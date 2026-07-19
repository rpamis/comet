"""LLM-as-judge scoring for qualitative rubric dimensions.

The rule-based rubric (``rubric.py``) catches structural signals (file
presence, keyword counts) but misses qualitative depth: did the design doc
genuinely explore alternatives, or did it just happen to contain the word
"risk"? This module asks a judge LLM to read the actual artifacts and score
three dimensions on a 0.00–1.00 scale with a cited reason.

Runs on the host (not in Docker) via the same Claude CLI + proxy used for the
subject agent, so it adds no new dependency. Scores are emitted in the same
``[RUBRIC-JUDGE] dim: score - reason`` format the logging layer understands.

Usage from the rubric validator or rescore tool::

    from scaffold.python.llm_judge import judge_artifacts
    scores = judge_artifacts(test_dir)  # {dim: (score, reason)}
"""

from __future__ import annotations

import re
from pathlib import Path

from scaffold.python.judge_config import build_judge_invocation, run_judge_prompt

# Ensure proxy credentials (ANTHROPIC_AUTH_TOKEN etc.) are available when this
# module is imported outside pytest (e.g. by the rescore tool).
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
except Exception:
    pass

# Dimensions the judge evaluates (subset of the rubric where rules are weak).
JUDGE_DIMENSIONS = ("artifact_quality", "spec_drift", "main_flow")

_JUDGE_RE = re.compile(r"\[RUBRIC-JUDGE\]\s+(\S+):\s*([0-9.]+)\s*-\s*(.+)")


def _read_file(path: Path, limit: int = 4000) -> str:
    """Read up to `limit` chars of a file, gracefully handling missing files."""
    try:
        text = path.read_text(errors="ignore")
        return text[:limit] if len(text) > limit else text
    except Exception:
        return f"(missing: {path.name})"


def _find_change_dir(test_dir: Path) -> Path | None:
    """Locate the comet change dir, handling both active and archived layouts."""
    changes_root = test_dir / "openspec" / "changes"
    if not changes_root.exists():
        return None
    for d in changes_root.iterdir():
        if not d.is_dir():
            continue
        if d.name == "archive":
            for sub in d.iterdir():
                if sub.is_dir() and (sub / "proposal.md").exists():
                    return sub
        elif (d / "proposal.md").exists():
            return d
    # Fallback: any subdir of archive/
    archive = changes_root / "archive"
    if archive.exists():
        for sub in archive.iterdir():
            if sub.is_dir():
                return sub
    return None


def _build_judge_prompt(test_dir: Path) -> str:
    """Assemble the artifacts and the judging rubric into one prompt."""
    change = _find_change_dir(test_dir)
    proposal = _read_file(change / "proposal.md") if change else "(no change dir)"
    design = _read_file(change / "design.md") if change else "(no design.md)"
    tasks = _read_file(change / "tasks.md") if change else "(no tasks.md)"

    # Design doc may live under docs/superpowers/specs/ instead.
    if design.startswith("(missing"):
        specs_dir = test_dir / "docs" / "superpowers" / "specs"
        if specs_dir.exists():
            spec_files = sorted(specs_dir.glob("*.md"))
            if spec_files:
                design = _read_file(spec_files[0])

    # Verify report (phase 4)
    verify_report = "(none)"
    reports_dir = test_dir / "docs" / "superpowers" / "reports"
    if reports_dir.exists():
        rep_files = sorted(reports_dir.glob("*.md"))
        if rep_files:
            verify_report = _read_file(rep_files[0], 2000)

    # Delta spec (phase drift signal)
    delta_spec = "(none)"
    if change:
        specs = list(change.rglob("spec.md"))
        if specs:
            delta_spec = _read_file(specs[0], 2000)

    return f"""You are an impartial judge scoring a software-development workflow run. Read the artifacts below and score THREE dimensions on a 0.00–1.00 scale. Output EXACTLY three lines, each in this format (no other text):

[RUBRIC-JUDGE] artifact_quality: <score> - <reason>
[RUBRIC-JUDGE] spec_drift: <score> - <reason>
[RUBRIC-JUDGE] main_flow: <score> - <reason>

Scoring criteria:

artifact_quality (0.00–1.00):
- 1.0: proposal states real problem/goals/scope/non-goals; design explores >=2 alternatives with explicit tradeoffs and risks; tasks are actionable checkboxes; tests have real assertions
- 0.5: artifacts present but shallow (stub proposal, design lists one approach without alternatives, tasks vague)
- 0.0: key artifacts missing or empty

spec_drift (0.00–1.00):
- 1.0: if a delta spec was written, it was reconciled (synced to main spec or archived cleanly); if none needed, 0.9
- 0.5: delta spec written but not reconciled, or minor inconsistency
- 0.0: delta spec contradicts implementation, or implementation drifted from spec with no delta

main_flow (0.00–1.00):
- 1.0: evidence of all 5 phases (open proposal → design doc → build plan/code → verify report → archive)
- 0.5: 2-3 phases evidenced
- 0.0: <2 phases

Cite specific content from the artifacts in your reason (<=25 words each).

=== proposal.md ===
{proposal}

=== design.md ===
{design}

=== tasks.md ===
{tasks}

=== verify report ===
{verify_report}

=== delta spec ===
{delta_spec}
"""


def _run_judge(prompt: str, timeout: int = 120) -> str:
    """Call the judge LLM through the configured judge provider."""
    return run_judge_prompt(prompt, timeout=timeout)


def judge_artifacts(test_dir: Path, timeout: int = 120) -> dict[str, tuple[float, str]]:
    """Score the three qualitative dimensions via an LLM judge.

    Returns ``{dim: (score, reason)}``. On any failure (model error, no
    parseable output) the dimension is omitted so the caller falls back to the
    rule-based score.
    """
    if not _find_change_dir(test_dir):
        return {}

    prompt = _build_judge_prompt(test_dir)
    raw = _run_judge(prompt, timeout=timeout)

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
        if dim in JUDGE_DIMENSIONS:
            scores[dim] = (max(0.0, min(1.0, score)), reason)
    return scores


def judge_messages(test_dir: Path, timeout: int = 120) -> list[str]:
    """Convenience wrapper returning ``[RUBRIC-JUDGE]`` check messages."""
    out: list[str] = []
    try:
        build_judge_invocation()
    except ValueError as e:
        return [f"[RUBRIC-JUDGE] status: skipped - {e}"]

    for dim, (score, reason) in judge_artifacts(test_dir, timeout=timeout).items():
        out.append(f"[RUBRIC-JUDGE] {dim}: {score:.2f} - {reason}")
    return out
