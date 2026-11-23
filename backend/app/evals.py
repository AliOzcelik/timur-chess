"""Evaluation helpers shared by live analysis and game review.

Evals are always stored from White's point of view as a small dict:
    {"cp": 34, "mate": None}            -> White is up 0.34 pawns
    {"cp": None, "mate": -3}            -> Black mates in 3
    {"cp": None, "mate": 0, "winner": "white"}   -> the game is over, White has mated
    {"cp": 0, "mate": None, "draw": True}        -> game over by draw (stalemate, ...)
"""

from __future__ import annotations

import math
from typing import Any

import chess
import chess.engine

# Like lichess: centipawns are capped at ±1000 before turning them into a
# winning chance, and a forced mate counts as the cap.
CP_CAP = 1000
WIN_K = 0.00368208

Eval = dict[str, Any]


def score_to_eval(score: chess.engine.PovScore) -> Eval:
    white = score.white()
    if white.is_mate():
        return {"cp": None, "mate": white.mate()}
    return {"cp": white.score(), "mate": None}


def terminal_eval(board: chess.Board) -> Eval | None:
    """Eval for a finished game, or None if the game is still going."""
    if board.is_checkmate():
        return {"cp": None, "mate": 0, "winner": "black" if board.turn == chess.WHITE else "white"}
    if board.is_stalemate() or board.is_insufficient_material() or board.is_seventyfive_moves() or board.is_fivefold_repetition():
        return {"cp": 0, "mate": None, "draw": True}
    return None


def white_cp(e: Eval) -> int:
    """White-POV centipawns, capped at ±CP_CAP (mates count as the cap)."""
    if e.get("winner") == "white":
        return CP_CAP
    if e.get("winner") == "black":
        return -CP_CAP
    mate = e.get("mate")
    if mate is not None:
        return CP_CAP if mate > 0 else -CP_CAP
    cp = e.get("cp") or 0
    return max(-CP_CAP, min(CP_CAP, cp))


def cp_for(e: Eval, color: chess.Color) -> int:
    cp = white_cp(e)
    return cp if color == chess.WHITE else -cp


def win_percent_white(e: Eval) -> float:
    """Chance (0-100) that White wins, using the same curve as lichess."""
    if e.get("winner") == "white":
        return 100.0
    if e.get("winner") == "black":
        return 0.0
    cp = white_cp(e)
    return 50 + 50 * (2 / (1 + math.exp(-WIN_K * cp)) - 1)


def win_percent(e: Eval, color: chess.Color) -> float:
    wp = win_percent_white(e)
    return wp if color == chess.WHITE else 100.0 - wp


def mate_for(e: Eval, color: chess.Color) -> int | None:
    """Moves to mate for `color` (positive), or None if `color` has no forced mate."""
    mate = e.get("mate")
    if mate is None or e.get("winner"):
        return None
    if color == chess.WHITE and mate > 0:
        return mate
    if color == chess.BLACK and mate < 0:
        return -mate
    return None


def format_eval(e: Eval) -> str:
    if e.get("winner"):
        return "1-0" if e["winner"] == "white" else "0-1"
    if e.get("draw"):
        return "½-½"
    mate = e.get("mate")
    if mate is not None:
        return f"#{mate}" if mate > 0 else f"#-{-mate}"
    cp = e.get("cp") or 0
    if cp == 0:
        return "0.00"  # no sign on a level eval, same as the analysis board
    return f"{cp / 100:+.2f}"
