import { promises as fs, type Dirent } from 'fs';
import path from 'path';
import { parseDocument, stringify } from 'yaml';

import { atomicWriteText } from './native-atomic-file.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import type {
  NativeApproval,
  NativeChangeState,
  NativePhase,
  NativeProjectPaths,
  NativeSpecChange,
  NativeVerificationResult,
} from './native-types.js';

const CHANGE_KEYS = new Set([
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
]);
const SPEC_CHANGE_KEYS = new Set(['capability', 'operation', 'source', 'base_hash']);
const PHASES = new Set<NativePhase>(['shape', 'build', 'verify', 'archive']);
const APPROVALS = new Set<Exclude<NativeApproval, null>>(['implicit', 'confirmed']);
const VERIFY_RESULTS = new Set<NativeVerificationResult>(['pending', 'pass', 'fail']);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

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

export function parseNativeChangeValue(value: unknown): NativeChangeState {
  const root = record(value, 'change.yaml');
  rejectUnknown(root, CHANGE_KEYS, 'change.yaml');
  if (root.schema !== 'comet.native.v1') throw new Error('Unsupported Native change schema');
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
    schema: 'comet.native.v1',
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

export function nativeChangeDocument(state: NativeChangeState): Record<string, unknown> {
  const parsed = parseNativeChangeValue(state);
  return {
    schema: parsed.schema,
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
  try {
    await fs.mkdir(changeDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(options.paths.changesDir, { recursive: true });
      await fs.mkdir(changeDir, { recursive: false });
    } else if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Native change already exists: ${options.name}`, { cause: error });
    } else {
      throw error;
    }
  }
  const state: NativeChangeState = {
    schema: 'comet.native.v1',
    name: options.name,
    language: options.language,
    phase: 'shape',
    brief: 'brief.md',
    approval: null,
    spec_changes: [],
    verification_result: 'pending',
    verification_report: null,
    archived: false,
    created_at: (options.now ?? new Date()).toISOString().slice(0, 10),
    run_id: null,
  };
  await Promise.all([
    fs.mkdir(path.join(changeDir, 'specs'), { recursive: true }),
    fs.mkdir(path.join(changeDir, 'runtime', 'checkpoints'), { recursive: true }),
    atomicWriteText(path.join(changeDir, 'brief.md'), NATIVE_BRIEF_TEMPLATE),
  ]);
  await writeNativeChange(options.paths, state);
  return state;
}

export async function readNativeChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeState> {
  const file = path.join(nativeChangeDir(paths, name), 'change.yaml');
  await resolveContainedNativePath(paths.nativeRoot, file);
  const document = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid Native change ${name}: ${document.errors[0].message}`);
  }
  const parsed = parseNativeChangeValue(document.toJS());
  if (parsed.name !== name) throw new Error(`Native change directory/name mismatch: ${name}`);
  return parsed;
}

export async function writeNativeChange(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<void> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  const file = path.join(nativeChangeDir(paths, state.name), 'change.yaml');
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteText(file, stringify(nativeChangeDocument(state)));
}

export async function writeNativeChangeFile(file: string, state: NativeChangeState): Promise<void> {
  await atomicWriteText(file, stringify(nativeChangeDocument(state)));
}

export async function readNativeChangeFile(file: string): Promise<NativeChangeState> {
  const document = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid Native change file ${file}: ${document.errors[0].message}`);
  }
  return parseNativeChangeValue(document.toJS());
}

export async function listNativeChanges(paths: NativeProjectPaths): Promise<NativeChangeState[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
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
