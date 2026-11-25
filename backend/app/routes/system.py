"""Settings and backups (Phase 7)."""

from __future__ import annotations

import re
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import config
from ..context import BACKUP_DIR, apply_engine_settings, db, settings, tablebases
from ..settings_store import defaults

router = APIRouter(prefix="/api")

KEEP_BACKUPS = 30
REQUIRED_TABLES = {"reviews", "games", "notes"}
NAME_RE = re.compile(r"^timur-[\w.-]+\.db$")


# ---- settings ------------------------------------------------------------------------

class Thresholds(BaseModel):
    inaccuracy: float = Field(..., ge=1, le=50)
    mistake: float = Field(..., ge=1, le=50)
    blunder: float = Field(..., ge=1, le=60)


class SettingsIn(BaseModel):
    stockfish_path: str | None = Field(None, max_length=500)
    live_threads: int | None = Field(None, ge=1, le=256)
    live_hash_mb: int | None = Field(None, ge=16, le=65536)
    review_threads: int | None = Field(None, ge=1, le=256)
    review_hash_mb: int | None = Field(None, ge=16, le=65536)
    default_profile: Literal["quick", "standard", "deep"] | None = None
    thresholds: Thresholds | None = None
    theme: Literal["system", "dark", "light"] | None = None
    accent: Literal["brass", "ember", "amethyst", "cobalt"] | None = None
    board: Literal["walnut", "slate", "moss", "rosewood"] | None = None
    allow_internet: bool | None = None
    llm_enabled: bool | None = None
    llm_base_url: str | None = Field(None, max_length=500)
    llm_model: str | None = Field(None, min_length=1, max_length=200)
    player_names: list[str] | None = Field(None, max_length=20)
    onboarded: bool | None = None


ENGINE_KEYS = {"stockfish_path", "live_threads", "live_hash_mb", "review_threads", "review_hash_mb"}


def _view() -> dict[str, Any]:
    return {"settings": settings.all(), "defaults": defaults(), "cpu_count": config.CPU_COUNT,
            "detected_stockfish": config.STOCKFISH_PATH, "tablebases": tablebases.status(),
            "data_dir": str(config.DATA_DIR)}


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return _view()


@router.put("/settings")
async def put_settings(req: SettingsIn) -> dict[str, Any]:
    changes = req.model_dump(exclude_unset=True, exclude_none=True)
    if "thresholds" in changes:
        t = changes["thresholds"]
        if not (t["inaccuracy"] < t["mistake"] < t["blunder"]):
            raise HTTPException(400, "Each threshold must be bigger than the one before: "
                                     "inaccuracy < mistake < blunder.")
    if "stockfish_path" in changes and changes["stockfish_path"].strip():
        path = Path(changes["stockfish_path"].strip()).expanduser()
        if not path.is_file():
            raise HTTPException(400, f"No file at {path}.")
        changes["stockfish_path"] = str(path)
    if "llm_base_url" in changes:
        url = changes["llm_base_url"].strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise HTTPException(400, "The model server address must start with http:// or https://.")
        changes["llm_base_url"] = url
    if "llm_model" in changes:
        changes["llm_model"] = changes["llm_model"].strip()
    if "player_names" in changes:
        changes["player_names"] = [n.strip() for n in changes["player_names"] if n.strip()]
    settings.update(changes)
    if ENGINE_KEYS & changes.keys():
        await apply_engine_settings()
    return _view()


@router.post("/settings/reset")
async def reset_settings() -> dict[str, Any]:
    settings.reset()
    await apply_engine_settings()
    return _view()


@router.post("/tablebases/reload")
async def reload_tablebases() -> dict[str, Any]:
    tablebases.reload()
    return tablebases.status()


# ---- backups ---------------------------------------------------------------------------

def _backups() -> list[dict[str, Any]]:
    if not BACKUP_DIR.is_dir():
        return []
    out = []
    for p in sorted(BACKUP_DIR.glob("timur-*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = p.stat()
        out.append({"name": p.name, "size": st.st_size,
                    "created_at": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds")})
    return out


def make_backup(label: str = "") -> dict[str, Any]:
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    name = f"timur-{stamp}{'-' + label if label else ''}.db"
    db.backup_to(BACKUP_DIR / name)
    # Keep the newest ones; safety copies made before a restore count too.
    for old in _backups()[KEEP_BACKUPS:]:
        (BACKUP_DIR / old["name"]).unlink(missing_ok=True)
    return next(b for b in _backups() if b["name"] == name)


def _check_database(path: Path) -> None:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0]
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        raise HTTPException(400, "That file is not a Timur backup (not an SQLite database).") from exc
    if ok != "ok":
        raise HTTPException(400, "That backup is damaged and can't be restored.")
    if "reviews" not in tables:
        raise HTTPException(400, "That file is not a Timur backup (no reviews table).")


@router.get("/backups")
async def list_backups() -> dict[str, Any]:
    return {"backups": _backups(), "folder": str(BACKUP_DIR)}


@router.post("/backups", status_code=201)
async def create_backup() -> dict[str, Any]:
    return make_backup()


def _backup_path(name: str) -> Path:
    if not NAME_RE.match(name):
        raise HTTPException(400, "Invalid backup name.")
    path = BACKUP_DIR / name
    if not path.is_file():
        raise HTTPException(404, "Backup not found.")
    return path


@router.get("/backups/{name}")
async def download_backup(name: str) -> FileResponse:
    return FileResponse(_backup_path(name), media_type="application/vnd.sqlite3", filename=name)


@router.delete("/backups/{name}")
async def delete_backup(name: str) -> dict[str, Any]:
    _backup_path(name).unlink()
    return {"ok": True}


async def _restore(path: Path) -> dict[str, Any]:
    _check_database(path)
    safety = make_backup("before-restore")
    db.restore_from(path)
    from ..library import backfill_reviews
    from ..context import library

    backfill_reviews(db, library, settings.my_color_for)
    await apply_engine_settings()
    return {"ok": True, "safety_backup": safety["name"]}


@router.post("/backups/{name}/restore")
async def restore_backup(name: str) -> dict[str, Any]:
    return await _restore(_backup_path(name))


@router.post("/restore")
async def restore_upload(request: Request) -> dict[str, Any]:
    """Restore from an uploaded .db file (sent as the raw request body)."""
    body = await request.body()
    if len(body) > 2_000_000_000:
        raise HTTPException(413, "File too large.")
    if not body.startswith(b"SQLite format 3\x00"):
        raise HTTPException(400, "That file is not a Timur backup (not an SQLite database).")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload.db"
        path.write_bytes(body)
        return await _restore(path)
