import { assertNativeEditReviewsComplete } from './native-edit-review.js';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
  ensureProtectedProjectDirectory,
} from '../workflow-contract/protected-project-path.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { atomicWriteText } from './native-atomic-file.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';
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
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  assertNativeSdkCandidateUnchanged,
  NativeSdkCandidateDriftError,
  NativeSdkCheckInputDriftError,
  NativeSdkCheckInputSnapshotError,
  nativeSdkCanRefreshChecks,
  nativeSdkCurrentCheckSummaries,
} from './native-sdk-checks.js';
import {
  renderNativeVerificationReport,
  writeNativeVerificationReport,
  nativeVerificationResultHash,
  nativeSdkVerificationReportOutput,
} from './native-verification-report-v2.js';

class NativeSdkReportDriftError extends Error {}

/** 确认绑定结构化验收结果；Markdown 只供阅读。 */
export function nativeSdkVerificationReportMetadata(
  state: NativePortableState,
  artifactRootRef: string,
) {
  return {
    candidateId: state.builder_handoff!.candidate_id,
    reportRef: path.posix.join(
      artifactRootRef.replaceAll('\\', '/'),
      'comet',
      'changes',
      state.name,
      'verification.md',
    ),
    reportSha256: createHash('sha256').update(renderNativeVerificationReport(state)).digest('hex'),
    stateVersion: state.state_version,
    verificationResultHash: nativeVerificationResultHash(state),
  };
}

/** 结果提交后可重试生成阅读视图，调用方单独报告写入失败。 */
export async function refreshNativeSdkVerificationReport(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
): Promise<void> {
  if (run.workflow.version !== '3') return;
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    !run.waits.some((wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending')
  )
    return;
  const report = nativeSdkVerificationReportOutput(run);
  if (!report) throw new Error('Native verification view lacks its confirmed result binding');
  const artifactRootRef = (run.input as { artifactRootRef: string }).artifactRootRef;
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== artifactRootRef)
    throw new Error('Native artifact root changed after Run creation');
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
  await writeNativeSdkVerificationReport({
    state,
    paths,
    runId: run.runId,
    file: path.join(paths.changesDir, state.name, 'verification.md'),
    previousReportSha256: report.reportSha256,
  });
}

/** 归档收据保持原值，阅读文件的缺失或改写只影响当前展示。 */
export async function nativeSdkArchivedReportWarning(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
): Promise<{ code: 'NATIVE_REPORT_PENDING'; message: string; reportRef: string } | undefined> {
  if (run.workflow.version !== '3' || run.status !== 'completed') return undefined;
  const state = parseNativePortableState(run.state);
  if (!state.archived) return undefined;
  const receipt = run.outputs['archive.finalize']?.value as { archiveRef?: unknown } | undefined;
  if (
    typeof receipt?.archiveRef !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(receipt.archiveRef)
  )
    return undefined;
  const paths = await nativeProjectPaths(
    projectRoot,
    (run.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  const file = path.join(paths.archiveDir, receipt.archiveRef, 'verification.md');
  const reportRef = path.relative(projectRoot, file).replaceAll('\\', '/');
  const current = await readNativeBoundedTextFile({
    root: paths.archiveDir,
    ref: `${receipt.archiveRef}/verification.md`,
    maxBytes: null,
  }).catch(() => null);
  const expected = createHash('sha256').update(renderNativeVerificationReport(state)).digest('hex');
  if (current?.hash === expected) return undefined;
  return {
    code: 'NATIVE_REPORT_PENDING',
    message: current
      ? '归档已完成，验证报告保留现有原文；阅读视图与结构化验收结果不同。'
      : '归档已完成，验证报告阅读视图尚不可用；结构化验收结果和归档收据已保存。',
    reportRef,
  };
}

function reportInput(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    !state.verification ||
    !state.builder_handoff ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'verify.report' ||
    action.ref !== 'native-verification-report'
  ) {
    throw new Error('Native verification report is not bound to the current passed candidate');
  }
  return { state, artifactRootRef: input.artifactRootRef };
}

async function reportTarget(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  root: string,
) {
  const { state, artifactRootRef } = reportInput(run, action);
  const config = await readProjectConfig(root);
  if (!config || config.native.artifact_root !== artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(root, artifactRootRef);
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
  const file = path.join(paths.changesDir, state.name, 'verification.md');
  const ref = path.relative(root, file).replaceAll('\\', '/');
  await inspectProtectedProjectPath(root, ref, {
    label: 'Native SDK verification report',
    expected: 'file',
  });
  return { state, file, ref, paths };
}

/** 写入阅读视图前保留用户原文，成功后返回实际文件摘要。 */
export async function writeNativeSdkVerificationReport(options: {
  state: NativePortableState;
  paths: NativeProjectPaths;
  runId: string;
  file: string;
  previousReportSha256?: unknown;
}) {
  const { state, paths, runId, file } = options;
  const readCurrent = () =>
    readNativeBoundedTextFile({
      root: path.dirname(file),
      ref: path.basename(file),
      maxBytes: null,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  const original = await readCurrent();
  const generatedHash = createHash('sha256')
    .update(renderNativeVerificationReport(state))
    .digest('hex');
  if (original?.hash === generatedHash) return { reportSha256: generatedHash };
  let preservedReportRef: string | undefined;
  if (
    original &&
    original.hash !== options.previousReportSha256 &&
    original.hash !== generatedHash
  ) {
    const directory = `native/preserved-verification/${hashRuntimeValue(runId)}`;
    await ensureProtectedProjectDirectory(paths.workspaceRuntimeRoot, directory, {
      label: 'Native preserved verification report',
    });
    preservedReportRef = `${directory}/${original.hash}.md`;
    const backup = path.join(paths.workspaceRuntimeRoot, ...preservedReportRef.split('/'));
    let originalText = original.text;
    if (createHash('sha256').update(originalText).digest('hex') !== original.hash) {
      const withBom = `\uFEFF${originalText}`;
      if (createHash('sha256').update(withBom).digest('hex') !== original.hash)
        throw new Error('Native verification report bytes cannot be preserved');
      originalText = withBom;
    }
    try {
      await atomicWriteText(backup, originalText, {
        containedRoot: paths.workspaceRuntimeRoot,
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const saved = await readNativeBoundedTextFile({
      root: paths.workspaceRuntimeRoot,
      ref: preservedReportRef,
      maxBytes: null,
    });
    if (saved.hash !== original.hash)
      throw new Error('Native preserved verification report changed');
  }
  await writeNativeVerificationReport({
    file,
    state,
    beforeCommit: async () => {
      const current = await readCurrent();
      if ((current?.hash ?? null) !== (original?.hash ?? null))
        throw new Error('Native verification report changed while preserving user edits');
    },
  });
  const ref = path.relative(paths.projectRoot, file).replaceAll('\\', '/');
  const current = await hashProtectedProjectFile(paths.projectRoot, ref, {
    label: 'Native SDK verification report',
  });
  return {
    reportSha256: current.digest,
    ...(preservedReportRef ? { preservedReportRef, preservedReportSha256: original!.hash } : {}),
  };
}

export const nativeSdkReportExecutor: RuntimeExecutor = {
  id: 'comet-native-report',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-verification-report',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native report requires a bound SDK Run');
    const { state, file, ref, paths } = await reportTarget(run, action, context.projectRoot);
    const previous = run.outputs['verify.report']?.value as { reportSha256?: unknown } | undefined;
    const written = await writeNativeSdkVerificationReport({
      state,
      paths,
      runId: run.runId,
      file,
      previousReportSha256: previous?.reportSha256,
    });
    return {
      status: 'succeeded',
      output: {
        candidateId: state.builder_handoff!.candidate_id,
        reportRef: ref,
        ...written,
        stateVersion: state.state_version,
        ...(run.workflow.version !== '1'
          ? { verificationResultHash: nativeVerificationResultHash(state) }
          : {}),
      } as unknown as RuntimeValue,
    };
  },
};

export const nativeSdkReportValidator: RuntimeValidator = {
  id: 'comet-native-report-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkReportExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return { accepted: false, reason: 'Native report was not produced by the Runtime executor' };
    }
    try {
      const { state, ref, paths } = await reportTarget(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      const expected = createHash('sha256')
        .update(renderNativeVerificationReport(state))
        .digest('hex');
      const actual =
        run.workflow.version !== '1'
          ? { digest: expected }
          : await hashProtectedProjectFile(context.projectRoot, ref, {
              label: 'Native SDK verification report',
            });
      if (
        !output ||
        output.candidateId !== state.builder_handoff!.candidate_id ||
        output.reportRef !== ref ||
        output.reportSha256 !== actual.digest ||
        output.stateVersion !== state.state_version ||
        actual.digest !== expected
      ) {
        return { accepted: false, reason: 'Native verification report changed after generation' };
      }
      if (
        run.workflow.version !== '1' &&
        output.verificationResultHash !== nativeVerificationResultHash(state)
      )
        return { accepted: false, reason: 'Native report result does not match accepted evidence' };
      if (output.preservedReportRef !== undefined || output.preservedReportSha256 !== undefined) {
        const expectedRef = `native/preserved-verification/${hashRuntimeValue(run.runId)}/${String(output.preservedReportSha256)}.md`;
        if (
          typeof output.preservedReportSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(output.preservedReportSha256) ||
          output.preservedReportRef !== expectedRef
        )
          return { accepted: false, reason: 'Native preserved report reference is invalid' };
        const saved = await readNativeBoundedTextFile({
          root: paths.workspaceRuntimeRoot,
          ref: expectedRef,
          maxBytes: null,
        });
        if (saved.hash !== output.preservedReportSha256)
          return { accepted: false, reason: 'Native preserved report content changed' };
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

async function revalidatedReport(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    !state.builder_handoff ||
    !state.verification ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    action.stepId !== 'verify.revalidate' ||
    action.ref !== 'native-report-revalidate' ||
    !run.waits.some(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    )
  ) {
    throw new Error('Native report revalidation lacks an approved current Verifier result');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native artifact root changed after Run creation');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
  await nativeSdkCurrentCheckSummaries({ run, projectRoot });
  await assertNativeEditReviewsComplete(paths, state);
  const file = path.join(paths.changesDir, state.name, 'verification.md');
  const ref = path.relative(projectRoot, file).replaceAll('\\', '/');
  const prior = nativeSdkVerificationReportOutput(run);
  if (
    !prior ||
    prior.candidateId !== state.builder_handoff.candidate_id ||
    prior.reportRef !== ref ||
    prior.stateVersion !== state.state_version ||
    typeof prior.reportSha256 !== 'string'
  ) {
    throw new Error('Native report approval is stale for the current candidate');
  }
  if (run.workflow.version !== '1') {
    const verificationResultHash = nativeVerificationResultHash(state);
    if (prior.verificationResultHash !== verificationResultHash)
      throw new Error('Native verification result changed after user approval');
    return {
      candidateId: state.builder_handoff.candidate_id,
      reportRef: ref,
      reportSha256: prior.reportSha256,
      stateVersion: state.state_version,
      verificationResultHash,
    };
  }
  const actual = await hashProtectedProjectFile(projectRoot, ref, {
    label: 'Native SDK verification report',
  });
  const expected = createHash('sha256').update(renderNativeVerificationReport(state)).digest('hex');
  if (actual.digest !== prior.reportSha256 || actual.digest !== expected) {
    throw new NativeSdkReportDriftError('Native verification report changed after user approval');
  }
  return {
    candidateId: state.builder_handoff.candidate_id,
    reportRef: ref,
    reportSha256: actual.digest,
    stateVersion: state.state_version,
  };
}

async function checkDriftOutcome(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
  error: NativeSdkCheckInputDriftError,
) {
  let refreshChecks =
    !(error instanceof NativeSdkCheckInputSnapshotError) && nativeSdkCanRefreshChecks(run);
  let message = error.message;
  try {
    await assertNativeSdkCandidateUnchanged({ run, projectRoot });
  } catch (candidateError) {
    if (!(candidateError instanceof NativeSdkCandidateDriftError)) throw candidateError;
    refreshChecks = false;
    message = candidateError.message;
  }
  return { reason: 'check-input-drift', refreshChecks, message };
}

export const nativeSdkReportRevalidationExecutor: RuntimeExecutor = {
  id: 'comet-native-report-revalidate',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-report-revalidate',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) {
      throw new Error('Native report revalidation requires a bound SDK Run');
    }
    try {
      return {
        status: 'succeeded',
        output: (await revalidatedReport(
          run,
          action,
          context.projectRoot,
        )) as unknown as RuntimeValue,
      };
    } catch (error) {
      if (error instanceof NativeSdkReportDriftError) {
        return { status: 'failed', output: { reason: 'report-drift' } };
      }
      if (error instanceof NativeSdkCheckInputDriftError) {
        return {
          status: 'failed',
          output: await checkDriftOutcome(run, context.projectRoot, error),
        };
      }
      throw error;
    }
  },
};

export const nativeSdkReportRevalidationValidator: RuntimeValidator = {
  id: 'comet-native-report-revalidation-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkReportRevalidationExecutor.id ||
      !['succeeded', 'failed'].includes(outcome.status)
    ) {
      return { accepted: false, reason: 'Native report was not revalidated by the Runtime' };
    }
    try {
      const expected = await revalidatedReport(run, action, context.projectRoot);
      if (outcome.status !== 'succeeded') {
        return { accepted: false, reason: 'Native report is current but outcome says it drifted' };
      }
      return hashRuntimeValue(outcome.output) ===
        hashRuntimeValue(expected as unknown as RuntimeValue)
        ? { accepted: true }
        : { accepted: false, reason: 'Native report revalidation changed before commit' };
    } catch (error) {
      if (error instanceof NativeSdkReportDriftError && outcome.status === 'failed') {
        return hashRuntimeValue(outcome.output) === hashRuntimeValue({ reason: 'report-drift' })
          ? { accepted: true }
          : { accepted: false, reason: 'Native report drift outcome is invalid' };
      }
      if (error instanceof NativeSdkCheckInputDriftError && outcome.status === 'failed') {
        return hashRuntimeValue(outcome.output) ===
          hashRuntimeValue(await checkDriftOutcome(run, context.projectRoot, error))
          ? { accepted: true }
          : { accepted: false, reason: 'Native check input drift outcome is invalid' };
      }
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

/** 仅自动生成本次独立验收的报告；用户确认仍由原 Wait 决定。 */
export function nativeSdkAutomaticReportAction(
  run: Readonly<WorkflowRun>,
  committed: { actionId: string; outcomeId: string },
): RuntimeAction | null {
  const verifier = run.actions.find((action) => action.id === committed.actionId);
  const output = verifier?.outcome?.output as
    { response?: { kind?: string; result?: { verdict?: string } } } | undefined;
  if (
    verifier?.stepId !== 'verify.verifier' ||
    run.actions.filter((action) => action.stepId === 'verify.verifier').at(-1)?.id !==
      committed.actionId ||
    verifier.status !== 'succeeded' ||
    verifier.outcome?.outcomeId !== committed.outcomeId ||
    output?.response?.kind !== 'final-result' ||
    output.response.result?.verdict !== 'pass' ||
    run.ready.length > 0 ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending')
  )
    return null;
  const active = run.actions.filter((action) =>
    ['pending', 'running', 'unknown'].includes(action.status),
  );
  if (
    active.length !== 1 ||
    active[0].stepId !== 'verify.report' ||
    active[0].status !== 'pending' ||
    active[0].ref !== 'native-verification-report'
  )
    return null;
  const state = parseNativePortableState(run.state);
  return state.phase === 'verify' &&
    state.status === 'await-user' &&
    state.verification_result === 'pass'
    ? active[0]
    : null;
}

/** 只重读无副作用的报告校验，保留原 claim 和 attempt；绝不声称原执行未发生。 */
export async function recoverNativeSdkReportRevalidation(
  projectRoot: string,
  run: WorkflowRun,
  runtime: WorkflowRuntime,
): Promise<WorkflowRun> {
  if (run.status === 'cancelled' || run.status === 'completed') return run;
  const action = run.actions.find(
    (entry) =>
      entry.status === 'unknown' &&
      entry.stepId === 'verify.revalidate' &&
      entry.ref === 'native-report-revalidate' &&
      entry.claim?.executorId === nativeSdkReportRevalidationExecutor.id,
  );
  if (!action?.claim) return run;
  const context = { projectRoot, requestId: 'native-report-revalidation-recovery' };
  let result;
  try {
    result = await nativeSdkReportRevalidationExecutor.execute(action, context, run);
  } catch {
    // 非检查失效错误可能涉及权限、存储或未知边界，保持原未知执行待核对。
    return run;
  }
  return runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      ...result,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: `${action.id}:${action.attempt}:revalidated-read-only`,
    },
    context,
  });
}

export { nativeSdkVerificationReportOutput } from './native-verification-report-v2.js';
