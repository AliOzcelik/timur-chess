"""App settings.

Every value has a sensible default for this Mac and can be overridden with an
environment variable (handy for testing or for a different machine).
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # the project folder (timur/)
DATA_DIR = Path(os.environ.get("TIMUR_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "timur.db"
FRONTEND_DIST = ROOT / "frontend" / "dist"

CPU_COUNT = os.cpu_count() or 4


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def find_stockfish() -> str | None:
    """STOCKFISH_PATH wins; otherwise look on PATH and in the usual Homebrew spots."""
    explicit = os.environ.get("STOCKFISH_PATH")
    if explicit:
        return explicit
    found = shutil.which("stockfish")
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/stockfish", "/usr/local/bin/stockfish", "/usr/games/stockfish"):
        if Path(candidate).exists():
            return candidate
    return None


@dataclass(frozen=True)
class EngineSettings:
    path: str | None
    threads: int
    hash_mb: int


STOCKFISH_PATH = find_stockfish()

# Live analysis gets most of the CPU (8 of 12 cores here); the background game
# reviewer gets the rest, so reviewing never freezes the analysis board.
LIVE_ENGINE = EngineSettings(
    path=STOCKFISH_PATH,
    threads=max(1, _env_int("TIMUR_LIVE_THREADS", max(1, CPU_COUNT - 4))),
    hash_mb=max(16, _env_int("TIMUR_LIVE_HASH_MB", 1024)),
)
REVIEW_ENGINE = EngineSettings(
    path=STOCKFISH_PATH,
    threads=max(1, _env_int("TIMUR_REVIEW_THREADS", max(1, min(4, CPU_COUNT // 3)))),
    hash_mb=max(16, _env_int("TIMUR_REVIEW_HASH_MB", 256)),
)

MAX_PGN_CHARS = 2_000_000
