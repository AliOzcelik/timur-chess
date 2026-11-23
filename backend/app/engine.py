"""Stockfish process management and live (streaming) analysis."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

import chess
import chess.engine

from .config import EngineSettings
from .evals import score_to_eval, terminal_eval

log = logging.getLogger("timur.engine")

Send = Callable[[dict[str, Any]], Awaitable[None]]

PV_MAX_PLIES = 18
SEND_INTERVAL = 0.12  # seconds between live updates sent to the browser


class EngineUnavailable(RuntimeError):
    pass


class EngineService:
    """Owns one Stockfish process. Starts it on first use and restarts it if it dies."""

    def __init__(self, label: str, settings: EngineSettings,
                 extra_options: Callable[[], dict[str, Any]] | None = None):
        self.label = label
        self.settings = settings
        self.extra_options = extra_options  # e.g. SyzygyPath once the tablebases are there
        self.engine: chess.engine.UciProtocol | None = None
        self.transport: asyncio.SubprocessTransport | None = None
        self.name: str | None = None
        self.error: str | None = None
        self._start_lock = asyncio.Lock()

    def _alive(self) -> bool:
        return self.engine is not None and not self.engine.returncode.done()

    async def get(self) -> chess.engine.UciProtocol:
        async with self._start_lock:
            if self._alive():
                assert self.engine is not None
                return self.engine
            await self._start()
            assert self.engine is not None
            return self.engine

    async def _start(self) -> None:
        path = self.settings.path
        if not path:
            self.error = "Stockfish was not found. Install it with: brew install stockfish"
            raise EngineUnavailable(self.error)
        try:
            self.transport, self.engine = await chess.engine.popen_uci(path)
            options: dict[str, Any] = {"Threads": self.settings.threads, "Hash": self.settings.hash_mb}
            if self.extra_options is not None:
                options.update({k: v for k, v in self.extra_options().items() if k in self.engine.options})
            await self.engine.configure(options)
            self.name = self.engine.id.get("name", "Stockfish")
            self.error = None
            log.info("%s engine ready: %s (threads=%s, hash=%sMB)", self.label, self.name,
                     self.settings.threads, self.settings.hash_mb)
        except Exception as exc:  # noqa: BLE001 - report any startup failure to the UI
            self.engine = None
            self.error = f"Could not start Stockfish at {path}: {exc}"
            log.error(self.error)
            raise EngineUnavailable(self.error) from exc

    async def apply(self, settings: EngineSettings) -> None:
        """Use new settings: the engine restarts with them on its next use."""
        async with self._start_lock:
            changed = settings != self.settings
            self.settings = settings
            if changed:
                await self.close()

    async def close(self) -> None:
        if self.engine is None:
            return
        try:
            await asyncio.wait_for(self.engine.quit(), timeout=3)
        except Exception:  # noqa: BLE001
            if self.transport is not None:
                self.transport.close()
        self.engine = None

    def status(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "name": self.name,
            "path": self.settings.path,
            "threads": self.settings.threads,
            "hash_mb": self.settings.hash_mb,
            "running": self._alive(),
            "error": self.error,
        }


def build_board(fen: str | None, moves: list[str] | None) -> chess.Board:
    """Board from a start FEN plus UCI moves (history lets the engine see repetitions)."""
    try:
        board = chess.Board(fen) if fen else chess.Board()
    except ValueError as exc:
        raise ValueError(f"Invalid FEN: {exc}") from exc
    if not board.is_valid():
        # Impossible positions (two kings, side not to move in check, ...) can crash the engine.
        problems = str(board.status()).replace("Status.", "").replace("_", " ").lower()
        raise ValueError(f"This position is not legal ({problems}).")
    for uci in moves or []:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError as exc:
            raise ValueError(f"Invalid move {uci!r}") from exc
        if not board.is_legal(move):
            raise ValueError(f"Illegal move {uci!r} in position {board.fen()}")
        board.push(move)
    return board


def pv_to_san(board: chess.Board, pv: list[chess.Move], max_plies: int = PV_MAX_PLIES) -> list[str]:
    b = board.copy(stack=False)
    out: list[str] = []
    for move in pv[:max_plies]:
        if not b.is_legal(move):
            break
        out.append(b.san(move))
        b.push(move)
    return out


def threat_board(board: chess.Board) -> chess.Board:
    """The position as if the side to move passed: shows what the opponent threatens."""
    b = board.copy(stack=False)
    b.push(chess.Move.null())
    return chess.Board(b.fen())


class LiveAnalysis:
    """One live analysis at a time on the shared 'live' engine. A new request replaces the old one."""

    def __init__(self, service: EngineService):
        self.service = service
        self._task: asyncio.Task[None] | None = None
        self._owner: object | None = None
        self._lock = asyncio.Lock()

    async def start(self, send: Send, request: dict[str, Any], owner: object) -> None:
        async with self._lock:
            await self._cancel_current()
            self._owner = owner
            self._task = asyncio.create_task(self._run(send, request))

    async def stop(self, owner: object | None = None) -> None:
        async with self._lock:
            if owner is None or owner is self._owner:
                await self._cancel_current()

    async def _cancel_current(self) -> None:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def evaluate(self, fen: str | None, moves: list[str] | None, depth: int, seconds: float) -> dict[str, Any]:
        """One-off evaluation (used by review's 'retry' mode). Pauses live analysis."""
        async with self._lock:
            await self._cancel_current()
            board = build_board(fen, moves)
            done = terminal_eval(board)
            if done is not None:
                return {"eval": done, "best": None, "pv_san": []}
            engine = await self.service.get()
            info = await engine.analyse(board, chess.engine.Limit(depth=depth, time=seconds))
            pv = info.get("pv") or []
            return {
                "eval": score_to_eval(info["score"]),
                "best": {"uci": pv[0].uci(), "san": board.san(pv[0])} if pv else None,
                "pv_san": pv_to_san(board, pv),
                "depth": info.get("depth"),
            }

    async def _run(self, send: Send, request: dict[str, Any]) -> None:
        rid = request.get("id")

        async def safe_send(msg: dict[str, Any]) -> bool:
            try:
                await send(msg)
                return True
            except Exception:  # noqa: BLE001 - the browser tab went away
                return False

        try:
            board = build_board(request.get("fen"), request.get("moves"))
        except ValueError as exc:
            await safe_send({"type": "error", "id": rid, "message": str(exc)})
            return

        threat = bool(request.get("threat"))
        if threat:
            if board.is_check():
                await safe_send({"type": "error", "id": rid, "message": "Threat mode is not available while in check."})
                return
            board = threat_board(board)

        done = terminal_eval(board)
        if done is not None:
            await safe_send({"type": "info", "id": rid, "threat": threat, "fen": board.fen(), "terminal": done,
                             "depth": 0, "lines": []})
            await safe_send({"type": "done", "id": rid})
            return

        try:
            engine = await self.service.get()
        except EngineUnavailable as exc:
            await safe_send({"type": "error", "id": rid, "message": str(exc)})
            return

        legal = board.legal_moves.count()
        multipv = max(1, min(int(request.get("multipv") or 1), 5, legal))
        depth = request.get("depth")
        limit = chess.engine.Limit(depth=int(depth)) if depth else None

        lines: dict[int, dict[str, Any]] = {}
        stats: dict[str, Any] = {}
        san_cache: dict[tuple[str, ...], list[str]] = {}
        dirty = False
        started = time.monotonic()

        def snapshot() -> dict[str, Any]:
            out_lines = []
            for k in sorted(lines):
                line = lines[k]
                key = tuple(m.uci() for m in line["pv"])
                if key not in san_cache:
                    san_cache[key] = pv_to_san(board, line["pv"])
                out_lines.append({
                    "multipv": k,
                    "eval": line["eval"],
                    "depth": line["depth"],
                    "uci": list(key[:PV_MAX_PLIES]),
                    "san": san_cache[key],
                })
            return {"type": "info", "id": rid, "threat": threat, "fen": board.fen(), "lines": out_lines, **stats}

        async def sender() -> None:
            nonlocal dirty
            while True:
                await asyncio.sleep(SEND_INTERVAL)
                if dirty:
                    dirty = False
                    if not await safe_send(snapshot()):
                        return

        sender_task = asyncio.create_task(sender())
        try:
            # No `game=` argument on purpose: keeping the hash between requests makes
            # stepping back and forth through a game much faster.
            with await engine.analysis(board, limit, multipv=multipv) as analysis:
                async for info in analysis:
                    pv = info.get("pv")
                    score = info.get("score")
                    if not pv or score is None:
                        continue
                    k = int(info.get("multipv", 1))
                    lines[k] = {"eval": score_to_eval(score), "depth": info.get("depth"), "pv": pv}
                    if k == 1:
                        stats = {
                            "depth": info.get("depth"),
                            "seldepth": info.get("seldepth"),
                            "nodes": info.get("nodes"),
                            "nps": info.get("nps"),
                            "time": round(time.monotonic() - started, 1),
                        }
                    dirty = True
        except chess.engine.EngineTerminatedError:
            await safe_send({"type": "error", "id": rid, "message": "Stockfish stopped unexpectedly. It will restart on the next request."})
            return
        finally:
            sender_task.cancel()
        if lines:
            await safe_send(snapshot())
        await safe_send({"type": "done", "id": rid})
