"""The background reviewer, end to end on the real engine (small, fast settings)."""

from __future__ import annotations

import asyncio
import time

import chess
import chess.engine
import pytest

from app.config import EngineSettings
from app.db import Database
from app.engine import EngineService
from app.review import runner as runner_module
from app.review.runner import ReviewRunner, analyse_position

from .conftest import FOOLS_MATE, SCHOLARS_MATE

pytestmark = pytest.mark.engine


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "timur.db")
    yield d
    d.close()


@pytest.fixture(autouse=True)
def faster_quick_profile(monkeypatch):
    # Keep the tests short: depth 12, at most 0.2 s per position.
    monkeypatch.setitem(runner_module.PROFILES, "quick", {"depth": 12, "time": 0.2})


def add_review(db: Database, pgn: str = SCHOLARS_MATE, my_color: str = "black") -> int:
    return db.create_review(profile="quick", my_color=my_color, pgn=pgn, ply_count=7, total=8,
                            white="You", black="Opponent")


async def wait_for(db: Database, rid: int, statuses: set[str], timeout: float = 90) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = db.get_review(rid)
        if row and row["status"] in statuses:
            return row
        await asyncio.sleep(0.05)
    raise TimeoutError(f"review {rid} did not reach {statuses}")


async def test_finished_position_is_not_sent_to_the_engine():
    result = await analyse_position(None, chess.Board(FOOLS_MATE), chess.engine.Limit(depth=5), "g")  # type: ignore[arg-type]
    assert result == {"fen": FOOLS_MATE, "eval": {"cp": None, "mate": 0, "winner": "black"}, "lines": [], "depth": 0}


async def test_analyse_position_returns_two_lines(service):
    engine = await service.get()
    result = await analyse_position(engine, chess.Board(), chess.engine.Limit(depth=8), "g")
    assert len(result["lines"]) == 2
    assert result["eval"] == result["lines"][0]["eval"]
    assert all(line["uci"] for line in result["lines"])
    assert result["depth"] >= 8


async def test_reviews_scholars_mate(service, db):
    rid = add_review(db)
    reviewer = ReviewRunner(service, db)
    reviewer.start()  # picks up the queued review
    try:
        row = await wait_for(db, rid, {"done", "error"})
    finally:
        await reviewer.shutdown()

    assert row["status"] == "done", row["error"]
    assert row["progress"] == row["total"] == 8
    analysis = row["analysis"]
    moves = analysis["moves"]
    assert [m["san"] for m in moves] == ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]

    nf6 = moves[5]
    assert nf6["classification"] == "blunder"
    assert "allows_mate" in nf6["tags"]
    assert "Qxf7#" in nf6["explanation"]
    assert nf6["best"]["san"] != "Nf6"

    assert moves[6]["classification"] == "best"
    assert analysis["positions"][-1]["eval"]["winner"] == "white"
    assert analysis["settings"]["profile"] == "quick"
    assert analysis["settings"]["engine"].startswith("Stockfish")
    assert row["white_accuracy"] > row["black_accuracy"]
    assert row["white_accuracy"] == analysis["summary"]["white"]["accuracy"]


async def test_cancelled_review_is_skipped(service, db):
    skipped = add_review(db)
    kept = add_review(db, pgn="1. e4 e5 2. Nf3 *")
    reviewer = ReviewRunner(service, db)
    reviewer.cancel(skipped)
    reviewer.start()
    try:
        await wait_for(db, kept, {"done", "error"})
    finally:
        await reviewer.shutdown()
    assert db.get_review(skipped)["status"] == "queued"
    assert db.get_review(skipped)["progress"] == 0
    assert db.get_review(kept)["status"] == "done"


async def test_interrupted_reviews_start_over(service, db):
    rid = add_review(db)
    db.update_review(rid, status="running", progress=5)
    reviewer = ReviewRunner(service, db)
    reviewer.start()
    row = db.get_review(rid)
    assert (row["status"], row["progress"]) == ("queued", 0)
    await reviewer.shutdown()


async def test_engine_failure_is_shown_on_the_review(db, tmp_path):
    broken = EngineService("review", EngineSettings(path=str(tmp_path / "missing"), threads=1, hash_mb=16))
    rid = add_review(db)
    reviewer = ReviewRunner(broken, db)
    reviewer.start()
    try:
        row = await wait_for(db, rid, {"done", "error"}, timeout=20)
    finally:
        await reviewer.shutdown()
    assert row["status"] == "error"
    assert row["error"].startswith("Could not start Stockfish")


async def test_bad_pgn_fails_without_stopping_the_queue(service, db):
    bad = db.create_review(profile="quick", my_color="both", pgn="1. e4 e5 2. Ke3 *", ply_count=3, total=4)
    good = add_review(db, pgn="1. d4 d5 *")
    reviewer = ReviewRunner(service, db)
    reviewer.start()
    try:
        await wait_for(db, good, {"done", "error"})
    finally:
        await reviewer.shutdown()
    assert db.get_review(bad)["status"] == "error"
    assert db.get_review(bad)["error"].startswith("Review failed")
    assert db.get_review(good)["status"] == "done"
