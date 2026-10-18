import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { listActiveNativeChangesOwnedByWorkspace } from '../../../domains/comet-native/native-change.js';
import {
  readSdkChangeOwner,
  recoverSdkChangeOwnerToActive,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { writeCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';
import * as cancellation from '../../../domains/comet-native/native-sdk-cancellation.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-active-read-scope-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const cli = async (args: string[]) => runNativeCli([...args, '--project-root', root, '--json']);
  const paths = await nativeProjectPaths(root, 'docs', { readOnly: true });
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(paths.workspaceRuntimeRoot, 'sdk-runs/native'),
  });
  for (const name of ['first-history', 'second-history']) {
    expect((await cli(['new', name])).exitCode).toBe(0);
    expect((await cli(['cancel', name])).exitCode).toBe(0);
    // Exercise terminal Runs retained in active storage, as before history migration.
    const run = (await store.read(name))!;
    expect(await store.readDisposition(name)).toBe('closed');
    await recoverSdkChangeOwnerToActive(root, 'native', name);
    expect(await store.reopenRun(name, run.revision)).toBe(true);
    expect(await store.readDisposition(name)).toBe('active');
    await expect(
      fs.access(path.join(paths.workspaceRuntimeRoot, 'change-owners/native', `${name}.json`)),
    ).resolves.toBeUndefined();
  }
  return { root, cli, paths };
}
it('starts a fresh observation inside an older scope and exposes later owner and selection changes', async () => {
  const { root, cli, paths } = await fixture();
  const name = 'first-history';
  const file = path.join(paths.workspaceRuntimeRoot, 'change-owners/native', `${name}.json`);
  const source = await fs.readFile(file, 'utf8');
  await runWithHookReadCache(async () => {
    expect(await readSdkChangeOwner(root, 'native', name, { readOnly: true })).not.toBeNull();
    await fs.writeFile(file, 'invalid owner');
    await expect(listActiveNativeChangesOwnedByWorkspace(paths)).rejects.toThrow();
    // The child observation is isolated; it does not clear the caller's snapshot.
    expect(await readSdkChangeOwner(root, 'native', name, { readOnly: true })).not.toBeNull();
    await fs.writeFile(file, source);
    await expect(listActiveNativeChangesOwnedByWorkspace(paths)).resolves.toEqual([]);
  });
  await writeCometCurrentSelection(root, {
    schema: 'comet.selection.v2',
    workflow: 'native',
    change: name,
    branch: null,
  });
  await expect(listActiveNativeChangesOwnedByWorkspace(paths)).resolves.toEqual([name]);
  await fs.unlink(path.join(root, '.comet/current-change.json'));
  await expect(listActiveNativeChangesOwnedByWorkspace(paths)).resolves.toEqual([]);
  expect((await cli(['new', 'fresh-after-observation'])).exitCode).toBe(0);
  await expect(listActiveNativeChangesOwnedByWorkspace(paths)).resolves.toEqual([
    'fresh-after-observation',
  ]);
});
it('waits for all pending inspections on failure and discards the failed observation', async () => {
  const { paths } = await fixture();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const inspected = new Set<string>();
  const inspect = vi
    .spyOn(cancellation, 'isNativeSdkCancellationComplete')
    .mockImplementation(async ({ run }) => {
      inspected.add(run.runId);
      if (inspected.size === 2) started();
      if (run.runId === 'first-history') throw new Error('controlled inspection failure');
      await pending;
      return true;
    });
  let finished = false;
  const outcome = listActiveNativeChangesOwnedByWorkspace(paths).then(
    () => {
      finished = true;
      return null;
    },
    (error: unknown) => {
      finished = true;
      return error;
    },
  );
  try {
    await entered;
    // Let the first rejection propagate while the other inspection remains pending.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(inspect.mock.calls.map(([{ run }]) => run.runId).sort()).toEqual([
      'first-history',
      'second-history',
    ]);
  } finally {
    release();
  }
  expect(await outcome).toMatchObject({ message: 'controlled inspection failure' });
  vi.restoreAllMocks();
  await expect(listActiveNativeChangesOwnedByWorkspace(paths)).resolves.toEqual([]);
});
