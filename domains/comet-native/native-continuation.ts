import type {
  NativeArchiveConfirmation,
  NativeChangeState,
  NativeClarificationMode,
  NativeContinuation,
  NativeStructuredFinding,
} from './native-types.js';
import { isNativeWorkspaceAdvisoryCode } from './native-workspace.js';

const REPAIR_CODES =
  /^(?:run-|trajectory-|checkpoint-(?:missing|mismatch|invalid|progress-invalid)|transition-(?:incomplete|invalid))/u;

function requiredPhaseInputs(state: NativeChangeState): string[] {
  if (state.phase === 'shape') {
    return ['summary', 'shared-understanding-confirmation'];
  }
  if (state.phase === 'build') {
    return state.approval === 'confirmed'
      ? ['summary', 'artifact-or-no-code-reason']
      : ['summary', 'artifact-or-no-code-reason', 'shared-understanding-confirmation'];
  }
  if (state.phase === 'verify') return ['summary', 'verification-result', 'verification-report'];
  return [];
}

export function nativeContinuation(options: {
  state: NativeChangeState;
  findings?: readonly NativeStructuredFinding[];
  archiveReady?: boolean;
  evidenceRetreat?: boolean;
  done?: boolean;
  clarificationMode?: NativeClarificationMode;
  archiveConfirmation?: NativeArchiveConfirmation;
  archivePreflightHash?: string;
}): NativeContinuation {
  const findings = options.findings ?? [];
  const actionableFindings = findings.filter(
    (finding) => !isNativeWorkspaceAdvisoryCode(finding.code),
  );
  const decision = actionableFindings.find((finding) => finding.requiresUserDecision);
  const repair = actionableFindings.find(
    (finding) => finding.repairCommand !== null || REPAIR_CODES.test(finding.code),
  );
  const repairDecision = actionableFindings.find(
    (finding) =>
      finding.code === 'repair-iteration-limit' || finding.code === 'repair-override-exhausted',
  );
  const stagnationStop = actionableFindings.find(
    (finding) => finding.code === 'repair-stagnation-stop',
  );
  const requiredInputs = [
    ...new Set(actionableFindings.map((finding) => finding.requiredAction)),
  ].sort();

  if (options.done) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'done',
      action: 'none',
      command: null,
      requiresUserDecision: false,
      requiredInputs: [],
    };
  }
  if (repairDecision) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'await-user',
      action: 'work-phase',
      command: null,
      requiresUserDecision: true,
      requiredInputs: ['repair-continuation-decision'],
    };
  }
  if (decision) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'await-user',
      action: 'work-phase',
      command: null,
      requiresUserDecision: true,
      requiredInputs,
    };
  }
  if (stagnationStop) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'blocked',
      action: 'repair',
      command: null,
      requiresUserDecision: false,
      requiredInputs: ['new-repair-hypothesis'],
    };
  }
  if (repair) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'blocked',
      action: 'repair',
      command: repair.repairCommand,
      requiresUserDecision: false,
      requiredInputs,
    };
  }
  if (options.evidenceRetreat) {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'continue',
      action: 'advance-phase',
      command: `comet native next ${options.state.name} --summary "<summary>"`,
      requiresUserDecision: false,
      requiredInputs: ['summary'],
    };
  }
  if (options.state.phase === 'build' && options.state.verification_result === 'fail') {
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'continue',
      action: 'work-phase',
      command: null,
      requiresUserDecision: false,
      requiredInputs: ['repair-verification-gaps'],
    };
  }
  if (actionableFindings.length > 0) {
    if (options.state.phase === 'archive') {
      return {
        schema: 'comet.native.continuation.v1',
        skill: 'comet-native',
        change: options.state.name,
        phase: options.state.phase,
        revision: options.state.revision,
        disposition: 'blocked',
        action: 'none',
        command: null,
        requiresUserDecision: false,
        requiredInputs,
      };
    }
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: 'continue',
      action: 'work-phase',
      command: null,
      requiresUserDecision: false,
      requiredInputs,
    };
  }
  if (options.state.phase === 'archive') {
    if (options.archiveReady && options.archivePreflightHash) {
      if (!/^[a-f0-9]{64}$/u.test(options.archivePreflightHash)) {
        throw new Error('Native Archive continuation preflight must be a SHA-256 hash');
      }
      if (options.archiveConfirmation === 'required') {
        return {
          schema: 'comet.native.continuation.v1',
          skill: 'comet-native',
          change: options.state.name,
          phase: options.state.phase,
          revision: options.state.revision,
          disposition: 'await-user',
          action: 'archive',
          command: null,
          requiresUserDecision: true,
          requiredInputs: ['archive-confirmation'],
        };
      }
      return {
        schema: 'comet.native.continuation.v1',
        skill: 'comet-native',
        change: options.state.name,
        phase: options.state.phase,
        revision: options.state.revision,
        disposition: 'continue',
        action: 'archive',
        command: `comet native archive ${options.state.name} --expect-preflight ${options.archivePreflightHash}`,
        requiresUserDecision: false,
        requiredInputs: [],
      };
    }
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: options.archiveReady ? 'continue' : 'blocked',
      action: options.archiveReady ? 'archive' : 'none',
      command: options.archiveReady ? `comet native archive ${options.state.name} --dry-run` : null,
      requiresUserDecision: false,
      requiredInputs: options.archiveReady ? [] : ['archive-readiness'],
    };
  }
  const confirmationSuffix =
    options.state.phase === 'shape' ||
    (options.state.phase === 'build' && options.state.approval !== 'confirmed')
      ? ' --confirmed'
      : '';
  return {
    schema: 'comet.native.continuation.v1',
    skill: 'comet-native',
    change: options.state.name,
    phase: options.state.phase,
    revision: options.state.revision,
    disposition: 'continue',
    action: 'advance-phase',
    command: `comet native next ${options.state.name} --summary "<summary>"${confirmationSuffix}`,
    requiresUserDecision: false,
    requiredInputs: requiredPhaseInputs(options.state),
  };
}
