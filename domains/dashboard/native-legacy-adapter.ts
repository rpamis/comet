import type { NativeChangeState } from '../comet-native/native-types.js';
import type {
  NativeDashboardArtifactPreview,
  NativeDashboardChangeListItem,
  NativeDashboardChangeProjection,
} from './native-adapter.js';

function localExecution(archived: boolean): NativeDashboardChangeListItem['localExecution'] {
  return {
    status: 'absent',
    reason: archived ? 'archived' : 'missing',
    stage: null,
    actor: null,
    startedAt: null,
    requestCheckRounds: 0,
    checks: [],
    recoverableFromStage: null,
  };
}

function identity(options: {
  state: NativeChangeState;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
}): NativeDashboardChangeListItem {
  const archived = options.status === 'archived';
  return {
    workflow: 'native',
    name: options.state.name,
    status: options.status,
    ...(options.archiveName ? { archiveName: options.archiveName } : {}),
    archivedAt: options.archivedAt ?? null,
    phase: archived ? 'archive' : options.state.phase,
    lifecycleStatus: archived ? 'done' : 'active',
    stateVersion: options.state.revision,
    legacy: true,
    migration: {
      status: archived ? 'legacy-read-only' : 'required',
      message: archived
        ? 'Legacy Native archive is available in read-only mode.'
        : 'Legacy active change requires Native migration before it can continue.',
    },
    loop: null,
    acceptance: null,
    verificationResult: options.state.verification_result,
    localExecution: localExecution(archived),
  };
}

export function adaptLegacyNativeDashboardListItem(options: {
  state: NativeChangeState;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
}): NativeDashboardChangeListItem {
  return identity(options);
}

export function adaptLegacyNativeDashboardChange(options: {
  state: NativeChangeState;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
  artifacts?: NativeDashboardArtifactPreview[];
}): NativeDashboardChangeProjection {
  const specs = options.state.spec_changes;
  const capabilities = specs.slice(0, 8).map(({ capability, operation }) => ({
    capability,
    operation: operation === 'replace' ? ('modify' as const) : operation,
  }));
  return {
    ...identity(options),
    artifacts: options.artifacts ?? [],
    specs: {
      total: specs.length,
      create: specs.filter(({ operation }) => operation === 'create').length,
      modify: specs.filter(({ operation }) => operation === 'replace').length,
      remove: specs.filter(({ operation }) => operation === 'remove').length,
      capabilities,
      capabilitiesTruncated: capabilities.length < specs.length,
    },
    acceptanceItems: [],
    builderHandoff: null,
    verification: null,
    checks: [],
    blockers: [],
    history: [],
    historyOverflow: {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  };
}

export function invalidNativeDashboardListItem(options: {
  name: string;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
  message?: string;
}): NativeDashboardChangeListItem {
  return {
    workflow: 'native',
    name: options.name,
    status: options.status,
    ...(options.archiveName ? { archiveName: options.archiveName } : {}),
    archivedAt: options.archivedAt ?? null,
    phase: 'invalid',
    lifecycleStatus: 'invalid',
    stateVersion: null,
    legacy: false,
    migration: { status: 'invalid', message: options.message ?? 'Native state is invalid.' },
    loop: null,
    acceptance: null,
    verificationResult: 'pending',
    localExecution: localExecution(options.status === 'archived'),
  };
}

export function invalidNativeDashboardChange(options: {
  name: string;
  status: 'active' | 'archived';
  archiveName?: string;
  archivedAt?: string | null;
  message?: string;
}): NativeDashboardChangeProjection {
  return {
    ...invalidNativeDashboardListItem(options),
    artifacts: [],
    specs: {
      total: 0,
      create: 0,
      modify: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [],
    builderHandoff: null,
    verification: null,
    checks: [],
    blockers: [],
    history: [],
    historyOverflow: {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  };
}
