"""Syzygy endgame tablebases (3-5 pieces): perfect win/draw/loss answers.

The tables live in data/syzygy (fetched with scripts/get-tablebases.sh).
Without them every caller falls back to Stockfish.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import chess
import chess.syzygy

MAX_PIECES = 5


def result_of(wdl: int) -> str:
    """Tablebase WDL for the side to move -> win / draw / loss.

    A 'cursed' win (only won without the 50-move rule) counts as a draw, as in a real game.
    """
    if wdl >= 2:
        return "win"
    if wdl <= -2:
        return "loss"
    return "draw"


class Tablebases:
    def __init__(self, path: Path):
        self.path = path
        self._tb: chess.syzygy.Tablebase | None = None
        self._lock = threading.Lock()
        self.files = 0
        self.reload()

    def reload(self) -> None:
        with self._lock:
            if self._tb is not None:
                self._tb.close()
                self._tb = None
            self.files = len(list(self.path.glob("*.rtbw"))) + len(list(self.path.glob("*.rtbz"))) if self.path.is_dir() else 0
            if self.files:
                self._tb = chess.syzygy.open_tablebase(str(self.path))

    @property
    def available(self) -> bool:
        return self._tb is not None

    def status(self) -> dict[str, Any]:
        return {"available": self.available, "files": self.files, "path": str(self.path), "max_pieces": MAX_PIECES}

    def covers(self, board: chess.Board) -> bool:
        return self.available and chess.popcount(board.occupied) <= MAX_PIECES and not board.castling_rights

    def probe(self, board: chess.Board) -> dict[str, Any] | None:
        """{'wdl', 'dtz', 'result'} for the side to move, or None when the tables can't answer."""
        if not self.covers(board):
            return None
        try:
            with self._lock:
                assert self._tb is not None
                wdl = self._tb.probe_wdl(board)
                dtz = self._tb.probe_dtz(board)
        except (KeyError, IndexError, ValueError):
            return None
        return {"wdl": wdl, "dtz": dtz, "result": result_of(wdl)}

    def rank_moves(self, board: chess.Board) -> list[dict[str, Any]] | None:
        """Every legal move with its tablebase outcome for the mover, best first."""
        if not self.covers(board):
            return None
        ranked = []
        for move in board.legal_moves:
            b = board.copy(stack=False)
            b.push(move)
            if b.is_checkmate():
                ranked.append({"move": move, "wdl": 2, "dtz": 0, "mate": True})
                continue
            info = self.probe(b)
            if info is None:
                return None
            ranked.append({"move": move, "wdl": -info["wdl"], "dtz": -info["dtz"], "mate": False})

        def key(r: dict[str, Any]) -> tuple:
            # Best result first. When winning, the shortest way (zeroing the counter);
            # when losing, the longest resistance.
            dtz = abs(r["dtz"])
            return (-r["wdl"], not r["mate"], dtz if r["wdl"] > 0 else -dtz)

        ranked.sort(key=key)
        return ranked
