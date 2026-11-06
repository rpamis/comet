import { promises as fs } from 'node:fs';
import { parseCometHookRequest } from '../../platform/process/hook-adapter.js';
import {
  claimedEditReviewAuthority,
  claimedAgentEditReviewAuthority,
  agentEditReviewRecordTemplate,
  readApprovedEditOriginal,
  readApprovedEditOriginalForEvidence,
  approvedEditHash,
  supersedeStaleAppliedEditReviews,
  claimEditReview,
  claimedEditReviewExecutionAuthority,
  editReviewContinuation,
  rememberEditReviewInput,
  inspectEditReviews,
  prepareEditReview,
  prepareObservedEditReview,
  recordEditReview,
  type EditReviewClaim,
  type EditReviewInput,
  type EditReviewCommandOptions,
  areObservedEditsNonBehavioral,
  assertEditReviewsComplete,
} from '../workflow-contract/edit-review.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  classicEditReviewScope,
  classicFormalEditReviewScope,
  observeClassicCheckInputs,
  observeClassicCompatCheckInputs,
  classicCompatCheckExecutionRef,
  observeClassicSdkAcceptedCandidateInputs,
} from './classic-edit-review.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureProtectedProjectDirectory,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import { resolveBranchBinding } from './classic-branch-binding.js';
import { reviseClassicSdkWork } from './classic-sdk-revision.js';
import { classicSdkPresetSourceEvidence } from './classic-formal-source-evidence.js';
import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import {
  latestCommandCheck,
  executeCommandCheck,
  readClassicAcceptedVerifyCheck,
  assertClassicAcceptedCandidateInputs,
  observeClassicAcceptedCandidateInputs,
  readClassicAcceptedCommandCheck,
  classicCheckBeforeUnexecutedAttempt,
} from './classic-command-checks.js';

export async function runClassicEditReviewCommand(options: EditReviewCommandOptions) {
  const { directory } = await resolveClassicChangeDirectory(options.name, options.projectRoot);
  const binding = await resolveBranchBinding(directory, { heal: false, cwd: options.projectRoot });
  if (binding.status === 'drift' || binding.status === 'unbound-detached')
    throw new Error('Classic 编辑复核必须在当前绑定工作区执行');
  if (
    options.operation === 'refresh-checks' &&
    !(await readSdkChangeOwner(options.projectRoot, 'classic', options.name))
  ) {
    if (!options.file) throw new Error('补充检查需要 observe 返回的输入文件');
    const input = JSON.parse(await fs.readFile(options.file, 'utf8')) as {
      expectedCheckEpoch: number;
      sourceActionId: string;
      observationHash: string;
      reportSha256: string;
      summary: string;
    };
    if (
      Object.keys(input).sort().join(',') !==
        'expectedCheckEpoch,observationHash,reportSha256,sourceActionId,summary' ||
      !input.summary?.trim()
    )
      throw new Error('补充检查输入必须绑定原检查、报告和实际观察');
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.run || !projection.classic) throw new Error('补充检查缺少原 Run');
    const { original: check } = await readClassicAcceptedCommandCheck(
      options.projectRoot,
      directory,
      projection.run,
      projection.classic,
    );
    if (!check?.argv || check.provenance !== 'runtime' || !check.reusable)
      throw new Error('只能补原 Runtime 明确可重复的本地 Verify 检查；保留其他执行并先核对');
    const requestId = hashRuntimeValue({
      workflow: 'classic',
      change: options.name,
      runId: projection.run.runId,
      refresh: input as unknown as RuntimeValue,
    });
    const validate = async () => {
      const current = await readClassicState(directory, { migrate: false });
      if (
        !current.classic ||
        current.run?.runId !== projection.run!.runId ||
        current.run.iteration !== projection.run!.iteration ||
        current.run.pending ||
        current.classic.phase !== 'archive' ||
        current.classic.archived ||
        current.classic.verifyResult !== 'pass' ||
        current.classic.checkEpoch !== input.expectedCheckEpoch
      )
        throw new Error('补充检查只能继续原已接受、尚未执行归档的 Run');
      const accepted = await readClassicAcceptedVerifyCheck(
        options.projectRoot,
        directory,
        current.run,
        current.classic,
      );
      if (accepted.reportSha256 !== input.reportSha256)
        throw new Error('补充检查与原已接受报告不匹配');
      await assertClassicAcceptedCandidateInputs(
        options.projectRoot,
        directory,
        current.run,
        current.classic,
      );
      const latest =
        (await latestCommandCheck(options.projectRoot, directory, current.run, 'verify')) ??
        (await classicCheckBeforeUnexecutedAttempt(
          options.projectRoot,
          directory,
          current.run,
          'verify',
        ));
      if (!latest || classicCompatCheckExecutionRef(latest) !== input.sourceActionId)
        throw new Error('原检查执行已变化，读取新的实际观察；不能重放旧请求');
      const observed = await observeClassicCompatCheckInputs(
        options.projectRoot,
        directory,
        current.classic,
        latest,
      );
      if (path.basename(observed.currentRef, '.manifest') !== input.observationHash)
        throw new Error('补充检查的输入已变化，由当前 Agent 只判断新增变化');
      const scopes = [
        await classicEditReviewScope(options.projectRoot, options.name, current.classic),
        await classicFormalEditReviewScope(options.projectRoot, options.name, current.classic),
      ];
      for (const scope of scopes) await assertEditReviewsComplete(scope);
      if (!(await areObservedEditsNonBehavioral(scopes, observed.changes)))
        throw new Error('补充检查需要当前 Agent 证明原验收结论仍适用；实质变化不能沿用原批准');
    };
    const result = await executeCommandCheck(options.projectRoot, directory, projection.run, {
      scope: 'verify',
      argv: check.argv,
      cwd: check.cwd,
      timeoutMs: check.timeoutMs,
      reusable: true,
      tier: check.tier,
      executionRequestId: requestId,
      expectedManifestHash: input.observationHash,
      validateBeforeStart: validate,
    });
    return {
      check: result,
      instruction:
        '核对补充检查的实际结果后继续原归档；原 Run、报告和批准保留。相同请求只返回原结果。',
    };
  }
  return withClassicStateLock(directory, async () => {
    const sdk = (await readSdkChangeOwner(options.projectRoot, 'classic', options.name))
      ? await inspectClassicSdkRun(options.projectRoot, options.name, { readOnly: true })
      : null;
    const compat = sdk ? null : await readClassicState(directory, { migrate: false });
    const state = sdk?.state ?? compat?.classic;
    if (options.operation === 'refresh-checks') {
      const owner = await readSdkChangeOwner(options.projectRoot, 'classic', options.name);
      if (
        !sdk ||
        !options.file ||
        !['classic-full', 'classic-tweak', 'classic-hotfix'].includes(owner?.application ?? '')
      )
        throw new Error(
          '补充检查需要内置 Classic SDK Run 和 observe 返回的输入文件；固定应用保留原定义',
        );
      const input = JSON.parse(await fs.readFile(options.file, 'utf8')) as {
        expectedRevision: number;
      } & Record<string, RuntimeValue>;
      const run = await reviseClassicSdkWork({
        projectRoot: options.projectRoot,
        change: options.name,
        name: 'refresh-checks',
        expectedRevision: input.expectedRevision,
        refreshInput: input,
      });
      const commandId = hashRuntimeValue({
        runId: run.runId,
        name: 'refresh-checks',
        expectedRevision: input.expectedRevision,
      });
      const action = run.actions.find(
        (entry) => entry.id === run.commands?.find((command) => command.id === commandId)?.actionId,
      )!;
      return {
        run,
        application: owner!.application,
        actionId: action.id,
        ...(action.status === 'pending'
          ? {
              executeRequest: {
                protocolVersion: 1,
                operation: 'execute',
                runId: run.runId,
                expectedRevision: run.revision,
                actionId: action.id,
                executorId: 'comet-classic-check',
              },
            }
          : {}),
        instruction:
          action.status === 'pending'
            ? `将 executeRequest 保存为 JSON，执行 comet runtime dispatch --application ${owner!.application} --request <file> --project-root <project> --json；在原 Run 只补检查，原验收报告和批准保留。`
            : '原补充检查已领取或已有结果；使用其原 Action 和当前 continuation 继续，不重复执行。',
      };
    }
    if (!state || !['design', 'build', 'verify', 'archive'].includes(state.phase) || state.archived)
      throw new Error('内容判断需要当前 Build、Verify 或尚未完成归档的 change');
    let scope = {
      ...(await classicEditReviewScope(
        options.projectRoot,
        options.name,
        state,
        options.operation !== 'show',
      )),
      ...(['judge', 'observe', 'prepare-applied'].includes(options.operation) ||
      (sdk &&
        options.sessionId &&
        sdk.run.actions.some(
          (action) => action.status === 'running' && action.claim?.sessionId === options.sessionId,
        ))
        ? { judgment: 'agent' as const }
        : {}),
    };
    if (options.proposalHash && ['claim', 'judge'].includes(options.operation)) {
      const formalScope = await classicFormalEditReviewScope(
        options.projectRoot,
        options.name,
        state,
        true,
        undefined,
        sdk?.run,
      );
      if (
        (await inspectEditReviews(formalScope)).some(
          (review) => review.proposalHash === options.proposalHash,
        )
      )
        scope = formalScope;
    }
    if (options.operation === 'observe') {
      if (!options.sessionId?.trim()) throw new Error('原始变化观察需要当前 Agent 会话');
      const { latestCommandCheck } = await import('./classic-command-checks.js');
      let compatCheck = compat?.run
        ? await latestCommandCheck(
            options.projectRoot,
            directory,
            compat.run,
            state.phase === 'build' ? 'build' : 'verify',
          )
        : null;
      if (!sdk && compat?.run && !compatCheck && state.phase === 'archive')
        compatCheck = await classicCheckBeforeUnexecutedAttempt(
          options.projectRoot,
          directory,
          compat.run,
          'verify',
        );
      if (!sdk && (!compat?.run || !compatCheck || compatCheck.provenance !== 'runtime'))
        throw new Error('原始变化观察需要原 Runtime 检查记录，不能将手工声明或当前文件当作旧执行');
      const observation = sdk
        ? await observeClassicCheckInputs(options.projectRoot, sdk.run)
        : await observeClassicCompatCheckInputs(
            options.projectRoot,
            directory,
            state,
            compatCheck!,
          );
      if (state.phase === 'archive') {
        const candidate = sdk
          ? await observeClassicSdkAcceptedCandidateInputs(options.projectRoot, sdk.run)
          : (
              await observeClassicAcceptedCandidateInputs(
                options.projectRoot,
                directory,
                compat!.run!,
                state,
              )
            ).observation;
        observation.changes.splice(
          0,
          observation.changes.length,
          ...new Map(
            [...observation.changes, ...candidate.changes].map((change) => [
              JSON.stringify(change),
              change,
            ]),
          ).values(),
        );
        Object.assign(observation, {
          candidateBeforeRef: candidate.beforeRef,
          candidateChanges: candidate.changes,
        });
      }
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
          instruction:
            '文件输入未变化时保留原 Run；正式材料由当前 Agent 对照已批准原文判断，显式 Git 依赖按实际变化执行相关检查。',
        };
      await supersedeStaleAppliedEditReviews(scope);
      const proposal = await prepareObservedEditReview(scope, changes);
      const builder = sdk?.run.actions
        .slice()
        .reverse()
        .find((action) =>
          ['full.build.execute', 'tweak.build.execute', 'hotfix.build.execute'].includes(
            action.stepId,
          ),
        );
      const agent = sdk?.run.actions.find(
        (action) =>
          action.status === 'running' &&
          [
            'full.design.handoff',
            'full.build.plan',
            `${state.workflow}.build.execute`,
            `${state.workflow}.verify.run`,
          ].includes(action.stepId) &&
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
            builderExecutionRef: builder?.claim?.sessionId ?? `classic-agent/${options.name}`,
            sessionId: options.sessionId,
          });
      const availableChecks = sdk
        ? sdk.run.actions
            .filter((action) => action.ref === 'classic-check')
            .map((action) => ({
              actionId: action.id,
              status: action.status,
              ...(action.outcome
                ? {
                    argv: (action.outcome.output as { argv?: unknown }).argv,
                    exitCode: (action.outcome.output as { exitCode?: unknown }).exitCode,
                  }
                : {}),
            }))
        : [
            {
              actionId: classicCompatCheckExecutionRef(compatCheck!),
              status: compatCheck!.exitCode === 0 ? 'passed' : 'failed',
              argv: compatCheck!.argv,
              exitCode: compatCheck!.exitCode,
            },
          ];
      return {
        ...claimed,
        observation,
        formalChanges,
        availableChecks,
        instruction:
          '由当前 Agent 读取变化文件、原输入清单及可取得的 Git 差异，结合当前需求判断。列出仍适用的原检查 Action，填写 recordTemplate；不另建审查会话。显式 Git 依赖的变化仍需执行相关检查。',
      };
    }
    let appliedOriginals: Map<string, string> | undefined;
    if (options.operation === 'prepare-applied') {
      scope = await classicFormalEditReviewScope(
        options.projectRoot,
        options.name,
        state,
        true,
        undefined,
        sdk?.run,
      );
      await supersedeStaleAppliedEditReviews(scope);
      if (state.workflow !== 'full' && !scope.allowedFormalPaths?.length) {
        if (sdk && !classicSdkPresetSourceEvidence(sdk.run))
          throw new Error(
            '当前 Preset 正式范围尚未接受；保留文件，继续原 Run 中待处理的材料或范围决定',
          );
        throw new Error(
          '旧 Preset 缺少已接受正式材料的原文登记；保留原 Run 和成果，不能从当前文件补造旧原文',
        );
      }
      const requested = options.file
        ? parseCometHookRequest(await fs.readFile(options.file, 'utf8')).targets.map((target) =>
            path
              .relative(options.projectRoot, path.resolve(options.projectRoot, target))
              .replaceAll('\\', '/'),
          )
        : null;
      let selected: { ref: string; original: string; current: string } | undefined;
      const formalSources: Array<readonly [string, string | null]> = sdk
        ? [
            ['full.design.evidence', state.designDoc],
            ['full.build.plan.evidence', state.plan],
            ...(scope.allowedFormalPaths ?? [])
              .filter((ref) => ref !== state.designDoc && ref !== state.plan)
              .map((ref) => ['sdk.handoff', ref] as const),
          ]
        : (scope.allowedFormalPaths ?? []).map((ref) => ['compat.handoff', ref] as const);
      for (const [stepId, ref] of formalSources) {
        if (!ref || !scope.approvedSources?.[ref] || (requested && !requested.includes(ref)))
          continue;
        const aggregate = sdk
          ? (classicSdkPresetSourceEvidence(sdk.run)?.evidenceHash ?? state.handoffHash)
          : ref === state.plan || ref === state.designDoc || !state.handoffHash
            ? scope.approvedSources[ref]
            : state.handoffHash;
        const accepted =
          sdk && stepId !== 'sdk.handoff'
            ? sdk.run.evidenceWaits
                ?.slice()
                .reverse()
                .find(
                  (wait) =>
                    wait.stepId === stepId &&
                    wait.status === 'resolved' &&
                    wait.receipt?.ref === ref,
                )?.receipt
            : aggregate
              ? { contentHash: aggregate }
              : undefined;
        if (!accepted) continue;
        const current = await readProtectedProjectFile(
          options.projectRoot,
          ref,
          Number.MAX_SAFE_INTEGER,
          { label: 'Classic 正式材料当前内容' },
        );
        const currentHash = createHash('sha256').update(current.bytes).digest('hex');
        if (stepId === 'full.design.evidence' && currentHash === accepted.contentHash) continue;
        const original =
          stepId === 'full.design.evidence'
            ? {
                text: await readApprovedEditOriginal(scope, ref, accepted.contentHash),
                contentHash: accepted.contentHash,
              }
            : await readApprovedEditOriginalForEvidence(scope, ref, accepted.contentHash);
        if (currentHash === original.contentHash) continue;
        const prior = await approvedEditHash(scope, ref, currentHash);
        if (prior?.beforeHash === original.contentHash) continue;
        selected = { ref, original: original.text, current: current.bytes.toString('utf8') };
        break;
      }
      if (!selected)
        return {
          reviews: await inspectEditReviews(scope),
          unavailableSources: (scope.allowedFormalPaths ?? []).filter(
            (ref) => !scope.approvedSources?.[ref],
          ),
          instruction: (scope.allowedFormalPaths ?? []).some((ref) => !scope.approvedSources?.[ref])
            ? '可核对的已批准材料没有尚未处理的变化。部分材料缺少当前接受来源；保留文件，按原 Run 完成对应材料验收，不能补造旧原文。'
            : '当前已批准的正式材料没有尚未处理的变化，沿用原 Run 继续。',
        };
      const source = JSON.stringify({
        cometApplied: true,
        tool_name: 'Write',
        tool_input: {
          file_path: path.resolve(options.projectRoot, selected.ref),
          content: selected.current,
        },
      });
      const root = await ensureProtectedProjectDirectory(
        scope.runtimeRoot,
        'classic/applied-edit-requests',
        { label: 'Classic 原始编辑请求' },
      );
      const file = path.join(root, `${createHash('sha256').update(source).digest('hex')}.json`);
      await atomicWriteContainedText(file, source, { containedRoot: root });
      options = { ...options, file };
      appliedOriginals = new Map([[selected.ref, selected.original]]);
    }
    if (options.file && ['prepare', 'judge', 'record'].includes(options.operation)) {
      const formalScope = await classicFormalEditReviewScope(
        options.projectRoot,
        options.name,
        state,
        options.operation !== 'show',
        undefined,
        sdk?.run,
      );
      const source = await fs.readFile(options.file, 'utf8');
      if (['prepare', 'judge'].includes(options.operation) && scope.judgment === 'agent') {
        const request = parseCometHookRequest(source);
        if (
          request.targets.length &&
          request.targets.every((target) =>
            formalScope.allowedFormalPaths?.includes(
              path
                .relative(
                  options.projectRoot,
                  path.resolve(request.cwd ?? options.projectRoot, target),
                )
                .replaceAll('\\', '/'),
            ),
          )
        )
          scope = formalScope;
      } else if (options.operation === 'record') {
        const input = JSON.parse(source) as EditReviewInput;
        if (
          (await inspectEditReviews(formalScope)).some(
            (review) => review.proposalHash === input.proposalHash,
          )
        )
          scope = formalScope;
      }
    }
    const builder = sdk?.run.actions
      .slice()
      .reverse()
      .find(
        (action) =>
          action.stepId === `${state.workflow}.build.execute` && action.status === 'succeeded',
      );
    const builderExecutionRef =
      builder?.claim?.sessionId ??
      (builder
        ? `classic-builder/${builder.id}/${builder.attempt}`
        : options.operation === 'judge'
          ? `classic-agent/${options.name}`
          : undefined);
    if (options.operation === 'show') {
      const formalScope = await classicFormalEditReviewScope(
        options.projectRoot,
        options.name,
        state,
        false,
        undefined,
        sdk?.run,
      );
      const [ordinary, formal] = await Promise.all([
        inspectEditReviews(scope),
        inspectEditReviews(formalScope),
      ]);
      return {
        reviews: [...ordinary, ...formal],
        continuation:
          (await editReviewContinuation(formalScope, formal, Boolean(sdk))) ??
          (await editReviewContinuation(scope, ordinary, Boolean(sdk))),
      };
    }
    if (options.operation === 'claim' || options.operation === 'judge') {
      if (!builderExecutionRef) throw new Error('编辑领取需要当前候选或 Agent 任务记录');
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
      const claimed = await claimEditReview(scope, {
        proposalHash,
        builderExecutionRef,
        sessionId: options.sessionId ?? '',
      });
      return scope.judgment === 'agent'
        ? {
            ...claimed,
            availableChecks:
              sdk?.run.actions
                .filter((action) => action.ref === 'classic-check')
                .map((action) => {
                  const output = action.outcome?.output as Record<string, unknown> | undefined;
                  return {
                    actionId: action.id,
                    status: action.status,
                    ...(output
                      ? {
                          argv: output.argv,
                          cwd: output.cwd,
                          exitCode: output.exitCode,
                          reusable: output.reusable,
                          receiptRef: output.receiptRef,
                        }
                      : {}),
                  };
                }) ?? [],
          }
        : claimed;
    }
    if (!options.file) throw new Error('编辑复核需要 --file 指定完整请求 JSON');
    const source = await fs.readFile(options.file, 'utf8');
    if (options.operation === 'prepare' || options.operation === 'prepare-applied') {
      const request = parseCometHookRequest(source);
      const proposal = await prepareEditReview(scope, request, appliedOriginals);
      await rememberEditReviewInput(scope, proposal.proposalHash, options.file, source);
      const agentAction =
        scope.judgment === 'agent'
          ? sdk?.run.actions.find(
              (action) =>
                action.status === 'running' &&
                [
                  'full.design.handoff',
                  'full.build.plan',
                  `${state.workflow}.build.execute`,
                  `${state.workflow}.verify.run`,
                ].includes(action.stepId) &&
                (!options.sessionId || action.claim?.sessionId === options.sessionId),
            )
          : undefined;
      const currentAgent =
        scope.judgment === 'agent' && !agentAction && options.sessionId
          ? await claimEditReview(scope, {
              proposalHash: proposal.proposalHash,
              builderExecutionRef: builderExecutionRef ?? `classic-agent/${options.name}`,
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
        request,
        continuation: await editReviewContinuation(
          scope,
          await inspectEditReviews(scope),
          Boolean(sdk),
        ),
        instructions:
          scope.judgment === 'agent'
            ? '由当前 Agent 读取完整原始差异，结合需求、使用方和现有检查判断影响，填写 recordTemplate 并使用当前 Action 的 claim 提交。判断融入当前工作，连续编辑合并处理。实际检查结果与内容判断分别保留；新编辑需补判断。'
            : '读取原文件和完整编辑请求，结合差异、实际使用方及当前验收条件判断影响；文件扩展名、语法结构或 hash 不同本身不能决定回滚。通过 record 提交 non-behavioral、implementation-changed 或 requirements-changed，并说明依据；无法确定时保持待复核。非行为修改应用后重新执行失效检查，再完成当前 Verifier。Compat 必须由用户明确确认复核结果；SDK 可沿用当前独立 Verifier 的 claim，也可由独立会话领取候选绑定的编辑复核任务；会话引用仅用于关联，不代表宿主身份认证。',
      };
    }
    if (options.operation !== 'record')
      throw new Error('编辑复核操作必须是 prepare、claim、record 或 show');
    const input = JSON.parse(source) as EditReviewInput & { claim?: EditReviewClaim };
    const selected = (await inspectEditReviews(scope)).find(
      (review) => review.proposalHash === input.proposalHash,
    );
    if (selected?.judgment === 'agent') scope = { ...scope, judgment: 'agent' };
    const authority = sdk
      ? input.claim
        ? claimedAgentEditReviewAuthority(
            sdk.run.actions,
            [
              'full.design.handoff',
              'full.build.plan',
              `${state.workflow}.build.execute`,
              `${state.workflow}.verify.run`,
            ],
            input.claim,
          )
        : input.reviewer
          ? await claimedEditReviewExecutionAuthority(
              scope,
              builderExecutionRef ??
                (scope.judgment === 'agent' && sdk ? `classic-agent/${sdk.run.runId}` : ''),
              input,
            )
          : claimedEditReviewAuthority(
              sdk.run.actions,
              `${state.workflow}.verify.run`,
              builderExecutionRef,
              input.claim!,
            )
      : input.reviewer && selected?.judgment === 'agent'
        ? await claimedEditReviewExecutionAuthority(
            scope,
            builderExecutionRef ?? `classic-agent/${options.name}`,
            input,
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
