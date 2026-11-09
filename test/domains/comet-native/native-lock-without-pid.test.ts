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
