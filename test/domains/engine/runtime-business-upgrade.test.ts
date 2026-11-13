import { expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
} from '../../../domains/engine/runtime.js';
import { upgradeNativeRun } from '../../../domains/comet-native/native-sdk-run-upgrade.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { upgradeClassicRun } from '../../../domains/comet-classic/classic-sdk-run-upgrade.js';

it.each(['native', 'classic'] as const)(
  'automatically imports %s history, approvals and live business claims without a process stop receipt',
  async (kind) => {
    const builder = kind === 'native' ? 'build.builder' : 'tweak.build.execute';
    const verifier = kind === 'native' ? 'verify.verifier' : 'tweak.verify.run';
    const oldCheck = kind === 'native' ? 'verify.checks' : 'tweak.verify.check';
    const id = kind === 'native' ? 'comet-native' : 'comet-classic-tweak';
    const before = defineWorkflow({
      id,
      version: '1',
      entry: 'seed',
      steps: {
        seed: { type: 'handoff', ref: 'requirements' },
        approve: { type: 'ask_user', proposalFrom: 'seed', choices: ['approved', 'rejected'] },
        [builder]: { type: 'handoff', ref: 'builder' },
        [oldCheck]: { type: 'call_tool', ref: 'old-check' },
        [verifier]: { type: 'handoff', ref: 'verifier' },
      },
      transitions: [
        { from: 'seed', to: 'approve' },
        { from: 'approve', to: builder, on: 'approved' },
        { from: builder, to: oldCheck },
        { from: oldCheck, to: verifier },
      ],
    });
    const after = defineWorkflow({
      ...before,
      version: kind === 'native' ? '4' : '2',
      steps: Object.fromEntries(Object.entries(before.steps).filter(([key]) => key !== oldCheck)),
      transitions: [
        { from: 'seed', to: 'approve' },
        { from: 'approve', to: builder, on: 'approved' },
        { from: builder, to: verifier },
      ],
    });
    const state =
      kind === 'native'
        ? createNativePortableState({ name: 'same-run', language: 'zh-CN' })
        : { workflow: 'tweak', phase: 'verify', archived: false };
    const store = createMemoryRuntimeStore();
    const runtime = createRuntime({ store, workflows: [before] });
    let run = await runtime.start({
      runId: 'same-run',
      workflow: before,
      input: { name: 'same-run', tasks: [{ id: 't1', done: true }] },
      initialState: state as never,
    });
    async function complete() {
      const action = run.actions.at(-1)!;
      run = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'platform',
        sessionId: 'original-session',
        claimToken: 'claim-' + action.id,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'claim-' + action.id,
          outcomeId: 'outcome-' + action.id,
          status: 'succeeded',
          output: { accepted: true },
        },
      });
    }
    await complete();
    const approval = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: approval.id,
      proposalHash: approval.proposalHash,
      choice: 'approved',
      decisionId: 'user-approved-original',
    });
    // A live business claim remains the same task after the definition upgrade.
    const business = run.actions.at(-1)!;
    run = await runtime.claim({
      runId: run.runId,
      actionId: business.id,
      attempt: business.attempt,
      inputHash: business.inputHash,
      executorId: 'platform',
      sessionId: 'original-session',
      claimToken: 'claim-' + business.id,
    });
    const upgrade = kind === 'native' ? upgradeNativeRun : upgradeClassicRun;
    const live = upgrade(run, after);
    expect(live.actions.at(-1)?.claim).toEqual(run.actions.at(-1)?.claim);
    expect(live.waits).toEqual(run.waits);
    await complete();
    const check = run.actions.at(-1)!;
    run = await runtime.claim({
      runId: run.runId,
      actionId: check.id,
      attempt: check.attempt,
      inputHash: check.inputHash,
      executorId: 'old-runner',
      claimToken: 'old-runner-claim',
    });
    const original = structuredClone(run),
      converted = upgrade(run, after);
    expect(run).toEqual(original);
    expect(converted.runId).toBe(run.runId);
    expect(converted.input).toEqual(run.input);
    expect(converted.waits).toEqual(run.waits);
    const retired = converted.actions.find((a) => a.id === check.id)!;
    expect(retired.status).toBe('cancelled');
    expect(retired.claim).toEqual(run.actions.at(-1)?.claim);
    expect(retired.outcome).toBeUndefined();
    expect(retired.executionStop).toBeUndefined();
    expect(retired.cancellation).toBeUndefined();
    converted.revision = run.revision + 1;
    expect(await store.compareAndSwap(run.runId, run.revision, converted)).toBe(true);
    const current = createRuntime({ store, workflows: [after] });
    await current.inspect(run.runId);
    const next = await current.next({ runId: run.runId });
    expect(next.actions.at(-1)?.stepId).toBe(verifier);
    expect(next.actions.at(-1)?.status).toBe('pending');
    expect(next.waits).toEqual(run.waits);
    expect(upgrade(next, after)).toBe(next);
  },
);
