import type {
  NativePortableAcceptanceResult,
  NativePortableBlockerState,
  NativePortableCheckSummary,
  NativePortableHistoryEntry,
  NativePortableHistoryOverflow,
  NativePortablePhase,
  NativePortableSpecChange,
  NativePortableState,
  NativePortableStatus,
  NativePortableText,
  NativePortableVerificationAssurance,
  NativePortableVerificationResult,
} from '../comet-native/native-portable-types.js';
import type { NativeChildDerivedStatus } from '../comet-native/native-children.js';
import type { DashboardWorkspaceIdentity } from './workspace.js';

export const NATIVE_DASHBOARD_SCHEMA = 'comet.dashboard.native.v2' as const;

export const NATIVE_DASHBOARD_LIMITS = Object.freeze({
  maxChanges: 32,
  maxArtifactPreviews: 8,
  maxCapabilities: 8,
});

export type NativeDashboardMigrationStatus =
  'none' | 'required' | 'failed' | 'legacy-read-only' | 'invalid';

export type NativeDashboardLocalExecutionReason =
  'current' | 'idle' | 'platform' | 'invalid' | 'archived';

export interface NativeDashboardArtifactPreview {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  content?: string;
  truncated?: boolean;
  size?: number;
  updatedAt?: string;
}

export interface NativeDashboardAcceptanceCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
}

export interface NativeDashboardAcceptanceItem {
  id: string;
  source: string;
  text: string;
  result: NativePortableAcceptanceResult;
  reason: NativePortableText | null;
}

export interface NativeDashboardLoopSummary {
  stage: NativePortableState['loop']['stage'];
  goalCycle: number;
  iteration: number;
  attempt: number;
  nextAction: string | null;
  actor: 'builder' | 'runtime' | 'verifier' | null;
}

export interface NativeDashboardLocalExecutionSummary {
  status: 'running' | 'interrupted' | 'absent';
  reason: NativeDashboardLocalExecutionReason;
  stage: 'building' | 'verifying' | 'archiving' | null;
  actor: 'builder' | 'runtime' | 'verifier' | null;
}

export interface NativeDashboardSpecSummary {
  total: number;
  create: number;
  modify: number;
  remove: number;
  capabilities: Array<Pick<NativePortableSpecChange, 'capability' | 'operation'>>;
  capabilitiesTruncated: boolean;
}

export interface NativeDashboardVerificationSummary {
  verdict: 'pass' | 'fail' | 'blocked';
  assurance: NativePortableVerificationAssurance;
  summary: NativePortableText;
  risks: NativePortableText[];
  risksTruncated: boolean;
  completedAt: string;
}

export interface NativeDashboardBuilderHandoffSummary {
  iteration: number;
  summary: NativePortableText;
  addressedAcceptanceIds: string[];
  checks: Array<{
    name: NativePortableText;
    result: 'passed' | 'failed' | 'not-run';
    note: NativePortableText | null;
  }>;
  checksTruncated: boolean;
  knownLimits: NativePortableText[];
  knownLimitsTruncated: boolean;
  submittedAt: string;
}

export interface NativeDashboardBlockerSummary {
  owner: NativePortableBlockerState['owner'];
  reason: NativePortableText;
  acceptanceIds: string[];
  resolutionAction: NativePortableBlockerState['resolution_action'];
}

export interface NativeDashboardCheckSummary {
  id: string;
  name: NativePortableText;
  status: NativePortableCheckSummary['status'];
  exitCode: number | null;
  durationMs: number;
}

export interface NativeDashboardHistorySummary {
  goalCycle: number;
  iteration: number;
  attempt: number;
  outcome: NativePortableHistoryEntry['outcome'];
  unresolvedIds: string[];
  summary: NativePortableText;
  completedAt: string;
}

export interface NativeDashboardHistoryOverflowSummary {
  droppedEntries: number;
  firstDroppedAt: string | null;
  lastDroppedAt: string | null;
  outcomeCounts: NativePortableHistoryOverflow['outcome_counts'];
}

export interface NativeDashboardMigrationSummary {
  status: NativeDashboardMigrationStatus;
  message: string | null;
}

export interface NativeDashboardChildSummary {
  name: string;
  summary: string | null;
  dependsOn: string[];
  covers: string[];
  status: NativeChildDerivedStatus;
  phase: NativePortablePhase | null;
  message: string | null;
  locator: string | null;
  changeStatus: 'active' | 'archived' | null;
  archiveName?: string;
  workspace: DashboardWorkspaceIdentity | null;
}

interface NativeDashboardChangeIdentity {
  workflow: 'native';
  locator: string;
  workspace: DashboardWorkspaceIdentity;
  name: string;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt: string | null;
  phase: NativePortablePhase | 'invalid';
  lifecycleStatus: NativePortableStatus | 'invalid';
  stateVersion: number | null;
  legacy: boolean;
  migration: NativeDashboardMigrationSummary;
  loop: NativeDashboardLoopSummary | null;
  acceptance: NativeDashboardAcceptanceCounts | null;
  verificationResult: NativePortableVerificationResult;
  localExecution: NativeDashboardLocalExecutionSummary;
  children: NativeDashboardChildSummary[];
}

export type NativeDashboardChangeListItem = NativeDashboardChangeIdentity;

export interface NativeDashboardChangeProjection extends NativeDashboardChangeIdentity {
  artifacts: NativeDashboardArtifactPreview[];
  specs: NativeDashboardSpecSummary;
  acceptanceItems: NativeDashboardAcceptanceItem[];
  builderHandoff: NativeDashboardBuilderHandoffSummary | null;
  verification: NativeDashboardVerificationSummary | null;
  checks: NativeDashboardCheckSummary[];
  blockers: NativeDashboardBlockerSummary[];
  history: NativeDashboardHistorySummary[];
  historyOverflow: NativeDashboardHistoryOverflowSummary;
}

export interface NativeDashboardProjection {
  schema: typeof NATIVE_DASHBOARD_SCHEMA;
  generatedAt: string;
  totalChangeCount: number;
  activeChangeCount?: number;
  archivedChangeCount?: number;
  visibleChangeCount: number;
  omittedChangeCount: number;
  changesTruncated: boolean;
  changes: NativeDashboardChangeProjection[];
}

export interface NativeDashboardPortableInput {
  state: NativePortableState;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
  artifacts?: NativeDashboardArtifactPreview[];
  localExecutionSummary?: NativeDashboardLocalExecutionSummary;
  locator?: string;
  workspace?: DashboardWorkspaceIdentity;
  children?: NativeDashboardChildSummary[];
}

function fallbackWorkspace(state: NativePortableState): DashboardWorkspaceIdentity {
  return {
    id: 'local',
    label: state.workspace.change_branch ?? 'current',
    branch: state.workspace.change_branch,
    current: true,
  };
}

function acceptanceCounts(
  acceptance: NativePortableState['acceptance'],
): NativeDashboardAcceptanceCounts {
  const count = (result: NativePortableAcceptanceResult): number =>
    acceptance.filter((item) => item.result === result).length;
  return {
    total: acceptance.length,
    passed: count('passed'),
    failed: count('failed'),
    blocked: count('blocked'),
    pending: count('pending'),
  };
}

function specSummary(specChanges: NativePortableSpecChange[]): NativeDashboardSpecSummary {
  const capabilities = specChanges
    .slice()
    .sort((left, right) => left.capability.localeCompare(right.capability))
    .slice(0, NATIVE_DASHBOARD_LIMITS.maxCapabilities)
    .map(({ capability, operation }) => ({ capability, operation }));
  return {
    total: specChanges.length,
    create: specChanges.filter(({ operation }) => operation === 'create').length,
    modify: specChanges.filter(({ operation }) => operation === 'modify').length,
    remove: specChanges.filter(({ operation }) => operation === 'remove').length,
    capabilities,
    capabilitiesTruncated: capabilities.length < specChanges.length,
  };
}

/** 只展示业务任务，不观测 OS 进程，也不从旧本机检查文件重建执行。 */
function localExecutionSummary(state: NativePortableState): NativeDashboardLocalExecutionSummary {
  const action = state.verifier_action;
  const current = action && ['pending', 'running', 'unknown'].includes(action.status);
  return {
    status: current
      ? action.status === 'running'
        ? 'running'
        : action.status === 'unknown'
          ? 'interrupted'
          : 'absent'
      : 'absent',
    reason: state.archived ? 'archived' : current ? 'current' : 'platform',
    stage: current ? 'verifying' : null,
    actor: current ? 'verifier' : null,
  };
}

function identity(input: NativeDashboardPortableInput): NativeDashboardChangeIdentity {
  const { state } = input;
  const localExecution = input.localExecutionSummary ?? localExecutionSummary(state);
  return {
    workflow: 'native',
    locator: input.locator ?? `${input.status}:${input.archiveName ?? ''}:${state.name}`,
    workspace: input.workspace ?? fallbackWorkspace(state),
    name: state.name,
    status: input.status,
    ...(input.archiveName ? { archiveName: input.archiveName } : {}),
    archivedAt: input.archivedAt ?? null,
    phase: state.phase,
    lifecycleStatus: state.status,
    stateVersion: state.state_version,
    legacy: false,
    migration: { status: 'none', message: null },
    loop: {
      stage: state.loop.stage,
      goalCycle: state.loop.goal_cycle,
      iteration: state.loop.iteration,
      attempt: state.loop.attempt,
      nextAction: state.loop.next_action,
      actor: localExecution.actor,
    },
    acceptance: acceptanceCounts(state.acceptance),
    verificationResult: state.verification_result,
    localExecution,
    children: input.children ?? [],
  };
}

export function adaptNativeDashboardListItem(
  input: NativeDashboardPortableInput,
): NativeDashboardChangeListItem {
  return identity(input);
}

export function adaptNativeDashboardChange(
  input: NativeDashboardPortableInput,
): NativeDashboardChangeProjection {
  const { state } = input;
  return {
    ...identity(input),
    artifacts: input.artifacts ?? [],
    specs: specSummary(state.spec_changes),
    acceptanceItems: state.acceptance.map(({ id, source, text, result, reason }) => ({
      id,
      source,
      text,
      result,
      reason,
    })),
    builderHandoff: state.builder_handoff
      ? {
          iteration: state.builder_handoff.iteration,
          summary: state.builder_handoff.summary,
          addressedAcceptanceIds: [...state.builder_handoff.addressed_acceptance_ids],
          checks: state.builder_handoff.checks.map(({ name, result, note }) => ({
            name,
            result,
            note,
          })),
          checksTruncated: state.builder_handoff.checks_truncated,
          knownLimits: state.builder_handoff.known_limits.map((value) => ({ ...value })),
          knownLimitsTruncated: state.builder_handoff.known_limits_truncated,
          submittedAt: state.builder_handoff.submitted_at,
        }
      : null,
    verification: state.verification
      ? {
          verdict: state.verification.verdict,
          assurance: state.verification.assurance,
          summary: state.verification.summary,
          risks: state.verification.risks.map((value) => ({ ...value })),
          risksTruncated: state.verification.risks_truncated,
          completedAt: state.verification.completed_at,
        }
      : null,
    checks: (state.verification?.checks ?? []).map((check) => ({
      id: check.id,
      name: check.name,
      status: check.status,
      exitCode: check.exit_code,
      durationMs: check.duration_ms,
    })),
    blockers: state.blockers.map((blocker) => ({
      owner: blocker.owner,
      reason: blocker.reason,
      acceptanceIds: [...blocker.acceptance_ids],
      resolutionAction: blocker.resolution_action,
    })),
    history: state.history.map((entry) => ({
      goalCycle: entry.goal_cycle,
      iteration: entry.iteration,
      attempt: entry.attempt,
      outcome: entry.outcome,
      unresolvedIds: [...entry.unresolved_ids],
      summary: entry.summary,
      completedAt: entry.completed_at,
    })),
    historyOverflow: {
      droppedEntries: state.history_overflow.dropped_entries,
      firstDroppedAt: state.history_overflow.first_dropped_at,
      lastDroppedAt: state.history_overflow.last_dropped_at,
      outcomeCounts: { ...state.history_overflow.outcome_counts },
    },
  };
}

export function adaptNativeDashboardProjection(input: {
  generatedAt: string;
  changes: NativeDashboardChangeProjection[];
  totalChangeCount?: number;
  activeChangeCount?: number;
  archivedChangeCount?: number;
}): NativeDashboardProjection {
  if (Number.isNaN(Date.parse(input.generatedAt))) {
    throw new Error('Native Dashboard generatedAt must be a canonical ISO timestamp');
  }
  const totalChangeCount = input.totalChangeCount ?? input.changes.length;
  const visible = input.changes.slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges);
  const result: NativeDashboardProjection = {
    schema: NATIVE_DASHBOARD_SCHEMA,
    generatedAt: new Date(input.generatedAt).toISOString(),
    totalChangeCount,
    ...(input.activeChangeCount === undefined
      ? {}
      : { activeChangeCount: input.activeChangeCount }),
    ...(input.archivedChangeCount === undefined
      ? {}
      : { archivedChangeCount: input.archivedChangeCount }),
    visibleChangeCount: visible.length,
    omittedChangeCount: Math.max(0, totalChangeCount - visible.length),
    changesTruncated: totalChangeCount > visible.length,
    changes: visible,
  };
  return result;
}
