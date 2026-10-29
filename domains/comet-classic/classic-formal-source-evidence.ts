import { hashRuntimeValue } from '../engine/runtime-json.js';
import type { WorkflowRun, RuntimeEvidenceWait } from '../engine/runtime.js';
import type { ClassicState } from './classic-state.js';

function validReceipt(value: unknown, ref: string): value is { ref: string; contentHash: string } {
  const receipt = value as { ref?: unknown; contentHash?: unknown } | null;
  return Boolean(
    receipt &&
    receipt.ref === ref &&
    typeof receipt.contentHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(receipt.contentHash),
  );
}

/** Preset 沿用实际 Open 或最新 continue 的范围；未完成的新决定不回退旧批准。 */
export function classicSdkPresetSourceEvidence(
  run: Readonly<WorkflowRun>,
): { identity: string; evidenceHash: string; ref: string } | null {
  const profile = (run.state as unknown as ClassicState).workflow;
  if (profile === 'full') return null;
  const ref = (run.input as { changeDir: string }).changeDir;
  const open = latestRound(
    run,
    `${profile}.open.evidence`,
    commandBoundary(run, ['repair-archive']),
  );
  if (!open || open.status !== 'resolved' || !validReceipt(open.receipt, ref)) return null;
  const opened = open.results[`${profile}.open`]?.value as
    { requirementsEvidence?: unknown } | undefined;
  if (opened?.requirementsEvidence !== undefined && !validReceipt(opened.requirementsEvidence, ref))
    return null;
  let aggregate =
    (opened?.requirementsEvidence as { ref: string; contentHash: string } | undefined) ??
    open.receipt;
  const escalations = run.waits
    .filter(
      (wait) =>
        wait.stepId === `${profile}.build.escalation-confirm` && wait.sequence > open.sequence,
    )
    .sort((left, right) => left.sequence - right.sequence);
  const latest = escalations.at(-1);
  if (latest) {
    if (
      latest.status !== 'resolved' ||
      latest.decision?.choice !== 'continue' ||
      latest.decision.proposalHash !== latest.proposalHash
    )
      return null;
    for (const wait of escalations) {
      if (
        wait.status !== 'resolved' ||
        wait.decision?.choice !== 'continue' ||
        wait.decision.proposalHash !== wait.proposalHash
      )
        continue;
      const output = (
        wait.proposal as
          { outputs?: Record<string, { requirementsEvidence?: unknown }> } | undefined
      )?.outputs?.[`${profile}.build.execute`];
      if (output?.requirementsEvidence === undefined) continue;
      if (!validReceipt(output.requirementsEvidence, ref)) return null;
      aggregate = output.requirementsEvidence;
    }
    return {
      identity: hashRuntimeValue([
        'classic-preset-source-v1',
        run.runId,
        profile,
        'continue',
        latest.id,
        latest.proposalHash,
        latest.decision.id,
        aggregate.ref,
        aggregate.contentHash,
      ]),
      evidenceHash: aggregate.contentHash,
      ref: aggregate.ref,
    };
  }
  return {
    identity: hashRuntimeValue([
      'classic-preset-source-v1',
      run.runId,
      profile,
      'open',
      open.id,
      open.receipt.ref,
      open.receipt.contentHash,
      aggregate.ref,
      aggregate.contentHash,
    ]),
    evidenceHash: aggregate.contentHash,
    ref: aggregate.ref,
  };
}

function commandBoundary(run: Readonly<WorkflowRun>, names: readonly string[]) {
  let latest = -1;
  for (const command of run.commands ?? []) {
    if (!names.includes(command.name)) continue;
    const sequence = run.actionContexts[command.actionId]?.sequence;
    if (!Number.isSafeInteger(sequence)) throw new Error('正式材料修订缺少原命令 Action 来源');
    latest = Math.max(latest, sequence);
  }
  return latest;
}

function latestRound(run: Readonly<WorkflowRun>, stepId: string, after: number) {
  return (run.evidenceWaits ?? [])
    .filter((wait) => wait.stepId === stepId && wait.sequence > after)
    .reduce<RuntimeEvidenceWait | undefined>(
      (latest, wait) => (!latest || wait.sequence > latest.sequence ? wait : latest),
      undefined,
    );
}

function acceptedIdentity(
  run: Readonly<WorkflowRun>,
  wait: RuntimeEvidenceWait | undefined,
  ref: string | null,
  design?: string,
) {
  if (!ref || !wait || wait.status !== 'resolved' || !wait.receipt || wait.receipt.ref !== ref)
    return null;
  return hashRuntimeValue([
    'classic-formal-source-v1',
    run.runId,
    wait.stepId,
    wait.id,
    wait.receipt.ref,
    wait.receipt.contentHash,
    ...(design ? [design] : []),
  ]);
}

/** 按真实接受轮次绑定来源；同一正文的新批准也有新身份，普通保存不改变身份。 */
export function classicSdkFormalSourceEvidence(
  run: Readonly<WorkflowRun>,
  designSourceRefs: readonly string[] = [],
): Record<string, string> {
  const state = run.state as unknown as ClassicState;
  const current: Record<string, string> = {};
  if (state.workflow !== 'full') return current;
  const boundary = commandBoundary(run, ['revise-design', 'repair-archive']);
  const confirmation = run.waits
    .filter((wait) => wait.stepId === 'full.design.confirm' && wait.sequence > boundary)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const handoff = confirmation?.results['full.design.handoff']?.value as
    { handoffHash?: string; handoffContext?: string } | undefined;
  if (
    confirmation?.status === 'resolved' &&
    confirmation.decision?.choice === 'approved' &&
    confirmation.decision.proposalHash === confirmation.proposalHash &&
    state.handoffHash &&
    handoff?.handoffHash === state.handoffHash &&
    handoff.handoffContext === state.handoffContext
  ) {
    const identity = hashRuntimeValue([
      'classic-formal-handoff-v1',
      run.runId,
      confirmation.id,
      confirmation.decision.id,
      state.handoffHash,
    ]);
    for (const ref of designSourceRefs) current[ref] = identity;
  }
  const design = acceptedIdentity(
    run,
    latestRound(
      run,
      'full.design.evidence',
      commandBoundary(run, ['revise-design', 'repair-archive']),
    ),
    state.designDoc,
  );
  if (design) for (const ref of state.designDoc ? [state.designDoc] : []) current[ref] = design;
  const plan = design
    ? acceptedIdentity(
        run,
        latestRound(
          run,
          'full.build.plan.evidence',
          commandBoundary(run, ['revise-design', 'revise-plan', 'repair-archive']),
        ),
        state.plan,
        design,
      )
    : null;
  if (plan && state.plan) current[state.plan] = plan;
  return current;
}
