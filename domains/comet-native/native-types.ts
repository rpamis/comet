export type NativePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativeApproval = null | 'implicit' | 'confirmed';
export type NativeVerificationResult = 'pending' | 'pass' | 'fail';
export type NativeSpecOperation = 'create' | 'replace' | 'remove';

export const NATIVE_RUNTIME_PROTOCOL_VERSION = 2 as const;
export const NATIVE_CHANGE_SCHEMA = 'comet.native.v2' as const;
export const NATIVE_LEGACY_CHANGE_SCHEMA = 'comet.native.v1' as const;
export const NATIVE_TRANSITION_SCHEMA = 'comet.native.transition.v2' as const;
export const NATIVE_LEGACY_TRANSITION_SCHEMA = 'comet.native.transition.v1' as const;

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

interface NativeChangeStateFields {
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

export interface NativeLegacyChangeState extends NativeChangeStateFields {
  schema: typeof NATIVE_LEGACY_CHANGE_SCHEMA;
}

export interface NativeChangeState extends NativeChangeStateFields {
  schema: typeof NATIVE_CHANGE_SCHEMA;
  minimum_runtime_version: typeof NATIVE_RUNTIME_PROTOCOL_VERSION;
  revision: number;
}

export type NativeReadableChangeState = NativeLegacyChangeState | NativeChangeState;

export interface NativeChangeSchemaInspection {
  status: 'current' | 'migration-required' | 'runtime-incompatible';
  schema: string;
  minimumRuntimeVersion: number | null;
  state: NativeReadableChangeState | null;
  message?: string;
}

export interface NativeSnapshotEntry {
  path: string;
  hash: string;
  size: number;
  type: 'file';
}

export interface NativeSnapshotOmission {
  path: string;
  size: number | null;
  type: 'file' | 'directory' | 'other';
  reason:
    | 'file-size'
    | 'file-count'
    | 'total-size'
    | 'manifest-size'
    | 'changed-during-read'
    | 'unreadable';
}

export interface NativeSnapshotOmissionOverflow {
  ref: string;
  hash: string;
  count: number;
}

export interface NativeContentSnapshotManifest {
  schema: 'comet.native.content-snapshot.v1';
  origin: 'change-created' | 'legacy-migration' | 'explicit';
  createdAt: string;
  complete: boolean;
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxManifestBytes: number;
  };
  entries: NativeSnapshotEntry[];
  omitted: NativeSnapshotOmission[];
  omittedCount: number;
  omissionOverflow?: NativeSnapshotOmissionOverflow;
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

interface NativeTransitionJournalFields<TState extends NativeReadableChangeState> {
  id: string;
  change: string;
  evidenceHash: string;
  createdAt: string;
  previousState: TState;
  nextState: TState;
  previousRun: RunState | null;
  nextRun: RunState;
  eventData: Record<string, unknown>;
}

export interface NativeLegacyTransitionJournal extends NativeTransitionJournalFields<NativeLegacyChangeState> {
  schema: typeof NATIVE_LEGACY_TRANSITION_SCHEMA;
}

export interface NativeTransitionJournal extends NativeTransitionJournalFields<NativeChangeState> {
  schema: typeof NATIVE_TRANSITION_SCHEMA;
  minimum_runtime_version: typeof NATIVE_RUNTIME_PROTOCOL_VERSION;
  revision: number;
}

export type NativeTransitionSchemaInspection =
  | { status: 'current'; journal: NativeTransitionJournal }
  | { status: 'migration-required'; journal: NativeLegacyTransitionJournal };

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
  schema?: string;
  migrationRequired?: boolean;
  minimumRuntimeVersion?: number | null;
  error?: string;
}

export interface NativeDoctorFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  repair?: 'continue' | 'rollback' | 'migrate' | 'truncate-tail';
}

export interface NativeSchemaMigrationJournal {
  schema: 'comet.native.schema-migration.v1';
  id: string;
  change: string;
  fromSchema: typeof NATIVE_LEGACY_CHANGE_SCHEMA;
  toSchema: typeof NATIVE_CHANGE_SCHEMA;
  sourceHash: string;
  targetHash: string;
  createdAt: string;
  nextState: NativeChangeState;
  transition?: {
    sourceHash: string;
    targetHash: string;
    nextJournal: NativeTransitionJournal;
  };
}

export interface NativeSchemaMigrationHooks {
  afterPrepared?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterStateWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterTransitionWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
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
