import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertEditReviewsComplete,
  type EditReviewScope,
} from '../workflow-contract/edit-review.js';
import {
  resolveWorkspaceRuntimeRootSync,
  resolveWorkspaceRuntimeRoot,
} from '../workflow-contract/workspace-runtime.js';
import { resolveClassicLayout } from './classic-layout.js';
import { classicProtectedDocumentPrefixes } from './classic-neutral-documents.js';
import type { ClassicState } from './classic-state.js';

export async function classicEditReviewScope(
  projectRoot: string,
  change: string,
  state: ClassicState,
  write = false,
): Promise<EditReviewScope> {
  const layout = await resolveClassicLayout(projectRoot);
  // 从 Archive 的阶段序号还原 Verify 序号；下一轮 Build 或重新验收使用新的序号。
  const verifyEpoch =
    (state.checkEpoch ?? 0) -
    (state.phase === 'archive'
      ? 1 + (state.archiveConfirmation === 'confirmed' ? 1 : 0) + (state.archived ? 1 : 0)
      : 0);
  const candidateKey = createHash('sha256')
    .update(
      JSON.stringify({
        createdAt: state.createdAt,
        baseRef: state.baseRef,
        plan: state.plan,
        handoffHash: state.handoffHash,
        verifyEpoch,
        boundBranch: state.boundBranch,
      }),
    )
    .digest('hex');
  return {
    projectRoot: path.resolve(projectRoot),
    runtimeRoot: write
      ? await resolveWorkspaceRuntimeRoot(projectRoot)
      : resolveWorkspaceRuntimeRootSync(projectRoot),
    workflow: 'classic',
    change,
    candidateKey,
    formalPrefixes: [
      '.comet',
      ...classicProtectedDocumentPrefixes(projectRoot, layout),
      ...[state.designDoc, state.plan, state.verificationReport].filter((ref): ref is string =>
        Boolean(ref),
      ),
    ],
  };
}

export async function assertClassicEditReviewsComplete(
  projectRoot: string,
  change: string,
  state: ClassicState,
): Promise<void> {
  await assertEditReviewsComplete(await classicEditReviewScope(projectRoot, change, state));
}
