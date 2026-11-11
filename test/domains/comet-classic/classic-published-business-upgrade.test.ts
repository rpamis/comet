import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { defineClassicWorkflowApplication } from '../../../domains/comet-classic/classic-sdk-application.js';
import { upgradeClassicRun } from '../../../domains/comet-classic/classic-sdk-run-upgrade.js';
import { acceptedClassicLegacyVerifyCheck } from '../../../domains/comet-classic/classic-sdk-run-upgrade.js';
import { assertVerifyEvidenceCurrent } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';

it('resumes the published 0.5.2 Build frontier on the original Run without running a check', async () => {
  const original = JSON.parse(
    await readFile('test/fixtures/classic-052-platform-upgrade/build-check-pending.json', 'utf8'),
  ) as WorkflowRun;
  const before = structuredClone(original),
    application = defineClassicWorkflowApplication('tweak');
  const converted = upgradeClassicRun(original, application.workflow);
  expect(original).toEqual(before);
  expect(converted.runId).toBe(original.runId);
  expect(converted.revision).toBe(original.revision);
  expect(converted.input).toEqual(original.input);
  expect(converted.waits).toEqual(original.waits);
  expect(converted.actions.find((a) => a.stepId === 'tweak.build.execute')).toEqual(
    expect.objectContaining({
      claim: original.actions.find((a) => a.stepId === 'tweak.build.execute')!.claim,
    }),
  );
  const retired = converted.actions.find((a) => a.stepId === 'tweak.build.check')!;
  expect(retired.status).toBe('cancelled');
  expect(retired.claim).toBeUndefined();
  expect(retired.outcome).toBeUndefined();
  expect(retired.executionStop).toBeUndefined();
  const store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint!(converted.runId, null, converted);
  const runtime = createRuntime({
    ...application,
    store,
    executors: [],
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
  });
  const resumed = await runtime.next({ runId: original.runId });
  expect(resumed.actions.at(-1)?.stepId).toBe('tweak.verify.run');
  expect(resumed.actions.at(-1)?.status).toBe('pending');
  expect(resumed.state).toMatchObject({ phase: 'verify', verifyResult: 'pending' });
  expect(upgradeClassicRun(resumed, application.workflow)).toBe(resumed);
});

it.each([
  'verify-accepted.archive-prepare',
  'archive-approved.preflight-pending',
  'archived.deliver-pending',
])('preserves published acceptance and delivery data at %s', async (name) => {
  const original = JSON.parse(
    await readFile(
      'test/fixtures/classic-052-platform-upgrade/' + name + '.sdk-052.run.json',
      'utf8',
    ),
  ) as WorkflowRun;
  const app = defineClassicWorkflowApplication('tweak'),
    converted = upgradeClassicRun(original, app.workflow);
  const store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint!(converted.runId, null, converted);
  const runtime = createRuntime({
    ...app,
    store,
    executors: [],
    workflows: [app.workflow],
    transitionHandlers: [app.transitionHandler],
  });
  const inspected = await runtime.inspect(converted.runId);
  expect(inspected.waits).toEqual(original.waits);
  expect(inspected.state).toEqual(original.state);
  expect(inspected.actions.at(-1)?.stepId).toBe(original.actions.at(-1)?.stepId);
  const accepted = acceptedClassicLegacyVerifyCheck(inspected);
  expect(accepted?.output.exitCode).toBe(0);
  expect(Object.keys(accepted?.output.deliveryInputs ?? {})).toEqual(['implementation.txt']);
  await expect(
    assertVerifyEvidenceCurrent(
      inspected,
      'unused-for-business-history',
      inspected.state as unknown as ClassicState,
    ),
  ).resolves.toBeUndefined();
  const verifier = inspected.actions.find((a) => a.stepId === 'tweak.verify.run')!;
  expect(verifier.outcome).toEqual(original.actions.find((a) => a.id === verifier.id)!.outcome);
  expect((verifier.outcome!.output as { checks?: unknown }).checks).toBeUndefined();
  const withoutEvidence = structuredClone(inspected);
  withoutEvidence.evidenceWaits = withoutEvidence.evidenceWaits?.filter(
    (e) => e.stepId !== 'tweak.verify.check.evidence',
  );
  expect(acceptedClassicLegacyVerifyCheck(withoutEvidence)).toBeNull();
  await expect(
    assertVerifyEvidenceCurrent(
      withoutEvidence,
      'unused',
      withoutEvidence.state as unknown as ClassicState,
    ),
  ).rejects.toThrow();
});

it.each(['reference', 'content-hash'] as const)(
  'rejects detached published Verify evidence (%s)',
  async (kind) => {
    const saved = JSON.parse(
      await readFile(
        'test/fixtures/classic-052-platform-upgrade/verify-accepted.archive-prepare.sdk-052.run.json',
        'utf8',
      ),
    ) as WorkflowRun;
    const converted = upgradeClassicRun(saved, defineClassicWorkflowApplication('tweak').workflow);
    const evidence = converted.evidenceWaits!.find(
      (wait) => wait.stepId === 'tweak.verify.check.evidence',
    )!;
    if (kind === 'reference') evidence.receipt!.ref += '.other';
    else evidence.receipt!.contentHash = '0'.repeat(64);
    expect(acceptedClassicLegacyVerifyCheck(converted)).toBeNull();
    await expect(
      assertVerifyEvidenceCurrent(converted, 'unused', converted.state as unknown as ClassicState),
    ).rejects.toThrow();
  },
);

it('rejects a changed current definition instead of treating it as legacy data', async () => {
  const saved = JSON.parse(
    await readFile('test/fixtures/classic-052-platform-upgrade/build-check-pending.json', 'utf8'),
  ) as WorkflowRun;
  const app = defineClassicWorkflowApplication('tweak');
  const current = upgradeClassicRun(saved, app.workflow);
  const forged = structuredClone(current);
  forged.workflow.hash = 'a'.repeat(64);
  forged.definitionHashes[JSON.stringify([forged.workflow.id, forged.workflow.version])] =
    forged.workflow.hash;
  expect(() => upgradeClassicRun(forged, app.workflow)).toThrow(/definition|定义|hash/u);
});
