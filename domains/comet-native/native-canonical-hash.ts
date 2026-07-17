import { createHash } from 'crypto';

function invalidCanonicalJson(detail: string): never {
  throw new TypeError(`Value is not valid canonical JSON: ${detail}`);
}

function canonicalArray(value: unknown[], ancestors: Set<object>): string {
  if (ancestors.has(value)) invalidCanonicalJson('cyclic structures are not supported');
  ancestors.add(value);
  try {
    const enumerableKeys = Object.keys(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        invalidCanonicalJson('sparse arrays are not supported');
      }
    }
    if (
      enumerableKeys.length !== value.length ||
      enumerableKeys.some((key, index) => key !== String(index))
    ) {
      invalidCanonicalJson('arrays must not have named enumerable properties');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      invalidCanonicalJson('symbol properties are not supported');
    }
    return `[${value.map((entry) => canonicalValue(entry, ancestors)).join(',')}]`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalObject(value: object, ancestors: Set<object>): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalidCanonicalJson('only plain objects are supported');
  }
  if (ancestors.has(value)) invalidCanonicalJson('cyclic structures are not supported');
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalidCanonicalJson('symbol properties are not supported');
  }

  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(value).sort();
    const fields = keys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        invalidCanonicalJson('accessor properties are not supported');
      }
      return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, ancestors)}`;
    });
    return `{${fields.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) invalidCanonicalJson('numbers must be finite');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object':
      return Array.isArray(value)
        ? canonicalArray(value, ancestors)
        : canonicalObject(value, ancestors);
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return invalidCanonicalJson(`${typeof value} values are not supported`);
  }
  return invalidCanonicalJson('unsupported value type');
}

/**
 * Serialize the JSON data model deterministically.
 *
 * Object keys use JavaScript's stable UTF-16 lexicographic ordering, arrays retain their
 * original order, strings retain their Unicode code points, and non-JSON values fail closed.
 */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set<object>());
}

/** Hash a canonical JSON value in an explicit domain. */
export function canonicalHash(tag: string, value: unknown): string {
  if (tag.length === 0) throw new TypeError('Canonical hash tag must be non-empty');
  if (/[\r\n]/u.test(tag)) {
    throw new TypeError('Canonical hash tag must not contain a line break');
  }
  return createHash('sha256')
    .update(`${tag}\n${canonicalJson(value)}`)
    .digest('hex');
}
