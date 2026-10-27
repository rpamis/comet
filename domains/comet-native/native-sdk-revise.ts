import type {
  RuntimeCommandValidator,
  RuntimeExecutor,
  RuntimeValidator,
  RuntimeValue,
  WorkflowRuntime,
  WorkflowRun,
} from '../engine/runtime.js';
import { hashRuntimeValue } from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';
import { collectNativeSupervisorRevisionWorkspaces } from './native-sdk-supervisor-revision.js';
import { inspectNativeSdkSupervisorRecovery } from './native-sdk-supervisor-recovery.js';
import type { NativePortableState } from './native-portable-types.js';
import { inspectNativeSdkPendingArchiveDrift } from './native-sdk-archive.js';
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  inspectNativeSdkCheckExecutions,
  hasNativeSdkPortableStopEvidence,
} from './native-sdk-check-execution.js';

type ImplementationRevision = {
  reason: string;
  expectedStateVersion: number;
  proposalHash: string;
  archiveActionId: string;
};

function implementationRevisionInput(value: unknown): ImplementationRevision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(',') !==
      'archiveActionId,expectedStateVersion,proposalHash,reason' ||
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    typeof input.expectedStateVersion !== 'number' ||
    typeof input.proposalHash !== 'string' ||
    typeof input.archiveActionId !== 'string'
  )
    return null;
  return input as ImplementationRevision;
}

/** 只替换尚未执行的 Archive Action，原批准和实际检查历史仍保留。 */
export const nativeSdkImplementationRevisionCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-implementation-revision-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const state = parseNativePortableState(run.state);
    const revision = implementationRevisionInput(input);
    const pending = run.actions.filter((action) => action.status === 'pending');
    const archive = pending[0];
    const approved = [...run.waits]
      .reverse()
      .find(
        (wait) =>
          wait.stepId === 'verify.confirm' &&
          wait.status === 'resolved' &&
          wait.decision?.choice === 'approved',
      );
    if (
      name !== 'revise-implementation' ||
      !revision ||
      !context?.projectRoot ||
      state.phase !== 'archive' ||
      state.status !== 'active' ||
      state.archived ||
      state.state_version !== revision.expectedStateVersion ||
      !approved ||
      approved.proposalHash !== revision.proposalHash ||
      pending.length !== 1 ||
      archive.id !== revision.archiveActionId ||
      !['archive.prepare', 'archive.execute'].includes(archive.stepId) ||
      run.actions.some((action) => ['running', 'unknown'].includes(action.status)) ||
      run.actions.some(
        (action) => action.stepId === 'archive.execute' && action.status === 'succeeded',
      ) ||
      run.waits.some((wait) => wait.status === 'pending') ||
      run.evidenceWaits?.some((wait) => wait.status === 'pending') ||
      run.ready.length > 0
    )
      return {
        accepted: false,
        reason: 'Native implementation revision is stale or Archive is already in progress',
      };
    const checks = await inspectNativeSdkCheckExecutions({
      projectRoot: context.projectRoot,
      run,
      includeSettled: true,
    });
    if (
      checks.some((check) => {
        const action = run.actions.find((entry) => entry.id === check.actionId);
        return !check.quiescent || !action || !hasNativeSdkPortableStopEvidence(run, action);
      })
    )
      return {
        accepted: false,
        reason: 'Native original check execution has not been confirmed stopped',
      };
    const paths = await nativeProjectPaths(
      context.projectRoot,
      (run.input as { artifactRootRef: string }).artifactRootRef,
      { readOnly: true },
    );
    const shape = await inspectNativePortableAcceptanceDrift({ paths, state });
    if (shape.drifted)
      return {
        accepted: false,
        reason: 'Native requirements changed; read the current status and revise the requirements',
      };
    const drift = await inspectNativeSdkPendingArchiveDrift({
      run,
      action: archive,
      projectRoot: context.projectRoot,
    });
    return {
      accepted: drift !== null,
      reason: 'Native candidate no longer differs; read the current status',
    };
  },
};

async function observeImplementationRevision(
  run: Readonly<WorkflowRun>,
  input: ImplementationRevision,
  projectRoot: string,
) {
  const original = run.actions.find((action) => action.id === input.archiveActionId);
  if (
    !original ||
    original.status !== 'cancelled' ||
    !['archive.prepare', 'archive.execute'].includes(original.stepId)
  )
    throw new Error('Native implementation revision has no original pending Archive action');
  const state = parseNativePortableState(run.state);
  const paths = await nativeProjectPaths(
    projectRoot,
    (run.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  const shape = await inspectNativePortableAcceptanceDrift({ paths, state });
  const drift = shape.drifted
    ? null
    : await inspectNativeSdkPendingArchiveDrift({ run, action: original, projectRoot });
  return {
    drift: shape.drifted || drift !== null,
    requirementsChanged: shape.drifted,
    driftKind: shape.drifted ? 'shape-drift' : (drift?.reason ?? null),
    archiveStep: original.stepId,
    reason: input.reason.trim(),
  };
}

export const nativeSdkImplementationRevisionExecutor: RuntimeExecutor = {
  id: 'comet-native-revise-implementation',
  capabilities: [],
  supports: (action) =>
    action.stepId === 'repair.implementation' && action.ref === 'native-revise-implementation',
  async execute(action, context, run) {
    const input = implementationRevisionInput(
      (action.input as { activation?: unknown }).activation,
    );
    if (!run || !input || !context?.projectRoot)
      throw new Error('Native implementation revision lacks its input');
    return {
      status: 'succeeded',
      output: await observeImplementationRevision(run, input, context.projectRoot),
    };
  },
};

export const nativeSdkImplementationRevisionValidator: RuntimeValidator = {
  id: 'comet-native-implementation-revision-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    const input = implementationRevisionInput(
      (action.input as { activation?: unknown }).activation,
    );
    if (
      !input ||
      !context?.projectRoot ||
      outcome.status !== 'succeeded' ||
      action.claim?.executorId !== nativeSdkImplementationRevisionExecutor.id
    )
      return {
        accepted: false,
        reason: 'Native implementation revision has no matching read-only result',
      };
    const expected = await observeImplementationRevision(run, input, context.projectRoot);
    return {
      accepted: hashRuntimeValue(outcome.output) === hashRuntimeValue(expected),
      reason: 'Native candidate changed during revision',
    };
  },
};

/** 只重新读取原修订 Action，沿用原 claim；不会执行被替换的 Archive。 */
export async function recoverNativeSdkImplementationRevision(
  projectRoot: string,
  run: WorkflowRun,
  runtime: WorkflowRuntime,
): Promise<WorkflowRun> {
  const action = run.actions.find(
    (entry) =>
      entry.stepId === 'repair.implementation' &&
      entry.ref === 'native-revise-implementation' &&
      entry.claim?.executorId === nativeSdkImplementationRevisionExecutor.id &&
      ['running', 'unknown'].includes(entry.status),
  );
  if (!action?.claim) return run;
  const context = { projectRoot, requestId: 'native-implementation-revision-recovery' };
  const result = await nativeSdkImplementationRevisionExecutor.execute(action, context, run);
  return runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      ...result,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId:
        action.status === 'running' && !action.rejectedOutcomes?.length
          ? `${action.id}:${action.attempt}:executor-result`
          : `${action.id}:${action.attempt}:revalidated-read-only:${action.rejectedOutcomes?.length ?? 0}`,
    },
    context,
  });
}

/** 普通 Build 只在原 Builder 明确失败且仍等待恢复决定时允许修改需求。 */
export function nativeSdkStoppedBuilderWait(run: Readonly<WorkflowRun>) {
  return run.waits.find((wait) => {
    if (wait.status !== 'pending' || wait.stepId !== 'build.resume') return false;
    const failedBuilderActionId = (
      wait.proposal as { activation?: { failedBuilderActionId?: unknown } }
    )?.activation?.failedBuilderActionId;
    return run.actions.some(
      (action) =>
        action.id === failedBuilderActionId &&
        action.stepId === 'build.builder' &&
        action.status === 'failed',
    );
  });
}

export function nativeSdkRequirementsRevisionAllowed(
  run: Readonly<WorkflowRun>,
  state: NativePortableState,
  proposalHash?: unknown,
): boolean {
  if (run.actions.some((action) => ['running', 'unknown'].includes(action.status))) return false;
  if (['verify', 'archive'].includes(state.phase)) return proposalHash === undefined;
  if (state.phase !== 'build') return false;
  if (state.children_contract_hash) return proposalHash === undefined;
  const pending = nativeSdkPendingBuilderRevisionHash(run);
  if (pending) return proposalHash === pending;
  const wait = nativeSdkStoppedBuilderWait(run);
  return wait !== undefined && wait.proposalHash === proposalHash;
}

/** 尚未领取的 Builder 可以被当前修订取代；哈希绑定原 Action，不能使用旧入口。 */
export function nativeSdkPendingBuilderRevisionHash(run: Readonly<WorkflowRun>): string | null {
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'build' ||
    state.children_contract_hash ||
    !['running', 'waiting'].includes(run.status) ||
    run.actions.some((action) => ['running', 'unknown'].includes(action.status))
  )
    return null;
  const pending = run.actions.filter((action) => action.status === 'pending');
  if (pending.length !== 1 || pending[0].stepId !== 'build.builder') return null;
  const { id: actionId, attempt, inputHash } = pending[0];
  return hashRuntimeValue({ actionId, attempt, inputHash });
}

export const nativeSdkReviseCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-revise-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const state = parseNativePortableState(run.state);
    if (
      name !== 'revise-requirements' ||
      state.archived ||
      !['active', 'await-user', 'blocked'].includes(state.status) ||
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      !['expectedStateVersion,reason', 'expectedStateVersion,proposalHash,reason'].includes(
        Object.keys(input).sort().join(','),
      ) ||
      !nativeSdkRequirementsRevisionAllowed(run, state, input.proposalHash) ||
      input.expectedStateVersion !== state.state_version ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      run.actions.some(
        (action) =>
          action.stepId === 'archive.execute' &&
          ['succeeded', 'running', 'unknown'].includes(action.status),
      )
    ) {
      return {
        accepted: false,
        reason: 'Native requirements revision is stale or cannot interrupt Archive application',
      };
    }
    if (run.status === 'completed') {
      try {
        const recovery = context?.projectRoot
          ? await inspectNativeSdkSupervisorRecovery(run, context.projectRoot)
          : null;
        return { accepted: recovery !== null, allowCompleted: recovery !== null };
      } catch (error) {
        return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    return { accepted: true };
  },
};

export const nativeSdkReviseExecutor: RuntimeExecutor = {
  id: 'comet-native-revise-requirements',
  capabilities: [],
  supports(action) {
    return action.stepId === 'shape.revise' && action.ref === 'native-revise-requirements';
  },
  async execute(action, context, run) {
    if (!run) throw new Error('Native SDK Run is required');
    const activation = (
      action.input as {
        activation?: { reason?: unknown; expectedStateVersion?: unknown };
      }
    ).activation;
    const state = parseNativePortableState(run.state);
    if (
      typeof activation?.reason !== 'string' ||
      !activation.reason.trim() ||
      activation.expectedStateVersion !== state.state_version
    ) {
      throw new Error('Native requirements revision references a stale change');
    }
    if (state.children_contract_hash && !context?.projectRoot)
      throw new Error('Native Supervisor 需求修订缺少实际项目');
    const workspaces = state.children_contract_hash
      ? collectNativeSupervisorRevisionWorkspaces(run, context!.projectRoot!)
      : undefined;
    return {
      status: 'succeeded',
      output: { reason: activation.reason.trim(), ...(workspaces ? { workspaces } : {}) },
    };
  },
};

export const nativeSdkReviseValidator: RuntimeValidator = {
  id: 'comet-native-revise-outcome',
  version: '1',
  validate({ run, action, outcome, context }) {
    const activation = (action.input as { activation?: { reason?: unknown } }).activation;
    const state = parseNativePortableState(run.state);
    let retained = true;
    try {
      if (state.children_contract_hash) {
        retained =
          Boolean(context?.projectRoot) &&
          hashRuntimeValue(
            (outcome.output as { workspaces?: RuntimeValue } | null)?.workspaces ?? null,
          ) ===
            hashRuntimeValue(collectNativeSupervisorRevisionWorkspaces(run, context!.projectRoot!));
      }
    } catch {
      retained = false;
    }
    return {
      accepted:
        outcome.status === 'succeeded' &&
        action.stepId === 'shape.revise' &&
        typeof activation?.reason === 'string' &&
        (outcome.output as { reason?: unknown } | null)?.reason === activation.reason.trim() &&
        retained,
      reason: 'Native requirements revision has no matching receipt',
    };
  },
};
