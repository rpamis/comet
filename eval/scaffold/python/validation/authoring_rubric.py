"""Rubric for generated `/comet-any` authoring Skill packages."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from scaffold.python.validation.generic_rubric import generic_rubric_validator

AUTHORING_RUBRIC_DIMENSIONS = (
    "completion",
    "skill_invocation",
    "artifact_presence",
    "generated_package",
    "resolved_skill_evidence",
    "engine_contract",
    "workflow_route_conformance",
    "authoring_lanes",
    "review_gate",
    "review_readiness",
    "safety_boundary",
)


def _fmt(dim: str, score: float, reason: str) -> str:
    return f"[RUBRIC] {dim}: {score:.2f} - {reason}"


def _fmt_na(dim: str, reason: str) -> str:
    return f"[RUBRIC] {dim}: N/A - {reason}"


def _package_path(test_dir: Path, outputs: dict[str, Any]) -> Path | None:
    raw = outputs.get("skill_package_path")
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else test_dir / path


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _binary_score(checks: list[bool]) -> float:
    return sum(1 for item in checks if item) / len(checks) if checks else 0.0


def _workflow_route(protocol: dict[str, Any]) -> list[str]:
    return [
        str(node.get("id"))
        for node in protocol.get("nodes") or []
        if isinstance(node, dict) and node.get("id") and not node.get("disabled")
    ]


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-")
    return slug or "node"


def _generated_node_skill_name(protocol: dict[str, Any], node_id: str) -> str:
    workflow_name = _slug(str(protocol.get("name") or "workflow"))
    return f"{workflow_name}-{_slug(node_id)}"


def _check_package(package: Path | None) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    skill = package / "SKILL.md"
    if not skill.exists():
        return 0.0, "SKILL.md missing", ["SKILL.md missing"]
    text = skill.read_text(encoding="utf-8")
    checks = [
        (
            bool(re.search(r"Workflow Nodes|工作流节点|workflow route|route", text, re.I)),
            "workflow route guidance missing",
        ),
        (
            bool(re.search(r"用户停顿点|decision point|stop", text, re.I)),
            "decision-point guidance missing",
        ),
        (
            "reference/workflow-protocol.json" in text and "reference/resolved-skills.json" in text,
            "workflow and resolved-skill references missing",
        ),
        (
            "workflow-guard" in text or "workflow-state" in text or "恢复" in text.lower(),
            "workflow guard or recovery guidance missing",
        ),
    ]
    failures = [reason for passed, reason in checks if not passed]
    score = (len(checks) - len(failures)) / len(checks)
    return score, f"{len(checks) - len(failures)}/{len(checks)} package checks passed", failures


def _check_resolved_evidence(package: Path | None) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    evidence = package / "reference" / "resolved-skills.json"
    if not evidence.exists():
        return 0.0, "resolved-skills.json missing", ["resolved-skills.json missing"]
    data = _read_json(evidence)
    if data is None:
        return 0.0, "resolved-skills.json invalid", ["resolved-skills.json invalid"]
    summaries = data.get("sourceSummaries") or []
    if not summaries:
        return 0.0, "sourceSummaries empty", ["sourceSummaries empty"]
    return 1.0, f"{len(summaries)} source summaries", []


def _check_engine_contract(package: Path | None) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    comet = package / "comet"
    expected = ["skill.yaml", "guardrails.yaml", "checks.yaml", "eval.yaml"]
    present = [name for name in expected if (comet / name).exists()]
    missing = [f"{name} missing" for name in expected if name not in present]
    if not present and not comet.exists():
        return 1.0, "Engine disabled for lightweight package", []
    legacy = (comet / "evals.yaml").exists()
    checks = [name in present for name in expected] + [not legacy]
    failures = missing + (["legacy evals.yaml present"] if legacy else [])
    return (
        _binary_score(checks),
        f"{len(present)}/{len(expected)} engine files present; legacy_evals={legacy}",
        failures,
    )


def _check_workflow_route_conformance(
    package: Path | None,
    outputs: dict[str, Any],
) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    protocol = _read_json(package / "reference" / "workflow-protocol.json")
    if protocol is None:
        return 0.0, "workflow-protocol.json missing or invalid", [
            "workflow-protocol.json missing or invalid"
        ]
    protocol_route = _workflow_route(protocol)
    expected_nodes = outputs.get("route_conformance_expected_node_order") or protocol_route
    generated_node_skills = outputs.get("generated_node_skills") or [
        _generated_node_skill_name(protocol, node_id) for node_id in protocol_route
    ]
    if not expected_nodes:
        return 0.0, "workflow route missing", ["workflow route missing"]
    route_matches = protocol_route == expected_nodes
    node_files = [
        (package.parent / node_skill / "SKILL.md").exists()
        for node_skill in generated_node_skills
    ]
    eval_manifest = package / "comet" / "eval.yaml"
    eval_text = eval_manifest.read_text(encoding="utf-8") if eval_manifest.exists() else ""
    eval_lists_route = (
        True
        if not eval_manifest.exists()
        else all(node_id in eval_text for node_id in expected_nodes)
        and all(node_skill in eval_text for node_skill in generated_node_skills)
        and ("workflow-route-conformance" in eval_text)
    )
    checks = [route_matches, all(node_files), eval_lists_route]
    failures = []
    if not route_matches:
        failures.append(
            f"workflow route mismatch: expected {expected_nodes}, got {protocol_route}"
        )
    if not all(node_files):
        missing = [
            node_skill
            for node_skill, exists in zip(generated_node_skills, node_files)
            if not exists
        ]
        failures.append(f"internal Node Skill missing: {', '.join(missing)}")
    if not eval_lists_route:
        failures.append("comet/eval.yaml missing workflow-route-conformance route entries")
    score = _binary_score(checks)
    return score, f"route={len(expected_nodes)} node(s) checks={sum(checks)}/{len(checks)}", failures


def _check_authoring_lanes(package: Path | None) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    lanes_path = package / "reference" / "authoring-lanes.json"
    data = _read_json(lanes_path)
    if data is None:
        return 0.0, "authoring-lanes.json missing or invalid", [
            "authoring-lanes.json missing or invalid"
        ]
    present = {
        lane
        if isinstance(lane, str)
        else lane.get("lane")
        for lane in data.get("lanes") or []
        if isinstance(lane, (str, dict))
    }
    required = {"script", "reference", "pause-points", "workflow-entry", "skill-core", "skill-review"}
    missing = sorted(required - present)
    review_passed = bool((data.get("review") or {}).get("passed"))
    checks = [not missing, review_passed]
    failures = []
    if missing:
        failures.append(f"authoring lanes missing: {', '.join(missing)}")
    if not review_passed:
        failures.append("authoring-lanes review did not pass")
    return _binary_score(checks), f"lanes={len(present)} review_passed={review_passed}", failures


def _check_review_gate(package: Path | None) -> tuple[float, str, list[str]]:
    if not package:
        return 0.0, "skill_package_path missing", ["skill_package_path missing"]
    review = package / "reference" / "skill-review.md"
    lanes = _read_json(package / "reference" / "authoring-lanes.json") or {}
    if not review.exists():
        return 0.0, "skill-review.md missing", ["skill-review.md missing"]
    text = review.read_text(encoding="utf-8")
    markdown_passed = bool(re.search(r"Review passed|Passed:\s*yes\b|审查通过|通过", text, re.I))
    lanes_passed = bool((lanes.get("review") or {}).get("passed"))
    blockers = (lanes.get("review") or {}).get("blockingFindings") or []
    checks = [markdown_passed, lanes_passed, len(blockers) == 0]
    failures = []
    if not markdown_passed:
        failures.append("skill-review.md does not report a passed review")
    if not lanes_passed:
        failures.append("authoring-lanes review did not pass")
    if blockers:
        failures.append(f"blocking findings present: {len(blockers)}")
    return _binary_score(checks), f"review_checks={sum(checks)}/{len(checks)}", failures


def _weighted(scores: dict[str, float | None]) -> float:
    weights = {
        "completion": 1.5,
        "skill_invocation": 1.0,
        "artifact_presence": 1.0,
        "generated_package": 1.4,
        "resolved_skill_evidence": 1.2,
        "engine_contract": 1.2,
        "workflow_route_conformance": 1.5,
        "authoring_lanes": 1.2,
        "review_gate": 0.8,
        "review_readiness": 0.8,
        "safety_boundary": 1.2,
    }
    applicable = {k: v for k, v in scores.items() if v is not None and k in weights}
    if not applicable:
        return 0.0
    total_weight = sum(weights[k] for k in applicable)
    return sum(applicable[k] * weights[k] for k in applicable) / total_weight


def _parse_generic_score(checks: list[str], name: str) -> float | None:
    prefix = f"[RUBRIC] {name}:"
    for item in checks:
        if item.startswith(prefix):
            remainder = item.removeprefix(prefix).strip()
            if remainder.startswith("N/A"):
                return None
            try:
                return float(remainder.split(" ", 1)[0])
            except ValueError:
                return 0.0
    return 0.0


def authoring_skill_rubric_validator(
    test_dir: Path,
    outputs: dict[str, Any],
) -> tuple[list[str], list[str]]:
    generic_passed, generic_failed = generic_rubric_validator(test_dir, outputs)
    package = _package_path(test_dir, outputs)
    package_score, package_reason, package_failures = _check_package(package)
    evidence_score, evidence_reason, evidence_failures = _check_resolved_evidence(package)
    engine_score, engine_reason, engine_failures = _check_engine_contract(package)
    route_score, route_reason, route_failures = _check_workflow_route_conformance(package, outputs)
    lanes_score, lanes_reason, lanes_failures = _check_authoring_lanes(package)
    review_gate_score, review_gate_reason, review_gate_failures = _check_review_gate(package)
    review_score = 1.0 if not generic_failed else 0.0
    review_reason = "no hard validation failures" if review_score == 1.0 else "hard failures present"

    scores = {
        "completion": _parse_generic_score(generic_passed, "completion"),
        "skill_invocation": _parse_generic_score(generic_passed, "skill_invocation"),
        "artifact_presence": _parse_generic_score(generic_passed, "artifact_presence"),
        "generated_package": package_score,
        "resolved_skill_evidence": evidence_score,
        "engine_contract": engine_score,
        "workflow_route_conformance": route_score,
        "authoring_lanes": lanes_score,
        "review_gate": review_gate_score,
        "review_readiness": review_score,
        "safety_boundary": _parse_generic_score(generic_passed, "safety_boundary"),
    }
    def _fmt_dim(dim: str, score: float | None, fallback_reason: str) -> str:
        if score is not None:
            return _fmt(dim, score, fallback_reason)
        return _fmt_na(dim, fallback_reason)

    passed = [
        _fmt_dim("completion", scores["completion"], "baseline completion score"),
        _fmt_dim("skill_invocation", scores["skill_invocation"], "required Skill invocation score"),
        _fmt_dim("artifact_presence", scores["artifact_presence"], "expected artifact score"),
        _fmt("generated_package", package_score, package_reason),
        _fmt("resolved_skill_evidence", evidence_score, evidence_reason),
        _fmt("engine_contract", engine_score, engine_reason),
        _fmt("workflow_route_conformance", route_score, route_reason),
        _fmt("authoring_lanes", lanes_score, lanes_reason),
        _fmt("review_gate", review_gate_score, review_gate_reason),
        _fmt("review_readiness", review_score, review_reason),
        _fmt_dim("safety_boundary", scores["safety_boundary"], "generic safety score"),
        f"[RUBRIC] weighted_score: {_weighted(scores):.2f}",
    ]
    failed = (
        generic_failed
        + package_failures
        + evidence_failures
        + engine_failures
        + route_failures
        + lanes_failures
        + review_gate_failures
    )
    return passed, failed
