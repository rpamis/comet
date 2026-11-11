import { resolveGitRef } from '../../platform/paths/git-worktree.js';
import {
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children.js';
import { readProjectConfig } from './native-config.js';
import { confirmNativePortableAcceptance } from './native-loop-runtime.js';
import { withNativeMutation } from './native-mutation.js';
import {
  assertNativePortableExpectedContinuationLocked,
  discoverNativePortableSpecChanges,
  readNativePortableAcceptance,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import { appendNativePortableHistory } from './native-portable-state.js';
import {
  lateBindPortableCurrentWorkspace,
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativePortableState,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import { rebuildNativeSupervisorStateFromFacts } from './native-supervisor-coordinator.js';
import {
  createNativeSupervisorState,
  reconcileNativeSupervisorState,
} from './native-supervisor-model.js';
import {
  assertNoActiveNativeSupervisorTasks,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { prepareNativeSupervisorIntegrationWorkspace } from './native-supervisor-workspace.js';
import type { NativeProjectPaths } from './native-types.js';
export async function confirmNativePortableShape(options: {
  paths: NativeProjectPaths;
  name: string;
  coordinationMode?: NativeSupervisorCoordinationMode;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'confirm-shape',
    });
    if (
      state.phase !== 'shape' ||
      state.status !== 'await-user' ||
      state.loop.stage !== 'await-user' ||
      state.loop.next_action !== 'confirm-shape'
    ) {
      throw new Error(
        'Native Shape can only be confirmed from the persisted user confirmation boundary',
      );
    }
    if (
      options.coordinationMode !== undefined &&
      state.coordination_mode !== undefined &&
      options.coordinationMode !== state.coordination_mode
    ) {
      throw new Error(
        '--coordination-mode is already bound to this Shape confirmation; revise Shape before changing it',
      );
    }
    const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
    const shape = await readNativePortableAcceptance({
      paths: options.paths,
      state,
      specChanges,
    });
    const { acceptance } = shape;
    const children = await readNativeChildrenContract({
      changeDir: nativePortableChangeDir(options.paths, state.name),
      acceptanceIds: acceptance.map(({ id }) => id),
      validation: nativeChildrenAcceptanceValidation({ ...state, acceptance }),
    });
    let bound = state;
    if (children && state.workspace.change_branch === null) {
      await assertNoActiveNativeSupervisorTasks(options.paths, state.name);
      const workspace = lateBindPortableCurrentWorkspace(
        state.workspace,
        options.paths.projectRoot,
      );
      if (workspace === null) {
        throw new Error(
          'Native parent changes require a Git integration branch; initialize Git, commit to a branch, then rerun the latest continuation to bind the workspace',
        );
      }
      bound = appendNativePortableHistory(
        { ...state, workspace },
        {
          goal_cycle: state.loop.goal_cycle,
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          outcome: 'recovery',
          unresolved_ids: [],
          summary: toNativePortableText(
            `Native workspace bound to branch ${workspace.change_branch} at the Supervisor Shape confirmation boundary`,
          ),
          completed_at: new Date().toISOString(),
        },
      );
    }
    const coordinationRequired =
      children?.contract.schema === 'comet.native.children.v2' &&
      children.contract.children.length >= 2;
    const coordinationMode = options.coordinationMode ?? state.coordination_mode;
    if (!coordinationRequired && options.coordinationMode !== undefined) {
      throw new Error(
        '--coordination-mode is only valid for a multi-child Native Supervisor Shape',
      );
    }
    if (coordinationRequired && !children) {
      throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
    }
    if (coordinationRequired && coordinationMode === undefined) {
      throw new Error(
        'Native Supervisor Shape requires --coordination-mode multi-session or single-session',
      );
    }
    const next = confirmNativePortableAcceptance({
      state: {
        ...bound,
        spec_changes: specChanges,
      },
      acceptance: acceptance.map((entry) => ({ ...entry })),
    });
    delete next.children_contract_ref;
    delete next.children_contract;
    delete next.coordination_mode;
    if (children) {
      next.children_contract_ref = next.name + ':shape:' + next.state_version;
      next.children_contract = children.contract;
      if (coordinationRequired) next.coordination_mode = coordinationMode;
    }
    let supervisorWorkspace: Awaited<
      ReturnType<typeof prepareNativeSupervisorIntegrationWorkspace>
    > | null = null;
    let existingSupervisor =
      children?.contract.schema === 'comet.native.children.v2'
        ? await readNativeSupervisorState(options.paths, state.name)
        : null;
    let supervisorTargetBranch: string | null = null;
    let supervisorTargetCommit: string | null = null;
    if (children?.contract.schema === 'comet.native.children.v2') {
      supervisorTargetBranch = bound.workspace.change_branch ?? bound.workspace.target_branch;
      if (!supervisorTargetBranch) {
        throw new Error('Native Supervisor v2 requires a target branch');
      }
      supervisorTargetCommit = resolveGitRef(options.paths.projectRoot, supervisorTargetBranch);
      if (!supervisorTargetCommit) {
        throw new Error(`Native Supervisor target branch has no commit: ${supervisorTargetBranch}`);
      }
      if (!existingSupervisor) {
        existingSupervisor = await rebuildNativeSupervisorStateFromFacts({
          paths: options.paths,
          parent: state.name,
          targetBranch: supervisorTargetBranch,
          contract: children.contract,
        });
      }
      if (!existingSupervisor) {
        supervisorWorkspace = await prepareNativeSupervisorIntegrationWorkspace({
          projectRoot: options.paths.projectRoot,
          parent: state.name,
          targetBranch: supervisorTargetBranch,
          sourceConfig: await readProjectConfig(options.paths.projectRoot),
        });
      }
    }
    // Reconcile or create the Supervisor state before touching the portable
    // state or local execution overlay. Contract removals and immutable
    // integrated-child changes can throw; validating them first prevents a
    // confirmed Shape from leaving a half-written portable plan behind.
    const supervisorStateToWrite =
      children?.contract.schema === 'comet.native.children.v2' &&
      supervisorTargetBranch &&
      supervisorTargetCommit
        ? existingSupervisor
          ? reconcileNativeSupervisorState({
              state: existingSupervisor,
              contract: children.contract,
            })
          : supervisorWorkspace
            ? createNativeSupervisorState({
                parent: next.name,
                targetBranch: supervisorTargetBranch,
                targetCommit: supervisorTargetCommit,
                integrationBranch: supervisorWorkspace.binding.changeBranch!,
                integrationWorktree: supervisorWorkspace.projectRoot,
                contract: children.contract,
              })
            : null
        : null;
    if (children?.contract.schema === 'comet.native.children.v2' && !supervisorStateToWrite) {
      throw new Error('Native Supervisor integration state is unavailable');
    }
    const written = await writePortableMutation({ paths: options.paths, previous: state, next });
    if (supervisorStateToWrite) {
      await writeNativeSupervisorState(options.paths, supervisorStateToWrite);
    }
    return written;
  });
}
