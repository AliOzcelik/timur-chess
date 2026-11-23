"""Background game-review queue. Runs on its own Stockfish process."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import chess
import chess.engine

from ..db import Database
from ..engine import EngineService, EngineUnavailable
from ..evals import score_to_eval, terminal_eval
from ..pgn_tools import first_game
from .classify import build_review

log = logging.getLogger("timur.review")

# Each position is searched until it reaches the depth OR the time runs out.
PROFILES: dict[str, dict[str, Any]] = {
    "quick": {"depth": 14, "time": 0.3},
    "standard": {"depth": 18, "time": 1.0},
    "deep": {"depth": 22, "time": 3.0},
}


async def analyse_position(engine: chess.engine.UciProtocol, board: chess.Board, limit: chess.engine.Limit,
                           game_key: str) -> dict[str, Any]:
    done = terminal_eval(board)
    if done is not None:
        return {"fen": board.fen(), "eval": done, "lines": [], "depth": 0}
    legal = board.legal_moves.count()
    infos = await engine.analyse(board, limit, multipv=min(2, legal), game=game_key)
    lines = []
    for info in infos:
        if "score" not in info:
            continue
        pv = info.get("pv") or []
        lines.append({"eval": score_to_eval(info["score"]), "uci": [m.uci() for m in pv[:12]]})
    return {
        "fen": board.fen(),
        "eval": lines[0]["eval"] if lines else {"cp": 0, "mate": None},
        "lines": lines,
        "depth": infos[0].get("depth") if infos else None,
    }


class ReviewRunner:
    def __init__(self, service: EngineService, db: Database, settings: Any = None):
        self.service = service
        self.db = db
        self.settings = settings  # settings_store.Settings: custom mistake thresholds
        self.queue: asyncio.Queue[int] = asyncio.Queue()
        self.current: int | None = None
        self._cancelled: set[int] = set()
        self._worker: asyncio.Task[None] | None = None

    def start(self) -> None:
        # Reviews interrupted by a restart start over.
        for rid in self.db.unfinished_review_ids():
            self.db.update_review(rid, status="queued", progress=0)
            self.queue.put_nowait(rid)
        self._worker = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    def enqueue(self, review_id: int) -> None:
        self.queue.put_nowait(review_id)

    def cancel(self, review_id: int) -> None:
        self._cancelled.add(review_id)

    async def _loop(self) -> None:
        while True:
            rid = await self.queue.get()
            if rid in self._cancelled:
                self._cancelled.discard(rid)
                continue
            self.current = rid
            try:
                await self._review(rid)
            except asyncio.CancelledError:
                raise
            except EngineUnavailable as exc:
                self.db.update_review(rid, status="error", error=str(exc))
            except chess.engine.EngineTerminatedError:
                self.db.update_review(rid, status="error",
                                      error="Stockfish stopped unexpectedly during the review. Please try again.")
            except Exception as exc:  # noqa: BLE001 - keep the queue alive, show the problem in the UI
                log.exception("Review %s failed", rid)
                self.db.update_review(rid, status="error", error=f"Review failed: {exc}")
            finally:
                self.current = None

    async def _review(self, rid: int) -> None:
        row = self.db.get_review(rid, with_result=False)
        if row is None:
            return
        game, _ = first_game(row["pgn"])
        profile = PROFILES.get(row["profile"], PROFILES["standard"])
        limit = chess.engine.Limit(depth=profile["depth"], time=profile["time"])
        moves = list(game.mainline_moves())
        total = len(moves) + 1
        self.db.update_review(rid, status="running", progress=0, total=total, error=None)

        engine = await self.service.get()
        board = game.board()
        positions: list[dict[str, Any]] = []
        last_saved = 0.0
        started = time.monotonic()
        for i in range(total):
            if i > 0:
                board.push(moves[i - 1])
            if rid in self._cancelled:
                self._cancelled.discard(rid)
                log.info("Review %s cancelled", rid)
                return
            positions.append(await analyse_position(engine, board, limit, game_key=f"review-{rid}"))
            now = time.monotonic()
            if now - last_saved > 0.4 or i == total - 1:
                self.db.update_review(rid, progress=i + 1)
                last_saved = now

        analysis = build_review(game, positions, profile=row["profile"], depth=profile["depth"],
                                engine_name=self.service.name,
                                thresholds=self.settings.thresholds() if self.settings is not None else None)
        summary = analysis["summary"]
        self.db.update_review(
            rid,
            status="done",
            progress=total,
            result_json=json.dumps(analysis),
            white_accuracy=summary["white"]["accuracy"],
            black_accuracy=summary["black"]["accuracy"],
        )
        log.info("Review %s done: %s positions in %.1fs", rid, total, time.monotonic() - started)
