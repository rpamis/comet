import path from 'node:path';

import {
  deriveBriefAcceptanceCriteria,
  deriveLegacyBriefAcceptanceCriteria,
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
 * Markdown 解析负责确定条目和场景的正文归属。这里不沿用内容哈希 ID；
 * Portable Native 的连续 ID 只映射当前已确认目标周期内的验收结果。
 */
export function buildNativePortableAcceptance(options: {
  briefMarkdown: string;
  briefSource?: string;
  /** Enable references only at the versioned Shape boundary; legacy callers retain their IDs. */
  resolveBriefReferences?: boolean;
  specs?: readonly NativePortableSpecAcceptanceInput[];
  /** 只核对已持久化的旧确认快照，不用于创建新 Shape。 */
  legacyBriefBoundaries?: boolean;
}): NativePortableAcceptanceCriterion[] {
  const briefSource = portableRef(options.briefSource ?? 'brief.md', 'Native brief source');
  const specs = [...(options.specs ?? [])].sort((left, right) =>
    compareText(left.capability, right.capability),
  );
  if (new Set(specs.map((entry) => entry.capability)).size !== specs.length) {
    throw new Error('Native acceptance sources contain duplicate capabilities');
  }

  const deriveBrief = options.legacyBriefBoundaries
    ? deriveLegacyBriefAcceptanceCriteria
    : deriveBriefAcceptanceCriteria;
  const derived: NativePortableAcceptanceInput[] = deriveBrief(
    options.briefMarkdown,
    briefSource,
    Number.MAX_SAFE_INTEGER,
    'none',
  ).map(({ source, text }) => ({ source, text }));
  const briefCount = derived.length;
  for (const spec of specs) {
    const source = portableRef(spec.source, `Native spec source for ${spec.capability}`);
    for (const scenario of deriveSpecAcceptanceCriteria(
      spec.markdown,
      source,
      Number.MAX_SAFE_INTEGER,
      'none',
      { resolveBriefReferences: options.resolveBriefReferences === true },
    )) {
      if (scenario.briefAcceptanceRef !== undefined) {
        const index = Number(scenario.briefAcceptanceRef.slice(1)) - 1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= briefCount) {
          throw new Error(
            `Native Spec references unknown brief acceptance ${scenario.briefAcceptanceRef}: ${source}`,
          );
        }
        continue;
      }
      derived.push({ source, text: scenario.text });
    }
  }

  const seen = new Set<string>();
  for (const item of derived) {
    item.text = normalizeNativeAcceptanceText(item.text);
    // A criterion is a user-visible behavior, not a source-file location.
    // Brief and Spec can therefore not create two formal checks for the same
    // normalized sentence. This runs only while preparing a new Shape; an
    // archived state keeps its persisted A1..An identities unchanged.
    const duplicateKey = item.text;
    if (seen.has(duplicateKey)) {
      throw new Error(`Native acceptance contains a duplicate criterion: ${item.text}`);
    }
    seen.add(duplicateKey);
  }
  if (derived.length === 0) {
    throw new Error(
      `Native change must define at least one acceptance criterion. In ${briefSource}, write each criterion as a top-level Markdown list item under Acceptance examples, for example: "- Input hello prints Words: 1." Keep requested tables; a table alone does not create formal acceptance items. Alternatively use complete Scenario: blocks in the target Specs. Add the explicit criteria without changing their meaning, then retry the same Shape step; do not recreate the change.`,
    );
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
