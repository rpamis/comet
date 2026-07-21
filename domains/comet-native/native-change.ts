import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument, stringify } from 'yaml';

import { readNativeBoundedTextFile } from './native-bounded-file.js';

import { atomicWriteText } from './native-atomic-file.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedDirectory } from './native-protected-file.js';
import { compareAndSwapNativeRevision } from './native-revision.js';
import {
  createNativeContentSnapshot,
  inspectNativeContentSnapshotHealth,
  writeNativeBaselineManifest,
} from './native-snapshot.js';
import { assertNativeTrajectoryHealthy } from './native-trajectory-recovery.js';
import { writeNativeWorkspaceIdentity } from './native-workspace.js';
import type {
  NativeApproval,
  NativeChangeSchemaInspection,
  NativeChangeState,
  NativeContentAddressedRef,
  NativeLegacyChangeState,
  NativePhase,
  NativeProjectPaths,
  NativeSpecChange,
  NativeVerificationResult,
  NativeV2ChangeState,
} from './native-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_V2_CHANGE_SCHEMA,
} from './native-types.js';

const CHANGE_KEYS = [
  'schema',
  'name',
  'language',
  'phase',
  'brief',
  'approval',
  'spec_changes',
  'verification_result',
  'verification_report',
  'archived',
  'created_at',
  'run_id',
] as const;
const LEGACY_CHANGE_KEYS = new Set<string>(CHANGE_KEYS);
const V2_CHANGE_KEYS = new Set<string>([...CHANGE_KEYS, 'minimum_runtime_version', 'revision']);
const CURRENT_CHANGE_KEYS = new Set<string>([
  ...V2_CHANGE_KEYS,
  'approved_contract_hash',
  'implementation_scope',
  'verification_evidence',
  'partial_allowance',
]);
const SPEC_CHANGE_KEYS = new Set(['capability', 'operation', 'source', 'base_hash']);
const PHASES = new Set<NativePhase>(['shape', 'build', 'verify', 'archive']);
const APPROVALS = new Set<Exclude<NativeApproval, null>>(['implicit', 'confirmed']);
const VERIFY_RESULTS = new Set<NativeVerificationResult>(['pending', 'pass', 'fail']);

export const NATIVE_CHANGE_STATE_FILE = 'comet-state.yaml';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CONTENT_ADDRESSED_REF_PATTERN =
  /^runtime\/evidence\/(scopes|allowances|verifications)\/([a-f0-9]{64})\.json$/u;

export class NativeSchemaMigrationRequiredError extends Error {
  readonly code = 'native-schema-migration-required';

  constructor(
    readonly change: string,
    readonly schema: string,
  ) {
    super(
      `Native change ${change} uses ${schema}; run comet native doctor ${change} --repair before mutating it`,
    );
    this.name = 'NativeSchemaMigrationRequiredError';
  }
}

export class NativeRuntimeCompatibilityError extends Error {
  readonly code = 'native-runtime-incompatible';

  constructor(
    readonly schema: string,
    readonly minimumRuntimeVersion: number | null,
  ) {
    super(
      schema !== NATIVE_CHANGE_SCHEMA || minimumRuntimeVersion === null
        ? `Unsupported Native change schema ${schema} for runtime protocol ${NATIVE_RUNTIME_PROTOCOL_VERSION}`
        : `Native change ${schema} requires runtime protocol ${minimumRuntimeVersion}; current protocol is ${NATIVE_RUNTIME_PROTOCOL_VERSION}`,
    );
    this.name = 'NativeRuntimeCompatibilityError';
  }
}

export class NativeChangeRevisionConflictError extends Error {
  readonly code = 'native-change-revision-conflict';

  constructor(
    readonly change: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Native change ${change} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`,
    );
    this.name = 'NativeChangeRevisionConflictError';
  }
}

export class NativeBaselineIncompleteError extends Error {
  readonly code = 'native-baseline-incomplete';

  constructor(
    readonly change: string,
    readonly omittedCount: number,
    readonly omittedByReason: Record<string, number>,
    readonly samplePaths: string[],
    readonly sampleTruncated: boolean,
  ) {
    super(
      `Native change ${change} baseline is incomplete (${omittedCount} omitted entr${omittedCount === 1 ? 'y' : 'ies'})`,
    );
    this.name = 'NativeBaselineIncompleteError';
  }
}

export const NATIVE_BRIEF_TEMPLATE = [
  '# Outcome',
  '',
  '# Scope',
  '',
  '# Non-goals',
  '',
  '# Acceptance examples',
  '',
  '# Constraints and invariants',
  '',
  '# Decisions',
  '',
  '# Open questions',
  '',
  '# Verification expectations',
  '',
].join('\n');

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, known: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

export function assertNativeName(value: string): void {
  if (!NAME_PATTERN.test(value)) throw new Error(`Invalid Native change name: ${value}`);
}

export function assertCapabilityId(value: string): void {
  if (!NAME_PATTERN.test(value)) throw new Error(`Invalid Native capability id: ${value}`);
}

function assertRelativeRef(value: string, label: string): void {
  if (
    value.length === 0 ||
    path.isAbsolute(value) ||
    /^(?:[A-Za-z]:|~|[\\/])/u.test(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} must stay inside the Native change`);
  }
}

function parseSpecChange(value: unknown, index: number): NativeSpecChange {
  const item = record(value, `spec_changes[${index}]`);
  rejectUnknown(item, SPEC_CHANGE_KEYS, `spec_changes[${index}]`);
  if (typeof item.capability !== 'string') throw new Error('spec change capability is required');
  assertCapabilityId(item.capability);
  if (item.operation !== 'create' && item.operation !== 'replace' && item.operation !== 'remove') {
    throw new Error(`Invalid spec operation for ${item.capability}`);
  }
  const source = item.source;
  const baseHash = item.base_hash;
  if (source !== undefined && typeof source !== 'string') {
    throw new Error(`Spec source for ${item.capability} must be a string`);
  }
  if (typeof source === 'string') assertRelativeRef(source, `Spec source for ${item.capability}`);
  if (item.operation === 'create') {
    if (!source) throw new Error(`Create spec ${item.capability} requires source`);
    if (baseHash !== null)
      throw new Error(`Create spec ${item.capability} requires null base_hash`);
  } else if (item.operation === 'replace') {
    if (!source) throw new Error(`Replace spec ${item.capability} requires source`);
    if (typeof baseHash !== 'string' || !HASH_PATTERN.test(baseHash)) {
      throw new Error(`Replace spec ${item.capability} requires a SHA-256 base_hash`);
    }
  } else {
    if (source !== undefined) throw new Error(`Remove spec ${item.capability} forbids source`);
    if (typeof baseHash !== 'string' || !HASH_PATTERN.test(baseHash)) {
      throw new Error(`Remove spec ${item.capability} requires a SHA-256 base_hash`);
    }
  }
  return {
    capability: item.capability,
    operation: item.operation,
    ...(typeof source === 'string' ? { source } : {}),
    base_hash: baseHash as string | null,
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

type ParsedChangeFields = Omit<NativeLegacyChangeState, 'schema'>;

function parseChangeFields(
  root: Record<string, unknown>,
  knownKeys: Set<string>,
): ParsedChangeFields {
  rejectUnknown(root, knownKeys, NATIVE_CHANGE_STATE_FILE);
  if (typeof root.name !== 'string') throw new Error('Native change name is required');
  assertNativeName(root.name);
  if (root.language !== 'en' && root.language !== 'zh-CN') {
    throw new Error('Native change language must be en or zh-CN');
  }
  if (typeof root.phase !== 'string' || !PHASES.has(root.phase as NativePhase)) {
    throw new Error('Native change phase is invalid');
  }
  if (root.brief !== 'brief.md') throw new Error('Native change brief must be brief.md');
  if (root.approval !== null && !APPROVALS.has(root.approval as Exclude<NativeApproval, null>)) {
    throw new Error('Native change approval is invalid');
  }
  if (!Array.isArray(root.spec_changes)) throw new Error('Native spec_changes must be an array');
  const specChanges = root.spec_changes.map(parseSpecChange);
  const duplicates = specChanges
    .map((change) => change.capability)
    .filter((capability, index, all) => all.indexOf(capability) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate Native capability operation: ${[...new Set(duplicates)].join(', ')}`,
    );
  }
  if (
    typeof root.verification_result !== 'string' ||
    !VERIFY_RESULTS.has(root.verification_result as NativeVerificationResult)
  ) {
    throw new Error('Native verification_result is invalid');
  }
  if (root.verification_report !== null && typeof root.verification_report !== 'string') {
    throw new Error('Native verification_report must be a string or null');
  }
  if (typeof root.verification_report === 'string') {
    assertRelativeRef(root.verification_report, 'Native verification_report');
  }
  if (typeof root.archived !== 'boolean') throw new Error('Native archived must be boolean');
  if (typeof root.created_at !== 'string' || !validDate(root.created_at)) {
    throw new Error('Native created_at must be a valid YYYY-MM-DD date');
  }
  if (root.run_id !== null && (typeof root.run_id !== 'string' || root.run_id.length === 0)) {
    throw new Error('Native run_id must be a non-empty string or null');
  }
  return {
    name: root.name,
    language: root.language,
    phase: root.phase as NativePhase,
    brief: 'brief.md',
    approval: root.approval as NativeApproval,
    spec_changes: specChanges,
    verification_result: root.verification_result as NativeVerificationResult,
    verification_report: root.verification_report as string | null,
    archived: root.archived,
    created_at: root.created_at,
    run_id: root.run_id as string | null,
  };
}

export function parseLegacyNativeChangeValue(value: unknown): NativeLegacyChangeState {
  const root = record(value, NATIVE_CHANGE_STATE_FILE);
  if (root.schema !== NATIVE_LEGACY_CHANGE_SCHEMA) {
    throw new Error(`Expected ${NATIVE_LEGACY_CHANGE_SCHEMA}`);
  }
  return {
    schema: NATIVE_LEGACY_CHANGE_SCHEMA,
    ...parseChangeFields(root, LEGACY_CHANGE_KEYS),
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function contentAddressedRef(
  value: unknown,
  label: string,
  kind: 'scopes' | 'allowances' | 'verifications',
): NativeContentAddressedRef | null {
  if (value === null) return null;
  const match = typeof value === 'string' ? CONTENT_ADDRESSED_REF_PATTERN.exec(value) : null;
  if (!match || match[1] !== kind) {
    throw new Error(
      `${label} must be null or runtime/evidence/${kind}/<sha256>.json relative to the Native change`,
    );
  }
  return value as NativeContentAddressedRef;
}

function approvedContractHash(value: unknown): string | null {
  // Early v3 files predate approval binding. Treat the absent field as an
  // unbound approval so status/transition guards can require confirmation.
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error('Native approved_contract_hash must be null or a SHA-256 hash');
  }
  return value;
}

export function parseV2NativeChangeValue(value: unknown): NativeV2ChangeState {
  const root = record(value, NATIVE_CHANGE_STATE_FILE);
  if (root.schema !== NATIVE_V2_CHANGE_SCHEMA) {
    throw new Error(`Expected ${NATIVE_V2_CHANGE_SCHEMA}`);
  }
  const minimumRuntimeVersion = positiveInteger(
    root.minimum_runtime_version,
    'Native v2 minimum_runtime_version',
  );
  if (minimumRuntimeVersion !== 2) {
    throw new Error(`Native ${NATIVE_V2_CHANGE_SCHEMA} minimum_runtime_version must be 2`);
  }
  return {
    schema: NATIVE_V2_CHANGE_SCHEMA,
    minimum_runtime_version: 2,
    revision: positiveInteger(root.revision, 'Native v2 revision'),
    ...parseChangeFields(root, V2_CHANGE_KEYS),
  };
}

export function parseNativeChangeValue(value: unknown): NativeChangeState {
  const root = record(value, NATIVE_CHANGE_STATE_FILE);
  if (root.schema !== NATIVE_CHANGE_SCHEMA) {
    if (root.schema === NATIVE_LEGACY_CHANGE_SCHEMA || root.schema === NATIVE_V2_CHANGE_SCHEMA) {
      const previous =
        root.schema === NATIVE_LEGACY_CHANGE_SCHEMA
          ? parseLegacyNativeChangeValue(root)
          : parseV2NativeChangeValue(root);
      throw new NativeSchemaMigrationRequiredError(previous.name, previous.schema);
    }
    throw new NativeRuntimeCompatibilityError(
      typeof root.schema === 'string' ? root.schema : '(missing)',
      typeof root.minimum_runtime_version === 'number' ? root.minimum_runtime_version : null,
    );
  }
  const minimumRuntimeVersion = positiveInteger(
    root.minimum_runtime_version,
    'Native minimum_runtime_version',
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new NativeRuntimeCompatibilityError(root.schema, minimumRuntimeVersion);
  }
  if (minimumRuntimeVersion !== NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native ${root.schema} minimum_runtime_version must be ${NATIVE_RUNTIME_PROTOCOL_VERSION}`,
    );
  }
  const revision = positiveInteger(root.revision, 'Native revision');
  const fields = parseChangeFields(root, CURRENT_CHANGE_KEYS);
  const approvalHash = approvedContractHash(root.approved_contract_hash);
  if (fields.approval === null && approvalHash !== null) {
    throw new Error('Native approved_contract_hash requires an approval');
  }
  return {
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
    ...fields,
    approved_contract_hash: approvalHash,
    implementation_scope: contentAddressedRef(
      root.implementation_scope,
      'Native implementation_scope',
      'scopes',
    ),
    verification_evidence: contentAddressedRef(
      root.verification_evidence,
      'Native verification_evidence',
      'verifications',
    ),
    partial_allowance: contentAddressedRef(
      root.partial_allowance,
      'Native partial_allowance',
      'allowances',
    ),
  };
}

export function inspectNativeChangeValue(value: unknown): NativeChangeSchemaInspection {
  const root = record(value, NATIVE_CHANGE_STATE_FILE);
  if (root.schema === NATIVE_LEGACY_CHANGE_SCHEMA) {
    const state = parseLegacyNativeChangeValue(root);
    return {
      status: 'migration-required',
      schema: state.schema,
      minimumRuntimeVersion: 1,
      state,
      message: `Native change ${state.name} requires migration to ${NATIVE_CHANGE_SCHEMA}`,
    };
  }
  if (root.schema === NATIVE_V2_CHANGE_SCHEMA) {
    const state = parseV2NativeChangeValue(root);
    return {
      status: 'migration-required',
      schema: state.schema,
      minimumRuntimeVersion: state.minimum_runtime_version,
      state,
      message: `Native change ${state.name} requires migration to ${NATIVE_CHANGE_SCHEMA}`,
    };
  }
  if (root.schema !== NATIVE_CHANGE_SCHEMA) {
    const minimumRuntimeVersion =
      typeof root.minimum_runtime_version === 'number' &&
      Number.isSafeInteger(root.minimum_runtime_version)
        ? root.minimum_runtime_version
        : null;
    return {
      status: 'runtime-incompatible',
      schema: typeof root.schema === 'string' ? root.schema : '(missing)',
      minimumRuntimeVersion,
      state: null,
      message: new NativeRuntimeCompatibilityError(
        typeof root.schema === 'string' ? root.schema : '(missing)',
        minimumRuntimeVersion,
      ).message,
    };
  }
  const minimumRuntimeVersion = positiveInteger(
    root.minimum_runtime_version,
    'Native minimum_runtime_version',
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    return {
      status: 'runtime-incompatible',
      schema: root.schema,
      minimumRuntimeVersion,
      state: null,
      message: new NativeRuntimeCompatibilityError(root.schema, minimumRuntimeVersion).message,
    };
  }
  const state = parseNativeChangeValue(root);
  return {
    status: 'current',
    schema: state.schema,
    minimumRuntimeVersion: state.minimum_runtime_version,
    state,
  };
}

export function nativeChangeDocument(state: NativeChangeState): Record<string, unknown> {
  const parsed = parseNativeChangeValue(state);
  return {
    schema: parsed.schema,
    minimum_runtime_version: parsed.minimum_runtime_version,
    revision: parsed.revision,
    name: parsed.name,
    language: parsed.language,
    phase: parsed.phase,
    brief: parsed.brief,
    approval: parsed.approval,
    approved_contract_hash: parsed.approved_contract_hash ?? null,
    spec_changes: parsed.spec_changes.map((change) => ({
      capability: change.capability,
      operation: change.operation,
      ...(change.source ? { source: change.source } : {}),
      base_hash: change.base_hash,
    })),
    verification_result: parsed.verification_result,
    verification_report: parsed.verification_report,
    implementation_scope: parsed.implementation_scope,
    verification_evidence: parsed.verification_evidence,
    partial_allowance: parsed.partial_allowance,
    archived: parsed.archived,
    created_at: parsed.created_at,
    run_id: parsed.run_id,
  };
}

export function nativeV2ChangeDocument(state: NativeV2ChangeState): Record<string, unknown> {
  const parsed = parseV2NativeChangeValue(state);
  return {
    schema: parsed.schema,
    minimum_runtime_version: parsed.minimum_runtime_version,
    revision: parsed.revision,
    name: parsed.name,
    language: parsed.language,
    phase: parsed.phase,
    brief: parsed.brief,
    approval: parsed.approval,
    spec_changes: parsed.spec_changes.map((change) => ({
      capability: change.capability,
      operation: change.operation,
      ...(change.source ? { source: change.source } : {}),
      base_hash: change.base_hash,
    })),
    verification_result: parsed.verification_result,
    verification_report: parsed.verification_report,
    archived: parsed.archived,
    created_at: parsed.created_at,
    run_id: parsed.run_id,
  };
}

export function nativeChangeDir(paths: NativeProjectPaths, name: string): string {
  assertNativeName(name);
  const target = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, target)) throw new Error('Native change path escaped');
  return target;
}

export async function hasPendingNativeSchemaMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const file = path.join(nativeChangeDir(paths, name), 'runtime', 'schema-migration.json');
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function hasPendingNativeCheckpointRecovery(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const file = path.join(nativeChangeDir(paths, name), 'runtime', 'checkpoint-journal.json');
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function createNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  now?: Date;
}): Promise<NativeChangeState> {
  return withNativeMutationLock(options.paths, `create change ${options.name}`, () =>
    createNativeChangeLocked(options),
  );
}

async function createNativeChangeLocked(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  now?: Date;
}): Promise<NativeChangeState> {
  assertNativeName(options.name);
  const changeDir = nativeChangeDir(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, changeDir);
  let createdChangeDir = false;
  try {
    try {
      await fs.mkdir(changeDir, { recursive: false });
      createdChangeDir = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(options.paths.changesDir, { recursive: true });
        try {
          await fs.mkdir(changeDir, { recursive: false });
          createdChangeDir = true;
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`Native change already exists: ${options.name}`, {
              cause: retryError,
            });
          }
          throw retryError;
        }
      } else if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Native change already exists: ${options.name}`, { cause: error });
      } else {
        throw error;
      }
    }
    const state: NativeChangeState = {
      schema: NATIVE_CHANGE_SCHEMA,
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
      revision: 1,
      name: options.name,
      language: options.language,
      phase: 'shape',
      brief: 'brief.md',
      approval: null,
      approved_contract_hash: null,
      spec_changes: [],
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
      archived: false,
      created_at: (options.now ?? new Date()).toISOString().slice(0, 10),
      run_id: null,
    };
    await Promise.all([
      fs.mkdir(path.join(changeDir, 'specs'), { recursive: true }),
      fs.mkdir(path.join(changeDir, 'runtime', 'checkpoints'), { recursive: true }),
      atomicWriteText(path.join(changeDir, 'brief.md'), NATIVE_BRIEF_TEMPLATE),
    ]);
    const baseline = await createNativeContentSnapshot(options.paths, {
      now: options.now,
      origin: 'change-created',
    });
    if (!baseline.complete) {
      const health = inspectNativeContentSnapshotHealth(baseline);
      const omittedByReason = baseline.omitted.reduce<Record<string, number>>((counts, item) => {
        counts[item.reason] = (counts[item.reason] ?? 0) + 1;
        return counts;
      }, {});
      const overflowCount = baseline.omissionOverflow?.count ?? 0;
      if (overflowCount > 0) omittedByReason.overflow = overflowCount;
      throw new NativeBaselineIncompleteError(
        state.name,
        baseline.omittedCount,
        omittedByReason,
        health.samplePaths,
        health.sampleTruncated,
      );
    }
    await writeNativeBaselineManifest(options.paths, state.name, baseline);
    await createNativeChangeFile(options.paths, state);
    await writeNativeWorkspaceIdentity({
      paths: options.paths,
      name: state.name,
      revision: state.revision,
      now: options.now,
    });
    return state;
  } catch (error) {
    if (createdChangeDir) await fs.rm(changeDir, { recursive: true, force: true });
    throw error;
  }
}

export const NATIVE_CHANGE_DOCUMENT_MAX_BYTES = 256 * 1024;

async function readChangeDocumentFile(file: string, root = path.dirname(file)): Promise<unknown> {
  const ref = path.relative(root, file).split(path.sep).join('/');
  const source = await readNativeBoundedTextFile({
    root,
    ref,
    maxBytes: NATIVE_CHANGE_DOCUMENT_MAX_BYTES,
  });
  const document = parseDocument(source.text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid Native change file ${file}: ${document.errors[0].message}`);
  }
  return document.toJS();
}

export async function inspectNativeChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeSchemaInspection> {
  const file = path.join(nativeChangeDir(paths, name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const inspection = inspectNativeChangeValue(await readChangeDocumentFile(file, paths.nativeRoot));
  if (inspection.state && inspection.state.name !== name) {
    throw new Error(`Native change directory/name mismatch: ${name}`);
  }
  if (await hasPendingNativeSchemaMigration(paths, name)) {
    return {
      status: 'migration-required',
      schema: inspection.schema,
      minimumRuntimeVersion: inspection.minimumRuntimeVersion,
      state: inspection.state,
      message: `Native schema migration is incomplete for ${name}; run doctor --repair`,
    };
  }
  return inspection;
}

export async function readNativeChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeState> {
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status === 'migration-required') {
    throw new NativeSchemaMigrationRequiredError(name, inspection.schema);
  }
  if (inspection.status === 'runtime-incompatible' || !inspection.state) {
    throw new NativeRuntimeCompatibilityError(inspection.schema, inspection.minimumRuntimeVersion);
  }
  return inspection.state as NativeChangeState;
}

export async function writeNativeChange(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeChangeState> {
  return compareAndSwapNativeChange(paths, state, state.revision);
}

async function createNativeChangeFile(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<void> {
  const file = path.join(nativeChangeDir(paths, state.name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs.access(file);
    throw new Error(`Native change state already exists: ${state.name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (state.revision !== 1) throw new Error('New Native change must start at revision 1');
  await atomicWriteText(file, stringify(nativeChangeDocument(state)));
}

export async function compareAndSwapNativeChangeFile(
  file: string,
  state: NativeChangeState,
  expectedRevision: number,
): Promise<NativeChangeState> {
  const next = {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: expectedRevision + 1,
  } satisfies NativeChangeState;
  const result = await compareAndSwapNativeRevision({
    expectedRevision,
    next,
    read: async () => {
      const current = parseNativeChangeValue(await readChangeDocumentFile(file));
      if (current.name !== state.name) {
        throw new Error(`Native change file/name mismatch: ${state.name}`);
      }
      return current;
    },
    write: (value) => atomicWriteText(file, stringify(nativeChangeDocument(value))),
    equals: (left, right) =>
      JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right)),
    conflict: (actualRevision) =>
      new NativeChangeRevisionConflictError(state.name, expectedRevision, actualRevision),
  });
  Object.assign(state, result);
  return result;
}

export async function compareAndSwapNativeChangeLocked(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  expectedRevision: number,
  options?: { allowPendingCheckpointRecovery?: boolean },
): Promise<NativeChangeState> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  if (await hasPendingNativeSchemaMigration(paths, state.name)) {
    throw new NativeSchemaMigrationRequiredError(state.name, state.schema);
  }
  if (
    !options?.allowPendingCheckpointRecovery &&
    (await hasPendingNativeCheckpointRecovery(paths, state.name))
  ) {
    throw new Error(
      `Native progress checkpoint recovery is required for ${state.name} before another state write`,
    );
  }
  await assertNativeTrajectoryHealthy(paths, state.name);
  const file = path.join(nativeChangeDir(paths, state.name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  return compareAndSwapNativeChangeFile(file, state, expectedRevision);
}

export async function compareAndSwapNativeChange(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  expectedRevision: number,
): Promise<NativeChangeState> {
  return withNativeMutationLock(paths, `write change ${state.name}`, () =>
    compareAndSwapNativeChangeLocked(paths, state, expectedRevision),
  );
}

export async function writeNativeChangeFile(
  file: string,
  state: NativeChangeState,
): Promise<NativeChangeState> {
  return compareAndSwapNativeChangeFile(file, state, state.revision);
}

export async function readNativeChangeFile(file: string): Promise<NativeChangeState> {
  return parseNativeChangeValue(await readChangeDocumentFile(file));
}

export async function listNativeChanges(paths: NativeProjectPaths): Promise<NativeChangeState[]> {
  let entries;
  try {
    const directory = await readNativeProtectedDirectory({
      root: paths.nativeRoot,
      directory: paths.changesDir,
      label: 'Native changes directory',
      maxEntries: 4_096,
    });
    await directory.verify();
    entries = directory.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => readNativeChange(paths, name)));
}
