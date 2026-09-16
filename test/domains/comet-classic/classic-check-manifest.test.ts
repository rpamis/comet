import { describe, expect, it } from 'vitest';
import {
  checkManifestHash,
  compileCheckPolicyPattern,
  diffCheckManifests,
  hasGlobCharacters,
  parseCheckManifest,
  serializeCheckManifest,
} from '../../../domains/comet-classic/classic-check-manifest.js';

describe('Classic check manifests', () => {
  it('round-trips entries through a deterministic serialization', () => {
    const entries = [
      { p: 'src/b.ts', h: 'b'.repeat(64), s: 2, m: '200' },
      { p: 'src/a.ts', h: 'a'.repeat(64), s: 1, m: '100' },
      { p: '\u0000git:.:head', h: 'c'.repeat(64), s: null, m: null },
    ];
    const serialized = serializeCheckManifest(entries);
    expect(serialized.split('\n')).toHaveLength(3);
    expect(checkManifestHash(serialized)).toMatch(/^[a-f0-9]{64}$/);
    expect(parseCheckManifest(serialized)).toEqual(
      entries.slice().sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)),
    );
  });

  it('rejects malformed manifest lines', () => {
    expect(() => parseCheckManifest('{"p":"a.ts"}')).toThrow(/manifest/i);
    expect(() => parseCheckManifest('not json')).toThrow();
    expect(parseCheckManifest('')).toEqual([]);
  });

  it('reports added, removed and changed files by content hash only', () => {
    const baseline = [
      { p: 'kept.js', h: 'a', s: 1, m: '1' },
      { p: 'removed.js', h: 'b', s: 2, m: '2' },
      { p: 'changed.js', h: 'c', s: 3, m: '3' },
    ];
    const current = [
      { p: 'kept.js', h: 'a', s: 1, m: '9' },
      { p: 'changed.js', h: 'd', s: 3, m: '3' },
      { p: 'added.js', h: 'e', s: 4, m: '4' },
    ];
    expect(diffCheckManifests(baseline, current)).toEqual({
      added: ['added.js'],
      removed: ['removed.js'],
      changed: ['changed.js'],
    });
    expect(diffCheckManifests(baseline, baseline)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it('detects glob characters', () => {
    expect(hasGlobCharacters('src/**')).toBe(true);
    expect(hasGlobCharacters('src/a?b.ts')).toBe(true);
    expect(hasGlobCharacters('src/plain.ts')).toBe(false);
  });

  it.each([
    ['src/**', 'src/a.ts', true],
    ['src/**', 'src/nested/deep/b.ts', true],
    ['src/**', 'lib/a.ts', false],
    ['**/generated/**', 'src/generated/out.json', true],
    ['**/generated/**', 'generated/out.json', true],
    ['*.ts', 'a.ts', true],
    ['*.ts', 'src/a.ts', false],
    ['src/*.test.ts', 'src/a.test.ts', true],
    ['src/*.test.ts', 'src/nested/a.test.ts', false],
    ['src/a?c.ts', 'src/abc.ts', true],
    ['src/a?c.ts', 'src/a/c.ts', false],
    ['package.json', 'package.json', true],
    ['package.json', 'package.json.bak', false],
  ])('matches %s against %s as %s', (pattern, relative, expected) => {
    expect(compileCheckPolicyPattern(pattern)(relative)).toBe(expected);
  });
});
