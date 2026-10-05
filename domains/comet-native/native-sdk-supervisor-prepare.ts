import path from 'node:path';

import { inspectGitWorktree, samePath } from '../../platform/paths/git-worktree.js';
import { resolveGitRef } from '../../platform/paths/git-worktree.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { hashNativeParentContract, nativeChildrenAcceptanceValidation } from './native-children.js';
import { readNativeChildrenContract } from './native-children-contract.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeSupervisorRevisionWorkspace } from './native-sdk-supervisor-revision.js';
import {
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
  nativeSupervisorChildWorktree,
  prepareNativeSupervisorChildWorkspace,
  prepareNativeSupervisorIntegrationWorkspace,
} from './native-supervisor-workspace.js';

export async function currentNativeSdkSupervisorPlan(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  if (
    !['build', 'verify', 'archive'].includes(state.phase) ||
    state.name !== input.name ||
    !state.children_contract_hash ||
    typeof input.artifactRootRef !== 'string'
  ) {
    throw new Error('Native SDK Supervisor preparation lacks a confirmed child plan');
  }
  const config = await readProjectConfig(projectRoot);
  if (!config || config.native.artifact_root !== input.artifactRootRef) {
    throw new Error('Native SDK Supervisor project configuration changed');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const children = await readNativeChildrenContract({
    changeDir: path.join(paths.changesDir, state.name),
    acceptanceIds: state.acceptance.map(({ id }) => id),
    validation: nativeChildrenAcceptanceValidation(state),
  });
  if (
    !children ||
    hashNativeParentContract({ acceptance: state.acceptance, children: children.contract }) !==
      state.children_contract_hash
  ) {
    throw new Error('Native SDK Supervisor child plan changed after Shape confirmation');
  }
  const targetBranch = state.workspace.change_branch ?? state.workspace.target_branch;
  if (!targetBranch) throw new Error('Native SDK Supervisor requires a bound Git target branch');
  const targetCommit = resolveGitRef(projectRoot, targetBranch);
  if (!targetCommit) throw new Error('Native SDK Supervisor target branch has no commit');
  return { state, config, contract: children.contract, targetBranch, targetCommit };
}

function childPreparationInput(action: Readonly<RuntimeAction>): {
  child: string;
  contractHash: string;
  integrationBranch: string;
  integrationWorktree: string;
  targetCommit: string;
} {
  const activation = (action.input as { activation?: Record<string, unknown> }).activation;
  if (
    !activation ||
    typeof activation.child !== 'string' ||
    typeof activation.contractHash !== 'string' ||
    typeof activation.integrationBranch !== 'string' ||
    typeof activation.integrationWorktree !== 'string' ||
    typeof activation.targetCommit !== 'string'
  ) {
    throw new Error('Native SDK Supervisor child preparation lacks its activation');
  }
  return activation as ReturnType<typeof childPreparationInput>;
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
    input.contractHash !== plan.state.children_contract_hash ||
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
        contractHash: plan.state.children_contract_hash!,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        targetBranch: plan.targetBranch,
        targetCommit: plan.targetCommit,
        integrationCommit: retained?.head ?? plan.targetCommit,
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
        output.contractHash !== plan.state.children_contract_hash ||
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
        contractHash: plan.input.contractHash,
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
        output.contractHash !== plan.input.contractHash ||
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
