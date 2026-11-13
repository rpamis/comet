import path from 'node:path';
import { confirmNativeSkillCoordinatedPass } from './native-loop-runtime.js';
import { withNativeMutation } from './native-mutation.js';
import {
  assertNativePortableExpectedContinuationLocked,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import {
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { returnNativePortableStateToFinalVerificationLocked } from './native-portable-transitions.js';
import type { NativePortableState } from './native-portable-types.js';
import { advanceNativeSupervisorIntegrationHead } from './native-supervisor-coordinator.js';
import { readNativeSupervisorState } from './native-supervisor-state.js';
import type { NativeProjectPaths } from './native-types.js';
import { writeNativeSdkVerificationReport } from './native-sdk-report.js';
import type { NativeWorkspaceFinish } from './native-workspace.js';
export async function confirmNativePortableSkillCoordinatedPass(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation?: NativePortableExpectedContinuation;
  finish?: NativeWorkspaceFinish;
}): Promise<NativePortableState> {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'accept-result',
    });
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
    if (supervisor) {
      const advanced = advanceNativeSupervisorIntegrationHead(supervisor);
      if (advanced.stateVersion !== supervisor.stateVersion) {
        return returnNativePortableStateToFinalVerificationLocked({
          paths: options.paths,
          state,
          reason:
            'Supervisor final verification was not bound to the current integration commit; rerun the final full verification.',
        });
      }
    }
    const next = confirmNativeSkillCoordinatedPass(state);
    if (options.finish !== undefined)
      next.workspace = { ...next.workspace, finish: options.finish };
    const written = await writePortableMutation({ paths: options.paths, previous: state, next });
    await writeNativeSdkVerificationReport({
      paths: options.paths,
      runId: state.name,
      file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
      state: written,
    });
    return written;
  });
}
