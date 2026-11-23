"""Plain-language hints, checked on small real positions."""

from __future__ import annotations

import chess
import pytest

from app.review.motifs import (
    describe_targets, explain, fork_targets, line_text, material_balance, material_swing, pawns_worth,
    play_until_quiet,
)

M = chess.Move.from_uci


def moves(*ucis: str) -> list[chess.Move]:
    return [M(u) for u in ucis]


def cp(v: int) -> dict:
    return {"cp": v, "mate": None}


def hint(fen, played, best, reply, classification="blunder", tags=(), e_before=None, e_after=None,
         win_before=50.0, win_after=20.0):
    return explain(chess.Board(fen), M(played), moves(*best), moves(*reply), e_before or cp(0),
                   e_after or cp(-400), classification, list(tags), win_before, win_after)


class TestMaterial:
    def test_even_at_the_start(self):
        assert material_balance(chess.Board(), chess.WHITE) == 0

    def test_counts_from_each_side(self):
        no_black_queen = chess.Board("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
        assert material_balance(no_black_queen, chess.WHITE) == 9
        assert material_balance(no_black_queen, chess.BLACK) == -9

    def test_play_until_quiet_stops_when_the_captures_end(self):
        end = play_until_quiet(chess.Board(), moves("e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5"))
        assert end.move_stack[-1] == M("d8d5")
        assert len(end.move_stack) == 4

    def test_play_until_quiet_stops_at_an_illegal_move(self):
        end = play_until_quiet(chess.Board(), moves("e2e4", "e2e4"))
        assert len(end.move_stack) == 1

    def test_play_until_quiet_follows_a_check_to_the_capture(self):
        # ...Nc2+ forks king and rook; after the king moves, Nxa1.
        board = chess.Board("4k3/8/8/8/3n4/8/7P/R3K3 w - - 0 1")
        end = play_until_quiet(board, moves("h2h3", "d4c2", "e1d2", "c2a1", "d2c1"))
        assert end.move_stack[-1] == M("c2a1")

    def test_play_until_quiet_follows_a_double_attack(self):
        # ...Nc2 hits queen and rook (no check); the queen leaves, the rook falls.
        board = chess.Board("6k1/8/8/8/3n4/8/7P/Q3R2K w - - 0 1")
        end = play_until_quiet(board, moves("h2h3", "d4c2", "a1a4", "c2e1", "a4e4"))
        assert end.move_stack[-1] == M("c2e1")

    def test_material_swing(self):
        # 2.Bxf7+ Kxf7: White gives a bishop for a pawn.
        board = chess.Board("rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3")
        assert material_swing(board, moves("c4f7", "e8f7", "g1f3"), chess.WHITE) == -2


class TestForks:
    def test_knight_forks_king_and_rook(self):
        board = chess.Board("r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1")
        targets = fork_targets(board, chess.C7)
        assert sorted(targets) == sorted([(chess.KING, chess.E8), (chess.ROOK, chess.A8)])
        assert describe_targets(targets) == "king on e8 and rook on a8"

    def test_defended_pawns_are_not_a_fork(self):
        board = chess.Board("4k3/2p1p3/3p4/3N4/8/8/8/4K3 b - - 0 1")
        assert fork_targets(board, chess.D5) == []

    def test_one_target_is_not_a_fork(self):
        board = chess.Board("r3k3/8/1N6/8/8/8/8/4K3 b - - 0 1")
        assert fork_targets(board, chess.B6) == []

    def test_empty_square(self):
        assert fork_targets(chess.Board(), chess.E4) == []

    def test_three_targets_are_listed_king_first_then_by_value(self):
        targets = [(chess.ROOK, chess.A8), (chess.QUEEN, chess.D8), (chess.KING, chess.E8)]
        assert describe_targets(targets) == "king on e8, queen on d8 and rook on a8"


class TestLineText:
    def test_numbers_white_moves(self):
        assert line_text(chess.Board(), moves("e2e4", "e7e5", "g1f3")) == "1.e4 e5 2.Nf3"

    def test_starting_with_black(self):
        board = chess.Board()
        board.push_san("e4")
        assert line_text(board, moves("e7e5", "g1f3")) == "1...e5 2.Nf3"

    def test_stops_at_illegal_moves_and_at_the_limit(self):
        assert line_text(chess.Board(), moves("e2e4", "e2e4")) == "1.e4"
        assert line_text(chess.Board(), moves("e2e4", "e7e5", "g1f3", "b8c6"), max_plies=2) == "1.e4 e5"


@pytest.mark.parametrize("n, text", [
    (1, "a pawn"), (2, "about two pawns' worth of material"), (3, "about a piece's worth of material"),
    (5, "about a rook's worth of material"), (9, "about a queen's worth of material"),
])
def test_pawns_worth(n, text):
    assert pawns_worth(n) == text


class TestExplain:
    def test_forced(self):
        assert hint(chess.STARTING_FEN, "e2e4", [], [], "forced") == ("The only legal move.", [])

    def test_best(self):
        assert hint(chess.STARTING_FEN, "e2e4", ["e2e4"], [], "best") == ("Best move.", [])

    def test_only_move(self):
        text, motifs = hint(chess.STARTING_FEN, "e2e4", ["e2e4"], [], "best", tags=["only_move"])
        assert text.startswith("Only move!")
        assert motifs == ["only_move"]

    def test_excellent_and_good_name_the_engine_choice(self):
        assert hint(chess.STARTING_FEN, "e2e4", ["d2d4"], [], "excellent")[0] == \
            "Excellent move. The engine slightly prefers d4."
        assert hint(chess.STARTING_FEN, "e2e4", [], [], "good")[0] == "Good move."

    def test_allows_mate(self):
        text, motifs = hint(
            "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3", "g8f6", ["g7g6", "h5f3"],
            ["h5f7"], e_after={"cp": None, "mate": 1},
        )
        assert text == "This allows mate in 1: 4.Qxf7#. Best was g6."
        assert motifs == ["allows_mate"]

    def test_missed_mate(self):
        text, motifs = hint(
            "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "h2h3", ["d1d8"], ["g8f8"], "inaccuracy",
            e_before={"cp": None, "mate": 1}, e_after=cp(1200),
        )
        assert text == "You had a forced mate in 1: 1.Rd8#."
        assert motifs == ["missed_mate"]

    def test_undefended_piece(self):
        # 1.e4 d5 2.Bc4?? dxc4
        text, motifs = hint("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2",
                            "f1c4", ["e4d5"], ["d5c4"])
        assert text == "This leaves your bishop on c4 undefended, and dxc4 wins it. Best was exd5."
        assert motifs == ["hanging_piece"]

    def test_defended_piece_taken_by_a_pawn(self):
        text, motifs = hint("4k3/8/8/2p5/8/2P5/4N3/4K3 w - - 0 1", "e2d4", ["e1d2"], ["c5d4", "c3d4"], "mistake")
        assert text == "Your knight on d4 can be taken by a pawn (cxd4). Best was Kd2."
        assert motifs == ["hanging_piece"]

    def test_allows_a_fork_with_check(self):
        text, motifs = hint("4k3/8/8/8/3n4/8/7P/R3K3 w - - 0 1", "h2h3", ["a1a4"], ["d4c2", "e1d2", "c2a1"])
        assert text == "This allows a fork: Nc2+ attacks your king on e1 and rook on a1. Best was Ra4."
        assert motifs == ["allows_fork"]

    def test_allows_a_fork_without_check(self):
        text, motifs = hint("6k1/8/8/8/3n4/8/7P/Q3R2K w - - 0 1", "h2h3", ["e1e4"], ["d4c2", "a1a4", "c2e1"])
        assert text == "This allows a fork: Nc2 attacks your queen on a1 and rook on e1. Best was Re4."
        assert motifs == ["allows_fork"]

    def test_loses_material_to_a_skewer(self):
        # 1.h3?? Ra2+ and the queen behind the king falls.
        text, motifs = hint("7k/8/8/8/8/8/3K2QP/r7 w - - 0 1", "h2h3", ["d2c3"], ["a1a2", "d2e3", "a2g2"])
        assert text == "This loses about a queen's worth of material after 1...Ra2+ 2.Ke3 Rxg2. Best was Kc3."
        assert motifs == ["loses_material"]

    def test_missed_fork(self):
        text, motifs = hint("r3k3/8/8/1N6/8/8/7P/4K3 w - - 0 1", "h2h3", ["b5c7", "e8d7", "c7a8"], ["a8a5"],
                            e_before=cp(500), e_after=cp(0))
        assert text == "You missed a fork: Nc7+ attacks the king on e8 and rook on a8."
        assert motifs == ["missed_fork"]

    def test_missed_free_piece(self):
        text, motifs = hint("4k3/8/8/8/3n4/8/7P/3QK3 w - - 0 1", "h2h3", ["d1d4"], ["d4f5"], "mistake")
        assert text == "You missed Qxd4, which wins the knight on d4."
        assert motifs == ["missed_material"]

    def test_no_tactic_found_falls_back_to_winning_chances(self):
        text, motifs = hint(chess.STARTING_FEN, "g2g4", ["e2e4"], ["d7d5"], "inaccuracy",
                            win_before=52.0, win_after=45.0)
        assert text == "Your winning chances drop from 52% to 45%. The strongest answer is d5. Best was e4."
        assert motifs == []
