import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { upgradeNativeRun } from '../../../domains/comet-native/native-sdk-run-upgrade.js';
const cases = [1, 2, 3].flatMap((version) =>
  ['shape-revalidate-pending', 'verify-checks-pending', 'verify-checks-claimed-not-executed'].map(
    (frontier) => ({ version, frontier }),
  ),
);
it('rejects an unknown current Native definition instead of rebinding its business records', async () => {
  const original = JSON.parse(
    await readFile(
      'test/fixtures/native-052-platform-upgrade/v3-verify-checks-pending.json',
      'utf8',
    ),
  ).run as WorkflowRun;
  const app = defineNativeWorkflowApplication();
  const current = upgradeNativeRun(original, app.workflow, app.transitionHandler);
  current.workflow.hash = 'a'.repeat(64);
  current.definitionHashes[JSON.stringify([current.workflow.id, current.workflow.version])] =
    current.workflow.hash;
  const before = structuredClone(current);
  expect(() => upgradeNativeRun(current, app.workflow, app.transitionHandler)).toThrow(
    /definition|定义|hash/u,
  );
  expect(current).toEqual(before);
});

it.each(['pending', 'unknown'] as const)(
  'continues an actually installed old v4 approved result without another decision (%s)',
  async (status) => {
    const original = JSON.parse(
      await readFile(
        'test/fixtures/native-v4-internal-actions/approved-result-' + status + '.json',
        'utf8',
      ),
    ) as WorkflowRun;
    const before = structuredClone(original),
      app = defineNativeWorkflowApplication();
    const upgraded = upgradeNativeRun(original, app.workflow, app.transitionHandler);
    expect(original).toEqual(before);
    expect(upgraded.waits).toEqual(original.waits);
    const old = original.actions.find((action) => action.stepId === 'verify.revalidate')!;
    expect(upgraded.actions.find((action) => action.id === old.id)).toMatchObject({
      status: 'cancelled',
      input: old.input,
      inputHash: old.inputHash,
      ...(old.claim ? { claim: old.claim } : {}),
    });
    expect(upgraded.actions.find((action) => action.id === old.id)?.outcome).toBeUndefined();
    expect(upgraded.actions.find((action) => action.id === old.id)?.executionStop).toBeUndefined();
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(upgraded.runId, null, upgraded);
    const runtime = createRuntime({
      ...app,
      executors: [],
      store,
      workflows: [app.workflow],
      transitionHandlers: [app.transitionHandler],
    });
    const resumed = await runtime.next({ runId: upgraded.runId });
    expect(
      resumed.actions.filter((action) => action.stepId === 'supervisor.parent.deliver'),
    ).toHaveLength(1);
    expect(resumed.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.parent.deliver',
      status: 'pending',
    });
    expect(resumed.waits).toEqual(original.waits);
  },
);
it.each(cases)(
  'automatically resumes published v$version $frontier with original business history',
  async ({ version, frontier }) => {
    const fixture = JSON.parse(
      await readFile(
        path.resolve('test/fixtures/native-052-platform-upgrade', `v${version}-${frontier}.json`),
        'utf8',
      ),
    );
    const original = fixture.run as WorkflowRun,
      before = structuredClone(original),
      application = defineNativeWorkflowApplication();
    const next = upgradeNativeRun(original, application.workflow, application.transitionHandler);
    expect(original).toEqual(before);
    expect(next.runId).toBe(original.runId);
    expect(next.revision).toBe(original.revision);
    expect(next.input).toEqual(original.input);
    expect(next.waits).toEqual(original.waits);
    const old = original.actions.find((action) => ['pending', 'running'].includes(action.status))!;
    const retired = next.actions.find((action) => action.id === old.id)!;
    expect(retired.status).toBe('cancelled');
    expect(retired.claim).toEqual(old.claim);
    expect(retired.outcome).toBeUndefined();
    expect(retired.executionStop).toBeUndefined();
    expect(retired.cancellation).toBeUndefined();
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(next.runId, null, next);
    const runtime = createRuntime({
      ...application,
      executors: [],
      store,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
    });
    const after = await runtime.next({ runId: next.runId });
    expect(after.actions.at(-1)?.stepId).toBe(
      frontier.startsWith('shape') ? 'build.builder' : 'verify.verifier',
    );
    expect(after.state).toMatchObject({
      phase: frontier.startsWith('shape') ? 'build' : 'verify',
      status: 'active',
      loop: { iteration: 1, attempt: frontier.startsWith('shape') ? 0 : 1 },
    });
    if (!frontier.startsWith('shape'))
      expect((after.state as { builder_handoff: unknown }).builder_handoff).toEqual(
        (original.state as { builder_handoff: unknown }).builder_handoff,
      );
    expect(upgradeNativeRun(after, application.workflow, application.transitionHandler)).toBe(
      after,
    );
  },
);

it.each(['v3-two-child-checks-pending', 'v3-child-checks-pending-sibling-builder-running'])(
  'preserves every independent old Child frontier: %s',
  async (name) => {
    const fixture = JSON.parse(
      await readFile(
        path.resolve('test/fixtures/native-052-platform-upgrade', name + '.json'),
        'utf8',
      ),
    );
    const original = fixture.run as WorkflowRun,
      app = defineNativeWorkflowApplication(),
      converted = upgradeNativeRun(original, app.workflow, app.transitionHandler);
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(converted.runId, null, converted);
    const runtime = createRuntime({
      ...app,
      executors: [],
      store,
      workflows: [app.workflow],
      transitionHandlers: [app.transitionHandler],
    });
    const resumed = await runtime.next({ runId: converted.runId });
    const expected = name === 'v3-two-child-checks-pending' ? ['api', 'ui'] : ['api'];
    const verifiers = resumed.actions.filter(
      (a) => a.stepId === 'supervisor.child.verifier' && a.status === 'pending',
    );
    expect(
      verifiers.map((a) => (a.input as { activation: { child: string } }).activation.child).sort(),
    ).toEqual(expected);
    for (const verifier of verifiers)
      expect((verifier.input as { activation: unknown }).activation).toMatchObject({
        candidateCommit: expect.any(String),
        builderSessionId: expect.any(String),
        acceptance: expect.any(Array),
        contractRef: expect.any(String),
      });
    const running = original.actions.find((a) => a.status === 'running');
    if (running)
      expect(resumed.actions.find((a) => a.id === running.id)).toMatchObject({
        status: 'running',
        claim: running.claim,
        input: running.input,
        inputHash: running.inputHash,
      });
    expect(resumed.waits).toEqual(original.waits);
  },
);

it('retains the old repair-only decision and returns to Build only after the original proposal is approved', async () => {
  const fixture = JSON.parse(
    await readFile(
      path.resolve('test/fixtures/native-052-platform-upgrade/v3-root-checks-stop-pending.json'),
      'utf8',
    ),
  );
  const original = fixture.run as WorkflowRun,
    app = defineNativeWorkflowApplication(),
    converted = upgradeNativeRun(original, app.workflow, app.transitionHandler);
  const originalWait = original.waits.find((w) => w.status === 'pending')!,
    wait = converted.waits.find((w) => w.id === originalWait.id)!;
  expect(wait).toEqual({ ...originalWait, stepId: 'verify.stop' });
  expect(wait.decision).toBeUndefined();
  expect(converted.ready).toEqual([]);
  const store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint!(converted.runId, null, converted);
  const runtime = createRuntime({
    ...app,
    executors: [],
    store,
    workflows: [app.workflow],
    transitionHandlers: [app.transitionHandler],
  });
  await runtime.inspect(converted.runId);
  await expect(
    runtime.resolveWait({
      runId: converted.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      choice: 'retry',
      decisionId: 'forbidden-auto-retry',
    }),
  ).rejects.toThrow();
  const after = await runtime.resolveWait({
    runId: converted.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'repair',
    decisionId: 'SIMULATED-USER-original-repair',
  });
  expect(after.state).toMatchObject({ phase: 'build' });
  expect(after.actions.at(-1)?.stepId).toBe('build.builder');
  expect(after.actions.at(-1)?.status).toBe('pending');
  const failed = original.actions.find(
    (a) => a.stepId === 'verify.checks' && a.status === 'failed',
  )!;
  expect(after.actions.find((a) => a.id === failed.id)?.outcome).toEqual(failed.outcome);
});

it('keeps a published running Supervisor preparation bound to its original approval and claim', async () => {
  const { run: original } = JSON.parse(
    await readFile(
      path.resolve('test/fixtures/native-052-platform-upgrade/v3-supervisor-prepare-running.json'),
      'utf8',
    ),
  );
  const app = defineNativeWorkflowApplication(),
    next = upgradeNativeRun(original, app.workflow, app.transitionHandler),
    prior = original.actions.at(-1),
    actual = next.actions.find((a) => a.id === prior.id);
  expect(actual).toMatchObject({
    input: prior.input,
    inputHash: prior.inputHash,
    claim: prior.claim,
    status: 'running',
    executionOrigin: { workflow: original.workflow },
  });
  expect(next.waits).toEqual(original.waits);
  expect(next.state).toMatchObject({
    children_contract_hash: original.state.children_contract_hash,
    children_contract_ref: expect.any(String),
  });
});
it('resumes a published successful integration repair at Archive without replaying checks', async () => {
  const { run: original } = JSON.parse(
    await readFile(
      path.resolve(
        'test/fixtures/native-052-platform-upgrade/v3-integration-repair-success-checks-pending.json',
      ),
      'utf8',
    ),
  );
  const app = defineNativeWorkflowApplication(),
    next = upgradeNativeRun(original, app.workflow, app.transitionHandler);
  const repair = original.actions.find(
    (a) => a.stepId === 'supervisor.child.integration-repair' && a.status === 'succeeded',
  );
  expect(next.ready).toContainEqual(
    expect.objectContaining({
      to: 'supervisor.child.archive',
      activation: expect.objectContaining({
        repairActionId: repair.id,
        integrationCommit: repair.outcome.output.integrationCommit,
      }),
    }),
  );
  expect(next.actions.find((a) => a.id === repair.id).outcome).toEqual(repair.outcome);
  expect(next.waits).toEqual(original.waits);
  const retired = next.actions.find((a) => a.id === original.actions.at(-1).id);
  expect(retired).toMatchObject({ status: 'cancelled' });
  expect(retired.outcome).toBeUndefined();
  expect(retired.executionStop).toBeUndefined();
});
it('preserves the original published pending Archive input after an accepted integration repair', async () => {
  const { run: original } = JSON.parse(
    await readFile(
      path.resolve(
        'test/fixtures/native-052-platform-upgrade/v3-child-archive-pending-after-repair.json',
      ),
      'utf8',
    ),
  );
  const app = defineNativeWorkflowApplication(),
    next = upgradeNativeRun(original, app.workflow, app.transitionHandler),
    prior = original.actions.at(-1);
  expect(prior.stepId).toBe('supervisor.child.archive');
  expect(next.actions.find((a) => a.id === prior.id)).toEqual(prior);
  expect(next.waits).toEqual(original.waits);
  expect(next.ready).toEqual(original.ready);
});
