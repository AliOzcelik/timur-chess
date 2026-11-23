"""Opening names (ECO codes) from lichess's chess-openings list.

Openings are matched by position, not by move order, so transpositions get
the right name (1.Nf3 d5 2.d4 is a Queen's Pawn line). The deepest named
position reached in a game's main line wins.
"""

from __future__ import annotations

import csv
import threading
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn

DATA = Path(__file__).parent / "data" / "openings"


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str
    ply: int  # how many moves into the game the named position is

    @property
    def family(self) -> str:
        """'Sicilian Defense: Najdorf Variation, English Attack' -> 'Sicilian Defense'."""
        return self.name.split(":")[0].strip()

    @property
    def variation(self) -> str | None:
        if ":" not in self.name:
            return None
        return self.name.split(":", 1)[1].split(",")[0].strip()

    def as_dict(self) -> dict:
        return {"eco": self.eco, "name": self.name, "family": self.family, "variation": self.variation, "ply": self.ply}


def epd(board: chess.Board) -> str:
    """Position key without move counters (and en passant only when it matters)."""
    return board.epd()


_index: dict[str, Opening] | None = None
_lock = threading.Lock()


def _build() -> dict[str, Opening]:
    index: dict[str, Opening] = {}
    for path in sorted(DATA.glob("*.tsv")):
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                board = chess.Board()
                ply = 0
                ok = True
                for token in row["pgn"].split():
                    if token.endswith("."):
                        continue
                    try:
                        board.push_san(token)
                    except ValueError:
                        ok = False
                        break
                    ply += 1
                if not ok:
                    continue
                key = epd(board)
                # Keep the first (most general) name for a position listed twice.
                index.setdefault(key, Opening(row["eco"], row["name"], ply))
    return index


def index() -> dict[str, Opening]:
    global _index
    if _index is None:
        with _lock:
            if _index is None:
                _index = _build()
    return _index


def detect_board_line(board: chess.Board, moves: list[chess.Move]) -> Opening | None:
    """Deepest named position along `moves` played from `board`."""
    idx = index()
    b = board.copy(stack=False)
    found = idx.get(epd(b))
    for move in moves:
        if not b.is_legal(move):
            break
        b.push(move)
        hit = idx.get(epd(b))
        if hit is not None:
            found = hit
    return found


def detect_game(game: chess.pgn.Game) -> Opening | None:
    board = game.board()
    if board.fen() != chess.STARTING_FEN:
        # A game from a set-up position can still reach a named position.
        pass
    return detect_board_line(board, list(game.mainline_moves()))
