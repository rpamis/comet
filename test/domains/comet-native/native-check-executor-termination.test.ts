import { EventEmitter } from 'node:events';
import { promises as fs, type WriteStream } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as ownedCommand from '../../../platform/process/owned-command.js';
import * as processIdentity from '../../../platform/process/process-identity.js';
import * as termination from '../../../platform/process/terminate-process-tree.js';
import {
  executeNativeCheck,
  NativeCheckTerminationUnconfirmedError,
} from '../../../domains/comet-native/native-check-executor.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root: string;
let child: ChildProcess & { stdout: PassThrough; stderr: PassThrough };
let confirmed: boolean;
let closes: boolean;
let result: { type: string; exitCode?: number } | null;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-executor-termination-'));
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  confirmed = true;
  closes = true;
  result = { type: 'completed', exitCode: 0 };
  child = Object.assign(new EventEmitter(), {
    pid: 123456,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as typeof child;
  vi.spyOn(ownedCommand, 'spawnOwnedCommand').mockImplementation((_command, _argv, options) => {
    expect(options.confirmTermination).toBe(true);
    return {
      child: child as ReturnType<typeof ownedCommand.spawnOwnedCommand>['child'],
      instanceId: 'original-instance',
      start: () => {
        if (result) queueMicrotask(() => child.emit('message', result));
      },
    };
  });
  vi.spyOn(processIdentity, 'readProcessIdentity').mockResolvedValue('original-identity');
  vi.spyOn(processIdentity, 'inspectProcessTreeLiveness').mockResolvedValue('dead');
  vi.spyOn(termination, 'terminateProcessTreeConfirmed').mockImplementation(async () => {
    if (closes)
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit('close', null, 'SIGKILL');
      });
    return confirmed;
  });
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
  child.stdout.destroy();
  child.stderr.destroy();
  await fs.rm(root, { recursive: true, force: true });
});

function execute(onTerminated?: Parameters<typeof executeNativeCheck>[0]['onTerminated']) {
  return executeNativeCheck({
    projectRoot: root,
    runtimeDir: root,
    operationId: 'original-operation',
    plan: {
      id: 'check',
      name: 'check',
      executable: process.execPath,
      argv: [],
      cwdRef: '.',
      timeoutMs: 50,
      repeatable: false,
    },
    onTerminated,
  });
}

it.each([0, 2])(
  'preserves normal Windows check result %s after confirmed tree termination',
  async (exitCode) => {
    result = { type: 'completed', exitCode };
    const record = vi.fn().mockResolvedValue(undefined);
    await expect(execute(record)).resolves.toMatchObject({
      status: exitCode === 0 ? 'passed' : 'failed',
      exitCode,
    });
    expect(record).toHaveBeenCalledWith(
      {
        instanceId: 'original-instance',
      },
      true,
    );
  },
);

it('reports a timeout only after confirmed tree termination', async () => {
  result = null;
  await expect(execute()).resolves.toMatchObject({ status: 'interrupted', timedOut: true });
});

it('stops immediately on a supervisor error instead of converting it into a command timeout', async () => {
  vi.mocked(ownedCommand.spawnOwnedCommand).mockImplementation(() => ({
    child: child as ReturnType<typeof ownedCommand.spawnOwnedCommand>['child'],
    instanceId: 'original-instance',
    ready: Promise.resolve(),
    start: () => {
      queueMicrotask(() => child.emit('error', new Error('IPC write failed')));
    },
  }));
  await expect(execute()).resolves.toMatchObject({ status: 'interrupted', timedOut: false });
});

it('waits for supervisor readiness before releasing the registered command', async () => {
  let ready!: () => void;
  const readiness = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let spawned!: () => void;
  const observed = new Promise<void>((resolve) => {
    spawned = resolve;
  });
  const start = vi.fn(() => queueMicrotask(() => child.emit('message', result)));
  vi.mocked(ownedCommand.spawnOwnedCommand).mockImplementation(() => {
    spawned();
    return {
      child: child as ReturnType<typeof ownedCommand.spawnOwnedCommand>['child'],
      instanceId: 'original-instance',
      ready: readiness,
      start,
    };
  });
  const operation = execute();
  await observed;
  await new Promise((resolve) => setImmediate(resolve));
  expect(start).not.toHaveBeenCalled();
  ready();
  await expect(operation).resolves.toMatchObject({ status: 'passed', timedOut: false });
});

it('cancels pending supervisor readiness immediately when its supervisor errors', async () => {
  vi.mocked(ownedCommand.spawnOwnedCommand).mockImplementation(() => {
    setImmediate(() => child.emit('error', new Error('IPC failed during registration')));
    return {
      child: child as ReturnType<typeof ownedCommand.spawnOwnedCommand>['child'],
      instanceId: 'original-instance',
      ready: new Promise(() => {}),
      start: vi.fn(),
    };
  });
  await expect(execute()).rejects.toThrow('IPC failed during registration');
});

it('never releases a late-ready command after its registration deadline has cancelled it', async () => {
  let ready!: () => void;
  const readiness = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const start = vi.fn();
  vi.mocked(ownedCommand.spawnOwnedCommand).mockImplementation(() => ({
    child: child as ReturnType<typeof ownedCommand.spawnOwnedCommand>['child'],
    instanceId: 'original-instance',
    ready: readiness,
    start,
  }));
  await expect(execute()).rejects.toThrow('检查进程登记超过执行时限');
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  expect(start).not.toHaveBeenCalled();
});

it.each(['completed', 'timeout'] as const)(
  'rejects Windows %s when only the leader was stopped',
  async (event) => {
    result = event === 'completed' ? result : null;
    confirmed = false;
    await expect(execute()).rejects.toBeInstanceOf(NativeCheckTerminationUnconfirmedError);
  },
);

it.each(['completed', 'timeout'] as const)(
  'preserves command completion and timeout facts when %s cleanup is unconfirmed',
  async (event) => {
    result = event === 'completed' ? result : null;
    confirmed = false;
    const failure = await execute().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NativeCheckTerminationUnconfirmedError);
    expect((failure as NativeCheckTerminationUnconfirmedError).diagnostics).toMatchObject({
      timeoutMs: 50,
      timedOut: event === 'timeout',
      resultReceived: event === 'completed',
      commandExitCode: event === 'completed' ? 0 : null,
    });
    expect((failure as Error).message).toContain('计划时限=50ms');
  },
);

it('does not hang when failed Windows tree cleanup never emits close', async () => {
  confirmed = false;
  closes = false;
  await expect(execute()).rejects.toBeInstanceOf(NativeCheckTerminationUnconfirmedError);
});

it('settles an interrupted check when confirmed Windows cleanup never closes inherited pipes', async () => {
  result = null;
  closes = false;
  const record = vi.fn().mockResolvedValue(undefined);
  await expect(execute(record)).resolves.toMatchObject({ status: 'interrupted', timedOut: true });
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({ instanceId: 'original-instance' }),
    true,
  );
}, 3000);

it('rejects a durable termination receipt failure instead of leaving the result pending', async () => {
  await expect(
    execute(async () => {
      throw new Error('receipt write EIO');
    }),
  ).rejects.toThrow('receipt write EIO');
});

it('does not turn a completed check into a timeout while confirmed cleanup is finishing', async () => {
  vi.mocked(termination.terminateProcessTreeConfirmed).mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.stdout.end();
    child.stderr.end();
    child.emit('close', null, 'SIGKILL');
    return true;
  });
  await expect(execute()).resolves.toMatchObject({ status: 'passed', timedOut: false });
});

it('does not let a log write error bypass pending Windows tree confirmation after close', async () => {
  let log: WriteStream | undefined;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const create = handle.createWriteStream.bind(handle);
    vi.spyOn(handle, 'createWriteStream').mockImplementation((options) => {
      log = create(options);
      return log;
    });
    return handle;
  });
  vi.mocked(termination.terminateProcessTreeConfirmed).mockImplementation(async () => {
    child.stdout.end();
    child.stderr.end();
    child.emit('close', null, 'SIGKILL');
    log!.emit('error', new Error('log EIO after close'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    return false;
  });
  await expect(execute()).rejects.toBeInstanceOf(NativeCheckTerminationUnconfirmedError);
});
