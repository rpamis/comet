import path from 'node:path';
import { inspectNativeSdkQuiescence } from './native-sdk-cancellation.js';
import type { NativeSdkCheckExecutionInspection } from './native-sdk-check-execution.js';
import {
  assertNativeSdkArchiveCheckInputs,
  NativeSdkCheckResultError,
} from './native-sdk-checks.js';
import { writeNativeSdkVerificationReport } from './native-sdk-report.js';

import {
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
  hashRuntimeValue,
} from '../engine/runtime.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  applyNativeSdkArchiveSpecs,
  finalizeNativeSdkArchive,
  inspectNativePortableArchive,
  inspectNativeSdkArchiveFinalization,
  inspectNativeSdkArchiveSpecs,
} from './native-portable-archive.js';
import { parseNativePortableState } from './native-portable-state.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';

export const NATIVE_SDK_ARCHIVE_STEPS = [
  ['supervisor.parent.deliver', 'native-supervisor-parent-deliver'],
  ['archive.prepare', 'native-archive-preflight'],
  ['archive.execute', 'native-archive'],
  ['archive.finalize', 'native-archive-finalize'],
  ['supervisor.cleanup', 'native-supervisor-cleanup'],
] as const;

/** 只重试明确失败的只读预检；旧定义、未知执行和其他待处理工作保持阻塞。 */
export function nativeSdkRetryableArchivePreflight(run: Readonly<WorkflowRun>) {
  const action = run.actions.at(-1);
  return run.status === 'failed' &&
    run.reason === 'ACTION_FAILED: archive.prepare' &&
    action?.stepId === 'archive.prepare' &&
    action.ref === 'native-archive-preflight' &&
    action.type === 'call_tool' &&
    action.status === 'failed' &&
    action.retry === 'idempotent' &&
    !action.rejectedOutcomes?.some((entry) => entry.outcome.attempt === action.attempt) &&
    !run.actions.some((entry) => ['running', 'unknown', 'pending'].includes(entry.status)) &&
    !run.waits.some((wait) => wait.status === 'pending') &&
    !run.evidenceWaits?.some((wait) => wait.status === 'pending')
    ? action
    : undefined;
}

/** 仅重试 Runtime 已证实在写入前因候选漂移停止的 finalize。 */
export function nativeSdkRetryableArchiveFinalization(run: Readonly<WorkflowRun>) {
  const action = run.actions.at(-1);
  return run.status === 'failed' &&
    action?.stepId === 'archive.finalize' &&
    action.status === 'failed' &&
    action.claim?.executorId === nativeSdkArchiveFinalizeExecutor.id &&
    (action.outcome?.output as { reason?: string } | undefined)?.reason === 'candidate-drift' &&
    !action.rejectedOutcomes?.some((entry) => entry.outcome.attempt === action.attempt) &&
    !run.actions.some((entry) => ['running', 'unknown', 'pending'].includes(entry.status)) &&
    !run.waits.some((wait) => wait.status === 'pending') &&
    !run.evidenceWaits?.some((wait) => wait.status === 'pending')
    ? action
    : undefined;
}

async function archivePreflightBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const confirmed = run.waits.some(
    (wait) =>
      wait.stepId === 'verify.confirm' &&
      wait.status === 'resolved' &&
      wait.decision?.choice === 'approved',
  );
  if (
    state.phase !== 'archive' ||
    state.status !== 'active' ||
    state.loop.stage !== 'archive-ready' ||
    !state.builder_handoff ||
    !state.verification ||
    state.verification_result !== 'pass' ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'archive.prepare' ||
    action.ref !== 'native-archive-preflight' ||
    !confirmed
  )
    throw new Error('Native Archive preflight lacks a confirmed SDK result');
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef)
    throw new Error('Native artifact root changed after Run creation');
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  const reportFile = path.join(paths.changesDir, state.name, 'verification.md');
  const reportRef = path.relative(projectRoot, reportFile).replaceAll('\\', '/');
  return { state, paths, reportFile, reportRef, reportStateVersion: state.state_version - 1 };
}

async function inspectArchivePreflightOutput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const bound = await archivePreflightBinding(run, action, projectRoot);
  await assertNativeSdkArchiveCheckInputs({ run, projectRoot });
  const inspected = await inspectNativePortableArchive({
    paths: bound.paths,
    name: bound.state.name,
    state: bound.state,
    requireCurrentAcceptance: false,
    verificationReportStateVersion: bound.reportStateVersion,
    checkCapabilityOwners: false,
    derivedReport: true,
  });
  const archiveDirRef = path.relative(projectRoot, inspected.archiveDir).replaceAll('\\', '/');
  if (archiveDirRef.startsWith('../') || path.isAbsolute(archiveDirRef))
    throw new Error('Native Archive destination is outside the project');
  return {
    candidateId: bound.state.builder_handoff!.candidate_id,
    stateVersion: bound.state.state_version,
    reportRef: bound.reportRef,
    reportStateVersion: bound.reportStateVersion,
    archiveDirRef,
    ready: inspected.ready,
    blockers: inspected.blockers,
    requiresReverification: inspected.requiresReverification,
    capabilityPeers: inspected.capabilityPeers,
    specPreview: inspected.specPreview,
  };
}

async function archivePreflightOutput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  return inspectArchivePreflightOutput(run, action, projectRoot);
}

export const nativeSdkArchivePreflightExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-preflight',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-preflight',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive preflight requires a bound SDK Run');
    }
    let output;
    try {
      output = await archivePreflightOutput(run, action, context.projectRoot);
    } catch (error) {
      if (!(error instanceof NativeSdkCheckResultError)) throw error;
      return {
        status: 'failed',
        output: { ready: false, reason: 'check-failed', message: error.message },
      };
    }
    return {
      status: output.ready ? 'succeeded' : 'failed',
      output: output as unknown as RuntimeValue,
    };
  },
};

export const nativeSdkArchivePreflightValidator: RuntimeValidator = {
  id: 'comet-native-archive-preflight-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkArchivePreflightExecutor.id
    ) {
      return { accepted: false, reason: 'Native Archive preflight was not run by the Runtime' };
    }
    // 失败不授予归档权限。保留本次失败事实，不能用另一次采样覆盖瞬时诊断。
    const output = outcome.output as { ready?: unknown } | null;
    if (outcome.status === 'failed' && output?.ready === false && outcome.event === undefined)
      return { accepted: true };
    try {
      const expected = await archivePreflightOutput(run, action, context.projectRoot);
      if (
        hashRuntimeValue(outcome.output) !==
          hashRuntimeValue(expected as unknown as RuntimeValue) ||
        (outcome.status === 'succeeded') !== expected.ready ||
        outcome.event !== undefined
      ) {
        return { accepted: false, reason: 'Native Archive preflight changed after execution' };
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function archiveApplyBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  recoverApplied = false,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const preflight = run.outputs['archive.prepare']?.value as Record<string, unknown> | undefined;
  if (
    state.phase !== 'archive' ||
    state.status !== 'active' ||
    !state.builder_handoff ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'archive.execute' ||
    action.ref !== 'native-archive' ||
    !preflight ||
    preflight.ready !== true ||
    preflight.candidateId !== state.builder_handoff.candidate_id ||
    preflight.stateVersion !== state.state_version
  )
    throw new Error('Native SDK Archive apply lacks a successful preflight for its current step');
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef)
    throw new Error('Native artifact root changed after Run creation');
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  if (recoverApplied) {
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    if (
      transaction?.kind !== 'archive' ||
      transaction.journal.spec_changes.length !== state.spec_changes.length ||
      transaction.journal.spec_changes.some(
        (change, index) =>
          change.capability !== state.spec_changes[index]?.capability ||
          change.operation !== state.spec_changes[index]?.operation,
      )
    )
      throw new Error('Native Archive recovery belongs to different Spec operations');
    await inspectNativeSdkArchiveSpecs({ paths, state });
  }
  return {
    state,
    paths,
    verificationReportStateVersion: preflight.reportStateVersion as number,
    checkCapabilityOwners: false,
    derivedReport: true,
  };
}

/** 只读检查待执行的归档动作；不会调用归档执行器或写入 Specs。 */
export async function inspectNativeSdkPendingArchiveDrift(options: {
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  projectRoot: string;
}): Promise<{
  ready: false;
  reason: 'candidate-drift' | 'report-drift' | 'report-missing';
  message: string;
} | null> {
  const { run, action, projectRoot } = options;
  if (action.stepId === 'archive.finalize') await archiveFinalizeBinding(run, action, projectRoot);
  else if (action.stepId === 'archive.prepare') {
    const output = await archivePreflightOutput(run, action, projectRoot);
    if (!output.ready) throw new Error(output.blockers.join('\n'));
  } else if (action.stepId === 'archive.execute')
    await archiveApplyBinding(run, action, projectRoot);
  return null;
}

export const nativeSdkArchiveApplyExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-apply',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native Archive requires a bound SDK Run');
    const bound = await archiveApplyBinding(run, action, context.projectRoot);
    const transaction = await applyNativeSdkArchiveSpecs(bound);
    return {
      status: 'succeeded',
      output: {
        transactionId: transaction.id,
        archiveRef: transaction.archive_ref,
        stateVersion: transaction.start_state_version,
        specCount: transaction.spec_changes.length,
      },
    };
  },
};

export const nativeSdkArchiveApplyValidator: RuntimeValidator = {
  id: 'comet-native-archive-apply-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkArchiveApplyExecutor.id ||
      outcome.event !== undefined
    ) {
      return { accepted: false, reason: 'Native Archive Specs were not applied by the Runtime' };
    }
    try {
      const recovering = action.status === 'unknown';
      const { state, paths } = await archiveApplyBinding(
        run,
        action,
        context.projectRoot,
        recovering,
      );
      if (outcome.status !== 'succeeded')
        return { accepted: false, reason: 'Unexpected Native Archive apply event' };
      const expected = {
        ...(await inspectNativeSdkArchiveSpecs({ paths, state })),
      };
      return hashRuntimeValue(outcome.output) ===
        hashRuntimeValue(expected as unknown as RuntimeValue)
        ? { accepted: true }
        : { accepted: false, reason: 'Native Archive Spec application changed before commit' };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function archiveFinalizeContext(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const applied = run.outputs['archive.execute']?.value as Record<string, unknown> | undefined;
  if (
    state.phase !== 'archive' ||
    state.status !== 'done' ||
    !state.archived ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'archive.finalize' ||
    action.ref !== 'native-archive-finalize' ||
    !applied ||
    applied.stateVersion !== state.state_version - 1 ||
    typeof applied.transactionId !== 'string' ||
    typeof applied.archiveRef !== 'string'
  )
    throw new Error('Native SDK Archive finalization lacks its completed Spec transaction');
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  return { state, paths, applied };
}

async function archiveFinalizeBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  _historicalRecovery = false,
) {
  return archiveFinalizeContext(run, action, projectRoot);
}

function derivedArchiveReport(
  run: Readonly<WorkflowRun>,
  bound: Awaited<ReturnType<typeof archiveFinalizeBinding>>,
) {
  if (run.workflow.version === '1') return undefined;
  return {
    optionalView: run.workflow.version === '3',
    preservedReportsRef: `native/preserved-verification/${hashRuntimeValue(run.runId)}`,
    write: (file: string) =>
      writeNativeSdkVerificationReport({
        state: bound.state,
        paths: bound.paths,
        runId: run.runId,
        file,
      }),
  };
}

export const nativeSdkArchiveFinalizeExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-finalize',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-finalize',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive finalization requires a bound SDK Run');
    }
    const bound = await archiveFinalizeContext(run, action, context.projectRoot);
    const { state, paths, applied } = bound;
    const receipt = await finalizeNativeSdkArchive({
      paths,
      state,
      runId: run.runId,
      transactionId: applied.transactionId as string,
      archiveRef: applied.archiveRef as string,
      derivedReport: derivedArchiveReport(run, bound),
    });
    if (
      receipt.transactionId !== applied.transactionId ||
      receipt.archiveRef !== applied.archiveRef
    ) {
      throw new Error('Native SDK Archive receipt does not match applied Specs');
    }
    return { status: 'succeeded', output: receipt as unknown as RuntimeValue };
  },
};

export const nativeSdkArchiveFinalizeValidator: RuntimeValidator = {
  id: 'comet-native-archive-finalize-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkArchiveFinalizeExecutor.id ||
      outcome.event !== undefined
    ) {
      return { accepted: false, reason: 'Native Archive was not finalized by the Runtime' };
    }
    try {
      const { state, paths, applied } = await archiveFinalizeBinding(
        run,
        action,
        context.projectRoot,
        outcome.status === 'succeeded',
      );
      if (outcome.status !== 'succeeded')
        return { accepted: false, reason: 'Native Archive finalization did not succeed' };
      const receipt = await inspectNativeSdkArchiveFinalization({
        paths,
        state,
        runId: run.runId,
        archiveRef: applied.archiveRef as string,
        history: action.status === 'unknown',
        allowMissingReport: run.workflow.version === '3',
      });
      if (
        receipt.transactionId !== applied.transactionId ||
        receipt.archiveRef !== applied.archiveRef ||
        hashRuntimeValue(outcome.output) !== hashRuntimeValue(receipt as unknown as RuntimeValue)
      ) {
        return { accepted: false, reason: 'Native Archive receipt changed before commit' };
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

/** Finish the original SDK Action from durable Archive evidence after confirmed host loss. */
export async function recoverNativeSdkArchiveOutcome(options: {
  runtime: WorkflowRuntime;
  runId: string;
  projectRoot: string;
}): Promise<WorkflowRun> {
  const run = await options.runtime.inspect(options.runId);
  const action = [...run.actions]
    .reverse()
    .find(
      (entry) =>
        entry.status === 'unknown' &&
        ['archive.prepare', 'archive.execute', 'archive.finalize'].includes(entry.stepId),
    );
  if (!action || action.status !== 'unknown' || !action.claim) {
    throw new Error('Native SDK Archive has no lost Action to recover');
  }
  let output: RuntimeValue;
  let status: 'succeeded' | 'failed' = 'succeeded';
  if (action.stepId === 'archive.prepare') {
    if (action.claim.executorId !== nativeSdkArchivePreflightExecutor.id)
      throw new Error('Native SDK Archive recovery belongs to another executor');
    const inspected = await archivePreflightOutput(run, action, options.projectRoot);
    output = inspected as unknown as RuntimeValue;
    status = inspected.ready ? 'succeeded' : 'failed';
  } else if (action.stepId === 'archive.execute') {
    if (action.claim.executorId !== nativeSdkArchiveApplyExecutor.id) {
      throw new Error('Native SDK Archive recovery belongs to another executor');
    }
    const transactionPaths = await nativeProjectPaths(
      options.projectRoot,
      (run.input as { artifactRootRef: string }).artifactRootRef,
      { readOnly: true },
    );
    const prior = await readNativePortableTransaction(transactionPaths, {
      kind: 'archive',
      change: run.runId,
    });
    const recovering = prior?.kind === 'archive' && prior.journal.status === 'specs-applied';
    const bound = await archiveApplyBinding(run, action, options.projectRoot, recovering);
    const { state, paths } = bound;
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    if (transaction?.kind !== 'archive') {
      throw new Error('Native SDK Archive recovery has no frozen Spec transaction');
    }
    if (transaction.journal.status === 'prepared') {
      await applyNativeSdkArchiveSpecs(bound);
    }
    output = {
      ...(await inspectNativeSdkArchiveSpecs({ paths, state })),
    } as unknown as RuntimeValue;
  } else {
    if (action.claim.executorId !== nativeSdkArchiveFinalizeExecutor.id) {
      throw new Error('Native SDK Archive recovery belongs to another executor');
    }
    const bound = await archiveFinalizeBinding(run, action, options.projectRoot, true);
    const { state, paths, applied } = bound;
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    // 有未完成事务时继续原 finalize，重新核对候选、Specs 和报告；完整收据只补记历史结果。
    const receipt = transaction
      ? await finalizeNativeSdkArchive({
          paths,
          state,
          runId: run.runId,
          transactionId: applied.transactionId as string,
          archiveRef: applied.archiveRef as string,
          derivedReport: derivedArchiveReport(run, bound),
        })
      : await inspectNativeSdkArchiveFinalization({
          paths,
          state,
          runId: run.runId,
          archiveRef: applied.archiveRef as string,
          allowMissingReport: run.workflow.version === '3',
          history: true,
        });
    if (
      receipt.transactionId !== applied.transactionId ||
      receipt.archiveRef !== applied.archiveRef
    ) {
      throw new Error('Native SDK Archive recovery receipt belongs to another transaction');
    }
    output = receipt as unknown as RuntimeValue;
  }
  return options.runtime.recordOutcome({
    runId: run.runId,
    context: {
      requestId: `native-sdk-archive-recovery:${run.runId}:${action.id}`,
      projectRoot: options.projectRoot,
    },
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: action.rejectedOutcomes?.length
        ? `${action.id}:${action.attempt}:archive-recovery:${action.rejectedOutcomes.length}:${hashRuntimeValue(output)}`
        : `${action.id}:${action.attempt}:executor-result`,
      status,
      output,
    },
  });
}

/** 收尾旧版本取消后留下的已应用事务；保留取消终态，不恢复调度或伪造 Action 回报。 */
export async function recoverCancelledNativeSdkArchive(options: {
  projectRoot: string;
  run: WorkflowRun;
  readOnly?: boolean;
  checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[];
}): Promise<Awaited<ReturnType<typeof inspectNativeSdkArchiveFinalization>>> {
  const { run, projectRoot } = options;
  const action = run.actions.at(-1);
  const appliedAction = [...run.actions]
    .reverse()
    .find((entry) => entry.stepId === 'archive.execute');
  if (
    run.status !== 'cancelled' ||
    action?.stepId !== 'archive.finalize' ||
    action.status !== 'cancelled' ||
    (action.claim && action.claim.executorId !== nativeSdkArchiveFinalizeExecutor.id) ||
    appliedAction?.status !== 'succeeded' ||
    !(
      await inspectNativeSdkQuiescence({
        projectRoot,
        run,
        ...(options.readOnly
          ? { checkExecutionObservation: options.checkExecutionObservation }
          : {}),
      })
    ).quiescent
  ) {
    throw new Error(
      'Cancelled Native Archive recovery requires applied Specs and proof that all original executions stopped',
    );
  }
  const input = run.input as { artifactRootRef: string };
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  const transaction = await readNativePortableTransaction(paths, {
    kind: 'archive',
    change: run.runId,
  });
  if (transaction && options.readOnly)
    throw new Error('取消归档仍有待收尾事务；只读诊断不能代替显式恢复');
  const bound = await archiveFinalizeBinding(run, action, projectRoot, transaction === null);
  const receipt = transaction
    ? await finalizeNativeSdkArchive({
        paths: bound.paths,
        state: bound.state,
        runId: run.runId,
        transactionId: bound.applied.transactionId as string,
        archiveRef: bound.applied.archiveRef as string,
        derivedReport: derivedArchiveReport(run, bound),
      })
    : await inspectNativeSdkArchiveFinalization({
        paths,
        state: bound.state,
        runId: run.runId,
        archiveRef: bound.applied.archiveRef as string,
        allowMissingReport: run.workflow.version === '3',
        history: true,
      });
  if (receipt.transactionId !== bound.applied.transactionId)
    throw new Error('Native SDK Archive recovery receipt belongs to another transaction');
  return receipt;
}
