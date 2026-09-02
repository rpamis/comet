export const NATIVE_PORTABLE_STATE_SCHEMA = 'comet.native.v4' as const;
export const NATIVE_LOCAL_EXECUTION_SCHEMA = 'comet.native.local-execution.v4' as const;
export const NATIVE_PORTABLE_HISTORY_LIMIT = 50 as const;

export type NativePortablePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativePortableStatus = 'active' | 'await-user' | 'blocked' | 'done';
export const NATIVE_SUPERVISOR_COORDINATION_MODES = ['multi-session', 'single-session'] as const;
export type NativeSupervisorCoordinationMode =
  (typeof NATIVE_SUPERVISOR_COORDINATION_MODES)[number];
export type NativePortableVerificationResult = 'pending' | 'pass' | 'fail' | 'blocked';
export type NativePortableLoopStopReason = 'budget' | 'stalled';
export type NativePortableVerificationAssurance =
  | 'host-attested'
  | 'skill-coordinated'
  | 'semantic-verification-unavailable'
  | 'user-confirmed-degraded';
export type NativePortableAcceptanceResult = 'pending' | 'passed' | 'failed' | 'blocked';
export type NativePortableHistoryOutcome =
  'pass' | 'fail' | 'blocked' | 'execution-error' | 'recovery';

export interface NativePortableText {
  text: string;
  truncated: boolean;
}

export interface NativePortableSpecChange {
  capability: string;
  operation: 'create' | 'modify' | 'remove';
  source: string | null;
}

export interface NativePortableWorkspace {
  isolation: 'current' | 'branch' | 'worktree';
  change_branch: string | null;
  target_branch: string | null;
  finish: 'merge' | 'push' | 'pull-request' | 'keep' | null;
}

export interface NativePortableLoopState {
  stage:
    | 'shape'
    | 'building'
    | 'verify-ready'
    | 'repairing'
    | 'archive-ready'
    | 'await-user'
    | 'blocked'
    | 'done';
  goal_cycle: number;
  iteration: number;
  attempt: number;
  retry_epoch: number;
  failed_iteration_count: number;
  no_progress_count: number;
  /** Set only when the Runtime pauses the repair loop for a bounded stop. */
  stop_reason?: NativePortableLoopStopReason;
  execution_failure_count: number;
  previous_unresolved_ids: string[];
  next_action: string | null;
}

export interface NativePortableAcceptanceState {
  id: string;
  source: string;
  text: string;
  result: NativePortableAcceptanceResult;
  reason: NativePortableText | null;
}

export interface NativeBuilderCheckSummary {
  name: NativePortableText;
  result: 'passed' | 'failed' | 'not-run';
  note: NativePortableText | null;
}

export interface NativeBuilderHandoff {
  candidate_id: string;
  identity_provider: string;
  builder_execution_ref: string;
  iteration: number;
  summary: NativePortableText;
  addressed_acceptance_ids: string[];
  checks: NativeBuilderCheckSummary[];
  checks_truncated: boolean;
  known_limits: NativePortableText[];
  known_limits_truncated: boolean;
  review: {
    status: 'passed';
    summary: NativePortableText;
    reviewer_execution_ref: string;
  } | null;
  submitted_at: string;
}

export interface NativePortableBlockerState {
  owner: 'builder' | 'runtime' | 'verifier' | 'user' | 'external';
  reason: NativePortableText;
  acceptance_ids: string[];
  resolution_action:
    | 'return-build'
    | 'retry-verifier'
    | 'resolve-verifier-blocker'
    | 'confirm-verifier-unavailable'
    | 'await-user'
    | 'wait-external';
}

export interface NativePortableCheckSummary {
  id: string;
  name: NativePortableText;
  argv_display: NativePortableText[];
  argv_truncated: boolean;
  cwd_ref: string;
  status: 'passed' | 'failed' | 'interrupted';
  exit_code: number | null;
  duration_ms: number;
}

export interface NativePortableVerificationState {
  candidate_id: string;
  identity_provider: string;
  verifier_execution_ref: string;
  iteration: number;
  attempt: number;
  assurance: NativePortableVerificationAssurance;
  verdict: 'pass' | 'fail' | 'blocked';
  checks: NativePortableCheckSummary[];
  summary: NativePortableText;
  risks: NativePortableText[];
  risks_truncated: boolean;
  completed_at: string;
}

export interface NativePortableHistoryEntry {
  goal_cycle: number;
  iteration: number;
  attempt: number;
  outcome: NativePortableHistoryOutcome;
  unresolved_ids: string[];
  summary: NativePortableText;
  completed_at: string;
}

export interface NativePortableHistoryOverflow {
  dropped_entries: number;
  first_dropped_at: string | null;
  last_dropped_at: string | null;
  outcome_counts: Record<NativePortableHistoryOutcome, number>;
}

export interface NativePortableState {
  schema: typeof NATIVE_PORTABLE_STATE_SCHEMA;
  name: string;
  language: 'en' | 'zh-CN';
  phase: NativePortablePhase;
  status: NativePortableStatus;
  state_version: number;
  brief: 'brief.md';
  children_contract_hash?: string;
  coordination_mode?: NativeSupervisorCoordinationMode;
  spec_changes: NativePortableSpecChange[];
  workspace: NativePortableWorkspace;
  loop: NativePortableLoopState;
  acceptance: NativePortableAcceptanceState[];
  builder_handoff: NativeBuilderHandoff | null;
  blockers: NativePortableBlockerState[];
  verification: NativePortableVerificationState | null;
  history: NativePortableHistoryEntry[];
  history_overflow: NativePortableHistoryOverflow;
  verification_result: NativePortableVerificationResult;
  verification_report: 'verification.md' | null;
  archived: boolean;
  created_at: string;
}

export interface NativeLocalExecutionState {
  schema: typeof NATIVE_LOCAL_EXECUTION_SCHEMA;
  change: string;
  basedOnStateVersion: number;
  workspace: {
    projectRoot: string;
    worktreeRoot: string;
    branch: string | null;
  };
  execution: null | {
    operationId: string;
    stage: 'building' | 'checking' | 'verifying' | 'archiving';
    actor: 'builder' | 'runtime' | 'verifier' | null;
    executionId: string | null;
    status: 'running' | 'completed' | 'interrupted';
    startedAt: string;
    requestCheckRounds: number;
  };
  checks: NativeLocalCheckState[];
}

export interface NativeLocalCheckState {
  id: string;
  name: string;
  operationId: string;
  status: 'planned' | 'running' | 'passed' | 'failed' | 'interrupted';
  repeatable: boolean;
  timeoutMs: number;
  executionCount: number;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  startedAt: string | null;
  completedAt: string | null;
  log: string;
}

export function emptyNativePortableHistoryOverflow(): NativePortableHistoryOverflow {
  return {
    dropped_entries: 0,
    first_dropped_at: null,
    last_dropped_at: null,
    outcome_counts: {
      pass: 0,
      fail: 0,
      blocked: 0,
      'execution-error': 0,
      recovery: 0,
    },
  };
}
