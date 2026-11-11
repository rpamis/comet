import type {
  WorkflowNativeEnabledProjectConfig,
  WorkflowNativePendingRootMove,
  WorkflowNativeRootMoveCleanup,
  WorkflowNativeRootMoveCleanupKind,
} from '../workflow-contract/types.js';

export type NativePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativeApproval = null | 'implicit' | 'confirmed';
export type NativeVerificationResult = 'pending' | 'pass' | 'fail';
export type NativeSpecOperation = 'create' | 'replace' | 'remove';
export type NativeClarificationMode =
  WorkflowNativeEnabledProjectConfig['native']['clarification_mode'];
export type NativeVerificationProtocol = 'legacy-v1';

export const NATIVE_RUNTIME_PROTOCOL_VERSION = 3 as const;
export const NATIVE_CHANGE_SCHEMA = 'comet.native.v3' as const;
export const NATIVE_V2_CHANGE_SCHEMA = 'comet.native.v2' as const;
export const NATIVE_LEGACY_CHANGE_SCHEMA = 'comet.native.v1' as const;
export const NATIVE_TRANSITION_SCHEMA = 'comet.native.transition.v3' as const;
export const NATIVE_V2_TRANSITION_SCHEMA = 'comet.native.transition.v2' as const;
export const NATIVE_LEGACY_TRANSITION_SCHEMA = 'comet.native.transition.v1' as const;

export type NativeRootMoveCleanupKind = WorkflowNativeRootMoveCleanupKind;
export type NativeRootMoveCleanup = WorkflowNativeRootMoveCleanup;
export type NativePendingRootMove = WorkflowNativePendingRootMove;

export type CometProjectConfig = WorkflowNativeEnabledProjectConfig;
export type NativeArchiveConfirmation =
  WorkflowNativeEnabledProjectConfig['native']['archive_confirmation'];

export interface NativeProjectPaths {
  projectRoot: string;
  configFile: string;
  artifactRoot: string;
  artifactRootRef: string;
  nativeRoot: string;
  specsDir: string;
  changesDir: string;
  archiveDir: string;
  workspaceRuntimeRoot: string;
  runtimeDir: string;
  changesRuntimeDir: string;
  transactionsDir: string;
}

/** Canonical user-editable and Runtime-managed paths for one Native change. */
export interface NativeChangeArtifactPaths {
  artifactRoot: string;
  nativeRoot: string;
  changeDir: string;
  briefPath: string;
  childrenPath: string;
  specsDir: string;
  verificationPath: string;
  statePath: string;
  runtimeDir: string;
  runtimeStatePath: string;
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

export interface NativeV2ChangeState extends NativeChangeStateFields {
  schema: typeof NATIVE_V2_CHANGE_SCHEMA;
  minimum_runtime_version: 2;
  revision: number;
}

export type NativeContentAddressedRef =
  `runtime/evidence/${'scopes' | 'allowances' | 'verifications'}/${string}.json`;

export interface NativeChangeState extends NativeChangeStateFields {
  schema: typeof NATIVE_CHANGE_SCHEMA;
  minimum_runtime_version: typeof NATIVE_RUNTIME_PROTOCOL_VERSION;
  revision: number;
  verification_protocol: NativeVerificationProtocol;
  /** Hash of the brief/spec contract that the current approval applies to. */
  approved_contract_hash: string | null;
  implementation_scope: NativeContentAddressedRef | null;
  verification_evidence: NativeContentAddressedRef | null;
  partial_allowance: NativeContentAddressedRef | null;
}

export type NativeReadableChangeState =
  NativeLegacyChangeState | NativeV2ChangeState | NativeChangeState;

export interface NativeChangeSchemaInspection {
  status: 'current' | 'migration-required' | 'runtime-incompatible';
  schema: string;
  minimumRuntimeVersion: number | null;
  state: NativeReadableChangeState | null;
  message?: string;
}

export interface NativeFinding {
  code: string;
  message: string;
  path?: string;
}

export type NativeFindingSeverity = 'info' | 'warning' | 'error';

/** Stable, machine-readable finding emitted by Native command projections. */
export interface NativeStructuredFinding {
  code: string;
  message: string;
  severity: NativeFindingSeverity;
  path: string | null;
  requiredAction: string;
  retryCommand: string | null;
  repairCommand: string | null;
  requiresUserDecision: boolean;
}

export interface NativeFindingSummary {
  total: number;
  errors: number;
  warnings: number;
  info: number;
  requiresUserDecision: boolean;
  codes: string[];
  truncated: boolean;
}

export type NativeContinuationDisposition = 'continue' | 'await-user' | 'blocked' | 'done';
export type NativeContinuationAction =
  'work-phase' | 'advance-phase' | 'repair' | 'archive' | 'none';

export interface NativeContinuationInputOption {
  input: string;
  flags: string[];
  required: boolean;
  placeholder: string | null;
  choices?: string[];
  repeatable?: boolean;
  alternativeGroup?: string;
}

export interface NativeContinuation {
  schema: 'comet.native.continuation.v1';
  skill: 'comet-native';
  change: string;
  phase: NativePhase;
  revision: number;
  disposition: NativeContinuationDisposition;
  action: NativeContinuationAction;
  command: string | null;
  /** Full executable plus argv template. Placeholders are explicit angle-bracket tokens. */
  commandArgs: string[] | null;
  requiresUserDecision: boolean;
  requiredInputs: string[];
  inputOptions: NativeContinuationInputOption[];
}

export interface NativeArtifactValidation {
  valid: boolean;
  findings: NativeFinding[];
}

export interface NativeAdvanceEvidence {
  summary: string;
  returnToBuild?: boolean;
  confirmed?: boolean;
  artifacts?: string[];
  noCodeReason?: string;
  allowPartialScopeHash?: string;
  partialReason?: string;
  verificationResult?: 'pass' | 'fail';
  verificationReport?: string;
  repairOverrideSignature?: string;
  repairOverrideSummary?: string;
}

export interface NativeAcceptanceCriterionProjection {
  id: string;
  kind: 'brief-example' | 'spec-scenario' | 'spec-must';
  source: string;
  context: string[];
  text: string;
  contextTruncated: boolean;
  textTruncated: boolean;
  verificationStatus: 'satisfied' | 'failed' | 'missing' | 'unverified';
}

export interface NativeAcceptancePageProjection {
  schema: 'comet.native.acceptance-page.v1';
  acceptanceHash: string;
  total: number;
  offset: number;
  items: NativeAcceptanceCriterionProjection[];
  failedAcceptanceIds: string[];
  missingAcceptanceIds: string[];
  failedCheckIds: string[];
  failedCheckIdsTruncated: boolean;
  nextCursor: string | null;
  nextPageCommand?: string | null;
  nextPageArgs?: string[] | null;
  limits: {
    maxItems: number;
    maxTextBytes: number;
    maxContextItems: number;
    maxContextItemBytes: number;
    maxFailedCheckIds: number;
    maxSerializedBytes: number;
  };
}

export interface NativeWorkspaceProjection {
  projectRoot: string;
  currentBranch: string | null;
  isSecondaryWorktree: boolean;
  bindingState: 'missing' | 'legacy' | 'aligned' | 'drifted' | 'invalid';
  isolation: 'current' | 'branch' | 'worktree' | null;
  changeBranch: string | null;
  targetBranch: string | null;
  finish: 'merge' | 'push' | 'pull-request' | 'keep' | null;
}

export interface NativeRepairDecisionProjection {
  disposition: 'continue' | 'warn' | 'manual-stop' | 'hard-stop';
  reasonCode:
    | 'new-failure-signature'
    | 'repeated-failure-warning'
    | 'repeated-failure-stop'
    | 'override-accepted'
    | 'override-already-used'
    | 'repair-iteration-limit';
  signatureHash: string;
  consecutiveFailures: number;
  totalRepairFailures: number;
  remainingIterations: number;
  overrideAccepted: boolean;
}

export interface NativeRepairStatusProjection {
  disposition: NativeRepairDecisionProjection['disposition'];
  signatureHash: string;
  overrideRecorded: boolean;
  failedAcceptanceIds: string[];
  failedCheckIds: string[];
  totalVerifyFailures: number;
  maxVerifyFailures: number;
  remainingVerifyFailures: number;
}

export interface NativePreparedScopeProjection {
  scopeHash: string;
  scopeRef: NativeContentAddressedRef;
  complete: boolean;
  unresolvedScopeCount: number;
  partialAllowanceRef: NativeContentAddressedRef | null;
  acceptancePage: NativeAcceptancePageProjection;
}

export interface NativeAdvanceResult {
  change: NativeChangeState;
  previousPhase: NativePhase;
  next: 'auto' | 'manual' | 'done';
  nextCommand: string | null;
  findings: NativeStructuredFinding[];
  continuation: NativeContinuation;
  preparedScope?: NativePreparedScopeProjection;
  repair?: NativeRepairDecisionProjection;
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

export type NativeTransitionOperation =
  'advance' | 'spec-rebase' | 'evidence-retreat' | 'runtime-rebuild';

export interface NativeLegacyTransitionJournal extends NativeTransitionJournalFields<NativeLegacyChangeState> {
  schema: typeof NATIVE_LEGACY_TRANSITION_SCHEMA;
}

export interface NativeV2TransitionJournal extends NativeTransitionJournalFields<NativeV2ChangeState> {
  schema: typeof NATIVE_V2_TRANSITION_SCHEMA;
  minimum_runtime_version: 2;
  revision: number;
}

export interface NativeTransitionJournal extends NativeTransitionJournalFields<NativeChangeState> {
  schema: typeof NATIVE_TRANSITION_SCHEMA;
  minimum_runtime_version: typeof NATIVE_RUNTIME_PROTOCOL_VERSION;
  revision: number;
  operation: NativeTransitionOperation;
}

export type NativeTransitionSchemaInspection =
  | { status: 'current'; journal: NativeTransitionJournal }
  | {
      status: 'migration-required';
      journal: NativeLegacyTransitionJournal | NativeV2TransitionJournal;
    };

export interface NativeTransitionHooks {
  afterPrepared?: (journal: NativeTransitionJournal) => void | Promise<void>;
  afterRunStateWritten?: (journal: NativeTransitionJournal) => void | Promise<void>;
  afterChangeStateWritten?: (journal: NativeTransitionJournal) => void | Promise<void>;
}

/** 旧业务文档的只读诊断；不读取或创建 progress 内容快照。 */
export interface NativeStatusProjection {
  name: string;
  artifacts?: NativeChangeArtifactPaths;
  phase: NativePhase | 'invalid';
  revision: number | null;
  approval: NativeApproval;
  verificationResult: NativeVerificationResult;
  specChanges: number;
  selected: boolean;
  nextCommand: string | null;
  archiveReady: boolean;
  inspection: {
    freshness: 'fresh' | 'stale';
    codes: string[];
    reasonCount: number;
    codesTruncated: boolean;
  };
  findingSummary: NativeFindingSummary;
  detailsCommand: string | null;
  checkpoint: null;
  continuation: NativeContinuation | null;
  workspace: NativeWorkspaceProjection;
  runtime: {
    status: 'available' | 'missing' | 'invalid';
    layout: 'user-local' | 'legacy' | 'missing';
    path: string;
    message?: string;
  };
  repair?: NativeRepairStatusProjection | null;
  acceptancePage?: NativeAcceptancePageProjection;
  findings?: NativeStructuredFinding[];
  schema?: string;
  migrationRequired?: boolean;
  minimumRuntimeVersion?: number | null;
  error?: string;
}

export interface NativeStatusPageProjection {
  schema: 'comet.native.status-page.v1';
  total: number;
  offset: number;
  items: NativeStatusProjection[];
  nextCursor: string | null;
  nextPageCommand: string | null;
  nextPageArgs: string[] | null;
  limits: {
    maxItems: number;
    maxChanges: number;
    maxSerializedBytes: number;
  };
}

export interface NativeDoctorFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  repair?: 'continue' | 'rollback' | 'migrate' | 'truncate-tail' | 'recover';
  repairCommand?: string;
}

export interface NativeSchemaMigrationJournal {
  schema: 'comet.native.schema-migration.v1';
  id: string;
  change: string;
  fromSchema: typeof NATIVE_LEGACY_CHANGE_SCHEMA | typeof NATIVE_V2_CHANGE_SCHEMA;
  toSchema: typeof NATIVE_V2_CHANGE_SCHEMA | typeof NATIVE_CHANGE_SCHEMA;
  sourceHash: string;
  targetHash: string;
  createdAt: string;
  nextState: NativeV2ChangeState | NativeChangeState;
  transition?: {
    sourceHash: string;
    targetHash: string;
    nextJournal: NativeV2TransitionJournal | NativeTransitionJournal;
  };
  transitionSupersede?: {
    sourceHash: string;
    transitionId: string;
    previousRun: RunState;
    nextRun: RunState;
    evidenceHash: string;
    eventData: Record<string, unknown>;
  };
  runRetreat?: {
    previousRun: RunState;
    nextRun: RunState;
    evidenceHash: string;
    eventData: Record<string, unknown>;
  };
}

export interface NativeSchemaMigrationHooks {
  afterPrepared?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterStateWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterTransitionWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterTransitionSuperseded?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterRunStateWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterTrajectoryWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
  afterCheckpointWritten?: (journal: NativeSchemaMigrationJournal) => void | Promise<void>;
}

export type NativeTransactionKind = 'archive' | 'root-move';
export type NativeTransactionStatus =
  'prepared' | 'applying' | 'committed' | 'rolling-back' | 'rolled-back';

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
  beforeRootMoveSourceRemove?: (sourceRoot: string) => void | Promise<void>;
  afterRootMoveSourceQuarantined?: (quarantine: string) => void | Promise<void>;
  afterRootMoveCleanupEntryRemoved?: (
    kind: NativeRootMoveCleanupKind,
    ref: string,
    removedCount: number,
  ) => void | Promise<void>;
}
import type { RunState } from '../engine/types.js';
