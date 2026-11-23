"""Notes API (Phase 4): Markdown notes, searchable, linked to positions, games, openings and tournaments."""

from __future__ import annotations

import io
import re
import zipfile
from datetime import date
from typing import Any

import chess
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import openings
from ..context import NOTES_EXPORT_DIR, db
from ..db import now_iso
from ..library import clean_tags

router = APIRouter(prefix="/api/notes")

COLUMNS = ("id, created_at, updated_at, title, body, tags, pinned, fen, epd, game_id, eco, opening, "
           "tournament_id")


def fts_query(text: str) -> str | None:
    """Every word must match, as a prefix: 'najd engl' finds 'Najdorf, English Attack'."""
    words = re.findall(r"\w+", text, flags=re.UNICODE)
    if not words:
        return None
    return " ".join('"' + w.replace('"', '""') + '"*' for w in words)


def _position_fields(fen: str | None) -> dict[str, Any]:
    if not fen:
        return {"fen": None, "epd": None}
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid FEN: {exc}") from exc
    return {"fen": board.fen(), "epd": openings.epd(board)}


def _get(note_id: int) -> dict[str, Any]:
    row = db.one(f"SELECT {COLUMNS} FROM notes WHERE id = ?", (note_id,))
    if row is None:
        raise HTTPException(404, "Note not found.")
    row["pinned"] = bool(row["pinned"])
    return row


@router.get("")
async def list_notes(q: str | None = None, fen: str | None = None, game_id: int | None = None,
                     tournament_id: int | None = None, tag: str | None = None, family: str | None = None,
                     eco: str | None = None, limit: int = Query(300, ge=1, le=2000)) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []
    join = ""
    order = "n.pinned DESC, n.updated_at DESC"
    snippet = "NULL AS snippet"
    if q and (match := fts_query(q)):
        join = "JOIN notes_fts f ON f.rowid = n.id"
        clauses.append("notes_fts MATCH ?")
        params.append(match)
        order = "n.pinned DESC, bm25(notes_fts), n.updated_at DESC"
        snippet = "snippet(notes_fts, 1, '[[', ']]', ' … ', 14) AS snippet"
    if fen:
        clauses.append("n.epd = ?")
        params.append(_position_fields(fen)["epd"])
    if game_id is not None:
        clauses.append("n.game_id = ?")
        params.append(game_id)
    if tournament_id is not None:
        clauses.append("n.tournament_id = ?")
        params.append(tournament_id)
    if tag:
        clauses.append("(', ' || n.tags || ',') LIKE ?")
        params.append(f"%, {tag},%")
    if family:
        clauses.append("(n.opening = ? OR n.opening LIKE ?)")
        params += [family, f"{family}:%"]
    if eco:
        clauses.append("n.eco LIKE ?")
        params.append(f"{eco}%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    cols = ", ".join(f"n.{c.strip()}" for c in COLUMNS.split(","))
    rows = db.all(f"SELECT {cols}, {snippet} FROM notes n {join} {where} ORDER BY {order} LIMIT ?",
                  (*params, limit))
    for r in rows:
        r["pinned"] = bool(r["pinned"])
    return {"notes": rows}


@router.get("/tags")
async def note_tags() -> dict[str, Any]:
    counts: dict[str, int] = {}
    for row in db.all("SELECT tags FROM notes WHERE tags != ''"):
        for t in row["tags"].split(","):
            if t.strip():
                counts[t.strip()] = counts.get(t.strip(), 0) + 1
    return {"tags": [{"tag": t, "count": n} for t, n in sorted(counts.items(), key=lambda x: (-x[1], x[0].lower()))]}


class NoteIn(BaseModel):
    title: str = Field("", max_length=300)
    body: str = Field("", max_length=500_000)
    tags: str | list[str] | None = None
    pinned: bool = False
    fen: str | None = None
    game_id: int | None = None
    tournament_id: int | None = None
    eco: str | None = None
    opening: str | None = None


def _fields(req: NoteIn, partial: set[str] | None = None) -> dict[str, Any]:
    data = req.model_dump(exclude_unset=partial is not None)
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key == "fen":
            out.update(_position_fields(value))
        elif key == "tags":
            out["tags"] = clean_tags(value)
        elif key == "pinned":
            out["pinned"] = int(bool(value))
        else:
            out[key] = value
    if out.get("epd") and not out.get("opening") and partial is None:
        found = openings.index().get(out["epd"])
        if found:
            out["eco"], out["opening"] = found.eco, found.name
    if "game_id" in out and out["game_id"] is not None and partial is None and not out.get("opening"):
        game = db.one("SELECT eco, opening FROM games WHERE id = ?", (out["game_id"],))
        if game is None:
            raise HTTPException(400, "That game is not in the library.")
        out["eco"], out["opening"] = game["eco"], game["opening"]
    return out


@router.post("", status_code=201)
async def create_note(req: NoteIn) -> dict[str, Any]:
    if not req.title.strip() and not req.body.strip():
        raise HTTPException(400, "Write a title or some text first.")
    stamp = now_iso()
    fields = {"created_at": stamp, "updated_at": stamp, **_fields(req)}
    fields.setdefault("tags", "")
    return _get(db.insert("notes", fields))


@router.get("/{note_id}")
async def get_note(note_id: int) -> dict[str, Any]:
    return _get(note_id)


@router.put("/{note_id}")
async def update_note(note_id: int, req: NoteIn) -> dict[str, Any]:
    _get(note_id)
    fields = _fields(req, partial=set())
    fields["updated_at"] = now_iso()
    db.update("notes", note_id, fields)
    return _get(note_id)


@router.delete("/{note_id}")
async def delete_note(note_id: int) -> dict[str, Any]:
    if db.run("DELETE FROM notes WHERE id = ?", (note_id,)) == 0:
        raise HTTPException(404, "Note not found.")
    return {"ok": True}


# ---- export: plain Markdown files you can open in any editor ------------------------------

def _slug(text: str) -> str:
    s = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)[:60] or "note"


def _markdown(note: dict[str, Any]) -> str:
    meta = {
        "title": note["title"],
        "created": note["created_at"],
        "updated": note["updated_at"],
        "tags": note["tags"],
        "opening": note["opening"],
        "eco": note["eco"],
        "fen": note["fen"],
        "game_id": note["game_id"],
        "tournament_id": note["tournament_id"],
    }
    lines = ["---"]
    for key, value in meta.items():
        if value not in (None, ""):
            text = str(value).replace('"', '\\"')
            lines.append(f'{key}: "{text}"')
    lines.append("---\n")
    if note["title"]:
        lines.append(f"# {note['title']}\n")
    return "\n".join(lines) + note["body"].rstrip() + "\n"


def _export_files() -> list[tuple[str, str]]:
    notes = db.all(f"SELECT {COLUMNS} FROM notes ORDER BY created_at")
    files: list[tuple[str, str]] = []
    used: set[str] = set()
    for n in notes:
        base = f"{n['created_at'][:10]}-{_slug(n['title'] or n['body'][:40])}"
        name = base
        i = 2
        while name in used:
            name = f"{base}-{i}"
            i += 1
        used.add(name)
        files.append((f"{name}.md", _markdown(n)))
    return files


@router.post("/export")
async def export_to_folder() -> dict[str, Any]:
    """Write every note as a .md file into data/notes-export (replacing the last export)."""
    NOTES_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    for old in NOTES_EXPORT_DIR.glob("*.md"):
        old.unlink()
    files = _export_files()
    for name, text in files:
        (NOTES_EXPORT_DIR / name).write_text(text, encoding="utf-8")
    return {"count": len(files), "folder": str(NOTES_EXPORT_DIR)}


@router.get("/export/zip")
async def export_zip() -> Response:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in _export_files():
            zf.writestr(f"timur-notes/{name}", text)
    name = f"timur-notes-{date.today().isoformat()}.zip"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
