import { promises as fs } from 'node:fs';

import { parseDocument, stringify } from 'yaml';

import { atomicWriteText, type NativeAtomicWriteOptions } from './native-atomic-file.js';
import {
  emptyNativePortableHistoryOverflow,
  NATIVE_PORTABLE_HISTORY_LIMIT,
  NATIVE_PORTABLE_STATE_SCHEMA,
  type NativeBuilderCheckSummary,
  type NativeBuilderHandoff,
  type NativePortableAcceptanceState,
  type NativePortableBlockerState,
  type NativePortableCheckSummary,
  type NativePortableHistoryEntry,
  type NativePortableHistoryOutcome,
  type NativePortableHistoryOverflow,
  type NativePortableLoopState,
  type NativePortableSpecChange,
  type NativePortableState,
  type NativePortableText,
  type NativePortableVerificationState,
  type NativePortableWorkspace,
} from './native-portable-types.js';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ACCEPTANCE_ID_PATTERN = /^A[1-9][0-9]*$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

const ROOT_KEYS = new Set([
  'schema',
  'name',
  'language',
  'phase',
  'status',
  'state_version',
  'brief',
  'children_contract_hash',
  'spec_changes',
  'workspace',
  'loop',
  'acceptance',
  'builder_handoff',
  'blockers',
  'verification',
  'history',
  'history_overflow',
  'verification_result',
  'verification_report',
  'archived',
  'created_at',
]);

export class NativePortableStateVersionConflictError extends Error {
  readonly code = 'native-state-version-conflict';

  constructor(
    readonly expectedStateVersion: number,
    readonly actualStateVersion: number,
  ) {
    super(
      `Native state version conflict: expected ${expectedStateVersion}, got ${actualStateVersion}`,
    );
    this.name = 'NativePortableStateVersionConflictError';
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function stringValue(value: unknown, label: string, options?: { empty?: boolean }): string {
  if (typeof value !== 'string' || (!options?.empty && value.length === 0)) {
    throw new Error(`${label} must be ${options?.empty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function hashValue(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!HASH_PATTERN.test(result)) throw new Error(`${label} must be a SHA-256 hash`);
  return result;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function integerValue(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integerValue(value, label, Number.MIN_SAFE_INTEGER);
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function arrayValue<T>(
  value: unknown,
  label: string,
  parse: (entry: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => parse(entry, index));
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label, (entry, index) => stringValue(entry, `${label}[${index}]`));
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function timestamp(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (Number.isNaN(Date.parse(result)))
    throw new Error(`${label} must be an ISO date or timestamp`);
  return result;
}

function portableRef(value: unknown, label: string, allowDot = false): string {
  const result = stringValue(value, label);
  if (
    result.includes('\\') ||
    result.startsWith('/') ||
    /^[A-Za-z]:/u.test(result) ||
    result.split('/').includes('..') ||
    (!allowDot && (result === '.' || result.split('/').includes('.')))
  ) {
    throw new Error(`${label} must be a portable relative path`);
  }
  return result;
}

function parsePortableText(value: unknown, label: string): NativePortableText {
  const root = record(value, label);
  rejectUnknown(root, new Set(['text', 'truncated']), label);
  return {
    text: stringValue(root.text, `${label}.text`, { empty: true }),
    truncated: booleanValue(root.truncated, `${label}.truncated`),
  };
}

function parseSpecChange(value: unknown, index: number): NativePortableSpecChange {
  const label = `Native spec_changes[${index}]`;
  const root = record(value, label);
  rejectUnknown(root, new Set(['capability', 'operation', 'source']), label);
  const capability = stringValue(root.capability, `${label}.capability`);
  if (!CAPABILITY_PATTERN.test(capability)) throw new Error(`${label}.capability is invalid`);
  const operation = enumValue(
    root.operation,
    ['create', 'modify', 'remove'] as const,
    `${label}.operation`,
  );
  const source = root.source === null ? null : portableRef(root.source, `${label}.source`);
  if (operation === 'remove' && source !== null)
    throw new Error(`${label} remove requires source null`);
  if (operation !== 'remove' && source === null) {
    throw new Error(`${label} ${operation} requires a source`);
  }
  return { capability, operation, source };
}

function parseWorkspace(value: unknown): NativePortableWorkspace {
  const label = 'Native workspace';
  const root = record(value, label);
  rejectUnknown(root, new Set(['isolation', 'change_branch', 'target_branch', 'finish']), label);
  const isolation = enumValue(
    root.isolation,
    ['current', 'branch', 'worktree'] as const,
    `${label}.isolation`,
  );
  const change_branch = nullableString(root.change_branch, `${label}.change_branch`);
  const target_branch = nullableString(root.target_branch, `${label}.target_branch`);
  const finish =
    root.finish === null
      ? null
      : enumValue(
          root.finish,
          ['merge', 'push', 'pull-request', 'keep'] as const,
          `${label}.finish`,
        );
  if (isolation === 'current' && finish !== null) {
    throw new Error('Native current workspace cannot contain a finish action');
  }
  if (isolation === 'current' && (change_branch === null) !== (target_branch === null)) {
    throw new Error('Native workspace branch bindings must both be present or both be null');
  }
  if (isolation !== 'current' && (change_branch === null || target_branch === null)) {
    throw new Error('Native isolated workspace requires change_branch and target_branch');
  }
  return { isolation, change_branch, target_branch, finish };
}

function parseLoop(value: unknown): NativePortableLoopState {
  const label = 'Native loop';
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'stage',
      'goal_cycle',
      'iteration',
      'attempt',
      'retry_epoch',
      'failed_iteration_count',
      'no_progress_count',
      'execution_failure_count',
      'previous_unresolved_ids',
      'next_action',
    ]),
    label,
  );
  const previous_unresolved_ids = stringArray(
    root.previous_unresolved_ids,
    `${label}.previous_unresolved_ids`,
  );
  assertUnique(previous_unresolved_ids, `${label}.previous_unresolved_ids`);
  return {
    stage: enumValue(
      root.stage,
      [
        'shape',
        'building',
        'verify-ready',
        'repairing',
        'archive-ready',
        'await-user',
        'blocked',
        'done',
      ] as const,
      `${label}.stage`,
    ),
    goal_cycle: integerValue(root.goal_cycle, `${label}.goal_cycle`, 1),
    iteration: integerValue(root.iteration, `${label}.iteration`),
    attempt: integerValue(root.attempt, `${label}.attempt`),
    retry_epoch: integerValue(root.retry_epoch, `${label}.retry_epoch`),
    failed_iteration_count: integerValue(
      root.failed_iteration_count,
      `${label}.failed_iteration_count`,
    ),
    no_progress_count: integerValue(root.no_progress_count, `${label}.no_progress_count`),
    execution_failure_count: integerValue(
      root.execution_failure_count,
      `${label}.execution_failure_count`,
    ),
    previous_unresolved_ids,
    next_action: nullableString(root.next_action, `${label}.next_action`),
  };
}

function parseAcceptance(value: unknown, index: number): NativePortableAcceptanceState {
  const label = `Native acceptance[${index}]`;
  const root = record(value, label);
  rejectUnknown(root, new Set(['id', 'source', 'text', 'result', 'reason']), label);
  const id = stringValue(root.id, `${label}.id`);
  if (!ACCEPTANCE_ID_PATTERN.test(id)) throw new Error(`${label}.id must use A1, A2, ...`);
  return {
    id,
    source: portableRef(root.source, `${label}.source`),
    text: stringValue(root.text, `${label}.text`),
    result: enumValue(
      root.result,
      ['pending', 'passed', 'failed', 'blocked'] as const,
      `${label}.result`,
    ),
    reason: root.reason === null ? null : parsePortableText(root.reason, `${label}.reason`),
  };
}

function parseBuilderCheck(value: unknown, index: number): NativeBuilderCheckSummary {
  const label = `Native builder_handoff.checks[${index}]`;
  const root = record(value, label);
  rejectUnknown(root, new Set(['name', 'result', 'note']), label);
  return {
    name: parsePortableText(root.name, `${label}.name`),
    result: enumValue(root.result, ['passed', 'failed', 'not-run'] as const, `${label}.result`),
    note: root.note === null ? null : parsePortableText(root.note, `${label}.note`),
  };
}

function parseBuilderHandoff(value: unknown): NativeBuilderHandoff {
  const label = 'Native builder_handoff';
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'candidate_id',
      'identity_provider',
      'builder_execution_ref',
      'iteration',
      'summary',
      'addressed_acceptance_ids',
      'checks',
      'checks_truncated',
      'known_limits',
      'known_limits_truncated',
      'submitted_at',
    ]),
    label,
  );
  const addressed_acceptance_ids = stringArray(
    root.addressed_acceptance_ids,
    `${label}.addressed_acceptance_ids`,
  );
  assertUnique(addressed_acceptance_ids, `${label}.addressed_acceptance_ids`);
  return {
    candidate_id: stringValue(root.candidate_id, `${label}.candidate_id`),
    identity_provider: stringValue(root.identity_provider, `${label}.identity_provider`),
    builder_execution_ref: stringValue(
      root.builder_execution_ref,
      `${label}.builder_execution_ref`,
    ),
    iteration: integerValue(root.iteration, `${label}.iteration`, 1),
    summary: parsePortableText(root.summary, `${label}.summary`),
    addressed_acceptance_ids,
    checks: arrayValue(root.checks, `${label}.checks`, parseBuilderCheck),
    checks_truncated: booleanValue(root.checks_truncated, `${label}.checks_truncated`),
    known_limits: arrayValue(root.known_limits, `${label}.known_limits`, (entry, index) =>
      parsePortableText(entry, `${label}.known_limits[${index}]`),
    ),
    known_limits_truncated: booleanValue(
      root.known_limits_truncated,
      `${label}.known_limits_truncated`,
    ),
    submitted_at: timestamp(root.submitted_at, `${label}.submitted_at`),
  };
}

function parseBlocker(value: unknown, index: number): NativePortableBlockerState {
  const label = `Native blockers[${index}]`;
  const root = record(value, label);
  rejectUnknown(root, new Set(['owner', 'reason', 'acceptance_ids', 'resolution_action']), label);
  const acceptance_ids = stringArray(root.acceptance_ids, `${label}.acceptance_ids`);
  assertUnique(acceptance_ids, `${label}.acceptance_ids`);
  return {
    owner: enumValue(
      root.owner,
      ['builder', 'runtime', 'verifier', 'user', 'external'] as const,
      `${label}.owner`,
    ),
    reason: parsePortableText(root.reason, `${label}.reason`),
    acceptance_ids,
    resolution_action: enumValue(
      root.resolution_action,
      [
        'return-build',
        'retry-verifier',
        'resolve-verifier-blocker',
        'confirm-verifier-unavailable',
        'await-user',
        'wait-external',
      ] as const,
      `${label}.resolution_action`,
    ),
  };
}

function parseCheck(value: unknown, index: number): NativePortableCheckSummary {
  const label = `Native verification.checks[${index}]`;
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'id',
      'name',
      'argv_display',
      'argv_truncated',
      'cwd_ref',
      'status',
      'exit_code',
      'duration_ms',
    ]),
    label,
  );
  return {
    id: stringValue(root.id, `${label}.id`),
    name: parsePortableText(root.name, `${label}.name`),
    argv_display: arrayValue(root.argv_display, `${label}.argv_display`, (entry, argvIndex) =>
      parsePortableText(entry, `${label}.argv_display[${argvIndex}]`),
    ),
    argv_truncated: booleanValue(root.argv_truncated, `${label}.argv_truncated`),
    cwd_ref: portableRef(root.cwd_ref, `${label}.cwd_ref`, true),
    status: enumValue(root.status, ['passed', 'failed', 'interrupted'] as const, `${label}.status`),
    exit_code: nullableInteger(root.exit_code, `${label}.exit_code`),
    duration_ms: integerValue(root.duration_ms, `${label}.duration_ms`),
  };
}

function parseVerification(value: unknown): NativePortableVerificationState {
  const label = 'Native verification';
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'candidate_id',
      'identity_provider',
      'verifier_execution_ref',
      'iteration',
      'attempt',
      'assurance',
      'verdict',
      'checks',
      'summary',
      'risks',
      'risks_truncated',
      'completed_at',
    ]),
    label,
  );
  const checks = arrayValue(root.checks, `${label}.checks`, parseCheck);
  assertUnique(
    checks.map((check) => check.id),
    `${label}.checks IDs`,
  );
  const identity_provider = stringValue(root.identity_provider, `${label}.identity_provider`);
  return {
    candidate_id: stringValue(root.candidate_id, `${label}.candidate_id`),
    identity_provider,
    verifier_execution_ref: stringValue(
      root.verifier_execution_ref,
      `${label}.verifier_execution_ref`,
    ),
    iteration: integerValue(root.iteration, `${label}.iteration`, 1),
    attempt: integerValue(root.attempt, `${label}.attempt`, 1),
    assurance:
      root.assurance === undefined
        ? identity_provider === 'skill-coordinated'
          ? 'skill-coordinated'
          : 'host-attested'
        : enumValue(
            root.assurance,
            [
              'host-attested',
              'skill-coordinated',
              'semantic-verification-unavailable',
              'user-confirmed-degraded',
            ] as const,
            `${label}.assurance`,
          ),
    verdict: enumValue(root.verdict, ['pass', 'fail', 'blocked'] as const, `${label}.verdict`),
    checks,
    summary: parsePortableText(root.summary, `${label}.summary`),
    risks: arrayValue(root.risks, `${label}.risks`, (entry, index) =>
      parsePortableText(entry, `${label}.risks[${index}]`),
    ),
    risks_truncated: booleanValue(root.risks_truncated, `${label}.risks_truncated`),
    completed_at: timestamp(root.completed_at, `${label}.completed_at`),
  };
}

function parseHistoryEntry(value: unknown, index: number): NativePortableHistoryEntry {
  const label = `Native history[${index}]`;
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'goal_cycle',
      'iteration',
      'attempt',
      'outcome',
      'unresolved_ids',
      'summary',
      'completed_at',
    ]),
    label,
  );
  const unresolved_ids = stringArray(root.unresolved_ids, `${label}.unresolved_ids`);
  assertUnique(unresolved_ids, `${label}.unresolved_ids`);
  return {
    goal_cycle: integerValue(root.goal_cycle, `${label}.goal_cycle`, 1),
    iteration: integerValue(root.iteration, `${label}.iteration`),
    attempt: integerValue(root.attempt, `${label}.attempt`),
    outcome: enumValue(
      root.outcome,
      ['pass', 'fail', 'blocked', 'execution-error', 'recovery'] as const,
      `${label}.outcome`,
    ),
    unresolved_ids,
    summary: parsePortableText(root.summary, `${label}.summary`),
    completed_at: timestamp(root.completed_at, `${label}.completed_at`),
  };
}

function parseOutcomeCounts(value: unknown): Record<NativePortableHistoryOutcome, number> {
  const label = 'Native history_overflow.outcome_counts';
  const root = record(value, label);
  const keys = ['pass', 'fail', 'blocked', 'execution-error', 'recovery'] as const;
  rejectUnknown(root, new Set(keys), label);
  return {
    pass: integerValue(root.pass, `${label}.pass`),
    fail: integerValue(root.fail, `${label}.fail`),
    blocked: integerValue(root.blocked, `${label}.blocked`),
    'execution-error': integerValue(root['execution-error'], `${label}.execution-error`),
    recovery: integerValue(root.recovery, `${label}.recovery`),
  };
}

function parseHistoryOverflow(value: unknown): NativePortableHistoryOverflow {
  const label = 'Native history_overflow';
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set(['dropped_entries', 'first_dropped_at', 'last_dropped_at', 'outcome_counts']),
    label,
  );
  const dropped_entries = integerValue(root.dropped_entries, `${label}.dropped_entries`);
  const first_dropped_at =
    root.first_dropped_at === null
      ? null
      : timestamp(root.first_dropped_at, `${label}.first_dropped_at`);
  const last_dropped_at =
    root.last_dropped_at === null
      ? null
      : timestamp(root.last_dropped_at, `${label}.last_dropped_at`);
  if (dropped_entries === 0 && (first_dropped_at !== null || last_dropped_at !== null)) {
    throw new Error('Native empty history overflow cannot contain dropped timestamps');
  }
  if (dropped_entries > 0 && (first_dropped_at === null || last_dropped_at === null)) {
    throw new Error('Native non-empty history overflow requires dropped timestamps');
  }
  const outcome_counts = parseOutcomeCounts(root.outcome_counts);
  const counted = Object.values(outcome_counts).reduce((sum, count) => sum + count, 0);
  if (counted !== dropped_entries) {
    throw new Error('Native history overflow outcome count must equal dropped_entries');
  }
  return { dropped_entries, first_dropped_at, last_dropped_at, outcome_counts };
}

function assertReferences(state: NativePortableState): void {
  const acceptanceIds = new Set(state.acceptance.map((entry) => entry.id));
  for (const id of state.loop.previous_unresolved_ids) {
    if (!acceptanceIds.has(id))
      throw new Error(`Native loop references unknown acceptance ID ${id}`);
  }
  for (const id of state.builder_handoff?.addressed_acceptance_ids ?? []) {
    if (!acceptanceIds.has(id))
      throw new Error(`Native builder handoff references unknown ID ${id}`);
  }
  for (const blocker of state.blockers) {
    for (const id of blocker.acceptance_ids) {
      if (!acceptanceIds.has(id)) throw new Error(`Native blocker references unknown ID ${id}`);
    }
  }
  if (state.builder_handoff) {
    const allowedIteration =
      state.builder_handoff.iteration === state.loop.iteration ||
      (state.phase === 'build' &&
        state.loop.stage === 'repairing' &&
        state.builder_handoff.iteration === state.loop.iteration - 1);
    if (!allowedIteration) {
      throw new Error('Native builder handoff iteration is not current or the prior repair result');
    }
  }
  if (state.verification) {
    if (!state.builder_handoff) throw new Error('Native verification requires a builder handoff');
    if (state.verification.candidate_id !== state.builder_handoff.candidate_id) {
      throw new Error('Native verification candidate must match the builder handoff');
    }
    if (state.verification.identity_provider !== state.builder_handoff.identity_provider) {
      throw new Error('Native Builder and Verifier identity providers must match');
    }
    const skillAssurance = [
      'skill-coordinated',
      'semantic-verification-unavailable',
      'user-confirmed-degraded',
    ].includes(state.verification.assurance);
    if (skillAssurance !== (state.verification.identity_provider === 'skill-coordinated')) {
      throw new Error('Native verification assurance does not match its identity provider');
    }
    if (
      state.verification.assurance === 'semantic-verification-unavailable' &&
      state.verification.verdict !== 'blocked'
    ) {
      throw new Error('Native unavailable semantic verification must remain blocked');
    }
    if (
      state.verification.assurance === 'user-confirmed-degraded' &&
      state.verification.verdict !== 'pass'
    ) {
      throw new Error('Native user-confirmed degraded verification must be passing');
    }
    if (state.verification.verifier_execution_ref === state.builder_handoff.builder_execution_ref) {
      throw new Error('Native Builder and Verifier execution refs must differ');
    }
    const currentResult =
      state.verification.iteration === state.loop.iteration &&
      state.verification.attempt === state.loop.attempt;
    const priorRepairResult =
      state.phase === 'build' &&
      state.loop.stage === 'repairing' &&
      state.verification.iteration === state.loop.iteration - 1 &&
      state.verification.iteration === state.builder_handoff.iteration;
    if (!currentResult && !priorRepairResult) {
      throw new Error(
        'Native verification iteration and attempt do not match a stable loop result',
      );
    }
  }
}

function assertLifecycle(state: NativePortableState): void {
  const stagesByPhase: Record<NativePortableState['phase'], ReadonlySet<string>> = {
    shape: new Set(['shape', 'await-user', 'blocked']),
    build: new Set(['building', 'repairing', 'await-user', 'blocked']),
    verify: new Set(['verify-ready', 'await-user', 'blocked']),
    archive: new Set(['archive-ready', 'await-user', 'blocked', 'done']),
  };
  if (!stagesByPhase[state.phase].has(state.loop.stage)) {
    throw new Error(`Native loop stage ${state.loop.stage} is invalid for phase ${state.phase}`);
  }
  const terminalStage =
    state.status === 'await-user'
      ? 'await-user'
      : state.status === 'blocked'
        ? 'blocked'
        : state.status === 'done'
          ? 'done'
          : null;
  if (terminalStage !== null && state.loop.stage !== terminalStage) {
    throw new Error(`Native status ${state.status} requires loop stage ${terminalStage}`);
  }
  if (state.status === 'active' && ['await-user', 'blocked', 'done'].includes(state.loop.stage)) {
    throw new Error(`Native active status cannot use loop stage ${state.loop.stage}`);
  }
  if (state.archived !== (state.status === 'done')) {
    throw new Error('Native archived must be true exactly when status is done');
  }
  if (state.archived && state.phase !== 'archive') {
    throw new Error('Native archived state must be in Archive');
  }
  if (state.verification_result === 'pass') {
    if (state.verification?.verdict !== 'pass') {
      throw new Error('Native pass requires a persisted passing verification');
    }
    if (state.acceptance.some((entry) => entry.result !== 'passed')) {
      throw new Error('Native pass requires every acceptance item to pass');
    }
    if (state.verification.checks.some((check) => check.status !== 'passed')) {
      throw new Error('Native pass requires every persisted check to pass');
    }
  }
  if (state.verification?.assurance === 'semantic-verification-unavailable') {
    if (
      state.phase !== 'verify' ||
      state.status !== 'await-user' ||
      state.verification_result !== 'blocked' ||
      state.loop.next_action !== 'confirm-verifier-unavailable'
    ) {
      throw new Error(
        'Native unavailable semantic verification must await explicit user confirmation',
      );
    }
  }
  if (state.verification_report !== null && state.verification === null) {
    throw new Error('Native verification report requires persisted verification');
  }
}

export function parseNativePortableState(value: unknown): NativePortableState {
  const root = record(value, 'Native portable state');
  rejectUnknown(root, ROOT_KEYS, 'Native portable state');
  if (root.schema !== NATIVE_PORTABLE_STATE_SCHEMA) {
    throw new Error(`Native portable state schema must be ${NATIVE_PORTABLE_STATE_SCHEMA}`);
  }
  const name = stringValue(root.name, 'Native state name');
  if (!NAME_PATTERN.test(name)) throw new Error('Native state name is invalid');
  if (root.brief !== 'brief.md') throw new Error('Native state brief must be brief.md');
  const spec_changes = arrayValue(root.spec_changes, 'Native spec_changes', parseSpecChange);
  assertUnique(
    spec_changes.map((entry) => entry.capability),
    'Native spec change capabilities',
  );
  const acceptance = arrayValue(root.acceptance, 'Native acceptance', parseAcceptance);
  assertUnique(
    acceptance.map((entry) => entry.id),
    'Native acceptance IDs',
  );
  const history = arrayValue(root.history, 'Native history', parseHistoryEntry);
  if (history.length > NATIVE_PORTABLE_HISTORY_LIMIT) {
    throw new Error(`Native history cannot exceed ${NATIVE_PORTABLE_HISTORY_LIMIT} entries`);
  }
  const state: NativePortableState = {
    schema: NATIVE_PORTABLE_STATE_SCHEMA,
    name,
    language: enumValue(root.language, ['en', 'zh-CN'] as const, 'Native state language'),
    phase: enumValue(
      root.phase,
      ['shape', 'build', 'verify', 'archive'] as const,
      'Native state phase',
    ),
    status: enumValue(
      root.status,
      ['active', 'await-user', 'blocked', 'done'] as const,
      'Native state status',
    ),
    state_version: integerValue(root.state_version, 'Native state_version', 1),
    brief: 'brief.md',
    ...(root.children_contract_hash === undefined
      ? {}
      : {
          children_contract_hash: hashValue(
            root.children_contract_hash,
            'Native children contract hash',
          ),
        }),
    spec_changes,
    workspace: parseWorkspace(root.workspace),
    loop: parseLoop(root.loop),
    acceptance,
    builder_handoff:
      root.builder_handoff === null ? null : parseBuilderHandoff(root.builder_handoff),
    blockers: arrayValue(root.blockers, 'Native blockers', parseBlocker),
    verification: root.verification === null ? null : parseVerification(root.verification),
    history,
    history_overflow: parseHistoryOverflow(root.history_overflow),
    verification_result: enumValue(
      root.verification_result,
      ['pending', 'pass', 'fail', 'blocked'] as const,
      'Native verification_result',
    ),
    verification_report:
      root.verification_report === null
        ? null
        : enumValue(
            root.verification_report,
            ['verification.md'] as const,
            'Native verification_report',
          ),
    archived: booleanValue(root.archived, 'Native archived'),
    created_at: timestamp(root.created_at, 'Native created_at'),
  };
  assertReferences(state);
  assertLifecycle(state);
  return state;
}

export function createNativePortableState(options: {
  name: string;
  language: 'en' | 'zh-CN';
  workspace?: NativePortableWorkspace;
  createdAt?: string | Date;
  nextAction?: string | null;
}): NativePortableState {
  const createdAt =
    options.createdAt instanceof Date
      ? options.createdAt.toISOString()
      : (options.createdAt ?? new Date().toISOString());
  return parseNativePortableState({
    schema: NATIVE_PORTABLE_STATE_SCHEMA,
    name: options.name,
    language: options.language,
    phase: 'shape',
    status: 'active',
    state_version: 1,
    brief: 'brief.md',
    spec_changes: [],
    workspace: options.workspace ?? {
      isolation: 'current',
      change_branch: null,
      target_branch: null,
      finish: null,
    },
    loop: {
      stage: 'shape',
      goal_cycle: 1,
      iteration: 0,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: options.nextAction ?? null,
    },
    acceptance: [],
    builder_handoff: null,
    blockers: [],
    verification: null,
    history: [],
    history_overflow: emptyNativePortableHistoryOverflow(),
    verification_result: 'pending',
    verification_report: null,
    archived: false,
    created_at: createdAt,
  });
}

export function appendNativePortableHistory(
  state: NativePortableState,
  entry: NativePortableHistoryEntry,
): NativePortableState {
  const parsedState = parseNativePortableState(state);
  const parsedEntry = parseHistoryEntry(entry, parsedState.history.length);
  const history = [...parsedState.history, parsedEntry];
  const overflow: NativePortableHistoryOverflow = {
    ...parsedState.history_overflow,
    outcome_counts: { ...parsedState.history_overflow.outcome_counts },
  };
  while (history.length > NATIVE_PORTABLE_HISTORY_LIMIT) {
    const dropped = history.shift()!;
    overflow.dropped_entries += 1;
    overflow.first_dropped_at ??= dropped.completed_at;
    overflow.last_dropped_at = dropped.completed_at;
    overflow.outcome_counts[dropped.outcome] += 1;
  }
  return parseNativePortableState({ ...parsedState, history, history_overflow: overflow });
}

function parseYaml(source: string, label: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${label} is invalid YAML: ${document.errors[0].message}`);
  }
  return document.toJS({ mapAsMap: false });
}

export async function readNativePortableState(file: string): Promise<NativePortableState> {
  const source = await fs.readFile(file, 'utf8');
  return parseNativePortableState(parseYaml(source, 'Native portable state'));
}

export async function writeNativePortableState(
  file: string,
  state: NativePortableState,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  const parsed = parseNativePortableState(state);
  await atomicWriteText(file, stringify(parsed), options);
}

const stateWriteQueues = new Map<string, Promise<void>>();

async function serializeStateWrite<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = stateWriteQueues.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  stateWriteQueues.set(file, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (stateWriteQueues.get(file) === queued) stateWriteQueues.delete(file);
  }
}

/**
 * Compare and atomically replace a portable state document. Integration callers
 * still hold Native's project mutation lock so the same guarantee spans processes.
 */
export async function compareAndSwapNativePortableState(options: {
  file: string;
  expectedStateVersion: number;
  next: NativePortableState;
  containedRoot?: string;
}): Promise<NativePortableState> {
  return serializeStateWrite(options.file, async () => {
    const expected = integerValue(options.expectedStateVersion, 'Native expected state version', 1);
    const next = parseNativePortableState(options.next);
    if (next.state_version !== expected + 1) {
      throw new Error('Native CAS next state_version must increment exactly once');
    }
    const current = await readNativePortableState(options.file);
    if (
      current.state_version === next.state_version &&
      JSON.stringify(current) === JSON.stringify(next)
    ) {
      return current;
    }
    if (current.state_version !== expected) {
      throw new NativePortableStateVersionConflictError(expected, current.state_version);
    }
    await writeNativePortableState(options.file, next, {
      ...(options.containedRoot ? { containedRoot: options.containedRoot } : {}),
      beforeCommit: async () => {
        const latest = await readNativePortableState(options.file);
        if (latest.state_version !== expected) {
          throw new NativePortableStateVersionConflictError(expected, latest.state_version);
        }
      },
    });
    return next;
  });
}
