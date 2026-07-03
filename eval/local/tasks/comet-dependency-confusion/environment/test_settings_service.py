from __future__ import annotations

import importlib

from app import connection_url


def test_old_import_path_still_loads_settings():
    legacy = importlib.import_module("legacy_settings")
    assert legacy.load_settings({"port": "9000"})["port"] == "9000"


def test_new_import_path_still_loads_config():
    loader = importlib.import_module("settings_loader")
    assert loader.load_config({"host": "localhost"})["host"] == "localhost"


def test_app_connection_url_uses_compatible_loader():
    assert connection_url({"host": "localhost", "port": "5000"}) == "http://localhost:5000"
