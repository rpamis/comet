import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { setEvalBaseline } from '../../domains/eval/eval-run-store.js';

it('collects a fixed Native and Classic regression suite without creating any Eval runs', async () => {
  const repository = process.env.COMET_TEST_PACKAGE_ROOT ?? path.resolve('.');
  if (!process.env.COMET_TEST_PACKAGE_ROOT) await ensureCliBuilt(repository);
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-regression-plan-'));
  const env = {
    ...process.env,
    HOME: project,
    USERPROFILE: project,
    COMET_DATA_DIR: path.join(project, 'data'),
  };
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(repository, 'bin/comet.js'), 'eval', ...args], {
      cwd: project,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
  try {
    const collected = cli('--workflow-regression', '--collect');
    expect(collected.status, collected.stderr).toBe(0);
    const plan = JSON.parse(collected.stdout);
    expect(plan).toMatchObject({
      schema: 'comet.eval.workflow-regression.v1',
      cases: [
        {
          id: 'native-interrupted-recovery',
          workflow: 'native',
          task: 'comet-native-sdk-recovery',
          treatment: 'COMET_NATIVE_SDK_CURRENT',
        },
        {
          id: 'native-independent-verify',
          workflow: 'native',
          task: 'comet-native-workflow',
          treatment: 'COMET_NATIVE_SDK_CURRENT',
        },
        {
          id: 'classic-scope-reconfirmation',
          workflow: 'classic',
          task: 'comet-classic-full-recovery',
          treatment: 'COMET_CLASSIC_DOCS_LAYOUT',
        },
      ],
    });
    for (const { id, task, commandArgs } of plan.cases) {
      expect(commandArgs).toEqual(['comet', 'eval', '--workflow-regression', id]);
      const packageTask = await fs.readFile(
        path.join(repository, 'eval/local/tasks', task, 'task.toml'),
        'utf8',
      );
      expect(packageTask).toContain(`name = "${task}"`);
    }
    const single = cli('--workflow-regression', 'classic-scope-reconfirmation', '--collect');
    expect(single.status, single.stderr).toBe(0);
    expect(JSON.parse(single.stdout).cases.map((entry: { id: string }) => entry.id)).toEqual([
      'classic-scope-reconfirmation',
    ]);
    const invalid = cli('--workflow-regression', 'missing', '--collect');
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('missing');
    await expect(fs.readdir(project)).resolves.toEqual([]);
  } finally {
    await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
  }
}, 120_000);

it('compares saved reports and attaches Classic phase costs without modifying either Run', async () => {
  const repository = process.env.COMET_TEST_PACKAGE_ROOT ?? path.resolve('.');
  if (!process.env.COMET_TEST_PACKAGE_ROOT) await ensureCliBuilt(repository);
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-regression-comparison-'));
  const task = 'comet-classic-full-recovery';
  const treatment = 'COMET_CLASSIC_DOCS_LAYOUT';
  const matrix = {
    cases: [{ rep: 1, task, treatment }],
    schema: 'comet.eval.expected-case-matrix.v1',
  };
  const write = (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value));
  try {
    for (const [id, passed] of [
      ['before', false],
      ['after', true],
    ] as const) {
      const root = path.join(project, '.comet/eval/runs', id);
      await fs.mkdir(path.join(root, 'reports'), { recursive: true });
      await write(path.join(root, 'expected-case-matrix.json'), {
        ...matrix,
        matrix_hash: `sha256:${createHash('sha256').update(JSON.stringify(matrix)).digest('hex')}`,
      });
      await write(path.join(root, 'metadata.json'), {
        experiment_id: id,
        completed_at: '2026-11-20T08:00:00Z',
        expected_case_matrix: { case_count: 1 },
      });
      await write(path.join(root, 'dashboard-run.json'), {
        schema: 'comet.eval.managed-run.v1',
        id,
        origin: 'cli',
        status: 'completed',
        targetId: `versioned/${id}/comet-classic`,
        contentHash: id,
        createdAt: '2026-11-20T07:59:00Z',
        updatedAt: '2026-11-20T08:00:00Z',
        config: {
          target: `versioned/${id}/comet-classic`,
          targetType: 'skill',
          task,
          workflowRegressionCase: 'classic-scope-reconfirmation',
        },
      });
      await write(path.join(root, 'reports/case_report.json'), {
        name: `${task}-${treatment}`,
        passed,
        rep: 1,
        sample_quality: { status: 'included', include_in_analysis: true },
        checks_passed: ['fixture check'],
        checks_failed: passed ? [] : ['fixture expected failure'],
        events_summary: {
          task,
          treatment,
          sample: 1,
          input_tokens: passed ? 30 : 50,
          telemetry_status: 'available',
          tool_calls: (passed ? [12] : [20, 27]).map((duration, index) => ({
            tool_call_id: `call-${index}`,
            status: 'completed',
            time_source: 'harness-stream-receipt',
            timing_scope: 'tool-round-trip',
            duration_ms: duration,
          })),
          role_models: { subject: 'fixture' },
          role_agents: { subject: 'codex' },
          skill_sources: [{ path: `versioned/${id}/comet-classic`, name: 'comet-classic' }],
          case_manifest: { task_hash: 'fixture-case', validator_hash: 'fixture-validator' },
        },
      });
      await write(path.join(project, `${id}.json`), {
        data: {
          schema: 'comet.classic.context-cost.v1',
          scope: { projectRoot: project, phase: 'verify', change: 'case' },
          metrics: {
            contextBytes: {
              kind: 'estimated',
              source: 'fixture-bytes',
              unit: 'bytes',
              value: passed ? 380 : 530,
            },
          },
        },
      });
    }
    await setEvalBaseline(project, 'before');
    const runsDir = path.join(project, '.comet/eval/runs');
    const snapshotRuns = async () => {
      const entries = await fs.readdir(runsDir, { recursive: true, withFileTypes: true });
      return new Map(
        await Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
              const file = path.join(entry.parentPath, entry.name);
              return [path.relative(runsDir, file), await fs.readFile(file)] as const;
            }),
        ),
      );
    };
    const savedRuns = await snapshotRuns();
    const compare = () =>
      spawnSync(
        process.execPath,
        [
          path.join(repository, 'bin/comet.js'),
          'eval',
          '--project',
          project,
          '--compare',
          'after',
          '--baseline-context-cost',
          path.join(project, 'before.json'),
          '--candidate-context-cost',
          path.join(project, 'after.json'),
        ],
        { cwd: project, encoding: 'utf8', windowsHide: true },
      );
    const compared = compare();
    expect(compared.status, compared.stderr).toBe(0);
    expect(await snapshotRuns()).toEqual(savedRuns);
    expect(JSON.parse(compared.stdout)).toMatchObject({
      comparable: true,
      improved: 1,
      cases: [
        {
          workflowRegressionCase: 'classic-scope-reconfirmation',
          metrics: {
            contextBytes: { delta: -150, reason: null, baseline: { phase: 'verify' } },
            inputTokens: { delta: -20, reason: null },
            toolRoundTrips: { delta: -1, reason: null, candidate: { value: 1, unit: 'calls' } },
            waitMs: { delta: -35, reason: null, candidate: { value: 12, unit: 'ms' } },
          },
        },
      ],
    });
    const afterCost = path.join(project, 'after.json');
    const changed = JSON.parse(await fs.readFile(afterCost, 'utf8'));
    changed.data.scope.phase = 'archive';
    await write(afterCost, changed);
    const differentPhase = compare();
    expect(differentPhase.status, differentPhase.stderr).toBe(0);
    expect(await snapshotRuns()).toEqual(savedRuns);
    expect(JSON.parse(differentPhase.stdout).cases[0].metrics.contextBytes).toMatchObject({
      delta: null,
      reason: 'different-measurement',
    });
    const saved = await fs.readFile(
      path.join(project, '.comet/eval/runs/after/reports/case_report.json'),
      'utf8',
    );
    expect(JSON.parse(saved).events_summary).not.toHaveProperty('classic_context_cost');
    await expect(fs.readdir(path.join(project, '.comet/eval/runs'))).resolves.toEqual([
      'after',
      'before',
    ]);
  } finally {
    await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
  }
}, 120_000);
