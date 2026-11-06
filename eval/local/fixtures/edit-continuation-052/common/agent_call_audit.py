"""Observe known Agent-creation tools and directly recognizable Claude launches.

This is an actual tool-stream audit, not a complete process-tree audit. It does
not classify TaskCreate/todos as agents or count deterministic controllers.
"""

import re
import shlex

AGENT_TOOLS = frozenset({"Task", "Agent", "spawn_agent", "collaboration.spawn_agent"})


def direct_claude_launch(command):
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()")
        lexer.whitespace_split = True
        tokens = list(lexer)
    except (TypeError, ValueError):
        return False
    segments = [[]]
    for token in tokens:
        if token and set(token) <= set(";&|()"):
            segments.append([])
        else:
            segments[-1].append(token)
    for segment in segments:
        while segment and (
            segment[0] in ("exec", "command", "env")
            or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", segment[0])
        ):
            segment = segment[1:]
        if not segment:
            continue
        executable = re.split(r"[/\\]", segment[0])[-1].lower()
        if executable in ("claude", "claude.exe", "claude.cmd"):
            return True
        if executable in ("npx", "npx.cmd") and any(
            item == "@anthropic-ai/claude-code" or item.startswith("@anthropic-ai/claude-code@")
            for item in segment[1:]
        ):
            return True
        if (
            executable in ("node", "node.exe")
            and len(segment) > 1
            and re.search(r"(?:^|[/\\])claude-code[/\\](?:cli|index)\.js$", segment[1])
        ):
            return True
    return False


def observe_agent_call(block, agent_calls, subprocess_calls):
    tool_id = block.get("id")
    name = block.get("name")
    if name in AGENT_TOOLS:
        agent_calls.setdefault(tool_id, {"toolUseId": tool_id, "name": name})
    if name == "Bash":
        command = block.get("input", {}).get("command", "")
        if direct_claude_launch(command):
            subprocess_calls.setdefault(
                tool_id,
                {
                    "toolUseId": tool_id,
                    "name": name,
                    "command": command,
                    "detection": "direct-recognizable-Claude-launch",
                },
            )


def agent_call_evidence(agent_calls, subprocess_calls):
    return {
        "observedExtraAgentCalls": len(agent_calls),
        "extraAgentToolCalls": list(agent_calls.values()),
        "observedSubprocessAgentCalls": len(subprocess_calls),
        "subprocessAgentCalls": list(subprocess_calls.values()),
        "agentCallAuditScope": "Actual tool_use IDs for exact Task, Agent, spawn_agent, collaboration.spawn_agent plus directly recognizable Bash Claude launches; does not prove zero agents inside arbitrary scripts or services. Deterministic trusted controller simulations are not model Agent calls.",
    }
