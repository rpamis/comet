"""Failure attribution for eval reports."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Literal

FailureBucket = Literal["harness", "workflow", "task", "model"]


@dataclass(frozen=True)
class FailureAttribution:
    bucket: FailureBucket
    check: str
    reason: str


def classify_failure(check: str, events: dict, profile: str | None) -> FailureAttribution:
    if check.startswith("dataset_reference_access:"):
        return FailureAttribution(
            "model", check, "execution Agent attempted to retrieve benchmark reference materials"
        )
    if check.startswith(("dataset_verifier_error:", "dataset_verifier_unconfirmed:")):
        return FailureAttribution(
            "task",
            check,
            "original verifier execution needs attribution; candidate and environment causes remain possible; original reward retained",
        )
    if check.startswith(
        ("dataset_environment:", "dataset_input_changed:", "dataset_environment_changed:")
    ):
        return FailureAttribution(
            "harness", check, "dataset preparation or bound evaluation input failed"
        )
    if check.startswith("dataset_incomplete:"):
        return FailureAttribution(
            "model",
            check,
            "original dataset grader did not award full success; workflow completion does not override it",
        )
    skills_invoked = events.get("skills_invoked") or []
    if re.search(r"Required skill not invoked|skill.*not invoked", check, re.I):
        if not skills_invoked:
            return FailureAttribution(
                "harness",
                check,
                "target Skill was never invoked, so workflow quality is not observable",
            )
        return FailureAttribution("workflow", check, "Skill invocation contract failed")

    if re.search(r"artifact path|not found in archive|validator|task directory", check, re.I):
        return FailureAttribution("task", check, "task or validator path assumption failed")

    if re.search(r"\.comet\.yaml|guard|state|transition|archive", check, re.I):
        return FailureAttribution("workflow", check, "workflow state or guard evidence failed")

    if profile == "generic" and not skills_invoked:
        return FailureAttribution("harness", check, "generic Skill target did not run")

    return FailureAttribution("model", check, "task failed after observable workflow execution")


def classify_failures(failed: list[str], events: dict, profile: str | None) -> list[dict[str, str]]:
    return [asdict(classify_failure(check, events, profile)) for check in failed]
