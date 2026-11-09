import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as identity from '../../../platform/process/process-identity.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import {
  acquireNativeLock,
  releaseNativeLock,
  diagnoseNativeLock,
  withNativeLockRecovery,
} from '../../../domains/comet-native/native-lock.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('keeps Native mutation exclusion without binding a PID or probing a thread', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-lock-no-pid-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const probe = vi.spyOn(identity, 'readProcessIdentity');
  const lock = await acquireNativeLock(paths, 'mutation', 'Save actual workflow state');
  try {
    expect(lock.owner).not.toHaveProperty('pid');
    expect(lock.owner).not.toHaveProperty('processIdentity');
    expect((await diagnoseNativeLock(lock.file)).status).toBe('active');
    await expect(acquireNativeLock(paths, 'mutation', 'Another writer')).rejects.toThrow('busy');
  } finally {
    await releaseNativeLock(lock);
  }
  expect((await diagnoseNativeLock(lock.file)).status).toBe('missing');
  expect(probe).not.toHaveBeenCalled();
});

it('keeps ordinary lock acquisition outside a running Native recovery section', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-recovery-no-pid-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  let release!: () => void;
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restoring = withNativeLockRecovery([paths], 'Restore the original Action', async () => {
    ready();
    await held;
  });
  await entered;
  let acquired = false;
  const writing = acquireNativeLock(paths, 'root-move', 'Another operation').then(async (lock) => {
    acquired = true;
    await releaseNativeLock(lock);
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(acquired).toBe(false);
  release();
  await Promise.all([restoring, writing]);
  expect(acquired).toBe(true);
});
