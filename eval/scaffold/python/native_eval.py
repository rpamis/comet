"""Adapt canonical Comet task checks to Native workflow semantics."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from contextlib import contextmanager
import shutil
import tempfile
import json
import os

from scaffold.python.validation.native_workflow import validate_native_workflow


@contextmanager
def current_native_environment(environment_dir: Path, treatment_name: str):
    """Install the selected CLI tooling around unchanged canonical business fixtures."""
    marker = ".include-current-comet-cli"
    if (
        treatment_name not in {"COMET_NATIVE_SDK_CURRENT", "COMET_NATIVE_040_RC1"}
        or (environment_dir / marker).is_file()
    ):
        yield environment_dir
        return
    reference = (
        Path(__file__).resolve().parents[2] / "local/tasks/comet-native-workflow/environment"
    )
    with tempfile.TemporaryDirectory(prefix="comet-native-sdk-environment-") as temporary:
        prepared = Path(temporary)
        shutil.copytree(environment_dir, prepared, dirs_exist_ok=True)
        for name in (marker, "current-comet.sh", "current-comet-package.json"):
            shutil.copyfile(reference / name, prepared / name)
        selected_source = os.environ.get("BENCH_COMET_SOURCE_ROOT")
        if selected_source:
            package = json.loads(
                (Path(selected_source) / "package.json").read_text(encoding="utf-8")
            )
            (prepared / "current-comet-package.json").write_text(
                json.dumps(
                    {
                        "type": "module",
                        "private": True,
                        "dependencies": package.get("dependencies", {}),
                        "overrides": package.get("overrides", {}),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        dockerfile = prepared / "Dockerfile"
        content = dockerfile.read_text(encoding="utf-8")
        # The old empty Classic scaffold is workflow setup, not a business input.
        content = content.replace(
            "RUN mkdir -p openspec/changes", "# Native has no Classic scaffold"
        )
        if "ARG CLAUDE_CODE_VERSION=" not in content:
            content = content.replace(
                "WORKDIR /workspace", "ARG CLAUDE_CODE_VERSION=latest\nWORKDIR /workspace", 1
            )
        content = content.replace(
            "@anthropic-ai/claude-code@latest",
            "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}",
        )
        # Install once in a shared stage, before task-specific COPY instructions.
        tooling = """FROM node:22-bookworm-slim AS comet_eval_tools
ARG CLAUDE_CODE_VERSION=latest
COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

"""
        lines = []
        skip = False
        for line in content.splitlines():
            if skip or (
                line.startswith("RUN npm install -g @")
                and any(
                    package in line
                    for package in ("@fission-ai/openspec", "@anthropic-ai/claude-code")
                )
            ):
                skip = line.rstrip().endswith("\\")
                continue
            lines.append(line.replace("nodejs npm", ""))
            if line.startswith("FROM "):
                lines.extend(
                    """COPY --from=comet_eval_tools /usr/local/ /usr/local/
COPY --from=comet_eval_tools /opt/comet-cli /opt/comet-cli
RUN mkdir -p /opt/comet-current && ln -s /opt/comet-cli/node_modules /opt/comet-current/node_modules
COPY current-comet.sh /usr/local/bin/comet
RUN chmod 0755 /usr/local/bin/comet
""".splitlines()
                )
        dockerfile.write_text(tooling + "\n".join(lines) + "\n", encoding="utf-8")
        yield prepared


NATIVE_CLARIFICATION_MODES = {
    "COMET_NATIVE_SEQUENTIAL": "sequential",
    "COMET_NATIVE_BATCH": "batch",
}
NATIVE_TREATMENTS = {
    "COMET_NATIVE_SDK_CURRENT",
    "COMET_NATIVE_040_RC1",
    "COMET_NATIVE_PHASE1",
    *NATIVE_CLARIFICATION_MODES,
}
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
    "native_loop",
    "native_isolation",
    "sdk_run",
)
COMET_WORKFLOW_CHECK_PREFIXES = (
    *CLASSIC_WORKFLOW_CHECK_PREFIXES,
    *NATIVE_WORKFLOW_CHECK_PREFIXES,
)

NATIVE_PROMPT_PREFIX = """[COMET NATIVE BETA17 TREATMENT]
Invoke /comet-native as the only Skill. Do not invoke /comet or any other Skill.
Preserve every business requirement in the task below, but interpret legacy
references to the comet workflow and its Open, Design, Build, Verify, and Archive
phases as the Native Shape, Build, Verify, and Archive workflow. Use beta17's
portable `comet.native.v4` state and its bounded Build↔Verify loop. Keep the
user-readable brief, specification, and verification report at the change root;
the machine-owned execution overlay belongs under `.comet/runtime`. Initialize
artifact_root `docs`. {terminal_instruction}
{clarification_instruction}
Do not create OpenSpec, Classic, Superpowers, snapshot, evidence, receipt,
checkpoint, trajectory, or change-local `runtime` artifacts. `.comet/config.yaml`
and `.comet/runtime` are the only Native machine state expected for this task.

[ORIGINAL BUSINESS TASK]
"""

SDK_NATIVE_PROMPT_PREFIX = """[COMET NATIVE SDK TREATMENT]
Invoke /comet-native as the only workflow Skill. Use the current-checkout
Comet CLI and SDK-backed Native Runtime for Shape, Build, Verify, and Archive.
The public `comet.native.v4` state is retained; the change must also have an
SDK owner, portable Run checkpoint, and terminal Run. Inspect it with
`comet runtime dispatch --application native` before claiming completion.
Initialize artifact_root `docs`. {terminal_instruction}
Do not create OpenSpec, Classic, Superpowers, or change-local machine artifacts.

[ORIGINAL BUSINESS TASK]
"""

RC1_NATIVE_PROMPT_PREFIX = """[COMET NATIVE 0.4.0-rc.1 TREATMENT]
Invoke /comet-native as the only workflow Skill. Use the pinned 0.4.0-rc.1
Comet CLI on PATH and that release's Native Runtime. Preserve every business
requirement below, mapping legacy Open, Design, Build, Verify, Archive wording
to Native Shape, Build, Verify, Archive. Follow this release's own approval,
independent review, verification, and archive protocol without replacing it
with a newer protocol. Initialize artifact_root `docs`. {terminal_instruction}
Do not invoke Classic, OpenSpec, Superpowers, or other workflow Skills.

[ORIGINAL BUSINESS TASK]
"""


def _is_classic_workflow_check(check: str) -> bool:
    return any(check.startswith(prefix) for prefix in CLASSIC_WORKFLOW_CHECK_PREFIXES)


def _is_comet_workflow_check(check: str) -> bool:
    return any(check.startswith(prefix) for prefix in COMET_WORKFLOW_CHECK_PREFIXES)


def is_observational_baseline_run(treatment_name: str) -> bool:
    """Return whether a treatment is recorded as a non-gating comparison baseline."""
    return treatment_name in CONTROL_BUSINESS_ONLY_TREATMENTS


def is_control_business_only_run(profile_name: str, treatment_name: str) -> bool:
    """Return whether workflow checks are non-applicable for this CONTROL run."""
    return profile_name == "comet-workflow" and is_observational_baseline_run(treatment_name)


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
    prefix = (
        SDK_NATIVE_PROMPT_PREFIX
        if treatment_name == "COMET_NATIVE_SDK_CURRENT"
        else RC1_NATIVE_PROMPT_PREFIX
        if treatment_name == "COMET_NATIVE_040_RC1"
        else NATIVE_PROMPT_PREFIX
    )
    return (
        f"{prefix.format(terminal_instruction=terminal_instruction, clarification_instruction=clarification_instruction)}"
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
