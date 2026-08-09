import { describe, expect, it } from 'vitest';

import {
  migrateNativeLegacyStateToPortable,
  NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA,
  nextNativePortableMigrationStep,
  parseNativePortableMigrationTransaction,
  type NativePortableMigrationTransaction,
  type NativePortableMigrationTransactionStatus,
} from '../../../domains/comet-native/native-portable-migration.js';
import type { NativePortableAcceptanceCriterion } from '../../../domains/comet-native/native-portable-acceptance.js';
import type { NativePortableWorkspace } from '../../../domains/comet-native/native-portable-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_V2_CHANGE_SCHEMA,
  type NativeChangeState,
  type NativeLegacyChangeState,
  type NativeReadableChangeState,
  type NativeV2ChangeState,
} from '../../../domains/comet-native/native-types.js';

const HASH = 'a'.repeat(64);
const ACCEPTANCE: NativePortableAcceptanceCriterion[] = [
  { id: 'A1', source: 'brief.md', text: 'The user can resume the change.' },
  {
    id: 'A2',
    source: 'specs/resume/spec.md',
    text: 'The migrated change starts from a stable boundary.',
  },
];
const WORKSPACE: NativePortableWorkspace = {
  isolation: 'worktree',
  change_branch: 'beta17',
  target_branch: 'master',
  finish: 'pull-request',
};

function legacyFields(phase: NativeReadableChangeState['phase']) {
  return {
    name: 'portable-migration',
    language: 'en' as const,
    phase,
    brief: 'brief.md' as const,
    approval: 'confirmed' as const,
    spec_changes: [
      {
        capability: 'created-capability',
        operation: 'create' as const,
        source: 'specs\\created-capability\\spec.md',
        base_hash: null,
      },
      {
        capability: 'changed-capability',
        operation: 'replace' as const,
        source: 'specs/changed-capability/spec.md',
        base_hash: HASH,
      },
      {
        capability: 'removed-capability',
        operation: 'remove' as const,
        base_hash: HASH,
      },
    ],
    verification_result: 'pass' as const,
    verification_report: 'evidence.md',
    archived: phase === 'archive',
    created_at: '2026-08-01',
    run_id: 'legacy-run',
  };
}

function v1(phase: NativeReadableChangeState['phase']): NativeLegacyChangeState {
  return { schema: NATIVE_LEGACY_CHANGE_SCHEMA, ...legacyFields(phase) };
}

function v2(phase: NativeReadableChangeState['phase']): NativeV2ChangeState {
  return {
    schema: NATIVE_V2_CHANGE_SCHEMA,
    minimum_runtime_version: 2,
    revision: 7,
    ...legacyFields(phase),
  };
}

function v3(phase: NativeReadableChangeState['phase']): NativeChangeState {
  return {
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: 3,
    revision: 9,
    verification_protocol: 'legacy-v1',
    approved_contract_hash: HASH,
    implementation_scope: `runtime/evidence/scopes/${HASH}.json`,
    verification_evidence: `runtime/evidence/verifications/${HASH}.json`,
    partial_allowance: `runtime/evidence/allowances/${HASH}.json`,
    ...legacyFields(phase),
  };
}

describe('Native legacy to portable migration', () => {
  it.each([
    ['Shape', v1('shape'), 'shape', 'shape', 0],
    ['Build', v2('build'), 'build', 'building', 1],
    ['Verify', v3('verify'), 'build', 'building', 1],
    ['Archive', v3('archive'), 'build', 'building', 1],
  ] as const)(
    'maps legacy %s to the conservative v4 stable boundary',
    (_label, state, phase, stage, iteration) => {
      const migrated = migrateNativeLegacyStateToPortable({
        state,
        acceptance: ACCEPTANCE,
        workspace: WORKSPACE,
        migratedAt: '2026-08-09T10:20:30.000Z',
      });

      expect(migrated).toMatchObject({
        schema: 'comet.native.v4',
        phase,
        status: 'active',
        state_version: 1,
        loop: {
          stage,
          goal_cycle: 1,
          iteration,
          attempt: 0,
          retry_epoch: 0,
          failed_iteration_count: 0,
          no_progress_count: 0,
          execution_failure_count: 0,
          previous_unresolved_ids: [],
        },
        builder_handoff: null,
        blockers: [],
        verification: null,
        verification_result: 'pending',
        verification_report: null,
        archived: false,
      });
      expect(migrated.history).toEqual([
        expect.objectContaining({
          goal_cycle: 1,
          iteration,
          attempt: 0,
          outcome: 'recovery',
          unresolved_ids: ['A1', 'A2'],
          completed_at: '2026-08-09T10:20:30.000Z',
        }),
      ]);
    },
  );

  it('preserves formal inputs but drops hashes, pass, evidence, and Run state', () => {
    const options = {
      state: v3('archive'),
      acceptance: ACCEPTANCE,
      workspace: WORKSPACE,
      migratedAt: '2026-08-09T10:20:30.000Z',
    } as const;

    const migrated = migrateNativeLegacyStateToPortable(options);
    expect(migrateNativeLegacyStateToPortable(options)).toEqual(migrated);
    expect(migrated.created_at).toBe('2026-08-01T00:00:00.000Z');
    expect(migrated.workspace).toEqual(WORKSPACE);
    expect(migrated.spec_changes).toEqual([
      {
        capability: 'created-capability',
        operation: 'create',
        source: 'specs/created-capability/spec.md',
      },
      {
        capability: 'changed-capability',
        operation: 'modify',
        source: 'specs/changed-capability/spec.md',
      },
      { capability: 'removed-capability', operation: 'remove', source: null },
    ]);
    expect(migrated.acceptance).toEqual(
      ACCEPTANCE.map((criterion) => ({ ...criterion, result: 'pending', reason: null })),
    );
    expect(JSON.stringify(migrated)).not.toMatch(/hash|evidence|run_id|legacy-run/iu);
  });

  it('does not require legacy Runtime and uses a deterministic timestamp by default', () => {
    const options = { state: v1('shape'), acceptance: ACCEPTANCE, workspace: WORKSPACE };
    const first = migrateNativeLegacyStateToPortable(options);
    const second = migrateNativeLegacyStateToPortable(options);

    expect(first).toEqual(second);
    expect(first.history[0].completed_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rejects acceptance and workspace data that cannot form portable state', () => {
    expect(() =>
      migrateNativeLegacyStateToPortable({
        state: v1('shape'),
        acceptance: [{ ...ACCEPTANCE[0], id: 'A2' }],
        workspace: WORKSPACE,
      }),
    ).toThrow(/contiguous sequence/iu);

    expect(() =>
      migrateNativeLegacyStateToPortable({
        state: v1('shape'),
        acceptance: ACCEPTANCE,
        workspace: { ...WORKSPACE, change_branch: null },
      }),
    ).toThrow(/requires change_branch and target_branch/iu);
  });
});

describe('Native portable migration transaction', () => {
  const base: NativePortableMigrationTransaction = {
    schema: NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA,
    id: 'migration-0001',
    change: 'portable-migration',
    fromSchema: NATIVE_CHANGE_SCHEMA,
    status: 'prepared',
    createdAt: '2026-08-09T10:20:30.000Z',
  };

  it.each([
    ['prepared', 'commit-portable-yaml', 'yaml-committed'],
    ['yaml-committed', 'cleanup-legacy-runtime', 'legacy-cleanup'],
    ['legacy-cleanup', 'commit-transaction', 'committed'],
    ['committed', 'done', null],
  ] as const)('returns the idempotent next step for %s', (status, action, nextStatus) => {
    const transaction = parseNativePortableMigrationTransaction({ ...base, status });
    const first = nextNativePortableMigrationStep(transaction);
    const second = nextNativePortableMigrationStep(transaction);

    expect(first).toEqual({ action, fromStatus: status, nextStatus });
    expect(second).toEqual(first);
    expect(transaction.status).toBe(status);
  });

  it('strictly parses transaction state', () => {
    for (const status of [
      'prepared',
      'yaml-committed',
      'legacy-cleanup',
      'committed',
    ] satisfies NativePortableMigrationTransactionStatus[]) {
      expect(parseNativePortableMigrationTransaction({ ...base, status })).toEqual({
        ...base,
        status,
      });
    }

    expect(() => parseNativePortableMigrationTransaction({ ...base, status: 'applying' })).toThrow(
      /status is invalid/iu,
    );
    expect(() =>
      parseNativePortableMigrationTransaction({ ...base, createdAt: '2026-08-09' }),
    ).toThrow(/canonical ISO timestamp/iu);
    expect(() => parseNativePortableMigrationTransaction({ ...base, sourceHash: HASH })).toThrow(
      /unknown field.*sourceHash/iu,
    );
  });
});
