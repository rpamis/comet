"""Unit tests for eval scaffold utilities."""

from pathlib import Path

from scaffold.python import utils
from scaffold.python.skill_parser import load_skill_content, parse_skill_md


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


def test_run_claude_fixture_defaults_langsmith_hook_log_path():
    conftest_py = (Path(__file__).resolve().parents[1] / "conftest.py").read_text(
        encoding="utf-8"
    )

    assert 'os.environ["CC_LANGSMITH_LOG_FILE"] = "/workspace/langsmith-hook.log"' in conftest_py


def test_claude_loop_applies_plugin_args_to_subject_turns_only():
    loop_sh = (utils.SHELL_DIR / "run-claude-loop.sh").read_text(encoding="utf-8")

    assert "PLUGIN_ARGS=()" in loop_sh
    assert 'claude -p "$PROMPT" "${PLUGIN_ARGS[@]}"' in loop_sh
    assert 'claude -p "$USER_REPLY" "${PLUGIN_ARGS[@]}"' in loop_sh
    assert 'claude -p "$sim_prompt" "${PLUGIN_ARGS[@]}"' not in loop_sh
