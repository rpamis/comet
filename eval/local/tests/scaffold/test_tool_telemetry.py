"""Observed protocol events must preserve uncertainty and parallel identities."""

import json
from pathlib import Path
import subprocess
import sys

from scaffold.python.logging import extract_events, parse_output


def event(kind, item=None, *, invocation="run-a", ns=0, **extra):
    return {
        "type": kind,
        **({"item": item} if item is not None else {}),
        "_comet_eval": {
            "invocation_id": invocation,
            "observed_at": f"2026-09-10T10:00:{ns // 1_000_000_000:02d}+00:00",
            "monotonic_ns": ns,
            "agent": "codex",
            "role": "subject",
        },
        **extra,
    }


def command(tool_id, command="comet native status", **extra):
    return {"type": "command_execution", "id": tool_id, "command": command, **extra}


def extract(*messages):
    return extract_events({"messages": list(messages)})


def test_interleaved_ids_duplicate_completion_and_explicit_retry():
    start_a = event("item.started", command("a"), ns=1_000_000_000)
    finish_a = event(
        "item.completed",
        command(
            "a",
            exit_code=64,
            aggregated_output=json.dumps(
                {"error": {"code": "usage", "message": "Missing --runner-input"}}
            ),
        ),
        ns=4_000_000_000,
    )
    events = extract(
        start_a,
        event("item.started", command("b", "git status"), ns=2_000_000_000),
        finish_a,
        finish_a,
        event("item.completed", command("b", "git status", exit_code=0), ns=5_000_000_000),
        event("item.started", command("c", retry_of="a"), ns=6_000_000_000),
        event("item.completed", command("c", exit_code=0), ns=7_000_000_000),
    )
    a, b, c = events["tool_calls"]
    assert len(events["commands_run"]) == 3
    assert (a["exit_code"], a["error"]["category"], a["duration_ms"]) == (
        64,
        "parameter-schema",
        3000,
    )
    assert b["duration_ms"] == 3000
    assert a["timing_scope"] == "tool-round-trip"
    assert a["runtime_duration_ms"] is None
    assert b["retry_of"] is None
    assert c["retry_of"] == "a" and c["retry_source"] == "agent-event"
    assert "tool_duration_seconds" not in events  # Parallel durations are not added.


def test_same_tool_id_in_interleaved_invocations_is_not_merged():
    events = extract(
        event("item.started", command("same", "first"), invocation="one", ns=1),
        event("item.started", command("same", "second"), invocation="two", ns=2),
        event("item.completed", command("same", "second", exit_code=0), invocation="two", ns=3),
        event("item.completed", command("same", "first", exit_code=65), invocation="one", ns=4),
    )
    first, second = events["tool_calls"]
    assert (first["input"]["command"], first["exit_code"]) == ("first", 65)
    assert (second["input"]["command"], second["exit_code"]) == ("second", 0)


def test_legacy_claude_result_before_call_and_duplicate_start():
    result = {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tool-1",
                    "content": [{"type": "text", "text": "ok"}],
                }
            ]
        },
    }
    start = {
        "type": "assistant",
        "message": {
            "content": [
                {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "Bash",
                    "input": {"command": "echo ok"},
                }
            ]
        },
    }
    events = extract(result, start, start)
    assert len(events["tool_calls"]) == 1
    call = events["tool_calls"][0]
    assert (call["tool"], call["output"]) == ("Bash", "ok")
    assert all(
        call[key] is None
        for key in (
            "invocation_id",
            "started_at",
            "ended_at",
            "duration_ms",
            "exit_code",
            "retry_of",
        )
    )


def test_missing_and_explicit_interruption_are_distinct():
    events = extract(
        event("comet.eval.invocation.started"),
        event("item.started", command("interrupted"), ns=1),
        event("comet.eval.invocation.completed", status="interrupted", exit_code=-15, ns=2),
        event("item.started", command("unknown"), invocation="unclosed", ns=1),
    )
    interrupted, unknown = events["tool_calls"]
    assert interrupted["status"] == "interrupted"
    assert unknown["status"] == "incomplete"
    for call in (interrupted, unknown):
        assert call["exit_code"] is None and call["ended_at"] is None
        assert call["duration_ms"] is None
    assert events["invocations"][0]["exit_code"] == -15


def test_agent_clocks_and_structured_error_categories_keep_their_source():
    events = extract(
        {"type": "item.started", "timestamp": "2026-09-10T10:00:00Z", "item": command("a")},
        {
            "type": "item.completed",
            "timestamp": "2026-09-10T10:00:02Z",
            "item": command(
                "a", exit_code=73, error={"code": "workspace-mismatch", "message": "bound worktree"}
            ),
        },
        {
            "type": "item.completed",
            "item": command("b", duration_ms=37, exit_code=65, error={"code": "invalid-data"}),
        },
    )
    a, b = events["tool_calls"]
    assert (a["duration_ms"], a["time_source"]) == (2000, "agent-event")
    assert a["error"]["category"] == "path-workspace"
    assert (b["duration_ms"], b["time_source"]) == (37, "agent-reported")
    assert b["error"]["category"] == "unknown"
    assert b["retry_of"] is None


def test_invalid_or_mixed_clocks_do_not_create_a_duration():
    events = extract(
        event("item.started", command("a", timestamp="2026-09-10T10:00:00Z"), ns=1),
        event("item.completed", command("a", exit_code=0), ns=2),
        event("item.started", command("b"), ns=4),
        event("item.completed", command("b", duration_ms=float("nan")), ns=3),
    )
    assert all(call["duration_ms"] is None for call in events["tool_calls"])


def test_native_invalid_data_uses_explicit_field_issues_without_guessing():
    issue = {
        "code": "invalid-fields",
        "path": "$.final",
        "missingFields": ["knownLimits"],
        "unknownFields": ["known_limits"],
    }
    events = extract(
        event(
            "item.completed",
            command(
                "a",
                exit_code=65,
                aggregated_output=json.dumps(
                    {
                        "error": {"code": "invalid-data", "issues": [issue]},
                    }
                ),
            ),
        ),
        event(
            "item.completed",
            command(
                "b",
                exit_code=65,
                aggregated_output=json.dumps(
                    {
                        "error": {"code": "invalid-data", "message": "unclassified data error"},
                    }
                ),
            ),
        ),
    )
    first, second = events["tool_calls"]
    assert first["error"]["category"] == "parameter-schema"
    assert first["error"]["issues"] == [issue]
    assert first["error"]["source"] == "tool-output-json"
    assert second["error"]["category"] == "unknown"


def test_classic_failure_preserves_data_issues_and_field_diagnostics():
    issue = {
        "code": "CLASSIC_FIELD_VALUE_INVALID",
        "field": "phase",
        "actual": "finish",
        "expected": ["open", "design", "build", "verify", "archive"],
        "message": "Invalid value for phase.",
    }
    # Actual Classic --json result shape emitted by classic-script-entry.ts.
    output = {"command": "state", "exitCode": 1, "data": {"issues": [issue]}}
    call = extract(
        event(
            "item.completed",
            command(
                "classic-field",
                exit_code=1,
                aggregated_output=json.dumps(output),
            ),
        )
    )["tool_calls"][0]
    assert call["status"] == "failed"
    assert call["error"]["code"] == "CLASSIC_FIELD_VALUE_INVALID"
    assert call["error"]["category"] == "parameter-schema"
    assert call["error"]["issues"] == [issue]
    assert call["error"]["source"] == "tool-output-json"


def test_classic_issue_codes_use_narrow_categories_and_leave_generic_causes_unknown():
    categories = {
        "CLASSIC_FIELD_UNKNOWN": "parameter-schema",
        "CLASSIC_DESIGN_METADATA_INVALID": "parameter-schema",
        "CLASSIC_ARTIFACT_REF_INVALID": "path-workspace",
        "CLASSIC_DESIGN_UNREADABLE": "path-workspace",
        "CLASSIC_ENTRY_CHECK_FAILED": "business-blocked",
        "CLASSIC_GUARD_CHECK_FAILED": "business-blocked",
        "CLASSIC_DESIGN_HANDOFF_FAILED": "unknown",
        "CLASSIC_OPENSPEC_FAILED": "unknown",
        "CLASSIC_COMMAND_FAILED": "unknown",
        "CLASSIC_FUTURE_ISSUE": "unknown",
    }
    for code, category in categories.items():
        issue = {
            "code": code,
            "message": "diagnostic",
            "path": "docs/design.md",
            "remediation": "repair",
        }
        call = extract(
            event(
                "item.completed",
                command(
                    code,
                    exit_code=1,
                    aggregated_output=json.dumps({"exitCode": 1, "data": {"issues": [issue]}}),
                ),
            )
        )["tool_calls"][0]
        assert call["error"]["category"] == category
        assert call["error"]["issues"] == [issue]


def test_successful_status_with_readiness_issues_is_not_a_failed_cli_call():
    call = extract(
        event(
            "item.completed",
            command(
                "status",
                exit_code=0,
                aggregated_output=json.dumps(
                    {
                        "exitCode": 0,
                        "data": {"issues": [{"code": "CLASSIC_DESIGN_METADATA_INVALID"}]},
                    }
                ),
            ),
        )
    )["tool_calls"][0]
    assert call["error"] is None
    assert call["status"] == "completed"


def test_completion_can_supply_both_clocks_and_provider_invocation_id():
    events = extract(
        event("item.started", command("a"), invocation_id="provider-run"),
        event("item.completed", command("a", exit_code=0)),
        {
            "type": "item.completed",
            "item": command(
                "b", started_at="2026-09-10T10:00:00Z", completed_at="2026-09-10T10:00:01Z"
            ),
        },
    )
    assert len(events["tool_calls"]) == 2
    first, second = events["tool_calls"]
    assert first["invocation_id"] == "provider-run"
    assert first["capture_invocation_id"] == "run-a"
    assert first["exit_code"] == 0
    assert second["duration_ms"] == 1000


def test_real_stream_capture_supplies_identity_and_receipt_clocks_without_model(tmp_path):
    capture = Path(__file__).parents[3] / "scaffold/python/stream_capture.py"
    fixture = tmp_path / "agent.py"
    fixture.write_text(
        "import json\n"
        "print(json.dumps({'type':'item.started','item':{'type':'command_execution','id':'t','command':'echo ok'}}), flush=True)\n"
        "print(json.dumps({'type':'item.completed','item':{'type':'command_execution','id':'t','command':'echo ok','exit_code':0}}), flush=True)\n"
        "print(json.dumps({'type':'comet.eval.capture.end','token':'fixture-token','exit_code':7}), flush=True)\n"
        "raise SystemExit(7)\n",
        encoding="utf-8",
    )
    with subprocess.Popen([sys.executable, str(fixture)], stdout=subprocess.PIPE) as source:
        result = subprocess.run(
            [sys.executable, str(capture), "--agent", "codex", "--stream-token", "fixture-token"],
            stdin=source.stdout,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        assert source.wait(timeout=5) == 7
    assert result.returncode == 0
    events = extract_events(parse_output(result.stdout))
    call = events["tool_calls"][0]
    assert call["invocation_id"] and call["invocation_id_source"] == "harness"
    assert call["duration_ms"] >= 0
    assert call["time_source"] == "harness-stream-receipt"
    assert events["invocations"][0]["exit_code"] == 7
    assert events["invocations"][0]["timing_scope"] == "agent-stream-receipt"
    assert events["subject_invocations"] == 0  # No invented model result event.


def test_missing_or_unrelated_end_record_has_no_invented_child_exit_code():
    capture = Path(__file__).parents[3] / "scaffold/python/stream_capture.py"
    result = subprocess.run(
        [sys.executable, str(capture), "--agent", "fixture", "--stream-token", "expected-token"],
        input=json.dumps({"type": "comet.eval.capture.end", "token": "unrelated", "exit_code": 0})
        + "\n",
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert result.returncode == 70
    events = extract_events(parse_output(result.stdout))
    assert events["invocations"][0]["exit_code"] is None
    assert events["invocations"][0]["status"] == "incomplete"


def test_replayed_terminal_event_keeps_first_result_and_duration():
    events = extract(
        event("item.started", command("t"), ns=1),
        event("item.completed", command("t", duration_ms=2, exit_code=65), ns=3),
        event("item.completed", command("t", "different", duration_ms=99, exit_code=0), ns=6),
    )
    call = events["tool_calls"][0]
    assert len(events["tool_calls"]) == 1
    assert (call["exit_code"], call["duration_ms"], call["input"]["command"]) == (
        65,
        2,
        "comet native status",
    )


def test_new_fields_are_redacted_before_persistence(monkeypatch, tmp_path):
    secret = "test-credential-never-persist-012345"
    monkeypatch.setenv("OPENAI_API_KEY", secret)
    messages = [
        event(
            "item.completed",
            command(
                "t",
                "run --api-key=" + secret,
                error={"code": "usage", "message": secret},
                aggregated_output=secret,
            ),
        )
    ]
    messages.append(
        event(
            "item.completed",
            command(
                "classic-secret",
                exit_code=1,
                aggregated_output=json.dumps(
                    {
                        "exitCode": 1,
                        "data": {
                            "issues": [
                                {
                                    "code": "CLASSIC_ARTIFACT_REF_INVALID",
                                    "actual": secret,
                                    "path": secret,
                                    "expected": "repository-relative path",
                                    "remediation": secret,
                                }
                            ]
                        },
                    }
                ),
            ),
        )
    )
    stdout = "\n".join(json.dumps(message) for message in messages)
    events = extract_events({"messages": messages})
    assert events["tool_calls"][1]["error"]["issues"][0]["expected"] == "repository-relative path"
    assert secret not in json.dumps(events)
    # The real logger applies the same redaction to old and new event fields.
    from scaffold.python.logging import _atomic_write_json

    output = tmp_path / "events.json"
    _atomic_write_json(output, events)
    assert secret not in output.read_text(encoding="utf-8")
    assert secret not in json.dumps(parse_output(stdout))
