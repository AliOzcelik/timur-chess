"""Practice API (Phase 6): play the engine, puzzles from your games, opening repertoire."""

from __future__ import annotations

import io
from typing import Any, Literal

import chess
import chess.pgn
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config, openings, training
from ..context import db, settings, trainer
from ..db import now_iso
from ..drills import puzzles
from ..engine import EngineUnavailable, build_board
from ..evals import win_percent
from ..pgn_tools import PgnError

router = APIRouter(prefix="/api")

Color = Literal["white", "black"]


# ---- play against the engine ------------------------------------------------------------

class PlayMove(BaseModel):
    fen: str | None = None
    moves: list[str] = Field(default_factory=list, max_length=1000)
    elo: int | None = Field(None, ge=800, le=3200)


@router.post("/play/move")
async def play_move(req: PlayMove) -> dict[str, Any]:
    try:
        board = build_board(req.fen, req.moves)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if board.is_game_over(claim_draw=True):
        return {"move": None, "over": _outcome(board)}
    try:
        move = await trainer.bot_move(board, req.elo, seconds=0.5 if req.elo else 1.0)
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    san = board.san(move)
    board.push(move)
    return {"move": {"uci": move.uci(), "san": san}, "fen": board.fen(),
            "over": _outcome(board) if board.is_game_over(claim_draw=True) else None}


def _outcome(board: chess.Board) -> dict[str, Any]:
    outcome = board.outcome(claim_draw=True)
    assert outcome is not None
    reason = outcome.termination.name.replace("_", " ").lower()
    return {"result": outcome.result(), "reason": reason,
            "winner": None if outcome.winner is None else ("white" if outcome.winner else "black")}


class PlayFinish(BaseModel):
    pgn: str = Field(..., max_length=config.MAX_PGN_CHARS)
    my_color: Color
    review: bool = True


@router.post("/play/finish")
async def play_finish(req: PlayFinish) -> dict[str, Any]:
    """Save a finished practice game to the library, and review it if asked."""
    from ..main import review_game  # late import: main imports this module

    try:
        if req.review:
            return review_game(req.pgn, profile=settings.get("default_profile"), my_color=req.my_color,
                               source="play")
    except PgnError as exc:
        raise HTTPException(400, str(exc)) from exc
    from ..context import library

    game = chess.pgn.read_game(io.StringIO(req.pgn))
    if game is None:
        raise HTTPException(400, "The PGN could not be read.")
    gid, _ = library.add(game, source="play", my_color=req.my_color)
    return {"id": None, "game_id": gid}


# ---- puzzles from your own mistakes ----------------------------------------------------

@router.get("/puzzles")
async def list_puzzles(endgame: bool | None = None, only_due: bool = False) -> dict[str, Any]:
    items = puzzles(db)
    progress = training.progress(db, "puzzle")
    out = []
    for p in items:
        if endgame is not None and p["endgame"] != endgame:
            continue
        state = progress.get(p["id"])
        if only_due and state is not None and not state["due"]:
            continue
        out.append({**p, "progress": state})
    # Never tried first, then due ones, then the rest.
    out.sort(key=lambda p: (p["progress"] is not None, not (p["progress"] or {}).get("due", True)))
    return {"puzzles": out, "total": len(items)}


class PuzzleCheck(BaseModel):
    fen: str
    uci: str
    best_uci: str | None = None


@router.post("/puzzles/check")
async def check_puzzle(req: PuzzleCheck) -> dict[str, Any]:
    """Is the move as good as the best one? Within 5% winning chance counts as solved."""
    try:
        board = build_board(req.fen, [])
        move = chess.Move.from_uci(req.uci)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not board.is_legal(move):
        raise HTTPException(400, "Illegal move.")
    mover = board.turn
    san = board.san(move)
    if req.best_uci and req.uci == req.best_uci:
        return {"correct": True, "exact": True, "san": san, "loss": 0.0}
    try:
        best = await trainer.evaluate(board, seconds=0.8)
        after = board.copy()
        after.push(move)
        if after.is_checkmate():
            return {"correct": True, "exact": False, "san": san, "loss": 0.0}
        got = await trainer.evaluate(after, seconds=0.8)
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    loss = max(0.0, win_percent(best["eval"], mover) - win_percent(got["eval"], mover))
    return {"correct": loss < 5.0, "exact": False, "san": san, "loss": round(loss, 1),
            "best": best["best"], "best_line": best["pv_san"], "reply_line": got["pv_san"]}


# ---- opening repertoire ---------------------------------------------------------------

def _edge_rows(color: str) -> list[dict[str, Any]]:
    return db.all("SELECT * FROM repertoire WHERE color = ? ORDER BY id", (color,))


@router.get("/repertoire")
async def get_repertoire(color: Color) -> dict[str, Any]:
    edges = _edge_rows(color)
    progress = training.progress(db, "rep")
    for e in edges:
        e["progress"] = progress.get(f"rep:{e['id']}")
        found = openings.index().get(e["to_epd"])
        e["opening"] = found.as_dict() if found else None
    return {"color": color, "root_epd": openings.epd(chess.Board()), "edges": edges}


class EdgeIn(BaseModel):
    color: Color
    fen: str
    uci: str
    comment: str = Field("", max_length=2000)


def _add_edge(color: str, board: chess.Board, move: chess.Move, comment: str = "") -> int:
    from_epd = openings.epd(board)
    san = board.san(move)
    board = board.copy(stack=False)
    board.push(move)
    existing = db.one("SELECT id FROM repertoire WHERE color = ? AND from_epd = ? AND uci = ?",
                      (color, from_epd, move.uci()))
    if existing:
        if comment:
            db.run("UPDATE repertoire SET comment = ? WHERE id = ?", (comment, existing["id"]))
        return existing["id"]
    return db.insert("repertoire", {"created_at": now_iso(), "color": color, "from_epd": from_epd,
                                    "uci": move.uci(), "san": san, "to_epd": openings.epd(board),
                                    "comment": comment})


@router.post("/repertoire/edges", status_code=201)
async def add_edge(req: EdgeIn) -> dict[str, Any]:
    try:
        board = chess.Board(req.fen)
        move = chess.Move.from_uci(req.uci)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not board.is_legal(move):
        raise HTTPException(400, "Illegal move.")
    mine = (board.turn == chess.WHITE) == (req.color == "white")
    if mine:
        other = db.one("SELECT san FROM repertoire WHERE color = ? AND from_epd = ? AND uci != ?",
                       (req.color, openings.epd(board), req.uci))
        if other:
            raise HTTPException(409, f"Your repertoire already plays {other['san']} here. "
                                     "Delete it first to choose another move.")
    return {"id": _add_edge(req.color, board, move, req.comment)}


class EdgeUpdate(BaseModel):
    comment: str = Field("", max_length=2000)


@router.put("/repertoire/edges/{edge_id}")
async def update_edge(edge_id: int, req: EdgeUpdate) -> dict[str, Any]:
    if db.run("UPDATE repertoire SET comment = ? WHERE id = ?", (req.comment, edge_id)) == 0:
        raise HTTPException(404, "Move not found.")
    return {"ok": True}


@router.delete("/repertoire/edges/{edge_id}")
async def delete_edge(edge_id: int) -> dict[str, Any]:
    """Delete the move and every move after it that is no longer reachable."""
    edge = db.one("SELECT * FROM repertoire WHERE id = ?", (edge_id,))
    if edge is None:
        raise HTTPException(404, "Move not found.")
    db.run("DELETE FROM repertoire WHERE id = ?", (edge_id,))
    removed = 1
    root = openings.epd(chess.Board())
    while True:
        rows = _edge_rows(edge["color"])
        reachable = {root}
        changed = True
        while changed:
            changed = False
            for r in rows:
                if r["from_epd"] in reachable and r["to_epd"] not in reachable:
                    reachable.add(r["to_epd"])
                    changed = True
        orphans = [r["id"] for r in rows if r["from_epd"] not in reachable]
        if not orphans:
            break
        for oid in orphans:
            db.run("DELETE FROM repertoire WHERE id = ?", (oid,))
            training.forget(db, f"rep:{oid}")
        removed += len(orphans)
    training.forget(db, f"rep:{edge_id}")
    return {"ok": True, "removed": removed}


class RepImport(BaseModel):
    color: Color
    pgn: str = Field(..., max_length=config.MAX_PGN_CHARS)
    max_plies: int = Field(30, ge=2, le=80)


@router.post("/repertoire/import")
async def import_repertoire(req: RepImport) -> dict[str, Any]:
    """Add every line of a PGN (with its variations) to the repertoire, up to `max_plies`."""
    stream = io.StringIO(req.pgn)
    added = 0
    conflicts: list[str] = []
    games = 0
    while (game := chess.pgn.read_game(stream)) is not None and games < 200:
        games += 1
        stack: list[tuple[chess.pgn.GameNode, chess.Board]] = [(game, game.board())]
        while stack:
            node, board = stack.pop()
            if board.ply() >= req.max_plies:
                continue
            for child in node.variations:
                move = child.move
                if move is None or not board.is_legal(move):
                    continue
                mine = (board.turn == chess.WHITE) == (req.color == "white")
                if mine:
                    other = db.one("SELECT san FROM repertoire WHERE color = ? AND from_epd = ? AND uci != ?",
                                   (req.color, openings.epd(board), move.uci()))
                    if other:
                        conflicts.append(f"{board.san(move)} (you play {other['san']})")
                        continue
                before = db.one("SELECT COUNT(*) AS n FROM repertoire")["n"]  # type: ignore[index]
                _add_edge(req.color, board, move, (child.comment or "").strip())
                added += db.one("SELECT COUNT(*) AS n FROM repertoire")["n"] - before  # type: ignore[index]
                nxt = board.copy(stack=False)
                nxt.push(move)
                stack.append((child, nxt))
    if games == 0:
        raise HTTPException(400, "No moves found in that PGN.")
    return {"added": added, "conflicts": conflicts[:20], "conflict_count": len(conflicts)}


@router.get("/repertoire/export")
async def export_repertoire(color: Color) -> dict[str, Any]:
    """The repertoire as one PGN with variations."""
    edges = _edge_rows(color)
    by_from: dict[str, list[dict[str, Any]]] = {}
    for e in edges:
        by_from.setdefault(e["from_epd"], []).append(e)
    game = chess.pgn.Game()
    game.headers["Event"] = f"Repertoire for {color}"
    seen: set[str] = set()
    stack: list[tuple[chess.pgn.GameNode, chess.Board]] = [(game, chess.Board())]
    while stack:
        node, board = stack.pop()
        key = openings.epd(board)
        if key in seen:
            continue
        seen.add(key)
        for e in by_from.get(key, []):
            move = chess.Move.from_uci(e["uci"])
            if not board.is_legal(move):
                continue
            child = node.add_variation(move, comment=e["comment"] or "")
            nxt = board.copy(stack=False)
            nxt.push(move)
            stack.append((child, nxt))
    return {"pgn": str(game)}
