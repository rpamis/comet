"""Path helpers for eval suites."""

import os
from pathlib import Path

from scaffold.python.eval_context import context_from_environment, resolve_managed_path


EVAL_ROOT = Path(__file__).resolve().parents[2]
SUITE_NAMES = {"local", "langsmith", "langfuse"}


def get_suite_root() -> Path:
    """Return the active eval suite root.

    Resolution order:
    1. BENCH_SUITE_ROOT, for explicit automation
    2. Current working directory when it looks like a suite root
    3. Any parent of the current working directory named local/langsmith
    4. eval/local as the default local suite
    """
    configured = os.environ.get("BENCH_SUITE_ROOT")
    if configured:
        return Path(configured).resolve()

    cwd = Path.cwd().resolve()
    if (cwd / "tasks").exists() and (cwd / "treatments").exists():
        return cwd

    for parent in (cwd, *cwd.parents):
        if parent.name in SUITE_NAMES:
            return parent

    return EVAL_ROOT / "local"


def get_suite_name() -> str:
    return get_suite_root().name


def get_tasks_dir() -> Path:
    configured = os.environ.get("BENCH_TASKS_DIR")
    return Path(configured).resolve() if configured else get_suite_root() / "tasks"


def get_treatments_dir() -> Path:
    configured = os.environ.get("BENCH_TREATMENTS_DIR")
    return Path(configured).resolve() if configured else get_suite_root() / "treatments"


def get_skills_dir() -> Path:
    configured = os.environ.get("BENCH_SKILLS_DIR")
    return Path(configured).resolve() if configured else get_suite_root() / "skills"


def get_logs_dir() -> Path:
    configured = os.environ.get("BENCH_LOGS_DIR")
    return Path(configured).resolve() if configured else get_suite_root() / "logs"


def get_runs_dir() -> Path:
    """Return the run directory, preferring CLI-resolved user-owned state."""
    context = context_from_environment()
    if context is not None:
        return resolve_managed_path(context, "runs")
    return get_logs_dir() / "experiments"
