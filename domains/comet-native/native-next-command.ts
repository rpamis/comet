import { inspectNativeChildren } from './native-children.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import { recoverNativePortableChange } from './native-portable-recovery.js';
import { applyNativeRunnerInput, readNativeRunnerInput } from './native-runner-input.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import {
  completeNativePortableParentBuild,
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  confirmNativePortableVerifierUnavailable,
  inspectNativePortableAcceptanceDrift,
  isNativePortableChange,
  resolveNativePortableVerifierBlocker,
  returnNativePortableChangeToBuild,
  returnNativePortableChangeToShape,
  retryNativePortableVerifier,
  type NativePortableExpectedContinuation,
  type NativePortableExpectedContinuationAction,
} from './native-portable-runtime.js';
import type { NativePortableState } from './native-portable-types.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import type { NativeProjectPaths } from './native-types.js';

const EXPECTED_CONTINUATION_ACTIONS = new Set<NativePortableExpectedContinuationAction>([
  'confirm-shape',
  'accept-result',
  'confirm-verifier-unavailable',
  'revise-implementation',
  'revise-requirements',
  'retry-verifier',
  'resolve-verifier-blocker',
]);

function expectedContinuationOption(
  args: string[],
): NativePortableExpectedContinuation | undefined {
  const stateVersion = takeOption(args, '--expected-state-version');
  const action = takeOption(args, '--expected-action');
  if (stateVersion === undefined && action === undefined) return undefined;
  if (stateVersion === undefined || action === undefined) {
    throw new NativeUsageError(
      '--expected-state-version and --expected-action must be provided together',
    );
  }
  if (!/^[1-9]\d*$/u.test(stateVersion) || !Number.isSafeInteger(Number(stateVersion))) {
    throw new NativeUsageError('--expected-state-version must be a positive integer');
  }
  if (!EXPECTED_CONTINUATION_ACTIONS.has(action as NativePortableExpectedContinuationAction)) {
    throw new NativeUsageError('--expected-action is not a recognized Native continuation action');
  }
  return {
    stateVersion: Number(stateVersion),
    action: action as NativePortableExpectedContinuationAction,
  };
}

async function portableParentView(paths: NativeProjectPaths, state: NativePortableState) {
  const children = await inspectNativeChildren({ paths, state });
  return {
    ...(children
      ? {
          children: children.children,
          readyChildren: children.readyChildren,
        }
      : {}),
    continuation: nativePortableContinuation(state, children),
  };
}

export async function nativeNextCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const summary = takeOption(args, '--summary');
  const runnerInputFile = takeOption(args, '--runner-input');
  const confirmed = takeFlag(args, '--confirmed');
  const acceptResult = takeFlag(args, '--accept-result');
  const reviseImplementation = takeFlag(args, '--revise-implementation');
  const reviseRequirements = takeFlag(args, '--revise-requirements');
  const retryVerifier = takeFlag(args, '--retry-verifier');
  const resolveVerifierBlocker = takeFlag(args, '--resolve-verifier-blocker');
  const expectedContinuation = expectedContinuationOption(args);
  if (
    [
      confirmed,
      acceptResult,
      reviseImplementation,
      reviseRequirements,
      retryVerifier,
      resolveVerifierBlocker,
    ].filter(Boolean).length > 1
  ) {
    throw new NativeUsageError(
      '--confirmed, --accept-result, --revise-implementation, --revise-requirements, --retry-verifier, and --resolve-verifier-blocker are mutually exclusive',
    );
  }
  // Agent-authored Build/Verify completion fields retired with Native v4.
  // Parsing the complete public surface before migration prevents a legacy
  // invocation from silently accepting one of those old fields.
  assertNoArguments(args);

  const configured = await configuredPaths(projectRoot);
  if (!(await isNativePortableChange(configured.paths, name))) {
    if (runnerInputFile) {
      throw new NativeUsageError('--runner-input is only valid for portable Native changes');
    }
    if (!summary) throw new NativeUsageError('--summary is required');
    // The first mutating command on a legacy active change performs the
    // deterministic migration and stops at the resulting stable boundary.
    const state = await migrateNativeLegacyChangeToPortable({
      paths: configured.paths,
      name,
    });
    return success('next', {
      state,
      migration: { completed: true, summary },
      continuation: nativePortableContinuation(state),
    });
  }

  if (runnerInputFile) {
    if (
      summary ||
      confirmed ||
      acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      resolveVerifierBlocker ||
      expectedContinuation
    ) {
      throw new NativeUsageError(
        '--runner-input cannot be combined with --summary, continuation expectations, or Agent transition flags',
      );
    }
    const recovery = await recoverNativePortableChange({
      paths: configured.paths,
      name,
      preserveRunningExecution: true,
    });
    const current = recovery.state;
    if (
      recovery.action === 'await-user' ||
      recovery.action === 'done' ||
      recovery.reason !== 'available'
    ) {
      return success('next', {
        state: current,
        recovery,
        ...(await portableParentView(configured.paths, current)),
      });
    }
    if (current.phase === 'build') {
      const drift = await inspectNativePortableAcceptanceDrift({
        paths: configured.paths,
        state: current,
      });
      if (drift.drifted) {
        const state = await returnNativePortableChangeToShape({
          paths: configured.paths,
          name,
          reason: drift.reason ?? 'Native confirmed requirements changed',
        });
        return success('next', {
          state,
          ...(await portableParentView(configured.paths, state)),
        });
      }
      if (await inspectNativeChildren({ paths: configured.paths, state: current })) {
        throw new NativeUsageError(
          'Native parent Build advances child changes and does not accept a Builder handoff',
        );
      }
    }
    const input = await readNativeRunnerInput(runnerInputFile, projectRoot);
    const result = await applyNativeRunnerInput({
      paths: configured.paths,
      name,
      input,
      maxVerifyFailures: configured.config.native.max_verify_failures,
    });
    return success('next', {
      ...result,
      ...(await portableParentView(configured.paths, result.state)),
      coordination: NATIVE_SKILL_COORDINATION,
    });
  }
  const recovery = await recoverNativePortableChange({ paths: configured.paths, name });
  const current = recovery.state;
  if (!summary) throw new NativeUsageError('--summary is required');
  let state;
  if (confirmed) {
    if (current.phase === 'shape') {
      state = await confirmNativePortableShape({
        paths: configured.paths,
        name,
        expectedContinuation,
      });
    } else if (
      current.phase === 'verify' &&
      current.status === 'await-user' &&
      current.loop.next_action === 'confirm-verifier-unavailable'
    ) {
      state = await confirmNativePortableVerifierUnavailable({
        paths: configured.paths,
        name,
        summary,
        expectedContinuation,
      });
    } else {
      throw new NativeUsageError(
        '--confirmed is only valid in Shape or for a user-accepted degraded verification fallback',
      );
    }
  } else if (acceptResult) {
    if (
      !expectedContinuation &&
      (current.phase !== 'verify' ||
        current.status !== 'await-user' ||
        current.loop.next_action !== 'confirm-skill-coordinated-pass')
    ) {
      throw new NativeUsageError(
        '--accept-result is only valid for a pending Verify pass decision',
      );
    }
    state = await confirmNativePortableSkillCoordinatedPass({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  } else if (reviseImplementation) {
    if (current.phase !== 'verify') {
      throw new NativeUsageError('--revise-implementation is only valid from Verify');
    }
    state = await returnNativePortableChangeToBuild({
      paths: configured.paths,
      name,
      reason: summary,
      expectedContinuation,
    });
  } else if (reviseRequirements) {
    if (!expectedContinuation && current.phase !== 'verify' && current.phase !== 'archive') {
      throw new NativeUsageError('--revise-requirements is only valid from Verify or Archive');
    }
    state = await returnNativePortableChangeToShape({
      paths: configured.paths,
      name,
      reason: summary,
      allowedPhases: ['verify', 'archive'],
      expectedContinuation,
    });
  } else if (retryVerifier) {
    state = await retryNativePortableVerifier({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  } else if (resolveVerifierBlocker) {
    state = await resolveNativePortableVerifierBlocker({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  } else {
    if (recovery.reason !== 'available') {
      return success('next', {
        state: current,
        recovery,
        ...(await portableParentView(configured.paths, current)),
      });
    }
    if (current.phase === 'build') {
      const drift = await inspectNativePortableAcceptanceDrift({
        paths: configured.paths,
        state: current,
      });
      if (drift.drifted) {
        state = await returnNativePortableChangeToShape({
          paths: configured.paths,
          name,
          reason: drift.reason ?? 'Native confirmed requirements changed',
        });
      } else {
        const children = await inspectNativeChildren({ paths: configured.paths, state: current });
        if (children) {
          if (
            children.allDone &&
            !(current.loop.stage === 'repairing' && current.verification_result === 'fail')
          ) {
            state = await completeNativePortableParentBuild({
              paths: configured.paths,
              name,
              summary,
            });
          } else {
            return success('next', {
              state: current,
              children: children.children,
              readyChildren: children.readyChildren,
              continuation: nativePortableContinuation(current, children),
            });
          }
        }
      }
    }
    if (state) {
      return success('next', {
        state,
        ...(await portableParentView(configured.paths, state)),
      });
    }
    return {
      command: 'next',
      exitCode: 65,
      data: { state: current, continuation: nativePortableContinuation(current) },
      error: {
        code: 'invalid-data',
        message:
          'This Native step requires the skill-coordinated --runner-input action returned by continuation; public JSON cannot supply identity, provider, execution ref, or candidate binding',
      },
    };
  }
  return success('next', {
    state,
    ...(await portableParentView(configured.paths, state)),
  });
}
