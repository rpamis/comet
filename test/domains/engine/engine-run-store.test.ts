import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  appendTrajectory,
  clearPendingAction,
  readArtifacts,
  readCheckpoint,
  readContext,
  readPendingAction,
  readTrajectory,
  writeArtifacts,
  writeCheckpoint,
  writeContext,
  writePendingAction,
} from '../../../domains/engine/run-store.js';
import type { Checkpoint, EngineAction, TrajectoryEvent } from '../../../domains/engine/types.js';

describe('run store', () => {
  let changeDir: string;
  let outsideRoot: string;

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-run-store-'));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-run-store-outside-'));
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(changeDir, { recursive: true, force: true }),
      fs.rm(`${changeDir}-held`, { recursive: true, force: true }),
      fs.rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it('appends trajectory events and atomically round-trips run files', async () => {
    const event: TrajectoryEvent = {
      sequence: 1,
      timestamp: '2026-06-13T00:00:00.000Z',
      type: 'run_started',
      runId: 'run-1',
      data: {},
    };
    const action: EngineAction = {
      id: 'action-1',
      stepId: 'start',
      type: 'invoke_skill',
      ref: 'writing-plans',
    };
    const checkpoint: Checkpoint = {
      runId: 'run-1',
      stateVersion: 1,
      trajectoryOffset: 1,
      contextHash: null,
      artifactsHash: 'a'.repeat(64),
      createdAt: '2026-06-13T00:00:00.000Z',
    };

    await appendTrajectory(changeDir, '.comet/trajectory.jsonl', event);
    await writeArtifacts(changeDir, '.comet/artifacts.json', { report: 'report.md' });
    await writeContext(changeDir, '.comet/context.md', '# Context\n');
    await writePendingAction(changeDir, '.comet/pending-action.json', action);
    await writeCheckpoint(changeDir, '.comet/checkpoint.json', checkpoint);

    expect(await readArtifacts(changeDir, '.comet/artifacts.json')).toEqual({
      report: 'report.md',
    });
    expect(await readPendingAction(changeDir, '.comet/pending-action.json')).toEqual(action);
    await clearPendingAction(changeDir, '.comet/pending-action.json');
    expect(await readPendingAction(changeDir, '.comet/pending-action.json')).toBeNull();
    expect(await readContext(changeDir, '.comet/context.md')).toBe('# Context\n');
    expect(await readCheckpoint(changeDir, '.comet/checkpoint.json')).toEqual(checkpoint);
    expect(await readTrajectory(changeDir, '.comet/trajectory.jsonl')).toEqual([event]);
  });

  it('returns empty recovery values when optional Run files do not exist', async () => {
    expect(await readArtifacts(changeDir, '.comet/artifacts.json')).toEqual({});
    expect(await readContext(changeDir, '.comet/context.md')).toBeNull();
    expect(await readPendingAction(changeDir, '.comet/pending-action.json')).toBeNull();
    expect(await readCheckpoint(changeDir, '.comet/checkpoint.json')).toBeNull();
    expect(await readTrajectory(changeDir, '.comet/trajectory.jsonl')).toEqual([]);
  });

  it('reports the malformed Trajectory line during recovery', async () => {
    const file = path.join(changeDir, '.comet', 'trajectory.jsonl');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"sequence":1}\nnot-json\n');

    await expect(readTrajectory(changeDir, '.comet/trajectory.jsonl')).rejects.toThrow(
      'Invalid Trajectory event at line 2',
    );
  });

  it('rejects paths outside the change directory', async () => {
    await expect(writeContext(changeDir, '../outside.md', 'x')).rejects.toThrow(
      'Run path must stay inside the change directory',
    );
  });

  it('does not append a trajectory through a parent replaced before commit', async () => {
    const original: TrajectoryEvent = {
      sequence: 1,
      timestamp: '2026-06-13T00:00:00.000Z',
      type: 'run_started',
      runId: 'run-1',
      data: {},
    };
    const next = { ...original, sequence: 2 };
    await appendTrajectory(changeDir, '.comet/trajectory.jsonl', original);
    const parent = path.join(changeDir, '.comet');
    const held = `${changeDir}-held`;
    const appendWithHook = appendTrajectory as unknown as (
      changeDir: string,
      relativePath: string,
      event: TrajectoryEvent,
      options: { beforeCommit: () => void | Promise<void> },
    ) => Promise<void>;

    try {
      await expect(
        appendWithHook(changeDir, '.comet/trajectory.jsonl', next, {
          beforeCommit: async () => {
            await fs.rename(parent, held);
            await fs.writeFile(
              path.join(outsideRoot, 'trajectory.jsonl'),
              '{"outside":"keep"}\n',
              'utf8',
            );
            await fs.symlink(
              outsideRoot,
              parent,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          },
        }),
      ).rejects.toThrow(/changed|junction|outside|managed parent/iu);
      await expect(fs.readFile(path.join(outsideRoot, 'trajectory.jsonl'), 'utf8')).resolves.toBe(
        '{"outside":"keep"}\n',
      );
    } finally {
      await restoreParent(parent, held);
    }
  });

  it('rejects a checkpoint read when its parent changes after open', async () => {
    const checkpoint: Checkpoint = {
      runId: 'run-1',
      stateVersion: 1,
      trajectoryOffset: 1,
      contextHash: null,
      artifactsHash: 'a'.repeat(64),
      createdAt: '2026-06-13T00:00:00.000Z',
    };
    await writeCheckpoint(changeDir, '.comet/checkpoint.json', checkpoint);
    const parent = path.join(changeDir, '.comet');
    const held = `${changeDir}-held`;
    const readWithHooks = readCheckpoint as unknown as (
      changeDir: string,
      relativePath: string,
      options: { hooks: { afterOpen: () => void | Promise<void> } },
    ) => Promise<Checkpoint | null>;

    try {
      await expect(
        readWithHooks(changeDir, '.comet/checkpoint.json', {
          hooks: {
            afterOpen: async () => {
              await fs.rename(parent, held);
              await fs.writeFile(
                path.join(outsideRoot, 'checkpoint.json'),
                JSON.stringify({ ...checkpoint, runId: 'outside' }),
                'utf8',
              );
              await fs.symlink(
                outsideRoot,
                parent,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        }),
      ).rejects.toThrow(/changed|junction|outside|regular file|operation not permitted|EPERM/iu);
    } finally {
      await restoreParent(parent, held);
    }
  });

  it('does not clear a pending action through a replaced parent', async () => {
    const action: EngineAction = {
      id: 'action-1',
      stepId: 'start',
      type: 'invoke_skill',
      ref: 'writing-plans',
    };
    await writePendingAction(changeDir, '.comet/pending-action.json', action);
    const parent = path.join(changeDir, '.comet');
    const held = `${changeDir}-held`;
    const clearWithHook = clearPendingAction as unknown as (
      changeDir: string,
      relativePath: string,
      options: { beforeRemove: () => void | Promise<void> },
    ) => Promise<void>;

    try {
      await expect(
        clearWithHook(changeDir, '.comet/pending-action.json', {
          beforeRemove: async () => {
            await fs.rename(parent, held);
            await fs.writeFile(path.join(outsideRoot, 'pending-action.json'), '{"keep":true}\n');
            await fs.symlink(
              outsideRoot,
              parent,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          },
        }),
      ).rejects.toThrow(/changed|junction|outside|managed parent/iu);
      await expect(
        fs.readFile(path.join(outsideRoot, 'pending-action.json'), 'utf8'),
      ).resolves.toBe('{"keep":true}\n');
    } finally {
      await restoreParent(parent, held);
    }
  });
});

async function restoreParent(parent: string, held: string): Promise<void> {
  try {
    if ((await fs.lstat(parent)).isSymbolicLink()) {
      if (process.platform === 'win32') await fs.rmdir(parent);
      else await fs.unlink(parent);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    await fs.stat(held).then(
      () => true,
      () => false,
    )
  ) {
    await fs.rename(held, parent);
  }
}
