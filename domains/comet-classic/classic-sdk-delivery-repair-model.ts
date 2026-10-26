import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import type { ClassicState } from './classic-state.js';

export interface ClassicDeliveryRepair {
  checkpointHash: string;
  archiveActionId: string;
  checkActionId: string;
  policyHash: string;
  excludedOutputs: Record<string, string>;
  command: { argv: string[]; cwd: string; timeoutMs: number; reusable: false };
}

export function classicDeliveryRepairRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Classic delivery recovery evidence is missing');
  return value as Record<string, unknown>;
}

export function classicDeliveryRepairOriginals(
  run: Readonly<WorkflowRun>,
  proof?: ClassicDeliveryRepair,
) {
  const profile = (run.state as unknown as ClassicState).workflow;
  const archive = run.actions
    .slice()
    .reverse()
    .find((a) => a.stepId === `${profile}.archive.execute` && a.status === 'succeeded');
  const check = run.actions
    .slice()
    .reverse()
    .find((a) => a.stepId === `${profile}.verify.check` && a.status === 'succeeded');
  if (
    !archive?.outcome ||
    !check?.outcome ||
    (proof && (proof.archiveActionId !== archive.id || proof.checkActionId !== check.id))
  )
    throw new Error('Classic delivery recovery requires its original Archive and Verify');
  const inputs = classicDeliveryRepairRecord(archive.input).outputs;
  const approved = classicDeliveryRepairRecord(
    classicDeliveryRepairRecord(inputs)[`${profile}.archive.preflight`],
  );
  const archiveRef = classicDeliveryRepairRecord(archive.outcome.output).archiveDirectory;
  if (typeof archiveRef !== 'string' || typeof approved?.baseCommit !== 'string')
    throw new Error('Classic delivery recovery lacks its approved archive target');
  return {
    profile,
    archive,
    check,
    approved: { ...approved, baseCommit: approved.baseCommit },
    archiveRef,
  };
}

export function classicDeliveryRepairForAction(
  action: Readonly<RuntimeAction>,
): ClassicDeliveryRepair {
  return classicDeliveryRepairRecord(classicDeliveryRepairRecord(action.input).activation)
    .deliveryRepair as ClassicDeliveryRepair;
}

export function isClassicDeliveryRepairCheck(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
) {
  const state = run.state as unknown as ClassicState;
  return (
    state.archived &&
    state.phase === 'archive' &&
    action.type === 'call_tool' &&
    action.ref === 'classic-check' &&
    action.stepId === `${state.workflow}.delivery.check`
  );
}

export function classicDeliveryRepairInputs(
  run: Readonly<WorkflowRun>,
  proof: ClassicDeliveryRepair,
) {
  const original = classicDeliveryRepairOriginals(run, proof);
  return Object.fromEntries(
    Object.entries(
      classicDeliveryRepairRecord(original.check.outcome!.output).deliveryInputs as Record<
        string,
        string
      >,
    ).filter(([ref]) => !Object.hasOwn(proof.excludedOutputs, ref)),
  );
}

export function canRepairClassicDelivery(run: Readonly<WorkflowRun>): boolean {
  const state = run.state as unknown as ClassicState;
  const pending = run.actions.filter((a) => a.status === 'pending');
  const waits = run.waits.filter((wait) => wait.status === 'pending');
  if (
    !state.archived ||
    state.phase !== 'archive' ||
    !['running', 'waiting', 'failed'].includes(run.status) ||
    run.actions.some((a) => ['running', 'unknown'].includes(a.status)) ||
    run.evidenceWaits?.some((w) => w.status === 'pending')
  )
    return false;
  if (run.status === 'failed') {
    const last = run.actions.at(-1);
    return (
      pending.length === 0 &&
      waits.length === 0 &&
      last?.status === 'failed' &&
      isClassicDeliveryRepairCheck(run, last)
    );
  }
  if (waits.length)
    return (
      run.status === 'waiting' &&
      pending.length === 0 &&
      waits.length === 1 &&
      waits[0].stepId === `${state.workflow}.delivery.confirm`
    );
  return (
    run.status === 'running' &&
    pending.length === 1 &&
    !pending[0].claim &&
    (pending[0].stepId === `${state.workflow}.archive.deliver` ||
      isClassicDeliveryRepairCheck(run, pending[0]))
  );
}

/** 显式修复命令只替换已绑定的旧 checkpoint，其他陈旧或编辑过的快照仍拒绝。 */
export function isClassicDeliveryRepairCheckpoint(value: unknown, run: WorkflowRun): boolean {
  if (value === undefined || (run.state as unknown as ClassicState).archived !== true) return false;
  const hash = hashRuntimeValue(value as RuntimeValue);
  return Boolean(
    run.commands?.some((command) => {
      if (!['repair-delivery', 'continue-work'].includes(command.name)) return false;
      const action = run.actions.find((a) => a.id === command.actionId);
      if (!action || hashRuntimeValue(action.input) !== action.inputHash) return false;
      const activation = classicDeliveryRepairRecord(
        classicDeliveryRepairRecord(action.input).activation,
      );
      if (command.name === 'continue-work') {
        const failed = run.actions.find((entry) => entry.id === activation.interruptedActionId);
        return (
          action.stepId === 'classic.resume-work' &&
          typeof activation.deliveryCheckpointHash === 'string' &&
          hashRuntimeValue(activation) === command.inputHash &&
          activation.deliveryCheckpointHash === hash &&
          Boolean(failed?.status === 'failed' && classicDeliveryActionContext(run, failed))
        );
      }
      return (
        isClassicDeliveryRepairCheck(run, action) &&
        hashRuntimeValue(activation) === command.inputHash &&
        classicDeliveryRepairRecord(activation.deliveryRepair).checkpointHash === hash
      );
    }),
  );
}

interface ClassicDeliveryActionContext {
  outputs: Record<string, unknown>;
  archiveActionId: string;
  repairCheckId?: string;
  approvalWaitIds: string[];
}

/** 沿已验证的交付和续行记录读取原归档上下文，不改变 Action 输入或重建执行结果。 */
export function classicDeliveryActionContext(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): ClassicDeliveryActionContext | null {
  const state = run.state as unknown as ClassicState;
  if (
    !state.archived ||
    action.type !== 'invoke_skill' ||
    action.stepId !== `${state.workflow}.archive.deliver`
  )
    return null;
  const activation = classicDeliveryRepairRecord(action.input).activation;
  const details = activation === undefined ? {} : classicDeliveryRepairRecord(activation);
  const id = details.deliveryRepairCheckId;
  if (id === undefined && details.interruptedActionId !== undefined) {
    const failed = run.actions.find((entry) => entry.id === details.interruptedActionId);
    const sequence = run.actionContexts[action.id]?.sequence;
    const bridgeResult = run.actionContexts[action.id]?.results['classic.resume-work'];
    const bridge = run.actions.find(
      (entry) =>
        entry.stepId === 'classic.resume-work' &&
        run.actionContexts[entry.id]?.sequence === bridgeResult?.sequence,
    );
    if (
      !failed ||
      failed.status !== 'failed' ||
      failed.type !== action.type ||
      failed.ref !== action.ref ||
      failed.stepId !== action.stepId ||
      sequence === undefined ||
      (run.actionContexts[failed.id]?.sequence ?? Infinity) >= sequence ||
      bridge?.status !== 'succeeded' ||
      bridge.claim?.executorId !== 'comet-classic-work-continuation' ||
      hashRuntimeValue(bridge.outcome?.output) !==
        hashRuntimeValue({ interruptedActionId: failed.id, resumeStepId: failed.stepId }) ||
      classicDeliveryRepairRecord(classicDeliveryRepairRecord(bridge.input).activation)
        .interruptedActionId !== failed.id ||
      !run.commands?.some(
        (command) =>
          command.name === 'continue-work' &&
          command.actionId === bridge.id &&
          command.inputHash ===
            hashRuntimeValue(classicDeliveryRepairRecord(bridge.input).activation as RuntimeValue),
      )
    )
      throw new Error('Classic delivery continuation is missing its original stopped Skill');
    return classicDeliveryActionContext(run, failed);
  }
  const original = classicDeliveryRepairOriginals(run);
  const approvalSequence =
    run.actionContexts[original.archive.id]?.results[`${state.workflow}.archive.confirm`]?.sequence;
  const originalApproval = run.waits.find(
    (wait) =>
      wait.stepId === `${state.workflow}.archive.confirm` &&
      wait.sequence === approvalSequence &&
      wait.status === 'resolved',
  );
  const base = {
    outputs: {
      ...classicDeliveryRepairRecord(classicDeliveryRepairRecord(original.archive.input).outputs),
      [original.archive.stepId]: original.archive.outcome!.output,
    },
    archiveActionId: original.archive.id,
    approvalWaitIds: originalApproval ? [originalApproval.id] : [],
  };
  if (id === undefined) {
    const outputs = classicDeliveryRepairRecord(classicDeliveryRepairRecord(action.input).outputs);
    if (
      run.actionContexts[action.id]?.results[original.archive.stepId]?.sequence !==
        run.actionContexts[original.archive.id]?.sequence ||
      hashRuntimeValue(outputs[`${state.workflow}.archive.preflight`]) !==
        hashRuntimeValue(original.approved) ||
      hashRuntimeValue(outputs[original.archive.stepId]) !==
        hashRuntimeValue(original.archive.outcome!.output)
    )
      throw new Error('Classic delivery is missing its original approved Archive context');
    return base;
  }
  const check = run.actions.find((a) => a.id === id);
  const wait = run.waits
    .slice()
    .reverse()
    .find(
      (w) =>
        w.stepId === `${state.workflow}.delivery.confirm` &&
        w.results[`${state.workflow}.delivery.check`]?.sequence ===
          (check && run.actionContexts[check.id]?.sequence),
    );
  if (
    !check ||
    !isClassicDeliveryRepairCheck(run, check) ||
    check.status !== 'succeeded' ||
    wait?.status !== 'resolved' ||
    wait.decision?.choice !== 'approved' ||
    hashRuntimeValue(
      classicDeliveryRepairRecord(classicDeliveryRepairRecord(wait.proposal).outputs)[check.stepId],
    ) !== hashRuntimeValue(check.outcome!.output)
  )
    throw new Error('Classic delivery repair is missing its current check and explicit approval');
  classicDeliveryRepairOriginals(run, classicDeliveryRepairForAction(check));
  return {
    ...base,
    outputs: { ...base.outputs, [check.stepId]: check.outcome!.output },
    repairCheckId: check.id,
    approvalWaitIds: [...base.approvalWaitIds, wait.id],
  };
}
