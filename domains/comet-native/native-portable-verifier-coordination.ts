import path from 'node:path';
import type { NativeWorkspaceFinish } from './native-workspace.js';
import {
  advanceNativeSupervisorFinalVerificationHead,
  recordNativeSupervisorPortableFinalVerification,
} from './native-supervisor-coordinator.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { confirmNativeSkillCoordinatedPass } from './native-loop-runtime.js';
import {
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import { writeNativeVerificationReport } from './native-verification-report-v2.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import {
  assertNativePortableExpectedContinuationLocked,
  ensureNativePortableAcceptanceCurrentLocked,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import { returnNativePortableStateToFinalVerificationLocked } from './native-portable-transitions.js';

export async function confirmNativePortableSkillCoordinatedPass(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation?: NativePortableExpectedContinuation;
  finish?: NativeWorkspaceFinish;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm portable Skill-coordinated pass ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'accept-result',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      if (
        options.finish !== undefined &&
        !['keep', 'merge', 'push', 'pull-request'].includes(options.finish)
      ) {
        throw new Error('Native workspace finish must be keep, merge, push, or pull-request');
      }
      if (options.finish !== undefined && state.workspace.isolation === 'current') {
        throw new Error('A workspace finish choice requires an isolated Native workspace');
      }
      const supervisor = await readNativeSupervisorState(options.paths, options.name);
      if (supervisor?.finalVerification.status === 'pending') {
        const advanced = advanceNativeSupervisorFinalVerificationHead(supervisor);
        if (advanced.stateVersion !== supervisor.stateVersion) {
          return returnNativePortableStateToFinalVerificationLocked({
            paths: options.paths,
            state,
            reason:
              'Supervisor final verification was not bound to the current integration commit; rerun the final full verification.',
          });
        }
        await writeNativeSupervisorState(
          options.paths,
          recordNativeSupervisorPortableFinalVerification(supervisor, state),
        );
      }
      const next = confirmNativeSkillCoordinatedPass(state);
      if (options.finish !== undefined)
        next.workspace = { ...next.workspace, finish: options.finish };
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
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}
