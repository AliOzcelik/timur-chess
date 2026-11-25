"""Timur: local chess trainer. FastAPI app (API + the built web UI)."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, Literal

import chess.pgn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, openings
from .context import (coach_service, db, library, live, live_service, review_service, runner, settings, tablebases,
                      trainer_service)
from .engine import EngineUnavailable
from .library import backfill_reviews
from .pgn_tools import PgnError, first_game, mainline_count, parse_for_board
from .review.runner import PROFILES
from .routes import coach as coach_routes, endgames, library as library_routes, notes, practice, prep, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("timur")

VERSION = "0.2.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await live_service.get()
    except EngineUnavailable:
        log.warning("Live engine is not available; the UI will show the error.")
    try:
        filed = backfill_reviews(db, library, settings.my_color_for)
        if filed:
            log.info("Filed %s earlier reviews in the library.", filed)
    except Exception:  # noqa: BLE001 - never block startup on this
        log.exception("Could not file earlier reviews in the library")
    try:
        _daily_backup()
    except Exception:  # noqa: BLE001
        log.exception("Automatic backup failed")
    runner.start()
    yield
    await runner.shutdown()
    await live.stop()
    await live_service.close()
    await review_service.close()
    await trainer_service.close()
    await coach_service.close()
    db.close()


def _daily_backup() -> None:
    """One automatic backup per day, made when the app starts."""
    from datetime import date

    from .context import BACKUP_DIR

    today = date.today().strftime("%Y-%m-%d")
    if BACKUP_DIR.is_dir() and any(BACKUP_DIR.glob(f"timur-{today}-*.db")):
        return
    if db.one("SELECT COUNT(*) AS n FROM reviews")["n"] == 0 and db.one("SELECT COUNT(*) AS n FROM games")["n"] == 0:  # type: ignore[index]
        return  # nothing to back up yet
    system.make_backup("auto")


app = FastAPI(title="Timur", version=VERSION, lifespan=lifespan)
for module in (library_routes, notes, endgames, practice, prep, system, coach_routes):
    app.include_router(module.router)


# ---- health ------------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": VERSION,
        "engines": {"live": live_service.status(), "review": review_service.status(),
                    "trainer": trainer_service.status()},
        "review_profiles": PROFILES,
        "tablebases": tablebases.status(),
        "openings": len(openings.index()),
        "settings": {"theme": settings.get("theme"), "accent": settings.get("accent"),
                     "board": settings.get("board"), "onboarded": settings.get("onboarded"),
                     "default_profile": settings.get("default_profile")},
    }


# ---- live engine -------------------------------------------------------------------------

@app.websocket("/api/engine/ws")
async def engine_socket(ws: WebSocket) -> None:
    await ws.accept()
    send_lock = asyncio.Lock()
    owner = object()

    async def send(message: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send_json(message)

    await send({"type": "hello", "engine": live_service.status()})
    try:
        while True:
            try:
                message = await ws.receive_json()
            except (ValueError, TypeError):
                await send({"type": "error", "message": "Messages must be JSON."})
                continue
            kind = message.get("type")
            if kind == "analyze":
                await live.start(send, message, owner)
            elif kind == "stop":
                await live.stop(owner)
            elif kind == "ping":
                await send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await live.stop(owner)


class EvalRequest(BaseModel):
    fen: str | None = None
    moves: list[str] = Field(default_factory=list, max_length=2000)
    depth: int = Field(18, ge=1, le=40)
    seconds: float = Field(2.0, gt=0, le=30)


@app.post("/api/engine/eval")
async def engine_eval(req: EvalRequest) -> dict[str, Any]:
    try:
        return await live.evaluate(req.fen, req.moves, req.depth, req.seconds)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


# ---- PGN ---------------------------------------------------------------------------------

class PgnRequest(BaseModel):
    pgn: str = Field(..., max_length=config.MAX_PGN_CHARS)


@app.post("/api/pgn/parse")
async def pgn_parse(req: PgnRequest) -> dict[str, Any]:
    try:
        return parse_for_board(req.pgn)
    except PgnError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---- reviews -----------------------------------------------------------------------------

class ReviewRequest(BaseModel):
    pgn: str = Field(..., max_length=config.MAX_PGN_CHARS)
    profile: Literal["quick", "standard", "deep"] = "standard"
    my_color: Literal["white", "black", "both"] = "both"
    game_id: int | None = None  # the library game this review belongs to
    save_to_library: bool = True


def _header(game: chess.pgn.Game, key: str) -> str | None:
    value = (game.headers.get(key) or "").strip()
    if value in ("", "?", "*", "????.??.??"):
        return None
    return value


def review_game(pgn: str, *, profile: str, my_color: str, game_id: int | None = None,
                save_to_library: bool = True, source: str = "review") -> dict[str, Any]:
    """Queue a review and file the game in the library (or link it to the library game it came from)."""
    game, count = first_game(pgn)
    plies = mainline_count(game)
    if plies == 0:
        raise PgnError("This game has no moves to review.")
    opening = openings.detect_game(game)
    review_id = db.create_review(
        profile=profile,
        my_color=my_color,
        white=_header(game, "White"),
        black=_header(game, "Black"),
        result=_header(game, "Result"),
        event=_header(game, "Event"),
        game_date=_header(game, "Date"),
        ply_count=plies,
        total=plies + 1,
        pgn=str(game),
        eco=opening.eco if opening else None,
        opening=opening.name if opening else None,
    )
    if game_id is not None and library.get(game_id) is None:
        game_id = None
    if game_id is None and save_to_library:
        color = my_color if my_color in ("white", "black") else settings.my_color_for(
            _header(game, "White"), _header(game, "Black"))
        game_id, _ = library.add(game, source=source, my_color=color)
    if game_id is not None:
        library.link_review(game_id, review_id)
    runner.enqueue(review_id)
    return {"id": review_id, "game_count": count, "game_id": game_id}


@app.post("/api/reviews", status_code=201)
async def create_review(req: ReviewRequest) -> dict[str, Any]:
    try:
        return review_game(req.pgn, profile=req.profile, my_color=req.my_color, game_id=req.game_id,
                           save_to_library=req.save_to_library)
    except PgnError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/reviews")
async def list_reviews() -> dict[str, Any]:
    return {"reviews": db.list_reviews(), "current": runner.current}


@app.get("/api/reviews/{review_id}")
async def get_review(review_id: int) -> dict[str, Any]:
    review = db.get_review(review_id)
    if review is None:
        raise HTTPException(404, "Review not found.")
    return review


@app.delete("/api/reviews/{review_id}")
async def delete_review(review_id: int) -> dict[str, Any]:
    runner.cancel(review_id)
    if not db.delete_review(review_id):
        raise HTTPException(404, "Review not found.")
    return {"ok": True}


# ---- web UI ------------------------------------------------------------------------------

# The new design is a static, self-contained preview served from design/.
# It is mounted before the SPA so /design/... is not swallowed by the app's
# single-page fallback. The working app remains at /.
_design_dir = config.ROOT / "design"
if _design_dir.is_dir():
    app.mount("/design", StaticFiles(directory=_design_dir, html=True), name="design")

if (config.FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="ui")
else:
    @app.get("/", response_class=HTMLResponse)
    async def ui_missing() -> str:
        return (
            "<h1>Timur</h1><p>The web interface has not been built yet. "
            "Run <code>./start.sh</code> from the project folder.</p>"
        )
