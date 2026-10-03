import { assertNativeInputKeys } from './native-input-error.js';

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
  ) {
    throw new Error(`${label} must contain a concrete statement of at most 4000 characters`);
  }
  return value.trim();
}

export function parseNativeBuilderAcceptanceReview(
  value: unknown,
): NativeBuilderAcceptanceReview[] {
  if (!Array.isArray(value)) throw new Error('Native Builder acceptance_review must be an array');
  return value.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Native Builder acceptance review entry must be an object');
    const row = entry as Record<string, unknown>;
    const label = `Native Builder acceptance_review[${index}]`;
    assertNativeInputKeys(
      row,
      ['id', 'status', 'evidence', 'note'],
      label,
      `/acceptance_review/${index}`,
    );
    const status = row.status as NativeBuilderAcceptanceReview['status'];
    if (
      ![
        'implemented-with-evidence',
        'implemented-no-evidence',
        'not-implemented',
        'known-fail',
      ].includes(status)
    )
      throw new Error(`${label}.status is invalid`);
    if (!Array.isArray(row.evidence)) throw new Error(`${label}.evidence must be an array`);
    return {
      id: text(row.id, `${label}.id`),
      status,
      evidence: row.evidence.map((value) => text(value, `${label}.evidence`)),
      note: text(row.note, `${label}.note`),
    };
  });
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
  const ids = review.map(({ id }) => id);
  const reviewed = new Set(ids);
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
