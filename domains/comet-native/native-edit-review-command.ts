import { promises as fs } from 'node:fs';
import { parseCometHookRequest } from '../../platform/process/hook-adapter.js';
import {
  claimedEditReviewAuthority,
  inspectEditReviews,
  prepareEditReview,
  recordEditReview,
  type EditReviewClaim,
  type EditReviewInput,
} from '../workflow-contract/edit-review.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { nativeEditReviewScope } from './native-edit-review.js';
import { nativeProjectPaths } from './native-paths.js';
import { readProjectConfig } from './native-config.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import { readNativePortableChange, currentBranch } from './native-portable-storage.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { withNativeMutationLock } from './native-mutation-lock.js';

export async function runNativeEditReviewCommand(options: {
  projectRoot: string;
  name: string;
  operation: string;
  file?: string;
  confirmed?: boolean;
}) {
  const config = await readProjectConfig(options.projectRoot);
  if (!config) throw new Error('当前项目缺少 Comet 配置');
  const paths = await nativeProjectPaths(options.projectRoot, config.native.artifact_root);
  return withNativeMutationLock(paths, `edit review ${options.name}`, async () => {
    const sdk = (await readSdkChangeOwner(options.projectRoot, 'native', options.name))
      ? await inspectNativeSdkRun(options.projectRoot, options.name, { readOnly: true })
      : null;
    const state = sdk?.state ?? (await readNativePortableChange(paths, options.name));
    if (
      (state.workspace.change_branch !== null &&
        currentBranch(options.projectRoot) !== state.workspace.change_branch) ||
      (state.workspace.isolation === 'worktree' &&
        !inspectGitWorktree(options.projectRoot).isSecondaryWorktree)
    )
      throw new Error('Native 编辑复核必须在当前绑定工作区执行');
    if (state.phase !== 'verify' || state.archived)
      throw new Error('编辑复核只用于当前 Verify 候选');
    const scope = nativeEditReviewScope(paths, state);
    if (options.operation === 'show') return { reviews: await inspectEditReviews(scope) };
    if (!options.file) throw new Error('编辑复核需要 --file 指定完整请求 JSON');
    const source = await fs.readFile(options.file, 'utf8');
    if (options.operation === 'prepare') {
      const request = parseCometHookRequest(source);
      return {
        proposal: await prepareEditReview(scope, request),
        request,
        instructions:
          '复核完整编辑前后内容及其调用场景；确认不改变行为后 record。应用编辑后重新执行失效检查，再完成当前 Verifier。Compat 必须由用户明确确认复核结果；SDK 沿用当前独立 Verifier 的 claim。',
      };
    }
    if (options.operation !== 'record')
      throw new Error('编辑复核操作必须是 prepare、record 或 show');
    const input = JSON.parse(source) as EditReviewInput & { claim?: EditReviewClaim };
    const authority = sdk
      ? claimedEditReviewAuthority(
          sdk.run.actions,
          'verify.verifier',
          state.builder_handoff?.builder_execution_ref,
          input.claim!,
        )
      : options.confirmed
        ? { kind: 'user-confirmed' as const, executionRef: 'explicit-user-review' }
        : null;
    if (!authority) throw new Error('Compat 编辑复核结果需要用户明确确认后使用 --confirmed');
    return {
      receipt: await recordEditReview(
        scope,
        {
          proposalHash: input.proposalHash,
          decision: input.decision,
          summary: input.summary,
        },
        authority,
      ),
    };
  });
}
