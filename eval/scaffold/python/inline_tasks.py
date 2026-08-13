"""Deterministic validators for project-authored inline eval tasks."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scaffold.python.utils import run_command_in_docker


def _workspace_path(test_dir: Path, value: str) -> Path:
    candidate = test_dir / value
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(test_dir.resolve())
    except ValueError as exc:
        raise ValueError(f"Task artifact escapes the workspace: {value!r}") from exc
    return candidate


def _json_path(value: Any, path: str) -> Any:
    if path == "$":
        return value
    if not path.startswith("$."):
        raise ValueError(f"Unsupported JSON path: {path}")
    tokens: list[str] = []
    for part in path[2:].replace("[", ".").replace("]", "").split("."):
        if part:
            tokens.append(part)
    current = value
    for token in tokens:
        if isinstance(current, list):
            current = current[int(token)]
        elif isinstance(current, dict):
            current = current[token]
        else:
            raise KeyError(token)
    return current


def _display_output(result: Any) -> str:
    output = "\n".join(
        part for part in (getattr(result, "stdout", ""), getattr(result, "stderr", "")) if part
    )
    return output[-1000:]


def make_inline_expectations_validator(expect: dict[str, Any]):
    """Build a validator for the normalized ``evaluation.tasks.expect`` map."""

    def validate(test_dir: Path, _outputs: dict) -> tuple[list[str], list[str]]:
        passed: list[str] = []
        failed: list[str] = []

        for command_spec in expect.get("commands", []):
            command = command_spec["run"]
            result = run_command_in_docker(test_dir, command, command_spec["timeout"])
            if result.returncode == 0:
                passed.append(f"Command succeeded: {command}")
            else:
                failed.append(f"Command failed: {command} ({_display_output(result)})")

        for artifact in expect.get("files", []):
            path = _workspace_path(test_dir, artifact)
            if any(char in artifact for char in "*?["):
                matches = []
                for item in test_dir.glob(artifact):
                    try:
                        safe_item = _workspace_path(test_dir, str(item.relative_to(test_dir)))
                    except ValueError:
                        continue
                    if safe_item == item:
                        matches.append(item)
                if matches:
                    passed.append(f"Files exist: {artifact}")
                else:
                    failed.append(f"Files missing: {artifact}")
            elif path.exists():
                passed.append(f"File exists: {artifact}")
            else:
                failed.append(f"File missing: {artifact}")

        for artifact, values in expect.get("contains", {}).items():
            path = _workspace_path(test_dir, artifact)
            if not path.is_file():
                failed.append(f"Contains checks missing file: {artifact}")
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            for value in values:
                if value in content:
                    passed.append(f"Contains {value!r} in {artifact}")
                else:
                    failed.append(f"Missing {value!r} in {artifact}")

        for check in expect.get("json", []):
            artifact = check["file"]
            path = _workspace_path(test_dir, artifact)
            try:
                actual = _json_path(json.loads(path.read_text(encoding="utf-8")), check["path"])
            except (
                FileNotFoundError,
                json.JSONDecodeError,
                KeyError,
                IndexError,
                TypeError,
                ValueError,
            ) as exc:
                failed.append(f"JSON {check['path']} in {artifact} could not be read: {exc}")
                continue
            if actual == check["equals"]:
                passed.append(f"JSON {check['path']} equals {check['equals']}")
            else:
                failed.append(f"JSON {check['path']} expected {check['equals']!r}, got {actual!r}")

        return passed, failed

    return validate
