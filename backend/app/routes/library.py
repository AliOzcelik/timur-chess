"""Library API (Phase 3): games and analyses, sorted by date and grouped by opening."""

from __future__ import annotations

import io
from datetime import date
from typing import Any, Literal

import chess
import chess.pgn
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config, openings
from ..context import library, settings
from ..engine import build_board
from ..pgn_tools import PgnError, game_to_tree

router = APIRouter(prefix="/api")

Color = Literal["white", "black"]


def _filters(q: str | None, family: str | None, opening: str | None, eco: str | None, color: str | None,
             kind: str | None, tag: str | None, outcome: str | None, since: str | None, until: str | None,
             player: str | None = None) -> dict[str, Any]:
    return {"q": q, "family": family, "opening": opening, "eco": eco, "color": color, "kind": kind, "tag": tag,
            "outcome": outcome, "since": since, "until": until, "player": player}


@router.get("/games")
async def list_games(q: str | None = None, family: str | None = None, opening: str | None = None,
                     eco: str | None = None, color: str | None = None, kind: str | None = None,
                     tag: str | None = None, outcome: str | None = None, since: str | None = None,
                     until: str | None = None, player: str | None = None,
                     limit: int = Query(500, ge=1, le=5000)) -> dict[str, Any]:
    rows, total = library.query(_filters(q, family, opening, eco, color, kind, tag, outcome, since, until, player),
                                limit)
    return {"games": rows, "total": total}


@router.get("/games/export")
async def export_games(ids: str | None = None, q: str | None = None, family: str | None = None,
                       color: str | None = None, kind: str | None = None, tag: str | None = None) -> Response:
    filters = _filters(q, family, None, None, color, kind, tag, None, None, None)
    if ids:
        try:
            filters["ids"] = [int(i) for i in ids.split(",") if i.strip()]
        except ValueError as exc:
            raise HTTPException(400, "ids must be numbers separated by commas.") from exc
    text = library.export(filters)
    name = f"timur-games-{date.today().isoformat()}.pgn"
    return Response(text, media_type="application/x-chess-pgn",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/games/tags")
async def game_tags() -> dict[str, Any]:
    return {"tags": library.tags()}


@router.get("/games/{game_id}")
async def get_game(game_id: int) -> dict[str, Any]:
    row = library.get(game_id)
    if row is None:
        raise HTTPException(404, "Game not found.")
    game = chess.pgn.read_game(io.StringIO(row["pgn"]))
    row["headers"] = dict(game.headers) if game else {}
    row["tree"] = game_to_tree(game) if game else None
    return row


class GameCreate(BaseModel):
    pgn: str = Field(..., max_length=config.MAX_PGN_CHARS)
    kind: Literal["game", "analysis"] = "game"
    source: Literal["board", "import", "review", "play"] = "board"
    my_color: Color | None = None
    tags: str | list[str] | None = None


@router.post("/games", status_code=201)
async def create_game(req: GameCreate) -> dict[str, Any]:
    game = chess.pgn.read_game(io.StringIO(req.pgn))
    if game is None or game.errors:
        raise HTTPException(400, "The PGN could not be read.")
    color = req.my_color or settings.my_color_for(game.headers.get("White"), game.headers.get("Black"))
    gid, created = library.add(game, source=req.source, kind=req.kind, my_color=color, tags=req.tags)
    return {"id": gid, "created": created, "game": library.get(gid)}


class GameUpdate(BaseModel):
    pgn: str | None = Field(None, max_length=config.MAX_PGN_CHARS)
    my_color: Color | Literal["none"] | None = None
    tags: str | list[str] | None = None
    kind: Literal["game", "analysis"] | None = None


@router.put("/games/{game_id}")
async def update_game(game_id: int, req: GameUpdate) -> dict[str, Any]:
    color: Any = False
    if req.my_color is not None:
        color = None if req.my_color == "none" else req.my_color
    try:
        row = library.update(game_id, pgn=req.pgn, my_color=color, tags=req.tags, kind=req.kind)
    except PgnError as exc:
        raise HTTPException(400, str(exc)) from exc
    if row is None:
        raise HTTPException(404, "Game not found.")
    return row


@router.delete("/games/{game_id}")
async def delete_game(game_id: int) -> dict[str, Any]:
    if not library.delete(game_id):
        raise HTTPException(404, "Game not found.")
    return {"ok": True}


class ImportRequest(BaseModel):
    pgn: str = Field(..., max_length=20_000_000)
    my_color: Color | None = None
    tags: str | list[str] | None = None


@router.post("/games/import")
async def import_games(req: ImportRequest) -> dict[str, Any]:
    try:
        return library.import_pgn(req.pgn, my_color=req.my_color, tags=req.tags, guess_color=settings.my_color_for)
    except PgnError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/library/openings")
async def opening_tree(color: str | None = None, kind: str | None = None, q: str | None = None,
                       since: str | None = None, until: str | None = None) -> dict[str, Any]:
    return {"families": library.opening_tree(_filters(q, None, None, None, color, kind, None, None, since, until))}


@router.get("/library/stats")
async def opening_stats(family: str | None = None, opening: str | None = None, eco: str | None = None,
                        color: str | None = None, kind: str | None = None, since: str | None = None,
                        until: str | None = None, player: str | None = None) -> dict[str, Any]:
    return library.opening_stats(_filters(None, family, opening, eco, color, kind, None, None, since, until, player))


class DetectRequest(BaseModel):
    fen: str | None = None
    moves: list[str] = Field(default_factory=list, max_length=2000)


@router.post("/openings/detect")
async def detect_opening(req: DetectRequest) -> dict[str, Any]:
    try:
        start = build_board(req.fen, [])
        moves = [chess.Move.from_uci(m) for m in req.moves]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    found = openings.detect_board_line(start, moves)
    return {"opening": found.as_dict() if found else None}
