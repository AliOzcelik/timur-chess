"""SQLite storage.

One file (data/timur.db) holds everything. Schema changes are applied as
numbered migrations, tracked with SQLite's built-in `user_version`.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

MIGRATIONS: list[str] = [
    # 1: game reviews (Phase 2)
    """
    CREATE TABLE reviews (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        status          TEXT NOT NULL,          -- queued | running | done | error
        progress        INTEGER NOT NULL DEFAULT 0,
        total           INTEGER NOT NULL DEFAULT 0,
        profile         TEXT NOT NULL,          -- quick | standard | deep
        my_color        TEXT NOT NULL,          -- white | black | both
        white           TEXT,
        black           TEXT,
        result          TEXT,
        event           TEXT,
        game_date       TEXT,
        ply_count       INTEGER NOT NULL DEFAULT 0,
        pgn             TEXT NOT NULL,
        white_accuracy  REAL,
        black_accuracy  REAL,
        result_json     TEXT,
        error           TEXT
    );
    CREATE INDEX reviews_created_at ON reviews(created_at DESC);
    """,
    # 2: library of games and analyses (Phase 3)
    """
    CREATE TABLE games (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        kind            TEXT NOT NULL DEFAULT 'game',   -- game | analysis
        source          TEXT NOT NULL DEFAULT 'import', -- board | import | review | play | lichess | chesscom
        white           TEXT,
        black           TEXT,
        result          TEXT,
        event           TEXT,
        site            TEXT,
        round           TEXT,
        game_date       TEXT,                           -- as in the PGN, e.g. 2026.11.20
        sort_date       TEXT NOT NULL,                  -- yyyy-mm-dd: date played, else date added
        my_color        TEXT,                           -- white | black | NULL
        eco             TEXT,
        opening         TEXT,
        opening_family  TEXT,
        ply_count       INTEGER NOT NULL DEFAULT 0,
        tags            TEXT NOT NULL DEFAULT '',       -- comma separated
        fingerprint     TEXT,
        start_fen       TEXT,
        pgn             TEXT NOT NULL,
        review_id       INTEGER REFERENCES reviews(id) ON DELETE SET NULL
    );
    CREATE INDEX games_sort ON games(sort_date DESC, id DESC);
    CREATE INDEX games_family ON games(opening_family);
    CREATE UNIQUE INDEX games_fingerprint ON games(fingerprint) WHERE fingerprint IS NOT NULL;
    ALTER TABLE reviews ADD COLUMN game_id INTEGER REFERENCES games(id) ON DELETE SET NULL;
    ALTER TABLE reviews ADD COLUMN eco TEXT;
    ALTER TABLE reviews ADD COLUMN opening TEXT;
    """,
    # 3: notes with full-text search (Phase 4)
    """
    CREATE TABLE notes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        title           TEXT NOT NULL DEFAULT '',
        body            TEXT NOT NULL DEFAULT '',
        tags            TEXT NOT NULL DEFAULT '',
        pinned          INTEGER NOT NULL DEFAULT 0,
        fen             TEXT,
        epd             TEXT,
        game_id         INTEGER REFERENCES games(id) ON DELETE SET NULL,
        eco             TEXT,
        opening         TEXT,
        tournament_id   INTEGER
    );
    CREATE INDEX notes_epd ON notes(epd);
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tags, content='notes', content_rowid='id',
                                              tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
    END;
    CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
    END;
    CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
        INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
    END;
    """,
    # 4: training progress (spaced repetition) and opening repertoire (Phases 5 and 6)
    """
    CREATE TABLE training (
        item_id         TEXT PRIMARY KEY,               -- e.g. endgame:lucena, puzzle:r3m17, rep:42
        kind            TEXT NOT NULL,                  -- endgame | puzzle | rep
        attempts        INTEGER NOT NULL DEFAULT 0,
        successes       INTEGER NOT NULL DEFAULT 0,
        streak          INTEGER NOT NULL DEFAULT 0,
        ease            REAL NOT NULL DEFAULT 2.5,
        interval_days   REAL NOT NULL DEFAULT 0,
        due_at          TEXT NOT NULL,
        last_result     TEXT,
        last_at         TEXT
    );
    CREATE INDEX training_due ON training(kind, due_at);
    CREATE TABLE repertoire (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT NOT NULL,
        color           TEXT NOT NULL,                  -- the side this repertoire is for
        from_epd        TEXT NOT NULL,
        uci             TEXT NOT NULL,
        san             TEXT NOT NULL,
        to_epd          TEXT NOT NULL,
        comment         TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX repertoire_edge ON repertoire(color, from_epd, uci);
    """,
    # 5: tournaments (Phase 6)
    """
    CREATE TABLE tournaments (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        name            TEXT NOT NULL,
        location        TEXT NOT NULL DEFAULT '',
        start_date      TEXT,
        end_date        TEXT,
        time_control    TEXT NOT NULL DEFAULT '',
        notes           TEXT NOT NULL DEFAULT '',
        checklist       TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE tournament_rounds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        number          INTEGER NOT NULL,
        round_date      TEXT,
        opponent        TEXT NOT NULL DEFAULT '',
        opponent_rating INTEGER,
        my_color        TEXT,
        result          TEXT,
        expected        TEXT NOT NULL DEFAULT '',
        prep            TEXT NOT NULL DEFAULT '',
        game_id         INTEGER REFERENCES games(id) ON DELETE SET NULL
    );
    CREATE INDEX rounds_tournament ON tournament_rounds(tournament_id, number);
    """,
    # 6: settings (Phase 7)
    """
    CREATE TABLE settings (
        key             TEXT PRIMARY KEY,
        value           TEXT NOT NULL
    );
    """,
]

REVIEW_LIST_COLUMNS = (
    "id, created_at, updated_at, status, progress, total, profile, my_color, white, black, "
    "result, event, game_date, ply_count, white_accuracy, black_accuracy, error, game_id, eco, opening"
)


def now_iso() -> str:
    """Local time with UTC offset, e.g. 2026-11-23T14:05:09+03:00."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self._conn = self._connect()
        self._migrate()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    # ---- generic helpers (used by the feature modules) -----------------------------

    def all(self, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, tuple(params)).fetchall()]

    def one(self, sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, tuple(params)).fetchone()
        return dict(row) if row is not None else None

    def run(self, sql: str, params: tuple | list = ()) -> int:
        """Execute a write and commit. Returns lastrowid for inserts, else the row count."""
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return int(cur.lastrowid) if sql.lstrip().upper().startswith("INSERT") else cur.rowcount

    def insert(self, table: str, fields: dict[str, Any]) -> int:
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        return self.run(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(fields.values()))

    def update(self, table: str, row_id: int, fields: dict[str, Any]) -> bool:
        if not fields:
            return False
        sets = ", ".join(f"{k} = ?" for k in fields)
        return self.run(f"UPDATE {table} SET {sets} WHERE id = ?", (*fields.values(), row_id)) > 0

    # ---- backup and restore ----------------------------------------------------------

    def backup_to(self, target: Path) -> None:
        """Consistent copy of the database, even while the app is running."""
        target.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            dest = sqlite3.connect(target)
            try:
                self._conn.backup(dest)
            finally:
                dest.close()

    def restore_from(self, source: Path) -> None:
        """Replace the database with `source` (already checked by the caller)."""
        with self._lock:
            src = sqlite3.connect(source)
            try:
                src.backup(self._conn)
            finally:
                src.close()
            self._conn.commit()
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            version = self._conn.execute("PRAGMA user_version").fetchone()[0]
            for number, sql in enumerate(MIGRATIONS[version:], start=version + 1):
                self._conn.executescript(sql)
                self._conn.execute(f"PRAGMA user_version = {number}")
                self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ---- reviews -----------------------------------------------------------------

    def create_review(self, **fields: Any) -> int:
        stamp = now_iso()
        fields = {"created_at": stamp, "updated_at": stamp, "status": "queued", **fields}
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        with self._lock:
            cur = self._conn.execute(f"INSERT INTO reviews ({cols}) VALUES ({marks})", tuple(fields.values()))
            self._conn.commit()
            return int(cur.lastrowid)

    def update_review(self, review_id: int, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = now_iso()
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._conn.execute(f"UPDATE reviews SET {sets} WHERE id = ?", (*fields.values(), review_id))
            self._conn.commit()

    def get_review(self, review_id: int, *, with_result: bool = True) -> dict[str, Any] | None:
        cols = "*" if with_result else REVIEW_LIST_COLUMNS + ", pgn"
        with self._lock:
            row = self._conn.execute(f"SELECT {cols} FROM reviews WHERE id = ?", (review_id,)).fetchone()
        if row is None:
            return None
        data = dict(row)
        if with_result:
            # "result" is the game result column (1-0, ...); the review itself goes in "analysis".
            raw = data.pop("result_json", None)
            data["analysis"] = json.loads(raw) if raw else None
        return data

    def list_reviews(self, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {REVIEW_LIST_COLUMNS} FROM reviews ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_review(self, review_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def unfinished_review_ids(self) -> list[int]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id FROM reviews WHERE status IN ('queued', 'running') ORDER BY id"
            ).fetchall()
        return [r[0] for r in rows]
