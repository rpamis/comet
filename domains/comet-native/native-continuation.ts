import type {
  NativeChangeState,
  NativeContinuation,
  NativeStructuredFinding,
} from './native-types.js';

const REPAIR_CODES =
  /^(?:run-|trajectory-|checkpoint-(?:missing|mismatch|invalid|progress-invalid)|transition-(?:incomplete|invalid))/u;

function requiredPhaseInputs(state: NativeChangeState): string[] {
  if (state.phase === 'shape') return ['summary'];
  if (state.phase === 'build') return ['summary', 'artifact-or-no-code-reason'];
  if (state.phase === 'verify') return ['summary', 'verification-result', 'verification-report'];
  return [];
}

export function nativeContinuation(options: {
  state: NativeChangeState;
  findings?: readonly NativeStructuredFinding[];
  archiveReady?: boolean;
  done?: boolean;
}): NativeContinuation {
  const findings = options.findings ?? [];
  const decision = findings.find((finding) => finding.requiresUserDecision);
  const repair = findings.find(
    (finding) => finding.repairCommand !== null || REPAIR_CODES.test(finding.code),
  );
  const requiredInputs = [...new Set(findings.map((finding) => finding.requiredAction))].sort();

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
  if (findings.length > 0) {
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
    return {
      schema: 'comet.native.continuation.v1',
      skill: 'comet-native',
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: options.archiveReady ? 'continue' : 'blocked',
      action: options.archiveReady ? 'archive' : 'none',
      command: options.archiveReady ? `comet native archive ${options.state.name}` : null,
      requiresUserDecision: false,
      requiredInputs: options.archiveReady ? [] : ['archive-readiness'],
    };
  }
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
    requiredInputs: requiredPhaseInputs(options.state),
  };
}
