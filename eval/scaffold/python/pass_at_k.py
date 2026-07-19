"""pass@k / pass^k metrics for the comet eval.

These two metrics capture complementary aspects of skill quality:

- **pass@k** (HumanEval): the probability that at least one of k independent
  attempts succeeds. Measures the *capability ceiling* — "can the agent do it
  at all, given k tries?". Uses the unbiased estimator
  ``1 - C(n-c, k) / C(n, k)`` where n = total runs, c = successful runs.

- **pass^k** (Cons@k / reliability): the probability that *all* k attempts
  succeed. Measures the *reliability floor* — "does the agent do it
  consistently, every time?". Equals 1 iff c == n, else 0 (for the observed
  sample).

The gap ``pass@k − pass^k`` quantifies instability: a skill with high pass@k
but low pass^k "can do it but can't be trusted to do it every time" — a
critical distinction for a workflow skill users run repeatedly.

"Pass" is defined at the task level: a run passes when its task-specific
validator reports zero failures (``checks_failed == []``), i.e. the feature was
actually implemented correctly.
"""

from __future__ import annotations

import math
from typing import Sequence


def _comb(n: int, k: int) -> int:
    """Integer binomial coefficient C(n, k), with C(n,k)=0 for k<0 or k>n."""
    if k < 0 or k > n:
        return 0
    return math.comb(n, k)


def pass_at_k(n: int, c: int, k: int) -> float:
    """Unbiased pass@k estimator (HumanEval definition).

    Parameters
    ----------
    n : total number of runs sampled.
    c : number of successful runs (0 <= c <= n).
    k : the "k" in pass@k — number of attempts given.

    Returns the probability that at least one of k attempts (drawn without
    replacement from the n observed runs) is a success. When ``n - c < k`` it
    is impossible to draw k all-failures, so pass@k = 1.0.
    """
    if n - c < k:
        return 1.0
    # 1 - C(n-c, k) / C(n, k)
    return 1.0 - _comb(n - c, k) / _comb(n, k)


def pass_pow_k(n: int, c: int, k: int) -> float:
    """pass^k (reliability): 1.0 iff all n runs passed (so any k-subset is
    all-pass), else 0.0.

    For the observed sample this is a lower bound on the true "all k succeed"
    probability. With n >= k runs all passing, pass^k = 1.0.
    """
    if c >= n and n >= 1:
        return 1.0
    return 0.0


def compute_pass_metrics(results: Sequence[bool], k: int = 1) -> dict[str, float | int]:
    """Compute pass@k and pass^k for a sequence of per-run pass/fail booleans.

    Parameters
    ----------
    results : list of bool, one per run (True = passed).
    k : the k for pass@k / pass^k (default 1, i.e. single-attempt pass rate).

    Returns ``{"pass_at_k": float, "pass_pow_k": float, "n": int, "c": int}``.
    """
    n = len(results)
    c = sum(1 for r in results if r)
    if n == 0:
        return {"pass_at_k": 0.0, "pass_pow_k": 0.0, "n": 0, "c": 0}
    # pass@k is meaningful for k <= n; clamp k to n.
    k_eff = min(k, n)
    return {
        "pass_at_k": pass_at_k(n, c, k_eff),
        "pass_pow_k": pass_pow_k(n, c, k_eff),
        "n": n,
        "c": c,
        "k": k_eff,
    }


def pass_metrics_table(
    runs_by_treatment: dict[str, Sequence[bool]],
    ks: Sequence[int] = (1, 2, 5),
) -> dict[str, dict[int, dict[str, float]]]:
    """Compute pass@k / pass^k for multiple treatments and k values.

    Returns ``{treatment: {k: {"pass_at_k", "pass_pow_k", "n", "c"}}}``.
    """
    out: dict[str, dict[int, dict[str, float]]] = {}
    for treatment, results in runs_by_treatment.items():
        out[treatment] = {}
        for k in ks:
            out[treatment][k] = compute_pass_metrics(results, k)
    return out
