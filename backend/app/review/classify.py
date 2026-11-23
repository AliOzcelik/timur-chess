"""Turn per-position engine evals into move labels, accuracy and hints.

Labels come from how much a move lowers the mover's winning chance (0-100%):
    best        the engine's top move
    excellent   loses < 2 points
    good        loses < 5
    inaccuracy  loses 5-10
    mistake     loses 10-15
    blunder     loses 15 or more
These match lichess (its 0.1 / 0.2 / 0.3 cut-offs are on a -1..+1 scale, which
is 5 / 10 / 15 points on the 0-100 scale used here). Forced mates are judged
like lichess too: allowing or missing a mate is a mistake or blunder unless the
position stays completely winning/lost anyway.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

import chess
import chess.pgn

from ..evals import Eval, cp_for, format_eval, mate_for, win_percent, win_percent_white
from .motifs import explain

INACCURACY, MISTAKE, BLUNDER = 5.0, 10.0, 15.0
GOOD, EXCELLENT = 5.0, 2.0
ONLY_MOVE_GAP = 15.0

SEVERITY = {"forced": -1, "best": 0, "excellent": 1, "good": 2, "inaccuracy": 3, "mistake": 4, "blunder": 5}
CLASSES = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder", "forced"]


def color_name(color: chess.Color) -> str:
    return "white" if color == chess.WHITE else "black"


def classify_drop(drop: float, thresholds: dict[str, float] | None = None) -> str:
    t = thresholds or {}
    if drop >= t.get("blunder", BLUNDER):
        return "blunder"
    if drop >= t.get("mistake", MISTAKE):
        return "mistake"
    if drop >= t.get("inaccuracy", INACCURACY):
        return "inaccuracy"
    if drop >= EXCELLENT:
        return "good"
    return "excellent"


def raw_cp_for(e: Eval, color: chess.Color) -> int:
    """Uncapped centipawns for `color` (mates count as ±100000)."""
    if e.get("winner"):
        return 100_000 if e["winner"] == color_name(color) else -100_000
    mate = e.get("mate")
    if mate is not None:
        white = 100_000 if mate > 0 else -100_000
    else:
        white = e.get("cp") or 0
    return white if color == chess.WHITE else -white


def mate_judgment(e_before: Eval, e_after: Eval, mover: chess.Color) -> str | None:
    """Lichess-style judgment for creating or losing a forced mate."""
    if e_after.get("winner") == color_name(mover):
        return None  # the move itself gave mate
    opponent = not mover
    if mate_for(e_after, opponent) and not mate_for(e_before, opponent):
        before = raw_cp_for(e_before, mover)
        if before < -999:
            return "inaccuracy"
        if before < -700:
            return "mistake"
        return "blunder"
    if mate_for(e_before, mover) and not mate_for(e_after, mover):
        after = raw_cp_for(e_after, mover)
        if after > 999:
            return "inaccuracy"
        if after > 700:
            return "mistake"
        return "blunder"
    return None


def move_accuracy(drop: float) -> float:
    """Lichess's accuracy curve: 100 for no loss, falling quickly as winning chance is lost."""
    if drop <= 0:
        return 100.0
    raw = 103.1668100711649 * math.exp(-0.04354415386753951 * drop) - 3.166924740191411 + 1
    return max(0.0, min(100.0, raw))


def game_accuracy(win_whites: list[float], drops: list[float], movers: list[chess.Color], color: chess.Color) -> float | None:
    """Lichess-style game accuracy: volatility-weighted mean averaged with the harmonic mean."""
    n_moves = len(drops)
    if n_moves == 0:
        return None
    window = max(2, min(8, n_moves // 10))
    if len(win_whites) <= window:
        windows = [win_whites] * n_moves
    else:
        pad = max(0, window - 2)
        windows = [win_whites[:window]] * pad + [win_whites[i:i + window] for i in range(len(win_whites) - window + 1)]
    weights = [max(0.5, min(12.0, statistics.pstdev(w))) for w in windows][:n_moves]
    while len(weights) < n_moves:
        weights.append(weights[-1] if weights else 1.0)

    accs: list[float] = []
    ws: list[float] = []
    for i in range(n_moves):
        if movers[i] != color:
            continue
        accs.append(move_accuracy(drops[i]))
        ws.append(weights[i])
    if not accs:
        return None
    weighted = sum(a * w for a, w in zip(accs, ws)) / sum(ws)
    harmonic = len(accs) / sum(1 / max(a, 1.0) for a in accs)
    return round((weighted + harmonic) / 2, 1)


def to_moves(ucis: list[str]) -> list[chess.Move]:
    out = []
    for u in ucis:
        try:
            out.append(chess.Move.from_uci(u))
        except ValueError:
            break
    return out


def san_line(board: chess.Board, moves: list[chess.Move], max_plies: int) -> list[str]:
    b = board.copy(stack=False)
    out = []
    for move in moves[:max_plies]:
        if not b.is_legal(move):
            break
        out.append(b.san(move))
        b.push(move)
    return out


def build_review(game: chess.pgn.Game, positions: list[dict[str, Any]], *, profile: str, depth: int,
                 engine_name: str | None, thresholds: dict[str, float] | None = None) -> dict[str, Any]:
    """`positions[i]` is the engine's view of the position before move i (plus one after the last move)."""
    board = game.board()
    root_fen = board.fen()
    moves = list(game.mainline_moves())
    win_whites = [win_percent_white(p["eval"]) for p in positions]

    out_moves: list[dict[str, Any]] = []
    drops: list[float] = []
    movers: list[chess.Color] = []
    cp_losses: dict[chess.Color, list[int]] = {chess.WHITE: [], chess.BLACK: []}

    for i, move in enumerate(moves):
        mover = board.turn
        before, after = positions[i], positions[i + 1]
        e_before, e_after = before["eval"], after["eval"]
        legal = board.legal_moves.count()
        san = board.san(move)
        best_line = to_moves(before["lines"][0]["uci"]) if before["lines"] else []
        best = best_line[0] if best_line else None
        reply_line = to_moves(after["lines"][0]["uci"]) if after["lines"] else []

        win_before = win_percent(e_before, mover)
        win_after = win_percent(e_after, mover)
        drop = max(0.0, win_before - win_after)

        if legal == 1:
            classification = "forced"
        elif best is not None and move == best:
            classification = "best"
        else:
            classification = classify_drop(drop, thresholds)
            judged = mate_judgment(e_before, e_after, mover)
            if judged and SEVERITY[judged] > SEVERITY[classification]:
                classification = judged

        # Playing the engine's move (or the only legal move) costs nothing, whatever small
        # differences the search shows between the two positions.
        effective_drop = 0.0 if classification in ("best", "forced") else drop

        tags: list[str] = []
        if classification == "best" and legal > 1 and len(before["lines"]) >= 2:
            if win_before - win_percent(before["lines"][1]["eval"], mover) >= ONLY_MOVE_GAP:
                tags.append("only_move")
        if mate_for(e_before, mover) and not mate_for(e_after, mover) and e_after.get("winner") != color_name(mover) \
                and classification not in ("best", "forced"):
            tags.append("missed_mate")
        if mate_for(e_after, not mover) and not mate_for(e_before, not mover):
            tags.append("allows_mate")
        if SEVERITY.get(classification, 0) >= SEVERITY["inaccuracy"] and win_before >= 75 and win_after <= 55:
            tags.append("missed_win")

        text, motifs = explain(board, move, best_line, reply_line, e_before, e_after, classification, tags,
                               win_before, win_after)

        cp_losses[mover].append(max(0, cp_for(e_before, mover) - cp_for(e_after, mover)) if effective_drop > 0 else 0)
        drops.append(effective_drop)
        movers.append(mover)

        out_moves.append({
            "index": i,
            "move_number": board.fullmove_number,
            "color": color_name(mover),
            "san": san,
            "uci": move.uci(),
            "fen_before": board.fen(),
            "eval_before": e_before,
            "eval_after": e_after,
            "eval_after_text": format_eval(e_after),
            "win_before": round(win_before, 1),
            "win_after": round(win_after, 1),
            "drop": round(effective_drop, 1),
            "classification": classification,
            "tags": tags,
            "motifs": motifs,
            "accuracy": round(move_accuracy(effective_drop), 1),
            "best": {"uci": best.uci(), "san": board.san(best)} if best is not None and board.is_legal(best) else None,
            "best_eval": e_before,
            "best_line_san": san_line(board, best_line, 10),
            "explanation": text,
        })
        board.push(move)
        out_moves[-1]["fen_after"] = board.fen()
        out_moves[-1]["reply_line_san"] = san_line(board, reply_line, 8)

    out_positions = []
    for p, wp in zip(positions, win_whites):
        out_positions.append({
            "fen": p["fen"],
            "eval": p["eval"],
            "eval_text": format_eval(p["eval"]),
            "win": round(wp, 1),
            "depth": p.get("depth"),
        })

    summary: dict[str, Any] = {}
    for color in (chess.WHITE, chess.BLACK):
        counts = {c: 0 for c in CLASSES}
        for m, mv_color in zip(out_moves, movers):
            if mv_color == color:
                counts[m["classification"]] += 1
        losses = cp_losses[color]
        summary[color_name(color)] = {
            "accuracy": game_accuracy(win_whites, drops, movers, color),
            "acpl": round(sum(losses) / len(losses)) if losses else None,
            "counts": counts,
            "moves": len(losses),
        }

    return {
        "version": 1,
        "headers": dict(game.headers),
        "root_fen": root_fen,
        "settings": {"profile": profile, "depth": depth, "engine": engine_name,
                     "thresholds": thresholds or {"inaccuracy": INACCURACY, "mistake": MISTAKE, "blunder": BLUNDER}},
        "positions": out_positions,
        "moves": out_moves,
        "summary": summary,
    }
