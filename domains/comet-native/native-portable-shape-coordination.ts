import { resolveGitRef } from '../../platform/paths/git-worktree.js';
import {
  hashNativeParentContract,
  inspectNativeChildren,
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
  readNativeSupervisorShapeIntent,
} from './native-children.js';
import { readProjectConfig } from './native-config.js';
import { confirmNativePortableAcceptance } from './native-loop-runtime.js';
import {
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import type {
  NativePortableState,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  createNativeSupervisorState,
  reconcileNativeSupervisorState,
} from './native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { prepareNativeSupervisorIntegrationWorkspace } from './native-supervisor-workspace.js';
import { rebuildNativeSupervisorStateFromFacts } from './native-supervisor-coordinator.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import {
  assertNativePortableExpectedContinuationLocked,
  discoverNativePortableSpecChanges,
  ensureNativePortableAcceptanceCurrentLocked,
  nativePortableShapeConfirmationHash,
  readNativePortableAcceptance,
  returnNativePortableStateToShapeLocked,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';

export async function confirmNativePortableShape(options: {
  paths: NativeProjectPaths;
  name: string;
  coordinationMode?: NativeSupervisorCoordinationMode;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm portable shape ${options.name}`,
    async () => {
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
      if (options.coordinationMode !== undefined) {
        throw new Error('--coordination-mode must be selected before final Shape confirmation');
      }
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
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
      if (children && state.workspace.change_branch === null) {
        throw new Error('Native parent changes require a Git integration branch');
      }
      const coordinationRequired =
        (await readNativeSupervisorShapeIntent(
          nativePortableChangeDir(options.paths, state.name),
        )) ||
        (children?.contract.schema === 'comet.native.children.v2' &&
          children.contract.children.length >= 2);
      const coordinationMode = state.coordination_mode;
      if (coordinationRequired && !children) {
        throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
      }
      if (coordinationRequired && coordinationMode === undefined) {
        throw new Error(
          'Native Supervisor Shape requires --coordination-mode multi-session or single-session',
        );
      }
      const latestShapeConfirmationHash = nativePortableShapeConfirmationHash({
        formalHash: shape.formalHash,
        childrenHash: children?.hash ?? null,
        coordinationMode,
      });
      if (
        state.shape_confirmation_hash === undefined ||
        latestShapeConfirmationHash !== state.shape_confirmation_hash
      ) {
        const reason =
          state.shape_confirmation_hash === undefined
            ? 'Native Shape confirmation fingerprint is missing'
            : 'Native Shape artifacts changed';
        await returnNativePortableStateToShapeLocked({
          paths: options.paths,
          state,
          reason,
        });
        throw new Error(`${reason}; Native change returned to Shape and requires confirmation`);
      }
      const next = confirmNativePortableAcceptance({
        state: { ...state, spec_changes: specChanges },
        acceptance: acceptance.map((entry) => ({ ...entry })),
      });
      delete next.children_contract_hash;
      delete next.coordination_mode;
      if (children) {
        next.children_contract_hash = hashNativeParentContract({
          acceptance: next.acceptance,
          children: children.contract,
        });
        if (coordinationRequired) next.coordination_mode = coordinationMode;
        const latestDecision = [...state.history]
          .reverse()
          .find(({ outcome }) => outcome === 'pass' || outcome === 'fail');
        if (latestDecision?.outcome === 'fail' && latestDecision.unresolved_ids.length > 0) {
          const inspection = await inspectNativeChildren({ paths: options.paths, state: next });
          const statusByChild = new Map(
            (inspection?.children ?? []).map(({ name, status }) => [name, status]),
          );
          const repairCoverage = new Set(
            children.contract.children
              .filter(({ name }) => {
                const status = statusByChild.get(name);
                return status !== 'done' && status !== 'integrated' && status !== 'archived';
              })
              .flatMap(({ covers }) => covers),
          );
          const missing = latestDecision.unresolved_ids.filter((id) => !repairCoverage.has(id));
          if (missing.length > 0) {
            throw new Error(
              `Native parent repair plan requires an unfinished child covering: ${missing.join(', ')}`,
            );
          }
        }
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
        supervisorTargetBranch = state.workspace.change_branch ?? state.workspace.target_branch;
        if (!supervisorTargetBranch) {
          throw new Error('Native Supervisor v2 requires a target branch');
        }
        supervisorTargetCommit = resolveGitRef(options.paths.projectRoot, supervisorTargetBranch);
        if (!supervisorTargetCommit) {
          throw new Error(
            `Native Supervisor target branch has no commit: ${supervisorTargetBranch}`,
          );
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
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      if (
        children?.contract.schema === 'comet.native.children.v2' &&
        supervisorTargetBranch &&
        supervisorTargetCommit
      ) {
        const supervisorState = existingSupervisor
          ? reconcileNativeSupervisorState({
              state: existingSupervisor,
              contract: children.contract,
            })
          : supervisorWorkspace
            ? createNativeSupervisorState({
                parent: written.name,
                targetBranch: supervisorTargetBranch,
                targetCommit: supervisorTargetCommit,
                integrationBranch: supervisorWorkspace.binding.changeBranch!,
                integrationWorktree: supervisorWorkspace.projectRoot,
                contract: children.contract,
              })
            : null;
        if (!supervisorState) throw new Error('Native Supervisor integration state is unavailable');
        await writeNativeSupervisorState(options.paths, supervisorState);
      }
      return written;
    },
  );
}
