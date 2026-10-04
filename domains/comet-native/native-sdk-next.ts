import { randomUUID } from 'node:crypto';

import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { collectNativeSdkShapeProposal } from './native-sdk-application.js';
import { nativeProjectPaths } from './native-paths.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { inspectNativeSdkStatus } from './native-sdk-status.js';
import { inspectNativeSdkSupervisorRecovery } from './native-sdk-supervisor-recovery.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
  type NativeSupervisorCoordinationMode,
} from './native-portable-types.js';

function sdkShapeContinuation(
  state: NativePortableState,
  supervisorConfirmation: boolean,
): ReturnType<typeof nativePortableContinuation> {
  const continuation = nativePortableContinuation(state);
  if (!supervisorConfirmation) return continuation;
  const chinese = state.language === 'zh-CN';
  return {
    ...continuation,
    requiredInputs: ['summary', 'shared-understanding-confirmation', 'coordination-mode'],
    commandAlternatives: NATIVE_SUPERVISOR_COORDINATION_MODES.map((mode) => ({
      name: mode,
      stateVersion: state.state_version,
      expectedAction: 'confirm-shape' as const,
      commandArgs: [
        'comet',
        'native',
        'next',
        state.name,
        '--summary',
        '<summary>',
        '--confirmed',
        '--coordination-mode',
        mode,
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'confirm-shape',
      ],
      requiredInputs: ['summary', 'shared-understanding-confirmation', 'coordination-mode'],
      inputOptions: [
        {
          name: 'summary',
          flag: '--summary',
          valueKind: 'text' as const,
          required: true,
          template: null,
        },
        {
          name: 'shared-understanding-confirmation',
          flag: '--confirmed',
          valueKind: 'confirmation' as const,
          required: true,
          template: null,
        },
        {
          name: 'coordination-mode',
          flag: '--coordination-mode',
          valueKind: 'choice' as const,
          required: true,
          template: mode,
          choices: [...NATIVE_SUPERVISOR_COORDINATION_MODES],
        },
      ],
    })),
    userCommunication: {
      required: true,
      message: chinese
        ? '请确认完整 Shape，并选择推进方式：多会话协作（推荐）或单会话推进。'
        : 'Confirm the complete Shape and choose multi-session coordination (recommended) or single-session progression.',
      suggestedReply: chinese
        ? '确认 Shape，选择多会话协作'
        : 'Confirm Shape with multi-session coordination',
      agentInstruction: chinese
        ? '先简要展示目标、范围、关键决定、验收标准、非目标及 Child 计划，再转述 message。只有用户明确确认当前完整 Shape 并选定推进方式后，才执行对应的 commandAlternatives；补充或修改要求不算确认。'
        : 'Summarize the target, scope, key decisions, acceptance criteria, non-goals, and child plan before relaying message. Execute the matching commandAlternative only after the user explicitly confirms the complete current Shape and chooses a coordination mode; additions or corrections are not confirmation.',
    },
  };
}

function sdkLoopStopContinuation(state: NativePortableState, proposalHash: string) {
  const continuation = nativePortableContinuation(state);
  if (!continuation.commandAlternatives) {
    throw new Error('Native SDK Verify stop has no recovery choices');
  }
  return {
    ...continuation,
    commandAlternatives: continuation.commandAlternatives.map((alternative) => {
      if (alternative.name !== 'revise-implementation' || !alternative.commandArgs) {
        return alternative;
      }
      const position = alternative.commandArgs.indexOf('--expected-state-version');
      if (position < 0) throw new Error('Native SDK repair command lacks its state version');
      return {
        ...alternative,
        commandArgs: [
          ...alternative.commandArgs.slice(0, position),
          '--proposal-hash',
          proposalHash,
          ...alternative.commandArgs.slice(position),
        ],
      };
    }),
  };
}

async function sdkNextResult(projectRoot: string, name: string): Promise<DispatchResult> {
  const { run, state } = await inspectNativeSdkRun(projectRoot, name);
  const recovery = await inspectNativeSdkSupervisorRecovery(run, projectRoot);
  const pendingActions = run.actions
    .filter((action) => action.status === 'pending')
    .map((action) => ({
      id: action.id,
      stepId: action.stepId,
      mechanism: 'runtime-dispatch',
    }));
  const pendingBuilderDecisions = run.waits
    .filter(
      (wait) =>
        wait.status === 'pending' &&
        ['build.resume', 'supervisor.child.resume', 'supervisor.parent.resume'].includes(
          wait.stepId,
        ),
    )
    .map((wait) => ({
      waitId: wait.id,
      stepId: wait.stepId,
      proposalHash: wait.proposalHash,
      commandArgs: [
        'comet',
        'native',
        'next',
        name,
        '--continue-builder',
        '--summary',
        '<summary>',
        '--proposal-hash',
        wait.proposalHash,
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'continue-builder',
      ],
    }));
  const loopStop = run.waits.find(
    (wait) => wait.status === 'pending' && wait.stepId === 'verify.stop',
  );
  const requirementRevisions = run.waits
    .filter(
      (wait) => wait.status === 'pending' && wait.stepId.startsWith('native.extension.revise.'),
    )
    .map((wait) => ({
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: wait.proposal,
      commandArgs: [
        'comet',
        'native',
        'next',
        name,
        '--revise-requirements',
        '--summary',
        '<用户确认的修订原因>',
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'revise-requirements',
      ],
      message:
        '扩展发现需求变化。请确认是否修订需求；确认后回到 Shape，原候选和验收不会复用。先核对 running/unknown 工作。',
    }));
  return success('next', {
    change: name,
    ...(await inspectNativeSdkStatus({ projectRoot, name })),
    ...(pendingBuilderDecisions.length > 0 ? { pendingBuilderDecisions } : {}),
    ...(requirementRevisions.length > 0
      ? { pendingRequirementDecisions: requirementRevisions }
      : {}),
    ...(recovery
      ? {
          continuation: {
            ...nativePortableContinuation(state),
            action: 'resolve-verifier-blocker',
            disposition: 'await-user',
            requiresUserDecision: true,
            commandArgs: [
              'comet',
              'native',
              'next',
              name,
              '--resolve-verifier-blocker',
              '--summary',
              '<summary>',
              '--proposal-hash',
              recovery.proposalHash,
              '--expected-state-version',
              String(state.state_version),
              '--expected-action',
              'resolve-verifier-blocker',
            ],
            requiredInputs: ['summary', 'proposal-hash'],
            commandAlternatives: [],
            inputOptions: [
              {
                name: 'summary',
                flag: '--summary',
                valueKind: 'text',
                required: true,
                template: null,
              },
              {
                name: 'proposal-hash',
                flag: '--proposal-hash',
                valueKind: 'text',
                required: true,
                template: recovery.proposalHash,
              },
            ],
            runnerAction: { ...nativePortableContinuation(state).runnerAction, kind: 'none' },
            userCommunication: {
              required: true,
              message:
                '独立 Child 验收被阻塞。确认恢复后，原 Run 将派发新的 Builder，保留原候选、检查和失败记录。后继候选需要重新检查和独立验收。',
              suggestedReply: '恢复原 Child，由新的 Builder 继续处理阻塞',
              agentInstruction:
                '只有明确选择恢复当前 Child 后才执行此命令；不得改写原结果或把原检查作为后继候选的通过证据。',
            },
          },
        }
      : loopStop
        ? { continuation: sdkLoopStopContinuation(state, loopStop.proposalHash) }
        : state.phase === 'shape'
          ? {
              continuation: sdkShapeContinuation(
                state,
                run.waits.some(
                  (wait) => wait.status === 'pending' && wait.stepId === 'supervisor.shape.confirm',
                ),
              ),
            }
          : pendingActions.length > 0
            ? {
                pendingAction: pendingActions[0],
                pendingActions,
              }
            : {}),
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
      }
    | {
        summary: string;
        expectedStateVersion: number;
        expectedAction: 'confirm-shape';
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
): Promise<DispatchResult> {
  const { run, state, artifactRootRef } = await inspectNativeSdkRun(projectRoot, name);
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
        command: 'next',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native SDK 推进动作已失效，请读取当前阶段、状态版本和待执行 Action。',
        },
      };
  }
  if (decision?.expectedAction === 'resolve-verifier-blocker') {
    const recovery = await inspectNativeSdkSupervisorRecovery(run, projectRoot);
    if (!decision.summary.trim()) throw new NativeUsageError('--summary 不能为空。');
    if (
      !recovery ||
      state.state_version !== decision.expectedStateVersion ||
      recovery.proposalHash !== decision.proposalHash
    ) {
      return {
        command: 'next',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native Child blocked 恢复决定已失效，请重新读取原 Run。',
        },
      };
    }
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    await runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: recovery.actionId,
      attempt: recovery.attempt,
      proposalHash: decision.proposalHash,
      context: { requestId: randomUUID(), projectRoot },
    });
    return sdkNextResult(projectRoot, name);
  }
  if (decision?.expectedAction === 'continue-builder') {
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        ['build.resume', 'supervisor.child.resume', 'supervisor.parent.resume'].includes(
          candidate.stepId,
        ) &&
        candidate.proposalHash === decision.proposalHash,
    );
    if (!wait || state.state_version !== decision.expectedStateVersion) {
      return {
        command: 'next',
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
    return advanceNativeSdkChange(projectRoot, name);
  }
  if (decision?.expectedAction === 'revise-requirements') {
    if (
      state.state_version !== decision.expectedStateVersion ||
      !(
        ['verify', 'archive'].includes(state.phase) ||
        (state.phase === 'build' && state.children_contract_hash)
      )
    ) {
      return {
        command: 'next',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: `Native SDK requirements revision for ${name} is stale`,
        },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    const commandId = hashRuntimeValue({
      runId: run.runId,
      name: 'revise-requirements',
      stateVersion: decision.expectedStateVersion,
      reason: decision.summary.trim(),
    });
    const dispatched = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId,
      name: 'revise-requirements',
      input: {
        reason: decision.summary.trim(),
        expectedStateVersion: decision.expectedStateVersion,
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
    if (action.status === 'pending') {
      await runtime.execute({
        runId: run.runId,
        actionId: action.id,
        executorId: 'comet-native-revise-requirements',
        context: { requestId: randomUUID(), projectRoot },
      });
    }
    return sdkNextResult(projectRoot, name);
  }
  if (
    decision?.expectedAction === 'accept-result' ||
    decision?.expectedAction === 'revise-implementation' ||
    decision?.expectedAction === 'retry-verifier'
  ) {
    const retry = decision.expectedAction === 'retry-verifier';
    const loopStop =
      decision.expectedAction === 'revise-implementation' &&
      state.loop.next_action === 'await-user';
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        candidate.stepId === (retry ? 'verify.retry' : loopStop ? 'verify.stop' : 'verify.confirm'),
    );
    if (
      !wait ||
      state.phase !== 'verify' ||
      state.loop.next_action !==
        (retry ? 'retry-verifier' : loopStop ? 'await-user' : 'confirm-skill-coordinated-pass') ||
      state.state_version !== decision.expectedStateVersion ||
      wait.proposalHash !== decision.proposalHash
    ) {
      return {
        command: 'next',
        exitCode: 73,
        error: { code: 'conflict', message: `Native SDK Verify decision for ${name} is stale` },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const choice = retry
      ? 'retry'
      : loopStop
        ? 'repair'
        : decision.expectedAction === 'accept-result'
          ? 'approved'
          : 'rejected';
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
        choice,
      }),
      choice,
    });
    return advanceNativeSdkChange(projectRoot, name);
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
        command: 'next',
        exitCode: 73,
        error: { code: 'conflict', message: `Native SDK Shape confirmation for ${name} is stale` },
      };
    }
    if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
    const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
    const current = await collectNativeSdkShapeProposal({ paths, state });
    const approved = (wait.proposal as { outputs?: Record<string, RuntimeValue> }).outputs?.[
      'shape.prepare'
    ];
    if (
      !approved ||
      hashRuntimeValue(current as unknown as RuntimeValue) !== hashRuntimeValue(approved) ||
      current.shapeConfirmationHash !== state.shape_confirmation_hash
    ) {
      return {
        command: 'next',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: `Native SDK Shape documents changed after the approval proposal for ${name}`,
        },
      };
    }
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    await runtime.resolveWait({
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
    return advanceNativeSdkChange(projectRoot, name);
  }
  if (
    run.waits.some(
      (wait) => wait.status === 'pending' && wait.stepId.startsWith('native.extension.revise.'),
    )
  )
    return sdkNextResult(projectRoot, name);
  const pending = run.actions.find((action) => action.status === 'pending');
  if (!pending) {
    if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
      throw new Error(`Native SDK change ${name} has a claimed Action with an unknown outcome`);
    }
    return sdkNextResult(projectRoot, name);
  }
  if (pending.stepId !== 'shape.prepare' && pending.stepId !== 'shape.revalidate') {
    if (pending.type === 'call_tool') {
      const { runtime, executors } = await loadOwnedNativeSdkRuntime(projectRoot, name);
      const executor = executors.find((candidate) => candidate.supports(pending));
      if (!executor) throw new Error(`Native SDK Action ${pending.stepId} has no executor`);
      await runtime.execute({
        runId: run.runId,
        actionId: pending.id,
        executorId: executor.id,
        context: { requestId: randomUUID(), projectRoot },
      });
    }
    return sdkNextResult(projectRoot, name);
  }
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
  const proposal = await collectNativeSdkShapeProposal({ paths, state });
  const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
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
  await runtime.recordOutcome({
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
  return sdkNextResult(projectRoot, name);
}
