import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  RuntimeValue,
  WorkflowRun,
  WorkflowRuntime,
} from '../engine/runtime.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
import { nativeSdkCurrentCheckSummaries } from './native-sdk-checks.js';
import type { NativeProjectPaths } from './native-types.js';
import { renderNativeVerificationReport } from './native-verification-report-v2.js';

export function nativeSdkVerificationReportMetadata(
  state: NativePortableState,
  artifactRootRef: string,
) {
  if (!state.builder_handoff || !state.verification)
    throw new Error('Native report requires its accepted Verifier result');
  return {
    candidateId: state.builder_handoff.candidate_id,
    reportRef: path.posix.join(
      artifactRootRef.replaceAll('\\', '/'),
      'comet',
      'changes',
      state.name,
      'verification.md',
    ),
    stateVersion: state.state_version,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
  };
}

/** 报告是阅读视图；保存已有原文后更新，不用内容摘要控制阶段。 */
export async function writeNativeSdkVerificationReport(options: {
  state: NativePortableState;
  paths: NativeProjectPaths;
  runId: string;
  file: string;
  previousReportSha256?: unknown;
}) {
  const { state, paths, file } = options;
  const ref = path.relative(paths.projectRoot, file).replaceAll('\\', '/');
  const original = await readProtectedProjectFile(paths.projectRoot, ref, Number.MAX_SAFE_INTEGER, {
    label: 'Native verification view',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const rendered = renderNativeVerificationReport(state);
  if (original?.bytes.equals(Buffer.from(rendered))) return {};
  let preservedReportRef: string | undefined;
  if (original) {
    const directory = 'native/preserved-verification/' + encodeURIComponent(options.runId);
    await ensureProtectedProjectDirectory(paths.workspaceRuntimeRoot, directory, {
      label: 'Native preserved report',
    });
    preservedReportRef = directory + '/' + randomUUID() + '.md';
    await fs.writeFile(
      path.join(paths.workspaceRuntimeRoot, ...preservedReportRef.split('/')),
      original.bytes,
      { flag: 'wx' },
    );
  }
  await atomicWriteText(file, rendered, { containedRoot: paths.projectRoot });
  return preservedReportRef ? { preservedReportRef } : {};
}

export async function refreshNativeSdkVerificationReport(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
): Promise<void> {
  if (!['3', '4'].includes(run.workflow.version)) return;
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass'
  )
    return;
  const root = (run.input as { artifactRootRef: string }).artifactRootRef;
  const paths = await nativeProjectPaths(projectRoot, root);
  await writeNativeSdkVerificationReport({
    state,
    paths,
    runId: run.runId,
    file: path.join(paths.changesDir, state.name, 'verification.md'),
  });
}

export async function nativeSdkArchivedReportWarning(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
): Promise<{ code: 'NATIVE_REPORT_PENDING'; message: string; reportRef: string } | undefined> {
  const state = parseNativePortableState(run.state);
  if (!state.archived) return;
  const paths = await nativeProjectPaths(
    projectRoot,
    (run.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  const finalized = run.outputs['archive.finalize']?.value as { archiveRef?: string } | undefined;
  if (!finalized?.archiveRef) return;
  const reportRef = path
    .relative(projectRoot, path.join(paths.archiveDir, finalized.archiveRef, 'verification.md'))
    .replaceAll('\\', '/');
  let available = false;
  try {
    available = (
      await inspectProtectedProjectPath(projectRoot, reportRef, {
        label: 'Native archived verification view',
        expected: 'file',
      })
    ).exists;
  } catch {
    // A completed Run keeps its accepted result when its reading view is unavailable.
  }
  return available
    ? undefined
    : {
        code: 'NATIVE_REPORT_PENDING',
        message: '归档已完成，验证报告阅读视图尚不可用；实际验收结果和归档进度已保存。',
        reportRef,
      };
}

async function reportTarget(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state),
    input = run.input as { name?: string; artifactRootRef?: string };
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
  )
    throw new Error('Native report lacks its passed Verifier Action');
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef)
    throw new Error('Native artifact root changed after Run creation');
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  return {
    state,
    paths,
    file: path.join(paths.changesDir, state.name, 'verification.md'),
    metadata: nativeSdkVerificationReportMetadata(state, input.artifactRootRef),
  };
}

export const nativeSdkReportExecutor: RuntimeExecutor = {
  id: 'comet-native-report',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-verification-report',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native report requires its SDK Run');
    const target = await reportTarget(run, action, context.projectRoot);
    const written = await writeNativeSdkVerificationReport({ ...target, runId: run.runId });
    return {
      status: 'succeeded',
      output: { ...target.metadata, ...written } as unknown as RuntimeValue,
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
    )
      return { accepted: false, reason: 'Native report lacks its Runtime execution' };
    try {
      const { metadata } = await reportTarget(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      if (
        !output ||
        output.candidateId !== metadata.candidateId ||
        output.reportRef !== metadata.reportRef ||
        output.stateVersion !== metadata.stateVersion
      )
        throw new Error('Native report metadata belongs to another verification step');
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: String(error) };
    }
  },
};

async function acceptedResult(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state),
    input = run.input as { artifactRootRef: string };
  if (
    action.stepId !== 'verify.revalidate' ||
    action.ref !== 'native-report-revalidate' ||
    !state.builder_handoff ||
    !state.verification ||
    state.verification_result !== 'pass' ||
    !run.waits.some(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    )
  )
    throw new Error('Native completion lacks its accepted Verifier result');
  const checks =
    run.workflow.version === '4' ? [] : await nativeSdkCurrentCheckSummaries({ run, projectRoot });
  if (checks.some((check) => check.status !== 'passed'))
    throw new Error('最新实际检查仍有失败、中断或未执行项');
  return nativeSdkVerificationReportMetadata(state, input.artifactRootRef);
}

export const nativeSdkReportRevalidationExecutor: RuntimeExecutor = {
  id: 'comet-native-report-revalidate',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'native-report-revalidate',
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native completion requires its SDK Run');
    try {
      return {
        status: 'succeeded',
        output: (await acceptedResult(run, action, context.projectRoot)) as unknown as RuntimeValue,
      };
    } catch (error) {
      return { status: 'failed', output: { reason: 'checks-failed', message: String(error) } };
    }
  },
};

export const nativeSdkReportRevalidationValidator: RuntimeValidator = {
  id: 'comet-native-report-revalidation-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkReportRevalidationExecutor.id
    )
      return { accepted: false, reason: 'Native completion lacks its Runtime execution' };
    try {
      const expected = await acceptedResult(run, action, context.projectRoot),
        output = outcome.output as Record<string, unknown> | null;
      return outcome.status === 'succeeded' &&
        output?.candidateId === expected.candidateId &&
        output.reportRef === expected.reportRef &&
        output.stateVersion === expected.stateVersion
        ? { accepted: true }
        : { accepted: false, reason: 'Native completion result belongs to another step' };
    } catch (error) {
      const output = outcome.output as { reason?: string; message?: string } | null;
      return outcome.status === 'failed' &&
        output?.reason === 'checks-failed' &&
        output.message === String(error)
        ? { accepted: true }
        : { accepted: false, reason: String(error) };
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
/** 只读结果核对可沿原 Action 恢复；不重放检查、写入或其他外部操作。 */
export async function recoverNativeSdkReportRevalidation(
  projectRoot: string,
  run: WorkflowRun,
  runtime: WorkflowRuntime,
): Promise<WorkflowRun> {
  if (run.status === 'cancelled' || run.status === 'completed') return run;
  const action = run.actions.find(
    (entry) =>
      entry.stepId === 'verify.revalidate' &&
      entry.status === 'unknown' &&
      entry.claim?.executorId === nativeSdkReportRevalidationExecutor.id,
  );
  if (!action?.claim) return run;
  const context = { requestId: randomUUID(), projectRoot };
  const result = await nativeSdkReportRevalidationExecutor.execute(action, context, run);
  return runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      ...result,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: action.id + ':' + action.attempt + ':accepted-result',
    },
    context,
  });
}
export { nativeSdkVerificationReportOutput } from './native-verification-report-v2.js';
