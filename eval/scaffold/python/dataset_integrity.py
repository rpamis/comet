"""内置数据集的参考材料访问规则；Hook 拦截与事后审计使用同一判断。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def reference_access(tool: str, arguments: object) -> str | None:
    # 委派指令和编写测试中的文字不等于读取参考答案。
    if tool.lower() in {"agent", "task", "write", "edit", "multiedit", "apply_patch"}:
        return None
    text = json.dumps(arguments, ensure_ascii=False).replace("\\\\", "/")
    patterns = (
        r"(?:huggingface\.co|hf\.co)/(?:datasets/)?tencent/workbuddy-bench(?:[/\s\"']|$)",
        r"(?:github\.com|raw\.githubusercontent\.com)/(?:tencent/workbuddy-bench|benchflow-ai/skillsbench)(?:[/\s\"']|$)",
        r"(?:/opt/dataset-original|/tmp/wb-dataset)(?:/[^\s\"']*)?/(?:gold\.patch|verifier\.py|solve\.sh)(?:[\s\"']|$)",
        r"/tasks/[^/\s\"']+/(?:tests/gold\.patch|solution/[^\s\"']*|verifier/[^\s\"']*)(?:[\s\"']|$)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            # 只记录命中的材料位置，避免把整个命令、提示词或凭据写进报告。
            return match.group(0).strip("\"' ")[:300]
    return None


def audit_reference_access(workspace: Path, events: dict) -> list[dict]:
    hits = []
    seen = set()

    def record(tool, arguments, source, identity):
        match = reference_access(str(tool), arguments)
        key = (str(tool), match, identity)
        if match and key not in seen:
            seen.add(key)
            hits.append({"tool": tool, "material": match, "source": source})

    for call in events.get("tool_calls", []):
        record(
            call.get("tool", ""), call.get("input", {}), "subject-stream", call.get("tool_call_id")
        )
    home = workspace / ".dataset-state/home/agent/.claude/projects"
    if home.is_dir() and not home.is_symlink():
        for file in home.glob("**/*.jsonl"):
            if file.is_symlink() or any(
                p.is_symlink() for p in file.parents if p.is_relative_to(workspace)
            ):
                continue
            with file.open(encoding="utf-8", errors="replace") as stream:
                for line in stream:
                    try:
                        item = json.loads(line)
                    except ValueError:
                        continue
                    if item.get("type") != "assistant":
                        continue
                    for block in (item.get("message") or {}).get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            record(
                                block.get("name", ""),
                                block.get("input", {}),
                                file.relative_to(workspace).as_posix(),
                                block.get("id"),
                            )
    return hits


def main():
    if sys.argv[1:] == ["--settings"]:
        command = "python3 -I /opt/python/dataset_integrity.py --hook"
        print(
            json.dumps(
                {
                    "hooks": {
                        "PreToolUse": [
                            {"matcher": ".*", "hooks": [{"type": "command", "command": command}]}
                        ]
                    }
                }
            )
        )
        return 0
    if sys.argv[1:] != ["--hook"]:
        return 2
    try:
        event = json.load(sys.stdin)
        reason = reference_access(event["tool_name"], event["tool_input"])
    except (ValueError, KeyError, TypeError):
        print("Cannot validate benchmark material access: invalid Hook input.", file=sys.stderr)
        return 2
    if reason:
        print(
            "Benchmark reference access is prohibited. Use the supplied task, workspace, and your own tests; do not retrieve benchmark solutions or graders.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
