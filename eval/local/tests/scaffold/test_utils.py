"""Unit tests for eval scaffold utilities."""

import importlib
import os
import subprocess
from pathlib import Path

import dotenv
import pytest

from scaffold.python import utils
from scaffold.python.skill_parser import load_skill_content, parse_skill_md


def test_import_does_not_read_dotenv(monkeypatch):
    calls = []
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: calls.append((args, kwargs)))

    importlib.reload(utils)

    assert calls == []
    utils.load_eval_environment()
    assert len(calls) == 3
    monkeypatch.undo()
    importlib.reload(utils)


def test_load_eval_environment_prefers_user_file_but_preserves_process_values(
    tmp_path, monkeypatch
):
    package = tmp_path / "package"
    suite = tmp_path / "suite"
    user = tmp_path / ".comet" / "eval"
    package.mkdir()
    suite.mkdir()
    user.mkdir(parents=True)
    (package / ".env").write_text(
        "BENCH_MODEL=package\nBENCH_BASE_URL=https://package.example\n",
        encoding="utf-8",
    )
    (suite / ".env").write_text(
        "BENCH_MODEL=suite\nBENCH_BASE_URL=https://suite.example\n",
        encoding="utf-8",
    )
    (user / ".env").write_text(
        "BENCH_MODEL=user\nBENCH_BASE_URL=https://user.example\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(utils, "EVAL_ROOT", package)
    monkeypatch.setattr(utils, "get_suite_root", lambda: suite)
    monkeypatch.setattr(utils.Path, "home", staticmethod(lambda: tmp_path))
    monkeypatch.setenv("BENCH_MODEL", "process")
    monkeypatch.delenv("BENCH_BASE_URL", raising=False)

    utils.load_eval_environment()

    assert os.environ["BENCH_MODEL"] == "process"
    assert os.environ["BENCH_BASE_URL"] == "https://user.example"


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


def test_run_command_in_docker_passes_timeout_and_shell_command(monkeypatch, tmp_path: Path):
    captured = {}

    def fake_run_shell(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(utils, "check_docker_available", lambda: True)
    monkeypatch.setattr(utils, "run_shell", fake_run_shell)

    result = utils.run_command_in_docker(tmp_path, "pnpm test", timeout=45)

    assert result.returncode == 0
    assert captured["args"] == (
        "docker.sh",
        "run-command",
        str(tmp_path),
        "--timeout",
        "45",
        "--",
        "pnpm test",
    )
    assert captured["kwargs"]["timeout"] == 75


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


def test_bash_env_bridges_selectable_agent_credentials_to_wsl(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )
    monkeypatch.setenv("WSLENV", "")
    monkeypatch.setenv("QODER_PERSONAL_ACCESS_TOKEN", "qoder-token")

    env = utils._bash_env()

    assert "QODER_PERSONAL_ACCESS_TOKEN" in env["WSLENV"].split(":")


def test_bash_env_bridges_codebuddy_credentials_and_model_to_wsl(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )
    monkeypatch.setenv("WSLENV", "")
    monkeypatch.setenv("CODEBUDDY_API_KEY", "codebuddy-key")
    monkeypatch.setenv("CODEBUDDY_MODEL", "codebuddy-model")
    monkeypatch.setenv("CODEBUDDY_SMALL_FAST_MODEL", "codebuddy-fast-model")
    monkeypatch.setenv("CODEBUDDY_BIG_SLOW_MODEL", "codebuddy-reasoning-model")
    monkeypatch.setenv("CODEBUDDY_CODE_SUBAGENT_MODEL", "codebuddy-subagent-model")

    env = utils._bash_env()

    assert "CODEBUDDY_API_KEY" in env["WSLENV"].split(":")
    assert "CODEBUDDY_MODEL" in env["WSLENV"].split(":")
    assert "CODEBUDDY_SMALL_FAST_MODEL" in env["WSLENV"].split(":")
    assert "CODEBUDDY_BIG_SLOW_MODEL" in env["WSLENV"].split(":")
    assert "CODEBUDDY_CODE_SUBAGENT_MODEL" in env["WSLENV"].split(":")


def test_bash_env_bridges_custom_agent_model_and_base_url_to_wsl(monkeypatch):
    monkeypatch.setattr(utils.os, "name", "nt")
    monkeypatch.setattr(
        utils,
        "BASH_EXEC",
        r"C:\Users\BENYM\AppData\Local\Microsoft\WindowsApps\bash.exe",
    )
    monkeypatch.setenv("WSLENV", "")
    monkeypatch.setenv("COMET_EVAL_CUSTOM_MODEL_ENV", "FIXTURE_AGENT_MODEL")
    monkeypatch.setenv("COMET_EVAL_CUSTOM_BASE_URL_ENV", "FIXTURE_AGENT_BASE_URL")
    monkeypatch.setenv("FIXTURE_AGENT_MODEL", "fixture-model")
    monkeypatch.setenv("FIXTURE_AGENT_BASE_URL", "https://fixture.example/v1")

    env = utils._bash_env()

    assert "FIXTURE_AGENT_MODEL" in env["WSLENV"].split(":")
    assert "FIXTURE_AGENT_BASE_URL" in env["WSLENV"].split(":")


def test_run_agent_in_docker_builds_the_selected_adapter_command(monkeypatch, tmp_path: Path):
    calls = []

    def fake_run_shell(script, *args, **kwargs):
        calls.append((script, args, kwargs))
        return subprocess.CompletedProcess([script, *args], 0, "", "")

    monkeypatch.setattr(utils, "run_shell", fake_run_shell)
    monkeypatch.setattr(utils, "check_docker_available", lambda: True)

    result = utils.run_agent_in_docker(
        str(tmp_path),
        "inspect the task",
        agent="codex",
        model="test-model",
        timeout=42,
    )

    assert result.returncode == 0
    assert calls[0][1] == (
        "run-agent",
        str(tmp_path),
        "inspect the task",
        "--agent",
        "codex",
        "--model",
        "test-model",
        "--timeout",
        "42",
    )


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


def test_agent_loop_timeout_force_removes_its_named_container(monkeypatch, tmp_path: Path):
    calls = []

    def fake_run_shell(script, *args, **kwargs):
        calls.append((script, args, kwargs))
        if args[0] == "run-agent-loop":
            raise subprocess.TimeoutExpired([script, *args], timeout=42)
        return subprocess.CompletedProcess([script, *args], 0, "", "")

    monkeypatch.setattr(utils, "run_shell", fake_run_shell)

    result = utils.run_agent_loop_in_docker(
        str(tmp_path), ["prompt", "--agent", "codex"], timeout=42
    )

    assert result.returncode == 124
    assert calls[0][1][0] == "run-agent-loop"
    assert calls[1][1] == ("cleanup-agent-loop", str(tmp_path))


def test_docker_subject_run_uses_controller_verified_immutable_image_identity():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")

    assert "docker_execution_identity" in docker_sh
    assert "claude --version" in docker_sh
    assert "runtime_image_id" in docker_sh
    assert 'image_id=$(resolve_runtime_image "$dir" "$expected_image_id")' in docker_sh
    assert '"$image_id"' in docker_sh


def test_docker_script_dispatches_all_supported_agent_clis():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    runtime_sh = (utils.SHELL_DIR / "run-agent-runtime.sh").read_text(encoding="utf-8")

    assert "run-agent" in docker_sh
    assert "codex exec" in runtime_sh
    assert "qodercli" in runtime_sh
    assert "QODER_PERSONAL_ACCESS_TOKEN" in docker_sh
    assert "codebuddy" in runtime_sh
    assert "CODEBUDDY_API_KEY" in docker_sh

    overlay = (utils.SHELL_DIR.parent / "docker" / "agent-overlay.Dockerfile").read_text(
        encoding="utf-8"
    )
    assert "@tencent-ai/codebuddy-code" in overlay


def test_codebuddy_forwards_official_model_variant_environment_variables():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")

    assert "CODEBUDDY_SMALL_FAST_MODEL" in docker_sh
    assert "CODEBUDDY_BIG_SLOW_MODEL" in docker_sh
    assert "CODEBUDDY_CODE_SUBAGENT_MODEL" in docker_sh


def test_codex_commands_use_explicit_openai_base_url_config():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    loop_sh = (utils.SHELL_DIR / "run-claude-loop.sh").read_text(encoding="utf-8")

    assert 'base_url = ' in (utils.SHELL_DIR / "agent-runtime-config.sh").read_text(encoding="utf-8")
    assert 'model_provider = "comet-eval"' in (utils.SHELL_DIR / "agent-runtime-config.sh").read_text(encoding="utf-8")
    assert 'openai_base_url=$OPENAI_BASE_URL' not in docker_sh
    assert 'openai_base_url=$OPENAI_BASE_URL' not in loop_sh


def test_agent_runtime_credentials_use_ephemeral_cli_config_roots():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    config_sh = (utils.SHELL_DIR / "agent-runtime-config.sh").read_text(encoding="utf-8")

    assert "run-agent-runtime.sh" in docker_sh
    assert "--tmpfs" in docker_sh
    assert "bash //opt/scaffold-shell/run-agent-runtime.sh" in docker_sh
    assert "/home/agent/.codex" in docker_sh
    assert "/home/agent/.qoder" in docker_sh
    assert "/home/agent/.codebuddy" in docker_sh
    assert 'env_key = "OPENAI_API_KEY"' in config_sh
    assert 'model_provider = "comet-eval"' in config_sh
    assert '"apiKeyHelper"' in config_sh
    assert "CODEBUDDY_API_KEY" in config_sh
    assert "QODER_CONFIG_DIR" in config_sh
    assert "config.toml" in config_sh
    assert "settings.json" in config_sh


def test_agent_runtime_config_is_agent_only_and_docker_does_not_inline_secrets():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    config_sh = (utils.SHELL_DIR / "agent-runtime-config.sh").read_text(encoding="utf-8")
    generic_run = docker_sh.split("docker_run() {", 1)[1].split(
        "# Run Claude CLI in Docker", 1
    )[0]

    assert "COMET_EVAL_CODEBUDDY_CONFIG_DIR" in config_sh
    assert 'ENV_ARGS+=("-e" "$key")' in docker_sh
    assert 'ENV_ARGS+=("-e" "$key=${!key}")' not in docker_sh
    assert "build_agent_runtime_mount_args" not in generic_run


def test_agent_runtime_config_files_never_contain_credential_literals(tmp_path):
    codex_home = utils._to_bash_path(tmp_path / "codex")
    qoder_home = utils._to_bash_path(tmp_path / "qoder")
    codebuddy_home = utils._to_bash_path(tmp_path / "codebuddy")
    script = utils._to_bash_path(utils.SHELL_DIR / "agent-runtime-config.sh")
    env = dict(os.environ)
    env.update(
        {
            "CODEX_HOME": codex_home,
            "QODER_CONFIG_DIR": qoder_home,
            "COMET_EVAL_CODEBUDDY_CONFIG_DIR": codebuddy_home,
            "OPENAI_API_KEY": "codex-sentinel",
            "OPENAI_BASE_URL": "https://codex.example/v1",
            "CODEBUDDY_API_KEY": "codebuddy-sentinel",
            "CODEBUDDY_BASE_URL": "https://codebuddy.example/v1",
        }
    )
    result = subprocess.run(
        [
            utils.BASH_EXEC,
            "-c",
            f'source "{script}"; '
            'prepare_agent_runtime_config codex "subject-model"; '
            'prepare_agent_runtime_config qoder "subject-model"; '
            'prepare_agent_runtime_config codebuddy "subject-model"',
        ],
        env=utils._bash_env(env),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    config_text = (tmp_path / "codex" / "config.toml").read_text(encoding="utf-8")
    settings_text = (tmp_path / "codebuddy" / "settings.json").read_text(encoding="utf-8")
    helper_text = (tmp_path / "codebuddy" / "api-key-helper.sh").read_text(encoding="utf-8")

    assert 'env_key = "OPENAI_API_KEY"' in config_text
    assert "codex-sentinel" not in config_text
    assert '"apiKeyHelper"' in settings_text
    assert "codebuddy-sentinel" not in settings_text
    assert "codebuddy-sentinel" not in helper_text
    assert "CODEBUDDY_API_KEY" in helper_text
    assert not list((tmp_path / "qoder").iterdir())


def test_codebuddy_api_key_helper_prefers_auth_token_without_persisting_it(tmp_path):
    codebuddy_home = utils._to_bash_path(tmp_path / "codebuddy")
    script = utils._to_bash_path(utils.SHELL_DIR / "agent-runtime-config.sh")
    env = dict(os.environ)
    env.update(
        {
            "COMET_EVAL_CODEBUDDY_CONFIG_DIR": codebuddy_home,
            "CODEBUDDY_AUTH_TOKEN": "auth-token-sentinel",
            "CODEBUDDY_API_KEY": "api-key-sentinel",
        }
    )
    result = subprocess.run(
        [
            utils.BASH_EXEC,
            "-c",
            f'source "{script}"; '
            'prepare_agent_runtime_config codebuddy "subject-model"; '
            'bash "$COMET_EVAL_CODEBUDDY_CONFIG_DIR/api-key-helper.sh"',
        ],
        env=utils._bash_env(env),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "auth-token-sentinel"
    helper_text = (tmp_path / "codebuddy" / "api-key-helper.sh").read_text(encoding="utf-8")
    assert "auth-token-sentinel" not in helper_text
    assert "api-key-sentinel" not in helper_text


def test_user_authored_validation_commands_receive_no_agent_or_reporting_secrets():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    command_block = docker_sh.split("docker_run_command() {", 1)[1].split(
        "# Run Python script in Docker", 1
    )[0]

    assert "build_env_args" not in command_block
    assert "ENV_ARGS" not in command_block


def test_docker_harness_mounts_langfuse_official_plugin_and_enables_trace_image():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")
    overlay = (utils.SHELL_DIR.parent / "docker" / "agent-overlay.Dockerfile").read_text(
        encoding="utf-8"
    )

    assert "LANGFUSE_TRAJECTORY_PLUGIN_DIR" in docker_sh
    assert "build_langfuse_plugin_args" in docker_sh
    assert "comet-langfuse-plugin" in docker_sh
    assert "LANGFUSE_ENABLED" in overlay


def test_interaction_driver_accepts_the_selected_agent():
    loop_sh = (utils.SHELL_DIR / "run-claude-loop.sh").read_text(encoding="utf-8")

    assert "--agent" in loop_sh
    assert "codex exec" in loop_sh
    assert "qodercli" in loop_sh
    assert "codebuddy" in loop_sh


def test_docker_harness_has_no_native_review_sidecar_contract():
    docker_sh = (utils.SHELL_DIR / "docker.sh").read_text(encoding="utf-8")

    assert "native_review_sidecar" not in docker_sh
    assert "NATIVE_REVIEW_CONTROLLER_VOLUME" not in docker_sh
    assert "COMET_NATIVE_REVIEW_VERIFIER_URL" not in docker_sh


def _get_image_name(directory: Path) -> str:
    """Resolve the image name for a workspace directory via docker.sh (bash required)."""
    script = (
        'source "$1"; '
        'image=$(get_image_name "$2") || { echo "image lookup failed"; exit 1; }; '
        'echo "image=$image"'
    )
    try:
        result = subprocess.run(
            [
                utils.BASH_EXEC,
                "-c",
                script,
                "_",
                utils._to_bash_path(utils.SHELL_DIR / "docker.sh"),
                utils._to_bash_path(directory),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError:
        pytest.skip("bash not available")
    assert result.returncode == 0, f"get_image_name failed (stderr: {result.stderr})"
    return result.stdout.strip()


def _get_custom_image_name(directory: Path, *, version: str) -> str:
    """Resolve a custom-agent image name with the selected install metadata."""
    script = (
        'source "$1"; '
        'image=$(get_image_name "$2" fixture-agent) || { echo "image lookup failed"; exit 1; }; '
        'echo "image=$image"'
    )
    environment = {
        **os.environ,
        "COMET_EVAL_CUSTOM_AGENT_ID": "fixture-agent",
        "COMET_EVAL_CUSTOM_EXECUTABLE": "fixture-agent-cli",
        "COMET_EVAL_CUSTOM_INSTALL_KIND": "npm",
        "COMET_EVAL_CUSTOM_INSTALL_PACKAGE": "fixture-agent-package",
        "COMET_EVAL_CUSTOM_INSTALL_VERSION": version,
    }
    try:
        result = subprocess.run(
            [
                utils.BASH_EXEC,
                "-c",
                script,
                "_",
                utils._to_bash_path(utils.SHELL_DIR / "docker.sh"),
                utils._to_bash_path(directory),
            ],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError:
        pytest.skip("bash not available")
    assert result.returncode == 0, f"get_image_name failed (stderr: {result.stderr})"
    return result.stdout.strip()


def test_get_image_name_falls_back_to_environment_dockerfile(tmp_path: Path):
    """get_image_name() resolves environment/Dockerfile when dir/Dockerfile is absent.

    docker_build() falls back to environment/Dockerfile, so get_image_name() must
    apply the same rule; otherwise the fallback in docker_build() is dead code and
    building a workspace that only carries an environment/Dockerfile always fails.
    """
    env_dir = tmp_path / "environment"
    env_dir.mkdir()
    (env_dir / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")

    root_dir = tmp_path / "root"
    root_dir.mkdir()
    (root_dir / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")
    assert _get_image_name(tmp_path) == _get_image_name(root_dir)


def test_get_image_name_prefers_root_dockerfile_over_environment(tmp_path: Path):
    """When both dir/Dockerfile and environment/Dockerfile exist, prefer the root one.

    The environment/ fallback only applies when the root Dockerfile is absent, mirroring
    docker_build()'s resolution order.
    """
    root_only = tmp_path / "root-only"
    root_only.mkdir()
    (root_only / "Dockerfile").write_text("FROM node:22\n", encoding="utf-8")

    both = tmp_path / "both"
    both.mkdir()
    (both / "Dockerfile").write_text("FROM node:22\n", encoding="utf-8")
    both_env = both / "environment"
    both_env.mkdir()
    (both_env / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")

    env_only = tmp_path / "env-only"
    env_only.mkdir()
    env_only_env = env_only / "environment"
    env_only_env.mkdir()
    (env_only_env / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")

    assert _get_image_name(root_only) == _get_image_name(both)
    assert _get_image_name(both) != _get_image_name(env_only)


def test_custom_image_name_changes_when_install_version_changes(tmp_path: Path):
    (tmp_path / "Dockerfile").write_text("FROM python:3.11-slim\n", encoding="utf-8")
    first = _get_custom_image_name(tmp_path, version="1.0.0")
    second = _get_custom_image_name(tmp_path, version="2.0.0")
    assert first != second


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
    assert 'run_agent_turn "$SUBJECT_PROMPT" "" "subject"' in loop_sh
    assert 'role_plugin_args=("${PLUGIN_ARGS[@]}")' in loop_sh
    assert 'claude -p "$prompt" "${role_plugin_args[@]}"' in loop_sh
    assert 'run_agent_turn "$USER_REPLY" "$SESSION_ID" "subject"' in loop_sh
    assert "fresh resume boundary detected" in loop_sh
    assert 'claude -p "$sim_prompt" "${PLUGIN_ARGS[@]}"' not in loop_sh
    assert 'if ! rm -f -- "$SIMULATOR_PROMPT_FILE"; then' in loop_sh
    assert loop_sh.index('rm -f -- "$SIMULATOR_PROMPT_FILE"') < loop_sh.index(
        'RAW=$(run_agent_turn "$SUBJECT_PROMPT"'
    )


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


def test_claude_loop_surfaces_simulator_failure(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_claude = fake_bin / "claude"
    fake_claude.write_text(
        """#!/usr/bin/env bash
if [[ "$COMET_EVAL_AGENT_ROLE" == "simulator" ]]; then
  echo "simulator failed" >&2
  exit 44
fi
printf '%s\n' '{"type":"system","session_id":"subject-1"}'
printf '%s\n' '{"type":"result","subtype":"success","session_id":"subject-1","result":"Question: Which option should be used? Recommendation: A."}'
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
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        env=env,
    )

    assert result.returncode == 44
    assert "simulator turn failed (exit 44)" in result.stderr


def test_non_claude_loop_does_not_inherit_anthropic_model(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    captured_args = tmp_path / "codex-args.txt"
    fake_codex = fake_bin / "codex"
    fake_codex.write_text(
        """#!/usr/bin/env bash
printf '%s\n' "$*" > "$CAPTURED_CODEX_ARGS"
printf '%s\n' '{"type":"thread.started","thread_id":"subject-1"}'
printf '%s\n' '{"type":"result","result":"Workflow completed through all phases and archived."}'
""",
        encoding="utf-8",
        newline="\n",
    )
    fake_codex.chmod(0o755)

    env = os.environ.copy()
    env["PATH"] = f"{utils._to_bash_path(fake_bin)}:{env.get('PATH', '')}"
    env["ANTHROPIC_MODEL"] = "claude-only-model"
    env["CAPTURED_CODEX_ARGS"] = utils._to_bash_path(captured_args)
    result = subprocess.run(
        [
            utils.BASH_EXEC,
            utils._to_bash_path(utils.SHELL_DIR / "run-claude-loop.sh"),
            "Implement the requested change.",
            "--agent",
            "codex",
            "--max-turns",
            "1",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert "claude-only-model" not in captured_args.read_text(encoding="utf-8")


def test_claude_loop_consumes_deterministic_reply_steps_in_order(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_claude = fake_bin / "claude"
    fake_claude.write_text(
        """#!/usr/bin/env bash
prompt=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-p" ]]; then
    prompt="$2"
    break
  fi
  shift
done
printf '%s\n' '{"type":"system","session_id":"session-1"}'
case "$prompt" in
  "First reply.")
    printf '%s\n' '{"type":"result","subtype":"success","session_id":"session-1","result":"Question: Which second choice should be used? Recommendation: B. Impact: changes output."}'
    ;;
  "Second reply.")
    printf '%s\n' '{"type":"result","subtype":"success","session_id":"session-1","result":"Workflow completed through all phases and archived."}'
    ;;
  *)
    printf '%s\n' '{"type":"result","subtype":"success","session_id":"session-1","result":"Question: Which first choice should be used? Recommendation: A. Impact: changes output."}'
    ;;
esac
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
            "3",
            "--decision-reply-step",
            "First reply.",
            "--decision-reply-step",
            "Second reply.",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert result.stderr.count("deterministic decision reply applied") == 2
    assert "workflow completion detected" in result.stderr


def test_claude_loop_removes_private_simulator_prompt_before_subject_run(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_claude = fake_bin / "claude"
    fake_claude.write_text(
        """#!/usr/bin/env bash
if [[ -e "$SIMULATOR_LEAK_PATH" ]]; then
  echo "private simulator prompt leaked to subject" >&2
  exit 43
fi
printf '%s\n' '{"type":"system","session_id":"session-1"}'
printf '%s\n' '{"type":"result","subtype":"success","session_id":"session-1","result":"Workflow completed through all phases and archived."}'
""",
        encoding="utf-8",
        newline="\n",
    )
    fake_claude.chmod(0o755)
    simulator_prompt = tmp_path / ".eval-simulator-prompt.txt"
    simulator_prompt.write_text("private fixed decisions", encoding="utf-8")

    env = os.environ.copy()
    env["PATH"] = f"{utils._to_bash_path(fake_bin)}:{env.get('PATH', '')}"
    env["SIMULATOR_LEAK_PATH"] = utils._to_bash_path(simulator_prompt)
    result = subprocess.run(
        [
            utils.BASH_EXEC,
            utils._to_bash_path(utils.SHELL_DIR / "run-claude-loop.sh"),
            "Implement the requested change.",
            "--max-turns",
            "1",
            "--simulator-prompt-file",
            utils._to_bash_path(simulator_prompt),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert "private simulator prompt leaked" not in result.stderr
    assert not simulator_prompt.exists()


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
        "completion-point.sh",
        "- **Archived to**: docs/comet/archive/2026-07-19-add-counting/",
        check=False,
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


def test_copied_scaffold_is_importable_by_validator_script(tmp_path: Path):
    validation_dir = tmp_path / "validation"
    validation_dir.mkdir()
    (validation_dir / "check.py").write_text(
        "from comet_checks import run_comet_checks\n"
        "from scaffold.python.validation.core import load_test_context\n"
        "print('ok')\n",
        encoding="utf-8",
    )

    utils._copy_scaffold_to_docker(tmp_path)

    result = subprocess.run(
        [os.sys.executable, str(validation_dir / "check.py")],
        cwd=tmp_path,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "ok\n"
