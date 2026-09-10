"""Attach receipt clocks to an Agent JSONL stream, without launching the Agent.

The shell keeps its original argv/exit semantics and adds an end record carrying
a fresh token. This stdlib-only filter writes no files; Eval's persistence layer
redacts the resulting stream before saving it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, TextIO
from uuid import uuid4


def capture_stream(stream: TextIO, *, agent: str, role: str, token: str) -> int:
    sequence = 0
    completion: dict[str, Any] | None = None

    def emit(record: dict[str, Any]) -> None:
        nonlocal sequence
        sequence += 1
        record["_comet_eval"] = {
            "schema": "comet.eval.stream-event.v1",
            "invocation_id": token,
            "agent": agent,
            "role": role,
            "sequence": sequence,
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "monotonic_ns": time.monotonic_ns(),
            "time_source": "harness-stream-receipt",
        }
        print(json.dumps(record, ensure_ascii=False), flush=True)

    emit({"type": "comet.eval.invocation.started"})
    for line in stream:
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            record = None
        if isinstance(record, dict):
            if (
                record.get("type") == "comet.eval.capture.end"
                and record.get("token") == token
                and isinstance(record.get("exit_code"), int)
                and not isinstance(record.get("exit_code"), bool)
            ):
                if completion is None:
                    completion = {
                        "type": "comet.eval.invocation.completed",
                        "status": "completed" if record["exit_code"] == 0 else "failed",
                        "exit_code": record["exit_code"],
                    }
                    emit(completion)
            else:
                emit(record)
        else:
            # Preserve diagnostics without manufacturing a tool result.
            sys.stdout.write(line)
            sys.stdout.flush()
    if completion is None:
        emit(
            {
                "type": "comet.eval.invocation.completed",
                "status": "incomplete",
                "exit_code": None,
            }
        )
        return 70
    return 0


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--new-token", action="store_true")
    parser.add_argument("--agent")
    parser.add_argument("--role", default="subject")
    parser.add_argument("--stream-token")
    args = parser.parse_args()
    if args.new_token:
        print(uuid4())
        return 0
    if not args.agent or not args.stream_token:
        parser.error("--agent and --stream-token are required")
    return capture_stream(sys.stdin, agent=args.agent, role=args.role, token=args.stream_token)


if __name__ == "__main__":
    raise SystemExit(main())
