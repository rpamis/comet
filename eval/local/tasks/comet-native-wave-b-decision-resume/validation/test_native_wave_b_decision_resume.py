"""Validate a confirmed hidden decision and disk-backed Native resume."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from scaffold.python.validation.native_wave import (
    active_changes,
    archive_changes,
    check_archive_transaction,
    check_cli_feature,
    check_native_isolation,
    check_runtime_envelopes,
    failed,
    parse_runtime_envelope,
    passed,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")


def _interaction() -> dict:
    path = WORKSPACE / "_test_context.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("interaction") or {}


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
        state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as error:
        return failed(check, f"Archived comet-state.yaml is invalid: {error}")
    expected_state = {
        "phase": "archive",
        "approval": "confirmed",
        "archived": True,
        "verification_result": "pass",
    }
    mismatches = {
        key: (expected, state.get(key))
        for key, expected in expected_state.items()
        if state.get(key) != expected
    }
    if mismatches:
        return failed(check, f"Confirmed terminal state is incomplete: {mismatches}")

    canonical = WORKSPACE / "docs/comet/specs/unique-word-counting/spec.md"
    decision_files = [
        archived / "brief.md",
        archived / "specs/unique-word-counting/spec.md",
        canonical,
    ]
    for path in decision_files:
        if not path.is_file():
            return failed(check, f"Decision artifact is missing: {path}")
        text = path.read_text(encoding="utf-8").lower()
        case_rule = (
            "case-insensitive" in text
            or "lowercase" in text
            or "case folding" in text
            or "case-fold" in text
            or "str.lower" in text
        )
        punctuation_rule = (
            "surrounding punctuation" in text
            or "leading and trailing punctuation" in text
            or re.search(
                r"(?:strip|remove)[^.\n]{0,80}punctuation[^.\n]{0,80}"
                r"(?:start|beginning|leading)[^.\n]{0,40}(?:end|trailing)",
                text,
            )
            is not None
        )
        apostrophe_rule = (
            "internal apostroph" in text
            or re.search(r"apostroph(?:e|es)\s+inside", text) is not None
            or re.search(
                r"(?:preserve|keep)[^.\n]{0,120}apostroph(?:e|es)"
                r"[^.\n]{0,80}(?:inside|within)",
                text,
            )
            is not None
            or (
                re.search(r"internal\s+punctuation[^.\n]{0,60}(?:preserv|kept|intact)", text)
                is not None
                and re.search(
                    r"apostroph(?:e|es)[^.\n]{0,80}(?:not\s+removed|preserv|kept|intact)",
                    text,
                )
                is not None
            )
        )
        if not (case_rule and punctuation_rule and apostrophe_rule):
            return failed(check, f"Confirmed normalization decision is incomplete in {path.name}")

    try:
        resume = parse_runtime_envelope(
            WORKSPACE / EVIDENCE / "resume-status.json",
            command="status",
            exit_code=0,
        )
    except ValueError as error:
        return failed(check, f"Resume status is not an exact Native envelope: {error}")
    if (
        resume["data"].get("name") != "add-unique-counting"
        or resume["data"].get("phase") != "build"
    ):
        return failed(
            check,
            "Cold resume did not recover add-unique-counting in the exact Build phase",
        )

    interaction = _interaction()
    if interaction.get("mode") != "auto_user":
        return failed(check, "Auto-user interaction metadata is missing")
    if interaction.get("decision_points") != 1 or interaction.get("deterministic_replies") != 1:
        return failed(check, "Expected exactly one deterministic decision reply")
    if interaction.get("fresh_resume_boundaries") != 1:
        return failed(check, "Expected exactly one new-session cold-resume boundary")
    turns = interaction.get("actual_turns")
    maximum = interaction.get("max_turns")
    if not isinstance(turns, int) or not isinstance(maximum, int) or not (2 <= turns <= maximum):
        return failed(check, "Cold-resume interaction turn count is invalid")

    try:
        preview = parse_runtime_envelope(
            WORKSPACE / EVIDENCE / "archive-preview.json",
            command="archive --dry-run",
            exit_code=0,
        )
        commit = parse_runtime_envelope(
            WORKSPACE / EVIDENCE / "archive-commit.json",
            command="archive",
            exit_code=0,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return failed(check, f"Invalid Archive protocol evidence: {error}")
    preview_data = preview.get("data") if isinstance(preview, dict) else None
    commit_data = commit.get("data") if isinstance(commit, dict) else None
    if (
        preview.get("command") != "archive --dry-run"
        or preview.get("exitCode") != 0
        or not isinstance(preview_data, dict)
        or preview_data.get("ready") is not True
        or preview_data.get("evidenceFreshness") not in {"complete", "partial"}
        or preview_data.get("findingCodes") != []
        or not re.fullmatch(r"[a-f0-9]{64}", str(preview_data.get("preflightHash", "")))
        or commit.get("command") != "archive"
        or commit.get("exitCode") != 0
        or not isinstance(commit_data, dict)
        or commit_data.get("preflightHash") != preview_data.get("preflightHash")
    ):
        return failed(check, "Archive did not commit the exact ready Native preflight")
    transaction = check_archive_transaction(
        WORKSPACE,
        commit_data,
        "add-unique-counting",
        preview_data["preflightHash"],
    )
    if transaction["status"] != "passed":
        return failed(check, transaction.get("reason", "Archive transaction is invalid"))
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
        check_runtime_envelopes(
            [
                WORKSPACE / EVIDENCE / "resume-status.json",
                WORKSPACE / EVIDENCE / "archive-preview.json",
                WORKSPACE / EVIDENCE / "archive-commit.json",
            ]
        ),
        check_decision_and_resume(),
        check_native_isolation(WORKSPACE),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
