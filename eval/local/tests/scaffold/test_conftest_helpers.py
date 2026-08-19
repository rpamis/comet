"""Tests for pytest fixture helper behavior."""

import importlib.util
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import conftest
import pytest
from scaffold.python.tasks import load_task
from scaffold.python.treatments import build_treatment_skills, load_treatments

if sys.platform == "win32":
    import msvcrt
else:
    msvcrt = None


def test_file_lock_context_manager_allows_exclusive_writes(tmp_path: Path):
    lock_file = tmp_path / "coordination.lock"
    data_file = tmp_path / "coordination.txt"

    with conftest.file_lock(lock_file):
        data_file.write_text("held")

    assert data_file.read_text() == "held"


@pytest.mark.skipif(msvcrt is None, reason="Windows locking API only")
def test_file_lock_waits_when_windows_lock_is_temporarily_busy(tmp_path: Path, monkeypatch):
    lock_file = tmp_path / "coordination.lock"
    real_locking = msvcrt.locking
    attempts = 0

    def flaky_locking(fd, mode, size):
        nonlocal attempts
        if mode == msvcrt.LK_NBLCK and attempts < 2:
            attempts += 1
            raise OSError(36, "Resource deadlock avoided")
        return real_locking(fd, mode, size)

    monkeypatch.setattr(msvcrt, "locking", flaky_locking)

    with conftest.file_lock(lock_file, timeout=1):
        assert attempts == 2


@pytest.mark.skipif(msvcrt is None, reason="Windows locking API only")
def test_file_lock_does_not_retry_non_contention_windows_errors(tmp_path: Path, monkeypatch):
    lock_file = tmp_path / "coordination.lock"
    attempts = 0

    def broken_locking(_fd, _mode, _size):
        nonlocal attempts
        attempts += 1
        raise OSError(22, "Invalid argument")

    monkeypatch.setattr(msvcrt, "locking", broken_locking)

    with pytest.raises(OSError, match="Invalid argument"):
        with conftest.file_lock(lock_file, timeout=1):
            pass
    assert attempts == 1


def test_unit_test_detection_handles_scaffold_and_script_paths():
    class Config:
        args = ["local/tests/scaffold/test_tasks.py", "-q"]

    assert conftest._is_unit_tests_only(Config()) is True


def test_unit_test_detection_keeps_task_runs_as_experiments():
    class Config:
        args = ["local/tests/tasks/test_tasks.py", "--task=comet-hotfix"]

    assert conftest._is_unit_tests_only(Config()) is False


def test_experiment_id_uses_explicit_comet_eval_run_id(monkeypatch):
    monkeypatch.setenv("COMET_EVAL_EXPERIMENT_ID", "comet-eval-1234")

    assert conftest._get_or_create_experiment_id("ignored", False) == "comet-eval-1234"
    assert conftest._get_or_create_experiment_id("ignored", True) == "comet-eval-1234"


def test_experiment_id_rejects_unsafe_explicit_value(monkeypatch):
    monkeypatch.setenv("COMET_EVAL_EXPERIMENT_ID", "../escape")

    with pytest.raises(ValueError, match="COMET_EVAL_EXPERIMENT_ID"):
        conftest._get_or_create_experiment_id("ignored", False)


def test_auto_generation_loads_environment_before_resolving_cache_identity(
    tmp_path: Path, monkeypatch
):
    skill = tmp_path / "skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text("Evaluate me.\n", encoding="utf-8")
    captured = {}

    def load_environment():
        monkeypatch.setenv("BENCH_CODEX_MODEL", "model-from-dotenv")

    def generate_manifest(_skill_path, _project_root, **kwargs):
        captured.update(kwargs)
        manifest_path = tmp_path / "generated.yaml"
        manifest_path.write_text(
            """apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata: {name: generated}
skill: {name: generated, source: .}
evaluation:
  tasks:
    - name: generated-one
      prompt: one
      expect: {files: [one.md]}
    - name: generated-two
      prompt: two
      expect: {files: [two.md]}
""",
            encoding="utf-8",
        )
        return SimpleNamespace(manifest_path=manifest_path)

    options = {
        "--task": None,
        "--quick": False,
        "--eval-manifest": None,
        "--skill-path": str(skill),
        "--profile": None,
        "--project-root": str(tmp_path),
        "--agent": "codex",
        "--skill-name": None,
    }

    class Config:
        option = SimpleNamespace(collectonly=False, eval_manifest=None)

        @staticmethod
        def getoption(name):
            return options[name]

    monkeypatch.setattr("scaffold.python.utils.load_eval_environment", load_environment)
    monkeypatch.setattr(conftest, "ensure_generated_manifest", generate_manifest)

    config = Config()
    conftest._ensure_auto_generated_manifest(config)

    assert captured["agent"] == "codex"
    assert captured["model"] == "model-from-dotenv"
    assert config.option.eval_manifest is None
    assert config._comet_frozen_task_set.source == "generated-cache"


def test_taskless_collect_only_marks_generation_pending_without_agent_or_disk_work(
    tmp_path: Path, monkeypatch
):
    skill = tmp_path / "skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text("Evaluate me.\n", encoding="utf-8")
    called = False

    def fail_generation(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("task generation must not run during collect-only")

    class Config:
        option = SimpleNamespace(collectonly=True, eval_manifest=None, skill_name=None)

        @staticmethod
        def getoption(name):
            return {
                "--task": None,
                "--quick": False,
                "--eval-manifest": None,
                "--skill-path": str(skill),
                "--profile": None,
                "--project-root": str(tmp_path),
                "--agent": None,
                "--skill-name": None,
            }[name]

    monkeypatch.setattr(conftest, "ensure_generated_manifest", fail_generation)
    config = Config()
    conftest._ensure_auto_generated_manifest(config)

    assert called is False
    assert config._comet_frozen_task_set.source == "pending-generation"
    assert config._comet_frozen_task_set.tasks == ()
    assert config._comet_resolution_manifest.skill_path == skill.resolve()
    assert config._comet_resolution_manifest.path == skill / "comet" / "eval.yaml"
    assert config._comet_resolved_tasks == {}

    from local.tests.tasks import test_tasks

    monkeypatch.setattr(test_tasks, "load_treatments", lambda: {})
    monkeypatch.setattr(test_tasks, "list_tasks", lambda: [])
    frozen = config._comet_frozen_task_set
    assert test_tasks.generate_test_params(None, None, config) == []
    assert test_tasks.generate_test_params(None, None, config) == []
    assert config._comet_frozen_task_set is frozen


def test_selected_agent_missing_credentials_fails_before_workloads():
    with pytest.raises(pytest.UsageError, match="Credentials for codebuddy not set"):
        conftest._require_agent_credentials("codebuddy", {})

    conftest._require_agent_credentials("codebuddy", {"CODEBUDDY_API_KEY": "configured"})


def test_extract_loop_turns_reads_driver_completion_line():
    stderr = (
        "[loop] turn 1/4\n"
        "[loop] decision point detected; simulating user reply\n"
        "[loop] deterministic decision reply applied\n"
        "[loop] workflow completion detected; ending\n"
        "[loop] finished after 3 turns\n"
    )

    assert conftest._extract_loop_turns(stderr) == 3
    assert conftest._extract_loop_interaction(stderr) == {
        "actual_turns": 3,
        "decision_points": 1,
        "deterministic_replies": 1,
        "completion_signals": 1,
        "fresh_resume_boundaries": 0,
        "role_sessions": {"subject": [], "simulator": [], "judge": []},
    }


def test_extract_loop_interaction_records_isolated_role_sessions():
    interaction = conftest._extract_loop_interaction(
        "[loop] role-session subject subject-1\n"
        "[loop] role-session simulator simulator-1\n"
        "[loop] role-session subject subject-1\n"
    )

    assert interaction["role_sessions"] == {
        "subject": ["subject-1"],
        "simulator": ["simulator-1"],
        "judge": [],
    }
    assert conftest._extract_loop_turns("ordinary stderr") is None


def test_extract_subject_turn_evidence_groups_results_and_tool_calls():
    stdout = "\n".join(
        [
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {"type": "text", "text": "Investigating."},
                            {
                                "type": "tool_use",
                                "id": "read-1",
                                "name": "Read",
                                "input": {"file_path": "x"},
                            },
                            {
                                "type": "tool_use",
                                "id": "bash-1",
                                "name": "Bash",
                                "input": {"command": "AUTH_TOKEN=topsecret cat > wordcount.py"},
                            },
                            {
                                "type": "tool_use",
                                "id": "edit-failed",
                                "name": "Edit",
                                "input": {"file_path": "sentence.py"},
                            },
                            {
                                "type": "tool_use",
                                "id": "bash-failed",
                                "name": "Bash",
                                "input": {"command": "cat > fallback.py"},
                            },
                        ]
                    },
                }
            ),
            json.dumps(
                {
                    "type": "user",
                    "message": {
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "read-1",
                                "content": "source",
                            },
                            {
                                "type": "tool_result",
                                "tool_use_id": "bash-1",
                                "content": "updated",
                            },
                            {
                                "type": "tool_result",
                                "tool_use_id": "edit-failed",
                                "content": "permission denied",
                                "is_error": True,
                            },
                            {
                                "type": "tool_result",
                                "tool_use_id": "bash-failed",
                                "content": "Process exited with code 1",
                            },
                        ]
                    },
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "subtype": "success",
                    "result": "[blocking] QUESTION\nShould empty input return zero?",
                }
            ),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "write-1",
                                "name": "Write",
                                "input": {"file_path": "y"},
                            },
                            {
                                "type": "text",
                                "text": "Implementation completed through archive.",
                            },
                        ]
                    },
                }
            ),
            json.dumps(
                {
                    "type": "user",
                    "message": {
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "write-1",
                                "content": "created",
                            }
                        ]
                    },
                }
            ),
            json.dumps(
                {
                    "type": "result",
                    "subtype": "success",
                    "result": "",
                }
            ),
        ]
    )

    assert conftest._extract_subject_turn_evidence(stdout) == [
        {
            "turn": 1,
            "result": "[blocking] QUESTION\nShould empty input return zero?",
            "tool_calls": [
                {"name": "Read", "success": True, "path": "x"},
                {
                    "name": "Bash",
                    "success": True,
                    "command": "AUTH_TOKEN=[REDACTED] cat > wordcount.py",
                },
                {
                    "name": "Edit",
                    "success": False,
                    "path": "sentence.py",
                },
                {
                    "name": "Bash",
                    "success": False,
                    "command": "cat > fallback.py",
                },
            ],
        },
        {
            "turn": 2,
            "result": "Implementation completed through archive.",
            "tool_calls": [{"name": "Write", "success": True, "path": "y"}],
        },
    ]


def test_capture_execution_identity_separates_runtime_image_from_safe_report(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://private-routing.example")
    runtime_image_id = "sha256:" + "a" * 64
    raw = {
        "schema": "comet.eval.execution-identity.v1",
        "runtime_image_id": runtime_image_id,
        "image_id_hash": "sha256:" + hashlib.sha256(runtime_image_id.encode()).hexdigest(),
        "image_repo_digests_hash": "sha256:" + "c" * 64,
        "image_ref_hash": "sha256:" + "d" * 64,
        "claude_tool_version_hash": "sha256:" + "e" * 64,
    }
    calls = []

    def fake_run_shell(*args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, json.dumps(raw), "")

    monkeypatch.setattr(conftest, "run_shell", fake_run_shell)
    interaction = SimpleNamespace(
        mode="auto_user",
        max_turns=3,
        simulator_prompt="secret simulator text",
        decision_patterns=[],
        decision_reply=None,
        continue_prompt="continue privately",
        fresh_resume_marker=None,
    )

    captured = conftest._capture_execution_identity(
        tmp_path,
        model="private-model",
        interaction=interaction,
    )

    assert captured.runtime_image_id == runtime_image_id
    serialized = json.dumps(captured.report_identity)
    assert runtime_image_id not in serialized
    assert "private-model" not in serialized
    assert "secret simulator text" not in serialized
    assert "private-routing.example" not in serialized
    assert captured.report_identity["claude_tool_version_hash"] == "sha256:" + "e" * 64
    assert calls[0][0][:2] == ("docker.sh", "execution-identity")


def test_expected_case_matrix_collection_and_xdist_safe_persistence(tmp_path: Path):
    def item(task: str, treatment: str, rep: int):
        marker = SimpleNamespace(kwargs={"repetition": rep})
        return SimpleNamespace(
            callspec=SimpleNamespace(params={"task_name": task, "treatment_name": treatment}),
            get_closest_marker=lambda name: marker if name == "eval_case" else None,
        )

    cases = conftest._expected_cases_from_items(
        [item("task-b", "BASE", 2), item("task-a", "CANDIDATE", 1)]
    )
    from scaffold.python.aligned_comparison import (
        EXPECTED_CASE_MATRIX_FILENAME,
        expected_case_matrix_payload,
    )

    payload = expected_case_matrix_payload(cases)
    conftest._persist_expected_case_matrix(tmp_path, payload)
    conftest._persist_expected_case_matrix(tmp_path, payload)

    persisted = json.loads((tmp_path / EXPECTED_CASE_MATRIX_FILENAME).read_text(encoding="utf-8"))
    assert persisted == payload
    assert persisted["cases"] == [
        {"task": "task-a", "treatment": "CANDIDATE", "rep": 1},
        {"task": "task-b", "treatment": "BASE", "rep": 2},
    ]

    conflicting = expected_case_matrix_payload([("task-a", "CANDIDATE", 2)])
    with pytest.raises(RuntimeError, match="different expected case matrices"):
        conftest._persist_expected_case_matrix(tmp_path, conflicting)


def test_experiment_plugin_persists_expected_matrix_from_collection(tmp_path: Path):
    marker = SimpleNamespace(kwargs={"repetition": 3})
    item = SimpleNamespace(
        callspec=SimpleNamespace(params={"task_name": "task-a", "treatment_name": "NATIVE"}),
        get_closest_marker=lambda name: marker if name == "eval_case" else None,
    )
    plugin = conftest.ExperimentPlugin(SimpleNamespace(option=SimpleNamespace(numprocesses=0)))
    plugin.logger = SimpleNamespace(base_dir=tmp_path, metadata={})

    plugin.pytest_collection_finish(SimpleNamespace(items=[item]))

    metadata = plugin.logger.metadata["expected_case_matrix"]
    assert metadata["case_count"] == 1
    matrix = json.loads((tmp_path / metadata["path"]).read_text(encoding="utf-8"))
    assert matrix["cases"] == [{"task": "task-a", "treatment": "NATIVE", "rep": 3}]


def test_auto_user_prompt_paths_bypass_msys_path_conversion():
    source = (Path(__file__).resolve().parents[1] / "conftest.py").read_text(encoding="utf-8")

    assert '"@//workspace/.eval-task-prompt.txt"' in source
    assert '"//workspace/.eval-simulator-prompt.txt"' in source
    assert "and not interaction.decision_reply" in source
    assert "and not interaction.decision_replies" in source


def test_dynamic_treatment_config_from_skill_path(tmp_path: Path):
    skill_dir = tmp_path / "demo-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo-skill\ndescription: Demo.\n---\n\nDemo body.",
        encoding="utf-8",
    )

    class Config:
        def getoption(self, name):
            values = {
                "--skill-path": str(skill_dir),
                "--skill-name": "demo-skill",
                "--profile": "generic",
                "--quick": True,
            }
            return values.get(name)

    cfg = conftest._get_dynamic_treatment_config(Config())

    assert cfg.name == "DYNAMIC_SKILL"
    assert cfg.description == "Dynamic Skill target: demo-skill"
    assert cfg.skills == [
        {
            "name": "demo-skill",
            "source": "path",
            "path": str(skill_dir),
            "profile": "generic",
        }
    ]


def test_resolve_interaction_config_prefers_cli_mode():
    task = load_task("comet-full-workflow")

    class Config:
        def getoption(self, name):
            values = {
                "--interaction-mode": "none",
                "--max-turns": "5",
                "--simulator-prompt": "Use CLI override.",
            }
            return values.get(name)

    interaction = conftest._resolve_interaction_config(task, "comet-workflow", Config())

    assert interaction.mode == "none"
    assert interaction.max_turns == 5
    assert interaction.simulator_prompt == "Use CLI override."


def test_resolve_interaction_config_uses_profile_default_prompt():
    task = load_task("comet-full-workflow")

    class Config:
        def getoption(self, name):
            return {
                "--interaction-mode": "auto_user",
                "--max-turns": None,
                "--simulator-prompt": None,
            }.get(name)

    interaction = conftest._resolve_interaction_config(task, "generic", Config())

    assert interaction.mode == "auto_user"
    assert interaction.max_turns == 12
    assert interaction.simulator_prompt is not None


def test_resolve_interaction_config_preserves_task_simulator_prompt(monkeypatch):
    task = load_task("comet-native-clarification-modes")
    monkeypatch.delenv("BENCH_SIMULATOR_PROMPT_FILE", raising=False)

    class Config:
        def getoption(self, name):
            return {
                "--interaction-mode": None,
                "--max-turns": None,
                "--simulator-prompt": None,
            }.get(name)

    interaction = conftest._resolve_interaction_config(task, "generic", Config())

    assert interaction.simulator_prompt == task.config.interaction.simulator_prompt


def test_resolve_interaction_config_allows_explicit_prompt_file_override(
    tmp_path: Path, monkeypatch
):
    task = load_task("comet-native-clarification-modes")
    prompt_file = tmp_path / "simulator.md"
    prompt_file.write_text("Use the explicit simulator.", encoding="utf-8")
    monkeypatch.setenv("BENCH_SIMULATOR_PROMPT_FILE", str(prompt_file))

    class Config:
        def getoption(self, name):
            return {
                "--interaction-mode": None,
                "--max-turns": None,
                "--simulator-prompt": None,
            }.get(name)

    interaction = conftest._resolve_interaction_config(task, "generic", Config())

    assert interaction.simulator_prompt == "Use the explicit simulator."


def test_build_eval_claude_md_injects_comet_workflow_contract():
    claude_md = conftest._build_eval_claude_md("comet-workflow")

    assert claude_md is not None
    assert "invoking the `/comet` Skill/slash command" in claude_md
    assert "nested Comet stage Skill" in claude_md
    assert "OpenSpec or Superpowers dependency Skill" in claude_md
    assert "Do not simulate the Comet workflow" in claude_md
    assert conftest.COMET_WORKFLOW_CLAUDE_MD_PATH.exists()


def test_build_eval_claude_md_preserves_treatment_guidance():
    claude_md = conftest._build_eval_claude_md("comet-workflow", "Extra guidance.")

    assert claude_md is not None
    assert "Extra guidance." in claude_md


def test_build_eval_claude_md_skips_generic_profile_without_treatment_guidance():
    assert conftest._build_eval_claude_md("generic") is None


def test_setup_test_context_copies_full_skill_package_and_configures_040_hook(
    tmp_path: Path, setup_test_context
):
    source_dir = tmp_path / "comet-source"
    source_dir.mkdir()
    (source_dir / "SKILL.md").write_text("---\nname: comet\n---\n\nOriginal.", encoding="utf-8")
    (source_dir / "rules").mkdir()
    (source_dir / "rules" / "comet-phase-guard.md").write_text("rule", encoding="utf-8")
    (source_dir / "reference").mkdir()
    (source_dir / "reference" / "scripts.md").write_text("ref", encoding="utf-8")
    (source_dir / "runtime" / "classic").mkdir(parents=True)
    (source_dir / "runtime" / "classic" / "skill.yaml").write_text("runtime", encoding="utf-8")
    scripts_dir = source_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "comet-hook-guard.mjs").write_text("process.exit(0);", encoding="utf-8")

    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.json").write_text(
        json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "stop"}]}]}}),
        encoding="utf-8",
    )

    setup_test_context(
        skills={
            "comet": {
                "sections": ["---\nname: comet\n---\n\nGenerated."],
                "scripts_dir": scripts_dir,
                "source_dir": source_dir,
            }
        }
    )

    installed = tmp_path / ".claude" / "skills" / "comet"
    assert (installed / "rules" / "comet-phase-guard.md").exists()
    assert (installed / "reference" / "scripts.md").exists()
    assert (installed / "runtime" / "classic" / "skill.yaml").exists()
    assert "Generated." in (installed / "SKILL.md").read_text(encoding="utf-8")

    settings = json.loads((tmp_path / ".claude" / "settings.json").read_text(encoding="utf-8"))
    assert "Stop" in settings["hooks"]
    pre_tool_use = settings["hooks"]["PreToolUse"]
    assert pre_tool_use == [
        {
            "matcher": "Write|Edit|MultiEdit",
            "hooks": [
                {
                    "type": "command",
                    "command": "node /workspace/.claude/skills/comet/scripts/comet-hook-guard.mjs",
                }
            ],
        }
    ]


def test_setup_test_context_configures_039_shell_hook(tmp_path: Path, setup_test_context):
    source_dir = tmp_path / "comet-source"
    source_dir.mkdir()
    (source_dir / "SKILL.md").write_text("---\nname: comet\n---\n\nBody.", encoding="utf-8")
    scripts_dir = source_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "comet-hook-guard.sh").write_text(
        "#!/usr/bin/env bash\nexit 0\n", encoding="utf-8"
    )

    setup_test_context(
        skills={
            "comet": {
                "sections": ["---\nname: comet\n---\n\nBody."],
                "scripts_dir": scripts_dir,
                "source_dir": source_dir,
            }
        }
    )

    settings = json.loads((tmp_path / ".claude" / "settings.json").read_text(encoding="utf-8"))
    command = settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
    assert command == "bash /workspace/.claude/skills/comet/scripts/comet-hook-guard.sh"


def test_setup_test_context_excludes_comet_runtime_state_from_skill_copy(
    tmp_path: Path, setup_test_context
):
    source_dir = tmp_path / "comet-source"
    source_dir.mkdir()
    (source_dir / "SKILL.md").write_text("---\nname: comet\n---\n\nOriginal.", encoding="utf-8")
    runtime_state = source_dir / ".comet" / "eval" / "cache" / "uv"
    runtime_state.mkdir(parents=True)
    (runtime_state / "long-wheel.lock").write_text("cached", encoding="utf-8")

    setup_test_context(
        skills={
            "comet": {
                "sections": ["---\nname: comet\n---\n\nGenerated."],
                "source_dir": source_dir,
            }
        }
    )

    installed = tmp_path / ".claude" / "skills" / "comet"
    assert (installed / "SKILL.md").exists()
    assert not (installed / ".comet").exists()


def test_codex_guard_uses_codex_hook_config_while_scripts_remain_under_agents(tmp_path: Path):
    command = "node /workspace/.agents/skills/comet/scripts/comet-hook-guard.mjs"

    conftest._ensure_agent_pre_tool_hook(tmp_path, "codex", command)

    hooks_path = tmp_path / ".codex" / "hooks.json"
    hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
    assert hooks["hooks"]["PreToolUse"][0]["hooks"][0]["command"] == command
    assert not (tmp_path / ".agents" / "hooks.json").exists()


def test_transcript_setup_failure_is_best_effort(tmp_path: Path, monkeypatch, capsys):
    monkeypatch.setenv("TRACE_TO_LANGFUSE", "true")
    monkeypatch.delenv("LANGFUSE_TRANSCRIPT_SETUP_WARNING_EMITTED", raising=False)
    monkeypatch.setattr(
        conftest,
        "install_transcript_hook",
        lambda *_args: (_ for _ in ()).throw(ValueError("invalid settings")),
    )

    conftest._ensure_langfuse_trajectory_support(tmp_path, "codebuddy")

    assert "optional codebuddy transcript setup skipped" in capsys.readouterr().err


def test_setup_test_context_writes_codebuddy_project_memory(
    tmp_path: Path,
    setup_test_context,
    monkeypatch,
):
    monkeypatch.setattr(
        conftest,
        "_resolve_eval_agent",
        lambda _config: SimpleNamespace(agent="codebuddy"),
    )

    setup_test_context(claude_md="Use the CodeBuddy workflow.")

    memory = tmp_path / ".codebuddy" / "CODEBUDDY.md"
    assert memory.read_text(encoding="utf-8") == "Use the CodeBuddy workflow."
    assert not (tmp_path / "AGENTS.md").exists()


def test_setup_test_context_copies_dependency_skill_packages_with_scripts(
    tmp_path: Path, setup_test_context
):
    skills = build_treatment_skills(load_treatments()["COMET_FULL_040_BETA"].skills)
    setup_test_context(
        skills={
            name: skills[name]
            for name in [
                "brainstorming",
                "subagent-driven-development",
                "writing-skills",
                "openspec-new-change",
            ]
        }
    )

    installed = tmp_path / ".claude" / "skills"
    assert (installed / "brainstorming" / "scripts" / "helper.js").exists()
    assert (installed / "brainstorming" / "visual-companion.md").exists()
    assert (installed / "subagent-driven-development" / "scripts" / "review-package").exists()
    assert (installed / "subagent-driven-development" / "task-reviewer-prompt.md").exists()
    assert (installed / "writing-skills" / "examples" / "CLAUDE_MD_TESTING.md").exists()
    assert (installed / "openspec-new-change" / "SKILL.md").exists()


def test_dynamic_treatment_config_from_eval_manifest(tmp_path: Path):
    package = tmp_path / "manifest-skill"
    package.mkdir()
    (package / "SKILL.md").write_text("---\nname: manifest-skill\n---\n\nBody.", encoding="utf-8")
    stage = tmp_path / "manifest-skill-open"
    stage.mkdir()
    (stage / "SKILL.md").write_text(
        "---\nname: manifest-skill-open\n---\n\nStage.", encoding="utf-8"
    )
    comet_dir = package / "comet"
    comet_dir.mkdir()
    manifest = comet_dir / "eval.yaml"
    manifest.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: manifest-skill
  draftHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
skill:
  name: manifest-skill
  source: ..
  profile: generic
evaluation:
  recommendedTasks:
    - generic-skill-smoke
    - workflow-route-conformance
    - workflow-overlay-contract
  baselineTreatments:
    - CONTROL
    - COMET_FULL_040_BETA
  qualityGates:
    minWeightedScore: 0.8
    minPassAt1: 0.6
    maxInstabilityGap: 0.4
  requiredOutputSchemas:
    - comet.grill-me.v1
  expectedEvidence:
    - node: design
      check: augmentation:design.grill-me
  requiredSkills:
    - manifest-skill
  generatedNodeSkills:
    - manifest-skill-open
  routeConformance:
    task: workflow-route-conformance
    expectedNodeOrder:
      - open
interaction:
  mode: none
""",
        encoding="utf-8",
    )

    class Config:
        def getoption(self, name):
            return {"--eval-manifest": str(manifest)}.get(name)

    cfg = conftest._get_dynamic_treatment_config(Config())

    assert cfg.name == "DYNAMIC_SKILL"
    assert cfg.skills[0]["name"] == "manifest-skill"
    assert cfg.skills[0]["source"] == "path"
    assert cfg.skills[0]["profile"] == "generic"
    assert cfg.skills[0]["generated_node_skills"] == ["manifest-skill-open"]
    assert cfg.skills[0]["route_conformance_expected_node_order"] == ["open"]
    assert cfg.skills[0]["baseline_treatments"] == ["CONTROL", "COMET_FULL_040_BETA"]
    assert cfg.skills[0]["quality_gates"] == {
        "minWeightedScore": 0.8,
        "minPassAt1": 0.6,
        "maxInstabilityGap": 0.4,
    }
    assert cfg.skills[0]["required_output_schemas"] == ["comet.grill-me.v1"]
    assert cfg.skills[0]["expected_evidence"] == [
        {"node": "design", "check": "augmentation:design.grill-me"}
    ]
    assert cfg.skills[0]["draft_hash"] == "a" * 64
    assert cfg.skills[1]["name"] == "manifest-skill-open"
    assert cfg.skills[1]["path"] == str(stage.resolve())


def test_snapshot_dynamic_skill_package_copies_package_and_node_skills(tmp_path: Path):
    source_root = tmp_path / "source"
    package = source_root / "manifest-skill"
    package.mkdir(parents=True)
    (package / "SKILL.md").write_text("---\nname: manifest-skill\n---\n\nBody.", encoding="utf-8")
    (package / "reference").mkdir()
    (package / "reference" / "workflow-protocol.json").write_text("{}", encoding="utf-8")
    stage = source_root / "manifest-skill-open"
    stage.mkdir()
    (stage / "SKILL.md").write_text(
        "---\nname: manifest-skill-open\n---\n\nStage.", encoding="utf-8"
    )
    test_dir = tmp_path / "workspace"
    test_dir.mkdir()

    relative_package = conftest._snapshot_dynamic_skill_package(
        test_dir,
        {
            "path": str(package),
            "generated_node_skills": ["manifest-skill-open"],
        },
    )

    assert relative_package == "_eval_target_skills/manifest-skill"
    assert (test_dir / relative_package / "SKILL.md").exists()
    assert (test_dir / "_eval_target_skills" / "manifest-skill-open" / "SKILL.md").exists()


def test_snapshot_dynamic_skill_package_excludes_comet_runtime_state(tmp_path: Path):
    source_root = tmp_path / "source"
    package = source_root / "manifest-skill"
    package.mkdir(parents=True)
    (package / "SKILL.md").write_text("---\nname: manifest-skill\n---\n\nBody.", encoding="utf-8")
    package_cache = package / ".comet" / "eval" / "cache" / "uv"
    package_cache.mkdir(parents=True)
    (package_cache / "long-wheel.lock").write_text("cached", encoding="utf-8")
    stage = source_root / "manifest-skill-open"
    stage.mkdir()
    (stage / "SKILL.md").write_text(
        "---\nname: manifest-skill-open\n---\n\nStage.", encoding="utf-8"
    )
    (stage / ".comet" / "eval" / "runs").mkdir(parents=True)
    test_dir = tmp_path / "workspace"
    test_dir.mkdir()

    relative_package = conftest._snapshot_dynamic_skill_package(
        test_dir,
        {
            "path": str(package),
            "generated_node_skills": ["manifest-skill-open"],
        },
    )

    assert (test_dir / relative_package / "SKILL.md").exists()
    assert not (test_dir / relative_package / ".comet").exists()
    node_snapshot = test_dir / "_eval_target_skills" / "manifest-skill-open"
    assert (node_snapshot / "SKILL.md").exists()
    assert not (node_snapshot / ".comet").exists()


def _workflow_overlay_validator():
    validator_path = (
        Path(__file__).parents[2]
        / "tasks"
        / "workflow-overlay-contract"
        / "validation"
        / "test_workflow_overlay_contract.py"
    )
    spec = importlib.util.spec_from_file_location(
        "workflow_overlay_contract_validator",
        validator_path,
    )
    validator = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(validator)
    return validator


def _run_workflow_overlay_validator(workspace: Path, context: dict) -> dict:
    (workspace / "_test_context.json").write_text(
        json.dumps(context),
        encoding="utf-8",
    )
    validator = _workflow_overlay_validator()
    old_cwd = Path.cwd()
    try:
        os.chdir(workspace)
        validator.main()
        return json.loads((workspace / "_test_results.json").read_text(encoding="utf-8"))
    finally:
        os.chdir(old_cwd)


def _write_overlay_eval_manifest(package: Path, draft_hash: str = "c" * 64) -> None:
    comet_dir = package / "comet"
    comet_dir.mkdir(parents=True, exist_ok=True)
    (comet_dir / "eval.yaml").write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: overlay-skill
  draftHash: {draft_hash}
skill:
  name: overlay-skill
  source: ..
  profile: authoring-skill
evaluation:
  recommendedTasks:
    - workflow-overlay-contract
    - comet-full-workflow
    - comet-fix-median
  baselineTreatments:
    - CONTROL
    - COMET_FULL_040_BETA
  qualityGates:
    minWeightedScore: 0.8
    minPassAt1: 0.6
    maxInstabilityGap: 0.4
  requiredOutputSchemas:
    - comet.grill-me.v1
  expectedEvidence:
    - node: design
      check: augmentation:design.grill-me
      enforcement: guarded
    - node: design
      check: output-schema:design.comet.grill-me.v1.challenge-summary
      schema: comet.grill-me.v1
      evidence: challenge-summary
""".format(draft_hash=draft_hash),
        encoding="utf-8",
    )


def _overlay_validator_context(package: Path, draft_hash: str = "c" * 64) -> dict:
    return {
        "skill_package_path": str(package),
        "baseline_treatments": ["CONTROL", "COMET_FULL_040_BETA"],
        "quality_gates": {
            "minWeightedScore": 0.8,
            "minPassAt1": 0.6,
            "maxInstabilityGap": 0.4,
        },
        "required_output_schemas": ["comet.grill-me.v1"],
        "expected_evidence": [
            {
                "node": "design",
                "check": "augmentation:design.grill-me",
                "enforcement": "guarded",
            },
            {
                "node": "design",
                "check": "output-schema:design.comet.grill-me.v1.challenge-summary",
                "schema": "comet.grill-me.v1",
                "evidence": "challenge-summary",
            },
        ],
        "draft_hash": draft_hash,
    }


def test_workflow_overlay_contract_validator_rejects_missing_contract_files(tmp_path: Path):
    package = tmp_path / "overlay-skill"
    package.mkdir()
    _write_overlay_eval_manifest(package)

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    results = _run_workflow_overlay_validator(workspace, _overlay_validator_context(package))

    failures = "\n".join(results["failed"])
    assert "reference/workflow-protocol.json missing" in failures
    assert "scripts/workflow-state.mjs missing" in failures
    assert "scripts/workflow-guard.mjs missing" in failures
    assert "scripts/workflow-handoff.mjs missing" in failures


def test_workflow_overlay_contract_validator_accepts_minimal_contract_package(tmp_path: Path):
    package = tmp_path / "overlay-skill"
    package.mkdir()
    (package / "reference").mkdir()
    (package / "scripts").mkdir()
    (package / "reference" / "workflow-protocol.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "kind": "comet-five-phase-overlay",
                "name": "overlay-skill",
                "goal": "Validate overlay contracts.",
                "nodes": [{"id": "design", "label": "Design"}],
            }
        ),
        encoding="utf-8",
    )
    (package / "scripts" / "workflow-state.mjs").write_text(
        "activeCometChanges resolveCometOverlayChange workflow-evidence "
        "isCometOverlay(protocol) command === 'init' /comet-open",
        encoding="utf-8",
    )
    (package / "scripts" / "workflow-guard.mjs").write_text(
        "readOverlayEvidence workflow-evidence missing augmentation evidence "
        "COMET STATE: unchanged",
        encoding="utf-8",
    )
    (package / "scripts" / "workflow-handoff.mjs").write_text(
        "workflow-protocol.json workflow: protocol.name protocol.nodes.map "
        "requiredSkillCalls augmentations outputSchemas",
        encoding="utf-8",
    )
    _write_overlay_eval_manifest(package)

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    results = _run_workflow_overlay_validator(workspace, _overlay_validator_context(package))

    assert results["failed"] == []


def test_build_report_payload_persists_sample_quality():
    report = conftest._build_report_payload(
        treatment_name="COMET_FULL_040_BETA",
        rep=1,
        run_id="run-1",
        events={
            "duration_seconds": 10,
            "total_tokens": 100,
            "total_cost_usd": 0.01,
            "case_manifest": {"case_hash": "sha256:demo"},
            "role_models": {
                "subject": "subject-model",
                "simulator": None,
                "judge": "judge-model",
            },
        },
        passed=["[RUBRIC] weighted_score: 1.00"],
        failed=[],
        scripts_used=[],
        artifact_references={"report": "reports/demo.json"},
        failure_attribution=[],
        returncode=0,
        stdout=json.dumps({"type": "result", "duration_ms": 10000}) + "\n",
        stderr="",
    )

    assert report["sample_quality"]["status"] == "included"
    assert report["sample_quality"]["reason_code"] == "valid_signal"
    assert report["sample_quality"]["include_in_analysis"] is True
    assert report["events_summary"]["case_manifest"] == {"case_hash": "sha256:demo"}
    assert report["events_summary"]["role_models"] == {
        "subject": "subject-model",
        "simulator": None,
        "judge": "judge-model",
    }


def test_build_report_payload_marks_timeout_as_excluded():
    report = conftest._build_report_payload(
        treatment_name="COMET_FULL_039",
        rep=1,
        run_id="run-2",
        events={},
        passed=[],
        failed=["no result"],
        scripts_used=[],
        artifact_references={"report": "reports/demo.json"},
        failure_attribution=[],
        returncode=124,
        stdout="",
        stderr="Timeout after 600s",
    )

    assert report["sample_quality"]["status"] == "excluded"
    assert report["sample_quality"]["reason_code"] == "runner_timeout"
    assert report["sample_quality"]["include_in_analysis"] is False


def test_prebuild_docker_image_allows_a_cold_image_build_to_run_for_fifteen_minutes(
    tmp_path: Path, monkeypatch
):
    environment = tmp_path / "environment"
    environment.mkdir()
    (environment / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")
    calls = []

    def fake_run_shell(*args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, "skillbench:test\n", "")

    monkeypatch.setattr(conftest, "run_shell", fake_run_shell)
    monkeypatch.setattr(conftest, "DOCKER_BUILD_LOCK", tmp_path / "docker-build.lock")

    assert conftest._build_docker_image_with_lock(environment) == "skillbench:test"
    assert calls == [
        (
            ("docker.sh", "build", str(environment)),
            {"timeout": 900, "check": False},
        )
    ]


def test_resolve_eval_agent_applies_cli_manifest_precedence(tmp_path: Path):
    manifest = tmp_path / "eval.yaml"
    manifest.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: selected-agent
skill:
  name: selected-agent
  source: .
execution:
  agent: codex
""",
        encoding="utf-8",
    )

    class Config:
        def __init__(self, agent):
            self.agent = agent

        def getoption(self, name):
            return {
                "--eval-manifest": str(manifest),
                "--agent": self.agent,
            }.get(name)

    assert conftest._resolve_eval_agent(Config(None)).agent == "codex"
    assert conftest._resolve_eval_agent(Config("qoder")).agent == "qoder"


def test_selected_agent_uses_its_native_project_skill_root():
    assert conftest._agent_project_root("claude-code") == ".claude"
    assert conftest._agent_project_root("codex") == ".agents"
    assert conftest._agent_project_root("qoder") == ".qoder"
    assert conftest._agent_project_root("codebuddy") == ".codebuddy"


def test_docker_prebuild_uses_only_the_tasks_selected_by_an_eval_manifest(
    tmp_path: Path,
):
    tasks_dir = tmp_path / "tasks"
    for task_name in ("authoring-skill-smoke", "workflow-route-conformance", "unrelated"):
        environment = tasks_dir / task_name / "environment"
        environment.mkdir(parents=True)
        (environment / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")

    class Config:
        _comet_frozen_task_set = SimpleNamespace(
            tasks=(
                SimpleNamespace(task=SimpleNamespace(environment_dir=tasks_dir / "authoring-skill-smoke" / "environment")),
                SimpleNamespace(task=SimpleNamespace(environment_dir=tasks_dir / "workflow-route-conformance" / "environment")),
            )
        )

    request = SimpleNamespace(config=Config())

    assert conftest._docker_environment_dirs_for_request(request, tasks_dir) == [
        tasks_dir / "authoring-skill-smoke" / "environment",
        tasks_dir / "workflow-route-conformance" / "environment",
    ]


@pytest.mark.parametrize(
    "source,selected",
    [
        ("explicit", ["authoring-skill-smoke"]),
        ("quick", ["workflow-route-conformance"]),
        ("authored", ["authoring-skill-smoke"]),
        ("recommended", ["workflow-route-conformance"]),
        ("generated-cache", ["authoring-skill-smoke"]),
        ("source", ["source-custom"]),
    ],
)
def test_docker_prebuild_consumes_only_frozen_task_environments(tmp_path: Path, source, selected):
    tasks_dir = tmp_path / "tasks"
    environments = {}
    for name in ("authoring-skill-smoke", "workflow-route-conformance", "source-custom", "unrelated"):
        environment = tasks_dir / name / "environment"
        environment.mkdir(parents=True)
        (environment / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        environments[name] = environment

    frozen = SimpleNamespace(
        source=source,
        generation=SimpleNamespace(generation_hash="frozen-hash") if source == "generated-cache" else None,
        tasks=tuple(
            SimpleNamespace(
                name=name,
                provenance="source" if name == "source-custom" else source,
                task=SimpleNamespace(environment_dir=environments[name]),
            )
            for name in [*selected, *selected]
        ),
    )
    request = SimpleNamespace(config=SimpleNamespace(_comet_frozen_task_set=frozen))

    assert conftest._docker_environment_dirs_for_request(request, tasks_dir) == [
        environments[name] for name in selected
    ]
