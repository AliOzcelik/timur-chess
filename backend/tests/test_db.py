from __future__ import annotations

import json
import re

import pytest

from app.db import MIGRATIONS, Database, now_iso

ISO_WITH_OFFSET = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$")


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "nested" / "timur.db")
    yield d
    d.close()


def new_review(db: Database, **extra) -> int:
    fields = {"profile": "quick", "my_color": "white", "pgn": "1. e4 *", "ply_count": 1, "total": 2, **extra}
    return db.create_review(**fields)


def test_now_iso_has_the_utc_offset():
    assert ISO_WITH_OFFSET.match(now_iso())


def test_migrations_run_once(tmp_path):
    path = tmp_path / "timur.db"
    first = Database(path)
    assert first._conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    rid = new_review(first)
    first.close()

    again = Database(path)  # must not try to create the tables a second time
    assert again._conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    assert again.get_review(rid) is not None
    again.close()


def test_uses_wal_mode(db):
    assert db._conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_create_and_get(db):
    rid = new_review(db, white="Ann", black="Ben", result="1-0", game_date="2026.11.20")
    row = db.get_review(rid)
    assert row["id"] == rid
    assert row["status"] == "queued"
    assert row["progress"] == 0
    assert (row["white"], row["black"], row["result"], row["game_date"]) == ("Ann", "Ben", "1-0", "2026.11.20")
    assert ISO_WITH_OFFSET.match(row["created_at"])
    assert row["created_at"] == row["updated_at"]
    assert row["analysis"] is None
    assert "result_json" not in row


def test_analysis_is_returned_as_data_and_result_stays_the_game_result(db):
    rid = new_review(db, result="0-1")
    db.update_review(rid, status="done", result_json=json.dumps({"moves": [1, 2]}), white_accuracy=91.5)
    row = db.get_review(rid)
    assert row["analysis"] == {"moves": [1, 2]}
    assert row["result"] == "0-1"
    assert row["white_accuracy"] == 91.5
    assert row["status"] == "done"


def test_light_read_skips_the_analysis(db):
    rid = new_review(db)
    db.update_review(rid, result_json=json.dumps({"big": True}))
    row = db.get_review(rid, with_result=False)
    assert row["pgn"] == "1. e4 *"
    assert "analysis" not in row and "result_json" not in row


def test_update_without_fields_does_nothing(db):
    rid = new_review(db)
    before = db.get_review(rid)
    db.update_review(rid)
    assert db.get_review(rid) == before


def test_list_is_newest_first_and_small(db):
    ids = [new_review(db) for _ in range(3)]
    rows = db.list_reviews()
    assert [r["id"] for r in rows] == list(reversed(ids))
    assert "pgn" not in rows[0] and "result_json" not in rows[0]
    assert len(db.list_reviews(limit=2)) == 2


def test_delete(db):
    rid = new_review(db)
    assert db.delete_review(rid) is True
    assert db.get_review(rid) is None
    assert db.delete_review(rid) is False


def test_unfinished_reviews(db):
    queued = new_review(db)
    running = new_review(db)
    done = new_review(db)
    failed = new_review(db)
    db.update_review(running, status="running")
    db.update_review(done, status="done")
    db.update_review(failed, status="error")
    assert db.unfinished_review_ids() == [queued, running]


def test_get_missing_review(db):
    assert db.get_review(999) is None
