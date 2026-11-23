"""User settings (Phase 7), stored as JSON values in the settings table.

Anything not saved falls back to the defaults below (which follow the
environment variables in config.py), so a fresh install needs no setup.
"""

from __future__ import annotations

import json
from typing import Any

from . import config
from .config import EngineSettings
from .db import Database


def defaults() -> dict[str, Any]:
    return {
        "stockfish_path": "",  # empty: found automatically
        "live_threads": config.LIVE_ENGINE.threads,
        "live_hash_mb": config.LIVE_ENGINE.hash_mb,
        "review_threads": config.REVIEW_ENGINE.threads,
        "review_hash_mb": config.REVIEW_ENGINE.hash_mb,
        "default_profile": "standard",
        "thresholds": {"inaccuracy": 5.0, "mistake": 10.0, "blunder": 15.0},
        "theme": "system",  # system | dark | light
        "allow_internet": False,  # only for downloading an opponent's public games
        "player_names": [],  # your names in PGN headers, to know which side you played
        "onboarded": False,
    }


class Settings:
    def __init__(self, db: Database):
        self.db = db

    def all(self) -> dict[str, Any]:
        values = defaults()
        for row in self.db.all("SELECT key, value FROM settings"):
            if row["key"] in values:
                try:
                    values[row["key"]] = json.loads(row["value"])
                except ValueError:
                    pass
        return values

    def get(self, key: str) -> Any:
        return self.all()[key]

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        known = defaults()
        for key, value in changes.items():
            if key not in known:
                continue
            self.db.run(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
        return self.all()

    def reset(self) -> dict[str, Any]:
        self.db.run("DELETE FROM settings")
        return self.all()

    def engine(self, kind: str) -> EngineSettings:
        s = self.all()
        path = s["stockfish_path"].strip() or config.STOCKFISH_PATH
        if kind == "live":
            return EngineSettings(path=path, threads=int(s["live_threads"]), hash_mb=int(s["live_hash_mb"]))
        if kind == "review":
            return EngineSettings(path=path, threads=int(s["review_threads"]), hash_mb=int(s["review_hash_mb"]))
        return EngineSettings(path=path, threads=2, hash_mb=64)  # trainer: play, endgames, puzzles

    def thresholds(self) -> dict[str, float]:
        t = self.get("thresholds")
        return {"inaccuracy": float(t["inaccuracy"]), "mistake": float(t["mistake"]), "blunder": float(t["blunder"])}

    def my_color_for(self, white: str | None, black: str | None) -> str | None:
        names = {n.strip().lower() for n in self.get("player_names") if n.strip()}
        if not names:
            return None
        if white and white.strip().lower() in names:
            return "white"
        if black and black.strip().lower() in names:
            return "black"
        return None
