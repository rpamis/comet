import path from 'node:path';

import { canonicalHash } from './native-canonical-hash.js';
import type {
  NativeAcceptanceCriterionProjection,
  NativeAcceptancePageProjection,
} from './native-types.js';

const ACCEPTANCE_HASH_TAG = 'comet.native.acceptance.v1';
const ACCEPTANCE_ID_PATTERN = /^acceptance-[a-f0-9]{64}$/u;
const EVIDENCE_ENTRY_KEYS = new Set(['acceptance_id', 'evidence_refs', 'skipped_reason']);
const ACCEPTANCE_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ACCEPTANCE_CURSOR_PATTERN =
  /^native-acceptance-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

export const NATIVE_ACCEPTANCE_PAGE_LIMITS = Object.freeze({
  maxItems: 16,
  maxTextBytes: 512,
  maxContextItems: 4,
  maxContextItemBytes: 256,
  maxSerializedBytes: 32 * 1024,
});

export const NATIVE_ACCEPTANCE_LIMITS = Object.freeze({
  maxCriteria: 1_024,
});

export const NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER =
  '<!-- comet-native:acceptance-evidence:start -->';
export const NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER =
  '<!-- comet-native:acceptance-evidence:end -->';

export type NativeAcceptanceKind = 'brief-example' | 'spec-scenario';

export interface NativeAcceptanceCriterion {
  id: string;
  kind: NativeAcceptanceKind;
  source: string;
  context: string[];
  text: string;
}

export interface NativeAcceptanceEvidenceEntry {
  acceptance_id: string;
  evidence_refs: string[];
  skipped_reason?: string;
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { value, truncated: false };
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return { value: result, truncated: true };
}

function acceptanceCursor(acceptanceHash: string, offset: number): string {
  const encodedOffset = offset.toString(36);
  const cursorHash = canonicalHash('comet.native.acceptance-cursor.v1', {
    acceptanceHash,
    offset,
  });
  return `native-acceptance-v1.${acceptanceHash}.${encodedOffset}.${cursorHash}`;
}

function acceptanceOffset(options: {
  acceptanceHash: string;
  total: number;
  cursor?: string | null;
}): number {
  if (!ACCEPTANCE_HASH_PATTERN.test(options.acceptanceHash)) {
    throw new Error('Native acceptance page hash is invalid');
  }
  if (options.cursor === undefined || options.cursor === null) return 0;
  const match = ACCEPTANCE_CURSOR_PATTERN.exec(options.cursor);
  if (!match) throw new Error('Native acceptance cursor is invalid');
  if (match[1] !== options.acceptanceHash) {
    throw new Error('Native acceptance cursor is stale');
  }
  const offset = Number.parseInt(match[2], 36);
  if (
    !Number.isSafeInteger(offset) ||
    offset <= 0 ||
    offset >= options.total ||
    offset.toString(36) !== match[2]
  ) {
    throw new Error('Native acceptance cursor offset is invalid');
  }
  if (
    match[3] !==
    canonicalHash('comet.native.acceptance-cursor.v1', {
      acceptanceHash: options.acceptanceHash,
      offset,
    })
  ) {
    throw new Error('Native acceptance cursor integrity check failed');
  }
  return offset;
}

function acceptanceProjection(
  criterion: NativeAcceptanceCriterion,
): NativeAcceptanceCriterionProjection {
  const text = truncateUtf8(criterion.text, NATIVE_ACCEPTANCE_PAGE_LIMITS.maxTextBytes);
  const projectedContext = criterion.context
    .slice(0, NATIVE_ACCEPTANCE_PAGE_LIMITS.maxContextItems)
    .map((entry) => truncateUtf8(entry, NATIVE_ACCEPTANCE_PAGE_LIMITS.maxContextItemBytes));
  return {
    id: criterion.id,
    kind: criterion.kind,
    source: criterion.source,
    context: projectedContext.map((entry) => entry.value),
    text: text.value,
    contextTruncated:
      criterion.context.length > projectedContext.length ||
      projectedContext.some((entry) => entry.truncated),
    textTruncated: text.truncated,
  };
}

/** Project a bounded, resumable page without hiding any acceptance ID. */
export function projectNativeAcceptancePage(options: {
  criteria: readonly NativeAcceptanceCriterion[];
  acceptanceHash: string;
  cursor?: string | null;
}): NativeAcceptancePageProjection {
  const offset = acceptanceOffset({
    acceptanceHash: options.acceptanceHash,
    total: options.criteria.length,
    cursor: options.cursor,
  });
  const items: NativeAcceptanceCriterionProjection[] = [];
  const remaining = options.criteria.slice(offset, offset + NATIVE_ACCEPTANCE_PAGE_LIMITS.maxItems);
  for (const criterion of remaining) {
    const candidate = [...items, acceptanceProjection(criterion)];
    const nextOffset = offset + candidate.length;
    const trial: NativeAcceptancePageProjection = {
      schema: 'comet.native.acceptance-page.v1',
      acceptanceHash: options.acceptanceHash,
      total: options.criteria.length,
      offset,
      items: candidate,
      nextCursor:
        nextOffset < options.criteria.length
          ? acceptanceCursor(options.acceptanceHash, nextOffset)
          : null,
      limits: { ...NATIVE_ACCEPTANCE_PAGE_LIMITS },
    };
    if (
      Buffer.byteLength(JSON.stringify(trial), 'utf8') >
      NATIVE_ACCEPTANCE_PAGE_LIMITS.maxSerializedBytes
    ) {
      if (items.length === 0) {
        throw new Error('Native acceptance criterion exceeds the page serialization budget');
      }
      break;
    }
    items.push(candidate.at(-1)!);
  }
  if (options.criteria.length > 0 && items.length === 0) {
    throw new Error('Native acceptance page could not project its next criterion');
  }
  const nextOffset = offset + items.length;
  const page: NativeAcceptancePageProjection = {
    schema: 'comet.native.acceptance-page.v1',
    acceptanceHash: options.acceptanceHash,
    total: options.criteria.length,
    offset,
    items,
    nextCursor:
      nextOffset < options.criteria.length
        ? acceptanceCursor(options.acceptanceHash, nextOffset)
        : null,
    limits: { ...NATIVE_ACCEPTANCE_PAGE_LIMITS },
  };
  if (
    Buffer.byteLength(JSON.stringify(page), 'utf8') >
    NATIVE_ACCEPTANCE_PAGE_LIMITS.maxSerializedBytes
  ) {
    throw new Error('Native acceptance page exceeds its serialization budget');
  }
  return page;
}

interface MarkdownHeading {
  level: number;
  text: string;
}

interface FenceState {
  marker: '`' | '~';
  length: number;
}

interface ScannedMarkdownLine {
  line: string;
  body: boolean;
}

interface IndexedScannedMarkdownLine extends ScannedMarkdownLine {
  index: number;
}

function markdownHeading(line: string): MarkdownHeading | null {
  const match = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/u.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    text: match[2].replace(/[ \t]+#+[ \t]*$/u, '').trim(),
  };
}

function nextFenceState(line: string, current: FenceState | null): FenceState | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return current;
  const marker = match[1][0] as '`' | '~';
  if (current === null) return { marker, length: match[1].length };
  if (
    marker === current.marker &&
    match[1].length >= current.length &&
    match[2].trim().length === 0
  ) {
    return null;
  }
  return current;
}

function* iterateScannedMarkdown(markdown: string): Generator<IndexedScannedMarkdownLine> {
  let fence: FenceState | null = null;
  let htmlComment = false;
  let htmlTag: string | null = null;
  const normalized = markdown.replace(/\r\n?/gu, '\n');
  let start = 0;
  let index = 0;
  while (start <= normalized.length) {
    const end = normalized.indexOf('\n', start);
    const line = end === -1 ? normalized.slice(start) : normalized.slice(start, end);
    const body = fence === null && !htmlComment && htmlTag === null;
    yield { line, body, index };
    index += 1;

    if (fence !== null) {
      fence = nextFenceState(line, fence);
    } else if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
    } else if (htmlTag !== null) {
      if (new RegExp(`</${htmlTag}\\s*>`, 'iu').test(line)) htmlTag = null;
    } else {
      const nextFence = nextFenceState(line, null);
      if (nextFence !== null) {
        fence = nextFence;
      } else {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) {
          htmlComment = true;
        } else {
          const htmlStart = /^<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/u.exec(trimmed);
          if (
            htmlStart &&
            !trimmed.startsWith('</') &&
            !trimmed.endsWith('/>') &&
            !new RegExp(`</${htmlStart[1]}\\s*>`, 'iu').test(trimmed)
          ) {
            htmlTag = htmlStart[1];
          }
        }
      }
    }
    if (end === -1) break;
    start = end + 1;
  }
}

function scanMarkdown(markdown: string): ScannedMarkdownLine[] {
  return [...iterateScannedMarkdown(markdown)].map(({ line, body }) => ({ line, body }));
}

export function normalizeNativeAcceptanceText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function criterion(
  kind: NativeAcceptanceKind,
  source: string,
  rawText: string,
  rawContext: readonly string[] = [],
): NativeAcceptanceCriterion {
  const text = normalizeNativeAcceptanceText(rawText);
  const normalizedSource = source.replaceAll('\\', '/').trim();
  const context = rawContext.map(normalizeNativeAcceptanceText);
  if (text.length === 0) throw new Error(`${kind} acceptance criterion must not be empty`);
  if (normalizedSource.length === 0) {
    throw new Error(`${kind} acceptance criterion source must not be empty`);
  }
  return {
    id: `acceptance-${canonicalHash(ACCEPTANCE_HASH_TAG, {
      kind,
      source: normalizedSource,
      context,
      text,
    })}`,
    kind,
    source: normalizedSource,
    context,
    text,
  };
}

function uniqueCriteria(
  criteria: NativeAcceptanceCriterion[],
  label: string,
): NativeAcceptanceCriterion[] {
  const seen = new Set<string>();
  for (const item of criteria) {
    if (seen.has(item.id)) throw new Error(`${label} contains duplicate acceptance criteria`);
    seen.add(item.id);
  }
  return criteria;
}

function acceptanceSectionBounds(markdown: string): { start: number; end: number } | null {
  let sectionStart: number | null = null;
  let sectionEnd: number | null = null;
  let matches = 0;
  let lineCount = 0;
  for (const { line, body, index } of iterateScannedMarkdown(markdown)) {
    lineCount = index + 1;
    const heading = body ? markdownHeading(line) : null;
    if (heading?.level !== 1) continue;
    if (heading.text.toLocaleLowerCase('en-US') === 'acceptance examples') {
      matches += 1;
      if (matches === 1) sectionStart = index + 1;
    } else if (sectionStart !== null && sectionEnd === null) {
      sectionEnd = index;
    }
  }
  if (matches === 0 || sectionStart === null) return null;
  if (matches !== 1) {
    throw new Error('Brief must contain exactly one Acceptance examples section');
  }
  return { start: sectionStart, end: sectionEnd ?? lineCount };
}

/** Derive criteria from top-level list items in the brief's Acceptance examples section. */
export function deriveBriefAcceptanceCriteria(
  markdown: string,
  source = 'brief.md',
  maxCriteria: number = NATIVE_ACCEPTANCE_LIMITS.maxCriteria,
): NativeAcceptanceCriterion[] {
  if (!Number.isSafeInteger(maxCriteria) || maxCriteria < 0) {
    throw new Error('Native brief acceptance budget is invalid');
  }
  const section = acceptanceSectionBounds(markdown);
  if (section === null) return [];

  let topLevelIndent: number | null = null;
  for (const { line, body, index } of iterateScannedMarkdown(markdown)) {
    if (index < section.start || index >= section.end) continue;
    const listItem = body ? /^( {0,3})[-*+][ \t]+/u.exec(line) : null;
    if (listItem === null) continue;
    const indent = listItem[1].length;
    topLevelIndent = topLevelIndent === null ? indent : Math.min(topLevelIndent, indent);
  }

  const items: string[][] = [];
  let active: string[] | null = null;
  const pushActive = () => {
    if (active === null) return;
    if (items.length >= maxCriteria) {
      throw new Error(`Native acceptance exceeds its ${maxCriteria}-criterion acceptance budget`);
    }
    items.push(active);
  };
  for (const { line, body, index } of iterateScannedMarkdown(markdown)) {
    if (index < section.start || index >= section.end) continue;
    const listItem = body ? /^( {0,3})[-*+][ \t]+(.*)$/u.exec(line) : null;
    if (listItem && listItem[1].length === topLevelIndent) {
      pushActive();
      active = [listItem[2]];
    } else if (active !== null) {
      active.push(line);
    }
  }
  pushActive();

  return uniqueCriteria(
    items.map((lines) => criterion('brief-example', source, lines.join('\n'))),
    'Brief',
  );
}

/** Derive criteria from explicit Markdown `Scenario:` heading blocks in a target spec. */
export function deriveSpecAcceptanceCriteria(
  markdown: string,
  source = 'spec.md',
  maxCriteria: number = NATIVE_ACCEPTANCE_LIMITS.maxCriteria,
): NativeAcceptanceCriterion[] {
  if (!Number.isSafeInteger(maxCriteria) || maxCriteria < 0) {
    throw new Error('Native specification acceptance budget is invalid');
  }
  const criteria: NativeAcceptanceCriterion[] = [];
  const ancestry: MarkdownHeading[] = [];
  let active: { level: number; title: string; body: string[]; context: string[] } | null = null;

  const flush = () => {
    if (active === null) return;
    if (criteria.length >= maxCriteria) {
      throw new Error(`Native acceptance exceeds its ${maxCriteria}-criterion acceptance budget`);
    }
    criteria.push(
      criterion('spec-scenario', source, [active.title, ...active.body].join('\n'), active.context),
    );
    active = null;
  };

  for (const { line, body } of iterateScannedMarkdown(markdown)) {
    const heading = body ? markdownHeading(line) : null;
    const scenario = heading ? /^Scenario\s*:\s*(.*)$/iu.exec(heading.text) : null;
    if (scenario) {
      flush();
      while (ancestry.at(-1) && ancestry.at(-1)!.level >= heading!.level) ancestry.pop();
      const title = normalizeNativeAcceptanceText(scenario[1]);
      if (title.length === 0) throw new Error('Scenario title must not be empty');
      active = {
        level: heading!.level,
        title,
        body: [],
        context: ancestry.map((item) => item.text),
      };
    } else if (heading) {
      if (active !== null && heading.level <= active.level) flush();
      else if (active !== null) active.body.push(line);
      while (ancestry.at(-1) && ancestry.at(-1)!.level >= heading.level) ancestry.pop();
      ancestry.push(heading);
    } else if (active !== null && body) {
      active.body.push(line);
    }
  }
  flush();
  return uniqueCriteria(criteria, 'Specification');
}

function normalizeEvidenceRef(value: string, acceptanceId: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    hasControlCharacter(normalized) ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Acceptance evidence ${acceptanceId} has an unsafe evidence ref`);
  }
  const portable = path.posix.normalize(normalized);
  if (portable === '.' || portable === '..' || portable.startsWith('../')) {
    throw new Error(`Acceptance evidence ${acceptanceId} has an unsafe evidence ref`);
  }
  if (
    portable
      .split('/')
      .some(
        (segment) => segment.toLowerCase() === '.git' || segment.toLowerCase().startsWith('.env'),
      )
  ) {
    throw new Error(`Acceptance evidence ${acceptanceId} references sensitive content`);
  }
  return portable;
}

function evidenceRecord(value: unknown, index: number): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Acceptance evidence entry ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !EVIDENCE_ENTRY_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Acceptance evidence entry ${index} has unknown field(s): ${unknown.join(', ')}`,
    );
  }
  return record;
}

function validateEvidenceEntries(value: unknown): NativeAcceptanceEvidenceEntry[] {
  if (!Array.isArray(value))
    throw new Error('Native acceptance evidence block must be a JSON array');
  const seenIds = new Set<string>();
  return value.map((item, index) => {
    const record = evidenceRecord(item, index);
    const acceptanceId = record.acceptance_id;
    if (typeof acceptanceId !== 'string' || !ACCEPTANCE_ID_PATTERN.test(acceptanceId)) {
      throw new Error(`Acceptance evidence entry ${index} has an invalid acceptance_id`);
    }
    if (seenIds.has(acceptanceId)) {
      throw new Error(`Native acceptance evidence has duplicate acceptance_id: ${acceptanceId}`);
    }
    seenIds.add(acceptanceId);

    if (!Array.isArray(record.evidence_refs)) {
      throw new Error(`Acceptance evidence ${acceptanceId} requires an evidence_refs array`);
    }
    const evidenceRefs = record.evidence_refs.map((reference) => {
      if (typeof reference !== 'string' || reference.trim().length === 0) {
        throw new Error(`Acceptance evidence ${acceptanceId} has a non-empty string requirement`);
      }
      return normalizeEvidenceRef(reference, acceptanceId);
    });
    if (new Set(evidenceRefs).size !== evidenceRefs.length) {
      throw new Error(`Acceptance evidence ${acceptanceId} has a duplicate evidence ref`);
    }

    let skippedReason: string | undefined;
    if (Object.prototype.hasOwnProperty.call(record, 'skipped_reason')) {
      if (typeof record.skipped_reason !== 'string' || record.skipped_reason.trim().length === 0) {
        throw new Error(
          `Acceptance evidence ${acceptanceId} skipped_reason must be a non-empty string`,
        );
      }
      skippedReason = record.skipped_reason.trim();
    }
    if (evidenceRefs.length === 0 && skippedReason === undefined) {
      throw new Error(
        `Acceptance evidence ${acceptanceId} requires evidence_refs or skipped_reason`,
      );
    }
    if (evidenceRefs.length > 0 && skippedReason !== undefined) {
      throw new Error(
        `Acceptance evidence ${acceptanceId} must not include both evidence and a skip`,
      );
    }
    return {
      acceptance_id: acceptanceId,
      evidence_refs: evidenceRefs,
      ...(skippedReason === undefined ? {} : { skipped_reason: skippedReason }),
    };
  });
}

/** Parse the single fixed acceptance-evidence block from verification Markdown. */
export function parseNativeVerificationMachineBlock(
  markdown: string,
): NativeAcceptanceEvidenceEntry[] {
  const lines = scanMarkdown(markdown);
  const invalidContextMarker = lines.some(
    ({ line, body }) =>
      !body &&
      (line === NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER ||
        line === NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER),
  );
  if (invalidContextMarker) {
    throw new Error('Native acceptance evidence markers must be in the Markdown body');
  }
  const starts = lines.flatMap(({ line, body }, index) =>
    body && line === NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER ? [index] : [],
  );
  const ends = lines.flatMap(({ line, body }, index) =>
    body && line === NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER ? [index] : [],
  );
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error('Verification must contain exactly one Native acceptance evidence block');
  }
  if (starts[0] >= ends[0]) {
    throw new Error('Native acceptance evidence markers are out of order');
  }
  const payload = lines
    .slice(starts[0] + 1, ends[0])
    .map(({ line }) => line)
    .join('\n')
    .trim();
  if (payload.length === 0) throw new Error('Native acceptance evidence block is empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch (error) {
    throw new Error(
      `Native acceptance evidence block is invalid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const validated = validateEvidenceEntries(parsed);
  const canonicalPayload = canonicalEvidencePayload(validated);
  if (payload !== canonicalPayload) {
    throw new Error('Native acceptance evidence block must use canonical serialization');
  }
  return validated;
}

function canonicalEvidencePayload(entries: readonly unknown[]): string {
  const validated = validateEvidenceEntries([...entries])
    .map((entry) => ({ ...entry, evidence_refs: [...entry.evidence_refs].sort() }))
    .sort((left, right) => left.acceptance_id.localeCompare(right.acceptance_id));
  return JSON.stringify(validated, null, 2);
}

/** Serialize a validated, deterministic acceptance-evidence block for verification.md. */
export function serializeNativeVerificationMachineBlock(entries: readonly unknown[]): string {
  return [
    NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER,
    canonicalEvidencePayload(entries),
    NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER,
  ].join('\n');
}
