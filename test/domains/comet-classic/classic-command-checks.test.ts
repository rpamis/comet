import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { RunState, TrajectoryEvent } from '../../../domains/engine/types.js';
import { appendTrajectory, readTrajectory } from '../../../domains/engine/run-store.js';
import {
  latestCommandCheck,
  recordCommandCheck,
  executeCommandCheck,
  usableCommandCheck,
} from '../../../domains/comet-classic/classic-command-checks.js';
import {
  checkEnvironmentFingerprint,
  legacyCheckInputFingerprint,
} from '../../../domains/comet-classic/classic-check-snapshot.js';
import { readCheckPolicy } from '../../../domains/comet-classic/classic-check-policy.js';

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
    changeDir = path.join(projectRoot, 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    run = runState();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  it('records a per-file manifest and reuses it while inputs stay unchanged', async () => {
    const recorded = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      reusable: true,
    });
    expect(recorded.exitCode).toBe(0);
    expect(recorded.reusable).toBe(true);
    expect(recorded.manifestRef).toMatch(
      /^openspec\/changes\/demo\/\.comet\/checks\/.+\.manifest$/,
    );
    const serialized = await fs.readFile(path.join(projectRoot, recorded.manifestRef!), 'utf8');
    expect(recorded.manifestHash).toBe(createHash('sha256').update(serialized).digest('hex'));
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

  it('invalidates manifest evidence on content changes but tolerates timestamp-only touches', async () => {
    const input = path.join(projectRoot, 'input.txt');
    await fs.writeFile(input, 'same');
    const recorded = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'verify',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      reusable: true,
    });
    const now = new Date();
    await fs.utimes(input, now, now);
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).not.toBeNull();
    await fs.writeFile(input, 'changed');
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
    const added = path.join(projectRoot, 'added.txt');
    await fs.writeFile(added, 'new');
    await fs.writeFile(input, 'same');
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).toBeNull();
    await fs.rm(added);
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'verify')).not.toBeNull();
    expect(recorded.scope).toBe('verify');
  });

  it('revalidates pre-manifest evidence with its original binding semantics', async () => {
    const argv = [process.execPath, '-e', 'process.exit(0)'];
    const cwd = '.';
    await fs.writeFile(path.join(projectRoot, 'input.txt'), 'stable');
    // The runtime directory exists before any real check runs; create it first
    // because the .comet directory entry itself is part of the input snapshot.
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      type: 'command_check_recorded',
      data: { scope: 'build', command: 'placeholder', exitCode: 0, cwd },
    });
    const inputAfter = await legacyCheckInputFingerprint(projectRoot, changeDir, { argv, cwd });
    const environment = await checkEnvironmentFingerprint(
      argv,
      path.resolve(projectRoot, cwd),
      await readCheckPolicy(projectRoot, { argv, cwd }, true),
      true,
    );
    const logRef = 'openspec/changes/demo/.comet/checks/legacy.log';
    await fs.mkdir(path.dirname(path.join(projectRoot, logRef)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, logRef), 'legacy output\n');
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: 2,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      type: 'command_check_executed',
      data: {
        scope: 'build',
        command: JSON.stringify(argv),
        checkEpoch: 0,
        argv,
        exitCode: 0,
        cwd,
        provenance: 'runtime',
        inputBefore: inputAfter,
        inputAfter,
        environment,
        logRef,
        logHash: createHash('sha256').update('legacy output\n').digest('hex'),
        reusable: true,
      },
    });
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'build')).not.toBeNull();
    await fs.writeFile(path.join(projectRoot, 'input.txt'), 'changed');
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'build')).toBeNull();
  });

  it('rejects evidence whose recorded manifest is damaged or absent', async () => {
    const recorded = await executeCommandCheck(projectRoot, changeDir, run, {
      scope: 'build',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      reusable: true,
    });
    const manifestPath = path.join(projectRoot, recorded.manifestRef!);
    await fs.writeFile(manifestPath, '{"p":"tampered","h":"0","s":null,"m":null}\n');
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'build')).toBeNull();
    await fs.rm(manifestPath);
    expect(await usableCommandCheck(projectRoot, changeDir, run, 'build')).toBeNull();
  });
});
