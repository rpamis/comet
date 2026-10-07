import { randomUUID } from 'node:crypto';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';

import { hashRuntimeValue, type RuntimeValue, type WorkflowRun } from '../engine/runtime.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { collectNativeSdkShapeProposal } from './native-sdk-application.js';
import { recoverNativeSdkChecks } from './native-sdk-checks.js';
import { nativeProjectPaths } from './native-paths.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { inspectNativeSdkSupervisorRecovery } from './native-sdk-supervisor-recovery.js';
import {
  nativeSdkChildVerifierRetryWaits,
  validateNativeSdkFailedChildVerifier,
} from './native-sdk-supervisor-verifier-recovery.js';
import { nativeSdkRequirementsRevisionAllowed } from './native-sdk-revise.js';
import { projectNativeSdkStatus } from './native-sdk-status.js';
import { nativeSdkNextAction } from './native-sdk-continuation.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativeSupervisorCoordinationMode } from './native-portable-types.js';

async function sdkNextResult(
  projectRoot: string,
  name: string,
  run: WorkflowRun,
  artifactRootRef: string,
  application: Awaited<ReturnType<typeof inspectNativeSdkRun>>['application'],
): Promise<DispatchResult> {
  const state = parseNativePortableState(run.state);
  return success('next', {
    change: name,
    ...(await projectNativeSdkStatus(
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
  let { run, state, artifactRootRef, application } = await inspectNativeSdkRun(projectRoot, name);
  if (run.actions.some((action) => ['running', 'unknown'].includes(action.status))) {
    run = await recoverNativeSdkChecks(
      projectRoot,
      run,
      (await loadOwnedNativeSdkRuntime(projectRoot, name)).runtime,
    );
    state = parseNativePortableState(run.state);
  }
  if (run.status === 'cancelled') {
    await settleNativeSdkCancellation({ projectRoot, run });
    return sdkNextResult(projectRoot, name, run, artifactRootRef, application);
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native SDK 推进动作已失效，请读取当前阶段、状态版本和待执行 Action。',
        },
      };
  }
  if (!decision && ['failed', 'cancelled'].includes(run.status))
    return sdkNextResult(projectRoot, name, run, artifactRootRef, application);
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
          ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
          exitCode: 73,
          error: { code: 'conflict', message: 'Native Child Verifier recovery decision is stale' },
        };
      if (!decision.summary.trim()) throw new NativeUsageError('--summary must not be empty');
      const actionId = (wait.proposal as { activation: { failedVerifierActionId: string } })
        .activation.failedVerifierActionId;
      const action = run.actions.find((candidate) => candidate.id === actionId)!;
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
      return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
    }
  }
  if (decision?.expectedAction === 'revise-implementation') {
    const wait = run.waits.find(
      (candidate) =>
        candidate.status === 'pending' &&
        ['supervisor.child.checks-stop', 'supervisor.child.integration-checks-stop'].includes(
          candidate.stepId,
        ) &&
        candidate.proposalHash === decision.proposalHash,
    );
    if (wait) {
      if (
        state.state_version !== decision.expectedStateVersion ||
        !decision.summary.trim() ||
        ['failed', 'completed', 'cancelled'].includes(run.status)
      )
        return {
          ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
          exitCode: 73,
          error: { code: 'conflict', message: 'Native Child check repair decision is stale' },
        };
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
          choice: 'repair',
        }),
        choice: 'repair',
      });
      return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
    }
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native Child blocked 恢复决定已失效，请重新读取原 Run。',
        },
      };
    }
    const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
    const completed = await runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: recovery.actionId,
      attempt: recovery.attempt,
      proposalHash: decision.proposalHash,
      context: { requestId: randomUUID(), projectRoot },
    });
    return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
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
      return advanceNativeSdkChange(projectRoot, name);
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
    return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
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
        (retry
          ? candidate.stepId === 'verify.retry'
          : loopStop
            ? ['verify.stop', 'verify.checks-stop'].includes(candidate.stepId)
            : candidate.stepId === 'verify.confirm'),
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
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
        ...(await sdkNextResult(projectRoot, name, run, artifactRootRef, application)),
        exitCode: 73,
        error: {
          code: 'conflict',
          message: `Native SDK Shape documents changed after the approval proposal for ${name}; use revise-requirements from the current continuation, then confirm the new complete Shape`,
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
    return sdkNextResult(projectRoot, name, run, artifactRootRef, application);
  if (run.ready.length > 0) {
    await (await loadOwnedNativeSdkRuntime(projectRoot, name)).runtime.next({ runId: run.runId });
    ({ run, state, artifactRootRef, application } = await inspectNativeSdkRun(projectRoot, name));
  }
  const pending = nativeSdkNextAction(run, state);
  if (!pending) {
    return sdkNextResult(projectRoot, name, run, artifactRootRef, application);
  }
  if (pending.stepId !== 'shape.prepare' && pending.stepId !== 'shape.revalidate') {
    let completed = run;
    if (pending.type === 'call_tool') {
      const { runtime, executors } = await loadOwnedNativeSdkRuntime(projectRoot, name);
      const executor = executors.find((candidate) => candidate.supports(pending));
      if (!executor) throw new Error(`Native SDK Action ${pending.stepId} has no executor`);
      completed = await runtime.execute({
        runId: run.runId,
        actionId: pending.id,
        executorId: executor.id,
        context: { requestId: randomUUID(), projectRoot },
      });
    }
    return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
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
  return sdkNextResult(projectRoot, name, completed, artifactRootRef, application);
}
