import '../../helpers/isolated-agent-home.js';
import { fixture } from '../../helpers/classic-platform-migration.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latestCommandCheck,
  recordCommandCheck,
} from '../../../domains/comet-classic/classic-command-checks.js';

import {
  appendTrajectory,
  readTrajectory,
} from '../../../domains/comet-classic/classic-run-store.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-state.js';
import { writeClassicState } from '../../../domains/comet-classic/classic-store.js';
import type { RunState, TrajectoryEvent } from '../../../domains/engine/types.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

function runState(runId = 'run-current'): RunState {
  return {
    runId,
    skill: 'comet-classic',
    skillVersion: '1',
    skillHash: 'a'.repeat(64),
    orchestration: 'deterministic',
    currentStep: 'full.build.execute',
    iteration: 1,
    pending: null,
    pendingRef: '.comet/pending-action.json',
    trajectoryRef: '.comet/trajectory.jsonl',
    contextRef: '.comet/context.md',
    artifactsRef: '.comet/artifacts.json',
    checkpointRef: '.comet/checkpoint.json',
    status: 'running',
    retries: {},
  };
}

describe('Classic command check evidence', () => {
  let projectRoot: string;
  let changeDir: string;
  let run: RunState;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-command-check-'));
    await prepareClassicLegacyProject(projectRoot);
    changeDir = path.join(projectRoot, 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    run = runState();
    await writeClassicState(changeDir, { classic: classicFixture(), run });
  });

  function classicFixture() {
    return parseClassicStateDocument({
      workflow: 'full',
      phase: 'build',
      design_doc: null,
      plan: null,
      build_mode: 'direct',
      isolation: 'current',
      verify_mode: 'light',
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    }).classic!;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it.each([0, 7])(
    'returns the original actual result for a repeated check request (exit=%s)',
    async (exitCode) => {
      const f = await fixture('source');
      await f.report('actual-' + exitCode, exitCode);
      const before = await f.inspect();
      const reported = await f.invoke('state', 'complete-build', 'demo', '--checks', 'checks.json');
      expect(reported.exitCode === 0).toBe(exitCode === 0);
      const original = await f.inspect();
      if (exitCode !== 0) expect(original).toEqual(before);
      await f.cli('state', 'next', 'demo');
      await f.cli('state', 'next', 'demo', '--continue');
      expect(await f.inspect()).toEqual(original);
      expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe(
        'actual-' + exitCode + '\n',
      );
    },
  );

  // Retired worker-only case 1, archived with migration mapping.

  it('refuses both old and new request IDs when the process ran but its completion receipt is unknown', async () => {
    const f = await fixture('source');
    const own = await inspectClassicSdkRun(f.root, 'demo');
    const action = own.run.actions.find(
      (a) => a.status === 'pending' && a.stepId === 'tweak.build.execute',
    )!;
    const claimed = await own.runtime.claim({
      runId: own.run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'platform-worker',
      claimToken: 'original-claim',
    });
    await f.report('started-once');
    const unknown = await own.runtime.markUnknown({
      runId: claimed.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'The platform lost the original task result.',
    });
    for (const id of ['old-request', 'new-request']) {
      const guide = await f.cli(
        'check',
        'run',
        'demo',
        'build',
        '--',
        process.execPath,
        '-e',
        'process.stdout.write(' + JSON.stringify(id) + ')',
      );
      expect(guide).toMatchObject({
        status: 'platform-execution-required',
        checksExecuted: false,
      });
      await f.invoke('state', 'next', 'demo', '--continue');
      expect(await f.inspect()).toEqual(unknown);
    }
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe('started-once\n');
  });

  it('appends command evidence without executing the saved command', async () => {
    const marker = path.join(projectRoot, 'must-not-exist');
    const recorded = await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      command: `node -e "require('fs').writeFileSync('${marker}', 'bad')"`,
      exitCode: 0,
      cwd: 'packages/app',
    });

    expect(recorded).toMatchObject({
      scope: 'build',
      exitCode: 0,
      cwd: 'packages/app',
      runId: 'run-current',
    });
    expect(await fs.stat(marker).catch(() => null)).toBeNull();
    expect(await readTrajectory(changeDir, run.trajectoryRef)).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'command_check_recorded',
        runId: 'run-current',
        data: expect.objectContaining({
          scope: 'build',
          exitCode: 0,
          cwd: 'packages/app',
        }),
      }),
    ]);
  });

  it('preserves successive evidence records and sequence allocation for one writer', async () => {
    const results: Awaited<ReturnType<typeof recordCommandCheck>>[] = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(
        await recordCommandCheck(projectRoot, changeDir, run, {
          scope: 'verify',
          command: `check-${index}`,
          exitCode: index,
        }),
      );
    }
    expect(results.map((record) => record.sequence).sort()).toEqual([1, 2, 3, 4]);
    expect(await readTrajectory(changeDir, run.trajectoryRef)).toMatchObject(
      results.map((record) => ({
        sequence: record.sequence,
        type: 'command_check_recorded',
        runId: run.runId,
        data: { scope: 'verify', command: record.command, exitCode: record.exitCode },
      })),
    );
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toEqual(
      results.find((record) => record.sequence === 4),
    );
  });

  it.each([
    'command_check_started',
    'command_check_consumed',
    'command_checks_invalidated',
  ] as const)('preserves %s fences after warming the index', async (type) => {
    await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      command: 'check',
      exitCode: 0,
    });
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'build')).not.toBeNull();
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: 2,
      timestamp: '',
      runId: run.runId,
      type,
      data: { scope: 'build', scopes: ['build'] },
    });
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'build')).toBeNull();
  });

  it('does not resurrect an older execution over a newer start', async () => {
    const original = await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      command: 'actual platform result',
      exitCode: 0,
    });
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toEqual(original);
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: original.sequence + 1,
      timestamp: '',
      runId: run.runId,
      type: 'command_check_started',
      data: { scope: 'verify' },
    });
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
  });

  it('returns the newest valid matching record, including failures, for only the current run', async () => {
    const oldRun = runState('run-old');
    await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      command: 'npm test',
      exitCode: 0,
    });
    await recordCommandCheck(projectRoot, changeDir, oldRun, {
      scope: 'verify',
      command: 'old run failure',
      exitCode: 9,
    });
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: 3,
      timestamp: new Date().toISOString(),
      type: 'command_check_recorded',
      runId: run.runId,
      data: { scope: 'verify', command: '', exitCode: 7, cwd: '.' },
    } as TrajectoryEvent);
    const failure = await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      command: 'npm test -- --runInBand',
      exitCode: 2,
    });

    expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toEqual(failure);
    expect(await latestCommandCheck(projectRoot, changeDir, run, 'build')).toBeNull();
  });

  it('ignores newer records with invalid cwd and normalizes the older valid cwd', async () => {
    const timestamp = new Date().toISOString();
    const events = [
      { sequence: 1, cwd: 'packages/../src', command: 'npm run build' },
      { sequence: 2, cwd: '', command: 'blank cwd' },
      { sequence: 3, cwd: '../outside', command: 'traversal cwd' },
      {
        sequence: 4,
        cwd: path.resolve(projectRoot, '..', 'outside'),
        command: 'absolute cwd',
      },
    ];
    for (const event of events) {
      await appendTrajectory(changeDir, run.trajectoryRef, {
        sequence: event.sequence,
        timestamp,
        type: 'command_check_recorded',
        runId: run.runId,
        data: {
          scope: 'build',
          command: event.command,
          exitCode: 0,
          cwd: event.cwd,
        },
      });
    }

    expect(await latestCommandCheck(projectRoot, changeDir, run, 'build')).toEqual({
      sequence: 1,
      timestamp,
      runId: run.runId,
      scope: 'build',
      command: 'npm run build',
      exitCode: 0,
      cwd: 'src',
    });
  });

  it('rejects a check when a persisted Run belongs to a different execution', async () => {
    const f = await fixture('source');
    const own = await inspectClassicSdkRun(f.root, 'demo');
    const action = own.run.actions.find(
      (a) => a.status === 'pending' && a.stepId === 'tweak.build.execute',
    )!;
    const claimed = await own.runtime.claim({
      runId: own.run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-worker',
      claimToken: 'original-token',
    });
    await expect(
      own.runtime.recordOutcome({
        runId: claimed.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: 'another-execution',
          claimToken: 'original-token',
          outcomeId: 'foreign',
          status: 'succeeded',
          output: {
            event: 'build-complete',
            checks: [{ name: 'foreign', result: 'passed' }],
          },
        },
        context: { projectRoot: f.root },
      }),
    ).rejects.toThrow();
    expect(await f.inspect()).toEqual(claimed);
    await expect(fs.stat(path.join(f.base, 'platform-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['null data', null],
    ['missing data', undefined],
    ['array data', []],
  ])('ignores a newer record with %s', async (_label, malformedData) => {
    const valid = await recordCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      command: 'npm test',
      exitCode: 0,
    });
    const malformed = {
      sequence: 2,
      timestamp: new Date().toISOString(),
      type: 'command_check_recorded',
      runId: run.runId,
      ...(malformedData === undefined ? {} : { data: malformedData }),
    } as unknown as TrajectoryEvent;
    await appendTrajectory(changeDir, run.trajectoryRef, malformed);

    await expect(latestCommandCheck(projectRoot, changeDir, run, 'verify')).resolves.toEqual(valid);
  });

  it.each([
    [{ scope: 'deploy', command: 'npm test', exitCode: 0 }, /scope/i],
    [{ scope: 'build', command: '   ', exitCode: 0 }, /command/i],
    [{ scope: 'build', command: 'npm test', exitCode: 0.5 }, /exitCode/i],
    [{ scope: 'build', command: 'npm test', exitCode: 0, cwd: '../outside' }, /project root/i],
  ])('rejects invalid evidence %#', async (input, message) => {
    await expect(recordCommandCheck(projectRoot, changeDir, run, input as never)).rejects.toThrow(
      message,
    );
  });

  it('reuses an explicitly selected original command without a file manifest', async () => {
    const f = await fixture('source');
    await f.report('explicit-original');
    const raw = await fs.readFile(path.join(f.root, 'checks.json'), 'utf8');
    expect(raw).not.toMatch(/manifest|fingerprint|sha256/);
    await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
    const submitted = await f.inspect();
    await f.cli('state', 'next', 'demo', '--continue');
    expect(await f.inspect()).toEqual(submitted);
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe(
      'explicit-original\n',
    );
  });

  it('reuses the same reusable command across Build and Verify without rerunning it', async () => {
    const f = await fixture('source');
    await f.report('shared-once');
    await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
    const before = await f.inspect();
    const original = before.actions.findLast((a) => a.stepId === 'tweak.build.execute')!;
    const report = 'docs/superpowers/reports/shared.md';
    await fs.mkdir(path.dirname(path.join(f.root, report)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(f.root, report),
      '# Verification\nAgent selected the original actual passing check.\n',
    );
    await f.cli(
      'guard',
      'demo',
      'verify',
      '--report',
      report,
      '--apply',
      '--checks',
      'checks.json',
    );
    const after = await f.inspect();
    expect(after.state).toMatchObject({ phase: 'archive' });
    expect(after.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(
      after.actions.findLast((a) => a.stepId === 'tweak.verify.run')?.outcome?.output,
    ).toMatchObject({ checks: [{ name: 'shared-once', result: 'passed' }] });
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe('shared-once\n');
  });

  // Retired worker-only case 14, archived with migration mapping.
});
