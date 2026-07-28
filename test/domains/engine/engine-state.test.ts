import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readRunState, writeRunState, RUN_STATE_FILE } from '../../../domains/engine/state.js';
import type { RunState } from '../../../domains/engine/types.js';

const state = (): RunState => ({
  runId: 'run-1',
  skill: 'demo',
  skillVersion: '1',
  skillHash: 'a'.repeat(64),
  orchestration: 'deterministic',
  currentStep: 'start',
  iteration: 0,
  pending: null,
  pendingRef: '.comet/pending-action.json',
  trajectoryRef: '.comet/trajectory.jsonl',
  contextRef: '.comet/context.md',
  artifactsRef: '.comet/artifacts.json',
  checkpointRef: '.comet/checkpoint.json',
  status: 'running',
  retries: {},
});

describe('engine state projection', () => {
  let changeDir: string;
  let outsideRoot: string;

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-engine-state-'));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-engine-state-outside-'));
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      'workflow: full\nphase: build\ncustom_user_field: keep-me\n',
    );
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(changeDir, { recursive: true, force: true }),
      fs.rm(`${changeDir}-held`, { recursive: true, force: true }),
      fs.rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it('round-trips run fields and preserves legacy and unknown fields', async () => {
    const value = state();
    await writeRunState(changeDir, value);
    expect(await readRunState(changeDir)).toEqual(value);
    const raw = await fs.readFile(path.join(changeDir, RUN_STATE_FILE), 'utf8');
    const json = JSON.parse(raw);
    expect(json.runId).toBe('run-1');
    expect(json.skill).toBe('demo');
  });

  it('creates .comet/run-state.json when the state file is absent', async () => {
    await writeRunState(changeDir, state());

    expect(await readRunState(changeDir)).toEqual(state());
  });

  it('does not commit Run state through a parent replaced before commit', async () => {
    await writeRunState(changeDir, state());
    const parent = path.join(changeDir, '.comet');
    const held = `${changeDir}-held`;
    const writeWithHook = writeRunState as unknown as (
      changeDir: string,
      state: RunState,
      options: { beforeCommit: () => void | Promise<void> },
    ) => Promise<void>;
    try {
      await expect(
        writeWithHook(
          changeDir,
          { ...state(), iteration: 1 },
          {
            beforeCommit: async () => {
              const temporaryName = (await fs.readdir(parent)).find(
                (entry) => entry.includes('run-state') && entry.endsWith('.tmp'),
              );
              expect(temporaryName).toBeDefined();
              await fs.rename(parent, held);
              await fs.writeFile(
                path.join(outsideRoot, 'run-state.json'),
                '{"keep":true}\n',
                'utf8',
              );
              await fs.writeFile(
                path.join(outsideRoot, temporaryName!),
                '{"outside":true}\n',
                'utf8',
              );
              await fs.symlink(
                outsideRoot,
                parent,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        ),
      ).rejects.toThrow(/changed|junction|outside|managed parent/iu);
      await expect(fs.readFile(path.join(outsideRoot, 'run-state.json'), 'utf8')).resolves.toBe(
        '{"keep":true}\n',
      );
    } finally {
      await restoreParent(parent, held);
    }
  });

  it('rejects Run state when its parent changes during the bounded read', async () => {
    await writeRunState(changeDir, state());
    const parent = path.join(changeDir, '.comet');
    const held = `${changeDir}-held`;
    const readWithHooks = readRunState as unknown as (
      changeDir: string,
      options: { hooks: { afterOpen: () => void | Promise<void> } },
    ) => Promise<RunState | null>;
    try {
      await expect(
        readWithHooks(changeDir, {
          hooks: {
            afterOpen: async () => {
              await fs.rename(parent, held);
              await fs.writeFile(
                path.join(outsideRoot, 'run-state.json'),
                JSON.stringify({ ...state(), runId: 'outside' }),
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

  it('does not replace .comet/run-state.json when writing fails', async () => {
    const file = path.join(changeDir, RUN_STATE_FILE);
    await fs.mkdir(file, { recursive: true });

    await expect(writeRunState(changeDir, state())).rejects.toBeInstanceOf(Error);
    expect((await fs.stat(file)).isDirectory()).toBe(true);
  });

  it('rejects incomplete Run projections', async () => {
    await fs.mkdir(path.join(changeDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(changeDir, RUN_STATE_FILE), JSON.stringify({ runId: 'run-1' }));

    await expect(readRunState(changeDir)).rejects.toThrow(
      'Invalid Run state: skill must be a non-empty string',
    );
  });

  it('rejects invalid Run counters and retry maps', async () => {
    await writeRunState(changeDir, state());
    const file = path.join(changeDir, RUN_STATE_FILE);
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);

    // Invalid iteration
    await fs.writeFile(file, JSON.stringify({ ...json, iteration: -1 }));
    await expect(readRunState(changeDir)).rejects.toThrow(
      'Invalid Run state: iteration must be a non-negative integer',
    );

    // Invalid retries (array instead of object)
    await fs.writeFile(file, JSON.stringify({ ...json, retries: [] }));
    await expect(readRunState(changeDir)).rejects.toThrow(
      'Invalid Run state: run_retries must be a JSON object',
    );
  });

  it.each([
    ['absolute', 'pendingRef', 'pending_ref', '/tmp/pending.json'],
    ['traversal', 'contextRef', 'context_ref', '../context.md'],
  ])('rejects %s Run reference paths', async (_name, jsonField, docField, invalidPath) => {
    await writeRunState(changeDir, state());
    const file = path.join(changeDir, RUN_STATE_FILE);
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);
    await fs.writeFile(file, JSON.stringify({ ...json, [jsonField]: invalidPath }));

    await expect(readRunState(changeDir)).rejects.toThrow(
      `Invalid Run state: ${docField} must stay inside the change directory`,
    );
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
