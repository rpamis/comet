"""Schema-first validation for public Eval YAML manifests."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


_UNEXPECTED = re.compile(r"(?:'([^']+)'|\"([^\"]+)\") was unexpected")
_ALIAS_PAIRS = (
    ("draftHash", "draft_hash"),
    ("generationHash", "generation_hash"),
    ("generationFile", "generation_file"),
    ("expectedNodeOrder", "expected_node_order"),
    ("recommendedTasks", "recommended_tasks"),
    ("baselineTreatments", "baseline_treatments"),
    ("qualityGates", "quality_gates"),
    ("requiredOutputSchemas", "required_output_schemas"),
    ("expectedEvidence", "expected_evidence"),
    ("requiredSkills", "required_skills"),
    ("expectedArtifacts", "expected_artifacts"),
    ("generatedNodeSkills", "generated_node_skills"),
    ("routeConformance", "route_conformance"),
    ("maxTurns", "max_turns"),
    ("simulatorPrompt", "simulator_prompt"),
    ("freshResumeMarker", "fresh_resume_marker"),
    ("baseUrl", "base_url"),
)


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema_path = Path(__file__).resolve().parents[2] / "schemas" / "comet.eval" / "v1alpha1.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _path(parts: object) -> str:
    result = ""
    for part in parts:
        if isinstance(part, int):
            result += f"[{part}]"
        else:
            result += ("." if result else "") + str(part)
    return result or "manifest"


def _task_label(data: Any, path: str) -> str:
    match = re.match(r"^evaluation\.tasks\[(\d+)\](.*)$", path)
    if not match or not isinstance(data, dict):
        return path
    evaluation = data.get("evaluation")
    tasks = evaluation.get("tasks") if isinstance(evaluation, dict) else None
    index = int(match.group(1))
    task = tasks[index] if isinstance(tasks, list) and index < len(tasks) else None
    name = task.get("name") if isinstance(task, dict) else None
    return f'task "{name}": {path}' if isinstance(name, str) else path


def _value_at_path(data: Any, path: object) -> Any:
    value = data
    for part in path:
        try:
            value = value[part]
        except (IndexError, KeyError, TypeError):
            return None
    return value


def _most_specific_error(error: Any, data: Any) -> Any:
    """Unwrap union errors while preserving the branch matching the task shape."""
    selected = error
    while selected.validator in {"oneOf", "anyOf"} and selected.context:
        value = _value_at_path(data, selected.absolute_path)
        if isinstance(value, dict) and "source" in value:
            selected = selected.context[-1]
        else:
            selected = selected.context[0]
    return selected


def _reject_alias_pair(data: Any, path: str, pairs: tuple[tuple[str, str], ...]) -> None:
    if not isinstance(data, dict):
        return
    for camel, snake in pairs:
        if camel in data and snake in data:
            raise ValueError(f"{path}.{camel} and {path}.{snake} cannot both be set")


def _reject_alias_conflicts(data: dict[str, Any]) -> None:
    """Reject ambiguous camelCase/snake_case pairs before schema normalization."""

    locations = (
        ("metadata", ("draftHash", "draft_hash", "generationHash", "generation_hash", "generationFile", "generation_file")),
        ("evaluation", ("recommendedTasks", "recommended_tasks", "baselineTreatments", "baseline_treatments", "qualityGates", "quality_gates", "requiredOutputSchemas", "required_output_schemas", "expectedEvidence", "expected_evidence", "requiredSkills", "required_skills", "expectedArtifacts", "expected_artifacts", "generatedNodeSkills", "generated_node_skills", "routeConformance", "route_conformance")),
        ("interaction", ("maxTurns", "max_turns", "simulatorPrompt", "simulator_prompt", "freshResumeMarker", "fresh_resume_marker")),
        ("execution", ("baseUrl", "base_url")),
        ("judge", ("baseUrl", "base_url")),
    )
    pair_set = tuple(_ALIAS_PAIRS)
    for location, _fields in locations:
        value = data.get(location)
        _reject_alias_pair(value, location, pair_set)
    evaluation = data.get("evaluation")
    if isinstance(evaluation, dict):
        for route_name in ("routeConformance", "route_conformance"):
            _reject_alias_pair(evaluation.get(route_name), f"evaluation.{route_name}", pair_set)


def validate_manifest_schema(data: Any) -> None:
    """Reject unknown/malformed fields before semantic normalization."""
    if not isinstance(data, dict):
        raise ValueError("manifest: must be a mapping")
    _reject_alias_conflicts(data)
    errors = sorted(_validator().iter_errors(data), key=lambda error: (list(error.absolute_path), error.message))
    if not errors:
        return
    error = _most_specific_error(errors[0], data)
    path = _task_label(data, _path(error.absolute_path))
    if error.validator == "additionalProperties":
        match = _UNEXPECTED.search(error.message)
        field = next((part for part in (match.groups() if match else ()) if part), "unknown")
        raise ValueError(f"{field if path == 'manifest' else f'{path}.{field}'}: unknown field")
    if error.validator == "required":
        missing = str(error.message).split("'", 2)[1]
        raise ValueError(f"{missing if path == 'manifest' else f'{path}.{missing}'}: is required")
    if error.validator in {"format", "pattern"} and str(path).endswith(("baseUrl", "base_url")):
        raise ValueError(f"{path}: must be a valid absolute http(s) URL")
    raise ValueError(f"{path}: {error.message}")
