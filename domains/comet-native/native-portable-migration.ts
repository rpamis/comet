import path from 'node:path';

import {
  parseLegacyNativeChangeValue,
  parseNativeChangeValue,
  parseV2NativeChangeValue,
} from './native-change.js';
import {
  assertNativePortableAcceptanceIds,
  type NativePortableAcceptanceCriterion,
} from './native-portable-acceptance.js';
import { parseNativePortableState } from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import {
  emptyNativePortableHistoryOverflow,
  NATIVE_PORTABLE_STATE_SCHEMA,
  type NativePortablePhase,
  type NativePortableSpecChange,
  type NativePortableState,
  type NativePortableWorkspace,
} from './native-portable-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_V2_CHANGE_SCHEMA,
  type NativeReadableChangeState,
} from './native-types.js';

export const NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA =
  'comet.native.portable-migration.v1' as const;

export type NativePortableMigrationTransactionStatus =
  | 'prepared'
  | 'yaml-committed'
  | 'legacy-cleanup'
  | 'committed';

export interface NativePortableMigrationTransaction {
  schema: typeof NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA;
  id: string;
  change: string;
  fromSchema:
    | typeof NATIVE_LEGACY_CHANGE_SCHEMA
    | typeof NATIVE_V2_CHANGE_SCHEMA
    | typeof NATIVE_CHANGE_SCHEMA;
  status: NativePortableMigrationTransactionStatus;
  createdAt: string;
}

export type NativePortableMigrationAction =
  | 'commit-portable-yaml'
  | 'cleanup-legacy-runtime'
  | 'commit-transaction'
  | 'done';

export interface NativePortableMigrationNextStep {
  action: NativePortableMigrationAction;
  fromStatus: NativePortableMigrationTransactionStatus;
  nextStatus: NativePortableMigrationTransactionStatus | null;
}

const TRANSACTION_KEYS = new Set(['schema', 'id', 'change', 'fromSchema', 'status', 'createdAt']);
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TRANSACTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const TRANSACTION_STATUSES = new Set<NativePortableMigrationTransactionStatus>([
  'prepared',
  'yaml-committed',
  'legacy-cleanup',
  'committed',
]);
const LEGACY_SCHEMAS = new Set<NativePortableMigrationTransaction['fromSchema']>([
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_V2_CHANGE_SCHEMA,
  NATIVE_CHANGE_SCHEMA,
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function canonicalTimestamp(value: string | Date, label: string): string {
  const parsed = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

function parseCanonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function parseLegacyState(state: NativeReadableChangeState): NativeReadableChangeState {
  if (state.schema === NATIVE_LEGACY_CHANGE_SCHEMA) {
    return parseLegacyNativeChangeValue(state);
  }
  if (state.schema === NATIVE_V2_CHANGE_SCHEMA) return parseV2NativeChangeValue(state);
  return parseNativeChangeValue(state);
}

function portableSpecSource(source: string): string {
  return path.posix.normalize(source.replaceAll('\\', '/'));
}

function migrateSpecChanges(state: NativeReadableChangeState): NativePortableSpecChange[] {
  return state.spec_changes.map((change) => {
    if (change.operation === 'remove') {
      return { capability: change.capability, operation: 'remove', source: null };
    }
    return {
      capability: change.capability,
      operation: change.operation === 'replace' ? 'modify' : 'create',
      source: portableSpecSource(change.source!),
    };
  });
}

function targetPhase(legacyPhase: NativePortablePhase): 'shape' | 'build' {
  return legacyPhase === 'shape' ? 'shape' : 'build';
}

function nextAction(language: NativePortableState['language'], phase: 'shape' | 'build'): string {
  if (language === 'zh-CN') {
    return phase === 'shape' ? '继续澄清并确认验收项' : '重新提交候选实现';
  }
  return phase === 'shape'
    ? 'Continue clarification and confirm acceptance'
    : 'Submit a fresh implementation candidate';
}

function recoverySummary(
  language: NativePortableState['language'],
  schema: NativeReadableChangeState['schema'],
  phase: NativePortablePhase,
): string {
  if (language === 'zh-CN') {
    return `从旧版 ${schema} ${phase} 状态恢复；旧版 Loop、验证结论和运行记录未继承。`;
  }
  return `Recovered from legacy ${schema} ${phase} state; prior Loop, verification results, and execution records were not inherited.`;
}

/**
 * Convert a parsed v1/v2/v3 change into the portable v4 stable boundary.
 *
 * This function intentionally has no Runtime input. Missing trajectory, Run,
 * checkpoint, snapshot, evidence, or per-change Runtime files cannot alter the
 * result. A caller may supply the migration time; otherwise the legacy creation
 * date is used as a deterministic recovery timestamp.
 */
export function migrateNativeLegacyStateToPortable(options: {
  state: NativeReadableChangeState;
  acceptance: readonly NativePortableAcceptanceCriterion[];
  workspace: NativePortableWorkspace;
  migratedAt?: string | Date;
}): NativePortableState {
  const legacy = parseLegacyState(options.state);
  assertNativePortableAcceptanceIds(options.acceptance);

  const phase = targetPhase(legacy.phase);
  const iteration = phase === 'shape' ? 0 : 1;
  const recoveredAt = canonicalTimestamp(
    options.migratedAt ?? `${legacy.created_at}T00:00:00.000Z`,
    'Native portable migration time',
  );
  const acceptance = options.acceptance.map((criterion) => ({
    id: criterion.id,
    source: criterion.source,
    text: criterion.text,
    result: 'pending' as const,
    reason: null,
  }));

  return parseNativePortableState({
    schema: NATIVE_PORTABLE_STATE_SCHEMA,
    name: legacy.name,
    language: legacy.language,
    phase,
    status: 'active',
    state_version: 1,
    brief: 'brief.md',
    spec_changes: migrateSpecChanges(legacy),
    workspace: options.workspace,
    loop: {
      stage: phase === 'shape' ? 'shape' : 'building',
      goal_cycle: 1,
      iteration,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: nextAction(legacy.language, phase),
    },
    acceptance,
    builder_handoff: null,
    blockers: [],
    verification: null,
    history: [
      {
        goal_cycle: 1,
        iteration,
        attempt: 0,
        outcome: 'recovery',
        unresolved_ids: acceptance.map(({ id }) => id),
        summary: toNativePortableText(
          recoverySummary(legacy.language, legacy.schema, legacy.phase),
        ),
        completed_at: recoveredAt,
      },
    ],
    history_overflow: emptyNativePortableHistoryOverflow(),
    verification_result: 'pending',
    verification_report: null,
    archived: false,
    created_at: `${legacy.created_at}T00:00:00.000Z`,
  });
}

export function parseNativePortableMigrationTransaction(
  value: unknown,
): NativePortableMigrationTransaction {
  const root = record(value, 'Native portable migration transaction');
  const unknown = Object.keys(root).filter((key) => !TRANSACTION_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Native portable migration transaction has unknown field(s): ${unknown.join(', ')}`,
    );
  }
  if (root.schema !== NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA) {
    throw new Error('Unsupported Native portable migration transaction schema');
  }
  if (typeof root.id !== 'string' || !TRANSACTION_ID_PATTERN.test(root.id)) {
    throw new Error('Native portable migration transaction id is invalid');
  }
  if (typeof root.change !== 'string' || !CHANGE_NAME_PATTERN.test(root.change)) {
    throw new Error('Native portable migration transaction change is invalid');
  }
  if (
    typeof root.fromSchema !== 'string' ||
    !LEGACY_SCHEMAS.has(root.fromSchema as NativePortableMigrationTransaction['fromSchema'])
  ) {
    throw new Error('Native portable migration transaction fromSchema is invalid');
  }
  if (
    typeof root.status !== 'string' ||
    !TRANSACTION_STATUSES.has(root.status as NativePortableMigrationTransactionStatus)
  ) {
    throw new Error('Native portable migration transaction status is invalid');
  }

  return {
    schema: NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA,
    id: root.id,
    change: root.change,
    fromSchema: root.fromSchema as NativePortableMigrationTransaction['fromSchema'],
    status: root.status as NativePortableMigrationTransactionStatus,
    createdAt: parseCanonicalTimestamp(
      root.createdAt,
      'Native portable migration transaction createdAt',
    ),
  };
}

/**
 * Return the one replay-safe action for a persisted transaction boundary.
 * Repeated calls with the same journal return the same action and never mutate
 * the journal; the filesystem integration advances status only after the action
 * has reached its stable boundary.
 */
export function nextNativePortableMigrationStep(
  value: NativePortableMigrationTransaction,
): NativePortableMigrationNextStep {
  const transaction = parseNativePortableMigrationTransaction(value);
  switch (transaction.status) {
    case 'prepared':
      return {
        action: 'commit-portable-yaml',
        fromStatus: 'prepared',
        nextStatus: 'yaml-committed',
      };
    case 'yaml-committed':
      return {
        action: 'cleanup-legacy-runtime',
        fromStatus: 'yaml-committed',
        nextStatus: 'legacy-cleanup',
      };
    case 'legacy-cleanup':
      return {
        action: 'commit-transaction',
        fromStatus: 'legacy-cleanup',
        nextStatus: 'committed',
      };
    case 'committed':
      return { action: 'done', fromStatus: 'committed', nextStatus: null };
  }
}
