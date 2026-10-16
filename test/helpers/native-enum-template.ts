/**
 * Test helpers for enumerated template placeholders (`<a|b|c>` strings that
 * list every legal value of an input field).
 */

const ENUM_PLACEHOLDER_PATTERN = /^<([^<>|]+(?:\|[^<>|]+)+)>$/u;

export function isNativeEnumPlaceholder(value: unknown): value is string {
  return typeof value === 'string' && ENUM_PLACEHOLDER_PATTERN.test(value);
}

/**
 * Replaces every `<a|b|c>` placeholder with its first listed option so a
 * copied template can be parsed by the real input contract.
 */
export function fillNativeEnumPlaceholders<T>(value: T): T {
  if (typeof value === 'string') {
    const match = ENUM_PLACEHOLDER_PATTERN.exec(value);
    return (match ? match[1].split('|')[0] : value) as T;
  }
  if (Array.isArray(value)) return value.map(fillNativeEnumPlaceholders) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, fillNativeEnumPlaceholders(entry)]),
    ) as T;
  }
  return value;
}
