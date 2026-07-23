"""Validate deep Sequential clarification and terminal Native artifacts."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml


WORKSPACE = Path("/workspace")
RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
QUESTION_SIGNAL = re.compile(
    r"^(?:\[blocking\]\s*)?\**\bQUESTION\b(?:\s*\([^)\n]*\))?\**\s*(?::\**|$)",
    re.IGNORECASE | re.MULTILINE,
)
CONFIRM_MARKER = re.compile(r"\[blocking\]\s*CONFIRM", re.IGNORECASE)
REQUIRED_ABBREVIATIONS = (
    "dr.",
    "mr.",
    "mrs.",
    "ms.",
    "prof.",
    "sr.",
    "jr.",
    "e.g.",
    "i.e.",
    "etc.",
    "vs.",
    "inc.",
    "ltd.",
    "corp.",
    "st.",
    "ave.",
)


def passed(name: str):
    return {"check": name, "status": "passed"}


def failed(name: str, reason: str):
    return {"check": name, "status": "failed", "reason": reason}


def read_context() -> dict:
    path = WORKSPACE / "_test_context.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def decision_topics(text: str) -> set[str]:
    primary_question = re.split(r"\n\s*\n", text.strip(), maxsplit=1)[0]
    normalized = " ".join(primary_question.lower().split())
    topics = set()
    embedded_token = bool(
        re.search(
            r"\bterminal\s+characters?\b.{0,80}\b(?:embedded|inside)\b|"
            r"\b(?:embedded|inside)\b.{0,80}\b(?:word|prose\s+token|token)\b",
            normalized,
        )
    )
    if re.search(r"\babbrevi|e\.g\.|\bdr\.", normalized) or embedded_token:
        content_signal = bool(
            re.search(
                r"\b(?:exact|entries|items|members|contents?)\b|"
                r"\b(?:which|what)\s+abbreviations?\b|"
                r"\bset\s+of\s+(?:common\s+)?abbreviations?\b",
                normalized,
            )
        )
        strategy_signal = bool(
            re.search(
                r"\b(?:maintain|maintained|maintenance|define|defined|recognize|"
                r"recognized|identify|rule|approach|hardcoded|configurable)\b",
                normalized,
            )
        )
        if content_signal:
            topics.add("abbreviation-list-content")
        if strategy_signal:
            topics.add("abbreviation-list-strategy")
        if not content_signal and not strategy_signal:
            topics.add("abbreviation-policy")
    if re.search(
        r"\bempty(?:\s+or\s+whitespace(?:-only)?)?\s+input\b|"
        r"\bempty\s+or\s+whitespace-only\b|"
        r"\bno\s+input\b|\bzero[- ]length\b",
        normalized,
    ):
        topics.add("empty")
    if "?!" in normalized or re.search(
        r"\b(?:consecutive|contiguous|run\s+of)\b.{0,80}"
        r"\b(?:terminators?|terminal\s+characters?|punctuation|endings?)\b",
        normalized,
    ):
        topics.add("terminator-run")
    return topics


def missing_decisions(text: str) -> list[str]:
    """Return fixed user decisions that are not preserved semantically."""
    normalized = " ".join(text.lower().split())
    missing = []
    abbreviation = "abbrevi" in normalized and bool(
        re.search(
            r"(?:do|does|should)\s+not\s+(?:end|count)|"
            r"(?:ignored|filtered|excluded|suppressed?)\s+as\s+(?:a\s+)?"
            r"sentence\s+boundar|"
            r"suppress(?:es|ed|ing)?\s+(?:their\s+)?periods?.{0,60}"
            r"(?:sentence\s+)?boundar|"
            r"abbrevi.{0,240}not.{0,80}(?:sentence\s+(?:ending|boundar)|false\s+boundar)",
            normalized,
        )
    )
    if not abbreviation:
        missing.append("abbreviation behavior")

    abbreviation_list = "abbrevi" in normalized and bool(
        re.search(
            r"(?:small|explicit|known).{0,50}(?:list|set|allowlist|collection)"
            r".{0,100}(?:e\.g\.|dr\.)|"
            r"(?:list|set|allowlist|collection).{0,80}(?:e\.g\.|dr\.)",
            normalized,
        )
    )
    if not abbreviation_list:
        missing.append("abbreviation collection strategy")
    if not all(item in normalized for item in REQUIRED_ABBREVIATIONS):
        missing.append("exact abbreviation collection")

    empty = "empty" in normalized and bool(
        re.search(
            r"empty.{0,180}(?:returns?|prints?|result(?:\s+is)?|sentences:)"
            r"[^0-9]{0,24}0\b",
            normalized,
        )
    )
    if not empty:
        missing.append("empty-input count")

    terminators = bool(
        re.search(
            r"(?:consecutive|contiguous|run\s+of).{0,100}"
            r"(?:terminator|terminal\s+character|punctuation)",
            normalized,
        )
        and re.search(r"(?:one|single|exactly\s+one).{0,40}(?:sentence\s+)?boundar", normalized)
    )
    if not terminators:
        missing.append("terminator-run behavior")
    return missing


def contradictory_decisions(text: str) -> list[str]:
    normalized = " ".join(text.lower().split())
    abbreviation_enabled = bool(
        re.search(
            r"(?:do|does|should)\s+not\s+(?:end|count)|"
            r"suppress(?:es|ed|ing)?\s+(?:their\s+)?periods?.{0,60}"
            r"(?:sentence\s+)?boundar|"
            r"abbrevi.{0,240}not.{0,80}(?:sentence\s+(?:ending|boundar)|false\s+boundar)",
            normalized,
        )
    )
    abbreviation_disabled = bool(
        re.search(
            r"abbrevi.{0,160}(?:no\s+special[- ]cas|ordinary\s+prose\s+tokens?.{0,80}"
            r"no\s+special[- ]cas)",
            normalized,
        )
    )
    return ["abbreviation behavior"] if abbreviation_enabled and abbreviation_disabled else []


def missing_shared_understanding(text: str) -> list[str]:
    missing = missing_decisions(text)
    normalized = " ".join(re.sub(r"[*_`#]", "", text.lower()).split())
    summary_fields = {
        "goal/outcome": r"\b(?:goal|outcome)\b",
        "scope": r"\b(?:scope|in scope)\b",
        "explicit non-goals": r"\b(?:explicit\s+non-goals?|non-goals?|out of scope)\b",
        "acceptance criteria": r"\b(?:acceptance(?:\s+criteria)?|accepted when|done when)\b",
    }
    for label, pattern in summary_fields.items():
        if not re.search(pattern, normalized):
            missing.append(label)
    return missing


def is_confirmation_request(text: str) -> bool:
    normalized = " ".join(text.lower().split())
    if CONFIRM_MARKER.search(text):
        return True
    summary = bool(
        re.search(
            r"\b(?:(?:shared|my|our|current|final)[- ]+understanding|"
            r"understanding summary|confirmation summary)\b",
            normalized,
        )
    )
    request = bool(
        re.search(
            r"\b(?:please\s+)?confirm\b|"
            r"\breply\b.{0,40}\bconfirmed\b|"
            r"\brespond\b.{0,40}\bconfirmed\b",
            normalized,
        )
    )
    return summary and request


def command_mutates_target(command: str, target: str) -> bool:
    if not re.search(target, command, re.IGNORECASE):
        return False
    return bool(
        re.search(
            rf"(?i)(?:>>?|tee(?:\s+-\w+)*|set-content|add-content|out-file)"
            rf"\s*[^\r\n]*{target}|"
            rf"(?:\b(?:apply_patch|cp|mv|touch|new-item|write_text|write_bytes|"
            rf"writealltext|writeallbytes)\b|"
            rf"\*\*\*\s+(?:Add|Update|Delete)\s+File:|"
            rf"\bsed\b[^\r\n]*\s-i\b|\bperl\b[^\r\n]*\s-(?:p?i|i)\b"
            rf")[^\r\n]*{target}|"
            rf"{target}[^\r\n]{{0,200}}\.(?:write_text|write_bytes)\b|"
            rf"\bopen\s*\([^\r\n]*{target}[^\r\n]*,\s*['\"][wa]",
            command,
        )
    )


def successful_tool_call(tool_call: dict) -> bool:
    return tool_call.get("success") is True


def excluded_evidence_path(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    if normalized.startswith("/workspace/"):
        normalized = normalized[len("/workspace/") :]
    elif normalized.startswith("/"):
        return True
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized.startswith((".eval-", "_eval_")) or normalized in {
        "_test_context.json",
        "_test_results.json",
    }


def implementation_write(tool_call: dict) -> bool:
    if not successful_tool_call(tool_call):
        return False
    name = str(tool_call.get("name") or "").lower()
    path = str(tool_call.get("path") or "").replace("\\", "/").lower()
    target_path = path.endswith(".py") and not excluded_evidence_path(path)
    if target_path and name in {"write", "edit", "multiedit", "notebookedit"}:
        return True

    command = str(tool_call.get("command") or "")
    if name not in {"bash", "shell", "powershell"} or not command:
        return False
    python_target = r"(?:[a-z]:)?[./\\\w-]*\.py\b"
    if not command_mutates_target(command, python_target):
        return False
    paths = re.findall(python_target, command, re.IGNORECASE)
    return any(not excluded_evidence_path(path) for path in paths)


def investigated_existing_implementation(tool_call: dict) -> bool:
    if not successful_tool_call(tool_call):
        return False
    name = str(tool_call.get("name") or "").lower()
    path = str(tool_call.get("path") or "").replace("\\", "/").lower()
    command = str(tool_call.get("command") or "")
    if name == "read" and re.search(r"(?:^|/)wordcount\.py$", path):
        return True
    return name in {"bash", "shell", "powershell"} and bool(
        re.search(r"(?i)\bwordcount\.py\b", command)
    )


def workspace_relative_path(path: str) -> str | None:
    normalized = path.replace("\\", "/").lower()
    if normalized.startswith("/workspace/"):
        return normalized[len("/workspace/") :]
    if normalized.startswith("/"):
        return None
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def persisted_native_decision_kinds(tool_call: dict) -> set[str]:
    if not successful_tool_call(tool_call):
        return set()
    name = str(tool_call.get("name") or "").lower()
    relative_path = workspace_relative_path(str(tool_call.get("path") or ""))
    native_root = "docs/comet/changes/add-sentence-counting/"
    kinds = set()
    if name in {"write", "edit", "multiedit"} and relative_path:
        if relative_path == native_root + "brief.md":
            kinds.add("brief")
        if re.fullmatch(
            re.escape(native_root) + r"specs/[^/]+/spec\.md",
            relative_path,
        ):
            kinds.add("spec")

    command = str(tool_call.get("command") or "")
    if name not in {"bash", "shell", "powershell"} or not command:
        return kinds
    root_pattern = r"(?:/workspace/|\./)?docs[/\\]comet[/\\]changes[/\\]"
    root_pattern += r"add-sentence-counting[/\\]"
    brief_pattern = root_pattern + r"brief\.md\b"
    spec_pattern = root_pattern + r"specs[/\\][^/\\\s]+[/\\]spec\.md\b"
    if command_mutates_target(command, brief_pattern):
        kinds.add("brief")
    if command_mutates_target(command, spec_pattern):
        kinds.add("spec")
    return kinds


def check_clarification_protocol():
    context = read_context()
    if context.get("treatment_name") != "COMET_NATIVE_SEQUENTIAL":
        return failed(
            "clarification_depth_protocol",
            f"Unexpected treatment: {context.get('treatment_name')!r}",
        )

    config_file = WORKSPACE / ".comet" / "config.yaml"
    if not config_file.is_file():
        return failed("clarification_depth_protocol", "Native project config is missing")
    config = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    mode = (config.get("native") or {}).get("clarification_mode")
    if mode != "sequential":
        return failed(
            "clarification_depth_protocol",
            f"Expected native.clarification_mode sequential, got {mode!r}",
        )

    interaction = context.get("interaction") or {}
    if interaction.get("mode") != "auto_user" or interaction.get("deterministic_replies") != 6:
        return failed("clarification_depth_protocol", "Interactive simulator metadata is invalid")
    if interaction.get("decision_points") != 6:
        return failed(
            "clarification_depth_protocol",
            f"Expected six decision rounds, got {interaction.get('decision_points')!r}",
        )

    turns = interaction.get("subject_turns")
    if not isinstance(turns, list) or not turns:
        return failed("clarification_depth_protocol", "Subject-turn evidence is missing")
    if interaction.get("actual_turns") != len(turns):
        return failed(
            "clarification_depth_protocol",
            "Subject-turn evidence does not match the loop turn count",
        )
    if any(
        not isinstance(turn.get("tool_calls"), list)
        or any(
            not isinstance(tool, dict) or not isinstance(tool.get("success"), bool)
            for tool in turn.get("tool_calls") or []
        )
        for turn in turns
    ):
        return failed("clarification_depth_protocol", "Tool-call evidence is incomplete")

    decision_turns = [
        (index, turn)
        for index, turn in enumerate(turns)
        if QUESTION_SIGNAL.search(str(turn.get("result") or ""))
        or is_confirmation_request(str(turn.get("result") or ""))
    ]
    if len(decision_turns) != 6:
        return failed(
            "clarification_depth_protocol",
            f"Expected six decision turns with a final confirmation, got {len(decision_turns)}",
        )

    topic_order = []
    for round_number, (_, turn) in enumerate(decision_turns[:5], start=1):
        result = str(turn.get("result") or "")
        if len(QUESTION_SIGNAL.findall(result)) != 1 or is_confirmation_request(result):
            return failed(
                "clarification_depth_protocol",
                f"Decision round {round_number} must contain exactly one product question",
            )
        question_text = QUESTION_SIGNAL.split(result, maxsplit=1)[-1]
        question_prompt = re.split(
            r"\**\brecommend(?:ation|ed)?\b(?:\s+option)?\**\s*:",
            question_text,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        topics = decision_topics(question_prompt)
        if len(topics) != 1:
            return failed(
                "clarification_depth_protocol",
                f"Decision round {round_number} must ask exactly one hidden behavior decision",
            )
        if "recommend" not in question_text.lower() or "impact" not in question_text.lower():
            return failed(
                "clarification_depth_protocol",
                f"Decision round {round_number} lacks recommendation or impact",
            )
        topic_order.append(next(iter(topics)))
    if topic_order != [
        "empty",
        "terminator-run",
        "abbreviation-policy",
        "abbreviation-list-strategy",
        "abbreviation-list-content",
    ]:
        return failed(
            "clarification_depth_protocol",
            "Sequential questions did not resolve the hidden and dependent decisions in order",
        )

    confirmation_index, confirmation_turn = decision_turns[5]
    confirmation = str(confirmation_turn.get("result") or "")
    if QUESTION_SIGNAL.search(confirmation) or not is_confirmation_request(confirmation):
        return failed(
            "clarification_depth_protocol",
            "The final decision round must be one shared-understanding confirmation",
        )
    missing_confirmation = missing_shared_understanding(confirmation)
    if missing_confirmation:
        return failed(
            "clarification_depth_protocol",
            "The confirmation summary is incomplete: " + ", ".join(missing_confirmation),
        )
    first_question_index = decision_turns[0][0]
    investigated = any(
        investigated_existing_implementation(tool_call)
        for turn in turns[: first_question_index + 1]
        for tool_call in turn.get("tool_calls") or []
    )
    if not investigated:
        return failed(
            "clarification_depth_protocol",
            "The existing implementation was not investigated before the first decision",
        )
    for round_number, (_, turn) in enumerate(decision_turns[1:], start=2):
        persistence_kinds = set()
        for tool_call in turn.get("tool_calls") or []:
            persistence_kinds.update(persisted_native_decision_kinds(tool_call))
        if persistence_kinds != {"brief", "spec"}:
            missing_persistence = sorted({"brief", "spec"} - persistence_kinds)
            return failed(
                "clarification_depth_protocol",
                f"Decision round {round_number} lacks prior-answer persistence evidence for "
                + ", ".join(missing_persistence),
            )
    for turn in turns[: confirmation_index + 1]:
        for tool_call in turn.get("tool_calls") or []:
            if implementation_write(tool_call):
                return failed(
                    "clarification_depth_protocol",
                    "Implementation files were modified before explicit confirmation",
                )
    implemented_after_confirmation = any(
        implementation_write(tool_call)
        for turn in turns[confirmation_index + 1 :]
        for tool_call in turn.get("tool_calls") or []
    )
    if not implemented_after_confirmation:
        return failed(
            "clarification_depth_protocol",
            "No implementation write evidence exists after explicit confirmation",
        )
    return passed("clarification_depth_protocol")


def check_behavior():
    cases = [
        ("", "Sentences: 0"),
        ("Use e.g. examples. Ask Dr. Smith!", "Sentences: 2"),
        ("Really?! Yes.", "Sentences: 2"),
    ]
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        for source, expected in cases:
            result = subprocess.run(
                [sys.executable, "wordcount.py", "--sentences"],
                cwd=WORKSPACE,
                input=source,
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            if expected not in result.stdout:
                return failed(
                    "clarification_depth_behavior",
                    f"Expected {expected!r}, got {result.stdout!r}",
                )
    except Exception as error:
        return failed("clarification_depth_behavior", str(error))
    return passed("clarification_depth_behavior")


def archive_directories():
    root = WORKSPACE / "docs" / "comet" / "archive"
    return sorted(path for path in root.glob("*-*") if path.is_dir())


def check_confirmed_archive():
    active_root = WORKSPACE / "docs" / "comet" / "changes"
    active = sorted(path for path in active_root.glob("*") if path.is_dir())
    if active:
        return failed("clarification_depth_archive", f"Active changes remain: {len(active)}")
    archives = archive_directories()
    if len(archives) != 1:
        return failed("clarification_depth_archive", f"Expected one archive, found {len(archives)}")
    archived = archives[0]
    state_file = archived / "comet-state.yaml"
    if not state_file.is_file():
        return failed("clarification_depth_archive", "Archived state is missing")
    state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
    if (
        state.get("phase") != "archive"
        or state.get("archived") is not True
        or state.get("approval") != "confirmed"
        or state.get("verification_result") != "pass"
    ):
        return failed(
            "clarification_depth_archive",
            "Archive lacks terminal verification or explicit confirmation",
        )

    brief_file = archived / "brief.md"
    if not brief_file.is_file():
        return failed("clarification_depth_archive", "Archived brief is missing")
    brief_text = brief_file.read_text(encoding="utf-8")
    missing_brief = missing_decisions(brief_text)
    if missing_brief:
        return failed(
            "clarification_depth_archive",
            "Brief does not preserve decisions: " + ", ".join(missing_brief),
        )
    contradictory_brief = contradictory_decisions(brief_text)
    if contradictory_brief:
        return failed(
            "clarification_depth_archive",
            "Brief contains contradictory decisions: " + ", ".join(contradictory_brief),
        )

    spec_changes = state.get("spec_changes") or []
    if len(spec_changes) != 1 or not isinstance(spec_changes[0], dict):
        return failed("clarification_depth_archive", "Expected one capability specification")
    capability = spec_changes[0].get("capability")
    source = spec_changes[0].get("source")
    canonical = WORKSPACE / "docs" / "comet" / "specs" / str(capability) / "spec.md"
    archived_spec = archived / str(source or "")
    if not capability or source != f"specs/{capability}/spec.md":
        return failed("clarification_depth_archive", "Specification link is invalid")
    if not canonical.is_file() or not archived_spec.is_file():
        return failed(
            "clarification_depth_archive",
            "Canonical or archived specification is missing",
        )
    canonical_text = canonical.read_text(encoding="utf-8")
    if canonical_text.lower() != archived_spec.read_text(encoding="utf-8").lower():
        return failed("clarification_depth_archive", "Canonical and archived specifications differ")
    missing_spec = missing_decisions(canonical_text)
    if missing_spec:
        return failed(
            "clarification_depth_archive",
            "Target specification does not preserve decisions: " + ", ".join(missing_spec),
        )
    contradictory_spec = contradictory_decisions(canonical_text)
    if contradictory_spec:
        return failed(
            "clarification_depth_archive",
            "Target specification contains contradictory decisions: "
            + ", ".join(contradictory_spec),
        )

    report = archived / str(state.get("verification_report") or "")
    if state.get("verification_report") != "verification.md" or not report.is_file():
        return failed("clarification_depth_archive", "Verification report is missing")
    if "pass" not in report.read_text(encoding="utf-8").lower():
        return failed("clarification_depth_archive", "Verification report is not passing")
    return passed("clarification_depth_archive")


def main():
    results = [
        check_clarification_protocol(),
        check_behavior(),
        check_confirmed_archive(),
    ]
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f"{result['check']}: {result.get('reason', '')}"
            for result in results
            if result["status"] == "failed"
        ],
    }
    (WORKSPACE / RESULTS_FILE).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 0 if not output["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
