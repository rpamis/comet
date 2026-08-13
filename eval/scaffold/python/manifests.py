"""Eval manifest parser for generated Skill packages."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml

from scaffold.python.agents import validate_agent_id
from scaffold.python.eval_schema import validate_manifest_schema
from scaffold.python.tasks import InteractionConfig


SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")
TASK_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
INLINE_EXPECT_KEYS = {"files", "contains", "json", "commands"}


@dataclass(frozen=True)
class ManifestTask:
    """One project-authored task reference from ``evaluation.tasks``."""

    name: str
    source: Path | None = None
    prompt: str | None = None
    workspace: Path | None = None
    expect: dict[str, Any] = field(default_factory=dict)
    rubric: list[str] = field(default_factory=list)

    @property
    def is_inline(self) -> bool:
        return self.source is None


@dataclass(frozen=True)
class ManifestExecutionConfig:
    agent: str | None = None
    model: str | None = None
    base_url: str | None = None


@dataclass(frozen=True)
class ManifestJudgeConfig:
    agent: str | None
    model: str
    base_url: str | None = None


@dataclass(frozen=True)
class ManifestReportingConfig:
    suite: str | None = None
    config: str | None = None


@dataclass(frozen=True)
class SkillEvalManifest:
    path: Path
    name: str
    description: str
    skill_name: str
    skill_path: Path
    profile: str | None = None
    draft_hash: str | None = None
    generation_hash: str | None = None
    generation_metadata_path: Path | None = None
    recommended_tasks: list[str] = field(default_factory=list)
    baseline_treatments: list[str] = field(default_factory=list)
    quality_gates: dict = field(default_factory=dict)
    required_output_schemas: list[str] = field(default_factory=list)
    expected_evidence: list[dict] = field(default_factory=list)
    required_skills: list[str] = field(default_factory=list)
    expected_artifacts: list[str | dict[str, Any]] = field(default_factory=list)
    generated_node_skills: list[str] = field(default_factory=list)
    route_conformance_task: str | None = None
    route_conformance_expected_node_order: list[str] = field(default_factory=list)
    interaction: InteractionConfig = field(default_factory=InteractionConfig)
    execution: ManifestExecutionConfig = field(default_factory=ManifestExecutionConfig)
    judge: ManifestJudgeConfig | None = None
    reporting: ManifestReportingConfig | None = None
    tasks: list[ManifestTask] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def execution_agent(self) -> str | None:
        return self.execution.agent


def _require_mapping(data: dict, field_name: str) -> dict:
    value = data.get(field_name)
    if not isinstance(value, dict):
        raise ValueError(f"Missing mapping field: {field_name}")
    return value


def _alias_value(data: dict, camel_name: str, snake_name: str, field_prefix: str) -> Any:
    """Read one public alias pair without silently discarding configuration."""
    if camel_name in data and snake_name in data:
        raise ValueError(
            f"{field_prefix}.{camel_name} and {field_prefix}.{snake_name} cannot both be set"
        )
    return data.get(camel_name, data.get(snake_name))


def _optional_string_list(data: dict, camel_name: str, snake_name: str) -> list[str]:
    value = _alias_value(data, camel_name, snake_name, "evaluation")
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Expected evaluation.{camel_name} to be a list of strings")
    return list(value)


def _optional_mapping(data: dict, camel_name: str, snake_name: str) -> dict:
    value = _alias_value(data, camel_name, snake_name, "evaluation")
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"Expected evaluation.{camel_name} to be a mapping")
    return dict(value)


def _optional_dict_list(data: dict, camel_name: str, snake_name: str) -> list[dict]:
    value = _alias_value(data, camel_name, snake_name, "evaluation")
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Expected evaluation.{camel_name} to be a list of mappings")
    return list(value)


def _optional_draft_hash(metadata: dict) -> str | None:
    value = _alias_value(metadata, "draftHash", "draft_hash", "metadata")
    if value is None:
        return None
    if value == "<current-bundle-hash>":
        return None
    if not isinstance(value, str) or not SHA256_HEX_RE.match(value):
        raise ValueError("Expected metadata.draftHash to be 64 lowercase hex characters")
    return value


def _optional_model(data: dict, field_name: str, *, required: bool = False) -> str | None:
    value = data.get("model")
    if value is None:
        if required:
            raise ValueError(f"{field_name}: is required")
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _optional_base_url(data: dict, field_prefix: str) -> str | None:
    value = _alias_value(data, "baseUrl", "base_url", field_prefix)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_prefix}.baseUrl: must be a valid absolute http(s) URL")
    try:
        parsed = urlsplit(value)
        parsed.port
        invalid = (
            value.strip() != value
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or any(character.isspace() for character in parsed.netloc)
            or parsed.username is not None
            or parsed.password is not None
            or bool(parsed.query)
            or bool(parsed.fragment)
        )
    except ValueError:
        invalid = True
    if invalid:
        raise ValueError(f"{field_prefix}.baseUrl: must be a valid absolute http(s) URL")
    return value


def _execution_config(data: dict) -> ManifestExecutionConfig:
    agent = data.get("agent")
    if agent is not None:
        agent = validate_agent_id(agent, field="manifest execution.agent")
    return ManifestExecutionConfig(
        agent=agent,
        model=_optional_model(data, "execution.model"),
        base_url=_optional_base_url(data, "execution"),
    )


def _judge_config(data: dict[str, Any] | None) -> ManifestJudgeConfig | None:
    if data is None:
        return None
    agent = data.get("agent")
    if agent is not None:
        agent = validate_agent_id(agent, field="manifest judge.agent")
    model = _optional_model(data, "judge.model", required=True)
    assert model is not None
    return ManifestJudgeConfig(
        agent=agent,
        model=model,
        base_url=_optional_base_url(data, "judge"),
    )


def _reporting_config(data: dict[str, Any] | None) -> ManifestReportingConfig | None:
    if data is None:
        return None
    suite = data.get("suite")
    if suite is not None and suite not in {"local", "langsmith", "langfuse"}:
        raise ValueError("reporting.suite must be local, langsmith, or langfuse")
    config = data.get("config")
    if config is not None and (not isinstance(config, str) or not config.strip()):
        raise ValueError("reporting.config must be a non-empty path")
    return ManifestReportingConfig(suite=suite, config=config)


def _resolve_package_path(
    value: object,
    *,
    package_root: Path,
    field_name: str,
    must_exist: bool,
) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Expected {field_name} to be a non-empty relative path")
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{field_name} must stay within the Skill package: {value!r}")
    resolved = (package_root / path).resolve()
    try:
        resolved.relative_to(package_root.resolve())
    except ValueError as exc:
        raise ValueError(f"{field_name} must stay within the Skill package: {value!r}") from exc
    if must_exist and not resolved.exists():
        raise ValueError(f"{field_name} does not exist: {value!r}")
    if resolved.is_dir():
        package_resolved = package_root.resolve()
        for child in resolved.rglob("*"):
            if not child.is_symlink():
                continue
            target = child.resolve()
            try:
                target.relative_to(package_resolved)
            except ValueError as exc:
                raise ValueError(
                    f"{field_name} contains a symlink outside the Skill package: {child.name!r}"
                ) from exc
    return resolved


def _validate_relative_artifact(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must contain non-empty relative paths")
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{field_name} must stay within the task workspace: {value!r}")
    return normalized


def _parse_inline_expect(expect: object, task_name: str) -> dict[str, Any]:
    field_prefix = f"evaluation.tasks.{task_name}.expect"
    if expect is None:
        raise ValueError(f"{field_prefix} must contain at least one deterministic expect")
    if not isinstance(expect, dict):
        raise ValueError(f"{field_prefix} must be a mapping")
    unknown = set(expect) - INLINE_EXPECT_KEYS
    if unknown:
        raise ValueError(f"{field_prefix} has unknown fields: {sorted(unknown)}")
    if not any(expect.get(key) for key in INLINE_EXPECT_KEYS):
        raise ValueError(f"{field_prefix} must contain at least one deterministic expect")

    files = expect.get("files", [])
    if not isinstance(files, list) or not all(isinstance(item, str) for item in files):
        raise ValueError(f"{field_prefix}.files must be a list of strings")
    normalized_files = [
        _validate_relative_artifact(item, f"{field_prefix}.files") for item in files
    ]

    contains = expect.get("contains", {})
    if not isinstance(contains, dict):
        raise ValueError(f"{field_prefix}.contains must be a mapping")
    normalized_contains: dict[str, list[str]] = {}
    for file_name, values in contains.items():
        safe_file = _validate_relative_artifact(file_name, f"{field_prefix}.contains")
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            raise ValueError(f"{field_prefix}.contains.{file_name} must be a list of strings")
        normalized_contains[safe_file] = list(values)

    json_checks = expect.get("json", [])
    if not isinstance(json_checks, list) or not all(isinstance(item, dict) for item in json_checks):
        raise ValueError(f"{field_prefix}.json must be a list of mappings")
    normalized_json = []
    for index, item in enumerate(json_checks):
        file_name = _validate_relative_artifact(
            item.get("file"), f"{field_prefix}.json[{index}].file"
        )
        json_path = item.get("path")
        if not isinstance(json_path, str) or not json_path.startswith("$"):
            raise ValueError(f"{field_prefix}.json[{index}].path must start with '$'")
        if "equals" not in item:
            raise ValueError(f"{field_prefix}.json[{index}].equals is required")
        normalized_json.append({"file": file_name, "path": json_path, "equals": item["equals"]})

    commands = expect.get("commands", [])
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        raise ValueError(f"{field_prefix}.commands must be a list of mappings")
    normalized_commands = []
    for index, item in enumerate(commands):
        command = item.get("run")
        if not isinstance(command, str) or not command.strip():
            raise ValueError(f"{field_prefix}.commands[{index}].run is required")
        timeout = item.get("timeout", 120)
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 3600:
            raise ValueError(f"{field_prefix}.commands[{index}].timeout must be 1..3600")
        normalized_commands.append({"run": command, "timeout": timeout})

    return {
        "files": normalized_files,
        "contains": normalized_contains,
        "json": normalized_json,
        "commands": normalized_commands,
    }


def _source_task_name(source: Path, task_name: object) -> str:
    name = task_name
    if name is None:
        try:
            from scaffold.python.tasks import load_task_from_path

            name = load_task_from_path(source).name
        except (FileNotFoundError, OSError, ValueError, KeyError, TypeError, OverflowError) as exc:
            raise ValueError(f"evaluation.tasks source task.toml is invalid: {source}") from exc
    else:
        # Aliases still point at a normal task package; validate it with the
        # same loader used by the execution path before applying the alias.
        name = task_name
        try:
            from scaffold.python.tasks import load_task_from_path

            load_task_from_path(source)
        except (FileNotFoundError, OSError, ValueError, KeyError, TypeError, OverflowError) as exc:
            raise ValueError(f"evaluation.tasks source task.toml is invalid: {source}") from exc
    if not isinstance(name, str) or not TASK_NAME_RE.fullmatch(name):
        raise ValueError(f"Invalid evaluation task name: {name!r}")
    return name


def _parse_manifest_tasks(evaluation: dict, package_root: Path) -> list[ManifestTask]:
    raw_tasks = evaluation.get("tasks") or []
    if not isinstance(raw_tasks, list):
        raise ValueError("Expected evaluation.tasks to be a list")
    tasks: list[ManifestTask] = []
    names: set[str] = set()
    for index, raw in enumerate(raw_tasks):
        field_prefix = f"evaluation.tasks[{index}]"
        if not isinstance(raw, dict):
            raise ValueError(f"{field_prefix} must be a mapping")
        source_value = raw.get("source")
        if source_value is not None:
            if set(raw) - {"source", "name"}:
                raise ValueError(f"{field_prefix} source tasks cannot define inline fields")
            source = _resolve_package_path(
                source_value,
                package_root=package_root,
                field_name=f"{field_prefix}.source",
                must_exist=True,
            )
            if (
                not source.is_dir()
                or not (source / "task.toml").is_file()
                or not (source / "instruction.md").is_file()
            ):
                raise ValueError(
                    f"{field_prefix}.source must point to a task package with task.toml and instruction.md"
                )
            name = _source_task_name(source, raw.get("name"))
            task = ManifestTask(name=name, source=source)
        else:
            unknown = set(raw) - {"name", "prompt", "workspace", "expect", "rubric"}
            if unknown:
                raise ValueError(f"{field_prefix} has unknown fields: {sorted(unknown)}")
            name = raw.get("name")
            if not isinstance(name, str) or not TASK_NAME_RE.fullmatch(name):
                raise ValueError(f"{field_prefix}.name must be a valid task name")
            prompt = raw.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError(f"{field_prefix}.prompt is required")
            workspace_value = raw.get("workspace")
            workspace = (
                _resolve_package_path(
                    workspace_value,
                    package_root=package_root,
                    field_name=f"{field_prefix}.workspace",
                    must_exist=True,
                )
                if workspace_value is not None
                else None
            )
            task = ManifestTask(
                name=name,
                prompt=prompt,
                workspace=workspace,
                expect=_parse_inline_expect(raw.get("expect"), name),
                rubric=raw.get("rubric", []),
            )
            if not isinstance(task.rubric, list) or not all(
                isinstance(item, str) and item.strip() for item in task.rubric
            ):
                raise ValueError(f"{field_prefix}.rubric must be a list of non-empty strings")
        if task.name in names:
            first_index = next(item_index for item_index, item in enumerate(tasks) if item.name == task.name)
            raise ValueError(
                f'evaluation.tasks[{index}].name duplicates evaluation.tasks[{first_index}].name: "{task.name}"'
            )
        names.add(task.name)
        tasks.append(task)
    return tasks


def load_eval_manifest(path: Path | str) -> SkillEvalManifest:
    manifest_path = Path(path).expanduser().resolve()
    data = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("manifest: must be a mapping")
    if data.get("apiVersion") != "comet.eval/v1alpha1":
        raise ValueError("Expected apiVersion comet.eval/v1alpha1")
    if data.get("kind") != "SkillEvalManifest":
        raise ValueError("Expected kind SkillEvalManifest")
    validate_manifest_schema(data)
    metadata = _require_mapping(data, "metadata")
    skill = _require_mapping(data, "skill")
    evaluation = data.get("evaluation") or {}
    if not isinstance(evaluation, dict):
        raise ValueError("Expected evaluation to be a mapping")
    interaction_data = data.get("interaction") or {}
    if not isinstance(interaction_data, dict):
        raise ValueError("Expected interaction to be a mapping")
    execution_data = data.get("execution") or {}
    if not isinstance(execution_data, dict):
        raise ValueError("Expected execution to be a mapping")
    judge_data = data.get("judge") if "judge" in data else None
    if judge_data is not None and not isinstance(judge_data, dict):
        raise ValueError("Expected judge to be a mapping")
    reporting_data = data.get("reporting") if "reporting" in data else None
    if reporting_data is not None and not isinstance(reporting_data, dict):
        raise ValueError("Expected reporting to be a mapping")
    skill_source = skill.get("source", "..")
    if not isinstance(skill_source, str):
        raise ValueError("Expected skill.source to be a relative path")
    skill_path = (manifest_path.parent / skill_source).resolve()
    package_root = skill_path
    route_conformance = (
        _alias_value(evaluation, "routeConformance", "route_conformance", "evaluation") or {}
    )
    if not isinstance(route_conformance, dict):
        raise ValueError("Expected evaluation.routeConformance to be a mapping")
    recommended_tasks = _optional_string_list(evaluation, "recommendedTasks", "recommended_tasks")
    seen_recommended: dict[str, int] = {}
    for index, task_name in enumerate(recommended_tasks):
        if task_name in seen_recommended:
            raise ValueError(
                f'evaluation.recommendedTasks[{index}] duplicates '
                f'evaluation.recommendedTasks[{seen_recommended[task_name]}]: "{task_name}"'
            )
        seen_recommended[task_name] = index

    interaction_mode = interaction_data.get("mode", "none")
    if interaction_mode not in {"none", "auto_user"}:
        raise ValueError("interaction.mode must be none or auto_user")
    max_turns = _alias_value(interaction_data, "maxTurns", "max_turns", "interaction")
    if max_turns is None:
        max_turns = 12
    if isinstance(max_turns, bool) or not isinstance(max_turns, int) or max_turns < 1:
        raise ValueError("interaction.maxTurns must be a positive integer")

    generation_hash_value = _alias_value(
        metadata, "generationHash", "generation_hash", "metadata"
    )
    generation_file_value = _alias_value(
        metadata, "generationFile", "generation_file", "metadata"
    )
    expected_artifacts_value = _alias_value(
        evaluation, "expectedArtifacts", "expected_artifacts", "evaluation"
    )
    return SkillEvalManifest(
        path=manifest_path,
        name=str(metadata.get("name") or skill.get("name")),
        description=str(metadata.get("description") or ""),
        skill_name=str(skill.get("name") or metadata.get("name")),
        skill_path=skill_path,
        profile=skill.get("profile"),
        draft_hash=_optional_draft_hash(metadata),
        generation_hash=generation_hash_value if isinstance(generation_hash_value, str) else None,
        generation_metadata_path=(
            (manifest_path.parent / generation_file_value).resolve()
            if isinstance(generation_file_value, str)
            else None
        ),
        recommended_tasks=recommended_tasks,
        baseline_treatments=_optional_string_list(
            evaluation, "baselineTreatments", "baseline_treatments"
        ),
        quality_gates=_optional_mapping(evaluation, "qualityGates", "quality_gates"),
        required_output_schemas=_optional_string_list(
            evaluation, "requiredOutputSchemas", "required_output_schemas"
        ),
        expected_evidence=_optional_dict_list(evaluation, "expectedEvidence", "expected_evidence"),
        required_skills=_optional_string_list(evaluation, "requiredSkills", "required_skills"),
        expected_artifacts=list(expected_artifacts_value or []),
        generated_node_skills=_optional_string_list(
            evaluation, "generatedNodeSkills", "generated_node_skills"
        ),
        route_conformance_task=route_conformance.get("task"),
        route_conformance_expected_node_order=list(
            _alias_value(
                route_conformance,
                "expectedNodeOrder",
                "expected_node_order",
                "evaluation.routeConformance",
            )
            or []
        ),
        interaction=InteractionConfig(
            mode=interaction_mode,
            max_turns=max_turns,
            simulator_prompt=_alias_value(
                interaction_data, "simulatorPrompt", "simulator_prompt", "interaction"
            ),
            decision_patterns=list(interaction_data.get("decisionPatterns") or []),
            decision_reply=interaction_data.get("decisionReply"),
            decision_replies=list(interaction_data.get("decisionReplies") or []),
            continue_prompt=interaction_data.get(
                "continuePrompt", "Please continue with the next phase of the workflow."
            ),
            fresh_resume_marker=_alias_value(
                interaction_data, "freshResumeMarker", "fresh_resume_marker", "interaction"
            ),
        ),
        execution=_execution_config(execution_data),
        judge=_judge_config(judge_data),
        reporting=_reporting_config(reporting_data),
        tasks=_parse_manifest_tasks(evaluation, package_root),
        raw=copy.deepcopy(data),
    )
