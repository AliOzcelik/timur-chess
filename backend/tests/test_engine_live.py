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


# ---- quick replacements (two browser tabs, fast arrow keys) -------------------------------
# Cancelling a search while python-chess waits for Stockfish's reply used to break the engine
# connection for good: every later request got no answer until the server restarted.

SICILIAN = ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "b8c6", "f1e2", "g7g6"]


def loop_errors() -> list[dict]:
    """Collect errors that asyncio would otherwise only log (like the broken engine callbacks)."""
    errors: list[dict] = []
    asyncio.get_running_loop().set_exception_handler(lambda _loop, ctx: errors.append(ctx))
    return errors


async def test_rapid_requests_from_two_tabs_keep_the_engine_working(service, inbox):
    import random

    errors = loop_errors()
    live = LiveAnalysis(service)
    tabs = [object(), object()]
    # This fixed sequence of starts, stops and pauses broke the old code every time.
    rnd = random.Random(1)
    for i in range(300):
        tab = tabs[0] if rnd.random() < 0.5 else tabs[1]
        n = rnd.randint(0, len(SICILIAN))
        req = request(1000 + i, moves=SICILIAN[:n], multipv=3, depth=None, threat=rnd.random() < 0.1)
        if rnd.random() < 0.15:
            await live.stop(tab)
        else:
            await live.start(inbox.send, req, owner=tab)
        await asyncio.sleep(rnd.choice([0, 0, 0.001, 0.005, 0.02, 0.1]))

    await live.start(inbox.send, request(2000, moves=SICILIAN, depth=8), owner=tabs[0])
    await inbox.wait_finished(2000)
    assert inbox.of(2000, "info")[-1]["lines"], "the engine must still answer"
    assert not errors, [e.get("message") for e in errors]
    await live.stop()


async def test_replaced_while_the_search_is_starting(service, inbox):
    errors = loop_errors()
    live = LiveAnalysis(service)
    owner = object()
    for i in range(40):  # no pause at all: each search is replaced before Stockfish even confirms it
        await live.start(inbox.send, request(3000 + i, moves=SICILIAN[: i % len(SICILIAN)], depth=None), owner=owner)
    await live.start(inbox.send, request(3100, depth=6), owner=owner)
    await inbox.wait_finished(3100)
    assert inbox.of(3100, "info")[-1]["lines"]
    assert not errors
    # Replaced searches stay quiet once a newer one has taken over.
    assert not any(m["type"] == "done" for i in range(40) for m in inbox.of(3000 + i))


async def test_cancelled_evaluation_keeps_the_engine_working(service):
    errors = loop_errors()
    live = LiveAnalysis(service)
    for delay in (0, 0.001, 0.01):
        task = asyncio.create_task(live.evaluate(None, SICILIAN, depth=20, seconds=2))
        await asyncio.sleep(delay)
        task.cancel()  # the HTTP request went away
        with pytest.raises(asyncio.CancelledError):
            await task
    result = await live.evaluate(BACK_RANK, [], depth=8, seconds=2)
    assert result["best"]["san"] == "Rd8#"
    assert not errors


async def test_engine_error_restarts_the_engine(service, inbox, monkeypatch):
    live = LiveAnalysis(service)
    first = await service.get()
    real = type(first).analysis
    calls = {"n": 0}

    async def flaky(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise AssertionError("CommandState.NEW")  # what python-chess raised when it broke
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(type(first), "analysis", flaky)
    await live.start(inbox.send, request(4000, depth=6), owner=object())
    await inbox.wait_finished(4000)
    assert inbox.of(4000, "error")[0]["message"].startswith("The engine had a problem")

    await live.start(inbox.send, request(4001, depth=6), owner=object())
    await inbox.wait_finished(4001)
    assert inbox.of(4001, "info")[-1]["lines"]
    assert await service.get() is not first, "a fresh Stockfish process should have been started"
