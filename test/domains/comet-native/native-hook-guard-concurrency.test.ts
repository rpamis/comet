import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  inspectNativeHookGuard,
  listActiveNativeHookChanges,
} from '../../../domains/comet-native/native-hook-guard.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import * as ownership from '../../../domains/comet-native/native-runtime-ownership.js';
import * as cancellation from '../../../domains/comet-native/native-sdk-cancellation.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';

let root: string;
const request = { intent: 'write' as const, targets: ['src/main.ts'], toolName: 'Write' };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-hook-concurrency-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function mockChanges(names: string[], complete: (name: string) => boolean = () => true) {
  vi.spyOn(ownership, 'listNativeSdkChangeNames').mockResolvedValue(names);
  vi.spyOn(cancellation, 'isNativeSdkChangeCancellationComplete').mockResolvedValue(false);
  vi.spyOn(cancellation, 'isNativeSdkCancellationComplete').mockImplementation(async ({ run }) =>
    complete(run.runId),
  );
  const result = (name: string): Awaited<ReturnType<typeof ownership.inspectNativeSdkRun>> => ({
    state: createNativePortableState({
      name,
      language: 'en',
      createdAt: '2026-10-17T00:00:00Z',
      nextAction: 'prepare-shape-confirmation',
    }),
    // 此测试隔离并发读取边界；真实取消凭据由 cancellation 生命周期测试覆盖。
    run: { runId: name, status: 'cancelled' } as Awaited<
      ReturnType<typeof ownership.inspectNativeSdkRun>
    >['run'],
    artifactRootRef: 'docs',
    application: null,
  });
  return result;
}

it('bounds cancelled history reads to four and reuses only the current Hook scope', async () => {
  const names = Array.from({ length: 10 }, (_, index) => `cancelled-${index}`);
  const result = mockChanges(names);
  const gates = new Map(names.map((name) => [name, deferred()]));
  let active = 0;
  let peak = 0;
  let completed = 0;
  let gated = true;
  const inspect = vi
    .spyOn(ownership, 'inspectNativeSdkRun')
    .mockImplementation(async (_root, name) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        if (gated) await gates.get(name)!.promise;
        return result(name);
      } finally {
        active -= 1;
        completed += 1;
      }
    });
  const work = runWithHookReadCache(async () => {
    expect(await listActiveNativeHookChanges(root)).toEqual([]);
    return inspectNativeHookGuard(root, request);
  });
  for (const count of [4, 8, 10]) {
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(count));
    expect(active).toBeLessThanOrEqual(4);
    for (const name of names.slice(0, count)) gates.get(name)!.resolve();
  }
  expect(await work).toMatchObject({ allowed: true });
  expect({ active, peak, completed }).toEqual({ active: 0, peak: 4, completed: 10 });
  expect(inspect).toHaveBeenCalledTimes(10);
  gated = false;
  expect(await runWithHookReadCache(() => inspectNativeHookGuard(root, request))).toMatchObject({
    allowed: true,
  });
  expect(inspect).toHaveBeenCalledTimes(20);
});

it('settles every read and denies using the first original-order error rather than the fastest error', async () => {
  const names = ['first', 'second', 'third', 'fourth', 'fifth'];
  const result = mockChanges(names);
  const gates = new Map(names.map((name) => [name, deferred()]));
  let active = 0;
  let completed = 0;
  const inspect = vi
    .spyOn(ownership, 'inspectNativeSdkRun')
    .mockImplementation(async (_root, name) => {
      active += 1;
      try {
        await gates.get(name)!.promise;
        return result(name);
      } finally {
        active -= 1;
        completed += 1;
      }
    });
  let settled = false;
  const work = runWithHookReadCache(() => inspectCometHook(root, request)).finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(4));
  gates.get('second')!.reject(new Error('second corrupt Run'));
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(5));
  for (const name of ['third', 'fourth', 'fifth']) gates.get(name)!.resolve();
  await vi.waitFor(() => expect(completed).toBe(4));
  expect(settled).toBe(false);
  gates.get('first')!.reject(new Error('first corrupt Run'));
  expect(await work).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('first corrupt Run'),
  });
  expect({ active, completed }).toEqual({ active: 0, completed: 5 });
});

it('preserves active ordering and ambiguity when cancelled executions are not stopped', async () => {
  const names = ['one', 'two', 'three'];
  const result = mockChanges(names, (name) => name === 'two');
  const gates = new Map(names.map((name) => [name, deferred()]));
  const inspect = vi
    .spyOn(ownership, 'inspectNativeSdkRun')
    .mockImplementation(async (_root, name) => {
      await gates.get(name)!.promise;
      return result(name);
    });
  const work = runWithHookReadCache(async () => ({
    changes: await listActiveNativeHookChanges(root),
    decision: await inspectNativeHookGuard(root, request),
  }));
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(3));
  for (const name of [...names].reverse()) gates.get(name)!.resolve();
  const observed = await work;
  expect(observed.changes.map(({ name }) => name)).toEqual(['one', 'three']);
  expect(observed.decision).toMatchObject({ allowed: false });
});

it('excludes proven cancelled history before loading workflow definitions or portable projections', async () => {
  const names = Array.from({ length: 10 }, (_, index) => `cancelled-${index}`);
  mockChanges(names);
  const complete = vi
    .mocked(cancellation.isNativeSdkChangeCancellationComplete)
    .mockResolvedValue(true);
  const full = vi
    .spyOn(ownership, 'inspectNativeSdkRun')
    .mockRejectedValue(new Error('must not load historical projection'));
  expect(await runWithHookReadCache(() => inspectNativeHookGuard(root, request))).toMatchObject({
    allowed: true,
  });
  expect(complete).toHaveBeenCalledTimes(10);
  expect(full).not.toHaveBeenCalled();
  complete.mockRejectedValueOnce(new Error('corrupt authoritative Run'));
  expect(await runWithHookReadCache(() => inspectCometHook(root, request))).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('corrupt authoritative Run'),
  });
  expect(complete).toHaveBeenCalledTimes(20);
  expect(full).not.toHaveBeenCalled();
});
