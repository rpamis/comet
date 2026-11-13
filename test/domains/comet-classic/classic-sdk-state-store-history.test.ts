import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('preserves original Run history and state when the authoritative CAS rejects a stale revision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-current-history-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const cli = (...args: string[]) =>
    runClassicCli(['state', ...args, '--json'], undefined, {
      projectRoot: root,
      invocationCwd: root,
    });
  expect(
    (await cli('init', 'history', 'full', '--runtime', 'sdk', '--isolation', 'current')).exitCode,
  ).toBe(0);
  expect((await cli('set', 'history', 'language', 'zh-CN')).exitCode).toBe(0);
  const raw = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/classic'),
    }),
    previous = (await raw.read('history'))!;
  expect(previous.revision).toBeGreaterThan(1);
  const stateFile = path.join(root, 'openspec/changes/history/comet-state.yaml'),
    before = await fs.readFile(stateFile),
    next = {
      ...previous,
      revision: previous.revision,
      reason: 'This stale proposal must never replace the original Run.',
    },
    commit = vi.spyOn(raw, 'compareAndSwap'),
    store = createClassicSdkStateStore(root, { store: raw });
  expect(await store.compareAndSwap(previous.runId, previous.revision - 1, next)).toBe(false);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(await raw.read(previous.runId)).toEqual(previous);
  expect(await fs.readFile(stateFile)).toEqual(before);
});
