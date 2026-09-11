import { createHash } from 'node:crypto';

import { parseDocument, stringify } from 'yaml';

export const NATIVE_DELTA_SCHEMA = 'comet.native.delta.v1' as const;
export const NATIVE_DELTA_FILE = 'delta.yaml' as const;

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REQUIREMENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/iu;
const MAX_BASE_REQUIREMENTS = 512;

export type NativeDeltaOperationKind = 'add' | 'modify' | 'remove' | 'rename';

export interface NativeDeltaOperation {
  readonly id: string;
  readonly operation: NativeDeltaOperationKind;
  readonly to_id?: string;
  readonly title?: string;
  readonly body?: string;
  /** Hash of the addressed total-Spec requirement before this delta. */
  readonly expected_hash?: string;
}

export interface NativeDeltaDocument {
  readonly schema: typeof NATIVE_DELTA_SCHEMA;
  /** Stable capability identity; it is intentionally independent of change name. */
  readonly capability: string;
  readonly base_hash: string;
  readonly base_version: number;
  /** Hash of content outside managed Requirement sections for legacy migration safety. */
  readonly legacy_hash?: string;
  /** Complete requirement hash snapshot used to detect uncertain cross-requirement impact. */
  readonly base_requirements?: Readonly<Record<string, string>>;
  /** Explicit proof for requirements known to be independent of this delta. */
  readonly independent_requirements?: Readonly<Record<string, string | null>>;
  readonly operations: readonly NativeDeltaOperation[];
}

export interface NativeDeltaApplyResult {
  readonly markdown: string;
  readonly base_hash: string;
  readonly result_hash: string;
  readonly rebased: boolean;
  readonly changedRequirementIds: readonly string[];
  readonly operationResults: readonly NativeDeltaOperationResult[];
}

export interface NativeDeltaOperationResult {
  readonly id: string;
  readonly operation: NativeDeltaOperationKind;
  readonly status: 'changed' | 'already-applied';
  readonly targetIds: readonly string[];
}

export class NativeDeltaValidationError extends Error {
  readonly code = 'native-delta-invalid';

  constructor(message: string) {
    super(message);
    this.name = 'NativeDeltaValidationError';
  }
}

export class NativeDeltaConflictError extends Error {
  readonly code = 'native-delta-conflict';
  readonly conflictIds: readonly string[];

  constructor(conflictIds: readonly string[], message: string) {
    super(message);
    this.name = 'NativeDeltaConflictError';
    this.conflictIds = [...new Set(conflictIds)];
  }
}

interface NativeRequirement {
  readonly id: string;
  readonly level: number;
  readonly title: string;
  readonly body: string;
  readonly raw: string;
  readonly startLine: number;
  readonly endLine: number;
}

interface ParsedNativeSpec {
  readonly text: string;
  readonly lines: readonly string[];
  readonly requirements: ReadonlyMap<string, NativeRequirement>;
  readonly legacyText: string;
}

interface RequirementMarker {
  readonly line: number;
  readonly level: number;
  readonly id: string;
  readonly title: string;
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function hashText(value: string): string {
  return createHash('sha256').update(normalizeLineEndings(value)).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeDeltaValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new NativeDeltaValidationError(`${label} has unknown field(s): ${unknown.join(', ')}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new NativeDeltaValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new NativeDeltaValidationError(`${label} must be text`);
  }
  return normalizeLineEndings(value).replace(/^\n+|\n+$/gu, '');
}

function hashValue(value: unknown, label: string): string {
  const result = requiredString(value, label).toLowerCase();
  if (!HASH_PATTERN.test(result)) {
    throw new NativeDeltaValidationError(`${label} must be a SHA-256 hash`);
  }
  return result;
}

function parseRequirementHashMap(
  value: unknown,
  label: string,
  allowNull: boolean,
): Record<string, string | null> {
  const input = record(value, label);
  const entries = Object.entries(input);
  if (entries.length > MAX_BASE_REQUIREMENTS) {
    throw new NativeDeltaValidationError(
      `${label} must contain at most ${MAX_BASE_REQUIREMENTS} entries`,
    );
  }
  const parsed: Record<string, string | null> = {};
  for (const [id, hash] of entries) {
    const normalizedId = requirementId(id, `${label} ID`);
    if (normalizedId !== id) {
      throw new NativeDeltaValidationError(`${label} ID must be normalized: ${id}`);
    }
    if (hash === null && allowNull) {
      parsed[id] = null;
    } else {
      parsed[id] = hashValue(hash, `${label}.${id}`);
    }
  }
  return parsed;
}

function requirementId(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!REQUIREMENT_ID_PATTERN.test(result)) {
    throw new NativeDeltaValidationError(`${label} is not a valid stable requirement ID`);
  }
  return result;
}

function capabilityId(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!CAPABILITY_ID_PATTERN.test(result)) {
    throw new NativeDeltaValidationError(`${label} is not a valid capability ID`);
  }
  return result;
}

function parseOperation(value: unknown, index: number): NativeDeltaOperation {
  const label = `Native delta operations[${index}]`;
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set(['id', 'operation', 'to_id', 'title', 'body', 'expected_hash']),
    label,
  );
  const id = requirementId(root.id, `${label}.id`);
  const operation = root.operation;
  if (!['add', 'modify', 'remove', 'rename'].includes(String(operation))) {
    throw new NativeDeltaValidationError(`${label}.operation is invalid`);
  }
  const kind = operation as NativeDeltaOperationKind;
  const to_id = root.to_id === undefined ? undefined : requirementId(root.to_id, `${label}.to_id`);
  const title = optionalText(root.title, `${label}.title`);
  const body = optionalText(root.body, `${label}.body`);
  const expected_hash =
    root.expected_hash === undefined
      ? undefined
      : hashValue(root.expected_hash, `${label}.expected_hash`);

  if (kind === 'add') {
    if (to_id !== undefined || expected_hash !== undefined || !body?.trim()) {
      throw new NativeDeltaValidationError(
        `${label} add requires body and forbids to_id and expected_hash`,
      );
    }
  } else if (kind === 'modify') {
    if (to_id !== undefined || !expected_hash || !body?.trim()) {
      throw new NativeDeltaValidationError(
        `${label} modify requires body and expected_hash and forbids to_id`,
      );
    }
  } else if (kind === 'remove') {
    if (to_id !== undefined || title !== undefined || body !== undefined || !expected_hash) {
      throw new NativeDeltaValidationError(
        `${label} remove requires expected_hash and forbids to_id, title, and body`,
      );
    }
  } else if (to_id === undefined || to_id === id || !expected_hash || body === '') {
    throw new NativeDeltaValidationError(
      `${label} rename requires a different to_id and expected_hash`,
    );
  }

  return {
    id,
    operation: kind,
    ...(to_id === undefined ? {} : { to_id }),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(expected_hash === undefined ? {} : { expected_hash }),
  };
}

function parseDeltaValue(value: unknown): NativeDeltaDocument {
  const root = record(value, 'Native delta');
  rejectUnknown(
    root,
    new Set([
      'schema',
      'capability',
      'base_hash',
      'base_version',
      'legacy_hash',
      'base_requirements',
      'independent_requirements',
      'operations',
    ]),
    'Native delta',
  );
  if (root.schema !== NATIVE_DELTA_SCHEMA) {
    throw new NativeDeltaValidationError(`Native delta schema must be ${NATIVE_DELTA_SCHEMA}`);
  }
  const capability = capabilityId(root.capability, 'Native delta capability');
  const base_hash = hashValue(root.base_hash, 'Native delta base_hash');
  if (!Number.isSafeInteger(root.base_version) || Number(root.base_version) < 1) {
    throw new NativeDeltaValidationError('Native delta base_version must be a positive integer');
  }
  const legacy_hash =
    root.legacy_hash === undefined
      ? undefined
      : hashValue(root.legacy_hash, 'Native delta legacy_hash');
  let base_requirements: Record<string, string> | undefined;
  if (root.base_requirements !== undefined) {
    base_requirements = parseRequirementHashMap(
      root.base_requirements,
      'Native delta base_requirements',
      false,
    ) as Record<string, string>;
  }
  const independent_requirements =
    root.independent_requirements === undefined
      ? undefined
      : parseRequirementHashMap(
          root.independent_requirements,
          'Native delta independent_requirements',
          true,
        );
  if (!Array.isArray(root.operations)) {
    throw new NativeDeltaValidationError('Native delta operations must be an array');
  }
  const operations = root.operations.map(parseOperation);
  const addresses = new Set<string>();
  for (const [index, operation] of operations.entries()) {
    const ids = [operation.id, ...(operation.to_id === undefined ? [] : [operation.to_id])];
    for (const id of ids) {
      if (addresses.has(id)) {
        throw new NativeDeltaValidationError(
          `Native delta operations contain duplicate or overlapping requirement ID ${id} at ${index}`,
        );
      }
      addresses.add(id);
    }
  }
  if (independent_requirements !== undefined) {
    if (base_requirements === undefined) {
      throw new NativeDeltaValidationError(
        'Native delta independent_requirements requires base_requirements',
      );
    }
    for (const [id, hash] of Object.entries(independent_requirements)) {
      if (addresses.has(id)) {
        throw new NativeDeltaValidationError(
          `Native delta requirement ${id} cannot be both addressed and independent`,
        );
      }
      const baseHash = base_requirements[id];
      if (hash === null ? baseHash !== undefined : baseHash !== hash) {
        throw new NativeDeltaValidationError(
          `Native delta independent_requirements does not match baseline ${id}`,
        );
      }
    }
  }
  return {
    schema: NATIVE_DELTA_SCHEMA,
    capability,
    base_hash,
    base_version: Number(root.base_version),
    ...(legacy_hash === undefined ? {} : { legacy_hash }),
    ...(base_requirements === undefined ? {} : { base_requirements }),
    ...(independent_requirements === undefined ? {} : { independent_requirements }),
    operations,
  };
}

function parseDeltaSource(source: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new NativeDeltaValidationError(
      `Native delta is invalid YAML: ${document.errors[0].message}`,
    );
  }
  return document.toJS({ mapAsMap: false });
}

export function parseNativeDelta(value: unknown): NativeDeltaDocument {
  return parseDeltaValue(typeof value === 'string' ? parseDeltaSource(value) : value);
}

/** Render a validated delta deterministically before it is persisted. */
export function renderNativeDelta(delta: NativeDeltaDocument): string {
  const parsed = parseNativeDelta(delta);
  return stringify({
    schema: parsed.schema,
    capability: parsed.capability,
    base_hash: parsed.base_hash,
    base_version: parsed.base_version,
    ...(parsed.legacy_hash === undefined ? {} : { legacy_hash: parsed.legacy_hash }),
    ...(parsed.base_requirements === undefined
      ? {}
      : {
          base_requirements: Object.fromEntries(
            Object.entries(parsed.base_requirements).sort(([left], [right]) =>
              left.localeCompare(right, 'en'),
            ),
          ),
        }),
    ...(parsed.independent_requirements === undefined
      ? {}
      : {
          independent_requirements: Object.fromEntries(
            Object.entries(parsed.independent_requirements).sort(([left], [right]) =>
              left.localeCompare(right, 'en'),
            ),
          ),
        }),
    operations: parsed.operations.map((operation) => ({
      id: operation.id,
      operation: operation.operation,
      ...(operation.to_id === undefined ? {} : { to_id: operation.to_id }),
      ...(operation.title === undefined ? {} : { title: operation.title }),
      ...(operation.body === undefined ? {} : { body: operation.body }),
      ...(operation.expected_hash === undefined ? {} : { expected_hash: operation.expected_hash }),
    })),
  });
}

function headingLevel(line: string): number | null {
  const match = /^\s{0,3}(#{1,6})\s+/u.exec(line);
  return match ? match[1].length : null;
}

function markersFor(lines: readonly string[]): RequirementMarker[] {
  const markers: RequirementMarker[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const [line, value] of lines.entries()) {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(value.trimEnd());
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        delimiter[2].trim().length === 0
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const match = /^(\s{0,3})(#{2,6})\s+Requirement:\s*([^\s]+)(?:\s+(.*?))?\s*$/u.exec(value);
    if (!match) continue;
    const id = match[3];
    if (!REQUIREMENT_ID_PATTERN.test(id)) {
      throw new NativeDeltaValidationError(`Native total Spec requirement ID is invalid: ${id}`);
    }
    markers.push({
      line,
      level: match[2].length,
      id,
      title: match[4]?.trim() ?? '',
    });
  }
  return markers;
}

function parseNativeSpec(markdown: string): ParsedNativeSpec {
  const text = normalizeLineEndings(markdown);
  const lines = text.split('\n');
  const markers = markersFor(lines);
  const ranges: Array<{ start: number; end: number; marker: RequirementMarker }> = [];
  const known = new Set<string>();
  for (const marker of markers) {
    if (known.has(marker.id)) {
      throw new NativeDeltaValidationError(
        `Native total Spec contains duplicate requirement ID ${marker.id}`,
      );
    }
    known.add(marker.id);
    let end = lines.length;
    for (let line = marker.line + 1; line < lines.length; line += 1) {
      if (markers.some((candidate) => candidate.line === line)) {
        end = line;
        break;
      }
      const level = headingLevel(lines[line]);
      if (level !== null && level <= marker.level) {
        end = line;
        break;
      }
    }
    ranges.push({ start: marker.line, end, marker });
  }
  const requirements = new Map<string, NativeRequirement>();
  for (const range of ranges) {
    const raw = `${lines.slice(range.start, range.end).join('\n')}${range.end < lines.length ? '\n' : ''}`;
    const body = lines
      .slice(range.start + 1, range.end)
      .join('\n')
      .replace(/^\n/u, '')
      .replace(/\n+$/u, '');
    requirements.set(range.marker.id, {
      id: range.marker.id,
      level: range.marker.level,
      title: range.marker.title,
      body,
      raw,
      startLine: range.start,
      endLine: range.end,
    });
  }
  const legacyChunks: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    legacyChunks.push(lines.slice(cursor, range.start).join('\n'));
    cursor = range.end;
  }
  legacyChunks.push(lines.slice(cursor).join('\n'));
  return {
    text,
    lines,
    requirements,
    legacyText: legacyChunks.join('\n'),
  };
}

export function nativeRequirementSectionHash(section: string): string {
  return hashText(section);
}

export function nativeTotalSpecHash(markdown: string): string {
  return hashText(markdown);
}

export function nativeLegacySectionHash(markdown: string): string {
  const legacy = parseNativeSpec(markdown).legacyText;
  return hashText(
    legacy
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .join('\n')
      .trim(),
  );
}

export function inspectNativeTotalSpec(markdown: string): {
  readonly legacy_hash: string;
  readonly requirements: readonly NativeRequirement[];
} {
  const parsed = parseNativeSpec(markdown);
  return {
    legacy_hash: nativeLegacySectionHash(markdown),
    requirements: [...parsed.requirements.values()].map((requirement) => ({ ...requirement })),
  };
}

/**
 * Return only the complete requirement sections touched by a delta.
 *
 * Native keeps the change's full target Spec for human review and backwards
 * compatibility, but the historical requirements in that target are not a
 * new implementation scope. The returned Markdown is therefore used for
 * change acceptance discovery, while the full target remains the archive
 * result and Shape fingerprint.
 */
export function nativeDeltaAcceptanceMarkdown(
  targetMarkdown: string,
  delta: NativeDeltaDocument,
): string {
  const parsed = parseNativeSpec(targetMarkdown);
  const sections: string[] = [];
  for (const operation of delta.operations) {
    if (operation.operation === 'remove') continue;
    const id = operation.operation === 'rename' ? operation.to_id! : operation.id;
    const requirement = parsed.requirements.get(id);
    if (!requirement) {
      throw new NativeDeltaValidationError(
        `Native delta target Spec is missing requirement ${id} for ${operation.operation}`,
      );
    }
    sections.push(requirement.raw.trimEnd());
  }
  return sections.length === 0 ? '' : `${sections.join('\n\n')}\n`;
}

function requirementText(
  level: number,
  id: string,
  title: string | undefined,
  body: string,
): string {
  const heading = `${'#'.repeat(level)} Requirement: ${id}${title?.trim() ? ` ${title.trim()}` : ''}`;
  const normalizedBody = normalizeLineEndings(body).replace(/\n+$/u, '');
  return [heading, '', ...normalizedBody.split('\n'), '', ''].join('\n');
}

function targetIds(operation: NativeDeltaOperation): string[] {
  return operation.operation === 'rename' ? [operation.id, operation.to_id!] : [operation.id];
}

function desiredRequirement(
  operation: NativeDeltaOperation,
  existing: NativeRequirement | undefined,
): { id: string; level: number; title: string | undefined; body: string } {
  if (operation.operation === 'rename') {
    if (!existing)
      throw new NativeDeltaValidationError(`Rename target does not exist: ${operation.id}`);
    return {
      id: operation.to_id!,
      level: existing.level,
      title: operation.title ?? existing.title,
      body: operation.body ?? existing.body,
    };
  }
  return {
    id: operation.id,
    level: existing?.level ?? 2,
    title: operation.title ?? existing?.title,
    body: operation.body ?? existing?.body ?? '',
  };
}

function replaceRequirement(
  markdown: string,
  existing: NativeRequirement,
  replacement: string,
): string {
  const parsed = parseNativeSpec(markdown);
  const lines = [...parsed.lines];
  const current = parsed.requirements.get(existing.id);
  if (!current)
    throw new NativeDeltaValidationError(`Requirement target disappeared: ${existing.id}`);
  lines.splice(current.startLine, current.endLine - current.startLine, ...replacement.split('\n'));
  return lines.join('\n');
}

function appendRequirement(markdown: string, replacement: string): string {
  const normalized = normalizeLineEndings(markdown);
  const separator = normalized.length === 0 ? '' : normalized.endsWith('\n\n') ? '' : '\n';
  const withSeparator = `${normalized}${separator}`;
  return `${withSeparator.endsWith('\n') || withSeparator.length === 0 ? withSeparator : `${withSeparator}\n`}${replacement}`;
}

function operationAlreadyApplied(
  operation: NativeDeltaOperation,
  parsed: ParsedNativeSpec,
): boolean {
  if (operation.operation === 'add' || operation.operation === 'modify') {
    const existing = parsed.requirements.get(operation.id);
    if (!existing) return false;
    const desired = desiredRequirement(
      operation,
      operation.operation === 'modify' ? existing : undefined,
    );
    return existing.raw === requirementText(desired.level, desired.id, desired.title, desired.body);
  }
  if (operation.operation === 'remove') return false;
  const existing = parsed.requirements.get(operation.to_id!);
  const old = parsed.requirements.get(operation.id);
  if (!existing || old) return false;
  const expected = desiredRequirement(operation, {
    id: operation.id,
    level: existing.level,
    title: existing.title,
    body: existing.body,
    raw: existing.raw,
    startLine: existing.startLine,
    endLine: existing.endLine,
  });
  return (
    existing.raw === requirementText(expected.level, expected.id, expected.title, expected.body)
  );
}

function validateOperationAgainstBaseline(
  operation: NativeDeltaOperation,
  baseline: ParsedNativeSpec,
): void {
  const existing = baseline.requirements.get(operation.id);
  if (operation.operation === 'add') {
    if (existing)
      throw new NativeDeltaValidationError(`Add target already exists: ${operation.id}`);
    return;
  }
  if (!existing) {
    throw new NativeDeltaValidationError(`Native delta target does not exist: ${operation.id}`);
  }
  if (operation.expected_hash !== nativeRequirementSectionHash(existing.raw)) {
    throw new NativeDeltaValidationError(
      `Native delta ${operation.operation} expected_hash does not match ${operation.id}`,
    );
  }
  if (operation.operation === 'rename' && baseline.requirements.has(operation.to_id!)) {
    throw new NativeDeltaValidationError(`Rename destination already exists: ${operation.to_id}`);
  }
}

function assertBaseRequirementsBinding(
  delta: NativeDeltaDocument,
  baseline: ParsedNativeSpec,
): void {
  if (delta.base_requirements === undefined) return;
  const expected = delta.base_requirements;
  const actual = baseline.requirements;
  if (Object.keys(expected).length !== actual.size) {
    throw new NativeDeltaValidationError(
      'Native delta base_requirements must describe the complete total Spec baseline',
    );
  }
  for (const [id, requirement] of actual) {
    if (expected[id] !== nativeRequirementSectionHash(requirement.raw)) {
      throw new NativeDeltaValidationError(
        `Native delta base_requirements does not match requirement ${id}`,
      );
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const SHARED_REQUIREMENT_MARKER =
  /\b(?:shared|common|global|every|all|must\s+always|applies\s+to\s+all)\b|共享|公共|全局|所有|统一/iu;

function requirementMentionsId(text: string, id: string): boolean {
  const escaped = escapeRegExp(id);
  return new RegExp(`(?:^|[^A-Za-z0-9._-])${escaped}(?:$|[^A-Za-z0-9._-])`, 'u').test(text);
}

/**
 * A changed requirement is safe to rebase only when it is clearly independent
 * from this delta. Stable IDs cover direct references; the conservative marker
 * check prevents silently merging edits to shared or global constraints.
 */
function assertConcurrentRequirementImpact(options: {
  readonly current: ParsedNativeSpec;
  readonly delta: NativeDeltaDocument;
}): void {
  const baseline = options.delta.base_requirements;
  if (baseline === undefined) {
    throw new NativeDeltaConflictError(
      [options.delta.capability],
      'Native delta cannot prove independent impact without base_requirements and explicit independent_requirements',
    );
  }
  const independent = options.delta.independent_requirements ?? {};
  const addressed = new Set(options.delta.operations.flatMap((operation) => targetIds(operation)));
  const changed: NativeRequirement[] = [];
  const undeclared: string[] = [];
  for (const [id, requirement] of options.current.requirements) {
    const expected = baseline[id];
    if (addressed.has(id)) continue;
    if (expected === undefined || expected !== nativeRequirementSectionHash(requirement.raw)) {
      changed.push(requirement);
      const declared = independent[id];
      if (
        declared === undefined ||
        (expected === undefined ? declared !== null : declared !== expected)
      ) {
        undeclared.push(id);
      }
    }
  }
  const missing = Object.keys(baseline).filter(
    (id) => !addressed.has(id) && !options.current.requirements.has(id),
  );
  if (changed.length === 0 && missing.length === 0) return;

  const operationText = options.delta.operations
    .map((operation) => `${operation.title ?? ''}\n${operation.body ?? ''}`)
    .join('\n');
  const uncertain = changed.filter(
    (requirement) =>
      SHARED_REQUIREMENT_MARKER.test(requirement.raw) ||
      [...addressed].some((id) => requirementMentionsId(requirement.raw, id)) ||
      Object.keys(baseline).some(
        (id) => !addressed.has(id) && requirementMentionsId(operationText, id),
      ),
  );
  if (uncertain.length === 0 && undeclared.length === 0 && missing.length === 0) return;
  throw new NativeDeltaConflictError(
    [...addressed, ...uncertain.map((requirement) => requirement.id), ...undeclared, ...missing],
    'Native delta impact is uncertain; declare verified independent_requirements before rebase',
  );
}

function assertLegacyBinding(delta: NativeDeltaDocument, baseline: ParsedNativeSpec): void {
  const legacyHash = nativeLegacySectionHash(baseline.text);
  if (legacyHash !== hashText('') && delta.legacy_hash !== legacyHash) {
    throw new NativeDeltaValidationError(
      'Native delta modifying a legacy total Spec requires a matching legacy_hash',
    );
  }
}

function assertConcurrentLegacyBinding(
  delta: NativeDeltaDocument,
  current: ParsedNativeSpec,
): void {
  const expected = delta.legacy_hash ?? hashText('');
  const actual = nativeLegacySectionHash(current.text);
  if (actual !== expected) {
    throw new NativeDeltaConflictError(
      [delta.capability],
      'Native delta conflicts with a concurrent change to shared legacy constraints',
    );
  }
}

function applyOperations(options: {
  readonly baselineMarkdown: string;
  readonly delta: NativeDeltaDocument;
  readonly allowAlreadyApplied: boolean;
  readonly rebased: boolean;
}): NativeDeltaApplyResult {
  let markdown = normalizeLineEndings(options.baselineMarkdown);
  const changed: string[] = [];
  const operationResults: NativeDeltaOperationResult[] = [];
  for (const operation of options.delta.operations) {
    const parsed = parseNativeSpec(markdown);
    const existing = parsed.requirements.get(operation.id);
    if (options.allowAlreadyApplied && operationAlreadyApplied(operation, parsed)) {
      operationResults.push({
        id: operation.id,
        operation: operation.operation,
        status: 'already-applied',
        targetIds: targetIds(operation),
      });
      continue;
    }
    if (operation.operation === 'add') {
      if (existing) {
        throw new NativeDeltaConflictError(
          [operation.id],
          `Native delta add conflicts with existing requirement ${operation.id}`,
        );
      }
      const desired = desiredRequirement(operation, undefined);
      markdown = appendRequirement(
        markdown,
        requirementText(desired.level, desired.id, desired.title, desired.body),
      );
    } else {
      if (!existing) {
        throw new NativeDeltaConflictError(
          [operation.id],
          `Native delta ${operation.operation} target does not exist: ${operation.id}`,
        );
      }
      if (operation.expected_hash !== nativeRequirementSectionHash(existing.raw)) {
        throw new NativeDeltaConflictError(
          [operation.id],
          `Native delta ${operation.operation} conflicts with concurrent requirement ${operation.id}`,
        );
      }
      const desired = desiredRequirement(operation, existing);
      if (
        operation.operation === 'rename' &&
        parseNativeSpec(markdown).requirements.has(operation.to_id!)
      ) {
        throw new NativeDeltaConflictError(
          [operation.id, operation.to_id!],
          `Native delta rename destination already exists: ${operation.to_id}`,
        );
      }
      if (operation.operation === 'remove') {
        const lines = [...parseNativeSpec(markdown).lines];
        lines.splice(existing.startLine, existing.endLine - existing.startLine);
        markdown = lines.join('\n');
      } else {
        markdown = replaceRequirement(
          markdown,
          existing,
          requirementText(desired.level, desired.id, desired.title, desired.body),
        );
      }
    }
    changed.push(...targetIds(operation));
    operationResults.push({
      id: operation.id,
      operation: operation.operation,
      status: 'changed',
      targetIds: targetIds(operation),
    });
  }
  const result = normalizeLineEndings(markdown);
  return {
    markdown: result,
    base_hash: options.delta.base_hash,
    result_hash: hashText(result),
    rebased: options.rebased,
    changedRequirementIds: [...new Set(changed)],
    operationResults,
  };
}

function assertConcurrentOperations(options: {
  readonly baseline: ParsedNativeSpec;
  readonly current: ParsedNativeSpec;
  readonly delta: NativeDeltaDocument;
}): void {
  assertLegacyBinding(options.delta, options.baseline);
  assertConcurrentLegacyBinding(options.delta, options.current);
  assertConcurrentRequirementImpact({ current: options.current, delta: options.delta });
  for (const operation of options.delta.operations) {
    const baseExisting = options.baseline.requirements.get(operation.id);
    const currentExisting = options.current.requirements.get(operation.id);
    if (operation.operation === 'add') {
      const currentDestination = options.current.requirements.get(operation.id);
      if (currentDestination) {
        const desired = requirementText(2, operation.id, operation.title, operation.body!);
        if (currentDestination.raw !== desired) {
          throw new NativeDeltaConflictError(
            [operation.id],
            `Native delta add conflicts with concurrent requirement ${operation.id}`,
          );
        }
      }
      continue;
    }
    if (!baseExisting) {
      throw new NativeDeltaValidationError(`Native delta target does not exist: ${operation.id}`);
    }
    if (operation.expected_hash !== nativeRequirementSectionHash(baseExisting.raw)) {
      throw new NativeDeltaValidationError(
        `Native delta ${operation.operation} expected_hash does not match ${operation.id}`,
      );
    }
    if (operationAlreadyApplied(operation, options.current)) continue;
    if (!currentExisting) {
      throw new NativeDeltaConflictError(
        targetIds(operation),
        `Native delta ${operation.operation} target changed or disappeared: ${operation.id}`,
      );
    }
    if (nativeRequirementSectionHash(currentExisting.raw) !== operation.expected_hash) {
      throw new NativeDeltaConflictError(
        targetIds(operation),
        `Native delta ${operation.operation} conflicts with concurrent requirement ${operation.id}`,
      );
    }
    if (operation.operation === 'rename' && options.current.requirements.has(operation.to_id!)) {
      throw new NativeDeltaConflictError(
        [operation.id, operation.to_id!],
        `Native delta rename destination changed concurrently: ${operation.to_id}`,
      );
    }
  }
}

export function applyNativeDelta(options: {
  readonly baselineMarkdown: string;
  readonly delta: NativeDeltaDocument;
  /** Allow a re-based operation that is already present in the new baseline. */
  readonly allowAlreadyApplied?: boolean;
}): NativeDeltaApplyResult {
  const baseline = parseNativeSpec(options.baselineMarkdown);
  if (hashText(baseline.text) !== options.delta.base_hash) {
    throw new NativeDeltaConflictError(
      [options.delta.capability],
      `Native delta base hash does not match the current total Spec for ${options.delta.capability}`,
    );
  }
  assertLegacyBinding(options.delta, baseline);
  assertBaseRequirementsBinding(options.delta, baseline);
  for (const operation of options.delta.operations) {
    if (options.allowAlreadyApplied && operationAlreadyApplied(operation, baseline)) continue;
    validateOperationAgainstBaseline(operation, baseline);
  }
  return applyOperations({
    baselineMarkdown: baseline.text,
    delta: options.delta,
    allowAlreadyApplied: options.allowAlreadyApplied ?? false,
    rebased: false,
  });
}

export function mergeNativeDelta(options: {
  readonly baselineMarkdown: string;
  readonly currentMarkdown: string;
  readonly delta: NativeDeltaDocument;
}): NativeDeltaApplyResult {
  const baseline = parseNativeSpec(options.baselineMarkdown);
  const current = parseNativeSpec(options.currentMarkdown);
  if (hashText(baseline.text) !== options.delta.base_hash) {
    throw new NativeDeltaValidationError(
      `Native delta base_hash does not identify the supplied baseline for ${options.delta.capability}`,
    );
  }
  assertBaseRequirementsBinding(options.delta, baseline);
  for (const operation of options.delta.operations)
    validateOperationAgainstBaseline(operation, baseline);
  const currentHash = hashText(current.text);
  if (currentHash === options.delta.base_hash) {
    return applyOperations({
      baselineMarkdown: current.text,
      delta: options.delta,
      allowAlreadyApplied: true,
      rebased: false,
    });
  }
  const expectedResult = applyOperations({
    baselineMarkdown: baseline.text,
    delta: options.delta,
    allowAlreadyApplied: false,
    rebased: false,
  });
  if (expectedResult.markdown === current.text) {
    return {
      ...expectedResult,
      rebased: true,
      changedRequirementIds: [],
      operationResults: expectedResult.operationResults.map((entry) => ({
        ...entry,
        status: 'already-applied' as const,
      })),
    };
  }
  assertConcurrentOperations({ baseline, current, delta: options.delta });
  return applyOperations({
    baselineMarkdown: current.text,
    delta: options.delta,
    allowAlreadyApplied: true,
    rebased: true,
  });
}

/**
 * Merge a delta into the latest canonical Spec when the original baseline is
 * no longer available. Per-requirement expected hashes are the proof that an
 * independent concurrent edit can be replayed safely; an uncertain edit is a
 * conflict and never becomes a blind replacement.
 */
export function mergeNativeDeltaAgainstCurrent(options: {
  readonly currentMarkdown: string;
  readonly delta: NativeDeltaDocument;
}): NativeDeltaApplyResult {
  const current = parseNativeSpec(options.currentMarkdown);
  if (hashText(current.text) === options.delta.base_hash) {
    return applyNativeDelta({
      baselineMarkdown: current.text,
      delta: options.delta,
      allowAlreadyApplied: true,
    });
  }
  assertConcurrentLegacyBinding(options.delta, current);
  assertConcurrentRequirementImpact({ current, delta: options.delta });
  for (const operation of options.delta.operations) {
    const existing = current.requirements.get(operation.id);
    if (operationAlreadyApplied(operation, current)) continue;
    if (operation.operation === 'add') {
      if (existing) {
        throw new NativeDeltaConflictError(
          [operation.id],
          `Native delta add conflicts with concurrent requirement ${operation.id}`,
        );
      }
      continue;
    }
    if (!existing || operation.expected_hash !== nativeRequirementSectionHash(existing.raw)) {
      throw new NativeDeltaConflictError(
        targetIds(operation),
        `Native delta ${operation.operation} conflicts with concurrent requirement ${operation.id}`,
      );
    }
    if (operation.operation === 'rename' && current.requirements.has(operation.to_id!)) {
      throw new NativeDeltaConflictError(
        [operation.id, operation.to_id!],
        `Native delta rename destination changed concurrently: ${operation.to_id}`,
      );
    }
  }
  return applyOperations({
    baselineMarkdown: current.text,
    delta: options.delta,
    allowAlreadyApplied: true,
    rebased: true,
  });
}
