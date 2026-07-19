"""Comet skill rubric validator.

Scores a comet workflow run across nine dimensions by analysing the
captured Claude events and the artifacts left in the test directory. Every
dimension emits a single check message of the form::

    [RUBRIC] <dim>: <score> - <reason>

where ``<score>`` is 0.0-1.0 (pass rate of binary checks) and ``<reason>`` is a
short human-readable justification. The logging layer parses these messages to
build per-dimension columns in the experiment summary.

Scoring methodology (aligned with industry best practices from Galileo, Hebbia,
τ-bench):
- Each dimension contains N binary pass/fail checks
- Dimension score = passed / total checks (0.0-1.0)
- Final weighted score = Σ(dimension_score × weight) / Σ(weight)
- Weights reflect dimension importance to workflow quality

Dimensions
----------
1. main_flow              - how many workflow-specific phases left evidence (weight 1.5)
2. gate_guard             - whether comet-guard / comet-state transition / --apply were used (weight 1.5)
3. skill_invocation       - whether the comet entry, nested stage skills, and dependency skills were invoked (weight 1.0)
4. spec_drift             - whether delta specs created during build were reconciled before archive (weight 1.0)
5. business_completion    - fraction of business validators that passed (weight 2.0)
6. workflow_completion    - fraction of workflow validators that passed (weight 1.0)
7. efficiency             - normalised cost (turns / tool calls / duration; lower is better) (weight 0.8)
8. decision_point_compliance - whether agent paused at blocking decision points instead of auto-deciding (weight 1.0)
9. artifact_quality       - whether proposal/design/tasks/test artefacts have substantive content (weight 1.2)
10. recovery_resilience   - whether the agent preserved and restored state correctly across interruptions (weight 1.0)
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

# All nine rubric dimensions, in display order.
RUBRIC_DIMENSIONS = (
    "main_flow",
    "gate_guard",
    "skill_invocation",
    "spec_drift",
    "business_completion",
    "workflow_completion",
    "efficiency",
    "decision_point_compliance",
    "artifact_quality",
    "recovery_resilience",
)

# Dimension weights: critical dimensions get higher relative weight.
# Raw weights need not sum to 1.0; they are normalized during aggregation.
_DIMENSION_WEIGHTS: dict[str, float] = {
    "business_completion": 2.0,      # Must complete the user-visible task
    "workflow_completion": 1.0,      # Workflow-specific validator completion
    "main_flow": 1.5,                # Core 5-phase workflow
    "gate_guard": 1.5,               # Quality gate enforcement
    "artifact_quality": 1.2,         # Substantive deliverables
    "skill_invocation": 1.0,         # Correct skill ordering
    "spec_drift": 1.0,               # Spec reconciliation
    "decision_point_compliance": 1.0, # User confirmation at gates
    "recovery_resilience": 1.0,      # State preservation
    "efficiency": 0.8,               # Nice-to-have, not critical
}

# Comet stage skills and dependency skills that should be observable as real
# Skill tool invocations, not inferred from generated artifacts.
_COMET_STAGE_SKILLS = (
    "comet-open",
    "comet-design",
    "comet-build",
    "comet-verify",
    "comet-archive",
    "comet-hotfix",
    "comet-tweak",
)

_SUPERPOWERS_DEPENDENCY_SKILLS = (
    "brainstorming",
    "dispatching-parallel-agents",
    "executing-plans",
    "finishing-a-development-branch",
    "requesting-code-review",
    "subagent-driven-development",
    "systematic-debugging",
    "test-driven-development",
    "using-git-worktrees",
    "verification-before-completion",
    "writing-plans",
)

# Decision-point state mutations that must be preceded by an explicit user
# confirmation (per comet/reference/decision-point.md). If any of these appear
# in commands_run without a nearby "ask"/"confirm" tool signal it is a
# compliance smell.
_DECISION_MUTATIONS = (
    re.compile(r"transition\s+\S+\s+(?:open-complete|design-complete|build-complete|verify-pass|verify-fail|preset-escalate)"),
    re.compile(r"set\s+\S+\s+(?:build_mode|isolation|tdd_mode|review_mode|build_pause)\s"),
)

# Files whose creation signals a given phase produced artefacts.
# Comet writes to several locations; cover both the canonical openspec/changes
# layout and the docs/superpowers/ + openspec/archive/ layouts actually used.
_PHASE_SIGNALS = {
    "open": (
        re.compile(r"openspec/changes/[^/]+/(?:proposal|tasks)\.md"),
        re.compile(r"openspec/changes/archive/[^/]+/(?:proposal|tasks)\.md"),
    ),
    "design": (
        re.compile(r"docs/superpowers/specs/.+\.md"),
        re.compile(r"openspec/changes/(?:archive/)?[^/]+/design\.md"),
    ),
    "build": (
        re.compile(r"openspec/changes/(?:archive/)?[^/]+/plan\.md"),
        re.compile(r"docs/superpowers/plans/.+\.md"),
        re.compile(r"openspec/changes/(?:archive/)?[^/]+/\.comet/"),
    ),
    "verify": (
        re.compile(r"openspec/changes/(?:archive/)?[^/]+/verification\.md"),
        re.compile(r"docs/superpowers/reports/.+\.md"),
    ),
    "archive": (
        re.compile(r"openspec/changes/archive/"),
        re.compile(r"openspec/archive/"),
    ),
}

# Substantive-content keywords for the design doc (brainstorming depth signals).
_DESIGN_DEPTH_KEYWORDS = (
    "tradeoff",
    "alternative",
    "risk",
    "consider",
    "option",
    "权衡",
    "替代",
    "风险",
    "考虑",
    "方案",
)

_WORKFLOW_PHASES = {
    "full": ("open", "design", "build", "verify", "archive"),
    "hotfix": ("open", "build", "verify", "archive"),
    "tweak": ("open", "build", "verify", "archive"),
}

_PRESET_DECISION_MUTATIONS = (
    re.compile(r"transition\s+\S+\s+(?:verify-fail|preset-escalate|archive-reopen)"),
)


def _fmt(dim: str, score: float, reason: str) -> str:
    return f"[RUBRIC] {dim}: {score:.2f} - {reason}"


def _fmt_na(dim: str, reason: str) -> str:
    return f"[RUBRIC] {dim}: N/A - {reason}"


def _fmt_weighted(score: float) -> str:
    return f"[RUBRIC] weighted_score: {score:.2f}"


def _join_commands(events: dict[str, Any]) -> str:
    return "\n".join(events.get("commands_run", []) or [])


def _binary_score(checks: list[bool]) -> tuple[float, str]:
    """Convert a list of binary checks to a pass-rate score.

    Returns (pass_rate, summary) where pass_rate = passed / total.
    """
    total = len(checks)
    if total == 0:
        return 0.0, "no checks"
    passed = sum(1 for c in checks if c)
    return passed / total, f"{passed}/{total} passed"


def _find_change_dir(test_dir: Path) -> Path | None:
    """Find the comet change directory (active or archived)."""
    changes_root = test_dir / "openspec" / "changes"
    if not changes_root.exists():
        return None

    for d in changes_root.iterdir():
        if not d.is_dir():
            continue
        if d.name == "archive":
            for sub in d.iterdir():
                if sub.is_dir() and (
                    (sub / ".comet.yaml").exists()
                    or (sub / ".comet").exists()
                    or (sub / "proposal.md").exists()
                    or (sub / "tasks.md").exists()
                ):
                    return sub
        elif (
            (d / ".comet.yaml").exists()
            or (d / ".comet").exists()
            or (d / "proposal.md").exists()
            or (d / "tasks.md").exists()
        ):
            return d
    return None


def _detect_workflow_kind(events: dict[str, Any], test_dir: Path) -> str:
    """Detect full/hotfix/tweak from observed Skill calls or .comet.yaml."""
    invoked = events.get("skills_invoked", []) or []
    if "comet-hotfix" in invoked:
        return "hotfix"
    if "comet-tweak" in invoked:
        return "tweak"

    cdir = _find_change_dir(test_dir)
    yaml_path = cdir / ".comet.yaml" if cdir else None
    if yaml_path and yaml_path.exists():
        try:
            yaml_content = yaml_path.read_text(errors="ignore")
            match = re.search(
                r"(?m)^\s*(?:workflow|classic_profile):\s*(full|hotfix|tweak)\b",
                yaml_content,
            )
            if match:
                return match.group(1)
        except Exception:
            pass

    state_events_path = cdir / ".comet" / "state-events.jsonl" if cdir else None
    if state_events_path and state_events_path.exists():
        try:
            state_events = state_events_path.read_text(errors="ignore")
            match = re.search(r'"workflow"\s*:\s*"(full|hotfix|tweak)"', state_events)
            if match:
                return match.group(1)
        except Exception:
            pass

    return "full"


def _artifact_haystack(events: dict[str, Any], test_dir: Path) -> str:
    files = list(events.get("files_created", [])) + list(events.get("files_modified", []))
    try:
        on_disk = [
            str(p.relative_to(test_dir)).replace("\\", "/")
            for p in test_dir.rglob("*")
            if p.is_file()
        ]
    except Exception:
        on_disk = []
    return "\n".join(files + on_disk)


def _score_main_flow(
    events: dict[str, Any], test_dir: Path, workflow: str
) -> tuple[float, str]:
    """Check which workflow-specific phases left evidence."""
    haystack = _artifact_haystack(events, test_dir)

    expected_phases = _WORKFLOW_PHASES[workflow]
    phase_checks: list[bool] = []
    phases_reached: list[str] = []
    for phase in expected_phases:
        patterns = _PHASE_SIGNALS[phase]
        found = any(p.search(haystack) for p in patterns)
        phase_checks.append(found)
        if found:
            phases_reached.append(phase)

    score, _ = _binary_score(phase_checks)
    return (
        score,
        "workflow={workflow} {reached}/{total} phases ({phases})".format(
            workflow=workflow,
            reached=len(phases_reached),
            total=len(expected_phases),
            phases=", ".join(phases_reached) if phases_reached else "none",
        ),
    )


def _score_gate_guard(events: dict[str, Any]) -> tuple[float, str]:
    """Check guard/state/apply usage. Binary checks: guard used, transitions used, apply used."""
    cmds = _join_commands(events)
    if not cmds:
        return 0.0, "no commands captured"

    guard_used = bool(re.search(r"comet-guard", cmds))
    transition_used = bool(re.search(r"transition\s+\S+\s+(?:open|design|build|verify|archive)", cmds))
    apply_used = bool(re.search(r"--apply", cmds))

    checks = [guard_used, transition_used, apply_used]
    score, _ = _binary_score(checks)

    guard_hits = len(re.findall(r"comet-guard", cmds))
    transition_hits = len(re.findall(r"transition\s+\S+\s+(?:open|design|build|verify|archive)", cmds))
    apply_hits = len(re.findall(r"--apply", cmds))

    return score, f"guard={guard_hits} transition={transition_hits} apply={apply_hits}"


def _score_skill_invocation(events: dict[str, Any]) -> tuple[float, str]:
    """Check real Skill tool usage across Comet stage and dependency layers."""
    invoked = events.get("skills_invoked", []) or []
    if not invoked:
        return 0.0, "no skills invoked"

    comet_entry = "comet" in invoked
    comet_stage_invoked = [skill for skill in invoked if skill in _COMET_STAGE_SKILLS]
    openspec_invoked = [skill for skill in invoked if skill.startswith("openspec-")]
    superpowers_invoked = [
        skill for skill in invoked if skill in _SUPERPOWERS_DEPENDENCY_SKILLS
    ]
    if comet_stage_invoked:
        first_stage_index = min(invoked.index(skill) for skill in comet_stage_invoked)
    else:
        first_stage_index = -1
    entry_before_stage = comet_entry and first_stage_index > invoked.index("comet")

    checks = [
        comet_entry,
        bool(comet_stage_invoked),
        bool(openspec_invoked),
        bool(superpowers_invoked),
        entry_before_stage,
    ]
    score, _ = _binary_score(checks)

    return (
        score,
        "entry={entry} comet_stage={stage} openspec={openspec} "
        "superpowers={superpowers} order={order}".format(
            entry="comet" if comet_entry else "missing",
            stage=", ".join(comet_stage_invoked) if comet_stage_invoked else "missing",
            openspec=", ".join(openspec_invoked) if openspec_invoked else "missing",
            superpowers=", ".join(superpowers_invoked) if superpowers_invoked else "missing",
            order="entry-before-stage" if entry_before_stage else "missing",
        ),
    )


def _score_spec_drift(events: dict[str, Any], test_dir: Path) -> tuple[float, str]:
    """Check delta spec reconciliation. Binary: spec written AND synced."""
    cmds = _join_commands(events)
    files = list(events.get("files_modified", [])) + list(events.get("files_created", []))

    spec_touched = any("specs/" in f and "openspec/changes" in f for f in files)
    spec_synced = bool(re.search(r"openspec\s+(?:sync|archive)", cmds))

    if not spec_touched:
        # No delta spec needed — neutral pass (not applicable)
        return 1.0, "no delta spec needed (n/a)"

    # Binary: was it synced?
    checks = [spec_touched, spec_synced]
    score, _ = _binary_score(checks)
    return score, f"spec_written={spec_touched} spec_synced={spec_synced}"


def _score_completion(outputs: dict[str, Any], key: str = "completion") -> tuple[float, str]:
    """Check validator pass rate. Already a ratio (0.0-1.0)."""
    checks = outputs.get(key) or {}
    passed = checks.get("passed", [])
    failed = checks.get("failed", [])
    total = len(passed) + len(failed)
    if total == 0:
        return 0.0, "no baseline checks ran"
    ratio = len(passed) / total
    return float(ratio), f"{len(passed)}/{total} baseline checks passed"


def _score_efficiency(events: dict[str, Any]) -> tuple[float, str]:
    """Check efficiency via binary thresholds. Each metric is pass/fail at threshold."""
    turns = events.get("num_turns") or 0
    tool_calls = len(events.get("tool_calls", []))
    duration = events.get("duration_seconds") or 0

    # Binary thresholds: "good enough" vs "too expensive"
    turns_ok = turns <= 80
    tools_ok = tool_calls <= 150
    duration_ok = duration <= 600

    checks = [turns_ok, tools_ok, duration_ok]
    score, _ = _binary_score(checks)
    return score, f"turns={turns} tools={tool_calls} dur={duration:.0f}s"


def _score_decision_point_compliance(
    events: dict[str, Any], workflow: str
) -> tuple[float, str]:
    """Check if agent asked user at decision points. Binary: ratio >= 0.5."""
    cmds = _join_commands(events)
    tool_calls = events.get("tool_calls", []) or []

    if not cmds:
        return 0.0, "no commands captured"

    ask_signals = sum(
        1
        for tc in tool_calls
        if tc.get("tool") in {"AskUserQuestion", "ask_user", "AskFollowUpQuestion"}
    )

    mutation_patterns = (
        _DECISION_MUTATIONS if workflow == "full" else _PRESET_DECISION_MUTATIONS
    )
    mutations = sum(len(rx.findall(cmds)) for rx in mutation_patterns)

    if mutations == 0:
        # No decision points reached — neutral pass
        return 1.0, f"no {workflow} decision mutations observed"

    # Binary: did the agent ask at least once per mutation?
    ratio = ask_signals / max(mutations, 1)
    checks = [ratio >= 0.5]
    score, _ = _binary_score(checks)
    return (
        score,
        f"workflow={workflow} {ask_signals} asks for {mutations} mutations "
        f"(ratio={ratio:.2f})",
    )


def _score_artifact_quality(test_dir: Path, workflow: str) -> tuple[float, str]:
    """Check artifact quality via binary checks per artifact type."""
    changes_root = test_dir / "openspec" / "changes"
    change_dirs: list[Path] = []
    if changes_root.exists():
        for d in changes_root.iterdir():
            if not d.is_dir():
                continue
            if d.name == "archive":
                change_dirs.extend(s for s in d.iterdir() if s.is_dir())
            elif (d / "proposal.md").exists() or (d / "tasks.md").exists():
                change_dirs.append(d)

    if not change_dirs:
        return 0.0, "no openspec change directory"

    cdir = change_dirs[0]
    checks: list[bool] = []
    notes: list[str] = []

    # Check 1: Proposal has substance (>= 10 lines)
    prop = cdir / "proposal.md"
    prop_text = prop.read_text(errors="ignore") if prop.exists() else ""
    prop_ok = prop_text.count("\n") >= 10
    checks.append(prop_ok)
    notes.append(f"workflow={workflow} proposal={'ok' if prop_ok else 'stub'}")

    # Check 2: Design doc exists with depth keywords
    design = cdir / "design.md"
    if workflow == "full":
        dtext = design.read_text(errors="ignore").lower() if design.exists() else ""
        depth_hits = sum(1 for kw in _DESIGN_DEPTH_KEYWORDS if kw in dtext)
        design_ok = design.exists() and depth_hits >= 2
        checks.append(design_ok)
        notes.append(f"design={'deep' if design_ok else 'shallow'}")
    elif design.exists():
        notes.append("design=preset-optional")

    # Check 3: Tasks has checkboxes
    tasks = cdir / "tasks.md"
    if tasks.exists():
        ttext = tasks.read_text(errors="ignore")
        checkboxes = len(re.findall(r"- \[[ x]\]", ttext))
        min_tasks = 3 if workflow == "full" else 1
        tasks_ok = checkboxes >= min_tasks
        checks.append(tasks_ok)
        notes.append(f"tasks={checkboxes} boxes")

    # Check 4: Tests have assertions
    test_files = list(test_dir.glob("test_*.py")) + list(test_dir.glob("**/test_*.py"))
    test_has_assert = False
    for tf in test_files:
        try:
            if "assert" in tf.read_text(errors="ignore").lower():
                test_has_assert = True
                break
        except Exception:
            continue
    if workflow in {"full", "hotfix"} or test_files:
        checks.append(test_has_assert)
        notes.append(f"tests={'w/ assert' if test_has_assert else 'no assert'}")
    else:
        notes.append("tests=n/a")

    score, _ = _binary_score(checks)
    return score, "; ".join(notes)


def _score_recovery_resilience(
    events: dict[str, Any], test_dir: Path, workflow: str
) -> tuple[float, str]:
    """Check recovery artifacts via binary checks."""
    cdir = _find_change_dir(test_dir)
    if not cdir:
        return 0.0, "no comet change directory"

    comet_dir = cdir / ".comet"
    checks: list[bool] = []
    notes: list[str] = []

    # Check 1: Checkpoint exists and valid
    checkpoint_path = comet_dir / "checkpoint.json"
    state_events_path = comet_dir / "state-events.jsonl"
    run_state_path = comet_dir / "run-state.json"
    if checkpoint_path.exists():
        try:
            checkpoint = json.loads(checkpoint_path.read_text(errors="ignore"))
            checkpoint_ok = (
                bool(checkpoint.get("runId"))
                and "contextHash" in checkpoint
                and bool(checkpoint.get("artifactsHash"))
                and bool(checkpoint.get("createdAt"))
            )
            checks.append(checkpoint_ok)
            notes.append(f"checkpoint={'valid' if checkpoint_ok else 'invalid'}")
        except Exception:
            checks.append(False)
            notes.append("checkpoint=unreadable")
    elif state_events_path.exists() or run_state_path.exists():
        checks.append(True)
        notes.append("checkpoint=state-events")
    else:
        checks.append(False)
        notes.append("checkpoint=missing")

    # Check 2: Trajectory exists
    trajectory_files = list(comet_dir.glob("trajectory*.jsonl"))
    trajectory_ok = bool(trajectory_files)
    checks.append(trajectory_ok)
    notes.append(f"trajectory={'exists' if trajectory_ok else 'missing'}")

    # Check 3: Context snapshot exists
    context_files = list(comet_dir.glob("**/context.*"))
    handoff_dir = comet_dir / "handoff"
    handoff_files = list(handoff_dir.glob("*.md")) + list(handoff_dir.glob("*.json")) if handoff_dir.exists() else []
    context_ok = bool(context_files or handoff_files)
    if workflow == "full":
        checks.append(context_ok)
        notes.append(f"context={'exists' if context_ok else 'missing'}")
    else:
        notes.append(f"context={'exists' if context_ok else 'preset-n/a'}")

    # Check 4: No orphaned pending actions
    pending_files = list(comet_dir.glob("**/pending*.json"))
    pending_clean = True
    for pf in pending_files:
        try:
            content = json.loads(pf.read_text(errors="ignore"))
            if content:
                pending_clean = False
                break
        except Exception:
            pass
    checks.append(pending_clean)
    notes.append(f"pending={'clean' if pending_clean else 'orphaned'}")

    # Check 5: .comet.yaml has phase field
    yaml_path = cdir / ".comet.yaml"
    if yaml_path.exists():
        try:
            yaml_content = yaml_path.read_text(errors="ignore")
            yaml_ok = bool(re.search(r"phase:\s*\w+", yaml_content))
            checks.append(yaml_ok)
            notes.append(f"state={'ok' if yaml_ok else 'incomplete'}")
        except Exception:
            checks.append(False)
            notes.append("state=unreadable")
    elif run_state_path.exists():
        try:
            run_state = json.loads(run_state_path.read_text(errors="ignore"))
            state_ok = run_state.get("status") == "completed" or bool(
                run_state.get("currentStep")
            )
            checks.append(state_ok)
            notes.append(f"state={'ok' if state_ok else 'incomplete'}")
        except Exception:
            checks.append(False)
            notes.append("state=unreadable")
    else:
        checks.append(False)
        notes.append("state=missing")

    score, _ = _binary_score(checks)
    return score, "; ".join(notes)


def _compute_weighted_score(dimension_scores: dict[str, float | None]) -> float:
    """Compute weighted average across applicable dimensions."""
    total_weight = 0.0
    weighted_sum = 0.0
    for dim in RUBRIC_DIMENSIONS:
        score = dimension_scores.get(dim)
        if score is None:
            continue
        weight = _DIMENSION_WEIGHTS.get(dim, 1.0)
        weighted_sum += score * weight
        total_weight += weight
    return weighted_sum / total_weight if total_weight > 0 else 0.0


def _is_control_business_only(outputs: dict[str, Any]) -> bool:
    return (outputs or {}).get("treatment_name") == "CONTROL"


def _completion_input(outputs: dict[str, Any], key: str) -> dict[str, list[str]] | None:
    if key in outputs:
        return outputs.get(key) or {"passed": [], "failed": []}
    if key == "business_completion":
        return outputs.get("completion") or {"passed": [], "failed": []}
    return None


def comet_rubric_validator(test_dir: Path, outputs: dict) -> tuple[list[str], list[str]]:
    """Run all rubric dimensions and return (passed_messages, []).

    Rubric dimensions are informational scores (never hard failures); the
    comparison report aggregates them across treatments. Every dimension always
    emits exactly one ``[RUBRIC]`` message.

    Scoring: each dimension uses binary checks, score = pass rate (0.0-1.0).
    Final weighted score uses dimension weights to aggregate.
    """
    events = (outputs or {}).get("events", {}) or {}
    business_completion = _completion_input(outputs or {}, "business_completion")
    workflow_completion = _completion_input(outputs or {}, "workflow_completion")
    is_control = _is_control_business_only(outputs or {})
    workflow = _detect_workflow_kind(events, test_dir)

    if is_control:
        na_reason = "CONTROL business-only baseline"
        scored: list[tuple[str, float | None, str]] = [
            ("main_flow", None, na_reason),
            ("gate_guard", None, na_reason),
            ("skill_invocation", None, na_reason),
            ("spec_drift", None, na_reason),
            (
                "business_completion",
                *_score_completion(
                    {"business_completion": business_completion},
                    "business_completion",
                ),
            ),
            ("workflow_completion", None, na_reason),
            ("efficiency", *_score_efficiency(events)),
            ("decision_point_compliance", None, na_reason),
            ("artifact_quality", None, na_reason),
            ("recovery_resilience", None, na_reason),
        ]
    else:
        scored = [
            ("main_flow", *_score_main_flow(events, test_dir, workflow)),
            ("gate_guard", *_score_gate_guard(events)),
            ("skill_invocation", *_score_skill_invocation(events)),
            ("spec_drift", *_score_spec_drift(events, test_dir)),
            (
                "business_completion",
                *_score_completion(
                    {"business_completion": business_completion},
                    "business_completion",
                ),
            ),
            (
                "workflow_completion",
                None,
                "workflow validators not available",
            )
            if workflow_completion is None
            else (
                "workflow_completion",
                *_score_completion(
                    {"workflow_completion": workflow_completion},
                    "workflow_completion",
                ),
            ),
            ("efficiency", *_score_efficiency(events)),
            ("decision_point_compliance", *_score_decision_point_compliance(events, workflow)),
            ("artifact_quality", *_score_artifact_quality(test_dir, workflow)),
            ("recovery_resilience", *_score_recovery_resilience(events, test_dir, workflow)),
        ]

    # Build dimension scores dict for weighted computation
    dimension_scores: dict[str, float | None] = {}
    passed: list[str] = []
    failed: list[str] = []
    for dim, score, reason in scored:
        dimension_scores[dim] = score
        if score is None:
            passed.append(_fmt_na(dim, reason))
        else:
            passed.append(_fmt(dim, score, reason))

    # Add weighted overall score
    weighted = _compute_weighted_score(dimension_scores)
    passed.append(_fmt_weighted(weighted))

    if not is_control:
        invoked = events.get("skills_invoked", []) or []
        if "comet" not in invoked:
            failed.append("Required skill not invoked: comet")
        else:
            if not any(skill in invoked for skill in _COMET_STAGE_SKILLS):
                failed.append("Required nested Comet stage skill not invoked")
            if not any(skill.startswith("openspec-") for skill in invoked):
                failed.append("Required OpenSpec dependency skill not invoked")
            if not any(skill in invoked for skill in _SUPERPOWERS_DEPENDENCY_SKILLS):
                failed.append("Required Superpowers dependency skill not invoked")

    # Optional LLM-as-judge overlay: when BENCH_LLM_JUDGE=1, a judge model
    # re-scores the three qualitative dimensions (artifact_quality, spec_drift,
    # main_flow) by reading the actual artifacts. These [RUBRIC-JUDGE] messages
    # supplement (do not replace) the rule-based [RUBRIC] scores so the report
    # can show rule vs judge agreement.
    if os.environ.get("BENCH_LLM_JUDGE") == "1":
        try:
            from scaffold.python.llm_judge import judge_messages

            judge_results = judge_messages(test_dir)
            passed.extend(judge_results)
            if any(
                result.startswith("[RUBRIC-JUDGE] ") and " status:" not in result
                for result in judge_results
            ):
                passed.append("[RUBRIC-JUDGE] status: enabled_and_successful")
        except Exception as e:
            passed.append(f"[RUBRIC-JUDGE] status: failed - {e}")

    return passed, failed
