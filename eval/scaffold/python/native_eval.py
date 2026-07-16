"""Adapt canonical Comet task checks to Native workflow semantics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from scaffold.python.validation.native_workflow import validate_native_workflow


NATIVE_TREATMENTS = {"COMET_NATIVE_PHASE1"}
CLASSIC_WORKFLOW_CHECK_PREFIXES = (
    "openspec_artifacts",
    "comet_state",
    "workflow_phases",
    "tests_written",
    "tests_exist",
)

NATIVE_PROMPT_PREFIX = """[COMET NATIVE TREATMENT]
Invoke /comet-native as the only Skill. Do not invoke /comet or any other Skill.
Preserve every business requirement in the task below, but interpret legacy
references to the comet workflow and its Open, Design, Build, Verify, and Archive
phases as the Native Shape, Build, Verify, and Archive workflow. Use only Native's
bundled runtime, initialize artifact_root `docs`, and leave a verified terminal
Native archive without OpenSpec, Classic, Superpowers, or hidden `.comet` artifacts.

[ORIGINAL BUSINESS TASK]
"""


def _is_classic_workflow_check(check: str) -> bool:
    return any(check.startswith(prefix) for prefix in CLASSIC_WORKFLOW_CHECK_PREFIXES)


def adapt_prompt_for_native(prompt: str, treatment_name: str) -> str:
    """Give canonical Classic-worded tasks an explicit Native treatment contract."""
    if treatment_name not in NATIVE_TREATMENTS:
        return prompt
    return f"{NATIVE_PROMPT_PREFIX}{prompt}"


def adapt_checks_for_native(
    test_dir: Path,
    outputs: dict[str, Any],
    passed: list[str],
    failed: list[str],
) -> tuple[list[str], list[str]]:
    """Replace Classic-only checks with Native's equivalent hard contract."""
    if outputs.get("treatment_name") not in NATIVE_TREATMENTS:
        return passed, failed
    kept_passed = [check for check in passed if not _is_classic_workflow_check(check)]
    kept_failed = [check for check in failed if not _is_classic_workflow_check(check)]
    native_passed, native_failed = validate_native_workflow(test_dir, outputs)
    return kept_passed + native_passed, kept_failed + native_failed
