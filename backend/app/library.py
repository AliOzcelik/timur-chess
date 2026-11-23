"""The game library (Phase 3): saved games and analyses with opening and dates."""

from __future__ import annotations

import hashlib
import io
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date
from typing import Any

import chess
import chess.pgn

from . import openings
from .db import Database, now_iso
from .pgn_tools import PgnError, read_games

UNKNOWN = ("", "?", "*", "????.??.??")
MAX_IMPORT_GAMES = 5000


def header(game: chess.pgn.Game, key: str) -> str | None:
    value = (game.headers.get(key) or "").strip()
    return None if value in UNKNOWN else value


def iso_date(pgn_date: str | None) -> str | None:
    """'2026.11.20' -> '2026-11-20'; partial dates fill in the 1st; unknown -> None."""
    if not pgn_date:
        return None
    parts = pgn_date.replace("-", ".").replace("/", ".").split(".")
    if not parts or not parts[0].isdigit() or len(parts[0]) != 4:
        return None
    year = int(parts[0])
    month = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
    day = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 1
    try:
        return date(year, max(1, min(12, month)), max(1, min(31, day))).isoformat()
    except ValueError:
        return date(year, max(1, min(12, month)), 1).isoformat()


def clean_tags(tags: str | list[str] | None) -> str:
    if not tags:
        return ""
    items = tags.split(",") if isinstance(tags, str) else tags
    seen: list[str] = []
    for t in items:
        t = re.sub(r"\s+", " ", t.strip())
        if t and t.lower() not in (s.lower() for s in seen):
            seen.append(t)
    return ", ".join(seen)


def pgn_text(game: chess.pgn.Game) -> str:
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return game.accept(exporter)


def describe(game: chess.pgn.Game, *, kind: str = "game") -> dict[str, Any]:
    """Columns for the games table, read from a parsed game."""
    moves = list(game.mainline_moves())
    board = game.board()
    opening = openings.detect_board_line(board, moves)
    played = header(game, "Date")
    start_fen = board.fen() if board.fen() != chess.STARTING_FEN else None
    fingerprint = None
    if moves and kind == "game":
        key = "|".join([
            (header(game, "White") or "").lower(), (header(game, "Black") or "").lower(),
            played or "", start_fen or "", " ".join(m.uci() for m in moves),
        ])
        fingerprint = hashlib.sha1(key.encode()).hexdigest()
    return {
        "white": header(game, "White"),
        "black": header(game, "Black"),
        "result": header(game, "Result"),
        "event": header(game, "Event"),
        "site": header(game, "Site"),
        "round": header(game, "Round"),
        "game_date": played,
        "eco": opening.eco if opening else None,
        "opening": opening.name if opening else None,
        "opening_family": opening.family if opening else None,
        "ply_count": len(moves),
        "start_fen": start_fen,
        "fingerprint": fingerprint,
        "pgn": pgn_text(game),
    }


class Library:
    def __init__(self, db: Database):
        self.db = db

    # ---- saving ---------------------------------------------------------------------

    def add(self, game: chess.pgn.Game, *, source: str, kind: str = "game", my_color: str | None = None,
            tags: str | list[str] | None = None, review_id: int | None = None) -> tuple[int, bool]:
        """Save one game. Returns (id, created); a game already in the library is not added twice."""
        fields = describe(game, kind=kind)
        if fields["fingerprint"]:
            existing = self.db.one("SELECT id FROM games WHERE fingerprint = ?", (fields["fingerprint"],))
            if existing:
                return existing["id"], False
        stamp = now_iso()
        fields.update({
            "created_at": stamp,
            "updated_at": stamp,
            "kind": kind,
            "source": source,
            "my_color": my_color,
            "tags": clean_tags(tags),
            "sort_date": iso_date(fields["game_date"]) or stamp[:10],
            "review_id": review_id,
        })
        try:
            return self.db.insert("games", fields), True
        except sqlite3.IntegrityError:
            existing = self.db.one("SELECT id FROM games WHERE fingerprint = ?", (fields["fingerprint"],))
            assert existing is not None
            return existing["id"], False

    def import_pgn(self, text: str, *, source: str = "import", my_color: str | None = None,
                   tags: str | list[str] | None = None, guess_color=None) -> dict[str, Any]:
        games = read_games(text, max_games=MAX_IMPORT_GAMES)
        added: list[int] = []
        duplicates: list[int] = []
        problems: list[str] = []
        for n, game in enumerate(games, start=1):
            if game.errors:
                problems.append(f"Game {n}: {game.errors[0]}")
                continue
            if not any(True for _ in game.mainline_moves()) and "FEN" not in game.headers:
                problems.append(f"Game {n}: no moves")
                continue
            color = my_color or (guess_color(header(game, "White"), header(game, "Black")) if guess_color else None)
            gid, created = self.add(game, source=source, my_color=color, tags=tags)
            (added if created else duplicates).append(gid)
        if not games:
            raise PgnError("No game found. Paste a PGN that contains moves, e.g. 1. e4 e5 2. Nf3 ...")
        return {"added": added, "duplicates": duplicates, "problems": problems[:20], "problem_count": len(problems)}

    def update(self, game_id: int, *, pgn: str | None = None, my_color: str | None | bool = False,
               tags: str | list[str] | None = None, kind: str | None = None) -> dict[str, Any] | None:
        row = self.get(game_id)
        if row is None:
            return None
        fields: dict[str, Any] = {}
        if pgn is not None:
            game = chess.pgn.read_game(io.StringIO(pgn))
            if game is None or game.errors:
                raise PgnError("The PGN could not be read.")
            described = describe(game, kind=kind or row["kind"])
            described["fingerprint"] = None if (kind or row["kind"]) == "analysis" else described["fingerprint"]
            fields.update(described)
            fields["sort_date"] = iso_date(described["game_date"]) or row["created_at"][:10]
        if my_color is not False:
            fields["my_color"] = my_color
        if tags is not None:
            fields["tags"] = clean_tags(tags)
        if kind is not None:
            fields["kind"] = kind
        fields["updated_at"] = now_iso()
        try:
            self.db.update("games", game_id, fields)
        except sqlite3.IntegrityError:
            fields["fingerprint"] = None
            self.db.update("games", game_id, fields)
        return self.get(game_id)

    def link_review(self, game_id: int, review_id: int) -> None:
        self.db.run("UPDATE games SET review_id = ? WHERE id = ?", (review_id, game_id))
        self.db.run("UPDATE reviews SET game_id = ? WHERE id = ?", (game_id, review_id))

    def delete(self, game_id: int) -> bool:
        return self.db.run("DELETE FROM games WHERE id = ?", (game_id,)) > 0

    # ---- reading --------------------------------------------------------------------

    LIST_COLUMNS = (
        "g.id, g.created_at, g.updated_at, g.kind, g.source, g.white, g.black, g.result, g.event, g.site, g.round, "
        "g.game_date, g.sort_date, g.my_color, g.eco, g.opening, g.opening_family, g.ply_count, g.tags, g.review_id, "
        "r.status AS review_status, r.white_accuracy, r.black_accuracy"
    )

    def get(self, game_id: int) -> dict[str, Any] | None:
        return self.db.one(
            f"SELECT {self.LIST_COLUMNS}, g.pgn, g.start_fen FROM games g LEFT JOIN reviews r ON r.id = g.review_id "
            "WHERE g.id = ?",
            (game_id,),
        )

    def query(self, filters: dict[str, Any], limit: int = 500) -> tuple[list[dict[str, Any]], int]:
        where, params = self._where(filters)
        rows = self.db.all(
            f"SELECT {self.LIST_COLUMNS} FROM games g LEFT JOIN reviews r ON r.id = g.review_id {where} "
            "ORDER BY g.sort_date DESC, g.id DESC LIMIT ?",
            (*params, limit),
        )
        total = self.db.one(f"SELECT COUNT(*) AS n FROM games g {where}", params)
        return rows, int(total["n"]) if total else 0

    def _where(self, f: dict[str, Any]) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if f.get("q"):
            for word in str(f["q"]).split():
                like = f"%{word}%"
                clauses.append("(g.white LIKE ? OR g.black LIKE ? OR g.event LIKE ? OR g.opening LIKE ? "
                               "OR g.eco LIKE ? OR g.tags LIKE ? OR g.site LIKE ?)")
                params += [like] * 7
        if f.get("family"):
            clauses.append("g.opening_family = ?")
            params.append(f["family"])
        if f.get("opening"):
            clauses.append("(g.opening = ? OR g.opening LIKE ?)")
            params += [f["opening"], f"{f['opening']},%"]
        if f.get("eco"):
            clauses.append("g.eco LIKE ?")
            params.append(f"{f['eco']}%")
        if f.get("color") in ("white", "black"):
            clauses.append("g.my_color = ?")
            params.append(f["color"])
        if f.get("kind") in ("game", "analysis"):
            clauses.append("g.kind = ?")
            params.append(f["kind"])
        if f.get("tag"):
            clauses.append("(', ' || g.tags || ',') LIKE ?")
            params.append(f"%, {f['tag']},%")
        if f.get("player"):
            clauses.append("(LOWER(g.white) = LOWER(?) OR LOWER(g.black) = LOWER(?))")
            params += [f["player"], f["player"]]
        if f.get("outcome") in ("win", "draw", "loss"):
            wins = {"white": "1-0", "black": "0-1"}
            if f["outcome"] == "draw":
                clauses.append("g.result = '1/2-1/2'")
            else:
                mine = "(g.my_color = 'white' AND g.result = '1-0') OR (g.my_color = 'black' AND g.result = '0-1')"
                theirs = "(g.my_color = 'white' AND g.result = '0-1') OR (g.my_color = 'black' AND g.result = '1-0')"
                clauses.append(f"({mine if f['outcome'] == 'win' else theirs})")
            del wins
        if f.get("since"):
            clauses.append("g.sort_date >= ?")
            params.append(f["since"])
        if f.get("until"):
            clauses.append("g.sort_date <= ?")
            params.append(f["until"])
        if f.get("ids"):
            ids = [int(i) for i in f["ids"]]
            clauses.append(f"g.id IN ({', '.join('?' for _ in ids)})")
            params += ids
        return ("WHERE " + " AND ".join(clauses)) if clauses else "", params

    def export(self, filters: dict[str, Any]) -> str:
        where, params = self._where(filters)
        rows = self.db.all(f"SELECT g.pgn FROM games g {where} ORDER BY g.sort_date, g.id", params)
        return "\n\n".join(r["pgn"].strip() for r in rows) + ("\n" if rows else "")

    def tags(self) -> list[dict[str, Any]]:
        counts: Counter[str] = Counter()
        for row in self.db.all("SELECT tags FROM games WHERE tags != ''"):
            for t in row["tags"].split(","):
                if t.strip():
                    counts[t.strip()] += 1
        return [{"tag": t, "count": n} for t, n in sorted(counts.items(), key=lambda x: (-x[1], x[0].lower()))]

    # ---- openings -------------------------------------------------------------------

    @staticmethod
    def _score(result: str | None, color: str | None) -> float | None:
        if not color or result not in ("1-0", "0-1", "1/2-1/2"):
            return None
        if result == "1/2-1/2":
            return 0.5
        return 1.0 if (result == "1-0") == (color == "white") else 0.0

    def opening_tree(self, filters: dict[str, Any]) -> list[dict[str, Any]]:
        """Families -> variations -> full names, with counts and your score."""
        where, params = self._where({k: v for k, v in filters.items() if k not in ("family", "opening")})
        rows = self.db.all(f"SELECT g.opening_family, g.opening, g.eco, g.result, g.my_color FROM games g {where}", params)
        families: dict[str, dict[str, Any]] = {}
        for r in rows:
            fam_name = r["opening_family"] or "Unknown opening"
            fam = families.setdefault(fam_name, {"family": fam_name, "count": 0, "ecos": set(), "variations": {},
                                                 "scores": {"white": [], "black": []}})
            fam["count"] += 1
            if r["eco"]:
                fam["ecos"].add(r["eco"])
            score = self._score(r["result"], r["my_color"])
            if score is not None:
                fam["scores"][r["my_color"]].append(score)
            name = r["opening"] or fam_name
            var_name = name.split(":", 1)[1].split(",")[0].strip() if ":" in name else "Main line"
            var = fam["variations"].setdefault(var_name, {"variation": var_name, "count": 0, "openings": Counter()})
            var["count"] += 1
            var["openings"][name] += 1

        out = []
        for fam in sorted(families.values(), key=lambda x: (-x["count"], x["family"])):
            out.append({
                "family": fam["family"],
                "count": fam["count"],
                "ecos": sorted(fam["ecos"]),
                "as_white": _score_summary(fam["scores"]["white"]),
                "as_black": _score_summary(fam["scores"]["black"]),
                "variations": [
                    {"variation": v["variation"], "count": v["count"],
                     "openings": [{"name": n, "count": c} for n, c in v["openings"].most_common()]}
                    for v in sorted(fam["variations"].values(), key=lambda x: (-x["count"], x["variation"]))
                ],
            })
        return out

    def opening_stats(self, filters: dict[str, Any]) -> dict[str, Any]:
        """Your results, accuracy and where mistakes happen, for the games matching the filters."""
        where, params = self._where(filters)
        rows = self.db.all(
            f"SELECT g.id, g.result, g.my_color, g.review_id, r.white_accuracy, r.black_accuracy, r.result_json "
            f"FROM games g LEFT JOIN reviews r ON r.id = g.review_id AND r.status = 'done' {where}",
            params,
        )
        by_color: dict[str, dict[str, Any]] = {c: {"games": 0, "wins": 0, "draws": 0, "losses": 0} for c in ("white", "black")}
        accuracies: dict[str, list[float]] = defaultdict(list)
        mistake_moves: Counter[int] = Counter()
        reviewed = 0
        import json

        for r in rows:
            color = r["my_color"]
            if color in by_color:
                s = self._score(r["result"], color)
                if s is not None:
                    side = by_color[color]
                    side["games"] += 1
                    side["wins" if s == 1 else "draws" if s == 0.5 else "losses"] += 1
            if r["result_json"] and color in ("white", "black"):
                reviewed += 1
                acc = r["white_accuracy"] if color == "white" else r["black_accuracy"]
                if acc is not None:
                    accuracies[color].append(acc)
                try:
                    analysis = json.loads(r["result_json"])
                except ValueError:
                    continue
                for m in analysis.get("moves", []):
                    if m["color"] == color and m["classification"] in ("mistake", "blunder"):
                        mistake_moves[m["move_number"]] += 1
        for side in by_color.values():
            side["score"] = round(100 * (side["wins"] + 0.5 * side["draws"]) / side["games"]) if side["games"] else None
        peak = None
        if mistake_moves:
            # The 3-move window with the most mistakes, e.g. "around move 9".
            best = max(range(1, max(mistake_moves) + 1),
                       key=lambda n: (mistake_moves[n - 1] + mistake_moves[n] + mistake_moves[n + 1], -n))
            peak = best
        return {
            "games": len(rows),
            "reviewed": reviewed,
            "by_color": by_color,
            "accuracy": {c: round(sum(v) / len(v), 1) for c, v in accuracies.items() if v},
            "mistakes_by_move": [{"move": n, "count": c} for n, c in sorted(mistake_moves.items())],
            "mistake_peak_move": peak,
            "mistake_count": sum(mistake_moves.values()),
        }


def _score_summary(scores: list[float]) -> dict[str, Any] | None:
    if not scores:
        return None
    return {"games": len(scores), "score": round(100 * sum(scores) / len(scores))}


def backfill_reviews(db: Database, lib: Library, guess_color=None) -> int:
    """Give reviews made before the library existed an opening name and a library entry."""
    rows = db.all("SELECT id, pgn, my_color FROM reviews WHERE game_id IS NULL AND status = 'done'")
    for row in rows:
        game = chess.pgn.read_game(io.StringIO(row["pgn"]))
        if game is None:
            continue
        opening = openings.detect_game(game)
        db.run("UPDATE reviews SET eco = ?, opening = ? WHERE id = ?",
               (opening.eco if opening else None, opening.name if opening else None, row["id"]))
        color = row["my_color"] if row["my_color"] in ("white", "black") else (
            guess_color(header(game, "White"), header(game, "Black")) if guess_color else None)
        gid, _ = lib.add(game, source="review", my_color=color)
        lib.link_review(gid, row["id"])
    return len(rows)
