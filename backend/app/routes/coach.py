"""The AI coach: explanations for reviewed moves, and chat on the analysis board.

A local LLM writes the words; Stockfish and python-chess supply every fact
(see review/coach.py and review/chat.py).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..context import coach, coach_service, db, llm
from ..engine import EngineUnavailable, build_board
from ..llm import LLMUnavailable
from ..review.chat import build_messages, position_facts
from ..review.coach import EXPLAINABLE, unknown_moves

router = APIRouter(prefix="/api")

# One fact-finding job at a time: the coach engine is single-lane.
_lock = asyncio.Lock()


class ExplainRequest(BaseModel):
    refresh: bool = False


@router.get("/llm/status")
async def llm_status() -> dict[str, Any]:
    return await llm.status()


@router.post("/reviews/{review_id}/moves/{index}/explain")
async def explain_move(review_id: int, index: int, req: ExplainRequest | None = None) -> dict[str, Any]:
    refresh = bool(req and req.refresh)
    review = db.get_review(review_id)
    if review is None:
        raise HTTPException(404, "Review not found")
    analysis = review.get("analysis")
    if review["status"] != "done" or not analysis:
        raise HTTPException(409, "This review isn't finished yet.")
    moves = analysis["moves"]
    if not 0 <= index < len(moves):
        raise HTTPException(404, "No such move in this review")
    move = moves[index]
    if move["classification"] not in EXPLAINABLE:
        raise HTTPException(400, "Only inaccuracies, mistakes and blunders get an AI explanation.")
    if move.get("coach") and not refresh:
        return move["coach"]

    async with _lock:
        try:
            result = await coach.explain(move)
        except LLMUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        except EngineUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        # Re-read before saving, so an explanation saved meanwhile for another move is kept.
        fresh = db.get_review(review_id)
        if fresh is None or not fresh.get("analysis"):
            raise HTTPException(404, "Review not found")
        fresh["analysis"]["moves"][index]["coach"] = result
        db.update_review(review_id, result_json=json.dumps(fresh["analysis"]))
    return result


# ---- chat on the analysis board ----------------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=6000)


class ChatRequest(BaseModel):
    fen: str | None = None  # the board's starting position (None: the normal start)
    moves: list[str] = Field(default_factory=list, max_length=1200)  # UCI moves up to the current position
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=60)


def _event(kind: str, **data: Any) -> bytes:
    return (json.dumps({"type": kind, **data}) + "\n").encode()


@router.post("/coach/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """Streams newline-separated JSON: status, facts, delta (text pieces), then done or error."""
    if req.messages[-1].role != "user" or not req.messages[-1].content.strip():
        raise HTTPException(400, "The last message must be your question.")
    try:
        board = build_board(req.fen, req.moves)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not llm.config()["enabled"]:
        raise HTTPException(503, "The AI coach is turned off. Turn it on in Settings → AI coach.")
    question = req.messages[-1].content
    history = [m.model_dump() for m in req.messages]

    async def body() -> AsyncIterator[bytes]:
        yield _event("status", text="Stockfish is looking at the position…")
        try:
            async with _lock:
                engine = await coach_service.get()
                last = board.move_stack[-1] if board.move_stack else None
                facts, allowed = await position_facts(board, engine, question, last_move=last)
        except EngineUnavailable as exc:
            yield _event("error", message=str(exc))
            return
        yield _event("facts", facts=facts)
        text = ""
        try:
            async for piece in llm.stream(build_messages(history, facts)):
                text += piece
                yield _event("delta", text=piece)
        except LLMUnavailable as exc:
            yield _event("error", message=str(exc))
            return
        yield _event("done", unverified=unknown_moves(text, allowed))

    return StreamingResponse(body(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
