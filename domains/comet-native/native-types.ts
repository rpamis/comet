export type NativePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativeApproval = null | 'implicit' | 'confirmed';
export type NativeVerificationResult = 'pending' | 'pass' | 'fail';
export type NativeSpecOperation = 'create' | 'replace' | 'remove';

export interface NativePendingRootMove {
  id: string;
  fromArtifactRoot: string;
  toArtifactRoot: string;
  stage: 'copying' | 'ready' | 'switched';
}

export interface CometProjectConfig {
  schema: 'comet.project.v1';
  default_workflow: 'native' | 'classic';
  native: {
    artifact_root: string;
    pending_root_move?: NativePendingRootMove;
  };
}

export interface NativeProjectPaths {
  projectRoot: string;
  configFile: string;
  artifactRoot: string;
  artifactRootRef: string;
  nativeRoot: string;
  specsDir: string;
  changesDir: string;
  archiveDir: string;
  runtimeDir: string;
  locksDir: string;
  transactionsDir: string;
}

export interface NativeSpecChange {
  capability: string;
  operation: NativeSpecOperation;
  source?: string;
  base_hash: string | null;
}

export interface NativeChangeState {
  schema: 'comet.native.v1';
  name: string;
  language: 'en' | 'zh-CN';
  phase: NativePhase;
  brief: 'brief.md';
  approval: NativeApproval;
  spec_changes: NativeSpecChange[];
  verification_result: NativeVerificationResult;
  verification_report: string | null;
  archived: boolean;
  created_at: string;
  run_id: string | null;
}

export interface NativeFinding {
  code: string;
  message: string;
  path?: string;
}

export interface NativeArtifactValidation {
  valid: boolean;
  findings: NativeFinding[];
}

export interface NativeAdvanceEvidence {
  summary: string;
  confirmed?: boolean;
  artifacts?: string[];
  noCodeReason?: string;
  verificationResult?: 'pass' | 'fail';
  verificationReport?: string;
}

export interface NativeAdvanceResult {
  change: NativeChangeState;
  previousPhase: NativePhase;
  next: 'auto' | 'manual' | 'done';
  nextCommand: string | null;
  findings: NativeFinding[];
}

export interface NativeTransitionJournal {
  schema: 'comet.native.transition.v1';
  id: string;
  change: string;
  evidenceHash: string;
  createdAt: string;
  previousState: NativeChangeState;
  nextState: NativeChangeState;
  previousRun: RunState | null;
  nextRun: RunState;
  eventData: Record<string, unknown>;
}

export interface NativeTransitionHooks {
  afterPrepared?: (journal: NativeTransitionJournal) => void | Promise<void>;
  afterRunStateWritten?: (journal: NativeTransitionJournal) => void | Promise<void>;
  afterChangeStateWritten?: (journal: NativeTransitionJournal) => void | Promise<void>;
}

export interface NativeStatusProjection {
  name: string;
  phase: NativePhase | 'invalid';
  approval: NativeApproval;
  verificationResult: NativeVerificationResult;
  specChanges: number;
  selected: boolean;
  nextCommand: string | null;
  archiveReady: boolean;
  error?: string;
}

export interface NativeDoctorFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  repair?: 'continue' | 'rollback';
}

export type NativeTransactionKind = 'archive' | 'root-move';
export type NativeTransactionStatus =
  | 'prepared'
  | 'applying'
  | 'committed'
  | 'rolling-back'
  | 'rolled-back';

export interface NativeTransactionOperation {
  id: string;
  type: 'write' | 'remove' | 'move';
  source?: string;
  target: string;
  staged?: string;
  backup?: string;
}

export interface NativeTransactionJournal {
  schema: 'comet.native.transaction.v1';
  id: string;
  kind: NativeTransactionKind;
  status: NativeTransactionStatus;
  projectRoot: string;
  nativeRoot: string;
  change?: string;
  createdAt: string;
  operations: NativeTransactionOperation[];
}

export interface NativeTransactionEvent {
  sequence: number;
  timestamp: string;
  type:
    | 'prepared'
    | 'operation-started'
    | 'operation-completed'
    | 'archive-finalization-started'
    | 'archive-finalized'
    | 'commit'
    | 'rollback-started'
    | 'rollback-completed';
  operationId?: string;
}

export interface NativeTransactionHooks {
  afterPrepared?: (journal: NativeTransactionJournal) => void | Promise<void>;
  afterOperation?: (
    operation: NativeTransactionOperation,
    completedCount: number,
  ) => void | Promise<void>;
  afterRootMoveStage?: (
    stage: NativePendingRootMove['stage'],
    journal: NativeTransactionJournal,
  ) => void | Promise<void>;
}
import type { RunState } from '../engine/types.js';
