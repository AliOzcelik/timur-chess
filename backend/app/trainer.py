"""The training engine (Phases 5 and 6): judges positions and plays the other side.

Positions with up to 5 pieces are judged by the Syzygy tablebases, so the answer
is exact. Bigger positions fall back to Stockfish's evaluation. The trainer has
its own small Stockfish process, so it never slows down the analysis board.
"""

from __future__ import annotations

import asyncio
from typing import Any

import chess
import chess.engine

from .engine import EngineService, pv_to_san
from .evals import score_to_eval, win_percent
from .tablebase import Tablebases, result_of

RESULT_RANK = {"loss": 0, "draw": 1, "win": 2}
# Below 5 pieces the tablebase decides. Above, Stockfish's winning chance (0-100) does:
WIN_AT, LOSS_AT = 70.0, 30.0


def color_name(color: chess.Color) -> str:
    return "white" if color == chess.WHITE else "black"


def game_over_result(board: chess.Board) -> tuple[str, str] | None:
    """(result for the side to move, reason) if the game is over, counting claimable draws."""
    if board.is_checkmate():
        return "loss", "checkmate"
    if board.is_stalemate():
        return "draw", "stalemate"
    if board.is_insufficient_material():
        return "draw", "not enough material to mate"
    if board.can_claim_threefold_repetition() or board.is_fivefold_repetition():
        return "draw", "repetition"
    if board.can_claim_fifty_moves() or board.is_seventyfive_moves():
        return "draw", "the 50-move rule"
    return None


class Trainer:
    def __init__(self, service: EngineService, tablebases: Tablebases):
        self.service = service
        self.tablebases = tablebases
        self._lock = asyncio.Lock()

    async def assess(self, board: chess.Board, color: chess.Color, seconds: float = 0.4) -> dict[str, Any]:
        """How the position stands for `color`: {'result', 'source', 'win'?, 'dtz'?, 'eval'?, 'reason'?}."""
        over = game_over_result(board)
        if over is not None:
            result, reason = over
            if board.turn != color:
                result = {"win": "loss", "loss": "win", "draw": "draw"}[result]
            return {"result": result, "source": "rules", "reason": reason, "over": True}
        probe = self.tablebases.probe(board)
        if probe is not None:
            mine = probe if board.turn == color else {"wdl": -probe["wdl"], "dtz": -probe["dtz"]}
            return {"result": result_of(mine["wdl"]), "source": "tablebase", "dtz": mine["dtz"], "over": False}
        async with self._lock:
            engine = await self.service.get()
            info = await engine.analyse(board, chess.engine.Limit(time=seconds, depth=22))
        e = score_to_eval(info["score"])
        win = win_percent(e, color)
        result = "win" if win >= WIN_AT else "loss" if win <= LOSS_AT else "draw"
        return {"result": result, "source": "engine", "win": round(win, 1), "eval": e, "over": False}

    async def best_move(self, board: chess.Board, seconds: float = 0.4,
                        longest_resistance: bool = False) -> tuple[chess.Move, str, list[str]]:
        """The strongest move: (move, 'tablebase' | 'engine', principal variation in SAN)."""
        ranked = self.tablebases.rank_moves(board)
        candidates: list[chess.Move] | None = None
        source = "engine"
        if ranked:
            top = ranked[0]["wdl"]
            if top < 0 or longest_resistance:
                # Losing: the move that holds out longest (exact). Also used to make the
                # defender as stubborn as possible.
                return ranked[0]["move"], "tablebase", [board.san(ranked[0]["move"])]
            candidates = [r["move"] for r in ranked if r["wdl"] == top]
            source = "tablebase"
            if len(candidates) == 1:
                return candidates[0], source, [board.san(candidates[0])]
        async with self._lock:
            engine = await self.service.get()
            res = await engine.play(board, chess.engine.Limit(time=seconds, depth=24), root_moves=candidates,
                                    info=chess.engine.INFO_PV)
        assert res.move is not None
        pv = res.info.get("pv") or [res.move]
        return res.move, source, pv_to_san(board, pv, 8)

    async def bot_move(self, board: chess.Board, elo: int | None, seconds: float = 0.6) -> chess.Move:
        """A move at roughly the given strength (Stockfish's own Elo limiter, 1320-3190)."""
        options: dict[str, Any] = {}
        async with self._lock:
            engine = await self.service.get()
            if elo is not None and "UCI_LimitStrength" in engine.options:
                low = engine.options["UCI_Elo"].min or 1320
                high = engine.options["UCI_Elo"].max or 3190
                options = {"UCI_LimitStrength": True, "UCI_Elo": max(low, min(high, elo))}
            res = await engine.play(board, chess.engine.Limit(time=seconds), options=options, game=object())
        assert res.move is not None
        return res.move

    async def evaluate(self, board: chess.Board, seconds: float = 1.0) -> dict[str, Any]:
        async with self._lock:
            engine = await self.service.get()
            info = await engine.analyse(board, chess.engine.Limit(time=seconds, depth=22))
        pv = info.get("pv") or []
        return {"eval": score_to_eval(info["score"]), "pv_san": pv_to_san(board, pv, 8),
                "best": {"uci": pv[0].uci(), "san": board.san(pv[0])} if pv else None}


def meets(result: str, goal: str) -> bool:
    return RESULT_RANK[result] >= RESULT_RANK[goal]
