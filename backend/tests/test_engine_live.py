"""Live analysis against the real Stockfish binary."""

from __future__ import annotations

import asyncio

import chess
import pytest

from app.engine import LiveAnalysis

from .conftest import BACK_RANK, FOOLS_MATE, ONE_LEGAL_MOVE

pytestmark = pytest.mark.engine


def request(rid, fen=None, moves=(), multipv=1, depth=8, threat=False):
    return {"type": "analyze", "id": rid, "fen": fen, "moves": list(moves), "multipv": multipv, "depth": depth,
            "threat": threat}


async def test_streams_lines_then_done(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(1, moves=["e2e4"], multipv=3, depth=10), owner=object())
    await inbox.wait_finished(1)

    infos = inbox.of(1, "info")
    assert infos, "expected at least one info message"
    last = infos[-1]
    assert last["fen"] == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    assert last["threat"] is False
    assert [line["multipv"] for line in last["lines"]] == [1, 2, 3]
    for line in last["lines"]:
        assert line["san"] and len(line["san"]) <= len(line["uci"])
        assert set(line["eval"]) >= {"cp", "mate"}
    assert last["depth"] >= 1 and last["nodes"] > 0
    assert inbox.of(1)[-1] == {"type": "done", "id": 1}


async def test_finds_mate_in_one(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(2, fen=BACK_RANK, depth=6), owner=object())
    await inbox.wait_finished(2)
    best = inbox.of(2, "info")[-1]["lines"][0]
    assert best["eval"] == {"cp": None, "mate": 1}
    assert best["san"][0] == "Rd8#"


@pytest.mark.parametrize("fen, asked, expected", [(ONE_LEGAL_MOVE, 5, 1), (None, 9, 5)])
async def test_number_of_lines_is_capped(service, inbox, fen, asked, expected):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(3, fen=fen, multipv=asked, depth=6), owner=object())
    await inbox.wait_finished(3)
    assert len(inbox.of(3, "info")[-1]["lines"]) == expected


async def test_threat_mode_analyses_for_the_other_side(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(4, moves=["e2e4"], threat=True, depth=6), owner=object())
    await inbox.wait_finished(4)
    info = inbox.of(4, "info")[-1]
    assert info["threat"] is True
    assert chess.Board(info["fen"]).turn == chess.WHITE  # White "moves again"


async def test_threat_mode_refused_in_check(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(5, moves=["e2e4", "f7f6", "d1h5"], threat=True), owner=object())
    await inbox.wait_finished(5)
    assert inbox.of(5) == [{"type": "error", "id": 5, "message": "Threat mode is not available while in check."}]


async def test_bad_position_is_an_error_not_a_crash(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(6, fen="KK6/8/8/8/8/8/8/7k w - - 0 1"), owner=object())
    await inbox.wait_finished(6)
    msg = inbox.of(6)[-1]
    assert msg["type"] == "error" and "not legal" in msg["message"]


async def test_finished_game_needs_no_engine(service, inbox):
    live = LiveAnalysis(service)
    await live.start(inbox.send, request(7, fen=FOOLS_MATE), owner=object())
    await inbox.wait_finished(7)
    info, done = inbox.of(7)
    assert info["terminal"] == {"cp": None, "mate": 0, "winner": "black"}
    assert info["lines"] == []
    assert done == {"type": "done", "id": 7}
    assert service.engine is None  # Stockfish was never started


async def test_new_request_replaces_the_old_one(service, inbox):
    live = LiveAnalysis(service)
    owner = object()
    await live.start(inbox.send, request(10, depth=None), owner=owner)  # infinite search
    await inbox.wait_for_info(10)
    await live.start(inbox.send, request(11, moves=["d2d4"], depth=6), owner=owner)
    seen_before_switch = len(inbox.messages)
    await inbox.wait_finished(11)

    assert not inbox.of(10, "done"), "the replaced search must not report done"
    assert all(m.get("id") == 11 for m in inbox.messages[seen_before_switch:])


async def test_stop_only_by_the_owner(service, inbox):
    live = LiveAnalysis(service)
    owner = object()
    await live.start(inbox.send, request(20, depth=None), owner=owner)
    await inbox.wait_for_info(20)

    await live.stop(owner=object())  # another browser tab
    count = len(inbox.messages)
    await asyncio.sleep(0.5)
    assert len(inbox.messages) > count, "analysis should still be running"

    await live.stop(owner=owner)
    count = len(inbox.messages)
    await asyncio.sleep(0.4)
    assert len(inbox.messages) == count
    assert not inbox.of(20, "done")


async def test_closed_browser_tab_does_not_break_analysis(service):
    live = LiveAnalysis(service)

    async def broken_send(msg):
        raise RuntimeError("socket closed")

    await live.start(broken_send, request(30, depth=6), owner=object())
    await asyncio.wait_for(live._task, 30)  # finishes quietly


async def test_one_off_evaluation(service):
    live = LiveAnalysis(service)
    result = await live.evaluate(BACK_RANK, [], depth=8, seconds=2)
    assert result["eval"] == {"cp": None, "mate": 1}
    assert result["best"] == {"uci": "d1d8", "san": "Rd8#"}
    assert result["pv_san"][0] == "Rd8#"
    assert result["depth"] >= 1


async def test_one_off_evaluation_of_a_finished_game(service):
    live = LiveAnalysis(service)
    result = await live.evaluate(FOOLS_MATE, [], depth=8, seconds=1)
    assert result == {"eval": {"cp": None, "mate": 0, "winner": "black"}, "best": None, "pv_san": []}


async def test_one_off_evaluation_rejects_illegal_moves(service):
    live = LiveAnalysis(service)
    with pytest.raises(ValueError, match="Illegal move"):
        await live.evaluate(None, ["e2e5"], depth=8, seconds=1)


async def test_engine_restarts_after_it_dies(service):
    first = await service.get()
    assert service.status()["running"] is True
    assert service.status()["name"].startswith("Stockfish")

    service.transport.kill()
    await asyncio.wait_for(first.returncode, 10)
    assert service.status()["running"] is False

    second = await service.get()
    assert second is not first
    assert service.status()["running"] is True
    info = await second.analyse(chess.Board(), chess.engine.Limit(depth=5))
    assert "score" in info
