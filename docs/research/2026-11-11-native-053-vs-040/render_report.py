"""Render observed results with the user's historical HTML report design."""

# The report reuses checkout-local parsers after locating the repository.
# ruff: noqa: E402

import argparse
import html
import json
from pathlib import Path
import re
import statistics
import sys

root = next(
    parent
    for parent in Path(__file__).resolve().parents
    if (parent / "package.json").is_file() and (parent / "eval").is_dir()
)
sys.path.insert(0, str(root / "eval"))
from scaffold.python.aligned_comparison import (
    load_treatment_records,
    _artifact_path,
    _read_raw_stdout,
)
from scaffold.python.logging import extract_events
from scaffold.python.native_eval import split_comet_completion_checks


def saved_telemetry(record, directory, treatment):
    source = _artifact_path(
        record.report,
        directory,
        "raw_stdout",
        task=record.task,
        treatment=treatment,
        rep=record.rep,
        report_path=record.report_path,
    )
    if source is None:
        return None
    allowed = directory if source.is_relative_to(directory) else source.parent.parent
    raw = _read_raw_stdout(source, allowed)
    if raw is None:
        return None
    messages = []
    for line in raw.splitlines():
        try:
            messages.append(json.loads(line))
        except ValueError:
            continue
    # These persisted logs are already redacted. Parse their JSON before applying
    # the framework's structured-event extraction; do not rewrite the JSON text.
    telemetry = extract_events({"messages": messages})
    return telemetry if telemetry.get("subject_invocations") else None


parser = argparse.ArgumentParser()
parser.add_argument("candidate", type=Path)
parser.add_argument("--supplement", type=Path, action="append", default=[])
parser.add_argument("--baseline", type=Path)
parser.add_argument(
    "--out", type=Path, default=root / "docs/research/2026-11-11-native-053-vs-040"
)
args = parser.parse_args()
run_meta_path = args.candidate / "dashboard-run.json"
run_meta = (
    json.loads(run_meta_path.read_text(encoding="utf-8"))
    if run_meta_path.is_file()
    else {}
)
historical_classic = (
    root
    / "eval/langsmith/logs/experiments/combined_comet_workflow_full_k3_20260705_v3_rerun_failed"
)
old_native = root / "eval/local/logs/experiments/experiment_20260716_104344"
tasks = root / "eval/local/tasks"
groups = []
specifications = [
    (args.candidate.resolve(), "COMET_NATIVE_SDK_CURRENT", "Native 0.5.3 · DeepSeek"),
    (
        args.baseline.resolve() if args.baseline else historical_classic,
        "COMET_NATIVE_040_RC1" if args.baseline else "COMET_FULL_040_BETA",
        "Native 0.4.0-rc.1 · DeepSeek" if args.baseline else "0.4.0 Classic · MiMo",
    ),
    (old_native, "COMET_NATIVE_PHASE1", "历史 Native · MiMo"),
]
if args.baseline:
    specifications.append(
        (historical_classic, "COMET_FULL_040_BETA", "历史 0.4.0 Classic · MiMo")
    )
for directory, treatment, label in specifications:
    records = [
        (record, directory)
        for record in load_treatment_records(directory, treatment, tasks_dir=tasks)
    ]
    if directory == args.candidate.resolve():
        for supplemental in args.supplement:
            records.extend(
                (record, supplemental.resolve())
                for record in load_treatment_records(
                    supplemental.resolve(), treatment, tasks_dir=tasks
                )
            )
    rows = []
    for record, record_directory in records:
        report = record.report
        telemetry = saved_telemetry(record, record_directory, treatment)
        checks = split_comet_completion_checks(
            report.get("checks_passed", []), report.get("checks_failed", [])
        )
        business = {
            key: [
                check
                for check in values
                if not check.startswith(
                    ("native_", "[RUBRIC", "Agent execution failed")
                )
            ]
            for key, values in checks["business_completion"].items()
        }
        rows.append(
            {
                "task": record.task,
                "rep": record.rep,
                "passed": report["passed"],
                "businessPassed": bool(business["passed"]) and not business["failed"],
                "checksFailed": report.get("checks_failed", []),
                "telemetry": telemetry,
                "quality": report.get("sample_quality"),
                "sourceReport": record.report_path.name,
                "sourceExperiment": record_directory.name,
                "currentCometBuild": report.get("events_summary", {}).get(
                    "current_comet_build"
                ),
                "executionIdentity": report.get("events_summary", {}).get(
                    "execution_identity"
                ),
                "failureAttribution": report.get("events_summary", {}).get(
                    "failure_attribution", []
                ),
            }
        )
    recorded = len(rows)
    if directory == args.candidate.resolve() or (
        args.baseline and directory == args.baseline.resolve()
    ):
        expected = json.loads(
            (directory / "expected-case-matrix.json").read_text(encoding="utf-8")
        )["cases"]
        expected_keys = {
            (c["task"], c["rep"]) for c in expected if c["treatment"] == treatment
        }
        present = {(r["task"], r["rep"]) for r in rows}
        assert present <= expected_keys and len(expected_keys) == 48
        for task, rep in sorted(expected_keys - present):
            rows.append(
                {
                    "task": task,
                    "rep": rep,
                    "passed": None,
                    "businessPassed": None,
                    "checksFailed": [],
                    "telemetry": None,
                    "quality": None,
                    "sourceReport": None,
                    "status": "unscored",
                }
            )
    assert len(rows) == 48 and len({(r["task"], r["rep"]) for r in rows}) == 48, (
        label,
        len(rows),
    )
    grouped = {}
    for row in rows:
        grouped.setdefault(row["task"], []).append(row)
    assert len(grouped) == 16 and all(
        sorted(r["rep"] for r in v) == [1, 2, 3] for v in grouped.values()
    )
    models = sorted(
        {m for r in rows for m in (r["telemetry"] or {}).get("model_usage", {})}
    )
    durations = [
        r["telemetry"]["duration_seconds"] for r in rows if r["telemetry"] is not None
    ]
    missing = 48 - recorded
    summary = {
        "runs": len(rows),
        "recordedRuns": recorded,
        "missingRuns": missing,
        "successes": sum(r["passed"] is True for r in rows),
        "failures": sum(r["passed"] is False for r in rows),
        "businessSuccesses": sum(r["businessPassed"] is True for r in rows),
        "pass1": None if missing else sum(r["passed"] for r in rows) / 48 * 100,
        "pass3": None
        if missing
        else sum(any(r["passed"] for r in v) for v in grouped.values()) / 16 * 100,
        "all3": None
        if missing
        else sum(all(r["passed"] for r in v) for v in grouped.values()) / 16 * 100,
        "durationCount": len(durations),
        "durationMean": statistics.mean(durations) if durations else None,
        "durationMedian": statistics.median(durations) if durations else None,
        "models": models,
        "agentVersions": sorted(
            {
                row["executionIdentity"]["agent_cli_version"]
                for row in rows
                if (row.get("executionIdentity") or {}).get("agent_cli_version")
            }
        ),
        "modelRoutingIdentities": sorted(
            {
                row["executionIdentity"]["model_selection_hash"]
                for row in rows
                if (row.get("executionIdentity") or {}).get("model_selection_hash")
            }
        ),
    }
    peaks = [
        r["telemetry"]["peak_context_input_tokens"]
        for r in rows
        if r["telemetry"] is not None
        and isinstance(r["telemetry"].get("peak_context_input_tokens"), (int, float))
    ]
    summary["contextCoverage"] = len(peaks)
    summary["contextMeanPeak"] = statistics.mean(peaks) if peaks else None
    summary["contextMedianPeak"] = statistics.median(peaks) if peaks else None
    summary["contextMaxPeak"] = max(peaks) if peaks else None
    groups.append(
        {
            "label": label,
            "experiment": directory.name,
            "treatment": treatment,
            "summary": summary,
            "rows": rows,
        }
    )

current, classic, previous = groups[:3]
display_groups = groups[:2] if args.baseline else groups
attempts = []
for run_dir in [
    args.candidate,
    *args.supplement,
    *([args.baseline] if args.baseline else []),
]:
    planned = json.loads(
        (run_dir / "expected-case-matrix.json").read_text(encoding="utf-8")
    )["cases"]
    expected_keys = {(c["task"], c["rep"]) for c in planned}
    scored = {
        (r["task"], r["rep"])
        for group in groups
        for r in group["rows"]
        if r.get("sourceExperiment") == run_dir.name and r["passed"] is not None
    }
    attempts.append(
        {
            "experiment": run_dir.name,
            "plannedCases": len(expected_keys),
            "scoredCases": len(scored),
            "unscoredCases": [
                {"task": task, "rep": rep}
                for task, rep in sorted(expected_keys - scored)
            ],
        }
    )
assert {r["task"] for r in current["rows"]} == {r["task"] for r in classic["rows"]}
index = [{(r["task"], r["rep"]): r for r in group["rows"]} for group in groups]
display_index = index[: len(display_groups)]
paired = [
    key for key, row in index[0].items() if row["passed"] and index[1][key]["passed"]
]
metrics = [
    ("模型启动 / 恢复次数", "subject_invocations", 2),
    ("Agent 轮次", "num_turns", 2),
    ("工具调用", "tools", 2),
    ("累计 Agent 执行耗时（秒）", "duration_seconds", 1),
    ("非缓存输入 Token", "input_tokens", 0),
    ("输出 Token", "output_tokens", 0),
    ("可观测 Token 总量（含缓存读取）", "total_tokens", 0),
    ("CLI 估算成本（美元）", "total_cost_usd", 3),
]


def value(row, field):
    telemetry = row.get("telemetry")
    if telemetry is None:
        return None
    if field == "tools":
        return len(telemetry.get("tool_calls", []))
    return telemetry.get(field)


efficiency = []
for label, field, places in metrics:
    keys = [
        key
        for key in paired
        if all(isinstance(value(side[key], field), (int, float)) for side in index[:2])
    ]
    averages = [
        statistics.mean(value(side[key], field) for key in keys) if keys else None
        for side in index[:2]
    ]
    efficiency.append(
        {
            "label": label,
            "field": field,
            "places": places,
            "pairs": len(keys),
            "values": averages,
        }
    )


def escape(value):
    return html.escape(str(value))


def number(value, places=1):
    return "N/A" if value is None else f"{value:,.{places}f}"


def rate(value):
    if value is None:
        return "N/A"
    return number(value, 2).rstrip("0").rstrip(".") + "%"


def difference(a, b, places=1):
    return "N/A" if a is None or not b else f"{(a / b - 1) * 100:+.{places}f}%"


def table(headers, rows):
    return (
        '<div class="table-scroll"><table><thead><tr>'
        + "".join(f"<th>{escape(h)}</th>" for h in headers)
        + "</tr></thead><tbody>"
        + "".join(
            "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows
        )
        + "</tbody></table></div>"
    )


def section(id, title, body):
    return f'<section aria-labelledby="{id}"><h2 id="{id}">{title}</h2>{body}</section>'


style = re.search(
    r"<style>(.*?)</style>",
    (
        root
        / "website/assets/eval-reports/comet-native-vs-040-20260716/native-benchmark-report.html"
    ).read_text(encoding="utf-8"),
    re.S,
)[1]
style += "\nsmall{color:var(--muted)}td{vertical-align:top}details{margin:16px 0}summary{cursor:pointer}code{overflow-wrap:anywhere}.badge-pass{color:var(--pass)}.badge-fail{color:var(--fail)}.badge-unknown{color:var(--muted)}.chart-value{min-width:0}.matrix-mark{display:inline-block;min-width:1.4em;font-weight:700}header p{max-width:75ch}.missing-label{display:block;font:12px sans-serif;color:var(--muted);text-align:center;line-height:20px}"
title = (
    "Native 0.5.3 与 Native 0.4.0-rc.1 同配置评估"
    if args.baseline
    else "Native 0.5.3 与 0.4.0 Classic 历史对照"
)
a, b = [g["summary"] for g in groups[:2]]
baseline_caption = (
    "Native 0.4.0-rc.1 / DeepSeek" if args.baseline else "0.4.0 Classic / MiMo"
)
baseline_short = "rc.1" if args.baseline else "Classic"
lead = f"当前 Native 取得 {a['recordedRuns']}/48 份评分，已确认严格通过 {a['successes']} 次，评分失败 {a['failures']} 次，缺少评分 {a['missingRuns']} 次；历史 Classic 严格通过 {b['successes']}/48。计划均为 16 题各重复 3 次，模型分别为 DeepSeek 与 MiMo。"
if args.baseline:
    lead = f"Native 严格通过 {a['successes']}/48，冻结的 Native 0.4.0-rc.1 严格通过 {b['successes']}/48。两组沿用同一 DeepSeek 主模型参数与快速模型映射、同一 Agent 版本，各执行 16 题 × 3 次。缺少评分分别为 {a['missingRuns']} 与 {b['missingRuns']} 次。历史 MiMo 结果仅作参考。"
supplemented = sum(
    row.get("sourceExperiment") not in {None, args.candidate.name}
    for row in current["rows"]
)
if supplemented:
    lead += f"其中 {supplemented} 份评分来自用户授权的准备失败补齐；原批次的失败记录保留在下方执行批次表中。"
body = (
    '<header class="report-header"><p class="kicker">COMET / NATIVE EVALUATION / 2026-11</p><h1>'
    + title
    + '</h1><p class="dek">'
    + lead
    + "</p></header>"
)
if run_meta.get("status") in {"running", "queued", "preparing"}:
    body += '<p role="status"><strong>评估运行中 · 中间预览</strong>。当前缺少评分的格子包括尚未执行的样本；最终结果以本轮结束后的版本为准。</p>'
cards = [
    (
        "Native 0.5.3 strict pass@1",
        rate(a["pass1"]),
        f"{baseline_short} {rate(b['pass1'])}；缺少评分时不估算完整通过率",
    ),
    ("Native 0.5.3 pass@3", rate(a["pass3"]), f"{baseline_short} {rate(b['pass3'])}"),
    ("Native 0.5.3 pass^3", rate(a["all3"]), f"{baseline_short} {rate(b['all3'])}"),
    (
        "Native 0.5.3 平均累计 Agent 执行耗时",
        number(a["durationMean"]) + "s",
        f"可观测 {a['durationCount']}/48；{baseline_short} {number(b['durationMean'])}s",
    ),
]
body += section(
    "headline",
    "核心数据",
    '<div class="metric-grid">'
    + "".join(
        f'<article class="metric"><div class="metric-label">{label}</div><span class="metric-value">{val}</span><span class="metric-context">{context}</span></article>'
        for label, val, context in cards
    )
    + "</div>",
)
chart = '<article class="figure"><div class="figure-head"><h3 class="figure-title">pass@1、pass@3 与 pass^3</h3><span class="figure-note">百分比，越高越好</span></div><div class="legend"><span style="--legend-color:var(--native)">Native 0.5.3 / DeepSeek</span><span style="--legend-color:var(--classic)">0.4.0 Classic / MiMo</span></div><div class="chart" role="img" aria-label="三项通过率对照">'
chart = chart.replace("0.4.0 Classic / MiMo", baseline_caption)
for label, key in [("pass@1", "pass1"), ("pass@3", "pass3"), ("pass^3", "all3")]:
    native_bar = (
        '<span class="missing-label">评分不完整</span>'
        if a[key] is None
        else f'<div class="bar" style="--value:{a[key]}%;--color:var(--native)"></div>'
    )
    classic_bar = (
        '<span class="missing-label">评分不完整</span>'
        if b[key] is None
        else f'<div class="bar" style="--value:{b[key]}%;--color:var(--classic)"></div>'
    )
    chart += f'<div class="chart-row"><div class="chart-label">{label}</div><div class="bar-pair"><div class="track">{native_bar}</div><div class="track">{classic_bar}</div></div><div class="chart-value">{rate(a[key])}<br>{rate(b[key])}</div></div>'
chart += '</div><p class="caption">pass@3 是每题三次至少一次通过；pass^3 是每题三次全部通过。完整评分不足 48 次时，该组完整通过率显示 N/A；空条不表示 0%。不把缺失评分算作模型失败，也不剔除后另称完整 48 次。</p></article>'
body += section("reliability", "pass@k 实验结果", chart)
eff_rows = [
    [
        escape(m["label"]),
        number(m["values"][0], m["places"]),
        number(m["values"][1], m["places"]),
        difference(*m["values"]),
        str(m["pairs"]),
    ]
    for m in efficiency
]
comparison_scope = (
    "相同主模型参数和快速模型映射；运行窗口与流程依赖没有完全受控，不能单独把差异归因于某项特性移除"
    if args.baseline
    else "模型和执行环境不同，这是描述性配对，不是受控因果比较"
)
body += section(
    "efficiency",
    "完成任务的执行效率",
    f"<p>仅统计同一题、同一重复编号在两组都通过的 {len(paired)} 对；{comparison_scope}。缺少原始遥测时按指标缩小可观测分母。</p>"
    + table(
        ["指标", "Native / DeepSeek", baseline_caption, "相对差异", "可观测配对"],
        eff_rows,
    )
    + '<p class="caption">成本来自 CLI 估算，不是供应商账单。Token 统计覆盖保存的受测 Agent 调用，完整 workflow（含独立子 Agent）的总量不可观测。累计 Agent 执行耗时累加每个样本全部顶层 result.duration_ms，包含模型调用、Agent 工具执行和续行，保留结束判断造成的额外调用；不含 Docker 准备和 Agent 退出后的业务验证。</p>',
)
body += section(
    "models",
    "模型与 Agent 记录",
    table(
        ["组别", "实际 Agent 版本", "原轨迹中的模型标签"],
        [
            [
                escape(group["label"]),
                escape(", ".join(group["summary"]["agentVersions"])) or "旧记录未绑定",
                escape(", ".join(group["summary"]["models"])) or "无可观测记录",
            ]
            for group in display_groups
        ],
    )
    + "<p>主模型参数为 deepseek-flash[1M]，快速和默认模型映射到 deepseek-v4-flash 系列。不同标签保留在原始用量中，不强行合并；历史 MiMo 组不参与同配置主比较。</p>",
)
body += section(
    "context",
    "可观测的峰值上下文",
    table(
        [
            "组别",
            "保存逐消息 usage 的样本",
            "平均峰值 Token",
            "中位峰值 Token",
            "最大峰值 Token",
        ],
        [
            [
                escape(g["label"]),
                f"{g['summary']['contextCoverage']}/48",
                number(g["summary"]["contextMeanPeak"], 0),
                number(g["summary"]["contextMedianPeak"], 0),
                number(g["summary"]["contextMaxPeak"], 0),
            ]
            for g in display_groups
        ],
    )
    + '<p class="caption">按各组保存的逐消息 usage 计算峰值，并列出可观测分母。这是本批次的上下文观测值，不代表其他任务的上下文上限。</p>',
)
latency_max = (
    max((g[key] or 0) for g in (a, b) for key in ("durationMean", "durationMedian"))
    or 1
)
latency = '<article class="figure"><div class="figure-head"><h3 class="figure-title">累计 Agent 执行耗时的平均值与中位数</h3><span class="figure-note">秒；同一零点刻度，越低越好</span></div><div class="legend"><span style="--legend-color:var(--native)">Native / DeepSeek</span><span style="--legend-color:var(--classic)">Classic / MiMo</span></div><div class="chart" role="img" aria-label="累计 Agent 执行耗时对照">'
latency = latency.replace("Classic / MiMo", baseline_caption)
for label, key in [("平均值", "durationMean"), ("中位数", "durationMedian")]:
    latency += f'<div class="chart-row"><div class="chart-label">{label}</div><div class="bar-pair"><div class="track"><div class="bar" style="--value:{(a[key] or 0) / latency_max * 100}%;--color:var(--native)"></div></div><div class="track"><div class="bar" style="--value:{(b[key] or 0) / latency_max * 100}%;--color:var(--classic)"></div></div></div><div class="chart-value">{number(a[key])}<br>{number(b[key])}</div></div>'
latency += '</div><p class="caption">仅使用可观测的累计 result duration。耗时受模型、时段与运行环境共同影响。</p></article>'
body += section(
    "latency",
    "累计 Agent 执行耗时",
    latency
    + table(
        ["组别", "可观测样本", "平均（秒）", "中位数（秒）"],
        [
            [
                escape(g["label"]),
                f"{g['summary']['durationCount']}/48",
                number(g["summary"]["durationMean"]),
                number(g["summary"]["durationMedian"]),
            ]
            for g in display_groups
        ],
    ),
)
matrix_rows = []
for task in sorted({r["task"] for r in current["rows"]}):
    cells = [f"<code>{escape(task)}</code>"]
    for side in display_index:
        cells.append(
            " ".join(
                f'<span class="matrix-mark badge-{"pass" if side[(task, rep)]["passed"] else "fail" if side[(task, rep)]["passed"] is False else "unknown"}" title="r{rep}">{"✓" if side[(task, rep)]["passed"] else "×" if side[(task, rep)]["passed"] is False else "?"}</span>'
                for rep in (1, 2, 3)
            )
        )
    matrix_rows.append(cells)
body += section(
    "matrix",
    "任务级稳定性矩阵",
    "<p>每格依次表示 r1、r2、r3。✓ 通过，× 评分失败，? 缺少评分。2026-07 的 MiMo 数据仅作历史参考。</p>"
    + table(["任务", *[group["label"] for group in display_groups]], matrix_rows),
)
failures = []
for g in display_groups:
    failed = [r for r in g["rows"] if r["passed"] is False]
    failure_rows = [
        [
            f"<code>{escape(r['task'])}</code> / r{r['rep']}",
            "<br>".join(escape(x) for x in r["checksFailed"]) or "未保存详细检查",
        ]
        for r in failed
    ]
    failures.append(
        f"<details><summary>{escape(g['label'])}：{len(failed)} 次严格失败；业务通过 {g['summary']['businessSuccesses']}/48</summary>"
        + table(["样本", "原始失败检查"], failure_rows)
        + "</details>"
    )
    absent = [r for r in g["rows"] if r["passed"] is None]
    if absent:
        failures.append(
            "<details open><summary>缺少评分："
            + str(len(absent))
            + " 次</summary>"
            + table(
                ["样本", "状态"],
                [
                    [
                        f"<code>{escape(r['task'])}</code> / r{r['rep']}",
                        "无逐样本评分；准备失败证据见执行记录",
                    ]
                    for r in absent
                ],
            )
            + "</details>"
        )
body += section(
    "failures",
    "失败检查与业务结果",
    "".join(failures)
    + "<p>业务成绩与 workflow 完成分别保留。API、构建和执行器失败应结合原始日志归因，不自动解释成模型或业务能力失败。</p>",
)
body += section(
    "attempts",
    "执行批次与缺失记录",
    table(
        ["实验", "计划项", "取得评分", "未取得评分"],
        [
            [
                f"<code>{escape(attempt['experiment'])}</code>",
                str(attempt["plannedCases"]),
                str(attempt["scoredCases"]),
                str(len(attempt["unscoredCases"])),
            ]
            for attempt in attempts
        ],
    )
    + "<p>补齐仅在用户明确授权后执行。原批次的准备失败保持原记录；每组中的同一题目与重复编号只取一份真实模型评分，不覆盖已有模型结果。此前第一轮 48 项均在 setup 阶段失败，模型运行 0 次，详见执行记录。</p>",
)
if args.baseline:
    body += section(
        "history",
        "原报告历史参考",
        "<details><summary>展开 MiMo 历史结果（未重跑，不参与主比较）</summary>"
        + table(
            ["历史组别", "严格通过", "pass@3", "pass^3", "平均累计 Agent 执行耗时"],
            [
                [
                    escape(group["label"]),
                    f"{group['summary']['successes']}/48",
                    rate(group["summary"]["pass3"]),
                    rate(group["summary"]["all3"]),
                    number(group["summary"]["durationMean"]) + "s",
                ]
                for group in groups[2:]
            ],
        )
        + "<p>这些数据来自 2026-07，旧 Native 是当时的协议快照，不代表本次选定的 0.4.0-rc.1。</p></details>",
    )
boundaries = [
    (
        "对齐的范围",
        "相同 16 个业务任务 ID、每题 3 次；当前任务的业务输入与业务验证器未为 Native 改写。",
    ),
    (
        "模型配置" if args.baseline else "模型不同",
        "本轮两组使用同一 DeepSeek 配置，包括主模型和快速模型映射；具体标签与工具版本见上表。历史 MiMo 组仅作参考。"
        if args.baseline
        else "本轮使用 DeepSeek 配置；历史两组原始轨迹出现 "
        + escape(", ".join(b["models"]))
        + "。",
    ),
    (
        "流程协议不同",
        "0.5.3 验证 SDK owner、原 Run、归档 checkpoint 与终态；0.4.0-rc.1 沿用自身 Native 协议，保留原版的独立审查和归档要求。历史参考保留各自原始评分。"
        if args.baseline
        else "当前 Native 验证 SDK owner、原 Run、归档 checkpoint 与终态；历史 Native 和 Classic 保留当时各自的协议与评分。",
    ),
    (
        "执行条件",
        "本次两组使用同一机器、相同 Agent 版本与模型映射；用户确认均由评估器以 auto_user 模拟，上限 12 轮。两组在不同窗口执行，保留各自流程依赖，未完全控制服务负载。历史参考来自 2026-07，其执行身份不能完整复原。"
        if args.baseline
        else "历史数据来自 2026-07，本轮来自 2026-11。Agent 版本、机器环境和服务负载没有在同一窗口中控制；旧轨迹不能完整证明全部执行身份或历史输入逐字节一致。",
    ),
    (
        "全部结果保留",
        "矩阵固定为每组计划 48 次与 16 题，不筛去低分、环境失败或 flagged 样本。评分缺失标为未知，不推算完整通过率。逐样本质量标记保留在附带 JSON。",
    ),
    (
        "验证范围",
        "通过表示满足这 16 题的确定性业务与流程检查，未使用 LLM Judge；不能据此证明其他任务的质量相同。本任务未重新执行全仓测试、完整安装验收或独立真实桌面平台 Hook 验收。",
    ),
    (
        "可追溯来源",
        "<br>".join("<code>" + escape(g["experiment"]) + "</code>" for g in groups),
    ),
]
body += section(
    "boundary",
    "比较边界与来源",
    '<div class="method-grid">'
    + "".join(
        f'<article class="method-item"><h3>{label}</h3><p>{text}</p></article>'
        for label, text in boundaries
    )
    + '</div><p><a href="https://docs.comet.rpamis.com/zh/eval/comet-native-vs-040-experiment">原始报告与实验说明</a> · <a href="comparison-data.json">逐样本结果与遥测</a></p>',
)
document = (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + title
    + "</title><style>"
    + style
    + "</style></head><body><main>"
    + body
    + "</main></body></html>"
)
args.out.mkdir(parents=True, exist_ok=True)
(args.out / "native-benchmark-report.html").write_text(document, encoding="utf-8")
for group in groups:
    for row in group["rows"]:
        telemetry = row["telemetry"]
        if telemetry is not None:
            row["telemetry"] = {
                key: telemetry.get(key)
                for key in (
                    "duration_seconds",
                    "subject_invocations",
                    "num_turns",
                    "input_tokens",
                    "output_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                    "total_tokens",
                    "total_cost_usd",
                    "cost_basis",
                    "model_usage",
                    "token_scope",
                    "duration_scope",
                    "model_usage_status",
                    "telemetry_warnings",
                    "peak_context_input_tokens",
                    "p95_context_input_tokens",
                    "peak_context_window_tokens",
                    "peak_context_occupancy_pct",
                )
            }
            row["telemetry"]["tool_call_count"] = len(telemetry.get("tool_calls", []))
(args.out / "comparison-data.json").write_text(
    json.dumps(
        {
            "groups": groups,
            "attempts": attempts,
            "pairedSuccesses": len(paired),
            "efficiency": efficiency,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
print(
    json.dumps({g["label"]: g["summary"] for g in groups}, ensure_ascii=False, indent=2)
)
