"""Generic test runner for comet skill task + treatment combinations.

Usage:
    # Run all default task/treatment combinations
    pytest local/tests/tasks/test_tasks.py -v

    # Run specific task with specific treatment
    pytest local/tests/tasks/test_tasks.py --task=comet-full-workflow --treatment=COMET_FULL_040_BETA -v

    # Run specific task with multiple treatments (comma-separated)
    pytest local/tests/tasks/test_tasks.py --task=comet-full-workflow --treatment=COMET_FULL_040_BETA,CONTROL -v

    # Run with repetitions and parallel workers
    pytest local/tests/tasks/test_tasks.py --task=comet-full-workflow --treatment=COMET_FULL_040_BETA --count=2 -n 2 -v
"""

import sys
import uuid

import pytest
import conftest
from conftest import get_fixtures

from scaffold import Treatment
from scaffold.python import extract_events, parse_output
from scaffold.python.aligned_comparison import build_case_manifest, case_manifest_payload
from scaffold.python.native_eval import (
    adapt_checks_for_native,
    adapt_prompt_for_native,
    filter_control_workflow_checks as _filter_control_workflow_checks,
    is_control_business_only_run as _is_control_business_only_run,
    is_observational_baseline_run as _is_observational_baseline_run,
    split_comet_completion_checks as _split_comet_completion_checks,
)
from scaffold.python.profiles import resolve_profile_name, run_profile_rubric
from scaffold.python.agents import get_agent_adapter
from scaffold.python.execution import redact_sensitive
from scaffold.python.manifest_tasks import load_manifest_tasks
from scaffold.python.eval_context import resolve_eval_context
from scaffold.python.task_resolution import build_task_catalogue, resolve_task_set
from scaffold.python.paths import get_tasks_dir
from scaffold.python.tasks import list_tasks, load_task
from scaffold.python.treatments import TreatmentConfig, build_treatment_skills, load_treatments
from scaffold.python.validation import run_validators

# Timeouts
CLAUDE_TIMEOUT = 1500  # Default floor for Claude to complete a multi-turn task
PYTEST_TIMEOUT = 3000  # 50 minutes total including task-specific runtime and teardown
MANIFEST_DYNAMIC_ONLY_TASKS = {"workflow-overlay-contract"}


def _manifest_authored_tasks(config):
    if config is None or not config.getoption("--eval-manifest"):
        return {}
    from scaffold.python.manifests import load_eval_manifest

    manifest = load_eval_manifest(config.getoption("--eval-manifest"))
    return {task.name: task for task in load_manifest_tasks(manifest)}


def _load_eval_task(task_name: str, config=None):
    resolved = getattr(config, "_comet_resolved_tasks", {}) if config is not None else {}
    if task_name in resolved:
        return resolved[task_name]
    authored = _manifest_authored_tasks(config)
    if task_name in authored:
        return authored[task_name]
    return load_task(task_name)


def _resolve_frozen_task_set(config, task_filter: str | None):
    """Resolve once per collection and retain the exact cross-suite task identity."""
    frozen = getattr(config, "_comet_frozen_task_set", None)
    if frozen is not None:
        return frozen
    from scaffold.python.manifests import SkillEvalManifest, load_eval_manifest

    manifest_path = config.getoption("--eval-manifest")
    context = getattr(config, "_comet_eval_context", None)
    if manifest_path:
        manifest = load_eval_manifest(manifest_path)
        context = context or resolve_eval_context(
            manifest_path=manifest.path, project_root=config.getoption("--project-root")
        )
    else:
        if context is None:
            context = resolve_eval_context(
                skill_path=config.getoption("--skill-path"),
                project_root=config.getoption("--project-root"),
            )
        manifest = SkillEvalManifest(
            path=context.skill_root / "comet" / "eval.yaml",
            name=context.skill_root.name,
            description="",
            skill_name=config.getoption("--skill-name") or context.skill_root.name,
            skill_path=context.skill_root,
            profile=config.getoption("--profile"),
        )
    frozen = resolve_task_set(
        context,
        manifest,
        build_task_catalogue(manifest, get_tasks_dir()),
        explicit_task=task_filter,
        quick=bool(config.getoption("--quick")),
        execution=conftest._resolve_eval_execution(config),
    )
    config._comet_frozen_task_set = frozen
    config._comet_resolved_tasks = {item.name: item.task for item in frozen.tasks}
    config._comet_resolution_manifest = manifest
    return frozen


# =============================================================================
# PARAMETRIZE HELPERS
# =============================================================================


def expand_treatment_patterns(patterns: list[str], all_treatments: dict) -> list[str]:
    """Expand treatment patterns into matching treatment names."""
    treatment_names = list(all_treatments.keys())
    expanded = []

    for pattern in patterns:
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            matches = [t for t in treatment_names if t.startswith(prefix)]
            if not matches:
                raise ValueError(
                    f"No treatments match pattern: {pattern}. Available: {treatment_names}"
                )
            expanded.extend(matches)
        else:
            if pattern not in all_treatments:
                raise ValueError(f"Treatment not found: {pattern}. Available: {treatment_names}")
            expanded.append(pattern)

    return list(dict.fromkeys(expanded))


def generate_test_params(task_filter: str | None, treatment_filter: str | None, config=None):
    """Generate (task_name, treatment_name) pairs based on filters."""
    params = []
    if config is not None:
        conftest._ensure_auto_generated_manifest(config, task_filter)
    all_treatments = load_treatments()
    all_tasks = list_tasks()
    dynamic = None

    if config is not None:
        dynamic = conftest._get_dynamic_treatment_config(config)
        if dynamic:
            all_treatments[dynamic.name] = dynamic
    manifest_tasks = None
    authored_tasks = {}
    manifest_baseline_treatments = []
    frozen_selected = False
    if config is not None and (config.getoption("--eval-manifest") or config.getoption("--skill-path")):
        resolved = _resolve_frozen_task_set(config, task_filter)
        frozen_selected = True
        manifest = config._comet_resolution_manifest
        manifest_tasks = [item.name for item in resolved.tasks]
        authored_tasks = {
            item.name: item.task
            for item in resolved.tasks
            if item.provenance in {"inline", "source"}
        }
        manifest_baseline_treatments = manifest.baseline_treatments

    if task_filter and task_filter not in set(all_tasks) | set(authored_tasks):
        available = sorted(set(all_tasks) | set(authored_tasks))
        raise ValueError(f"Task not found: {task_filter}. Available: {available}")

    treatment_list = []
    if treatment_filter:
        patterns = [t.strip() for t in treatment_filter.split(",")]
        treatment_list = expand_treatment_patterns(patterns, all_treatments)
    elif dynamic and manifest_tasks:
        treatment_list = [
            treatment for treatment in manifest_baseline_treatments if treatment in all_treatments
        ]
        if dynamic.name not in treatment_list:
            treatment_list.append(dynamic.name)
    elif dynamic:
        treatment_list = [dynamic.name]

    if task_filter:
        tasks_to_run = [task_filter]
    elif frozen_selected:
        tasks_to_run = list(manifest_tasks or [])
    elif authored_tasks or manifest_tasks:
        tasks_to_run = list(manifest_tasks or authored_tasks)
    else:
        tasks_to_run = all_tasks
    tasks_to_run = list(dict.fromkeys(tasks_to_run))

    for task_name in tasks_to_run:
        task = _load_eval_task(task_name, config)
        task_treatments = treatment_list
        if (
            dynamic
            and manifest_tasks
            and not treatment_filter
            and task_name in MANIFEST_DYNAMIC_ONLY_TASKS
        ):
            task_treatments = [dynamic.name]
        if task_treatments:
            for treatment_name in task_treatments:
                params.append((task_name, treatment_name))
        else:
            for treatment_name in task.default_treatments:
                if treatment_name in all_treatments:
                    params.append((task_name, treatment_name))

    return params


def test_eval_manifest_baselines_extend_dynamic_treatment_list(tmp_path, monkeypatch):
    package = tmp_path / "manifest-skill"
    package.mkdir()
    (package / "SKILL.md").write_text("---\nname: manifest-skill\n---\n\nBody.", encoding="utf-8")
    comet_dir = package / "comet"
    comet_dir.mkdir()
    manifest = comet_dir / "eval.yaml"
    manifest.write_text(
        """
apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: manifest-skill
skill:
  name: manifest-skill
  source: ..
evaluation:
  recommendedTasks:
    - generic-skill-smoke
    - workflow-overlay-contract
  baselineTreatments:
    - CONTROL
    - COMET_FULL_040_BETA
    - MISSING_BASELINE
interaction:
  mode: none
""",
        encoding="utf-8",
    )

    class Config:
        def getoption(self, name):
            return {"--eval-manifest": str(manifest)}.get(name)

    monkeypatch.setattr(
        sys.modules[__name__],
        "load_treatments",
        lambda: {
            "CONTROL": TreatmentConfig(name="CONTROL", description="Control"),
            "COMET_FULL_040_BETA": TreatmentConfig(
                name="COMET_FULL_040_BETA", description="Comet full"
            ),
        },
    )

    params = generate_test_params("generic-skill-smoke", None, Config())

    assert params == [
        ("generic-skill-smoke", "CONTROL"),
        ("generic-skill-smoke", "COMET_FULL_040_BETA"),
        ("generic-skill-smoke", "DYNAMIC_SKILL"),
    ]

    assert generate_test_params("workflow-overlay-contract", None, Config()) == [
        ("workflow-overlay-contract", "DYNAMIC_SKILL")
    ]
    assert generate_test_params(None, None, Config()) == [
        ("generic-skill-smoke", "CONTROL"),
        ("generic-skill-smoke", "COMET_FULL_040_BETA"),
        ("generic-skill-smoke", "DYNAMIC_SKILL"),
        ("workflow-overlay-contract", "DYNAMIC_SKILL"),
    ]


def test_eval_manifest_prefers_authored_tasks_over_recommended_tasks(tmp_path):
    package = tmp_path / "manifest-skill"
    package.mkdir()
    (package / "SKILL.md").write_text("# Skill\n", encoding="utf-8")
    comet_dir = package / "comet"
    comet_dir.mkdir()
    manifest = comet_dir / "eval.yaml"
    manifest.write_text(
        "\n".join(
            [
                "apiVersion: comet.eval/v1alpha1",
                "kind: SkillEvalManifest",
                "metadata:",
                "  name: manifest-skill",
                "skill:",
                "  name: manifest-skill",
                "  source: ..",
                "evaluation:",
                "  tasks:",
                "    - name: inline-task",
                "      prompt: Create result.md.",
                "      expect:",
                "        files: [result.md]",
                "  recommendedTasks:",
                "    - generic-skill-smoke",
            ]
        ),
        encoding="utf-8",
    )

    class Config:
        def getoption(self, name):
            return {"--eval-manifest": str(manifest)}.get(name)

    params = generate_test_params(None, None, Config())

    assert [task_name for task_name, _ in params] == ["inline-task"]
    assert all(treatment == "DYNAMIC_SKILL" for _, treatment in params)


def test_control_comet_workflow_filters_workflow_only_checks():
    passed, failed = _filter_control_workflow_checks(
        "comet-workflow",
        "CONTROL",
        [
            "sentence_feature",
            "tests_written: ok",
            "workflow_phases: 5/5",
            "tests_exist",
            "native_skill_invocation",
            "native_artifacts",
            "native_loop",
        ],
        [
            "openspec_artifacts: openspec/changes/ directory not found",
            "comet_state: No .comet.yaml found",
            "workflow_phases: Only 1/5 phases",
            "tests_written: No test files written by the agent",
            "tests_exist: No test files found",
            "native_state: no terminal Native archive exists",
            "native_isolation: Classic or hidden workflow artifacts exist",
            "sentence_feature: --sentences flag not found",
        ],
    )

    assert passed == ["sentence_feature"]
    assert failed == ["sentence_feature: --sentences flag not found"]


def test_split_comet_completion_checks_separates_business_and_workflow():
    completion = _split_comet_completion_checks(
        [
            "sentence_feature",
            "tests_exist",
            "workflow_phases: 5/5",
            "native_skill_invocation",
            "native_artifacts",
            "native_loop",
        ],
        [
            "openspec_artifacts: missing",
            "comet_state: missing",
            "native_state: incomplete",
            "native_isolation: forbidden artifacts",
            "business_rule: failed",
        ],
    )

    assert completion["business_completion"] == {
        "passed": ["sentence_feature"],
        "failed": ["business_rule: failed"],
    }
    assert completion["workflow_completion"] == {
        "passed": [
            "tests_exist",
            "workflow_phases: 5/5",
            "native_skill_invocation",
            "native_artifacts",
            "native_loop",
        ],
        "failed": [
            "openspec_artifacts: missing",
            "comet_state: missing",
            "native_state: incomplete",
            "native_isolation: forbidden artifacts",
        ],
    }


def test_control_filter_does_not_apply_to_comet_treatment():
    passed, failed = _filter_control_workflow_checks(
        "comet-workflow",
        "COMET_FULL_040_BETA",
        [],
        ["openspec_artifacts: missing"],
    )

    assert passed == []
    assert failed == ["openspec_artifacts: missing"]


def pytest_generate_tests(metafunc):
    """Dynamically parametrize tests based on CLI options.

    ``--count N`` repeats each (task, treatment) pair N times so the report can
    compute pass-rate distributions instead of a single noisy sample.
    """
    if "task_name" in metafunc.fixturenames and "treatment_name" in metafunc.fixturenames:
        task_filter = metafunc.config.getoption("--task")
        treatment_filter = metafunc.config.getoption("--treatment")
        count = int(metafunc.config.getoption("--count") or 1)
        base_params = generate_test_params(task_filter, treatment_filter, metafunc.config)
        # The explicit marker is the controller-owned repetition identity used
        # to persist a complete matrix before any model run begins.
        params = []
        for rep in range(count):
            for task_name, treatment_name in base_params:
                params.append(
                    pytest.param(
                        task_name,
                        treatment_name,
                        id=f"{task_name}-{treatment_name}-r{rep + 1}",
                        marks=pytest.mark.eval_case(repetition=rep + 1),
                    )
                )
        metafunc.parametrize("task_name,treatment_name", params)


# =============================================================================
# TEST
# =============================================================================


@pytest.mark.timeout(PYTEST_TIMEOUT)
def test_task_treatment(task_name, treatment_name):
    """Run a task with a treatment and validate results."""
    fixtures = get_fixtures()
    task = _load_eval_task(task_name, fixtures.request_config)
    treatments = load_treatments()
    dynamic = conftest._get_dynamic_treatment_config(fixtures.request_config)
    if dynamic:
        treatments[dynamic.name] = dynamic
    if treatment_name not in treatments:
        pytest.skip(f"Treatment {treatment_name} not found")
    treatment_cfg = treatments[treatment_name]
    skill_hints = treatment_cfg.skills[0] if treatment_cfg.skills else {}
    validators = task.load_validators()

    skills = build_treatment_skills(treatment_cfg.skills) if treatment_cfg.skills else {}
    skill_sources = [
        skill.get("source")
        for skill in skills.values()
        if isinstance(skill, dict) and skill.get("source")
    ]
    eval_manifest = next(
        (cfg.get("manifest") for cfg in treatment_cfg.skills if cfg.get("manifest")),
        None,
    )
    treatment = Treatment(
        description=treatment_cfg.description,
        skills=skills,
        claude_md=treatment_cfg.claude_md if treatment_cfg.claude_md else None,
    )

    run_id = str(uuid.uuid4())

    template_vars = {"run_id": run_id}
    for var_name, var_template in task.config.setup.template_vars.items():
        template_vars[var_name] = var_template.format(run_id=run_id)

    prompt = adapt_prompt_for_native(
        task.render_prompt(**template_vars),
        treatment_name,
        terminal_mode=task.config.evaluation.native_terminal,
    )
    target_profile = None
    if treatment_cfg.skills:
        target_profile = treatment_cfg.skills[0].get("profile")
    profile_name = resolve_profile_name(
        task,
        override=fixtures.request_config.getoption("--profile"),
        target_profile=target_profile,
    )
    interaction = conftest._resolve_interaction_config(task, profile_name, fixtures.request_config)
    fixtures.setup_test_context(
        skills=treatment.skills,
        claude_md=conftest._build_eval_claude_md(profile_name, treatment.claude_md),
        environment_dir=task.environment_dir,
        workspace_dir=task.workspace_dir,
    )
    selected_agent = conftest._resolve_eval_agent(fixtures.request_config).agent
    selected_adapter = get_agent_adapter(selected_agent)
    execution = conftest._resolve_eval_execution(fixtures.request_config)
    selected_model = execution.model
    judge = conftest._resolve_eval_judge(fixtures.request_config)
    role_models = {
        "subject": selected_model,
        "simulator": (
            selected_model
            if interaction.mode == "auto_user"
            and not interaction.decision_reply
            and not interaction.decision_replies
            else None
        ),
        "judge": judge.model if judge is not None else None,
    }
    role_agents = {
        "subject": selected_agent,
        "simulator": selected_agent if interaction.mode == "auto_user" else None,
        "judge": judge.agent if judge is not None else None,
    }
    captured_execution = conftest._capture_execution_identity(
        fixtures.test_dir,
        model=selected_model,
        interaction=interaction,
    )
    case_manifest = case_manifest_payload(
        build_case_manifest(
            task.name,
            task.path.parent,
            execution_identity=captured_execution.report_identity,
            manifest_path=task.manifest_path,
            rendered_prompt=prompt if task.manifest_path else None,
            workspace_dir=task.workspace_dir if task.manifest_path else None,
            validation_rules=task.manifest_expectations if task.manifest_path else None,
            environment_dir=task.environment_dir if task.manifest_path else None,
        )
    )
    skill_package_path = conftest._snapshot_dynamic_skill_package(
        fixtures.test_dir, skill_hints
    ) or skill_hints.get("path")

    result = fixtures.run_claude(
        prompt,
        timeout=max(CLAUDE_TIMEOUT, task.config.timeout_sec),
        model=selected_model,
        interaction=interaction,
        image_id=captured_execution.runtime_image_id,
    )

    events = extract_events(parse_output(result.stdout), agent=selected_agent)
    events["telemetry_status"] = "N/A" if not selected_adapter.supports_telemetry else "available"
    loop_interaction = conftest._extract_loop_interaction(result.stderr)
    for role, session_ids in loop_interaction.get("role_sessions", {}).items():
        target = events["role_sessions"].setdefault(role, [])
        for session_id in session_ids:
            if session_id not in target:
                target.append(session_id)
    subject_turns = conftest._extract_subject_turn_evidence(redact_sensitive(result.stdout))
    outputs = {
        "run_id": run_id,
        "treatment_name": treatment_name,
        "agent": selected_agent,
        "agent_adapter": selected_adapter,
        "main_credentials": selected_adapter.required_credentials,
        "role_models": role_models,
        "role_agents": role_agents,
        "telemetry_status": events["telemetry_status"],
        "judge_agent": judge.agent if judge is not None else None,
        "judge_model": judge.model if judge is not None else None,
        "judge_base_url": judge.base_url if judge is not None else None,
        "events": events,
        "profile": profile_name,
        "skill_sources": skill_sources,
        "eval_manifest": eval_manifest or skill_hints.get("manifest"),
        "required_skills": skill_hints.get("required_skills")
        or task.config.evaluation.required_skills,
        "expected_artifacts": skill_hints.get("expected_artifacts")
        or task.config.evaluation.expected_artifacts,
        "require_skill_invocation": skill_hints.get("require_skill_invocation")
        or task.config.evaluation.require_skill_invocation,
        "rubric_criteria": task.config.evaluation.rubric_criteria,
        "native_terminal": task.config.evaluation.native_terminal,
        "skill_package_path": skill_package_path,
        "generated_node_skills": skill_hints.get("generated_node_skills") or [],
        "route_conformance_task": skill_hints.get("route_conformance_task"),
        "route_conformance_expected_node_order": (
            skill_hints.get("route_conformance_expected_node_order") or []
        ),
        "baseline_treatments": skill_hints.get("baseline_treatments") or [],
        "quality_gates": skill_hints.get("quality_gates") or {},
        "required_output_schemas": skill_hints.get("required_output_schemas") or [],
        "expected_evidence": skill_hints.get("expected_evidence") or [],
        "draft_hash": skill_hints.get("draft_hash"),
        "eval_generation": (
            {
                "generation_hash": skill_hints.get("generation_hash"),
                "manifest_path": skill_hints.get("manifest")
                or str(fixtures.request_config.getoption("--eval-manifest")),
                "metadata_path": skill_hints.get("generation_metadata_path"),
                "manifest_hash": skill_hints.get("generation_manifest_hash"),
                "metadata_hash": skill_hints.get("generation_metadata_hash"),
                "overhead": skill_hints.get("generation_overhead"),
            }
            if skill_hints.get("generation_hash")
            else None
        ),
        "interaction": {
            "mode": interaction.mode,
            "max_turns": interaction.max_turns,
            **loop_interaction,
            "subject_turns": subject_turns,
        },
        "case_manifest": case_manifest,
        "role_sessions": events["role_sessions"],
    }
    events["profile"] = outputs["profile"]
    events["agent"] = selected_agent
    events["role_models"] = role_models
    events["role_agents"] = role_agents
    events["telemetry_status"] = outputs["telemetry_status"]
    events["skill_sources"] = outputs["skill_sources"]
    events["eval_manifest"] = outputs["eval_manifest"]
    events["interaction"] = outputs["interaction"]
    events["case_manifest"] = case_manifest
    events["eval_generation"] = outputs["eval_generation"]

    passed, failed = run_validators(validators, fixtures.test_dir, outputs)
    passed, failed = adapt_checks_for_native(
        fixtures.test_dir,
        outputs,
        passed,
        failed,
    )
    completion_slices = _split_comet_completion_checks(passed, failed)
    passed, failed = _filter_control_workflow_checks(
        profile_name,
        treatment_name,
        passed,
        failed,
    )

    # Rubric scoring: feed the baseline validator outcome as the "completion"
    # dimension input, then append the eight [RUBRIC] messages as informational
    # checks (they never produce hard failures).
    rubric_outputs = dict(outputs)
    rubric_outputs["completion"] = {"passed": passed, "failed": failed}
    if profile_name == "comet-workflow":
        rubric_outputs.update(completion_slices)
        if _is_control_business_only_run(profile_name, treatment_name):
            rubric_outputs["workflow_completion"] = {"passed": [], "failed": []}
    rubric_passed, rubric_failed = run_profile_rubric(
        profile_name, fixtures.test_dir, rubric_outputs
    )
    passed = passed + rubric_passed
    failed = failed + rubric_failed
    agent_failed = result.returncode != 0
    if agent_failed:
        failed.append(f"Agent execution failed with exit code {result.returncode}")

    # Keep the run-level context available to thin remote reporting wrappers.
    # These fields are local evidence as well; Langfuse applies its own bounded
    # capture policy before sending them remotely.
    events["task"] = task.name
    events["treatment"] = treatment_name
    events["prompt"] = prompt
    events["skill"] = skill_hints.get("name") or skill_hints.get("path")
    events["final_response"] = subject_turns[-1].get("result") if subject_turns else None
    events["quality_gates"] = outputs["quality_gates"]
    events["execution_identity"] = captured_execution.report_identity
    events["role_sessions"] = outputs["role_sessions"]

    fixtures.record_result(
        events,
        passed,
        failed,
        run_id=run_id,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )

    if agent_failed:
        pytest.fail(f"{selected_agent} execution failed with exit code {result.returncode}")
    if failed and not _is_observational_baseline_run(treatment_name):
        pytest.fail(f"Validation failed: {failed}")
