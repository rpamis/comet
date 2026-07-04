"""Output parsing, event extraction, and experiment logging for Claude CLI."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from scaffold.python.evidence import stable_treatment_name
from scaffold.python.paths import get_logs_dir
from scaffold.python.report_outputs import (
    ReportOutputConfig,
    preferred_report_path,
    write_report_outputs,
)

# Regex to strip ANSI escape codes
ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

_SKILL_ALIASES = {
    "opsx:new": "openspec-new-change",
    "opsx:apply": "openspec-apply-change",
    "opsx:verify": "openspec-verify-change",
    "opsx:archive": "openspec-archive-change",
    "opsx:explore": "openspec-explore",
    "opsx:propose": "openspec-propose",
}


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_ESCAPE.sub("", text)


def _record_skill_invocation(events: dict[str, Any], skill: str) -> None:
    normalized = _SKILL_ALIASES.get(skill, skill)
    if normalized not in events["skills_invoked"]:
        events["skills_invoked"].append(normalized)


# =============================================================================
# OUTPUT PARSING
# =============================================================================


def parse_output(stdout: str) -> dict[str, Any]:
    """Parse stream-json output into structured data."""
    if not stdout:
        return {"messages": []}
    messages = []
    for line in stdout.strip().split("\n"):
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return {"messages": messages}


def extract_events(parsed: dict[str, Any]) -> dict[str, Any]:
    """Extract events (tool calls, files, etc.) from parsed output."""
    events = {
        "tool_calls": [],
        "files_read": [],
        "files_created": [],
        "files_modified": [],
        "commands_run": [],
        "skills_invoked": [],
        "duration_seconds": None,
        "num_turns": None,
        "input_tokens": None,
        "output_tokens": None,
        "cache_read_input_tokens": None,
        "cache_creation_input_tokens": None,
        "total_tokens": None,
        "total_cost_usd": None,
        "model_usage": {},
    }

    # Map tool_use_id -> index in tool_calls list for matching outputs
    tool_id_to_index = {}

    for msg in parsed.get("messages", []):
        if msg.get("type") == "result":
            events["duration_seconds"] = msg.get("duration_ms", 0) / 1000
            events["num_turns"] = msg.get("num_turns")
            usage = msg.get("usage") or {}
            input_tokens = usage.get("input_tokens")
            output_tokens = usage.get("output_tokens")
            cache_read = usage.get("cache_read_input_tokens")
            cache_creation = usage.get("cache_creation_input_tokens")
            events["input_tokens"] = input_tokens
            events["output_tokens"] = output_tokens
            events["cache_read_input_tokens"] = cache_read
            events["cache_creation_input_tokens"] = cache_creation
            token_parts = [input_tokens, output_tokens, cache_read, cache_creation]
            if any(v is not None for v in token_parts):
                events["total_tokens"] = sum(v or 0 for v in token_parts)
            events["total_cost_usd"] = msg.get("total_cost_usd")
            events["model_usage"] = msg.get("modelUsage") or {}

        if msg.get("type") == "assistant":
            for item in msg.get("message", {}).get("content", []):
                if item.get("type") == "tool_use":
                    tool, inp = item.get("name", ""), item.get("input", {})
                    tool_id = item.get("id")
                    tool_call = {"tool": tool, "input": inp}
                    if tool_id:
                        tool_id_to_index[tool_id] = len(events["tool_calls"])
                    events["tool_calls"].append(tool_call)
                    path = inp.get("file_path", "")
                    if tool == "Read" and path:
                        events["files_read"].append(path)
                        # Detect skill reads (e.g., .claude/skills/skill-name/SKILL.md)
                        if ".claude/skills/" in path and (
                            m := re.search(r"\.claude/skills/([^/]+)", path)
                        ):
                            _record_skill_invocation(events, m.group(1))
                    elif tool == "Write" and path:
                        events["files_created"].append(path)
                    elif tool == "Edit" and path:
                        events["files_modified"].append(path)
                    elif tool == "Bash" and inp.get("command"):
                        events["commands_run"].append(inp["command"])
                    elif tool == "Skill" and inp.get("skill"):
                        _record_skill_invocation(events, inp["skill"])

        # Capture tool results and match to their tool_use calls
        if msg.get("type") == "user":
            for item in msg.get("message", {}).get("content", []):
                if item.get("type") == "tool_result":
                    tool_use_id = item.get("tool_use_id")
                    if tool_use_id and tool_use_id in tool_id_to_index:
                        idx = tool_id_to_index[tool_use_id]
                        # Extract output content
                        content = item.get("content", "")
                        if isinstance(content, list):
                            # Content can be a list of text blocks
                            content = " ".join(
                                c.get("text", str(c)) if isinstance(c, dict) else str(c)
                                for c in content
                            )
                        events["tool_calls"][idx]["output"] = content

    return events


# =============================================================================
# TREATMENT RESULT
# =============================================================================


@dataclass
class TreatmentResult:
    """Result from a single treatment run."""

    name: str
    passed: bool
    checks_passed: list[str]
    checks_failed: list[str]
    events_summary: dict[str, Any] = field(default_factory=dict)
    run_id: str = ""  # Unique ID for finding LangSmith assets (test-{run_id})

    def has_check(self, pattern: str) -> bool:
        """Check if any passed check contains pattern."""
        return any(pattern in c for c in self.checks_passed)

    def has_failed_check(self, pattern: str) -> bool:
        """Check if any failed check contains pattern."""
        return any(pattern in c for c in self.checks_failed)

    @property
    def turns(self) -> int | None:
        return self.events_summary.get("num_turns")

    @property
    def duration(self) -> float | None:
        return self.events_summary.get("duration_seconds")

    @property
    def tool_calls(self) -> int | None:
        return self.events_summary.get("tool_calls")

    @property
    def total_tokens(self) -> int | None:
        return self.events_summary.get("total_tokens")

    @property
    def total_cost_usd(self) -> float | None:
        return self.events_summary.get("total_cost_usd")

    @property
    def skills_invoked(self) -> list[str]:
        return self.events_summary.get("skills_invoked", [])

    @property
    def scripts_used(self) -> list[str]:
        return self.events_summary.get("scripts_used", [])


# =============================================================================
# REPORT COLUMNS
# =============================================================================


@dataclass
class ReportColumn:
    """Defines a column in the results table."""

    name: str
    extract: Callable[[TreatmentResult], str]  # Single run -> display value
    aggregate: Callable[[list[TreatmentResult]], str] = None  # Multiple runs -> display value
    description: str = ""  # Human-readable description of what this column checks

    def get_value(self, result: TreatmentResult) -> str:
        return self.extract(result)

    def get_aggregate(self, runs: list[TreatmentResult]) -> str:
        if self.aggregate:
            return self.aggregate(runs)
        return self.extract(runs[0]) if runs else "N/A"


def bool_column(name: str, pattern: str, description: str = None) -> ReportColumn:
    """Column that checks if pattern exists in passed checks."""
    return ReportColumn(
        name=name,
        extract=lambda r: "Yes" if r.has_check(pattern) else "No",
        aggregate=lambda runs: f"{sum(1 for r in runs if r.has_check(pattern))}/{len(runs)}",
        description=description or f"Checks if any passed check contains: `{pattern}`",
    )


def quality_column(name: str = "Quality") -> ReportColumn:
    """Column for output quality ([GOOD] vs [LOW])."""

    def extract(r):
        for c in r.checks_passed:
            if "[GOOD]" in c:
                return "Good"
            if "[LOW]" in c:
                return "Low"
        return "N/A"

    def aggregate(runs):
        good = sum(1 for r in runs if any("[GOOD]" in c for c in r.checks_passed))
        return f"{good}/{len(runs)}"

    return ReportColumn(
        name=name,
        extract=extract,
        aggregate=aggregate,
        description="Checks for [GOOD] or [LOW] quality rating from LLM evaluation",
    )


def default_columns() -> list[ReportColumn]:
    """Standard columns: Checks, Turns, Duration, Tools."""
    return [
        ReportColumn(
            name="Checks",
            extract=lambda r: _checks_single(r),
            aggregate=lambda runs: _checks_aggregate(runs),
        ),
        ReportColumn(
            name="Turns",
            extract=lambda r: str(r.turns) if r.turns else "N/A",
            aggregate=lambda runs: _avg([r.turns for r in runs if r.turns], "{:.0f}"),
        ),
        ReportColumn(
            name="Duration",
            extract=lambda r: f"{r.duration:.0f}s" if r.duration else "N/A",
            aggregate=lambda runs: _avg([r.duration for r in runs if r.duration], "{:.0f}s"),
        ),
        ReportColumn(
            name="Tools",
            extract=lambda r: str(r.tool_calls) if r.tool_calls else "N/A",
            aggregate=lambda runs: _avg([r.tool_calls for r in runs if r.tool_calls], "{:.0f}"),
        ),
        ReportColumn(
            name="Tokens",
            extract=lambda r: _format_tokens(r.total_tokens),
            aggregate=lambda runs: _format_tokens(_sum([r.total_tokens for r in runs])),
        ),
        ReportColumn(
            name="Cost",
            extract=lambda r: _format_cost(r.total_cost_usd),
            aggregate=lambda runs: _format_cost(_sum([r.total_cost_usd for r in runs])),
        ),
    ]


def _checks_single(r) -> str:
    """Format checks for a single run."""
    passed = len(r.checks_passed)
    total = passed + len(r.checks_failed)
    pct = (passed / total * 100) if total > 0 else 0
    return f"{passed}/{total} ({pct:.0f}%)"


# Rubric score extraction — parses ``[RUBRIC] dim: score - reason`` messages.
_RUBRIC_RE = re.compile(r"\[RUBRIC\]\s+(\S+):\s*([0-9.]+)")
_RUBRIC_DERIVED_METRICS = {"weighted_score"}


def _rubric_scores(result: TreatmentResult) -> dict[str, float]:
    """Extract per-dimension rubric scores from a run's passed checks."""
    scores: dict[str, float] = {}
    for check in result.checks_passed:
        m = _RUBRIC_RE.search(check)
        if m:
            try:
                scores[m.group(1)] = float(m.group(2))
            except ValueError:
                continue
    return scores


def rubric_column(dim: str) -> ReportColumn:
    """Column showing the score (0.00-1.00) for one rubric dimension."""

    def extract(r: TreatmentResult) -> str:
        scores = _rubric_scores(r)
        return f"{scores.get(dim, 0):.2f}" if dim in scores else "/"

    def aggregate(runs: list[TreatmentResult]) -> str:
        vals = [_rubric_scores(r).get(dim) for r in runs]
        vals = [v for v in vals if v is not None]
        if not vals:
            return "/"
        return f"{sum(vals) / len(vals):.2f}"

    return ReportColumn(name=dim, extract=extract, aggregate=aggregate)


def rubric_total_column() -> ReportColumn:
    """Column showing the unweighted mean across base rubric dimensions."""

    def total(scores: dict[str, float]) -> float | None:
        base_scores = {
            dim: score for dim, score in scores.items() if dim not in _RUBRIC_DERIVED_METRICS
        }
        if not base_scores:
            return None
        return sum(base_scores.values()) / len(base_scores)

    def extract(r: TreatmentResult) -> str:
        t = total(_rubric_scores(r))
        return f"{t:.2f}" if t is not None else "/"

    def aggregate(runs: list[TreatmentResult]) -> str:
        per_run = [total(_rubric_scores(r)) for r in runs]
        per_run = [t for t in per_run if t is not None]
        if not per_run:
            return "/"
        return f"{sum(per_run) / len(per_run):.2f}"

    return ReportColumn(name="RubricAvg", extract=extract, aggregate=aggregate)


def rubric_columns(dimensions: tuple[str, ...] | list[str] | None = None) -> list[ReportColumn]:
    """Rubric dimension columns plus derived metrics and the aggregate."""
    if dimensions is None:
        from scaffold.python.profiles import all_rubric_dimensions

        dimensions = all_rubric_dimensions()
    base_dimensions = [dim for dim in dimensions if dim not in _RUBRIC_DERIVED_METRICS]
    derived_metrics = [dim for dim in dimensions if dim in _RUBRIC_DERIVED_METRICS]
    if "weighted_score" not in derived_metrics:
        derived_metrics.append("weighted_score")
    cols = [rubric_column(dim) for dim in base_dimensions]
    cols.extend(rubric_column(dim) for dim in derived_metrics)
    cols.append(rubric_total_column())
    return cols

def _checks_aggregate(runs: list) -> str:
    """Aggregate checks passed across runs."""
    total_passed = sum(len(r.checks_passed) for r in runs)
    total_checks = sum(len(r.checks_passed) + len(r.checks_failed) for r in runs)
    pct = (total_passed / total_checks * 100) if total_checks > 0 else 0
    return f"{total_passed}/{total_checks} ({pct:.0f}%)"


def _avg(values: list, fmt: str = "{:.1f}") -> str:
    """Calculate average and format, or return N/A."""
    values = [v for v in values if v is not None]
    if not values:
        return "N/A"
    return fmt.format(sum(values) / len(values))


def _sum(values: list) -> int | float | None:
    values = [v for v in values if v is not None]
    return sum(values) if values else None


def _format_tokens(value: int | float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value:,.0f}"


def _format_cost(value: int | float | None) -> str:
    if value is None:
        return "N/A"
    return f"${value:.4f}"


# =============================================================================
# EXPERIMENT LOGGER
# =============================================================================


class ExperimentLogger:
    """Manages logging for a single experiment run."""

    def __init__(
        self,
        experiment_name: str = None,
        columns: list[ReportColumn] = None,
        experiment_id: str = None,
        report_outputs: ReportOutputConfig = None,
    ):
        """Create experiment logger.

        Args:
            experiment_name: Name for this experiment (used to generate ID if not provided)
            columns: Custom columns for reporting (in addition to defaults)
            experiment_id: Existing experiment ID to join (for parallel workers)
            report_outputs: Enabled summary report formats
        """
        if experiment_id:
            # Join existing experiment
            self.experiment_id = experiment_id
            self.name = experiment_id.rsplit("_", 2)[0] if "_" in experiment_id else experiment_id
            self.timestamp = experiment_id.rsplit("_", 1)[-1] if "_" in experiment_id else ""
        else:
            # Create new experiment
            self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self.name = experiment_name or f"experiment_{self.timestamp}"
            self.experiment_id = f"{self.name}_{self.timestamp}"

        self.base_dir = get_logs_dir() / "experiments" / self.experiment_id

        # Create subdirectories
        self.events_dir = self.base_dir / "events"
        self.reports_dir = self.base_dir / "reports"
        self.raw_dir = self.base_dir / "raw"

        for d in [self.events_dir, self.reports_dir, self.raw_dir]:
            d.mkdir(parents=True, exist_ok=True)

        self.columns = list(columns) if columns else rubric_columns()
        self.report_outputs = report_outputs or ReportOutputConfig()
        self.results: dict[str, list[TreatmentResult]] = {}
        self.metadata: dict[str, Any] = {
            "experiment_id": self.experiment_id,
            "started_at": datetime.now().isoformat(),
            "treatments": [],
        }

    def add_result(self, treatment_name: str, result: TreatmentResult):
        """Add a treatment result."""
        if treatment_name not in self.results:
            self.results[treatment_name] = []
            self.metadata["treatments"].append(treatment_name)
        self.results[treatment_name].append(result)

    def _get_all_columns(self) -> list[ReportColumn]:
        """Get all columns: custom first, then defaults."""
        defaults = default_columns()
        pass_col = defaults[0]
        metric_cols = defaults[1:]
        return [pass_col] + self.columns + metric_cols

    def _aggregate_by_base_treatment(self) -> dict[str, list[TreatmentResult]]:
        """Group results by base treatment name (strip -N-M suffix from pytest --count).

        Example: ADV_BASELINE-1-3, ADV_BASELINE-2-3, ADV_BASELINE-3-3 -> ADV_BASELINE
        """
        base_treatments: dict[str, list[TreatmentResult]] = {}
        pattern = re.compile(r"^(.+)-\d+-\d+$")  # Matches NAME-N-M

        for name, runs in self.results.items():
            match = pattern.match(name)
            base_name = match.group(1) if match else name
            if base_name not in base_treatments:
                base_treatments[base_name] = []
            base_treatments[base_name].extend(runs)

        return base_treatments

    def generate_summary(self) -> str:
        """Generate markdown summary of experiment results."""
        lines = []
        lines.append("# Experiment Results Summary\n")
        lines.append(f"**Experiment ID:** `{self.experiment_id}`\n")
        lines.append(f"**Started:** {self.metadata['started_at']}\n")
        lines.append(f"**Completed:** {datetime.now().isoformat()}\n")
        lines.append("")

        columns = self._get_all_columns()
        has_reps = any(len(runs) > 1 for runs in self.results.values())

        # Column definitions section
        custom_cols = [c for c in self.columns if c.description]
        if custom_cols:
            lines.append("## Column Definitions\n")
            for col in custom_cols:
                lines.append(f"- **{col.name}**: {col.description}")
            lines.append("")

        col_names = ["Treatment"] + [c.name for c in columns]
        header = "| " + " | ".join(col_names) + " |"
        separator = "|" + "|".join("-" * (len(name) + 2) for name in col_names) + "|"

        if has_reps:
            lines.append("## Results (with Repetitions)\n")
        else:
            lines.append("## Results\n")

        lines.append(header)
        lines.append(separator)

        for name, runs in self.results.items():
            if has_reps:
                values = [c.get_aggregate(runs) for c in columns]
            else:
                values = [c.get_value(runs[0]) for c in columns]
            lines.append(f"| {name} | " + " | ".join(values) + " |")

        lines.append("")

        total_runs = sum(len(runs) for runs in self.results.values())
        total_checks_passed = sum(
            sum(len(r.checks_passed) for r in runs) for runs in self.results.values()
        )
        total_checks = sum(
            sum(len(r.checks_passed) + len(r.checks_failed) for r in runs)
            for runs in self.results.values()
        )
        check_pct = (total_checks_passed / total_checks * 100) if total_checks > 0 else 0

        lines.append("## Summary\n")
        lines.append(f"- **Total Runs:** {total_runs}")
        lines.append(
            f"- **Checks Passed:** {total_checks_passed}/{total_checks} ({check_pct:.1f}%)"
        )
        lines.append("")

        # Aggregate by base treatment name (strip -N-M suffix from pytest --count)
        base_treatments = self._aggregate_by_base_treatment()
        if base_treatments and len(base_treatments) < len(self.results):
            lines.append("## Aggregated by Treatment\n")
            lines.append(
                "| Treatment | Reps Passed | Checks | Avg Turns | Avg Duration | Tokens | Cost | Skills | Scripts |"
            )
            lines.append(
                "|-----------|-------------|--------|-----------|--------------|--------|------|--------|---------|"
            )
            for base_name, all_runs in base_treatments.items():
                # A rep passes if all checks pass (no failures)
                reps_passed = sum(1 for r in all_runs if not r.checks_failed)
                total_reps = len(all_runs)
                total_passed = sum(len(r.checks_passed) for r in all_runs)
                total_all = sum(len(r.checks_passed) + len(r.checks_failed) for r in all_runs)
                pct = (total_passed / total_all * 100) if total_all > 0 else 0
                avg_turns = _avg([r.turns for r in all_runs if r.turns], "{:.0f}")
                avg_dur = _avg([r.duration for r in all_runs if r.duration], "{:.0f}s")
                total_tokens = _format_tokens(_sum([r.total_tokens for r in all_runs]))
                total_cost = _format_cost(_sum([r.total_cost_usd for r in all_runs]))
                # Get skills/scripts from first run (should be same for all reps)
                skills = (
                    ", ".join(all_runs[0].skills_invoked) if all_runs[0].skills_invoked else "none"
                )
                scripts = (
                    ", ".join(all_runs[0].scripts_used) if all_runs[0].scripts_used else "none"
                )
                lines.append(
                    f"| {base_name} | {reps_passed}/{total_reps} | {total_passed}/{total_all} ({pct:.0f}%) | {avg_turns} | {avg_dur} | {total_tokens} | {total_cost} | {skills} | {scripts} |"
                )
            lines.append("")

        # Detailed per-treatment breakdown
        lines.append("## Treatment Details\n")
        for name, runs in self.results.items():
            treatment_passed = sum(len(r.checks_passed) for r in runs)
            treatment_total = sum(len(r.checks_passed) + len(r.checks_failed) for r in runs)
            treatment_pct = (treatment_passed / treatment_total * 100) if treatment_total > 0 else 0
            lines.append(
                f"### {name} ({treatment_passed}/{treatment_total} checks, {treatment_pct:.0f}%)\n"
            )

            for i, r in enumerate(runs, 1):
                run_label = f"Run {i}" if has_reps else "Result"
                run_passed = len(r.checks_passed)
                run_total = run_passed + len(r.checks_failed)
                run_pct = (run_passed / run_total * 100) if run_total > 0 else 0
                run_id_str = f" (run_id: {r.run_id})" if r.run_id else ""
                lines.append(
                    f"**{run_label}:** {run_passed}/{run_total} checks ({run_pct:.0f}%){run_id_str}"
                )

                # Show metrics
                metrics = []
                if r.turns:
                    metrics.append(f"Turns: {r.turns}")
                if r.duration:
                    metrics.append(f"Duration: {r.duration:.0f}s")
                if r.tool_calls:
                    metrics.append(f"Tool calls: {r.tool_calls}")
                if r.total_tokens is not None:
                    metrics.append(f"Tokens: {_format_tokens(r.total_tokens)}")
                if r.total_cost_usd is not None:
                    metrics.append(f"Cost: {_format_cost(r.total_cost_usd)}")
                if metrics:
                    lines.append(f"- Metrics: {', '.join(metrics)}")

                # Show skills and scripts
                if r.skills_invoked:
                    lines.append(f"- Skills invoked: {', '.join(r.skills_invoked)}")
                if r.scripts_used:
                    lines.append(f"- Scripts used: {', '.join(r.scripts_used)}")

                # Show all passed checks
                if r.checks_passed:
                    lines.append(f"- Passed checks ({len(r.checks_passed)}):")
                    for check in r.checks_passed:
                        lines.append(f"  - {check}")

                # Show all failed checks
                if r.checks_failed:
                    lines.append(f"- Failed checks ({len(r.checks_failed)}):")
                    for check in r.checks_failed:
                        lines.append(f"  - {check}")

                lines.append("")

        return "\n".join(lines)

    def finalize(self):
        """Generate and save final summary."""
        summary = self.generate_summary()
        summary_path = self.base_dir / "summary.md"
        written = write_report_outputs(
            summary,
            summary_path,
            self.report_outputs,
            title="Comet Eval Summary",
        )

        self.metadata["completed_at"] = datetime.now().isoformat()
        self.metadata["total_runs"] = sum(len(runs) for runs in self.results.values())
        self.metadata["total_passed"] = sum(
            sum(1 for r in runs if r.passed) for runs in self.results.values()
        )
        self.metadata["report_outputs"] = {name: str(path) for name, path in written.items()}

        metadata_path = self.base_dir / "metadata.json"
        metadata_path.write_text(json.dumps(self.metadata, indent=2), encoding="utf-8")

        print(f"\nExperiment results saved to: {self.base_dir}")
        if written:
            print("Summary: " + ", ".join(str(path) for path in written.values()))
        else:
            print("Summary outputs disabled by report config")

        return preferred_report_path(written, self.base_dir)


# =============================================================================
# PARALLEL SAVE HELPERS (for multiprocessing workers)
# =============================================================================


def save_events(base_dir: Path, treatment_name: str, rep: int, events: dict[str, Any]):
    """Save events JSON."""
    events_dir = base_dir / "events"
    events_dir.mkdir(parents=True, exist_ok=True)
    save_path = events_dir / f"{stable_treatment_name(treatment_name)}_rep{rep}.json"
    save_path.write_text(json.dumps(events, indent=2), encoding="utf-8")
    return save_path


def save_raw(base_dir: Path, treatment_name: str, rep: int, stdout: str, stderr: str = None):
    """Save raw CLI output."""
    raw_dir = base_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    stable_name = stable_treatment_name(treatment_name)
    stdout_path = raw_dir / f"{stable_name}_rep{rep}_stdout.json"
    stdout_path.write_text(stdout, encoding="utf-8")

    if stderr:
        stderr_path = raw_dir / f"{stable_name}_rep{rep}_stderr.txt"
        stderr_path.write_text(stderr, encoding="utf-8")


def save_report(base_dir: Path, treatment_name: str, rep: int, report: dict[str, Any]):
    """Save treatment report."""
    reports_dir = base_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    save_path = reports_dir / f"{stable_treatment_name(treatment_name)}_rep{rep}_report.json"
    save_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return save_path
