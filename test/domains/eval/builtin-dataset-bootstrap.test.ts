import childProcess from 'node:child_process';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';

function scaffold(file: string, selection: string, passed: number): void {
  const result = childProcess.spawnSync(
    'uv',
    [
      'run',
      '--locked',
      '--no-sync',
      '--no-python-downloads',
      'python',
      '-m',
      'pytest',
      `local/tests/scaffold/${file}`,
      '-q',
      '--tb=short',
      '-k',
      selection,
    ],
    {
      cwd: path.resolve('eval'),
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PYTHON_DOTENV_DISABLED: '1', PYTHONUTF8: '1' },
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.error, output).toBeUndefined();
  expect(result.status, output).toBe(0);
  expect(output).toContain(`${passed} passed`);
  expect(output).not.toContain('skipped');
}

it('includes captured Python output when a scaffold subprocess fails', () => {
  const execute = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
    pid: 1,
    output: [null, 'Python assertion output\n', 'Shell failure output\n'],
    stdout: 'Python assertion output\n',
    stderr: 'Shell failure output\n',
    status: 1,
    signal: null,
  });
  try {
    expect(() => scaffold('test_builtin_datasets.py', 'fixture', 1)).toThrow(
      /Python assertion output\nShell failure output/u,
    );
  } finally {
    execute.mockRestore();
  }
});

it('keeps authored task images separate when copied candidate bytes change', () => {
  scaffold(
    'test_conftest_helpers.py',
    'authored_environment_image_identity_binds_copied_inputs',
    1,
  );
});

it('preserves dataset-bound Dockerfiles when preparing image inputs', () => {
  scaffold(
    'test_conftest_helpers.py',
    'dataset_environment_copy_preserves_bound_dockerfile_bytes',
    1,
  );
});

it('keeps Eval CLI tooling snapshots separate from dataset home caches', async () => {
  await ensureCliBuilt(path.resolve('.'));
  scaffold('test_builtin_datasets.py', 'current_cli_dependency_snapshot', 2);
  scaffold('test_builtin_datasets.py', 'dataset_root_home_cache', 2);
}, 35_000);

it('excludes changed dataset inputs while preserving valid low scores and raw results', () => {
  scaffold('test_dataset_integrity.py', 'changed_dataset_inputs or low_dataset_reward', 5);
});

it('keeps dataset Node tools separate from the original task installation', () => {
  scaffold('test_builtin_datasets.py', 'dataset_node_tools_do_not_overwrite_original_node', 1);
}, 35_000);

it('keeps dataset runtime installation independent of repository development dependencies', () => {
  scaffold(
    'test_builtin_datasets.py',
    'dataset_runtime_manifest_excludes_repository_development_graph',
    1,
  );
}, 35_000);

it('pins WorkBuddy verifier libraries to upstream revisions in an isolated environment', () => {
  scaffold('test_builtin_datasets.py', 'workbuddy_verifier_installs_upstream_pins', 1);
}, 35_000);

it('runs WorkBuddy scoring through its private Python in isolated mode', () => {
  scaffold('test_builtin_datasets.py', 'workbuddy_score_uses_private_isolated_python', 1);
}, 35_000);

it('reports dataset installation progress and stops on install or binary failure', () => {
  scaffold(
    'test_builtin_datasets.py',
    'dataset_agent_install_exposes_progress or dataset_prebuild_failure',
    2,
  );
}, 35_000);

it('requires the declared native Agent package and rejects unsupported or modified installers', () => {
  scaffold(
    'test_builtin_datasets.py',
    'dataset_agent_install_exposes_progress or agent_installer_handles_legacy or dataset_rejects_modified_agent',
    3,
  );
}, 35_000);

it('allows bounded extra time for cold dataset builds and keeps ordinary build limits', () => {
  scaffold('test_builtin_datasets.py', 'dataset_cold_build_has_bounded_extra_time', 1);
}, 35_000);

it('binds dataset selection to its pytest session without overriding manifest contracts', () => {
  scaffold(
    'test_builtin_datasets.py',
    'dataset_plan_does_not_override or dataset_selection_uses_bound_plan',
    2,
  );
}, 35_000);

it('terminates timed out build descendants and preserves normal command results', () => {
  scaffold(
    'test_utils.py',
    'build_timeout_terminates_descendants or build_timeout_reports_unconfirmed',
    2,
  );
}, 35_000);

it('keeps dataset workflows free of default deadlines across both Agent loops', () => {
  scaffold(
    'test_builtin_datasets.py',
    'workflow_has_no_default_wall_clock or unlimited_deadline_reaches',
    2,
  );
}, 35_000);

it('recognizes the reported Chinese Shape confirmation without reviving completed requests', () => {
  scaffold('test_builtin_datasets.py', 'shape_confirmation_replays', 1);
  scaffold('test_utils.py', 'real_reply_to_chinese_shape', 1);
}, 35_000);

it('checks WorkBuddy root contracts before preparation and rejects scoring input drift', () => {
  scaffold('test_builtin_datasets.py', 'missing_dataset_contract or dataset_contract_drift', 2);
}, 35_000);

it('retains redacted scoring errors while cleaning up the failed container', () => {
  scaffold('test_builtin_datasets.py', 'score_preserves_redacted', 1);
}, 35_000);

it('removes the outer pytest deadline only for builtin dataset tasks', () => {
  scaffold('test_builtin_datasets.py', 'dataset_pytest_guard', 1);
}, 35_000);

it('ends completed datasets through owned Native roots instead of completion wording', () => {
  scaffold('test_builtin_datasets.py', 'dataset_terminal_probe_requires', 1);
  scaffold('test_utils.py', 'dataset_completion_uses_sdk', 1);
}, 35_000);

it('preserves SkillsBench verifier paths and fractional task scores', () => {
  scaffold('test_builtin_datasets.py', 'skillsbench_scoring_preserves', 1);
}, 35_000);

it('binds the original dataset task independently of simulated approval', () => {
  scaffold('test_builtin_datasets.py', 'public_instruction_cannot_be_replaced', 1);
}, 35_000);

it('preserves declared candidate directories for Native and Goal and rejects protected paths', () => {
  scaffold(
    'test_builtin_datasets.py',
    'candidate_mapping_preserves_declared or runtime_mapping_is_independent or candidate_mapping_rejects or trusted_sources_are_readonly',
    4,
  );
}, 35_000);

it('deduplicates cumulative session usage without double counting resumed results', () => {
  scaffold('test_logging.py', 'dataset_session_cumulative or dataset_cumulative_usage', 2);
}, 35_000);

it('binds finite new dataset budgets while preserving legacy explicit transport', () => {
  scaffold('test_builtin_datasets.py', 'new_plan_has_bound_budget or new_budget_does_not_add', 2);
}, 35_000);

it('preserves original rewards while separating verifier environment and assertion failures', () => {
  scaffold(
    'test_builtin_datasets.py',
    'verifier_resources_and_status or observer_distinguishes_pytest or scoring_uses_candidate_copy or failed_verifier_keeps_reward or pytest_only_loads_root_owned or workbuddy_judge_status or workbuddy_partial_score',
    16,
  );
}, 35_000);

it('keeps missing telemetry unknown and simulator usage separate from subject usage', () => {
  scaffold(
    'test_builtin_datasets.py',
    'missing_efficiency_telemetry or simulator_usage_is_recorded or measurements_survive_report',
    3,
  );
  scaffold('test_logging.py', 'dataset_summary_separates_strata', 1);
}, 35_000);

it('enforces candidate storage monitoring without deleting the candidate', () => {
  scaffold('test_builtin_datasets.py', 'storage_limit_keeps_candidate', 1);
}, 35_000);

it('seeds portable dataset configuration without copying platform Runtime fences', () => {
  scaffold(
    'test_builtin_datasets.py',
    'native_mode_seed_survives_execution_workspace_relocation',
    1,
  );
}, 35_000);

it('keeps late controller files out of dataset inputs and refuses original path collisions', () => {
  scaffold(
    'test_builtin_datasets.py',
    'late_controller_skill_snapshot or controller_snapshot_rejects',
    2,
  );
}, 35_000);

it('keeps dataset image identity stable across modes while binding every build input', () => {
  scaffold('test_builtin_datasets.py', 'image_hash_uses_build_inputs', 1);
}, 35_000);

it('blocks benchmark answer access while allowing business tests and verifier handoffs', () => {
  scaffold('test_dataset_integrity.py', 'reference_guard or reference_settings', 11);
  scaffold('test_utils.py', 'goal_uses_native_command_without_comet_completion_or_nudges', 2);
}, 35_000);

it('excludes benchmark reference access and audits independent child sessions without changing scores', () => {
  scaffold('test_dataset_integrity.py', 'reference_access_excludes or reference_audit', 2);
}, 35_000);

it('excludes unverified or mismatched experiment modes including legacy flags', () => {
  scaffold('test_dataset_integrity.py', 'legacy_invalid or changed_dataset_inputs', 7);
  scaffold('test_dataset_integrity.py', 'sdk_inspection_preserves_original_owner', 1);
}, 35_000);

it('honors dataset workspace build budgets without extending ordinary image builds', () => {
  scaffold(
    'test_utils.py',
    'dataset_workspace_build_uses_declared_budget_and_preserves_regular_limit',
    3,
  );
});

it('supports explicit unlimited image builds without changing task budgets or lock cleanup', () => {
  scaffold('test_utils.py', 'unlimited_image_build', 3);
});
