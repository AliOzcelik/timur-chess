"""Board building and engine process handling that do not need Stockfish."""

from __future__ import annotations

import chess
import pytest

from app.config import EngineSettings
from app.engine import EngineService, EngineUnavailable, LiveAnalysis, build_board, pv_to_san, threat_board

from .conftest import Inbox


class TestBuildBoard:
    def test_start_position(self):
        assert build_board(None, None) == chess.Board()

    def test_moves_are_played_and_kept_as_history(self):
        board = build_board(None, ["e2e4", "e7e5"])
        assert board.fen() == "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
        assert len(board.move_stack) == 2  # lets the engine see repetitions

    def test_custom_start(self):
        fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
        assert build_board(fen, ["e2e4"]).fen() == "4k3/8/8/8/4P3/8/8/4K3 b - - 0 1"

    def test_invalid_fen(self):
        with pytest.raises(ValueError, match="Invalid FEN"):
            build_board("not a fen", [])

    @pytest.mark.parametrize("fen", [
        "KK6/8/8/8/8/8/8/7k w - - 0 1",   # two white kings
        "4k3/8/8/8/8/8/8/4R1K1 w - - 0 1",  # Black is in check but it is White's move
        "4k3/8/8/8/8/8/8/8 w - - 0 1",      # no white king
    ])
    def test_impossible_positions_are_refused(self, fen):
        with pytest.raises(ValueError, match="not legal"):
            build_board(fen, [])

    def test_illegal_move(self):
        with pytest.raises(ValueError, match="Illegal move 'e2e5'"):
            build_board(None, ["e2e5"])

    def test_unreadable_move(self):
        with pytest.raises(ValueError, match="Invalid move 'zz'"):
            build_board(None, ["zz"])


def test_pv_to_san_stops_at_an_illegal_move():
    pv = [chess.Move.from_uci(u) for u in ["e2e4", "e7e5", "e7e5", "g1f3"]]
    assert pv_to_san(chess.Board(), pv) == ["e4", "e5"]


def test_pv_to_san_limit():
    pv = [chess.Move.from_uci(u) for u in ["e2e4", "e7e5", "g1f3", "b8c6"]]
    assert pv_to_san(chess.Board(), pv, max_plies=3) == ["e4", "e5", "Nf3"]


def test_threat_board_passes_the_move():
    board = chess.Board()
    board.push_san("e4")  # Black to move, en passant square e3
    threat = threat_board(board)
    assert threat.turn == chess.WHITE
    assert threat.board_fen() == board.board_fen()
    assert threat.ep_square is None
    assert threat.move_stack == []


class TestEngineServiceWithoutStockfish:
    async def test_missing_binary(self):
        service = EngineService("live", EngineSettings(path=None, threads=1, hash_mb=16))
        with pytest.raises(EngineUnavailable, match="brew install stockfish"):
            await service.get()
        status = service.status()
        assert status["running"] is False
        assert "not found" in status["error"]

    async def test_broken_path(self, tmp_path):
        service = EngineService("live", EngineSettings(path=str(tmp_path / "no-such-engine"), threads=1, hash_mb=16))
        with pytest.raises(EngineUnavailable, match="Could not start Stockfish"):
            await service.get()
        assert service.status()["error"].startswith("Could not start Stockfish")

    async def test_status_before_start(self):
        status = EngineService("review", EngineSettings(path="/x/stockfish", threads=3, hash_mb=64)).status()
        assert status == {"label": "review", "name": None, "path": "/x/stockfish", "threads": 3, "hash_mb": 64,
                          "running": False, "error": None}

    async def test_close_when_never_started(self):
        await EngineService("x", EngineSettings(path=None, threads=1, hash_mb=16)).close()

    async def test_live_analysis_reports_a_missing_engine(self):
        live = LiveAnalysis(EngineService("live", EngineSettings(path=None, threads=1, hash_mb=16)))
        inbox = Inbox()
        await live.start(inbox.send, {"id": 1, "fen": None, "moves": [], "multipv": 1, "depth": 5}, owner=object())
        await inbox.wait_finished(1)
        assert inbox.of(1)[-1]["type"] == "error"
        assert "brew install stockfish" in inbox.of(1)[-1]["message"]
