"""Unit tests for eval scaffold utilities."""

import importlib
import os
import subprocess
from pathlib import Path

import dotenv

from scaffold.python import utils
from scaffold.python.skill_parser import load_skill_content, parse_skill_md


def test_import_does_not_read_dotenv(monkeypatch):
    calls = []
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: calls.append((args, kwargs)))

    importlib.reload(utils)

    assert calls == []
    utils.load_eval_environment()
    assert len(calls) == 2
    monkeypatch.undo()
    importlib.reload(utils)


def test_execution_validator_converts_structured_checks(monkeypatch, tmp_path: Path):
    def fake_run_eval_in_docker(*_args, **_kwargs):
        return {
            "checks": [
                {"check": "openspec_artifacts", "status": "passed", "message": "found"},
                {"check": "median_fix", "status": "passed", "message": "all tests pass"},
                {"check": "tests_written", "status": "failed", "message": "missing assertions"},
            ]
        }

    monkeypatch.setattr(utils, "run_eval_in_docker", fake_run_eval_in_docker)

    validator = utils.make_execution_validator(
        validation_dir=tmp_path,
        test_scripts="test_task.py",
        target_artifacts=[],
    )

    passed, failed = validator(tmp_path, {"run_id": "abc"})

    assert passed == [
        "openspec_artifacts: found",
        "median_fix: all tests pass",
    ]
    assert failed == ["tests_written: missing assertions"]


def test_docker_script_failure_preserves_stderr(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(utils, "check_docker_available", lambda: True)
    monkeypatch.setattr(
        utils,
        "run_shell",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["docker.sh"],
            returncode=1,
            stdout="",
            stderr="validator import failed",
        ),
    )

    success, output = utils.run_python_in_docker(tmp_path, "validation/check.py")

    assert success is False
    assert "validator import failed" in output


def test_run_shell_decodes_subprocess_output_as_utf8(monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs

    monkeypatch.setattr(utils.subprocess, "run", fake_run)

    utils.run_shell("docker.sh", "check", check=False)

    assert captured["kwargs"]["encoding"] == "utf-8"
    assert captured["kwargs"]["errors"] == "replace"


def test_to_bash_path_uses_msys_drive_prefix_for_git_bash(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(utils, "BASH_EXEC", r"C:\Program Files\Git\bin\bash.exe")

    assert utils._to_bash_path(r"D:\Project\Comet\eval") == "/d/Project/Comet/eval"


def test_resolve_bash_prefers_git_bash_when_path_bash_is_wsl(monkeypatch):
    monkeypatch.delenv("GIT_BASH", raising=False)
    monkeypatch.setattr(
        utils.shutil,
        "which",
        lambda name: {"bash": r"C:\Windows\System32\bash.exe", "git": r"D:\Git\cmd\git.exe"}.get(
            name
        ),
    )
    monkeypatch.setattr(
        utils.os.path,
        "isfile",
        lambda path: str(path).replace("/", "\\").lower() == r"d:\git\bin\bash.exe",
    )

    assert utils._resolve_bash(os_name="nt") == r"D:\Git\bin\bash.exe"


def test_to_bash_path_uses_wsl_mount_prefix_for_windowsapps_bash(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )

    assert utils._to_bash_path(r"D:\Project\Comet\eval") == "/mnt/d/Project/Comet/eval"


def test_skill_parser_reads_skill_markdown_as_utf8(tmp_path: Path):
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        "---\nname: utf8-skill\ndescription: Bob’s test\n---\n\n<overview>\n中文内容\n</overview>\n",
        encoding="utf-8",
    )

    sections = parse_skill_md(skill_md)

    assert "Bob’s test" in load_skill_content(skill_md)
    assert "中文内容" in sections["overview"]


def test_bash_env_bridges_eval_keys_to_wsl(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )
    monkeypatch.setenv("WSLENV", "EXISTING")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "token")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://example.test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    env = utils._bash_env()

    names = env["WSLENV"].split(":")
    assert names[:1] == ["EXISTING"]
    assert "ANTHROPIC_AUTH_TOKEN" in names
    assert "ANTHROPIC_BASE_URL" in names
    assert "ANTHROPIC_API_KEY" not in names


def test_bash_env_bridges_langsmith_hook_log_to_wsl(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )
    monkeypatch.setenv("CC_LANGSMITH_LOG_FILE", "/workspace/langsmith-hook.log")

    env = utils._bash_env()

    assert "CC_LANGSMITH_LOG_FILE" in env["WSLENV"].split(":")


def test_docker_loop_passes_langsmith_plugin_args_to_loop_driver():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")

    assert '${PLUGIN_CLI_ARGS[@]+"' in docker_sh
    assert 'bash //opt/scaffold-shell/run-claude-loop.sh "$prompt"' in docker_sh
    assert "CC_LANGSMITH_LOG_FILE" in docker_sh


def test_claude_loop_timeout_force_removes_its_named_container(monkeypatch, tmp_path: Path):
    calls = []

    def fake_run_shell(script, *args, **kwargs):
        calls.append((script, args, kwargs))
        if args[0] == "run-claude-loop":
            raise subprocess.TimeoutExpired([script, *args], timeout=42)
        return subprocess.CompletedProcess([script, *args], 0, "", "")

    monkeypatch.setattr(utils, "run_shell", fake_run_shell)

    result = utils.run_claude_loop_in_docker(tmp_path, ["prompt"], timeout=42)

    assert result.returncode == 124
    assert calls[0][1][0] == "run-claude-loop"
    assert calls[1][1] == ("cleanup-claude-loop", tmp_path)

    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    assert '--name "$container_name"' in docker_sh
    assert "cleanup-claude-loop" in docker_sh


def test_docker_subject_run_uses_controller_verified_immutable_image_identity():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")

    assert "docker_execution_identity" in docker_sh
    assert "claude --version" in docker_sh
    assert "runtime_image_id" in docker_sh
    assert 'image_id=$(resolve_runtime_image "$dir" "$expected_image_id")' in docker_sh
    assert '"$image_id"' in docker_sh


def test_run_claude_fixture_defaults_langsmith_hook_log_path():
    conftest_py = (Path(__file__).resolve().parents[1] / "conftest.py").read_text(encoding="utf-8")

    assert 'os.environ["CC_LANGSMITH_LOG_FILE"] = "/workspace/langsmith-hook.log"' in conftest_py


def test_claude_loop_applies_plugin_args_to_subject_turns_only():
    loop_sh = (utils.SHELL_DIR / "run-claude-loop.sh").read_text(encoding="utf-8")

    assert "PLUGIN_ARGS=()" in loop_sh
    assert "shopt -s nocasematch" in loop_sh
    assert "DECISION_REPLY=" in loop_sh
    assert 'USER_REPLY="$DECISION_REPLY"' in loop_sh
    assert 'bash "$SCRIPT_DIR/decision-point.sh" "$RESULT_TEXT"' in loop_sh
    assert 'bash "$SCRIPT_DIR/completion-point.sh" "$RESULT_TEXT"' in loop_sh
    assert loop_sh.index("workflow completion detected") < loop_sh.index(
        'bash "$SCRIPT_DIR/decision-point.sh" "$RESULT_TEXT"'
    )
    assert 'SUBJECT_PROMPT="${FRESH_PROMPT:-$PROMPT}"' in loop_sh
    assert 'claude -p "$SUBJECT_PROMPT" "${PLUGIN_ARGS[@]}"' in loop_sh
    assert 'claude -p "$USER_REPLY" "${PLUGIN_ARGS[@]}"' in loop_sh
    assert "fresh resume boundary detected" in loop_sh
    assert 'claude -p "$sim_prompt" "${PLUGIN_ARGS[@]}"' not in loop_sh


def test_claude_loop_surfaces_subject_resume_failure(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_claude = fake_bin / "claude"
    fake_claude.write_text(
        """#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "--resume" ]]; then
    echo "resume failed stdout diagnostic"
    echo "resume failed diagnostic" >&2
    exit 42
  fi
done
printf '%s\n' '{"type":"system","session_id":"session-1"}'
printf '%s\n' '{"type":"result","subtype":"success","session_id":"session-1","result":"Should abbreviations end a sentence?"}'
""",
        encoding="utf-8",
        newline="\n",
    )
    fake_claude.chmod(0o755)

    env = os.environ.copy()
    env["PATH"] = f"{utils._to_bash_path(fake_bin)}:{env.get('PATH', '')}"
    result = subprocess.run(
        [
            utils.BASH_EXEC,
            utils._to_bash_path(utils.SHELL_DIR / "run-claude-loop.sh"),
            "Implement the requested change.",
            "--max-turns",
            "2",
            "--decision-pattern",
            "abbreviation",
            "--decision-reply",
            "Use an explicit abbreviation list.",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        env=env,
    )

    assert result.returncode != 0
    assert "resume failed stdout diagnostic" in result.stderr
    assert "resume failed diagnostic" in result.stderr
    assert "subject turn 2 failed" in result.stderr


def test_decision_point_detector_rejects_completion_statements():
    statement = "Implementation is complete and the artifacts provide the requested evidence."
    punctuation_summary = "Done. The counter recognizes ., !, and ? terminators."
    question = "Please confirm whether abbreviations should end a sentence."

    statement_result = utils.run_shell("decision-point.sh", statement, check=False)
    punctuation_result = utils.run_shell("decision-point.sh", punctuation_summary, check=False)
    question_result = utils.run_shell("decision-point.sh", question, check=False)

    assert statement_result.returncode == 1
    assert punctuation_result.returncode == 1
    assert question_result.returncode == 0


def test_decision_point_detector_rejects_multiline_archived_decision_summary():
    result = utils.run_shell(
        "decision-point.sh",
        """Change archived successfully.
1. Should abbreviations end sentences — No.
2. Consecutive terminators (`?!`) count as one boundary.
All verification checks passed.""",
        check=False,
    )

    assert result.returncode == 1


def test_decision_point_patterns_require_an_unresolved_decision_signal():
    ordinary = utils.run_shell(
        "decision-point.sh",
        "The brief records abbreviation behavior.",
        "abbreviation",
        check=False,
    )
    unresolved = utils.run_shell(
        "decision-point.sh",
        "Abbreviation behavior is unresolved; I need your decision before continuing.",
        "abbreviation",
        check=False,
    )

    assert ordinary.returncode == 1
    assert unresolved.returncode == 0


def test_decision_point_detector_accepts_question_followed_by_recommendation_and_impact():
    result = utils.run_shell(
        "decision-point.sh",
        """How should abbreviations affect sentence boundaries?

Recommendation: Ignore a small explicit list.
Impact: Counts remain intuitive, but the list needs maintenance.""",
        check=False,
    )

    assert result.returncode == 0


def test_decision_point_detector_accepts_batch_labels_and_reply_confirmation():
    labelled_question = utils.run_shell(
        "decision-point.sh",
        """**1. Question:** Whether abbreviations such as `e.g.` end a sentence.
**Recommendation:** No.
**Impact:** Counts stay intuitive.""",
        check=False,
    )
    reply_confirmation = utils.run_shell(
        "decision-point.sh",
        'Please reply **"confirmed"** to approve this shared understanding.',
        check=False,
    )

    assert labelled_question.returncode == 0
    assert reply_confirmation.returncode == 0


def test_completion_point_detector_requires_explicit_non_negated_workflow_completion():
    archived = utils.run_shell(
        "completion-point.sh",
        "Change archived at docs/comet/archive/2026-07-15-add-counting/.",
        check=False,
    )
    archive_complete = utils.run_shell(
        "completion-point.sh", "The archive is complete and verified from disk.", check=False
    )
    completed_through_archive = utils.run_shell(
        "completion-point.sh", "Change add-counting completed through Archive.", check=False
    )
    archived_to = utils.run_shell(
        "completion-point.sh", "- **Archived to**: docs/comet/archive/2026-07-19-add-counting/", check=False
    )
    completed_all_phases = utils.run_shell(
        "completion-point.sh",
        "The change has been completed through all phases and archived.",
        check=False,
    )
    terminal_archived = utils.run_shell(
        "completion-point.sh",
        "The change is already in its terminal archived state.",
        check=False,
    )
    archived_heading = utils.run_shell(
        "completion-point.sh",
        "**Native change `add-sentence-counting` is archived**",
        check=False,
    )
    phase_done = utils.run_shell(
        "completion-point.sh", "Shape is done; Build remains pending.", check=False
    )
    negated = utils.run_shell(
        "completion-point.sh", "The workflow is not complete yet.", check=False
    )
    negated_through_archive = utils.run_shell(
        "completion-point.sh", "The change is not completed through Archive.", check=False
    )

    assert archived.returncode == 0
    assert archive_complete.returncode == 0
    assert completed_through_archive.returncode == 0
    assert archived_to.returncode == 0
    assert completed_all_phases.returncode == 0
    assert terminal_archived.returncode == 0
    assert archived_heading.returncode == 0
    assert phase_done.returncode == 1
    assert negated.returncode == 1
    assert negated_through_archive.returncode == 1
