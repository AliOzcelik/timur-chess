"""Plain-language hints for mistakes.

Every hint is built from facts the engine already confirmed (its best line and
its best reply), plus simple board checks with python-chess. Nothing is guessed:
if no clear reason is found, the hint just says what was better.
"""

from __future__ import annotations

import chess

from ..evals import Eval, mate_for

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook",
         chess.QUEEN: "queen", chess.KING: "king"}


def material_balance(board: chess.Board, color: chess.Color) -> int:
    total = 0
    for piece_type, value in VALUES.items():
        total += value * (len(board.pieces(piece_type, color)) - len(board.pieces(piece_type, not color)))
    return total


def _wins_material(board: chess.Board, move: chess.Move | None) -> bool:
    return move is not None and board.is_legal(move) and (board.is_capture(move) or move.promotion is not None)


def play_until_quiet(board: chess.Board, moves: list[chess.Move], max_plies: int = 10) -> chess.Board:
    """Play a line on a copy until the material settles.

    The line goes on while the next move captures, after a check (the answer is forced),
    and when a quiet move is followed by a capture from the same side one move later
    (a fork or other double attack: the opponent saves one piece, the other is taken).
    """
    b = board.copy(stack=False)
    limit = min(len(moves), max_plies)
    for j in range(limit):
        move = moves[j]
        if not b.is_legal(move):
            break
        b.push(move)
        if j == 0:
            continue
        nxt = moves[j + 1] if j + 1 < limit else None
        if nxt is None or not b.is_legal(nxt):
            break
        if _wins_material(b, nxt) or b.is_check():
            continue
        after_next = moves[j + 2] if j + 2 < limit else None
        peek = b.copy(stack=False)
        peek.push(nxt)
        if not _wins_material(peek, after_next):
            break
    return b


def material_swing(board: chess.Board, moves: list[chess.Move], color: chess.Color) -> int:
    """Material change for `color` (in pawns) once the line's captures are over."""
    end = play_until_quiet(board, moves)
    return material_balance(end, color) - material_balance(board, color)


def fork_targets(board: chess.Board, square: chess.Square) -> list[tuple[chess.PieceType, chess.Square]]:
    """Valuable enemy pieces attacked by the piece on `square`, if it attacks two or more."""
    piece = board.piece_at(square)
    if piece is None:
        return []
    attacker_value = 100 if piece.piece_type == chess.KING else VALUES[piece.piece_type]
    targets: list[tuple[chess.PieceType, chess.Square]] = []
    for sq in board.attacks(square):
        target = board.piece_at(sq)
        if target is None or target.color == piece.color:
            continue
        if target.piece_type == chess.KING:
            targets.append((target.piece_type, sq))
            continue
        if VALUES[target.piece_type] < 3:
            continue
        defended = board.is_attacked_by(target.color, sq)
        if VALUES[target.piece_type] > attacker_value or not defended:
            targets.append((target.piece_type, sq))
    return targets if len(targets) >= 2 else []


def describe_targets(targets: list[tuple[chess.PieceType, chess.Square]]) -> str:
    ordered = sorted(targets, key=lambda t: (t[0] != chess.KING, -VALUES[t[0]]))
    names = [f"{NAMES[pt]} on {chess.square_name(sq)}" for pt, sq in ordered]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f" and {names[-1]}"


def line_text(board: chess.Board, moves: list[chess.Move], max_plies: int = 6) -> str:
    """SAN with move numbers, e.g. '16.Nxe5 dxe5 17.Qxd8+'."""
    b = board.copy(stack=False)
    parts: list[str] = []
    for i, move in enumerate(moves[:max_plies]):
        if not b.is_legal(move):
            break
        san = b.san(move)
        if b.turn == chess.WHITE:
            parts.append(f"{b.fullmove_number}.{san}")
        elif i == 0:
            parts.append(f"{b.fullmove_number}...{san}")
        else:
            parts.append(san)
        b.push(move)
    return " ".join(parts)


def pawns_worth(n: int) -> str:
    if n >= 9:
        return "about a queen's worth of material"
    if n >= 5:
        return "about a rook's worth of material"
    if n >= 3:
        return "about a piece's worth of material"
    if n == 2:
        return "about two pawns' worth of material"
    return "a pawn"


def explain(
    board_before: chess.Board,
    played: chess.Move,
    best_line: list[chess.Move],
    reply_line: list[chess.Move],
    e_before: Eval,
    e_after: Eval,
    classification: str,
    tags: list[str],
    win_before: float,
    win_after: float,
) -> tuple[str, list[str]]:
    """Return (hint text, motif tags) for one move."""
    mover = board_before.turn
    opponent = not mover
    board_after = board_before.copy(stack=False)
    board_after.push(played)

    best = best_line[0] if best_line and board_before.is_legal(best_line[0]) else None
    best_san = board_before.san(best) if best else None
    reply = reply_line[0] if reply_line and board_after.is_legal(reply_line[0]) else None
    reply_san = board_after.san(reply) if reply else None

    if classification == "forced":
        return "The only legal move.", []
    if classification == "best":
        if "only_move" in tags:
            return "Only move! Every other move loses a lot of ground.", ["only_move"]
        return "Best move.", []
    if classification in ("excellent", "good"):
        if best_san:
            return f"{'Excellent' if classification == 'excellent' else 'Good'} move. The engine slightly prefers {best_san}.", []
        return "Good move.", []

    sentences: list[str] = []
    motifs: list[str] = []

    # 1. Mates: missed ones and allowed ones.
    my_mate_before = mate_for(e_before, mover)
    their_mate_after = mate_for(e_after, opponent)
    if my_mate_before and not mate_for(e_after, mover) and best:
        sentences.append(f"You had a forced mate in {my_mate_before}: {line_text(board_before, best_line, min(2 * my_mate_before - 1, 9))}.")
        motifs.append("missed_mate")
    if their_mate_after and not mate_for(e_before, opponent):
        line = line_text(board_after, reply_line, min(2 * their_mate_after - 1, 9))
        sentences.append(f"This allows mate in {their_mate_after}: {line}." if line else f"This allows mate in {their_mate_after}.")
        motifs.append("allows_mate")

    # 2. Losing material: forks, undefended pieces, cheap captures.
    played_swing = material_swing(board_before, [played, *reply_line], mover)
    if not motifs and played_swing <= -2 and reply is not None:
        after_reply = board_after.copy(stack=False)
        after_reply.push(reply)
        targets = fork_targets(after_reply, reply.to_square)
        victim = board_after.piece_at(reply.to_square) if board_after.is_capture(reply) else None
        attacker = board_after.piece_at(reply.from_square)
        if targets:
            sentences.append(f"This allows a fork: {reply_san} attacks your {describe_targets(targets)}.")
            motifs.append("allows_fork")
        elif victim is not None and victim.color == mover and attacker is not None:
            square = chess.square_name(reply.to_square)
            name = NAMES[victim.piece_type]
            if not board_after.is_attacked_by(mover, reply.to_square):
                sentences.append(f"This leaves your {name} on {square} undefended, and {reply_san} wins it.")
                motifs.append("hanging_piece")
            elif VALUES[attacker.piece_type] < VALUES[victim.piece_type]:
                sentences.append(f"Your {name} on {square} can be taken by a {NAMES[attacker.piece_type]} ({reply_san}).")
                motifs.append("hanging_piece")
            else:
                sentences.append(f"This loses {pawns_worth(-played_swing)}: {line_text(board_after, reply_line, 4)}.")
                motifs.append("loses_material")
        else:
            sentences.append(f"This loses {pawns_worth(-played_swing)} after {line_text(board_after, reply_line, 4)}.")
            motifs.append("loses_material")

    # 3. Missing a way to win material.
    if not motifs and best is not None and best != played:
        best_swing = material_swing(board_before, best_line, mover)
        if best_swing >= 2 and best_swing - played_swing >= 2:
            after_best = board_before.copy(stack=False)
            after_best.push(best)
            targets = fork_targets(after_best, best.to_square)
            victim = board_before.piece_at(best.to_square) if board_before.is_capture(best) else None
            if targets:
                sentences.append(f"You missed a fork: {best_san} attacks the {describe_targets(targets)}.")
                motifs.append("missed_fork")
            elif victim is not None and VALUES[victim.piece_type] >= 3:
                sentences.append(f"You missed {best_san}, which wins the {NAMES[victim.piece_type]} on {chess.square_name(best.to_square)}.")
                motifs.append("missed_material")
            else:
                sentences.append(f"You missed {best_san}, which wins {pawns_worth(best_swing)} ({line_text(board_before, best_line, 5)}).")
                motifs.append("missed_material")

    # 4. No concrete tactic: describe what changed.
    if not sentences:
        if "missed_win" in tags:
            sentences.append("You were clearly better, but this lets most of the advantage slip.")
        sentences.append(f"Your winning chances drop from {win_before:.0f}% to {win_after:.0f}%.")
        if reply_san:
            sentences.append(f"The strongest answer is {reply_san}.")

    if best_san and best != played and not any(best_san in s for s in sentences):
        sentences.append(f"Best was {best_san}.")
    return " ".join(sentences), motifs
