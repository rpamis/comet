import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as processIdentity from '../../../platform/process/process-identity.js';
import {
  type RuntimeAction,
  type WorkflowRun,
  createRuntime,
  createMemoryRuntimeStore,
} from '../../../domains/engine/runtime.js';
import {
  createNativeSdkCheckExecution,
  acknowledgeNativeSdkCheckStopped,
  terminateNativeSdkCheckExecutions,
  inspectNativeSdkCheckExecutions,
} from '../../../domains/comet-native/native-sdk-check-execution.js';

import { inspectNativeSdkCancellation } from '../../../domains/comet-native/native-sdk-cancellation.js';
import { recoverNativeSdkChecks } from '../../../domains/comet-native/native-sdk-checks.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-check-termination-'));
  vi.spyOn(processIdentity, 'readProcessIdentity').mockResolvedValue('original-identity');
  vi.spyOn(processIdentity, 'inspectProcessLiveness').mockResolvedValue('dead');
  vi.spyOn(processIdentity, 'inspectProcessTreeLiveness').mockResolvedValue('dead');
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function registration(phase: 'running' | 'interrupted' | 'completed', modern = false) {
  const action = {
    id: 'check-action',
    runId: 'check-run',
    attempt: 1,
    inputHash: 'original-input',
    type: 'call_tool',
    ref: 'native-required-checks',
    status: 'unknown',
    claim: { token: 'original-claim', executorId: 'comet-native-checks' },
  } as RuntimeAction;
  const run = { runId: 'check-run', actions: [action] } as WorkflowRun;
  const registered = await createNativeSdkCheckExecution({
    projectRoot: root,
    run,
    action,
    candidateId: 'original-candidate',
    plansHash: 'original-plans',
  });
  await registered.register('check-1', modern ? instance : 123456);
  registered.execution.phase = phase;
  await registered.save();
  return { run, action, registered };
}

it.each(['running', 'interrupted', 'completed'] as const)(
  'keeps a Windows %s check blocked when both owner and supervisor exited without tree evidence',
  async (phase) => {
    const { run } = await registration(phase);
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    const [inspection] = await inspectNativeSdkCheckExecutions({ projectRoot: root, run });
    expect(inspection).toMatchObject({
      owner: 'dead',
      process: 'dead',
      quiescent: false,
      recoveryRequired: true,
    });
  },
);

const instance = {
  pid: 123456,
  identity: 'original-identity',
  instanceId: 'original-instance',
  ownerPid: process.pid,
};
function windows() {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
}

it('accepts a cold completed Windows result only with its own confirmed process receipt', async () => {
  const { run, registered } = await registration('running', true);
  await registered.recordTermination(instance, true);
  registered.execution.phase = 'completed';
  await registered.save();
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
});

it('does not let an unconfirmed cleanup overwrite a confirmed receipt', async () => {
  const { run, registered } = await registration('completed', true);
  await registered.recordTermination(instance, true);
  await registered.recordTermination(instance, false);
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
});

it.each(['identity', 'instanceId', 'ownerPid'] as const)(
  'rejects a termination receipt with another %s',
  async (field) => {
    const { run, registered } = await registration('completed', true);
    await expect(
      registered.recordTermination(
        { ...instance, [field]: field === 'ownerPid' ? 98765 : 'other' },
        true,
      ),
    ).rejects.toThrow('原进程实例');
    windows();
    expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
      false,
    );
  },
);

it('does not transfer the previous check receipt to a newly registered check with the same pid', async () => {
  const { run, registered } = await registration('completed', true);
  await registered.recordTermination(instance, true);
  await registered.register('check-2', { ...instance, instanceId: 'next-instance' });
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    false,
  );
});

it('keeps legacy POSIX process-group confirmation compatible', async () => {
  const { run } = await registration('completed');
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
});

it('allows a legacy Windows registration only after explicitly bound manual stop evidence', async () => {
  const { run, action, registered } = await registration('interrupted');
  const stoppedAction = {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    evidence: 'The original owner and all descendants were stopped and checked.',
  };
  windows();
  await expect(
    acknowledgeNativeSdkCheckStopped({
      projectRoot: root,
      run,
      action,
      stoppedAction: { ...stoppedAction, claimToken: 'another-claim' },
    }),
  ).rejects.toThrow('原领取身份');
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    false,
  );
  await acknowledgeNativeSdkCheckStopped({ projectRoot: root, run, action, stoppedAction });
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
  registered.execution.checkId = 'different-execution';
  await registered.save();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    false,
  );
});

it('rejects manual evidence while the original owner could still start another check', async () => {
  const { run, action } = await registration('interrupted');
  vi.mocked(processIdentity.inspectProcessLiveness).mockResolvedValue('alive');
  windows();
  await expect(
    acknowledgeNativeSdkCheckStopped({
      projectRoot: root,
      run,
      action,
      stoppedAction: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        evidence: 'All descendants checked.',
      },
    }),
  ).rejects.toThrow('尚未确认退出');
});

it.each([false, true])('persists only confirmed cancellation cleanup (%s)', async (confirmed) => {
  const { run } = await registration('interrupted', true);
  vi.mocked(processIdentity.inspectProcessTreeLiveness).mockResolvedValue('alive');
  vi.spyOn(processIdentity, 'terminateRegisteredProcessTree').mockImplementation(async () => {
    vi.mocked(processIdentity.inspectProcessTreeLiveness).mockResolvedValue('dead');
    return confirmed;
  });
  windows();
  const [inspection] = await terminateNativeSdkCheckExecutions({ projectRoot: root, run });
  expect(inspection.quiescent).toBe(confirmed);
});

it('releases a cancelled Windows check only after the original action and process evidence agree', async () => {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'stop-check',
        version: '1',
        entry: 'check',
        steps: { check: { type: 'call_tool', ref: 'native-required-checks' } },
      },
    ],
  });
  const started = await runtime.start({
    runId: 'stop-check',
    workflow: { id: 'stop-check', version: '1' },
    input: null,
  });
  const pending = started.actions[0];
  const claimed = await runtime.claim({
    runId: started.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: 'comet-native-checks',
    claimToken: 'original-check-claim',
  });
  const action = claimed.actions[0];
  const registered = await createNativeSdkCheckExecution({
    projectRoot: root,
    run: claimed,
    action,
    candidateId: 'candidate',
    plansHash: 'plans',
  });
  await registered.register('check', instance);
  const cancelled = await runtime.cancel({ runId: claimed.runId, reason: 'Stop this execution' });
  windows();
  expect(await inspectNativeSdkCancellation({ projectRoot: root, run: cancelled })).toMatchObject({
    status: 'cancelling',
    quiescent: false,
  });
  const recovered = await recoverNativeSdkChecks(root, cancelled, runtime, {
    reconcileInterrupted: true,
    stoppedActions: [
      {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        evidence: 'The original execution and all descendants have stopped.',
      },
    ],
  });
  expect(await inspectNativeSdkCancellation({ projectRoot: root, run: recovered })).toMatchObject({
    status: 'cancelled',
    quiescent: true,
  });
  expect(recovered.actions[0].outcome).toBeUndefined();
  expect(recovered.actions[0].attempt).toBe(action.attempt);
  expect(recovered.actions[0].claim).toEqual(action.claim);
});

it('persists confirmed Windows cleanup when creation-identity probing was unavailable', async () => {
  const { run, registered } = await registration('running', true);
  const unavailable = { ...instance, identity: undefined };
  await registered.register('unavailable-identity', unavailable);
  await registered.recordTermination(unavailable, true);
  registered.execution.phase = 'completed';
  await registered.save();
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
});

it('keeps legacy no-identity registrations recoverable with explicit stop evidence', async () => {
  vi.mocked(processIdentity.readProcessIdentity).mockResolvedValue(null);
  const { run, action } = await registration('interrupted');
  windows();
  await acknowledgeNativeSdkCheckStopped({
    projectRoot: root,
    run,
    action,
    stoppedAction: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      evidence: 'The original execution and all child tasks were checked and stopped.',
    },
  });
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].quiescent).toBe(
    true,
  );
});

it('does not infer no process from an unconfirmed interruption before child registration', async () => {
  const { run, registered } = await registration('interrupted');
  delete registered.execution.child;
  registered.execution.terminationUnconfirmed = true;
  await registered.save();
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0]).toMatchObject({
    owner: 'dead',
    process: 'unknown',
    quiescent: false,
  });
});

it('keeps the pre-registration crash gap unknown before a child pid can be saved', async () => {
  const { run, registered } = await registration('running');
  delete registered.execution.child;
  registered.execution.phase = 'reserved';
  await registered.save();
  windows();
  expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0]).toMatchObject({
    owner: 'dead',
    process: 'unknown',
    quiescent: false,
  });
});
