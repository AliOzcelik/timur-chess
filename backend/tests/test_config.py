from __future__ import annotations

import pytest

from app import config
from app.config import _env_int, find_stockfish


def test_data_goes_to_the_test_folder_not_the_real_database():
    # conftest points TIMUR_DATA_DIR at a temporary folder before the app is imported.
    assert config.DATA_DIR != config.ROOT / "data"
    assert config.DB_PATH.parent == config.DATA_DIR


def test_engine_settings_come_from_the_environment():
    assert config.LIVE_ENGINE.threads == 2
    assert config.LIVE_ENGINE.hash_mb == 32
    assert config.REVIEW_ENGINE.threads == 1
    assert config.REVIEW_ENGINE.hash_mb == 16


@pytest.mark.parametrize("raw, expected", [(None, 7), ("", 7), ("  ", 7), ("12", 12), ("abc", 7), ("-3", -3)])
def test_env_int(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("TIMUR_TEST_INT", raising=False)
    else:
        monkeypatch.setenv("TIMUR_TEST_INT", raw)
    assert _env_int("TIMUR_TEST_INT", 7) == expected


def test_stockfish_path_variable_wins(monkeypatch):
    monkeypatch.setenv("STOCKFISH_PATH", "/custom/stockfish")
    assert find_stockfish() == "/custom/stockfish"


def test_stockfish_found_on_path(monkeypatch):
    monkeypatch.delenv("STOCKFISH_PATH", raising=False)
    monkeypatch.setattr(config.shutil, "which", lambda name: "/somewhere/bin/stockfish")
    assert find_stockfish() == "/somewhere/bin/stockfish"


def test_stockfish_missing(monkeypatch):
    monkeypatch.delenv("STOCKFISH_PATH", raising=False)
    monkeypatch.setattr(config.shutil, "which", lambda name: None)
    monkeypatch.setattr(config.Path, "exists", lambda self: False)
    assert find_stockfish() is None
