import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectStandaloneTasks,
  loadInstalledCustomAgent,
  resolveEvalContext,
} from '../../../domains/eval/index.js';

const repository = path.resolve('.');
const packageRoot = repository;
const evalRoot = path.join(repository, 'eval');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function skillRoot(manifest?: string): Promise<{ root: string; manifest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-static-collect-'));
  temporary.push(root);
  const skill = path.join(root, 'skill');
  const comet = path.join(skill, 'comet');
  await fs.mkdir(comet, { recursive: true });
  await fs.writeFile(path.join(skill, 'SKILL.md'), '# Skill\n', 'utf8');
  const target = path.join(comet, 'eval.yaml');
  await fs.writeFile(
    target,
    manifest ??
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation: {}',
        '',
      ].join('\n'),
    'utf8',
  );
  return { root: skill, manifest: target };
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function pythonAccepts(manifest: string): boolean {
  try {
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'from pathlib import Path; from scaffold.python.manifests import load_eval_manifest; load_eval_manifest(Path(__import__("sys").argv[1]))',
        manifest,
      ],
      { cwd: evalRoot, stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

describe('standalone static collector parity', () => {
  it.each<[string, string, number?]>([
    [
      'excludes prior generated Eval output while binding real release inputs',
      'local/tests/scaffold/test_regression_check.py::test_candidate_harness_ignores_old_eval_outputs_but_binds_authored_skill_inputs',
    ],
    [
      'rejects unreadable Skill directories instead of accepting incomplete candidate inputs',
      'local/tests/scaffold/test_regression_check.py::test_candidate_skill_enumeration_rejects_unreadable_directories',
      4,
    ],
    [
      'recognizes every approval request preserved from the original Classic failure',
      'local/tests/scaffold/test_utils.py::test_decision_point_detector_accepts_original_104058_choice_replies',
      4,
    ],
    [
      'sends an actual approval reply for numeric delivery options instead of a continuation nudge',
      'local/tests/scaffold/test_utils.py::test_claude_loop_sends_a_real_reply_to_plain_numeric_approval',
    ],
    [
      'aligns both Classic layout treatments with the required unified entry',
      'local/tests/scaffold/test_tasks.py::test_current_classic_treatments_follow_the_required_unified_entry_before_classic',
    ],
    [
      'keeps destructive and unbound shell cleanup rejected',
      'local/tests/scaffold/test_profiles.py::test_generic_safety_keeps_dangerous_or_unbound_cleanup_blocked',
      18,
    ],
    [
      'accepts explicit temporary cleanup APIs without relaxing shell deletion patterns',
      'local/tests/scaffold/test_profiles.py::test_generic_safety_accepts_explicit_temporary_resource_cleanup',
      2,
    ],
    [
      'keeps the approved hardest-task matrix at three independent successes per workflow',
      'local/tests/scaffold/test_regression_check.py::test_recovery_release_requires_all_three_samples_of_both_hard_tasks',
    ],
    [
      'revalidates the complete six-sample recovery receipt without accepting the full-suite baseline',
      'local/tests/scaffold/test_regression_check.py::test_recovery_release_receipt_requires_six_independent_passing_samples',
    ],
    [
      'rejects a failed or missing third recovery sample and duplicate executions',
      'local/tests/scaffold/test_regression_check.py::test_recovery_release_never_selects_one_success_out_of_three',
      5,
    ],
    [
      'combines both actual CI core partitions before launching paid models',
      'local/tests/scaffold/test_regression_check.py::test_ci_preflight_combines_complete_original_platform_jobs_before_models',
    ],
    [
      'binds a uniquely named one-shot check to its original identity and rejects mismatched evidence',
      'local/tests/scaffold/test_native_sdk_recovery.py::test_named_one_shot_requires_unique_plan_and_original_receipt_identity',
    ],
    [
      'collects Python artifacts without repeating execution or one-shot side effects',
      'local/tests/scaffold/test_logging.py::test_save_artifacts_never_replays_python_or_one_shot_outputs',
    ],
    [
      'checks cold recovery boundaries even after artifact failure and retains the original SDK Run',
      'local/tests/scaffold/test_native_sdk_recovery.py::test_failed_native_artifact_still_checks_cold_boundary_and_retains_authoritative_run',
    ],
    [
      'archives trusted SDK inspections with explicit integrity and credential redaction',
      'local/tests/scaffold/test_logging.py::test_save_artifacts_preserves_sdk_inspection_with_integrity_and_redaction',
    ],
    [
      'retains only trusted validator evidence even when the task fails',
      'local/tests/scaffold/test_utils.py::test_execution_validator_retains_failed_trusted_inspection_and_discards_subject_evidence',
    ],
    [
      'stops only after every requested owned Classic Run has completed delivery',
      'local/tests/scaffold/test_sdk_task_validators.py::test_requested_classic_completion_requires_every_owned_delivery',
    ],
    [
      'requires the requested Native owner and terminal Run before ending the model loop',
      'local/tests/scaffold/test_sdk_task_validators.py::test_requested_native_completion_uses_owned_terminal_run_without_prose',
    ],
    [
      'binds the Native recovery task to its fixed completion Run and brief table location',
      'local/tests/scaffold/test_sdk_task_validators.py::test_native_recovery_task_declares_its_fixed_completion_run',
    ],
    [
      'ends the Native model loop on trusted completion without requiring completion words',
      'local/tests/scaffold/test_utils.py::test_native_terminal_probe_ends_without_requiring_completion_words',
      2,
    ],
    [
      'rejects fresh Classic design or delivery approvals without actual user interaction evidence',
      'local/tests/scaffold/test_sdk_task_validators.py::test_new_classic_proposals_cannot_pass_without_actual_user_interaction',
    ],
    [
      'requires explicit fresh Classic proposal interaction configuration without reapproving historical runs',
      'local/tests/scaffold/test_tasks.py::test_task_declares_classic_proposal_interaction_only_for_fresh_scenarios',
    ],
    [
      'exports the original SDK Run from shared archive tasks before any later terminal failure',
      'local/tests/scaffold/test_current_archive_acceptance.py::test_shared_archive_tasks_export_the_original_inspected_run_even_after_terminal_failure',
      4,
    ],
    [
      'loads the completion probe across separate mounts without workspace or PYTHONPATH injection',
      'local/tests/scaffold/test_utils.py::test_requested_run_probe_loads_standalone_helper_without_package_imports',
      4,
    ],
    [
      'stops on an unavailable completion probe without repeatedly invoking the agent',
      'local/tests/scaffold/test_utils.py::test_requested_run_probe_bootstrap_failure_stops_loop_without_terminal_nudges',
    ],
    [
      'requires a bound execution observation for parked coexistence outside scoped check inputs',
      'local/tests/scaffold/test_classic_sdk_recovery.py::test_scoped_verify_requires_bound_coexistence_observation',
    ],
    [
      'rejects workspace module and PYTHONPATH injection into the coexistence observer and pytest',
      'local/tests/scaffold/test_classic_sdk_recovery.py::test_coexistence_helper_isolates_workspace_modules_and_pythonpath',
    ],
  ])('%s', (_name, selector, expectedCount = 1) => {
    const output = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        '--no-sync',
        '--no-python-downloads',
        'python',
        '-m',
        'pytest',
        '-q',
        selector,
      ],
      {
        cwd: evalRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, PYTHONUTF8: '1' },
      },
    );
    expect(output).toContain(`${expectedCount} passed`);
  });

  it('preserves exact provided check bytes across LF and CRLF without accepting mutations or duplicate execution', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'exact_distributed_script_bytes or missing_distributed_script_digest',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/6 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('binds Native recovery inputs to its required canonical spec and numeric line format', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'fixed_canonical',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('binds Classic parked proposal instructions to the unchanged exact preservation validator', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'classic_parked_proposal',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('prepares all six current workflow fixtures with only their selected trusted oracles', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        '051_matrix_prepares or native_oracle_requires',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/9 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('isolates Classic controller tooling from Git inputs without altering Native fixtures', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_conftest_helpers.py',
        'local/tests/scaffold/test_utils.py',
        '-k',
        'current_classic_git_excludes or eval_git_excludes_does_not_initialize',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/3 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('binds Native recovery acceptance examples to the unchanged business baseline', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'native_recovery_examples',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('loads public treatment configurations with the current scaffold model', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_treatments.py',
        '-k',
        'public_load_treatment',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('provides the current Native shared capability reference without installing another Skill', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_conftest_helpers.py',
        '-k',
        'current_native_shared_host_check',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/2 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('binds one-shot recovery receipts to direct Python or an explicit fixed PATH', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_native_sdk_recovery.py',
        '-k',
        'one_shot_receipt',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('starts the trusted Native recovery boundary checker in the actual flattened container layout', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'native_boundary_entry_imports_in_the_flattened_docker_python_layout',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('keeps the outer case timeout beyond the configured Classic execution budget', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'outer_case_timeout',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('stops after verified requested Run deliveries without dropping incomplete or child-only cases', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        'local/tests/scaffold/test_utils.py',
        '-k',
        'completion_detector or completion_point',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/11 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('ends disposable medium fixtures after verified Archive without persisting learning', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_current_archive_acceptance.py',
        '-k',
        'disposable_medium_fixture',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('keeps controller installations from displacing actual business artifacts in Judge input', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_profiles.py',
        '-k',
        'generic_judge_keeps_business_artifacts_when_current_cli_snapshots_are_present',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/1 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('translates Claude context suffixes for HTTP Judges while retaining configured model identity', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_profiles.py',
        '-k',
        'judge_provider_uses_direct_http_when_base_url_is_configured',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/5 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('accepts either builtin Judge credential while preserving custom credential requirements', () => {
    const result = execFileSync(
      'uv',
      ['run', '--locked', 'python', '-m', 'pytest', 'local/tests/scaffold/test_execution.py', '-q'],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(Number(result.match(/(\d+) passed/)?.[1])).toBeGreaterThanOrEqual(28);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it('forwards explicit Claude tool search compatibility into isolated evaluation containers', () => {
    const result = execFileSync(
      'uv',
      [
        'run',
        '--locked',
        'python',
        '-m',
        'pytest',
        'local/tests/scaffold/test_utils.py',
        '-k',
        'docker_forwards_explicit_tool_search_compatibility',
        '-q',
      ],
      { cwd: evalRoot, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(result).toMatch(/2 passed/);
    expect(result).not.toMatch(/failed|skipped/);
  });

  it.each([
    ['valid inline', '        files: [result.md]', true, 'evaluation.tasks[0]'],
    ['unsafe files', '        files: [../secret]', false, 'evaluation.tasks[0]'],
    ['unsafe contains', '        contains: {../secret: [bad]}', false, 'evaluation.tasks[0]'],
    [
      'invalid jsonpath',
      '        json: [{file: result.json, path: nope, equals: ok}]',
      false,
      'evaluation.tasks[0]',
    ],
    ['invalid command', '        commands: [{run: "", timeout: 0}]', false, 'evaluation.tasks[0]'],
    ['unknown field', '        unknown: true', false, 'evaluation.tasks[0].expect.unknown'],
  ])('%s has the same acceptance as Python', async (_name, expectBody, accepted, field) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks:',
        '    - name: authored',
        '      prompt: work',
        '      rubric: [clear]',
        '      expect:',
        expectBody,
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    const node = collectStandaloneTasks({}, context, packageRoot);
    if (accepted) await expect(node).resolves.toContain('Tasks: authored');
    else await expect(node).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(accepted);
  });

  it('uses metadata.name, not another TOML section, for source tasks', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks: [{name: public-alias, source: tasks/source}]',
        '',
      ].join('\n'),
    );
    const source = path.join(root, 'tasks', 'source');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, 'task.toml'),
      '[other]\nname = "wrong"\n[metadata]\nname = "right"\n',
    );
    await fs.writeFile(path.join(source, 'instruction.md'), 'do work\n');
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      '- public-alias',
    );
    expect(pythonAccepts(manifest)).toBe(true);
    await fs.writeFile(path.join(source, 'task.toml'), '[metadata\nname = "bad"\n');
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow('task.toml');
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('rejects source task TOML that the normal loader cannot execute', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks: [{source: tasks/source}]',
        '',
      ].join('\n'),
    );
    const source = path.join(root, 'tasks', 'source');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, 'task.toml'),
      '[metadata]\nname = "invalid-source"\n[evaluation]\nnative_terminal = "invalid"\n',
    );
    await fs.writeFile(path.join(source, 'instruction.md'), 'do work\n');
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.native_terminal',
    );
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it.each([
    ['execution.agent', 'execution:\n  agent: "unknown agent"\n'],
    ['judge.agent', 'judge:\n  agent: "unknown agent"\n  model: judge-model\n'],
  ])('rejects an unknown %s before task selection', async (field, section) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        section.trimEnd(),
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('rejects an unknown CLI Agent before returning pending generation', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(
      collectStandaloneTasks({ agent: 'unknown agent' }, context, packageRoot),
    ).rejects.toThrow('CLI evaluation agent');
  });

  it('validates a custom Agent against the explicitly installed adapter registry', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'execution:',
        '  agent: fixture-agent',
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const registry = path.join(path.dirname(root), 'adapters');
    await fs.mkdir(path.join(registry, 'fixture-agent'), { recursive: true });
    await fs.writeFile(
      path.join(registry, 'fixture-agent', 'adapter.yaml'),
      [
        'apiVersion: comet.eval.agent/v1alpha1',
        'kind: EvalAgentAdapter',
        'metadata: { id: fixture-agent, version: 1.0.0 }',
        'runtime: { executable: fixture-agent, install: { kind: none } }',
        'credentials: [FIXTURE_AGENT_API_KEY]',
        'modelEnv: FIXTURE_AGENT_MODEL',
        'baseUrlEnv: FIXTURE_AGENT_BASE_URL',
        'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
        '',
      ].join('\n'),
      'utf8',
    );
    const previous = process.env.COMET_EVAL_ADAPTERS_DIR;
    process.env.COMET_EVAL_ADAPTERS_DIR = registry;
    try {
      await expect(loadInstalledCustomAgent('fixture-agent')).resolves.toEqual({
        id: 'fixture-agent',
        modelEnv: 'FIXTURE_AGENT_MODEL',
        baseUrlEnv: 'FIXTURE_AGENT_BASE_URL',
      });
      const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
      await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
        'Tasks: pending generation',
      );
    } finally {
      if (previous === undefined) delete process.env.COMET_EVAL_ADAPTERS_DIR;
      else process.env.COMET_EVAL_ADAPTERS_DIR = previous;
    }
  });

  it('fails closed across the installed custom adapter metadata matrix', async () => {
    const { root } = await skillRoot();
    const registry = path.join(path.dirname(root), 'adapters');
    const candidate = path.join(registry, 'matrix-agent');
    await fs.mkdir(candidate, { recursive: true });
    const valid = () =>
      [
        'apiVersion: comet.eval.agent/v1alpha1',
        'kind: EvalAgentAdapter',
        'metadata: { id: matrix-agent, version: 1.0.0 }',
        'runtime: { executable: matrix-agent, install: { kind: none } }',
        'credentials: [MATRIX_AGENT_KEY]',
        'modelEnv: MATRIX_AGENT_MODEL',
        'baseUrlEnv: MATRIX_AGENT_BASE_URL',
        'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
        '',
      ].join('\n');
    const previous = process.env.COMET_EVAL_ADAPTERS_DIR;
    process.env.COMET_EVAL_ADAPTERS_DIR = registry;
    try {
      await expect(loadInstalledCustomAgent('codex')).resolves.toBeNull();
      await expect(loadInstalledCustomAgent('bad id')).resolves.toBeNull();
      await expect(loadInstalledCustomAgent('missing-agent')).rejects.toThrow('not installed');

      const cases: Array<[string, string, string]> = [
        ['invalid YAML', 'not: [valid', 'invalid adapter.yaml'],
        ['scalar document', 'true\n', 'must be a mapping'],
        ['unknown field', `${valid()}extra: true\n`, 'invalid adapter metadata'],
        [
          'API version',
          valid().replace('comet.eval.agent/v1alpha1', 'wrong/v1'),
          'invalid adapter metadata',
        ],
        [
          'metadata id',
          valid().replace('id: matrix-agent', 'id: other-agent'),
          'invalid adapter metadata',
        ],
        [
          'metadata version',
          valid().replace('version: 1.0.0', 'version: "not safe"'),
          'invalid metadata.version',
        ],
        [
          'runtime missing',
          valid().replace('runtime: { executable: matrix-agent, install: { kind: none } }\n', ''),
          'runtime must be a mapping',
        ],
        [
          'runtime fields',
          valid().replace(
            'runtime: { executable: matrix-agent, install: { kind: none } }',
            'runtime: { executable: matrix-agent, unknown: true }',
          ),
          'runtime has unknown fields',
        ],
        [
          'runtime executable',
          valid().replace('executable: matrix-agent', 'executable: "bad token"'),
          'runtime.executable is invalid',
        ],
        [
          'install mapping',
          valid().replace('install: { kind: none }', 'install: invalid'),
          'runtime.install must be a mapping',
        ],
        [
          'install kind',
          valid().replace('kind: none', 'kind: cargo'),
          'runtime.install.kind is invalid',
        ],
        [
          'install package without kind',
          valid().replace('install: { kind: none }', 'install: { kind: none, package: package }'),
          'package requires npm or pip',
        ],
        [
          'install package',
          valid().replace(
            'install: { kind: none }',
            'install: { kind: npm, package: "bad package" }',
          ),
          'runtime.install package is invalid',
        ],
        [
          'credentials count',
          valid().replace('credentials: [MATRIX_AGENT_KEY]', 'credentials: [A, B, C]'),
          'credentials are invalid',
        ],
        [
          'credentials name',
          valid().replace('credentials: [MATRIX_AGENT_KEY]', 'credentials: [bad-name]'),
          'credentials are invalid',
        ],
        [
          'duplicate credentials',
          valid().replace(
            'credentials: [MATRIX_AGENT_KEY]',
            'credentials: [MATRIX_AGENT_KEY, MATRIX_AGENT_KEY]',
          ),
          'credentials are invalid',
        ],
        [
          'capabilities missing',
          valid().replace(
            'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
            '',
          ),
          'capabilities are invalid',
        ],
        [
          'capability unknown',
          valid().replace(
            'skillInvocationEvidence: true }',
            'skillInvocationEvidence: true, unknown: true }',
          ),
          'capabilities are invalid',
        ],
        [
          'capability type',
          valid().replace('singleTurn: true', 'singleTurn: yes'),
          'capabilities are invalid',
        ],
        [
          'model env',
          valid().replace('modelEnv: MATRIX_AGENT_MODEL', 'modelEnv: bad-name'),
          'modelEnv must be an environment variable name',
        ],
        [
          'base URL env',
          valid().replace('baseUrlEnv: MATRIX_AGENT_BASE_URL', 'baseUrlEnv: bad-name'),
          'baseUrlEnv must be an environment variable name',
        ],
      ];
      for (const [label, content, message] of cases) {
        await fs.writeFile(path.join(candidate, 'adapter.yaml'), content, 'utf8');
        await expect(loadInstalledCustomAgent('matrix-agent'), label).rejects.toThrow(message);
      }

      await fs.rm(path.join(candidate, 'adapter.yaml'));
      await expect(loadInstalledCustomAgent('matrix-agent')).rejects.toThrow(
        'missing adapter.yaml',
      );
    } finally {
      if (previous === undefined) delete process.env.COMET_EVAL_ADAPTERS_DIR;
      else process.env.COMET_EVAL_ADAPTERS_DIR = previous;
    }
  });

  it('rejects manifests that set both alias spellings', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  recommendedTasks: [generic-skill-smoke]',
        '  recommended_tasks: [workflow-route-conformance]',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.recommendedTasks and evaluation.recommended_tasks cannot both be set',
    );
  });

  it('rejects duplicate recommended task names with the Python field diagnostic', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  recommendedTasks: [generic-skill-smoke, generic-skill-smoke]',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.recommendedTasks[1] duplicates evaluation.recommendedTasks[0]: "generic-skill-smoke"',
    );
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('accepts preserved main and Judge model routing fields during static collection', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'execution:',
        '  agent: codex',
        '  model: gpt-main',
        '  baseUrl: https://main.example.com/v1',
        'judge:',
        '  agent: claude-code',
        '  model: claude-judge',
        '  baseUrl: https://judge.example.com',
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      'Tasks: pending generation',
    );
    expect(pythonAccepts(manifest)).toBe(true);
  });

  it('rejects an enabled environment Judge without a dedicated model', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await withEnvironment({ BENCH_LLM_JUDGE: '1', BENCH_JUDGE_MODEL: undefined }, async () => {
      await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
        'BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1',
      );
    });
  });

  it('validates environment-provided main and Judge base URLs during static collection', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await withEnvironment(
      {
        BENCH_EVAL_AGENT: 'claude-code',
        ANTHROPIC_BASE_URL: 'relative/main-url',
        BENCH_LLM_JUDGE: undefined,
        BENCH_JUDGE_MODEL: undefined,
        BENCH_JUDGE_BASE_URL: undefined,
      },
      async () => {
        await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
          'execution.baseUrl',
        );
      },
    );
    await withEnvironment(
      {
        BENCH_EVAL_AGENT: undefined,
        ANTHROPIC_BASE_URL: undefined,
        BENCH_LLM_JUDGE: '1',
        BENCH_JUDGE_MODEL: 'judge-model',
        BENCH_JUDGE_BASE_URL: 'relative/judge-url',
      },
      async () => {
        await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
          'judge.baseUrl',
        );
      },
    );
  });

  it.each([
    ['execution.model', 'execution:\n  model: "   "\n'],
    ['execution.baseUrl', 'execution:\n  baseUrl: ftp://main.example.com\n'],
    ['execution.baseUrl', 'execution:\n  baseUrl: https://main.example.com:99999/v1\n'],
    ['judge.model', 'judge:\n  agent: codex\n'],
    ['judge.model', 'judge:\n  model: "   "\n'],
    ['judge.baseUrl', 'judge:\n  model: judge-model\n  baseUrl: relative/path\n'],
  ])('rejects invalid %s instead of silently ignoring it', async (field, section) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        section.trimEnd(),
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('hits a Python-generated cache and falls back to pending for corrupt cache content', async () => {
    const { root } = await skillRoot();
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'from pathlib import Path; import sys; from scaffold.python.auto_tasks import ensure_generated_manifest; ensure_generated_manifest(Path(sys.argv[1]), Path(sys.argv[2]), agent="claude-code", model=None, profile="generic", interaction={"mode":"none","max_turns":12,"simulator_prompt":None,"decision_patterns":[],"decision_reply":None,"decision_replies":[],"continue_prompt":"Please continue with the next phase of the workflow.","fresh_resume_marker":None}, generate=lambda _: {"tasks":[{"name":"python-one","prompt":"one","expect":{"files":["one.md"]}},{"name":"python-two","prompt":"two","expect":{"commands":[{"run":"true","timeout":1}]}}]})',
        root,
        path.dirname(root),
      ],
      { cwd: evalRoot, stdio: 'pipe' },
    );
    const context = await resolveEvalContext({ skillPath: root, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toEqual(
      expect.arrayContaining(['Tasks: generated cache', '- python-one', '- python-two']),
    );
    const generatedRoot = path.join(path.dirname(root), '.comet', 'eval', 'generated');
    const [safe] = await fs.readdir(generatedRoot);
    const [key] = await fs.readdir(path.join(generatedRoot, safe));
    await fs.writeFile(path.join(generatedRoot, safe, key, 'eval.yaml'), 'unknownTopLevel: true\n');
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      'Tasks: pending generation',
    );
  });

  it('hard-fails when generated cache components escape the owner-local artifact root', async () => {
    const { root } = await skillRoot();
    const owner = path.dirname(root);
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-static-external-'));
    temporary.push(external);
    const generatedRoot = path.join(owner, '.comet', 'eval', 'generated');
    await fs.mkdir(generatedRoot, { recursive: true });
    const link = path.join(generatedRoot, path.basename(root));
    try {
      await fs.symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    const context = await resolveEvalContext({ skillPath: root, project: owner });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'Eval managed path',
    );
  });
});
