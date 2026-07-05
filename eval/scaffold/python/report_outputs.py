"""Configurable report output helpers for eval summaries."""

from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ReportOutputConfig:
    """Controls which report formats are written."""

    markdown: bool = True
    html: bool = False


def load_report_output_config(config_path: str | Path | None = None) -> ReportOutputConfig:
    """Load report output settings from a JSON/YAML config file or env var.

    The supported shape is:

        {"report_outputs": {"markdown": true, "html": false}}

    If no file is provided and COMET_EVAL_REPORT_CONFIG is unset, only markdown
    is written to preserve the existing eval behavior.
    """
    selected = config_path or os.environ.get("COMET_EVAL_REPORT_CONFIG")
    if not selected:
        return ReportOutputConfig()

    path = Path(selected)
    data = _read_config_file(path)
    report_outputs = data.get("report_outputs", data)
    if not isinstance(report_outputs, dict):
        raise ValueError("report_outputs must be an object")

    return ReportOutputConfig(
        markdown=_read_bool(report_outputs, "markdown", default=True),
        html=_read_bool(report_outputs, "html", default=False),
    )


def write_report_outputs(
    markdown: str,
    markdown_path: Path,
    config: ReportOutputConfig,
    *,
    title: str,
) -> dict[str, Path]:
    """Write enabled report formats and return paths by format name."""
    written: dict[str, Path] = {}

    if config.markdown:
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(markdown, encoding="utf-8")
        written["markdown"] = markdown_path

    if config.html:
        html_path = markdown_path.with_suffix(".html")
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_text(render_markdown_html(markdown, title=title), encoding="utf-8")
        written["html"] = html_path

    return written


def preferred_report_path(written: dict[str, Path], fallback: Path) -> Path:
    """Return the most useful path for callers that historically returned one file."""
    return written.get("markdown") or written.get("html") or fallback


def render_markdown_html(markdown: str, *, title: str) -> str:
    """Render enough Markdown for eval reports without adding dependencies."""
    figures_zh = _render_paper_figures(markdown, lang="zh")
    figures_en = _render_paper_figures(markdown, lang="en")
    abstract_zh = _render_paper_abstract(markdown, lang="zh")
    abstract_en = _render_paper_abstract(markdown, lang="en")
    body_zh = _render_markdown_body(
        _localize_eval_markdown(markdown),
        after_first_heading_html=f"{abstract_zh}\n{figures_zh}",
    )
    body_en = _render_markdown_body(
        markdown,
        after_first_heading_html=f"{abstract_en}\n{figures_en}",
    )
    safe_title = html.escape(title)
    return f"""<!doctype html>
<html lang="zh-CN" data-lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>
    :root {{
      color-scheme: light;
      --paper: #f7f4ed;
      --panel: #ffffff;
      --ink: #191817;
      --muted: #66615a;
      --line: #c9c9c9;
      --grid: #e4e4e4;
      --code: #f3f3f3;
      --accent: #4b5563;
      --page-width: 980px;
      --paper-font:
        'Times New Roman', SimSun, 'Songti SC', 'Noto Serif CJK SC',
        'Source Han Serif SC', serif;
    }}
    * {{ box-sizing: border-box; }}
    html {{ background: #f6f6f6; }}
    body {{
      margin: 0;
      background: #f6f6f6;
      color: var(--ink);
      font: 15px/1.55 var(--paper-font);
    }}
    main {{
      width: min(var(--page-width), calc(100vw - 48px));
      margin: 24px auto 56px;
      padding: 48px 58px 64px;
      background: var(--panel);
      border: 1px solid #dedede;
      border-top: 2px solid var(--ink);
      box-shadow: none;
    }}
    .report-kicker {{
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-align: center;
    }}
    .language-toggle {{
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 20;
      display: inline-flex;
      gap: 0;
      padding: 3px;
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid var(--line);
      border-radius: 999px;
      box-shadow: 0 8px 28px rgba(25, 24, 23, 0.12);
      backdrop-filter: blur(8px);
    }}
    .language-toggle button {{
      border: 0;
      border-radius: 999px;
      padding: 6px 12px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: 700 12px/1.2 var(--paper-font);
    }}
    .language-toggle button.is-active {{
      background: var(--ink);
      color: #fffdf8;
    }}
    .localized {{
      display: none;
    }}
    html[data-lang="zh"] .localized[data-locale="zh"],
    html[data-lang="en"] .localized[data-locale="en"] {{
      display: block;
    }}
    h1, h2, h3, h4, h5, h6 {{
      line-height: 1.25;
      margin: 1.6em 0 0.55em;
    }}
    h1 {{
      max-width: 820px;
      margin: 0 auto 0.85rem;
      font-size: clamp(30px, 3vw, 42px);
      letter-spacing: 0;
      text-wrap: balance;
      text-align: center;
    }}
    h2 {{
      border-bottom: 1px solid var(--ink);
      padding-bottom: 0.18rem;
      font-size: 1.18rem;
      margin-top: 2.1rem;
    }}
    h3 {{ font-size: 1.08rem; }}
    p, ul {{ margin: 0 0 1rem; }}
    ul {{ padding-left: 1.4rem; }}
    li + li {{ margin-top: 0.25rem; }}
    .table-scroll {{
      width: 100%;
      max-width: 100%;
      margin: 0 auto 1rem;
      overflow-x: auto;
      border-top: 1.5px solid var(--ink);
      border-bottom: 1.5px solid var(--ink);
    }}
    table {{
      width: max-content;
      max-width: 100%;
      margin: 0 auto 1rem;
      border-collapse: collapse;
      background: transparent;
      border: 0;
      font-size: 12.5px;
    }}
    .table-scroll table {{
      max-width: none;
      margin: 0 auto;
    }}
    th, td {{
      padding: 0.38rem 0.55rem;
      border: 0;
      border-bottom: 1px solid var(--grid);
      text-align: center;
      vertical-align: top;
      white-space: nowrap;
    }}
    th {{
      background: transparent;
      border-bottom: 1.25px solid var(--ink);
      font-weight: 700;
    }}
    .data-table--wide th,
    .data-table--wide td {{
      white-space: normal;
      text-align: left;
    }}
    .col-task,
    .col-treatment,
    .col-metric,
    .col-dimension,
    .col-source,
    .col-meaning,
    .col-report,
    .col-run,
    .col-reason,
    .col-evidence {{
      text-align: left;
    }}
    .col-evidence {{
      min-width: 18rem;
      max-width: 30rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .col-report {{
      min-width: 16rem;
      max-width: 26rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .col-run {{
      max-width: 13rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    code {{
      background: var(--code);
      border-radius: 4px;
      padding: 0.1rem 0.25rem;
      font-size: 0.92em;
      font-family: var(--paper-font);
    }}
    .paper-figures {{
      display: grid;
      justify-items: center;
      gap: 18px;
      margin: 24px 0 30px;
    }}
    .paper-figure {{
      width: min(100%, 880px);
      margin-left: auto;
      margin-right: auto;
      background: #fff;
      border: 0;
      border-top: 1.25px solid var(--ink);
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      overflow: hidden;
    }}
    .paper-figure header {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 18px;
      padding: 12px 0 9px;
      border-bottom: 1px solid var(--line);
    }}
    .paper-figure h2 {{
      margin: 0;
      padding: 0;
      border: 0;
      font-size: 15px;
    }}
    .paper-figure .kicker {{
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }}
    .paper-figure .figure-body {{
      padding: 16px 18px 18px;
    }}
    .paper-figure svg {{
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      margin-left: auto;
      margin-right: auto;
      border: 1px solid var(--grid);
      background: #fff;
    }}
    .caption {{
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 13px;
      text-wrap: pretty;
    }}
    .paper-abstract {{
      max-width: 820px;
      margin: 0 auto 22px;
      color: var(--ink);
      font-size: 14.5px;
      line-height: 1.62;
      text-align: justify;
      text-wrap: pretty;
    }}
    .paper-abstract p {{
      margin: 0;
    }}
    .muted {{ color: var(--muted); }}
    @media (max-width: 760px) {{
      main {{
      width: 100%;
      margin: 0;
        padding: 24px 20px 36px;
        border-left: 0;
        border-right: 0;
      }}
      .paper-figure header {{
        display: block;
      }}
      .paper-figure .kicker {{
        display: block;
        margin-top: 6px;
      }}
    }}
  </style>
</head>
<body>
  <nav class="language-toggle" aria-label="Report language">
    <button type="button" data-set-lang="zh" class="is-active">中文</button>
    <button type="button" data-set-lang="en">English</button>
  </nav>
  <main>
    <section class="localized" data-locale="zh" lang="zh-CN">
      <p class="report-kicker">Comet Eval Report</p>
{body_zh}
    </section>
    <section class="localized" data-locale="en" lang="en">
      <p class="report-kicker">Comet Eval Report</p>
{body_en}
    </section>
  </main>
  <script>
    (() => {{
      const root = document.documentElement;
      const buttons = Array.from(document.querySelectorAll("[data-set-lang]"));
      const setLang = (lang) => {{
        root.dataset.lang = lang;
        root.lang = lang === "zh" ? "zh-CN" : "en";
        buttons.forEach((button) => {{
          button.classList.toggle("is-active", button.dataset.setLang === lang);
        }});
      }};
      buttons.forEach((button) => {{
        button.addEventListener("click", () => setLang(button.dataset.setLang));
      }});
      setLang(root.dataset.lang || "zh");
    }})();
  </script>
</body>
</html>
"""


PAPER_FONT = "'Times New Roman', SimSun, 'Songti SC', 'Noto Serif CJK SC', serif"
CURRENT = "#1F5F8B"
BASELINE = "#9F3D2F"
GOOD = "#28745C"
BAD = "#A33A32"
INK = "#1B1A18"
MUTED = "#66615A"
GRID = "#D8D2C7"


def _render_paper_abstract(markdown: str, *, lang: str) -> str:
    treatments = _extract_report_field(markdown, "Treatments with data")
    experiment = _extract_report_field(markdown, "Experiment")
    if lang == "zh":
        scope = f"本报告比较 {treatments} 的表现" if treatments else "本报告比较各 baseline 的表现"
        experiment_text = f"，实验为 {experiment}" if experiment else ""
        text = (
            f"{scope}{experiment_text}。报告同时呈现业务完成、workflow 完成、"
            "pass@k/pass^k、成本与运行时开销，并将 CONTROL 作为业务完成基线处理；"
            "不适用的 workflow 指标以 `/` 标记。所有结论基于 analysis set，"
            "并保留来源证据以便追溯到原始 run artifact。"
        )
        label = "摘要。"
    else:
        scope = f"This report compares {treatments}" if treatments else "This report compares the baselines"
        experiment_text = f" for experiment {experiment}" if experiment else ""
        text = (
            f"{scope}{experiment_text}. It reports business completion, workflow completion, "
            "pass@k/pass^k, cost, and runtime effort while treating CONTROL as a "
            "business-only baseline; workflow-only metrics use `/` when they do not apply. "
            "All conclusions are computed from the analysis set and retain source evidence "
            "for tracing aggregates back to raw run artifacts."
        )
        label = "Abstract."
    return (
        '    <section class="paper-abstract">\n'
        f"      <p><strong>{html.escape(label)}</strong> {html.escape(text)}</p>\n"
        "    </section>"
    )


def _extract_report_field(markdown: str, field: str) -> str:
    match = re.search(rf"^- {re.escape(field)}:\s*`?([^`\n]+)`?", markdown, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _render_paper_figures(markdown: str, *, lang: str) -> str:
    tables = _extract_tables_by_heading(markdown)
    payload = {
        "rubric": _rubric_delta_data(tables),
        "spend": _spend_data(tables),
        "tasks": _task_outcome_data(tables),
        "lang": lang,
    }
    python_rendered = _render_figures_with_python(payload)
    if python_rendered is not None:
        return python_rendered
    return _render_paper_figures_inline(payload, backend="inline-svg")


def _render_figures_with_python(payload: dict[str, Any]) -> str | None:
    if os.environ.get("COMET_EVAL_REPORT_CHART_BACKEND", "").lower() == "inline":
        return None

    python = os.environ.get("COMET_EVAL_PYTHON") or sys.executable
    if not python:
        python = shutil.which("python3") or shutil.which("python")
    if not python:
        return None

    eval_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = (
        str(eval_root)
        if not env.get("PYTHONPATH")
        else str(eval_root) + os.pathsep + env["PYTHONPATH"]
    )
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        completed = subprocess.run(
            [python, "-m", "scaffold.python.paper_charts"],
            input=json.dumps(payload),
            capture_output=True,
            cwd=eval_root,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    output = completed.stdout or ""
    if 'data-chart-backend="python"' not in output:
        return None
    return output


def _render_paper_figures_inline(payload: dict[str, Any], *, backend: str) -> str:
    lang = "zh" if payload.get("lang") == "zh" else "en"
    rubric = payload.get("rubric") or []
    spend = payload.get("spend") or {}
    tasks = payload.get("tasks") or []
    figures: list[str] = []
    if rubric:
        copy = _figure_copy(lang, "rubric")
        figures.append(
            _figure_block(
                copy["title"],
                copy["kicker"],
                _rubric_delta_svg(rubric, lang=lang),
                copy["caption"],
            )
        )
    if rubric and spend:
        quality_points = _quality_cost_points(rubric, spend)
        if len(quality_points) >= 2:
            copy = _figure_copy(lang, "quality_cost")
            figures.append(
                _figure_block(
                    copy["title"],
                    copy["kicker"],
                    _quality_cost_svg(quality_points, lang=lang),
                    copy["caption"],
                )
            )
    if tasks:
        copy = _figure_copy(lang, "tasks")
        figures.append(
            _figure_block(
                copy["title"],
                copy["kicker"],
                _task_outcomes_svg(tasks, lang=lang),
                copy["caption"],
            )
        )

    if not figures:
        return ""
    aria = "论文图表" if lang == "zh" else "Paper-style figures"
    return (
        f'    <section class="paper-figures" aria-label="{html.escape(aria)}" '
        f'data-chart-backend="{html.escape(backend)}">\n'
        + "\n".join(figures)
        + "\n    </section>\n"
    )


def _figure_block(title: str, kicker: str, svg: str, caption: str) -> str:
    return f"""      <article class="paper-figure">
        <header>
          <h2>{html.escape(title)}</h2>
          <span class="kicker">{html.escape(kicker)}</span>
        </header>
        <div class="figure-body">
{_indent(svg, 10)}
          <p class="caption">{html.escape(caption)}</p>
        </div>
      </article>"""


def _figure_copy(lang: str, key: str) -> dict[str, str]:
    copy = {
        "en": {
            "rubric": {
                "title": "Figure 1. Rubric dimension deltas",
                "kicker": "Mean score difference, higher is better",
                "caption": (
                    "The zero line is the baseline. Blue marks improvements for the "
                    "current workflow; red marks regressions."
                ),
            },
            "quality_cost": {
                "title": "Figure 2. Quality-cost frontier",
                "kicker": "Rubric score vs token budget",
                "caption": (
                    "This figure separates quality from spend so token usage is visible "
                    "as a trade-off, not hidden inside the score."
                ),
            },
            "tasks": {
                "title": "Figure 3. Task outcome matrix",
                "kicker": "Per-task pass/fail evidence",
                "caption": (
                    "The matrix keeps per-task granularity for appendix-style inspection "
                    "while preserving the table below as raw evidence."
                ),
            },
        },
        "zh": {
            "rubric": {
                "title": "图 1. Rubric 维度差异",
                "kicker": "平均分差值，越高越好",
                "caption": "零线代表基线。蓝色表示当前 workflow 改进，红色表示回退。",
            },
            "quality_cost": {
                "title": "图 2. 质量-成本前沿",
                "kicker": "Rubric 分数 vs token 预算",
                "caption": "该图把质量与开销分开呈现，避免 token 使用量被隐藏在分数里。",
            },
            "tasks": {
                "title": "图 3. 任务结果矩阵",
                "kicker": "逐任务通过/失败证据",
                "caption": "矩阵保留逐任务粒度，便于附录式检查；下方表格仍保留原始证据。",
            },
        },
    }
    return copy.get(lang, copy["en"])[key]


def _extract_tables_by_heading(markdown: str) -> dict[str, list[list[str]]]:
    tables: dict[str, list[list[str]]] = {}
    current_heading = ""
    lines = markdown.splitlines()
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            if len(heading.group(1)) <= 2:
                current_heading = _plain_text(heading.group(2))
            i += 1
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            table_lines: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            rows = [_table_cells(line) for line in table_lines if not _is_table_separator(line)]
            if rows:
                key = current_heading or f"table_{len(tables)}"
                if key in tables:
                    suffix = 2
                    while f"{key}#{suffix}" in tables:
                        suffix += 1
                    key = f"{key}#{suffix}"
                tables[key] = rows
            continue
        i += 1
    return tables


def _rubric_delta_data(tables: dict[str, list[list[str]]]) -> list[tuple[str, float]]:
    rows = _find_table_with_columns(
        tables,
        "Rubric dimensions",
        ("COMET_FULL_040_BETA", "COMET_FULL_039"),
    )
    if not rows:
        return []
    header = rows[0]
    try:
        workflow_idx = header.index("COMET_FULL_040_BETA")
        baseline_idx = header.index("COMET_FULL_039")
    except ValueError:
        return []

    data: list[tuple[str, float]] = []
    for row in rows[1:]:
        if len(row) <= max(workflow_idx, baseline_idx):
            continue
        dim = _plain_text(row[0])
        if not dim or dim.lower() == "overall":
            continue
        workflow = _number(row[workflow_idx])
        baseline = _number(row[baseline_idx])
        if workflow is None or baseline is None:
            continue
        data.append((dim, workflow - baseline))
    return data


def _spend_data(tables: dict[str, list[list[str]]]) -> dict[str, tuple[float, float]]:
    rows = _find_table(tables, "Spend summary")
    if not rows:
        return {}
    header = rows[0]
    try:
        treatment_idx = header.index("Treatment")
        tokens_idx = header.index("Tokens")
        cost_idx = header.index("Cost")
    except ValueError:
        return {}

    spend: dict[str, tuple[float, float]] = {}
    for row in rows[1:]:
        if len(row) <= max(treatment_idx, tokens_idx, cost_idx):
            continue
        tokens = _number(row[tokens_idx])
        cost = _number(row[cost_idx])
        if tokens is None or cost is None:
            continue
        spend[_plain_text(row[treatment_idx])] = (tokens / 1_000_000, cost)
    return spend


def _task_outcome_data(
    tables: dict[str, list[list[str]]],
) -> list[tuple[str, bool | None, bool | None]]:
    rows = _find_table(tables, "Task outcomes")
    if not rows:
        return []
    header = rows[0]
    try:
        task_idx = header.index("Task")
        workflow_idx = header.index("COMET_FULL_040_BETA")
        baseline_idx = header.index("COMET_FULL_039")
    except ValueError:
        return []
    tasks: list[tuple[str, bool | None, bool | None]] = []
    for row in rows[1:]:
        if len(row) <= max(task_idx, workflow_idx, baseline_idx):
            continue
        current = _status_value(row[workflow_idx])
        baseline = _status_value(row[baseline_idx])
        tasks.append((_plain_text(row[task_idx]), current, baseline))
    return tasks


def _quality_cost_points(
    rubric: list[tuple[str, float]],
    spend: dict[str, tuple[float, float]],
) -> list[tuple[str, float, float, float]]:
    deltas = [delta for _, delta in rubric]
    delta_mean = sum(deltas) / len(deltas) if deltas else 0.0
    baseline_score = max(0.0, min(1.0, 0.5 - delta_mean / 2))
    workflow_score = max(0.0, min(1.0, baseline_score + delta_mean))
    points: list[tuple[str, float, float, float]] = []
    if "COMET_FULL_039" in spend:
        tokens_m, cost = spend["COMET_FULL_039"]
        points.append(("0.3.9 baseline", tokens_m, cost, baseline_score))
    if "COMET_FULL_040_BETA" in spend:
        tokens_m, cost = spend["COMET_FULL_040_BETA"]
        points.append(("Current workflow", tokens_m, cost, workflow_score))
    return points


def _rubric_delta_svg(data: list[tuple[str, float]], *, lang: str) -> str:
    width, height = 920, max(260, 116 + len(data) * 38)
    x0, y0, plot_w, row_gap = 330, 82, 410, 38
    min_delta = min((delta for _, delta in data), default=-0.2)
    max_delta = max((delta for _, delta in data), default=0.2)
    x_min = min(-0.3, min_delta - 0.08)
    x_max = max(0.3, max_delta + 0.08)
    scale = plot_w / (x_max - x_min)
    zero_x = x0 + (0 - x_min) * scale
    title = "Rubric 维度差异" if lang == "zh" else "Rubric dimension deltas"
    subtitle = (
        "当前 workflow 减去 0.3.9 基线"
        if lang == "zh"
        else "Current workflow minus 0.3.9 baseline"
    )
    parts = _svg_header(
        width,
        height,
        title,
        subtitle,
    )
    for tick in _ticks(x_min, x_max):
        x = x0 + (tick - x_min) * scale
        klass = "axis" if abs(tick) < 0.0001 else "grid"
        parts.append(
            f'<line class="{klass}" x1="{x:.1f}" y1="68" '
            f'x2="{x:.1f}" y2="{height - 58}" />'
        )
        parts.append(
            f'<text class="tick" x="{x:.1f}" y="{height - 26}" '
            f'text-anchor="middle">{tick:+.1f}</text>'
        )
    for idx, (label, delta) in enumerate(data):
        y = y0 + idx * row_gap
        x = x0 + (delta - x_min) * scale
        color = CURRENT if delta >= 0 else BASELINE
        parts.append(f'<text class="label" x="44" y="{y + 4}">{html.escape(label)}</text>')
        parts.append(
            f'<line x1="{zero_x:.1f}" y1="{y}" x2="{x:.1f}" y2="{y}" '
            f'stroke="{color}" stroke-width="3" />'
        )
        parts.append(f'<circle cx="{x:.1f}" cy="{y}" r="5.2" fill="{color}" />')
        parts.append(
            f'<text class="value" x="850" y="{y + 4}" '
            f'text-anchor="end">{delta:+.2f}</text>'
        )
    parts.append("</svg>")
    return "\n".join(parts)


def _quality_cost_svg(points: list[tuple[str, float, float, float]], *, lang: str) -> str:
    width, height = 820, 460
    left, top, plot_w, plot_h = 86, 72, 620, 300
    max_tokens = max(1.0, max(point[1] for point in points) * 1.15)
    title = "质量-成本前沿" if lang == "zh" else "Quality-cost frontier"
    subtitle = "左上角更优" if lang == "zh" else "Upper-left is better"
    parts = _svg_header(width, height, title, subtitle)
    for tick in _linear_ticks(0, max_tokens, 4):
        x = left + (tick / max_tokens) * plot_w
        parts.append(
            f'<line class="grid" x1="{x:.1f}" y1="{top}" '
            f'x2="{x:.1f}" y2="{top + plot_h}" />'
        )
        parts.append(
            f'<text class="tick" x="{x:.1f}" y="402" '
            f'text-anchor="middle">{tick:.1f}M</text>'
        )
    for tick in (0.3, 0.5, 0.7, 0.9):
        y = top + (0.9 - tick) / 0.6 * plot_h
        parts.append(
            f'<line class="grid" x1="{left}" y1="{y:.1f}" '
            f'x2="{left + plot_w}" y2="{y:.1f}" />'
        )
        parts.append(
            f'<text class="tick" x="60" y="{y + 4:.1f}" '
            f'text-anchor="end">{tick:.1f}</text>'
        )
    parts.append(
        f'<line class="axis" x1="{left}" y1="{top + plot_h}" '
        f'x2="{left + plot_w}" y2="{top + plot_h}" />'
    )
    parts.append(f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_h}" />')

    coords = []
    for label, tokens_m, cost, score in points:
        x = left + (tokens_m / max_tokens) * plot_w
        y = top + (0.9 - score) / 0.6 * plot_h
        coords.append((x, y, label, tokens_m, cost, score))
    if len(coords) >= 2:
        parts.append(
            f'<line x1="{coords[0][0]:.1f}" y1="{coords[0][1]:.1f}" '
            f'x2="{coords[1][0]:.1f}" y2="{coords[1][1]:.1f}" '
            'stroke="#9B9488" stroke-width="1.5" stroke-dasharray="5 5" />'
        )
    for x, y, label, _tokens_m, cost, score in coords:
        is_current = "Current" in label
        color = CURRENT if is_current else BASELINE
        anchor = "end" if x > left + plot_w * 0.72 else "start"
        text_x = x - 14 if anchor == "end" else x + 14
        display_label = (
            ("当前 workflow" if is_current else "0.3.9 基线")
            if lang == "zh"
            else label
        )
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="{color}" />')
        parts.append(
            f'<text class="value" x="{text_x:.1f}" y="{y - 10:.1f}" '
            f'text-anchor="{anchor}">{html.escape(display_label)}</text>'
        )
        parts.append(
            f'<text class="tick" x="{text_x:.1f}" y="{y + 9:.1f}" '
            f'text-anchor="{anchor}">{score:.2f} / ${cost:.2f}</text>'
        )
    parts.append(
        f'<text class="label" x="{left + plot_w / 2:.1f}" y="438" '
        f'text-anchor="middle">{"总 tokens" if lang == "zh" else "Total tokens"}</text>'
    )
    y_axis = top + plot_h / 2
    parts.append(
        f'<text class="label" x="24" y="{y_axis:.1f}" '
        f'transform="rotate(-90 24 {y_axis:.1f})" '
        f'text-anchor="middle">{"Rubric 分数" if lang == "zh" else "Rubric score"}</text>'
    )
    parts.append("</svg>")
    return "\n".join(parts)


def _task_outcomes_svg(tasks: list[tuple[str, bool | None, bool | None]], *, lang: str) -> str:
    width, height = 700, max(260, 116 + len(tasks) * 43)
    left, top, cell_w, cell_h, gap = 300, 108, 142, 34, 9
    title = "任务结果矩阵" if lang == "zh" else "Task outcome matrix"
    subtitle = "绿色表示通过；红色表示失败" if lang == "zh" else "Green means pass; red means fail"
    parts = _svg_header(width, height, title, subtitle)
    column_labels = (
        ("当前 workflow", "0.3.9 基线")
        if lang == "zh"
        else ("Current workflow", "0.3.9 baseline")
    )
    for i, label in enumerate(column_labels):
        x = left + i * (cell_w + 28) + cell_w / 2
        parts.append(f'<text class="label" x="{x:.1f}" y="86" text-anchor="middle">{label}</text>')
    for row, (task, current, baseline) in enumerate(tasks):
        y = top + row * (cell_h + gap)
        parts.append(f'<text class="label" x="42" y="{y + 22}">{html.escape(task)}</text>')
        for col, passed in enumerate((current, baseline)):
            x = left + col * (cell_w + 28)
            color = "#9B9488" if passed is None else GOOD if passed else BAD
            if passed is None:
                status = "N/A"
            elif lang == "zh":
                status = "通过" if passed else "失败"
            else:
                status = "PASS" if passed else "FAIL"
            parts.append(
                f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" '
                f'rx="2" fill="{color}" />'
            )
            parts.append(
                f'<text x="{x + cell_w / 2:.1f}" y="{y + 22}" '
                f'text-anchor="middle" fill="#FFFFFF" font-family="{PAPER_FONT}" '
                f'font-size="12" font-weight="700">{status}</text>'
            )
    parts.append("</svg>")
    return "\n".join(parts)


def _svg_header(width: int, height: int, title: str, subtitle: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{html.escape(title)}">',
        "<style>",
        f"text {{ font-family: {PAPER_FONT}; }}",
        ".title { fill: #1B1A18; font-size: 18px; font-weight: 700; }",
        ".subtitle, .tick { fill: #66615A; font-size: 12px; }",
        ".label { fill: #1B1A18; font-size: 13px; }",
        ".value { fill: #1B1A18; font-size: 12px; }",
        f".grid {{ stroke: {GRID}; stroke-width: 1; shape-rendering: crispEdges; }}",
        f".axis {{ stroke: {INK}; stroke-width: 1; shape-rendering: crispEdges; }}",
        "</style>",
        f'<rect width="{width}" height="{height}" fill="#FFFFFF" />',
        f'<text class="title" x="32" y="32">{html.escape(title)}</text>',
        f'<text class="subtitle" x="32" y="54">{html.escape(subtitle)}</text>',
    ]


def _find_table(tables: dict[str, list[list[str]]], heading_prefix: str) -> list[list[str]]:
    for heading, rows in tables.items():
        if heading.startswith(heading_prefix):
            return rows
    return []


def _find_table_with_columns(
    tables: dict[str, list[list[str]]],
    heading_prefix: str,
    columns: tuple[str, ...],
) -> list[list[str]]:
    for heading, rows in tables.items():
        if not heading.startswith(heading_prefix) or not rows:
            continue
        header = rows[0]
        if all(column in header for column in columns):
            return rows
    return []


def _plain_text(value: str) -> str:
    return re.sub(r"[*`_]", "", html.unescape(value)).strip()


def _number(value: str) -> float | None:
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", _plain_text(value))
    if not match:
        return None
    return float(match.group(0).replace(",", ""))


def _status_value(value: str) -> bool | None:
    normalized = _plain_text(value).upper()
    if normalized == "PASS":
        return True
    if normalized == "FAIL":
        return False
    return None


def _ticks(x_min: float, x_max: float) -> list[float]:
    ticks = [-0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8]
    return [tick for tick in ticks if x_min <= tick <= x_max] or [0.0]


def _linear_ticks(start: float, stop: float, count: int) -> list[float]:
    if count <= 1:
        return [start]
    step = (stop - start) / (count - 1)
    return [start + step * idx for idx in range(count)]


def _indent(text: str, spaces: int) -> str:
    prefix = " " * spaces
    return "\n".join(prefix + line for line in text.splitlines())


def _localize_eval_markdown(markdown: str) -> str:
    """Translate the human-facing eval report shell for HTML display only."""
    replacements = [
        ("# Comet Baseline Comparison Report", "# Comet 基线对比报告"),
        ("- Experiment:", "- 实验："),
        ("- Treatments with data:", "- 有数据的 Treatment："),
        ("No report data found. Run the eval suite first.", "未找到报告数据。请先运行 eval 套件。"),
        ("## Metric guide", "## 指标说明"),
        ("| Metric | Meaning | Source | Report section |", "| 指标 | 含义 | 来源 | 报告位置 |"),
        ("|--------|---------|--------|----------------|", "|------|------|------|----------|"),
        ("| `raw runs` | All discovered report JSON files before quality filtering. | report files | Data quality summary |", "| `raw runs` | 质量过滤前发现的全部 report JSON 文件。 | report files | 数据质量摘要 |"),
        ("| `analysis set` | Runs included in comparison metrics after excluding hard infrastructure noise. | sample_quality.include_in_analysis | Data quality summary / Run counts |", "| `analysis set` | 排除硬基础设施噪音后纳入对比指标的运行集合。 | sample_quality.include_in_analysis | 数据质量摘要 / 运行次数 |"),
        ("| `flagged` | Completed runs kept in analysis but marked as suspicious, usually harness/task/observability risk. | sample_quality.status | Data quality summary / Flagged runs |", "| `flagged` | 已完成且仍纳入分析，但带有 harness、task 或观测风险标记的运行。 | sample_quality.status | 数据质量摘要 / 已标记运行 |"),
        ("| `excluded` | Runs removed from headline metrics, typically API, quota, auth, network, container, or runner failures before a complete result. | sample_quality.status | Data quality summary / Excluded runs |", "| `excluded` | 从核心指标中移除的运行，通常是完整结果前发生 API、额度、鉴权、网络、容器或 runner 故障。 | sample_quality.status | 数据质量摘要 / 已排除运行 |"),
        ("| `pass@k` | Probability that at least one of k attempts succeeds; capability ceiling. | pass/fail booleans | pass@k / pass^k |", "| `pass@k` | k 次尝试中至少一次成功的概率，表示能力上限。 | pass/fail booleans | pass@k / pass^k |"),
        ("| `pass^k` | Probability that all k attempts succeed; reliability floor. | pass/fail booleans | pass@k / pass^k |", "| `pass^k` | k 次尝试全部成功的概率，表示可靠性下限。 | pass/fail booleans | pass@k / pass^k |"),
        ("| `overall` | Run passes when task-level `checks_failed == []`. | checks_failed | pass@k / Task outcomes |", "| `overall` | task 级 `checks_failed == []` 时视为运行通过。 | checks_failed | pass@k / 任务结果 |"),
        ("| `business_completion` | Business validator pass rate; CONTROL is evaluated on this without requiring Comet workflow artifacts. | `[RUBRIC] business_completion` | Rubric dimensions / pass@k |", "| `business_completion` | 业务 validator 通过率；CONTROL 只按它评估，不要求 Comet workflow 产物。 | `[RUBRIC] business_completion` | Rubric 维度 / pass@k |"),
        ("| `workflow_completion` | Comet workflow validator pass rate; `/` means not applicable for CONTROL. | `[RUBRIC] workflow_completion` | Rubric dimensions / pass@k |", "| `workflow_completion` | Comet workflow validator 通过率；`/` 表示 CONTROL 不适用。 | `[RUBRIC] workflow_completion` | Rubric 维度 / pass@k |"),
        ("| `weighted_score` | Weighted average across applicable rubric dimensions; N/A dimensions are skipped. | `[RUBRIC] weighted_score` | Rubric dimensions / Overall |", "| `weighted_score` | 适用 Rubric 维度的加权平均；N/A 维度不参与计算。 | `[RUBRIC] weighted_score` | Rubric 维度 / Overall |"),
        ("| `tokens` / `cost` | Total model token and USD cost telemetry for included runs. | events_summary | Spend summary |", "| `tokens` / `cost` | 纳入分析运行的模型 token 与美元成本遥测。 | events_summary | 成本摘要 |"),
        ("| `turns` / `duration` / `tool calls` | Runtime effort telemetry for included runs; also feeds the `efficiency` rubric. | events_summary | Runtime summary / Rubric dimensions |", "| `turns` / `duration` / `tool calls` | 纳入分析运行的运行时开销遥测，也用于 `efficiency` Rubric。 | events_summary | 运行摘要 / Rubric 维度 |"),
        ("| `run-level failed checks` | Buckets sample-level `checks_failed` entries into harness, business, workflow, task, or uncategorized causes; this is not the same as the task outcome matrix. | checks_failed / events_summary.failure_attribution | Run-level failed checks |", "| `run-level failed checks` | 将样本级 `checks_failed` 条目归入 harness、business、workflow、task 或 uncategorized；它不等同于任务结果矩阵。 | checks_failed / events_summary.failure_attribution | 样本级失败检查 |"),
        ("| `source evidence` | Run id, quality status, profile, Skill source hashes, eval manifest, and raw report reference. | events_summary / sample_quality | Source evidence |", "| `source evidence` | run id、质量状态、profile、Skill source hash、eval manifest 和原始 report 引用。 | events_summary / sample_quality | 来源证据 |"),
        ("## Data quality summary", "## 数据质量摘要"),
        ("## Run counts", "## 运行次数"),
        (
            "_Analysis set only; excluded hard-noise runs are omitted._",
            "_仅统计分析集；已排除的硬噪声运行不会进入统计。_",
        ),
        (
            "## pass@k / pass^k — capability vs reliability",
            "## pass@k / pass^k — 能力上限 vs 可靠性下限",
        ),
        (
            "- **pass@k**: probability ≥1 of k attempts succeeds (capability ceiling)",
            "- **pass@k**：k 次尝试中至少 1 次成功的概率（能力上限）",
        ),
        (
            "- **pass^k**: probability all k attempts succeed (reliability floor)",
            "- **pass^k**：k 次尝试全部成功的概率（可靠性下限）",
        ),
        (
            "- **overall**: run passes when `checks_failed == []`.",
            "- **overall**：当 `checks_failed == []` 时视为运行通过。",
        ),
        (
            "- **business**: run passes when `business_completion == 1.00`.",
            "- **business**：当 `business_completion == 1.00` 时视为业务完成。",
        ),
        (
            "- **workflow**: run passes when `workflow_completion == 1.00`; `/` means not applicable.",
            "- **workflow**：当 `workflow_completion == 1.00` 时视为 workflow 完成；`/` 表示不适用。",
        ),
        (
            "- The gap (pass@k − pass^k) measures instability: high ceiling, low floor = unreliable.",
            "- pass@k 与 pass^k 的差值衡量不稳定性：上限高但下限低，说明可靠性不足。",
        ),
        ("## Task outcomes", "## 任务结果"),
        ("## Spend summary", "## 成本摘要"),
        ("## Runtime summary", "## 运行摘要"),
        ("## Source evidence", "## 来源证据"),
        (
            "Use this section to trace each aggregate metric back to the raw run artifacts.",
            "使用本节可以把每个聚合指标追溯到原始运行产物。",
        ),
        ("- `Run` is the run id or fallback report id.", "- `Run` 是 run id，缺失时使用 report id。"),
        (
            "- `Quality` is the sample-quality status used by the analysis-set filter.",
            "- `Quality` 是分析集过滤使用的样本质量状态。",
        ),
        (
            "- `Reason` explains why the run is included, flagged, or excluded.",
            "- `Reason` 解释该运行为什么被纳入、标记或排除。",
        ),
        (
            "- `Profile` is the eval rubric/profile that scored the run.",
            "- `Profile` 是对该运行评分的 eval rubric/profile。",
        ),
        (
            "- `Skill sources` records installed Skill identity or hash evidence when the run provides it.",
            "- `Skill sources` 记录运行提供的已安装 Skill 身份或 hash 证据。",
        ),
        (
            "- `Eval manifest` is the task manifest that defined the evaluated scenario.",
            "- `Eval manifest` 是定义被评估场景的任务 manifest。",
        ),
        (
            "- `Report` points to the raw per-run report JSON for deeper inspection.",
            "- `Report` 指向可深入检查的原始单次运行 report JSON。",
        ),
        ("## Rubric dimensions", "## Rubric 维度"),
        (
            "_Scores are binary pass-rates (0.0-1.0). Overall uses the validator-emitted weighted_score when available (see weights below)._",
            "_分数是二值通过率（0.0-1.0）。Overall 优先使用 validator 输出的 weighted_score（权重见下方）。_",
        ),
        ("### Dimension guide", "### 维度说明"),
        ("| Dimension | Meaning |", "| 维度 | 含义 |"),
        (
            "| main_flow | Completion of the expected Comet workflow phases. |",
            "| main_flow | 是否完成预期的 Comet workflow 阶段。 |",
        ),
        (
            "| gate_guard | Use of required guard, state transition, and apply checkpoints. |",
            "| gate_guard | 是否使用必需的 guard、状态推进和 apply 检查点。 |",
        ),
        (
            "| skill_invocation | Invocation of Comet, OpenSpec, and Superpowers dependency Skills. |",
            "| skill_invocation | 是否调用 Comet、OpenSpec 和 Superpowers 依赖 Skill。 |",
        ),
        (
            "| spec_drift | Whether build-time spec changes were reconciled before archive. |",
            "| spec_drift | 构建期间产生的 spec 变更是否在归档前完成同步。 |",
        ),
        (
            "| business_completion | Business validator pass rate for the requested task behavior. |",
            "| business_completion | 业务 validator 对用户请求行为的通过率。 |",
        ),
        (
            "| workflow_completion | Workflow validator pass rate for Comet workflow artifacts. |",
            "| workflow_completion | Workflow validator 对 Comet workflow 产物的通过率。 |",
        ),
        (
            "| efficiency | Runtime effort score from turns, tool calls, and duration. |",
            "| efficiency | 基于轮次、工具调用和耗时计算的运行开销得分。 |",
        ),
        (
            "| decision_point_compliance | Whether blocking decision points were surfaced instead of auto-decided. |",
            "| decision_point_compliance | 是否把阻塞性决策点交给用户，而不是自动决定。 |",
        ),
        (
            "| artifact_quality | Whether generated proposal, design, task, and test artifacts are substantive. |",
            "| artifact_quality | 生成的 proposal、design、task 和 test 产物是否有实质内容。 |",
        ),
        (
            "| recovery_resilience | Whether workflow state was preserved and recovered across interruptions. |",
            "| recovery_resilience | 中断前后 workflow 状态是否被保存并可恢复。 |",
        ),
        ("### Dimension weights", "### 维度权重"),
        ("## Excluded runs", "## 已排除运行"),
        ("## Flagged runs", "## 已标记运行"),
        ("## Raw vs analysis sensitivity", "## Raw 与分析集敏感性"),
        ("## Run-level failed checks", "## 样本级失败检查"),
        (
            "These are sample-level `checks_failed` entries. They can coexist with `workflow_completion == 1.00`, `pass@k == 1.00`, or a passing task outcome because they describe stricter run-contract failures rather than the workflow artifact completion score or the task outcome matrix.",
            "这些是样本级 `checks_failed` 条目。它们可以与 `workflow_completion == 1.00`、`pass@k == 1.00` 或通过的任务结果同时存在，因为它们描述的是更严格的运行契约失败，而不是 workflow 产物完成分数或任务结果矩阵。",
        ),
        (
            "Each failed baseline check is bucketed as **harness** (runner/trigger issue), **business** (requested behavior issue), **workflow** (skill guidance or workflow artifact issue), **task** (task/validator issue), or **uncategorized** (valid completed failure that needs inspection).",
            "每个失败的基线检查都会归因到 **harness**（运行器/触发问题）、**business**（业务实现问题）、**workflow**（Skill 指引或 workflow 产物问题）、**task**（任务/validator 问题）或 **uncategorized**（需要继续检查的有效失败）。",
        ),
        ("_No baseline check failures across treatments._", "_所有 Treatment 均无基线检查失败。_"),
        ("## Verdict", "## 结论"),
        (
            "⚠️ **Insufficient clean data**: analysis set has no included runs for",
            "⚠️ **干净数据不足**：分析集没有可纳入的运行：",
        ),
        (
            ". Rerun the affected task/treatment pairs or inspect the excluded runs above.",
            "。请重新运行受影响的 task/treatment 组合，或检查上方已排除运行。",
        ),
        (
            "⚠️ **Inconclusive due to data quality**: more than half of the raw runs were excluded for",
            "⚠️ **因数据质量无法下结论**：超过一半原始运行被排除：",
        ),
        (
            ". The analysis metrics are shown, but the A/B verdict should not be treated as final.",
            "。报告仍展示分析指标，但 A/B 结论不应视为最终结论。",
        ),
        ("Insufficient data: need both", "数据不足：需要同时具备"),
        (
            "❌ **Workflow regresses on",
            "❌ **Workflow 相比 0.3.9 基线发生回退，共",
        ),
        (
            "See the run-level failed checks section above and the events/raw logs for root-cause analysis.",
            "请结合上方样本级失败检查以及 events/raw logs 做根因分析。",
        ),
        ("✅ **Workflow is stable**", "✅ **Workflow 稳定**"),
        ("⚠️ **Workflow overall lower**", "⚠️ **Workflow overall 较低**"),
        ("_Verdict uses analysis set:", "_结论使用分析集："),
        (
            "_Distribution stats computed from ≥2 runs per treatment._",
            "_分布统计基于每个 Treatment 至少 2 次运行计算。_",
        ),
        ("## LLM-judge overlay (rule vs judge)", "## LLM-judge 覆盖层（规则 vs Judge）"),
        (
            "Independent LLM re-scored the three qualitative dimensions by reading the actual artifacts. Large rule-vs-judge gaps flag heuristic weaknesses.",
            "独立 LLM 读取实际产物后重新评分三个定性维度。规则分与 Judge 分差距较大时，说明启发式指标可能偏弱。",
        ),
    ]
    localized = markdown
    for source, target in replacements:
        localized = localized.replace(source, target)
    localized = _localize_failure_attribution(localized)
    return localized


def _localize_failure_attribution(markdown: str) -> str:
    localized = markdown
    localized = re.sub(
        r"^### (.+?) \((\d+) failure\(s\)\)$",
        r"### \1（\2 个失败）",
        localized,
        flags=re.MULTILINE,
    )
    localized = re.sub(
        r"^- \*\*(harness|business|workflow|task|uncategorized)\*\* \((\d+)\):$",
        r"- **\1**（\2）：",
        localized,
        flags=re.MULTILINE,
    )
    replacements = [
        ("**harness**（", "**harness/运行器**（"),
        ("**business**（", "**business/业务**（"),
        ("**workflow**（", "**workflow/流程**（"),
        ("**task**（", "**task/任务**（"),
        ("**uncategorized**（", "**uncategorized/未分类**（"),
        ("[harness]", "[运行器]"),
        ("[business]", "[业务]"),
        ("[workflow]", "[流程]"),
        ("[task]", "[任务]"),
        ("[uncategorized]", "[未分类]"),
        ("business validator failed", "业务验证失败"),
        ("workflow validator failed", "Workflow 验证失败"),
        ("validator failed", "验证失败"),
        ("Required skill not invoked", "必需 Skill 未调用"),
        ("target Skill was never invoked", "目标 Skill 未被调用"),
        (
            "business implementation did not pass validation",
            "业务实现未通过",
        ),
        (
            "workflow validation did not pass",
            "Workflow 验证未通过",
        ),
        (
            "uncategorized valid failure",
            "未分类有效失败",
        ),
        (
            "skill was not invoked — workflow guidance failed to trigger the skill",
            "Skill 未调用，workflow 指引未触发 Skill",
        ),
        (
            "guard/state machinery not exercised — workflow did not drive phase transitions",
            "guard/state 机制未执行，workflow 没有推进阶段转换",
        ),
        (
            "feature implementation incomplete",
            "功能实现不完整",
        ),
        (
            "artifact path/layout mismatch — likely task/validator path assumption",
            "产物路径或布局不匹配，可能是任务或 validator 的路径假设问题",
        ),
        (
            "comet state file missing — workflow did not initialise state machine",
            "comet 状态文件缺失，workflow 没有初始化状态机",
        ),
        (
            "expected tests were not written",
            "预期测试未写入",
        ),
    ]
    for source, target in replacements:
        localized = localized.replace(source, target)
    return localized


def _read_config_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"report config not found: {path}")
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        import yaml

        data = yaml.safe_load(text) or {}
    else:
        data = json.loads(text or "{}")
    if not isinstance(data, dict):
        raise ValueError("report config must be an object")
    return data


def _read_bool(data: dict[str, Any], key: str, *, default: bool) -> bool:
    value = data.get(key, default)
    if isinstance(value, bool):
        return value
    raise ValueError(f"report_outputs.{key} must be true or false")


def _render_markdown_body(markdown: str, *, after_first_heading_html: str = "") -> str:
    lines = markdown.splitlines()
    rendered: list[str] = []
    in_list = False
    inserted_after_title = False
    i = 0

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            rendered.append("</ul>")
            in_list = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            close_list()
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            close_list()
            table_lines: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            rendered.extend(_render_table(table_lines))
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            close_list()
            level = len(heading.group(1))
            rendered.append(f"<h{level}>{_inline_markdown(heading.group(2))}</h{level}>")
            if level == 1 and after_first_heading_html and not inserted_after_title:
                rendered.extend(after_first_heading_html.rstrip("\n").splitlines())
                inserted_after_title = True
            i += 1
            continue

        bullet = re.match(r"^-\s+(.+)$", stripped)
        if bullet:
            if not in_list:
                rendered.append("<ul>")
                in_list = True
            rendered.append(f"  <li>{_inline_markdown(bullet.group(1))}</li>")
            i += 1
            continue

        close_list()
        rendered.append(f"<p>{_inline_markdown(stripped)}</p>")
        i += 1

    close_list()
    return "\n".join(f"    {line}" for line in rendered)


def _render_table(lines: list[str]) -> list[str]:
    rows = [_table_cells(line) for line in lines if not _is_table_separator(line)]
    if not rows:
        return []

    headers = rows[0]
    column_classes = [_column_class(header) for header in headers]
    wide_table = any(column in {"col-evidence", "col-report", "col-run"} for column in column_classes)
    table_class = "data-table data-table--wide" if wide_table else "data-table"
    rendered = [
        '<div class="table-scroll">',
        f'<table class="{table_class}">',
        "  <thead>",
        "    <tr>",
    ]
    for cell, column_class in zip(headers, column_classes):
        rendered.append(f"      <th{_class_attr(column_class)}>{_inline_markdown(cell)}</th>")
    rendered.extend(["    </tr>", "  </thead>"])
    if len(rows) > 1:
        rendered.append("  <tbody>")
        for row in rows[1:]:
            rendered.append("    <tr>")
            for index, cell in enumerate(row):
                column_class = column_classes[index] if index < len(column_classes) else ""
                rendered.append(f"      <td{_class_attr(column_class)}>{_inline_markdown(cell)}</td>")
            rendered.append("    </tr>")
        rendered.append("  </tbody>")
    rendered.append("</table>")
    rendered.append("</div>")
    return rendered


def _class_attr(class_name: str) -> str:
    return f' class="{class_name}"' if class_name else ""


def _column_class(header: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", header.strip().lower()).strip("-")
    return f"col-{slug}" if slug else ""


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_table_separator(line: str) -> bool:
    cells = _table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def _inline_markdown(text: str) -> str:
    escaped = html.escape(text)
    full_emphasis = escaped.startswith("_") and escaped.endswith("_") and len(escaped) > 2
    if full_emphasis:
        escaped = escaped[1:-1]
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"<em>\1</em>", escaped)
    if full_emphasis:
        escaped = f"<em>{escaped}</em>"
    return escaped
