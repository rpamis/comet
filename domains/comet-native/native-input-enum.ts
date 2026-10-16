/**
 * Single source of truth for enumerated Native runner-input values.
 *
 * Validation sites, continuation templates, and state parsing must all derive
 * their legal values from these constants so the sets cannot drift apart.
 */

export const NATIVE_BUILDER_CHECK_RESULTS = ['passed', 'failed', 'not-run'] as const;

export const NATIVE_VERIFIER_VERDICTS = ['pass', 'fail', 'blocked'] as const;

export const NATIVE_VERIFIER_ACCEPTANCE_RESULTS = ['passed', 'failed', 'blocked'] as const;

export const NATIVE_ACCEPTANCE_REVIEW_STATUSES = [
  'implemented-with-evidence',
  'implemented-no-evidence',
  'not-implemented',
  'known-fail',
] as const;

export const NATIVE_VERIFIER_RESPONSE_KINDS = ['final-result', 'request-checks'] as const;

export const NATIVE_RUNNER_INPUT_KINDS = [
  'builder-handoff',
  'dispatch-verifier',
  'retry-checks',
  'verifier-response',
  'verifier-started',
  'verifier-execution-error',
  'verifier-unavailable',
  'supervisor-builder-result',
  'supervisor-builder-failure',
  'supervisor-retry-builder',
  'supervisor-reconnect',
  'supervisor-cancel',
  'supervisor-verifier-result',
  'supervisor-checks',
  'supervisor-integrate',
] as const;

/**
 * Validates an enumerated input value and names every legal value in the error
 * so a rejected submission is self-explanatory without reading source code.
 */
export function nativeEnumText<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

/**
 * Template placeholder listing every legal value of an enumerated field, for
 * example `<passed|failed|not-run>`. Templates pair this with
 * {@link nativeEnumText} so the placeholder always matches the validator.
 */
export function nativeEnumPlaceholder<T extends readonly string[]>(allowed: T): string {
  return `<${allowed.join('|')}>`;
}
