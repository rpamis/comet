import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeNativeCheck } from '../../../domains/comet-native/native-check-executor.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-registration-'));
  roots.push(root);
  return { projectRoot: root, runtimeDir: path.join(root, 'runtime'), operationId: 'registration' };
}

describe('Native check process registration', () => {
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

  it('waits for process termination when the log stream cannot be opened', async () => {
    const options = await setup();
    const directory = path.join(options.runtimeDir, 'logs', 'checks');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'registration-slow.log'), 'existing log');
    let pid = 0;
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
        onSpawn: async (child) => {
          pid = child.pid;
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
