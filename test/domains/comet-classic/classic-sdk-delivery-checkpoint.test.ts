import { describe, expect, it } from 'vitest';
import { readClassicSdkDeliveryCheckpoint } from '../../../domains/comet-classic/classic-sdk-delivery-checkpoint.js';
import {
  createMemoryRuntimeStore,
  createPortableRunCheckpoint,
  createRuntime,
  encodePortableRunCheckpoint,
  hashRuntimeValue,
  readPortableRunCheckpoint,
  type RuntimeValue,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { encodeRuntimeHistory } from '../../../domains/engine/runtime-history-storage.js';
import { decodeJsonValueMaps } from '../../../platform/fs/json-value-pool.js';

async function setup(profile = 'hotfix', large = false) {
  const verify = `${profile}.verify.check`;
  const confirm = `${profile}.archive.confirm`;
  const archive = `${profile}.archive.execute`;
  const deliver = `${profile}.archive.deliver`;
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'classic-checkpoint-test',
        version: '1',
        entry: verify,
        initialState: {
          workflow: profile,
          phase: 'archive',
          archived: false,
          branchStatus: 'pending',
        },
        stateSchema: { type: 'object' },
        transitionHandler: { id: 'archive', version: '1' },
        steps: {
          [verify]: { type: 'call_tool', ref: 'check' },
          [confirm]: { type: 'ask_user', proposalFrom: verify, choices: ['local', 'push'] },
          [archive]: { type: 'call_tool', ref: 'classic-archive' },
          [deliver]: { type: 'invoke_skill', ref: 'comet-archive', retry: 'manual' },
        },
        transitions: [
          { from: verify, to: confirm },
          { from: confirm, to: archive, on: 'local' },
          { from: archive, to: deliver },
        ],
        commands: {
          'continue-delivery': { stepId: deliver, validator: { id: 'continue', version: '1' } },
        },
      },
    ],
    commandValidators: [
      { id: 'continue', version: '1', validate: () => ({ accepted: true, allowFailed: true }) },
    ],
    transitionHandlers: [
      {
        id: 'archive',
        version: '1',
        apply: ({ run, event }) => ({
          state: {
            ...(run.state as Record<string, RuntimeValue>),
            ...(event.stepId === archive ? { archived: true } : {}),
            ...(event.stepId === deliver &&
            event.kind === 'action-outcome' &&
            event.outcome.status === 'succeeded'
              ? { branchStatus: 'handled' }
              : {}),
          },
          next:
            event.stepId === verify
              ? [confirm]
              : event.stepId === confirm
                ? [archive]
                : event.stepId === archive
                  ? [deliver]
                  : [],
        }),
      },
    ],
  });
  const claim = async (run: WorkflowRun) => {
    const action = run.actions.at(-1)!;
    return runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'test',
      claimToken: `${action.id}:${action.attempt}`,
    });
  };
  const finish = async (
    run: WorkflowRun,
    status: 'succeeded' | 'failed' = 'succeeded',
    output: RuntimeValue = { action: 'local', commit: 'a'.repeat(40), targetBranch: 'main' },
  ) => {
    const action = run.actions.at(-1)!;
    return runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: `${action.id}:${action.attempt}:result`,
        status,
        output,
      },
    });
  };
  let run = await runtime.start({
    runId: 'example',
    workflow: { id: 'classic-checkpoint-test', version: '1' },
    input: null,
  });
  run = await finish(await claim(run), 'succeeded', {
    verified: true,
    proof: 'evidence'.repeat(large ? 30_000 : 1),
  });
  const wait = run.waits[0];
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'archive-approval',
    choice: 'local',
  });
  run = await finish(await claim(run), 'succeeded', { archiveDirectory: 'archive/example' });
  const baseline = run;
  const checkpoint = encodePortableRunCheckpoint(createPortableRunCheckpoint(baseline));
  const retry = (run: WorkflowRun) =>
    runtime.retry({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      attempt: run.actions.at(-1)!.attempt,
      reconciliation: { resolution: 'not-executed', evidence: { remote: 'not-found' } },
    });
  const unknown = (run: WorkflowRun) =>
    runtime.markUnknown({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      attempt: run.actions.at(-1)!.attempt,
      reason: 'Connection lost; reconcile the original execution',
    });
  return { runtime, baseline, checkpoint, claim, finish, retry, unknown, deliver };
}

describe('immutable Classic archive delivery checkpoints', () => {
  it('keeps only the exact prior failed output when a new delivery is pending', async () => {
    const { runtime, baseline, claim, finish, deliver } = await setup();
    const failed = await finish(await claim(baseline), 'failed', {
      summary: 'Stopped before Git delivery.',
    });
    const resumed = await runtime.dispatchCommand({
      runId: baseline.runId,
      name: 'continue-delivery',
      commandId: 'continue-delivery-1',
      expectedRevision: failed.revision,
      input: null,
    });
    expect(resumed.actions.at(-1)?.id).not.toBe(failed.actions.at(-1)?.id);
    expect(resumed.outputs[deliver]).toEqual(failed.outputs[deliver]);
    const saved = encodePortableRunCheckpoint(createPortableRunCheckpoint(resumed));
    expect(readClassicSdkDeliveryCheckpoint(saved, resumed)).not.toBeNull();
    const completed = await finish(await claim(resumed));
    expect(readClassicSdkDeliveryCheckpoint(saved, completed)?.state).toEqual(resumed.state);
    for (const field of ['value', 'sequence', 'prior-outcome', 'prior-status'] as const) {
      const altered = structuredClone(resumed);
      const prior = altered.actions.find((action) => action.id === failed.actions.at(-1)!.id)!;
      if (field === 'value') altered.outputs[deliver].value = { summary: 'Other output' };
      if (field === 'sequence')
        altered.outputs[deliver].sequence =
          altered.actionContexts[altered.actions.at(-1)!.id].sequence;
      if (field === 'prior-outcome')
        prior.outcome!.output = { summary: 'Other historical outcome' };
      if (field === 'prior-status') prior.status = 'succeeded';
      expect(() => readClassicSdkDeliveryCheckpoint(saved, altered)).toThrow();
    }
  });
  it.each(['full', 'tweak', 'hotfix'])(
    'keeps %s baseline through claim and completion',
    async (profile) => {
      const { baseline, checkpoint, claim, finish } = await setup(profile);
      const bytes = JSON.stringify(checkpoint);
      const claimed = await claim(baseline);
      for (const run of [baseline, claimed]) {
        expect(readClassicSdkDeliveryCheckpoint(checkpoint, run)?.state).toEqual(baseline.state);
      }
      const completed = await finish(claimed);
      expect(readClassicSdkDeliveryCheckpoint(checkpoint, completed)?.status).toBe('running');
      expect(JSON.stringify(checkpoint)).toBe(bytes);
    },
  );

  it('accepts unknown reconciliation and unknown or failed retries on the same delivery', async () => {
    for (const failure of ['unknown', 'failed'] as const) {
      const { baseline, checkpoint, claim, finish, retry, unknown } = await setup();
      const claimed = await claim(baseline);
      const interrupted =
        failure === 'unknown' ? await unknown(claimed) : await finish(claimed, 'failed');
      expect(readClassicSdkDeliveryCheckpoint(checkpoint, interrupted)).not.toBeNull();
      if (failure === 'unknown') {
        expect(
          readClassicSdkDeliveryCheckpoint(checkpoint, await finish(interrupted)),
        ).not.toBeNull();
      } else {
        const retried = await retry(interrupted);
        expect(readClassicSdkDeliveryCheckpoint(checkpoint, retried)).not.toBeNull();
        expect(
          readClassicSdkDeliveryCheckpoint(checkpoint, await finish(await claim(retried))),
        ).not.toBeNull();
      }
    }
    const { baseline, checkpoint, claim, finish, retry, unknown } = await setup();
    const retried = await retry(await unknown(await claim(baseline)));
    expect(readClassicSdkDeliveryCheckpoint(checkpoint, retried)).not.toBeNull();
    expect(
      readClassicSdkDeliveryCheckpoint(checkpoint, await finish(await claim(retried))),
    ).not.toBeNull();
  });

  it('compares pooled history without materializing its source maps', async () => {
    const { baseline, checkpoint, claim, finish } = await setup('full', true);
    expect(checkpoint.schema).toBe('comet.workflow-run-checkpoint.v2');
    const completed = await finish(await claim(baseline));
    const encoded = encodeRuntimeHistory(completed);
    expect(encoded.pool).toBeDefined();
    const projection = decodeJsonValueMaps(encoded.record, encoded.pool, false);
    expect(
      readClassicSdkDeliveryCheckpoint(checkpoint, projection, { projection: true })?.state,
    ).toEqual(baseline.state);
  });

  it('resumes an older checkpoint saved after failed delivery retry without changing its receipt, reconciliation, or output prefix', async () => {
    const { baseline, claim, finish, retry, deliver } = await setup();
    const savedRun = await retry(await finish(await claim(baseline), 'failed'));
    expect(savedRun.actions.at(-1)!.attempt).toBe(2);
    const saved = encodePortableRunCheckpoint(createPortableRunCheckpoint(savedRun));
    const bytes = JSON.stringify(saved);
    expect(readClassicSdkDeliveryCheckpoint(saved, savedRun)).not.toBeNull();
    for (const field of ['receipt', 'reconciliation', 'output']) {
      const tampered = structuredClone(savedRun);
      const action = tampered.actions.at(-1)!;
      if (field === 'receipt') action.receipts[0].hash = '0'.repeat(64);
      if (field === 'reconciliation') action.reconciliations[0].evidence = { changed: true };
      if (field === 'output') tampered.outputs[deliver].value = { changed: true };
      expect(() => readClassicSdkDeliveryCheckpoint(saved, tampered)).toThrow();
    }
    const claimed = await claim(savedRun);
    expect(readClassicSdkDeliveryCheckpoint(saved, claimed)).not.toBeNull();
    const completed = await finish(claimed);
    expect(readClassicSdkDeliveryCheckpoint(saved, completed)?.state).toEqual(savedRun.state);
    expect(JSON.stringify(saved)).toBe(bytes);
    const tampered = structuredClone(completed);
    tampered.actions.at(-1)!.receipts[0].hash = '0'.repeat(64);
    expect(() => readClassicSdkDeliveryCheckpoint(saved, tampered)).toThrow();
  });

  it.each([
    'sequence',
    'workflow',
    'approval',
    'verify',
    'archive',
    'branch',
    'input',
    'output',
    'attempt',
    'revision',
  ])('rejects %s drift without replacing the frozen checkpoint', async (field) => {
    const { baseline, checkpoint, claim, finish, deliver } = await setup();
    const completed = structuredClone(await finish(await claim(baseline)));
    const delivery = completed.actions.at(-1)!;
    if (field === 'sequence') completed.sequence++;
    if (field === 'workflow') completed.workflow.hash = '0'.repeat(64);
    if (field === 'approval') completed.waits[0].decision!.choice = 'push';
    if (field === 'verify') completed.actions[0].outcome!.output = { verified: false };
    if (field === 'archive') completed.actions[1].outcome!.output = { archiveDirectory: 'other' };
    if (field === 'branch')
      (completed.state as Record<string, RuntimeValue>).branchStatus = 'pending';
    if (field === 'input') delivery.inputHash = '0'.repeat(64);
    if (field === 'output') completed.outputs[deliver].value = { commit: 'unverified' };
    if (field === 'attempt') delivery.attempt++;
    if (field === 'revision') completed.revision = baseline.revision;
    expect(() => readClassicSdkDeliveryCheckpoint(checkpoint, completed)).toThrow();
  });

  it('validates checkpoint hashes, preserves completed legacy checkpoints, and never invents delivery on clone', async () => {
    const { baseline, checkpoint, claim, finish } = await setup();
    expect(() =>
      readClassicSdkDeliveryCheckpoint({ ...checkpoint, hash: '0'.repeat(64) }, baseline),
    ).toThrow();
    const clone = readPortableRunCheckpoint(checkpoint, baseline.runId, {
      preserveSourceRevision: true,
    })!;
    expect(readClassicSdkDeliveryCheckpoint(checkpoint, clone)?.status).toBe('running');
    expect(clone.actions.at(-1)!.status).toBe('pending');
    const completed = await finish(await claim(baseline));
    expect(
      readClassicSdkDeliveryCheckpoint(createPortableRunCheckpoint(completed), completed),
    ).toBeNull();
    expect(readClassicSdkDeliveryCheckpoint(undefined, baseline)).toBeNull();
    const active = { ...baseline, state: { ...(baseline.state as object), archived: false } };
    expect(readClassicSdkDeliveryCheckpoint({ invalid: true }, active)).toBeNull();
    const changed = structuredClone(checkpoint);
    (changed.run.state as Record<string, RuntimeValue>).branchStatus = 'handled';
    changed.hash = hashRuntimeValue(changed.run);
    changed.sourceHash = hashRuntimeValue({
      hash: changed.hash,
      sourceRevision: changed.sourceRevision,
    });
    expect(() => readClassicSdkDeliveryCheckpoint(changed, baseline)).toThrow();
  });
});
