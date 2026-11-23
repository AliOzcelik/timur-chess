"""The HTTP and WebSocket API, through the real app with its real engines."""

from __future__ import annotations

import time

import pytest

from .conftest import BACK_RANK, FOOLS_MATE, SCHOLARS_MATE

pytestmark = pytest.mark.engine


def wait_for_review(client, rid: int, timeout: float = 120) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        data = client.get(f"/api/reviews/{rid}").json()
        if data["status"] in ("done", "error"):
            return data
        time.sleep(0.2)
    raise TimeoutError(f"review {rid} did not finish")


def ws_until(ws, kinds: set[str], limit: int = 500) -> list[dict]:
    """Read messages until one of `kinds` arrives; return all of them."""
    out = []
    for _ in range(limit):
        msg = ws.receive_json()
        out.append(msg)
        if msg["type"] in kinds:
            return out
    raise AssertionError(f"no {kinds} message")


class TestHealth:
    def test_reports_both_engines(self, client):
        data = client.get("/api/health").json()
        assert data["ok"] is True
        assert data["version"]
        live = data["engines"]["live"]
        assert live["running"] is True
        assert live["name"].startswith("Stockfish")
        assert (live["threads"], live["hash_mb"]) == (2, 32)
        assert data["engines"]["review"]["threads"] == 1
        assert set(data["review_profiles"]) == {"quick", "standard", "deep"}


class TestWebSocket:
    def test_hello_then_analysis(self, client):
        with client.websocket_connect("/api/engine/ws") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello"
            assert hello["engine"]["running"] is True

            ws.send_json({"type": "analyze", "id": 1, "fen": BACK_RANK, "moves": [], "multipv": 2, "depth": 8})
            messages = ws_until(ws, {"done", "error"})
            assert messages[-1] == {"type": "done", "id": 1}
            info = [m for m in messages if m["type"] == "info"][-1]
            assert len(info["lines"]) == 2
            assert info["lines"][0]["san"][0] == "Rd8#"

    def test_ping(self, client):
        with client.websocket_connect("/api/engine/ws") as ws:
            ws.receive_json()
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    def test_bad_message_does_not_close_the_socket(self, client):
        with client.websocket_connect("/api/engine/ws") as ws:
            ws.receive_json()
            ws.send_text("this is not json")
            assert ws.receive_json() == {"type": "error", "message": "Messages must be JSON."}
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    def test_illegal_position(self, client):
        with client.websocket_connect("/api/engine/ws") as ws:
            ws.receive_json()
            ws.send_json({"type": "analyze", "id": 9, "fen": "8/8/8/8/8/8/8/8 w - - 0 1", "moves": []})
            msg = ws_until(ws, {"done", "error"})[-1]
            assert msg["type"] == "error" and msg["id"] == 9

    def test_stop(self, client):
        with client.websocket_connect("/api/engine/ws") as ws:
            ws.receive_json()
            ws.send_json({"type": "analyze", "id": 3, "fen": None, "moves": [], "multipv": 1, "depth": None})
            assert ws_until(ws, {"info"})[-1]["id"] == 3
            ws.send_json({"type": "stop"})
            ws.send_json({"type": "ping"})
            after_stop = ws_until(ws, {"pong"})
            assert not [m for m in after_stop if m["type"] == "done"]
            # The socket still works after a stop.
            ws.send_json({"type": "analyze", "id": 4, "fen": None, "moves": ["e2e4"], "multipv": 1, "depth": 6})
            assert ws_until(ws, {"done"})[-1] == {"type": "done", "id": 4}


class TestEval:
    def test_best_move(self, client):
        res = client.post("/api/engine/eval", json={"fen": BACK_RANK, "moves": [], "depth": 8, "seconds": 2})
        assert res.status_code == 200
        data = res.json()
        assert data["best"] == {"uci": "d1d8", "san": "Rd8#"}
        assert data["eval"] == {"cp": None, "mate": 1}

    def test_after_a_move(self, client):
        res = client.post("/api/engine/eval", json={"fen": BACK_RANK, "moves": ["h2h3"], "depth": 8, "seconds": 1})
        assert res.status_code == 200
        assert res.json()["best"]["uci"]

    def test_finished_game(self, client):
        data = client.post("/api/engine/eval", json={"fen": FOOLS_MATE}).json()
        assert data["eval"]["winner"] == "black"
        assert data["best"] is None

    def test_bad_fen(self, client):
        res = client.post("/api/engine/eval", json={"fen": "nonsense", "moves": []})
        assert res.status_code == 400
        assert "Invalid FEN" in res.json()["detail"]

    def test_illegal_move(self, client):
        res = client.post("/api/engine/eval", json={"fen": None, "moves": ["e2e5"]})
        assert res.status_code == 400

    @pytest.mark.parametrize("body", [{"depth": 0}, {"depth": 41}, {"seconds": 0}, {"seconds": 31}])
    def test_limits_are_validated(self, client, body):
        assert client.post("/api/engine/eval", json=body).status_code == 422


class TestPgnParse:
    def test_parses_a_game(self, client):
        res = client.post("/api/pgn/parse", json={"pgn": SCHOLARS_MATE})
        assert res.status_code == 200
        data = res.json()
        assert data["headers"]["White"] == "You"
        assert data["game_count"] == 1
        assert data["tree"]["children"][0]["san"] == "e4"

    def test_empty(self, client):
        res = client.post("/api/pgn/parse", json={"pgn": ""})
        assert res.status_code == 400
        assert res.json()["detail"].startswith("No game found")

    def test_missing_field(self, client):
        assert client.post("/api/pgn/parse", json={}).status_code == 422

    def test_too_long(self, client):
        assert client.post("/api/pgn/parse", json={"pgn": "x" * 2_000_001}).status_code == 422


class TestReviews:
    def test_full_cycle(self, client):
        res = client.post("/api/reviews", json={"pgn": SCHOLARS_MATE, "profile": "quick", "my_color": "black"})
        assert res.status_code == 201
        rid = res.json()["id"]
        assert res.json()["game_count"] == 1

        row = wait_for_review(client, rid)
        assert row["status"] == "done", row["error"]
        assert (row["white"], row["black"], row["result"], row["event"]) == ("You", "Opponent", "1-0", "Club night")
        assert row["game_date"] == "2026.11.20"
        assert row["my_color"] == "black"
        assert row["ply_count"] == 7
        assert row["pgn"].startswith('[Event "Club night"]')
        assert row["analysis"]["moves"][5]["classification"] == "blunder"

        listed = client.get("/api/reviews").json()
        assert listed["reviews"][0]["id"] == rid
        assert listed["reviews"][0]["white_accuracy"] == row["white_accuracy"]
        assert "pgn" not in listed["reviews"][0]

        assert client.delete(f"/api/reviews/{rid}").json() == {"ok": True}
        assert client.get(f"/api/reviews/{rid}").status_code == 404
        assert client.delete(f"/api/reviews/{rid}").status_code == 404

    def test_unknown_names_are_left_empty(self, client):
        pgn = '[White "?"]\n[Black ""]\n[Date "????.??.??"]\n[Result "*"]\n\n1. e4 *'
        rid = client.post("/api/reviews", json={"pgn": pgn, "profile": "quick"}).json()["id"]
        row = client.get(f"/api/reviews/{rid}").json()
        assert (row["white"], row["black"], row["game_date"], row["result"]) == (None, None, None, None)
        assert row["my_color"] == "both"
        wait_for_review(client, rid)
        client.delete(f"/api/reviews/{rid}")

    def test_game_without_moves(self, client):
        res = client.post("/api/reviews", json={"pgn": '[White "A"]\n[Black "B"]\n\n*'})
        assert res.status_code == 400
        assert "no moves" in res.json()["detail"]

    def test_broken_pgn(self, client):
        res = client.post("/api/reviews", json={"pgn": "1. e4 e5 2. Ke3"})
        assert res.status_code == 400

    @pytest.mark.parametrize("body", [
        {"pgn": "1. e4 *", "profile": "ultra"},
        {"pgn": "1. e4 *", "my_color": "green"},
        {"profile": "quick"},
    ])
    def test_invalid_requests(self, client, body):
        assert client.post("/api/reviews", json=body).status_code == 422

    def test_missing_review(self, client):
        assert client.get("/api/reviews/987654").status_code == 404
        assert client.get("/api/reviews/not-a-number").status_code == 422


def test_web_page_is_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "Timur" in res.text
