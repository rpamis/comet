"""Eval manifest parser for generated Skill packages."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from scaffold.python.tasks import InteractionConfig


SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class SkillEvalManifest:
    path: Path
    name: str
    description: str
    skill_name: str
    skill_path: Path
    profile: str | None = None
    draft_hash: str | None = None
    recommended_tasks: list[str] = field(default_factory=list)
    baseline_treatments: list[str] = field(default_factory=list)
    quality_gates: dict = field(default_factory=dict)
    required_output_schemas: list[str] = field(default_factory=list)
    expected_evidence: list[dict] = field(default_factory=list)
    required_skills: list[str] = field(default_factory=list)
    expected_artifacts: list[str] = field(default_factory=list)
    generated_node_skills: list[str] = field(default_factory=list)
    route_conformance_task: str | None = None
    route_conformance_expected_node_order: list[str] = field(default_factory=list)
    interaction: InteractionConfig = field(default_factory=InteractionConfig)


def _require_mapping(data: dict, field_name: str) -> dict:
    value = data.get(field_name)
    if not isinstance(value, dict):
        raise ValueError(f"Missing mapping field: {field_name}")
    return value


def _optional_string_list(data: dict, camel_name: str, snake_name: str) -> list[str]:
    value = data.get(camel_name, data.get(snake_name))
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Expected evaluation.{camel_name} to be a list of strings")
    return list(value)


def _optional_mapping(data: dict, camel_name: str, snake_name: str) -> dict:
    value = data.get(camel_name, data.get(snake_name))
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"Expected evaluation.{camel_name} to be a mapping")
    return dict(value)


def _optional_dict_list(data: dict, camel_name: str, snake_name: str) -> list[dict]:
    value = data.get(camel_name, data.get(snake_name))
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Expected evaluation.{camel_name} to be a list of mappings")
    return list(value)


def _optional_draft_hash(metadata: dict) -> str | None:
    value = metadata.get("draftHash") or metadata.get("draft_hash")
    if value is None:
        return None
    if not isinstance(value, str) or not SHA256_HEX_RE.match(value):
        raise ValueError("Expected metadata.draftHash to be 64 lowercase hex characters")
    return value


def load_eval_manifest(path: Path | str) -> SkillEvalManifest:
    manifest_path = Path(path).expanduser().resolve()
    data = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    if data.get("apiVersion") != "comet.eval/v1alpha1":
        raise ValueError("Expected apiVersion comet.eval/v1alpha1")
    if data.get("kind") != "SkillEvalManifest":
        raise ValueError("Expected kind SkillEvalManifest")

    metadata = _require_mapping(data, "metadata")
    skill = _require_mapping(data, "skill")
    evaluation = data.get("evaluation") or {}
    interaction_data = data.get("interaction") or {}
    skill_source = skill.get("source", "..")
    route_conformance = evaluation.get("routeConformance") or {}

    return SkillEvalManifest(
        path=manifest_path,
        name=str(metadata.get("name") or skill.get("name")),
        description=str(metadata.get("description") or ""),
        skill_name=str(skill.get("name") or metadata.get("name")),
        skill_path=(manifest_path.parent / skill_source).resolve(),
        profile=skill.get("profile"),
        draft_hash=_optional_draft_hash(metadata),
        recommended_tasks=list(evaluation.get("recommendedTasks") or []),
        baseline_treatments=_optional_string_list(
            evaluation, "baselineTreatments", "baseline_treatments"
        ),
        quality_gates=_optional_mapping(evaluation, "qualityGates", "quality_gates"),
        required_output_schemas=_optional_string_list(
            evaluation, "requiredOutputSchemas", "required_output_schemas"
        ),
        expected_evidence=_optional_dict_list(
            evaluation, "expectedEvidence", "expected_evidence"
        ),
        required_skills=list(evaluation.get("requiredSkills") or []),
        expected_artifacts=list(evaluation.get("expectedArtifacts") or []),
        generated_node_skills=list(evaluation.get("generatedNodeSkills") or []),
        route_conformance_task=route_conformance.get("task"),
        route_conformance_expected_node_order=list(
            route_conformance.get("expectedNodeOrder") or []
        ),
        interaction=InteractionConfig(
            mode=interaction_data.get("mode", "none"),
            max_turns=int(interaction_data.get("maxTurns", interaction_data.get("max_turns", 12))),
            simulator_prompt=interaction_data.get("simulatorPrompt")
            or interaction_data.get("simulator_prompt"),
            fresh_resume_marker=interaction_data.get("freshResumeMarker")
            or interaction_data.get("fresh_resume_marker"),
        ),
    )
