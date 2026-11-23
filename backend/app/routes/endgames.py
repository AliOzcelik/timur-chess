"""Endgame trainer API (Phase 5) and spaced-repetition progress."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import chess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import training
from ..context import db, tablebases, trainer
from ..drills import endgame_drills
from ..engine import EngineUnavailable, build_board
from ..trainer import meets

router = APIRouter(prefix="/api")

LESSONS_FILE = Path(__file__).resolve().parents[1] / "data" / "endgames" / "lessons.json"
CATEGORIES = ["Basic mates", "King and pawn", "Rook endings", "Minor pieces", "Queen endings", "From your games"]


@lru_cache(maxsize=1)
def lessons() -> list[dict[str, Any]]:
    data = json.loads(LESSONS_FILE.read_text(encoding="utf-8"))
    for lesson in data:
        lesson["side"] = "white" if chess.Board(lesson["fen"]).turn == chess.WHITE else "black"
    return data


def find_lesson(lesson_id: str) -> dict[str, Any]:
    for lesson in lessons():
        if lesson["id"] == lesson_id:
            return lesson
    if lesson_id.startswith("game:"):
        for drill in endgame_drills(db):
            if drill["id"] == lesson_id:
                drill["side"] = "white" if chess.Board(drill["fen"]).turn == chess.WHITE else "black"
                return drill
    raise HTTPException(404, "Lesson not found.")


def item_id(lesson_id: str) -> str:
    return lesson_id if lesson_id.startswith("game:") else f"endgame:{lesson_id}"


@router.get("/endgames")
async def list_endgames() -> dict[str, Any]:
    progress = training.progress(db, "endgame")
    out = []
    for lesson in lessons():
        out.append({k: lesson[k] for k in ("id", "category", "level", "title", "fen", "goal", "side")}
                   | {"progress": progress.get(item_id(lesson["id"]))})
    drills = endgame_drills(db)
    for d in drills:
        d["side"] = "white" if chess.Board(d["fen"]).turn == chess.WHITE else "black"
        out.append({k: d[k] for k in ("id", "category", "level", "title", "fen", "goal", "side", "opening", "date")}
                   | {"progress": progress.get(d["id"])})
    return {"lessons": out, "categories": CATEGORIES, "tablebases": tablebases.status()}


@router.get("/endgames/lessons/{lesson_id}")
async def get_lesson(lesson_id: str) -> dict[str, Any]:
    lesson = dict(find_lesson(lesson_id))
    lesson["progress"] = training.describe(db.one("SELECT * FROM training WHERE item_id = ?", (item_id(lesson_id),)))
    lesson["item_id"] = item_id(lesson_id)
    board = chess.Board(lesson["fen"])
    lesson["exact"] = tablebases.covers(board)
    return lesson


class Success(BaseModel):
    type: Literal["mate", "promote", "capture", "hold"]
    moves: int = Field(10, ge=1, le=60)


class MoveRequest(BaseModel):
    fen: str
    moves: list[str] = Field(default_factory=list, max_length=600)
    goal: Literal["win", "draw"]
    success: Success


GOAL_TEXT = {"win": "the win", "draw": "the draw"}


def _check_success(board: chess.Board, user: chess.Color, success: Success, goal: str, result: str,
                   user_moves: int) -> bool:
    if not meets(result, goal):
        return False
    last = board.peek() if board.move_stack else None
    if success.type == "mate":
        return board.is_checkmate() and board.turn != user
    if success.type == "promote":
        return last is not None and last.promotion is not None and board.turn != user
    if success.type == "capture":
        opponent = not user
        return board.occupied_co[opponent] == board.kings & board.occupied_co[opponent]
    return user_moves >= success.moves


@router.post("/endgames/move")
async def endgame_move(req: MoveRequest) -> dict[str, Any]:
    """Judge your last move, then play the defence. The start position must be your move."""
    try:
        board = build_board(req.fen, req.moves)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    user = chess.Board(req.fen).turn
    if not req.moves:
        raise HTTPException(400, "Play a move first.")
    if len(req.moves) % 2 == 0:
        raise HTTPException(400, "It is the trainer's move, not yours.")
    user_moves = (len(req.moves) + 1) // 2
    try:
        state = await trainer.assess(board, user)
        if not meets(state["result"], req.goal):
            before = board.copy()
            before.pop()
            best, source, pv = await trainer.best_move(before)
            reason = f" ({state['reason']})" if state.get("reason") else ""
            return {
                "ok": False, "success": False, "finished": True, "result": state["result"], "source": state["source"],
                "message": f"That move gives away {GOAL_TEXT[req.goal]}{reason}. {before.san(best)} was the move.",
                "best": {"uci": best.uci(), "san": before.san(best), "line": pv}, "reply": None,
            }
        if _check_success(board, user, req.success, req.goal, state["result"], user_moves) or (
                state.get("over") and req.goal == "draw"):
            return {"ok": True, "success": True, "finished": True, "result": state["result"],
                    "source": state["source"], "message": _success_text(req.success, req.goal), "reply": None,
                    "best": None}
        if state.get("over"):
            return {"ok": False, "success": False, "finished": True, "result": state["result"],
                    "source": state["source"], "message": f"The game is over: {state.get('reason')}.", "reply": None,
                    "best": None}

        reply, _, _ = await trainer.best_move(board, seconds=0.3)
        reply_san = board.san(reply)
        board.push(reply)
        after = await trainer.assess(board, user)
        payload = {"reply": {"uci": reply.uci(), "san": reply_san}, "result": after["result"],
                   "source": after["source"], "dtz": after.get("dtz"), "win": after.get("win"), "best": None}
        if after.get("over"):
            if req.goal == "draw" and meets(after["result"], "draw"):
                return {**payload, "ok": True, "success": True, "finished": True,
                        "message": f"Drawn by {after['reason']}. Well held."}
            if not meets(after["result"], req.goal):
                return {**payload, "ok": False, "success": False, "finished": True,
                        "message": f"The game ended: {after['reason']}. That's not {GOAL_TEXT[req.goal]}."}
        return {**payload, "ok": True, "success": False, "finished": False,
                "message": _progress_text(req.success, user_moves, after)}
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


def _success_text(success: Success, goal: str) -> str:
    return {
        "mate": "Checkmate. Well done.",
        "promote": "The pawn has queened and the win is safe. Well done.",
        "capture": "Only the king is left. The rest is a basic mate. Well done.",
        "hold": f"You kept {GOAL_TEXT[goal]} for {success.moves} moves. Well done.",
    }[success.type]


def _progress_text(success: Success, user_moves: int, state: dict[str, Any]) -> str:
    if success.type == "hold":
        left = success.moves - user_moves
        return f"Still {'winning' if state['result'] == 'win' else 'holding'}. {left} more move{'s' if left != 1 else ''}."
    if state.get("dtz") is not None and state["result"] == "win":
        return "Still winning."
    return "Good. Keep going."


class HintRequest(BaseModel):
    fen: str
    moves: list[str] = Field(default_factory=list, max_length=600)


@router.post("/endgames/hint")
async def endgame_hint(req: HintRequest) -> dict[str, Any]:
    try:
        board = build_board(req.fen, req.moves)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if board.is_game_over():
        raise HTTPException(400, "The game is over.")
    try:
        move, source, pv = await trainer.best_move(board)
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    piece = board.piece_at(move.from_square)
    return {
        "best": {"uci": move.uci(), "san": board.san(move), "line": pv},
        "source": source,
        "piece": chess.piece_name(piece.piece_type) if piece else None,
        "from": chess.square_name(move.from_square),
    }


class AssessRequest(BaseModel):
    fen: str
    moves: list[str] = Field(default_factory=list, max_length=600)


@router.post("/endgames/assess")
async def endgame_assess(req: AssessRequest) -> dict[str, Any]:
    """Exact result (tablebase) or Stockfish's verdict for the side to move."""
    try:
        board = build_board(req.fen, req.moves)
        return await trainer.assess(board, board.turn)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


# ---- spaced repetition ------------------------------------------------------------------

class ResultRequest(BaseModel):
    item_id: str = Field(..., max_length=200)
    kind: Literal["endgame", "puzzle", "rep"]
    outcome: Literal["good", "hard", "again"]


@router.post("/training/result")
async def training_result(req: ResultRequest) -> dict[str, Any]:
    return training.record(db, req.item_id, req.kind, req.outcome) or {}


@router.get("/training")
async def training_progress(kind: str | None = None) -> dict[str, Any]:
    items = training.progress(db, kind)
    due = sum(1 for i in items.values() if i and i["due"])
    mastered = sum(1 for i in items.values() if i and i["mastered"])
    return {"items": items, "due": due, "mastered": mastered, "total": len(items)}
