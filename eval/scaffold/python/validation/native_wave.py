"""Shared hard checks for the Comet Native wave B-F evaluations.

The wave tasks intentionally exercise different runtime contracts, but their
evidence is all machine-readable JSON.  Keeping the parsing here prevents each
task validator from inventing a slightly different interpretation of Native
state, compare-and-swap outcomes, or Dashboard projections.
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
import sys
import unicodedata
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any


HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ACCEPTANCE_ID_PATTERN = re.compile(r"^acceptance-[a-f0-9]{64}$")
SCOPE_ID_PATTERN = re.compile(r"^scope:[a-f0-9]{64}$")
CHANGE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
MAX_EVIDENCE_BYTES = 1024 * 1024
MAX_SAFE_INTEGER = 2**53 - 1


class NativeEvidenceError(ValueError):
    """Raised when an eval artifact is not an exact Native runtime document."""


def canonical_json(value: Any) -> str:
    """Mirror Native's canonical JSON for JSON-domain eval documents."""
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise NativeEvidenceError(f"Value is not canonical JSON: {error}") from error


def canonical_hash(tag: str, value: Any) -> str:
    if not tag or "\n" in tag or "\r" in tag:
        raise NativeEvidenceError("Canonical hash tag is invalid")
    return hashlib.sha256(f"{tag}\n{canonical_json(value)}".encode()).hexdigest()


NATIVE_CHECK_LIMITS = {
    "maxFiles": 256,
    "maxFileBytes": 1024 * 1024,
    "maxTotalBytes": 8 * 1024 * 1024,
    "maxIssues": 128,
}
NATIVE_CHECKER_HASH = canonical_hash(
    "comet.native.checker-policy.v1",
    {
        "policy": "scoped-text-safety",
        "version": 1,
        "limits": NATIVE_CHECK_LIMITS,
        "checks": ["conflict-marker", "space-before-tab", "trailing-whitespace"],
        "binaryHandling": "skip-and-count",
    },
)
NATIVE_CHECK_ISSUE_KINDS = (
    "conflict-marker",
    "trailing-whitespace",
    "space-before-tab",
    "scope-mismatch",
    "unsafe-file",
    "scan-limit",
)
NATIVE_CHECK_STALE_REASONS = (
    "contract-before-does-not-match-scope",
    "implementation-before-does-not-match-scope",
    "contract-changed-during-check",
    "implementation-changed-during-check",
    "contract-after-does-not-match-scope",
    "implementation-after-does-not-match-scope",
)


def _record(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise NativeEvidenceError(f"{label} must be an object")
    return value


def _exact_keys(
    value: dict[str, Any],
    required: Iterable[str],
    optional: Iterable[str] = (),
    *,
    label: str,
) -> None:
    required_set = set(required)
    allowed = required_set | set(optional)
    missing = sorted(required_set - set(value))
    unknown = sorted(set(value) - allowed)
    if missing or unknown:
        raise NativeEvidenceError(
            f"{label} fields are invalid: missing={missing}, unknown={unknown}"
        )


def _hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not HASH_PATTERN.fullmatch(value):
        raise NativeEvidenceError(f"{label} must be a SHA-256 hash")
    return value


def _positive_int(value: Any, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > MAX_SAFE_INTEGER
    ):
        raise NativeEvidenceError(f"{label} must be a positive integer")
    return value


def _nonnegative_int(value: Any, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > MAX_SAFE_INTEGER
    ):
        raise NativeEvidenceError(f"{label} must be a non-negative integer")
    return value


def _timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value
    ):
        raise NativeEvidenceError(f"{label} must be a canonical ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise NativeEvidenceError(f"{label} must be a canonical ISO timestamp") from error
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        raise NativeEvidenceError(f"{label} must be a canonical ISO timestamp")
    return value


def portable_ref(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise NativeEvidenceError(f"{label} must be a non-empty relative ref")
    if "\\" in value or any(
        ord(character) <= 0x1F or ord(character) == 0x7F for character in value
    ):
        raise NativeEvidenceError(f"{label} must be portable")
    ref = PurePosixPath(value)
    if ref.is_absolute() or ".." in ref.parts or "." in ref.parts or str(ref) != value:
        raise NativeEvidenceError(f"{label} must be a normalized relative ref")
    if re.match(r"^(?:[A-Za-z]:|~)", value) or value.endswith("/"):
        raise NativeEvidenceError(f"{label} must be a normalized relative ref")
    return value


def _assert_real_directory_chain(root: Path, target: Path, label: str) -> None:
    root = root.absolute()
    target = target.absolute()
    try:
        relative = target.relative_to(root)
    except ValueError as error:
        raise NativeEvidenceError(f"{label} escapes its root") from error
    cursor = root
    if cursor.is_symlink() or not cursor.is_dir():
        raise NativeEvidenceError(f"{label} root must be a real directory")
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise NativeEvidenceError(f"{label} crosses a symbolic link: {cursor}")


def contained_file(root: Path, ref: Any, label: str) -> Path:
    reference = portable_ref(ref, label)
    target = root.joinpath(*PurePosixPath(reference).parts)
    _assert_real_directory_chain(root, target.parent, label)
    if target.is_symlink() or not target.is_file():
        raise NativeEvidenceError(f"{label} is not a real regular file: {reference}")
    try:
        target.resolve(strict=True).relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise NativeEvidenceError(f"{label} resolves outside its root") from error
    return target


def read_contained_json(root: Path, ref: Any, label: str) -> Any:
    target = contained_file(root, ref, label)
    if target.stat().st_size > MAX_EVIDENCE_BYTES:
        raise NativeEvidenceError(f"{label} exceeds its byte budget")
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise NativeEvidenceError(f"{label} is invalid JSON: {error}") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def passed(check: str, message: str = "") -> dict[str, str]:
    result = {"check": check, "status": "passed"}
    if message:
        result["message"] = message
    return result


def failed(check: str, reason: str) -> dict[str, str]:
    return {"check": check, "status": "failed", "reason": reason}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_runtime_envelope(
    path: Path,
    *,
    command: str | None = None,
    exit_code: int | None = None,
) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise NativeEvidenceError(f"Missing real runtime JSON evidence: {path}")
    if path.stat().st_size > MAX_EVIDENCE_BYTES:
        raise NativeEvidenceError(f"Runtime envelope exceeds its byte budget: {path.name}")
    try:
        payload = read_json(path)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise NativeEvidenceError(f"Invalid runtime JSON in {path.name}: {error}") from error
    envelope = _record(payload, f"Runtime envelope {path.name}")
    _exact_keys(
        envelope,
        ["command", "exitCode", "data"],
        ["error"],
        label=f"Runtime envelope {path.name}",
    )
    if not isinstance(envelope["command"], str) or not envelope["command"]:
        raise NativeEvidenceError(f"{path.name} has no exact command")
    if (
        isinstance(envelope["exitCode"], bool)
        or not isinstance(envelope["exitCode"], int)
        or not isinstance(envelope["data"], dict)
    ):
        raise NativeEvidenceError(f"{path.name} has an invalid exitCode/data envelope")
    if "error" in envelope:
        error = _record(envelope["error"], f"Runtime error {path.name}")
        _exact_keys(error, ["code", "message"], label=f"Runtime error {path.name}")
        if error["code"] not in {"usage", "invalid-data", "blocked", "conflict", "internal"}:
            raise NativeEvidenceError(f"{path.name} has an invalid runtime error code")
        if not isinstance(error["message"], str) or not error["message"]:
            raise NativeEvidenceError(f"{path.name} has an invalid runtime error message")
    if command is not None and envelope["command"] != command:
        raise NativeEvidenceError(
            f"{path.name} expected command {command!r}; observed {envelope['command']!r}"
        )
    if exit_code is not None and envelope["exitCode"] != exit_code:
        raise NativeEvidenceError(
            f"{path.name} expected exit {exit_code}; observed {envelope['exitCode']!r}"
        )
    return envelope


def _walk(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _normalise_token(value: Any) -> str:
    return str(value).strip().lower().replace("_", "-").replace(" ", "-")


def check_json_state(path: Path, expected_state: str) -> dict[str, str]:
    """Require an exact state token anywhere in a JSON evidence payload."""
    check = f"json_state_{expected_state}"
    if not path.is_file():
        return failed(check, f"Missing evidence file: {path}")
    try:
        payload = read_json(path)
    except (OSError, json.JSONDecodeError) as error:
        return failed(check, f"Invalid JSON in {path.name}: {error}")

    expected = _normalise_token(expected_state)
    tokens = {
        _normalise_token(value)
        for value in _walk(payload)
        if isinstance(value, (str, int, float, bool))
    }
    if expected not in tokens:
        return failed(check, f"Expected state {expected_state!r}; observed {sorted(tokens)}")
    return passed(check)


def check_runtime_envelopes(paths: Iterable[Path]) -> dict[str, str]:
    """Require exact Native CLI JSON envelopes instead of prose reconstructions."""
    check = "runtime_json_envelopes"
    for path in paths:
        try:
            parse_runtime_envelope(path)
        except NativeEvidenceError as error:
            return failed(check, str(error))
    return passed(check)


def _normalize_acceptance_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


def _heading(line: str) -> tuple[int, str] | None:
    match = re.fullmatch(r" {0,3}(#{1,6})[ \t]+(.+?)[ \t]*", line)
    if not match:
        return None
    text = re.sub(r"[ \t]+#+[ \t]*$", "", match.group(2)).strip()
    return len(match.group(1)), text


def _scanned_markdown(markdown: str) -> list[tuple[str, bool]]:
    scanned: list[tuple[str, bool]] = []
    fence: tuple[str, int] | None = None
    html_comment = False
    html_tag: str | None = None
    for line in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        scanned.append((line, fence is None and not html_comment and html_tag is None))
        fence_match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence is not None:
            if (
                fence_match
                and fence_match.group(1)[0] == fence[0]
                and len(fence_match.group(1)) >= fence[1]
                and not fence_match.group(2).strip()
            ):
                fence = None
            continue
        if html_comment:
            if "-->" in line:
                html_comment = False
            continue
        if html_tag is not None:
            if re.search(rf"</{re.escape(html_tag)}\s*>", line, re.IGNORECASE):
                html_tag = None
            continue
        if fence_match:
            fence = (fence_match.group(1)[0], len(fence_match.group(1)))
            continue
        trimmed = line.lstrip()
        if trimmed.startswith("<!--") and "-->" not in trimmed:
            html_comment = True
            continue
        html_start = re.match(r"<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>", trimmed)
        if (
            html_start
            and not trimmed.startswith("</")
            and not trimmed.endswith("/>")
            and not re.search(rf"</{re.escape(html_start.group(1))}\s*>", trimmed, re.IGNORECASE)
        ):
            html_tag = html_start.group(1)
    return scanned


def _criterion(kind: str, source: str, text: str, context: list[str] | None = None) -> dict:
    normalized = {
        "kind": kind,
        "source": portable_ref(source, "Acceptance source"),
        "context": [_normalize_acceptance_text(item) for item in (context or [])],
        "text": _normalize_acceptance_text(text),
    }
    if not normalized["text"]:
        raise NativeEvidenceError("Acceptance criterion text is empty")
    return {
        "id": f"acceptance-{canonical_hash('comet.native.acceptance.v1', normalized)}",
        **normalized,
    }


def _brief_acceptance(markdown: str, source: str) -> list[dict]:
    lines = _scanned_markdown(markdown)
    starts = [
        index
        for index, (line, body) in enumerate(lines)
        if body
        and (candidate := _heading(line)) is not None
        and candidate[0] == 1
        and candidate[1].lower() == "acceptance examples"
    ]
    if not starts:
        return []
    if len(starts) != 1:
        raise NativeEvidenceError("Brief must contain exactly one Acceptance examples section")
    start = starts[0] + 1
    end = len(lines)
    for index in range(start, len(lines)):
        heading = _heading(lines[index][0]) if lines[index][1] else None
        if heading and heading[0] == 1:
            end = index
            break
    section = lines[start:end]
    indents = [
        len(match.group(1))
        for line, body in section
        if body and (match := re.match(r"^( {0,3})[-*+][ \t]+", line))
    ]
    if not indents:
        return []
    top = min(indents)
    items: list[list[str]] = []
    active: list[str] | None = None
    for line, body in section:
        match = re.match(r"^( {0,3})[-*+][ \t]+(.*)$", line) if body else None
        if match and len(match.group(1)) == top:
            if active is not None:
                items.append(active)
            active = [match.group(2)]
        elif active is not None:
            active.append(line)
    if active is not None:
        items.append(active)
    return [_criterion("brief-example", source, "\n".join(item)) for item in items]


def _spec_acceptance(markdown: str, source: str) -> list[dict]:
    criteria: list[dict] = []
    ancestry: list[tuple[int, str]] = []
    active: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal active
        if active is not None:
            criteria.append(
                _criterion(
                    "spec-scenario",
                    source,
                    "\n".join([active["title"], *active["body"]]),
                    active["context"],
                )
            )
            active = None

    for line, body in _scanned_markdown(markdown):
        heading = _heading(line) if body else None
        scenario = (
            re.match(r"^Scenario\s*:\s*(.*)$", heading[1], re.IGNORECASE) if heading else None
        )
        if scenario:
            flush()
            while ancestry and ancestry[-1][0] >= heading[0]:
                ancestry.pop()
            title = _normalize_acceptance_text(scenario.group(1))
            if not title:
                raise NativeEvidenceError("Scenario title is empty")
            active = {
                "level": heading[0],
                "title": title,
                "body": [],
                "context": [item[1] for item in ancestry],
            }
            continue
        if heading:
            if active is not None and heading[0] <= active["level"]:
                flush()
            while ancestry and ancestry[-1][0] >= heading[0]:
                ancestry.pop()
            ancestry.append((heading[0], _normalize_acceptance_text(heading[1])))
        elif active is not None:
            active["body"].append(line)
    flush()
    return criteria


def build_contract_from_change(change_root: Path, state: dict[str, Any]) -> dict[str, Any]:
    brief_ref = portable_ref(state.get("brief"), "Native brief ref")
    brief_path = contained_file(change_root, brief_ref, "Native brief")
    brief_markdown = brief_path.read_text(encoding="utf-8")
    raw_specs = state.get("spec_changes")
    if not isinstance(raw_specs, list) or not raw_specs or len(raw_specs) > 64:
        raise NativeEvidenceError("Native spec_changes are missing or exceed their budget")
    specs: list[dict[str, Any]] = []
    acceptance = _brief_acceptance(brief_markdown, brief_ref)
    seen_capabilities: set[str] = set()
    seen_sources = {brief_ref}
    for index, raw in enumerate(raw_specs):
        spec = _record(raw, f"Native spec change {index}")
        _exact_keys(
            spec,
            ["capability", "operation", "source", "base_hash"],
            label=f"Native spec change {index}",
        )
        capability = spec["capability"]
        operation = spec["operation"]
        if not isinstance(capability, str) or not CHANGE_NAME_PATTERN.fullmatch(capability):
            raise NativeEvidenceError(f"Native spec change {index} capability is invalid")
        if capability in seen_capabilities:
            raise NativeEvidenceError("Native contract has duplicate capabilities")
        seen_capabilities.add(capability)
        if operation == "remove":
            if spec["source"] is not None:
                raise NativeEvidenceError("Remove spec cannot have a source")
            base_hash = _hash(spec["base_hash"], "Remove spec base hash")
            specs.append(
                {
                    "capability": capability,
                    "operation": operation,
                    "source": None,
                    "baseHash": base_hash,
                    "contentHash": None,
                }
            )
            continue
        if operation not in {"create", "replace"}:
            raise NativeEvidenceError(f"Native spec change {index} operation is invalid")
        source = portable_ref(spec["source"], f"Native spec change {index} source")
        if source in seen_sources:
            raise NativeEvidenceError("Native contract has duplicate artifact sources")
        seen_sources.add(source)
        markdown = contained_file(change_root, source, "Native target spec").read_text(
            encoding="utf-8"
        )
        base_hash = None if operation == "create" else _hash(spec["base_hash"], "Replace base hash")
        if operation == "create" and spec["base_hash"] is not None:
            raise NativeEvidenceError("Create spec must have a null base hash")
        specs.append(
            {
                "capability": capability,
                "operation": operation,
                "source": source,
                "baseHash": base_hash,
                "contentHash": canonical_hash(
                    "comet.native.contract-content.v1",
                    markdown.replace("\r\n", "\n").replace("\r", "\n"),
                ),
            }
        )
        acceptance.extend(_spec_acceptance(markdown, source))
    acceptance.sort(key=lambda item: item["id"])
    if not acceptance or len(acceptance) > 1024:
        raise NativeEvidenceError("Native contract acceptance set is empty or over budget")
    ids = [item["id"] for item in acceptance]
    if len(ids) != len(set(ids)):
        raise NativeEvidenceError("Native contract has duplicate acceptance IDs")
    specs.sort(key=lambda item: item["capability"])
    acceptance_hash = canonical_hash("comet.native.acceptance-set.v1", acceptance)
    content = {
        "schema": "comet.native.contract.v1",
        "brief": {
            "source": brief_ref,
            "contentHash": canonical_hash(
                "comet.native.contract-content.v1",
                brief_markdown.replace("\r\n", "\n").replace("\r", "\n"),
            ),
        },
        "specs": specs,
        "acceptance": acceptance,
        "acceptanceHash": acceptance_hash,
    }
    return {**content, "contractHash": canonical_hash("comet.native.contract.v1", content)}


def _parse_snapshot_projection(value: Any, expected_hash: str) -> dict[str, Any]:
    projection = _record(value, "Native snapshot projection")
    _exact_keys(
        projection,
        ["schema", "origin", "complete", "limits", "entries", "omitted", "omittedCount"],
        ["omissionOverflow"],
        label="Native snapshot projection",
    )
    if projection["schema"] != "comet.native.content-snapshot-projection.v1":
        raise NativeEvidenceError("Native snapshot projection schema is invalid")
    if projection["origin"] not in {"change-created", "legacy-migration", "explicit"}:
        raise NativeEvidenceError("Native snapshot projection origin is invalid")
    if not isinstance(projection["complete"], bool):
        raise NativeEvidenceError("Native snapshot projection completeness is invalid")
    limits = _record(projection["limits"], "Native snapshot limits")
    _exact_keys(
        limits,
        ["maxFiles", "maxFileBytes", "maxTotalBytes", "maxManifestBytes"],
        label="Native snapshot limits",
    )
    for key, value in limits.items():
        _positive_int(value, f"Native snapshot {key}")
    entries = projection["entries"]
    omitted = projection["omitted"]
    if not isinstance(entries, list) or not isinstance(omitted, list):
        raise NativeEvidenceError("Native snapshot entries/omissions are invalid")
    parsed_entries = []
    for index, raw in enumerate(entries):
        entry = _record(raw, f"Native snapshot entry {index}")
        _exact_keys(entry, ["path", "hash", "size", "type"], label=f"Native snapshot entry {index}")
        parsed_entries.append(
            {
                "path": portable_ref(entry["path"], f"Native snapshot entry {index} path"),
                "hash": _hash(entry["hash"], f"Native snapshot entry {index} hash"),
                "size": _nonnegative_int(entry["size"], f"Native snapshot entry {index} size"),
                "type": entry["type"],
            }
        )
        if entry["type"] != "file":
            raise NativeEvidenceError(f"Native snapshot entry {index} type is invalid")
    if len({entry["path"] for entry in parsed_entries}) != len(parsed_entries):
        raise NativeEvidenceError("Native snapshot has duplicate paths")
    if parsed_entries != sorted(
        parsed_entries,
        key=lambda item: (item["path"], item["hash"], item["size"]),
    ):
        raise NativeEvidenceError("Native snapshot entries are not canonical")
    if len(parsed_entries) > limits["maxFiles"] or any(
        entry["size"] > limits["maxFileBytes"] for entry in parsed_entries
    ):
        raise NativeEvidenceError("Native snapshot entries exceed their limits")
    if sum(entry["size"] for entry in parsed_entries) > limits["maxTotalBytes"]:
        raise NativeEvidenceError("Native snapshot entries exceed their total byte limit")

    omission_types = {"file", "directory", "other"}
    omission_reasons = {
        "file-size",
        "file-count",
        "total-size",
        "manifest-size",
        "changed-during-read",
        "unreadable",
    }
    parsed_omitted = []
    for index, raw in enumerate(omitted):
        omission = _record(raw, f"Native snapshot omission {index}")
        _exact_keys(
            omission,
            ["path", "size", "type", "reason"],
            label=f"Native snapshot omission {index}",
        )
        if omission["type"] not in omission_types:
            raise NativeEvidenceError(f"Native snapshot omission {index} type is invalid")
        if omission["reason"] not in omission_reasons:
            raise NativeEvidenceError(f"Native snapshot omission {index} reason is invalid")
        parsed_omitted.append(
            {
                "path": portable_ref(omission["path"], f"Native snapshot omission {index} path"),
                "size": (
                    None
                    if omission["size"] is None
                    else _nonnegative_int(
                        omission["size"], f"Native snapshot omission {index} size"
                    )
                ),
                "type": omission["type"],
                "reason": omission["reason"],
            }
        )
    if parsed_omitted != sorted(
        parsed_omitted,
        key=lambda item: (
            item["path"],
            item["reason"],
            item["type"],
            -1 if item["size"] is None else item["size"],
        ),
    ):
        raise NativeEvidenceError("Native snapshot omissions are not canonical")
    omitted_count = _nonnegative_int(projection["omittedCount"], "Native omitted count")
    if len(parsed_omitted) > 1000 or omitted_count < len(parsed_omitted):
        raise NativeEvidenceError("Native snapshot omission count is invalid")
    overflow_count = omitted_count - len(parsed_omitted)
    overflow = projection.get("omissionOverflow")
    if overflow is not None:
        overflow = _record(overflow, "Native snapshot omission overflow")
        _exact_keys(
            overflow,
            ["ref", "hash", "count"],
            label="Native snapshot omission overflow",
        )
        overflow_hash = _hash(overflow["hash"], "Native snapshot omission overflow hash")
        if (
            overflow["ref"] != f"native-snapshot://omitted-overflow/{overflow_hash}"
            or _positive_int(overflow["count"], "Native snapshot omission overflow count")
            != overflow_count
        ):
            raise NativeEvidenceError("Native snapshot omission overflow is inconsistent")
    if (
        (overflow_count == 0 and overflow is not None)
        or (overflow_count > 0 and overflow is None)
        or projection["complete"] != (omitted_count == 0)
    ):
        raise NativeEvidenceError("Native snapshot omission state is inconsistent")
    if canonical_hash("comet.native.content-snapshot-projection.v1", projection) != expected_hash:
        raise NativeEvidenceError("Native snapshot projection content hash mismatch")
    return projection


def _parse_declared_artifact(value: Any, label: str) -> dict[str, str]:
    artifact = _record(value, label)
    _exact_keys(artifact, ["path", "kind"], label=label)
    if artifact["kind"] not in {"file", "directory"}:
        raise NativeEvidenceError(f"{label} kind is invalid")
    return {"path": portable_ref(artifact["path"], f"{label} path"), "kind": artifact["kind"]}


def _parse_identity(value: Any, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    identity = _record(value, label)
    _exact_keys(identity, ["hash", "size"], label=label)
    return {
        "hash": _hash(identity["hash"], f"{label} hash"),
        "size": _nonnegative_int(identity["size"], f"{label} size"),
    }


def _snapshot_changes(baseline: dict, current: dict) -> list[dict[str, Any]]:
    before = {
        entry["path"]: {"hash": entry["hash"], "size": entry["size"]}
        for entry in baseline["entries"]
    }
    after = {
        entry["path"]: {"hash": entry["hash"], "size": entry["size"]}
        for entry in current["entries"]
    }
    result = []
    for path in sorted(set(before) | set(after)):
        if before.get(path) == after.get(path):
            continue
        result.append(
            {
                "path": path,
                "kind": "added"
                if path not in before
                else "removed"
                if path not in after
                else "modified",
                "before": before.get(path),
                "after": after.get(path),
            }
        )
    return result


def _artifact_covers(artifact: dict[str, str], path: str) -> bool:
    return artifact["path"] == path or (
        artifact["kind"] == "directory" and path.startswith(f"{artifact['path']}/")
    )


def _derived_unresolved_scope(identity: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "id": ("scope:" + canonical_hash("comet.native.unresolved-scope-id.v1", identity)),
        "kind": identity["kind"],
        "source": identity["source"],
        "path": identity["path"],
        "reason": reason,
    }


def _snapshot_omission_scopes(source: str, projection: dict[str, Any]) -> list[dict[str, Any]]:
    scopes = [
        _derived_unresolved_scope(
            {
                "kind": "snapshot-omission",
                "source": source,
                "path": omission["path"],
                "evidence": {
                    "reason": omission["reason"],
                    "size": omission["size"],
                    "type": omission["type"],
                },
            },
            f"{source} snapshot omitted {omission['path']}: {omission['reason']}",
        )
        for omission in projection["omitted"]
    ]
    if not projection["complete"]:
        scopes.append(
            _derived_unresolved_scope(
                {
                    "kind": "snapshot-incomplete",
                    "source": source,
                    "path": None,
                    "evidence": {"omittedCount": projection["omittedCount"]},
                },
                f"{source} snapshot is incomplete",
            )
        )
    overflow = projection.get("omissionOverflow")
    if overflow is not None:
        scopes.append(
            _derived_unresolved_scope(
                {
                    "kind": "snapshot-omission-overflow",
                    "source": source,
                    "path": None,
                    "evidence": {
                        "count": overflow["count"],
                        "hash": overflow["hash"],
                        "ref": overflow["ref"],
                    },
                },
                f"{source} snapshot has {overflow['count']} unlisted omissions",
            )
        )
    return scopes


def _unresolved_sort_key(item: dict[str, Any]) -> tuple[str, str, tuple[int, str], str]:
    path = item["path"]
    return (
        item["kind"],
        item["source"],
        (0, "") if path is None else (1, path),
        item["id"],
    )


def parse_scope_bundle(
    change_root: Path,
    scope_ref: Any,
    *,
    project_root: Path | None = None,
) -> dict[str, Any]:
    reference = portable_ref(scope_ref, "Implementation scope ref")
    match = re.fullmatch(r"runtime/evidence/scopes/([a-f0-9]{64})\.json", reference)
    if not match:
        raise NativeEvidenceError("Implementation scope ref is not content addressed")
    expected_hash = match.group(1)
    scope = _record(
        read_contained_json(change_root, reference, "Implementation scope"), "Implementation scope"
    )
    _exact_keys(
        scope,
        [
            "schema",
            "contractHash",
            "baselineProjectionRef",
            "baselineProjectionHash",
            "currentProjectionRef",
            "currentProjectionHash",
            "complete",
            "declaredArtifacts",
            "changes",
            "unattributed",
            "unresolvedScopes",
            "noCodeReason",
            "scopeHash",
        ],
        ["gitAdvisory"],
        label="Implementation scope",
    )
    if scope["schema"] != "comet.native.implementation-scope.v2":
        raise NativeEvidenceError("Implementation scope schema is invalid")
    if scope.get("gitAdvisory") is not None:
        advisory = _record(scope["gitAdvisory"], "Implementation scope Git advisory")
        _exact_keys(
            advisory,
            [
                "advisoryOnly",
                "changedPaths",
                "pathsPresentInSnapshotChanges",
                "pathsAbsentFromSnapshotChanges",
            ],
            label="Implementation scope Git advisory",
        )
        if advisory["advisoryOnly"] is not True:
            raise NativeEvidenceError("Implementation scope Git advisory is not advisory-only")
    contract_hash = _hash(scope["contractHash"], "Implementation scope contract hash")
    baseline_hash = _hash(scope["baselineProjectionHash"], "Baseline projection hash")
    current_hash = _hash(scope["currentProjectionHash"], "Current projection hash")
    expected_baseline_ref = f"runtime/evidence/snapshots/{baseline_hash}.json"
    expected_current_ref = f"runtime/evidence/snapshots/{current_hash}.json"
    if (
        scope["baselineProjectionRef"] != expected_baseline_ref
        or scope["currentProjectionRef"] != expected_current_ref
    ):
        raise NativeEvidenceError("Implementation scope snapshot ref/hash binding is invalid")
    baseline = _parse_snapshot_projection(
        read_contained_json(change_root, expected_baseline_ref, "Baseline projection"),
        baseline_hash,
    )
    current = _parse_snapshot_projection(
        read_contained_json(change_root, expected_current_ref, "Current projection"), current_hash
    )
    if not isinstance(scope["complete"], bool):
        raise NativeEvidenceError("Implementation scope completeness is invalid")
    if not all(
        isinstance(scope[key], list)
        for key in ("declaredArtifacts", "changes", "unattributed", "unresolvedScopes")
    ):
        raise NativeEvidenceError("Implementation scope collections are invalid")
    declared = [
        _parse_declared_artifact(item, f"Declared artifact {index}")
        for index, item in enumerate(scope["declaredArtifacts"])
    ]
    if declared != sorted(declared, key=lambda item: (item["path"], item["kind"])) or len(
        {item["path"] for item in declared}
    ) != len(declared):
        raise NativeEvidenceError("Declared artifacts are not sorted and unique")
    expected_changes = _snapshot_changes(baseline, current)
    parsed_changes = []
    for index, raw in enumerate(scope["changes"]):
        change = _record(raw, f"Implementation change {index}")
        _exact_keys(
            change,
            ["path", "kind", "before", "after", "attributedTo"],
            label=f"Implementation change {index}",
        )
        path = portable_ref(change["path"], f"Implementation change {index} path")
        if not isinstance(change["attributedTo"], list):
            raise NativeEvidenceError(f"Implementation change {index} attribution must be an array")
        attributed = [
            _parse_declared_artifact(
                item, f"Implementation change {index} attribution {item_index}"
            )
            for item_index, item in enumerate(change["attributedTo"])
        ]
        expected_attribution = [item for item in declared if _artifact_covers(item, path)]
        parsed_changes.append(
            {
                "path": path,
                "kind": change["kind"],
                "before": _parse_identity(
                    change["before"], f"Implementation change {index} before"
                ),
                "after": _parse_identity(change["after"], f"Implementation change {index} after"),
                "attributedTo": attributed,
            }
        )
        if attributed != expected_attribution:
            raise NativeEvidenceError(f"Implementation change {path} attribution is forged")
    expected_with_attribution = [
        {
            **item,
            "attributedTo": [
                artifact for artifact in declared if _artifact_covers(artifact, item["path"])
            ],
        }
        for item in expected_changes
    ]
    if parsed_changes != expected_with_attribution:
        raise NativeEvidenceError("Implementation scope changes do not match its snapshots")
    expected_unattributed = [item for item in parsed_changes if not item["attributedTo"]]
    if scope["unattributed"] != expected_unattributed:
        raise NativeEvidenceError("Implementation scope unattributed changes are inconsistent")
    no_code_reason = scope["noCodeReason"]
    if no_code_reason is not None and (
        not isinstance(no_code_reason, str)
        or not no_code_reason
        or no_code_reason != no_code_reason.strip()
    ):
        raise NativeEvidenceError("Implementation scope no-code reason is invalid")

    unresolved_kinds = {
        "unattributed-change",
        "snapshot-omission",
        "snapshot-incomplete",
        "snapshot-omission-overflow",
        "missing-no-code-reason",
    }
    unresolved_sources = {"baseline", "current", "implementation-scope"}
    parsed_unresolved = []
    for index, raw in enumerate(scope["unresolvedScopes"]):
        unresolved = _record(raw, f"Unresolved scope {index}")
        _exact_keys(
            unresolved,
            ["id", "kind", "source", "path", "reason"],
            label=f"Unresolved scope {index}",
        )
        if not isinstance(unresolved["id"], str) or not SCOPE_ID_PATTERN.fullmatch(
            unresolved["id"]
        ):
            raise NativeEvidenceError(f"Unresolved scope {index} id is invalid")
        if unresolved["kind"] not in unresolved_kinds:
            raise NativeEvidenceError(f"Unresolved scope {index} kind is invalid")
        if unresolved["source"] not in unresolved_sources:
            raise NativeEvidenceError(f"Unresolved scope {index} source is invalid")
        path = unresolved["path"]
        if path is not None:
            path = portable_ref(path, f"Unresolved scope {index} path")
        reason = unresolved["reason"]
        if not isinstance(reason, str) or not reason or reason != reason.strip():
            raise NativeEvidenceError(f"Unresolved scope {index} reason is invalid")
        parsed_unresolved.append(
            {
                "id": unresolved["id"],
                "kind": unresolved["kind"],
                "source": unresolved["source"],
                "path": path,
                "reason": reason,
            }
        )

    expected_unresolved = [
        *(
            _derived_unresolved_scope(
                {
                    "kind": "unattributed-change",
                    "source": "implementation-scope",
                    "path": change["path"],
                    "evidence": {
                        "after": change["after"],
                        "before": change["before"],
                        "changeKind": change["kind"],
                    },
                },
                f"Changed path is not covered by a declared artifact: {change['path']}",
            )
            for change in expected_unattributed
        ),
        *_snapshot_omission_scopes("baseline", baseline),
        *_snapshot_omission_scopes("current", current),
    ]
    if not parsed_changes and no_code_reason is None:
        expected_unresolved.append(
            _derived_unresolved_scope(
                {
                    "kind": "missing-no-code-reason",
                    "source": "implementation-scope",
                    "path": None,
                    "evidence": {
                        "baselineProjectionHash": baseline_hash,
                        "currentProjectionHash": current_hash,
                    },
                },
                "A non-empty no-code reason is required when the snapshots contain no changes",
            )
        )
    expected_unresolved = sorted(
        {item["id"]: item for item in expected_unresolved}.values(),
        key=_unresolved_sort_key,
    )
    unresolved_ids = [item["id"] for item in parsed_unresolved]
    if (
        len(unresolved_ids) != len(set(unresolved_ids))
        or parsed_unresolved != sorted(parsed_unresolved, key=_unresolved_sort_key)
        or parsed_unresolved != expected_unresolved
    ):
        raise NativeEvidenceError(
            "Implementation scope unresolved entries do not match the Runtime-derived scope"
        )
    if scope["complete"] != (len(parsed_unresolved) == 0):
        raise NativeEvidenceError("Implementation scope completeness is inconsistent")
    content = {key: value for key, value in scope.items() if key != "scopeHash"}
    scope_hash = _hash(scope["scopeHash"], "Implementation scope hash")
    if (
        scope_hash != expected_hash
        or canonical_hash("comet.native.implementation-scope.v2", content) != scope_hash
    ):
        raise NativeEvidenceError("Implementation scope filename/content hash mismatch")
    if project_root is not None:
        for entry in current["entries"]:
            target = contained_file(project_root, entry["path"], "Current snapshot project entry")
            if target.stat().st_size != entry["size"] or sha256_file(target) != entry["hash"]:
                raise NativeEvidenceError(
                    f"Current snapshot project entry drifted: {entry['path']}"
                )
    return {"scope": scope, "baseline": baseline, "current": current, "contractHash": contract_hash}


def parse_partial_allowance(
    change_root: Path,
    allowance_ref: Any,
    *,
    expected_change: str,
) -> dict[str, Any]:
    reference = portable_ref(allowance_ref, "Partial allowance ref")
    match = re.fullmatch(r"runtime/evidence/allowances/([a-f0-9]{64})\.json", reference)
    if not match:
        raise NativeEvidenceError("Partial allowance ref is not content addressed")
    allowance = _record(
        read_contained_json(change_root, reference, "Partial allowance"), "Partial allowance"
    )
    _exact_keys(
        allowance,
        [
            "schema",
            "change",
            "scopeHash",
            "scopeIds",
            "reason",
            "confirmedSummary",
            "sourceRevision",
            "confirmedAt",
            "allowanceHash",
        ],
        label="Partial allowance",
    )
    if (
        allowance["schema"] != "comet.native.partial-allowance.v1"
        or allowance["change"] != expected_change
    ):
        raise NativeEvidenceError("Partial allowance schema/change binding is invalid")
    scope_hash = _hash(allowance["scopeHash"], "Partial allowance scope hash")
    scope_ids = allowance["scopeIds"]
    if (
        not isinstance(scope_ids, list)
        or not scope_ids
        or any(
            not isinstance(item, str) or not SCOPE_ID_PATTERN.fullmatch(item) for item in scope_ids
        )
        or scope_ids != sorted(set(scope_ids))
    ):
        raise NativeEvidenceError("Partial allowance scope IDs are invalid")
    for key in ("reason", "confirmedSummary"):
        if (
            not isinstance(allowance[key], str)
            or not allowance[key]
            or allowance[key] != allowance[key].strip()
        ):
            raise NativeEvidenceError(f"Partial allowance {key} is invalid")
    _positive_int(allowance["sourceRevision"], "Partial allowance source revision")
    _timestamp(allowance["confirmedAt"], "Partial allowance timestamp")
    content = {key: value for key, value in allowance.items() if key != "allowanceHash"}
    allowance_hash = _hash(allowance["allowanceHash"], "Partial allowance hash")
    if (
        allowance_hash != match.group(1)
        or canonical_hash("comet.native.partial-allowance.v1", content) != allowance_hash
    ):
        raise NativeEvidenceError("Partial allowance filename/content hash mismatch")
    scope_bundle = parse_scope_bundle(change_root, f"runtime/evidence/scopes/{scope_hash}.json")
    scope = scope_bundle["scope"]
    expected_ids = sorted(item["id"] for item in scope["unresolvedScopes"])
    if scope["complete"] or scope_ids != expected_ids:
        raise NativeEvidenceError("Partial allowance does not bind the unresolved scope")
    return allowance


def _parse_acceptance_trace(
    value: Any,
    *,
    contract: dict[str, Any],
    project_root: Path,
) -> dict[str, Any]:
    trace = _record(value, "Native acceptance trace")
    _exact_keys(
        trace,
        [
            "schema",
            "nativeRootRef",
            "criteriaHash",
            "total",
            "evidenced",
            "skipped",
            "entries",
            "traceHash",
        ],
        label="Native acceptance trace",
    )
    if trace["schema"] != "comet.native.acceptance-trace.v1":
        raise NativeEvidenceError("Native acceptance trace schema is invalid")
    native_root_ref = portable_ref(trace["nativeRootRef"], "Native root ref")
    criteria_hash = _hash(trace["criteriaHash"], "Acceptance criteria hash")
    if criteria_hash != contract["acceptanceHash"]:
        raise NativeEvidenceError("Acceptance trace is not bound to the contract")
    entries = trace["entries"]
    if not isinstance(entries, list):
        raise NativeEvidenceError("Acceptance trace entries are invalid")
    expected_by_id = {item["id"]: item for item in contract["acceptance"]}
    parsed = []
    for index, raw in enumerate(entries):
        entry = _record(raw, f"Acceptance trace entry {index}")
        _exact_keys(
            entry,
            ["acceptanceId", "kind", "source", "evidenceRefs", "skippedReason"],
            label=f"Acceptance trace entry {index}",
        )
        acceptance_id = entry["acceptanceId"]
        if not isinstance(acceptance_id, str) or not ACCEPTANCE_ID_PATTERN.fullmatch(acceptance_id):
            raise NativeEvidenceError(f"Acceptance trace entry {index} has a forged ID")
        criterion = expected_by_id.get(acceptance_id)
        if (
            criterion is None
            or entry["kind"] != criterion["kind"]
            or entry["source"] != criterion["source"]
        ):
            raise NativeEvidenceError(f"Acceptance trace entry {index} is not in the contract")
        refs = entry["evidenceRefs"]
        if (
            not isinstance(refs, list)
            or any(not isinstance(ref, str) for ref in refs)
            or refs != sorted(set(refs))
        ):
            raise NativeEvidenceError(f"Acceptance trace entry {index} refs are not canonical")
        skipped = entry["skippedReason"]
        if (not refs) == (skipped is None):
            raise NativeEvidenceError(f"Acceptance trace entry {index} evidence state is invalid")
        if skipped is not None and (
            not isinstance(skipped, str) or not skipped or skipped != skipped.strip()
        ):
            raise NativeEvidenceError(f"Acceptance trace entry {index} skipped reason is invalid")
        for evidence_ref in refs:
            reference = portable_ref(evidence_ref, f"Acceptance evidence ref {acceptance_id}")
            lower = reference.lower()
            if (
                lower.startswith((".cache/", ".git/", ".env"))
                or lower == native_root_ref.lower()
                or lower.startswith(f"{native_root_ref.lower()}/")
            ):
                raise NativeEvidenceError(
                    f"Acceptance evidence ref is workflow/sensitive metadata: {reference}"
                )
            contained_file(project_root, reference, f"Acceptance evidence ref {acceptance_id}")
        parsed.append(entry)
    if parsed != sorted(parsed, key=lambda item: item["acceptanceId"]) or len(
        {item["acceptanceId"] for item in parsed}
    ) != len(parsed):
        raise NativeEvidenceError("Acceptance trace entries are not sorted and unique")
    if set(item["acceptanceId"] for item in parsed) != set(expected_by_id):
        raise NativeEvidenceError("Acceptance trace does not cover the exact contract")
    total = _nonnegative_int(trace["total"], "Acceptance trace total")
    evidenced = _nonnegative_int(trace["evidenced"], "Acceptance trace evidenced")
    skipped_count = _nonnegative_int(trace["skipped"], "Acceptance trace skipped")
    if (
        total != len(parsed)
        or evidenced != sum(bool(item["evidenceRefs"]) for item in parsed)
        or skipped_count != sum(item["skippedReason"] is not None for item in parsed)
    ):
        raise NativeEvidenceError("Acceptance trace counts are inconsistent")
    content = {key: value for key, value in trace.items() if key != "traceHash"}
    trace_hash = _hash(trace["traceHash"], "Acceptance trace hash")
    if canonical_hash("comet.native.acceptance-trace.v1", content) != trace_hash:
        raise NativeEvidenceError("Acceptance trace content hash mismatch")
    return trace


def _parse_check_receipt(
    *,
    change_root: Path,
    receipt_ref: Any,
    expected_change: str,
    expected_source_revision: int,
    expected_result: str,
    expected_contract_hash: str,
    scope: dict[str, Any],
) -> dict[str, Any]:
    reference = portable_ref(receipt_ref, "Verification receipt ref")
    match = re.fullmatch(r"runtime/evidence/check-receipts/([a-f0-9]{64})\.json", reference)
    if not match:
        raise NativeEvidenceError("Verification receipt ref is invalid")
    receipt_file = contained_file(change_root, reference, "Verification receipt")
    if receipt_file.stat().st_size > 512 * 1024:
        raise NativeEvidenceError("Native check receipt exceeds its byte budget")
    try:
        receipt = _record(
            json.loads(receipt_file.read_text(encoding="utf-8")),
            "Native check receipt",
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise NativeEvidenceError(f"Native check receipt is invalid JSON: {error}") from error
    _exact_keys(
        receipt,
        [
            "schema",
            "change",
            "sourceRevision",
            "checker",
            "inputHash",
            "status",
            "startedAt",
            "endedAt",
            "contract",
            "implementation",
            "counts",
            "issues",
            "issuesTruncated",
            "stale",
            "staleReasons",
            "receiptHash",
        ],
        label="Native check receipt",
    )
    change = receipt["change"]
    if (
        receipt["schema"] != "comet.native.check-receipt.v1"
        or not isinstance(change, str)
        or len(change.encode("utf-8")) > 128
        or not CHANGE_NAME_PATTERN.fullmatch(change)
    ):
        raise NativeEvidenceError("Native check receipt schema/change is invalid")
    source_revision = _positive_int(
        receipt["sourceRevision"], "Native check receipt source revision"
    )

    checker = _record(receipt["checker"], "Native check receipt checker")
    _exact_keys(
        checker,
        ["policy", "version", "hash", "limits"],
        label="Native check receipt checker",
    )
    limits = _record(checker["limits"], "Native check receipt limits")
    _exact_keys(
        limits,
        ["maxFiles", "maxFileBytes", "maxTotalBytes", "maxIssues"],
        label="Native check receipt limits",
    )
    if (
        checker["policy"] != "scoped-text-safety"
        or isinstance(checker["version"], bool)
        or not isinstance(checker["version"], int)
        or checker["version"] != 1
        or checker["hash"] != NATIVE_CHECKER_HASH
        or any(
            isinstance(limits[key], bool) or not isinstance(limits[key], int)
            for key in NATIVE_CHECK_LIMITS
        )
        or limits != NATIVE_CHECK_LIMITS
    ):
        raise NativeEvidenceError("Native check receipt checker policy is unsupported")

    contract = _record(receipt["contract"], "Native check receipt contract")
    _exact_keys(
        contract,
        ["expectedHash", "beforeHash", "afterHash"],
        label="Native check receipt contract",
    )
    parsed_contract = {
        "expectedHash": _hash(
            contract["expectedHash"], "Native check receipt expected contract hash"
        ),
        "beforeHash": _hash(contract["beforeHash"], "Native check receipt before contract hash"),
        "afterHash": _hash(contract["afterHash"], "Native check receipt after contract hash"),
    }
    implementation = _record(receipt["implementation"], "Native check receipt implementation")
    _exact_keys(
        implementation,
        [
            "scopeHash",
            "expectedSnapshotHash",
            "beforeSnapshotHash",
            "afterSnapshotHash",
        ],
        label="Native check receipt implementation",
    )
    parsed_implementation = {
        "scopeHash": _hash(implementation["scopeHash"], "Native check receipt scope hash"),
        "expectedSnapshotHash": _hash(
            implementation["expectedSnapshotHash"],
            "Native check receipt expected snapshot hash",
        ),
        "beforeSnapshotHash": _hash(
            implementation["beforeSnapshotHash"],
            "Native check receipt before snapshot hash",
        ),
        "afterSnapshotHash": _hash(
            implementation["afterSnapshotHash"],
            "Native check receipt after snapshot hash",
        ),
    }
    expected_input_hash = canonical_hash(
        "comet.native.check-input.v1",
        {
            "change": change,
            "sourceRevision": source_revision,
            "checkerHash": checker["hash"],
            "contractHash": parsed_contract["expectedHash"],
            "scopeHash": parsed_implementation["scopeHash"],
            "snapshotHash": parsed_implementation["expectedSnapshotHash"],
        },
    )
    if _hash(receipt["inputHash"], "Native check receipt input hash") != expected_input_hash:
        raise NativeEvidenceError("Native check receipt input hash mismatch")
    if receipt["status"] not in {"passed", "failed"}:
        raise NativeEvidenceError("Native check receipt status is invalid")
    started_at = _timestamp(receipt["startedAt"], "Native check receipt startedAt")
    ended_at = _timestamp(receipt["endedAt"], "Native check receipt endedAt")
    if ended_at < started_at:
        raise NativeEvidenceError("Native check receipt endedAt precedes startedAt")

    counts = _record(receipt["counts"], "Native check receipt counts")
    _exact_keys(
        counts,
        [
            "filesSelected",
            "filesScanned",
            "binaryFilesSkipped",
            "bytesScanned",
            "issueCount",
            "recordedIssueCount",
        ],
        label="Native check receipt counts",
    )
    parsed_counts = {
        key: _nonnegative_int(value, f"Native check receipt {key}") for key, value in counts.items()
    }
    if (
        parsed_counts["filesScanned"] + parsed_counts["binaryFilesSkipped"]
        > parsed_counts["filesSelected"]
        or parsed_counts["filesScanned"] + parsed_counts["binaryFilesSkipped"]
        > NATIVE_CHECK_LIMITS["maxFiles"]
        or parsed_counts["bytesScanned"] > NATIVE_CHECK_LIMITS["maxTotalBytes"]
        or parsed_counts["recordedIssueCount"] > parsed_counts["issueCount"]
        or parsed_counts["recordedIssueCount"] > NATIVE_CHECK_LIMITS["maxIssues"]
    ):
        raise NativeEvidenceError("Native check receipt count accounting is invalid")

    raw_issues = receipt["issues"]
    if not isinstance(raw_issues, list) or len(raw_issues) > NATIVE_CHECK_LIMITS["maxIssues"]:
        raise NativeEvidenceError("Native check receipt issues are not a bounded array")
    issue_rank = {kind: index for index, kind in enumerate(NATIVE_CHECK_ISSUE_KINDS)}
    issues = []
    for index, raw in enumerate(raw_issues):
        issue = _record(raw, f"Native check receipt issue {index}")
        _exact_keys(
            issue,
            ["path", "line", "kind"],
            label=f"Native check receipt issue {index}",
        )
        path = portable_ref(issue["path"], f"Native check receipt issue {index} path")
        if len(path.encode("utf-8")) > 2048:
            raise NativeEvidenceError(f"Native check receipt issue {index} path is too long")
        if issue["kind"] not in issue_rank:
            raise NativeEvidenceError(f"Native check receipt issue {index} kind is invalid")
        issues.append(
            {
                "path": path,
                "line": _positive_int(issue["line"], f"Native check receipt issue {index} line"),
                "kind": issue["kind"],
            }
        )
    if issues != sorted(
        issues,
        key=lambda issue: (issue["path"], issue["line"], issue_rank[issue["kind"]]),
    ):
        raise NativeEvidenceError("Native check receipt issues are not canonical")
    if parsed_counts["recordedIssueCount"] != len(issues):
        raise NativeEvidenceError("Native check receipt recorded issue count is inconsistent")
    if not isinstance(receipt["issuesTruncated"], bool) or receipt["issuesTruncated"] != (
        parsed_counts["issueCount"] > len(issues)
    ):
        raise NativeEvidenceError("Native check receipt issue truncation is inconsistent")

    stale_reasons = receipt["staleReasons"]
    if (
        not isinstance(stale_reasons, list)
        or any(reason not in NATIVE_CHECK_STALE_REASONS for reason in stale_reasons)
        or len(stale_reasons) != len(set(stale_reasons))
        or stale_reasons
        != [reason for reason in NATIVE_CHECK_STALE_REASONS if reason in stale_reasons]
    ):
        raise NativeEvidenceError("Native check receipt stale reasons are not canonical")
    if not isinstance(receipt["stale"], bool) or receipt["stale"] != bool(stale_reasons):
        raise NativeEvidenceError("Native check receipt stale state is inconsistent")
    expected_status = (
        "passed" if parsed_counts["issueCount"] == 0 and not receipt["stale"] else "failed"
    )
    if receipt["status"] != expected_status:
        raise NativeEvidenceError("Native check receipt status is inconsistent")
    if receipt["status"] == "passed" and (
        parsed_counts["filesSelected"] > NATIVE_CHECK_LIMITS["maxFiles"]
        or parsed_counts["filesScanned"] + parsed_counts["binaryFilesSkipped"]
        != parsed_counts["filesSelected"]
    ):
        raise NativeEvidenceError("Native check receipt passed without full file coverage")
    if parsed_counts["filesSelected"] > NATIVE_CHECK_LIMITS["maxFiles"] and not any(
        issue["kind"] == "scan-limit" for issue in issues
    ):
        raise NativeEvidenceError("Native check receipt exceeded its budget without an issue")

    content = {
        "schema": "comet.native.check-receipt.v1",
        "change": change,
        "sourceRevision": source_revision,
        "checker": {
            "policy": "scoped-text-safety",
            "version": 1,
            "hash": NATIVE_CHECKER_HASH,
            "limits": dict(NATIVE_CHECK_LIMITS),
        },
        "inputHash": expected_input_hash,
        "status": receipt["status"],
        "startedAt": started_at,
        "endedAt": ended_at,
        "contract": parsed_contract,
        "implementation": parsed_implementation,
        "counts": parsed_counts,
        "issues": issues,
        "issuesTruncated": receipt["issuesTruncated"],
        "stale": receipt["stale"],
        "staleReasons": stale_reasons,
    }
    receipt_hash = _hash(receipt["receiptHash"], "Native check receipt content hash")
    if (
        receipt_hash != match.group(1)
        or canonical_hash("comet.native.check-receipt.v1", content) != receipt_hash
    ):
        raise NativeEvidenceError("Native check receipt filename/content hash mismatch")

    selected_files = [entry for entry in scope["changes"] if entry["after"] is not None]
    selected_bytes = sum(entry["after"]["size"] for entry in selected_files)
    if (
        receipt["stale"]
        or change != expected_change
        or source_revision != expected_source_revision
        or set(parsed_contract.values()) != {expected_contract_hash}
        or parsed_implementation["scopeHash"] != scope["scopeHash"]
        or set(
            (
                parsed_implementation["expectedSnapshotHash"],
                parsed_implementation["beforeSnapshotHash"],
                parsed_implementation["afterSnapshotHash"],
            )
        )
        != {scope["currentProjectionHash"]}
        or parsed_counts["filesSelected"] != len(selected_files)
        or (
            receipt["status"] == "passed"
            and (
                parsed_counts["filesScanned"] + parsed_counts["binaryFilesSkipped"]
                != len(selected_files)
                or parsed_counts["bytesScanned"] != selected_bytes
            )
        )
    ):
        raise NativeEvidenceError("Native check receipt is not bound to the verification facts")
    if expected_result == "pass" and receipt["status"] != "passed":
        raise NativeEvidenceError("Native check receipt outcome does not support a pass")
    return {**content, "receiptHash": receipt_hash}


def parse_verification_bundle(
    *,
    project_root: Path,
    change_root: Path,
    evidence_ref: Any,
    state: dict[str, Any],
    expected_result: str | None = None,
    expected_freshness: str | None = None,
    verify_current_files: bool = False,
) -> dict[str, Any]:
    change = state.get("name")
    if not isinstance(change, str) or not CHANGE_NAME_PATTERN.fullmatch(change):
        raise NativeEvidenceError("Native change name is invalid")
    reference = portable_ref(evidence_ref, "Verification evidence ref")
    match = re.fullmatch(r"runtime/evidence/verifications/([a-f0-9]{64})\.json", reference)
    if not match:
        raise NativeEvidenceError("Verification evidence ref is not content addressed")
    envelope = _record(
        read_contained_json(change_root, reference, "Verification envelope"),
        "Verification envelope",
    )
    _exact_keys(
        envelope,
        [
            "schema",
            "change",
            "sourceRevision",
            "result",
            "freshness",
            "contractHash",
            "acceptanceCriteriaHash",
            "implementationScopeRef",
            "implementationScopeHash",
            "reportRef",
            "reportHash",
            "acceptanceTrace",
            "partialAllowanceRef",
            "partialAllowanceHash",
            "receiptRef",
            "createdAt",
            "envelopeHash",
        ],
        label="Verification envelope",
    )
    if (
        envelope["schema"] != "comet.native.verification-evidence.v1"
        or envelope["change"] != change
    ):
        raise NativeEvidenceError("Verification envelope schema/change binding is invalid")
    _positive_int(envelope["sourceRevision"], "Verification source revision")
    if envelope["result"] not in {"pass", "fail"} or envelope["freshness"] not in {
        "complete",
        "partial",
    }:
        raise NativeEvidenceError("Verification result/freshness is invalid")
    if expected_result is not None and envelope["result"] != expected_result:
        raise NativeEvidenceError("Verification envelope has the wrong result")
    if expected_freshness is not None and envelope["freshness"] != expected_freshness:
        raise NativeEvidenceError("Verification envelope has the wrong freshness")
    contract = build_contract_from_change(change_root, state)
    contract_hash = _hash(envelope["contractHash"], "Verification contract hash")
    acceptance_hash = _hash(envelope["acceptanceCriteriaHash"], "Verification acceptance hash")
    if contract_hash != contract["contractHash"] or acceptance_hash != contract["acceptanceHash"]:
        raise NativeEvidenceError("Verification envelope is not bound to the archived contract")
    scope_bundle = parse_scope_bundle(
        change_root,
        envelope["implementationScopeRef"],
        project_root=project_root if verify_current_files else None,
    )
    scope = scope_bundle["scope"]
    if (
        envelope["implementationScopeHash"] != scope["scopeHash"]
        or scope["contractHash"] != contract_hash
        or envelope["freshness"] != ("complete" if scope["complete"] else "partial")
    ):
        raise NativeEvidenceError("Verification envelope/scope binding is invalid")
    _parse_acceptance_trace(
        envelope["acceptanceTrace"], contract=contract, project_root=project_root
    )
    report_ref = portable_ref(envelope["reportRef"], "Verification report ref")
    report_hash = _hash(envelope["reportHash"], "Verification report hash")
    report_snapshot = read_contained_json(
        change_root,
        f"runtime/evidence/reports/{report_hash}.json",
        "Verification report snapshot",
    )
    if (
        not isinstance(report_snapshot, dict)
        or set(report_snapshot) != {"schema", "reportHash", "content"}
        or report_snapshot.get("schema") != "comet.native.verification-report.v1"
        or report_snapshot.get("reportHash") != report_hash
        or not isinstance(report_snapshot.get("content"), str)
        or hashlib.sha256(report_snapshot["content"].encode()).hexdigest() != report_hash
    ):
        raise NativeEvidenceError("Verification report snapshot hash mismatch")
    report_text = report_snapshot["content"]
    if verify_current_files:
        report = contained_file(change_root, report_ref, "Verification report")
        if sha256_file(report) != report_hash:
            raise NativeEvidenceError("Verification report content hash mismatch")
    for criterion in contract["acceptance"]:
        if criterion["id"] not in report_text:
            raise NativeEvidenceError("Verification report does not preserve every acceptance ID")
    allowance_ref = envelope["partialAllowanceRef"]
    allowance_hash = envelope["partialAllowanceHash"]
    if envelope["freshness"] == "complete":
        if allowance_ref is not None or allowance_hash is not None:
            raise NativeEvidenceError("Complete evidence unexpectedly has a partial allowance")
    else:
        allowance = parse_partial_allowance(change_root, allowance_ref, expected_change=change)
        if (
            allowance_hash != allowance["allowanceHash"]
            or allowance["scopeHash"] != scope["scopeHash"]
            or allowance["sourceRevision"] >= envelope["sourceRevision"]
        ):
            raise NativeEvidenceError("Verification envelope/allowance binding is invalid")
    receipt_ref = envelope["receiptRef"]
    if receipt_ref is not None:
        _parse_check_receipt(
            change_root=change_root,
            receipt_ref=receipt_ref,
            expected_change=change,
            expected_source_revision=envelope["sourceRevision"],
            expected_result=envelope["result"],
            expected_contract_hash=contract_hash,
            scope=scope,
        )
    _timestamp(envelope["createdAt"], "Verification timestamp")
    content = {key: value for key, value in envelope.items() if key != "envelopeHash"}
    envelope_hash = _hash(envelope["envelopeHash"], "Verification envelope hash")
    if (
        envelope_hash != match.group(1)
        or canonical_hash("comet.native.verification-evidence.v1", content) != envelope_hash
    ):
        raise NativeEvidenceError("Verification envelope filename/content hash mismatch")
    return {"envelope": envelope, "scope": scope, "contract": contract}


def check_archive_transaction(
    workspace: Path,
    commit_data: Any,
    expected_change: str,
    expected_preflight_hash: str,
) -> dict[str, str]:
    """Bind a successful Archive envelope to its durable v2 transaction journal."""
    check = "archive_transaction"
    try:
        commit = _record(commit_data, "Archive commit data")
        transaction_id = commit.get("transactionId")
        if not isinstance(transaction_id, str) or not re.fullmatch(
            r"[a-f0-9-]{8,}", transaction_id
        ):
            raise NativeEvidenceError("Archive commit has no valid transactionId")
        if commit.get("preflightHash") != expected_preflight_hash:
            raise NativeEvidenceError("Archive commit does not match the expected preflight hash")
        native_root = workspace / "docs" / "comet"
        journal_ref = f"runtime/transactions/{transaction_id}/transaction.json"
        journal = _record(
            read_contained_json(native_root, journal_ref, "Archive transaction journal"),
            "Archive transaction journal",
        )
        _exact_keys(
            journal,
            [
                "schema",
                "id",
                "kind",
                "status",
                "change",
                "createdAt",
                "preflightHash",
                "operations",
            ],
            label="Archive transaction journal",
        )
        if (
            journal["schema"] != "comet.native.transaction.v2"
            or journal["id"] != transaction_id
            or journal["kind"] != "archive"
            or journal["status"] != "committed"
            or journal["change"] != expected_change
            or journal["preflightHash"] != expected_preflight_hash
        ):
            raise NativeEvidenceError("Archive envelope is not bound to one committed v2 journal")
        _timestamp(journal["createdAt"], "Archive transaction timestamp")
        operations = journal["operations"]
        if not isinstance(operations, list) or not operations or len(operations) > 65:
            raise NativeEvidenceError("Archive transaction operations are invalid")
        operation_ids: list[str] = []
        for index, raw in enumerate(operations):
            operation = _record(raw, f"Archive transaction operation {index}")
            _exact_keys(
                operation,
                ["id", "type", "target", "expectedTargetHash"],
                ["source", "staged", "backup", "expectedSourceHash", "stagedHash"],
                label=f"Archive transaction operation {index}",
            )
            operation_id = operation["id"]
            if not isinstance(operation_id, str) or not re.fullmatch(
                r"[a-z0-9][a-z0-9-]*", operation_id
            ):
                raise NativeEvidenceError(f"Archive transaction operation {index} id is invalid")
            operation_ids.append(operation_id)
            portable_ref(operation["target"], f"Archive transaction operation {index} target")
            for field in ("source", "staged", "backup"):
                if field in operation:
                    portable_ref(operation[field], f"Archive transaction operation {index} {field}")
            if operation["expectedTargetHash"] is not None:
                _hash(
                    operation["expectedTargetHash"],
                    f"Archive transaction operation {index} target hash",
                )
            if operation["type"] == "write":
                if (
                    "staged" not in operation
                    or "source" in operation
                    or "expectedSourceHash" in operation
                ):
                    raise NativeEvidenceError("Archive write operation shape is invalid")
                _hash(operation.get("stagedHash"), "Archive staged hash")
                if (operation["expectedTargetHash"] is None) != ("backup" not in operation):
                    raise NativeEvidenceError("Archive write backup binding is invalid")
            elif operation["type"] == "remove":
                if (
                    any(
                        field in operation
                        for field in ("source", "staged", "stagedHash", "expectedSourceHash")
                    )
                    or "backup" not in operation
                    or operation["expectedTargetHash"] is None
                ):
                    raise NativeEvidenceError("Archive remove operation shape is invalid")
            elif operation["type"] == "move":
                if (
                    "source" not in operation
                    or any(field in operation for field in ("staged", "stagedHash", "backup"))
                    or operation["expectedTargetHash"] is not None
                ):
                    raise NativeEvidenceError("Archive move operation shape is invalid")
                _hash(operation.get("expectedSourceHash"), "Archive move source hash")
            else:
                raise NativeEvidenceError("Archive transaction operation type is invalid")
        if len(set(operation_ids)) != len(operation_ids):
            raise NativeEvidenceError("Archive transaction operation IDs are not unique")
        move = operations[-1]
        target = move.get("target")
        if (
            move.get("id") != "archive-change"
            or move.get("type") != "move"
            or move.get("source") != f"changes/{expected_change}"
            or not isinstance(target, str)
            or not re.fullmatch(
                rf"archive/\d{{4}}-\d{{2}}-\d{{2}}-{re.escape(expected_change)}", target
            )
        ):
            raise NativeEvidenceError(
                "Committed Archive journal has no exact content-bound final move"
            )
        for operation in operations[:-1]:
            if operation["type"] == "move" or not re.fullmatch(
                r"specs/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/spec\.md", operation["target"]
            ):
                raise NativeEvidenceError("Archive transaction has a non-canonical spec operation")
        archive_dir = native_root.joinpath(*PurePosixPath(target).parts)
        _assert_real_directory_chain(native_root, archive_dir, "Archived change directory")
        if archive_dir.is_symlink() or not archive_dir.is_dir():
            raise NativeEvidenceError(
                "Archive transaction target is not the live archive directory"
            )
        events_path = contained_file(
            native_root,
            f"runtime/transactions/{transaction_id}/events.jsonl",
            "Archive transaction events",
        )
        events = []
        for line_number, line in enumerate(events_path.read_text(encoding="utf-8").splitlines(), 1):
            if not line:
                raise NativeEvidenceError("Archive transaction events contain a blank line")
            event = _record(json.loads(line), f"Archive transaction event {line_number}")
            _exact_keys(
                event,
                ["sequence", "timestamp", "type"],
                ["operationId"],
                label=f"Archive transaction event {line_number}",
            )
            if event["sequence"] != line_number:
                raise NativeEvidenceError("Archive transaction event sequence is invalid")
            _timestamp(event["timestamp"], f"Archive transaction event {line_number} timestamp")
            events.append(event)
        expected_events: list[tuple[str, str | None]] = [("prepared", None)]
        for operation in operations:
            expected_events.extend(
                [("operation-started", operation["id"]), ("operation-completed", operation["id"])]
            )
        expected_events.extend(
            [("archive-finalization-started", None), ("archive-finalized", None), ("commit", None)]
        )
        actual_events = [(event["type"], event.get("operationId")) for event in events]
        if actual_events != expected_events:
            raise NativeEvidenceError(
                "Archive transaction event lifecycle is incomplete or reordered"
            )
        serialized = canonical_json(journal)
        if str(workspace) in serialized or "\\workspace" in serialized:
            raise NativeEvidenceError(
                "Archive transaction journal exposed an absolute workspace path"
            )
    except (NativeEvidenceError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return failed(check, str(error))
    return passed(check)


def check_checkpoint_cas_envelopes(paths: Iterable[Path]) -> dict[str, str]:
    """Require two raw checkpoint envelopes from one revision with one winner."""
    check = "cas_single_winner"
    evidence_paths = list(paths)
    if len(evidence_paths) != 2:
        return failed(
            check, f"Expected exactly two checkpoint envelopes, found {len(evidence_paths)}"
        )
    envelopes: list[dict[str, Any]] = []
    for path in evidence_paths:
        if not path.is_file():
            return failed(check, f"Missing checkpoint evidence file: {path}")
        try:
            payload = read_json(path)
        except (OSError, json.JSONDecodeError) as error:
            return failed(check, f"Invalid checkpoint evidence in {path.name}: {error}")
        if not isinstance(payload, dict) or payload.get("command") != "checkpoint":
            return failed(check, f"{path.name} is not a raw Native checkpoint envelope")
        if not isinstance(payload.get("data"), dict):
            return failed(check, f"{path.name} has no structured checkpoint data")
        envelopes.append(payload)

    winners = [item for item in envelopes if item.get("exitCode") == 0]
    conflicts = [item for item in envelopes if item.get("exitCode") == 73]
    if len(winners) != 1 or len(conflicts) != 1:
        return failed(
            check,
            f"Expected one exit 0 and one exit 73; observed {[item.get('exitCode') for item in envelopes]}",
        )

    winner = winners[0]["data"]
    conflict = conflicts[0]["data"]
    expected = winner.get("expectedRevision")
    winner_change = winner.get("change")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        return failed(check, "Checkpoint winner has no positive expectedRevision")
    if (
        winner.get("outcome") != "recorded"
        or winner.get("previousRevision") != expected
        or winner.get("revision") != expected + 1
        or not isinstance(winner_change, dict)
        or not isinstance(winner_change.get("name"), str)
        or winner_change.get("revision") != expected + 1
    ):
        return failed(check, f"Checkpoint winner has inconsistent CAS data: {winner!r}")
    if (
        conflict.get("outcome") != "revision-conflict"
        or conflict.get("change") != winner_change.get("name")
        or conflict.get("expectedRevision") != expected
        or conflict.get("actualRevision") != expected + 1
    ):
        return failed(check, f"Checkpoint conflict has inconsistent CAS data: {conflict!r}")
    return passed(check)


def _get_first(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _normalise_projection(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    name = _get_first(value, "name", "change", "changeName", "change_name")
    phase = _get_first(value, "phase", "currentPhase", "current_phase")
    if not isinstance(name, str) or phase is None:
        return None

    verification = _get_first(value, "verificationResult", "verification_result")
    if verification is None and isinstance(value.get("verification"), dict):
        verification = _get_first(value["verification"], "result", "status")
    next_command = _get_first(
        value,
        "nextCommand",
        "next_command",
        "nextAction",
        "next_action",
        "next",
    )
    finding_source = value.get("findingSummary") or value.get("finding_summary")
    if not isinstance(finding_source, dict):
        finding_source = value.get("findings") if isinstance(value.get("findings"), dict) else {}
    finding_codes = finding_source.get("codes")
    if not isinstance(finding_codes, list):
        finding_codes = []
    continuation = value.get("continuation")
    continuation_projection = None
    if isinstance(continuation, dict):
        required_inputs = continuation.get(
            "requiredInputs", continuation.get("required_inputs", [])
        )
        continuation_projection = {
            "disposition": continuation.get("disposition"),
            "action": continuation.get("action"),
            "command": continuation.get("command"),
            "requiresUserDecision": continuation.get(
                "requiresUserDecision", continuation.get("requires_user_decision")
            ),
            "requiredInputs": sorted(required_inputs) if isinstance(required_inputs, list) else [],
            "requiredInputsTruncated": continuation.get("requiredInputsTruncated", False)
            is True,
        }
    finding_projection = {
        "total": finding_source.get("total", 0),
        "errors": finding_source.get("errors", 0),
        "warnings": finding_source.get("warnings", 0),
        "info": finding_source.get("info", 0),
        "requiresUserDecision": finding_source.get(
            "requiresUserDecision", finding_source.get("requires_user_decision", False)
        )
        is True,
        "codes": sorted(item for item in finding_codes if isinstance(item, str)),
        "truncated": finding_source.get("truncated", False) is True,
    }
    return {
        "name": name,
        "phase": phase,
        "revision": value.get("revision"),
        "selected": value.get("selected", False) is True,
        "nextCommand": next_command,
        "verificationResult": verification,
        "archiveReady": value.get("archiveReady", value.get("archive_ready")),
        "findings": finding_projection,
        "continuation": continuation_projection,
    }


def _projection_records(payload: Any, *, dashboard: bool) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    root = payload.get("data", payload)
    candidates: Any = None
    if dashboard:
        if isinstance(root, dict) and isinstance(root.get("native"), dict):
            candidates = root["native"].get("changes")
        elif isinstance(root, dict) and isinstance(root.get("snapshot"), dict):
            snapshot = root["snapshot"]
            if isinstance(snapshot.get("native"), dict):
                candidates = snapshot["native"].get("changes")
            else:
                candidates = snapshot.get("changes")
        elif isinstance(root, dict):
            candidates = root.get("changes")
    elif isinstance(root, dict) and root.get("schema") == "comet.native.status-page.v1":
        candidates = root.get("items")
    elif isinstance(root, list):
        candidates = root
    else:
        candidates = [root]
    if not isinstance(candidates, list):
        return []
    result = []
    for candidate in candidates:
        projection = _normalise_projection(candidate)
        if projection is not None:
            result.append(projection)
    return result


def check_dashboard_projection(
    cli_path: Path,
    dashboard_path: Path,
    *,
    comparison_dashboard: bool = True,
) -> dict[str, str]:
    """Require Dashboard's Native projection to match the CLI projection."""
    check = "dashboard_projection"
    missing = [str(path) for path in (cli_path, dashboard_path) if not path.is_file()]
    if missing:
        return failed(check, f"Missing projection evidence: {', '.join(missing)}")
    try:
        cli = _projection_records(read_json(cli_path), dashboard=False)
        dashboard = _projection_records(
            read_json(dashboard_path), dashboard=comparison_dashboard
        )
    except (OSError, json.JSONDecodeError) as error:
        return failed(check, f"Invalid projection evidence: {error}")
    if not cli:
        return failed(check, "CLI evidence has no Native change projection")
    if not dashboard:
        return failed(check, "Dashboard evidence has no Native change projection")

    if len({item["name"] for item in cli}) != len(cli):
        return failed(check, "CLI evidence repeats a Native change projection")
    if len({item["name"] for item in dashboard}) != len(dashboard):
        return failed(check, "Dashboard evidence repeats a Native change projection")
    dashboard_by_name = {item["name"]: item for item in dashboard}
    cli_names = {item["name"] for item in cli}
    dashboard_names = set(dashboard_by_name)
    mismatches = []
    for cli_item in cli:
        dashboard_item = dashboard_by_name.get(cli_item["name"])
        if dashboard_item is None:
            mismatches.append(f"{cli_item['name']}: missing from Dashboard")
        elif dashboard_item != cli_item:
            mismatches.append(f"{cli_item['name']}: CLI={cli_item!r}, Dashboard={dashboard_item!r}")
    for extra in sorted(dashboard_names - cli_names):
        mismatches.append(f"{extra}: unexpected Dashboard-only change")
    if mismatches:
        return failed(check, "; ".join(mismatches))
    return passed(check)


def active_changes(workspace: Path) -> list[Path]:
    root = workspace / "docs" / "comet" / "changes"
    if not root.exists():
        return []
    _assert_real_directory_chain(workspace, root, "Native active changes root")
    return sorted(path for path in root.iterdir() if path.is_dir() and not path.is_symlink())


def archive_changes(workspace: Path) -> list[Path]:
    root = workspace / "docs" / "comet" / "archive"
    if not root.exists():
        return []
    _assert_real_directory_chain(workspace, root, "Native archive root")
    return sorted(
        path
        for path in root.iterdir()
        if path.is_dir() and not path.is_symlink() and "-" in path.name
    )


def check_pytest(workspace: Path, check: str = "project_tests") -> dict[str, str]:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except Exception as error:
        return failed(check, str(error))
    if result.returncode != 0:
        detail = (result.stdout + "\n" + result.stderr).strip()
        return failed(check, detail[-2000:] or f"pytest exited {result.returncode}")
    return passed(check)


def check_cli_feature(
    workspace: Path,
    flag: str,
    input_text: str,
    expected_output: str,
    test_marker: str,
) -> dict[str, str]:
    check = f"feature_{flag.lstrip('-').replace('-', '_')}"
    project_tests = check_pytest(workspace, check)
    if project_tests["status"] == "failed":
        return project_tests
    try:
        result = subprocess.run(
            [sys.executable, "wordcount.py", flag],
            cwd=workspace,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as error:
        return failed(check, str(error))
    if result.returncode != 0 or expected_output not in result.stdout:
        return failed(
            check,
            f"Expected {expected_output!r}; exit={result.returncode}, stdout={result.stdout!r}",
        )
    tests = workspace / "test_wordcount.py"
    if not tests.is_file() or test_marker.lower() not in tests.read_text(encoding="utf-8").lower():
        return failed(check, f"No focused test marker {test_marker!r} was found")
    return passed(check)


def check_native_isolation(workspace: Path) -> dict[str, str]:
    check = "native_isolation"
    comet_config_dir = workspace / ".comet"
    hidden_entries = (
        {path.name for path in comet_config_dir.iterdir()}
        if comet_config_dir.is_dir()
        else set()
    )
    present = []
    if (workspace / "openspec").exists():
        present.append("openspec")
    present.extend(f".comet/{name}" for name in sorted(hidden_entries - {"config.yaml"}))
    if present:
        return failed(check, f"Forbidden workflow artifacts exist: {present}")
    return passed(check)


def write_results(
    results: list[dict[str, str]],
    workspace: Path,
    results_file: str | None = None,
) -> int:
    output = {
        "passed": [result["check"] for result in results if result["status"] == "passed"],
        "failed": [
            f"{result['check']}: {result.get('reason', '')}"
            for result in results
            if result["status"] == "failed"
        ],
    }
    target = results_file or os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
    (workspace / target).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output))
    return 1 if output["failed"] else 0
