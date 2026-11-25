"""Positional facts about a board, computed with python-chess.

Stockfish 19 scores positions with a neural network, so its evaluation cannot
be split into named ideas like "backward pawn". These functions find those
ideas directly on the board. Each fact has a stable key, so two positions can
be compared and only what changed is reported.

Facts use absolute colours ("White", "Black") so they read correctly whoever
made the move.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .motifs import NAMES, VALUES


@dataclass(frozen=True)
class Fact:
    key: str
    weight: int  # 1 minor, 2 notable, 3 important
    text: str


COLOR = {chess.WHITE: "White", chess.BLACK: "Black"}


def _forward(color: chess.Color) -> int:
    return 1 if color == chess.WHITE else -1


def _rel_rank(square: chess.Square, color: chess.Color) -> int:
    """0-7 from the side's own back rank."""
    r = chess.square_rank(square)
    return r if color == chess.WHITE else 7 - r


def _pawns_on_file(board: chess.Board, color: chess.Color, file: int) -> list[chess.Square]:
    return [sq for sq in board.pieces(chess.PAWN, color) if chess.square_file(sq) == file]


def _ahead(square: chess.Square, color: chess.Color, other: chess.Square) -> bool:
    """Is `other` further up the board than `square`, seen from `color`?"""
    return _rel_rank(other, color) > _rel_rank(square, color)


def _is_passed(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    file = chess.square_file(square)
    for f in (file - 1, file, file + 1):
        if 0 <= f <= 7:
            for sq in _pawns_on_file(board, not color, f):
                if _ahead(square, color, sq):
                    return False
    return True


def _can_be_hit_by_pawn(board: chess.Board, square: chess.Square, by: chess.Color) -> bool:
    """Could a pawn of `by` ever attack `square` (now or after advancing)?"""
    file = chess.square_file(square)
    for f in (file - 1, file + 1):
        if not 0 <= f <= 7:
            continue
        for sq in _pawns_on_file(board, by, f):
            # `by`'s pawn must still be behind the square from its own point of view.
            if _rel_rank(sq, by) < _rel_rank(square, by):
                return True
    return False


def _pawn_structure(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    enemy = COLOR[not color]
    out: list[Fact] = []
    pawns = board.pieces(chess.PAWN, color)
    files = [chess.square_file(sq) for sq in pawns]
    for file in sorted(set(files)):
        if files.count(file) >= 2:
            out.append(Fact(f"doubled:{side}:{file}", 1, f"{side} has doubled pawns on the {chess.FILE_NAMES[file]}-file"))
    for sq in pawns:
        name = chess.square_name(sq)
        file = chess.square_file(sq)
        neighbours = [f for f in (file - 1, file + 1) if 0 <= f <= 7]
        own_adjacent = [p for f in neighbours for p in _pawns_on_file(board, color, f)]
        if _is_passed(board, sq, color):
            advanced = _rel_rank(sq, color) >= 5
            out.append(Fact(f"passed:{side}:{name}", 3 if advanced else 2,
                            f"{side} has a {'far-advanced ' if advanced else ''}passed pawn on {name}"))
        if not own_adjacent:
            half_open = not _pawns_on_file(board, not color, file)
            out.append(Fact(f"isolated:{side}:{name}", 2,
                            f"{side} pawn on {name} is isolated" + (" on a half-open file" if half_open else "")))
            continue
        stop = sq + 8 * _forward(color)
        if not 0 <= stop <= 63:
            continue
        supporters = [p for p in own_adjacent if not _ahead(sq, color, p)]
        stop_hit = bool(board.attackers(not color, stop) & board.pieces(chess.PAWN, not color))
        if not supporters and stop_hit:
            half_open = not _pawns_on_file(board, not color, file)
            out.append(Fact(f"backward:{side}:{name}", 3 if half_open else 2,
                            f"{side} pawn on {name} is backward" +
                            (f" on a half-open file that {enemy}'s pieces can attack" if half_open else "")))
    return out


def _outposts(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    enemy = COLOR[not color]
    out: list[Fact] = []
    for piece_type in (chess.KNIGHT, chess.BISHOP):
        for sq in board.pieces(piece_type, color):
            if not 3 <= _rel_rank(sq, color) <= 5:
                continue
            supported = bool(board.attackers(color, sq) & board.pieces(chess.PAWN, color))
            if supported and not _can_be_hit_by_pawn(board, sq, not color):
                name = chess.square_name(sq)
                out.append(Fact(f"outpost:{side}:{name}", 3,
                                f"{side} {NAMES[piece_type]} on {name} sits on an outpost: no {enemy} pawn can drive it away"))
    return out


def _bishops(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    out: list[Fact] = []
    bishops = board.pieces(chess.BISHOP, color)
    light = [b for b in bishops if chess.BB_SQUARES[b] & chess.BB_LIGHT_SQUARES]
    dark = [b for b in bishops if chess.BB_SQUARES[b] & chess.BB_DARK_SQUARES]
    if light and dark and not (len(board.pieces(chess.BISHOP, not color)) >= 2):
        out.append(Fact(f"bishop_pair:{side}", 1, f"{side} has the bishop pair"))
    pawns = board.pieces(chess.PAWN, color)
    for sq in bishops:
        on_light = bool(chess.BB_SQUARES[sq] & chess.BB_LIGHT_SQUARES)
        mask = chess.BB_LIGHT_SQUARES if on_light else chess.BB_DARK_SQUARES
        same = [p for p in pawns if chess.BB_SQUARES[p] & mask]
        # Pawns that are fixed (blocked by any piece in front) can't get out of the bishop's way.
        fixed = [p for p in same if board.piece_at(p + 8 * _forward(color)) is not None]
        mobility = len(board.attacks(sq) & ~board.occupied_co[color])
        if len(fixed) >= 2 and mobility <= 4:
            names = ", ".join(chess.square_name(p) for p in sorted(fixed))
            kind = "light" if on_light else "dark"
            out.append(Fact(f"bad_bishop:{side}:{kind}", 2,
                            f"{side}'s {kind}-squared bishop is hemmed in by its own pawns on {names}"))
    return out


def _rooks(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    out: list[Fact] = []
    for sq in board.pieces(chess.ROOK, color):
        file = chess.square_file(sq)
        letter = chess.FILE_NAMES[file]
        if _pawns_on_file(board, color, file):
            continue
        if not _pawns_on_file(board, not color, file):
            out.append(Fact(f"rook_open:{side}:{letter}", 2, f"{side} rook on {chess.square_name(sq)} controls the open {letter}-file"))
        else:
            out.append(Fact(f"rook_half:{side}:{letter}", 1, f"{side} rook on {chess.square_name(sq)} is on the half-open {letter}-file"))
        if _rel_rank(sq, color) == 6:
            out.append(Fact(f"rook_7th:{side}", 2, f"{side} has a rook on the 7th rank"))
    return out


def _king_safety(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    enemy = COLOR[not color]
    king = board.king(color)
    if king is None:
        return []
    out: list[Fact] = []
    queens_on = bool(board.pieces(chess.QUEEN, not color))
    file = chess.square_file(king)
    if file in (3, 4) and not board.has_castling_rights(color) and queens_on and board.fullmove_number >= 8:
        out.append(Fact(f"king_centre:{side}", 2, f"{side}'s king is stuck in the centre and can no longer castle"))
    if _rel_rank(king, color) <= 1 and file not in (3, 4):
        for f in (file - 1, file, file + 1):
            if not 0 <= f <= 7:
                continue
            letter = chess.FILE_NAMES[f]
            shield = [p for p in _pawns_on_file(board, color, f) if 1 <= _rel_rank(p, color) - _rel_rank(king, color) <= 2]
            if not shield:
                if not _pawns_on_file(board, color, f) and queens_on:
                    out.append(Fact(f"king_file:{side}:{letter}", 3, f"the {letter}-file next to {side}'s king is open"))
                else:
                    out.append(Fact(f"king_shield:{side}:{letter}", 2,
                                    f"{side}'s king has lost its pawn cover on the {letter}-file"))
    zone = chess.SquareSet(board.attacks(king)) | chess.SquareSet(chess.BB_SQUARES[king])
    attackers = set()
    for sq in zone:
        for a in board.attackers(not color, sq):
            piece = board.piece_at(a)
            if piece and piece.piece_type not in (chess.PAWN, chess.KING):
                attackers.add(a)
    if len(attackers) >= 3 and queens_on:
        out.append(Fact(f"king_attack:{side}", 3, f"{len(attackers)} {enemy} pieces are aimed at the squares around {side}'s king"))
    return out


def _loose_pieces(board: chess.Board, color: chess.Color) -> list[Fact]:
    side = COLOR[color]
    out: list[Fact] = []
    for piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        for sq in board.pieces(piece_type, color):
            if board.is_attacked_by(not color, sq) and not board.is_attacked_by(color, sq):
                name = chess.square_name(sq)
                out.append(Fact(f"loose:{side}:{name}", 3, f"{side} {NAMES[piece_type]} on {name} is attacked and undefended"))
    return out


def _development(board: chess.Board, color: chess.Color) -> list[Fact]:
    if board.fullmove_number > 15:
        return []
    side = COLOR[color]
    home = chess.BB_RANK_1 if color == chess.WHITE else chess.BB_RANK_8
    minors = (board.pieces(chess.KNIGHT, color) | board.pieces(chess.BISHOP, color)) & chess.SquareSet(home)
    if len(minors) >= 2:
        return [Fact(f"undeveloped:{side}", 1, f"{side} still has {len(minors)} minor pieces on the back rank")]
    return []


def _mobility(board: chess.Board, color: chess.Color) -> int:
    total = 0
    for piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        for sq in board.pieces(piece_type, color):
            total += len(board.attacks(sq) & ~board.occupied_co[color])
    return total


def _activity(board: chess.Board) -> list[Fact]:
    w, b = _mobility(board, chess.WHITE), _mobility(board, chess.BLACK)
    if min(w, b) == 0:
        return []
    if w >= 1.35 * b and w - b >= 8:
        return [Fact("active:White", 2, f"White's pieces are much more active ({w} squares reached against {b})")]
    if b >= 1.35 * w and b - w >= 8:
        return [Fact("active:Black", 2, f"Black's pieces are much more active ({b} squares reached against {w})")]
    return []


def features(board: chess.Board) -> dict[str, Fact]:
    facts: list[Fact] = []
    for color in (chess.WHITE, chess.BLACK):
        facts += _pawn_structure(board, color)
        facts += _outposts(board, color)
        facts += _bishops(board, color)
        facts += _rooks(board, color)
        facts += _king_safety(board, color)
        facts += _loose_pieces(board, color)
        facts += _development(board, color)
    facts += _activity(board)
    return {f.key: f for f in facts}


def changes(before: dict[str, Fact], after: dict[str, Fact]) -> dict[str, Fact]:
    """Facts that appeared, and facts that went away (marked as such)."""
    out: dict[str, Fact] = {}
    for key, fact in after.items():
        if key not in before:
            out[key] = fact
    for key, fact in before.items():
        if key not in after:
            out[f"gone:{key}"] = Fact(f"gone:{key}", max(1, fact.weight - 1), f"no longer true: {fact.text}")
    return out


def ranked(facts: dict[str, Fact], limit: int) -> list[str]:
    ordered = sorted(facts.values(), key=lambda f: (-f.weight, f.key))
    return [f.text for f in ordered[:limit]]


def material_text(board: chess.Board) -> str:
    diff = 0
    for piece_type, value in VALUES.items():
        diff += value * (len(board.pieces(piece_type, chess.WHITE)) - len(board.pieces(piece_type, chess.BLACK)))
    if diff == 0:
        return "equal"
    leader = "White" if diff > 0 else "Black"
    n = abs(diff)
    return f"{leader} is up {n} pawn{'s' if n != 1 else ''}' worth of material" if n != 1 else f"{leader} is up a pawn"
