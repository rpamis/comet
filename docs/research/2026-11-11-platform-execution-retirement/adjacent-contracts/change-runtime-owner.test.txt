import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import * as protectedFiles from '../../../domains/workflow-contract/protected-project-path.js';
import * as runtime from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  listSdkChangeNames,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-read-scope-'));
  await fs.mkdir(path.join(root, '.git'));
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: 'first',
    format: 'sdk',
    application: 'native',
    runId: 'first',
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('shares Runtime discovery only inside one read request and rechecks changed fences', async () => {
  const discovery = vi.spyOn(runtime, 'readWorkspaceRuntimeRoots');
  await runWithHookReadCache(async () => {
    expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual(['first']);
    expect(await readChangeRuntimeOwner(root, 'native', 'first', { readOnly: true })).toMatchObject(
      { change: 'first' },
    );
    expect(discovery).toHaveBeenCalledTimes(1);
  });
  const fence = path.join(root, '.comet/runtime');
  const original = await fs.readFile(fence);
  await fs.writeFile(fence, '{invalid');
  await expect(
    runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).rejects.toThrow();
  expect(discovery).toHaveBeenCalledTimes(2);
  await fs.writeFile(fence, original);
  expect(
    await runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).toEqual(['first']);
  expect(discovery).toHaveBeenCalledTimes(3);
});

it('does not reuse read-only fence discovery for a mutation in the same scope', async () => {
  await runWithHookReadCache(async () => {
    await listSdkChangeNames(root, 'native', { readOnly: true });
    await fs.writeFile(path.join(root, '.comet/runtime'), '{invalid');
    await expect(readChangeRuntimeOwner(root, 'native', 'first')).rejects.toThrow();
  });
});

it('reads owner contents again in the next request and rejects tampering', async () => {
  expect(
    await runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).toEqual(['first']);
  await fs.writeFile(
    path.join(runtime.resolveWorkspaceRuntimeRootSync(root), 'change-owners/native/first.json'),
    '{}',
  );
  await expect(
    runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).rejects.toThrow('Invalid change runtime owner');
});

it('bounds owner validation at eight and settles all reads before returning an error', async () => {
  for (let i = 0; i < 10; i++) {
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: `history-${i}`,
      format: 'sdk',
      application: 'native',
      runId: `history-${i}`,
    });
  }
  const original = protectedFiles.readProtectedProjectFile;
  let active = 0;
  let peak = 0;
  let completed = 0;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    if (!args[1].startsWith('change-owners/')) return original(...args);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (args[1].endsWith('/first.json')) throw new Error('invalid first owner');
      return await original(...args);
    } finally {
      active--;
      completed++;
    }
  });
  await expect(
    runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).rejects.toThrow('invalid first owner');
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect(completed).toBe(11);
  expect(active).toBe(0);
});
