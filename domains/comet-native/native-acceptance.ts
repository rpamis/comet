import path from 'node:path';

import { canonicalHash } from './native-canonical-hash.js';

const ACCEPTANCE_HASH_TAG = 'comet.native.acceptance.v1';
const ACCEPTANCE_ID_PATTERN = /^acceptance-[a-f0-9]{64}$/u;
const EVIDENCE_ENTRY_KEYS = new Set(['acceptance_id', 'evidence_refs', 'skipped_reason']);

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

function scanMarkdown(markdown: string): ScannedMarkdownLine[] {
  const scanned: ScannedMarkdownLine[] = [];
  let fence: FenceState | null = null;
  let htmlComment = false;
  let htmlTag: string | null = null;

  for (const line of markdown.replace(/\r\n?/gu, '\n').split('\n')) {
    const body = fence === null && !htmlComment && htmlTag === null;
    scanned.push({ line, body });

    if (fence !== null) {
      fence = nextFenceState(line, fence);
      continue;
    }
    if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
      continue;
    }
    if (htmlTag !== null) {
      if (new RegExp(`</${htmlTag}\\s*>`, 'iu').test(line)) htmlTag = null;
      continue;
    }

    const nextFence = nextFenceState(line, null);
    if (nextFence !== null) {
      fence = nextFence;
      continue;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) {
      htmlComment = true;
      continue;
    }
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
  return scanned;
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

function acceptanceSection(lines: ScannedMarkdownLine[]): ScannedMarkdownLine[] | null {
  const starts: number[] = [];
  let fence: FenceState | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const { line, body } = lines[index];
    if (fence === null && body) {
      const heading = markdownHeading(line);
      if (
        heading?.level === 1 &&
        heading.text.toLocaleLowerCase('en-US') === 'acceptance examples'
      ) {
        starts.push(index);
      }
    }
    fence = nextFenceState(line, fence);
  }
  if (starts.length === 0) return null;
  if (starts.length !== 1) {
    throw new Error('Brief must contain exactly one Acceptance examples section');
  }

  const start = starts[0] + 1;
  fence = null;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const { line, body } = lines[index];
    if (fence === null && body && markdownHeading(line)?.level === 1) {
      end = index;
      break;
    }
    fence = nextFenceState(line, fence);
  }
  return lines.slice(start, end);
}

/** Derive criteria from top-level list items in the brief's Acceptance examples section. */
export function deriveBriefAcceptanceCriteria(
  markdown: string,
  source = 'brief.md',
): NativeAcceptanceCriterion[] {
  const section = acceptanceSection(scanMarkdown(markdown));
  if (section === null) return [];

  const topLevelIndent = section.reduce<number | null>((minimum, { line, body }) => {
    const listItem = body ? /^( {0,3})[-*+][ \t]+/u.exec(line) : null;
    if (listItem === null) return minimum;
    const indent = listItem[1].length;
    return minimum === null ? indent : Math.min(minimum, indent);
  }, null);

  const items: string[][] = [];
  let active: string[] | null = null;
  for (const { line, body } of section) {
    const listItem = body ? /^( {0,3})[-*+][ \t]+(.*)$/u.exec(line) : null;
    if (listItem && listItem[1].length === topLevelIndent) {
      if (active !== null) items.push(active);
      active = [listItem[2]];
    } else if (active !== null) {
      active.push(line);
    }
  }
  if (active !== null) items.push(active);

  return uniqueCriteria(
    items.map((lines) => criterion('brief-example', source, lines.join('\n'))),
    'Brief',
  );
}

/** Derive criteria from explicit Markdown `Scenario:` heading blocks in a target spec. */
export function deriveSpecAcceptanceCriteria(
  markdown: string,
  source = 'spec.md',
): NativeAcceptanceCriterion[] {
  const criteria: NativeAcceptanceCriterion[] = [];
  const ancestry: MarkdownHeading[] = [];
  let active: { level: number; title: string; body: string[]; context: string[] } | null = null;

  const flush = () => {
    if (active === null) return;
    criteria.push(
      criterion('spec-scenario', source, [active.title, ...active.body].join('\n'), active.context),
    );
    active = null;
  };

  for (const { line, body } of scanMarkdown(markdown)) {
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
