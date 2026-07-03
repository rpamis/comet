from __future__ import annotations

from legacy_settings import load_settings


def connection_url(overrides: dict[str, str] | None = None) -> str:
    settings = load_settings(overrides)
    return f"http://{settings['host']}:{settings['port']}"
