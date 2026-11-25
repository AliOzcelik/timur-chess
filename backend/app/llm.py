"""Local LLM client (Ollama, LM Studio, llama.cpp: anything with an OpenAI-style API).

The model never judges chess. It only rewrites facts that Stockfish and
python-chess produced into plain language (see review/coach.py).
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator

import openai
from openai import AsyncOpenAI

log = logging.getLogger("timur.llm")


class LLMUnavailable(RuntimeError):
    pass


class LLMClient:
    def __init__(self, settings: Any):
        self.settings = settings  # settings_store.Settings
        self._client: AsyncOpenAI | None = None
        self._url: str | None = None

    def config(self) -> dict[str, Any]:
        s = self.settings.all()
        return {"enabled": bool(s["llm_enabled"]), "base_url": s["llm_base_url"].strip().rstrip("/"),
                "model": s["llm_model"].strip()}

    def _get(self, base_url: str) -> AsyncOpenAI:
        if self._client is None or self._url != base_url:
            # Ollama ignores the key, but the client library needs one.
            self._client = AsyncOpenAI(base_url=base_url, api_key="ollama", timeout=180, max_retries=0)
            self._url = base_url
        return self._client

    def _friendly(self, exc: Exception, base_url: str, model: str) -> LLMUnavailable:
        if isinstance(exc, openai.APIConnectionError):
            return LLMUnavailable(f"Couldn't reach the local model server at {base_url}. "
                                  "Start Ollama (open the Ollama app, or run: ollama serve) and try again.")
        if isinstance(exc, openai.NotFoundError):
            return LLMUnavailable(f"The model {model} isn't installed. Install it with: ollama pull {model}")
        if isinstance(exc, openai.APITimeoutError):
            return LLMUnavailable("The local model took too long to answer. Try again.")
        return LLMUnavailable(f"The local model failed: {exc}")

    async def chat(self, messages: list[dict[str, str]], *, temperature: float = 0.2, max_tokens: int = 600) -> str:
        cfg = self.config()
        if not cfg["enabled"]:
            raise LLMUnavailable("AI explanations are turned off in Settings.")
        try:
            resp = await self._get(cfg["base_url"]).chat.completions.create(
                model=cfg["model"],
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                # Thinking models: skip the hidden reasoning, the facts are already worked out.
                reasoning_effort="none",  # type: ignore[arg-type]
            )
        except Exception as exc:  # noqa: BLE001 - turn every failure into a message for the UI
            log.warning("LLM call failed: %s", exc)
            raise self._friendly(exc, cfg["base_url"], cfg["model"]) from exc
        text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
        if not text:
            raise LLMUnavailable("The local model returned an empty answer. Try again.")
        return text

    async def stream(self, messages: list[dict[str, str]], *, temperature: float = 0.3,
                     max_tokens: int = 700) -> AsyncIterator[str]:
        """Yield the answer piece by piece. Connection problems raise LLMUnavailable before the first piece."""
        cfg = self.config()
        if not cfg["enabled"]:
            raise LLMUnavailable("AI explanations are turned off in Settings.")
        try:
            resp = await self._get(cfg["base_url"]).chat.completions.create(
                model=cfg["model"],
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort="none",  # type: ignore[arg-type]
                stream=True,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("LLM call failed: %s", exc)
            raise self._friendly(exc, cfg["base_url"], cfg["model"]) from exc
        try:
            async for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as exc:  # noqa: BLE001
            log.warning("LLM stream failed: %s", exc)
            raise self._friendly(exc, cfg["base_url"], cfg["model"]) from exc

    async def status(self) -> dict[str, Any]:
        cfg = self.config()
        out: dict[str, Any] = {**cfg, "reachable": False, "installed": False, "models": [], "error": None}
        if not cfg["enabled"]:
            return out
        try:
            page = await self._get(cfg["base_url"]).models.list()
            out["models"] = sorted(m.id for m in page.data)
            out["reachable"] = True
            out["installed"] = cfg["model"] in out["models"]
            if not out["installed"]:
                out["error"] = f"The model {cfg['model']} isn't installed. Install it with: ollama pull {cfg['model']}"
        except Exception as exc:  # noqa: BLE001
            out["error"] = str(self._friendly(exc, cfg["base_url"], cfg["model"]))
        return out
