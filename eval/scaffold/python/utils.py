"""Python utilities - thin wrappers around shell scripts."""
import json, os, random, shutil, subprocess, time
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from scaffold.python.paths import EVAL_ROOT, get_suite_root

TEST_CONTEXT_FILE = os.environ.get("BENCH_TEST_CONTEXT", "_test_context.json")
TEST_RESULTS_FILE = os.environ.get("BENCH_TEST_RESULTS", "_test_results.json")
load_dotenv(EVAL_ROOT / ".env")
load_dotenv(get_suite_root() / ".env", override=True)
SHELL_DIR = Path(__file__).parent.parent / "shell"
SCAFFOLD_PYTHON_DIR = Path(__file__).parent

def _resolve_bash() -> str:
    """Resolve a reliable bash executable for running MSYS shell scripts.

    On Windows, ``subprocess.run(['bash', ...])`` may resolve ``bash`` via
    CreateProcess's PATH search to WSL's ``C:\\Windows\\System32\\bash.exe``,
    which cannot run MSYS scripts (it uses ``/mnt/d`` paths). ``shutil.which``
    honours the Python/MSYS PATH ordering and returns the git-bash binary
    first, and passing that full path to subprocess bypasses the ambiguous
    bare-name lookup. Prefer an explicit ``GIT_BASH`` env var when set.
    """
    import shutil

    if os.name != "nt":
        return "bash"

    env_bash = os.environ.get("GIT_BASH")
    if env_bash and os.path.isfile(env_bash):
        return env_bash

    resolved = shutil.which("bash")
    if resolved and os.path.isfile(resolved):
        return resolved

    return "bash"


BASH_EXEC = _resolve_bash()
WSL_ENV_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LANGSMITH_API_KEY",
    "LANGSMITH_PROJECT",
    "LANGSMITH_TRACING",
    "LANGSMITH_ENDPOINT",
    "TAVILY_API_KEY",
    "TRACE_TO_LANGSMITH",
    "CC_LANGSMITH_API_KEY",
    "CC_LANGSMITH_PROJECT",
    "CC_LANGSMITH_DEBUG",
    "CC_LANGSMITH_LOG_FILE",
    "CC_LANGSMITH_METADATA",
    "CC_LANGSMITH_PARENT_DOTTED_ORDER",
    "CC_LANGSMITH_PLUGIN_DIR",
    "BENCH_EVAL_LANGSMITH_TRACE",
    "BENCH_EVAL_BAGGAGE",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "BENCH_CC_VERSION",
    "BENCH_CC_MODEL",
)


def _to_bash_path(value) -> str:
    """Normalise a path argument for bash on Windows.

    Git Bash/MSYS resolves script paths in ``/d/...`` form, while WSL bash
    resolves Windows drives under ``/mnt/d/...``. Windows backslash paths get
    their separators eaten as escapes, and ``D:/...`` drive-letter form is
    rejected when passed as argv (no shell parsing). On non-Windows, pass
    through.
    """
    s = str(value)
    if os.name == "nt":
        s = s.replace("\\", "/")
        if len(s) >= 2 and s[1] == ":" and s[0].isalpha():
            drive = s[0].lower()
            prefix = f"/mnt/{drive}" if _uses_wsl_bash(BASH_EXEC) else f"/{drive}"
            s = prefix + s[2:]
    return s


def _uses_wsl_bash(bash_exec: str) -> bool:
    normalized = bash_exec.replace("\\", "/").lower()
    return normalized.endswith("/windowsapps/bash.exe") or normalized.endswith("/system32/bash.exe")


def _bash_env() -> dict[str, str]:
    env = os.environ.copy()
    if os.name != "nt" or not _uses_wsl_bash(BASH_EXEC):
        return env

    existing = [item for item in env.get("WSLENV", "").split(":") if item]
    exported = [key for key in WSL_ENV_KEYS if env.get(key)]
    merged = list(dict.fromkeys(existing + exported))
    if merged:
        env["WSLENV"] = ":".join(merged)
    return env


def run_shell(script, *args, timeout=None, check=True):
    cmd = [BASH_EXEC, _to_bash_path(SHELL_DIR / script)] + [_to_bash_path(a) for a in args]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=check,
        env=_bash_env(),
    )

def check_docker_available():
    try:
        return run_shell("docker.sh", "check", check=False, timeout=10).returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False

def build_docker_image(test_dir, force=False, verbose=False):
    try:
        args = ["build", str(test_dir)] + (["--force"] if force else [])
        result = run_shell("docker.sh", *args, timeout=300, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except subprocess.TimeoutExpired:
        return None

def _docker_run_script(mode, test_dir, script_name, timeout=120, args=None):
    if not check_docker_available():
        return False, "Docker not available"
    try:
        cmd = [mode, str(test_dir), script_name] + (args or [])
        result = run_shell("docker.sh", *cmd, timeout=timeout, check=False)
        return result.returncode == 0, result.stdout
    except subprocess.TimeoutExpired:
        return False, f"Timeout ({timeout}s)"
    except Exception as e:
        return False, str(e)

def run_python_in_docker(test_dir, script_name, timeout=120, args=None):
    return _docker_run_script("run-python", test_dir, script_name, timeout, args)

def run_node_in_docker(test_dir, script_name, timeout=120, args=None):
    return _docker_run_script("run-node", test_dir, script_name, timeout, args)

def run_claude_in_docker(test_dir, prompt, timeout=300, model=None):
    if not check_docker_available():
        raise RuntimeError("Docker not available")
    cmd = ["run-claude", str(test_dir), prompt, "--timeout", str(timeout)]
    if model:
        cmd.extend(["--model", model])
    try:
        return run_shell("docker.sh", *cmd, timeout=timeout + 30, check=False)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 124, "", f"Timeout after {timeout}s")

def _copy_scaffold_to_docker(test_dir):
    scaffold_root = SCAFFOLD_PYTHON_DIR.parent
    scaffold_dir = test_dir / "scaffold"
    scaffold_dir.mkdir(parents=True, exist_ok=True)
    (scaffold_dir / "__init__.py").touch()
    py_dest = scaffold_dir / "python"
    py_dest.mkdir(exist_ok=True)
    (py_dest / "__init__.py").touch()
    shutil.copy(SCAFFOLD_PYTHON_DIR / "utils.py", py_dest / "utils.py")
    py_validation = SCAFFOLD_PYTHON_DIR / "validation"
    if py_validation.is_dir():
        shutil.copytree(py_validation, py_dest / "validation", dirs_exist_ok=True)

    # Copy the shared comet-workflow checks as a TOP-LEVEL module (comet_checks)
    # so validators can `from comet_checks import ...` without triggering the
    # scaffold package __init__ chain (which depends on host-side libs like
    # dotenv that are absent in the validator container).
    comet_checks_src = py_validation / "comet_workflow.py"
    if comet_checks_src.exists():
        shutil.copy(comet_checks_src, test_dir / "comet_checks.py")

def _parse_json_output(output):
    stripped = output.strip()
    try:
        result = json.loads(stripped)
        if isinstance(result, dict):
            return result
    except (json.JSONDecodeError, ValueError):
        pass
    for line in reversed(stripped.splitlines()):
        try:
            result = json.loads(line)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            continue
    return None

def run_eval_in_docker(test_dir, validation_dir, test_script, timeout=120, data_dir=None):
    val_dir = test_dir / "validation"
    val_dir.mkdir(exist_ok=True)
    for f in validation_dir.iterdir():
        if f.is_file():
            shutil.copy(f, val_dir / f.name)
    if data_dir and data_dir.is_dir():
        dest_data = test_dir / "data"
        dest_data.mkdir(exist_ok=True)
        for f in data_dir.iterdir():
            if f.is_file():
                shutil.copy(f, dest_data / f.name)
    _copy_scaffold_to_docker(test_dir)
    results_path = test_dir / TEST_RESULTS_FILE
    results_path.unlink(missing_ok=True)
    script_path = f"validation/{test_script}"
    if test_script.endswith((".ts", ".js")):
        success, output = run_node_in_docker(test_dir, script_path, timeout=timeout)
    else:
        success, output = run_python_in_docker(test_dir, script_path, timeout=timeout)
    if results_path.exists():
        try:
            return json.loads(results_path.read_text())
        except (json.JSONDecodeError, ValueError):
            pass
    result = _parse_json_output(output)
    if result is not None:
        return result
    return {"error": f"No JSON output. success={success}, output={output[:300]}"}


def _format_structured_check(check):
    name = str(check.get("check") or check.get("name") or "check")
    detail = check.get("message") or check.get("reason") or check.get("error") or ""
    return f"{name}: {detail}" if detail else name


def _normalise_validation_results(results):
    passed = list(results.get("passed") or [])
    failed = list(results.get("failed") or [])

    for check in results.get("checks") or []:
        if not isinstance(check, dict):
            continue
        status = str(check.get("status") or "").lower()
        message = _format_structured_check(check)
        if status in {"passed", "pass", "ok", "success"}:
            passed.append(message)
        elif status in {"failed", "fail", "error"}:
            failed.append(message)

    return passed, failed

def make_execution_validator(validation_dir, test_scripts, target_artifacts, timeout=120, data_dir=None):
    test_scripts = [test_scripts] if isinstance(test_scripts, str) else test_scripts
    artifacts = [target_artifacts] if isinstance(target_artifacts, str) else target_artifacts

    def validate_execution(test_dir, outputs):
        passed, failed = [], []
        for artifact in artifacts:
            if any(c in artifact for c in "*?["):
                if not list(test_dir.glob(artifact)):
                    failed.append(f"Artifact not found: {artifact}")
            elif not (test_dir / artifact).exists():
                failed.append(f"Artifact not found: {artifact}")
        if failed:
            return passed, failed
        context = dict(outputs) if outputs else {}
        context["target_artifacts"] = artifacts
        (test_dir / TEST_CONTEXT_FILE).write_text(json.dumps(context, default=str))
        for script in test_scripts:
            results = run_eval_in_docker(test_dir, validation_dir, script, timeout=timeout, data_dir=data_dir)
            script_passed, script_failed = _normalise_validation_results(results)
            passed.extend(script_passed)
            failed.extend(script_failed)
            if results.get("error") and not script_passed and not script_failed:
                failed.append(f"Test execution error ({script}): {results['error']}")
        return passed, failed

    return validate_execution

def check_claude_available():
    try:
        return subprocess.run(["claude", "--version"], capture_output=True, timeout=10).returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False

def retry_with_backoff(func, max_retries=3, base_delay=1.0, max_delay=10.0, retry_on=None):
    retry_on = retry_on or (lambda e: "429" in str(e) or "rate limit" in str(e).lower())
    for attempt in range(max_retries + 1):
        try:
            return func()
        except Exception as e:
            if not retry_on(e) or attempt == max_retries:
                raise
            time.sleep(min(base_delay * (2**attempt) + random.uniform(0, 1), max_delay))

def read_json_file(path):
    if not path.exists():
        return None, f"file not found: {path.name}"
    try:
        with open(path) as f:
            return json.load(f), None
    except json.JSONDecodeError as e:
        return None, f"invalid JSON: {e}"
    except Exception as e:
        return None, str(e)


def get_langsmith_client():
    """Get LangSmith client if available.

    Returns:
        (client, None) on success, (None, error_message) on failure.
        The client is a langsmith.Client instance configured from environment.
    """
    try:
        from langsmith import Client
    except ImportError:
        return None, "langsmith package not installed (pip install langsmith)"

    api_key = os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY")
    if not api_key:
        return None, "LANGSMITH_API_KEY not set"

    try:
        client = Client(api_key=api_key)
        return client, None
    except Exception as e:
        return None, f"LangSmith client error: {e}"


def safe_api_call(func, *args, **kwargs):
    """Execute a LangSmith API call with error handling.

    Returns:
        (result, None) on success, (None, error_message) on failure.
    """
    try:
        result = func(*args, **kwargs)
        return result, None
    except Exception as e:
        return None, f"API error: {e}"

def get_field(obj, *keys, default=None):
    if not isinstance(obj, dict):
        return default
    for key in keys:
        if key in obj:
            return obj[key]
    return default

def get_nested_field(obj, outer_keys, inner_keys, default=None):
    outer = get_field(obj, *outer_keys) or {}
    return get_field(outer, *inner_keys, default=default) if isinstance(outer, dict) else default

def normalize_score(score):
    if isinstance(score, bool):
        return 1.0 if score else 0.0
    if isinstance(score, (int, float)) and score > 1:
        return score / 100.0
    return float(score) if score is not None else 0.0
