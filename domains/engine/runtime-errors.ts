/** 恢复建议不授权重试，也不表示外部操作尚未执行。 */
export type RuntimeErrorRecovery =
  | 'inspect-run'
  | 'review-proposal'
  | 'reconcile-execution'
  | 'inspect-outcome'
  | 'correct-input'
  | 'restore-definition'
  | 'repair-storage'
  | 'manual-review';

/** 当前公开协议的错误码；宿主仍须保守处理未知的新错误码。 */
export type RuntimeErrorCode =
  | 'ACTION_ACTIVE'
  | 'ACTION_ALREADY_ADVANCED'
  | 'ACTION_ALREADY_CLAIMED'
  | 'ACTION_IN_FLIGHT'
  | 'ACTION_NOT_FOUND'
  | 'ACTION_NOT_PENDING'
  | 'ACTION_NOT_RUNNING'
  | 'ACTION_TERMINAL'
  | 'CAPABILITY_REQUIRED'
  | 'CHILD_DEPTH_LIMIT'
  | 'CHILD_MANAGED'
  | 'COMMAND_CONFLICT'
  | 'COMMAND_DISPATCH_FAILED'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_REJECTED'
  | 'COMMAND_VALIDATION_ERROR'
  | 'COMMAND_VALIDATOR_UNAVAILABLE'
  | 'DECISION_CONFLICT'
  | 'DUPLICATE_COMMAND_VALIDATOR'
  | 'DUPLICATE_EVIDENCE_VALIDATOR'
  | 'DUPLICATE_EXECUTOR'
  | 'DUPLICATE_STATE_VALIDATOR'
  | 'DUPLICATE_TRANSITION_HANDLER'
  | 'DUPLICATE_VALIDATOR'
  | 'DUPLICATE_WORKFLOW'
  | 'EVIDENCE_INVALIDATION_UNAVAILABLE'
  | 'EVIDENCE_KIND_MISMATCH'
  | 'EVIDENCE_REJECTED'
  | 'EVIDENCE_STEP_CHANGED'
  | 'EVIDENCE_STILL_VALID'
  | 'EVIDENCE_VALIDATOR_UNAVAILABLE'
  | 'EVIDENCE_WAIT_NOT_FOUND'
  | 'EVIDENCE_WAIT_RESOLVED'
  | 'EXECUTION_UNKNOWN'
  | 'EXECUTOR_UNAVAILABLE'
  | 'EXECUTOR_UNSUPPORTED'
  | 'INITIAL_STATE_CONFLICT'
  | 'INITIAL_STATE_INVALID'
  | 'INITIAL_STATE_REQUIRED'
  | 'INVALID_ACTION'
  | 'INVALID_COMMAND'
  | 'INVALID_DECISION'
  | 'INVALID_EVIDENCE'
  | 'INVALID_JOIN'
  | 'INVALID_JSON'
  | 'INVALID_OUTCOME'
  | 'INVALID_RUN'
  | 'INVALID_WORKFLOW'
  | 'OUTCOME_ALREADY_RECORDED'
  | 'OUTCOME_CONFLICT'
  | 'OUTCOME_PROCESSING_ERROR'
  | 'OUTCOME_REJECTED'
  | 'OUTPUT_INVALID'
  | 'PROPOSAL_INPUT_MISSING'
  | 'RECONCILIATION_REQUIRED'
  | 'REQUEST_ABORTED'
  | 'REVISION_CONFLICT'
  | 'RUN_CANCELLED'
  | 'RUN_CONFLICT'
  | 'RUN_FAILED'
  | 'RUN_NOT_FOUND'
  | 'RUN_STATE_INVALID'
  | 'RUN_TERMINAL'
  | 'STALE_ACTION'
  | 'STALE_PROPOSAL'
  | 'STATE_VALIDATOR_UNAVAILABLE'
  | 'STORE_ATOMIC_PUBLICATION_UNSUPPORTED'
  | 'STORE_CHANGED_DIRECTORY'
  | 'STORE_CORRUPT_RECORD'
  | 'STORE_INVALID_ENTRY'
  | 'STORE_INVALID_REVISION'
  | 'STORE_INVALID_ROOT'
  | 'STORE_INVALID_RUN_ID'
  | 'STORE_MISSING_REVISION'
  | 'TRANSITION_HANDLER_UNAVAILABLE'
  | 'TRANSITION_STATE_INVALID'
  | 'TRANSITION_TARGET_INVALID'
  | 'TRANSITION_UNAVAILABLE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'VALIDATOR_UNAVAILABLE'
  | 'WAIT_NOT_FOUND'
  | 'WORKFLOW_CHANGED'
  | 'WORKFLOW_UNAVAILABLE';

const recoveryByCode: Readonly<Record<RuntimeErrorCode, RuntimeErrorRecovery>> = Object.freeze({
  ACTION_ACTIVE: 'reconcile-execution',
  ACTION_ALREADY_ADVANCED: 'inspect-run',
  ACTION_ALREADY_CLAIMED: 'inspect-run',
  ACTION_IN_FLIGHT: 'reconcile-execution',
  ACTION_NOT_FOUND: 'inspect-run',
  ACTION_NOT_PENDING: 'inspect-run',
  ACTION_NOT_RUNNING: 'inspect-run',
  ACTION_TERMINAL: 'inspect-run',
  CAPABILITY_REQUIRED: 'correct-input',
  CHILD_DEPTH_LIMIT: 'restore-definition',
  CHILD_MANAGED: 'inspect-run',
  COMMAND_CONFLICT: 'correct-input',
  COMMAND_DISPATCH_FAILED: 'manual-review',
  COMMAND_NOT_FOUND: 'inspect-run',
  COMMAND_REJECTED: 'correct-input',
  COMMAND_VALIDATION_ERROR: 'manual-review',
  COMMAND_VALIDATOR_UNAVAILABLE: 'restore-definition',
  DECISION_CONFLICT: 'inspect-run',
  DUPLICATE_COMMAND_VALIDATOR: 'restore-definition',
  DUPLICATE_EVIDENCE_VALIDATOR: 'restore-definition',
  DUPLICATE_EXECUTOR: 'restore-definition',
  DUPLICATE_STATE_VALIDATOR: 'restore-definition',
  DUPLICATE_TRANSITION_HANDLER: 'restore-definition',
  DUPLICATE_VALIDATOR: 'restore-definition',
  DUPLICATE_WORKFLOW: 'restore-definition',
  EVIDENCE_INVALIDATION_UNAVAILABLE: 'restore-definition',
  EVIDENCE_KIND_MISMATCH: 'correct-input',
  EVIDENCE_REJECTED: 'correct-input',
  EVIDENCE_STEP_CHANGED: 'restore-definition',
  EVIDENCE_STILL_VALID: 'inspect-run',
  EVIDENCE_VALIDATOR_UNAVAILABLE: 'restore-definition',
  EVIDENCE_WAIT_NOT_FOUND: 'inspect-run',
  EVIDENCE_WAIT_RESOLVED: 'inspect-run',
  EXECUTION_UNKNOWN: 'reconcile-execution',
  EXECUTOR_UNAVAILABLE: 'restore-definition',
  EXECUTOR_UNSUPPORTED: 'correct-input',
  INITIAL_STATE_CONFLICT: 'correct-input',
  INITIAL_STATE_INVALID: 'correct-input',
  INITIAL_STATE_REQUIRED: 'correct-input',
  INVALID_ACTION: 'correct-input',
  INVALID_COMMAND: 'correct-input',
  INVALID_DECISION: 'correct-input',
  INVALID_EVIDENCE: 'correct-input',
  INVALID_JOIN: 'correct-input',
  INVALID_JSON: 'correct-input',
  INVALID_OUTCOME: 'correct-input',
  INVALID_RUN: 'correct-input',
  INVALID_WORKFLOW: 'correct-input',
  OUTCOME_ALREADY_RECORDED: 'inspect-run',
  OUTCOME_CONFLICT: 'inspect-outcome',
  OUTCOME_PROCESSING_ERROR: 'inspect-outcome',
  OUTCOME_REJECTED: 'inspect-outcome',
  OUTPUT_INVALID: 'inspect-outcome',
  PROPOSAL_INPUT_MISSING: 'correct-input',
  RECONCILIATION_REQUIRED: 'reconcile-execution',
  REQUEST_ABORTED: 'inspect-run',
  REVISION_CONFLICT: 'inspect-run',
  RUN_CANCELLED: 'inspect-run',
  RUN_CONFLICT: 'correct-input',
  RUN_FAILED: 'inspect-run',
  RUN_NOT_FOUND: 'inspect-run',
  RUN_STATE_INVALID: 'restore-definition',
  RUN_TERMINAL: 'inspect-run',
  STALE_ACTION: 'inspect-run',
  STALE_PROPOSAL: 'review-proposal',
  STATE_VALIDATOR_UNAVAILABLE: 'restore-definition',
  STORE_ATOMIC_PUBLICATION_UNSUPPORTED: 'repair-storage',
  STORE_CHANGED_DIRECTORY: 'repair-storage',
  STORE_CORRUPT_RECORD: 'repair-storage',
  STORE_INVALID_ENTRY: 'repair-storage',
  STORE_INVALID_REVISION: 'repair-storage',
  STORE_INVALID_ROOT: 'repair-storage',
  STORE_INVALID_RUN_ID: 'repair-storage',
  STORE_MISSING_REVISION: 'repair-storage',
  TRANSITION_HANDLER_UNAVAILABLE: 'restore-definition',
  TRANSITION_STATE_INVALID: 'restore-definition',
  TRANSITION_TARGET_INVALID: 'restore-definition',
  TRANSITION_UNAVAILABLE: 'restore-definition',
  UNSUPPORTED_PROTOCOL: 'restore-definition',
  VALIDATOR_UNAVAILABLE: 'restore-definition',
  WAIT_NOT_FOUND: 'inspect-run',
  WORKFLOW_CHANGED: 'restore-definition',
  WORKFLOW_UNAVAILABLE: 'restore-definition',
});

export class RuntimeProtocolError extends Error {
  readonly recovery: RuntimeErrorRecovery;

  constructor(
    readonly code: RuntimeErrorCode | (string & Record<never, never>),
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'RuntimeProtocolError';
    this.recovery = Object.hasOwn(recoveryByCode, code)
      ? recoveryByCode[code as RuntimeErrorCode]
      : 'manual-review';
  }
}
