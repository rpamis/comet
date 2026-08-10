"""Unit tests for the beta17 Native Eval protocol.

These tests intentionally exercise portable v4 state and Dashboard v2. Legacy
receipt/snapshot/checkpoint fixtures belong to a separate legacy test suite.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from scaffold.python.validation.native_v4 import (
    check_dashboard_projection,
    check_native_isolation,
    validate_active_state,
    validate_terminal_state,
)


ROOT = Path(__file__).resolve().parents[3]


def _load_workflow_validator():
    path = ROOT / "local" / "tasks" / "comet-native-workflow" / "validation" / "test_native_workflow.py"
    spec = importlib.util.spec_from_file_location("native_workflow_validator", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _state(**overrides):
    state = {
        "schema": "comet.native.v4",
        "name": "demo",
        "phase": "archive",
        "status": "done",
        "state_version": 4,
        "loop": {"stage": "done", "iteration": 1, "attempt": 1},
        "acceptance": [{"id": "A1", "result": "passed"}],
        "verification": {"verdict": "pass", "assurance": "host-attested"},
        "verification_result": "pass",
        "verification_report": "verification.md",
        "archived": True,
        "history": [{"outcome": "pass", "iteration": 1, "attempt": 1}],
    }
    state.update(overrides)
    return state


def test_terminal_v4_state_requires_all_acceptance_items():
    assert validate_terminal_state(_state()) == []
    errors = validate_terminal_state(_state(acceptance=[{"id": "A1", "result": "pending"}]))
    assert "acceptance is incomplete" in errors


def test_active_v4_state_does_not_require_a_failed_loop():
    errors = validate_active_state(
        _state(
            phase="build",
            status="active",
            archived=False,
            loop={"stage": "build", "iteration": 0, "attempt": 0},
            verification=None,
            verification_result="pending",
            verification_report=None,
            history=[],
        )
    )
    assert errors == []


def test_native_isolation_allows_runtime_owned_comet_files(tmp_path: Path):
    (tmp_path / ".comet" / "runtime" / "native").mkdir(parents=True)
    (tmp_path / ".comet" / "config.yaml").write_text("schema: comet.project.v1\n", encoding="utf-8")
    (tmp_path / ".comet" / "current-change.json").write_text("{}", encoding="utf-8")
    assert check_native_isolation(tmp_path)["status"] == "passed"


def test_native_isolation_rejects_change_local_runtime(tmp_path: Path):
    legacy = tmp_path / "docs" / "comet" / "changes" / "demo" / "runtime"
    legacy.mkdir(parents=True)
    assert check_native_isolation(tmp_path)["status"] == "failed"


def test_dashboard_v2_projection_rejects_old_schema():
    assert check_dashboard_projection({"schema": "comet.dashboard.native.v1"})["status"] == "failed"


def test_dashboard_v2_projection_accepts_bounded_change():
    projection = {
        "schema": "comet.dashboard.native.v2",
        "totalChangeCount": 1,
        "visibleChangeCount": 1,
        "changes": [
            {
                "name": "demo",
                "stateVersion": 2,
                "phase": "verify",
                "loop": {"stage": "verify", "iteration": 1, "attempt": 1},
                "acceptance": {"total": 1, "passed": 1, "failed": 0, "blocked": 0, "pending": 0},
            }
        ],
    }
    assert check_dashboard_projection(projection)["status"] == "passed"


def test_workflow_validator_does_not_use_removed_receipt_helpers():
    validator = _load_workflow_validator()
    for name in (
        "_canonical_hash",
        "_direct_acceptance_receipt_refs",
        "_trusted_native_runtime",
        "_validate_native_contract_with_trusted_runtime",
    ):
        assert not hasattr(validator, name)
