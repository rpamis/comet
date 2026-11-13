import { createHash } from 'node:crypto';

import { parseDocument, stringify } from 'yaml';

export const NATIVE_DELTA_SCHEMA = 'comet.native.delta.v1' as const;
export const NATIVE_DELTA_FILE = 'delta.yaml' as const;

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REQUIREMENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

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
  readonly base_hash?: string;
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
  readonly base_hash?: string;
  readonly result_hash?: string;
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
  // codeql[js/insufficient-password-hash] Deterministic integrity digest for Spec content; it is not password hashing.
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
  if (kind === 'add') {
    if (to_id !== undefined || !body?.trim()) {
      throw new NativeDeltaValidationError(`${label} add requires body and forbids to_id`);
    }
  } else if (kind === 'modify') {
    if (to_id !== undefined || !body?.trim()) {
      throw new NativeDeltaValidationError(`${label} modify requires body and forbids to_id`);
    }
  } else if (kind === 'remove') {
    if (to_id !== undefined || title !== undefined || body !== undefined) {
      throw new NativeDeltaValidationError(`${label} remove forbids to_id, title, and body`);
    }
  } else if (to_id === undefined || to_id === id || body === '') {
    throw new NativeDeltaValidationError(`${label} rename requires a different to_id`);
  }

  return {
    id,
    operation: kind,
    ...(to_id === undefined ? {} : { to_id }),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
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
  return {
    schema: NATIVE_DELTA_SCHEMA,
    capability,
    base_version:
      Number.isSafeInteger(root.base_version) && Number(root.base_version) > 0
        ? Number(root.base_version)
        : 1,
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
  return stringify(parsed);
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
    rebased: options.rebased,
    changedRequirementIds: [...new Set(changed)],
    operationResults,
  };
}

export function applyNativeDelta(options: {
  readonly baselineMarkdown: string;
  readonly delta: NativeDeltaDocument;
  /** Allow a re-based operation that is already present in the new baseline. */
  readonly allowAlreadyApplied?: boolean;
}): NativeDeltaApplyResult {
  return applyOperations({
    baselineMarkdown: options.baselineMarkdown,
    delta: parseNativeDelta(options.delta),
    allowAlreadyApplied: options.allowAlreadyApplied ?? false,
    rebased: false,
  });
}

export function mergeNativeDelta(options: {
  readonly baselineMarkdown: string;
  readonly currentMarkdown: string;
  readonly delta: NativeDeltaDocument;
}): NativeDeltaApplyResult {
  return applyOperations({
    baselineMarkdown: options.currentMarkdown,
    delta: parseNativeDelta(options.delta),
    allowAlreadyApplied: true,
    rebased: false,
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
  return applyOperations({
    baselineMarkdown: options.currentMarkdown,
    delta: parseNativeDelta(options.delta),
    allowAlreadyApplied: true,
    rebased: false,
  });
}
