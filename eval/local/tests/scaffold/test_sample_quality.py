"""Unit tests for eval sample-quality classification."""

import json
from pathlib import Path

from scaffold.python.sample_quality import (
    include_in_analysis,
    infer_sample_quality,
    quality_from_report,
    sample_quality_dict,
)


def test_api_timeout_is_excluded_from_analysis():
    quality = infer_sample_quality(
        checks_failed=["Validation failed: no result"],
        stdout='{"type":"assistant","message":{"content":[]}}\n',
        stderr="Error: API request timed out after 600s",
        returncode=1,
    )

    assert quality.status == "excluded"
    assert quality.reason_code == "api_timeout"
    assert quality.include_in_analysis is False
    assert "API request timed out" in " ".join(quality.evidence)


def test_rate_limit_is_excluded_from_analysis():
    quality = infer_sample_quality(stderr="429 rate_limit_error: insufficient quota")

    assert quality.status == "excluded"
    assert quality.reason_code == "rate_limited"
    assert quality.include_in_analysis is False


def test_structured_connection_failure_outranks_rate_limit_wording_in_prompt():
    stderr = "\n".join(
        [
            json.dumps(
                {
                    "type": "user",
                    "message": {"content": "Document rate limit behavior."},
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "is_error": True,
                    "terminal_reason": "api_error",
                    "result": "API Error: Connection closed mid-response.",
                }
            ),
        ]
    )

    quality = infer_sample_quality(
        checks_failed=["Required skill not invoked"],
        stderr=stderr,
        returncode=1,
    )

    assert quality.status == "excluded"
    assert quality.reason_code == "network_failure"
    assert quality.include_in_analysis is False


def test_container_failure_is_excluded_from_analysis():
    quality = infer_sample_quality(stderr="ERROR: Docker daemon not running")

    assert quality.status == "excluded"
    assert quality.reason_code == "container_failure"
    assert quality.include_in_analysis is False


def test_completed_run_with_api_timeout_in_failed_check_stays_in_analysis():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 42,
            "total_tokens": 1000,
            "total_cost_usd": 0.12,
        },
        checks_failed=["validator failed: expected graceful API timeout handling"],
        stdout=json.dumps({"type": "result", "duration_ms": 42000}) + "\n",
        returncode=0,
    )

    assert quality.status == "flagged"
    assert quality.reason_code == "completed_run_mentions_outer_failure"
    assert quality.include_in_analysis is True


def test_completed_run_with_network_wording_in_failed_check_stays_in_analysis():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 42,
            "total_tokens": 1000,
            "total_cost_usd": 0.12,
        },
        checks_failed=["validator failed: summary should mention network retry guidance"],
        stdout=json.dumps({"type": "result", "duration_ms": 42000}) + "\n",
        returncode=0,
    )

    assert quality.status == "flagged"
    assert quality.reason_code == "completed_run_mentions_outer_failure"
    assert quality.include_in_analysis is True


def test_completed_run_with_container_wording_in_logs_stays_in_analysis():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 42,
            "total_tokens": 1000,
            "total_cost_usd": 0.12,
        },
        checks_failed=["validator failed: expected report artifact"],
        stdout=json.dumps({"type": "result", "duration_ms": 42000}) + "\n",
        stderr="Task output discussed why a Docker daemon not running error should be surfaced.",
        returncode=0,
    )

    assert quality.status == "flagged"
    assert quality.reason_code == "completed_run_mentions_outer_failure"
    assert quality.include_in_analysis is True


def test_completed_run_with_container_wording_only_in_result_is_valid_signal():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 42,
            "total_tokens": 1000,
            "total_cost_usd": 0.12,
        },
        checks_failed=[],
        stdout=(
            json.dumps(
                {
                    "type": "result",
                    "duration_ms": 42000,
                    "result": "The Docker container workflow completed successfully.",
                }
            )
            + "\n"
        ),
        stderr="[loop] workflow completion detected; ending\n",
        returncode=0,
    )

    assert quality.status == "included"
    assert quality.reason_code == "valid_signal"


def test_validator_failure_with_observable_run_is_included():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 42,
            "total_tokens": 1000,
            "total_cost_usd": 0.12,
            "skills_invoked": ["comet"],
            "artifact_references": {"report": "reports/demo.json"},
        },
        checks_failed=["validator failed: output file missing"],
        stdout=json.dumps({"type": "result", "duration_ms": 42000}) + "\n",
        returncode=0,
    )

    assert quality.status == "included"
    assert quality.reason_code == "valid_signal"
    assert quality.include_in_analysis is True


def test_harness_attribution_without_hard_noise_is_flagged():
    quality = infer_sample_quality(
        events={"duration_seconds": 10, "skills_invoked": []},
        checks_failed=["Required skill not invoked: comet"],
        failure_attribution=[
            {
                "bucket": "harness",
                "check": "Required skill not invoked: comet",
                "reason": "target Skill was never invoked",
            }
        ],
        stdout=json.dumps({"type": "result", "duration_ms": 10000}) + "\n",
        returncode=0,
    )

    assert quality.status == "flagged"
    assert quality.reason_code == "harness_trigger_suspect"
    assert quality.include_in_analysis is True


def test_existing_sample_quality_is_respected():
    report = {
        "sample_quality": {
            "status": "excluded",
            "reason_code": "api_timeout",
            "reason": "API timeout",
            "include_in_analysis": False,
            "confidence": "high",
            "evidence": ["stderr timeout"],
        }
    }

    quality = quality_from_report(report)

    assert quality.status == "excluded"
    assert quality.reason_code == "api_timeout"
    assert include_in_analysis(report) is False
    assert sample_quality_dict(report)["include_in_analysis"] is False


def test_sample_quality_in_events_summary_is_respected():
    report = {
        "events_summary": {
            "sample_quality": {
                "status": "excluded",
                "reason_code": "rate_limited",
                "reason": "quota exceeded",
                "include_in_analysis": False,
                "confidence": "high",
                "evidence": ["events summary"],
            }
        }
    }

    quality = quality_from_report(report)

    assert quality.status == "excluded"
    assert quality.reason_code == "rate_limited"
    assert include_in_analysis(report) is False
    assert sample_quality_dict(report)["status"] == "excluded"


def test_plain_build_failed_with_observable_result_is_included():
    quality = infer_sample_quality(
        events={
            "duration_seconds": 10,
            "total_tokens": 1234,
            "total_cost_usd": 0.01,
        },
        stdout='{"type":"result","duration_ms": 1000}\n',
        stderr="build failed",
        checks_failed=[],
        returncode=0,
    )

    assert quality.status == "included"
    assert quality.reason_code == "valid_signal"
    assert quality.include_in_analysis is True


def test_legacy_report_reads_raw_stderr_reference(tmp_path: Path):
    stderr = tmp_path / "raw" / "workflow_rep1_stderr.txt"
    stderr.parent.mkdir()
    stderr.write_text("Timeout after 600s", encoding="utf-8")
    report = {
        "checks_passed": [],
        "checks_failed": ["no result"],
        "events_summary": {
            "artifact_references": {"raw_stderr": str(stderr)},
        },
    }

    quality = quality_from_report(report)

    assert quality.status == "excluded"
    assert quality.reason_code == "runner_timeout"
    assert quality.include_in_analysis is False
