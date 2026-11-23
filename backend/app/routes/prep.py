"""Tournament prep API (Phase 6): tournaments, rounds, checklists and opponents' games."""

from __future__ import annotations

import asyncio
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..context import db, library, settings
from ..db import now_iso

router = APIRouter(prefix="/api")

DEFAULT_CHECKLIST = [
    "Review my repertoire lines",
    "Look at my opponents' recent games",
    "Endgame drills: rook endings",
    "Sleep well the night before",
    "Pack a pen, water and a snack",
]

USER_AGENT = "Timur-local-chess-trainer/0.2"


# ---- tournaments -----------------------------------------------------------------------

class TournamentIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: str = Field("", max_length=200)
    start_date: str | None = None
    end_date: str | None = None
    time_control: str = Field("", max_length=100)
    notes: str = Field("", max_length=100_000)
    checklist: list[dict[str, Any]] | None = None


class TournamentPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    location: str | None = Field(None, max_length=200)
    start_date: str | None = None
    end_date: str | None = None
    time_control: str | None = Field(None, max_length=100)
    notes: str | None = Field(None, max_length=100_000)
    checklist: list[dict[str, Any]] | None = None


def _tournament(tid: int) -> dict[str, Any]:
    row = db.one("SELECT * FROM tournaments WHERE id = ?", (tid,))
    if row is None:
        raise HTTPException(404, "Tournament not found.")
    row["checklist"] = json.loads(row["checklist"] or "[]")
    return row


@router.get("/tournaments")
async def list_tournaments() -> dict[str, Any]:
    rows = db.all(
        "SELECT t.*, (SELECT COUNT(*) FROM tournament_rounds r WHERE r.tournament_id = t.id) AS rounds, "
        "(SELECT COUNT(*) FROM notes n WHERE n.tournament_id = t.id) AS note_count "
        "FROM tournaments t ORDER BY COALESCE(t.start_date, t.created_at) DESC"
    )
    for r in rows:
        r["checklist"] = json.loads(r["checklist"] or "[]")
    return {"tournaments": rows}


@router.post("/tournaments", status_code=201)
async def create_tournament(req: TournamentIn) -> dict[str, Any]:
    stamp = now_iso()
    checklist = req.checklist if req.checklist is not None else [{"text": t, "done": False} for t in DEFAULT_CHECKLIST]
    tid = db.insert("tournaments", {
        "created_at": stamp, "updated_at": stamp, "name": req.name.strip(), "location": req.location,
        "start_date": req.start_date or None, "end_date": req.end_date or None, "time_control": req.time_control,
        "notes": req.notes, "checklist": json.dumps(checklist),
    })
    return _tournament(tid)


@router.get("/tournaments/{tid}")
async def get_tournament(tid: int) -> dict[str, Any]:
    t = _tournament(tid)
    t["rounds"] = db.all("SELECT r.*, g.white, g.black, g.result AS game_result, g.opening, g.review_id "
                         "FROM tournament_rounds r LEFT JOIN games g ON g.id = r.game_id "
                         "WHERE r.tournament_id = ? ORDER BY r.number", (tid,))
    t["notes_list"] = db.all("SELECT id, title, updated_at, pinned FROM notes WHERE tournament_id = ? "
                             "ORDER BY pinned DESC, updated_at DESC", (tid,))
    points = 0.0
    played = 0
    for r in t["rounds"]:
        if r["result"] in ("1", "0.5", "0"):
            points += float(r["result"])
            played += 1
    t["score"] = {"points": points, "played": played}
    return t


@router.put("/tournaments/{tid}")
async def update_tournament(tid: int, req: TournamentPatch) -> dict[str, Any]:
    _tournament(tid)
    fields = req.model_dump(exclude_unset=True)
    if "checklist" in fields:
        fields["checklist"] = json.dumps(fields["checklist"] or [])
    fields["updated_at"] = now_iso()
    db.update("tournaments", tid, fields)
    return await get_tournament(tid)


@router.delete("/tournaments/{tid}")
async def delete_tournament(tid: int) -> dict[str, Any]:
    if db.run("DELETE FROM tournaments WHERE id = ?", (tid,)) == 0:
        raise HTTPException(404, "Tournament not found.")
    db.run("UPDATE notes SET tournament_id = NULL WHERE tournament_id = ?", (tid,))
    return {"ok": True}


class RoundIn(BaseModel):
    number: int | None = Field(None, ge=1, le=99)
    round_date: str | None = None
    opponent: str = Field("", max_length=200)
    opponent_rating: int | None = Field(None, ge=0, le=4000)
    my_color: Literal["white", "black"] | None = None
    result: Literal["1", "0.5", "0", ""] | None = None
    expected: str = Field("", max_length=2000)
    prep: str = Field("", max_length=100_000)
    game_id: int | None = None


@router.post("/tournaments/{tid}/rounds", status_code=201)
async def add_round(tid: int, req: RoundIn) -> dict[str, Any]:
    _tournament(tid)
    data = req.model_dump()
    if data["number"] is None:
        last = db.one("SELECT MAX(number) AS n FROM tournament_rounds WHERE tournament_id = ?", (tid,))
        data["number"] = int((last or {}).get("n") or 0) + 1
    data["result"] = data["result"] or None
    rid = db.insert("tournament_rounds", {"tournament_id": tid, **data})
    return db.one("SELECT * FROM tournament_rounds WHERE id = ?", (rid,)) or {}


@router.put("/tournaments/{tid}/rounds/{rid}")
async def update_round(tid: int, rid: int, req: RoundIn) -> dict[str, Any]:
    fields = req.model_dump(exclude_unset=True)
    if "result" in fields:
        fields["result"] = fields["result"] or None
    if not db.one("SELECT id FROM tournament_rounds WHERE id = ? AND tournament_id = ?", (rid, tid)):
        raise HTTPException(404, "Round not found.")
    db.update("tournament_rounds", rid, fields)
    return db.one("SELECT * FROM tournament_rounds WHERE id = ?", (rid,)) or {}


@router.delete("/tournaments/{tid}/rounds/{rid}")
async def delete_round(tid: int, rid: int) -> dict[str, Any]:
    if db.run("DELETE FROM tournament_rounds WHERE id = ? AND tournament_id = ?", (rid, tid)) == 0:
        raise HTTPException(404, "Round not found.")
    return {"ok": True}


# ---- opponents ------------------------------------------------------------------------

def _http_get(url: str, accept: str, timeout: float = 30) -> str:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https hosts only
        return resp.read().decode("utf-8", errors="replace")


def _fetch_lichess(username: str, max_games: int) -> str:
    q = urllib.parse.urlencode({"max": max_games, "opening": "true", "clocks": "false", "evals": "false"})
    return _http_get(f"https://lichess.org/api/games/user/{urllib.parse.quote(username)}?{q}",
                     "application/x-chess-pgn")


def _fetch_chesscom(username: str, max_games: int) -> str:
    name = urllib.parse.quote(username.lower())
    archives = json.loads(_http_get(f"https://api.chess.com/pub/player/{name}/games/archives", "application/json"))
    pgns: list[str] = []
    count = 0
    for url in reversed(archives.get("archives", [])):
        if count >= max_games:
            break
        if not url.startswith("https://api.chess.com/"):
            continue
        text = _http_get(url + "/pgn", "application/x-chess-pgn")
        games = [g for g in re.split(r"\n\n(?=\[Event )", text.strip()) if g.strip()]
        games.reverse()  # newest first
        take = games[: max_games - count]
        pgns.extend(take)
        count += len(take)
    return "\n\n".join(pgns)


class FetchRequest(BaseModel):
    site: Literal["lichess", "chesscom"]
    username: str = Field(..., min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    max: int = Field(50, ge=1, le=300)


@router.post("/opponents/fetch")
async def fetch_opponent(req: FetchRequest) -> dict[str, Any]:
    """Download an opponent's public games into the library (needs 'Allow internet' in Settings)."""
    if not settings.get("allow_internet"):
        raise HTTPException(403, "Timur works offline. To download games, turn on 'Allow internet' in Settings.")
    fetch = _fetch_lichess if req.site == "lichess" else _fetch_chesscom
    try:
        text = await asyncio.to_thread(fetch, req.username, req.max)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(404, f"No player called {req.username} on {req.site}.") from exc
        raise HTTPException(502, f"{req.site} answered with error {exc.code}. Try again later.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(502, f"Could not reach {req.site}. Check the internet connection.") from exc
    if not text.strip():
        return {"added": [], "duplicates": [], "problems": [], "problem_count": 0, "player": req.username}
    result = library.import_pgn(text, source=req.site, tags=[f"opponent:{req.username}"])
    # Mark which side the opponent had, from their point of view, in each game.
    return {**result, "player": req.username}


@router.get("/opponents")
async def list_opponents() -> dict[str, Any]:
    tags = [t for t in library.tags() if t["tag"].startswith("opponent:")]
    return {"opponents": [{"name": t["tag"].split(":", 1)[1], "games": t["count"]} for t in tags]}


@router.get("/opponents/{name}")
async def opponent_summary(name: str) -> dict[str, Any]:
    """What the opponent plays: openings as White and as Black, with their results."""
    rows = db.all("SELECT id, white, black, result, eco, opening, opening_family, sort_date FROM games "
                  "WHERE (', ' || tags || ',') LIKE ? OR LOWER(white) = LOWER(?) OR LOWER(black) = LOWER(?) "
                  "ORDER BY sort_date DESC",
                  (f"%, opponent:{name},%", name, name))
    sides: dict[str, dict[str, Any]] = {}
    for color in ("white", "black"):
        games = [r for r in rows if (r[color] or "").lower() == name.lower()]
        fam: Counter[str] = Counter()
        detail: dict[str, Counter[str]] = {}
        scores: dict[str, list[float]] = {}
        for g in games:
            family = g["opening_family"] or "Unknown opening"
            fam[family] += 1
            detail.setdefault(family, Counter())[g["opening"] or family] += 1
            if g["result"] in ("1-0", "0-1", "1/2-1/2"):
                s = 0.5 if g["result"] == "1/2-1/2" else float((g["result"] == "1-0") == (color == "white"))
                scores.setdefault(family, []).append(s)
        sides[color] = {
            "games": len(games),
            "openings": [
                {"family": f, "count": n,
                 "score": round(100 * sum(scores.get(f, [])) / len(scores[f])) if scores.get(f) else None,
                 "lines": [{"name": k, "count": v} for k, v in detail[f].most_common(5)]}
                for f, n in fam.most_common(12)
            ],
        }
    return {"name": name, "games": len(rows), "as_white": sides["white"], "as_black": sides["black"],
            "recent": rows[:15]}
