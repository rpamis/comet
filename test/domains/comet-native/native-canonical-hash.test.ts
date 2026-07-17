import { createHash } from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalHash,
  canonicalJson,
} from '../../../domains/comet-native/native-canonical-hash.js';

describe('Native canonical hashing', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({
        zebra: [{ second: 2, first: 1 }, 'last'],
        alpha: { z: true, a: null },
      }),
    ).toBe('{"alpha":{"a":null,"z":true},"zebra":[{"first":1,"second":2},"last"]}');

    expect(canonicalJson(['second', 'first'])).not.toBe(canonicalJson(['first', 'second']));
  });

  it('preserves Unicode text and uses deterministic UTF-16 key ordering', () => {
    expect(canonicalJson({ é: '雪', a: '😀' })).toBe('{"a":"😀","é":"雪"}');
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
  });

  it('uses JSON number spelling and canonicalizes negative zero', () => {
    expect(canonicalJson({ decimal: 1.25, exponent: 1e30, negativeZero: -0 })).toBe(
      '{"decimal":1.25,"exponent":1e+30,"negativeZero":0}',
    );
  });

  it('hashes the domain tag, newline, and canonical JSON exactly', () => {
    const value = { b: 2, a: 1 };
    const expected = createHash('sha256')
      .update('comet.native.test.v1\n{"a":1,"b":2}')
      .digest('hex');

    expect(canonicalHash('comet.native.test.v1', value)).toBe(expected);
    expect(canonicalHash('comet.native.other.v1', value)).not.toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => undefined],
    ['a symbol', Symbol('value')],
    ['a bigint', BigInt(1)],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['a Date', new Date('2026-07-17T00:00:00.000Z')],
    ['undefined in an object', { value: undefined }],
    ['undefined in an array', [undefined]],
  ])('rejects %s instead of silently dropping or coercing it', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow('not valid canonical JSON');
  });

  it('rejects sparse and cyclic structures but permits repeated non-cyclic references', () => {
    const sparse = new Array(1);
    expect(() => canonicalJson(sparse)).toThrow('sparse arrays');

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('cyclic structures');

    const shared = { stable: true };
    expect(canonicalJson({ left: shared, right: shared })).toBe(
      '{"left":{"stable":true},"right":{"stable":true}}',
    );
  });

  it('rejects numeric-looking properties that are not real array indexes', () => {
    const value: unknown[] = [];
    Object.assign(value, { 4294967295: 'hidden-from-array-map' });

    expect(Object.keys(value)).toEqual(['4294967295']);
    expect(() => canonicalJson(value)).toThrow('named enumerable properties');
  });

  it('rejects ambiguous domain tags', () => {
    expect(() => canonicalHash('', {})).toThrow('non-empty');
    expect(() => canonicalHash('line\nbreak', {})).toThrow('must not contain');
  });
});
