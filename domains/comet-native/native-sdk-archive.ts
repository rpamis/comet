import {
  createNativeLegacyArchiveOverlay,
  withNativeLegacyArchiveMaterials,
} from './native-archive-legacy-overlay.js';
import { inspectNativeSdkQuiescence } from './native-sdk-cancellation.js';
import type { NativeSdkCheckExecutionInspection } from './native-sdk-check-execution.js';
import { readNativeSdkArchiveOriginals } from './native-sdk-archive-originals.js';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  assertNativeSdkCandidateUnchanged,
  nativeSdkCandidateInputGate,
  NativeSdkCandidateDriftError,
  assertNativeSdkArchiveCheckInputs,
  NativeSdkCheckInputDriftError,
  NativeSdkCheckInputSnapshotError,
} from './native-sdk-checks.js';

import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
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
  nativePortableArchiveDirectory,
} from './native-portable-archive.js';
import { parseNativePortableState } from './native-portable-state.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import { readNativeApprovedShapeSemanticSnapshot } from './native-portable-requirements.js';
import { nativeEditReviewScope } from './native-edit-review-scope.js';
import { nativeShapeReviewAnchorMatches } from './native-shape-review-evidence.js';
import {
  nativeShapeArtifactContractHash,
  nativeShapeArtifactSnapshot,
} from './native-shape-semantics.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { approvedEditFingerprint, inspectEditReviews } from '../workflow-contract/edit-review.js';

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

/** Spec 内容由归档事务核对；搬迁材料另行逐文件绑定，不能借目录排除隐藏实现漂移。 */
async function archiveCandidateBinding(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
  includeGeneratedInputs = true,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { artifactRootRef: string };
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  const active = path.join(paths.changesDir, state.name);
  const archived = nativePortableArchiveDirectory(paths, state);
  const ref = (file: string) => path.relative(projectRoot, file).replaceAll('\\', '/');
  const archiveOwnedPaths = [
    active,
    archived,
    ...state.spec_changes.map(({ capability }) => path.join(paths.specsDir, capability, 'spec.md')),
  ].map(ref);
  const source = await fs.lstat(active).then(
    () => active,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return archived;
    },
  );
  const materials: Array<{ ref: string; digest: string; mode: number }> = [];
  const shape = (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))?.snapshot;
  const scope = state.builder_handoff ? nativeEditReviewScope(paths, state) : null;
  let reviews: Awaited<ReturnType<typeof inspectEditReviews>> | undefined;
  async function visit(directory: string) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Native Archive materials contain an unsafe directory');
    for (const entry of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, entry);
      const relative = path.relative(source, file).replaceAll('\\', '/');
      if (['verification.md', 'comet-state.yaml', 'children.yaml'].includes(relative)) continue;
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) await visit(file);
      else {
        let { digest } = await hashProtectedProjectFile(projectRoot, ref(file), {
          label: 'Native Archive material',
        });
        const approved = shape?.artifacts.find((artifact) => artifact.source === relative);
        if (scope && approved && digest !== approved.contentHash) {
          reviews ??= await inspectEditReviews(scope);
          const current = await readNativeBoundedTextFile({
            root: projectRoot,
            ref: ref(file),
            maxBytes: null,
          });
          const reviewedRef = ref(path.join(paths.changesDir, state.name, approved.source));
          const reviewed =
            current.hash === digest
              ? await approvedEditFingerprint(scope, reviewedRef, current.text, reviews)
              : null;
          const observed = nativeShapeArtifactSnapshot(approved.source, current.text);
          if (
            reviewed &&
            (await nativeShapeReviewAnchorMatches(scope, approved, reviewed.beforeHash)) &&
            nativeShapeArtifactContractHash({
              ...observed,
              commentsHash: approved.commentsHash,
            }) === nativeShapeArtifactContractHash(approved)
          )
            digest = approved.contentHash;
        }
        materials.push({ ref: relative, digest, mode: stat.mode & 0o777 });
      }
    }
  }
  await visit(source);
  const candidateGate = await nativeSdkCandidateInputGate({
    run,
    projectRoot,
    archiveOwnedPaths,
    includeGeneratedInputs,
  });
  if (candidateGate === null)
    throw new NativeSdkCandidateDriftError(
      'Native Archive 无法完整复核候选实现；请恢复候选或重新验收',
    );
  const binding = hashRuntimeValue({ candidateGate, materials });
  return includeGeneratedInputs ? `v2:${binding}` : binding;
}

async function assertArchiveCandidate(run: Readonly<WorkflowRun>, projectRoot: string) {
  const preflight = run.outputs['archive.prepare']?.value as
    { candidateBinding?: string } | undefined;
  if (!preflight?.candidateBinding) {
    // 旧 Run 尚无归档摘要时只接受原检查仍能证明的候选，绝不从当前文件静默重建信任。
    try {
      await assertNativeSdkCandidateUnchanged({ run, projectRoot, requireEvidence: true });
    } catch (error) {
      if (!(error instanceof NativeSdkCandidateDriftError)) throw error;
      const state = parseNativePortableState(run.state);
      const paths = await nativeProjectPaths(
        projectRoot,
        (run.input as { artifactRootRef: string }).artifactRootRef,
        { readOnly: true },
      );
      const transaction = await readNativePortableTransaction(paths, {
        kind: 'archive',
        change: state.name,
      });
      if (transaction?.kind !== 'archive') throw error;
      if (
        transaction.journal.start_state_version !==
        state.state_version - (state.archived ? 1 : 0)
      )
        throw new Error('旧 Archive 事务与当前状态不匹配', { cause: error });
      const originals = await readNativeSdkArchiveOriginals(paths, run.runId, transaction.journal);
      const legacyArchiveOverlay = await withNativeLegacyArchiveMaterials({
        paths,
        transaction: transaction.journal,
        overlay: createNativeLegacyArchiveOverlay({
          paths,
          transaction: transaction.journal,
          originals,
        }),
      });
      await assertNativeSdkCandidateUnchanged({
        run,
        projectRoot,
        requireEvidence: true,
        legacyArchiveOverlay,
      });
    }
    return;
  }
  if (
    (await archiveCandidateBinding(
      run,
      projectRoot,
      preflight.candidateBinding.startsWith('v2:'),
    )) !== preflight.candidateBinding
  )
    throw new NativeSdkCandidateDriftError(
      'Native Archive 候选实现或搬迁材料已变化；请恢复已确认候选后重试，或在写入 Specs 前重新验收',
    );
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
  ) {
    throw new Error('Native Archive preflight lacks a confirmed SDK candidate');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
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
  return {
    state,
    paths,
    reportFile,
    reportRef,
    priorReportSha256: prior.reportSha256,
    reportStateVersion: prior.stateVersion as number,
  };
}

async function inspectArchivePreflightOutput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const bound = await archivePreflightBinding(run, action, projectRoot);
  await assertNativeSdkCandidateUnchanged({ run, projectRoot, requireEvidence: true });
  try {
    await assertNativeSdkArchiveCheckInputs({ run, projectRoot });
  } catch (error) {
    if (
      !(error instanceof NativeSdkCheckInputDriftError) &&
      !(error instanceof NativeSdkCheckInputSnapshotError)
    )
      throw error;
    throw new NativeSdkCandidateDriftError(
      `Native 归档前检查输入已变化或无法完整复核；请恢复原输入或重新验收：${error.message}`,
    );
  }
  const candidateBinding = await archiveCandidateBinding(run, projectRoot);
  const report = await hashProtectedProjectFile(projectRoot, bound.reportRef, {
    label: 'Native SDK verification report',
  });
  if (report.digest !== bound.priorReportSha256) {
    throw new Error('Native verification report changed after Archive confirmation');
  }
  const inspected = await inspectNativePortableArchive({
    paths: bound.paths,
    name: bound.state.name,
    state: bound.state,
    requireCurrentAcceptance: true,
    verificationReportStateVersion: bound.reportStateVersion,
  });
  const archiveDirRef = path.relative(projectRoot, inspected.archiveDir).replaceAll('\\', '/');
  if (archiveDirRef.startsWith('../') || path.isAbsolute(archiveDirRef)) {
    throw new Error('Native Archive destination is outside the project');
  }
  return {
    candidateBinding,
    candidateId: bound.state.builder_handoff!.candidate_id,
    stateVersion: bound.state.state_version,
    reportRef: bound.reportRef,
    reportSha256: report.digest,
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
  try {
    return await inspectArchivePreflightOutput(run, action, projectRoot);
  } catch (error) {
    if (!(error instanceof NativeSdkCandidateDriftError)) throw error;
    return { ready: false, reason: 'candidate-drift', message: error.message };
  }
}

export const nativeSdkArchivePreflightExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-preflight',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-preflight',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive preflight requires a bound SDK Run');
    }
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
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  const reportRef = path
    .relative(projectRoot, path.join(paths.changesDir, state.name, 'verification.md'))
    .replaceAll('\\', '/');
  const preparedAction = [...run.actions]
    .reverse()
    .find((entry) => entry.stepId === 'archive.prepare' && entry.status === 'succeeded');
  const legacyReport =
    preflight.reportStateVersion === undefined && preparedAction?.retry === 'manual';
  const reportStateVersion = legacyReport ? state.state_version : preflight.reportStateVersion;
  if (
    preflight.reportRef !== reportRef ||
    !Number.isSafeInteger(reportStateVersion) ||
    (reportStateVersion as number) > state.state_version ||
    (!legacyReport && reportStateVersion === state.state_version)
  ) {
    throw new Error('Native SDK Archive preflight lacks the confirmed report binding');
  }
  const report = await hashProtectedProjectFile(projectRoot, reportRef, {
    label: 'Native SDK verification report',
  });
  if (report.digest !== preflight.reportSha256)
    throw new Error('Native verification report changed after Archive preflight');
  await assertArchiveCandidate(run, projectRoot);
  return { state, paths, verificationReportStateVersion: reportStateVersion as number };
}

async function archiveUnappliedDrift(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
  error: unknown,
) {
  if (!(error instanceof NativeSdkCandidateDriftError)) return null;
  const state = parseNativePortableState(run.state);
  const paths = await nativeProjectPaths(
    projectRoot,
    (run.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  if (await readNativePortableTransaction(paths, { kind: 'archive', change: state.name }))
    return null;
  return { ready: false, reason: 'candidate-drift', message: error.message };
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
  if (action.stepId === 'archive.finalize') {
    await archiveFinalizeBinding(run, action, projectRoot);
    return null;
  }
  if (!['archive.prepare', 'archive.execute'].includes(action.stepId)) return null;
  const state = parseNativePortableState(run.state);
  const input = run.input as { artifactRootRef: string };
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  const changeRef = path
    .relative(projectRoot, path.join(paths.changesDir, state.name))
    .replaceAll('\\', '/');
  const change = await inspectProtectedProjectPath(projectRoot, changeRef, {
    label: 'Native change directory',
    expected: 'directory',
  });
  if (!change.exists) throw new Error('Native change directory is missing');
  const report = await inspectProtectedProjectPath(projectRoot, `${changeRef}/verification.md`, {
    label: 'Native SDK verification report',
    expected: 'file',
  });
  if (!report.exists)
    return {
      ready: false,
      reason: 'report-missing',
      message:
        'Native verification report is missing; keep existing files and reverify the candidate',
    };
  if (action.stepId === 'archive.prepare') {
    try {
      const output = await archivePreflightOutput(run, action, projectRoot);
      return !output.ready && 'reason' in output && output.reason === 'candidate-drift'
        ? { ready: false, reason: 'candidate-drift', message: output.message }
        : null;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Native verification report changed after Archive confirmation'
      )
        return { ready: false, reason: 'report-drift', message: error.message };
      throw error;
    }
  }
  try {
    await archiveApplyBinding(run, action, projectRoot);
    return null;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Native verification report changed after Archive preflight'
    )
      return { ready: false, reason: 'report-drift', message: error.message };
    const drift = await archiveUnappliedDrift(run, projectRoot, error);
    if (drift) return { ready: false, reason: 'candidate-drift', message: drift.message };
    throw error;
  }
}

export const nativeSdkArchiveApplyExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-apply',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native Archive requires a bound SDK Run');
    let bound: Awaited<ReturnType<typeof archiveApplyBinding>>;
    try {
      bound = await archiveApplyBinding(run, action, context.projectRoot);
    } catch (error) {
      const output = await archiveUnappliedDrift(run, context.projectRoot, error);
      if (!output) throw error;
      return { status: 'failed', output };
    }
    const { state, paths } = bound;
    await applyNativeSdkArchiveSpecs(bound);
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
      outcome.event !== undefined
    ) {
      return { accepted: false, reason: 'Native Archive Specs were not applied by the Runtime' };
    }
    try {
      const { state, paths } = await archiveApplyBinding(run, action, context.projectRoot);
      if (outcome.status !== 'succeeded')
        return { accepted: false, reason: 'Unexpected Native Archive apply event' };
      const expected = await inspectNativeSdkArchiveSpecs({ paths, state });
      return hashRuntimeValue(outcome.output) ===
        hashRuntimeValue(expected as unknown as RuntimeValue)
        ? { accepted: true }
        : { accepted: false, reason: 'Native Archive Spec application changed before commit' };
    } catch (error) {
      const drift = await archiveUnappliedDrift(run, context.projectRoot, error);
      if (
        drift &&
        outcome.status === 'failed' &&
        hashRuntimeValue(outcome.output) === hashRuntimeValue(drift)
      )
        return { accepted: true };
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function archiveFinalizeBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  historicalRecovery = false,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const applied = run.outputs['archive.execute']?.value as Record<string, unknown> | undefined;
  const preflight = run.outputs['archive.prepare']?.value as Record<string, unknown> | undefined;
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
    typeof applied.archiveRef !== 'string' ||
    typeof preflight?.reportSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(preflight.reportSha256)
  ) {
    throw new Error('Native SDK Archive finalization lacks applied Specs');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
  if (
    !historicalRecovery ||
    ((run.outputs['archive.prepare']?.value as { candidateBinding?: unknown })?.candidateBinding &&
      !['unknown', 'cancelled'].includes(action.status))
  )
    await assertArchiveCandidate(run, projectRoot);
  return { state, paths, applied, priorReportSha256: preflight.reportSha256 };
}

export const nativeSdkArchiveFinalizeExecutor: RuntimeExecutor = {
  id: 'comet-native-archive-finalize',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-archive-finalize',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native Archive finalization requires a bound SDK Run');
    }
    let bound: Awaited<ReturnType<typeof archiveFinalizeBinding>>;
    try {
      bound = await archiveFinalizeBinding(run, action, context.projectRoot);
    } catch (error) {
      if (!(error instanceof NativeSdkCandidateDriftError)) throw error;
      return { status: 'failed', output: { reason: 'candidate-drift', message: error.message } };
    }
    const { state, paths, applied } = bound;
    const receipt = await finalizeNativeSdkArchive({
      paths,
      state,
      runId: run.runId,
      transactionId: applied.transactionId as string,
      archiveRef: applied.archiveRef as string,
      priorReportSha256: bound.priorReportSha256,
      validateCandidate: () => assertArchiveCandidate(run, context.projectRoot!),
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
      if (
        error instanceof NativeSdkCandidateDriftError &&
        outcome.status === 'failed' &&
        hashRuntimeValue(outcome.output) ===
          hashRuntimeValue({ reason: 'candidate-drift', message: error.message })
      )
        return { accepted: true };
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
    output = inspected as RuntimeValue;
    status = inspected.ready ? 'succeeded' : 'failed';
  } else if (action.stepId === 'archive.execute') {
    if (action.claim.executorId !== nativeSdkArchiveApplyExecutor.id) {
      throw new Error('Native SDK Archive recovery belongs to another executor');
    }
    const bound = await archiveApplyBinding(run, action, options.projectRoot);
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
    output = (await inspectNativeSdkArchiveSpecs({ paths, state })) as unknown as RuntimeValue;
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
          priorReportSha256: bound.priorReportSha256,
          validateCandidate: () => assertArchiveCandidate(run, options.projectRoot),
        })
      : await inspectNativeSdkArchiveFinalization({
          paths,
          state,
          runId: run.runId,
          archiveRef: applied.archiveRef as string,
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
        priorReportSha256: bound.priorReportSha256,
        validateCandidate: () => assertArchiveCandidate(run, projectRoot),
      })
    : await inspectNativeSdkArchiveFinalization({
        paths,
        state: bound.state,
        runId: run.runId,
        archiveRef: bound.applied.archiveRef as string,
        history: true,
      });
  if (receipt.transactionId !== bound.applied.transactionId)
    throw new Error('Native SDK Archive recovery receipt belongs to another transaction');
  return receipt;
}
