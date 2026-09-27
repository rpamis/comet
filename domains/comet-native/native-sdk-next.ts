import { randomUUID } from 'node:crypto';

import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from './native-sdk-application.js';
import { nativeProjectPaths } from './native-paths.js';
import { createNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { inspectNativeSdkStatus } from './native-sdk-status.js';
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

async function sdkNextResult(projectRoot: string, name: string): Promise<DispatchResult> {
  const { run, state } = await inspectNativeSdkRun(projectRoot, name);
  const pendingActions = run.actions
    .filter((action) => action.status === 'pending')
    .map((action) => ({
      id: action.id,
      stepId: action.stepId,
      mechanism: 'runtime-dispatch',
    }));
  return success('next', {
    change: name,
    ...(await inspectNativeSdkStatus({ projectRoot, name })),
    ...(state.phase === 'shape'
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
      },
): Promise<DispatchResult> {
  const { run, state, artifactRootRef } = await inspectNativeSdkRun(projectRoot, name);
  if (decision?.expectedAction === 'revise-requirements') {
    if (
      state.state_version !== decision.expectedStateVersion ||
      !['verify', 'archive'].includes(state.phase)
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
    const runtime = createNativeSdkRuntime(projectRoot);
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
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        candidate.stepId === (retry ? 'verify.retry' : 'verify.confirm'),
    );
    if (
      !wait ||
      state.phase !== 'verify' ||
      state.loop.next_action !== (retry ? 'retry-verifier' : 'confirm-skill-coordinated-pass') ||
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
      : decision.expectedAction === 'accept-result'
        ? 'approved'
        : 'rejected';
    await createNativeSdkRuntime(projectRoot).resolveWait({
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
    const runtime = createNativeSdkRuntime(projectRoot);
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
  const pending = run.actions.find((action) => action.status === 'pending');
  if (!pending) {
    if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
      throw new Error(`Native SDK change ${name} has a claimed Action with an unknown outcome`);
    }
    return sdkNextResult(projectRoot, name);
  }
  if (pending.stepId !== 'shape.prepare' && pending.stepId !== 'shape.revalidate') {
    if (pending.type === 'call_tool') {
      const executor = defineNativeWorkflowApplication().executors.find((candidate) =>
        candidate.supports(pending),
      );
      if (!executor) throw new Error(`Native SDK Action ${pending.stepId} has no executor`);
      await createNativeSdkRuntime(projectRoot).execute({
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
  const runtime = createNativeSdkRuntime(projectRoot);
  const requestId = randomUUID();
  const context = { requestId, projectRoot };
  const claimed = await runtime.claim({
    runId: run.runId,
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
