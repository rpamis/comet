"""Shared pytest fixtures and experiment logging plugin.

Generates rich experiment logs in logs/experiments/ including:
- summary.md: Full markdown report with tables and details
- events/: Parsed events from each test run
- raw/: Raw Claude CLI output
- reports/: Per-run validation reports
- artifacts/: Files Claude generated and their execution output
- metadata.json: Experiment metadata

Supports pytest-xdist parallel execution via worker coordination.
"""

import json
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from scaffold import run_claude_in_docker, run_python_in_docker, run_shell
from scaffold.python import (
    ExperimentLogger,
    TreatmentResult,
    build_eval_artifact_references,
    classify_failures,
    get_profile,
    load_report_output_config,
    save_events,
    save_raw,
    save_report,
    strip_ansi,
)
from scaffold.python.sample_quality import infer_sample_quality
from scaffold.python.skill_parser import SCRIPT_EXTENSIONS
from scaffold.python.utils import run_claude_loop_in_docker
from scaffold.python.aligned_comparison import (
    EXPECTED_CASE_MATRIX_FILENAME,
    build_execution_identity,
    expected_case_matrix_payload,
    parse_expected_case_matrix,
)


def _extract_loop_turns(stderr: str | None) -> int | None:
    match = re.search(r"\[loop\] finished after (\d+) turns", stderr or "")
    return int(match.group(1)) if match else None


def _extract_loop_interaction(stderr: str | None) -> dict[str, int | None]:
    source = stderr or ""
    return {
        "actual_turns": _extract_loop_turns(source),
        "decision_points": source.count("[loop] decision point detected"),
        "deterministic_replies": source.count("[loop] deterministic decision reply applied"),
        "completion_signals": source.count("[loop] workflow completion detected"),
        "fresh_resume_boundaries": source.count("[loop] fresh resume boundary detected"),
    }


# =============================================================================
# CONSTANTS
# =============================================================================

PROJECT_ROOT = Path(__file__).parent.parent
EVAL_ROOT = PROJECT_ROOT.parent
REPOSITORY_ROOT = EVAL_ROOT.parent

# Shared files for xdist worker coordination
XDIST_EXPERIMENT_FILE = PROJECT_ROOT / ".pytest_experiment_id"
DOCKER_BUILD_LOCK = PROJECT_ROOT / ".pytest_docker_build.lock"

# Global plugin instance (set during pytest_configure)
_plugin: "ExperimentPlugin | None" = None

# Cache discovered scripts (computed once on first call)
_KNOWN_SCRIPTS: list[str] | None = None

COMET_WORKFLOW_CLAUDE_MD_PATH = (
    PROJECT_ROOT
    / "skills"
    / "benchmarks"
    / "dependency"
    / "claude-md"
    / "comet-workflow"
    / "CLAUDE.md"
)

CURRENT_COMET_CLI_MARKER = ".include-current-comet-cli"
CURRENT_COMET_BUILD_SCHEMA = "comet.eval.current-comet-build.v1"
TRUSTED_NATIVE_RUNTIME_MARKER = ".include-trusted-native-runtime"
TRUSTED_NATIVE_RUNTIME_SCHEMA = "comet.eval.trusted-native-runtime.v1"
MODEL_EXECUTION_ENV_KEYS = (
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "CLAUDE_CODE_SUBAGENT_MODEL",
)


def _selected_claude_model() -> str | None:
    """Resolve the exact model selector passed to Claude without persisting it."""
    return os.environ.get("BENCH_CC_MODEL") or os.environ.get("ANTHROPIC_MODEL")


def _model_execution_config() -> dict[str, str | None]:
    """Return only model-routing values; credentials are deliberately excluded."""
    return {key: os.environ.get(key) for key in MODEL_EXECUTION_ENV_KEYS}


def _capture_execution_identity(test_dir: Path, *, model: str | None, interaction):
    """Capture an immutable image/tool identity and a safe report payload."""
    result = run_shell(
        "docker.sh",
        "execution-identity",
        str(test_dir),
        timeout=300,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Could not verify eval Docker/Claude execution identity")
    try:
        raw = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("Eval execution identity output is not valid JSON") from error
    report_identity = build_execution_identity(
        raw,
        model=model,
        model_config=_model_execution_config(),
        interaction=interaction,
    )
    return SimpleNamespace(
        runtime_image_id=raw["runtime_image_id"],
        report_identity=report_identity,
    )


def _regular_tree_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Current Comet snapshot source contains a symbolic link: {path}")
        if path.is_file():
            files.append(path)
    return files


def _tree_digest(root: Path, files: list[Path] | None = None) -> tuple[str, int]:
    digest = hashlib.sha256()
    selected = files if files is not None else _regular_tree_files(root)
    for path in selected:
        relative = path.relative_to(root).as_posix()
        payload = path.read_bytes()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(payload)).encode("ascii"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(payload).hexdigest().encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest(), len(selected)


def _build_current_comet_dist(checkout: Path, output: Path) -> str:
    """Compile the checkout's TypeScript into an isolated, timestamp-free dist tree."""
    node = shutil.which("node")
    tsc = checkout / "node_modules/typescript/bin/tsc"
    compiler_package = checkout / "node_modules/typescript/package.json"
    if not node or not tsc.is_file() or not compiler_package.is_file():
        raise FileNotFoundError("Current Comet source build requires local Node.js and TypeScript")
    compiler = json.loads(compiler_package.read_text(encoding="utf-8"))
    version = compiler.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("Current Comet TypeScript compiler version is invalid")
    result = subprocess.run(
        [
            node,
            str(tsc),
            "--pretty",
            "false",
            "--outDir",
            str(output),
            "--declaration",
            "false",
            "--declarationMap",
            "false",
            "--sourceMap",
            "false",
            "--incremental",
            "false",
        ],
        cwd=checkout,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stdout + "\n" + result.stderr).strip()
        raise RuntimeError(f"Current Comet source build failed: {detail[-4000:]}")
    required = [output / "app/cli/index.js", output / "domains/dashboard/native-adapter.js"]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Current Comet source build omitted required output: {missing}")
    return version


def _copy_current_comet_cli_snapshot(environment_dir: Path, test_dir: Path) -> None:
    """Expose the current checkout's built CLI to task containers on request.

    The task workspace is the only host directory mounted into Docker.  A task
    carrying ``CURRENT_COMET_CLI_MARKER`` therefore needs an explicit snapshot
    of this checkout's bin/dist package rather than a published npm version.
    """
    if not (environment_dir / CURRENT_COMET_CLI_MARKER).is_file():
        return

    target = test_dir / "_eval_current_comet"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    package_file = REPOSITORY_ROOT / "package.json"
    bin_dir = REPOSITORY_ROOT / "bin"
    source_roots = [
        REPOSITORY_ROOT / "app",
        REPOSITORY_ROOT / "domains",
        REPOSITORY_ROOT / "platform",
    ]
    source_files = [
        path
        for root in source_roots
        for path in _regular_tree_files(root)
        if path.suffix in {".ts", ".tsx", ".json"}
    ]
    source_files.extend(
        path
        for path in (
            REPOSITORY_ROOT / "tsconfig.json",
            package_file,
            REPOSITORY_ROOT / "bin/comet.js",
        )
        if path.is_file()
    )
    if not package_file.is_file() or not bin_dir.is_dir() or not source_files:
        raise FileNotFoundError("Current Comet source snapshot is incomplete")
    source_hash, source_count = _tree_digest(REPOSITORY_ROOT, sorted(set(source_files)))
    with tempfile.TemporaryDirectory(prefix="comet-eval-source-build-") as temporary:
        built_dist = Path(temporary) / "dist"
        compiler_version = _build_current_comet_dist(REPOSITORY_ROOT, built_dist)
        shutil.copytree(built_dist, target / "dist")
    shutil.copytree(bin_dir, target / "bin")
    shutil.copy2(package_file, target / "package.json")
    snapshot_files = [
        path for relative in ("bin", "dist") for path in _regular_tree_files(target / relative)
    ] + [target / "package.json"]
    snapshot_hash, snapshot_count = _tree_digest(target, sorted(snapshot_files))
    identity = {
        "schema": CURRENT_COMET_BUILD_SCHEMA,
        "sourceHash": source_hash,
        "sourceFileCount": source_count,
        "snapshotHash": snapshot_hash,
        "snapshotFileCount": snapshot_count,
        "packageHash": hashlib.sha256((target / "package.json").read_bytes()).hexdigest(),
        "entryHash": hashlib.sha256((target / "dist/app/cli/index.js").read_bytes()).hexdigest(),
        "nativeAdapterHash": hashlib.sha256(
            (target / "dist/domains/dashboard/native-adapter.js").read_bytes()
        ).hexdigest(),
        "compilerVersion": compiler_version,
    }
    (target / "build-identity.json").write_text(
        json.dumps(identity, indent=2) + "\n", encoding="utf-8"
    )


def _copy_trusted_native_runtime_snapshot(
    environment_dir: Path,
    test_dir: Path,
    skills: dict[str, Any] | None,
) -> None:
    """Snapshot the controller-selected Native runtime before the Agent starts."""
    if not (environment_dir / TRUSTED_NATIVE_RUNTIME_MARKER).is_file():
        return
    config = (skills or {}).get("comet-native")
    if not isinstance(config, dict):
        raise ValueError("Trusted Native oracle requires the comet-native Skill source")
    source_dir = config.get("source_dir")
    scripts_dir = config.get("scripts_dir")
    candidates = []
    if source_dir:
        candidates.append(Path(source_dir) / "scripts/comet-native-runtime.mjs")
    if scripts_dir:
        candidates.append(Path(scripts_dir) / "comet-native-runtime.mjs")
    source = next(
        (
            candidate
            for candidate in candidates
            if candidate.is_file() and not candidate.is_symlink()
        ),
        None,
    )
    if source is None:
        raise FileNotFoundError("Controller-selected Comet Native runtime is unavailable")

    target_root = test_dir / "_eval_trusted_oracles"
    if target_root.exists():
        shutil.rmtree(target_root)
    target_root.mkdir(parents=True)
    target = target_root / "comet-native-runtime.mjs"
    shutil.copyfile(source, target)
    identity = {
        "schema": TRUSTED_NATIVE_RUNTIME_SCHEMA,
        "runtimeFile": target.name,
        "runtimeHash": hashlib.sha256(target.read_bytes()).hexdigest(),
    }
    (target_root / "native-runtime-identity.json").write_text(
        json.dumps(identity, indent=2) + "\n", encoding="utf-8"
    )


# =============================================================================
# PYTEST HOOKS
# =============================================================================


def pytest_addoption(parser):
    """Add CLI options for task and treatment selection."""
    parser.addoption(
        "--task",
        action="store",
        default=None,
        help="Run specific task (e.g., --task=comet-full-workflow)",
    )
    parser.addoption(
        "--treatment",
        action="store",
        default=None,
        help="Run specific treatment (e.g., --treatment=COMET_FULL_040_BETA)",
    )
    parser.addoption(
        "--count",
        action="store",
        type=int,
        default=1,
        help="Repeat each task/treatment combination N times for distribution stats (default: 1)",
    )
    parser.addoption(
        "--skill-path",
        action="store",
        default=None,
        help="Local Skill directory or SKILL.md to evaluate",
    )
    parser.addoption(
        "--skill-name",
        action="store",
        default=None,
        help="Skill name to inject for --skill-path",
    )
    parser.addoption(
        "--profile",
        action="store",
        default=None,
        help="Eval profile override",
    )
    parser.addoption(
        "--eval-manifest",
        action="store",
        default=None,
        help="Path to comet/eval.yaml",
    )
    parser.addoption(
        "--interaction-mode",
        action="store",
        default=None,
        help="Override interaction mode (e.g., none, auto_user)",
    )
    parser.addoption(
        "--max-turns",
        action="store",
        default=None,
        help="Override max interaction turns for auto_user loops",
    )
    parser.addoption(
        "--simulator-prompt",
        action="store",
        default=None,
        help="Override user simulator prompt for auto_user loops",
    )
    parser.addoption(
        "--report-config",
        action="store",
        default=None,
        help="JSON/YAML config for eval report outputs",
    )


def pytest_configure(config):
    """Register experiment plugin (decision deferred to sessionstart)."""
    config.addinivalue_line(
        "markers",
        "eval_case(repetition): controller-owned task/treatment/repetition identity",
    )
    global _plugin
    _plugin = ExperimentPlugin(config)
    config.pluginmanager.register(_plugin, "experiment_plugin")


# =============================================================================
# EXPERIMENT PLUGIN
# =============================================================================


class ExperimentPlugin:
    """Pytest plugin that generates rich experiment logs in logs/experiments/."""

    def __init__(self, config):
        self.config = config
        self.logger: ExperimentLogger | None = None
        self.start_time = None
        self.run_counter: dict[str, int] = {}
        self.is_xdist_worker = hasattr(config, "workerinput")
        self.is_xdist_master = (
            not hasattr(config, "workerinput")
            and (getattr(config.option, "numprocesses", None) or 0) > 0
        )
        self.worker_id = (
            config.workerinput.get("workerid", "master") if self.is_xdist_worker else "master"
        )

    def pytest_sessionstart(self, session):
        """Create or join experiment logger at session start."""
        if _is_unit_tests_only(self.config):
            return

        name = _get_experiment_name(session)
        use_coordination = self.is_xdist_worker or self.is_xdist_master
        experiment_id = _get_or_create_experiment_id(name, use_coordination)

        report_outputs = load_report_output_config(self.config.getoption("--report-config"))
        self.logger = ExperimentLogger(
            experiment_name=name,
            experiment_id=experiment_id,
            report_outputs=report_outputs,
        )
        self.start_time = time.time()

        print(f"\n{'=' * 60}")
        print(f"EXPERIMENT: {self.logger.experiment_id}")
        print(f"Logging to: {self.logger.base_dir}")
        print(f"{'=' * 60}\n")

    def pytest_collection_finish(self, session):
        """Persist the full collected case matrix before any model run starts."""
        if not self.logger:
            return
        cases = _expected_cases_from_items(session.items)
        if not cases:
            return
        payload = expected_case_matrix_payload(cases)
        _persist_expected_case_matrix(self.logger.base_dir, payload)
        self.logger.metadata["expected_case_matrix"] = {
            "schema": payload["schema"],
            "matrix_hash": payload["matrix_hash"],
            "case_count": len(payload["cases"]),
            "path": EXPECTED_CASE_MATRIX_FILENAME,
        }

    def pytest_sessionfinish(self, session, exitstatus):
        """Generate and save summary at session end."""
        if not self.logger:
            return

        if self.is_xdist_worker:
            return

        if self.is_xdist_master:
            time.sleep(1)

        self._reload_expected_case_matrix_metadata()
        self._reload_results_from_reports()

        if self.logger.results:
            self.logger.finalize()
            self._print_summary()

        _cleanup_experiment_coordination()

    def _reload_expected_case_matrix_metadata(self):
        """Attach the worker-written matrix to controller-finalized metadata."""
        path = self.logger.base_dir / EXPECTED_CASE_MATRIX_FILENAME
        if not path.is_file():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            matrix = parse_expected_case_matrix(payload)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError("Expected case matrix became invalid before finalize") from error
        self.logger.metadata["expected_case_matrix"] = {
            "schema": payload["schema"],
            "matrix_hash": matrix.matrix_hash,
            "case_count": len(matrix.cases),
            "path": EXPECTED_CASE_MATRIX_FILENAME,
        }

    def get_rep_number(self, treatment_name: str) -> int:
        """Get the next repetition number for a treatment."""
        if treatment_name not in self.run_counter:
            self.run_counter[treatment_name] = 0
        self.run_counter[treatment_name] += 1
        return self.run_counter[treatment_name]

    def _reload_results_from_reports(self):
        """Reload results from saved report files (aggregates all workers)."""
        reports_dir = self.logger.reports_dir
        if not reports_dir.exists():
            return

        self.logger.results.clear()

        for report_file in sorted(reports_dir.glob("*.json")):
            try:
                report = json.loads(report_file.read_text())
                treatment_name = report.get("name", "unknown")
                result = TreatmentResult(
                    name=treatment_name,
                    passed=report.get("passed", False),
                    checks_passed=report.get("checks_passed", []),
                    checks_failed=report.get("checks_failed", []),
                    events_summary=report.get("events_summary", {}),
                    run_id=report.get("run_id", ""),
                )
                if treatment_name not in self.logger.results:
                    self.logger.results[treatment_name] = []
                self.logger.results[treatment_name].append(result)
            except Exception as e:
                import sys

                print(f"Warning: failed to reload report {report_file.name}: {e}", file=sys.stderr)

    def _print_summary(self):
        """Print summary to console."""
        print(f"\n{'=' * 120}")
        print("  RESULTS")
        print(f"{'=' * 120}\n")

        print(
            f"{'Treatment':<25} {'Checks':<15} {'Turns':<8} {'Dur':<8} {'Tokens':<12} {'Cost':<10} {'Skills':<40}"
        )
        print("-" * 120)

        for treatment, runs in self.logger.results.items():
            for r in runs:
                checks_passed = len(r.checks_passed)
                checks_total = checks_passed + len(r.checks_failed)
                check_pct = (checks_passed / checks_total * 100) if checks_total > 0 else 0
                checks_str = f"{checks_passed}/{checks_total} ({check_pct:.0f}%)"
                turns = str(r.turns) if r.turns else "?"
                dur = f"{r.duration:.0f}s" if r.duration else "?"
                tokens = f"{r.total_tokens:,}" if r.total_tokens is not None else "?"
                cost = f"${r.total_cost_usd:.4f}" if r.total_cost_usd is not None else "?"
                skills = r.events_summary.get("skills_invoked", [])
                skills_str = ", ".join(skills) if skills else "none"
                if len(skills_str) > 38:
                    skills_str = skills_str[:35] + "..."
                print(
                    f"{treatment:<25} {checks_str:<15} {turns:<8} {dur:<8} {tokens:<12} {cost:<10} {skills_str:<40}"
                )

        print("-" * 120)
        total_passed = sum(
            sum(len(r.checks_passed) for r in runs) for runs in self.logger.results.values()
        )
        total_checks = sum(
            sum(len(r.checks_passed) + len(r.checks_failed) for r in runs)
            for runs in self.logger.results.values()
        )
        if total_checks:
            print(
                f"Total: {total_passed}/{total_checks} checks passed ({total_passed / total_checks * 100:.1f}%)"
            )
        print(f"{'=' * 120}")


# =============================================================================
# EXPERIMENT PLUGIN HELPERS
# =============================================================================


def _is_unit_tests_only(config) -> bool:
    """Check if running ONLY unit tests (scaffold/scripts - don't need experiment logs)."""
    args = [a for a in (config.args or []) if not a.startswith("-")]
    if not args:
        return False
    return all("scripts" in arg or "scaffold" in arg for arg in args)


def _get_experiment_name(session) -> str:
    """Determine experiment name from task name parameter."""
    items = getattr(session, "items", None)
    if not items:
        return "experiment"

    first_item = items[0]
    if hasattr(first_item, "callspec") and "task_name" in first_item.callspec.params:
        return first_item.callspec.params["task_name"].replace("-", "_")

    return "experiment"


def _get_dynamic_treatment_config(config):
    manifest_path = config.getoption("--eval-manifest")
    if manifest_path:
        from scaffold.python.manifests import load_eval_manifest
        from scaffold.python.treatments import TreatmentConfig

        manifest = load_eval_manifest(manifest_path)
        node_skills = []
        for node_skill in manifest.generated_node_skills:
            node_path = manifest.skill_path.parent / node_skill
            if (node_path / "SKILL.md").exists():
                node_skills.append(
                    {
                        "name": node_skill,
                        "source": "path",
                        "path": str(node_path),
                    }
                )
        return TreatmentConfig(
            name="DYNAMIC_SKILL",
            description=f"Dynamic Skill target: {manifest.skill_name}",
            skills=[
                {
                    "name": manifest.skill_name,
                    "source": "path",
                    "path": str(manifest.skill_path),
                    "profile": manifest.profile,
                    "manifest": str(manifest.path),
                    "baseline_treatments": manifest.baseline_treatments,
                    "quality_gates": manifest.quality_gates,
                    "required_output_schemas": manifest.required_output_schemas,
                    "expected_evidence": manifest.expected_evidence,
                    "draft_hash": manifest.draft_hash,
                    "required_skills": manifest.required_skills,
                    "expected_artifacts": manifest.expected_artifacts,
                    "generated_node_skills": manifest.generated_node_skills,
                    "route_conformance_task": manifest.route_conformance_task,
                    "route_conformance_expected_node_order": (
                        manifest.route_conformance_expected_node_order
                    ),
                }
            ]
            + node_skills,
        )

    skill_path = config.getoption("--skill-path")
    if not skill_path:
        return None
    skill_name = config.getoption("--skill-name") or Path(skill_path).resolve().parent.name
    profile = config.getoption("--profile")
    skill_cfg = {
        "name": skill_name,
        "source": "path",
        "path": skill_path,
    }
    if profile:
        skill_cfg["profile"] = profile
    from scaffold.python.treatments import TreatmentConfig

    return TreatmentConfig(
        name="DYNAMIC_SKILL",
        description=f"Dynamic Skill target: {skill_name}",
        skills=[skill_cfg],
    )


def _resolve_interaction_config(task, profile_name: str, config):
    profile_default = get_profile(profile_name).default_interaction
    task_interaction = task.config.interaction

    mode = task_interaction.mode or profile_default.mode
    max_turns = task_interaction.max_turns or profile_default.max_turns
    simulator_prompt = task_interaction.simulator_prompt or profile_default.simulator_prompt
    decision_patterns = list(
        task_interaction.decision_patterns or profile_default.decision_patterns
    )
    decision_reply = task_interaction.decision_reply or profile_default.decision_reply
    continue_prompt = task_interaction.continue_prompt or profile_default.continue_prompt
    fresh_resume_marker = task_interaction.fresh_resume_marker

    mode_override = config.getoption("--interaction-mode")
    if mode_override:
        mode = mode_override

    max_turns_override = config.getoption("--max-turns")
    if max_turns_override not in (None, ""):
        max_turns = int(max_turns_override)

    simulator_prompt_override = config.getoption("--simulator-prompt")

    prompt_file = os.environ.get("BENCH_SIMULATOR_PROMPT_FILE")
    prompt_path = Path(prompt_file) if prompt_file else (EVAL_ROOT / "simulator-instruction.md")
    if not prompt_path.is_absolute():
        prompt_path = EVAL_ROOT / prompt_path
    if prompt_path.exists():
        simulator_prompt = prompt_path.read_text(encoding="utf-8")

    if simulator_prompt_override:
        simulator_prompt = simulator_prompt_override

    return task_interaction.__class__(
        mode=mode,
        max_turns=max_turns,
        simulator_prompt=simulator_prompt,
        decision_patterns=decision_patterns,
        decision_reply=decision_reply,
        continue_prompt=continue_prompt,
        fresh_resume_marker=fresh_resume_marker,
    )


def _read_required_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Required eval instruction file not found: {path}")
    return path.read_text(encoding="utf-8")


def _build_eval_claude_md(profile_name: str, treatment_claude_md: str | None = None) -> str | None:
    sections: list[str] = []
    if profile_name == "comet-workflow":
        sections.append(_read_required_text(COMET_WORKFLOW_CLAUDE_MD_PATH))
    if treatment_claude_md:
        sections.append(treatment_claude_md.strip())
    return "\n\n".join(section for section in sections if section.strip()) or None


def _comet_hook_command(test_dir: Path) -> str | None:
    scripts_dir = test_dir / ".claude" / "skills" / "comet" / "scripts"
    mjs_hook = scripts_dir / "comet-hook-guard.mjs"
    shell_hook = scripts_dir / "comet-hook-guard.sh"
    if mjs_hook.exists():
        return "node /workspace/.claude/skills/comet/scripts/comet-hook-guard.mjs"
    if shell_hook.exists():
        return "bash /workspace/.claude/skills/comet/scripts/comet-hook-guard.sh"
    return None


def _ensure_claude_pre_tool_hook(test_dir: Path, command: str | None) -> None:
    if not command:
        return
    settings_path = test_dir / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    if settings_path.exists():
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    else:
        settings = {}
    hooks = settings.setdefault("hooks", {})
    pre_tool_use = hooks.setdefault("PreToolUse", [])
    hook_entry = {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{"type": "command", "command": command}],
    }
    if not any(entry == hook_entry for entry in pre_tool_use):
        pre_tool_use.append(hook_entry)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def _get_or_create_experiment_id(name: str, use_coordination: bool) -> str:
    """Get shared experiment ID or create new one."""
    if not use_coordination:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{name}_{timestamp}"

    lock_file = XDIST_EXPERIMENT_FILE.with_suffix(".lock")

    with file_lock(lock_file):
        if XDIST_EXPERIMENT_FILE.exists():
            data = json.loads(XDIST_EXPERIMENT_FILE.read_text())
            return data["experiment_id"]

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        experiment_id = f"{name}_{timestamp}"
        XDIST_EXPERIMENT_FILE.write_text(
            json.dumps(
                {
                    "experiment_id": experiment_id,
                    "created_at": datetime.now().isoformat(),
                }
            )
        )
        return experiment_id


def _expected_cases_from_items(items) -> list[tuple[str, str, int]]:
    """Read explicit eval-case marks from the complete pytest collection."""
    cases: list[tuple[str, str, int]] = []
    for item in items:
        callspec = getattr(item, "callspec", None)
        marker = item.get_closest_marker("eval_case")
        if callspec is None or marker is None:
            continue
        task = callspec.params.get("task_name")
        treatment = callspec.params.get("treatment_name")
        repetition = marker.kwargs.get("repetition")
        if not isinstance(task, str) or not isinstance(treatment, str):
            raise pytest.UsageError("eval_case is missing task/treatment parameters")
        if isinstance(repetition, bool) or not isinstance(repetition, int) or repetition < 1:
            raise pytest.UsageError("eval_case repetition must be a positive integer")
        cases.append((task, treatment, repetition))
    return cases


def _persist_expected_case_matrix(base_dir: Path, payload: dict[str, Any]) -> None:
    """Write one xdist-shared matrix; workers must agree byte-for-byte."""
    canonical = parse_expected_case_matrix(payload)
    path = base_dir / EXPECTED_CASE_MATRIX_FILENAME
    lock_path = base_dir / f".{EXPECTED_CASE_MATRIX_FILENAME}.lock"
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    with file_lock(lock_path):
        if path.exists():
            try:
                existing = parse_expected_case_matrix(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError, ValueError) as error:
                raise RuntimeError("Existing expected case matrix is invalid") from error
            if existing != canonical:
                raise RuntimeError("pytest workers collected different expected case matrices")
            return
        temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
        try:
            temporary.write_text(serialized, encoding="utf-8")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def _snapshot_dynamic_skill_package(test_dir: Path, skill_hints: dict[str, Any]) -> str | None:
    """Copy a manifest target package and generated Node Skills into the workspace.

    Validation scripts run inside Docker with ``test_dir`` mounted as /workspace,
    so they cannot inspect arbitrary host paths from the original manifest. Keep
    a package-shaped snapshot under the workspace and pass a relative path.
    """
    raw_path = skill_hints.get("path")
    if not raw_path:
        return None
    source = Path(raw_path).expanduser().resolve()
    package_dir = source.parent if source.is_file() else source
    if not package_dir.exists():
        return None

    snapshot_root = test_dir / "_eval_target_skills"
    snapshot_root.mkdir(parents=True, exist_ok=True)
    package_dest = snapshot_root / package_dir.name
    shutil.copytree(package_dir, package_dest, dirs_exist_ok=True)

    for node_skill in skill_hints.get("generated_node_skills") or []:
        node_source = package_dir.parent / node_skill
        if not (node_source / "SKILL.md").exists():
            continue
        shutil.copytree(node_source, snapshot_root / node_skill, dirs_exist_ok=True)

    return str(package_dest.relative_to(test_dir)).replace("\\", "/")


def _cleanup_experiment_coordination():
    """Remove coordination files after experiment."""
    import sys

    for f in [XDIST_EXPERIMENT_FILE, XDIST_EXPERIMENT_FILE.with_suffix(".lock")]:
        try:
            f.unlink(missing_ok=True)
        except Exception as e:
            print(f"Warning: failed to clean up {f.name}: {e}", file=sys.stderr)


# =============================================================================
# SESSION-SCOPED FIXTURES
# =============================================================================


@pytest.fixture(scope="session")
def project_root():
    """Project root directory."""
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def worker_id(request):
    """Get pytest-xdist worker ID, or 'master' if not using xdist."""
    if hasattr(request.config, "workerinput"):
        return request.config.workerinput["workerid"]
    return "master"


@pytest.fixture(scope="session", autouse=True)
def verify_environment(project_root, request):
    """Verify Docker, Claude CLI, uv, bash, and API keys are available."""
    if _is_unit_tests_only(request.config):
        return

    from scaffold.python.utils import load_eval_environment

    load_eval_environment()

    # Check uv (Python package manager)
    if shutil.which("uv") is None:
        pytest.skip(
            "uv is not installed or not in PATH.\n"
            "Install it: https://docs.astral.sh/uv/getting-started/installation/"
        )

    # Check bash (required for MSYS shell scripts on Windows)
    from scaffold.python.utils import BASH_EXEC

    if os.name == "nt" and BASH_EXEC == "bash":
        # _resolve_bash() fell back to bare "bash" — verify it actually works
        try:
            bash_check = subprocess.run(["bash", "--version"], capture_output=True, timeout=5)
            if bash_check.returncode != 0:
                raise FileNotFoundError
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pytest.skip(
                "Git Bash not found. Install Git for Windows: https://git-scm.com/download/win\n"
                "Or set GIT_BASH env var to the full path of bash.exe"
            )

    result = run_shell("docker.sh", "check", check=False)
    if result.returncode != 0:
        pytest.skip("Docker not available")

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        pytest.skip("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN not set")

    if shutil.which("claude") is None:
        pytest.skip("Claude CLI not available")


@pytest.fixture(scope="session", autouse=True)
def prebuild_docker_image(request):
    """Pre-build Docker image once per session to avoid race conditions."""
    if _is_unit_tests_only(request.config):
        yield
        return

    tasks_dir = PROJECT_ROOT / "tasks"
    if tasks_dir.exists():
        for task_dir in tasks_dir.iterdir():
            if task_dir.is_dir():
                env_dir = task_dir / "environment"
                if env_dir.exists() and (env_dir / "Dockerfile").exists():
                    image = _build_docker_image_with_lock(env_dir)
                    if image:
                        print(f"\nPre-built Docker image: {image}")

    yield

    try:
        DOCKER_BUILD_LOCK.unlink(missing_ok=True)
    except Exception:
        pass


# =============================================================================
# FUNCTION-SCOPED FIXTURES
# =============================================================================


@pytest.fixture
def test_dir(tmp_path):
    """Create isolated test directory (pytest manages cleanup)."""
    return tmp_path


@pytest.fixture
def experiment_logger():
    """Get the experiment logger for the current session."""
    return _plugin.logger if _plugin else None


@pytest.fixture
def setup_test_context(test_dir):
    """Factory fixture to set up test context with skills and CLAUDE.md."""

    def _write_skill(
        skill_name: str,
        skill_file: str,
        scripts_dir: Path | None = None,
        source_dir: Path | None = None,
    ) -> None:
        skill_dir = test_dir / ".claude" / "skills" / skill_name
        skill_dir.mkdir(parents=True, exist_ok=True)

        if source_dir and source_dir.is_dir():
            shutil.copytree(source_dir, skill_dir, dirs_exist_ok=True)

        shutil.copyfile(skill_file, skill_dir / "SKILL.md")

        if scripts_dir and scripts_dir.is_dir():
            scripts_dest = skill_dir / "scripts"
            shutil.rmtree(scripts_dest, ignore_errors=True)
            shutil.copytree(scripts_dir, scripts_dest, dirs_exist_ok=True)

    def _copy_environment(environment_dir: Path) -> None:
        for item in environment_dir.iterdir():
            if item.name in {CURRENT_COMET_CLI_MARKER, TRUSTED_NATIVE_RUNTIME_MARKER}:
                continue
            dest = test_dir / item.name
            if item.is_dir():
                if dest.exists() and dest.is_dir():
                    shutil.copytree(item, dest, dirs_exist_ok=True)
                else:
                    shutil.copytree(item, dest)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)
        _copy_current_comet_cli_snapshot(environment_dir, test_dir)

    def _write_claude_md(content_file: str) -> None:
        claude_dir = test_dir / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(content_file, claude_dir / "CLAUDE.md")
        shutil.copyfile(content_file, test_dir / "CLAUDE.md")

    def _setup(skills: dict = None, claude_md: str = None, environment_dir: Path = None):
        for skill_name, cfg in (skills or {}).items():
            if not cfg:
                continue

            if isinstance(cfg, dict):
                sections = cfg.get("sections") or cfg.get("all", [])
                scripts_dir = cfg.get("scripts_dir")
                script_filter = cfg.get("script_filter")
                source_dir = cfg.get("source_dir")
            else:
                sections, scripts_dir, script_filter, source_dir = cfg, None, None, None

            if not sections:
                continue

            content = "\n\n".join(s for s in sections if s and s.strip())
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".md", delete=False, encoding="utf-8"
            ) as f:
                f.write(content)
                skill_file = f.name

            filtered_dir = _filter_scripts(scripts_dir, script_filter)
            is_temp_dir = filtered_dir and filtered_dir != scripts_dir

            try:
                _write_skill(skill_name, skill_file, filtered_dir, source_dir)
            finally:
                os.unlink(skill_file)
                if is_temp_dir and filtered_dir.exists():
                    shutil.rmtree(filtered_dir)

        if environment_dir and environment_dir.exists():
            _copy_environment(environment_dir)
            _copy_trusted_native_runtime_snapshot(environment_dir, test_dir, skills)

        if claude_md:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".md", delete=False, encoding="utf-8"
            ) as f:
                f.write(claude_md)
                temp_file = f.name
            try:
                _write_claude_md(temp_file)
            finally:
                os.unlink(temp_file)

        _ensure_claude_pre_tool_hook(test_dir, _comet_hook_command(test_dir))

        return test_dir

    return _setup


@pytest.fixture
def run_claude(test_dir, experiment_logger, request):
    """Factory fixture to run Claude in Docker and capture artifacts.

    For tasks using ``interaction.mode=auto_user`` the single-shot ``run-claude``
    is replaced by the multi-turn ``run-claude-loop`` driver, which simulates a
    user replying at the workflow's decision points.
    """
    default_model = _selected_claude_model()

    def _run(
        prompt: str,
        timeout: int = 600,
        model: str = None,
        interaction=None,
        image_id: str | None = None,
    ):
        mdl = model or default_model
        if os.environ.get("TRACE_TO_LANGSMITH", "").lower() == "true" and not os.environ.get(
            "CC_LANGSMITH_LOG_FILE"
        ):
            os.environ["CC_LANGSMITH_LOG_FILE"] = "/workspace/langsmith-hook.log"
        use_loop = interaction is not None and interaction.mode == "auto_user"
        if not use_loop:
            result = run_claude_in_docker(
                test_dir,
                prompt,
                timeout=timeout,
                model=mdl,
                image_id=image_id,
            )
        else:
            task_prompt_file = test_dir / ".eval-task-prompt.txt"
            task_prompt_file.write_text(prompt, encoding="utf-8")
            loop_args = [
                "run-claude-loop",
                test_dir,
                "@//workspace/.eval-task-prompt.txt",
                "--max-turns",
                str(interaction.max_turns),
            ]
            if mdl:
                loop_args += ["--model", mdl]
            if image_id:
                loop_args += ["--image-id", image_id]
            if interaction.continue_prompt:
                loop_args += ["--continue-prompt", interaction.continue_prompt]
            for pattern in interaction.decision_patterns:
                loop_args += ["--decision-pattern", pattern]
            if interaction.decision_reply:
                loop_args += ["--decision-reply", interaction.decision_reply]
            if interaction.fresh_resume_marker:
                loop_args += ["--fresh-resume-marker", interaction.fresh_resume_marker]

            prompt_file = None
            try:
                if interaction.simulator_prompt and not interaction.decision_reply:
                    prompt_file = test_dir / ".eval-simulator-prompt.txt"
                    prompt_file.write_text(interaction.simulator_prompt, encoding="utf-8")
                    loop_args += [
                        "--simulator-prompt-file",
                        "//workspace/.eval-simulator-prompt.txt",
                    ]
                result = run_claude_loop_in_docker(
                    test_dir,
                    loop_args[2:],
                    timeout=timeout + 60,
                )
            finally:
                task_prompt_file.unlink(missing_ok=True)
                if prompt_file and prompt_file.exists():
                    prompt_file.unlink()

        if experiment_logger and hasattr(request, "node"):
            treatment_name = _get_treatment_name(request.node)
            rep = _plugin.get_rep_number(treatment_name) if _plugin else 1
            save_raw(
                experiment_logger.base_dir,
                treatment_name,
                rep,
                result.stdout,
                result.stderr,
            )

        return result

    return _run


@pytest.fixture
def record_result(test_dir, experiment_logger, request):
    """Factory fixture to record validation results and save artifacts."""

    def _record(
        events: dict[str, Any],
        passed: list[str],
        failed: list[str],
        run_id: str = "",
        returncode: int | None = None,
        stdout: str | None = None,
        stderr: str | None = None,
    ):
        if not experiment_logger:
            return

        treatment_name = _get_treatment_name(request.node)
        rep = _plugin.run_counter.get(treatment_name, 1) if _plugin else 1
        base_dir = experiment_logger.base_dir

        save_events(base_dir, treatment_name, rep, events)
        _save_artifacts(base_dir, treatment_name, rep, test_dir)
        artifact_references = build_eval_artifact_references(base_dir, treatment_name, rep)

        scripts_used = _extract_scripts_used(events)
        failure_attribution = classify_failures(
            failed,
            events,
            events.get("profile"),
        )

        report = _build_report_payload(
            treatment_name=treatment_name,
            rep=rep,
            run_id=run_id,
            events=events,
            passed=passed,
            failed=failed,
            scripts_used=scripts_used,
            artifact_references=artifact_references,
            failure_attribution=failure_attribution,
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        )
        save_report(base_dir, treatment_name, rep, report)

        experiment_logger.add_result(
            treatment_name,
            TreatmentResult(
                name=treatment_name,
                passed=len(failed) == 0,
                checks_passed=passed,
                checks_failed=failed,
                events_summary={
                    "num_turns": events.get("num_turns"),
                    "duration_seconds": events.get("duration_seconds"),
                    "tool_calls": len(events.get("tool_calls", [])),
                    "input_tokens": events.get("input_tokens"),
                    "output_tokens": events.get("output_tokens"),
                    "cache_read_input_tokens": events.get("cache_read_input_tokens"),
                    "cache_creation_input_tokens": events.get("cache_creation_input_tokens"),
                    "total_tokens": events.get("total_tokens"),
                    "total_cost_usd": events.get("total_cost_usd"),
                    "model_usage": events.get("model_usage", {}),
                    "skills_invoked": events.get("skills_invoked", []),
                    "scripts_used": scripts_used,
                    "profile": events.get("profile"),
                    "skill_sources": events.get("skill_sources", []),
                    "eval_manifest": events.get("eval_manifest"),
                    "case_manifest": events.get("case_manifest"),
                    "interaction": events.get("interaction", {}),
                    "artifact_references": artifact_references,
                    "failure_attribution": failure_attribution,
                },
                run_id=run_id,
            ),
        )

    return _record


def _build_report_payload(
    *,
    treatment_name: str,
    rep: int,
    run_id: str,
    events: dict[str, Any],
    passed: list[str],
    failed: list[str],
    scripts_used: list[str],
    artifact_references: dict[str, str],
    failure_attribution: list[dict[str, str]],
    returncode: int | None = None,
    stdout: str | None = None,
    stderr: str | None = None,
) -> dict[str, Any]:
    sample_quality = infer_sample_quality(
        events=events,
        checks_failed=failed,
        failure_attribution=failure_attribution,
        stdout=stdout,
        stderr=stderr,
        returncode=returncode,
    ).to_dict()

    return {
        "name": treatment_name,
        "rep": rep,
        "passed": len(failed) == 0,
        "run_id": run_id,
        "checks_passed": passed,
        "checks_failed": failed,
        "sample_quality": sample_quality,
        "events_summary": {
            "duration_seconds": events.get("duration_seconds"),
            "num_turns": events.get("num_turns"),
            "tool_calls": len(events.get("tool_calls", [])),
            "input_tokens": events.get("input_tokens"),
            "output_tokens": events.get("output_tokens"),
            "cache_read_input_tokens": events.get("cache_read_input_tokens"),
            "cache_creation_input_tokens": events.get("cache_creation_input_tokens"),
            "total_tokens": events.get("total_tokens"),
            "total_cost_usd": events.get("total_cost_usd"),
            "model_usage": events.get("model_usage", {}),
            "files_created": events.get("files_created", []),
            "skills_invoked": events.get("skills_invoked", []),
            "scripts_used": scripts_used,
            "profile": events.get("profile"),
            "skill_sources": events.get("skill_sources", []),
            "eval_manifest": events.get("eval_manifest"),
            "case_manifest": events.get("case_manifest"),
            "interaction": events.get("interaction", {}),
            "artifact_references": artifact_references,
            "failure_attribution": failure_attribution,
        },
        "timestamp": datetime.now().isoformat(),
    }


# Fixture bundle accessor
_current_fixtures: SimpleNamespace | None = None


def get_fixtures() -> SimpleNamespace:
    """Get the current test's fixtures bundle."""
    if _current_fixtures is None:
        raise RuntimeError("get_fixtures() called outside of test context")
    return _current_fixtures


@pytest.fixture(scope="function", autouse=True)
def fixtures(
    verify_environment,
    test_dir,
    setup_test_context,
    run_claude,
    record_result,
    request,
):
    """Bundle test fixtures and make them accessible via get_fixtures()."""
    global _current_fixtures
    _current_fixtures = SimpleNamespace(
        test_dir=test_dir,
        setup_test_context=setup_test_context,
        run_claude=run_claude,
        record_result=record_result,
        request_config=request.config,
    )
    yield _current_fixtures
    _current_fixtures = None


# =============================================================================
# FIXTURE HELPERS
# =============================================================================


def _get_treatment_name(node) -> str:
    """Extract treatment name from pytest node."""
    nodeid = node.nodeid
    if "[" in nodeid:
        return nodeid.split("[")[1].rstrip("]")
    return nodeid.split("::")[-1]


def _filter_scripts(scripts_dir: Path, script_filter: str) -> Path | None:
    """Filter scripts by extension and return a temp dir with filtered scripts."""
    if not scripts_dir or not scripts_dir.exists():
        return None

    if script_filter is None or script_filter == "all":
        return scripts_dir

    extensions = SCRIPT_EXTENSIONS.get(script_filter)
    if extensions is None:
        return scripts_dir

    temp_dir = Path(tempfile.mkdtemp(prefix="scripts_"))
    copied_any = False

    for script in scripts_dir.iterdir():
        if script.is_file() and script.suffix in extensions:
            shutil.copy2(script, temp_dir / script.name)
            copied_any = True

    if not copied_any:
        shutil.rmtree(temp_dir)
        return None

    return temp_dir


def _build_docker_image_with_lock(environment_dir: Path) -> str | None:
    """Build Docker image with file locking to prevent race conditions."""
    if not environment_dir or not (environment_dir / "Dockerfile").exists():
        return None

    with file_lock(DOCKER_BUILD_LOCK):
        result = run_shell("docker.sh", "build", str(environment_dir), timeout=300, check=False)
        if result.returncode == 0:
            return result.stdout.strip()
        return None


@contextmanager
def file_lock(path: Path, timeout: float = 600):
    """Cross-platform exclusive file lock for pytest-xdist coordination."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            deadline = time.monotonic() + timeout
            while True:
                lock_file.seek(0)
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.errno not in {13, 36}:
                        raise
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.05)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _discover_skill_scripts() -> list[str]:
    """Dynamically discover all script files from skills directories."""
    scripts = set()
    skills_dir = PROJECT_ROOT / "skills"

    if not skills_dir.exists():
        return []

    for scripts_dir in skills_dir.rglob("scripts"):
        if scripts_dir.is_dir():
            for script in scripts_dir.iterdir():
                if script.is_file() and script.suffix in {".py", ".ts", ".js"}:
                    scripts.add(script.name)

    return sorted(scripts)


def _get_known_scripts() -> list[str]:
    """Get known scripts, discovering them on first call."""
    global _KNOWN_SCRIPTS
    if _KNOWN_SCRIPTS is None:
        _KNOWN_SCRIPTS = _discover_skill_scripts()
    return _KNOWN_SCRIPTS


def _extract_scripts_used(events: dict) -> list[str]:
    """Extract which skill scripts were used from events."""
    commands = " ".join(events.get("commands_run", [])).lower()
    files_read = " ".join(events.get("files_read", [])).lower()
    all_activity = commands + " " + files_read

    return [s for s in _get_known_scripts() if s.lower() in all_activity]


def _save_artifacts(base_dir: Path, treatment_name: str, rep: int, test_dir: Path):
    """Save Claude's generated files as artifacts."""
    artifacts_dir = base_dir / "artifacts" / f"{treatment_name.lower()}_rep{rep}"
    claude_dir = artifacts_dir / "claude"
    execution_dir = artifacts_dir / "execution"
    claude_dir.mkdir(parents=True, exist_ok=True)
    execution_dir.mkdir(parents=True, exist_ok=True)

    from scaffold.python.utils import TEST_CONTEXT_FILE, TEST_RESULTS_FILE

    exclude_dirs = {
        ".claude",
        ".git",
        "_eval_current_comet",
        "node_modules",
        "__pycache__",
        "scaffold",
        "validation",
        "data",
    }
    exclude_files = {
        "CLAUDE.md",
        "Dockerfile",
        "requirements.txt",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        TEST_CONTEXT_FILE,
        TEST_RESULTS_FILE,
    }

    claude_files = []
    for item in test_dir.rglob("*"):
        if not item.is_file():
            continue
        if item.name.startswith("."):
            continue
        if item.name in exclude_files:
            continue
        if any(excl in item.parts for excl in exclude_dirs):
            continue
        try:
            rel_path = item.relative_to(test_dir)
            dest = claude_dir / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(item, dest)
            claude_files.append(item)
        except Exception as e:
            import sys

            print(f"Warning: failed to save artifact {item.name}: {e}", file=sys.stderr)

    for py_file in claude_files:
        if py_file.suffix == ".py" and py_file.parent == test_dir:
            try:
                success, output = run_python_in_docker(test_dir, py_file.name, timeout=300)
                status = "success" if success else "error"
                output_file = execution_dir / f"{py_file.stem}_{status}.txt"
                output_file.write_text(strip_ansi(output))
            except Exception as e:
                error_file = execution_dir / f"{py_file.stem}_error.txt"
                error_file.write_text(str(e))
