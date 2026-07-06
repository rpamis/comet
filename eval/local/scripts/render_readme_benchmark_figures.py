"""Render README benchmark figures from a baseline comparison report."""

from __future__ import annotations

import argparse
import math
import os
import re
from pathlib import Path

import numpy as np

DEFAULT_EXPERIMENT = "combined_comet_workflow_full_k5_20260705_v4_extra_rounds"
REPO_ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("MPLCONFIGDIR", str(REPO_ROOT / "eval" / ".cache" / "matplotlib"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

DEFAULT_REPORT = (
    REPO_ROOT
    / "eval"
    / "langsmith"
    / "logs"
    / "experiments"
    / DEFAULT_EXPERIMENT
    / "comparison_report.md"
)
DEFAULT_OUTPUT_DIR = REPO_ROOT / "img"

TREATMENT_LABELS = {
    "CONTROL": "No Comet",
    "COMET_FULL_040_BETA": "Comet 0.4.0",
    "COMET_FULL_039": "Comet 0.3.9",
}
TREATMENT_ORDER = ["CONTROL", "COMET_FULL_040_BETA", "COMET_FULL_039"]
COLORS = {
    "CONTROL": "#667085",
    "COMET_FULL_040_BETA": "#0072B2",
    "COMET_FULL_039": "#d55e00",
}
DIMENSION_LABELS = {
    "Overall": "Overall weighted",
    "main_flow": "Main flow",
    "gate_guard": "Gate guard",
    "skill_invocation": "Skill invocation",
    "spec_drift": "Spec drift",
    "business_completion": "Business completion",
    "workflow_completion": "Workflow completion",
    "efficiency": "Efficiency",
    "decision_point_compliance": "Decision points",
    "artifact_quality": "Artifact quality",
    "recovery_resilience": "Recovery resilience",
}


def main() -> None:
    args = parse_args()
    report_path = args.report.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    report_text = report_path.read_text(encoding="utf-8")
    pass_rows = parse_markdown_table(report_text, "## pass@k / pass^k")
    rubric_rows = parse_rubric_scores(report_text)
    judge_rows = parse_markdown_table(report_text, "## LLM-judge overlay")

    pass_path = output_dir / "comet-eval-pass5.png"
    rubric_path = output_dir / "comet-eval-rubric-core.png"
    render_pass5_figure(pass_rows, pass_path)
    render_rubric_figure(rubric_rows, judge_rows, rubric_path)

    print(pass_path)
    print(rubric_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def parse_markdown_table(text: str, heading: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    start = next((idx for idx, line in enumerate(lines) if line.startswith(heading)), None)
    if start is None:
        raise ValueError(f"Missing report heading: {heading}")

    table_lines: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("|"):
            table_lines.append(line)
        elif table_lines:
            break

    if len(table_lines) < 3:
        raise ValueError(f"Missing markdown table after heading: {heading}")

    return parse_table_lines(table_lines)


def parse_table_lines(table_lines: list[str]) -> list[dict[str, str]]:
    headers = [cell.strip() for cell in table_lines[0].strip("|").split("|")]
    rows: list[dict[str, str]] = []
    for line in table_lines[2:]:
        values = [cell.strip() for cell in line.strip("|").split("|")]
        if len(values) != len(headers):
            continue
        rows.append(dict(zip(headers, values)))
    return rows


def parse_rubric_scores(text: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    header_index = next(
        (
            idx
            for idx, line in enumerate(lines)
            if line.startswith("| Dimension | CONTROL | COMET_FULL_040_BETA |")
        ),
        None,
    )
    if header_index is None:
        raise ValueError("Missing rubric score table")

    table_lines: list[str] = []
    for line in lines[header_index:]:
        if line.startswith("|"):
            table_lines.append(line)
        elif table_lines and not line.strip():
            continue
        elif table_lines:
            break
    rows = parse_table_lines(table_lines)
    for row in rows:
        row["Dimension"] = row["Dimension"].replace("*", "").strip()
    return rows


def parse_float(value: str) -> float:
    value = value.strip()
    if value in {"/", "—", "-", ""}:
        return math.nan
    match = re.match(r"([-+]?\d+(?:\.\d+)?)", value)
    if not match:
        return math.nan
    return float(match.group(1))


def parse_pass_fraction(value: str) -> float:
    if value.strip() in {"/", "—", "-", ""}:
        return math.nan
    if "/" not in value:
        return math.nan
    passed, total = value.split("/", 1)
    total_value = float(total)
    if total_value == 0:
        return math.nan
    return float(passed) / total_value


def value_for(
    rows: list[dict[str, str]],
    metric: str,
    treatment: str,
    column: str,
    *,
    fraction: bool = False,
) -> float:
    for row in rows:
        if row.get("Metric") == metric and row.get("Treatment") == treatment:
            return parse_pass_fraction(row[column]) if fraction else parse_float(row[column])
    return math.nan


def judge_value(rows: list[dict[str, str]], dimension: str, treatment: str) -> float:
    for row in rows:
        if row.get("Dimension") == dimension and row.get("Treatment") == treatment:
            return parse_float(row.get("Judge", ""))
    return math.nan


def configure_style() -> None:
    plt.rcParams.update(
        {
            "figure.dpi": 160,
            "savefig.dpi": 320,
            "font.family": "DejaVu Sans",
            "font.size": 10.5,
            "axes.titlesize": 12,
            "axes.labelsize": 10.5,
            "axes.linewidth": 0.8,
            "xtick.labelsize": 9.5,
            "ytick.labelsize": 9.5,
            "legend.fontsize": 9.5,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
        }
    )


def render_pass5_figure(rows: list[dict[str, str]], output: Path) -> None:
    configure_style()
    columns = [
        ("Overall\npass@5", "overall", "pass@5"),
        ("Business\npass@5", "business", "pass@5"),
        ("Workflow\npass@5", "workflow", "pass@5"),
        ("Overall\npass^5", "overall", "pass^5"),
        ("Business\npass^5", "business", "pass^5"),
        ("Workflow\npass^5", "workflow", "pass^5"),
    ]
    matrix = np.array(
        [
            [value_for(rows, metric, treatment, column) for _, metric, column in columns]
            for treatment in TREATMENT_ORDER
        ],
        dtype=float,
    )
    masked = np.ma.masked_invalid(matrix)

    cmap = LinearSegmentedColormap.from_list(
        "paper_bright_blue",
        ["#f8fbff", "#d8ecff", "#8cc8ff", "#2d9cff", "#0072ce"],
    )
    cmap.set_bad("#f2f4f7")

    fig, ax = plt.subplots(figsize=(10.8, 3.55), constrained_layout=True)
    ax.imshow(masked, cmap=cmap, vmin=0, vmax=1, aspect="auto")
    ax.set_title(
        "Pass@5 saturates; pass^5 exposes strict-reliability gaps",
        loc="left",
        pad=14,
        weight="bold",
    )
    ax.set_xticks(range(len(columns)), [label for label, _, _ in columns])
    ax.set_yticks(range(len(TREATMENT_ORDER)), [TREATMENT_LABELS[item] for item in TREATMENT_ORDER])
    ax.tick_params(axis="both", length=0)
    ax.axvline(2.5, color="white", linewidth=2.4)

    for row_index in range(matrix.shape[0]):
        for col_index in range(matrix.shape[1]):
            value = matrix[row_index, col_index]
            label = "N/A" if math.isnan(value) else f"{value:.2f}"
            color = "#101828" if math.isnan(value) or value < 0.75 else "white"
            ax.text(col_index, row_index, label, ha="center", va="center", color=color, weight="bold")

    for spine in ax.spines.values():
        spine.set_visible(False)
    fig.text(
        0.01,
        -0.04,
        "Source: 16 Comet workflow tasks x 3 treatments x 5 samples. pass@5 is a capability ceiling; pass^5 requires all five samples to pass.",
        ha="left",
        fontsize=9,
        color="#667085",
    )
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def render_rubric_figure(
    rubric_rows: list[dict[str, str]],
    judge_rows: list[dict[str, str]],
    output: Path,
) -> None:
    configure_style()
    rows = sorted(
        rubric_rows,
        key=lambda row: parse_float(row.get("Δ (workflow−baseline)", "0")),
        reverse=True,
    )
    overall = [row for row in rows if row["Dimension"] == "Overall"]
    dimensions = [row for row in rows if row["Dimension"] != "Overall"]
    ordered_rows = overall + dimensions

    fig, ax = plt.subplots(figsize=(12.6, 6.7), constrained_layout=True)
    render_rubric_dumbbell(ax, ordered_rows, judge_rows)

    handles = [
        plt.Line2D([], [], marker="o", color=COLORS["COMET_FULL_040_BETA"], linestyle=""),
        plt.Line2D([], [], marker="s", color=COLORS["COMET_FULL_039"], linestyle=""),
        plt.Line2D(
            [],
            [],
            marker="D",
            markerfacecolor="white",
            markeredgecolor="#475467",
            color="none",
            linestyle="",
        ),
    ]
    fig.legend(
        handles,
        ["Comet 0.4.0 rubric", "Comet 0.3.9 rubric", "LLM judge"],
        loc="upper center",
        bbox_to_anchor=(0.56, 1.06),
        ncols=3,
        frameon=False,
    )
    fig.text(
        0.01,
        -0.02,
        "Source: same k=5 LangSmith comparison report. Filled markers are deterministic rubric means; hollow diamonds are independent LLM-as-judge means.",
        ha="left",
        fontsize=9,
        color="#667085",
    )
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def render_rubric_dumbbell(
    ax: plt.Axes,
    rows: list[dict[str, str]],
    judge_rows: list[dict[str, str]],
) -> None:
    y_positions = list(range(len(rows)))
    labels = [DIMENSION_LABELS.get(row["Dimension"], row["Dimension"]) for row in rows]

    for y, row in zip(y_positions, rows):
        current = parse_float(row["COMET_FULL_040_BETA"])
        baseline = parse_float(row["COMET_FULL_039"])
        delta = parse_float(row.get("Δ (workflow−baseline)", ""))
        low, high = sorted([current, baseline])
        line_color = "#98a2b3" if abs(delta) < 0.005 else COLORS["COMET_FULL_040_BETA"]
        ax.hlines(y, low, high, color=line_color, linewidth=2.3, alpha=0.72)
        ax.scatter(
            current,
            y,
            s=54,
            color=COLORS["COMET_FULL_040_BETA"],
            edgecolor="white",
            linewidth=0.8,
            zorder=3,
        )
        ax.scatter(
            baseline,
            y,
            s=44,
            marker="s",
            color=COLORS["COMET_FULL_039"],
            edgecolor="white",
            linewidth=0.8,
            zorder=3,
        )
        delta_label = f"{delta:+.2f}"
        is_large_gain = delta >= 0.07
        ax.text(
            1.085,
            y,
            delta_label,
            ha="left",
            va="center",
            color=COLORS["COMET_FULL_040_BETA"] if delta > 0 else "#475467",
            weight="bold" if is_large_gain else "normal",
        )

    overlay_judge_markers(ax, rows, judge_rows)
    ax.set_title("Rubric profile: 0.4.0 advantages over 0.3.9", loc="left", pad=22, weight="bold")
    ax.set_yticks(y_positions, labels)
    ax.invert_yaxis()
    ax.set_xlim(0.45, 1.12)
    ax.set_xticks(np.arange(0.5, 1.01, 0.1))
    ax.set_xlabel("Mean score")
    ax.grid(axis="x", color="#e5e7eb", linewidth=0.8)
    ax.axvline(1.0, color="#d0d5dd", linewidth=0.9, linestyle="--")
    ax.tick_params(axis="y", length=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#98a2b3")
    ax.spines["bottom"].set_color("#98a2b3")


def overlay_judge_markers(
    ax: plt.Axes,
    rubric_rows: list[dict[str, str]],
    judge_rows: list[dict[str, str]],
) -> None:
    row_index_by_dimension = {row["Dimension"]: index for index, row in enumerate(rubric_rows)}
    offsets = {"CONTROL": -0.22, "COMET_FULL_040_BETA": 0.0, "COMET_FULL_039": 0.22}
    for treatment in TREATMENT_ORDER:
        for dimension in ("artifact_quality", "spec_drift", "main_flow"):
            y = row_index_by_dimension.get(dimension)
            if y is None:
                continue
            x = judge_value(judge_rows, dimension, treatment)
            if math.isnan(x):
                continue
            color = COLORS[treatment]
            ax.scatter(
                x,
                y + offsets[treatment],
                s=44,
                marker="D",
                facecolor="white",
                edgecolor=color,
                linewidth=1.4,
                zorder=4,
            )
            ax.text(
                x + 0.012,
                y + offsets[treatment],
                f"{x:.2f}",
                va="center",
                fontsize=7.8,
                color="#475467",
            )


if __name__ == "__main__":
    main()
