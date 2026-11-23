from __future__ import annotations

import chess
import chess.engine
import pytest

from app.evals import (
    CP_CAP, cp_for, format_eval, mate_for, score_to_eval, terminal_eval, white_cp, win_percent,
    win_percent_white,
)

from .conftest import FOOLS_MATE


def pov(score: chess.engine.Score, turn: chess.Color = chess.WHITE) -> chess.engine.PovScore:
    return chess.engine.PovScore(score, turn)


class TestScoreToEval:
    def test_centipawns(self):
        assert score_to_eval(pov(chess.engine.Cp(34))) == {"cp": 34, "mate": None}

    def test_black_point_of_view_is_turned_to_white(self):
        assert score_to_eval(pov(chess.engine.Cp(50), chess.BLACK)) == {"cp": -50, "mate": None}

    def test_mate(self):
        assert score_to_eval(pov(chess.engine.Mate(3), chess.BLACK)) == {"cp": None, "mate": -3}


class TestTerminalEval:
    def test_checkmate_names_the_winner(self):
        assert terminal_eval(chess.Board(FOOLS_MATE)) == {"cp": None, "mate": 0, "winner": "black"}

    def test_stalemate_is_a_draw(self):
        assert terminal_eval(chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")) == {"cp": 0, "mate": None, "draw": True}

    def test_bare_kings_are_a_draw(self):
        assert terminal_eval(chess.Board("8/8/8/4k3/8/8/8/4K3 w - - 0 1"))["draw"] is True

    def test_game_still_going(self):
        assert terminal_eval(chess.Board()) is None


@pytest.mark.parametrize("e, expected", [
    ({"cp": 34, "mate": None}, 34),
    ({"cp": 1500, "mate": None}, CP_CAP),
    ({"cp": -2000, "mate": None}, -CP_CAP),
    ({"cp": None, "mate": 2}, CP_CAP),
    ({"cp": None, "mate": -1}, -CP_CAP),
    ({"cp": None, "mate": 0, "winner": "white"}, CP_CAP),
    ({"cp": None, "mate": 0, "winner": "black"}, -CP_CAP),
    ({"cp": None, "mate": None}, 0),
])
def test_white_cp_caps_and_mates(e, expected):
    assert white_cp(e) == expected


def test_cp_for_turns_the_sign_for_black():
    e = {"cp": 120, "mate": None}
    assert cp_for(e, chess.WHITE) == 120
    assert cp_for(e, chess.BLACK) == -120


class TestWinPercent:
    def test_level_position_is_fifty_percent(self):
        assert win_percent_white({"cp": 0, "mate": None}) == pytest.approx(50)

    def test_one_pawn_matches_lichess(self):
        # lichess shows about 59% for +1.00
        assert win_percent_white({"cp": 100, "mate": None}) == pytest.approx(59.1, abs=0.1)

    def test_symmetric(self):
        up = win_percent_white({"cp": 300, "mate": None})
        down = win_percent_white({"cp": -300, "mate": None})
        assert up + down == pytest.approx(100)

    def test_grows_with_the_eval(self):
        values = [win_percent_white({"cp": cp, "mate": None}) for cp in range(-1000, 1001, 100)]
        assert values == sorted(values)
        assert all(0 < v < 100 for v in values)

    def test_forced_mate_counts_as_the_cap(self):
        assert win_percent_white({"cp": None, "mate": 4}) == pytest.approx(win_percent_white({"cp": 1000, "mate": None}))

    def test_finished_games(self):
        assert win_percent_white({"cp": None, "mate": 0, "winner": "white"}) == 100
        assert win_percent_white({"cp": None, "mate": 0, "winner": "black"}) == 0

    def test_black_gets_the_rest(self):
        e = {"cp": 250, "mate": None}
        assert win_percent(e, chess.BLACK) == pytest.approx(100 - win_percent(e, chess.WHITE))


@pytest.mark.parametrize("e, white, black", [
    ({"cp": None, "mate": 3}, 3, None),
    ({"cp": None, "mate": -2}, None, 2),
    ({"cp": 500, "mate": None}, None, None),
    ({"cp": None, "mate": 0, "winner": "white"}, None, None),
])
def test_mate_for(e, white, black):
    assert mate_for(e, chess.WHITE) == white
    assert mate_for(e, chess.BLACK) == black


@pytest.mark.parametrize("e, text", [
    ({"cp": 34, "mate": None}, "+0.34"),
    ({"cp": -150, "mate": None}, "-1.50"),
    ({"cp": 0, "mate": None}, "0.00"),
    ({"cp": None, "mate": 2}, "#2"),
    ({"cp": None, "mate": -3}, "#-3"),
    ({"cp": None, "mate": 0, "winner": "white"}, "1-0"),
    ({"cp": None, "mate": 0, "winner": "black"}, "0-1"),
    ({"cp": 0, "mate": None, "draw": True}, "½-½"),
])
def test_format_eval(e, text):
    assert format_eval(e) == text
