import { createHash } from 'node:crypto';
import path from 'node:path';

import { hashProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
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
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { parseNativePortableState } from './native-portable-state.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import {
  renderNativeVerificationReport,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';

export const NATIVE_SDK_ARCHIVE_STEPS = [
  ['supervisor.parent.deliver', 'native-supervisor-parent-deliver'],
  ['archive.prepare', 'native-archive-preflight'],
  ['archive.execute', 'native-archive'],
  ['archive.finalize', 'native-archive-finalize'],
  ['supervisor.cleanup', 'native-supervisor-cleanup'],
] as const;

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
  ) {
    throw new Error('Native Archive preflight lacks a confirmed SDK candidate');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const reportFile = path.join(paths.changesDir, state.name, 'verification.md');
  const reportRef = path.relative(projectRoot, reportFile).replaceAll('\\', '/');
  const prior = run.outputs['verify.report']?.value as Record<string, unknown> | undefined;
  if (
    !prior ||
    prior.candidateId !== state.builder_handoff.candidate_id ||
    prior.reportRef !== reportRef ||
    typeof prior.reportSha256 !== 'string' ||
    !Number.isSafeInteger(prior.stateVersion) ||
    (prior.stateVersion as number) >= state.state_version
  ) {
    throw new Error('Native Archive preflight lacks the confirmed verification report');
  }
  return { state, paths, reportFile, reportRef, priorReportSha256: prior.reportSha256 };
}

async function archivePreflightOutput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const bound = await archivePreflightBinding(run, action, projectRoot);
  const report = await hashProtectedProjectFile(projectRoot, bound.reportRef, {
    label: 'Native SDK verification report',
  });
  const expected = createHash('sha256')
    .update(renderNativeVerificationReport(bound.state))
    .digest('hex');
  if (report.digest !== expected) {
    throw new Error('Native verification report changed after Archive confirmation');
  }
  const inspected = await inspectNativePortableArchive({
    paths: bound.paths,
    name: bound.state.name,
    state: bound.state,
    requireCurrentAcceptance: true,
  });
  const archiveDirRef = path.relative(projectRoot, inspected.archiveDir).replaceAll('\\', '/');
  if (archiveDirRef.startsWith('../') || path.isAbsolute(archiveDirRef)) {
    throw new Error('Native Archive destination is outside the project');
  }
  return {
    candidateId: bound.state.builder_handoff!.candidate_id,
    stateVersion: bound.state.state_version,
    reportRef: bound.reportRef,
    reportSha256: report.digest,
    archiveDirRef,
    ready: inspected.ready,
    blockers: inspected.blockers,
    requiresReverification: inspected.requiresReverification,
    capabilityPeers: inspected.capabilityPeers,
    specPreview: inspected.specPreview,
  };
}

export const nativeSdkArchivePreflightExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-preflight',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-preflight',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive preflight requires a bound SDK Run');
    }
    const bound = await archivePreflightBinding(run, action, context.projectRoot);
    const drift = await inspectNativePortableAcceptanceDrift(bound);
    if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
    const previous = await hashProtectedProjectFile(context.projectRoot, bound.reportRef, {
      label: 'Native SDK verification report',
    });
    if (previous.digest !== bound.priorReportSha256) {
      throw new Error('Native verification report changed after user confirmation');
    }
    await writeNativeVerificationReport({ file: bound.reportFile, state: bound.state });
    const output = await archivePreflightOutput(run, action, context.projectRoot);
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
    try {
      const expected = await archivePreflightOutput(run, action, context.projectRoot);
      if (
        hashRuntimeValue(outcome.output) !==
          hashRuntimeValue(expected as unknown as RuntimeValue) ||
        (outcome.status === 'succeeded') !== expected.ready
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
  ) {
    throw new Error('Native SDK Archive apply lacks a current successful preflight');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  return { state, paths };
}

export const nativeSdkArchiveApplyExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-apply',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native Archive requires a bound SDK Run');
    const { state, paths } = await archiveApplyBinding(run, action, context.projectRoot);
    await applyNativeSdkArchiveSpecs({ paths, state });
    return {
      status: 'succeeded',
      output: (await inspectNativeSdkArchiveSpecs({ paths, state })) as unknown as RuntimeValue,
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
      outcome.status !== 'succeeded'
    ) {
      return { accepted: false, reason: 'Native Archive Specs were not applied by the Runtime' };
    }
    try {
      const { state, paths } = await archiveApplyBinding(run, action, context.projectRoot);
      const expected = await inspectNativeSdkArchiveSpecs({ paths, state });
      return hashRuntimeValue(outcome.output) ===
        hashRuntimeValue(expected as unknown as RuntimeValue)
        ? { accepted: true }
        : { accepted: false, reason: 'Native Archive Spec application changed before commit' };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function archiveFinalizeBinding(
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
  ) {
    throw new Error('Native SDK Archive finalization lacks applied Specs');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  return { state, paths, applied };
}

export const nativeSdkArchiveFinalizeExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-finalize',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-finalize',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive finalization requires a bound SDK Run');
    }
    const { state, paths, applied } = await archiveFinalizeBinding(
      run,
      action,
      context.projectRoot,
    );
    const receipt = await finalizeNativeSdkArchive({ paths, state, runId: run.runId });
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
      outcome.status !== 'succeeded'
    ) {
      return { accepted: false, reason: 'Native Archive was not finalized by the Runtime' };
    }
    try {
      const { state, paths, applied } = await archiveFinalizeBinding(
        run,
        action,
        context.projectRoot,
      );
      const receipt = await inspectNativeSdkArchiveFinalization({
        paths,
        state,
        runId: run.runId,
        archiveRef: applied.archiveRef as string,
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
        ['archive.execute', 'archive.finalize'].includes(entry.stepId),
    );
  if (!action || action.status !== 'unknown' || !action.claim) {
    throw new Error('Native SDK Archive has no lost Action to recover');
  }
  let output: RuntimeValue;
  if (action.stepId === 'archive.execute') {
    if (action.claim.executorId !== nativeSdkArchiveApplyExecutor.id) {
      throw new Error('Native SDK Archive recovery belongs to another executor');
    }
    const { state, paths } = await archiveApplyBinding(run, action, options.projectRoot);
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    if (transaction?.kind !== 'archive') {
      throw new Error('Native SDK Archive recovery has no frozen Spec transaction');
    }
    if (transaction.journal.status === 'prepared') {
      await applyNativeSdkArchiveSpecs({ paths, state });
    }
    output = (await inspectNativeSdkArchiveSpecs({ paths, state })) as unknown as RuntimeValue;
  } else {
    if (action.claim.executorId !== nativeSdkArchiveFinalizeExecutor.id) {
      throw new Error('Native SDK Archive recovery belongs to another executor');
    }
    const { state, paths, applied } = await archiveFinalizeBinding(
      run,
      action,
      options.projectRoot,
    );
    const receipt = await inspectNativeSdkArchiveFinalization({
      paths,
      state,
      runId: run.runId,
      archiveRef: applied.archiveRef as string,
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
      outcomeId: `${action.id}:${action.attempt}:executor-result`,
      status: 'succeeded',
      output,
    },
  });
}
