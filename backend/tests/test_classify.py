"""Move labels, accuracy and the review builder, with hand-made engine evals (no Stockfish)."""

from __future__ import annotations

import chess
import pytest

from app.pgn_tools import first_game
from app.review.classify import (
    build_review, classify_drop, game_accuracy, mate_judgment, move_accuracy, raw_cp_for,
)

from .conftest import BACK_RANK, ONE_LEGAL_MOVE, SCHOLARS_MATE


def cp(value: int) -> dict:
    return {"cp": value, "mate": None}


def mate(n: int) -> dict:
    return {"cp": None, "mate": n}


WHITE_MATED_BLACK = {"cp": None, "mate": 0, "winner": "white"}


@pytest.mark.parametrize("drop, label", [
    (0, "excellent"), (1.99, "excellent"),
    (2, "good"), (4.99, "good"),
    (5, "inaccuracy"), (9.99, "inaccuracy"),
    (10, "mistake"), (14.99, "mistake"),
    (15, "blunder"), (60, "blunder"),
])
def test_label_cut_offs_match_lichess(drop, label):
    assert classify_drop(drop) == label


class TestMoveAccuracy:
    def test_no_loss_is_perfect(self):
        assert move_accuracy(0) == 100
        assert move_accuracy(-3) == 100

    def test_lichess_curve(self):
        assert move_accuracy(10) == pytest.approx(64.6, abs=0.1)

    def test_falls_as_the_loss_grows_and_stays_in_range(self):
        values = [move_accuracy(d) for d in range(0, 101, 5)]
        assert values == sorted(values, reverse=True)
        assert all(0 <= v <= 100 for v in values)


class TestGameAccuracy:
    def test_no_moves(self):
        assert game_accuracy([50.0], [], [], chess.WHITE) is None

    def test_side_without_moves(self):
        assert game_accuracy([50.0, 50.0], [0.0], [chess.WHITE], chess.BLACK) is None

    def test_perfect_play(self):
        wins = [50.0] * 11
        movers = [chess.WHITE, chess.BLACK] * 5
        assert game_accuracy(wins, [0.0] * 10, movers, chess.WHITE) == 100.0

    def test_a_blunder_costs_accuracy(self):
        wins = [50, 52, 50, 51, 50, 20, 22, 20, 21, 20, 19]
        movers = [chess.WHITE, chess.BLACK] * 5
        drops = [0, 0, 0, 0, 30, 0, 0, 0, 0, 0]  # White's third move dropped 30 points
        white = game_accuracy(wins, drops, movers, chess.WHITE)
        black = game_accuracy(wins, drops, movers, chess.BLACK)
        assert black == 100.0
        assert 0 < white < 90


def test_raw_cp_for():
    assert raw_cp_for(WHITE_MATED_BLACK, chess.WHITE) == 100_000
    assert raw_cp_for(WHITE_MATED_BLACK, chess.BLACK) == -100_000
    assert raw_cp_for(mate(-2), chess.WHITE) == -100_000
    assert raw_cp_for(cp(50), chess.BLACK) == -50
    assert raw_cp_for(cp(5000), chess.WHITE) == 5000  # not capped


class TestMateJudgment:
    def test_allowing_mate_from_a_normal_position_is_a_blunder(self):
        assert mate_judgment(cp(0), mate(-3), chess.WHITE) == "blunder"

    def test_allowing_mate_when_already_lost(self):
        assert mate_judgment(cp(-800), mate(-3), chess.WHITE) == "mistake"
        assert mate_judgment(cp(-1200), mate(-3), chess.WHITE) == "inaccuracy"

    def test_missing_a_mate(self):
        assert mate_judgment(mate(3), cp(100), chess.WHITE) == "blunder"
        assert mate_judgment(mate(3), cp(800), chess.WHITE) == "mistake"
        assert mate_judgment(mate(3), cp(1200), chess.WHITE) == "inaccuracy"

    def test_black_missing_a_mate_but_still_winning(self):
        assert mate_judgment(mate(-2), cp(-1500), chess.BLACK) == "inaccuracy"

    def test_giving_mate_is_never_judged(self):
        assert mate_judgment(mate(1), WHITE_MATED_BLACK, chess.WHITE) is None

    def test_no_mates_involved(self):
        assert mate_judgment(cp(30), cp(-200), chess.WHITE) is None

    def test_keeping_a_mate_is_fine(self):
        assert mate_judgment(mate(3), mate(2), chess.WHITE) is None


def position(fen: str, e: dict, lines: list[tuple[dict, list[str]]]) -> dict:
    return {"fen": fen, "eval": e, "depth": 20, "lines": [{"eval": le, "uci": u} for le, u in lines]}


def scholars_positions() -> list[dict]:
    game, _ = first_game(SCHOLARS_MATE)
    board = game.board()
    fens = [board.fen()]
    for move in game.mainline_moves():
        board.push(move)
        fens.append(board.fen())
    return [
        position(fens[0], cp(30), [(cp(30), ["e2e4", "e7e5"]), (cp(25), ["d2d4"])]),
        position(fens[1], cp(30), [(cp(30), ["e7e5", "g1f3"]), (cp(40), ["c7c5"])]),
        position(fens[2], cp(30), [(cp(30), ["g1f3", "b8c6"]), (cp(25), ["f1c4"])]),
        position(fens[3], cp(20), [(cp(20), ["g8f6", "d2d3"]), (cp(25), ["b8c6"])]),
        position(fens[4], cp(30), [(cp(30), ["g1f3", "g8f6"]), (cp(20), ["d2d3"])]),
        position(fens[5], cp(0), [(cp(0), ["g7g6", "h5f3", "g8f6"]), (cp(10), ["d8e7"])]),
        position(fens[6], mate(1), [(mate(1), ["h5f7"])]),
        position(fens[7], WHITE_MATED_BLACK, []),
    ]


@pytest.fixture
def scholars_review() -> dict:
    game, _ = first_game(SCHOLARS_MATE)
    return build_review(game, scholars_positions(), profile="quick", depth=14, engine_name="Stockfish 19")


class TestBuildReview:
    def test_labels(self, scholars_review):
        labels = [(m["san"], m["classification"]) for m in scholars_review["moves"]]
        assert labels == [
            ("e4", "best"), ("e5", "best"), ("Bc4", "excellent"), ("Nc6", "excellent"),
            ("Qh5", "good"), ("Nf6", "blunder"), ("Qxf7#", "best"),
        ]

    def test_the_blunder_explains_the_mate(self, scholars_review):
        nf6 = scholars_review["moves"][5]
        assert nf6["color"] == "black"
        assert nf6["move_number"] == 3
        assert nf6["tags"] == ["allows_mate"]
        assert nf6["motifs"] == ["allows_mate"]
        assert nf6["explanation"] == "This allows mate in 1: 4.Qxf7#. Best was g6."
        assert nf6["best"] == {"uci": "g7g6", "san": "g6"}
        assert nf6["best_line_san"] == ["g6", "Qf3", "Nf6"]
        assert nf6["reply_line_san"] == ["Qxf7#"]
        assert nf6["drop"] == pytest.approx(47.5, abs=0.1)
        assert nf6["win_before"] == 50.0
        assert nf6["eval_after_text"] == "#1"

    def test_moves_carry_positions_and_evals(self, scholars_review):
        first = scholars_review["moves"][0]
        assert first["uci"] == "e2e4"
        assert first["fen_before"] == scholars_review["root_fen"]
        assert first["fen_after"] == scholars_review["moves"][1]["fen_before"]
        assert first["accuracy"] == 100.0
        assert first["drop"] == 0.0

    def test_mate_ends_the_game(self, scholars_review):
        last = scholars_review["moves"][-1]
        assert last["eval_after"] == WHITE_MATED_BLACK
        assert last["eval_after_text"] == "1-0"
        assert scholars_review["positions"][-1]["win"] == 100.0
        assert scholars_review["positions"][-1]["eval_text"] == "1-0"

    def test_summary(self, scholars_review):
        white = scholars_review["summary"]["white"]
        black = scholars_review["summary"]["black"]
        assert white["moves"] == 4 and black["moves"] == 3
        assert white["counts"]["best"] == 2 and white["counts"]["excellent"] == 1 and white["counts"]["good"] == 1
        assert black["counts"]["blunder"] == 1 and black["counts"]["best"] == 1
        assert white["acpl"] == 10   # Bc4 cost 10, Qh5 cost 30, best moves cost nothing
        assert black["acpl"] == 337  # Nc6 cost 10, Nf6 cost 1000 (mate counts as the cap)
        assert white["accuracy"] > 90 > black["accuracy"]

    def test_headers_and_settings(self, scholars_review):
        assert scholars_review["headers"]["White"] == "You"
        assert {k: v for k, v in scholars_review["settings"].items() if k != "thresholds"} == {"profile": "quick", "depth": 14, "engine": "Stockfish 19"}
        assert scholars_review["settings"]["thresholds"] == {"inaccuracy": 5.0, "mistake": 10.0, "blunder": 15.0}
        assert len(scholars_review["positions"]) == 8


def single_move_review(fen: str, move: str, before: dict, after: dict) -> dict:
    game, _ = first_game(f'[SetUp "1"]\n[FEN "{fen}"]\n\n1. {move} *')
    board = game.board()
    fen_before = board.fen()
    board.push(next(iter(game.mainline_moves())))
    positions = [{**before, "fen": fen_before}, {**after, "fen": board.fen()}]
    return build_review(game, positions, profile="quick", depth=14, engine_name=None)["moves"][0]


def test_only_legal_move_is_forced():
    m = single_move_review(
        ONE_LEGAL_MOVE, "Kxb2",
        position("", cp(0), [(cp(0), ["a1b2"])]),
        position("", {"cp": 0, "mate": None, "draw": True}, []),
    )
    assert m["classification"] == "forced"
    assert m["explanation"] == "The only legal move."
    assert m["drop"] == 0


def test_only_move_tag_when_everything_else_loses():
    start = chess.STARTING_FEN
    m = single_move_review(
        start, "e4",
        position("", cp(0), [(cp(0), ["e2e4"]), (cp(-600), ["d2d4"])]),
        position("", cp(0), [(cp(0), ["e7e5"])]),
    )
    assert m["classification"] == "best"
    assert m["tags"] == ["only_move"]
    assert m["explanation"].startswith("Only move!")


def test_letting_a_big_advantage_slip():
    m = single_move_review(
        chess.STARTING_FEN, "e4",
        position("", cp(500), [(cp(500), ["d2d4"])]),
        position("", cp(50), [(cp(50), ["e7e5"])]),
    )
    assert m["classification"] == "blunder"
    assert "missed_win" in m["tags"]
    assert m["explanation"] == (
        "You were clearly better, but this lets most of the advantage slip. "
        "Your winning chances drop from 86% to 55%. The strongest answer is e5. Best was d4."
    )


def test_missing_mate_in_one_while_still_winning():
    m = single_move_review(
        BACK_RANK, "h3",
        position("", mate(1), [(mate(1), ["d1d8"])]),
        position("", cp(1200), [(cp(1200), ["g8f8"])]),
    )
    # The win% barely changes (both are "completely winning"), but missing mate is still marked.
    assert m["classification"] == "inaccuracy"
    assert "missed_mate" in m["tags"]
    assert m["explanation"] == "You had a forced mate in 1: 1.Rd8#."


def test_giving_mate_with_a_non_engine_move_is_not_a_missed_mate():
    # Engine prefers another mate; the played move mates too.
    m = single_move_review(
        BACK_RANK, "Rd8#",
        position("", mate(1), [(mate(1), ["d1d7"])]),
        position("", WHITE_MATED_BLACK, []),
    )
    assert "missed_mate" not in m["tags"]
    assert m["classification"] == "excellent"
