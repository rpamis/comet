from __future__ import annotations

from pathlib import Path


class SessionStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._state: dict[str, str] = {}

    def save(self, thread_id: str, key: str, value: str) -> None:
        self._state[key] = value

    def load(self, thread_id: str, key: str, default: str | None = None) -> str | None:
        return self._state.get(key, default)
