import {
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  RuntimeProtocolError,
  type WorkflowRun,
} from '../engine/runtime.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { classicSdkRevisionApplication } from './classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';

/** 同一 CAS 同时升级已核验的内置定义和重开当前阶段，保留全部审批与结果历史。 */
export async function reviseClassicSdkWork(options: {
  projectRoot: string;
  change: string;
  name: 'revise-design' | 'revise-plan';
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
  const application = classicSdkRevisionApplication(
    run.workflow.id.slice('comet-classic-'.length) as 'full' | 'tweak' | 'hotfix',
  );
  const definition = defineWorkflow(application.workflow);
  const upgraded = structuredClone(run);
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
    commandValidators: application.commandValidators,
  });
  const revised = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision,
    commandId,
    name,
    input: { expectedRevision, fromPhase: state.phase },
  });
  const store = createClassicSdkStateStore(projectRoot);
  if (!(await store.compareAndSwap(run.runId, expectedRevision, revised))) {
    throw new RuntimeProtocolError(
      'REVISION_CONFLICT',
      'Run 已变化，未提交修订；重新读取当前 revision',
    );
  }
  return revised;
}
