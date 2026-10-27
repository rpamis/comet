import type { NativePortableState } from './native-portable-types.js';
import type { RuntimeValue } from '../engine/runtime.js';

export type NativeRecoveryCode =
  | 'archive-blocked'
  | 'archive-preflight-blocked'
  | 'candidate-drift'
  | 'verification-report-drift'
  | 'shape-drift'
  | 'execution-unresolved'
  | 'lock-active'
  | 'lock-stale'
  | 'lock-owner-unknown'
  | 'runtime-recovery-required'
  | 'workspace-conflict'
  | 'git-lock';

export interface NativeRecovery {
  schema: 'comet.native.recovery.v1';
  code: NativeRecoveryCode;
  reason: string;
  affectedPaths: string[];
  owner: unknown | null;
  diagnosticArgs: string[];
  recoveryArgs: string[] | null;
  request?: RuntimeValue;
  preconditions: string[];
  preserved: { candidateId: string | null; shapeConfirmationHash: string | null };
}

export function nativeRecoveryCommand(args: readonly string[], projectRoot?: string): string[] {
  return [
    ...args,
    ...(projectRoot && !args.includes('--project-root') ? ['--project-root', projectRoot] : []),
    ...(args.includes('--json') ? [] : ['--json']),
  ];
}

/** 只投影恢复步骤；推进权仍属于原 Run、事务和审批。 */
export function nativeRecoveryForContinuation(options: {
  state: NativePortableState;
  continuation: { disposition: string; commandArgs: string[] | null; requiredInputs: string[] };
  projectRoot?: string;
  reason?: string;
}): NativeRecovery | undefined {
  if (options.continuation.disposition !== 'blocked') return undefined;
  const { state, continuation, projectRoot } = options;
  const diagnosticArgs = nativeRecoveryCommand(
    ['comet', 'native', 'doctor', state.name],
    projectRoot,
  );
  const reason =
    options.reason ??
    (state.blockers.map(({ reason }) => String(reason)).join('; ') ||
      `Native ${state.phase} requires inspection of the original execution before continuing.`);
  return {
    schema: 'comet.native.recovery.v1',
    code: state.phase === 'archive' ? 'archive-blocked' : 'runtime-recovery-required',
    reason,
    affectedPaths: [],
    owner: null,
    diagnosticArgs,
    recoveryArgs: continuation.commandArgs
      ? nativeRecoveryCommand(continuation.commandArgs, projectRoot)
      : null,
    preconditions: continuation.requiredInputs.length
      ? continuation.requiredInputs.map((input) => `Resolve the recorded condition: ${input}`)
      : ['Inspect the original Action and its retained evidence before retrying.'],
    preserved: {
      candidateId: state.builder_handoff?.candidate_id ?? null,
      shapeConfirmationHash: state.shape_confirmation_hash ?? null,
    },
  };
}
