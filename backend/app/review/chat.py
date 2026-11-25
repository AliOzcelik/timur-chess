"""Chat about the position on the analysis board.

The model can't see the board and can't calculate, so before every answer:
- Stockfish analyses the position (top 3 lines) and the threat (the same
  position with the other side to move),
- any move the user names in the question is checked by Stockfish too, so
  "what about Nxe5?" gets a real verdict and refutation,
- python-chess lists the position's features and what the best line changes.

Those facts go into the question. Afterwards every move in the answer is
checked against the facts and the legal moves; anything else is flagged.
"""

from __future__ import annotations

import json
from typing import Any

import chess
import chess.engine

from .. import openings
from ..engine import threat_board
from ..evals import format_eval, win_percent
from .coach import MOVE_TOKEN, _analyse, _norm, _sans, describe, settle, unknown_moves
from .motifs import line_text, material_swing, pawns_worth
from .positional import changes, features, material_text, ranked

LINE_PLIES = 6
MAX_ASKED = 3
MAX_HISTORY = 10
MAX_CHARS = 2000

SYSTEM_PROMPT = """You are a friendly chess coach sitting next to the player at their analysis board.
You cannot see the board and you must not calculate. With every question you get fresh facts about the position now on the board, from Stockfish and from board analysis. They are correct.

How to answer:
- Answer the question in a few short sentences (at most 5) unless the player asks for more detail.
- Base every claim on the facts. If the facts don't answer the question, say so plainly and suggest how to find out (for example: play the move on the board and ask again).
- Mention only moves that appear in the facts (engine lines, threat, asked_moves). Copy them exactly as written there.
- "*_does" fields say what a move physically does. Never describe a move differently.
- asked_moves holds Stockfish's verdict on moves the player asked about. Use the verdict and refutation given there.
- not_legal_here lists moves the player named that can't be played now; say so.
- You may describe the evaluation in words (equal, slightly better, winning). Avoid raw numbers unless the player asks.
- Earlier messages may be about earlier positions. The facts in the latest message are about the position now on the board.
- Plain text. No markdown headings, tables or bold."""

SEARCH = chess.engine.Limit(depth=18, time=1.0)
ASKED_SEARCH = chess.engine.Limit(depth=16, time=0.6)


def _verdict(drop: float) -> str:
    if drop < 2:
        return "as good as the engine's top move"
    if drop < 5:
        return "fine, slightly weaker than the top move"
    if drop < 10:
        return "an inaccuracy"
    if drop < 15:
        return "a mistake"
    return "a blunder"


def _eval_words(e: dict[str, Any]) -> str:
    if e.get("winner"):
        return f"{e['winner'].capitalize()} has won"
    if e.get("draw"):
        return "drawn"
    mate = e.get("mate")
    if mate is not None:
        return f"{'White' if mate > 0 else 'Black'} mates in {abs(mate)}"
    cp = e.get("cp") or 0
    side = "White" if cp > 0 else "Black"
    a = abs(cp)
    if a < 30:
        words = "equal"
    elif a < 80:
        words = f"{side} is slightly better"
    elif a < 200:
        words = f"{side} is better"
    elif a < 500:
        words = f"{side} is winning"
    else:
        words = f"{side} is completely winning"
    return f"{words} ({format_eval(e)})"


def asked_moves(board: chess.Board, text: str) -> tuple[list[chess.Move], list[str]]:
    """Legal moves the player names in their question ("what about Nxe5?", "why not 14.d4"),
    and move-like words that aren't legal here ("Qxd8" when no queen can take on d8)."""
    out: list[chess.Move] = []
    illegal: list[str] = []
    for m in MOVE_TOKEN.finditer(text):
        san = m.group(2).replace("0", "O")
        # Any legal move the player names counts, even a bare "e4": they are asking about it.
        try:
            move = board.parse_san(san)
        except ValueError:
            # A bare "e4" that isn't legal is probably a square name; anything else is a move attempt.
            if not (san[0] in "abcdefgh" and "x" not in san and not m.group(1)) and san not in illegal:
                illegal.append(san)
            continue
        if move not in out:
            out.append(move)
        if len(out) >= MAX_ASKED:
            break
    return out, illegal


async def position_facts(board: chess.Board, engine: chess.engine.UciProtocol, question: str,
                         last_move: chess.Move | None = None) -> tuple[dict[str, Any], set[str]]:
    """Facts about the board for one question, plus every move (SAN) the answer may mention."""
    mover = board.turn
    side = "White" if mover == chess.WHITE else "Black"
    facts: dict[str, Any] = {"side_to_move": side, "move_number": board.fullmove_number}
    # Only moves Stockfish actually looked at count as checked; any other legal move gets flagged.
    allowed: set[str] = set()

    if last_move is not None:
        prev = board.copy()
        prev.pop()
        facts["last_move"] = line_text(prev, [last_move], 1)
        facts["last_move_does"] = describe(prev, last_move)
        allowed.add(_norm(prev.san(last_move)))

    if board.is_game_over():
        outcome = board.outcome()
        facts["game_over"] = outcome.termination.name.lower().replace("_", " ") if outcome else "over"
        return facts, allowed

    opening = openings.detect_board_line(chess.Board(board.root().fen()), list(board.move_stack)) if board.move_stack else None
    if opening:
        facts["opening"] = f"{opening.eco} {opening.name}"

    lines = await _analyse(engine, board, 3, SEARCH)
    base = features(board)
    if lines:
        top = lines[0]
        facts["evaluation"] = _eval_words(top["eval"])
        facts["engine_lines"] = [
            {"line": line_text(board, ln["pv"], LINE_PLIES), "evaluation": _eval_words(ln["eval"])} for ln in lines
        ]
        best = top["pv"][0]
        facts["best_move"] = line_text(board, [best], 1)
        facts["best_move_does"] = describe(board, best)
        if len(lines) >= 2:
            gap = win_percent(top["eval"], mover) - win_percent(lines[1]["eval"], mover)
            if gap >= 15:
                facts["only_move"] = f"{facts['best_move']} is the only good move; the next best is much worse"
        best_end = settle(board, top["pv"])
        facts["what_the_best_line_changes"] = ranked(changes(base, features(best_end)), 4) or ["no notable positional changes"]
        swing = material_swing(board, top["pv"], mover)
        if swing >= 1:
            facts["best_line_wins"] = f"{pawns_worth(swing)} for {side}"
        for ln in lines:
            allowed.update(_norm(s) for s in _sans(board, ln["pv"][:LINE_PLIES]))

    facts["position_features"] = ranked(base, 8) or ["nothing notable"]
    facts["material"] = material_text(board)

    if not board.is_check():
        tb = threat_board(board)
        threats = await _analyse(engine, tb, 1, ASKED_SEARCH)
        if threats and threats[0]["pv"]:
            pv = threats[0]["pv"]
            other = "Black" if mover == chess.WHITE else "White"
            gain = material_swing(tb, pv, not mover)
            facts["threat"] = {
                "if_it_were_the_opponents_move": f"{other} would play {line_text(tb, pv, 4)}",
                "does": describe(tb, pv[0]),
                "wins_material": pawns_worth(gain) if gain >= 1 else "no",
            }
            allowed.update(_norm(s) for s in _sans(tb, pv[:4]))
    else:
        facts["in_check"] = f"{side} is in check"

    asked, illegal = asked_moves(board, question)
    if illegal:
        facts["not_legal_here"] = [f"{san} is not a legal move in this position" for san in illegal]
        allowed.update(_norm(san) for san in illegal)
    if asked and lines:
        best_win = win_percent(lines[0]["eval"], mover)
        out = []
        for move in asked:
            allowed.add(_norm(board.san(move)))
            after = board.copy(stack=False)
            after.push(move)
            replies = await _analyse(engine, after, 1, ASKED_SEARCH)
            if after.is_game_over():
                out.append({"move": line_text(board, [move], 1), "does": describe(board, move), "verdict": "ends the game"})
                continue
            if not replies:
                continue
            e = replies[0]["eval"]
            drop = max(0.0, best_win - win_percent(e, mover))
            reply = replies[0]["pv"]
            entry: dict[str, Any] = {
                "move": line_text(board, [move], 1),
                "does": describe(board, move),
                "verdict": _verdict(drop) if move != lines[0]["pv"][0] else "the engine's top move",
                "evaluation_after": _eval_words(e),
                "best_reply_line": line_text(after, reply, LINE_PLIES),
            }
            lost = material_swing(board, [move, *reply], mover)
            if lost <= -1:
                entry["loses_material"] = pawns_worth(-lost)
            entry["what_it_changes"] = ranked(changes(base, features(settle(board, [move, *reply]))), 3) or ["no notable positional changes"]
            out.append(entry)
            allowed.update(_norm(s) for s in _sans(after, reply[:LINE_PLIES]))
        facts["asked_moves"] = out
    return facts, allowed


def build_messages(history: list[dict[str, str]], facts: dict[str, Any]) -> list[dict[str, str]]:
    """System prompt, earlier turns as plain text, and the latest question with the facts attached."""
    turns = [m for m in history if m.get("role") in ("user", "assistant") and m.get("content", "").strip()]
    turns = turns[-MAX_HISTORY:]
    out: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in turns[:-1]:
        out.append({"role": m["role"], "content": m["content"][:MAX_CHARS]})
    question = turns[-1]["content"][:MAX_CHARS] if turns else ""
    out.append({"role": "user", "content": (
        "Facts about the position now on the board (from Stockfish and board analysis):\n"
        f"{json.dumps(facts, indent=1)}\n\n"
        f"My question: {question}"
    )})
    return out


__all__ = ["position_facts", "build_messages", "unknown_moves", "SYSTEM_PROMPT"]
