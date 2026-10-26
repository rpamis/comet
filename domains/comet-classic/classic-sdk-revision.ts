import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  RuntimeProtocolError,
  type WorkflowRun,
} from '../engine/runtime.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import {
  classicSdkRevisionApplication,
  classicArchiveRepairAction,
  classicInterruptedSkill,
} from './classic-sdk-revision-application.js';
import { assertClassicArchiveUnchanged } from './classic-sdk-archive-manifest.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import {
  captureClassicDeliveryRepair,
  classicDeliveryRepairCheckpointHash,
} from './classic-sdk-delivery-repair.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';
import { withClassicDeliveryRepair } from './classic-sdk-delivery-repair-application.js';

/** 只更新当前工作区的分支绑定；原 Action、审批和执行收据继续保留。 */
export async function rebindClassicSdkWork(
  projectRoot: string,
  change: string,
): Promise<WorkflowRun> {
  const branch = liveGitBranch(projectRoot);
  if (!isGitWorkTree(projectRoot) || !branch)
    throw new Error('Cannot rebind without a checked-out Git branch');
  const { run, state } = await inspectClassicSdkRun(projectRoot, change, {
    allowBranchRebind: true,
  });
  if (
    !state.boundBranch ||
    state.archived ||
    ['completed', 'cancelled'].includes(run.status) ||
    run.actions.some(
      (action) =>
        ['running', 'unknown'].includes(action.status) ||
        (action.status === 'cancelled' && action.claim && !action.cancellation),
    )
  )
    throw new Error('Classic rebind requires an active bound Run with no unresolved execution');
  if (state.boundBranch === branch) return run;
  const next = { ...run, revision: run.revision + 1, state: { ...state, boundBranch: branch } };
  if (liveGitBranch(projectRoot) !== branch)
    throw new Error('Git branch changed during rebind; read the current state again');
  if (
    !(await createClassicSdkStateStore(projectRoot).compareAndSwap(run.runId, run.revision, next))
  )
    throw new RuntimeProtocolError(
      'REVISION_CONFLICT',
      'Run 已变化，未更新分支绑定；重新读取当前 revision',
    );
  return next;
}

/** 同一 CAS 同时升级已核验的内置定义和重开当前阶段，保留全部审批与结果历史。 */
export async function reviseClassicSdkWork(options: {
  projectRoot: string;
  change: string;
  name:
    | 'revise-design'
    | 'revise-plan'
    | 'reopen-verification'
    | 'repair-archive'
    | 'repair-delivery'
    | 'continue-build'
    | 'continue-work';
  expectedRevision: number;
}): Promise<WorkflowRun> {
  const { projectRoot, change, name, expectedRevision } = options;
  const { run, state } = await inspectClassicSdkRun(projectRoot, change);
  const commandId = hashRuntimeValue({ runId: run.runId, name, expectedRevision });
  if (run.commands?.some((command) => command.id === commandId)) return run;
  if (run.revision !== expectedRevision)
    throw new RuntimeProtocolError(
      'REVISION_CONFLICT',
      'Run 已变化，请重新读取当前 revision 后修订',
    );
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (!['ok', 'not-applicable'].includes(branch.status))
    throw new Error(`Classic SDK branch binding is ${branch.status}`);
  if (name === 'reopen-verification') {
    const active = await inspectProtectedProjectPath(
      projectRoot,
      (run.input as { changeDir: string }).changeDir,
      { label: 'Classic active change', expected: 'directory' },
    );
    if (!active.exists)
      throw new Error(
        'Classic verification requires its active change directory; reconcile the Archive operation',
      );
  }
  const base = classicSdkRevisionApplication(
    run.workflow.id.slice('comet-classic-'.length) as 'full' | 'tweak' | 'hotfix',
    state.workflow === 'full' ? 'full' : true,
    true,
    true,
    true,
    run,
  );
  const deliveryRepair =
    name === 'repair-delivery' ? await captureClassicDeliveryRepair(projectRoot, run) : null;
  const repairingDelivery =
    deliveryRepair || run.commands?.some((command) => command.name === 'repair-delivery');
  const application = repairingDelivery
    ? withClassicDeliveryRepair(base, state.workflow, run)
    : base;
  const failedSkill = name === 'continue-work' ? classicInterruptedSkill(run) : null;
  const deliveryCheckpointHash =
    failedSkill && classicDeliveryActionContext(run, failedSkill)
      ? await classicDeliveryRepairCheckpointHash(projectRoot, run)
      : null;
  const definition = defineWorkflow(application.workflow);
  const upgraded =
    hashRuntimeValue(definition) === run.workflow.hash
      ? structuredClone(run)
      : preserveRuntimeExecutionOrigins(run);
  if (name === 'repair-archive') {
    const action = classicArchiveRepairAction(run);
    if (!action) throw new Error('Classic Archive 执行结果未知或尚未失败；先核对原执行');
    await assertClassicArchiveUnchanged(projectRoot, run, action);
  }
  upgraded.workflow.hash = hashRuntimeValue(definition);
  upgraded.definitionHashes[JSON.stringify([definition.id, definition.version])] =
    hashRuntimeValue(definition);
  const staging = createMemoryRuntimeStore<WorkflowRun>();
  await staging.restoreCheckpoint!(run.runId, null, upgraded);
  const runtime = createRuntime({
    store: staging,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: application.evidenceValidators,
    validators: application.validators,
    executors: application.executors,
    commandValidators: application.commandValidators,
  });
  const revised = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision,
    commandId,
    name,
    input: {
      expectedRevision,
      fromPhase: state.phase,
      ...(deliveryRepair
        ? {
            deliveryRepair:
              deliveryRepair as unknown as import('../engine/runtime.js').RuntimeValue,
          }
        : {}),
      ...(name === 'continue-work'
        ? { interruptedActionId: classicInterruptedSkill(run)?.id ?? '' }
        : {}),
      ...(deliveryCheckpointHash ? { deliveryCheckpointHash } : {}),
    },
    context: { requestId: commandId, projectRoot },
  });
  if (name === 'continue-work') {
    const action = revised.actions.find(
      (entry) => entry.stepId === 'classic.resume-work' && entry.status === 'pending',
    );
    if (!action) throw new Error('Classic work continuation is missing');
    const continued = await runtime.execute({
      runId: run.runId,
      actionId: action.id,
      executorId: 'comet-classic-work-continuation',
      context: { requestId: commandId, projectRoot },
    });
    Object.assign(revised, continued);
    // 续行器只核对原失败并安排后续工作；内存暂存的步骤通过一次 CAS 发布，不执行 Skill。
    revised.revision = expectedRevision + 1;
  }
  if (name === 'revise-design') {
    // 同一修订提交必须同时切换业务阶段，正式 Design 入口才能核对新 Action。
    revised.state = {
      ...(revised.state as object),
      phase: 'design',
      verifyResult: 'pending',
      verifiedAt: null,
      verificationReport: null,
      archiveConfirmation: null,
      branchStatus: 'pending',
    };
  }
  if (name === 'revise-plan' || name === 'continue-build') {
    revised.state = {
      ...(revised.state as object),
      phase: 'build',
      verifyResult: 'pending',
      verifiedAt: null,
      verificationReport: null,
      archiveConfirmation: null,
      branchStatus: 'pending',
      buildPause: name === 'revise-plan' && state.phase === 'build' ? state.buildPause : null,
    };
  }
  if (name === 'reopen-verification') {
    revised.state = {
      ...(revised.state as object),
      phase: 'verify',
      verifyResult: 'pending',
      verifiedAt: null,
      verificationReport: null,
      archiveConfirmation: null,
      branchStatus: 'pending',
      verifyFailures: 0,
    };
  }
  if (name === 'repair-archive') {
    revised.state = {
      ...(revised.state as object),
      phase: 'open',
      verifyResult: 'pending',
      verifiedAt: null,
      verificationReport: null,
      archiveConfirmation: null,
      branchStatus: 'pending',
      verifyFailures: 0,
      buildPause: null,
    };
    const action = classicArchiveRepairAction(run)!;
    await assertClassicArchiveUnchanged(projectRoot, run, action);
  }
  const store = createClassicSdkStateStore(projectRoot);
  if (!(await store.compareAndSwap(run.runId, expectedRevision, revised))) {
    throw new RuntimeProtocolError(
      'REVISION_CONFLICT',
      'Run 已变化，未提交修订；重新读取当前 revision',
    );
  }
  return revised;
}
