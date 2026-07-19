"""Regression gate for the comet skill eval.

Runs the eval (or reuses an existing experiment), compares the workflow
treatment against a stored baseline, and exits non-zero if any rubric
dimension regresses beyond a tolerance. On success the baseline is refreshed.

This is the "closed loop" from the Harness Eval methodology: every skill
change must prove it does not regress before merging.

Usage::

    # Run a fresh eval (3 reps) and gate against the stored baseline.
    uv run python local/scripts/regression_check.py --count 3

    # Gate an already-completed experiment without re-running claude.
    uv run python local/scripts/regression_check.py --experiment experiment_20260620_002548

    # Only compare two existing experiments (no eval, no baseline update).
    uv run python local/scripts/regression_check.py --experiment experiment_X --no-update

Exit code: 0 = pass (no regression), 1 = regression detected, 2 = error.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

EVAL_ROOT = Path(__file__).resolve().parents[2]
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from scaffold.python.paths import get_logs_dir  # noqa: E402
from scaffold.python.validation.rubric import RUBRIC_DIMENSIONS  # noqa: E402
from local.scripts.compare_baselines import (  # noqa: E402
    BASELINE,
    WORKFLOW,
    _aggregate,
    _load_reports,
)

# Stored baseline: {dim: mean} for the workflow treatment, refreshed on pass.
BASELINE_FILE = get_logs_dir().parent / "regression_baseline.json"
DEFAULT_TOLERANCE = 0.10  # a dimension may drop up to this much vs baseline


def _workflow_means(experiment_dir: Path) -> dict[str, float]:
    """Mean rubric score per dimension for the WORKFLOW treatment."""
    by_t = _load_reports(experiment_dir)
    reps = by_t.get(WORKFLOW, [])
    if not reps:
        return {}
    agg = _aggregate(reps)
    return {dim: agg[dim]["mean"] for dim in RUBRIC_DIMENSIONS}


def _load_stored_baseline() -> dict[str, float]:
    if BASELINE_FILE.exists():
        try:
            data = json.loads(BASELINE_FILE.read_text())
            # Stored shape is {"dimensions": {dim: mean}, ...}; unwrap.
            if isinstance(data, dict) and "dimensions" in data:
                return data["dimensions"]
            return data
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_baseline(means: dict[str, float]) -> None:
    BASELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"dimensions": means, "source": "regression_check.py"}
    BASELINE_FILE.write_text(json.dumps(payload, indent=2))


def _run_eval(count: int, treatments: str) -> str:
    """Invoke pytest to run a fresh eval; return the experiment id."""
    cmd = [
        sys.executable, "-m", "pytest", "local/tests/tasks/test_tasks.py",
        "--task=comet-full-workflow",
        f"--treatment={treatments}",
        f"--count={count}",
        "-v",
    ]
    print(f"[regression] running eval: {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        # pytest exits non-zero on validator failures, which is expected; the
        # reports are still written. We proceed to read them.
        print("[regression] pytest reported failures (expected for incomplete runs); continuing to gate", file=sys.stderr)
    # Find the latest experiment dir.
    exp_root = get_logs_dir() / "experiments"
    dirs = sorted([d for d in exp_root.iterdir() if d.is_dir()], key=lambda p: p.stat().st_mtime)
    return dirs[-1].name if dirs else ""


def gate(experiment_id: str, tolerance: float, update: bool) -> int:
    stored = _load_stored_baseline()
    experiment_dir = get_logs_dir() / "experiments" / experiment_id
    if not experiment_dir.exists():
        print(f"[regression] experiment not found: {experiment_id}", file=sys.stderr)
        return 2

    current = _workflow_means(experiment_dir)
    if not current:
        print(f"[regression] no {WORKFLOW} reports in {experiment_id}", file=sys.stderr)
        return 2

    print(f"[regression] gating {WORKFLOW} in {experiment_id} (tolerance ±{tolerance})")
    print(f"[regression] stored baseline: {stored or '(none — first run)'}")

    regressions: list[tuple[str, float, float]] = []
    print(f"\n{'Dimension':<28} {'Current':>8} {'Baseline':>9} {'Δ':>8}  Status")
    print("-" * 64)
    for dim in RUBRIC_DIMENSIONS:
        cur = current.get(dim, 0.0)
        base = stored.get(dim)
        if base is None:
            status = "NEW"
            delta_str = "—"
        else:
            delta = cur - base
            delta_str = f"{delta:+.2f}"
            if delta < -tolerance:
                status = "REGRESS"
                regressions.append((dim, cur, base))
            else:
                status = "ok"
        print(f"{dim:<28} {cur:>8.2f} {base if base is not None else 0.0:>9.2f} {delta_str:>8}  {status}")

    if regressions:
        print(f"\n❌ REGRESSION: {len(regressions)} dimension(s) dropped beyond tolerance:", file=sys.stderr)
        for dim, cur, base in regressions:
            print(f"   - {dim}: {cur:.2f} < {base:.2f} (Δ {cur - base:+.2f})", file=sys.stderr)
        print("\nBaseline NOT updated. Fix the regression or raise tolerance.", file=sys.stderr)
        return 1

    if update:
        _save_baseline(current)
        print(f"\n✅ PASS — baseline refreshed at {BASELINE_FILE}")
    else:
        print("\n✅ PASS (--no-update: baseline not refreshed)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", default=None, help="Existing experiment id to gate (skip eval)")
    parser.add_argument("--count", type=int, default=1, help="Reps per treatment when running eval (default 1)")
    parser.add_argument("--treatments", default=f"{WORKFLOW},{BASELINE}", help="Comma-separated treatments to run")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE, help="Max allowed drop per dimension")
    parser.add_argument("--no-update", action="store_true", help="Do not refresh the stored baseline on pass")
    args = parser.parse_args(argv)

    if args.experiment:
        experiment_id = args.experiment
    else:
        experiment_id = _run_eval(args.count, args.treatments)
        if not experiment_id:
            print("[regression] no experiment produced", file=sys.stderr)
            return 2

    return gate(experiment_id, args.tolerance, update=not args.no_update)


if __name__ == "__main__":
    raise SystemExit(main())
