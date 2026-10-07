import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import {
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
} from '../../../domains/engine/portable-run-checkpoint.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

async function checkpoint() {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'recovery',
        version: '1',
        entry: 'work',
        steps: { work: { type: 'call_tool', ref: 'external-work' } },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'demo',
    workflow: { id: 'recovery', version: '1' },
    input: null,
  });
  const action = run.actions[0];
  const claimed = await runtime.claim({
    runId: 'demo',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'host',
    claimToken: 'local-secret-token',
  });
  return { claimed, saved: createPortableRunCheckpoint(claimed) };
}

describe('portable Run revision identity', () => {
  it('keeps default portable semantics while explicitly restoring the bound source revision', async () => {
    const { claimed, saved } = await checkpoint();
    expect(saved.run.revision).toBe(1);
    expect(readPortableRunCheckpoint(saved, 'demo')!.revision).toBe(1);
    const restored = readPortableRunCheckpoint(saved, 'demo', { preserveSourceRevision: true })!;
    expect(restored.revision).toBe(claimed.revision);
    expect(restored.actions[0]).toMatchObject({
      status: 'unknown',
      claim: { token: expect.stringMatching(/^portable-/) },
    });
    expect(JSON.stringify(saved)).not.toContain('local-secret-token');
    expect(createPortableRunCheckpoint(restored)).toEqual(saved);
  });

  it.each(['revision', 'hash', 'missing-revision', 'missing-hash', 'fraction', 'zero'])(
    'rejects %s damage even when the caller requests normalized progress',
    async (damage) => {
      const { saved } = await checkpoint();
      if (damage === 'revision') saved.sourceRevision! += 1;
      else if (damage === 'hash') saved.sourceHash = '0'.repeat(64);
      else if (damage === 'missing-revision') delete saved.sourceRevision;
      else if (damage === 'missing-hash') delete saved.sourceHash;
      else saved.sourceRevision = damage === 'fraction' ? 1.5 : 0;
      expect(() => readPortableRunCheckpoint(saved, 'demo')).toThrow(/checkpoint revision/);
    },
  );

  it('reads old checkpoints without inventing a source revision', async () => {
    const { saved } = await checkpoint();
    delete saved.sourceRevision;
    delete saved.sourceHash;
    expect(readPortableRunCheckpoint(saved, 'demo', { preserveSourceRevision: true })).toEqual(
      saved.run,
    );
  });
});
