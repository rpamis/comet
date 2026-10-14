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
import { classicEditReviewScope } from './classic-edit-review.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import { resolveBranchBinding } from './classic-branch-binding.js';

export async function runClassicEditReviewCommand(options: {
  projectRoot: string;
  name: string;
  operation: string;
  file?: string;
  confirmed?: boolean;
}) {
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
    const builder = sdk?.run.actions
      .slice()
      .reverse()
      .find(
        (action) =>
          action.stepId === `${state.workflow}.build.execute` && action.status === 'succeeded',
      );
    const authority = sdk
      ? claimedEditReviewAuthority(
          sdk.run.actions,
          `${state.workflow}.verify.run`,
          builder?.claim?.sessionId,
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
