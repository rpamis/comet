import { nativeSupervisorContractRef } from './native-children-contract.js';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN, readProjectConfig } from './native-config.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeSupervisorRevisionWorkspace } from './native-sdk-supervisor-revision.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
  prepareNativeSupervisorChildWorkspace,
  prepareNativeSupervisorIntegrationWorkspace,
} from './native-supervisor-workspace.js';

export async function currentNativeSdkSupervisorContract(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    !['build', 'verify', 'archive'].includes(state.phase) ||
    state.name !== input.name ||
    !state.children_contract_ref ||
    typeof input.artifactRootRef !== 'string'
  ) {
    throw new Error('Native SDK Supervisor preparation lacks a confirmed child plan');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native SDK Supervisor project configuration changed');
  }

  const approvedProposal = (run.outputs['shape.revalidate']?.value ??
    run.outputs['shape.prepare']?.value) as
    | { children?: { contract?: import('./native-children-contract.js').NativeChildrenContract } }
    | undefined;
  const contract = state.children_contract ?? approvedProposal?.children?.contract;
  if (!contract)
    throw new Error(
      'Native SDK Supervisor lacks its original approved children plan; explicitly revise requirements to confirm it',
    );
  const targetBranch = state.workspace.change_branch ?? state.workspace.target_branch;
  if (!targetBranch) throw new Error('Native SDK Supervisor requires a bound Git target branch');
  return { state, config, contract, targetBranch };
}

/** Resolve the live target only for preparation and integration that consume its commit. */
export async function currentNativeSdkSupervisorPlan(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
) {
  const plan = await currentNativeSdkSupervisorContract(run, projectRoot);
  const targetCommit = resolveGitRef(projectRoot, plan.targetBranch);
  if (!targetCommit) throw new Error('Native SDK Supervisor target branch has no commit');
  return { ...plan, targetCommit };
}

function childPreparationInput(action: Readonly<RuntimeAction>): {
  child: string;
  contractRef: string;
  integrationBranch: string;
  integrationWorktree: string;
  targetCommit: string;
} {
  const activation = (action.input as { activation?: Record<string, unknown> }).activation;
  if (
    !activation ||
    typeof activation.child !== 'string' ||
    typeof nativeSupervisorContractRef(activation) !== 'string' ||
    typeof activation.integrationBranch !== 'string' ||
    typeof activation.integrationWorktree !== 'string' ||
    typeof activation.targetCommit !== 'string'
  ) {
    throw new Error('Native SDK Supervisor child preparation lacks its activation');
  }
  return { ...activation, contractRef: nativeSupervisorContractRef(activation)! } as ReturnType<
    typeof childPreparationInput
  >;
}

async function currentChildPreparation(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const input = childPreparationInput(action);
  if (
    !plan.contract.children.some(({ name }) => name === input.child) ||
    nativeSupervisorContractRef(input, run) !== plan.state.children_contract_ref ||
    input.integrationBranch !== nativeSupervisorIntegrationBranch(plan.state.name) ||
    !samePath(
      input.integrationWorktree,
      nativeSupervisorIntegrationWorktree(projectRoot, plan.state.name),
    ) ||
    resolveGitRef(projectRoot, input.integrationBranch) !== input.targetCommit
  ) {
    throw new Error('Native SDK Supervisor child preparation no longer matches its parent plan');
  }
  const integration = inspectGitWorktree(input.integrationWorktree);
  if (integration.currentBranch !== input.integrationBranch) {
    throw new Error('Native SDK Supervisor integration worktree changed before child preparation');
  }
  return { ...plan, input };
}

export const nativeSdkSupervisorPrepareExecutor: RuntimeExecutor = {
  id: 'native-supervisor-prepare',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.prepare' && action.type === 'call_tool';
  },
  async preflight(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action))
      throw new Error('Native SDK Supervisor preparation requires a bound Run and project');
    const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
    nativeSupervisorRevisionWorkspace(
      run,
      nativeSupervisorIntegrationWorktree(context.projectRoot, plan.state.name),
      nativeSupervisorIntegrationBranch(plan.state.name),
    );
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor preparation requires a bound Run and project');
    }
    const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
    const retained = nativeSupervisorRevisionWorkspace(
      run,
      nativeSupervisorIntegrationWorktree(context.projectRoot, plan.state.name),
      nativeSupervisorIntegrationBranch(plan.state.name),
    );
    const prepared = await prepareNativeSupervisorIntegrationWorkspace({
      projectRoot: context.projectRoot,
      parent: plan.state.name,
      targetBranch: plan.targetBranch,
      sourceConfig: plan.config,
    });
    return {
      status: 'succeeded',
      output: {
        contractRef: plan.state.children_contract_ref!,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        targetBranch: plan.targetBranch,
        targetCommit: plan.targetCommit,
        integrationCommit: retained?.head ?? plan.targetCommit,
        maxParallelChildren:
          plan.state.coordination_mode === 'single-session'
            ? 1
            : (plan.config.native.max_parallel_children ?? DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN),
      },
    };
  },
};

export const nativeSdkSupervisorPrepareValidator: RuntimeValidator = {
  id: 'native-supervisor-prepare-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (!context?.projectRoot || !nativeSdkSupervisorPrepareExecutor.supports(action)) {
      return { accepted: false, reason: 'Native SDK Supervisor preparation lacks its project' };
    }
    try {
      const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      const expectedWorktree = nativeSupervisorIntegrationWorktree(
        context.projectRoot,
        plan.state.name,
      );
      const expectedBranch = nativeSupervisorIntegrationBranch(plan.state.name);
      const retained = nativeSupervisorRevisionWorkspace(run, expectedWorktree, expectedBranch);
      if (
        !output ||
        nativeSupervisorContractRef(output, run, action) !== plan.state.children_contract_ref ||
        output.integrationBranch !== expectedBranch ||
        typeof output.integrationWorktree !== 'string' ||
        !samePath(output.integrationWorktree, expectedWorktree) ||
        output.targetBranch !== plan.targetBranch ||
        output.targetCommit !== plan.targetCommit ||
        (output.integrationCommit ?? output.targetCommit) !== (retained?.head ?? plan.targetCommit)
      ) {
        throw new Error('Native SDK Supervisor preparation result does not match its plan');
      }
      const workspace = inspectGitWorktree(expectedWorktree);
      if (workspace.currentBranch !== expectedBranch) {
        throw new Error('Native SDK Supervisor integration worktree has a different branch');
      }
      if (
        resolveGitRef(expectedWorktree, expectedBranch) !== (retained?.head ?? plan.targetCommit)
      ) {
        throw new Error('Native SDK Supervisor integration worktree head changed');
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const nativeSdkSupervisorChildPrepareExecutor: RuntimeExecutor = {
  id: 'native-supervisor-child-prepare',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.child.prepare' && action.type === 'call_tool';
  },
  async preflight(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action))
      throw new Error('Native SDK Supervisor child preparation requires a bound Run and project');
    const plan = await currentChildPreparation(run, action, context.projectRoot);
    nativeSupervisorRevisionWorkspace(
      run,
      nativeSupervisorChildWorktree(context.projectRoot, plan.state.name, plan.input.child),
      `comet/supervisor/${plan.state.name}/${plan.input.child}`,
    );
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor child preparation requires a bound Run and project');
    }
    const plan = await currentChildPreparation(run, action, context.projectRoot);
    nativeSupervisorRevisionWorkspace(
      run,
      nativeSupervisorChildWorktree(context.projectRoot, plan.state.name, plan.input.child),
      `comet/supervisor/${plan.state.name}/${plan.input.child}`,
    );
    const prepared = await prepareNativeSupervisorChildWorkspace({
      projectRoot: context.projectRoot,
      parent: plan.state.name,
      child: plan.input.child,
      targetBranch: plan.input.integrationBranch,
      sourceConfig: plan.config,
    });
    return {
      status: 'succeeded',
      output: {
        child: plan.input.child,
        contractRef: plan.input.contractRef,
        worktree: prepared.projectRoot,
        branch: prepared.binding.changeBranch!,
        baseCommit: plan.input.targetCommit,
      },
    };
  },
};

export const nativeSdkSupervisorChildPrepareValidator: RuntimeValidator = {
  id: 'native-supervisor-child-prepare-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (!context?.projectRoot || !nativeSdkSupervisorChildPrepareExecutor.supports(action)) {
      return {
        accepted: false,
        reason: 'Native SDK Supervisor child preparation lacks its project',
      };
    }
    try {
      const plan = await currentChildPreparation(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      const worktree = nativeSupervisorChildWorktree(
        context.projectRoot,
        plan.state.name,
        plan.input.child,
      );
      const branch = `comet/supervisor/${plan.state.name}/${plan.input.child}`;
      if (
        !output ||
        output.child !== plan.input.child ||
        nativeSupervisorContractRef(output, run) !== nativeSupervisorContractRef(plan.input, run) ||
        typeof output.worktree !== 'string' ||
        !samePath(output.worktree, worktree) ||
        output.branch !== branch ||
        output.baseCommit !== plan.input.targetCommit
      ) {
        throw new Error('Native SDK Supervisor child preparation result does not match its plan');
      }
      const workspace = inspectGitWorktree(worktree);
      const retained = nativeSupervisorRevisionWorkspace(run, worktree, branch);
      if (
        workspace.currentBranch !== branch ||
        (resolveGitRef(worktree, branch) !== output.baseCommit && !retained)
      ) {
        throw new Error('Native SDK Supervisor child worktree changed before Builder dispatch');
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
