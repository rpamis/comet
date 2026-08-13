"""Langfuse suite configuration with collect-safe credential handling."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from scaffold.python.eval_context import (
    ResolvedEvalContext,
    context_from_environment,
    managed_path_for_owner,
    resolve_managed_path,
)
from scaffold.python.paths import get_runs_dir

from scaffold.python.langfuse_adapter import (
    LangfuseConfig,
    LangfuseRunReporter,
    TrajectoryProvisionError,
    create_client,
    enable_trajectory_environment,
    provision_trajectory_plugin,
    result_payload_from_local_report,
)

LANGFUSE_ROOT = Path(__file__).resolve().parents[1]
EVAL_ROOT = LANGFUSE_ROOT.parent
LOCAL_ROOT = EVAL_ROOT / "local"
_LANGFUSE_CLIENT = None
_LANGFUSE_REPORTER: LangfuseRunReporter | None = None
_LANGFUSE_CONFIG: LangfuseConfig | None = None


def default_trajectory_cache_root(context: ResolvedEvalContext) -> Path:
    """Place default trajectory assets in the resolved owner cache."""
    return resolve_managed_path(context, "cache", "langfuse", "plugins")


def resolve_trajectory_cache_root(
    context: ResolvedEvalContext | None, project_root: Path
) -> Path:
    """Keep CLI-resolved trajectory state owner-local; retain direct harness overrides."""
    if context is not None:
        return default_trajectory_cache_root(context)
    explicit_cache = os.environ.get("LANGFUSE_TRAJECTORY_CACHE_DIR")
    if explicit_cache:
        return Path(explicit_cache)
    return managed_path_for_owner(project_root, "cache", "langfuse", "plugins")

os.environ.setdefault("BENCH_SUITE_ROOT", str(LANGFUSE_ROOT))
os.environ.setdefault("BENCH_TASKS_DIR", str(LOCAL_ROOT / "tasks"))
os.environ.setdefault("BENCH_TREATMENTS_DIR", str(LOCAL_ROOT / "treatments"))
os.environ.setdefault("BENCH_SKILLS_DIR", str(LOCAL_ROOT / "skills"))
os.environ.setdefault("BENCH_LOGS_DIR", str(LANGFUSE_ROOT / "logs"))
os.environ.setdefault("LANGFUSE_TEST_SUITE", "comet-skill-eval")

load_dotenv(EVAL_ROOT / ".env")
load_dotenv(LANGFUSE_ROOT / ".env", override=True)

_LOCAL_CONFTEST = LOCAL_ROOT / "tests" / "conftest.py"
_spec = importlib.util.spec_from_file_location("_comet_local_conftest", _LOCAL_CONFTEST)
_local_conftest = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_local_conftest)

for _name in dir(_local_conftest):
    if not _name.startswith("__") and _name not in globals():
        globals()[_name] = getattr(_local_conftest, _name)


def _is_adapter_tests_only(config) -> bool:
    args = [arg for arg in (config.args or []) if not arg.startswith("-")]
    return bool(args) and all("test_adapter.py" in arg for arg in args)


def pytest_configure(config):
    """Register the local plugin, then authenticate before any Agent run."""
    if _is_adapter_tests_only(config):
        _local_conftest._is_unit_tests_only = lambda _config: True
    _local_conftest.pytest_configure(config)
    if (
        config.option.collectonly
        or _local_conftest._is_unit_tests_only(config)
        or _is_adapter_tests_only(config)
    ):
        return

    global _LANGFUSE_CLIENT, _LANGFUSE_CONFIG, _LANGFUSE_REPORTER
    _LANGFUSE_CONFIG = LangfuseConfig.from_environment()
    selected_agent = _local_conftest._resolve_eval_agent(config).agent
    enable_trajectory_environment(_LANGFUSE_CONFIG, selected_agent)
    _LANGFUSE_CLIENT = create_client(_LANGFUSE_CONFIG)
    _LANGFUSE_REPORTER = LangfuseRunReporter(_LANGFUSE_CLIENT)
    context = getattr(config, "_comet_eval_context", None) or context_from_environment()
    project_root = Path(config.getoption("--project-root") or EVAL_ROOT.parent)
    cache_root = resolve_trajectory_cache_root(context, project_root)
    os.environ["LANGFUSE_TRAJECTORY_CACHE_DIR"] = str(cache_root)
    try:
        provision = provision_trajectory_plugin(cache_root, selected_agent)
        if provision.plugin_path is not None:
            os.environ["LANGFUSE_TRAJECTORY_PLUGIN_DIR"] = str(provision.plugin_path)
            os.environ["LANGFUSE_TRAJECTORY_PROVISIONED"] = "true"
    except TrajectoryProvisionError as exc:
        os.environ["LANGFUSE_TRAJECTORY_PROVISIONED"] = "false"
        print(f"[langfuse] optional trajectory provisioning unavailable: {exc}", file=os.sys.stderr)


def pytest_sessionfinish(session, exitstatus):
    """Flush the summary trace after all task cases have completed."""
    if _LANGFUSE_REPORTER is None:
        return
    try:
        if hasattr(session.config, "workerinput"):
            _LANGFUSE_REPORTER.flush()
            return
        if (getattr(session.config.option, "numprocesses", None) or 0) > 0:
            experiment_id = os.environ.get("COMET_EVAL_EXPERIMENT_ID", "")
            reports_dir = get_runs_dir() / experiment_id / "reports"
            cases = []
            for report_path in sorted(reports_dir.glob("*_report.json")):
                report = json.loads(report_path.read_text(encoding="utf-8"))
                cases.append(result_payload_from_local_report(report))
            _LANGFUSE_REPORTER.cases = cases
        _LANGFUSE_REPORTER.report_summary()
        _LANGFUSE_REPORTER.flush()
    except Exception as exc:
        session.exitstatus = 1
        print(f"[langfuse] required summary reporting failed: {exc}", file=os.sys.stderr)


@pytest.fixture(scope="session", autouse=True)
def verify_langfuse_environment(request):
    """Keep collection offline; runtime authentication is done in pytest_configure."""
    if (
        request.config.option.collectonly
        or _local_conftest._is_unit_tests_only(request.config)
        or _is_adapter_tests_only(request.config)
    ):
        return
    if _LANGFUSE_REPORTER is None:
        raise pytest.UsageError("Langfuse reporter was not initialized before Agent execution")
