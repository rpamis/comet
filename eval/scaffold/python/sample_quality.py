"""Sample-quality classification for eval reports."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

QualityStatus = Literal["included", "excluded", "flagged"]
QualityConfidence = Literal["high", "medium", "low"]

_API_TIMEOUT_RE = re.compile(
    r"(api request timed out|request timed out|read timed out)",
    re.I,
)
_RUNNER_TIMEOUT_RE = re.compile(
    r"(timeout after|timed out after|subprocess.*timeout)",
    re.I,
)
_RATE_LIMIT_RE = re.compile(
    r"(429|rate[_ -]?limit|insufficient quota|quota exceeded)",
    re.I,
)
_AUTH_RE = re.compile(
    r"(authentication|unauthorized|invalid api key|api key|auth token)",
    re.I,
)
_NETWORK_RE = re.compile(
    r"(dns|tls|connection closed|connection reset|connection refused|gateway timeout|econnreset|etimedout)",
    re.I,
)
_OUTER_FAILURE_MENTION_RE = re.compile(
    r"(api timeout|timeout|rate[_ -]?limit|quota|network|dns|tls|docker|container|auth)",
    re.I,
)
_CONTAINER_RE = re.compile(
    r"(docker daemon not running|"
    r"docker [^\n]{0,80}(not available|failed|image build failed)|"
    r"docker build[^\n]{0,80}failed|"
    r"container (?:failed|crashed|did not start)|"
    r"container build[^\n]{0,80}failed|"
    r"build image[^\n]{0,80}failed|"
    r"image build[^\n]{0,80}failed|"
    r"mount[^\n]{0,80}failed)",
    re.I,
)
_VALIDATOR_RE = re.compile(
    r"(validator|artifact path|task directory|not found in archive)",
    re.I,
)


@dataclass(frozen=True)
class SampleQuality:
    status: QualityStatus
    reason_code: str
    reason: str
    include_in_analysis: bool
    confidence: QualityConfidence = "high"
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _coerce_quality(value: dict[str, Any]) -> SampleQuality:
    status = value.get("status", "flagged")
    if status not in {"included", "excluded", "flagged"}:
        status = "flagged"
    include = bool(value.get("include_in_analysis", status != "excluded"))
    confidence = value.get("confidence", "medium")
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium"
    evidence = value.get("evidence", [])
    return SampleQuality(
        status=status,
        reason_code=str(value.get("reason_code") or "legacy_unknown"),
        reason=str(value.get("reason") or "legacy sample-quality metadata"),
        include_in_analysis=include,
        confidence=confidence,
        evidence=[str(item) for item in evidence if item],
    )


def _read_text(path: str | None) -> str | None:
    if not path:
        return None
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _artifact_text(report: dict[str, Any], key: str) -> str | None:
    refs = report.get("events_summary", {}).get("artifact_references") or {}
    value = refs.get(key)
    return _read_text(value if isinstance(value, str) else None)


def _has_result_event(stdout: str | None) -> bool:
    if not stdout:
        return False
    for line in stdout.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("type") == "result":
            return True
    return False


def _terminal_error_text(*streams: str | None) -> str | None:
    parts: list[str] = []
    for stream in streams:
        if not stream:
            continue
        for line in stream.splitlines():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "result" or not (
                payload.get("is_error") or payload.get("terminal_reason") == "api_error"
            ):
                continue
            parts.extend(
                str(value)
                for value in (
                    payload.get("terminal_reason"),
                    payload.get("error"),
                    payload.get("result"),
                )
                if value
            )
    return "\n".join(parts) or None


def _text_parts(*values: Any) -> str:
    parts: list[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            parts.extend(str(item) for item in value if item is not None)
        else:
            parts.append(str(value))
    return "\n".join(parts)


def _hard_noise(
    text: str,
    returncode: int | None,
    has_result: bool,
) -> SampleQuality | None:
    if _RATE_LIMIT_RE.search(text) and not has_result:
        return SampleQuality(
            "excluded",
            "rate_limited",
            "API rate limit or quota failure",
            False,
            evidence=[text[:200]],
        )
    if _API_TIMEOUT_RE.search(text) and not has_result:
        return SampleQuality(
            "excluded",
            "api_timeout",
            "Claude/API request timed out",
            False,
            evidence=[text[:200]],
        )
    if returncode == 124 or (_RUNNER_TIMEOUT_RE.search(text) and not has_result):
        return SampleQuality(
            "excluded",
            "runner_timeout",
            "Runner timed out before a complete result",
            False,
            evidence=[text[:200]],
        )
    if _CONTAINER_RE.search(text) and not has_result:
        return SampleQuality(
            "excluded",
            "container_failure",
            "Docker/container failed before evaluation completed",
            False,
            evidence=[text[:200]],
        )
    if _AUTH_RE.search(text) and not has_result:
        return SampleQuality(
            "excluded",
            "auth_failure",
            "Authentication failed before evaluation completed",
            False,
            evidence=[text[:200]],
        )
    if _NETWORK_RE.search(text) and not has_result:
        return SampleQuality(
            "excluded",
            "network_failure",
            "Network failure interrupted evaluation",
            False,
            evidence=[text[:200]],
        )
    return None


def _soft_noise(
    text: str,
    failure_attribution: list[dict[str, Any]],
    events: dict[str, Any],
    has_result: bool,
) -> SampleQuality | None:
    if has_result and (
        _RATE_LIMIT_RE.search(text)
        or _API_TIMEOUT_RE.search(text)
        or _CONTAINER_RE.search(text)
        or _AUTH_RE.search(text)
        or _NETWORK_RE.search(text)
        or _OUTER_FAILURE_MENTION_RE.search(text)
    ):
        return SampleQuality(
            "flagged",
            "completed_run_mentions_outer_failure",
            "Run completed, but logs or checks mention outer runner/API/environment failures",
            True,
            "medium",
            [text[:200]],
        )
    if any(item.get("bucket") == "harness" for item in failure_attribution):
        return SampleQuality(
            "flagged",
            "harness_trigger_suspect",
            "Harness attribution indicates the target Skill may not have been triggered",
            True,
            "medium",
            [
                item.get("reason", "")
                for item in failure_attribution
                if item.get("bucket") == "harness"
            ],
        )
    if _VALIDATOR_RE.search(text) and any(
        item.get("bucket") == "task" for item in failure_attribution
    ):
        return SampleQuality(
            "flagged",
            "validator_assumption",
            "Failure may come from task or validator assumptions",
            True,
            "medium",
            [text[:200]],
        )
    if has_result and (events.get("total_tokens") is None or events.get("total_cost_usd") is None):
        return SampleQuality(
            "flagged",
            "partial_observability",
            "Run completed but token or cost telemetry is incomplete",
            True,
            "medium",
            ["result event present but telemetry missing"],
        )
    return None


def infer_sample_quality(
    *,
    report: dict[str, Any] | None = None,
    events: dict[str, Any] | None = None,
    checks_failed: list[str] | None = None,
    failure_attribution: list[dict[str, Any]] | None = None,
    stdout: str | None = None,
    stderr: str | None = None,
    returncode: int | None = None,
) -> SampleQuality:
    report = report or {}
    existing = report.get("sample_quality")
    if isinstance(existing, dict):
        return _coerce_quality(existing)

    events_summary = report.get("events_summary", {})
    existing = events_summary.get("sample_quality") if isinstance(events_summary, dict) else None
    if isinstance(existing, dict):
        return _coerce_quality(existing)

    events = events or report.get("events_summary") or {}
    checks_failed = checks_failed if checks_failed is not None else report.get("checks_failed", [])
    failure_attribution = (
        failure_attribution
        if failure_attribution is not None
        else events.get("failure_attribution", [])
    )
    stdout = stdout if stdout is not None else _artifact_text(report, "raw_stdout")
    stderr = stderr if stderr is not None else _artifact_text(report, "raw_stderr")

    terminal_error = _terminal_error_text(stderr, stdout)
    if terminal_error:
        hard = _hard_noise(terminal_error, returncode, False)
        if hard:
            return hard
        return SampleQuality(
            "excluded",
            "api_failure",
            "Claude/API execution ended with a structured error result",
            False,
            evidence=[terminal_error[:200]],
        )

    has_result = _has_result_event(stdout) or events.get("duration_seconds") is not None
    text = _text_parts(stderr, stdout, checks_failed)

    hard = _hard_noise(text, returncode, has_result)
    if hard:
        return hard

    # A completed task may legitimately discuss Docker, networking, auth, or
    # timeout behavior in its result. Only runner stderr and failed checks are
    # evidence that those terms describe the evaluation environment itself.
    soft_text = _text_parts(stderr, checks_failed)
    soft = _soft_noise(soft_text, failure_attribution, events, has_result)
    if soft:
        return soft

    if not has_result and checks_failed:
        return SampleQuality(
            "flagged",
            "partial_observability",
            "Run has failures but no complete result event was observed",
            True,
            "low",
            [str(checks_failed[0])],
        )

    return SampleQuality(
        "included",
        "valid_signal",
        "Run completed with validator evidence",
        True,
        "high",
        ["result event present" if has_result else "legacy report treated as valid signal"],
    )


def quality_from_report(
    report: dict[str, Any],
    *,
    experiment_dir: Path | None = None,
) -> SampleQuality:
    if experiment_dir is not None:
        refs = report.get("events_summary", {}).get("artifact_references") or {}
        normalized_refs = {}
        for key, value in refs.items():
            if isinstance(value, str) and not Path(value).is_absolute():
                normalized_refs[key] = str(experiment_dir / value)
            else:
                normalized_refs[key] = value
        if normalized_refs:
            report = {
                **report,
                "events_summary": {
                    **report.get("events_summary", {}),
                    "artifact_references": normalized_refs,
                },
            }
    return infer_sample_quality(report=report)


def sample_quality_dict(
    report: dict[str, Any],
    *,
    experiment_dir: Path | None = None,
) -> dict[str, Any]:
    return quality_from_report(report, experiment_dir=experiment_dir).to_dict()


def include_in_analysis(
    report: dict[str, Any],
    *,
    experiment_dir: Path | None = None,
) -> bool:
    return quality_from_report(report, experiment_dir=experiment_dir).include_in_analysis
