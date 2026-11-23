"""Spaced repetition for endgames, puzzles and repertoire lines.

A simple SM-2 variant: get it right and the item comes back after 1 day, then
3, then the interval grows by the item's 'ease' (2.5 to start). A wrong answer
brings it back in 10 minutes and resets the streak. Items with an interval of
three weeks or more count as mastered.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from .db import Database, now_iso

Outcome = Literal["good", "hard", "again"]
MASTERED_DAYS = 21
MIN_EASE, MAX_EASE = 1.3, 3.0


def _now() -> datetime:
    return datetime.now().astimezone()


def schedule(row: dict[str, Any] | None, outcome: Outcome) -> dict[str, Any]:
    """The next state of an item after an attempt."""
    attempts = (row or {}).get("attempts", 0) + 1
    successes = (row or {}).get("successes", 0)
    streak = (row or {}).get("streak", 0)
    ease = (row or {}).get("ease", 2.5)
    interval = (row or {}).get("interval_days", 0.0)
    if outcome == "again":
        streak = 0
        ease = max(MIN_EASE, ease - 0.2)
        interval = 0.0
        due = _now() + timedelta(minutes=10)
    else:
        successes += 1
        streak += 1
        if outcome == "hard":
            ease = max(MIN_EASE, ease - 0.15)
            interval = max(1.0, interval * 1.2)
        elif interval < 1:
            interval = 1.0
        elif interval < 3:
            interval = 3.0
        else:
            interval = interval * ease
            ease = min(MAX_EASE, ease + 0.1)
        due = _now() + timedelta(days=interval)
    return {
        "attempts": attempts,
        "successes": successes,
        "streak": streak,
        "ease": round(ease, 2),
        "interval_days": round(interval, 2),
        "due_at": due.isoformat(timespec="seconds"),
        "last_result": outcome,
        "last_at": now_iso(),
    }


def record(db: Database, item_id: str, kind: str, outcome: Outcome) -> dict[str, Any]:
    row = db.one("SELECT * FROM training WHERE item_id = ?", (item_id,))
    state = schedule(row, outcome)
    if row is None:
        db.insert("training", {"item_id": item_id, "kind": kind, **state})
    else:
        sets = ", ".join(f"{k} = ?" for k in state)
        db.run(f"UPDATE training SET {sets} WHERE item_id = ?", (*state.values(), item_id))
    return describe({"item_id": item_id, "kind": kind, **state})


def describe(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    due = datetime.fromisoformat(row["due_at"])
    return {
        **row,
        "due": due <= _now(),
        "mastered": row["interval_days"] >= MASTERED_DAYS,
    }


def progress(db: Database, kind: str | None = None) -> dict[str, dict[str, Any]]:
    rows = db.all("SELECT * FROM training" + (" WHERE kind = ?" if kind else ""), (kind,) if kind else ())
    return {r["item_id"]: describe(r) for r in rows}  # type: ignore[misc]


def forget(db: Database, item_id: str) -> None:
    db.run("DELETE FROM training WHERE item_id = ?", (item_id,))
