import { assertNativeInputKeys } from './native-input-error.js';
import { NATIVE_ACCEPTANCE_REVIEW_STATUSES, nativeEnumText } from './native-input-enum.js';

export interface NativeBuilderAcceptanceReview {
  id: string;
  status:
    'implemented-with-evidence' | 'implemented-no-evidence' | 'not-implemented' | 'known-fail';
  evidence: string[];
  note: string;
}

export class NativeBuilderAcceptanceIncompleteError extends Error {
  constructor(
    readonly missingIds: string[],
    readonly incompleteIds: string[],
  ) {
    super(
      `Native Builder handoff is incomplete${missingIds.length ? `; missing: ${missingIds.join(', ')}` : ''}${incompleteIds.length ? `; not ready: ${incompleteIds.join(', ')}` : ''}. Complete acceptance_review for every requirement and its evidence before Verify`,
    );
  }
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4000 ||
    /^<[^>]+>$/u.test(value.trim())
  )
    throw new Error(`${label} must contain a concrete statement of at most 4000 characters`);
  return value.trim();
}

export function parseNativeBuilderAcceptanceReview(
  value: unknown,
  acceptance?: readonly { id: string }[],
  field = 'acceptance_review',
): NativeBuilderAcceptanceReview[] {
  if (!Array.isArray(value)) throw new Error(`Native Builder ${field} must be an array`);
  const errors: string[] = [];
  const read = <T>(parse: () => T): T | undefined => {
    try {
      return parse();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  const known = acceptance && new Set(acceptance.map(({ id }) => id));
  const ids: string[] = [];
  const unknownIds: { index: number; id: string }[] = [];
  const reviews = value.flatMap((entry: unknown, index) => {
    const label = `Native Builder ${field}[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`);
      return [];
    }
    const row = entry as Record<string, unknown>;
    read(() =>
      assertNativeInputKeys(row, ['id', 'status', 'evidence', 'note'], label, `/${field}/${index}`),
    );
    const id = read(() => text(row.id, `${label}.id`));
    if (id) {
      if (ids.includes(id)) errors.push(`${label}.id contains duplicate ID: ${id}`);
      ids.push(id);
      if (known && !known.has(id)) unknownIds.push({ index, id });
    }
    const detail = id && known?.has(id) ? label + ' (' + id + ')' : label;
    const status = read(() =>
      nativeEnumText(row.status, NATIVE_ACCEPTANCE_REVIEW_STATUSES, `${label}.status`),
    );
    let evidence: string[] | undefined;
    if (!Array.isArray(row.evidence))
      errors.push(
        `${detail}.evidence must be an array of concrete strings of at most 4000 characters; received ${typeof row.evidence}`,
      );
    else
      evidence = row.evidence
        .map((item, i) => read(() => text(item, `${label}.evidence[${i}]`)))
        .filter((item): item is string => item !== undefined);
    const note = read(() => text(row.note, `${detail}.note`));
    return id && status && evidence && note ? [{ id, status, evidence, note }] : [];
  });
  if (acceptance && !errors.length) {
    assertNativeBuilderAcceptanceComplete(acceptance, reviews);
    return reviews;
  }
  if (acceptance) {
    for (const { index, id } of unknownIds)
      errors.push(`Native Builder ${field}[${index}].id contains unknown ID: ${id}`);
    const missing = acceptance.filter(({ id }) => !ids.includes(id)).map(({ id }) => id);
    if (missing.length) errors.push(`Native Builder ${field} missing: ${missing.join(', ')}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return reviews;
}

export function assertNativeBuilderAcceptanceComplete(
  acceptance: readonly { id: string }[],
  review: readonly NativeBuilderAcceptanceReview[] | undefined,
): asserts review is NativeBuilderAcceptanceReview[] {
  if (!review)
    throw new NativeBuilderAcceptanceIncompleteError(
      acceptance.map(({ id }) => id),
      [],
    );
  const known = new Set(acceptance.map(({ id }) => id));
  const ids = review.map(({ id }) => id),
    reviewed = new Set(ids);
  if (reviewed.size !== ids.length)
    throw new Error('Native Builder acceptance_review contains duplicate IDs');
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length)
    throw new Error(`Native Builder acceptance_review contains unknown IDs: ${unknown.join(', ')}`);
  const missing = acceptance.filter(({ id }) => !reviewed.has(id)).map(({ id }) => id);
  const incomplete = review
    .filter((row) => row.status !== 'implemented-with-evidence' || row.evidence.length === 0)
    .map(({ id }) => id);
  if (missing.length || incomplete.length)
    throw new NativeBuilderAcceptanceIncompleteError(missing, incomplete);
}
