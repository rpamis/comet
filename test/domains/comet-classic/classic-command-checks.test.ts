import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { RunState, TrajectoryEvent } from '../../../domains/engine/types.js';
import { appendTrajectory, readTrajectory } from '../../../domains/engine/run-store.js';
import {
  latestCommandCheck,
  recordCommandCheck,
} from '../../../domains/comet-classic/classic-command-checks.js';

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
    const recorded = await recordCommandCheck(changeDir, run, {
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

  it('returns the newest valid matching record, including failures, for only the current run', async () => {
    const oldRun = runState('run-old');
    await recordCommandCheck(changeDir, run, {
      scope: 'verify',
      command: 'npm test',
      exitCode: 0,
    });
    await recordCommandCheck(changeDir, oldRun, {
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
    const failure = await recordCommandCheck(changeDir, run, {
      scope: 'verify',
      command: 'npm test -- --runInBand',
      exitCode: 2,
    });

    expect(await latestCommandCheck(changeDir, run, 'verify')).toEqual(failure);
    expect(await latestCommandCheck(changeDir, run, 'build')).toBeNull();
  });

  it.each([
    [{ scope: 'deploy', command: 'npm test', exitCode: 0 }, /scope/i],
    [{ scope: 'build', command: '   ', exitCode: 0 }, /command/i],
    [{ scope: 'build', command: 'npm test', exitCode: 0.5 }, /exitCode/i],
    [{ scope: 'build', command: 'npm test', exitCode: 0, cwd: '../outside' }, /project root/i],
  ])('rejects invalid evidence %#', async (input, message) => {
    await expect(recordCommandCheck(changeDir, run, input as never)).rejects.toThrow(message);
  });
});
