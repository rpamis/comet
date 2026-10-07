import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';

import { executeNativeCheck } from '../../../domains/comet-native/native-check-executor.js';
import {
  createNativeSdkCheckExecution,
  inspectNativeSdkCheckExecutions,
  terminateNativeSdkCheckExecutions,
} from '../../../domains/comet-native/native-sdk-check-execution.js';
import { recoverNativeSdkChecks } from '../../../domains/comet-native/native-sdk-checks.js';
import { createRuntime, createMemoryRuntimeStore } from '../../../domains/engine/runtime.js';
import {
  inspectProcessTreeLiveness,
  readProcessIdentity,
} from '../../../platform/process/process-identity.js';
import { spawnOwnedCommand } from '../../../platform/process/owned-command.js';
import { waitForCondition, waitForProcessExit } from '../../helpers/native-portable-process.js';

const roots: string[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await waitForProcessExit(child).catch(() => {});
  }
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-owner-'));
  roots.push(value);
  return value;
}
const exists = async (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function claimedRun() {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore(),
    workflows: [
      {
        id: 'check-owner',
        version: '1',
        entry: 'verify.checks',
        steps: {
          'verify.checks': { type: 'call_tool', ref: 'native-required-checks', retry: 'reconcile' },
        },
      },
    ],
  });
  let run = await runtime.start({
    runId: 'owner-test',
    workflow: { id: 'check-owner', version: '1' },
    input: {},
  });
  const pending = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: 'comet-native-checks',
    claimToken: 'owner-claim',
  });
  return { runtime, run, action: run.actions[0] };
}

describe('Native check owner recovery', () => {
  it.each(['SIGTERM', 'SIGKILL'] as const)(
    'stops checks and their descendants when their actual owner receives %s',
    async (signal) => {
      const directory = await root();
      const started = path.join(directory, 'started');
      const marker = path.join(directory, 'late');
      const bundle = path.join(directory, 'owner.cjs');
      const source = path.resolve('domains/comet-native/native-check-executor.ts');
      const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 800); setTimeout(() => process.exit(0), 1300)`;
      const command = `require('node:fs').writeFileSync(${JSON.stringify(started)}, String(process.pid)); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setTimeout(() => process.exit(0), 1600)`;
      await build({
        stdin: {
          contents: `const { executeNativeCheck } = require(${JSON.stringify(source)}); executeNativeCheck({projectRoot:${JSON.stringify(directory)},runtimeDir:${JSON.stringify(path.join(directory, 'runtime'))},operationId:'owner',plan:${JSON.stringify({ id: 'check', name: 'owner', executable: process.execPath, argv: ['-e', command], cwdRef: '.', timeoutMs: 500, repeatable: false })}}).catch(() => process.exitCode = 1);`,
          resolveDir: process.cwd(),
        },
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      });
      const owner = spawn(process.execPath, [bundle], { stdio: 'ignore' });
      processes.push(owner);
      await waitForCondition(() => exists(started), 'check did not start', 5000);
      owner.kill(signal);
      await waitForProcessExit(owner);
      await sleep(1050);
      expect(await exists(marker)).toBe(false);
    },
  );

  it('keeps its deadline when the owner event loop cannot run its timeout timer', async () => {
    const directory = await root();
    const marker = path.join(directory, 'timer-late');
    const started = path.join(directory, 'timer-started');
    const bundle = path.join(directory, 'blocked-owner.cjs');
    const command = `require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 800); setTimeout(() => process.exit(0), 1600)`;
    await build({
      stdin: {
        contents: `const { executeNativeCheck } = require(${JSON.stringify(path.resolve('domains/comet-native/native-check-executor.ts'))}); executeNativeCheck({projectRoot:${JSON.stringify(directory)},runtimeDir:${JSON.stringify(path.join(directory, 'runtime'))},operationId:'blocked-owner',plan:${JSON.stringify({ id: 'check', name: 'blocked owner', executable: process.execPath, argv: ['-e', command], cwdRef: '.', timeoutMs: 500, repeatable: false })}}).catch(() => {}); setTimeout(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200),150);`,
        resolveDir: process.cwd(),
      },
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    });
    const owner = spawn(process.execPath, [bundle], { stdio: 'ignore' });
    processes.push(owner);
    await waitForCondition(() => exists(started), 'check did not start', 5000);
    await sleep(1000);
    expect(await exists(marker)).toBe(false);
    await waitForProcessExit(owner);
  });

  it('does not launch the command before registration and bounds a stuck registration', async () => {
    const directory = await root();
    const marker = path.join(directory, 'unregistered-side-effect');
    const started = Date.now();
    await expect(
      executeNativeCheck({
        projectRoot: directory,
        runtimeDir: path.join(directory, 'runtime'),
        operationId: 'register',
        plan: {
          id: 'check',
          name: 'check',
          executable: process.execPath,
          argv: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
          cwdRef: '.',
          timeoutMs: 150,
          repeatable: false,
        },
        onSpawn: async () => new Promise(() => {}),
      }),
    ).rejects.toThrow(/登记.*时限/u);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await exists(marker)).toBe(false);
  });

  it('kills background descendants before reporting their parent command complete', async () => {
    const directory = await root();
    const marker = path.join(directory, 'background');
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'), 500)`;
    const result = await executeNativeCheck({
      projectRoot: directory,
      runtimeDir: path.join(directory, 'runtime'),
      operationId: 'background',
      plan: {
        id: 'check',
        name: 'check',
        executable: process.execPath,
        argv: [
          '-e',
          `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }).unref()`,
        ],
        cwdRef: '.',
        timeoutMs: 2000,
        repeatable: false,
      },
    });
    expect(result.status).toBe('passed');
    await sleep(650);
    expect(await exists(marker)).toBe(false);
  });

  it('keeps a surviving group unknown after its supervisor is killed and does not replay it', async () => {
    const directory = await root();
    const { runtime, run, action } = await claimedRun();
    const registration = await createNativeSdkCheckExecution({
      projectRoot: directory,
      run,
      action,
      candidateId: 'candidate',
      plansHash: 'plans',
    });
    const started = path.join(directory, 'started');
    const supervisor = spawnOwnedCommand(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(started)}, 'yes'); setTimeout(() => process.exit(0), 1500)`,
      ],
      { cwd: directory, timeoutMs: 3000 },
    );
    processes.push(supervisor.child);
    await registration.register('check', supervisor.child.pid!);
    supervisor.start();
    await waitForCondition(() => exists(started), 'check did not start');
    supervisor.child.kill('SIGKILL');
    await waitForProcessExit(supervisor.child);
    const status = (await inspectNativeSdkCheckExecutions({ projectRoot: directory, run }))[0];
    expect(status.process).toBe('unknown');
    expect(status.quiescent).toBe(false);
    await expect(
      createNativeSdkCheckExecution({
        projectRoot: directory,
        run,
        action,
        candidateId: 'candidate',
        plansHash: 'plans',
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    // 进程仍活着时不得依赖原监管器 PID 消失释放工作区。
    expect((await runtime.inspect(run.runId)).actions[0].attempt).toBe(1);
    try {
      process.kill(-supervisor.child.pid!, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
    await waitForCondition(
      async () =>
        (await inspectProcessTreeLiveness(
          supervisor.child.pid!,
          registration.execution.child!.identity,
        )) === 'dead',
      'process group did not stop',
    );
  });

  it('records owner death as unknown while preserving claim and refuses overwrite across attempts', async () => {
    const directory = await root();
    const { runtime, run, action } = await claimedRun();
    const registration = await createNativeSdkCheckExecution({
      projectRoot: directory,
      run,
      action,
      candidateId: 'candidate',
      plansHash: 'plans',
    });
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
    });
    processes.push(owner);
    registration.execution.owner = {
      pid: owner.pid!,
      identity: (await readProcessIdentity(owner.pid!)) ?? undefined,
    };
    await registration.save();
    owner.kill('SIGKILL');
    await waitForProcessExit(owner);
    const recovered = await recoverNativeSdkChecks(directory, run, runtime);
    expect(recovered.actions[0]).toMatchObject({
      status: 'unknown',
      claim: action.claim,
      attempt: 1,
    });
    const again = await recoverNativeSdkChecks(directory, recovered, runtime);
    expect(again.revision).toBe(recovered.revision);
    await expect(
      runtime.retry({ runId: run.runId, actionId: action.id, attempt: 1 }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    const retried = await runtime.retry({
      runId: run.runId,
      actionId: action.id,
      attempt: 1,
      reconciliation: { resolution: 'not-executed', evidence: 'unsupported assertion' },
    });
    const next = retried.actions[0];
    const claimed = await runtime.claim({
      runId: run.runId,
      actionId: next.id,
      attempt: next.attempt,
      inputHash: next.inputHash,
      executorId: 'comet-native-checks',
      claimToken: 'another-claim',
    });
    await expect(
      createNativeSdkCheckExecution({
        projectRoot: directory,
        run: claimed,
        action: claimed.actions[0],
        candidateId: 'candidate',
        plansHash: 'plans',
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('persists cancellation before a delayed executor has registered so it cannot launch', async () => {
    const directory = await root();
    const { run, action } = await claimedRun();
    expect(
      (await terminateNativeSdkCheckExecutions({ projectRoot: directory, run }))[0].phase,
    ).toBe('missing');
    const registration = await createNativeSdkCheckExecution({
      projectRoot: directory,
      run,
      action,
      candidateId: 'candidate',
      plansHash: 'plans',
    });
    await expect(registration.assertNotStopped()).rejects.toThrow(/取消/u);
    await expect(registration.register('delayed', process.pid)).rejects.toThrow(/取消/u);
    expect(registration.execution.child).toBeUndefined();
  });

  it('does not treat a reused process PID as the original child instance', async () => {
    const directory = await root();
    const { run, action } = await claimedRun();
    const registration = await createNativeSdkCheckExecution({
      projectRoot: directory,
      run,
      action,
      candidateId: 'candidate',
      plansHash: 'plans',
    });
    registration.execution.child = { pid: process.pid, identity: 'linux:prior-boot:1' };
    registration.execution.phase = 'completed';
    await registration.save();
    const [status] = await inspectNativeSdkCheckExecutions({ projectRoot: directory, run });
    expect(status.process).toBe('dead');
    expect(status.quiescent).toBe(true);
  });
});
