import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNativeCheck } from '../../../domains/comet-native/native-check-executor.js';
import * as ownedCommand from '../../../platform/process/owned-command.js';
import * as processIdentity from '../../../platform/process/process-identity.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-registration-'));
  roots.push(root);
  return { projectRoot: root, runtimeDir: path.join(root, 'runtime'), operationId: 'registration' };
}

describe('Native check process registration', () => {
  it('does not invoke registration after cancellation during identity lookup', async () => {
    let releaseIdentity!: () => void;
    let identityStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      identityStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    vi.spyOn(processIdentity, 'readProcessIdentity').mockImplementation(async () => {
      identityStarted();
      await released;
      return null;
    });
    const onSpawn = vi.fn(async () => {});
    const pending = executeNativeCheck({
      ...(await setup()),
      plan: {
        id: 'cancelled',
        name: 'Cancelled registration',
        executable: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwdRef: '.',
        timeoutMs: 1000,
        repeatable: true,
      },
      onSpawn,
    });
    try {
      await started;
      await expect(pending).rejects.toThrow('检查进程登记超过执行时限');
    } finally {
      releaseIdentity();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onSpawn).not.toHaveBeenCalled();
  });
  it('waits for registration even if the check has already exited', async () => {
    let registered = false;
    const result = await executeNativeCheck({
      ...(await setup()),
      plan: {
        id: 'fast',
        name: 'Fast check',
        executable: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: true,
      },
      onSpawn: async ({ pid }) => {
        expect(pid).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 200));
        registered = true;
      },
    });
    expect(registered).toBe(true);
    expect(result.status).toBe('passed');
  });

  it('terminates the check and preserves a registration failure before returning', async () => {
    let pid = 0;
    await expect(
      executeNativeCheck({
        ...(await setup()),
        plan: {
          id: 'slow',
          name: 'Slow check',
          executable: process.execPath,
          argv: ['-e', 'setInterval(() => {}, 1000)'],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: true,
        },
        onSpawn: async (child) => {
          pid = child.pid;
          throw new Error('registration failed');
        },
      }),
    ).rejects.toThrow('registration failed');
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('rejects an unavailable log before spawning or registering the check', async () => {
    const options = await setup();
    const directory = path.join(options.runtimeDir, 'logs', 'checks');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'registration-slow.log'), 'existing log');
    const spawn = vi.spyOn(ownedCommand, 'spawnOwnedCommand');
    const onSpawn = vi.fn(async () => {});
    await expect(
      executeNativeCheck({
        ...options,
        plan: {
          id: 'slow',
          name: 'Slow check',
          executable: process.execPath,
          argv: ['-e', 'setInterval(() => {}, 1000)'],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: true,
        },
        onSpawn,
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(spawn).not.toHaveBeenCalled();
    expect(onSpawn).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(directory, 'registration-slow.log'), 'utf8')).toBe(
      'existing log',
    );
  });
});
