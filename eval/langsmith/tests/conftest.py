"""LangSmith eval suite pytest configuration.

This suite reuses the local task corpus by default and writes reports under
eval/langsmith/logs. LangSmith-specific environment checks live here so local
runs stay free of LangSmith requirements.
"""

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest
from dotenv import load_dotenv
from scaffold.python.utils import _to_bash_path

LANGSMITH_ROOT = Path(__file__).resolve().parents[1]
EVAL_ROOT = LANGSMITH_ROOT.parent
LOCAL_ROOT = EVAL_ROOT / "local"
DEFAULT_LANGSMITH_PLUGIN_DIR = EVAL_ROOT / ".cache" / "langsmith-cc-plugin"

os.environ.setdefault("BENCH_SUITE_ROOT", str(LANGSMITH_ROOT))
os.environ.setdefault("BENCH_TASKS_DIR", str(LOCAL_ROOT / "tasks"))
os.environ.setdefault("BENCH_TREATMENTS_DIR", str(LOCAL_ROOT / "treatments"))
os.environ.setdefault("BENCH_SKILLS_DIR", str(LOCAL_ROOT / "skills"))
os.environ.setdefault("BENCH_LOGS_DIR", str(LANGSMITH_ROOT / "logs"))
# Group every run in this suite under one LangSmith dataset/test-suite by default.
os.environ.setdefault("LANGSMITH_TEST_SUITE", "comet-skill-eval")

load_dotenv(EVAL_ROOT / ".env")
load_dotenv(LANGSMITH_ROOT / ".env", override=True)


def configure_langsmith_environment() -> None:
    """Derive Claude Code plugin env from the eval suite's LangSmith config."""
    os.environ.setdefault("LANGSMITH_TRACING", "true")
    os.environ.setdefault(
        "TRACE_TO_LANGSMITH",
        "true" if os.environ.get("LANGSMITH_TRACING", "").lower() == "true" else "false",
    )
    os.environ.setdefault("LANGSMITH_PROJECT", "comet-skill-eval")

    api_key = os.environ.get("LANGSMITH_API_KEY", "")
    if api_key:
        os.environ.setdefault("CC_LANGSMITH_API_KEY", api_key)
    os.environ.setdefault("CC_LANGSMITH_PROJECT", os.environ["LANGSMITH_PROJECT"])


configure_langsmith_environment()

_LOCAL_CONFTEST = LOCAL_ROOT / "tests" / "conftest.py"
_spec = importlib.util.spec_from_file_location("_comet_local_conftest", _LOCAL_CONFTEST)
_local_conftest = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_local_conftest)

for _name in dir(_local_conftest):
    if not _name.startswith("__") and _name not in globals():
        globals()[_name] = getattr(_local_conftest, _name)


@pytest.fixture(scope="session", autouse=True)
def verify_langsmith_environment(request):
    """Require LangSmith credentials only for non-unit LangSmith eval runs."""
    if _local_conftest._is_unit_tests_only(request.config):
        return
    if not os.environ.get("LANGSMITH_API_KEY"):
        pytest.skip("LANGSMITH_API_KEY not set")


def _build_default_langsmith_plugin(target_dir: Path) -> bool:
    """Build the official Claude Code LangSmith plugin into eval/.cache."""
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    mount_arg = f"{target_dir.parent}:/out"
    command = (
        "set -e; "
        "cd /tmp; "
        "git clone --depth 1 https://github.com/langchain-ai/langsmith-claude-code-plugins; "
        "cd langsmith-claude-code-plugins; "
        "corepack enable; "
        "pnpm install; "
        "pnpm build; "
        "rm -rf /out/langsmith-cc-plugin; "
        "cp -r . /out/langsmith-cc-plugin"
    )
    result = subprocess.run(
        ["docker", "run", "--rm", "-v", mount_arg, "node:20", "sh", "-c", command],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode == 0:
        return True
    print("[langsmith] failed to auto-build Claude Code tracing plugin.")
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())
    return False


def _plugin_dir_env_value(plugin_dir: Path) -> str:
    """Return a plugin path value that docker.sh can test and mount from bash."""
    return _to_bash_path(plugin_dir)


def provision_langsmith_plugin_dir() -> Path | None:
    """Resolve or auto-build the official Claude Code LangSmith plugin directory."""
    configure_langsmith_environment()
    if os.environ.get("TRACE_TO_LANGSMITH", "").lower() != "true":
        return None

    explicit_dir = os.environ.get("CC_LANGSMITH_PLUGIN_DIR", "").strip()
    if explicit_dir:
        plugin_dir = Path(explicit_dir)
        if plugin_dir.is_dir():
            os.environ["CC_LANGSMITH_PLUGIN_DIR"] = _plugin_dir_env_value(plugin_dir)
            return plugin_dir
        print(
            f"[langsmith] CC_LANGSMITH_PLUGIN_DIR not a directory ({plugin_dir}); "
            "falling back to the eval plugin cache."
        )
        os.environ.pop("CC_LANGSMITH_PLUGIN_DIR", None)

    plugin_dir = DEFAULT_LANGSMITH_PLUGIN_DIR
    if plugin_dir.is_dir():
        os.environ["CC_LANGSMITH_PLUGIN_DIR"] = _plugin_dir_env_value(plugin_dir)
        return plugin_dir

    if os.environ.get("CC_LANGSMITH_PLUGIN_AUTO_BUILD", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print(
            "[langsmith] trajectory tracing disabled: "
            "CC_LANGSMITH_PLUGIN_AUTO_BUILD=false and no plugin directory was provided."
        )
        return None

    print(
        "[langsmith] building Claude Code tracing plugin into "
        f"{plugin_dir} via node:20..."
    )
    if _build_default_langsmith_plugin(plugin_dir) and plugin_dir.is_dir():
        os.environ["CC_LANGSMITH_PLUGIN_DIR"] = _plugin_dir_env_value(plugin_dir)
        return plugin_dir

    os.environ.pop("CC_LANGSMITH_PLUGIN_DIR", None)
    return None


@pytest.fixture(scope="session", autouse=True)
def provision_langsmith_tracing(request):
    """Wire the official langsmith-tracing Claude Code plugin, best-effort.

    Results logging (rubric scores + treatment comparison) only needs a
    LANGSMITH_API_KEY. Trajectory tracing additionally needs the prebuilt
    ``langsmith-tracing`` plugin, provided via ``CC_LANGSMITH_PLUGIN_DIR``
    (host path). When it is missing we log once and continue without the
    nested Claude Code trajectory instead of failing the run.
    """
    if _local_conftest._is_unit_tests_only(request.config):
        return

    plugin_dir = provision_langsmith_plugin_dir()
    if plugin_dir:
        print(f"[langsmith] trajectory tracing enabled via plugin: {plugin_dir}")
    else:
        print(
            "[langsmith] trajectory tracing disabled "
            "(rubric + comparison still logged)."
        )


@pytest.fixture(scope="session")
def langsmith_experiment_metadata():
    """Attach suite metadata to each LangSmith experiment (project).

    Read by the LangSmith pytest plugin (requires langsmith>=0.7.13); ignored by
    older versions.
    """
    return {
        "suite": "comet-skill-eval",
        "cc_model": os.environ.get("BENCH_CC_MODEL", "cli-default"),
        "cc_version": os.environ.get("BENCH_CC_VERSION", "latest"),
    }
