"""LLM-as-judge scoring for generic Skill eval targets.

The rule-based generic rubric (``generic_rubric.py``) catches structural signals
(file presence, command execution) but misses qualitative depth: did the agent
produce meaningful output, or just a stub? This module asks a judge LLM to read
workspace artifacts and score three generic quality dimensions on a 0.00-1.00
scale with a cited reason.

Runs on the host (not in Docker) via the same Claude CLI + proxy used for the
subject agent, so it adds no new dependency. Scores are emitted in the same
``[RUBRIC-JUDGE] dim: score - reason`` format the logging layer understands.

Usage::

    from scaffold.python.generic_llm_judge import judge_generic_messages
    results = judge_generic_messages(test_dir, outputs)
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from scaffold.python.judge_config import build_judge_invocation, run_judge_prompt

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
except Exception:
    pass

GENERIC_JUDGE_DIMENSIONS = ("task_completion", "output_quality", "instruction_adherence")

_JUDGE_RE = re.compile(r"\[RUBRIC-JUDGE\]\s+(\S+):\s*([0-9.]+)\s*-\s*(.+)")

# Directories to skip when collecting workspace artifacts.
_SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".comet",
    ".pytest_cache",
    "venv",
    ".venv",
    "env",
}

# Max chars per file, total budget across all files.
_PER_FILE_LIMIT = 3000
_TOTAL_BUDGET = 20_000


def _read_file(path: Path, limit: int = _PER_FILE_LIMIT) -> str:
    """Read up to *limit* chars of a file, gracefully handling missing files."""
    try:
        text = path.read_text(errors="ignore")
        return text[:limit] if len(text) > limit else text
    except Exception:
        return f"(missing: {path.name})"


def _collect_workspace_artifacts(test_dir: Path) -> str:
    """Walk *test_dir* and return a concatenated dump of workspace files.

    Skips hidden directories, common vendor dirs, and binary-looking files.
    Total output is capped at ``_TOTAL_BUDGET`` chars.
    """
    parts: list[str] = []
    total = 0

    for path in sorted(test_dir.rglob("*")):
        if not path.is_file():
            continue
        # Skip hidden paths.
        if any(part.startswith(".") for part in path.relative_to(test_dir).parts):
            continue
        # Skip known vendor / cache dirs.
        if any(part in _SKIP_DIRS for part in path.relative_to(test_dir).parts):
            continue
        # Skip large or binary-looking files.
        try:
            if path.stat().st_size > 50_000:
                continue
        except OSError:
            continue

        rel = path.relative_to(test_dir)
        text = _read_file(path, _PER_FILE_LIMIT)
        chunk = f"\n=== {rel} ===\n{text}\n"

        if total + len(chunk) > _TOTAL_BUDGET:
            remaining = _TOTAL_BUDGET - total
            if remaining > 200:
                parts.append(chunk[:remaining])
            break
        parts.append(chunk)
        total += len(chunk)

    return "".join(parts) if parts else "(no workspace files found)"


def _build_generic_judge_prompt(
    test_dir: Path,
    outputs: dict[str, Any],
) -> str:
    """Assemble workspace artifacts and the judging rubric into one prompt."""
    artifacts = _collect_workspace_artifacts(test_dir)

    # Include completion results summary if available.
    completion = outputs.get("completion") or {}
    passed_checks = completion.get("passed", [])
    failed_checks = completion.get("failed", [])
    completion_summary = (
        f"Passed: {len(passed_checks)}, Failed: {len(failed_checks)}\n"
        if passed_checks or failed_checks
        else "(no baseline checks)\n"
    )
    if failed_checks:
        completion_summary += "Failed checks:\n" + "\n".join(
            f"  - {item}" for item in failed_checks[:10]
        )

    # Custom rubric criteria from task.toml.
    custom_criteria = outputs.get("rubric_criteria") or []
    custom_section = ""
    if custom_criteria:
        lines = "\n".join(f"- {c}" for c in custom_criteria)
        custom_section = f"\nAdditional task-specific criteria:\n{lines}\n"

    # Build the list of dimensions the judge should output.
    all_dims = list(GENERIC_JUDGE_DIMENSIONS)
    dim_lines = [
        f"[RUBRIC-JUDGE] {dim}: <score> - <reason>" for dim in all_dims
    ]
    extra_dim_lines = [
        f"[RUBRIC-JUDGE] custom_{i}: <score> - <reason>"
        for i in range(len(custom_criteria))
    ]
    all_output_lines = "\n".join(dim_lines + extra_dim_lines)

    # Dimension count for the instruction.
    total_dims = len(all_dims) + len(custom_criteria)

    return f"""You are an impartial judge scoring an AI agent's task execution. Read the workspace artifacts below and score {total_dims} dimensions on a 0.00-1.00 scale. Output EXACTLY {total_dims} lines, each in this format (no other text):

{all_output_lines}

Scoring criteria:

task_completion (0.00-1.00):
- 1.0: all task requirements met, output artifacts present and correct, baseline checks pass
- 0.5: partial completion, some requirements met but others missing or incorrect
- 0.0: task not completed, key output missing or empty

output_quality (0.00-1.00):
- 1.0: output is well-structured, complete, non-trivial; shows evidence of thoughtful work
- 0.5: output present but shallow, minimal, or barely adequate
- 0.0: output missing, empty, or clearly a stub

instruction_adherence (0.00-1.00):
- 1.0: agent followed all instructions and constraints, no forbidden patterns, appropriate tool usage
- 0.5: minor deviations from instructions, but core intent respected
- 0.0: significant instruction violations, dangerous commands, or constraint failures
{custom_section}
Cite specific content from the artifacts in your reason (<=25 words each).

Baseline validation results:
{completion_summary}

=== Workspace artifacts ===
{artifacts}
"""


def _run_judge(prompt: str, timeout: int = 120) -> str:
    """Call the judge LLM through the configured judge provider."""
    return run_judge_prompt(prompt, timeout=timeout)


def judge_generic_artifacts(
    test_dir: Path,
    outputs: dict[str, Any],
    timeout: int = 120,
) -> dict[str, tuple[float, str]]:
    """Score qualitative dimensions via an LLM judge for generic skills.

    Returns ``{dim: (score, reason)}``. On any failure (model error, no
    parseable output) the dimension is omitted so the caller falls back to
    rule-based scores.
    """
    prompt = _build_generic_judge_prompt(test_dir, outputs)
    raw = _run_judge(prompt, timeout=timeout)

    # Collect all valid dimension names (standard + custom).
    custom_criteria = outputs.get("rubric_criteria") or []
    valid_dims = set(GENERIC_JUDGE_DIMENSIONS)
    for i in range(len(custom_criteria)):
        valid_dims.add(f"custom_{i}")

    scores: dict[str, tuple[float, str]] = {}
    for line in raw.splitlines():
        m = _JUDGE_RE.search(line)
        if not m:
            continue
        dim = m.group(1)
        try:
            score = float(m.group(2))
        except ValueError:
            continue
        reason = m.group(3).strip()
        if dim in valid_dims:
            scores[dim] = (max(0.0, min(1.0, score)), reason)
    return scores


def judge_generic_messages(
    test_dir: Path,
    outputs: dict[str, Any],
    timeout: int = 120,
) -> list[str]:
    """Convenience wrapper returning ``[RUBRIC-JUDGE]`` check messages."""
    out: list[str] = []
    try:
        build_judge_invocation()
    except ValueError as e:
        return [f"[RUBRIC-JUDGE] status: skipped - {e}"]

    for dim, (score, reason) in judge_generic_artifacts(
        test_dir, outputs, timeout=timeout
    ).items():
        out.append(f"[RUBRIC-JUDGE] {dim}: {score:.2f} - {reason}")
    return out
