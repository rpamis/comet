"""Validate a product decision and a disk-backed Native v4 resume.

The validator intentionally checks the portable YAML state and the Runtime
continuation, not an Agent-authored receipt or an implementation snapshot.
Those documents were part of the retired beta16 protocol.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from scaffold.python.validation.native_v4 import (
    active_changes,
    archive_changes,
    check_cli_feature,
    failed,
    parse_runtime_envelope,
    passed,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")


def _interaction() -> dict[str, Any]:
    path = WORKSPACE / "_test_context.json"
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value.get("interaction") or {} if isinstance(value, dict) else {}


def _state_from_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    data = envelope.get("data")
    if not isinstance(data, dict):
        return {}
    state = data.get("state")
    if isinstance(state, dict):
        return state
    change = data.get("change")
    if isinstance(change, dict):
        return change
    return data


def _read_state(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError("comet-state.yaml must contain a mapping")
    return value


def _portable_v4(state: dict[str, Any], *, name: str, require_passed: bool = False) -> list[str]:
    errors: list[str] = []
    if state.get("schema") != "comet.native.v4":
        errors.append(f"schema={state.get('schema')!r}")
    if state.get("name") != name:
        errors.append(f"name={state.get('name')!r}")
    if (
        not isinstance(state.get("state_version"), int)
        or isinstance(state.get("state_version"), bool)
        or state["state_version"] < 1
    ):
        errors.append("state_version is not a positive integer")
    loop = state.get("loop")
    if not isinstance(loop, dict):
        errors.append("loop is missing")
    else:
        if not isinstance(loop.get("stage"), str) or not loop["stage"]:
            errors.append("loop.stage is missing")
        for key in ("iteration", "attempt", "failed_iteration_count", "no_progress_count"):
            if (
                not isinstance(loop.get(key), int)
                or isinstance(loop.get(key), bool)
                or loop[key] < 0
            ):
                errors.append(f"loop.{key} is invalid")
    acceptance = state.get("acceptance")
    if not isinstance(acceptance, list) or not acceptance:
        errors.append("acceptance is empty")
    elif require_passed:
        results = [item.get("result") for item in acceptance if isinstance(item, dict)]
        if not results or any(result != "passed" for result in results):
            errors.append(f"acceptance results={results!r}")
    return errors


def _check_decision_artifacts(archived: Path) -> str | None:
    canonical = WORKSPACE / "docs/comet/specs/unique-word-counting/spec.md"
    paths = [archived / "brief.md", archived / "specs/unique-word-counting/spec.md", canonical]
    for path in paths:
        if not path.is_file():
            return f"Decision artifact is missing: {path}"
        text = path.read_text(encoding="utf-8").lower()
        case_rule = any(
            token in text
            for token in ("case-insensitive", "lowercase", "case folding", "case-fold", "str.lower")
        )
        punctuation_rule = (
            "surrounding punctuation" in text or "leading and trailing punctuation" in text
        )
        apostrophe_rule = "internal apostroph" in text or "preserve internal" in text
        if not (case_rule and punctuation_rule and apostrophe_rule):
            return f"Confirmed normalization decision is incomplete in {path.name}"
    return None


def check_decision_and_resume() -> dict[str, str]:
    check = "decision_and_resume"
    active = active_changes(WORKSPACE)
    archives = archive_changes(WORKSPACE)
    if active:
        return failed(check, f"Expected no active change after Archive, found {len(active)}")
    if len(archives) != 1:
        return failed(check, f"Expected exactly one archive, found {len(archives)}")

    archived = archives[0]
    state_file = archived / "comet-state.yaml"
    if not state_file.is_file():
        return failed(check, "Archived comet-state.yaml is missing")
    try:
        state = _read_state(state_file)
    except (OSError, UnicodeDecodeError, yaml.YAMLError, ValueError) as error:
        return failed(check, f"Archived comet-state.yaml is invalid: {error}")
    errors = _portable_v4(state, name="add-unique-counting", require_passed=True)
    if (
        state.get("phase") != "archive"
        or state.get("status") != "done"
        or state.get("archived") is not True
    ):
        errors.append("terminal state is not archive/done/archived")
    if state.get("verification_result") != "pass":
        errors.append("verification_result is not pass")
    loop = state.get("loop") if isinstance(state.get("loop"), dict) else {}
    if loop.get("stage") not in {"archive-ready", "done"}:
        errors.append(f"loop.stage={loop.get('stage')!r}")
    if errors:
        return failed(check, "Invalid Native v4 terminal state: " + "; ".join(errors))

    decision_error = _check_decision_artifacts(archived)
    if decision_error:
        return failed(check, decision_error)

    try:
        resume = parse_runtime_envelope(EVIDENCE / "resume-status.json")
    except Exception as error:
        return failed(check, f"Resume status is not an exact Runtime envelope: {error}")
    resume_state = _state_from_envelope(resume)
    resume_errors = _portable_v4(resume_state, name="add-unique-counting")
    if resume_state.get("phase") not in {"build", "verify"}:
        resume_errors.append(f"cold resume phase={resume_state.get('phase')!r}")
    if resume_errors:
        return failed(
            check, "Cold resume did not expose a recoverable v4 state: " + "; ".join(resume_errors)
        )

    continuation = (
        resume.get("data", {}).get("continuation") if isinstance(resume.get("data"), dict) else None
    )
    if not isinstance(continuation, dict):
        return failed(check, "Cold resume did not return a continuation")
    if not any(continuation.get(key) for key in ("commandArgs", "command", "action")):
        return failed(check, "Cold resume continuation has no next action")

    interaction = _interaction()
    if interaction.get("mode") != "auto_user":
        return failed(check, "Auto-user interaction metadata is missing")
    if interaction.get("decision_points") != 1 or interaction.get("deterministic_replies") != 1:
        return failed(check, "Expected exactly one deterministic decision reply")
    if interaction.get("fresh_resume_boundaries") != 1:
        return failed(check, "Expected exactly one new-session cold-resume boundary")
    return passed(check)


def main() -> int:
    results = [
        check_cli_feature(
            WORKSPACE,
            "--unique-words",
            "Hello, hello HELLO! can't can't.",
            "Unique words: 2",
            "unique",
        ),
        check_decision_and_resume(),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
