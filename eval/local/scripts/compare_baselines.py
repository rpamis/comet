# ruff: noqa: E402
"""Compare comet baseline treatments across the rubric dimensions.

Reads experiment reports from ``local/logs/experiments/<id>/reports/*.json`` and
emits a markdown comparison report highlighting where the workflow (0.4.0-beta.1) baseline
scores below the 0.3.9 baseline.

Usage::

    uv run python local/scripts/compare_baselines.py [--experiment <id>] [--report-config <path>]

If ``--experiment`` is omitted the most recent experiment directory is used.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EVAL_ROOT = Path(__file__).resolve().parents[2]
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from scaffold.python.aligned_comparison import build_aligned_report
from scaffold.python.paths import get_logs_dir
from scaffold.python.report_outputs import (
    localize_eval_markdown,
    load_report_output_config,
    write_report_outputs,
)
from scaffold.python.pass_at_k import pass_metrics_table
from scaffold.python.sample_quality import quality_from_report, sample_quality_dict
from scaffold.python.validation.rubric import RUBRIC_DIMENSIONS, _DIMENSION_WEIGHTS

RUBRIC_RE = re.compile(r"\[RUBRIC\]\s+(\S+):\s*([0-9.]+)")
RUBRIC_JUDGE_RE = re.compile(r"\[RUBRIC-JUDGE\]\s+(\S+):\s*([0-9.]+)")
RUBRIC_DERIVED_METRICS = ("weighted_score",)
RUBRIC_DIMENSION_GUIDE = {
    "main_flow": "Completion of the expected Comet workflow phases.",
    "gate_guard": "Use of required guard, state transition, and apply checkpoints.",
    "skill_invocation": "Invocation of Comet, OpenSpec, and Superpowers dependency Skills.",
    "spec_drift": "Whether build-time spec changes were reconciled before archive.",
    "business_completion": "Business validator pass rate for the requested task behavior.",
    "workflow_completion": "Workflow validator pass rate for Comet workflow artifacts.",
    "efficiency": "Runtime effort score from turns, tool calls, and duration.",
    "decision_point_compliance": "Whether blocking decision points were surfaced instead of auto-decided.",
    "artifact_quality": "Whether generated proposal, design, task, and test artifacts are substantive.",
    "recovery_resilience": "Whether workflow state was preserved and recovered across interruptions.",
}

# Treatments we compare. CONTROL is included for context but not used in the
# pass/fail decision.
TREATMENTS = ("CONTROL", "COMET_FULL_040_BETA", "COMET_FULL_039")
KNOWN_TREATMENTS = (*TREATMENTS, "COMET_NATIVE_PHASE1")
WORKFLOW = "COMET_FULL_040_BETA"
BASELINE = "COMET_FULL_039"


@dataclass(frozen=True)
class ReportPartitions:
    raw: dict[str, list[dict]]
    analysis: dict[str, list[dict]]
    flagged: dict[str, list[dict]]
    excluded: dict[str, list[dict]]


def _treatment_from_report_name(raw_name: str) -> str:
    for treatment in sorted(KNOWN_TREATMENTS, key=len, reverse=True):
        if re.search(rf"(?:^|-){re.escape(treatment)}(?:-r\d+)?$", raw_name):
            return treatment
    return raw_name


def _latest_experiment(logs: Path) -> Path | None:
    exp_root = logs / "experiments"
    if not exp_root.exists():
        return None
    dirs = sorted([d for d in exp_root.iterdir() if d.is_dir()], key=lambda p: p.stat().st_mtime)
    return dirs[-1] if dirs else None


def _resolve_experiment(value: str, logs: Path) -> Path:
    """Resolve an experiment id or an explicit local/langsmith experiment path."""
    supplied = Path(value).expanduser()
    candidates = [
        supplied,
        EVAL_ROOT / supplied,
        logs / "experiments" / value,
        EVAL_ROOT / "local" / "logs" / "experiments" / value,
        EVAL_ROOT / "langsmith" / "logs" / "experiments" / value,
    ]
    matches: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved in seen or not (resolved / "reports").is_dir():
            continue
        seen.add(resolved)
        matches.append(resolved)
    if not matches:
        raise FileNotFoundError(f"Experiment not found: {value}")
    if len(matches) > 1:
        rendered = ", ".join(str(path) for path in matches)
        raise ValueError(f"Experiment id is ambiguous; pass an explicit path: {rendered}")
    return matches[0]


def _run_passed(report: dict) -> bool:
    """A run 'passes' when its task-level validator has zero failures.

    Rubric [RUBRIC]/[RUBRIC-JUDGE] checks are informational and never appear in
    checks_failed, so this reflects whether the feature was actually completed.
    """
    return len(report.get("checks_failed", [])) == 0


def _pass_fail_by_treatment(by_treatment: dict[str, list[dict]]) -> dict[str, list[bool]]:
    """Per-run pass/fail booleans keyed by treatment id."""
    return {t: [_run_passed(r) for r in reps] for t, reps in by_treatment.items()}


def _rubric_dimension_passed(report: dict, dim: str) -> bool | None:
    """Return True/False for a rubric dimension, or None when not applicable."""
    scores = _scores_from_report(report)
    if dim not in scores:
        return None
    return scores[dim] >= 1.0


def _pass_fail_by_rubric_dimension(
    by_treatment: dict[str, list[dict]],
    dim: str,
) -> dict[str, list[bool]]:
    """Per-run pass/fail booleans from a rubric dimension score."""
    by_metric: dict[str, list[bool]] = {}
    for treatment, reports in by_treatment.items():
        values: list[bool] = []
        for report in reports:
            passed = _rubric_dimension_passed(report, dim)
            if passed is not None:
                values.append(passed)
        by_metric[treatment] = values
    return by_metric


def _load_reports(experiment_dir: Path) -> dict[str, list[dict]]:
    """Group report JSON files by treatment name.

    Report ``name`` fields carry the ``<task>-<TREATMENT>`` form (e.g.
    ``comet-full-workflow-COMET_FULL_040_BETA``); we key by the canonical treatment id
    (``COMET_FULL_040_BETA``) so the rest of the script can use the short names.
    """
    reports_dir = experiment_dir / "reports"
    by_treatment: dict[str, list[dict]] = defaultdict(list)
    if not reports_dir.exists():
        return by_treatment
    for rf in sorted(reports_dir.glob("*.json")):
        try:
            data = json.loads(rf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        raw_name = data.get("name", "unknown")
        # Match the canonical treatment id, allowing pytest repetition suffixes
        # such as ``COMET_FULL_040_BETA-r1``.
        name = _treatment_from_report_name(raw_name)
        by_treatment[name].append(data)
    return by_treatment


def _partition_reports(
    by_treatment: dict[str, list[dict]],
    experiment_dir: Path,
) -> ReportPartitions:
    analysis: dict[str, list[dict]] = defaultdict(list)
    flagged: dict[str, list[dict]] = defaultdict(list)
    excluded: dict[str, list[dict]] = defaultdict(list)

    for treatment, reports in by_treatment.items():
        for report in reports:
            quality = quality_from_report(report, experiment_dir=experiment_dir)
            if quality.status == "excluded" or not quality.include_in_analysis:
                excluded[treatment].append(report)
            else:
                analysis[treatment].append(report)
                if quality.status == "flagged":
                    flagged[treatment].append(report)

    return ReportPartitions(
        raw={key: list(value) for key, value in by_treatment.items()},
        analysis={key: list(value) for key, value in analysis.items()},
        flagged={key: list(value) for key, value in flagged.items()},
        excluded={key: list(value) for key, value in excluded.items()},
    )


def _quality_counts(partitions: ReportPartitions, treatment: str) -> tuple[int, int, int, int]:
    raw = len(partitions.raw.get(treatment, []))
    analysis_set = len(partitions.analysis.get(treatment, []))
    flagged = len(partitions.flagged.get(treatment, []))
    excluded = len(partitions.excluded.get(treatment, []))
    return raw, analysis_set, flagged, excluded


def _report_ref(report: dict) -> str:
    return (
        (report.get("events_summary", {}).get("artifact_references") or {}).get("report")
        or report.get("run_id")
        or "none"
    )


def _scores_from_report(report: dict) -> dict[str, float]:
    """Parse rubric scores from a single report's passed checks."""
    scores: dict[str, float] = {}
    for check in report.get("checks_passed", []):
        m = RUBRIC_RE.search(check)
        if m:
            try:
                scores[m.group(1)] = float(m.group(2))
            except ValueError:
                continue
    return scores


def _judge_scores_from_report(report: dict) -> dict[str, float]:
    """Parse [RUBRIC-JUDGE] overlay scores (if LLM judge ran)."""
    scores: dict[str, float] = {}
    for check in report.get("checks_passed", []):
        m = RUBRIC_JUDGE_RE.search(check)
        if m:
            try:
                scores[m.group(1)] = float(m.group(2))
            except ValueError:
                continue
    return scores


def _aggregate_judge(reports: list[dict]) -> dict[str, dict[str, float]]:
    """Judge-overlay distribution stats (same shape as _aggregate)."""
    per_dim: dict[str, list[float]] = defaultdict(list)
    for rep in reports:
        for dim, score in _judge_scores_from_report(rep).items():
            per_dim[dim].append(score)
    result: dict[str, dict[str, float]] = {}
    for dim in ("artifact_quality", "spec_drift", "main_flow"):
        vals = per_dim.get(dim, [])
        n = len(vals)
        if not vals:
            result[dim] = {
                "mean": 0.0,
                "stdev": 0.0,
                "min": 0.0,
                "max": 0.0,
                "pass_rate": 0.0,
                "n": 0,
            }
            continue
        result[dim] = {
            "mean": statistics.fmean(vals),
            "stdev": statistics.pstdev(vals) if len(vals) > 1 else 0.0,
            "min": min(vals),
            "max": max(vals),
            "pass_rate": sum(1 for v in vals if v >= 0.5) / n,
            "n": n,
        }
    return result


def _aggregate(reports: list[dict]) -> dict[str, dict[str, float]]:
    """Per-dimension distribution stats across a treatment's reports.

    Returns ``{dim: {mean, stdev, min, max, pass_rate, n}}`` where pass_rate is
    the fraction of runs scoring >= 0.5 on that dimension (a "mostly passed"
    threshold) and n is the run count with a score for that dimension.
    """
    per_dim: dict[str, list[float]] = defaultdict(list)
    for rep in reports:
        for dim, score in _scores_from_report(rep).items():
            per_dim[dim].append(score)
    result: dict[str, dict[str, float]] = {}
    for dim in tuple(RUBRIC_DIMENSIONS) + RUBRIC_DERIVED_METRICS:
        vals = per_dim.get(dim, [])
        n = len(vals)
        if not vals:
            result[dim] = {
                "mean": 0.0,
                "stdev": 0.0,
                "min": 0.0,
                "max": 0.0,
                "pass_rate": 0.0,
                "n": 0,
            }
            continue
        mean = statistics.fmean(vals)
        stdev = statistics.pstdev(vals) if len(vals) > 1 else 0.0
        result[dim] = {
            "mean": mean,
            "stdev": stdev,
            "min": min(vals),
            "max": max(vals),
            "pass_rate": sum(1 for v in vals if v >= 0.5) / n,
            "n": n,
        }
    return result


def _overall(agg: dict[str, dict[str, float]]) -> float:
    """Use weighted_score if available, otherwise fall back to unweighted mean."""
    # weighted_score is computed by the new binary-check + weighted aggregation
    weighted = agg.get("weighted_score", {})
    if weighted and weighted.get("n", 0) > 0:
        return weighted["mean"]
    # Fallback: mean of per-dimension means (legacy behavior)
    vals = [agg.get(d, {}).get("mean", 0.0) for d in RUBRIC_DIMENSIONS]
    return statistics.fmean(vals) if vals else 0.0


def _fmt_dim(stats: dict[str, float] | None, with_dist: bool = False) -> str:
    """Format a dimension cell. With distribution: 'mean±std (pass%)'."""
    if not stats or stats.get("n", 0) == 0:
        return "/"
    mean = stats["mean"]
    if not with_dist or stats["n"] < 2:
        return f"{mean:.2f}"
    return f"{mean:.2f}±{stats['stdev']:.2f} ({stats['pass_rate'] * 100:.0f}%)"


def _sum_metric(reports: list[dict], key: str) -> int | float | None:
    values = [
        rep.get("events_summary", {}).get(key)
        for rep in reports
        if rep.get("events_summary", {}).get(key) is not None
    ]
    return sum(values) if values else None


def _fmt_tokens(value: int | float | None) -> str:
    return "N/A" if value is None else f"{value:,.0f}"


def _fmt_cost(value: int | float | None) -> str:
    return "N/A" if value is None else f"${value:.4f}"


def _fmt_seconds(value: int | float | None) -> str:
    return "N/A" if value is None else f"{value:,.0f}s"


def _fmt_average(value: int | float | None, decimals: int = 1) -> str:
    return "N/A" if value is None else f"{value:,.{decimals}f}"


def _quality_run_rows(
    reports: list[dict],
    treatment: str,
    experiment_dir: Path,
    *,
    include_column: bool,
) -> list[str]:
    rows: list[str] = []
    for report in reports:
        quality = sample_quality_dict(report, experiment_dir=experiment_dir)
        task = _task_name(report, treatment)
        evidence = _quality_evidence_summary(quality.get("evidence", []))
        include_text = (
            f" | {'yes' if quality.get('include_in_analysis') else 'no'}" if include_column else ""
        )
        rows.append(
            f"| `{report.get('run_id') or 'n/a'}` | {task} | {treatment} | "
            f"{quality.get('reason_code')} | {evidence}{include_text} | {_report_ref(report)} |"
        )
    return rows


def _quality_evidence_summary(evidence_items: list[Any]) -> str:
    raw = "\n".join(str(item) for item in evidence_items if item)
    if not raw:
        return "none"

    loop_lines = re.findall(r"^\s*\[loop\]\s+(.+)$", raw, flags=re.MULTILINE)
    if loop_lines:
        finished = re.search(r"\[loop\]\s+finished after\s+(\d+)\s+turns?", raw)
        turn_numbers = [
            int(match.group(1))
            for match in re.finditer(r"\[loop\]\s+turn\s+(\d+)/\d+", raw)
        ]
        turns = int(finished.group(1)) if finished else (max(turn_numbers) if turn_numbers else 0)
        replies = len(re.findall(r"\[loop\]\s+simulated reply", raw))
        turn_text = f"{turns} {'turn' if turns == 1 else 'turns'}"
        reply_text = f"{replies} simulated decision {'reply' if replies == 1 else 'replies'}"
        return f"loop trace: {turn_text}; {reply_text}; see report JSON for full evidence"

    summary = "; ".join(_collapse_table_cell_text(str(item)) for item in evidence_items[:2] if item)
    if len(summary) > 220:
        summary = f"{summary[:217].rstrip()}..."
    return summary or "none"


def _collapse_table_cell_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("|", "/")).strip()


def _overall_by_reports(reports: list[dict]) -> float | None:
    if not reports:
        return None
    return _overall(_aggregate(reports))


def _fmt_optional_score(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def _source_summary(report: dict, quality: dict[str, Any]) -> str:
    events = report.get("events_summary", {})
    run_id = report.get("run_id") or "n/a"
    profile = events.get("profile") or "n/a"
    sources = events.get("skill_sources") or []
    source_text = (
        ", ".join(
            (
                f"{item.get('name', 'skill')}@{item.get('hash', item.get('path', 'unknown'))}"
                if isinstance(item, dict)
                else str(item)
            )
            for item in sources
        )
        or "none"
    )
    manifest = events.get("eval_manifest") or "none"
    report_ref = (events.get("artifact_references") or {}).get("report", "none")
    return (
        f"| `{run_id}` | {quality.get('status')} | {quality.get('reason_code')} | "
        f"{profile} | {source_text} | {manifest} | {report_ref} |"
    )


def _task_name(report: dict, treatment: str) -> str:
    raw_name = str(report.get("name") or "unknown")
    match = re.match(rf"^(.*)-{re.escape(treatment)}(?:-r\d+)?$", raw_name)
    if match:
        return match.group(1)
    return raw_name


def _task_outcomes(by_treatment: dict[str, list[dict]]) -> dict[str, dict[str, bool]]:
    outcomes: dict[str, dict[str, bool]] = {}
    for treatment in TREATMENTS:
        for report in by_treatment.get(treatment, []):
            task = _task_name(report, treatment)
            outcomes.setdefault(task, {})[treatment] = _run_passed(report)
    return outcomes


# --- Attribution (improvement 2) -------------------------------------------
# Classify a failed check into one of three buckets:
#   business  - the requested business behavior did not pass validation
#   workflow  - the skill guidance is wrong/missing (skill not invoked, guard not used)
#   task      - the task/validator itself is ambiguous or buggy
#   uncategorized - valid completed failure that does not match a specific bucket
_ATTRIBUTION_RULES = [
    # (regex on failed-check text, bucket, reason)
    (
        re.compile(r"business validator failed|business[_ -]?completion", re.I),
        "business",
        "business implementation did not pass validation",
    ),
    (
        re.compile(r"workflow validator failed|workflow[_ -]?completion", re.I),
        "workflow",
        "workflow validation did not pass",
    ),
    (
        re.compile(r"skill.*(not invoke|not found)|did not invoke", re.I),
        "workflow",
        "skill was not invoked — workflow guidance failed to trigger the skill",
    ),
    (
        re.compile(r"guard|state|apply|transition", re.I),
        "workflow",
        "guard/state machinery not exercised — workflow did not drive phase transitions",
    ),
    (
        re.compile(r"--sentences|sentence_feature|wordcount", re.I),
        "business",
        "feature implementation incomplete",
    ),
    (
        re.compile(r"openspec_artifacts|not found in.*archive|directory not found", re.I),
        "task",
        "artifact path/layout mismatch — likely task/validator path assumption",
    ),
    (
        re.compile(r"comet_state|\.comet\.yaml", re.I),
        "workflow",
        "comet state file missing — workflow did not initialise state machine",
    ),
    (
        re.compile(r"tests_exist|no.*tests", re.I),
        "workflow",
        "expected tests were not written",
    ),
]


def _attribute_failure(check_text: str) -> tuple[str, str]:
    """Return (bucket, reason) for a failed check."""
    for rx, bucket, reason in _ATTRIBUTION_RULES:
        if rx.search(check_text):
            return bucket, reason
    return "uncategorized", "uncategorized valid failure"


def _attributions(reports: list[dict]) -> dict[str, list[str]]:
    """Bucket all failed checks across a treatment's runs by attribution."""
    buckets: dict[str, list[str]] = defaultdict(list)
    for rep in reports:
        structured = rep.get("events_summary", {}).get("failure_attribution") or []
        if structured:
            for item in structured:
                bucket = item.get("bucket", "uncategorized")
                buckets[bucket].append(
                    f"{item.get('check', '')}  ->  [{bucket}] {item.get('reason', '')}"
                )
            continue
        for fail in rep.get("checks_failed", []):
            # Skip rubric informational checks (they never fail, but be safe)
            if "[RUBRIC]" in fail:
                continue
            bucket, reason = _attribute_failure(fail)
            buckets[bucket].append(f"{fail}  →  [{bucket}] {reason}")
    return buckets


def _summarize_attribution_items(items: list[str]) -> list[str]:
    """Collapse repeated failure causes while preserving first-seen order."""
    counts: dict[str, int] = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    summarized = []
    for item, count in counts.items():
        summarized.append(f"x{count} {item}" if count > 1 else item)
    return summarized


def build_report(experiment_dir: Path) -> str:
    raw_by_treatment = _load_reports(experiment_dir)
    partitions = _partition_reports(raw_by_treatment, experiment_dir)
    by_treatment = partitions.analysis
    aggregated = {t: _aggregate(reps) for t, reps in by_treatment.items() if reps}

    lines: list[str] = []
    lines.append("# Comet Baseline Comparison Report")
    lines.append("")
    lines.append(f"- Experiment: `{experiment_dir.name}`")
    lines.append(f"- Treatments with data: {', '.join(sorted(raw_by_treatment)) or 'none'}")
    lines.append("")

    if not raw_by_treatment:
        lines.append("No report data found. Run the eval suite first.")
        return "\n".join(lines)

    lines.append("## Metric guide")
    lines.append("")
    lines.append("| Metric | Meaning | Source | Report section |")
    lines.append("|--------|---------|--------|----------------|")
    lines.append("| `raw runs` | All discovered report JSON files before quality filtering. | report files | Data quality summary |")
    lines.append("| `analysis set` | Runs included in comparison metrics after excluding hard infrastructure noise. | sample_quality.include_in_analysis | Data quality summary / Run counts |")
    lines.append("| `flagged` | Completed runs kept in analysis but marked as suspicious, usually harness/task/observability risk. | sample_quality.status | Data quality summary / Flagged runs |")
    lines.append("| `excluded` | Runs removed from headline metrics, typically API, quota, auth, network, container, or runner failures before a complete result. | sample_quality.status | Data quality summary / Excluded runs |")
    lines.append("| `pass@k` | Probability that at least one of k attempts succeeds; capability ceiling. | pass/fail booleans | pass@k / pass^k |")
    lines.append("| `pass^k` | Probability that all k attempts succeed; reliability floor. | pass/fail booleans | pass@k / pass^k |")
    lines.append("| `overall` | Run passes when task-level `checks_failed == []`. | checks_failed | pass@k / Task outcomes |")
    lines.append("| `business_completion` | Business validator pass rate; CONTROL is evaluated on this without requiring Comet workflow artifacts. | `[RUBRIC] business_completion` | Rubric dimensions / pass@k |")
    lines.append("| `workflow_completion` | Comet workflow validator pass rate; `/` means not applicable for CONTROL. | `[RUBRIC] workflow_completion` | Rubric dimensions / pass@k |")
    lines.append("| `weighted_score` | Weighted average across applicable rubric dimensions; N/A dimensions are skipped. | `[RUBRIC] weighted_score` | Rubric dimensions / Overall |")
    lines.append("| `tokens` / `cost` | Total model token and USD cost telemetry for included runs. | events_summary | Spend summary |")
    lines.append("| `turns` / `duration` / `tool calls` | Runtime effort telemetry for included runs; also feeds the `efficiency` rubric. | events_summary | Runtime summary / Rubric dimensions |")
    lines.append("| `run-level failed checks` | Buckets sample-level `checks_failed` entries into harness, business, workflow, task, or uncategorized causes; this is not the same as the task outcome matrix. | checks_failed / events_summary.failure_attribution | Run-level failed checks |")
    lines.append("| `source evidence` | Run id, quality status, profile, Skill source hashes, eval manifest, and raw report reference. | events_summary / sample_quality | Source evidence |")
    lines.append("")

    lines.append("## Data quality summary")
    lines.append("")
    lines.append("| Treatment | Raw runs | Analysis set | Flagged | Excluded |")
    lines.append("|-----------|----------|--------------|---------|----------|")
    for t in TREATMENTS:
        raw, analysis_set, flagged, excluded = _quality_counts(partitions, t)
        if raw == 0:
            continue
        lines.append(f"| {t} | {raw} | {analysis_set} | {flagged} | {excluded} |")
    lines.append("")

    lines.append("## Run counts")
    lines.append("")
    lines.append("_Analysis set only; excluded hard-noise runs are omitted._")
    lines.append("")
    lines.append("| Treatment | Runs |")
    lines.append("|-----------|------|")
    for t in TREATMENTS:
        if t in by_treatment:
            lines.append(f"| {t} | {len(by_treatment[t])} |")
    lines.append("")

    has_dist = any(len(by_treatment.get(t, [])) >= 2 for t in TREATMENTS)

    pass_fail_metrics = {
        "overall": _pass_fail_by_treatment(by_treatment),
        "business": _pass_fail_by_rubric_dimension(by_treatment, "business_completion"),
        "workflow": _pass_fail_by_rubric_dimension(by_treatment, "workflow_completion"),
    }
    max_n = max(
        (len(v) for metric_values in pass_fail_metrics.values() for v in metric_values.values()),
        default=0,
    )
    ks = [k for k in (1, 2, 3, 5) if k <= max_n] or [1]

    lines.append("## pass@k / pass^k — capability vs reliability")
    lines.append("")
    lines.append("- **pass@k**: probability ≥1 of k attempts succeeds (capability ceiling)")
    lines.append("- **pass^k**: probability all k attempts succeed (reliability floor)")
    lines.append("- **overall**: run passes when `checks_failed == []`.")
    lines.append("- **business**: run passes when `business_completion == 1.00`.")
    lines.append("- **workflow**: run passes when `workflow_completion == 1.00`; `/` means not applicable.")
    lines.append(
        "- The gap (pass@k − pass^k) measures instability: high ceiling, low floor = unreliable."
    )
    lines.append("")
    header_cells = ["Metric", "Treatment"]
    for k in ks:
        header_cells.append(f"pass@{k}")
    for k in ks:
        header_cells.append(f"pass^{k}")
    header_cells.append("pass/fail")
    lines.append("| " + " | ".join(header_cells) + " |")
    lines.append("|" + "|".join(["---"] * len(header_cells)) + "|")
    for metric_name, metric_values in pass_fail_metrics.items():
        ptable = pass_metrics_table(metric_values, ks=ks)
        for t in TREATMENTS:
            values = metric_values.get(t, [])
            if not values:
                cells = [metric_name, t] + ["/"] * (len(ks) * 2 + 1)
                lines.append("| " + " | ".join(cells) + " |")
                continue
            cells = [metric_name, t]
            for k in ks:
                cells.append(f"{ptable[t][k]['pass_at_k']:.2f}")
            for k in ks:
                cells.append(f"{ptable[t][k]['pass_pow_k']:.0f}")
            c = ptable[t][ks[0]]["c"]
            n = ptable[t][ks[0]]["n"]
            cells.append(f"{c}/{n}")
            lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    if max_n < 2:
        lines.append(
            f"_Only {max_n} run per treatment — pass@k/pass^k for k>1 need ≥2 runs "
            "to be meaningful. Use ``--count 5``._"
        )
        lines.append("")

    task_outcomes = _task_outcomes(by_treatment)
    if task_outcomes:
        lines.append("## Task outcomes")
        lines.append("")
        lines.append("| Task | " + " | ".join(TREATMENTS) + " |")
        lines.append("|------|" + "|".join(["------"] * len(TREATMENTS)) + "|")
        for task in sorted(task_outcomes):
            cells = [task]
            for treatment in TREATMENTS:
                if treatment not in task_outcomes[task]:
                    cells.append("—")
                else:
                    cells.append("PASS" if task_outcomes[task][treatment] else "FAIL")
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")

    lines.append("## Spend summary")
    lines.append("")
    lines.append("| Treatment | Runs | Tokens | Cost | Avg Tokens/Run | Avg Cost/Run |")
    lines.append("|-----------|------|--------|------|----------------|--------------|")
    for t in TREATMENTS:
        reps = by_treatment.get(t, [])
        if not reps:
            continue
        total_tokens = _sum_metric(reps, "total_tokens")
        total_cost = _sum_metric(reps, "total_cost_usd")
        avg_tokens = (total_tokens / len(reps)) if total_tokens is not None else None
        avg_cost = (total_cost / len(reps)) if total_cost is not None else None
        lines.append(
            f"| {t} | {len(reps)} | {_fmt_tokens(total_tokens)} | "
            f"{_fmt_cost(total_cost)} | {_fmt_tokens(avg_tokens)} | "
            f"{_fmt_cost(avg_cost)} |"
        )
    lines.append("")

    lines.append("## Runtime summary")
    lines.append("")
    lines.append("| Treatment | Runs | Turns | Duration | Tool Calls | Avg Turns/Run | Avg Duration/Run | Avg Tool Calls/Run |")
    lines.append("|-----------|------|-------|----------|------------|---------------|------------------|--------------------|")
    for t in TREATMENTS:
        reps = by_treatment.get(t, [])
        if not reps:
            continue
        total_turns = _sum_metric(reps, "num_turns")
        total_duration = _sum_metric(reps, "duration_seconds")
        total_tool_calls = _sum_metric(reps, "tool_calls")
        avg_turns = (total_turns / len(reps)) if total_turns is not None else None
        avg_duration = (total_duration / len(reps)) if total_duration is not None else None
        avg_tool_calls = (
            (total_tool_calls / len(reps)) if total_tool_calls is not None else None
        )
        lines.append(
            f"| {t} | {len(reps)} | {_fmt_tokens(total_turns)} | "
            f"{_fmt_seconds(total_duration)} | {_fmt_tokens(total_tool_calls)} | "
            f"{_fmt_average(avg_turns)} | {_fmt_seconds(avg_duration)} | "
            f"{_fmt_average(avg_tool_calls)} |"
        )
    lines.append("")

    lines.append("## Source evidence")
    lines.append("")
    lines.append("Use this section to trace each aggregate metric back to the raw run artifacts.")
    lines.append("")
    lines.append("- `Run` is the run id or fallback report id.")
    lines.append("- `Quality` is the sample-quality status used by the analysis-set filter.")
    lines.append("- `Reason` explains why the run is included, flagged, or excluded.")
    lines.append("- `Profile` is the eval rubric/profile that scored the run.")
    lines.append("- `Skill sources` records installed Skill identity or hash evidence when the run provides it.")
    lines.append("- `Eval manifest` is the task manifest that defined the evaluated scenario.")
    lines.append("- `Report` points to the raw per-run report JSON for deeper inspection.")
    lines.append("")
    lines.append("| Run | Quality | Reason | Profile | Skill sources | Eval manifest | Report |")
    lines.append("|-----|---------|--------|---------|---------------|---------------|--------|")
    for treatment in TREATMENTS:
        for rep in raw_by_treatment.get(treatment, []):
            quality = sample_quality_dict(rep, experiment_dir=experiment_dir)
            lines.append(_source_summary(rep, quality))
    lines.append("")

    label = "(mean±stdev, pass-rate across runs; 0.00–1.00)" if has_dist else "(mean, 0.00–1.00)"
    lines.append(f"## Rubric dimensions {label}")
    lines.append("")
    lines.append(
        "_Scores are binary pass-rates (0.0-1.0). Overall uses the "
        "validator-emitted weighted_score when available (see weights below)._"
    )
    lines.append("")
    lines.append("### Dimension guide")
    lines.append("")
    lines.append("| Dimension | Meaning |")
    lines.append("|-----------|---------|")
    for dim in RUBRIC_DIMENSIONS:
        lines.append(f"| {dim} | {RUBRIC_DIMENSION_GUIDE[dim]} |")
    lines.append("")

    header = "| Dimension | " + " | ".join(TREATMENTS) + " | Δ (workflow−baseline) |"
    sep = "|-----------|" + "|".join(["------"] * len(TREATMENTS)) + "|------|"
    lines.append(header)
    lines.append(sep)

    regressions: list[tuple[str, float, float]] = []
    for dim in RUBRIC_DIMENSIONS:
        row = [f"{dim}"]
        wf_stats = aggregated.get(WORKFLOW, {}).get(dim)
        bl_stats = aggregated.get(BASELINE, {}).get(dim)
        for t in TREATMENTS:
            row.append(_fmt_dim(aggregated.get(t, {}).get(dim), with_dist=has_dist))
        if wf_stats and bl_stats:
            delta = wf_stats["mean"] - bl_stats["mean"]
            row.append(f"{delta:+.2f}" + (" ⚠️" if delta < -0.05 else ""))
            if delta < -0.05:
                regressions.append((dim, wf_stats["mean"], bl_stats["mean"]))
        else:
            row.append("—")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    lines.append(
        "| **Overall** | "
        + " | ".join(
            (f"{_overall(aggregated[t]):.2f}" if t in aggregated else "—") for t in TREATMENTS
        )
        + " | "
        + (
            f"{_overall(aggregated[WORKFLOW]) - _overall(aggregated[BASELINE]):+.2f}"
            if WORKFLOW in aggregated and BASELINE in aggregated
            else "—"
        )
        + " |"
    )
    lines.append("")

    lines.append("### Dimension weights")
    lines.append("")
    lines.append("| Dimension | Weight |")
    lines.append("|-----------|--------|")
    for dim in RUBRIC_DIMENSIONS:
        weight = _DIMENSION_WEIGHTS.get(dim, 1.0)
        lines.append(f"| {dim} | {weight:.1f} |")
    lines.append("")

    excluded_total = sum(len(items) for items in partitions.excluded.values())
    if excluded_total:
        lines.append("## Excluded runs")
        lines.append("")
        lines.append("| Run | Task | Treatment | Reason | Evidence | Report |")
        lines.append("|-----|------|-----------|--------|----------|--------|")
        for treatment in TREATMENTS:
            lines.extend(
                _quality_run_rows(
                    partitions.excluded.get(treatment, []),
                    treatment,
                    experiment_dir,
                    include_column=False,
                )
            )
        lines.append("")

    flagged_total = sum(len(items) for items in partitions.flagged.values())
    if flagged_total:
        lines.append("## Flagged runs")
        lines.append("")
        lines.append("| Run | Task | Treatment | Reason | Evidence | Included? | Report |")
        lines.append("|-----|------|-----------|--------|----------|-----------|--------|")
        for treatment in TREATMENTS:
            lines.extend(
                _quality_run_rows(
                    partitions.flagged.get(treatment, []),
                    treatment,
                    experiment_dir,
                    include_column=True,
                )
            )
        lines.append("")

    lines.append("## Raw vs analysis sensitivity")
    lines.append("")
    lines.append("| Metric | Raw | Analysis | Delta |")
    lines.append("|--------|-----|----------|-------|")
    for treatment in TREATMENTS:
        raw_value = _overall_by_reports(raw_by_treatment.get(treatment, []))
        analysis_value = _overall_by_reports(by_treatment.get(treatment, []))
        if raw_value is None and analysis_value is None:
            continue
        delta = (
            "—"
            if raw_value is None or analysis_value is None
            else f"{analysis_value - raw_value:+.2f}"
        )
        lines.append(
            f"| {treatment} overall | {_fmt_optional_score(raw_value)} | "
            f"{_fmt_optional_score(analysis_value)} | {delta} |"
        )
    lines.append("")

    lines.append("## Run-level failed checks")
    lines.append("")
    lines.append(
        "These are sample-level `checks_failed` entries. They can coexist with "
        "`workflow_completion == 1.00`, `pass@k == 1.00`, or a passing task outcome "
        "because they describe stricter run-contract failures rather than the "
        "workflow artifact completion score or the task outcome matrix."
    )
    lines.append("")
    lines.append(
        "Each failed baseline check is bucketed as **harness** (runner/trigger issue), "
        "**business** (requested behavior issue), **workflow** (skill guidance or workflow "
        "artifact issue), **task** (task/validator issue), or **uncategorized** "
        "(valid completed failure that needs inspection)."
    )
    lines.append("")
    any_failures = False
    for t in TREATMENTS:
        attr = _attributions(raw_by_treatment.get(t, []))
        total = sum(len(v) for v in attr.values())
        if total == 0:
            continue
        any_failures = True
        lines.append(f"### {t} ({total} failure(s))")
        lines.append("")
        for bucket in ("harness", "business", "workflow", "task", "uncategorized"):
            items = attr.get(bucket, [])
            if not items:
                continue
            lines.append(f"- **{bucket}** ({len(items)}):")
            for item in _summarize_attribution_items(items):
                lines.append(f"  - {item}")
        lines.append("")
    if not any_failures:
        lines.append("_No baseline check failures across treatments._")
        lines.append("")

    lines.append("## Verdict")
    lines.append("")
    key_treatments = (WORKFLOW, BASELINE)
    missing_clean = [t for t in key_treatments if not by_treatment.get(t)]
    noisy_majority = []
    for t in key_treatments:
        raw, _included, _flagged, excluded = _quality_counts(partitions, t)
        if raw > 0 and excluded / raw > 0.5:
            noisy_majority.append(t)

    if missing_clean:
        lines.append(
            "⚠️ **Insufficient clean data**: analysis set has no included runs for "
            + ", ".join(f"`{t}`" for t in missing_clean)
            + ". Rerun the affected task/treatment pairs or inspect the excluded runs above."
        )
    elif noisy_majority:
        lines.append(
            "⚠️ **Inconclusive due to data quality**: more than half of the raw runs were "
            "excluded for "
            + ", ".join(f"`{t}`" for t in noisy_majority)
            + ". The analysis metrics are shown, but the A/B verdict should not be treated as final."
        )
    elif WORKFLOW not in aggregated or BASELINE not in aggregated:
        lines.append(f"Insufficient data: need both `{WORKFLOW}` and `{BASELINE}` runs.")
    elif regressions:
        lines.append(
            f"❌ **Workflow regresses on {len(regressions)} dimension(s) vs 0.3.9 baseline:**"
        )
        lines.append("")
        for dim, wf, bl in regressions:
            lines.append(f"- **{dim}**: workflow {wf:.2f} < baseline {bl:.2f} (Δ {wf - bl:+.2f})")
        lines.append("")
        lines.append(
            "See the run-level failed checks section above and the events/raw logs "
            "for root-cause analysis."
        )
    else:
        wf_overall = _overall(aggregated[WORKFLOW])
        bl_overall = _overall(aggregated[BASELINE])
        if wf_overall >= bl_overall:
            lines.append(
                f"✅ **Workflow is stable**: overall {wf_overall:.2f} ≥ "
                f"baseline {bl_overall:.2f}, no dimension regresses beyond "
                "the 0.05 tolerance."
            )
        else:
            lines.append(
                f"⚠️ **Workflow overall lower** ({wf_overall:.2f} < {bl_overall:.2f}) "
                f"but no single dimension regresses beyond tolerance."
            )

    if (
        not missing_clean
        and not noisy_majority
        and WORKFLOW in aggregated
        and BASELINE in aggregated
    ):
        raw, included, flagged, excluded = _quality_counts(partitions, WORKFLOW)
        lines.append("")
        lines.append(
            f"_Verdict uses analysis set: `{WORKFLOW}` included {included}/{raw} raw run(s), "
            f"flagged {flagged}, excluded {excluded}._"
        )

    if has_dist:
        lines.append("")
        lines.append("_Distribution stats computed from ≥2 runs per treatment._")

    judge_aggregated = {t: _aggregate_judge(reps) for t, reps in by_treatment.items() if reps}
    has_judge = any(
        stats.get(d, {}).get("n", 0) > 0
        for stats in judge_aggregated.values()
        for d in ("artifact_quality", "spec_drift", "main_flow")
    )
    if has_judge:
        lines.append("")
        lines.append("## LLM-judge overlay (rule vs judge)")
        lines.append("")
        lines.append(
            "Independent LLM re-scored the three qualitative dimensions by reading "
            "the actual artifacts. Large rule-vs-judge gaps flag heuristic weaknesses."
        )
        lines.append("")
        lines.append("| Dimension | Treatment | Rule | Judge | Gap |")
        lines.append("|-----------|-----------|------|-------|-----|")
        for dim in ("artifact_quality", "spec_drift", "main_flow"):
            for t in TREATMENTS:
                rule_stats = aggregated.get(t, {}).get(dim, {})
                judge_stats = judge_aggregated.get(t, {}).get(dim, {})
                rule = rule_stats.get("mean") if rule_stats.get("n") else None
                judge = judge_stats.get("mean") if judge_stats.get("n") else None
                if rule is None and judge is None:
                    continue
                gap = f"{judge - rule:+.2f}" if (rule is not None and judge is not None) else "—"
                lines.append(
                    f"| {dim} | {t} | {_fmt_optional_score(rule)} | "
                    f"{_fmt_optional_score(judge)} | {gap} |"
                )
        lines.append("")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", default=None, help="Experiment id (defaults to latest)")
    parser.add_argument(
        "--out",
        default=None,
        help="Output path (defaults to <experiment>/comparison_report.md)",
    )
    parser.add_argument("--report-config", default=None, help="JSON/YAML config for report outputs")
    parser.add_argument(
        "--language",
        choices=("en", "zh"),
        default="en",
        help="Language used by generated Markdown and HTML report bodies",
    )
    parser.add_argument(
        "--candidate-experiment",
        default=None,
        help="Candidate experiment id or path for strict two-experiment alignment",
    )
    parser.add_argument(
        "--baseline-experiment",
        default=None,
        help="Baseline experiment id or path for strict two-experiment alignment",
    )
    parser.add_argument(
        "--candidate-treatment",
        default="COMET_NATIVE_PHASE1",
        help="Treatment selected from the candidate experiment",
    )
    parser.add_argument(
        "--baseline-treatment",
        default="COMET_FULL_040_BETA",
        help="Treatment selected from the baseline experiment",
    )
    parser.add_argument(
        "--ks",
        default="1,2,3",
        help="Comma-separated k values for strict task-macro pass metrics",
    )
    args = parser.parse_args(argv)

    logs = get_logs_dir()
    aligned_mode = bool(args.candidate_experiment or args.baseline_experiment)
    if aligned_mode:
        if not args.candidate_experiment or not args.baseline_experiment:
            print(
                "--candidate-experiment and --baseline-experiment must be provided together",
                file=sys.stderr,
            )
            return 2
        if args.experiment:
            print(
                "--experiment cannot be combined with two-experiment alignment",
                file=sys.stderr,
            )
            return 2
        try:
            ks = tuple(int(item.strip()) for item in args.ks.split(",") if item.strip())
        except ValueError:
            print("--ks must be a comma-separated list of integers", file=sys.stderr)
            return 2
        if not ks or any(k < 1 for k in ks):
            print("--ks must contain positive integers", file=sys.stderr)
            return 2
        try:
            candidate_dir = _resolve_experiment(args.candidate_experiment, logs)
            baseline_dir = _resolve_experiment(args.baseline_experiment, logs)
        except (FileNotFoundError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
        try:
            report = build_aligned_report(
                candidate_dir,
                baseline_dir,
                candidate_treatment=args.candidate_treatment,
                baseline_treatment=args.baseline_treatment,
                tasks_dir=EVAL_ROOT / "local" / "tasks",
                ks=ks,
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        html_report = report
        if args.language == "zh":
            report = localize_eval_markdown(report)
        out_path = Path(args.out) if args.out else candidate_dir / "aligned_comparison_report.md"
        outputs = write_report_outputs(
            report,
            out_path,
            load_report_output_config(args.report_config),
            title=(
                "Comet 对齐实验对比报告"
                if args.language == "zh"
                else "Comet Aligned Experiment Comparison Report"
            ),
            html_markdown=html_report,
        )
        print(report)
        if outputs:
            print("\nWrote: " + ", ".join(str(path) for path in outputs.values()))
        else:
            print("\nReport outputs disabled by report config")
        return 0

    if args.experiment:
        experiment_dir = logs / "experiments" / args.experiment
        if not experiment_dir.exists():
            print(f"Experiment not found: {experiment_dir}", file=sys.stderr)
            return 1
    else:
        experiment_dir = _latest_experiment(logs)
        if experiment_dir is None:
            print("No experiments found under logs/experiments/", file=sys.stderr)
            return 1

    report = build_report(experiment_dir)
    out_path = Path(args.out) if args.out else experiment_dir / "comparison_report.md"
    outputs = write_report_outputs(
        report,
        out_path,
        load_report_output_config(args.report_config),
        title="Comet Baseline Comparison Report",
    )
    print(report)
    if outputs:
        print("\nWrote: " + ", ".join(str(path) for path in outputs.values()))
    else:
        print("\nReport outputs disabled by report config")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
