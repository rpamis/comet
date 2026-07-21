"""Strict, task-macro comparison for two eval experiments.

The legacy comparison report pools every run in one experiment.  That is useful
for a quick dashboard, but it is not a valid pass@k comparison when treatments
were executed in separate experiments or when tasks have different numbers of
repetitions.  This module pairs runs by ``(task, repetition, case hash)`` and
then computes each task's metric before taking the macro average.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from scaffold.python.logging import extract_events, parse_output
from scaffold.python.pass_at_k import compute_pass_metrics
from scaffold.python.sample_quality import quality_from_report


CASE_MANIFEST_SCHEMA_V1 = "comet.eval.case-manifest.v1"
CASE_MANIFEST_SCHEMA = "comet.eval.case-manifest.v2"
EXECUTION_IDENTITY_SCHEMA = "comet.eval.execution-identity.v1"
EXPECTED_CASE_MATRIX_SCHEMA = "comet.eval.expected-case-matrix.v1"
EXPECTED_CASE_MATRIX_FILENAME = "expected-case-matrix.json"
DURATION_SOURCE = "raw_stdout:extract_events"
MAX_RAW_STDOUT_BYTES = 64 * 1024 * 1024
MAX_EXPECTED_CASE_MATRIX_BYTES = 8 * 1024 * 1024
_EVAL_ROOT = Path(__file__).resolve().parents[2]
_REPORT_SUFFIX_RE = r"(?:-r(?P<rep>\d+))?$"
_CASE_IDENTIFIER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")
_HASHED_CASE_PARTS_V1 = (
    "task_hash",
    "instruction_hash",
    "validator_hash",
    "environment_hash",
    "data_hash",
    "prompt_hash",
)
_HASHED_CASE_PARTS_V2 = (
    *_HASHED_CASE_PARTS_V1,
    "runner_hash",
    "controller_hash",
    "execution_hash",
)
_EXECUTION_IDENTITY_HASH_KEYS = (
    "image_id_hash",
    "image_repo_digests_hash",
    "image_ref_hash",
    "claude_tool_version_hash",
    "model_selection_hash",
    "interaction_hash",
)
_RUNNER_FILES = (
    "scaffold/shell/docker.sh",
    "scaffold/shell/common.sh",
    "scaffold/shell/run-claude-loop.sh",
    "scaffold/shell/decision-point.sh",
    "scaffold/shell/completion-point.sh",
)
_CONTROLLER_FILES = (
    "local/tests/tasks/test_tasks.py",
    "local/tests/conftest.py",
    "scaffold/python/tasks.py",
    "scaffold/python/treatments.py",
    "scaffold/python/profiles.py",
    "scaffold/python/manifests.py",
    "scaffold/python/utils.py",
    "scaffold/python/logging.py",
    "scaffold/python/aligned_comparison.py",
)


@dataclass(frozen=True)
class CaseManifest:
    schema: str
    task: str
    case_hash: str
    core_hash: str
    task_hash: str
    instruction_hash: str
    validator_hash: str
    environment_hash: str
    data_hash: str
    prompt_hash: str
    runner_hash: str | None
    controller_hash: str | None
    execution_hash: str | None
    execution_identity: dict[str, str] | None
    source: str
    run_bound: bool
    execution_bound: bool


@dataclass(frozen=True)
class ExpectedCase:
    task: str
    treatment: str
    rep: int


@dataclass(frozen=True)
class ExpectedCaseMatrix:
    matrix_hash: str
    cases: tuple[ExpectedCase, ...]

    def keys_for(self, treatment: str) -> frozenset[tuple[str, int]]:
        return frozenset(
            (case.task, case.rep) for case in self.cases if case.treatment == treatment
        )


@dataclass(frozen=True)
class ExpectedCaseMatrixLoad:
    matrix: ExpectedCaseMatrix | None
    error: str | None


@dataclass(frozen=True)
class RunRecord:
    task: str
    rep: int
    treatment: str
    report: dict[str, Any]
    report_path: Path
    manifest: CaseManifest
    manifest_valid: bool
    include_in_analysis: bool
    quality_reason: str


@dataclass(frozen=True)
class AlignmentIssue:
    task: str
    rep: int
    reason: str
    detail: str


@dataclass(frozen=True)
class AlignedPair:
    task: str
    rep: int
    case_hash: str
    candidate: RunRecord
    baseline: RunRecord


@dataclass(frozen=True)
class AlignmentResult:
    candidate_records: tuple[RunRecord, ...]
    baseline_records: tuple[RunRecord, ...]
    pairs: tuple[AlignedPair, ...]
    issues: tuple[AlignmentIssue, ...]
    tasks: tuple[str, ...]
    expected_keys: int


def _sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _hash_tree(path: Path) -> str:
    """Hash a file/tree without following symlinks."""
    digest = hashlib.sha256()
    if not path.exists() and not path.is_symlink():
        digest.update(b"missing\0")
        return "sha256:" + digest.hexdigest()

    paths = [path] if path.is_file() or path.is_symlink() else sorted(path.rglob("*"))
    for item in paths:
        if item.name.startswith(".env"):
            continue
        if item.name == "__pycache__" or "__pycache__" in item.parts:
            continue
        if item.suffix in {".pyc", ".pyo"}:
            continue
        relative = item.name if item == path else item.relative_to(path).as_posix()
        if item.is_symlink():
            digest.update(f"L\0{relative}\0{item.readlink()}\0".encode("utf-8"))
        elif item.is_file():
            digest.update(f"F\0{relative}\0".encode("utf-8"))
            digest.update(item.read_bytes())
            digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def _case_hash(task: str, components: dict[str, str], *, schema: str) -> str:
    payload = {
        "schema": schema,
        "task": task,
        **components,
    }
    return _sha256_bytes(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _case_core_hash(task: str, components: dict[str, str]) -> str:
    return _case_hash(
        task,
        {key: components[key] for key in _HASHED_CASE_PARTS_V1},
        schema="comet.eval.case-core.v1",
    )


def _hash_named_files(paths: Sequence[str]) -> str:
    components = {path: _hash_tree(_EVAL_ROOT / path) for path in paths}
    return _sha256_bytes(
        json.dumps(components, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


def _is_hash(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def _hash_private_value(value: Any) -> str:
    """Hash configuration without persisting its potentially sensitive text."""
    return _sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    )


def build_execution_identity(
    docker_identity: dict[str, Any],
    *,
    model: str | None,
    model_config: dict[str, str | None] | None = None,
    interaction: Any,
) -> dict[str, str]:
    """Build the safe, report-bound execution identity.

    Docker supplies hashes derived from the immutable image and the actual
    ``claude --version`` output. Model and interaction text are hashed by the
    controller; only bounded enums and digests enter reports.
    """
    if docker_identity.get("schema") != EXECUTION_IDENTITY_SCHEMA:
        raise ValueError("Docker execution identity schema is invalid")
    allowed = {"schema", "runtime_image_id", *_EXECUTION_IDENTITY_HASH_KEYS[:4]}
    unknown = set(docker_identity) - allowed
    if unknown:
        raise ValueError(f"Docker execution identity has unknown keys: {sorted(unknown)}")
    runtime_image_id = docker_identity.get("runtime_image_id")
    if not isinstance(runtime_image_id, str) or not re.fullmatch(
        r"sha256:[0-9a-f]{64}", runtime_image_id
    ):
        raise ValueError("Docker execution identity does not include an immutable image ID")
    for key in _EXECUTION_IDENTITY_HASH_KEYS[:4]:
        if not _is_hash(docker_identity.get(key)):
            raise ValueError(f"Docker execution identity {key} is invalid")
    if docker_identity["image_id_hash"] != _sha256_bytes(runtime_image_id.encode("utf-8")):
        raise ValueError("Docker execution identity image hash does not match its runtime image")

    mode = getattr(interaction, "mode", None) or "none"
    if mode not in {"none", "auto_user"}:
        mode = "custom"
    max_turns = getattr(interaction, "max_turns", None)
    if isinstance(max_turns, bool) or not isinstance(max_turns, int) or not 1 <= max_turns <= 1000:
        raise ValueError("Interaction max_turns must be between 1 and 1000")
    interaction_payload = {
        "mode": mode,
        "max_turns": max_turns,
        "simulator_prompt": getattr(interaction, "simulator_prompt", None),
        "decision_patterns": list(getattr(interaction, "decision_patterns", ()) or ()),
        "decision_reply": getattr(interaction, "decision_reply", None),
        "continue_prompt": getattr(interaction, "continue_prompt", None),
        "fresh_resume_marker": getattr(interaction, "fresh_resume_marker", None),
    }
    model_source = "explicit" if model else "runtime-default"
    normalized_model_config = {
        key: value
        for key, value in sorted((model_config or {}).items())
        if isinstance(key, str) and isinstance(value, (str, type(None)))
    }
    return {
        "schema": EXECUTION_IDENTITY_SCHEMA,
        **{key: docker_identity[key] for key in _EXECUTION_IDENTITY_HASH_KEYS[:4]},
        "model_selection_hash": _hash_private_value(
            {
                "source": model_source,
                "selection": model or "runtime-default",
                "runtime_config": normalized_model_config,
            }
        ),
        "interaction_hash": _hash_private_value(interaction_payload),
        "model_source": model_source,
        "interaction_mode": mode,
        "interaction_max_turns": str(max_turns),
    }


def _validated_execution_identity(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    allowed = {
        "schema",
        *_EXECUTION_IDENTITY_HASH_KEYS,
        "model_source",
        "interaction_mode",
        "interaction_max_turns",
    }
    if set(raw) != allowed or raw.get("schema") != EXECUTION_IDENTITY_SCHEMA:
        return None
    if not all(_is_hash(raw.get(key)) for key in _EXECUTION_IDENTITY_HASH_KEYS):
        return None
    if raw.get("model_source") not in {"explicit", "runtime-default"}:
        return None
    if raw.get("interaction_mode") not in {"none", "auto_user", "custom"}:
        return None
    try:
        max_turns = int(raw.get("interaction_max_turns", ""))
    except (TypeError, ValueError):
        return None
    if not 1 <= max_turns <= 1000 or str(max_turns) != raw.get("interaction_max_turns"):
        return None
    return {key: raw[key] for key in sorted(allowed)}


def build_case_manifest(
    task: str,
    tasks_dir: Path,
    *,
    execution_identity: dict[str, str] | None = None,
) -> CaseManifest:
    """Build a manifest for the canonical task and, for new runs, its execution."""
    task_dir = tasks_dir / task
    instruction_path = task_dir / "instruction.md"
    task_hash = _hash_tree(task_dir / "task.toml")
    instruction_hash = _hash_tree(instruction_path)
    validator_components = {
        "task_validation": _hash_tree(task_dir / "validation"),
        "shared_validation": _hash_tree(_EVAL_ROOT / "scaffold" / "python" / "validation"),
        "native_adapter": _hash_tree(_EVAL_ROOT / "scaffold" / "python" / "native_eval.py"),
    }
    validator_hash = _sha256_bytes(
        json.dumps(validator_components, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    environment_hash = _hash_tree(task_dir / "environment")
    data_hash = _hash_tree(task_dir / "data")
    instruction_bytes = instruction_path.read_bytes() if instruction_path.is_file() else b"missing"
    prompt_components = {
        "instruction": _sha256_bytes(b"canonical-task-prompt-v1\0" + instruction_bytes),
        "task_renderer": _hash_tree(_EVAL_ROOT / "scaffold" / "python" / "tasks.py"),
        "native_adapter": validator_components["native_adapter"],
    }
    prompt_hash = _sha256_bytes(
        json.dumps(prompt_components, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    base_components = {
        "task_hash": task_hash,
        "instruction_hash": instruction_hash,
        "validator_hash": validator_hash,
        "environment_hash": environment_hash,
        "data_hash": data_hash,
        "prompt_hash": prompt_hash,
    }
    if execution_identity is None:
        schema = CASE_MANIFEST_SCHEMA_V1
        components = base_components
        runner_hash = controller_hash = execution_hash = None
        validated_identity = None
        source = "current-task-tree-fallback"
        run_bound = False
        execution_bound = False
    else:
        validated_identity = _validated_execution_identity(execution_identity)
        if validated_identity is None:
            raise ValueError("execution identity is not a safe canonical payload")
        schema = CASE_MANIFEST_SCHEMA
        runner_hash = _hash_named_files(_RUNNER_FILES)
        controller_hash = _hash_named_files(_CONTROLLER_FILES)
        execution_hash = _hash_private_value(validated_identity)
        components = {
            **base_components,
            "runner_hash": runner_hash,
            "controller_hash": controller_hash,
            "execution_hash": execution_hash,
        }
        source = "report-bound-v2"
        run_bound = True
        execution_bound = True
    case_hash = _case_hash(task, components, schema=schema)
    core_hash = _case_core_hash(task, base_components)
    return CaseManifest(
        schema=schema,
        task=task,
        case_hash=case_hash,
        core_hash=core_hash,
        task_hash=task_hash,
        instruction_hash=instruction_hash,
        validator_hash=validator_hash,
        environment_hash=environment_hash,
        data_hash=data_hash,
        prompt_hash=prompt_hash,
        runner_hash=runner_hash,
        controller_hash=controller_hash,
        execution_hash=execution_hash,
        execution_identity=validated_identity,
        source=source,
        run_bound=run_bound,
        execution_bound=execution_bound,
    )


def case_manifest_payload(manifest: CaseManifest) -> dict[str, Any]:
    """Serialize a case manifest into the report-bound wire format."""
    payload: dict[str, Any] = {
        "schema": manifest.schema,
        "task": manifest.task,
        "case_hash": manifest.case_hash,
        **{key: getattr(manifest, key) for key in _HASHED_CASE_PARTS_V1},
    }
    if manifest.schema == CASE_MANIFEST_SCHEMA:
        payload.update(
            {
                key: getattr(manifest, key)
                for key in ("runner_hash", "controller_hash", "execution_hash")
            }
        )
        payload["execution_identity"] = manifest.execution_identity
    return payload


def _embedded_case_manifest(report: dict[str, Any], task: str) -> CaseManifest | None:
    events = report.get("events_summary") or {}
    raw = report.get("case_manifest") or events.get("case_manifest")
    if not isinstance(raw, dict):
        return None
    schema = raw.get("schema")
    if schema not in {CASE_MANIFEST_SCHEMA_V1, CASE_MANIFEST_SCHEMA} or raw.get("task") != task:
        return None
    hashed_parts = (
        _HASHED_CASE_PARTS_V2 if schema == CASE_MANIFEST_SCHEMA else _HASHED_CASE_PARTS_V1
    )
    expected_keys = {"schema", "task", "case_hash", *hashed_parts}
    if schema == CASE_MANIFEST_SCHEMA:
        expected_keys.add("execution_identity")
    if set(raw) != expected_keys:
        return None
    if not all(_is_hash(raw.get(key)) for key in hashed_parts):
        return None
    case_hash = raw.get("case_hash")
    if not isinstance(case_hash, str) or not case_hash.startswith("sha256:"):
        return None
    components = {key: raw[key] for key in hashed_parts}
    if case_hash != _case_hash(task, components, schema=schema):
        return None
    execution_identity = (
        _validated_execution_identity(raw.get("execution_identity"))
        if schema == CASE_MANIFEST_SCHEMA
        else None
    )
    if schema == CASE_MANIFEST_SCHEMA and (
        execution_identity is None
        or raw["execution_hash"] != _hash_private_value(execution_identity)
    ):
        return None
    return CaseManifest(
        schema=schema,
        task=task,
        case_hash=case_hash,
        core_hash=_case_core_hash(task, components),
        task_hash=raw["task_hash"],
        instruction_hash=raw["instruction_hash"],
        validator_hash=raw["validator_hash"],
        environment_hash=raw["environment_hash"],
        data_hash=raw["data_hash"],
        prompt_hash=raw["prompt_hash"],
        runner_hash=raw.get("runner_hash"),
        controller_hash=raw.get("controller_hash"),
        execution_hash=raw.get("execution_hash"),
        execution_identity=execution_identity,
        source="report-bound-v2" if schema == CASE_MANIFEST_SCHEMA else "report-bound-v1",
        run_bound=True,
        execution_bound=schema == CASE_MANIFEST_SCHEMA,
    )


def expected_case_matrix_payload(
    cases: Iterable[tuple[str, str, int] | ExpectedCase],
) -> dict[str, Any]:
    """Create a deterministic, controller-owned expected-case matrix."""
    normalized: set[tuple[str, str, int]] = set()
    for raw in cases:
        if isinstance(raw, ExpectedCase):
            task, treatment, rep = raw.task, raw.treatment, raw.rep
        else:
            task, treatment, rep = raw
        if (
            not isinstance(task, str)
            or _CASE_IDENTIFIER_RE.fullmatch(task) is None
            or not isinstance(treatment, str)
            or _CASE_IDENTIFIER_RE.fullmatch(treatment) is None
        ):
            raise ValueError("Expected case task and treatment must be non-empty strings")
        if isinstance(rep, bool) or not isinstance(rep, int) or rep < 1:
            raise ValueError("Expected case repetition must be a positive integer")
        key = (task, treatment, rep)
        if key in normalized:
            raise ValueError("Expected case matrix contains a duplicate case")
        normalized.add(key)
    serialized = [
        {"task": task, "treatment": treatment, "rep": rep}
        for task, treatment, rep in sorted(normalized)
    ]
    hash_payload = {"schema": EXPECTED_CASE_MATRIX_SCHEMA, "cases": serialized}
    matrix_hash = _sha256_bytes(
        json.dumps(hash_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    return {**hash_payload, "matrix_hash": matrix_hash}


def parse_expected_case_matrix(raw: Any) -> ExpectedCaseMatrix:
    if not isinstance(raw, dict) or set(raw) != {"schema", "matrix_hash", "cases"}:
        raise ValueError("expected case matrix has an invalid object shape")
    if raw.get("schema") != EXPECTED_CASE_MATRIX_SCHEMA:
        raise ValueError("expected case matrix schema is invalid")
    cases_raw = raw.get("cases")
    if not isinstance(cases_raw, list):
        raise ValueError("expected case matrix cases must be a list")
    cases: list[ExpectedCase] = []
    seen: set[tuple[str, str, int]] = set()
    for item in cases_raw:
        if not isinstance(item, dict) or set(item) != {"task", "treatment", "rep"}:
            raise ValueError("expected case matrix contains an invalid case")
        task = item.get("task")
        treatment = item.get("treatment")
        rep = item.get("rep")
        if (
            not isinstance(task, str)
            or _CASE_IDENTIFIER_RE.fullmatch(task) is None
            or not isinstance(treatment, str)
            or _CASE_IDENTIFIER_RE.fullmatch(treatment) is None
        ):
            raise ValueError("expected case matrix contains an invalid task or treatment")
        if isinstance(rep, bool) or not isinstance(rep, int) or rep < 1:
            raise ValueError("expected case matrix contains an invalid repetition")
        key = (task, treatment, rep)
        if key in seen:
            raise ValueError("expected case matrix contains a duplicate case")
        seen.add(key)
        cases.append(ExpectedCase(task=task, treatment=treatment, rep=rep))
    if [(case.task, case.treatment, case.rep) for case in cases] != sorted(seen):
        raise ValueError("expected case matrix cases are not canonically ordered")
    canonical = expected_case_matrix_payload(cases)
    if raw.get("matrix_hash") != canonical["matrix_hash"]:
        raise ValueError("expected case matrix hash does not match its cases")
    return ExpectedCaseMatrix(matrix_hash=canonical["matrix_hash"], cases=tuple(cases))


def load_expected_case_matrix(experiment_dir: Path) -> ExpectedCaseMatrixLoad:
    path = experiment_dir / EXPECTED_CASE_MATRIX_FILENAME
    try:
        before = path.lstat()
    except FileNotFoundError:
        return ExpectedCaseMatrixLoad(matrix=None, error=None)
    except OSError:
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix metadata cannot be read")
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix is not a regular file")
    if before.st_size > MAX_EXPECTED_CASE_MATRIX_BYTES:
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix exceeds the size limit")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        after = path.lstat()
        if _path_identity(before) != _path_identity(after):
            return ExpectedCaseMatrixLoad(matrix=None, error="matrix changed during read")
        return ExpectedCaseMatrixLoad(matrix=parse_expected_case_matrix(raw), error=None)
    except OSError:
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix cannot be read")
    except UnicodeError:
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix is not valid UTF-8")
    except json.JSONDecodeError:
        return ExpectedCaseMatrixLoad(matrix=None, error="matrix is not valid JSON")
    except ValueError as error:
        return ExpectedCaseMatrixLoad(matrix=None, error=str(error))


def _report_identity(
    report: dict[str, Any],
    treatment: str,
    report_path: Path | None = None,
) -> tuple[str, int] | None:
    name = str(report.get("name") or "")
    match = re.match(
        rf"^(?P<task>.+)-{re.escape(treatment)}{_REPORT_SUFFIX_RE}",
        name,
    )
    if not match:
        return None
    combined_sample = (
        re.search(r"_sample(?P<rep>\d+)_from_", report_path.stem)
        if report_path is not None
        else None
    )
    rep_text = combined_sample.group("rep") if combined_sample else match.group("rep")
    raw_rep = rep_text if rep_text is not None else report.get("rep", 1)
    if isinstance(raw_rep, bool):
        return None
    try:
        rep = int(raw_rep)
    except (TypeError, ValueError):
        return None
    if rep < 1:
        return None
    return match.group("task"), rep


def load_treatment_records(
    experiment_dir: Path,
    treatment: str,
    *,
    tasks_dir: Path,
) -> tuple[RunRecord, ...]:
    reports_dir = experiment_dir / "reports"
    manifests: dict[str, CaseManifest] = {}
    records: list[RunRecord] = []
    if not reports_dir.is_dir():
        return ()
    for path in sorted(reports_dir.glob("*.json")):
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        identity = _report_identity(report, treatment, path)
        if identity is None:
            continue
        task, rep = identity
        events = report.get("events_summary") or {}
        raw_manifest = report.get("case_manifest") or events.get("case_manifest")
        manifest = _embedded_case_manifest(report, task)
        manifest_valid = manifest is not None or raw_manifest is None
        if manifest is None:
            manifest = manifests.setdefault(task, build_case_manifest(task, tasks_dir))
        quality = quality_from_report(report, experiment_dir=experiment_dir)
        records.append(
            RunRecord(
                task=task,
                rep=rep,
                treatment=treatment,
                report=report,
                report_path=path,
                manifest=manifest,
                manifest_valid=manifest_valid,
                include_in_analysis=quality.include_in_analysis,
                quality_reason=quality.reason_code,
            )
        )
    return tuple(records)


def align_records(
    candidate_records: Sequence[RunRecord],
    baseline_records: Sequence[RunRecord],
    *,
    candidate_expected: frozenset[tuple[str, int]] | None = None,
    baseline_expected: frozenset[tuple[str, int]] | None = None,
    initial_issues: Sequence[AlignmentIssue] = (),
) -> AlignmentResult:
    candidate_by_key: dict[tuple[str, int], list[RunRecord]] = defaultdict(list)
    baseline_by_key: dict[tuple[str, int], list[RunRecord]] = defaultdict(list)
    for record in candidate_records:
        candidate_by_key[(record.task, record.rep)].append(record)
    for record in baseline_records:
        baseline_by_key[(record.task, record.rep)].append(record)

    candidate_observed = set(candidate_by_key)
    baseline_observed = set(baseline_by_key)
    effective_candidate_expected = (
        candidate_observed if candidate_expected is None else set(candidate_expected)
    )
    effective_baseline_expected = (
        baseline_observed if baseline_expected is None else set(baseline_expected)
    )
    keys = sorted(
        candidate_observed
        | baseline_observed
        | effective_candidate_expected
        | effective_baseline_expected
    )
    tasks = tuple(sorted({task for task, _rep in keys}))
    issues: list[AlignmentIssue] = list(initial_issues)
    pairs: list[AlignedPair] = []
    for task, rep in keys:
        key = (task, rep)
        candidate_matches = candidate_by_key.get((task, rep), [])
        baseline_matches = baseline_by_key.get((task, rep), [])
        matrix_mismatch = (
            candidate_expected is not None
            and baseline_expected is not None
            and (key in effective_candidate_expected) != (key in effective_baseline_expected)
        )
        if matrix_mismatch:
            omitted = (
                "baseline matrix omits case"
                if key in effective_candidate_expected
                else "candidate matrix omits case"
            )
            issues.append(AlignmentIssue(task, rep, "expected-matrix-mismatch", omitted))
        unexpected: list[str] = []
        if candidate_expected is not None and candidate_matches and key not in candidate_expected:
            unexpected.append("candidate")
        if baseline_expected is not None and baseline_matches and key not in baseline_expected:
            unexpected.append("baseline")
        if unexpected:
            issues.append(AlignmentIssue(task, rep, "unexpected-run", ", ".join(unexpected)))
            continue
        if len(candidate_matches) != 1 or len(baseline_matches) != 1:
            if len(candidate_matches) > 1 or len(baseline_matches) > 1:
                detail = f"candidate={len(candidate_matches)}, baseline={len(baseline_matches)}"
                issues.append(AlignmentIssue(task, rep, "duplicate-run", detail))
            elif not candidate_matches or not baseline_matches:
                missing = []
                if not candidate_matches:
                    missing.append("candidate")
                if not baseline_matches:
                    missing.append("baseline")
                issues.append(
                    AlignmentIssue(
                        task,
                        rep,
                        "missing-repetition",
                        f"missing {' and '.join(missing)} run",
                    )
                )
            continue

        candidate = candidate_matches[0]
        baseline = baseline_matches[0]
        invalid_manifests = []
        if not candidate.manifest_valid:
            invalid_manifests.append("candidate")
        if not baseline.manifest_valid:
            invalid_manifests.append("baseline")
        if invalid_manifests:
            issues.append(
                AlignmentIssue(
                    task,
                    rep,
                    "invalid-case-manifest",
                    ", ".join(invalid_manifests),
                )
            )
            continue
        excluded = []
        if not candidate.include_in_analysis:
            excluded.append(f"candidate:{candidate.quality_reason}")
        if not baseline.include_in_analysis:
            excluded.append(f"baseline:{baseline.quality_reason}")
        if excluded:
            issues.append(AlignmentIssue(task, rep, "quality-excluded", ", ".join(excluded)))
            continue
        exact_execution_identity = (
            candidate.manifest.execution_bound and baseline.manifest.execution_bound
        )
        comparison_hash = (
            candidate.manifest.case_hash
            if exact_execution_identity
            else candidate.manifest.core_hash
        )
        baseline_comparison_hash = (
            baseline.manifest.case_hash if exact_execution_identity else baseline.manifest.core_hash
        )
        if comparison_hash != baseline_comparison_hash:
            issues.append(
                AlignmentIssue(
                    task,
                    rep,
                    "case-hash-mismatch",
                    f"candidate={comparison_hash}, baseline={baseline_comparison_hash}",
                )
            )
            continue
        pairs.append(
            AlignedPair(
                task=task,
                rep=rep,
                case_hash=comparison_hash,
                candidate=candidate,
                baseline=baseline,
            )
        )

    case_hashes_by_task: dict[str, set[str]] = defaultdict(set)
    for pair in pairs:
        case_hashes_by_task[pair.task].add(pair.case_hash)
    drifting_tasks = {
        task: hashes for task, hashes in case_hashes_by_task.items() if len(hashes) > 1
    }
    if drifting_tasks:
        pairs = [pair for pair in pairs if pair.task not in drifting_tasks]
        for task, hashes in sorted(drifting_tasks.items()):
            issues.append(
                AlignmentIssue(
                    task,
                    0,
                    "case-hash-drift",
                    ", ".join(sorted(hashes)),
                )
            )

    return AlignmentResult(
        candidate_records=tuple(candidate_records),
        baseline_records=tuple(baseline_records),
        pairs=tuple(pairs),
        issues=tuple(issues),
        tasks=tasks,
        expected_keys=len(keys),
    )


def _run_passed(report: dict[str, Any]) -> bool:
    failed = report.get("checks_failed")
    return report.get("passed") is True and isinstance(failed, list) and len(failed) == 0


def task_macro_pass_metrics(
    results_by_task: dict[str, Sequence[bool]],
    ks: Sequence[int],
    *,
    total_tasks: int,
) -> dict[int, dict[str, float | int | None]]:
    """Compute task-level pass metrics and macro-average eligible tasks.

    A task with fewer than ``k`` aligned repetitions is not silently evaluated
    at a smaller k.  It is excluded for that k and reported through coverage.
    """
    output: dict[int, dict[str, float | int | None]] = {}
    for k in ks:
        per_task = [
            compute_pass_metrics(values, k)
            for values in results_by_task.values()
            if len(values) >= k
        ]
        output[k] = {
            "pass_at_k": (
                statistics.fmean(float(item["pass_at_k"]) for item in per_task)
                if per_task
                else None
            ),
            "pass_pow_k": (
                statistics.fmean(float(item["pass_pow_k"]) for item in per_task)
                if per_task
                else None
            ),
            "eligible_tasks": len(per_task),
            "total_tasks": total_tasks,
        }
    return output


def _artifact_path(
    report: dict[str, Any],
    experiment_dir: Path,
    key: str,
    *,
    task: str,
    treatment: str,
    rep: int,
    report_path: Path,
) -> Path | None:
    reference = ((report.get("events_summary") or {}).get("artifact_references") or {}).get(key)
    if not isinstance(reference, str) or not reference:
        return None
    comparison_root = experiment_dir.resolve()
    raw_path = Path(reference)
    candidate = Path(
        os.path.abspath(raw_path if raw_path.is_absolute() else comparison_root / raw_path)
    )
    allowed_root = comparison_root
    try:
        candidate.relative_to(allowed_root)
    except ValueError:
        combined = re.search(
            r"_sample(?P<rep>\d+)_from_(?P<source>[A-Za-z0-9._-]+)$",
            report_path.stem,
        )
        if combined is None or int(combined.group("rep")) != rep:
            return None
        source = combined.group("source")
        if source in {".", ".."}:
            return None
        allowed_root = comparison_root.parent / source
        try:
            candidate.relative_to(allowed_root)
        except ValueError:
            return None

    report_name = report.get("name")
    report_rep = report.get("rep", 1)
    if not isinstance(report_name, str) or not report_name:
        return None
    if isinstance(report_rep, bool):
        return None
    try:
        raw_rep = int(report_rep)
    except (TypeError, ValueError):
        return None
    if raw_rep < 1:
        return None
    identity = _report_identity(report, treatment, report_path)
    if identity != (task, rep):
        return None
    expected_names = {
        f"{report_name}_rep{raw_rep}_stdout.json",
        f"{report_name.replace('-', '_')}_rep{raw_rep}_stdout.json",
    }
    if candidate.name not in expected_names:
        return None
    try:
        root_stat = allowed_root.lstat()
        if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
            return None
    except OSError:
        return None
    return candidate


def _path_identity(value: os.stat_result) -> tuple[int, int, int, int]:
    return (value.st_dev, value.st_ino, value.st_mtime_ns, value.st_size)


def _directory_chain(root: Path, parent: Path) -> tuple[tuple[Path, os.stat_result], ...]:
    relative = parent.relative_to(root)
    paths = [root]
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        paths.append(cursor)
    chain: list[tuple[Path, os.stat_result]] = []
    for path in paths:
        current = path.lstat()
        if stat.S_ISLNK(current.st_mode) or not stat.S_ISDIR(current.st_mode):
            raise OSError(f"raw stdout parent is not a real directory: {path}")
        chain.append((path, current))
    return tuple(chain)


def _verify_directory_chain(chain: Sequence[tuple[Path, os.stat_result]]) -> None:
    for path, expected in chain:
        current = path.lstat()
        if (
            stat.S_ISLNK(current.st_mode)
            or not stat.S_ISDIR(current.st_mode)
            or _path_identity(current)[:3] != _path_identity(expected)[:3]
        ):
            raise OSError(f"raw stdout parent changed during read: {path}")


def _read_raw_stdout(path: Path, allowed_root: Path) -> str | None:
    try:
        root = allowed_root.resolve(strict=True)
        chain = _directory_chain(root, path.parent)
        before = path.lstat()
        if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
            return None
        if before.st_size > MAX_RAW_STDOUT_BYTES:
            return None
        _verify_directory_chain(chain)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        try:
            opened = os.fstat(descriptor)
            after_open = path.lstat()
            if (
                not stat.S_ISREG(opened.st_mode)
                or stat.S_ISLNK(after_open.st_mode)
                or not stat.S_ISREG(after_open.st_mode)
                or _path_identity(opened) != _path_identity(before)
                or _path_identity(after_open) != _path_identity(before)
            ):
                return None
            _verify_directory_chain(chain)
            chunks: list[bytes] = []
            remaining = MAX_RAW_STDOUT_BYTES + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(64 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            if remaining == 0:
                return None
            after_read = os.fstat(descriptor)
            after_path = path.lstat()
            _verify_directory_chain(chain)
            if (
                stat.S_ISLNK(after_path.st_mode)
                or not stat.S_ISREG(after_path.st_mode)
                or _path_identity(after_read) != _path_identity(opened)
                or _path_identity(after_path) != _path_identity(opened)
            ):
                return None
            return b"".join(chunks).decode("utf-8", errors="replace")
        finally:
            os.close(descriptor)
    except OSError:
        return None


def recompute_duration(
    report: dict[str, Any],
    experiment_dir: Path,
    *,
    task: str,
    treatment: str,
    rep: int,
    report_path: Path,
) -> float | None:
    """Recompute additive duration from raw stdout; never use stale report duration."""
    telemetry = recompute_telemetry(
        report,
        experiment_dir,
        task=task,
        treatment=treatment,
        rep=rep,
        report_path=report_path,
    )
    if telemetry is None:
        return None
    duration = telemetry.get("duration_seconds")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        return None
    return float(duration)


def recompute_telemetry(
    report: dict[str, Any],
    experiment_dir: Path,
    *,
    task: str,
    treatment: str,
    rep: int,
    report_path: Path,
) -> dict[str, Any] | None:
    """Recompute cumulative task telemetry from the controller-bound raw stdout."""
    path = _artifact_path(
        report,
        experiment_dir,
        "raw_stdout",
        task=task,
        treatment=treatment,
        rep=rep,
        report_path=report_path,
    )
    if path is None:
        return None
    try:
        path.relative_to(experiment_dir.resolve())
        allowed_root = experiment_dir
    except ValueError:
        combined = re.search(
            r"_sample(?P<rep>\d+)_from_(?P<source>[A-Za-z0-9._-]+)$",
            report_path.stem,
        )
        if combined is None or int(combined.group("rep")) != rep:
            return None
        allowed_root = experiment_dir.resolve().parent / combined.group("source")
    stdout = _read_raw_stdout(path, allowed_root)
    if stdout is None:
        return None
    telemetry = extract_events(parse_output(stdout))
    if telemetry.get("subject_invocations") == 0:
        return None
    return telemetry


def _hash_short(value: str) -> str:
    return value.removeprefix("sha256:")[:12]


def _format_metric(value: float | int | None) -> str:
    return "N/A" if value is None else f"{float(value):.2f}"


def _format_seconds(value: float | None) -> str:
    return "N/A" if value is None else f"{value:,.0f}s"


def _experiment_label(directory: Path) -> str:
    """Render a stable public identifier without leaking a controller-local path."""
    return directory.name


def _manifest_by_task(records: Iterable[RunRecord]) -> dict[str, CaseManifest]:
    manifests: dict[str, CaseManifest] = {}
    for record in records:
        manifests.setdefault(record.task, record.manifest)
    return manifests


def _results_by_task(
    pairs: Sequence[AlignedPair],
    side: str,
) -> dict[str, list[bool]]:
    results: dict[str, list[bool]] = defaultdict(list)
    for pair in sorted(pairs, key=lambda item: (item.task, item.rep)):
        record = pair.candidate if side == "candidate" else pair.baseline
        results[pair.task].append(_run_passed(record.report))
    return dict(results)


def _duration_summary(
    pairs: Sequence[AlignedPair],
    side: str,
    experiment_dir: Path,
) -> tuple[int, int, float | None, float | None, tuple[tuple[str, int], ...]]:
    values: list[float] = []
    missing: list[tuple[str, int]] = []
    for pair in pairs:
        record = pair.candidate if side == "candidate" else pair.baseline
        duration = recompute_duration(
            record.report,
            experiment_dir,
            task=record.task,
            treatment=record.treatment,
            rep=record.rep,
            report_path=record.report_path,
        )
        if duration is not None:
            values.append(duration)
        else:
            missing.append((pair.task, pair.rep))
    total = sum(values) if values else None
    average = statistics.fmean(values) if values else None
    return len(pairs), len(values), total, average, tuple(missing)


_EFFICIENCY_METRICS = (
    ("subject_invocations", "Model starts/resumes", "count"),
    ("num_turns", "Agent turns", "count"),
    ("tool_calls", "Tool calls", "tool-count"),
    ("duration_seconds", "Wall duration", "seconds"),
    ("input_tokens", "Non-cache input tokens", "tokens"),
    ("output_tokens", "Output tokens", "tokens"),
    ("cache_read_input_tokens", "Cache-read input tokens", "tokens"),
    ("total_tokens", "Total tokens incl. cache", "tokens"),
    ("total_cost_usd", "Model cost", "usd"),
    ("peak_context_input_tokens", "Peak context input", "tokens"),
    ("p95_context_input_tokens", "P95 context input", "tokens"),
    ("peak_context_occupancy_pct", "Peak context occupancy", "percent"),
)


def _telemetry_value(events: dict[str, Any], key: str, kind: str) -> float | None:
    value: Any = events.get(key)
    if kind == "tool-count":
        value = len(value) if isinstance(value, list) else value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _format_efficiency(value: float | None, kind: str) -> str:
    if value is None:
        return "N/A"
    if kind == "seconds":
        return f"{value:,.0f}s"
    if kind == "tokens":
        return f"{value:,.0f}"
    if kind == "usd":
        return f"${value:,.3f}"
    if kind == "percent":
        return f"{value:,.1f}%"
    return f"{value:,.2f}"


def _format_reduction(candidate: float | None, baseline: float | None) -> str:
    if candidate is None or baseline in (None, 0):
        return "N/A"
    change = (baseline - candidate) / baseline * 100
    return f"{abs(change):.1f}% {'less' if change >= 0 else 'more'}"


def _telemetry_by_pair(
    pairs: Sequence[AlignedPair],
    candidate_dir: Path,
    baseline_dir: Path,
) -> list[tuple[AlignedPair, dict[str, Any] | None, dict[str, Any] | None]]:
    output = []
    for pair in pairs:
        sides = []
        for record, directory in (
            (pair.candidate, candidate_dir),
            (pair.baseline, baseline_dir),
        ):
            sides.append(
                recompute_telemetry(
                    record.report,
                    directory,
                    task=record.task,
                    treatment=record.treatment,
                    rep=record.rep,
                    report_path=record.report_path,
                )
            )
        output.append((pair, sides[0], sides[1]))
    return output


def _render_efficiency_table(
    telemetry: Sequence[tuple[AlignedPair, dict[str, Any] | None, dict[str, Any] | None]],
    *,
    successes_only: bool,
) -> list[str]:
    selected = [
        item
        for item in telemetry
        if not successes_only
        or (_run_passed(item[0].candidate.report) and _run_passed(item[0].baseline.report))
    ]
    lines = [
        "| Metric | Complete pairs | Candidate average | Baseline average | Candidate delta |",
        "|--------|----------------|-------------------|------------------|-----------------|",
    ]
    for key, label, kind in _EFFICIENCY_METRICS:
        values = []
        for _pair, candidate, baseline in selected:
            if candidate is None or baseline is None:
                continue
            candidate_value = _telemetry_value(candidate, key, kind)
            baseline_value = _telemetry_value(baseline, key, kind)
            if candidate_value is not None and baseline_value is not None:
                values.append((candidate_value, baseline_value))
        candidate_average = statistics.fmean(value[0] for value in values) if values else None
        baseline_average = statistics.fmean(value[1] for value in values) if values else None
        lines.append(
            f"| {label} | {len(values)}/{len(selected)} | "
            f"{_format_efficiency(candidate_average, kind)} | "
            f"{_format_efficiency(baseline_average, kind)} | "
            f"{_format_reduction(candidate_average, baseline_average)} |"
        )
    return lines


def build_aligned_report(
    candidate_dir: Path,
    baseline_dir: Path,
    *,
    candidate_treatment: str,
    baseline_treatment: str,
    tasks_dir: Path,
    ks: Sequence[int] = (1, 2, 3),
) -> str:
    """Build a strict two-experiment comparison report."""
    if not ks or any(isinstance(k, bool) or k < 1 for k in ks):
        raise ValueError("ks must contain positive integers")
    normalized_ks = tuple(sorted(set(int(k) for k in ks)))
    candidate_records = load_treatment_records(
        candidate_dir,
        candidate_treatment,
        tasks_dir=tasks_dir,
    )
    baseline_records = load_treatment_records(
        baseline_dir,
        baseline_treatment,
        tasks_dir=tasks_dir,
    )
    candidate_matrix_load = load_expected_case_matrix(candidate_dir)
    baseline_matrix_load = load_expected_case_matrix(baseline_dir)
    if not candidate_records:
        raise ValueError(
            f"no {candidate_treatment} reports found in candidate experiment {candidate_dir}"
        )
    if not baseline_records:
        raise ValueError(
            f"no {baseline_treatment} reports found in baseline experiment {baseline_dir}"
        )
    matrix_issues: list[AlignmentIssue] = []
    if candidate_matrix_load.error:
        matrix_issues.append(
            AlignmentIssue(
                "*",
                0,
                "invalid-expected-case-matrix",
                f"candidate: {candidate_matrix_load.error}",
            )
        )
    if baseline_matrix_load.error:
        matrix_issues.append(
            AlignmentIssue(
                "*",
                0,
                "invalid-expected-case-matrix",
                f"baseline: {baseline_matrix_load.error}",
            )
        )
    candidate_expected = (
        candidate_matrix_load.matrix.keys_for(candidate_treatment)
        if candidate_matrix_load.matrix is not None
        else (frozenset() if candidate_matrix_load.error else None)
    )
    baseline_expected = (
        baseline_matrix_load.matrix.keys_for(baseline_treatment)
        if baseline_matrix_load.matrix is not None
        else (frozenset() if baseline_matrix_load.error else None)
    )
    if candidate_matrix_load.matrix is not None and not candidate_expected:
        matrix_issues.append(
            AlignmentIssue(
                "*",
                0,
                "expected-treatment-missing",
                f"candidate matrix has no {candidate_treatment} cases",
            )
        )
    if baseline_matrix_load.matrix is not None and not baseline_expected:
        matrix_issues.append(
            AlignmentIssue(
                "*",
                0,
                "expected-treatment-missing",
                f"baseline matrix has no {baseline_treatment} cases",
            )
        )
    alignment = align_records(
        candidate_records,
        baseline_records,
        candidate_expected=candidate_expected,
        baseline_expected=baseline_expected,
        initial_issues=matrix_issues,
    )
    candidate_results = _results_by_task(alignment.pairs, "candidate")
    baseline_results = _results_by_task(alignment.pairs, "baseline")
    candidate_metrics = task_macro_pass_metrics(
        candidate_results,
        normalized_ks,
        total_tasks=len(alignment.tasks),
    )
    baseline_metrics = task_macro_pass_metrics(
        baseline_results,
        normalized_ks,
        total_tasks=len(alignment.tasks),
    )

    lines = [
        "# Comet Aligned Experiment Comparison Report",
        "",
        f"- Candidate: `{candidate_treatment}` from `{_experiment_label(candidate_dir)}`",
        f"- Baseline: `{baseline_treatment}` from `{_experiment_label(baseline_dir)}`",
        f"- Requested k: {', '.join(str(k) for k in normalized_ks)}",
        "",
        "## Alignment contract",
        "",
        "- Runs pair only when `task` and repetition match. Two v2 records must also match the full execution-bound `case_hash`; when either side is historical v1, only the shared task-core hash can be checked and the limitation is disclosed below.",
        "- Expected task/repetition coverage comes from each experiment's controller-written matrix when available, not from the reports that happened to survive.",
        "- Metrics are computed per task and then macro-averaged; runs are never pooled across tasks.",
        "- A task with fewer than k aligned repetitions is excluded from that k's task coverage; k is never reduced.",
        "- Duration is reparsed from raw stdout with the current additive result-event parser. Stored historical duration fields are not mixed into this metric.",
        "",
        "## Alignment summary",
        "",
        "| Candidate runs | Baseline runs | Expected task/rep keys | Strictly matched pairs | Tasks | Issues |",
        "|----------------|---------------|------------------------|------------------------|-------|--------|",
        f"| {len(candidate_records)} | {len(baseline_records)} | {alignment.expected_keys} | {len(alignment.pairs)} | {len(alignment.tasks)} | {len(alignment.issues)} |",
        "",
    ]

    matrix_rows = []
    for side, matrix_load, treatment in (
        ("Candidate", candidate_matrix_load, candidate_treatment),
        ("Baseline", baseline_matrix_load, baseline_treatment),
    ):
        if matrix_load.matrix is None:
            status = "invalid (fail closed)" if matrix_load.error else "historical fallback"
            matrix_rows.append(f"| {side} | {status} | N/A | N/A |")
        else:
            keys = matrix_load.matrix.keys_for(treatment)
            matrix_rows.append(
                f"| {side} | report-bound | {_hash_short(matrix_load.matrix.matrix_hash)} | {len(keys)} |"
            )
    lines.extend(
        [
            "## Expected case matrix audit",
            "",
            "| Experiment | Source | Matrix hash | Target cases |",
            "|------------|--------|-------------|--------------|",
            *matrix_rows,
            "",
        ]
    )
    missing_matrices = [
        side
        for side, matrix_load in (
            ("candidate", candidate_matrix_load),
            ("baseline", baseline_matrix_load),
        )
        if matrix_load.matrix is None and matrix_load.error is None
    ]
    if missing_matrices:
        lines.extend(
            [
                "> Expected-matrix limitation: "
                + " and ".join(missing_matrices)
                + " experiment(s) predate a valid controller-written matrix. Observed-report fallback is used for that side, so a case missing from every fallback source cannot be reconstructed or claimed as historically executed.",
                "",
            ]
        )
    invalid_matrices = [
        side
        for side, matrix_load in (
            ("candidate", candidate_matrix_load),
            ("baseline", baseline_matrix_load),
        )
        if matrix_load.error is not None
    ]
    if invalid_matrices:
        lines.extend(
            [
                "> Invalid-matrix handling: "
                + " and ".join(invalid_matrices)
                + " experiment matrix failed validation. Its observed reports are excluded rather than treated as a historical fallback.",
                "",
            ]
        )

    fallback_count = sum(
        1 for record in (*candidate_records, *baseline_records) if not record.manifest.run_bound
    )
    if fallback_count:
        lines.extend(
            [
                f"> Audit limitation: {fallback_count} run record(s) predate report-bound case manifests. Their hashes were reconstructed from the current canonical task tree and are marked `current-task-tree-fallback`; they prove comparison-time parity, not the exact historical checkout.",
                "",
            ]
        )
    execution_unbound_count = sum(
        1
        for record in (*candidate_records, *baseline_records)
        if not record.manifest.execution_bound
    )
    if execution_unbound_count:
        lines.extend(
            [
                f"> Execution-identity limitation: {execution_unbound_count} run record(s) use v1 or reconstructed manifests that do not bind the runner/controller sources, immutable Docker image, Claude tool version, model selection, and interaction configuration. They must not be presented as exact historical execution identity.",
                "",
            ]
        )

    lines.extend(
        [
            "## pass@k / pass^k — task macro average",
            "",
            "Each value is the mean of the per-task estimator. Coverage is shown as eligible tasks / all aligned task names.",
            "`pass@k` uses the HumanEval at-least-one-success estimator. `pass^k` keeps Comet's observed consistency lower bound: a task contributes 1 only when all of its aligned repetitions pass.",
            "",
            "| Treatment | Metric | "
            + " | ".join(f"k={k}" for k in normalized_ks)
            + " | Matched pass/fail |",
            "|-----------|--------|"
            + "|".join("-----" for _ in normalized_ks)
            + "|-------------------|",
        ]
    )
    for treatment, results, metrics in (
        (candidate_treatment, candidate_results, candidate_metrics),
        (baseline_treatment, baseline_results, baseline_metrics),
    ):
        total_passes = sum(sum(1 for value in values if value) for values in results.values())
        total_runs = sum(len(values) for values in results.values())
        pass_at_cells = [
            f"{_format_metric(metrics[k]['pass_at_k'])} "
            f"({metrics[k]['eligible_tasks']}/{metrics[k]['total_tasks']} tasks)"
            for k in normalized_ks
        ]
        pass_pow_cells = [
            f"{_format_metric(metrics[k]['pass_pow_k'])} "
            f"({metrics[k]['eligible_tasks']}/{metrics[k]['total_tasks']} tasks)"
            for k in normalized_ks
        ]
        lines.append(
            f"| {treatment} | pass@k | "
            + " | ".join(pass_at_cells)
            + f" | {total_passes}/{total_runs} |"
        )
        lines.append(
            f"| {treatment} | pass^k | "
            + " | ".join(pass_pow_cells)
            + f" | {total_passes}/{total_runs} |"
        )
    lines.append("")

    lines.extend(
        [
            "## Duration from raw stdout",
            "",
            "Missing raw duration is reported as missing coverage and is not replaced by, or averaged with, the stored report duration.",
            "",
            "| Treatment | Matched runs | Duration coverage | Total | Average / covered run | Source |",
            "|-----------|--------------|-------------------|-------|-----------------------|--------|",
        ]
    )
    duration_missing: list[tuple[str, tuple[tuple[str, int], ...]]] = []
    for treatment, side, directory in (
        (candidate_treatment, "candidate", candidate_dir),
        (baseline_treatment, "baseline", baseline_dir),
    ):
        matched, covered, total, average, missing = _duration_summary(
            alignment.pairs,
            side,
            directory,
        )
        lines.append(
            f"| {treatment} | {matched} | {covered}/{matched} | "
            f"{_format_seconds(total)} | {_format_seconds(average)} | {DURATION_SOURCE} |"
        )
        if missing:
            duration_missing.append((treatment, missing))
    lines.append("")
    for treatment, missing in duration_missing:
        references = ", ".join(f"`{task}#r{rep}`" for task, rep in missing)
        lines.append(f"- {treatment} missing raw duration: {references}")
    if duration_missing:
        lines.append("")

    paired_telemetry = _telemetry_by_pair(alignment.pairs, candidate_dir, baseline_dir)
    successful_pairs = sum(
        _run_passed(pair.candidate.report) and _run_passed(pair.baseline.report)
        for pair in alignment.pairs
    )
    lines.extend(
        [
            "## Paired task efficiency from raw stdout",
            "",
            "Result telemetry is additive across the initial model start, deterministic user-answer resumes, and cold resumes. Token totals include cache-read tokens. Context input deduplicates streamed assistant events by message id.",
            "",
            f"### Strict-success intersection ({successful_pairs} paired runs)",
            "",
            "This is the primary completed-task efficiency view: both candidate and baseline passed the same task repetition.",
            "",
            *_render_efficiency_table(paired_telemetry, successes_only=True),
            "",
            f"### All aligned runs ({len(alignment.pairs)} paired runs)",
            "",
            *_render_efficiency_table(paired_telemetry, successes_only=False),
            "",
            "> Context rows require per-assistant-message usage from both sides. Low pair coverage means the historical CLI did not preserve enough context telemetry; those rows must not be promoted as a workflow comparison.",
            "",
        ]
    )

    candidate_manifests = _manifest_by_task(candidate_records)
    baseline_manifests = _manifest_by_task(baseline_records)
    lines.extend(
        [
            "## Case manifest audit",
            "",
            "Hash cells show the first 12 hexadecimal characters. Full hashes remain in the source report when report-bound; fallback hashes are reproducible from the task tree.",
            "",
            "| Task | Candidate case | Baseline case | Source | Instruction | Validator | Environment | Prompt | Runner | Controller | Execution |",
            "|------|----------------|---------------|--------|-------------|-----------|-------------|--------|--------|------------|-----------|",
        ]
    )
    for task in alignment.tasks:
        candidate_manifest = candidate_manifests.get(task)
        baseline_manifest = baseline_manifests.get(task)
        representative = candidate_manifest or baseline_manifest
        if representative is None:
            continue
        source = "/".join(
            filter(
                None,
                (
                    candidate_manifest.source if candidate_manifest else "candidate-missing",
                    baseline_manifest.source if baseline_manifest else "baseline-missing",
                ),
            )
        )
        lines.append(
            f"| {task} | "
            f"{_hash_short(candidate_manifest.case_hash) if candidate_manifest else '—'} | "
            f"{_hash_short(baseline_manifest.case_hash) if baseline_manifest else '—'} | "
            f"{source} | {_hash_short(representative.instruction_hash)} | "
            f"{_hash_short(representative.validator_hash)} | "
            f"{_hash_short(representative.environment_hash)} | "
            f"{_hash_short(representative.prompt_hash)} | "
            f"{_hash_short(representative.runner_hash) if representative.runner_hash else 'v1-unbound'} | "
            f"{_hash_short(representative.controller_hash) if representative.controller_hash else 'v1-unbound'} | "
            f"{_hash_short(representative.execution_hash) if representative.execution_hash else 'v1-unbound'} |"
        )
    lines.append("")

    lines.extend(
        [
            "## Task outcomes on strictly matched repetitions",
            "",
            "| Task | Repetitions | Candidate | Baseline |",
            "|------|-------------|-----------|----------|",
        ]
    )
    pairs_by_task: dict[str, list[AlignedPair]] = defaultdict(list)
    for pair in alignment.pairs:
        pairs_by_task[pair.task].append(pair)
    for task in alignment.tasks:
        pairs = sorted(pairs_by_task.get(task, []), key=lambda item: item.rep)
        reps = ",".join(str(pair.rep) for pair in pairs) or "—"
        candidate_passes = sum(_run_passed(pair.candidate.report) for pair in pairs)
        baseline_passes = sum(_run_passed(pair.baseline.report) for pair in pairs)
        lines.append(
            f"| {task} | {reps} | {candidate_passes}/{len(pairs)} | "
            f"{baseline_passes}/{len(pairs)} |"
        )
    lines.append("")

    if alignment.issues:
        counts = Counter(issue.reason for issue in alignment.issues)
        lines.extend(
            [
                "## Alignment issues",
                "",
                "Issue counts: "
                + ", ".join(f"`{reason}`={count}" for reason, count in sorted(counts.items())),
                "",
                "| Task | Rep | Reason | Detail |",
                "|------|-----|--------|--------|",
            ]
        )
        for issue in alignment.issues:
            detail = issue.detail.replace("|", "/")
            lines.append(f"| {issue.task} | {issue.rep} | {issue.reason} | {detail} |")
        lines.append("")
    else:
        lines.extend(["## Alignment issues", "", "_None._", ""])

    return "\n".join(lines)
