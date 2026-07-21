"""Adapt canonical Comet task checks to Native workflow semantics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from scaffold.python.validation.native_workflow import validate_native_workflow


NATIVE_CLARIFICATION_MODES = {
    "COMET_NATIVE_SEQUENTIAL": "sequential",
    "COMET_NATIVE_BATCH": "batch",
}
NATIVE_TREATMENTS = {"COMET_NATIVE_PHASE1", *NATIVE_CLARIFICATION_MODES}
CONTROL_BUSINESS_ONLY_TREATMENTS = {"CONTROL"}
CLASSIC_WORKFLOW_CHECK_PREFIXES = (
    "openspec_artifacts",
    "comet_state",
    "workflow_phases",
    "tests_written",
    "tests_exist",
)
NATIVE_WORKFLOW_CHECK_PREFIXES = (
    "native_skill_invocation",
    "native_artifacts",
    "native_state",
    "native_trajectory",
    "native_isolation",
)
COMET_WORKFLOW_CHECK_PREFIXES = (
    *CLASSIC_WORKFLOW_CHECK_PREFIXES,
    *NATIVE_WORKFLOW_CHECK_PREFIXES,
)

NATIVE_PROMPT_PREFIX = """[COMET NATIVE TREATMENT]
Invoke /comet-native as the only Skill. Do not invoke /comet or any other Skill.
Preserve every business requirement in the task below, but interpret legacy
references to the comet workflow and its Open, Design, Build, Verify, and Archive
phases as the Native Shape, Build, Verify, and Archive workflow. Use only Native's
bundled runtime and initialize artifact_root `docs`. {terminal_instruction}
{clarification_instruction}
Do not create OpenSpec, Classic, Superpowers, or hidden `.comet` artifacts.

[ORIGINAL BUSINESS TASK]
"""


def _is_classic_workflow_check(check: str) -> bool:
    return any(check.startswith(prefix) for prefix in CLASSIC_WORKFLOW_CHECK_PREFIXES)


def _is_comet_workflow_check(check: str) -> bool:
    return any(check.startswith(prefix) for prefix in COMET_WORKFLOW_CHECK_PREFIXES)


def is_control_business_only_run(profile_name: str, treatment_name: str) -> bool:
    """Return whether workflow checks are non-applicable for this CONTROL run."""
    return profile_name == "comet-workflow" and treatment_name in CONTROL_BUSINESS_ONLY_TREATMENTS


def filter_control_workflow_checks(
    profile_name: str,
    treatment_name: str,
    passed: list[str],
    failed: list[str],
) -> tuple[list[str], list[str]]:
    """Remove Classic and Native workflow checks from business-only CONTROL."""
    if not is_control_business_only_run(profile_name, treatment_name):
        return passed, failed
    return (
        [check for check in passed if not _is_comet_workflow_check(check)],
        [check for check in failed if not _is_comet_workflow_check(check)],
    )


def split_comet_completion_checks(
    passed: list[str],
    failed: list[str],
) -> dict[str, dict[str, list[str]]]:
    """Split business checks from both Classic and Native workflow checks."""
    return {
        "business_completion": {
            "passed": [check for check in passed if not _is_comet_workflow_check(check)],
            "failed": [check for check in failed if not _is_comet_workflow_check(check)],
        },
        "workflow_completion": {
            "passed": [check for check in passed if _is_comet_workflow_check(check)],
            "failed": [check for check in failed if _is_comet_workflow_check(check)],
        },
    }


def adapt_prompt_for_native(
    prompt: str,
    treatment_name: str,
    terminal_mode: str = "archive",
) -> str:
    """Give canonical Classic-worded tasks an explicit Native treatment contract."""
    if treatment_name not in NATIVE_TREATMENTS:
        return prompt
    terminal_instruction = {
        "active": "Leave the task-requested Native changes active; do not force an Archive.",
        "active-blocked": (
            "If the task intentionally exercises a runtime stop, leave the change active at its "
            "runtime-enforced blocked state."
        ),
    }.get(terminal_mode, "Leave a verified terminal Native archive.")
    clarification_mode = NATIVE_CLARIFICATION_MODES.get(treatment_name)
    clarification_instruction = (
        f"Configure native.clarification_mode `{clarification_mode}` before asking any product "
        "question and do not change it during the run."
        if clarification_mode
        else ""
    )
    return (
        f"{NATIVE_PROMPT_PREFIX.format(terminal_instruction=terminal_instruction, clarification_instruction=clarification_instruction)}"
        f"{prompt}"
    )


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
    native_passed, native_failed = validate_native_workflow(
        test_dir,
        outputs,
        terminal_mode=outputs.get("native_terminal", "archive"),
    )
    return kept_passed + native_passed, kept_failed + native_failed
