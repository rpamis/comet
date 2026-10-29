import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseCometHookRequest } from '../../platform/process/hook-adapter.js';
import {
  claimedEditReviewAuthority,
  claimedAgentEditReviewAuthority,
  agentEditReviewRecordTemplate,
  claimEditReview,
  claimedEditReviewExecutionAuthority,
  editReviewContinuation,
  rememberEditReviewInput,
  inspectEditReviews,
  prepareEditReview,
  prepareObservedEditReview,
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
  nativeFormalEditReviewScope,
  nativeEditReviewPreparationScope,
  prepareNativeAppliedFormalReview,
  nativeAppliedFormalReviewRequest,
  inspectNativeEditReviews,
  nativeEditReviewContinuation,
} from './native-edit-review.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeProjectPaths } from './native-paths.js';
import { readProjectConfig } from './native-config.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import { readNativePortableChange, currentBranch } from './native-portable-storage.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { observeNativeSdkInputs } from './native-sdk-checks.js';
import {
  observeNativePortableRawInputs,
  nativePortableCheckExecutionRef,
  refreshNativePortableChecks,
  type NativePortableCheckRefreshInput,
} from './native-portable-checks.js';
import { readNativeLocalExecution } from './native-local-execution.js';
import { nativeLocalExecutionFile } from './native-portable-storage.js';
import { refreshNativeSdkCheckWork } from './native-sdk-next.js';
import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';

export async function runNativeEditReviewCommand(options: EditReviewCommandOptions) {
  const config = await readProjectConfig(options.projectRoot);
  if (!config) throw new Error('当前项目缺少 Comet 配置');
  const paths = await nativeProjectPaths(options.projectRoot, config.native.artifact_root);
  // Compat 检查自行执行锁内预留、锁外运行和锁内提交，不能被编辑记录锁包住。
  if (
    options.operation === 'refresh-checks' &&
    !(await readSdkChangeOwner(options.projectRoot, 'native', options.name))
  ) {
    if (!options.file) throw new Error('补充检查需要 observe 返回的输入文件');
    const state = await readNativePortableChange(paths, options.name);
    if (
      (state.workspace.change_branch !== null &&
        currentBranch(options.projectRoot) !== state.workspace.change_branch) ||
      (state.workspace.isolation === 'worktree' &&
        !inspectGitWorktree(options.projectRoot).isSecondaryWorktree)
    )
      throw new Error('Native 补充检查必须在当前绑定工作区执行');
    const input = JSON.parse(
      await fs.readFile(options.file, 'utf8'),
    ) as NativePortableCheckRefreshInput;
    const checks = await refreshNativePortableChecks(paths, options.name, input);
    return {
      checks,
      instruction:
        '补充检查已记录到原候选；核对实际结果后继续原归档事务，原验收报告和接受结果保留。',
    };
  }
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
    if (options.operation === 'refresh-checks') {
      if (!sdk || !options.file)
        throw new Error('补充检查需要当前 SDK Run 和 observe 返回的输入文件');
      const { expectedRevision, ...input } = JSON.parse(
        await fs.readFile(options.file, 'utf8'),
      ) as { expectedRevision: number } & Record<string, RuntimeValue>;
      const run = await refreshNativeSdkCheckWork(
        options.projectRoot,
        options.name,
        expectedRevision,
        input,
      );
      const commandId = hashRuntimeValue({
        runId: run.runId,
        name: 'refresh-checks',
        expectedRevision,
      });
      const action = run.actions.find(
        (entry) => entry.id === run.commands?.find((command) => command.id === commandId)?.actionId,
      )!;
      return {
        run,
        actionId: action.id,
        application: 'native',
        ...(action.status === 'pending'
          ? {
              executeRequest: {
                protocolVersion: 1,
                operation: 'execute',
                runId: run.runId,
                expectedRevision: run.revision,
                actionId: action.id,
                executorId: 'comet-native-checks',
              },
            }
          : {}),
        instruction:
          action.status === 'pending'
            ? '将 executeRequest 保存为 JSON，执行 comet runtime dispatch --application native --request <file> --project-root <project> --json；在原 Run 只补检查，原验收报告和批准保留。'
            : '原补充检查已领取或已有结果；使用其原 Action 和当前 continuation 继续，不重复执行。',
      };
    }
    const archiveReady =
      state.phase === 'archive' &&
      (sdk === null ||
        (pending.length === 1 &&
          ['archive.prepare', 'archive.execute'].includes(pending[0].stepId) &&
          !sdk.run.actions.some((action) => ['running', 'unknown'].includes(action.status))));
    if ((state.phase !== 'verify' && state.phase !== 'build' && !archiveReady) || state.archived)
      throw new Error('内容判断需要当前 Build、Verify 或尚未执行归档的 change');
    const currentAgent =
      ['judge', 'observe', 'prepare-applied'].includes(options.operation) ||
      (sdk &&
        (state.phase === 'build' ||
          (options.sessionId &&
            sdk.run.actions.some(
              (action) =>
                action.status === 'running' && action.claim?.sessionId === options.sessionId,
            ))));
    let scope = {
      ...nativeEditReviewScope(paths, state),
      ...(currentAgent ? { judgment: 'agent' as const } : {}),
    };
    if (state.shape_confirmation_hash && ['record', 'claim', 'judge'].includes(options.operation)) {
      const hash =
        options.proposalHash ??
        (options.operation === 'record' && options.file
          ? (JSON.parse(await fs.readFile(options.file, 'utf8')) as EditReviewInput).proposalHash
          : undefined);
      if (hash) {
        const formalScope = nativeFormalEditReviewScope(paths, state);
        if ((await inspectEditReviews(formalScope)).some((review) => review.proposalHash === hash))
          scope = formalScope;
      }
    }
    if (options.operation === 'observe') {
      if (!options.sessionId?.trim()) throw new Error('内容判断需要当前 Agent 会话标识');
      const local = sdk
        ? null
        : await readNativeLocalExecution(nativeLocalExecutionFile(paths, state.name));
      if (!sdk && !local) throw new Error('原始输入观察需要原执行记录，不能从当前文件补造旧快照');
      const observation = sdk
        ? await observeNativeSdkInputs(sdk.run, options.projectRoot)
        : await observeNativePortableRawInputs(paths, state, local!);
      const formalChanges = observation.changes.filter((change) =>
        scope.formalPrefixes.some(
          (prefix) => change.path === prefix || change.path.startsWith(`${prefix}/`),
        ),
      );
      const changes = observation.changes.filter((change) => !formalChanges.includes(change));
      if (!changes.length)
        return {
          observation,
          formalChanges,
          instruction: formalChanges.length
            ? `由当前 Agent 使用 comet edit-review prepare-applied native ${state.name} --session ${options.sessionId} 判断正式材料；保留现有批准和工作。`
            : '实际文件内容未变；沿用原 Run 继续，单独核对明确依赖 Git 或执行环境的检查。',
        };
      await supersedeStaleAppliedEditReviews(scope);
      const proposal = await prepareObservedEditReview(scope, changes);
      const agent = sdk?.run.actions.find(
        (action) =>
          action.status === 'running' &&
          ['build.builder', 'verify.verifier'].includes(action.stepId) &&
          action.claim?.sessionId === options.sessionId,
      );
      const claimed = agent?.claim?.sessionId
        ? {
            proposal,
            readPaths: proposal.edits.map((edit) => path.resolve(options.projectRoot, edit.path)),
            recordTemplate: agentEditReviewRecordTemplate(proposal.proposalHash, {
              actionId: agent.id,
              attempt: agent.attempt,
              inputHash: agent.inputHash,
              claimToken: agent.claim.token,
              sessionId: agent.claim.sessionId,
            }),
            continuation: await editReviewContinuation(
              scope,
              await inspectEditReviews(scope),
              true,
            ),
          }
        : await claimEditReview(scope, {
            proposalHash: proposal.proposalHash,
            builderExecutionRef:
              state.builder_handoff?.builder_execution_ref ?? `native-agent/${state.name}`,
            sessionId: options.sessionId,
          });
      const availableChecks = sdk
        ? sdk.run.actions.flatMap((action) => {
            const output = action.outcome?.output as
              | {
                  checks?: Array<{
                    id: string;
                    name: string;
                    status: string;
                    exitCode: number | null;
                  }>;
                }
              | undefined;
            return ['verify.checks', 'verify.requested-checks'].includes(action.stepId)
              ? (output?.checks ?? []).map((check) => ({
                  actionId: action.id,
                  checkId: check.id,
                  name: check.name,
                  status: check.status,
                  exitCode: check.exitCode,
                }))
              : [];
          })
        : (local?.checks ?? []).map((check) => ({
            actionId: nativePortableCheckExecutionRef(check),
            executionRef: nativePortableCheckExecutionRef(check),
            checkId: check.id,
            status: check.status,
            argvDisplay: check.argv,
            cwdRef: check.cwd,
            rawInput: check.rawInput,
          }));
      return {
        ...claimed,
        observation,
        formalChanges,
        availableChecks,
        instruction:
          '由当前 Agent 读取变化文件、原输入清单和可取得的 Git 差异，结合现有上下文判断；缺少判断所需的原文时明确说明，不能把摘要当作原文。列出仍适用的原检查，填写 recordTemplate；不新增审查会话。',
      };
    }
    if (options.operation === 'show') {
      const reviews = await inspectNativeEditReviews(paths, state);
      return {
        reviews,
        continuation: await nativeEditReviewContinuation(paths, state, reviews, Boolean(sdk)),
      };
    }
    if (options.operation === 'claim' || options.operation === 'judge') {
      const builderExecutionRef =
        state.builder_handoff?.builder_execution_ref ??
        (options.operation === 'judge' ? `native-agent/${state.name}` : undefined);
      if (!builderExecutionRef) throw new Error('编辑领取需要当前候选的 Builder 记录');
      let proposalHash = options.proposalHash;
      let originalPaths: string[] = [];
      if (options.file) {
        const source = await fs.readFile(options.file, 'utf8');
        const request = parseCometHookRequest(source);
        const applied = (JSON.parse(source) as { cometApplied?: unknown }).cometApplied === true;
        const prepared = applied
          ? await prepareNativeAppliedFormalReview(paths, state, request, scope.judgment)
          : null;
        const proposal =
          prepared?.proposal ??
          (await prepareEditReview(
            await nativeEditReviewPreparationScope(paths, state, request, scope.judgment),
            request,
          ));
        scope = {
          ...scope,
          candidateKey: proposal.binding.candidateKey,
          ...(proposal.judgment ? { judgment: proposal.judgment } : {}),
        };
        originalPaths = prepared?.originalPaths ?? [];
        if (proposalHash && proposalHash !== proposal.proposalHash)
          throw new Error('原编辑请求与所选复核提案不匹配');
        proposalHash = proposal.proposalHash;
        await rememberEditReviewInput(scope, proposalHash, options.file, source);
      }
      if (!sdk && scope.judgment !== 'agent') {
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
            scope.judgment,
          );
          if (prepared.proposal.proposalHash !== claim.proposal.proposalHash)
            throw new Error('已应用编辑请求与领取的提案不匹配');
          originalPaths = prepared.originalPaths;
        }
      }
      const availableChecks = sdk
        ? sdk.run.actions.flatMap((action) => {
            if (!['verify.checks', 'verify.requested-checks'].includes(action.stepId)) return [];
            const output = action.outcome?.output as
              | {
                  checks?: Array<{
                    id: string;
                    name: string;
                    status: string;
                    exitCode: number | null;
                    cwdRef: string;
                    argvDisplay: string[];
                  }>;
                }
              | undefined;
            return (output?.checks ?? []).map((check) => ({
              actionId: action.id,
              checkId: check.id,
              name: check.name,
              status: check.status,
              exitCode: check.exitCode,
              cwdRef: check.cwdRef,
              argvDisplay: check.argvDisplay,
            }));
          })
        : [];
      return {
        ...claim,
        ...(originalPaths.length ? { originalPaths } : {}),
        ...(scope.judgment === 'agent' ? { availableChecks } : {}),
      };
    }
    let requestFile = options.file;
    if (options.operation === 'prepare-applied' && !requestFile) {
      await supersedeStaleAppliedEditReviews(scope);
      const generated = await nativeAppliedFormalReviewRequest(paths, state, scope.judgment);
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
          ? await prepareNativeAppliedFormalReview(paths, state, request, scope.judgment)
          : {
              proposal: await prepareEditReview(
                await nativeEditReviewPreparationScope(paths, state, request, scope.judgment),
                request,
              ),
              originalPaths: [],
            };
      scope = {
        ...scope,
        candidateKey: prepared.proposal.binding.candidateKey,
        ...(prepared.proposal.judgment ? { judgment: prepared.proposal.judgment } : {}),
      };
      const { proposal } = prepared;
      await rememberEditReviewInput(scope, proposal.proposalHash, requestFile, source);
      const agentAction =
        scope.judgment === 'agent'
          ? sdk?.run.actions.find(
              (action) =>
                action.status === 'running' &&
                ['build.builder', 'verify.verifier'].includes(action.stepId) &&
                (!options.sessionId || action.claim?.sessionId === options.sessionId),
            )
          : undefined;
      const currentAgent =
        scope.judgment === 'agent' && !agentAction && options.sessionId
          ? await claimEditReview(scope, {
              proposalHash: proposal.proposalHash,
              builderExecutionRef:
                state.builder_handoff?.builder_execution_ref ?? `native-agent/${state.name}`,
              sessionId: options.sessionId,
            })
          : undefined;
      return {
        proposal,
        ...(agentAction?.claim?.sessionId
          ? {
              recordTemplate: agentEditReviewRecordTemplate(proposal.proposalHash, {
                actionId: agentAction.id,
                attempt: agentAction.attempt,
                inputHash: agentAction.inputHash,
                claimToken: agentAction.claim.token,
                sessionId: agentAction.claim.sessionId,
              }),
            }
          : currentAgent
            ? { recordTemplate: currentAgent.recordTemplate }
            : {}),
        ...(prepared.originalPaths.length ? { originalPaths: prepared.originalPaths } : {}),
        request,
        continuation: await editReviewContinuation(
          scope,
          await inspectEditReviews(scope),
          Boolean(sdk),
        ),
        instructions:
          scope.judgment === 'agent'
            ? '由当前 Agent 读取完整原始差异、已批准原文及现有检查，判断内容与影响并填写 recordTemplate；沿用当前 Action 的 claim，不另建审查会话。已有授权下继续，真实未覆盖的需求变化才请求相关决定。'
            : options.operation === 'prepare-applied'
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
    if (pendingReview?.applied && !pendingReview.observed) {
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
        pendingReview.judgment ?? scope.judgment,
      );
      if (prepared.proposal.proposalHash !== input.proposalHash)
        throw new Error('已应用编辑与原提案不匹配，不能提交复核');
    }
    const authority =
      sdk && input.claim
        ? claimedAgentEditReviewAuthority(
            sdk.run.actions,
            ['build.builder', 'verify.verifier'],
            input.claim,
          )
        : input.reviewer && (sdk || pendingReview?.applied || pendingReview?.judgment === 'agent')
          ? await claimedEditReviewExecutionAuthority(
              { ...scope, judgment: pendingReview?.judgment ?? scope.judgment },
              state.builder_handoff?.builder_execution_ref ??
                (pendingReview?.judgment === 'agent' ? `native-agent/${state.name}` : ''),
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
        retainedCheckActionIds: input.retainedCheckActionIds,
        retainedChecks: input.retainedChecks,
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
