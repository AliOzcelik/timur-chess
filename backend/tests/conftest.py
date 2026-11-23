"""Shared test setup.

The app reads its settings when it is imported, so the environment is prepared
here first: all data goes to a throwaway folder (never data/timur.db) and the
engines run small (1-2 threads, little hash) so tests are quick and light.
"""

from __future__ import annotations

import os
import shutil
import tempfile

_TMP_DATA = tempfile.mkdtemp(prefix="timur-tests-")
os.environ["TIMUR_DATA_DIR"] = _TMP_DATA
os.environ["TIMUR_LIVE_THREADS"] = "2"
os.environ["TIMUR_LIVE_HASH_MB"] = "32"
os.environ["TIMUR_REVIEW_THREADS"] = "1"
os.environ["TIMUR_REVIEW_HASH_MB"] = "16"

import asyncio  # noqa: E402
import time  # noqa: E402
from collections.abc import Iterator  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402

from app import config as app_config  # noqa: E402
from app.config import EngineSettings  # noqa: E402
from app.engine import EngineService  # noqa: E402

SCHOLARS_MATE = (
    '[Event "Club night"]\n[Site "?"]\n[Date "2026.11.20"]\n[Round "?"]\n'
    '[White "You"]\n[Black "Opponent"]\n[Result "1-0"]\n\n'
    "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0\n"
)

# Mate in one for White (Rd8#), a common back-rank pattern.
BACK_RANK = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"
# White's only legal move is Kxb2.
ONE_LEGAL_MOVE = "k7/8/8/8/8/8/1q6/K7 w - - 0 1"
# Fool's mate: White is checkmated.
FOOLS_MATE = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    shutil.rmtree(_TMP_DATA, ignore_errors=True)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if app_config.STOCKFISH_PATH:
        return
    skip = pytest.mark.skip(reason="Stockfish is not installed (brew install stockfish)")
    for item in items:
        if "engine" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def small_engine() -> EngineSettings:
    return EngineSettings(path=app_config.STOCKFISH_PATH, threads=1, hash_mb=16)


@pytest.fixture
async def service(small_engine: EngineSettings):
    s = EngineService("test", small_engine)
    yield s
    await s.close()


class Inbox:
    """Collects the messages LiveAnalysis sends, like a browser tab would."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self._finished: dict[Any, asyncio.Event] = {}

    def _event(self, rid: Any) -> asyncio.Event:
        return self._finished.setdefault(rid, asyncio.Event())

    async def send(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)
        if msg["type"] in ("done", "error"):
            self._event(msg.get("id")).set()

    async def wait_finished(self, rid: Any, timeout: float = 30) -> None:
        await asyncio.wait_for(self._event(rid).wait(), timeout)

    async def wait_for_info(self, rid: Any, timeout: float = 30) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for msg in self.messages:
                if msg["type"] == "info" and msg.get("id") == rid and msg.get("lines"):
                    return msg
            await asyncio.sleep(0.02)
        raise TimeoutError(f"no info for request {rid}")

    def of(self, rid: Any, kind: str | None = None) -> list[dict[str, Any]]:
        return [m for m in self.messages if m.get("id") == rid and (kind is None or m["type"] == kind)]


@pytest.fixture
def inbox() -> Inbox:
    return Inbox()


@pytest.fixture(scope="session")
def client() -> Iterator[Any]:
    """One running app for all API tests (it owns two Stockfish processes)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
