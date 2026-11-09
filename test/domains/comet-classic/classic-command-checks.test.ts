import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startClassicCheckAction } from '../../../domains/comet-classic/classic-check-action.js';
import {
  executeCommandCheck,
  latestCommandCheck,
  recordCommandCheck,
  recoverCommandChecks,
  usableCommandCheck,
} from '../../../domains/comet-classic/classic-command-checks.js';
import * as checkFiles from '../../../domains/comet-classic/classic-protected-path.js';
import {
  appendTrajectory,
  readTrajectory,
} from '../../../domains/comet-classic/classic-run-store.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-state.js';
import {
  readClassicState,
  writeClassicState,
} from '../../../domains/comet-classic/classic-store.js';
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
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it.each([0, 7])(
    'returns the original actual result for a repeated check request (exit=%s)',
    async (exitCode) => {
      const counter = `${projectRoot}-execution-count`;
      try {
        const input = {
          scope: 'verify' as const,
          argv: [
            process.execPath,
            '-e',
            `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x'); process.exit(${exitCode})`,
          ],
          reusable: true,
          executionRequestId: 'a'.repeat(64),
        };
        const original = await executeCommandCheck(projectRoot, changeDir, run, input);
        const repeated = await executeCommandCheck(projectRoot, changeDir, run, input);
        expect(original.exitCode).toBe(exitCode);
        expect(repeated).toEqual({ ...original, reused: true });
        expect(await fs.readFile(counter, 'utf8')).toBe('x');
        expect(
          (await readTrajectory(changeDir, run.trajectoryRef)).filter(
            (event) => event.type === 'command_check_started',
          ),
        ).toHaveLength(1);
      } finally {
        await fs.rm(counter, { force: true });
      }
    },
  );

  it('retries only a proven prelaunch failure in the same check Action without replaying a process', async () => {
    const counter = `${projectRoot}-execution-count`;
    try {
      const input = {
        scope: 'verify' as const,
        argv: [
          process.execPath,
          '-e',
          `require('node:fs').appendFileSync(${JSON.stringify(counter)},'x')`,
        ],
        reusable: true,
        executionRequestId: 'b'.repeat(64),
      };
      // 旧版确实在启动前中断的持久化记录；没有启动任何检查进程。
      const action = startClassicCheckAction({
        run,
        id: input.executionRequestId,
        scope: input.scope,
        argv: input.argv,
        cwd: '.',
        timeoutMs: 300000,
        tier: 'full',
        checkEpoch: 0,
      });
      await appendTrajectory(changeDir, run.trajectoryRef, {
        sequence: 1,
        timestamp: new Date().toISOString(),
        runId: run.runId,
        type: 'command_check_started',
        data: {
          scope: input.scope,
          argv: input.argv,
          cwd: '.',
          timeoutMs: 300000,
          reusable: true,
          tier: 'full',
          checkEpoch: 0,
          action,
        },
      });
      await appendTrajectory(changeDir, run.trajectoryRef, {
        sequence: 2,
        timestamp: new Date().toISOString(),
        runId: run.runId,
        type: 'checkpoint',
        data: {
          kind: 'classic-check-not-executed',
          scope: input.scope,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          reason: 'Original input read stopped before launch.',
        },
      });
      expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
      expect(await fs.stat(counter).catch(() => null)).toBeNull();
      const resumed = await executeCommandCheck(projectRoot, changeDir, run, input);
      expect(resumed.action).toMatchObject({
        id: input.executionRequestId,
        attempt: 2,
        status: 'succeeded',
      });
      expect(resumed.action?.reconciliations).toEqual([
        expect.objectContaining({ attempt: 1, resolution: 'not-executed' }),
      ]);
      expect(await fs.readFile(counter, 'utf8')).toBe('x');
      expect(await executeCommandCheck(projectRoot, changeDir, run, input)).toEqual({
        ...resumed,
        reused: true,
      });
      expect(await fs.readFile(counter, 'utf8')).toBe('x');
    } finally {
      await fs.rm(counter, { force: true });
    }
  });

  it('refuses both old and new request IDs when the process ran but its completion receipt is unknown', async () => {
    const counter = `${projectRoot}-execution-count`;
    try {
      const input = {
        scope: 'verify' as const,
        argv: [
          process.execPath,
          '-e',
          `require('node:fs').appendFileSync(${JSON.stringify(counter)},'x')`,
        ],
        reusable: true,
        executionRequestId: 'c'.repeat(64),
      };
      vi.spyOn(checkFiles, 'writeClassicProjectText').mockRejectedValueOnce(
        new Error('completion receipt unavailable'),
      );
      await expect(executeCommandCheck(projectRoot, changeDir, run, input)).rejects.toThrow(
        'receipt unavailable',
      );
      expect(await fs.readFile(counter, 'utf8')).toBe('x');
      expect(await latestCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
      await expect(executeCommandCheck(projectRoot, changeDir, run, input)).rejects.toThrow(
        '结果未明',
      );
      await expect(
        executeCommandCheck(projectRoot, changeDir, run, {
          ...input,
          executionRequestId: 'd'.repeat(64),
        }),
      ).rejects.toThrow('结果未明');
      expect(await fs.readFile(counter, 'utf8')).toBe('x');
    } finally {
      await fs.rm(counter, { force: true });
    }
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
        data: expect.objectContaining({ scope: 'build', exitCode: 0, cwd: 'packages/app' }),
      }),
    ]);
  });

  it('serializes concurrent evidence sequence allocation', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        recordCommandCheck(projectRoot, changeDir, run, {
          scope: 'verify',
          command: `check-${index}`,
          exitCode: index,
        }),
      ),
    );
    expect(results.map((record) => record.sequence).sort()).toEqual([1, 2, 3, 4]);
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
    const execution = executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      argv: [process.execPath, '-e', 'setTimeout(() => {}, 1000)'],
      reusable: true,
    });
    const outcome = execution.then(
      () => 'unexpected success',
      (error: Error) => error.message,
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await readTrajectory(changeDir, run.trajectoryRef)).some(
          (event) => event.type === 'command_check_started',
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: 2,
      timestamp: '',
      runId: run.runId,
      type: 'command_check_started',
      data: { scope: 'verify' },
    });
    expect(await outcome).toMatch(/superseded/i);
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
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
      { sequence: 4, cwd: path.resolve(projectRoot, '..', 'outside'), command: 'absolute cwd' },
    ];
    for (const event of events) {
      await appendTrajectory(changeDir, run.trajectoryRef, {
        sequence: event.sequence,
        timestamp,
        type: 'command_check_recorded',
        runId: run.runId,
        data: { scope: 'build', command: event.command, exitCode: 0, cwd: event.cwd },
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
    await writeClassicState(changeDir, {
      ...(await readClassicState(changeDir)),
      run: runState('another-run'),
    });
    await expect(
      executeCommandCheck(projectRoot, changeDir, run, {
        scope: 'build',
        argv: [process.execPath, '-e', 'process.exit(0)'],
      }),
    ).rejects.toThrow('Classic check Run changed before launch');
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
    const recorded = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      reusable: true,
    });
    expect(recorded.exitCode).toBe(0);
    expect(recorded.reusable).toBe(true);
    expect(recorded.manifestRef).toBeUndefined();
    expect(recorded.manifestHash).toBeUndefined();
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'build')).toMatchObject({
      sequence: recorded.sequence,
    });
    const again = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      reusable: true,
    });
    expect(again.reused).toBe(true);
  });

  it('reuses the same reusable command across Build and Verify without rerunning it', async () => {
    const marker = path.join(changeDir, '.comet', 'check-count.txt');
    await fs.mkdir(path.dirname(marker), { recursive: true });
    const argv = [
      process.execPath,
      '-e',
      `require('fs').appendFileSync(${JSON.stringify(marker)}, 'run\\n')`,
    ];
    const build = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      argv,
      reusable: true,
    });
    const verify = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      argv,
      reusable: true,
    });

    expect(build.reused).toBeUndefined();
    expect(verify).toMatchObject({ scope: 'verify', reused: true, exitCode: 0 });
    expect(await fs.readFile(marker, 'utf8')).toBe('run\n');
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).toMatchObject({
      sequence: verify.sequence,
    });
  });

  it('does not append duplicate cold-recovery fences after an unrelated checkpoint', async () => {
    await expect(recoverCommandChecks(projectRoot, changeDir, run)).resolves.toEqual({
      build: 'rerun-required',
      verify: 'rerun-required',
    });
    const first = await readTrajectory(changeDir, run.trajectoryRef);
    expect(first.filter((event) => event.type === 'command_checks_invalidated')).toHaveLength(1);

    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: first.at(-1)!.sequence + 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      type: 'checkpoint',
      data: { note: 'unrelated progress checkpoint' },
    });
    await expect(recoverCommandChecks(projectRoot, changeDir, run)).resolves.toEqual({
      build: 'rerun-required',
      verify: 'rerun-required',
    });

    const second = await readTrajectory(changeDir, run.trajectoryRef);
    expect(second.filter((event) => event.type === 'command_checks_invalidated')).toHaveLength(1);
  });
});
