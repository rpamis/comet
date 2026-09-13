import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { readNativeBoundedTextFile } from './native-bounded-file.js';
import type {
  NativePortableAcceptanceState,
  NativePortableState,
} from './native-portable-types.js';
export const NATIVE_CHILDREN_FILE = 'children.yaml';
export const NATIVE_CHILDREN_SCHEMA = 'comet.native.children.v1' as const;
export const NATIVE_CHILDREN_V2_SCHEMA = 'comet.native.children.v2' as const;
export const NATIVE_CHILDREN_SCHEMA_V2 = NATIVE_CHILDREN_V2_SCHEMA;

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ROOT_KEYS_V1 = new Set(['schema', 'children']);
const ROOT_KEYS_V2 = new Set(['schema', 'acceptance_index', 'children']);
const V1_CHILD_KEYS = new Set(['name', 'depends_on', 'covers']);
const V2_CHILD_KEYS = new Set(['name', 'summary', 'depends_on']);
const CHILD_KEYS = new Set(['name', 'depends_on', 'covers']);

type NativeChildrenContractVariant = 'v1' | 'summary-v2' | 'indexed-v2';

export interface NativeChildDefinition {
  name: string;
  summary: string | null;
  depends_on: string[];
  covers: string[];
}

export interface NativeChildAcceptanceIndexEntry {
  source: string;
  text: string;
}

export interface NativeChildrenContract {
  schema: typeof NATIVE_CHILDREN_SCHEMA | typeof NATIVE_CHILDREN_SCHEMA_V2;
  acceptance_index?: Record<string, NativeChildAcceptanceIndexEntry>;
  children: NativeChildDefinition[];
}

export interface NativeChildrenDocument {
  contract: NativeChildrenContract;
  hash: string;
  size: number;
  drift: NativeChildrenIndexDrift | null;
}

function record(value: unknown, label: string, hint = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object${hint}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  const missing = [...known].filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
      ...(unknown.length > 0 ? [`unexpected ${unknown.join(', ')}`] : []),
      `expected ${[...known].join(', ')}`,
    ];
    throw new Error(`${label} fields are invalid: ${details.join('; ')}`);
  }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...new Set(value)].sort((left, right) => left.localeCompare(right, 'en'));
}

function assertAcyclic(children: readonly NativeChildDefinition[]): void {
  const byName = new Map(children.map((child) => [child.name, child]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Native children dependency cycle includes ${name}`);
    visiting.add(name);
    for (const dependency of byName.get(name)!.depends_on) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const child of children) visit(child.name);
}

function validateCoverage(
  children: readonly NativeChildDefinition[],
  acceptanceIds: readonly string[],
  requiredAcceptanceIds: readonly string[] = acceptanceIds,
): void {
  const known = new Set(acceptanceIds);
  for (const child of children) {
    const unknown = child.covers.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Native child ${child.name} covers unknown acceptance: ${unknown.join(', ')}`,
      );
    }
  }
  const covered = new Set(children.flatMap((child) => child.covers));
  const missing = requiredAcceptanceIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(`Native children do not cover parent acceptance: ${missing.join(', ')}`);
  }
}

export function nativeChildrenIndexDrift(
  contract: NativeChildrenContract,
  acceptanceIds: readonly string[] | undefined,
  options: NativeChildrenValidationOptions,
): NativeChildrenIndexDrift | null {
  const drift: NativeChildrenIndexDrift = {
    missing: [],
    extra: [],
    mismatched: [],
    uncovered: [],
    unknownCovers: [],
  };
  if (contract.schema === NATIVE_CHILDREN_SCHEMA_V2 && contract.acceptance_index) {
    const required = options.requiredAcceptanceIds ?? acceptanceIds ?? [];
    const allowed = options.allowedAcceptanceIds ?? required;
    const indexKeys = Object.keys(contract.acceptance_index);
    drift.missing = required.filter((id) => !(id in contract.acceptance_index!));
    drift.extra = indexKeys.filter((id) => !allowed.includes(id));
    const catalog = new Map((options.acceptanceCatalog ?? []).map((entry) => [entry.id, entry]));
    for (const id of indexKeys) {
      const expected = catalog.get(id);
      const actual = contract.acceptance_index[id];
      if (
        expected &&
        actual &&
        (actual.source !== expected.source || actual.text !== expected.text)
      ) {
        drift.mismatched.push(id);
      }
    }
    const known = new Set(indexKeys);
    for (const child of contract.children) {
      drift.unknownCovers.push(...child.covers.filter((id) => !known.has(id)));
    }
    drift.uncovered = indexKeys.filter((id) => !coveredBy(contract.children, id));
    return hasDrift(drift) ? drift : null;
  }
  if (contract.schema === NATIVE_CHILDREN_SCHEMA && acceptanceIds) {
    const known = new Set(acceptanceIds);
    for (const child of contract.children) {
      drift.unknownCovers.push(...child.covers.filter((id) => !known.has(id)));
    }
    drift.uncovered = acceptanceIds.filter((id) => !coveredBy(contract.children, id));
    return hasDrift(drift) ? drift : null;
  }
  return null;
}

function coveredBy(children: readonly NativeChildDefinition[], id: string): boolean {
  return children.some((child) => child.covers.includes(id));
}

function hasDrift(drift: NativeChildrenIndexDrift): boolean {
  return (
    drift.missing.length > 0 ||
    drift.extra.length > 0 ||
    drift.mismatched.length > 0 ||
    drift.uncovered.length > 0 ||
    drift.unknownCovers.length > 0
  );
}

export interface NativeChildrenValidationOptions {
  acceptanceCatalog?: readonly Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>[];
  requiredAcceptanceIds?: readonly string[];
  allowedAcceptanceIds?: readonly string[];
  /**
   * Advisory parsing keeps the same structural checks but reports acceptance-index
   * drift through NativeChildrenDocument.drift instead of throwing, so read-only
   * projections can render a stale contract as "confirmation required".
   */
  policy?: 'strict' | 'advisory';
}

export interface NativeChildrenIndexDrift {
  missing: string[];
  extra: string[];
  mismatched: string[];
  uncovered: string[];
  unknownCovers: string[];
}

type NativeChildrenAcceptanceState = Pick<
  NativePortableState,
  'brief' | 'loop' | 'verification_result' | 'history'
> & {
  acceptance: readonly Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>[];
};

export function nativeChildrenAcceptanceValidation(
  state: NativeChildrenAcceptanceState,
): NativeChildrenValidationOptions {
  const currentAcceptanceIds = new Set(state.acceptance.map(({ id }) => id));
  const requiredAcceptanceIds = new Set(
    state.acceptance.filter(({ source }) => source === state.brief).map(({ id }) => id),
  );
  const allowedAcceptanceIds = new Set(requiredAcceptanceIds);
  for (const failure of state.history.filter(({ outcome }) => outcome === 'fail')) {
    for (const id of failure.unresolved_ids) {
      if (currentAcceptanceIds.has(id)) allowedAcceptanceIds.add(id);
    }
  }
  if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
    const latestFailure = [...state.history].reverse().find(({ outcome }) => outcome === 'fail');
    for (const id of latestFailure?.unresolved_ids ?? []) requiredAcceptanceIds.add(id);
  }
  return {
    acceptanceCatalog: state.acceptance,
    requiredAcceptanceIds: [...requiredAcceptanceIds],
    allowedAcceptanceIds: [...allowedAcceptanceIds],
  };
}

function parseAcceptanceIndex(value: unknown): Record<string, NativeChildAcceptanceIndexEntry> {
  const index = record(
    value,
    'Native children acceptance_index',
    ' keyed by acceptance ID, for example A1: { source: brief.md, text: "Full acceptance text" }',
  );
  const result: Record<string, NativeChildAcceptanceIndexEntry> = {};
  for (const [id, entry] of Object.entries(index)) {
    const item = record(entry, `Native children acceptance_index.${id}`);
    exactKeys(item, new Set(['source', 'text']), `Native children acceptance_index.${id}`);
    if (typeof item.source !== 'string' || item.source.length === 0) {
      throw new Error(`Native children acceptance_index.${id}.source must be a non-empty string`);
    }
    if (typeof item.text !== 'string' || item.text.length === 0) {
      throw new Error(`Native children acceptance_index.${id}.text must be a non-empty string`);
    }
    result[id] = { source: item.source, text: item.text };
  }
  return result;
}

function validateAcceptanceIndex(
  index: Record<string, NativeChildAcceptanceIndexEntry>,
  acceptanceIds: readonly string[] | undefined,
  options: NativeChildrenValidationOptions,
): void {
  const required = options.requiredAcceptanceIds ?? acceptanceIds ?? [];
  const allowed = options.allowedAcceptanceIds ?? required;
  const actual = Object.keys(index);
  const missing = required.filter((id) => !(id in index));
  const extra = actual.filter((id) => !allowed.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Native children acceptance_index must match the required acceptance: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`,
    );
  }
  const catalog = new Map((options.acceptanceCatalog ?? []).map((entry) => [entry.id, entry]));
  for (const id of actual) {
    const expected = catalog.get(id);
    if (!expected) continue;
    const actualEntry = index[id];
    if (actualEntry.source !== expected.source || actualEntry.text !== expected.text) {
      const mismatched = (['source', 'text'] as const).filter(
        (key) => actualEntry[key] !== expected[key],
      );
      throw new Error(
        `Native children acceptance_index.${id} does not match the acceptance catalog: copy ${mismatched.join(', ')} exactly from the current acceptance catalog`,
      );
    }
  }
}

export function parseNativeChildrenContract(
  source: string,
  acceptanceIds?: readonly string[],
  options: NativeChildrenValidationOptions = {},
): NativeChildrenContract {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Native children contract is invalid YAML: ${document.errors[0].message}`);
  }
  const root = record(document.toJS({ mapAsMap: false }), 'Native children contract');
  const schema = root.schema;
  if (schema !== NATIVE_CHILDREN_SCHEMA && schema !== NATIVE_CHILDREN_V2_SCHEMA) {
    exactKeys(root, ROOT_KEYS_V1, 'Native children contract');
    throw new Error(
      `Native children schema must be ${NATIVE_CHILDREN_SCHEMA} or ${NATIVE_CHILDREN_V2_SCHEMA}`,
    );
  }
  const variant: NativeChildrenContractVariant =
    schema === NATIVE_CHILDREN_SCHEMA
      ? 'v1'
      : 'acceptance_index' in root
        ? 'indexed-v2'
        : 'summary-v2';
  const variantLabel = variant.replace('-', ' ');
  exactKeys(
    root,
    variant === 'indexed-v2' ? ROOT_KEYS_V2 : ROOT_KEYS_V1,
    'Native children contract',
  );
  if (!Array.isArray(root.children) || root.children.length === 0) {
    throw new Error('Native children must be a non-empty array');
  }
  const children = root.children.map((entry, index): NativeChildDefinition => {
    const child = record(entry, `Native child ${index}`);
    exactKeys(
      child,
      variant === 'indexed-v2'
        ? CHILD_KEYS
        : variant === 'summary-v2'
          ? V2_CHILD_KEYS
          : V1_CHILD_KEYS,
      `Native ${variantLabel} child fields (child ${index})`,
    );
    if (typeof child.name !== 'string' || !NAME_PATTERN.test(child.name)) {
      throw new Error(`Native child ${index} name is invalid`);
    }
    const readableV2 = variant === 'summary-v2';
    if (readableV2) {
      if (typeof child.summary !== 'string' || child.summary.trim().length === 0) {
        throw new Error(`Native child ${child.name} summary must be a non-empty string`);
      }
      if (child.summary.length > 2_000) {
        throw new Error(`Native child ${child.name} summary exceeds 2000 characters`);
      }
    }
    return {
      name: child.name,
      summary: readableV2 ? (child.summary as string) : null,
      depends_on: stringList(child.depends_on, `Native child ${child.name} depends_on`),
      covers:
        variant === 'indexed-v2' || variant === 'v1'
          ? stringList(child.covers, `Native child ${child.name} covers`)
          : [],
    };
  });
  const names = children.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error('Native child names must be unique');
  const known = new Set(names);
  for (const child of children) {
    const missing = child.depends_on.filter((dependency) => !known.has(dependency));
    if (missing.length > 0) {
      throw new Error(`Native child ${child.name} depends on unknown child: ${missing.join(', ')}`);
    }
  }
  assertAcyclic(children);
  const advisory = options.policy === 'advisory';
  if (schema === NATIVE_CHILDREN_SCHEMA_V2) {
    if (variant === 'indexed-v2') {
      const acceptanceIndex = parseAcceptanceIndex(root.acceptance_index);
      if (!advisory) validateAcceptanceIndex(acceptanceIndex, acceptanceIds, options);
      const indexedAcceptanceIds = Object.keys(acceptanceIndex);
      if (!advisory) validateCoverage(children, indexedAcceptanceIds, indexedAcceptanceIds);
      return { schema: NATIVE_CHILDREN_V2_SCHEMA, acceptance_index: acceptanceIndex, children };
    }
    return { schema: NATIVE_CHILDREN_V2_SCHEMA, children };
  }
  if (acceptanceIds && !advisory) validateCoverage(children, acceptanceIds);
  return { schema: NATIVE_CHILDREN_SCHEMA, children };
}

export async function readNativeChildrenContract(options: {
  changeDir: string;
  acceptanceIds?: readonly string[];
  validation?: NativeChildrenValidationOptions;
  policy?: 'strict' | 'advisory';
}): Promise<NativeChildrenDocument | null> {
  const file = path.join(options.changeDir, NATIVE_CHILDREN_FILE);
  try {
    await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const source = await readNativeBoundedTextFile({
    root: options.changeDir,
    ref: NATIVE_CHILDREN_FILE,
  });
  const advisory = options.policy === 'advisory';
  const validation: NativeChildrenValidationOptions = advisory
    ? { ...options.validation, policy: 'advisory' }
    : (options.validation ?? {});
  const contract = parseNativeChildrenContract(source.text, options.acceptanceIds, validation);
  return {
    contract,
    hash: source.hash,
    size: source.size,
    drift: advisory
      ? nativeChildrenIndexDrift(contract, options.acceptanceIds, options.validation ?? {})
      : null,
  };
}
