import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, it } from 'vitest';

function scaffold(file: string, selection: string, passed: number): void {
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
      `local/tests/scaffold/${file}`,
      '-q',
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
  expect(output).toContain(`${passed} passed`);
  expect(output).not.toContain('skipped');
}

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
    'verifier_resources_and_status or observer_distinguishes_pytest or scoring_applies_fixed_verifier or failed_verifier_keeps_reward or pytest_only_loads_root_owned or workbuddy_judge_status or workbuddy_partial_score',
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

it('fixes Native verification mode before model execution and checks actual Run inputs', () => {
  scaffold('test_builtin_datasets.py', 'seeds_verification_mode or actual_run_mode_mismatch', 2);
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
