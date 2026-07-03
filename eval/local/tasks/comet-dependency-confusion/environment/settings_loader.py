from __future__ import annotations


DEFAULTS = {
    "host": "127.0.0.1",
    "port": "8080",
}


def load_config(overrides: dict[str, str] | None = None) -> dict[str, str]:
    config = dict(DEFAULTS)
    if overrides:
        config.update(overrides)
    return config
