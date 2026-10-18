import * as history from '../../../domains/comet-native/native-sdk-history-discovery.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as engine from '../../../domains/engine/runtime.js';
import * as owners from '../../../domains/workflow-contract/change-runtime-owner.js';
import * as git from '../../../platform/paths/git-worktree.js';
import * as cancellation from '../../../domains/comet-native/native-sdk-cancellation.js';
import { listActiveNativeChangesOwnedByWorkspace } from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-active-concurrency-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('bounds creation discovery, settles errors in name order and reads owners without migration', async () => {
  const paths = await nativeProjectPaths(root, 'docs');
  const names = Array.from({ length: 10 }, (_, i) => `history-${i}`);
  vi.spyOn(history, 'listNativeSdkHistoryPartitions').mockResolvedValue({
    active: names,
    history: [],
  });
  const owner = vi
    .spyOn(owners, 'readSdkChangeOwner')
    .mockImplementation(async (_root, _workflow, name) => ({
      schema: owners.COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'sdk',
      application: 'native',
      runId: name,
    }));
  const gates = names.map(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  });
  let active = 0;
  let peak = 0;
  let completed = 0;
  let fail = false;
  let corruptIdentity: 'runId' | 'name' | 'artifactRootRef' | null = null;
  const inspect = vi.fn(async (name: string) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await gates[names.indexOf(name)].promise;
      if (fail && ['history-0', 'history-1'].includes(name)) throw new Error(`corrupt ${name}`);
      return {
        runId: corruptIdentity === 'runId' ? 'foreign-run' : name,
        input: {
          name: corruptIdentity === 'name' ? 'foreign-name' : name,
          artifactRootRef: corruptIdentity === 'artifactRootRef' ? null : 'docs',
        },
        workflow: { id: 'comet-native', version: '1' },
        state: createNativePortableState({
          name,
          language: 'en',
          nextAction: 'prepare-shape-confirmation',
        }),
      } as engine.WorkflowRun;
    } finally {
      active--;
      completed++;
    }
  });
  vi.spyOn(engine, 'createRuntime').mockReturnValue({ inspect } as unknown as ReturnType<
    typeof engine.createRuntime
  >);
  vi.spyOn(cancellation, 'isNativeSdkCancellationComplete').mockResolvedValue(true);
  const gitInspection = vi.spyOn(git, 'inspectGitWorktree');
  const pending = listActiveNativeChangesOwnedByWorkspace(paths);
  for (const count of [4, 8, 10]) {
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(count));
    gates.slice(0, count).forEach((gate) => gate.resolve());
  }
  expect(await pending).toEqual([]);
  expect({ active, peak, completed }).toEqual({ active: 0, peak: 4, completed: 10 });
  expect(gitInspection).not.toHaveBeenCalled();
  for (const call of owner.mock.calls) expect(call[3]).toEqual({ readOnly: true });
  vi.mocked(cancellation.isNativeSdkCancellationComplete).mockResolvedValue(false);
  expect(await listActiveNativeChangesOwnedByWorkspace(paths)).toEqual(names);
  expect(gitInspection).toHaveBeenCalledTimes(1);
  fail = true;
  await expect(listActiveNativeChangesOwnedByWorkspace(paths)).rejects.toThrow('corrupt history-0');
  expect(active).toBe(0);
  expect(completed).toBe(30);
  fail = false;
  vi.mocked(cancellation.isNativeSdkCancellationComplete).mockResolvedValue(true);
  for (const field of ['runId', 'name', 'artifactRootRef'] as const) {
    corruptIdentity = field;
    await expect(listActiveNativeChangesOwnedByWorkspace(paths)).rejects.toThrow(
      'does not match its change identity',
    );
    expect(active).toBe(0);
  }
  expect(completed).toBe(60);
});
