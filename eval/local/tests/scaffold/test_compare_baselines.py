"""Unit tests for baseline comparison reporting."""

import json
from pathlib import Path

from local.scripts.compare_baselines import build_report, main
from scaffold.python.report_outputs import render_markdown_html


def _write_report(reports_dir: Path, name: str, tokens: int, cost: float, passed: bool = True):
    report = {
        "name": f"comet-fix-median-{name}",
        "passed": passed,
        "checks_passed": [
            "[RUBRIC] main_flow: 1.00 - ok",
            "[RUBRIC] gate_guard: 1.00 - ok",
            "[RUBRIC] skill_invocation: 1.00 - ok",
            "[RUBRIC] spec_drift: 1.00 - ok",
            "[RUBRIC] business_completion: 1.00 - ok",
            "[RUBRIC] workflow_completion: 1.00 - ok",
            "[RUBRIC] efficiency: 1.00 - ok",
            "[RUBRIC] decision_point_compliance: 1.00 - ok",
            "[RUBRIC] artifact_quality: 1.00 - ok",
        ],
        "checks_failed": [] if passed else ["validator failed"],
        "events_summary": {
            "total_tokens": tokens,
            "total_cost_usd": cost,
        },
    }
    (reports_dir / f"{name.lower()}_report.json").write_text(json.dumps(report))


def _write_quality_report(
    reports_dir: Path,
    filename: str,
    *,
    name: str,
    weighted_score: float,
    tokens: int,
    cost: float,
    sample_quality: dict,
    passed: bool = True,
):
    report = {
        "name": name,
        "passed": passed,
        "run_id": filename,
        "checks_passed": [f"[RUBRIC] weighted_score: {weighted_score:.2f}"],
        "checks_failed": [] if passed else ["validator failed"],
        "sample_quality": sample_quality,
        "events_summary": {
            "total_tokens": tokens,
            "total_cost_usd": cost,
            "artifact_references": {"report": f"reports/{filename}.json"},
        },
    }
    (reports_dir / f"{filename}.json").write_text(json.dumps(report), encoding="utf-8")


def test_compare_report_includes_spend_summary(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    report = build_report(experiment)

    assert "## Spend summary" in report
    assert "| Treatment | Runs | Tokens | Cost | Avg Tokens/Run | Avg Cost/Run |" in report
    assert "| COMET_FULL_040_BETA | 1 | 200 | $0.0200 | 200 | $0.0200 |" in report


def test_compare_report_reads_utf8_report_json(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    report = {
        "name": "comet-fix-median-COMET_FULL_040_BETA",
        "passed": True,
        "checks_passed": ["[RUBRIC] weighted_score: 1.00 - 通过"],
        "checks_failed": [],
        "events_summary": {
            "total_tokens": 200,
            "total_cost_usd": 0.02,
            "artifact_references": {"report": "报告路径"},
        },
    }
    (reports / "utf8_report.json").write_text(
        json.dumps(report, ensure_ascii=False),
        encoding="utf-8",
    )

    output = build_report(experiment)

    assert "报告路径" in output


def test_compare_report_handles_partial_llm_judge_overlay_scores(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    workflow = {
        "name": "comet-fix-median-COMET_FULL_040_BETA",
        "passed": True,
        "checks_passed": ["[RUBRIC-JUDGE] artifact_quality: 0.75 - ok"],
        "checks_failed": [],
        "events_summary": {},
    }
    (reports / "workflow_judge_only.json").write_text(
        json.dumps(workflow),
        encoding="utf-8",
    )

    report = build_report(experiment)

    assert "## LLM-judge overlay (rule vs judge)" in report
    assert "| artifact_quality | COMET_FULL_040_BETA | — | 0.75 | — |" in report


def test_compare_report_includes_metric_guide_and_runtime_summary(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    for path in reports.glob("*.json"):
        report = json.loads(path.read_text(encoding="utf-8"))
        report["events_summary"].update(
            {
                "num_turns": 6,
                "duration_seconds": 120,
                "tool_calls": 18,
            }
        )
        path.write_text(json.dumps(report), encoding="utf-8")

    report = build_report(experiment)

    assert "## Metric guide" in report
    assert "| Metric | Meaning | Source | Report section |" in report
    assert "| `raw runs` | All discovered report JSON files before quality filtering. | report files | Data quality summary |" in report
    assert "| `business_completion` | Business validator pass rate; CONTROL is evaluated on this without requiring Comet workflow artifacts. | `[RUBRIC] business_completion` | Rubric dimensions / pass@k |" in report
    assert "| `workflow_completion` | Comet workflow validator pass rate; `/` means not applicable for CONTROL. | `[RUBRIC] workflow_completion` | Rubric dimensions / pass@k |" in report
    assert "## Runtime summary" in report
    assert "| Treatment | Runs | Turns | Duration | Tool Calls | Avg Turns/Run | Avg Duration/Run | Avg Tool Calls/Run |" in report
    assert "| COMET_FULL_040_BETA | 1 | 6 | 120s | 18 | 6.0 | 120s | 18.0 |" in report


def test_compare_report_includes_rubric_dimension_guide(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    report = build_report(experiment)
    html = render_markdown_html(report, title="Comet Baseline Comparison Report")

    assert "### Dimension guide" in report
    assert "| main_flow | Completion of the expected Comet workflow phases. |" in report
    assert "| business_completion | Business validator pass rate for the requested task behavior. |" in report
    assert "<h3>维度说明</h3>" in html
    assert "业务 validator 对用户请求行为的通过率" in html
    assert "Workflow validator 对 Comet workflow 产物的通过率" in html


def test_compare_report_normalizes_repeated_run_suffixes(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    report = {
        "name": "comet-fix-median-COMET_FULL_040_BETA-r1",
        "passed": True,
        "checks_passed": ["[RUBRIC] weighted_score: 1.00"],
        "checks_failed": [],
        "events_summary": {"total_tokens": 200, "total_cost_usd": 0.02},
    }
    (reports / "workflow_report.json").write_text(json.dumps(report))

    output = build_report(experiment)

    assert "| COMET_FULL_040_BETA | 1 |" in output
    assert "| comet-fix-median | — | PASS | — |" in output
    html = render_markdown_html(output, title="Comet Baseline Comparison Report")
    assert "Task outcome matrix" in html
    assert "N/A" in html


def test_compare_report_includes_task_outcome_table(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03, passed=False)

    report = build_report(experiment)

    assert "## Task outcomes" in report
    assert "| Task | CONTROL | COMET_FULL_040_BETA | COMET_FULL_039 |" in report
    assert "| comet-fix-median | PASS | PASS | FAIL |" in report


def test_compare_report_splits_pass_metrics_by_business_and_workflow(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)

    def write_run(
        filename: str,
        *,
        treatment: str,
        business_score: float,
        workflow_score: float | None,
        passed: bool,
    ):
        checks = [f"[RUBRIC] business_completion: {business_score:.2f} - demo"]
        if workflow_score is None:
            checks.append("[RUBRIC] workflow_completion: N/A - CONTROL business-only baseline")
        else:
            checks.append(f"[RUBRIC] workflow_completion: {workflow_score:.2f} - demo")
        report = {
            "name": f"comet-fix-median-{treatment}",
            "passed": passed,
            "checks_passed": checks,
            "checks_failed": [] if passed else ["validator failed"],
            "events_summary": {},
        }
        (reports / filename).write_text(json.dumps(report), encoding="utf-8")

    write_run(
        "control_1.json",
        treatment="CONTROL",
        business_score=1.0,
        workflow_score=None,
        passed=True,
    )
    write_run(
        "control_2.json",
        treatment="CONTROL",
        business_score=0.0,
        workflow_score=None,
        passed=False,
    )
    write_run(
        "workflow_1.json",
        treatment="COMET_FULL_040_BETA",
        business_score=1.0,
        workflow_score=1.0,
        passed=True,
    )
    write_run(
        "workflow_2.json",
        treatment="COMET_FULL_040_BETA",
        business_score=1.0,
        workflow_score=0.0,
        passed=False,
    )
    write_run(
        "baseline_1.json",
        treatment="COMET_FULL_039",
        business_score=1.0,
        workflow_score=1.0,
        passed=True,
    )
    write_run(
        "baseline_2.json",
        treatment="COMET_FULL_039",
        business_score=1.0,
        workflow_score=1.0,
        passed=True,
    )

    report = build_report(experiment)

    assert "| Metric | Treatment | pass@1 | pass@2 | pass^1 | pass^2 | pass/fail |" in report
    assert "| overall | COMET_FULL_040_BETA | 0.50 | 1.00 | 0 | 0 | 1/2 |" in report
    assert "| business | COMET_FULL_040_BETA | 1.00 | 1.00 | 1 | 1 | 2/2 |" in report
    assert "| workflow | CONTROL | / | / | / | / | / |" in report
    assert "| workflow | COMET_FULL_040_BETA | 0.50 | 1.00 | 0 | 0 | 1/2 |" in report


def test_compare_report_includes_pass_at_3_when_three_runs_exist(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)

    for rep, passed in enumerate((True, False, False), start=1):
        _write_report(reports, f"CONTROL-r{rep}", 100, 0.01, passed=passed)
    for rep, passed in enumerate((True, True, False), start=1):
        _write_report(reports, f"COMET_FULL_040_BETA-r{rep}", 200, 0.02, passed=passed)
    for rep, passed in enumerate((True, True, True), start=1):
        _write_report(reports, f"COMET_FULL_039-r{rep}", 300, 0.03, passed=passed)

    report = build_report(experiment)

    assert (
        "| Metric | Treatment | pass@1 | pass@2 | pass@3 | pass^1 | pass^2 | pass^3 | pass/fail |"
        in report
    )
    assert "| overall | CONTROL | 0.33 | 0.67 | 1.00 | 0 | 0 | 0 | 1/3 |" in report
    assert "| overall | COMET_FULL_040_BETA | 0.67 | 1.00 | 1.00 | 0 | 0 | 0 | 2/3 |" in report
    assert "| overall | COMET_FULL_039 | 1.00 | 1.00 | 1.00 | 1 | 1 | 1 | 3/3 |" in report


def test_compare_report_honors_html_report_output_config(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("BENCH_LOGS_DIR", str(tmp_path))
    experiment = tmp_path / "experiments" / "exp1"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    config = tmp_path / "report-config.json"
    config.write_text(json.dumps({"report_outputs": {"markdown": False, "html": True}}))

    result = main(["--experiment", "exp1", "--report-config", str(config)])

    assert result == 0
    assert not (experiment / "comparison_report.md").exists()
    html_report = experiment / "comparison_report.html"
    assert html_report.exists()
    html = html_report.read_text(encoding="utf-8")
    assert "Comet Baseline Comparison Report" in html
    assert "paper-figure" in html
    assert 'data-chart-backend="python"' in html
    assert "Rubric dimension deltas" in html
    assert "Task outcome matrix" in html
    assert "<svg" in html
    assert "matplotlib" not in html.lower()
    assert "chart.js" not in html.lower()


def test_html_report_falls_back_when_python_chart_backend_disabled(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("COMET_EVAL_REPORT_CHART_BACKEND", "inline")
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert 'data-chart-backend="inline-svg"' in html
    assert "Task outcome matrix" in html


def test_compare_report_uses_structured_failure_attribution(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    workflow = {
        "name": "comet-full-workflow-COMET_FULL_040_BETA",
        "passed": False,
        "checks_passed": [],
        "checks_failed": ["Required skill not invoked: comet"],
        "events_summary": {
            "total_tokens": 200,
            "total_cost_usd": 0.02,
            "failure_attribution": [
                {
                    "bucket": "harness",
                    "check": "Required skill not invoked: comet",
                    "reason": "target Skill was never invoked",
                }
            ],
        },
    }
    (reports / "COMET_FULL_040_BETA_report.json").write_text(json.dumps(workflow))

    report = build_report(experiment)

    assert "**harness**" in report
    assert "[harness] target Skill was never invoked" in report


def test_compare_report_groups_repeated_failure_attribution(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    for index in range(2):
        workflow = {
            "name": f"comet-full-workflow-COMET_FULL_040_BETA-r{index}",
            "passed": False,
            "checks_passed": [],
            "checks_failed": ["Required Superpowers dependency skill not invoked"],
            "events_summary": {
                "total_tokens": 200,
                "total_cost_usd": 0.02,
                "failure_attribution": [
                    {
                        "bucket": "workflow",
                        "check": "Required Superpowers dependency skill not invoked",
                        "reason": "Skill invocation contract failed",
                    }
                ],
            },
        }
        (reports / f"COMET_FULL_040_BETA_{index}_report.json").write_text(
            json.dumps(workflow)
        )

    report = build_report(experiment)

    assert "- **workflow** (2):" in report
    assert (
        "x2 Required Superpowers dependency skill not invoked  ->  "
        "[workflow] Skill invocation contract failed"
    ) in report


def test_compare_report_labels_failure_attribution_as_run_level_checks(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02, passed=False)

    report = build_report(experiment)
    html = render_markdown_html(report, title="Comet Baseline Comparison Report")

    assert "## Run-level failed checks" in report
    assert (
        "These are sample-level `checks_failed` entries. They can coexist with "
        "`workflow_completion == 1.00`, `pass@k == 1.00`, or a passing task outcome"
        in report
    )
    assert "<h2>样本级失败检查</h2>" in html
    assert "它们可以与 <code>workflow_completion == 1.00</code>、<code>pass@k == 1.00</code>" in html


def test_compare_report_lists_source_evidence(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    workflow = {
        "name": "comet-full-workflow-COMET_FULL_040_BETA",
        "passed": True,
        "run_id": "run-123",
        "checks_passed": ["[RUBRIC] weighted_score: 1.00 - ok"],
        "checks_failed": [],
        "events_summary": {
            "profile": "comet-workflow",
            "skill_sources": [{"name": "comet", "hash": "sha256:abc"}],
            "eval_manifest": "demo/comet/eval.yaml",
            "artifact_references": {"report": "reports/COMET_FULL_040_BETA_report.json"},
            "total_tokens": 200,
            "total_cost_usd": 0.02,
        },
    }
    (reports / "COMET_FULL_040_BETA_report.json").write_text(json.dumps(workflow))

    report = build_report(experiment)

    assert "## Source evidence" in report
    assert "Use this section to trace each aggregate metric back to the raw run artifacts." in report
    assert "`Quality` is the sample-quality status used by the analysis-set filter." in report
    assert "`Skill sources` records installed Skill identity or hash evidence when the run provides it." in report
    assert "`run-123`" in report
    assert "comet-workflow" in report
    assert "sha256:abc" in report
    assert "reports/COMET_FULL_040_BETA_report.json" in report


def test_compare_report_overall_uses_weighted_score(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)

    workflow = {
        "name": "comet-full-workflow-COMET_FULL_040_BETA",
        "passed": True,
        "checks_passed": [
            "[RUBRIC] main_flow: 1.00 - ok",
            "[RUBRIC] gate_guard: 1.00 - ok",
            "[RUBRIC] skill_invocation: 1.00 - ok",
            "[RUBRIC] spec_drift: 1.00 - ok",
            "[RUBRIC] business_completion: 1.00 - ok",
            "[RUBRIC] workflow_completion: 1.00 - ok",
            "[RUBRIC] efficiency: 1.00 - ok",
            "[RUBRIC] decision_point_compliance: 1.00 - ok",
            "[RUBRIC] artifact_quality: 1.00 - ok",
            "[RUBRIC] recovery_resilience: 1.00 - ok",
            "[RUBRIC] weighted_score: 0.25",
        ],
        "checks_failed": [],
        "events_summary": {},
    }
    baseline = {
        "name": "comet-full-workflow-COMET_FULL_039",
        "passed": True,
        "checks_passed": [
            "[RUBRIC] main_flow: 0.00 - missing",
            "[RUBRIC] gate_guard: 0.00 - missing",
            "[RUBRIC] skill_invocation: 0.00 - missing",
            "[RUBRIC] spec_drift: 0.00 - missing",
            "[RUBRIC] business_completion: 0.00 - missing",
            "[RUBRIC] workflow_completion: 0.00 - missing",
            "[RUBRIC] efficiency: 0.00 - missing",
            "[RUBRIC] decision_point_compliance: 0.00 - missing",
            "[RUBRIC] artifact_quality: 0.00 - missing",
            "[RUBRIC] recovery_resilience: 0.00 - missing",
            "[RUBRIC] weighted_score: 0.75",
        ],
        "checks_failed": [],
        "events_summary": {},
    }
    (reports / "workflow_report.json").write_text(json.dumps(workflow))
    (reports / "baseline_report.json").write_text(json.dumps(baseline))

    report = build_report(experiment)

    assert "| **Overall** | — | 0.25 | 0.75 | -0.50 |" in report


def test_compare_report_marks_control_workflow_dimensions_with_slash(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)

    control = {
        "name": "comet-full-workflow-CONTROL",
        "passed": True,
        "checks_passed": [
            "[RUBRIC] main_flow: N/A - CONTROL business-only baseline",
            "[RUBRIC] gate_guard: N/A - CONTROL business-only baseline",
            "[RUBRIC] skill_invocation: N/A - CONTROL business-only baseline",
            "[RUBRIC] spec_drift: N/A - CONTROL business-only baseline",
            "[RUBRIC] business_completion: 1.00 - ok",
            "[RUBRIC] workflow_completion: N/A - CONTROL business-only baseline",
            "[RUBRIC] efficiency: 1.00 - ok",
            "[RUBRIC] weighted_score: 1.00",
        ],
        "checks_failed": [],
        "events_summary": {},
    }
    workflow = {
        "name": "comet-full-workflow-COMET_FULL_040_BETA",
        "passed": True,
        "checks_passed": [
            "[RUBRIC] main_flow: 1.00 - ok",
            "[RUBRIC] gate_guard: 1.00 - ok",
            "[RUBRIC] skill_invocation: 1.00 - ok",
            "[RUBRIC] spec_drift: 1.00 - ok",
            "[RUBRIC] business_completion: 1.00 - ok",
            "[RUBRIC] workflow_completion: 1.00 - ok",
            "[RUBRIC] efficiency: 1.00 - ok",
            "[RUBRIC] weighted_score: 1.00",
        ],
        "checks_failed": [],
        "events_summary": {},
    }
    baseline = dict(workflow, name="comet-full-workflow-COMET_FULL_039")
    (reports / "control_report.json").write_text(json.dumps(control))
    (reports / "workflow_report.json").write_text(json.dumps(workflow))
    (reports / "baseline_report.json").write_text(json.dumps(baseline))

    report = build_report(experiment)

    assert "| main_flow | / | 1.00 | 1.00 | +0.00 |" in report
    assert "| skill_invocation | / | 1.00 | 1.00 | +0.00 |" in report
    assert "| business_completion | 1.00 | 1.00 | 1.00 | +0.00 |" in report
    assert "| workflow_completion | / | 1.00 | 1.00 | +0.00 |" in report
    assert "| completion |" not in report


def test_compare_report_excludes_hard_noise_from_analysis_metrics(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_quality_report(
        reports,
        "workflow_clean",
        name="comet-fix-median-COMET_FULL_040_BETA",
        weighted_score=1.0,
        tokens=200,
        cost=0.02,
        sample_quality={
            "status": "included",
            "reason_code": "valid_signal",
            "reason": "clean",
            "include_in_analysis": True,
            "confidence": "high",
            "evidence": ["result event present"],
        },
    )
    _write_quality_report(
        reports,
        "workflow_timeout",
        name="comet-fix-median-COMET_FULL_040_BETA-r1",
        weighted_score=0.0,
        tokens=999,
        cost=9.99,
        sample_quality={
            "status": "excluded",
            "reason_code": "api_timeout",
            "reason": "timeout",
            "include_in_analysis": False,
            "confidence": "high",
            "evidence": ["stderr timeout"],
        },
        passed=False,
    )
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    report = build_report(experiment)

    assert "## Data quality summary" in report
    assert "| COMET_FULL_040_BETA | 2 | 1 | 0 | 1 |" in report
    assert "| COMET_FULL_040_BETA | 1 |" in report
    assert "| COMET_FULL_040_BETA | 1 | 200 | $0.0200 | 200 | $0.0200 |" in report
    assert "workflow_timeout" in report
    assert "api_timeout" in report
    assert "999" not in report.split("## Spend summary", 1)[1].split("## Source evidence", 1)[0]


def test_compare_report_lists_flagged_runs_without_excluding_them(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    _write_quality_report(
        reports,
        "workflow_flagged",
        name="comet-full-workflow-COMET_FULL_040_BETA",
        weighted_score=0.5,
        tokens=200,
        cost=0.02,
        sample_quality={
            "status": "flagged",
            "reason_code": "harness_trigger_suspect",
            "reason": "target Skill may not have been triggered",
            "include_in_analysis": True,
            "confidence": "medium",
            "evidence": ["target Skill was never invoked"],
        },
    )

    report = build_report(experiment)

    assert "## Flagged runs" in report
    assert "harness_trigger_suspect" in report
    assert "| Treatment | Raw runs | Analysis set | Flagged | Excluded |" in report
    assert "| COMET_FULL_040_BETA | 1 | 1 | 1 | 0 |" in report
    assert "| COMET_FULL_040_BETA | 1 | 200 | $0.0200 | 200 | $0.0200 |" in report


def test_compare_report_summarizes_multiline_loop_evidence(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    _write_quality_report(
        reports,
        "workflow_flagged",
        name="comet-full-workflow-COMET_FULL_040_BETA",
        weighted_score=0.5,
        tokens=200,
        cost=0.02,
        sample_quality={
            "status": "flagged",
            "reason_code": "completed_run_mentions_outer_failure",
            "reason": "completed with suspicious runner output",
            "include_in_analysis": True,
            "confidence": "medium",
            "evidence": [
                "[loop] turn 1/12\n"
                "[loop] decision point detected; simulating user reply\n"
                "[loop] simulated reply (42 chars)\n"
                "[loop] turn 2/12\n"
                "[loop] workflow appears complete; ending\n"
                "[loop] finished after 2 turns"
            ],
        },
    )

    report = build_report(experiment)

    assert "loop trace: 2 turns; 1 simulated decision reply; see report JSON for full evidence" in report
    flagged_section = report.split("## Flagged runs", 1)[1].split("## Raw vs analysis", 1)[0]
    assert "[loop] decision point detected" not in flagged_section


def test_compare_report_reports_insufficient_clean_data(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    _write_quality_report(
        reports,
        "workflow_timeout",
        name="comet-full-workflow-COMET_FULL_040_BETA",
        weighted_score=0.0,
        tokens=999,
        cost=9.99,
        sample_quality={
            "status": "excluded",
            "reason_code": "runner_timeout",
            "reason": "timeout",
            "include_in_analysis": False,
            "confidence": "high",
            "evidence": ["Timeout after 600s"],
        },
        passed=False,
    )

    report = build_report(experiment)

    assert "Insufficient clean data" in report
    assert "COMET_FULL_040_BETA" in report


def test_compare_report_keeps_data_quality_sections_when_all_key_runs_are_excluded(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_quality_report(
        reports,
        "workflow_timeout",
        name="comet-full-workflow-COMET_FULL_040_BETA",
        weighted_score=0.0,
        tokens=999,
        cost=9.99,
        sample_quality={
            "status": "excluded",
            "reason_code": "runner_timeout",
            "reason": "timeout",
            "include_in_analysis": False,
            "confidence": "high",
            "evidence": ["Timeout after 600s"],
        },
        passed=False,
    )
    _write_quality_report(
        reports,
        "baseline_timeout",
        name="comet-full-workflow-COMET_FULL_039",
        weighted_score=0.0,
        tokens=888,
        cost=8.88,
        sample_quality={
            "status": "excluded",
            "reason_code": "api_timeout",
            "reason": "timeout",
            "include_in_analysis": False,
            "confidence": "high",
            "evidence": ["stderr timeout"],
        },
        passed=False,
    )

    report = build_report(experiment)

    assert "## Data quality summary" in report
    assert "## Excluded runs" in report
    assert "## Source evidence" in report
    assert "Insufficient clean data" in report
    assert "No report data found" not in report


def test_html_report_includes_data_quality_summary(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "Data quality summary" in html
    assert "paper-figure" in html


def test_html_report_wraps_wide_evidence_tables(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    _write_quality_report(
        reports,
        "workflow_flagged",
        name="comet-full-workflow-COMET_FULL_040_BETA",
        weighted_score=0.5,
        tokens=200,
        cost=0.02,
        sample_quality={
            "status": "flagged",
            "reason_code": "completed_run_mentions_outer_failure",
            "reason": "completed with suspicious runner output",
            "include_in_analysis": True,
            "confidence": "medium",
            "evidence": ["a-very-long-evidence-token-without-natural-breaks-" * 8],
        },
    )

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert 'class="table-scroll"' in html
    assert 'class="col-evidence"' in html
    assert 'class="col-report"' in html
    assert "overflow-wrap: anywhere" in html


def test_html_report_includes_bilingual_language_toggle(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert '<html lang="zh-CN" data-lang="zh">' in html
    assert 'class="language-toggle"' in html
    assert 'data-set-lang="zh"' in html
    assert 'data-set-lang="en"' in html
    assert 'data-locale="zh"' in html
    assert 'data-locale="en"' in html
    assert "Comet 基线对比报告" in html
    assert "Comet Baseline Comparison Report" in html
    assert "pass@k / pass^k — 能力上限 vs 可靠性下限" in html
    assert "指标说明" in html
    assert "运行摘要" in html
    assert "业务 validator 通过率" in html


def test_html_report_uses_conference_paper_layout(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "--page-width: 980px;" in html
    assert "linear-gradient(90deg" not in html
    assert "box-shadow: none;" in html
    assert "border-top: 2px solid var(--ink);" in html
    assert html.index("<h1>Comet 基线对比报告</h1>") < html.index('class="paper-figures"')


def test_html_report_includes_paper_abstract_and_centers_figures(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert '<section class="paper-abstract">' in html
    assert "<strong>Abstract.</strong>" in html
    assert "<strong>摘要。</strong>" in html
    assert "justify-items: center;" in html
    assert "margin-left: auto;" in html
    assert "margin-right: auto;" in html
    assert html.index("<h1>Comet 基线对比报告</h1>") < html.index('<section class="paper-abstract">')
    assert html.index('<section class="paper-abstract">') < html.index('class="paper-figures"')


def test_html_report_centers_markdown_tables(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "width: max-content;" in html
    assert "max-width: 100%;" in html
    assert "margin: 0 auto 1rem;" in html
    assert "margin: 0 auto;" in html
    assert "text-align: center;" in html
    assert ".col-task," in html


def test_html_report_renders_localized_emphasis_without_literal_underscore_markers(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "<p>_分数是二值通过率" not in html
    assert "权重见下方）。_</p>" not in html
    assert "<p><em>分数是二值通过率" in html
    assert "weighted_score" in html


def test_html_report_keeps_chinese_chart_text_utf8(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "图 1. Rubric 维度差异" in html
    assert "图 3. 任务结果矩阵" in html
    assert "ͼ 1." not in html
    assert "����" not in html


def test_html_report_localizes_failure_attribution_in_chinese_layer(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)
    control = {
        "name": "comet-fix-median-CONTROL",
        "passed": False,
        "checks_passed": [],
        "checks_failed": ["business validator failed"],
        "events_summary": {},
    }
    workflow = {
        "name": "comet-fix-median-COMET_FULL_040_BETA",
        "passed": False,
        "checks_passed": [],
        "checks_failed": ["workflow validator failed"],
        "events_summary": {},
    }
    (reports / "control_report.json").write_text(json.dumps(control), encoding="utf-8")
    (reports / "workflow_report.json").write_text(json.dumps(workflow), encoding="utf-8")

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")
    zh = html.split('<section class="localized" data-locale="zh"', 1)[1].split(
        '<section class="localized" data-locale="en"',
        1,
    )[0]

    assert "CONTROL（1 个失败）" in zh
    assert "business/业务" in zh
    assert "业务实现未通过" in zh
    assert "workflow/流程" in zh
    assert "Workflow 验证未通过" in zh
    assert "model/模型" not in zh
    assert "unclassified failure" not in zh
    assert "failure(s)" not in zh


def test_html_report_renders_markdown_emphasis_without_literal_underscores(tmp_path: Path):
    experiment = tmp_path / "experiment"
    reports = experiment / "reports"
    reports.mkdir(parents=True)
    _write_report(reports, "CONTROL", 100, 0.01)
    _write_report(reports, "COMET_FULL_040_BETA", 200, 0.02)
    _write_report(reports, "COMET_FULL_039", 300, 0.03)

    markdown = build_report(experiment)
    html = render_markdown_html(markdown, title="Comet Baseline Comparison Report")

    assert "<em>仅统计分析集；已排除的硬噪声运行不会进入统计。</em>" in html
    assert "<em>Analysis set only; excluded hard-noise runs are omitted.</em>" in html
    assert "<p>_仅统计分析集" not in html
    assert "<p>_Analysis set only" not in html
