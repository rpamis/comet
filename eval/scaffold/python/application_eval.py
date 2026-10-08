"""SDK application inputs and controller-owned evaluation reports."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def application_eval_context() -> dict[str, Any] | None:
    raw = os.environ.get("COMET_APPLICATION_EVAL_CONTEXT")
    if not raw:
        return None
    value = json.loads(raw)
    if not isinstance(value, dict) or not isinstance(value.get("preview"), dict):
        raise ValueError("Invalid SDK application Eval context")
    skill = Path(value["skillRoot"]).resolve()
    preview = json.loads((skill / "references/workflows.json").read_text(encoding="utf-8"))
    if preview != value["preview"]:
        raise ValueError("SDK application Eval context does not match its frozen snapshot")
    return value


def application_environment(skill_root: Path) -> Path | None:
    if not (skill_root / "scripts/application/application.json").is_file():
        return None
    from scaffold.python.paths import EVAL_ROOT

    return EVAL_ROOT / "scaffold/environments/workflow-application"


def application_generation_guidance(snapshot) -> str:
    if not any(item.path == "references/workflows.json" for item in snapshot.files):
        return ""
    return """
This is a complete SDK workflow application, not a prose-only Skill. Read the workflow definitions,
input/output schemas, fixed dependencies, approval choices and recovery contracts in the snapshot.
Generate a normal execution case plus cases for relevant rejection, invalid-input and recovery paths.
Every case must start or resume an actual SDK Run; an invalid-input case can first create a valid Run
and then check rejection of an invalid action. Check real business artifacts using deterministic
expectations. Do not substitute a hand-written state file for Runtime execution. Explain the required
scenario in each prompt; do not claim coverage of paths that were not executed. Use only /workspace
and isolated fixtures. Mock external services; never send real messages, publish or push remotely.
The controller installs the application and its fixed dependency Skills before execution. Use the
installed application Skill or comet runtime dispatch --application <application id>. Read the
actual immutable package selected by that installed entry; do not invent another workflow.
"""


def install_application_for_case(test_dir: Path, package: str, agent: str) -> str:
    context = application_eval_context()
    if context is None:
        return ""
    from scaffold.python.utils import run_command_in_docker
    import shlex

    platform = {"claude-code": "claude", "codex": "codex", "qoder": "qoder", "codebuddy": "codebuddy"}.get(agent)
    if platform is None:
        raise ValueError("SDK application Eval needs a registered installation platform for this Agent")
    command = "comet application distribute " + shlex.quote(package + "/scripts/application/application.json") + " --project /workspace --platform " + platform + " --json"
    preview_result = run_command_in_docker(test_dir, command, 120)
    preview = json.loads(preview_result.stdout)
    if preview_result.returncode != 0 or preview.get("contentHash") != context["preview"]["application"]["contentHash"]:
        raise ValueError("SDK application installation preview did not match the fixed candidate")
    installed_result = run_command_in_docker(test_dir, command + " --confirmation-hash " + shlex.quote(preview["confirmationHash"]), 120)
    if installed_result.returncode != 0:
        raise ValueError("SDK application installation failed before model execution")
    installed = json.loads(installed_result.stdout)
    expected = "/workspace/.comet/applications/" + context["preview"]["application"]["id"] + "/versions/" + context["preview"]["application"]["contentHash"] + "/application.json"
    if installed.get("file") != expected:
        raise ValueError("SDK application installation selected another immutable package")
    return expected


def application_execution_prompt(prompt: str, package: str, file: str) -> str:
    context = application_eval_context()
    if context is None:
        return prompt
    return (
        "[SDK application evaluation]\nThe controller installed the actual " + context["preview"]["application"]["id"]
        + " application Skill and its fixed dependencies. Load that Skill and follow its Runtime instructions. "
        + "The immutable application file is " + file + ". The original workflow definitions and contracts are in "
        + package + "/references/workflows.json. Keep actual Run/Action/Wait identities; do not create a replacement workflow or fabricate state.\n\n"
        + prompt
    )


def application_runs_validator(test_dir: Path, outputs: dict) -> tuple[list[str], list[str]]:
    context = application_eval_context()
    if context is None:
        return [], []
    from scaffold.python.utils import run_command_in_docker

    identity = context["preview"]["application"]
    package = outputs.get("skill_package_path")
    if not isinstance(package, str) or not package:
        return [], ["SDK application package snapshot is unavailable"]
    root = test_dir / ".comet/runtime/applications" / identity["id"]
    passed: list[str] = []
    failed: list[str] = []
    observed: set[str] = set()
    executed: set[str] = set()
    choices: set[str] = set()
    recovered: set[str] = set()
    runs = sorted(root.glob("*")) if root.is_dir() else []
    for directory in runs:
        if directory.is_symlink() or not directory.is_dir():
            failed.append("SDK Run storage contains an invalid directory")
            continue
        revisions = sorted(directory.glob("[0-9]" * 16 + ".json"))
        if not revisions:
            continue
        try:
            saved = json.loads(revisions[-1].read_text(encoding="utf-8"))
            run_id = saved["run"]["runId"]
            request = test_dir / ".eval-sdk-inspect.json"
            request.write_text(json.dumps({"operation": "inspect", "runId": run_id}), encoding="utf-8")
            import shlex

            command = (
                "comet runtime dispatch --application "
                + shlex.quote(identity["id"])
                + " --project-root /workspace --request .eval-sdk-inspect.json --details --json"
            )
            actual = run_command_in_docker(test_dir, command, 60)
            result = json.loads(actual.stdout)
            if actual.returncode != 0 or result.get("status") != "succeeded":
                raise ValueError("Runtime inspection rejected the Run")
            run = result["data"]
            if result["application"]["id"] != identity["id"] or result["application"]["version"] != identity["version"]:
                raise ValueError("Run belongs to another application version")
            if result["application"]["contentHash"] != context["preview"]["runtimeIdentityHash"]:
                raise ValueError("Application implementation or fixed dependencies changed inside the evaluation")
            expected = next((workflow for workflow in context["preview"]["workflows"] if workflow["id"] == run["workflow"]["id"]), None)
            if expected is None or expected["definitionHash"] != run["workflow"]["hash"]:
                raise ValueError("Actual SDK Run uses another workflow definition")
            for action in run["actions"]:
                if action["status"] == "succeeded":
                    observed.add(run["workflow"]["id"] + "/" + action["stepId"])
                    executed.add(run["workflow"]["id"] + "/" + action["stepId"])
                    if action["attempt"] > 1:
                        recovered.add(run["workflow"]["id"] + "/" + action["stepId"])
            for wait in run["waits"]:
                observed.add(run["workflow"]["id"] + "/" + wait["stepId"])
                if wait.get("decision"):
                    executed.add(run["workflow"]["id"] + "/" + wait["stepId"])
                    choices.add(run["workflow"]["id"] + "/" + wait["stepId"] + "/" + wait["decision"]["choice"])
            passed.append("SDK Run inspected by actual Runtime: " + run_id)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            failed.append("SDK Run evidence rejected: " + str(exc))
    if not passed:
        failed.append("No actual SDK application Run was verified")
    outputs["application_coverage"] = sorted(observed)
    outputs["application_executed_steps"] = sorted(executed)
    outputs["application_choices"] = sorted(choices)
    outputs["application_recovery"] = sorted(recovered)
    return passed, failed


def write_application_result(logger) -> None:
    context = application_eval_context()
    if context is None:
        return
    results = [result for runs in logger.results.values() for result in runs]
    names = sorted({result.events_summary.get("task", "") for result in results} - {""})
    preview = context["preview"]
    covered = {step for result in results for step in result.events_summary.get("application_coverage", [])}
    executed = {step for result in results for step in result.events_summary.get("application_executed_steps", [])}
    covered_choices = {choice for result in results for choice in result.events_summary.get("application_choices", [])}
    declared_choices = {workflow["id"] + "/" + step + "/" + choice for workflow in preview["workflows"] for step, spec in workflow.get("definition", {}).get("steps", {}).items() for choice in spec.get("choices", [])}
    declared = {workflow["id"] + "/" + step for workflow in preview["workflows"] for step in workflow["steps"]}
    failures = [check for result in results for check in result.checks_failed]
    complete = 2 <= len(names) <= 4 and len(results) == len(names)
    verified = all(any(check.startswith("SDK Run inspected by actual Runtime:") for check in result.checks_passed) for result in results)
    if not executed:
        verified = False
        failures.append("No SDK workflow step or decision was actually executed")
    clean = all(result.events_summary.get("sample_quality", {}).get("status", "included") == "included" for result in results)
    exitstatus = getattr(logger, "metadata", {}).get("pytest_exitstatus", 0)
    harness_complete = exitstatus in {0, 1} and not (exitstatus == 1 and all(result.passed for result in results))
    status = "passed" if complete and clean and verified and harness_complete and all(result.passed for result in results) else "failed" if complete and clean and verified and harness_complete else "incomplete"
    models = set()
    for case in results:
        reported = case.events_summary.get("model_usage") or {}
        if isinstance(reported, dict) and reported:
            models.update(name for name in reported if isinstance(name, str) and name)
        else:
            selected = (case.events_summary.get("execution_identity") or {}).get("model")
            if selected:
                models.add(str(selected))
    costs = [case.total_cost_usd for case in results]
    known_cost = sum(cost for cost in costs if cost is not None)
    result = {
        "schema": "comet.workflow.application.eval.result.v1",
        "experimentId": context["experimentId"],
        "confirmationHash": preview["confirmationHash"],
        "snapshotHash": context["snapshotHash"],
        "application": preview["application"],
        "settings": preview["settings"],
        "status": status,
        "taskNames": names,
        "passed": sum(result.passed for result in results),
        "total": len(results),
        "report": "summary.html" if (logger.base_dir / "summary.html").is_file() else "summary.md",
        "limitations": [*preview["limitations"], "Uncovered SDK steps: " + ", ".join(sorted(declared - covered)), "Uncovered decisions: " + ", ".join(sorted(declared_choices - covered_choices))],
        "failures": failures,
        "coveredSteps": sorted(covered),
        "executedSteps": sorted(executed),
        "uncoveredSteps": sorted(declared - covered),
        "coveredChoices": sorted(covered_choices),
        "uncoveredChoices": sorted(declared_choices - covered_choices),
        "recoveredActions": sorted({step for result in results for step in result.events_summary.get("application_recovery", [])}),
        "actualModels": sorted(models),
        "modelIdentityAvailable": bool(models),
        "caseCostUsd": known_cost if costs and all(cost is not None for cost in costs) else None,
        "knownCaseCostUsd": known_cost if any(cost is not None for cost in costs) else None,
        "costUsd": None,
        "costStatus": "case-costs-only" if costs and all(cost is not None for cost in costs) else "partial" if any(cost is not None for cost in costs) else "unavailable",
        **({"taskSet": logger.metadata["application_task_set"]} if getattr(logger, "metadata", {}).get("application_task_set") else {}),
    }
    # The output location is selected by the same controller-owned experiment identity.
    target = logger.base_dir / "application-result.json"
    if target.resolve() != Path(context["resultFile"]).resolve():
        raise ValueError("SDK application report is outside the selected experiment")
    from scaffold.python.logging import _atomic_write_json

    _atomic_write_json(target, result)
