import { describe, expect, it } from 'vitest';

import {
  hasComparableNativeFileObject,
  sameNativeFileObject,
} from '../../../domains/comet-native/native-file-identity.js';

describe('Native file object identity', () => {
  it('requires a complete device and inode pair before metadata can be skipped', () => {
    const left = { dev: 7, ino: 0, birthtime: 100 };
    const right = { dev: 7, ino: 0, birthtime: 200 };

    expect(hasComparableNativeFileObject(left, right)).toBe(false);
    expect(sameNativeFileObject(left, right)).toBe(false);
  });

  it('uses matching inode and birth time when one Windows device id is unavailable', () => {
    const pathStat = { dev: 0, ino: 42, birthtime: 100 };
    const handleStat = { dev: 7, ino: 42, birthtime: 100 };

    expect(hasComparableNativeFileObject(pathStat, handleStat)).toBe(false);
    expect(sameNativeFileObject(pathStat, handleStat)).toBe(true);
    expect(sameNativeFileObject(pathStat, { ...handleStat, ino: 43 })).toBe(false);
  });
});
