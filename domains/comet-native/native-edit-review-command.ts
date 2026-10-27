import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseCometHookRequest } from '../../platform/process/hook-adapter.js';
import {
  claimedEditReviewAuthority,
  claimEditReview,
  claimedEditReviewExecutionAuthority,
  editReviewContinuation,
  rememberEditReviewInput,
  inspectEditReviews,
  prepareEditReview,
  recordEditReview,
  readEditReviewInput,
  supersedeStaleAppliedEditReviews,
  type EditReviewClaim,
  type EditReviewInput,
  type EditReviewCommandOptions,
} from '../workflow-contract/edit-review.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  nativeEditReviewScope,
  nativeEditReviewPreparationScope,
  prepareNativeAppliedFormalReview,
  nativeAppliedFormalReviewRequest,
} from './native-edit-review.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeProjectPaths } from './native-paths.js';
import { readProjectConfig } from './native-config.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import { readNativePortableChange, currentBranch } from './native-portable-storage.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { withNativeMutationLock } from './native-mutation-lock.js';

export async function runNativeEditReviewCommand(options: EditReviewCommandOptions) {
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
    const pending = sdk?.run.actions.filter((action) => action.status === 'pending') ?? [];
    const archiveReady =
      state.phase === 'archive' &&
      sdk !== null &&
      pending.length === 1 &&
      ['archive.prepare', 'archive.execute'].includes(pending[0].stepId) &&
      !sdk.run.actions.some((action) => ['running', 'unknown'].includes(action.status));
    if ((state.phase !== 'verify' && !archiveReady) || state.archived)
      throw new Error('编辑复核只用于当前 Verify 或未执行归档的候选');
    const scope = nativeEditReviewScope(paths, state);
    if (options.operation === 'show') {
      const reviews = await inspectEditReviews(scope);
      return { reviews, continuation: await editReviewContinuation(scope, reviews, Boolean(sdk)) };
    }
    if (options.operation === 'claim') {
      const builderExecutionRef = state.builder_handoff?.builder_execution_ref;
      if (!builderExecutionRef) throw new Error('编辑领取需要当前候选的 Builder 记录');
      let proposalHash = options.proposalHash;
      let originalPaths: string[] = [];
      if (options.file) {
        const source = await fs.readFile(options.file, 'utf8');
        const request = parseCometHookRequest(source);
        const applied = (JSON.parse(source) as { cometApplied?: unknown }).cometApplied === true;
        const prepared = applied
          ? await prepareNativeAppliedFormalReview(paths, state, request)
          : null;
        const proposal =
          prepared?.proposal ??
          (await prepareEditReview(
            await nativeEditReviewPreparationScope(paths, state, request),
            request,
          ));
        originalPaths = prepared?.originalPaths ?? [];
        if (proposalHash && proposalHash !== proposal.proposalHash)
          throw new Error('原编辑请求与所选复核提案不匹配');
        proposalHash = proposal.proposalHash;
        await rememberEditReviewInput(scope, proposalHash, options.file, source);
      }
      if (!sdk) {
        const reviews = await inspectEditReviews(scope);
        const selected = proposalHash
          ? reviews.find((review) => review.proposalHash === proposalHash)
          : reviews.find((review) => !review.receipt);
        if (!selected?.applied) throw new Error('Compat 的普通编辑复核仍需用户确认');
      }
      const claim = await claimEditReview(scope, {
        proposalHash,
        builderExecutionRef,
        sessionId: options.sessionId ?? '',
      });
      if (!originalPaths.length && claim.originalRequestRef) {
        const saved = await fs.readFile(claim.originalRequestRef, 'utf8');
        if ((JSON.parse(saved) as { cometApplied?: unknown }).cometApplied === true) {
          const prepared = await prepareNativeAppliedFormalReview(
            paths,
            state,
            parseCometHookRequest(saved),
          );
          if (prepared.proposal.proposalHash !== claim.proposal.proposalHash)
            throw new Error('已应用编辑请求与领取的提案不匹配');
          originalPaths = prepared.originalPaths;
        }
      }
      return originalPaths.length ? { ...claim, originalPaths } : claim;
    }
    let requestFile = options.file;
    if (options.operation === 'prepare-applied' && !requestFile) {
      await supersedeStaleAppliedEditReviews(scope);
      const generated = await nativeAppliedFormalReviewRequest(paths, state);
      if (generated === null) {
        const reviews = await inspectEditReviews(scope);
        return {
          reviews,
          continuation: await editReviewContinuation(scope, reviews, Boolean(sdk)),
        };
      }
      const ref = `native/applied-edit-requests/${createHash('sha256').update(generated).digest('hex')}.json`;
      requestFile = path.join(paths.workspaceRuntimeRoot, ref);
      try {
        await atomicWriteText(requestFile, generated, {
          containedRoot: paths.workspaceRuntimeRoot,
          exclusive: true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await fs.readFile(requestFile, 'utf8')) !== generated)
          throw new Error('已应用编辑请求记录发生变化', { cause: error });
      }
    }
    if (!requestFile) throw new Error('编辑复核需要 --file 指定完整请求 JSON');
    const source = await fs.readFile(requestFile, 'utf8');
    if (options.operation === 'prepare' || options.operation === 'prepare-applied') {
      if (options.operation === 'prepare-applied' && options.file)
        await supersedeStaleAppliedEditReviews(scope);
      const request = parseCometHookRequest(source);
      if (
        options.operation === 'prepare-applied' &&
        (JSON.parse(source) as { cometApplied?: unknown }).cometApplied !== true
      )
        throw new Error('已应用编辑请求必须设置 cometApplied: true');
      const prepared =
        options.operation === 'prepare-applied'
          ? await prepareNativeAppliedFormalReview(paths, state, request)
          : {
              proposal: await prepareEditReview(
                await nativeEditReviewPreparationScope(paths, state, request),
                request,
              ),
              originalPaths: [],
            };
      const { proposal } = prepared;
      await rememberEditReviewInput(scope, proposal.proposalHash, requestFile, source);
      return {
        proposal,
        ...(prepared.originalPaths.length ? { originalPaths: prepared.originalPaths } : {}),
        request,
        continuation: await editReviewContinuation(
          scope,
          await inspectEditReviews(scope),
          Boolean(sdk),
        ),
        instructions:
          options.operation === 'prepare-applied'
            ? '对比已批准原文与当前文件，独立判断具体修改；完成复核后保留当前文件并刷新失效检查。不得重写原文或猜测原始内容。'
            : '读取原文件和完整编辑请求，结合差异、实际使用方及当前验收条件判断影响；文件扩展名、语法结构或 hash 不同本身不能决定回滚。通过 record 提交 non-behavioral、implementation-changed 或 requirements-changed，并说明依据；无法确定时保持待复核。非行为修改应用后重新执行失效检查，再完成当前 Verifier。Compat 的普通编辑由用户确认，已应用编辑可由独立会话复核；SDK 可沿用当前独立 Verifier 的 claim，也可由独立会话领取候选绑定的编辑复核任务；会话引用仅用于关联，不代表平台身份认证。',
      };
    }
    if (options.operation !== 'record')
      throw new Error('编辑复核操作必须是 prepare、prepare-applied、claim、record 或 show');
    const input = JSON.parse(source) as EditReviewInput & { claim?: EditReviewClaim };
    const pendingReview = (await inspectEditReviews(scope)).find(
      (review) => review.proposalHash === input.proposalHash,
    );
    if (pendingReview?.applied) {
      const originalRequest = await readEditReviewInput(scope, input.proposalHash);
      if (
        !originalRequest ||
        (JSON.parse(originalRequest) as { cometApplied?: unknown }).cometApplied !== true
      )
        throw new Error('已应用编辑的原始请求丢失或变化，不能提交复核');
      const prepared = await prepareNativeAppliedFormalReview(
        paths,
        state,
        parseCometHookRequest(originalRequest),
      );
      if (prepared.proposal.proposalHash !== input.proposalHash)
        throw new Error('已应用编辑与原提案不匹配，不能提交复核');
    }
    const authority =
      input.reviewer && (sdk || pendingReview?.applied)
        ? await claimedEditReviewExecutionAuthority(
            scope,
            state.builder_handoff?.builder_execution_ref ?? '',
            input,
          )
        : sdk
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
    const receipt = await recordEditReview(
      scope,
      {
        proposalHash: input.proposalHash,
        decision: input.decision,
        summary: input.summary,
      },
      authority,
    );
    return {
      receipt,
      continuation: await editReviewContinuation(
        scope,
        await inspectEditReviews(scope),
        Boolean(sdk),
      ),
    };
  });
}
