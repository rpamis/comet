import { describe, expect, it, vi } from 'vitest';
import {
  canonicalRuntimeJson,
  cloneRuntimeValue,
  hashRuntimeValue,
} from '../../../domains/engine/runtime-json.js';

describe('Runtime JSON snapshots', () => {
  it('preserves canonical JSON round-trip values and key order without serializing a clone', () => {
    const shared = { nested: ['\ud800', -0, Number.MAX_VALUE, Number.MIN_VALUE] };
    const value = Object.assign(Object.create(null), {
      z: shared,
      ä: shared,
      a: { '10': 'ten', '2': 'two', toJSON: 'ordinary data' },
    });
    Object.defineProperty(value, '__proto__', {
      value: { ordinary: true },
      enumerable: true,
    });
    const serialized = canonicalRuntimeJson(value);
    const expected = JSON.parse(serialized);
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');
    let cloned: ReturnType<typeof cloneRuntimeValue>;
    let serializationCount: number;
    try {
      cloned = cloneRuntimeValue(value);
      serializationCount = stringify.mock.calls.length + parse.mock.calls.length;
    } finally {
      stringify.mockRestore();
      parse.mockRestore();
    }
    expect(serializationCount).toBe(0);
    expect(cloned).toStrictEqual(expected);
    expect(Object.keys(cloned!)).toEqual(Object.keys(expected));
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(canonicalRuntimeJson(cloned)).toBe(serialized);
    expect(hashRuntimeValue(cloned)).toBe(hashRuntimeValue(expected));

    const snapshot = cloned as typeof value;
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true);
    expect(Object.is(snapshot.z.nested[1], 0)).toBe(true);
    expect(snapshot.z).not.toBe(shared);
    expect(snapshot.z).not.toBe(snapshot.ä);
    snapshot.z.nested[0] = 'changed';
    expect(snapshot.ä.nested[0]).toBe('\ud800');
    expect(shared.nested[0]).toBe('\ud800');
  });

  it('copies inherited array subclasses as plain JSON arrays without invoking their hooks', () => {
    const hook = vi.fn(() => {
      throw new Error('must not execute');
    });
    class CustomArray extends Array<number> {
      toJSON() {
        return hook();
      }
    }
    const values = new CustomArray(-0, 2);
    const cloned = cloneRuntimeValue(values);
    expect(cloned).toStrictEqual([0, 2]);
    expect(Object.getPrototypeOf(cloned)).toBe(Array.prototype);
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol(), () => true, new Date(), new Map()])(
    'rejects non-JSON values in both clone and canonical serialization: %s',
    (value) => {
      for (const input of [value, { value }, [value]]) {
        expect(() => cloneRuntimeValue(input)).toThrow(/INVALID_JSON/);
        expect(() => canonicalRuntimeJson(input)).toThrow(/INVALID_JSON/);
      }
    },
  );

  it('rejects executable, hidden and symbol properties without invoking getters or toJSON', () => {
    const hook = vi.fn(() => null);
    const getter = Object.defineProperty({}, 'value', { get: hook, enumerable: true });
    const arrayGetter = Object.defineProperty([1], '0', { get: hook });
    const hidden = Object.defineProperty({}, 'value', { value: 1 });
    const symbol = { [Symbol('hidden')]: 1 };
    const extraArray = Object.assign([1], { extra: 2 });
    for (const value of [getter, arrayGetter, hidden, symbol, extraArray, { toJSON: hook }]) {
      expect(() => cloneRuntimeValue(value)).toThrow(/INVALID_JSON/);
      expect(() => canonicalRuntimeJson(value)).toThrow(/INVALID_JSON/);
    }
    expect(hook).not.toHaveBeenCalled();
  });

  it('retains the same cycle, sparse array and nesting limits', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let nested: unknown = null;
    for (let index = 0; index < 64; index += 1) nested = { nested };
    expect(cloneRuntimeValue(nested)).toStrictEqual(JSON.parse(canonicalRuntimeJson(nested)));
    for (const value of [cyclic, new Array(2), { nested }]) {
      expect(() => cloneRuntimeValue(value)).toThrow(/INVALID_JSON/);
      expect(() => canonicalRuntimeJson(value)).toThrow(/INVALID_JSON/);
    }
  });
});
