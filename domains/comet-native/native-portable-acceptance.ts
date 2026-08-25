import path from 'node:path';

import {
  deriveBriefAcceptanceCriteria,
  deriveSpecAcceptanceCriteria,
  normalizeNativeAcceptanceText,
} from './native-acceptance.js';

export interface NativePortableAcceptanceInput {
  source: string;
  text: string;
}

export interface NativePortableAcceptanceCriterion extends NativePortableAcceptanceInput {
  id: string;
}

export interface NativePortableSpecAcceptanceInput {
  capability: string;
  source: string;
  markdown: string;
}

const ACCEPTANCE_ID_PATTERN = /^A[1-9]\d*$/u;

function portableRef(value: string, label: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..') ||
    path.posix.normalize(value) !== value ||
    value === '.' ||
    value.endsWith('/')
  ) {
    throw new Error(`${label} must be a normalized change-relative ref`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

/**
 * Build the confirmed acceptance list without deriving identity from content.
 *
 * The existing Markdown scanner remains useful for excluding code/comments and
 * recognizing scenarios. Its legacy content-derived IDs are deliberately
 * discarded here; portable Native uses small sequential IDs only for result
 * mapping within the confirmed goal cycle.
 */
export function buildNativePortableAcceptance(options: {
  briefMarkdown: string;
  briefSource?: string;
  specs?: readonly NativePortableSpecAcceptanceInput[];
}): NativePortableAcceptanceCriterion[] {
  const briefSource = portableRef(options.briefSource ?? 'brief.md', 'Native brief source');
  const specs = [...(options.specs ?? [])].sort((left, right) =>
    compareText(left.capability, right.capability),
  );
  if (new Set(specs.map((entry) => entry.capability)).size !== specs.length) {
    throw new Error('Native acceptance sources contain duplicate capabilities');
  }

  const derived: NativePortableAcceptanceInput[] = deriveBriefAcceptanceCriteria(
    options.briefMarkdown,
    briefSource,
    Number.MAX_SAFE_INTEGER,
    'none',
  ).map(({ source, text }) => ({ source, text }));
  for (const spec of specs) {
    const source = portableRef(spec.source, `Native spec source for ${spec.capability}`);
    derived.push(
      ...deriveSpecAcceptanceCriteria(spec.markdown, source, Number.MAX_SAFE_INTEGER, 'none').map(
        ({ text }) => ({ source, text }),
      ),
    );
  }

  const seen = new Set<string>();
  for (const item of derived) {
    item.text = normalizeNativeAcceptanceText(item.text);
    const duplicateKey = `${item.source}\u0000${item.text}`;
    if (seen.has(duplicateKey)) {
      throw new Error(`Native acceptance contains a duplicate criterion: ${item.text}`);
    }
    seen.add(duplicateKey);
  }
  if (derived.length === 0) {
    throw new Error('Native change must define at least one acceptance criterion');
  }

  return derived.map((item, index) => ({
    id: `A${index + 1}`,
    source: item.source,
    text: item.text,
  }));
}

export function assertNativePortableAcceptanceIds(
  acceptance: readonly Pick<NativePortableAcceptanceCriterion, 'id'>[],
): void {
  const ids = acceptance.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Native acceptance IDs must be unique');
  }
  for (let index = 0; index < ids.length; index += 1) {
    if (!ACCEPTANCE_ID_PATTERN.test(ids[index]) || ids[index] !== `A${index + 1}`) {
      throw new Error('Native acceptance IDs must be the contiguous sequence A1..An');
    }
  }
}

export function sameNativePortableAcceptance(
  left: readonly NativePortableAcceptanceInput[],
  right: readonly NativePortableAcceptanceInput[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) => entry.source === right[index]?.source && entry.text === right[index]?.text,
    )
  );
}
