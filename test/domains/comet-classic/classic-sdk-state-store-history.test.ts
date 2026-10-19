import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function completedCheck() {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'check-history',
        version: '1',
        entry: 'check',
        steps: { check: { type: 'call_tool', ref: 'classic-check' } },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'history',
    workflow: { id: 'check-history', version: '1' },
    input: { change: 'history', changeDir: 'docs/openspec/changes/history' },
    initialState: { archived: false },
  });
  const action = run.actions[0];
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'test-check',
    claimToken: 'test-claim',
  });
  return runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'test-claim',
      outcomeId: 'test-outcome',
      status: 'succeeded',
      output: { exitCode: 0 },
    },
  });
}

async function wrapped(previous: WorkflowRun) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-history-'));
  roots.push(root);
  // CAS 故意返回冲突，隔离验证提交前的历史筛选，不写入合成历史。
  const commit = vi.fn(async () => false);
  const store = createClassicSdkStateStore(root, {
    store: { read: async () => previous, compareAndSwap: commit },
  });
  return { store, commit };
}

describe('Classic check history receipt filtering', () => {
  it('indexes historical action IDs with linear work and keeps equal outcomes receipt-free', async () => {
    const previous = await completedCheck();
    const count = 512;
    previous.actions = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(previous.actions[0]),
      id: `historical-${index}`,
    }));
    const next = structuredClone(previous);
    next.revision++;
    let idReads = 0;
    for (const action of previous.actions) {
      const id = action.id;
      Object.defineProperty(action, 'id', {
        enumerable: true,
        get: () => {
          idReads++;
          return id;
        },
      });
    }
    const { store, commit } = await wrapped(previous);
    expect(await store.compareAndSwap(previous.runId, previous.revision, next)).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(idReads).toBeLessThanOrEqual(count * 4);
  });

  it.each(['changed', 'added'] as const)(
    'requires original receipts for %s outcomes',
    async (mode) => {
      const previous = await completedCheck();
      const next = structuredClone(previous);
      next.revision++;
      if (mode === 'changed') next.actions[0].outcome!.output = { exitCode: 1 };
      else next.actions[0].id = 'new-check';
      const { store, commit } = await wrapped(previous);
      await expect(store.compareAndSwap(previous.runId, previous.revision, next)).rejects.toThrow(
        /original Runtime execution receipt is unavailable/,
      );
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale expected revision before checking new receipts', async () => {
    const previous = await completedCheck();
    const next = structuredClone(previous);
    next.revision++;
    next.actions[0].outcome!.output = { exitCode: 1 };
    const { store, commit } = await wrapped(previous);
    expect(await store.compareAndSwap(previous.runId, previous.revision - 1, next)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });
});
