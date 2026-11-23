from __future__ import annotations

import pytest

from app.pgn_tools import PgnError, first_game, game_to_tree, mainline_count, parse_for_board, read_games

ANNOTATED = (
    '[Event "Club"]\n[White "Ann"]\n[Black "Ben"]\n[Result "1-0"]\n\n'
    "{Before the game} 1. e4 {King's pawn} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 1-0\n"
)


def test_reads_several_games():
    text = ANNOTATED + "\n" + '[White "C"]\n[Black "D"]\n\n1. d4 d5 *\n'
    games = read_games(text)
    assert [g.headers["White"] for g in games] == ["Ann", "C"]


def test_read_games_respects_the_limit():
    text = "\n".join("1. e4 e5 *\n" for _ in range(5))
    assert len(read_games(text, max_games=3)) == 3


@pytest.mark.parametrize("text", ["", "   \n  "])
def test_no_game(text):
    with pytest.raises(PgnError, match="No game found"):
        first_game(text)


def test_illegal_move_is_reported():
    with pytest.raises(PgnError, match="problem"):
        first_game("1. e4 e5 2. Ke3 *")


def test_first_game_counts_the_games():
    game, count = first_game(ANNOTATED + "\n" + ANNOTATED)
    assert count == 2
    assert game.headers["White"] == "Ann"


def test_tree_keeps_variations_comments_and_nags():
    game, _ = first_game(ANNOTATED)
    root = game_to_tree(game)
    assert root["fen"].startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w")
    assert root["comment"] == "Before the game"

    e4 = root["children"][0]
    assert (e4["san"], e4["uci"], e4["comment"]) == ("e4", "e2e4", "King's pawn")
    assert [c["san"] for c in e4["children"]] == ["e5", "c5"]  # main line first

    side_line = e4["children"][1]
    assert [c["san"] for c in side_line["children"]] == ["Nf3"]

    nf3 = e4["children"][0]["children"][0]
    assert nf3["san"] == "Nf3"
    assert nf3["nags"] == [1]
    assert nf3["children"][0]["san"] == "Nc6"
    assert nf3["children"][0]["fen"] == "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"


def test_tree_starts_from_a_set_up_position():
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    game, _ = first_game(f'[SetUp "1"]\n[FEN "{fen}"]\n\n1. e4 Kd7 *')
    root = game_to_tree(game)
    assert root["fen"] == fen
    assert root["children"][0]["san"] == "e4"


def test_long_games_do_not_hit_the_recursion_limit():
    # 600 plies of knights going back and forth.
    moves = " ".join(f"{i * 2 + 1}. Nf3 Nf6 {i * 2 + 2}. Ng1 Ng8" for i in range(150))
    game, _ = first_game(moves + " *")
    node = game_to_tree(game)
    depth = 0
    while node["children"]:
        node = node["children"][0]
        depth += 1
    assert depth == 600


def test_parse_for_board():
    data = parse_for_board(ANNOTATED)
    assert data["headers"]["White"] == "Ann"
    assert data["game_count"] == 1
    assert data["tree"]["children"][0]["san"] == "e4"


def test_mainline_count_ignores_side_lines():
    game, _ = first_game(ANNOTATED)
    assert mainline_count(game) == 4
