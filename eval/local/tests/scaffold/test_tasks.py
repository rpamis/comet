"""Unit tests for the comet eval task loader."""

import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from scaffold.python.paths import get_tasks_dir
from scaffold.python.tasks import list_tasks, load_task


BASIC_TASK_TOML = """
[metadata]
name = "test-basic"
description = "A basic test task"
difficulty = "easy"
category = "testing"
tags = ["test", "basic"]
default_treatments = ["CONTROL", "COMET_FULL_040_BETA"]

[template]
required = ["run_id"]

[environment]
description = "Test environment"
dockerfile = "environment/Dockerfile"
timeout_sec = 300

[validation]
test_scripts = ["test_one.py", "test_two.py"]
target_artifacts = ["result.json"]
timeout = 45

[setup.template_vars]
artifact_name = "result-{run_id}.json"
"""


@pytest.fixture
def mock_tasks_dir(tmp_path: Path) -> Path:
    tasks_dir = tmp_path / "tasks"
    task_dir = tasks_dir / "test-basic"
    task_dir.mkdir(parents=True)
    (task_dir / "task.toml").write_text(BASIC_TASK_TOML)
    (task_dir / "instruction.md").write_text("Run {run_id} and write {artifact_name}.")

    invalid_dir = tasks_dir / "invalid"
    invalid_dir.mkdir()
    (invalid_dir / "task.toml").write_text("[metadata]\nname = 'invalid'\n")

    return tasks_dir


def test_list_tasks_returns_only_complete_task_dirs(mock_tasks_dir: Path):
    assert list_tasks(mock_tasks_dir) == ["test-basic"]


def test_load_task_parses_validation_and_setup(mock_tasks_dir: Path):
    task = load_task("test-basic", mock_tasks_dir)

    assert task.name == "test-basic"
    assert task.config.validation.test_scripts == ["test_one.py", "test_two.py"]
    assert task.config.validation.target_artifacts == ["result.json"]
    assert task.config.validation.timeout == 45
    assert task.config.setup.template_vars == {"artifact_name": "result-{run_id}.json"}


def test_load_task_parses_evaluation_and_interaction(mock_tasks_dir: Path):
    task_dir = mock_tasks_dir / "test-basic"
    task_dir.joinpath("task.toml").write_text(
        BASIC_TASK_TOML
        + """

[evaluation]
profile = "generic"
required_skills = ["target-skill"]
expected_artifacts = ["result.json"]
require_skill_invocation = true
native_terminal = "active-blocked"

[interaction]
mode = "auto_user"
max_turns = 7
simulator_prompt = "Answer as a concise developer user."
decision_patterns = ["confirm", "choose"]
decision_reply = "Use the recommended option."
continue_prompt = "Please continue."
fresh_resume_marker = "COLD_RESUME_READY"
"""
    )

    task = load_task("test-basic", mock_tasks_dir)

    assert task.config.evaluation.profile == "generic"
    assert task.config.evaluation.required_skills == ["target-skill"]
    assert task.config.evaluation.expected_artifacts == ["result.json"]
    assert task.config.evaluation.require_skill_invocation is True
    assert task.config.evaluation.native_terminal == "active-blocked"
    assert task.config.interaction.mode == "auto_user"
    assert task.config.interaction.max_turns == 7
    assert task.config.interaction.simulator_prompt == "Answer as a concise developer user."
    assert task.config.interaction.decision_patterns == ["confirm", "choose"]
    assert task.config.interaction.decision_reply == "Use the recommended option."
    assert task.config.interaction.continue_prompt == "Please continue."
    assert task.config.interaction.fresh_resume_marker == "COLD_RESUME_READY"


def test_comet_tasks_default_to_comet_workflow_profile():
    task = load_task("comet-full-workflow")

    assert task.config.evaluation.profile == "comet-workflow"
    assert task.config.interaction.mode == "auto_user"


def test_comet_task_prompt_requires_real_comet_invocation():
    task = load_task("comet-fix-median")

    prompt = task.render_prompt()

    assert prompt.startswith("## Eval harness requirement")
    assert "must begin by invoking the `/comet` Skill/slash command" in prompt
    assert "Do not simulate the Comet workflow in plain prose" in prompt


def test_render_prompt_requires_declared_template_variables(mock_tasks_dir: Path):
    task = load_task("test-basic", mock_tasks_dir)

    with pytest.raises(KeyError, match="run_id"):
        task.render_prompt(artifact_name="result-123.json")

    prompt = task.render_prompt(run_id="123", artifact_name="result-123.json")
    assert prompt == "Run 123 and write result-123.json."


def test_load_task_reads_instruction_as_utf8(mock_tasks_dir: Path):
    task_dir = mock_tasks_dir / "test-basic"
    (task_dir / "instruction.md").write_text("Fix Bob’s task {run_id}.", encoding="utf-8")

    task = load_task("test-basic", mock_tasks_dir)

    assert task.render_prompt(run_id="123", artifact_name="unused") == "Fix Bob’s task 123."


def test_comet_task_index_lists_real_tasks():
    index_path = get_tasks_dir() / "index.yaml"

    assert index_path.exists()

    index = yaml.safe_load(index_path.read_text(encoding="utf-8"))
    names = [task["name"] for task in index["tasks"]]
    assert sorted(names) == sorted(list_tasks())
    assert len(names) == 30
    assert set(names) == {
        "authoring-skill-smoke",
        "comet-agent-memory-routing",
        "comet-api-cache-ttl",
        "comet-cross-file-refactor",
        "comet-dependency-confusion",
        "comet-fix-median",
        "comet-framework-selection",
        "comet-full-workflow",
        "comet-graph-execution-review",
        "comet-human-approval-flow",
        "comet-layered-streaming-fix",
        "comet-perf-dedupe",
        "comet-persistence-threading",
        "comet-refactor-counter",
        "comet-robust-config",
        "comet-noise-distractor",
        "comet-native-workflow",
        "comet-native-clarification",
        "comet-native-clarification-modes",
        "comet-native-repository-fact",
        "comet-native-interrupted-transition",
        "comet-native-wave-b-decision-resume",
        "comet-native-wave-c-verification-integrity",
        "comet-native-wave-d-stagnation-stop",
        "comet-native-wave-e-parallel-safety",
        "comet-native-wave-f-dashboard-readonly",
        "comet-observability-env-template",
        "generic-skill-smoke",
        "workflow-overlay-contract",
        "workflow-route-conformance",
    }


def test_native_task_uses_its_own_skill_contract():
    task = load_task("comet-native-workflow")

    assert task.config.evaluation.profile == "generic"
    assert task.config.evaluation.required_skills == ["comet-native"]
    assert task.config.evaluation.require_skill_invocation is True
    assert task.config.interaction.mode == "none"
    prompt = task.render_prompt()
    assert prompt.startswith("You are working on a Python project")
    assert "Begin by invoking the `/comet-native` Skill" in prompt
    assert "/comet` Skill/slash command" not in prompt


def test_native_clarification_task_requires_one_decision_and_confirmed_resume():
    task = load_task("comet-native-clarification")

    assert task.config.evaluation.profile == "generic"
    assert task.config.evaluation.required_skills == ["comet-native"]
    assert task.config.interaction.mode == "auto_user"
    assert task.config.interaction.max_turns == 4
    assert task.config.interaction.decision_reply == (
        "Abbreviations such as e.g. and Dr. do not end a sentence; use a small explicit abbreviation list."
    )
    assert "docs/comet/specs/sentence-counting/spec.md" not in (
        task.config.evaluation.expected_artifacts
    )
    assert "verify the Native status from disk" in task.config.interaction.continue_prompt
    assert "one highest-value question" in task.config.interaction.simulator_prompt
    prompt = task.render_prompt()
    assert "Do not guess how abbreviations should behave" in prompt
    assert "Do not begin implementation before the user answers" in prompt


def test_native_clarification_modes_task_compares_batch_and_sequential():
    task = load_task("comet-native-clarification-modes")

    assert task.default_treatments == ["COMET_NATIVE_SEQUENTIAL", "COMET_NATIVE_BATCH"]
    assert task.config.evaluation.profile == "generic"
    assert task.config.evaluation.required_skills == ["comet-native"]
    assert task.config.interaction.mode == "auto_user"
    assert task.config.interaction.max_turns == 6
    assert task.config.timeout_sec == 2400
    assert task.config.interaction.decision_reply is None
    assert "answer only the questions present" in task.config.interaction.simulator_prompt.lower()
    prompt = task.render_prompt()
    assert "three independent product decisions" in prompt
    assert "Do not choose the clarification mode" in prompt


@pytest.mark.parametrize(
    ("treatment", "mode", "decision_points"),
    [
        ("COMET_NATIVE_SEQUENTIAL", "sequential", 3),
        ("COMET_NATIVE_BATCH", "batch", 2),
    ],
)
def test_native_clarification_modes_validator_accepts_expected_rounds(
    tmp_path: Path,
    treatment: str,
    mode: str,
    decision_points: int,
):
    validator_path = (
        get_tasks_dir()
        / "comet-native-clarification-modes"
        / "validation"
        / "test_native_clarification_modes.py"
    )
    spec = importlib.util.spec_from_file_location(
        "native_clarification_modes_validator", validator_path
    )
    assert spec and spec.loader
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    validator.WORKSPACE = tmp_path

    config = tmp_path / ".comet" / "config.yaml"
    config.parent.mkdir(parents=True)
    config.write_text(
        f"schema: comet.project.v1\nnative:\n  clarification_mode: {mode}\n",
        encoding="utf-8",
    )
    (tmp_path / "_test_context.json").write_text(
        json.dumps(
            {
                "treatment_name": treatment,
                "interaction": {
                    "mode": "auto_user",
                    "actual_turns": decision_points + 1,
                    "decision_points": decision_points,
                    "deterministic_replies": 0,
                },
            }
        ),
        encoding="utf-8",
    )

    assert validator.check_mode_and_interaction()["status"] == "passed"


def test_native_clarification_modes_validator_accepts_semantic_decision_wording_and_approval():
    validator_path = (
        get_tasks_dir()
        / "comet-native-clarification-modes"
        / "validation"
        / "test_native_clarification_modes.py"
    )
    spec = importlib.util.spec_from_file_location(
        "native_clarification_modes_semantic_validator", validator_path
    )
    assert spec and spec.loader
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)

    text = """
### Scenario: Empty input
Given input `""`, the function returns `0`.
### Scenario: Abbreviations do not end sentences
Known abbreviations such as `Dr.` are ignored as sentence boundaries.
### Scenario: Punctuation runs
A contiguous run of terminal punctuation (`.`, `!`, `?`) counts as exactly one boundary.
"""

    assert validator.missing_decisions(text) == []
    assert validator.approval_is_valid("sequential", "implicit") is True
    assert validator.approval_is_valid("sequential", "confirmed") is True
    assert validator.approval_is_valid("batch", "confirmed") is True
    assert validator.approval_is_valid("batch", "implicit") is False


def test_native_clarification_validator_rejects_multiple_archives(tmp_path: Path):
    validator_path = (
        get_tasks_dir() / "comet-native-clarification" / "validation" / "test_native_clarification.py"
    )
    spec = importlib.util.spec_from_file_location("native_clarification_validator", validator_path)
    assert spec and spec.loader
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    validator.WORKSPACE = tmp_path

    archive_root = tmp_path / "docs" / "comet" / "archive"
    (archive_root / "2026-07-15-first-change").mkdir(parents=True)
    current = archive_root / "2026-07-15-second-change"
    current.mkdir()
    (current / "comet-state.yaml").write_text("approval: confirmed\n", encoding="utf-8")
    (current / "brief.md").write_text("Abbreviation decision confirmed.\n", encoding="utf-8")
    canonical = tmp_path / "docs" / "comet" / "specs" / "sentence-counting" / "spec.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text("# Sentence counting\n", encoding="utf-8")

    result = validator.check_confirmed_archive()

    assert result["status"] == "failed"
    assert "exactly one Native archive" in result["reason"]


def test_native_clarification_validator_accepts_one_semantic_canonical_spec(tmp_path: Path):
    validator_path = (
        get_tasks_dir() / "comet-native-clarification" / "validation" / "test_native_clarification.py"
    )
    spec = importlib.util.spec_from_file_location("native_clarification_validator", validator_path)
    assert spec and spec.loader
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    validator.WORKSPACE = tmp_path

    archived = tmp_path / "docs" / "comet" / "archive" / "2026-07-15-add-sentences"
    archived.mkdir(parents=True)
    (archived / "comet-state.yaml").write_text(
        """schema: comet.native.v1
name: add-sentences
phase: archive
approval: confirmed
spec_changes:
  - capability: sentences
    operation: create
    source: specs/sentences/spec.md
    base_hash: null
verification_result: pass
verification_report: verification.md
archived: true
""",
        encoding="utf-8",
    )
    (archived / "brief.md").write_text(
        "# Decisions\nAbbreviations such as e.g. and Dr. do not end a sentence.\n",
        encoding="utf-8",
    )
    canonical = tmp_path / "docs" / "comet" / "specs" / "sentences" / "spec.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text(
        "# Sentence counting\nThe --sentences flag ignores e.g. and Dr. boundaries.\n",
        encoding="utf-8",
    )
    archived_spec = archived / "specs" / "sentences" / "spec.md"
    archived_spec.parent.mkdir(parents=True)
    archived_spec.write_text(canonical.read_text(encoding="utf-8"), encoding="utf-8")
    (archived / "verification.md").write_text(
        "# Commands and results\npytest: 24 passed\n# Conclusion\npass\n",
        encoding="utf-8",
    )
    trajectory = archived / "runtime" / "trajectory.jsonl"
    trajectory.parent.mkdir(parents=True)
    trajectory.write_text(
        "\n".join(
            json.dumps(
                {
                    "type": "state_transitioned",
                    "data": {"previousPhase": previous, "nextPhase": following},
                }
            )
            for previous, following in [
                ("shape", "build"),
                ("build", "verify"),
                ("verify", "archive"),
                ("archive", None),
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "_test_context.json").write_text(
        json.dumps(
            {
                "interaction": {
                    "mode": "auto_user",
                    "actual_turns": 2,
                    "max_turns": 4,
                    "decision_points": 1,
                    "deterministic_replies": 1,
                    "completion_signals": 1,
                }
            }
        ),
        encoding="utf-8",
    )

    result = validator.check_confirmed_archive()

    assert result["status"] == "passed"


def test_native_clarification_validator_rejects_leftover_active_change(tmp_path: Path):
    validator_path = (
        get_tasks_dir() / "comet-native-clarification" / "validation" / "test_native_clarification.py"
    )
    spec = importlib.util.spec_from_file_location("native_clarification_validator", validator_path)
    assert spec and spec.loader
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    validator.WORKSPACE = tmp_path

    archive = tmp_path / "docs" / "comet" / "archive" / "2026-07-15-add-sentences"
    archive.mkdir(parents=True)
    active = tmp_path / "docs" / "comet" / "changes" / "add-sentences"
    active.mkdir(parents=True)

    result = validator.check_confirmed_archive()

    assert result["status"] == "failed"
    assert "active change" in result["reason"]


def test_native_repository_fact_task_requires_investigation_without_interaction():
    task = load_task("comet-native-repository-fact")

    assert task.config.evaluation.required_skills == ["comet-native"]
    assert task.config.interaction.mode == "none"
    prompt = task.render_prompt()
    assert "already documented somewhere in this repository" in prompt
    assert "do not ask the user to repeat repository facts" in prompt


def test_native_interrupted_transition_task_requires_runtime_recovery():
    task = load_task("comet-native-interrupted-transition")

    assert task.config.evaluation.required_skills == ["comet-native"]
    assert task.config.interaction.mode == "none"
    prompt = task.render_prompt()
    assert "recover the existing `add-character-counting` change" in prompt
    assert "do not create a replacement change" in prompt


def test_native_interrupted_transition_fixture_is_recovered_by_current_runtime(tmp_path: Path):
    task = load_task("comet-native-interrupted-transition")
    workspace = tmp_path / "workspace"
    shutil.copytree(task.environment_dir, workspace)
    runtime = get_tasks_dir().parents[2] / "assets/skills/comet-native/scripts/comet-native-runtime.mjs"
    change = workspace / "docs/comet/changes/add-character-counting"

    def run_native(*args: str, expected_exit: int = 0) -> dict:
        result = subprocess.run(
            [
                "node",
                str(runtime),
                *args,
                "--json",
                "--project-root",
                str(workspace),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == expected_exit, result.stdout or result.stderr
        return json.loads(result.stdout)

    status = run_native("status", "add-character-counting")

    assert status["data"]["name"] == "add-character-counting"
    assert status["data"]["phase"] == "shape"
    assert status["data"]["migrationRequired"] is True

    repaired = run_native(
        "doctor",
        "add-character-counting",
        "--repair",
        "--strategy",
        "continue",
        expected_exit=65,
    )

    assert {finding["code"] for finding in repaired["data"]["findings"]} >= {
        "schema-migrated",
        "transition-recovered",
        "contract-changed-after-approval",
    }
    state = yaml.safe_load((change / "comet-state.yaml").read_text(encoding="utf-8"))
    assert state["phase"] == "build"
    assert state["run_id"] == "native-recovery-eval-run"
    assert not (change / "runtime/transition.json").exists()

    run_native(
        "doctor",
        "add-character-counting",
        "--repair",
        "--strategy",
        "continue",
        expected_exit=65,
    )

    events = [
        json.loads(line)
        for line in (change / "runtime/trajectory.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    recovered = [
        event
        for event in events
        if event.get("type") == "state_transitioned"
        and event.get("data", {}).get("transitionId")
        == "11111111-2222-4333-8444-555555555555"
    ]
    assert len(recovered) == 1
