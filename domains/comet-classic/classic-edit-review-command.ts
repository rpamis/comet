import { promises as fs } from 'node:fs';
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
  type EditReviewClaim,
  type EditReviewInput,
  type EditReviewCommandOptions,
} from '../workflow-contract/edit-review.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { classicEditReviewScope } from './classic-edit-review.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import { resolveBranchBinding } from './classic-branch-binding.js';

export async function runClassicEditReviewCommand(options: EditReviewCommandOptions) {
  const { directory } = await resolveClassicChangeDirectory(options.name, options.projectRoot);
  const binding = await resolveBranchBinding(directory, { heal: false, cwd: options.projectRoot });
  if (binding.status === 'drift' || binding.status === 'unbound-detached')
    throw new Error('Classic 编辑复核必须在当前绑定工作区执行');
  return withClassicStateLock(directory, async () => {
    const sdk = (await readSdkChangeOwner(options.projectRoot, 'classic', options.name))
      ? await inspectClassicSdkRun(options.projectRoot, options.name, { readOnly: true })
      : null;
    const state = sdk?.state ?? (await readClassicState(directory, { migrate: false })).classic;
    if (!state || state.phase !== 'verify' || state.archived)
      throw new Error('编辑复核只用于当前 Verify 候选');
    const scope = await classicEditReviewScope(
      options.projectRoot,
      options.name,
      state,
      options.operation !== 'show',
    );
    const builder = sdk?.run.actions
      .slice()
      .reverse()
      .find(
        (action) =>
          action.stepId === `${state.workflow}.build.execute` && action.status === 'succeeded',
      );
    const builderExecutionRef =
      builder?.claim?.sessionId ??
      (builder ? `classic-builder/${builder.id}/${builder.attempt}` : undefined);
    if (options.operation === 'show') {
      const reviews = await inspectEditReviews(scope);
      return { reviews, continuation: await editReviewContinuation(scope, reviews, Boolean(sdk)) };
    }
    if (options.operation === 'claim') {
      if (!sdk || !builderExecutionRef)
        throw new Error('编辑领取需要 SDK 当前候选的 Builder 记录；Compat 使用明确用户确认');
      let proposalHash = options.proposalHash;
      if (options.file) {
        const source = await fs.readFile(options.file, 'utf8');
        const request = parseCometHookRequest(source);
        const proposal = await prepareEditReview(scope, request);
        if (proposalHash && proposalHash !== proposal.proposalHash)
          throw new Error('原编辑请求与所选复核提案不匹配');
        proposalHash = proposal.proposalHash;
        await rememberEditReviewInput(scope, proposalHash, options.file, source);
      }
      return claimEditReview(scope, {
        proposalHash,
        builderExecutionRef,
        sessionId: options.sessionId ?? '',
      });
    }
    if (!options.file) throw new Error('编辑复核需要 --file 指定完整请求 JSON');
    const source = await fs.readFile(options.file, 'utf8');
    if (options.operation === 'prepare') {
      const request = parseCometHookRequest(source);
      const proposal = await prepareEditReview(scope, request);
      await rememberEditReviewInput(scope, proposal.proposalHash, options.file, source);
      return {
        proposal,
        request,
        continuation: await editReviewContinuation(
          scope,
          await inspectEditReviews(scope),
          Boolean(sdk),
        ),
        instructions:
          '读取原文件和完整编辑请求，结合差异、实际使用方及当前验收条件判断影响；文件扩展名、语法结构或 hash 不同本身不能决定回滚。通过 record 提交 non-behavioral、implementation-changed 或 requirements-changed，并说明依据；无法确定时保持待复核。非行为修改应用后重新执行失效检查，再完成当前 Verifier。Compat 必须由用户明确确认复核结果；SDK 可沿用当前独立 Verifier 的 claim，也可由独立会话领取候选绑定的编辑复核任务；会话引用仅用于关联，不代表宿主身份认证。',
      };
    }
    if (options.operation !== 'record')
      throw new Error('编辑复核操作必须是 prepare、claim、record 或 show');
    const input = JSON.parse(source) as EditReviewInput & { claim?: EditReviewClaim };
    const authority = sdk
      ? input.reviewer
        ? await claimedEditReviewExecutionAuthority(scope, builderExecutionRef ?? '', input)
        : claimedEditReviewAuthority(
            sdk.run.actions,
            `${state.workflow}.verify.run`,
            builderExecutionRef,
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
