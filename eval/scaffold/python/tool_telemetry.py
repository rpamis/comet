"""Merge observed tool lifecycle events by identity, never by neighboring text."""

from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Any


def _number(value: Any) -> int | float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return value
    return None


def _text(*values: Any) -> str | None:
    return next((value for value in values if isinstance(value, str) and value), None)


def _seconds(value: Any) -> float | None:
    if not isinstance(value, str):
        return None  # A numeric timestamp with no declared unit remains unknown.
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def _output(value: Any) -> Any:
    if isinstance(value, list):
        return " ".join(
            item.get("text", str(item)) if isinstance(item, dict) else str(item) for item in value
        )
    return value


_ERROR_CATEGORIES = {
    "usage": "parameter-schema",
    "schema-validation": "parameter-schema",
    "workspace-mismatch": "path-workspace",
    "workspace-isolation-required": "path-workspace",
    "stale-state": "stale-state",
    "revision-conflict": "stale-state",
    "implementation-scope-stale": "stale-state",
    "baseline-incomplete": "business-blocked",
    "check-failed": "check-failed",
    "verification-failed": "check-failed",
    "FileNotFoundError": "installation-host",
    "CLASSIC_FIELD_VALUE_INVALID": "parameter-schema",
    "CLASSIC_FIELD_UNKNOWN": "parameter-schema",
    "CLASSIC_DESIGN_METADATA_INVALID": "parameter-schema",
    "CLASSIC_ARTIFACT_REF_INVALID": "path-workspace",
    "CLASSIC_DESIGN_UNREADABLE": "path-workspace",
    # These report unmet workflow prerequisites, not an executed test failure.
    "CLASSIC_ENTRY_CHECK_FAILED": "business-blocked",
    "CLASSIC_GUARD_CHECK_FAILED": "business-blocked",
}


def _error(item: dict, message: dict, output: Any) -> dict | None:
    error = item.get("error", message.get("error"))
    source = "agent-event"
    if error is None and isinstance(output, str):
        try:
            envelope = json.loads(output)
        except (ValueError, TypeError):
            envelope = None
        if isinstance(envelope, dict) and envelope.get("error") is not None:
            error = envelope["error"]
            source = "tool-output-json"
        elif isinstance(envelope, dict):
            data = envelope.get("data")
            issues = data.get("issues") if isinstance(data, dict) else None
            failed = (
                item.get("is_error") is True
                or message.get("type") == "item.failed"
                or any(
                    value is not None and value != 0
                    for value in (
                        _number(item.get("exit_code", item.get("exitCode"))),
                        _number(envelope.get("exitCode")),
                    )
                )
            )
            # Classic also exposes readiness issues in successful status reads;
            # only an observed failure makes data.issues an operation error.
            if failed and isinstance(issues, list) and issues:
                primary = next((issue for issue in issues if isinstance(issue, dict)), {})
                error = {**primary, "issues": issues}
                source = "tool-output-json"
    if error is None and item.get("is_error") is not True:
        return None
    record = error if isinstance(error, dict) else {}
    code = _text(record.get("code"), record.get("type"))
    issues = record.get("issues")
    issues = issues if isinstance(issues, list) else []
    category = record.get("category")
    if not isinstance(category, str) or category not in set(_ERROR_CATEGORIES.values()):
        category = _ERROR_CATEGORIES.get(code, "unknown")
        if code == "invalid-data" and any(
            isinstance(issue, dict) and issue.get("code") == "invalid-fields" for issue in issues
        ):
            category = "parameter-schema"
    return {
        "code": code,
        "category": category,
        "message": _text(record.get("message"), error),
        "source": source,
        "issues": issues,
    }


def extract_tool_telemetry(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    calls: list[dict] = []
    by_id: dict[tuple, dict] = {}
    private: dict[int, dict] = {}
    invocations: dict[str, dict] = {}
    invocation_clocks: dict[str, dict] = {}
    sessions: dict[str | None, str] = {}
    legacy_segment = 0

    for message in messages:
        if not isinstance(message, dict):
            continue
        meta = message.get("_comet_eval")
        meta = meta if isinstance(meta, dict) else {}
        invocation_id = _text(
            message.get("invocation_id"), message.get("invocationId"), meta.get("invocation_id")
        )
        capture_id = _text(meta.get("invocation_id"))
        stream_id = capture_id or invocation_id
        invocation_source = (
            "agent"
            if message.get("invocation_id") or message.get("invocationId")
            else "harness"
            if meta.get("invocation_id")
            else None
        )
        inner = message.get("message")
        inner = inner if isinstance(inner, dict) else {}
        session_id = _text(
            message.get("session_id"),
            message.get("sessionId"),
            message.get("thread_id"),
            message.get("threadId"),
            inner.get("session_id"),
        )
        if session_id:
            sessions[stream_id] = session_id
        session_id = session_id or sessions.get(stream_id)
        kind = message.get("type")
        if kind in {"comet.eval.invocation.started", "comet.eval.invocation.completed"}:
            if invocation_id:
                invocation = invocations.setdefault(
                    invocation_id,
                    {
                        "invocation_id": invocation_id,
                        "source": invocation_source,
                        "agent": meta.get("agent"),
                        "role": meta.get("role"),
                        "started_at": None,
                        "ended_at": None,
                        "exit_code": None,
                        "duration_ms": None,
                        "status": "incomplete",
                        "time_source": "harness-stream-receipt",
                        "timing_scope": "agent-stream-receipt",
                        "error": None,
                    },
                )
                if kind.endswith("started"):
                    invocation["started_at"] = meta.get("observed_at")
                    invocation_clocks.setdefault(invocation_id, {})["start"] = _number(
                        meta.get("monotonic_ns")
                    )
                else:
                    invocation.update(
                        ended_at=meta.get("observed_at"),
                        exit_code=_number(message.get("exit_code")),
                        status=message.get("status", "unknown"),
                        error=_error(message, {}, None),
                    )
                    invocation_clocks.setdefault(invocation_id, {})["end"] = _number(
                        meta.get("monotonic_ns")
                    )
            continue

        candidates: list[tuple[dict, bool, bool]] = []
        if kind in {"item.started", "item.completed", "item.failed"}:
            item = message.get("item")
            if isinstance(item, dict) and item.get("type") in {
                "command_execution",
                "mcp_tool_call",
                "tool_call",
            }:
                candidates.append((item, kind == "item.started", kind != "item.started"))
        elif kind in {"assistant", "user"}:
            for item in inner.get("content", []) if isinstance(inner.get("content"), list) else []:
                if isinstance(item, dict) and item.get("type") in {"tool_use", "tool_result"}:
                    candidates.append(
                        (item, item["type"] == "tool_use", item["type"] == "tool_result")
                    )

        for item, started, ended in candidates:
            tool_id = _text(
                item.get("tool_use_id"),
                item.get("id"),
                item.get("call_id"),
                item.get("tool_call_id"),
            )
            scope = (
                ("invocation", stream_id) if stream_id else ("legacy", session_id, legacy_segment)
            )
            key = (*scope, tool_id) if tool_id else None
            call = by_id.get(key) if key else None
            tool = (
                "Bash"
                if item.get("type") == "command_execution"
                else _text(item.get("name"), item.get("tool"))
            )
            arguments = (
                {"command": item.get("command", "")}
                if item.get("type") == "command_execution"
                else item.get("arguments", item.get("input"))
            )
            if call is None:
                call = {
                    "tool": tool or "unknown",
                    "input": arguments if arguments is not None else {},
                    "tool_call_id": tool_id,
                    "invocation_id": invocation_id,
                    "capture_invocation_id": capture_id,
                    "invocation_id_source": invocation_source,
                    "session_id": session_id,
                    "started_at": None,
                    "ended_at": None,
                    "duration_ms": None,
                    "time_source": None,
                    "timing_scope": "tool-round-trip",
                    "runtime_duration_ms": None,
                    "exit_code": None,
                    "error": None,
                    "status": "incomplete",
                    "retry_of": None,
                    "retry_source": None,
                    "event_sources": [],
                    "field_sources": {},
                }
                calls.append(call)
                private[id(call)] = {}
                if key:
                    by_id[key] = call
            observed = private[id(call)]
            if ended and observed.get("terminal"):
                # Replayed terminal events must not replace the first result,
                # its arguments, or its timing with a later receipt clock.
                continue
            if tool:
                call["tool"] = tool
            if arguments is not None:
                call["input"] = arguments
            if kind not in call["event_sources"]:
                call["event_sources"].append(kind)
            retry_of = _text(
                item.get("retry_of"),
                item.get("retryOf"),
                message.get("retry_of"),
                message.get("retryOf"),
            )
            if retry_of:
                call.update(retry_of=retry_of, retry_source="agent-event")

            for boundary, enabled, aliases in (
                ("started_at", started, ("started_at", "startedAt")),
                ("ended_at", ended, ("ended_at", "endedAt", "completed_at")),
            ):
                agent_time = next(
                    (
                        record[name]
                        for record in (item, message)
                        for name in aliases
                        if record.get(name) is not None
                    ),
                    None,
                )
                if (not enabled and agent_time is None) or call[boundary] is not None:
                    continue
                if agent_time is None:
                    agent_time = item.get("timestamp", message.get("timestamp"))
                stamp = agent_time if agent_time is not None else meta.get("observed_at")
                source = (
                    "agent-event"
                    if agent_time is not None
                    else ("harness-stream-receipt" if stamp is not None else None)
                )
                call[boundary] = stamp
                call["field_sources"][boundary] = source
                if source == "harness-stream-receipt":
                    observed[boundary + "_ns"] = _number(meta.get("monotonic_ns"))

            duration = _number(item.get("duration_ms", message.get("duration_ms")))
            if duration is not None and duration >= 0:
                call.update(duration_ms=duration, time_source="agent-reported")
                call["field_sources"]["duration_ms"] = "agent-event"
            if ended and not observed.get("terminal"):
                observed["terminal"] = True
                output = item.get("aggregated_output", item.get("content", item.get("result")))
                if output is not None:
                    call["output"] = _output(output)
                exit_code = item.get("exit_code", item.get("exitCode"))
                if isinstance(exit_code, int) and not isinstance(exit_code, bool):
                    call["exit_code"] = exit_code
                    call["field_sources"]["exit_code"] = "agent-event"
                call["error"] = _error(item, message, call.get("output"))
                if (
                    kind == "item.failed"
                    or item.get("is_error") is True
                    or call["error"] is not None
                    or call["exit_code"] not in {None, 0}
                ):
                    call["status"] = "failed"
                else:
                    call["status"] = "completed"
                if item.get("status") in {"interrupted", "cancelled", "canceled"}:
                    call["status"] = "interrupted"

        if kind in {"result", "turn.completed"} and invocation_id is None:
            legacy_segment += 1

    for call in calls:
        observed = private[id(call)]
        if call["duration_ms"] is None:
            sources = call["field_sources"]
            source = sources.get("started_at")
            if source is not None and source == sources.get("ended_at"):
                if source == "harness-stream-receipt":
                    start = observed.get("started_at_ns")
                    end = observed.get("ended_at_ns")
                    duration = (
                        (end - start) / 1_000_000 if start is not None and end is not None else None
                    )
                else:
                    start, end = _seconds(call["started_at"]), _seconds(call["ended_at"])
                    duration = (
                        (end - start) * 1000 if start is not None and end is not None else None
                    )
                if duration is not None and duration >= 0:
                    call.update(duration_ms=duration, time_source=source)
                    sources["duration_ms"] = source
        invocation = invocations.get(call["capture_invocation_id"] or call["invocation_id"])
        if call["status"] == "incomplete" and invocation and invocation["status"] == "interrupted":
            call["status"] = "interrupted"
            call["field_sources"]["status"] = "harness-invocation-interruption"
    for invocation_id, invocation in invocations.items():
        clocks = invocation_clocks.get(invocation_id, {})
        start, end = clocks.get("start"), clocks.get("end")
        if start is not None and end is not None and end >= start:
            invocation["duration_ms"] = (end - start) / 1_000_000
    return calls, list(invocations.values())
