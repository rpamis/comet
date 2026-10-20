import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createRuntime,
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  assertClassicSdkCheckReceipt,
  recordClassicSdkCheckReceipt,
  classicSdkCheckRecordRef,
} from '../../../domains/comet-classic/classic-sdk-check-record.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-origin-'));
  roots.push(root);
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'classic-origin',
        version: '1',
        entry: 'check',
        steps: { check: { type: 'call_tool', ref: 'classic-check' } },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'example',
    workflow: { id: 'classic-origin', version: '1' },
    input: { changeDir: 'openspec/changes/example' },
  });
  const action = run.actions[0];
  return {
    root,
    run: await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-check',
      claimToken: 'original-execution',
    }),
  };
}
const result = { status: 'succeeded' as const, output: { exitCode: 0 } };
it('retains the same receipt and recovery record identity across portable restore and approved definition changes', async () => {
  const { root, run } = await fixture();
  await recordClassicSdkCheckReceipt(root, run, run.actions[0], result);
  const next = preserveRuntimeExecutionOrigins(createPortableRunCheckpoint(run).run);
  next.workflow.hash = 'b'.repeat(64);
  expect(classicSdkCheckRecordRef(next, next.actions[0])).toBe(
    classicSdkCheckRecordRef(run, run.actions[0]),
  );
  await expect(
    assertClassicSdkCheckReceipt(root, next, next.actions[0], result),
  ).resolves.toBeUndefined();
  const forged = structuredClone(next);
  forged.actions[0].claim!.token = 'different-execution';
  await expect(
    assertClassicSdkCheckReceipt(root, forged, forged.actions[0], result),
  ).rejects.toThrow('original Runtime execution receipt');
});
it('accepts an exact legacy raw-key receipt and rejects a conflicting alias', async () => {
  const { root, run } = await fixture();
  const action = run.actions[0];
  const id = hashRuntimeValue({
    workflow: run.workflow,
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claim: action.claim,
  });
  const store = createFileRuntimeStore<{
    runId: string;
    revision: number;
    schema: string;
    result: unknown;
    resultHash: string;
  }>({
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'check-receipts/classic'),
  });
  await store.compareAndSwap(id, null, {
    runId: id,
    revision: 1,
    schema: 'comet.classic-sdk-check-receipt.v1',
    result,
    resultHash: hashRuntimeValue(result),
  });
  await expect(assertClassicSdkCheckReceipt(root, run, action, result)).resolves.toBeUndefined();
  await expect(
    recordClassicSdkCheckReceipt(root, run, action, {
      status: 'failed',
      output: { exitCode: 1 },
    }),
  ).rejects.toThrow('original Runtime execution receipt');
  const stable = hashRuntimeValue(
    (await import('../../../domains/engine/runtime.js')).runtimeExecutionBinding(run, action),
  );
  const conflicting = { status: 'failed', output: { exitCode: 1 } };
  await store.compareAndSwap(stable, null, {
    runId: stable,
    revision: 1,
    schema: 'comet.classic-sdk-check-receipt.v1',
    result: conflicting,
    resultHash: hashRuntimeValue(conflicting),
  });
  await expect(assertClassicSdkCheckReceipt(root, run, action, result)).rejects.toThrow(
    'original Runtime execution receipt',
  );
});
