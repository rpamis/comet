import { prepareNativeBuildWorkspace } from './native-build-workspace.js';
import { randomUUID } from 'node:crypto';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import { hasNativeCompletedWork } from './native-experience.js';
import { archiveNativeSdkChange } from './native-sdk-archive-command.js';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';
import { settleNativeSdkCompletion } from './native-sdk-completion-cleanup.js';
import { inspectNativeSdkRunDiagnostics } from './native-sdk-diagnostics.js';
import { refreshNativeSdkVerificationReport } from './native-sdk-report.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  hashRuntimeValue,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import type {
  NativeSupervisorCoordinationMode,
  NativePortableState,
} from './native-portable-types.js';
import {
  inspectNativeSdkDefinitionUpgrade,
  inspectNativeSdkRun,
  loadOwnedNativeSdkRuntime,
} from './native-runtime-ownership.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
  nativeSdkApplicationForRun,
} from './native-sdk-application.js';
import { nativeSdkNextAction, nativeSdkPendingActions } from './native-sdk-continuation.js';
import {
  nativeSdkRequirementsRevisionAllowed,
  recoverNativeSdkImplementationRevision,
} from './native-sdk-revise.js';
import { createNativeSdkStateStore } from './native-sdk-state-store.js';
import { projectNativeSdkStatus, projectNativeSdkTaskStatus } from './native-sdk-status.js';
import {
  nativeSdkChildVerifierRetryWaits,
  validateNativeSdkFailedChildVerifier,
  nativeSdkLegacyChildFailureForWait,
} from './native-sdk-supervisor-verifier-recovery.js';
import { nativeSdkVerifyDecisions } from './native-sdk-verify-decision.js';
/** 子任务可并行领取；已就绪的内部检查与集成继续按队列串行执行。 */
function nextAutomaticAction(
  run: WorkflowRun,
  state: NativePortableState,
  fixedApplication: boolean,
) {
  const next = nativeSdkNextAction(run, state);
  return !fixedApplication &&
    ['3', '4'].includes(run.workflow.version) &&
    state.children_contract_ref &&
    next?.type === 'handoff'
    ? (nativeSdkPendingActions(run).find((action) => action.type === 'call_tool') ?? next)
    : next;
}
async function sdkNextResult(
  projectRoot: string,
  name: string,
  run: WorkflowRun,
  artifactRootRef: string,
  application: Awaited<ReturnType<typeof inspectNativeSdkRun>>['application'],
  taskProjection = false,
): Promise<DispatchResult> {
  const state = parseNativePortableState(run.state);
  let warning:
    | {
        code: string;
        message: string;
      }
    | undefined;
  {
    try {
      await refreshNativeSdkVerificationReport(projectRoot, run);
    } catch (error) {
      warning = {
        code: 'NATIVE_REPORT_PENDING',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return success('next', {
    ...(warning ? { warning } : {}),
    change: name,
    ...(taskProjection && !application
      ? await projectNativeSdkTaskStatus({ projectRoot, name }, run, state)
      : await projectNativeSdkStatus(
          { projectRoot, name },
          { run, state, artifactRootRef, application },
        )),
  });
}
export async function advanceNativeSdkChange(
  projectRoot: string,
  name: string,
  decision?:
    | {
        summary?: string;
        expectedStateVersion?: number;
        expectedAction?: 'prepare-shape-confirmation';
      }
    | {
        summary: string;
        expectedStateVersion: number;
        expectedAction: 'revise-requirements';
        proposalHash?: string;
      }
    | {
        summary: string;
        expectedStateVersion: number;
        expectedAction: 'confirm-shape';
        deferBuild?: boolean;
        coordinationMode?: NativeSupervisorCoordinationMode;
      }
    | {
        summary: string;
        proposalHash: string;
        expectedStateVersion: number;
        expectedAction: 'accept-result' | 'revise-implementation' | 'retry-verifier';
      }
    | {
        summary: string;
        proposalHash: string;
        expectedStateVersion: number;
        expectedAction: 'continue-builder' | 'resolve-verifier-blocker';
      },
  initial?: Awaited<ReturnType<typeof inspectNativeSdkRun>>,
  taskProjection = false,
  observeTaskResult?: (
    run: WorkflowRun,
    status: Awaited<ReturnType<typeof projectNativeSdkTaskStatus>>,
  ) => void,
): Promise<DispatchResult> {
  let { run, state, artifactRootRef, application } =
    initial ?? (await inspectNativeSdkRun(projectRoot, name));
  const originalRun = run;
  const nextResult = async (...args: Parameters<typeof sdkNextResult>) => {
    const result = await sdkNextResult(
      ...(args.slice(0, 5) as [string, string, WorkflowRun, string, typeof application]),
      taskProjection,
    );
    if (taskProjection && !args[4])
      observeTaskResult?.(
        args[2],
        result.data as Awaited<ReturnType<typeof projectNativeSdkTaskStatus>>,
      );
    return { ...result, workflowCompleted: hasNativeCompletedWork(originalRun, args[2]) };
  };
  // 已授权的内置归档沿用同一推进入口，避免 next 再执行一套归档前置检查。
  if (
    !decision &&
    !application &&
    !state.children_contract_ref &&
    state.phase === 'archive' &&
    run.status === 'running' &&
    run.actions.some(
      (action) => action.status === 'pending' && action.stepId.startsWith('archive.'),
    )
  ) {
    try {
      return {
        ...(await archiveNativeSdkChange({
          projectRoot,
          name,
          dryRun: false,
          recover: false,
          confirmed: false,
        })),
        command: 'next',
      };
    } catch (error) {
      if (
        state.workspace.change_branch &&
        inspectGitWorktree(projectRoot).currentBranch !== state.workspace.change_branch
      ) {
        const current = await inspectNativeSdkRun(projectRoot, name, { readOnly: true });
        return nextResult(
          projectRoot,
          name,
          current.run,
          current.artifactRootRef,
          current.application,
        );
      }
      throw error;
    }
  }
  const interrupted = run.actions.filter((action) =>
    ['running', 'unknown'].includes(action.status),
  );
  if (interrupted.some((action) => action.stepId === 'repair.implementation')) {
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    run = await recoverNativeSdkImplementationRevision(projectRoot, run, runtime);
    state = parseNativePortableState(run.state);
  }
  if (run.status === 'cancelled') {
    await settleNativeSdkCancellation({ projectRoot, run });
    return nextResult(projectRoot, name, run, artifactRootRef, application);
  }
  if (run.status === 'completed') {
    await settleNativeSdkCompletion({ projectRoot, run });
  }
  if (
    decision &&
    (decision.expectedAction === undefined ||
      decision.expectedAction === 'prepare-shape-confirmation')
  ) {
    if (
      (decision.summary !== undefined && !decision.summary.trim()) ||
      (decision.expectedAction === 'prepare-shape-confirmation' && decision.summary === undefined)
    )
      throw new NativeUsageError('--summary 不能为空。');
    const prepare = run.actions.find((action) => action.status === 'pending');
    if (
      (decision.expectedStateVersion !== undefined &&
        state.state_version !== decision.expectedStateVersion) ||
      (decision.expectedAction === 'prepare-shape-confirmation' &&
        (state.phase !== 'shape' ||
          state.status !== 'active' ||
          prepare?.stepId !== 'shape.prepare'))
    )
      return {
        ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native SDK 推进动作已失效，请读取当前阶段、状态版本和待执行 Action。',
        },
      };
  }
  if (!decision && ['failed', 'cancelled'].includes(run.status))
    return nextResult(projectRoot, name, run, artifactRootRef, application);
  if (
    decision?.expectedAction === 'retry-verifier' ||
    decision?.expectedAction === 'revise-implementation'
  ) {
    const wait = nativeSdkChildVerifierRetryWaits(run).find(
      (candidate) => candidate.proposalHash === decision.proposalHash,
    );
    if (wait) {
      if (
        state.state_version !== decision.expectedStateVersion ||
        ['failed', 'cancelled', 'completed'].includes(run.status)
      )
        return {
          ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
          exitCode: 73,
          error: { code: 'conflict', message: 'Native Child Verifier recovery decision is stale' },
        };
      if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
      const actionId = (
        wait.proposal as {
          activation: {
            failedVerifierActionId: string;
          };
        }
      ).activation?.failedVerifierActionId;
      const action =
        run.actions.find((candidate) => candidate.id === actionId) ??
        nativeSdkLegacyChildFailureForWait(run, wait);
      if (!action) throw new Error('Child decision lacks its original failure');
      if (decision.expectedAction === 'retry-verifier')
        await validateNativeSdkFailedChildVerifier(run, action, projectRoot);
      const choice = decision.expectedAction === 'retry-verifier' ? 'retry' : 'repair';
      const completed = await (
        await loadOwnedNativeSdkRuntime(projectRoot, name)
      ).runtime.resolveWait({
        runId: run.runId,
        expectedRevision: run.revision,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: hashRuntimeValue({
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          summary: decision.summary.trim(),
          choice,
        }),
        choice,
      });
      return nextResult(projectRoot, name, completed, artifactRootRef, application);
    }
  }
  if (decision?.expectedAction === 'continue-builder') {
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        [
          'build.resume',
          'supervisor.child.resume',
          'supervisor.parent.resume',
          'supervisor.child.integration-resume',
        ].includes(candidate.stepId) &&
        candidate.proposalHash === decision.proposalHash,
    );
    if (!wait || state.state_version !== decision.expectedStateVersion) {
      return {
        ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: { code: 'conflict', message: `Native SDK Builder decision for ${name} is stale` },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    await (
      await loadOwnedNativeSdkRuntime(projectRoot, name)
    ).runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: decision.proposalHash,
      decisionId: hashRuntimeValue({
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        summary: decision.summary.trim(),
        choice: 'continue',
      }),
      choice: 'continue',
    });
    return advanceNativeSdkChange(
      projectRoot,
      name,
      undefined,
      undefined,
      taskProjection,
      observeTaskResult,
    );
  }
  if (decision?.expectedAction === 'revise-requirements') {
    const shapeWait = run.waits.find(
      (wait) =>
        wait.status === 'pending' &&
        ['shape.confirm', 'supervisor.shape.confirm'].includes(wait.stepId),
    );
    const inFlight = run.actions.some((action) => ['running', 'unknown'].includes(action.status));
    const renewShape =
      state.phase === 'shape' &&
      state.status === 'await-user' &&
      state.loop.next_action === 'confirm-shape' &&
      shapeWait !== undefined &&
      decision.proposalHash === shapeWait.proposalHash &&
      !inFlight;
    if (
      state.state_version !== decision.expectedStateVersion ||
      (!renewShape && !nativeSdkRequirementsRevisionAllowed(run, state, decision.proposalHash))
    ) {
      return {
        ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: {
          code: 'conflict',
          message: inFlight
            ? `ACTION_IN_FLIGHT: Native SDK ${name} 仍有 running/unknown Action；先核对并回报原任务结果，再按当前 continuation 修订需求。`
            : `Native SDK requirements revision for ${name} is stale; follow the current continuation and proposal hash`,
        },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    if (renewShape) {
      await runtime.resolveWait({
        runId: run.runId,
        expectedRevision: run.revision,
        waitId: shapeWait!.id,
        proposalHash: shapeWait!.proposalHash,
        decisionId: hashRuntimeValue({
          waitId: shapeWait!.id,
          proposalHash: shapeWait!.proposalHash,
          summary: decision.summary.trim(),
          choice: 'rejected',
        }),
        choice: 'rejected',
      });
      return advanceNativeSdkChange(
        projectRoot,
        name,
        undefined,
        undefined,
        taskProjection,
        observeTaskResult,
      );
    }
    const commandId = hashRuntimeValue({
      runId: run.runId,
      name: 'revise-requirements',
      stateVersion: decision.expectedStateVersion,
      reason: decision.summary.trim(),
      ...(decision.proposalHash === undefined ? {} : { proposalHash: decision.proposalHash }),
    });
    const dispatched = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId,
      name: 'revise-requirements',
      input: {
        reason: decision.summary.trim(),
        expectedStateVersion: decision.expectedStateVersion,
        ...(decision.proposalHash === undefined ? {} : { proposalHash: decision.proposalHash }),
      },
      context: { requestId: randomUUID(), projectRoot },
    });
    const receipt = dispatched.commands?.find((command) => command.id === commandId);
    const action = dispatched.actions.find((candidate) => candidate.id === receipt?.actionId);
    if (!action) throw new Error('Native SDK requirements revision Action is missing');
    if (action.status === 'running' || action.status === 'unknown') {
      throw new Error('Native SDK requirements revision outcome is unknown; reconcile its Action');
    }
    if (action.status === 'failed') throw new Error('Native SDK requirements revision failed');
    let completed = dispatched;
    if (action.status === 'pending') {
      completed = await runtime.execute({
        runId: run.runId,
        actionId: action.id,
        executorId: 'comet-native-revise-requirements',
        context: { requestId: randomUUID(), projectRoot },
      });
    }
    return nextResult(projectRoot, name, completed, artifactRootRef, application);
  }
  if (
    decision?.expectedAction === 'accept-result' ||
    decision?.expectedAction === 'revise-implementation' ||
    decision?.expectedAction === 'retry-verifier' ||
    decision?.expectedAction === 'resolve-verifier-blocker'
  ) {
    if (decision.expectedAction === 'accept-result' && state.phase === 'archive') {
      const approved = run.waits.find(
        (wait) =>
          wait.stepId === 'verify.confirm' &&
          wait.status === 'resolved' &&
          wait.decision?.choice === 'approved' &&
          wait.proposalHash === decision.proposalHash,
      );
      const report = (
        approved?.proposal as {
          activation?: {
            report?: {
              candidateId?: string;
              reportSha256?: string;
            };
          };
        }
      )?.activation?.report;
      if (approved && report?.candidateId === state.builder_handoff?.candidate_id)
        return nextResult(projectRoot, name, run, artifactRootRef, application);
    }
    if (decision.expectedAction === 'revise-implementation') {
      const commandId = hashRuntimeValue({
        name: 'revise-implementation',
        runId: run.runId,
        expectedStateVersion: decision.expectedStateVersion,
        proposalHash: decision.proposalHash,
        reason: decision.summary.trim(),
      });
      const previous = run.commands?.find((command) => command.id === commandId);
      if (previous) {
        const action = run.actions.find((candidate) => candidate.id === previous.actionId);
        if (action?.status === 'pending') {
          const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
          run = await runtime.execute({
            runId: run.runId,
            actionId: action.id,
            executorId: 'comet-native-revise-implementation',
            context: { requestId: randomUUID(), projectRoot },
          });
        }
        return nextResult(projectRoot, name, run, artifactRootRef, application);
      }
      if (state.phase === 'archive') {
        if (state.state_version !== decision.expectedStateVersion || !decision.summary.trim())
          return {
            ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
            exitCode: 73,
            error: { code: 'conflict', message: 'Native implementation revision is stale' },
          };
        const upgrade = await inspectNativeSdkDefinitionUpgrade(projectRoot, name, true);
        if (upgrade?.repaired)
          ({ run, state, artifactRootRef, application } = await inspectNativeSdkRun(
            projectRoot,
            name,
          ));
        const pending = nativeSdkNextAction(run, state);
        if (!pending || !['archive.prepare', 'archive.execute'].includes(pending.stepId))
          return {
            ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
            exitCode: 73,
            error: { code: 'conflict', message: 'Native Archive action is no longer pending' },
          };
        const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
        const dispatched = await runtime.dispatchCommand({
          runId: run.runId,
          expectedRevision: run.revision,
          commandId,
          name: 'revise-implementation',
          input: {
            reason: decision.summary.trim(),
            expectedStateVersion: decision.expectedStateVersion,
            proposalHash: decision.proposalHash,
            archiveActionId: pending.id,
          },
          context: { requestId: randomUUID(), projectRoot },
        });
        const action = dispatched.actions.find(
          (candidate) =>
            candidate.id ===
            dispatched.commands?.find((command) => command.id === commandId)?.actionId,
        );
        if (!action) throw new Error('Native implementation revision Action is missing');
        if (action.status !== 'pending')
          return nextResult(projectRoot, name, dispatched, artifactRootRef, application);
        const completed = await runtime.execute({
          runId: run.runId,
          actionId: action.id,
          executorId: 'comet-native-revise-implementation',
          context: { requestId: randomUUID(), projectRoot },
        });
        return nextResult(projectRoot, name, completed, artifactRootRef, application);
      }
    }
    const recovery = nativeSdkVerifyDecisions(run, state).find(
      ({ action, wait }) =>
        action === decision.expectedAction && wait.proposalHash === decision.proposalHash,
    );
    if (!recovery || state.state_version !== decision.expectedStateVersion) {
      return {
        ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: { code: 'conflict', message: `Native SDK Verify decision for ${name} is stale` },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const { wait, choice } = recovery;
    await (
      await loadOwnedNativeSdkRuntime(projectRoot, name)
    ).runtime.resolveWait({
      runId: run.runId,
      expectedRevision: run.revision,
      waitId: wait.id,
      proposalHash: decision.proposalHash,
      decisionId: hashRuntimeValue({
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        summary: decision.summary.trim(),
        choice,
      }),
      choice,
      reason: decision.summary.trim(),
    });
    return advanceNativeSdkChange(
      projectRoot,
      name,
      undefined,
      undefined,
      taskProjection,
      observeTaskResult,
    );
  }
  if (decision?.expectedAction === 'confirm-shape') {
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        candidate.stepId ===
          (decision.coordinationMode ? 'supervisor.shape.confirm' : 'shape.confirm'),
    );
    if (
      !wait ||
      state.state_version !== decision.expectedStateVersion ||
      state.loop.next_action !== decision.expectedAction
    ) {
      return {
        ...(await nextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: { code: 'conflict', message: `Native SDK Shape confirmation for ${name} is stale` },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    const confirmedRun = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: hashRuntimeValue({
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        summary: decision.summary.trim(),
        choice: decision.coordinationMode ?? 'approved',
      }),
      choice: decision.coordinationMode ?? 'approved',
    });
    if (decision.deferBuild)
      return nextResult(projectRoot, name, confirmedRun, artifactRootRef, application);
    return advanceNativeSdkChange(
      projectRoot,
      name,
      undefined,
      undefined,
      taskProjection,
      observeTaskResult,
    );
  }
  if (
    run.waits.some(
      (wait) => wait.status === 'pending' && wait.stepId.startsWith('native.extension.revise.'),
    )
  )
    return nextResult(projectRoot, name, run, artifactRootRef, application);
  if (
    !application &&
    state.phase === 'build' &&
    !run.actions.some(
      (action) =>
        ['build.builder', 'supervisor.prepare'].includes(action.stepId) &&
        action.status !== 'pending',
    )
  ) {
    const target = await prepareNativeBuildWorkspace(projectRoot, name);
    if (target !== projectRoot)
      return {
        ...(await advanceNativeSdkChange(
          target,
          name,
          undefined,
          undefined,
          taskProjection,
          observeTaskResult,
        )),
        executionCwd: target,
      };
  }
  const diagnostics = await inspectNativeSdkRunDiagnostics(projectRoot, run);
  if (!diagnostics.healthy) return nextResult(projectRoot, name, run, artifactRootRef, application);
  if (
    run.ready.length === 0 &&
    nextAutomaticAction(run, state, Boolean(application))?.type !== 'call_tool'
  )
    return nextResult(projectRoot, name, run, artifactRootRef, application);
  // 同一次请求共享应用加载；每个 Action 仍单独领取、校验并持久化。
  const owned = await loadOwnedNativeSdkRuntime(projectRoot, name);
  // 取走加载时的快照，后续 Shape 的 CAS 发布后从同一 store 读取新 Action。
  run = await owned.runtime.inspect(name);
  state = parseNativePortableState(run.state);
  const automaticSteps = !application ? 32 : 1;
  for (let steps = 0; steps < automaticSteps; steps++) {
    if (['failed', 'cancelled', 'completed'].includes(run.status)) break;
    if (
      steps > 0 &&
      !state.archived &&
      state.workspace.change_branch &&
      inspectGitWorktree(projectRoot).currentBranch !== state.workspace.change_branch
    )
      return nextResult(projectRoot, name, run, artifactRootRef, application);
    if (run.ready.length > 0) {
      run = await owned.runtime.next({ runId: run.runId });
      state = parseNativePortableState(run.state);
    }
    const pending = nextAutomaticAction(run, state, Boolean(application));
    if (!pending) {
      return nextResult(projectRoot, name, run, artifactRootRef, application);
    }
    if (pending.type !== 'call_tool')
      return nextResult(projectRoot, name, run, artifactRootRef, application);
    if (pending.stepId !== 'shape.prepare' && pending.stepId !== 'shape.revalidate') {
      const { runtime, executors } = owned;
      const executor = executors.find((candidate) => candidate.supports(pending));
      if (!executor) throw new Error(`Native SDK Action ${pending.stepId} has no executor`);
      if (pending.stepId.startsWith('archive.'))
        reportCometRuntimeProgress(
          pending.stepId === 'archive.prepare'
            ? '核对归档材料'
            : pending.stepId === 'archive.execute'
              ? '更新正式规格'
              : '完成归档',
        );
      const completed = await runtime.execute({
        runId: run.runId,
        actionId: pending.id,
        executorId: executor.id,
        context: { requestId: randomUUID(), projectRoot },
      });
      if (
        completed.revision === run.revision ||
        completed.actions.find((action) => action.id === pending.id)?.status !== 'succeeded'
      )
        return nextResult(projectRoot, name, completed, artifactRootRef, application);
      run = completed;
      state = parseNativePortableState(run.state);
      continue;
    }
    const paths = await nativeProjectPaths(projectRoot, artifactRootRef, { change: name });
    const proposal = await collectNativeSdkShapeProposal({
      paths,
      state,
      materializeTargets: true,
    });
    // 纯 Shape 计算可重做：保留原 claim/outcome 校验，只在成功后发布一个 revision。
    // 外部执行和固定应用仍使用原来的持久化两阶段协议。
    const staging =
      !application && ['3', '4'].includes(run.workflow.version)
        ? createMemoryRuntimeStore<WorkflowRun>()
        : undefined;
    if (staging) await staging.restoreCheckpoint!(run.runId, null, run);
    const definition = staging
      ? nativeSdkApplicationForRun(run, defineNativeWorkflowApplication('4'))
      : undefined;
    const runtime = definition
      ? createRuntime({
          ...definition,
          store: staging!,
          workflows: [definition.workflow],
          transitionHandlers: [definition.transitionHandler],
        })
      : owned.runtime;
    const requestId = randomUUID();
    const context = { requestId, projectRoot };
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-cli',
      claimToken: requestId,
      context,
    });
    const claimedAction = claimed.actions.find((action) => action.id === pending.id);
    if (!claimedAction?.claim) throw new Error(`Native SDK Action ${pending.id} was not claimed`);
    const completed = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: pending.id,
        attempt: pending.attempt,
        inputHash: pending.inputHash,
        claimToken: claimedAction.claim.token,
        outcomeId: requestId,
        status: 'succeeded',
        output: proposal as unknown as RuntimeValue,
      },
      context,
    });
    if (staging) {
      const next = { ...completed, revision: run.revision + 1 };
      if (
        !(await createNativeSdkStateStore(projectRoot).compareAndSwap(
          run.runId,
          run.revision,
          next,
        ))
      )
        throw new Error('Native Shape 输入或 Run 已变化，请重新读取当前提案');
      run = next;
    } else run = completed;
    state = parseNativePortableState(run.state);
  }
  return nextResult(projectRoot, name, run, artifactRootRef, application);
}
