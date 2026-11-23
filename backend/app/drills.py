"""Training material taken from your own reviewed games: puzzles and endgame drills."""

from __future__ import annotations

import json
from typing import Any

import chess

from .db import Database

BAD = ("mistake", "blunder")


def is_endgame(board: chess.Board) -> bool:
    """Few pieces left: at most 6 pieces besides kings and pawns (lichess's definition)."""
    pieces = chess.popcount(board.occupied & ~board.kings & ~board.pawns)
    return pieces <= 6


def _my_moves(db: Database) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """(review row, move) for every mistake or blunder made by you in a finished review."""
    rows = db.all(
        "SELECT id, created_at, my_color, white, black, game_date, event, eco, opening, game_id, result_json "
        "FROM reviews WHERE status = 'done' ORDER BY created_at DESC, id DESC"
    )
    out = []
    for r in rows:
        try:
            analysis = json.loads(r.pop("result_json") or "null")
        except ValueError:
            continue
        if not analysis:
            continue
        for m in analysis.get("moves", []):
            if m["classification"] not in BAD or not m.get("best"):
                continue
            if r["my_color"] in ("white", "black") and m["color"] != r["my_color"]:
                continue
            out.append((r, m))
    return out


def _source(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "review_id": r["id"],
        "game_id": r["game_id"],
        "white": r["white"],
        "black": r["black"],
        "date": r["game_date"],
        "event": r["event"],
        "eco": r["eco"],
        "opening": r["opening"],
    }


def puzzles(db: Database) -> list[dict[str, Any]]:
    out = []
    for r, m in _my_moves(db):
        out.append({
            "id": f"puzzle:r{r['id']}m{m['index']}",
            "fen": m["fen_before"],
            "color": m["color"],
            "move_number": m["move_number"],
            "played": {"san": m["san"], "uci": m["uci"]},
            "best": m["best"],
            "best_line_san": m.get("best_line_san") or [],
            "classification": m["classification"],
            "win_before": m["win_before"],
            "win_after": m["win_after"],
            "explanation": m.get("explanation"),
            "endgame": is_endgame(chess.Board(m["fen_before"])),
            **_source(r),
        })
    return out


def endgame_drills(db: Database) -> list[dict[str, Any]]:
    """Endgame positions where you went wrong. Goal: the result the position deserved."""
    out = []
    for r, m in _my_moves(db):
        board = chess.Board(m["fen_before"])
        if not is_endgame(board):
            continue
        win = m["win_before"]
        goal = "win" if win >= 75 else "draw" if win >= 40 else None
        if goal is None:
            continue  # it was lost already; nothing to practise
        out.append({
            "id": f"game:{r['id']}:{m['index']}",
            "category": "From your games",
            "level": 2,
            "title": f"Move {m['move_number']}{'.' if m['color'] == 'white' else '...'} "
                     f"vs {r['black'] if m['color'] == 'white' else r['white'] or 'opponent'}",
            "fen": m["fen_before"],
            "goal": goal,
            "success": {"type": "hold", "moves": 10},
            "idea": (f"In the game you played {m['san']} ({m['classification']}). "
                     f"The position was {'winning' if goal == 'win' else 'holdable'}: "
                     f"{'keep the win' if goal == 'win' else 'keep the draw'} for 10 moves against the engine."),
            "steps": [],
            "hint": m.get("explanation") or "",
            "best": m["best"],
            **_source(r),
        })
    return out
