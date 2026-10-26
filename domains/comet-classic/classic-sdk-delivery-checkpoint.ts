import { hashJsonValueProjection } from '../../platform/fs/json-value-pool.js';
import { isClassicDeliveryRepairCheckpoint } from './classic-sdk-delivery-repair-model.js';
import { validateRuntimeActionSnapshot } from '../engine/runtime-action.js';
import {
  portableRunCheckpointProjectionMatches,
  readPortableRunCheckpoint,
  readPortableRunCheckpointProjection,
  type RuntimeAction,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function equal(left: unknown, right: unknown): boolean {
  return hashJsonValueProjection(left) === hashJsonValueProjection(right);
}

function actionIdentity(action: RuntimeAction) {
  return {
    protocolVersion: action.protocolVersion,
    id: action.id,
    runId: action.runId,
    stepId: action.stepId,
    type: action.type,
    ...(action.ref === undefined ? {} : { ref: action.ref }),
    input: action.input,
    inputHash: action.inputHash,
    retry: action.retry,
    requiredCapabilities: action.requiredCapabilities,
  };
}

/** 已提交的归档 checkpoint 只作交付前基线；本机交付回执继续保存在权威 Run。 */
export function readClassicSdkDeliveryCheckpoint(
  value: unknown,
  run: WorkflowRun,
  options: { projection?: boolean } = {},
): WorkflowRun | null {
  if (object(run.state).archived !== true) return null;
  if (isClassicDeliveryRepairCheckpoint(value, run)) return null;
  const baseline = (
    options.projection ? readPortableRunCheckpointProjection : readPortableRunCheckpoint
  )(value, run.runId, { preserveSourceRevision: true });
  if (!baseline) return null;
  const state = object(baseline.state);
  const delivery = baseline.actions.at(-1);
  const stepId = `${state.workflow}.archive.deliver`;
  if (
    state.archived !== true ||
    state.phase !== 'archive' ||
    !['full', 'tweak', 'hotfix'].includes(String(state.workflow)) ||
    baseline.status !== 'running' ||
    !delivery ||
    delivery.stepId !== stepId ||
    delivery.status !== 'pending' ||
    delivery.claim ||
    delivery.outcome
  )
    return null;

  const invalid = (): never => {
    throw new Error(
      `Classic SDK Run ${run.runId} does not match its archived delivery checkpoint; restore the original checkpoint and reconcile delivery on the same Run without changing its Archive or Verify history`,
    );
  };
  const deliveryOutput = baseline.outputs[stepId];
  const deliverySequence = baseline.actionContexts[delivery.id]?.sequence;
  const ownDeliveryOutput =
    deliveryOutput !== undefined && deliveryOutput.sequence === deliverySequence;
  const historicalDeliveryOutput =
    deliveryOutput !== undefined &&
    !ownDeliveryOutput &&
    baseline.actions.some(
      (previous) =>
        previous.id !== delivery.id &&
        previous.stepId === stepId &&
        previous.status === 'failed' &&
        previous.outcome?.status === 'failed' &&
        baseline.actionContexts[previous.id]?.sequence === deliveryOutput.sequence &&
        deliverySequence !== undefined &&
        deliveryOutput.sequence < deliverySequence &&
        equal(previous.outcome.output, deliveryOutput.value),
    );
  if (
    state.branchStatus !== 'pending' ||
    delivery.type !== 'invoke_skill' ||
    typeof delivery.ref !== 'string' ||
    !delivery.ref.trim() ||
    delivery.retry !== 'manual' ||
    delivery.reconciliations.length !== delivery.attempt - 1 ||
    delivery.reconciliations.some((item, index) => item.attempt !== index + 1) ||
    delivery.receipts.length >= delivery.attempt ||
    (delivery.rejectedOutcomes?.length ?? 0) !== 0 ||
    (delivery.receipts.length !== 0) !== ownDeliveryOutput ||
    (deliveryOutput !== undefined && !ownDeliveryOutput && !historicalDeliveryOutput) ||
    delivery.reason !== undefined ||
    baseline.reason !== undefined ||
    !baseline.actions.some(
      (action) =>
        action.stepId === `${state.workflow}.archive.execute` &&
        action.ref === 'classic-archive' &&
        action.status === 'succeeded',
    ) ||
    baseline.actions
      .slice(0, -1)
      .some((action) => ['pending', 'running', 'unknown'].includes(action.status)) ||
    baseline.ready.length !== 0 ||
    baseline.waits.some((wait) => wait.status === 'pending') ||
    baseline.evidenceWaits?.some((wait) => wait.status === 'pending') ||
    Object.values(baseline.joins).some((queues) =>
      Object.values(queues).some((queue) => queue.length !== 0),
    )
  )
    invalid();

  const current = run.actions.at(-1);
  if (!current) return invalid();
  if (!equal(actionIdentity(current), actionIdentity(delivery))) invalid();
  validateRuntimeActionSnapshot(
    current as unknown as RuntimeValue,
    hashJsonValueProjection(current.input),
  );
  if (
    !['pending', 'running', 'unknown', 'failed', 'succeeded'].includes(current.status) ||
    current.cancellation ||
    current.executionStop ||
    (current.executionOrigin && !equal(current.executionOrigin.workflow, run.workflow)) ||
    current.reconciliations.length !== current.attempt - 1 ||
    current.reconciliations.some((item, index) => item.attempt !== index + 1) ||
    current.attempt < delivery.attempt ||
    !equal(current.receipts.slice(0, delivery.receipts.length), delivery.receipts) ||
    !equal(
      current.reconciliations.slice(0, delivery.reconciliations.length),
      delivery.reconciliations,
    ) ||
    current.receipts.length - (current.rejectedOutcomes?.length ?? 0) > current.attempt ||
    (current.status === 'pending' && current.reason !== undefined)
  )
    invalid();

  const succeeded = current.status === 'succeeded';
  const failed = current.status === 'failed';
  if (
    run.status !== (succeeded ? 'completed' : failed ? 'failed' : 'running') ||
    run.reason !== (failed ? `ACTION_FAILED: ${stepId}` : undefined) ||
    object(run.state).branchStatus !== (succeeded ? 'handled' : state.branchStatus) ||
    run.revision <
      baseline.revision +
        (current.attempt - delivery.attempt) * 3 +
        (current.status === 'pending' ? 0 : current.status === 'running' ? 1 : 2)
  )
    invalid();
  if (
    !current.outcome &&
    current.receipts.length === delivery.receipts.length &&
    (Object.hasOwn(run.outputs, stepId) !== Object.hasOwn(baseline.outputs, stepId) ||
      (Object.hasOwn(baseline.outputs, stepId) &&
        !equal(run.outputs[stepId], baseline.outputs[stepId])))
  )
    invalid();
  if (current.outcome) {
    if (
      !equal(run.outputs[stepId], {
        sequence: baseline.actionContexts[delivery.id].sequence,
        value: current.outcome.output,
      })
    )
      invalid();
  } else if (
    Object.hasOwn(run.outputs, stepId) &&
    !(
      historicalDeliveryOutput &&
      equal(run.outputs[stepId], deliveryOutput) &&
      current.receipts.length === (current.rejectedOutcomes?.length ?? 0)
    ) &&
    (current.attempt === 1 ||
      current.receipts.length === (current.rejectedOutcomes?.length ?? 0) ||
      run.outputs[stepId].sequence !== baseline.actionContexts[delivery.id].sequence)
  )
    invalid();

  const outputs = { ...run.outputs };
  if (Object.hasOwn(baseline.outputs, stepId)) outputs[stepId] = baseline.outputs[stepId];
  else delete outputs[stepId];
  const restored: WorkflowRun = {
    ...run,
    revision: baseline.revision,
    status: baseline.status,
    state: { ...object(run.state), branchStatus: state.branchStatus } as RuntimeValue,
    actions: [...run.actions.slice(0, -1), delivery],
    outputs,
  };
  delete restored.reason;
  if (!portableRunCheckpointProjectionMatches(value, restored)) invalid();
  return baseline;
}
