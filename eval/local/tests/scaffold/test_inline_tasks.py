"""Tests for deterministic expectations in inline manifest tasks."""

import json
from pathlib import Path

from scaffold.python import inline_tasks


def test_inline_expectations_check_files_contains_json_and_commands(monkeypatch, tmp_path: Path):
    (tmp_path / "result.md").write_text("# Result\ncomplete\n", encoding="utf-8")
    (tmp_path / "summary.json").write_text(json.dumps({"status": "complete"}), encoding="utf-8")
    commands = []

    def fake_run_command(test_dir, command, timeout):
        commands.append((test_dir, command, timeout))
        return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(inline_tasks, "run_command_in_docker", fake_run_command)
    validator = inline_tasks.make_inline_expectations_validator(
        {
            "files": ["result.md"],
            "contains": {"result.md": ["# Result", "complete"]},
            "json": [{"file": "summary.json", "path": "$.status", "equals": "complete"}],
            "commands": [{"run": "pnpm test", "timeout": 45}],
        }
    )

    passed, failed = validator(tmp_path, {})

    assert failed == []
    assert any("File exists: result.md" in check for check in passed)
    assert any("Contains '# Result'" in check for check in passed)
    assert any("JSON $.status equals complete" in check for check in passed)
    assert any("Command succeeded: pnpm test" in check for check in passed)
    assert commands == [(tmp_path, "pnpm test", 45)]


def test_inline_expectations_report_command_failure_without_running_host_shell(
    monkeypatch, tmp_path: Path
):
    calls = []

    def fake_run_command(test_dir, command, timeout):
        calls.append((test_dir, command, timeout))
        return type("Result", (), {"returncode": 1, "stdout": "out", "stderr": "err"})()

    monkeypatch.setattr(inline_tasks, "run_command_in_docker", fake_run_command)
    validator = inline_tasks.make_inline_expectations_validator(
        {"commands": [{"run": "pnpm test", "timeout": 10}]}
    )

    passed, failed = validator(tmp_path, {})

    assert passed == []
    assert failed == ["Command failed: pnpm test (out\nerr)"]
    assert calls == [(tmp_path, "pnpm test", 10)]
