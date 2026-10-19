import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
} from '../../../domains/engine/portable-run-checkpoint.js';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
  type RuntimeStore,
} from '../../../domains/engine/runtime-store.js';
import { defineWorkflow } from '../../../domains/engine/workflow-definition.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const child = {
  id: 'research',
  version: '1',
  entry: 'read',
  steps: { read: { type: 'call_tool' as const, ref: 'read' } },
};
const parent = {
  id: 'report',
  version: '1',
  entry: 'research',
  steps: {
    research: {
      type: 'child_workflow' as const,
      workflow: { id: child.id, version: child.version },
    },
    write: { type: 'call_tool' as const, ref: 'write' },
  },
  transitions: [{ from: 'research', to: 'write' }],
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function storeFor(kind: 'memory' | 'file'): Promise<RuntimeStore<WorkflowRun>> {
  if (kind === 'memory') return createMemoryRuntimeStore<WorkflowRun>();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-recovery-'));
  roots.push(rootDir);
  return createFileRuntimeStore<WorkflowRun>({ rootDir });
}

async function fixture(status: 'running' | 'completed' | 'failed' | 'cancelled' = 'completed') {
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({ store, workflows: [parent, child] });
  await runtime.start({ runId: 'parent', workflow: parent, input: { topic: 'safe recovery' } });
  const parentRun = await runtime.next({ runId: 'parent' });
  const childId = parentRun.children[0].runId;
  const childRun = await runtime.inspect(childId);
  const action = childRun.actions[0];
  await runtime.claim({
    runId: childId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'original-host',
    claimToken: 'original-child-claim',
  });
  if (status === 'cancelled') {
    await runtime.cancel({ runId: childId, reason: 'user cancelled child' });
  } else if (status !== 'running') {
    await runtime.recordOutcome({
      runId: childId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'original-child-claim',
        outcomeId: 'actual-child-result',
        status: status === 'completed' ? 'succeeded' : 'failed',
        output: { source: 'durable child', status },
      },
    });
  }
  return { store, runtime, parentRun, childRun: await runtime.inspect(childId), childId };
}

async function restore(store: RuntimeStore<WorkflowRun>, run: WorkflowRun): Promise<void> {
  const checkpoint = JSON.parse(JSON.stringify(createPortableRunCheckpoint(run)));
  const restored = readPortableRunCheckpoint(checkpoint, run.runId)!;
  const copiedAgain = createPortableRunCheckpoint(restored);
  expect(copiedAgain.run).toEqual(checkpoint.run);
  expect(copiedAgain.hash).toBe(checkpoint.hash);
  expect(
    await store.restoreCheckpoint!(
      run.runId,
      null,
      readPortableRunCheckpoint(copiedAgain, run.runId)!,
    ),
  ).toBe(true);
}

describe('Runtime-owned child reconciliation', () => {
  describe.each(['memory', 'file'] as const)('%s portable recovery', (kind) => {
    it.each(['completed', 'failed', 'cancelled'] as const)(
      'uses the existing %s child result exactly once',
      async (status) => {
        const source = await fixture(status);
        const store = await storeFor(kind);
        await restore(store, source.parentRun);
        await restore(store, source.childRun);
        const runtime = createRuntime({ store, workflows: [parent, child] });
        const before = await runtime.inspect('parent');
        const childBefore = await runtime.inspect(source.childId);
        expect(before.actions[0].status).toBe('unknown');
        const results = await Promise.all([
          runtime.next({ runId: 'parent' }),
          runtime.next({ runId: 'parent' }),
        ]);
        expect(results[0]).toEqual(results[1]);
        const reconciled = results[0];
        expect(reconciled.actions[0]).toMatchObject({
          status: status === 'completed' ? 'succeeded' : 'failed',
          attempt: 1,
          claim: before.actions[0].claim,
          reconciliations: [],
          receipts: [expect.any(Object)],
          outcome: {
            claimToken: before.actions[0].claim!.token,
            output: status === 'cancelled' ? {} : { read: { source: 'durable child', status } },
          },
        });
        expect(reconciled.status).toBe(status === 'completed' ? 'running' : 'failed');
        expect(reconciled.actions.filter((action) => action.stepId === 'write')).toHaveLength(
          status === 'completed' ? 1 : 0,
        );
        expect(await runtime.next({ runId: 'parent' })).toEqual(reconciled);
        expect(await runtime.inspect(source.childId)).toEqual(childBefore);
      },
    );

    it('leaves an in-flight external child unknown without executing or retrying it', async () => {
      const source = await fixture('running');
      const store = await storeFor(kind);
      await restore(store, source.parentRun);
      await restore(store, source.childRun);
      let calls = 0;
      const runtime = createRuntime({
        store,
        workflows: [parent, child],
        executors: [
          {
            id: 'host',
            capabilities: [],
            supports: () => true,
            async execute() {
              calls++;
              return { status: 'succeeded', output: 'must not execute' };
            },
          },
        ],
      });
      const before = await runtime.inspect('parent');
      const childBefore = await runtime.inspect(source.childId);
      expect(await runtime.next({ runId: 'parent' })).toEqual(before);
      expect((await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' })).reason).toBe(
        'execution-unknown',
      );
      expect(await runtime.inspect(source.childId)).toEqual(childBefore);
      expect(calls).toBe(0);
    });

    it('does not recreate a missing child from an unknown parent claim', async () => {
      const source = await fixture();
      const store = await storeFor(kind);
      await restore(store, source.parentRun);
      const runtime = createRuntime({ store, workflows: [parent, child] });
      const before = await runtime.inspect('parent');
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(runtime.next({ runId: 'parent' })).rejects.toThrow(/RUN_NOT_FOUND/);
        expect(await runtime.inspect('parent')).toEqual(before);
        expect(await store.read(source.childId)).toBeNull();
      }
    });
  });

  it('reconciles public markUnknown with an existing child, then observes its later completion', async () => {
    const source = await fixture('running');
    const action = source.parentRun.actions[0];
    const marked = await source.runtime.markUnknown({
      runId: 'parent',
      actionId: action.id,
      attempt: action.attempt,
      reason: 'parent disconnected',
    });
    const restarted = createRuntime({ store: source.store, workflows: [parent, child] });
    expect(await restarted.next({ runId: 'parent' })).toEqual(marked);
    const childAction = source.childRun.actions[0];
    await restarted.recordOutcome({
      runId: source.childId,
      outcome: {
        actionId: childAction.id,
        attempt: childAction.attempt,
        inputHash: childAction.inputHash,
        claimToken: childAction.claim!.token,
        outcomeId: 'late-child-result',
        status: 'succeeded',
        output: { source: 'late durable result' },
      },
    });
    const reconciled = await restarted.next({ runId: 'parent' });
    expect(reconciled.actions[0]).toMatchObject({
      status: 'succeeded',
      attempt: 1,
      claim: action.claim,
    });
    expect(reconciled.outputs.research.value).toEqual({ read: { source: 'late durable result' } });
    expect(await restarted.next({ runId: 'parent' })).toEqual(reconciled);
  });

  it('runUntilBlocked can reconcile a completed child without replaying its external work', async () => {
    const source = await fixture();
    const store = await storeFor('memory');
    await restore(store, source.parentRun);
    await restore(store, source.childRun);
    const calls: string[] = [];
    const runtime = createRuntime({
      store,
      workflows: [parent, child],
      executors: [
        {
          id: 'host',
          capabilities: [],
          supports: () => true,
          async execute(action) {
            calls.push(action.ref!);
            return { status: 'succeeded', output: 'written' };
          },
        },
      ],
    });
    const result = await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' });
    expect(result.reason).toBe('completed');
    expect(result.actionsExecuted).toBe(1);
    expect(calls).toEqual(['write']);
    expect(
      (await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' })).actionsExecuted,
    ).toBe(0);
  });

  it.each([
    'lineage',
    'input',
    'workflow',
    'executor',
    'claim-token',
    'attempt',
    'definition',
  ] as const)('rejects a mismatched %s without modifying either Run', async (damage) => {
    const source = await fixture();
    const store = await storeFor('memory');
    const parentRun = readPortableRunCheckpoint(
      createPortableRunCheckpoint(source.parentRun),
      'parent',
    )!;
    const childRun = readPortableRunCheckpoint(
      createPortableRunCheckpoint(source.childRun),
      source.childId,
    )!;
    const alternate = { ...child, id: 'alternate' };
    const alternateDefinition = defineWorkflow(alternate);
    const alternateKey = JSON.stringify([alternate.id, alternate.version]);
    const alternateHash = hashRuntimeValue(alternateDefinition);
    if (damage === 'lineage') childRun.lineage = [];
    else if (damage === 'input') childRun.input = { unrelated: true };
    else if (damage === 'workflow') {
      childRun.workflow = { id: alternate.id, version: alternate.version, hash: alternateHash };
      childRun.definitionHashes = { [alternateKey]: alternateHash };
    } else if (damage === 'executor') parentRun.actions[0].claim!.executorId = 'unrelated-host';
    else if (damage === 'claim-token') parentRun.actions[0].claim!.token = 'unrelated-claim';
    else if (damage === 'attempt') parentRun.actions[0].attempt = 2;
    else {
      parentRun.children[0].workflow = { id: alternate.id, version: alternate.version };
      parentRun.actions[0].ref = `${alternate.id}@${alternate.version}`;
      parentRun.definitionHashes[alternateKey] = alternateHash;
      childRun.workflow = { id: alternate.id, version: alternate.version, hash: alternateHash };
      childRun.definitionHashes = { [alternateKey]: alternateHash };
    }
    expect(await store.restoreCheckpoint!('parent', null, parentRun)).toBe(true);
    expect(await store.restoreCheckpoint!(childRun.runId, null, childRun)).toBe(true);
    const runtime = createRuntime({ store, workflows: [parent, child, alternate] });
    await expect(runtime.next({ runId: 'parent' })).rejects.toThrow(/INVALID_RUN|RUN_CONFLICT/);
    expect(await store.read('parent')).toEqual(parentRun);
    expect(await store.read(childRun.runId)).toEqual(childRun);
  });

  it('still starts a child after a known running claim was interrupted before creation', async () => {
    const source = await fixture();
    const store = await storeFor('memory');
    expect(await store.restoreCheckpoint!('parent', null, source.parentRun)).toBe(true);
    const runtime = createRuntime({ store, workflows: [parent, child] });
    const resumed = await runtime.next({ runId: 'parent' });
    expect(resumed.actions[0].claim).toEqual(source.parentRun.actions[0].claim);
    const created = await runtime.inspect(source.childId);
    expect(created.actions).toHaveLength(1);
    expect(created.actions[0].status).toBe('pending');
    expect(created.lineage).toEqual(['parent']);
    expect(await runtime.next({ runId: 'parent' })).toEqual(resumed);
    expect(await runtime.inspect(source.childId)).toEqual(created);
  });

  it('reconciles nested portable children with their pinned definitions and original lineage', async () => {
    const middle = {
      id: 'middle',
      version: '1',
      entry: 'research',
      steps: { research: parent.steps.research },
    };
    const root = {
      id: 'root',
      version: '1',
      entry: 'middle',
      steps: {
        middle: {
          type: 'child_workflow' as const,
          workflow: { id: middle.id, version: middle.version },
        },
      },
    };
    const source = createRuntime({
      store: createMemoryRuntimeStore(),
      workflows: [root, middle, child],
    });
    await source.start({ runId: 'root', workflow: root, input: 'nested topic' });
    const rootRun = await source.next({ runId: 'root' });
    const middleRun = await source.inspect(rootRun.children[0].runId);
    const childRun = await source.inspect(middleRun.children[0].runId);
    const action = childRun.actions[0];
    await source.claim({
      runId: childRun.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'leaf-claim',
    });
    await source.recordOutcome({
      runId: childRun.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'leaf-claim',
        outcomeId: 'leaf-result',
        status: 'succeeded',
        output: 'nested output',
      },
    });
    const store = await storeFor('memory');
    for (const runId of [rootRun.runId, middleRun.runId, childRun.runId]) {
      await restore(store, await source.inspect(runId));
    }
    const runtime = createRuntime({ store, workflows: [root, middle, child] });
    const restored = await runtime.next({ runId: 'root' });
    expect(restored.status).toBe('completed');
    expect(restored.outputs.middle.value).toEqual({ research: { read: 'nested output' } });
    expect((await runtime.inspect(middleRun.runId)).lineage).toEqual(['root']);
    expect((await runtime.inspect(childRun.runId)).lineage).toEqual(['root', middleRun.runId]);
    expect(await runtime.next({ runId: 'root' })).toEqual(restored);
  });

  it('still rejects host completion or generic retry for an unknown managed child', async () => {
    const source = await fixture();
    const store = await storeFor('memory');
    await restore(store, source.parentRun);
    await restore(store, source.childRun);
    const runtime = createRuntime({ store, workflows: [parent, child] });
    const before = await runtime.inspect('parent');
    const action = before.actions[0];
    await expect(
      runtime.recordOutcome({
        runId: 'parent',
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          outcomeId: 'invented',
          status: 'succeeded',
          output: 'invented',
        },
      }),
    ).rejects.toThrow(/CHILD_MANAGED/);
    await expect(
      runtime.retry({
        runId: 'parent',
        actionId: action.id,
        attempt: action.attempt,
        reconciliation: { resolution: 'not-executed', evidence: 'host assertion' },
      }),
    ).rejects.toThrow(/CHILD_MANAGED/);
    expect(await runtime.inspect('parent')).toEqual(before);
  });
});
