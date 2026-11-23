"""Shared objects used by every part of the server: the database, settings,
engines, tablebases and background workers. Created once at import time."""

from __future__ import annotations

from typing import Any

from . import config
from .db import Database
from .engine import EngineService, LiveAnalysis
from .library import Library
from .review.runner import ReviewRunner
from .settings_store import Settings
from .tablebase import Tablebases

SYZYGY_DIR = config.DATA_DIR / "syzygy"
BACKUP_DIR = config.DATA_DIR / "backups"
NOTES_EXPORT_DIR = config.DATA_DIR / "notes-export"

db = Database(config.DB_PATH)
settings = Settings(db)
tablebases = Tablebases(SYZYGY_DIR)
library = Library(db)


def syzygy_options() -> dict[str, Any]:
    # Stockfish probes the same tables during its search when they are there.
    return {"SyzygyPath": str(SYZYGY_DIR)} if tablebases.available else {}


live_service = EngineService("live", settings.engine("live"), syzygy_options)
review_service = EngineService("review", settings.engine("review"), syzygy_options)
trainer_service = EngineService("trainer", settings.engine("trainer"), syzygy_options)
live = LiveAnalysis(live_service)
runner = ReviewRunner(review_service, db, settings)


async def apply_engine_settings() -> None:
    await live.stop()
    await live_service.apply(settings.engine("live"))
    await review_service.apply(settings.engine("review"))
    await trainer_service.apply(settings.engine("trainer"))

from .trainer import Trainer  # noqa: E402

trainer = Trainer(trainer_service, tablebases)
