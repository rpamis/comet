import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as identity from '../../../platform/process/process-identity.js';
import {
  createNativeSdkCheckExecution,
  inspectNativeSdkCheckExecutions,
  requestNativeSdkCheckStop,
} from '../../../domains/comet-native/native-sdk-check-execution.js';
import { executeNativeCheck } from '../../../domains/comet-native/native-check-executor.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

let root: string;
beforeEach(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'native-pid-free-check-'));
  root = path.join(temporary, 'project');
  await fs.mkdir(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'data'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(path.dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function original() {
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
  const run = {
    runId: 'check-run',
    workflow: { id: 'comet-native', version: '1', hash: 'a'.repeat(64) },
    actions: [action],
  } as WorkflowRun;
  return { run, action };
}

it('cancels the current managed check through its stop request without persisting or probing PID', async () => {
  const { run, action } = original();
  const probe = vi.spyOn(identity, 'readProcessIdentity');
  const inspect = vi.spyOn(identity, 'inspectProcessLiveness');
  const registration = await createNativeSdkCheckExecution({
    projectRoot: root,
    run,
    action,
    candidateId: 'candidate',
    plansHash: 'plans',
  });
  try {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const executing = executeNativeCheck({
      projectRoot: root,
      runtimeDir: path.join(root, 'logs'),
      operationId: 'original',
      signal: registration.signal,
      plan: {
        id: 'long',
        name: 'long command',
        executable: process.execPath,
        argv: ['-e', 'setInterval(() => process.stdout.write("tick"), 30)'],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: false,
      },
      onSpawn: async ({ signal, ...instance }) => {
        await registration.register('long', instance, signal);
        started();
      },
      onTerminated: (instance, confirmed) => registration.recordTermination(instance, confirmed),
    });
    await ready;
    await requestNativeSdkCheckStop({ projectRoot: root, run, action });
    const result = await executing;
    expect(result.status).toBe('interrupted');
    expect(result.durationMs).toBeLessThan(8000);
    expect(JSON.stringify(registration.execution)).not.toMatch(
      /"(?:pid|ownerPid|identity|ownerIdentity)"/u,
    );
    expect(probe).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  } finally {
    await registration.release();
  }
});

it('accepts the original legacy stop receipt without querying its historical PID', async () => {
  const { run, action } = original();
  const execution = {
    schema: 'comet.native.sdk-check-execution.v1',
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    candidateId: 'candidate',
    plansHash: 'plans',
    owner: { pid: 2147483647, identity: 'old-owner' },
    child: {
      pid: 2147483646,
      identity: 'old-child',
      instanceId: 'old-instance',
      ownerPid: 2147483647,
    },
    checkId: 'one',
    phase: 'completed',
    terminationUnconfirmed: false,
    checks: [],
    outcome: { status: 'succeeded', output: {} },
  };
  const dir = path.join(
    resolveWorkspaceRuntimeRootSync(root),
    'native/sdk-checks',
    hashRuntimeValue(run.runId),
    'executions',
  );
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, hashRuntimeValue(action.id) + '.json');
  await fs.writeFile(file, JSON.stringify(execution));
  await fs.writeFile(
    file + '.termination.json',
    JSON.stringify({
      schema: 'comet.native.sdk-check-termination.v1',
      confirmed: true,
      source: 'process-tree',
      actionBinding: hashRuntimeValue([
        run.runId,
        action.id,
        action.attempt,
        action.inputHash,
        action.claim!.token,
      ]),
      childBinding: hashRuntimeValue({ child: execution.child, checkId: execution.checkId }),
    }),
  );
  const probe = vi.spyOn(identity, 'inspectProcessLiveness');
  const [inspected] = await inspectNativeSdkCheckExecutions({
    projectRoot: root,
    run,
    includeSettled: true,
  });
  expect(inspected).toMatchObject({ phase: 'completed', quiescent: true });
  expect(inspected.execution?.outcome?.status).toBe('succeeded');
  expect(probe).not.toHaveBeenCalled();
});
