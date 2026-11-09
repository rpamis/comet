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
  it('does not register or start a command after its operation is cancelled', async () => {
    const options = await setup();
    const signal = AbortSignal.abort(new Error('cancelled'));
    const onSpawn = vi.fn(async () => {});
    await expect(
      executeNativeCheck({
        ...options,
        signal,
        plan: {
          id: 'cancelled',
          name: 'Cancelled check',
          executable: process.execPath,
          argv: ['-e', 'setInterval(() => {}, 1000)'],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: false,
        },
        onSpawn,
      }),
    ).rejects.toThrow();
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
      onSpawn: async ({ instanceId }) => {
        expect(instanceId).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 200));
        registered = true;
      },
    });
    expect(registered).toBe(true);
    expect(result.status).toBe('passed');
  });

  it('terminates the check and preserves a registration failure before returning', async () => {
    let instanceId = '';
    const spawn = vi.spyOn(ownedCommand, 'spawnOwnedCommand');
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
          instanceId = child.instanceId;
          throw new Error('registration failed');
        },
      }),
    ).rejects.toThrow('registration failed');
    expect(instanceId).toBeTruthy();
    const child = spawn.mock.results[0].value.child;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
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
