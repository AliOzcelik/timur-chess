"""Plain-language mistake explanations: Stockfish + board facts, written up by a local LLM.

1. Facts. The review already holds Stockfish's best line before the move and its
   best reply after it (the refutation). Stockfish is asked two more things here:
   which other moves were also fine (MultiPV), and what the opponent was already
   threatening (the same position with the other side to move). Both lines are
   played out until the captures stop, python-chess lists the positional features
   of each end position, and only what changed is kept.
2. Writing. The LLM gets those facts as JSON and writes 2-3 sentences.
3. Checking. Every move the LLM mentions must come from the given lines. If not,
   it is asked once to fix it; after that the built-in hint is used instead.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

import chess
import chess.engine

from ..engine import EngineService, threat_board
from ..evals import score_to_eval, win_percent
from ..llm import LLMClient, LLMUnavailable
from .motifs import NAMES, line_text, material_swing
from .positional import changes, features, material_text, ranked

EXPLAINABLE = {"inaccuracy", "mistake", "blunder"}
SEARCH = chess.engine.Limit(depth=18, time=1.0)
ALTERNATIVE_GAP = 5.0  # other moves within 5 winning-chance points of the best are "also fine"
NO_CHANGE = "no notable positional changes"
LINE_PLIES = 4  # lines shown to the model; short lines keep the explanation short

SYSTEM_PROMPT = """You are a chess coach explaining one move from the player's own game.
You get a JSON object of facts. Stockfish and board analysis produced them, so they are correct. You cannot see the board.

Write 2 or 3 short sentences to the player. The player had the side named in "side": call that side "you"/"your" and the other side "your opponent".
1. Say why move_played is worse. Use the refutation and changes_after_played_line (or tactics and material facts, if present).
2. Say what best_move does instead and why, using changes_after_best_line.

Rules:
- Mention only moves that appear in move_played, best_line, refutation, good_alternatives or threat_missed. Copy them exactly, with move numbers. Quote at most the first three moves of any line.
- move_played_does and best_move_does say what each move physically does. Never describe a move differently.
- State nothing about the position that is not in the facts. Do not invent plans, pieces, squares or threats.
- Match the tone to classification: an inaccuracy is a small slip, a mistake is a clear error, a blunder is serious.
- If tactics, material or mate decide it, explain the concrete line and skip positional talk.
- Facts starting with "no longer true:" mean something went away.
- If a changes list says "no notable positional changes", say nothing structural about that line, and never repeat that phrase.
- Plain text only. No lists, no markdown, no evaluation numbers or percentages."""

# Moves the LLM might write. Bare pawn moves like "d5" are only checked with a move number,
# because "d5" on its own is usually a square name.
MOVE_TOKEN = re.compile(
    r"(?<![A-Za-z0-9])(?:(\d+)\s*(?:\.\.\.|\.|…)\s*)?"
    r"(O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)"
    r"[+#]?(?![A-Za-z0-9])"
)


def _norm(san: str) -> str:
    return san.rstrip("+#!?").replace("0", "O")


def _parse_san_line(board: chess.Board, sans: list[str]) -> list[chess.Move]:
    b = board.copy(stack=False)
    out: list[chess.Move] = []
    for san in sans:
        try:
            move = b.parse_san(san)
        except ValueError:
            break
        out.append(move)
        b.push(move)
    return out


def settle(board: chess.Board, moves: list[chess.Move], min_plies: int = 4, max_plies: int = 10) -> chess.Board:
    """Play a line for at least `min_plies`, then on while it is still capturing or checking."""
    b = board.copy(stack=False)
    for i, move in enumerate(moves[:max_plies]):
        if not b.is_legal(move):
            break
        if i >= min_plies and not (b.is_check() or b.is_capture(move) or move.promotion):
            break
        b.push(move)
    return b


def _sans(board: chess.Board, moves: list[chess.Move]) -> list[str]:
    b = board.copy(stack=False)
    out = []
    for m in moves:
        if not b.is_legal(m):
            break
        out.append(b.san(m))
        b.push(m)
    return out


def describe(board: chess.Board, move: chess.Move) -> str:
    """'White queen on d1 takes the pawn on d4', so the model never has to guess what a move does."""
    piece = board.piece_at(move.from_square)
    if piece is None:
        return ""
    side = "White" if piece.color == chess.WHITE else "Black"
    if board.is_castling(move):
        return f"{side} castles {'kingside' if chess.square_file(move.to_square) > 4 else 'queenside'}"
    text = f"{side} {NAMES[piece.piece_type]} on {chess.square_name(move.from_square)}"
    if board.is_en_passant(move):
        text += f" takes the pawn en passant, landing on {chess.square_name(move.to_square)}"
    elif board.is_capture(move):
        victim = board.piece_at(move.to_square)
        text += f" takes the {NAMES[victim.piece_type] if victim else 'piece'} on {chess.square_name(move.to_square)}"
    else:
        text += f" goes to {chess.square_name(move.to_square)}"
    if move.promotion:
        text += f" and promotes to a {NAMES[move.promotion]}"
    if board.gives_check(move):
        text += ", with check"
    return text


async def _analyse(engine: chess.engine.UciProtocol, board: chess.Board, multipv: int,
                   limit: chess.engine.Limit = SEARCH) -> list[dict[str, Any]]:
    if board.is_game_over():
        return []
    # shield: if the request goes away (tab closed, Stop pressed), let Stockfish finish this short search
    # rather than cancel python-chess mid-command, which leaves the engine unusable.
    infos = await asyncio.shield(
        engine.analyse(board, limit, multipv=min(multipv, board.legal_moves.count()), game="coach"))
    return [{"eval": score_to_eval(i["score"]), "pv": list(i.get("pv") or [])} for i in infos if "score" in i]


async def build_facts(move: dict[str, Any], engine: chess.engine.UciProtocol) -> tuple[dict[str, Any], set[str]]:
    """The fact sheet for one reviewed move, plus every move (SAN) the LLM may mention."""
    before = chess.Board(move["fen_before"])
    mover = before.turn
    side = "White" if mover == chess.WHITE else "Black"
    played = chess.Move.from_uci(move["uci"])
    after = before.copy(stack=False)
    after.push(played)

    best_line = _parse_san_line(before, move.get("best_line_san") or [])
    reply_line = _parse_san_line(after, move.get("reply_line_san") or [])

    # Stockfish: alternatives to the best move, and lines the review didn't store.
    top = await _analyse(engine, before, 3)
    if not best_line and top:
        best_line = top[0]["pv"]
    if not reply_line:
        replies = await _analyse(engine, after, 1)
        reply_line = replies[0]["pv"] if replies else []

    alternatives: list[str] = []
    if top:
        best_win = win_percent(top[0]["eval"], mover)
        for line in top[1:]:
            if not line["pv"] or line["pv"][0] == played:
                continue
            if best_win - win_percent(line["eval"], mover) <= ALTERNATIVE_GAP:
                alternatives.append(line_text(before, line["pv"][:1], 1))

    # Stockfish: what was the opponent threatening? Only worth saying if the
    # refutation is exactly that threat, i.e. the move ignored it.
    threat_missed: str | None = None
    if not before.is_check() and reply_line:
        threats = await _analyse(engine, threat_board(before), 1)
        if threats and threats[0]["pv"] and threats[0]["pv"][0] == reply_line[0]:
            threat = line_text(after, reply_line[:1], 1)
            threat_missed = f"{threat} was already threatened before {line_text(before, [played], 1)}, and the move did nothing against it"

    played_end = settle(before, [played, *reply_line])
    best_end = settle(before, best_line)
    base = features(before)
    played_changes = changes(base, features(played_end))
    best_changes = changes(base, features(best_end))
    # What both lines share doesn't explain the difference between them.
    only_played = {k: f for k, f in played_changes.items() if k not in best_changes}
    only_best = {k: f for k, f in best_changes.items() if k not in played_changes}

    facts: dict[str, Any] = {
        "side": side,
        "move_played": line_text(before, [played], 1),
        "move_played_does": describe(before, played),
        "classification": move["classification"],
        "win_pct_drop": round(move.get("drop") or 0),
        "best_move": line_text(before, best_line[:1], 1) if best_line else None,
        "best_move_does": describe(before, best_line[0]) if best_line else None,
        "best_line": line_text(before, best_line, LINE_PLIES),
        "refutation": line_text(after, reply_line, LINE_PLIES),
        "changes_after_played_line": ranked(only_played, 4) or [NO_CHANGE],
        "changes_after_best_line": ranked(only_best, 3) or [NO_CHANGE],
        "material_after_refutation": material_text(played_end),
        "material_after_best_line": material_text(best_end),
    }
    swing = material_swing(before, [played, *reply_line], mover)
    if swing <= -1:
        facts["material_lost_by_move_played"] = f"{-swing} pawn{'s' if swing != -1 else ''}' worth"
    if alternatives:
        facts["good_alternatives"] = alternatives
    if threat_missed:
        facts["threat_missed"] = threat_missed
    if move.get("motifs"):
        facts["tactics"] = move.get("explanation")

    allowed: set[str] = {_norm(before.san(played))}
    allowed.update(_norm(s) for s in _sans(before, best_line[:LINE_PLIES]))
    allowed.update(_norm(s) for s in _sans(after, reply_line[:LINE_PLIES]))
    for line in top:
        allowed.update(_norm(s) for s in _sans(before, line["pv"][:1]))
    return facts, allowed


def unknown_moves(text: str, allowed: set[str]) -> list[str]:
    bad = []
    for m in MOVE_TOKEN.finditer(text):
        number, san = m.group(1), m.group(2)
        is_bare_pawn = san[0] in "abcdefgh" and "x" not in san
        if is_bare_pawn and not number:
            continue  # a square name, not a move
        if _norm(san) not in allowed:
            bad.append(m.group(0).strip())
    return bad


def _clean(text: str) -> str:
    text = re.sub(r"[*_`#]+", "", text).strip()
    text = re.sub(r"^(here('s| is)[^:\n]*:)\s*", "", text, flags=re.IGNORECASE)
    return " ".join(text.split())


class Coach:
    """Writes explanations one at a time on its own small Stockfish process."""

    def __init__(self, service: EngineService, llm: LLMClient):
        self.service = service
        self.llm = llm

    async def explain(self, move: dict[str, Any]) -> dict[str, Any]:
        if move.get("classification") not in EXPLAINABLE:
            raise ValueError("Only inaccuracies, mistakes and blunders get an AI explanation.")
        engine = await self.service.get()
        facts, allowed = await build_facts(move, engine)
        model = self.llm.config()["model"]

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(facts, indent=2)},
        ]
        text = _clean(await self.llm.chat(messages))
        bad = unknown_moves(text, allowed)
        if bad:
            messages += [
                {"role": "assistant", "content": text},
                {"role": "user", "content": f"You mentioned {', '.join(bad)}, which is not in the given lines. "
                                            "Rewrite the explanation using only moves from the facts."},
            ]
            text = _clean(await self.llm.chat(messages))
            bad = unknown_moves(text, allowed)

        result: dict[str, Any] = {"facts": facts, "model": model, "created_at": int(time.time())}
        if bad:
            result.update(text=move.get("explanation") or "", source="template",
                          note="The AI's explanation mentioned moves that aren't in the engine's lines, so the built-in hint is shown.")
        else:
            result.update(text=text, source="llm")
        return result


__all__ = ["Coach", "LLMUnavailable", "build_facts", "unknown_moves", "settle", "EXPLAINABLE"]
