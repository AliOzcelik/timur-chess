"""PGN reading with python-chess (keeps variations, comments and NAGs)."""

from __future__ import annotations

import io
from typing import Any

import chess
import chess.pgn


class PgnError(ValueError):
    pass


def read_games(text: str, max_games: int = 100) -> list[chess.pgn.Game]:
    stream = io.StringIO(text)
    games: list[chess.pgn.Game] = []
    while len(games) < max_games:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        games.append(game)
    return games


def first_game(text: str) -> tuple[chess.pgn.Game, int]:
    """The first readable game and how many games the text holds. Raises PgnError."""
    games = read_games(text)
    if not games:
        raise PgnError("No game found. Paste a PGN that contains moves, e.g. 1. e4 e5 2. Nf3 ...")
    game = games[0]
    if game.errors:
        raise PgnError(f"The PGN has a problem: {game.errors[0]}")
    return game, len(games)


def game_to_tree(game: chess.pgn.Game) -> dict[str, Any]:
    """Nested move tree: each node has san, uci, fen, comment, nags and children."""
    board = game.board()
    root: dict[str, Any] = {"fen": board.fen(), "comment": game.comment or "", "children": []}
    # Iterative walk (long games would otherwise hit Python's recursion limit).
    stack: list[tuple[chess.pgn.GameNode, dict[str, Any], chess.Board]] = [(game, root, board)]
    while stack:
        node, out, node_board = stack.pop()
        for child in node.variations:
            move = child.move
            if move is None or not node_board.is_legal(move):
                continue
            san = node_board.san(move)
            child_board = node_board.copy(stack=False)
            child_board.push(move)
            child_out = {
                "san": san,
                "uci": move.uci(),
                "fen": child_board.fen(),
                "comment": child.comment or "",
                "nags": sorted(child.nags),
                "children": [],
            }
            out["children"].append(child_out)
            stack.append((child, child_out, child_board))
    return root


def parse_for_board(text: str) -> dict[str, Any]:
    game, count = first_game(text)
    return {
        "headers": dict(game.headers),
        "tree": game_to_tree(game),
        "game_count": count,
    }


def mainline_count(game: chess.pgn.Game) -> int:
    return sum(1 for _ in game.mainline_moves())
