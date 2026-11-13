import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WorkflowRun } from '../engine/runtime.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { ensureWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import { renderNativeVerificationReport } from './native-verification-report-v2.js';
export function nativeSdkPreservedReportsRef(runId: string): string {
  return 'native/preserved-verification/' + encodeURIComponent(runId);
}
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
    await ensureWorkspaceRuntimeRoot(paths.projectRoot);
    const directory = nativeSdkPreservedReportsRef(options.runId);
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
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass'
  )
    return;
  const root = (
    run.input as {
      artifactRootRef: string;
    }
  ).artifactRootRef;
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
): Promise<
  | {
      code: 'NATIVE_REPORT_PENDING';
      message: string;
      reportRef: string;
    }
  | undefined
> {
  const state = parseNativePortableState(run.state);
  if (!state.archived) return;
  const paths = await nativeProjectPaths(
    projectRoot,
    (
      run.input as {
        artifactRootRef: string;
      }
    ).artifactRootRef,
    { readOnly: true },
  );
  const finalized = run.outputs['archive.finalize']?.value as
    | {
        archiveRef?: string;
      }
    | undefined;
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
    // 报告阅读视图缺失不改变已接受的归档结果。
  }
  return available
    ? undefined
    : {
        code: 'NATIVE_REPORT_PENDING',
        message: '归档已完成，验证报告阅读视图尚不可用；实际验收结果和归档进度已保存。',
        reportRef,
      };
}
