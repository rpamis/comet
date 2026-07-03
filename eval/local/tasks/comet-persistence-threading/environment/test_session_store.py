from __future__ import annotations

from session_store import SessionStore


def test_thread_ids_are_isolated(tmp_path):
    store = SessionStore(tmp_path / "state.json")
    store.save("thread-a", "status", "draft")
    store.save("thread-b", "status", "approved")

    assert store.load("thread-a", "status") == "draft"
    assert store.load("thread-b", "status") == "approved"


def test_state_persists_across_store_instances(tmp_path):
    path = tmp_path / "state.json"
    first = SessionStore(path)
    first.save("thread-a", "checkpoint", "ready")

    second = SessionStore(path)
    assert second.load("thread-a", "checkpoint") == "ready"
