import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTreeConfirmed } from '../../../platform/process/terminate-process-tree.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', platform);
});

describe('Windows termination result events', () => {
  it('accepts successful taskkill exit without waiting for its delayed close event', async () => {
    const target = {
      pid: 123456,
      exitCode: null as number | null,
      signalCode: null,
      kill: vi.fn(),
    };
    const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      void Promise.resolve().then(() => {
        target.exitCode = 1;
        killer.emit('exit', 0, null);
      });
      return killer as unknown as ChildProcess;
    });
    const operation = terminateProcessTreeConfirmed(target as unknown as ChildProcess);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await operation).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(killer.kill).not.toHaveBeenCalled();
  });

  it.each([1, null])(
    'does not confirm taskkill exit %s just because the target leader exited',
    async (code) => {
      const target = {
        pid: 123456,
        exitCode: null as number | null,
        signalCode: null,
        kill: vi.fn(),
      };
      const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
      vi.mocked(spawn).mockImplementation(() => {
        void Promise.resolve().then(() => {
          target.exitCode = 1;
          killer.emit('exit', code, code === null ? 'SIGTERM' : null);
        });
        return killer as unknown as ChildProcess;
      });
      const operation = terminateProcessTreeConfirmed(target as unknown as ChildProcess);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await operation).toBe(false);
      expect(spawn).toHaveBeenCalledTimes(1);
    },
  );
});
