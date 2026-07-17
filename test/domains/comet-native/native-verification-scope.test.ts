import { describe, expect, it } from 'vitest';

import { buildNativeImplementationScope } from '../../../domains/comet-native/native-verification-scope.js';
import type {
  NativeContentSnapshotManifest,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
} from '../../../domains/comet-native/native-types.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function entry(entryPath: string, hash: string, size = 1): NativeSnapshotEntry {
  return { path: entryPath, hash, size, type: 'file' };
}

function manifest(
  options: {
    createdAt?: string;
    entries?: NativeSnapshotEntry[];
    omitted?: NativeSnapshotOmission[];
    omittedCount?: number;
    overflow?: NativeContentSnapshotManifest['omissionOverflow'];
    origin?: NativeContentSnapshotManifest['origin'];
  } = {},
): NativeContentSnapshotManifest {
  const omitted = options.omitted ?? [];
  const omittedCount = options.omittedCount ?? omitted.length;
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: options.origin ?? 'explicit',
    createdAt: options.createdAt ?? '2026-07-17T00:00:00.000Z',
    complete: omittedCount === 0,
    limits: {
      maxFiles: 100,
      maxFileBytes: 1_000,
      maxTotalBytes: 10_000,
      maxManifestBytes: 10_000,
    },
    entries: options.entries ?? [],
    omitted,
    omittedCount,
    ...(options.overflow ? { omissionOverflow: options.overflow } : {}),
  };
}

describe('Native implementation scope', () => {
  it('derives sorted added, modified, and removed content changes', () => {
    const result = buildNativeImplementationScope({
      baseline: manifest({
        entries: [entry('removed.ts', HASH_A), entry('modified.ts', HASH_A)],
      }),
      current: manifest({
        entries: [entry('modified.ts', HASH_B), entry('added.ts', HASH_C)],
      }),
      contractHash: 'contract-v1',
      declaredArtifacts: [
        { path: 'modified.ts', kind: 'file' },
        { path: 'added.ts', kind: 'file' },
        { path: 'removed.ts', kind: 'file' },
      ],
    });

    expect(result.changes.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: 'added.ts', kind: 'added' },
      { path: 'modified.ts', kind: 'modified' },
      { path: 'removed.ts', kind: 'removed' },
    ]);
    expect(result.complete).toBe(true);
    expect(result.unattributed).toEqual([]);
    expect(result.scopeHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('attributes exact files and directory ranges without prefix collisions', () => {
    const result = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest({
        entries: [
          entry('src/exact.ts', HASH_A),
          entry('src/features/a.ts', HASH_B),
          entry('src/features-extra/b.ts', HASH_C),
        ],
      }),
      contractHash: 'contract-v1',
      declaredArtifacts: [
        { path: 'src/exact.ts', kind: 'file' },
        { path: 'src/features', kind: 'directory' },
      ],
    });

    const byPath = new Map(result.changes.map((change) => [change.path, change]));
    expect(byPath.get('src/exact.ts')?.attributedTo).toEqual([
      { path: 'src/exact.ts', kind: 'file' },
    ]);
    expect(byPath.get('src/features/a.ts')?.attributedTo).toEqual([
      { path: 'src/features', kind: 'directory' },
    ]);
    expect(result.unattributed.map((change) => change.path)).toEqual(['src/features-extra/b.ts']);
    expect(result.complete).toBe(false);
    expect(result.unresolvedScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unattributed-change',
          path: 'src/features-extra/b.ts',
        }),
      ]),
    );
  });

  it('creates stable unresolved IDs for every omission, incompleteness, and overflow', () => {
    const omission: NativeSnapshotOmission = {
      path: 'large.bin',
      size: 2_000,
      type: 'file',
      reason: 'file-size',
    };
    const overflow = {
      ref: `native-snapshot://omitted-overflow/${HASH_C}`,
      hash: HASH_C,
      count: 2,
    } as const;
    const input = {
      baseline: manifest({ omitted: [omission], omittedCount: 3, overflow }),
      current: manifest(),
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: 'No tracked content changed.',
    };

    const first = buildNativeImplementationScope(input);
    const second = buildNativeImplementationScope({
      ...input,
      baseline: manifest({
        createdAt: '2030-01-01T00:00:00.000Z',
        omitted: [omission],
        omittedCount: 3,
        overflow,
      }),
    });

    expect(first.complete).toBe(false);
    expect(first.unresolvedScopes.map(({ kind }) => kind)).toEqual([
      'snapshot-incomplete',
      'snapshot-omission',
      'snapshot-omission-overflow',
    ]);
    expect(second.unresolvedScopes.map(({ id }) => id)).toEqual(
      first.unresolvedScopes.map(({ id }) => id),
    );
    expect(second.scopeHash).toBe(first.scopeHash);
  });

  it('requires a non-empty reason before a genuinely unchanged scope is complete', () => {
    const unchanged = manifest({ entries: [entry('src/a.ts', HASH_A)] });
    const missing = buildNativeImplementationScope({
      baseline: unchanged,
      current: { ...unchanged, createdAt: '2026-07-18T00:00:00.000Z' },
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: '   ',
    });
    const explained = buildNativeImplementationScope({
      baseline: unchanged,
      current: { ...unchanged, createdAt: '2026-07-18T00:00:00.000Z' },
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: ' Documentation-only review. ',
    });

    expect(missing.complete).toBe(false);
    expect(missing.unresolvedScopes).toEqual([
      expect.objectContaining({ kind: 'missing-no-code-reason' }),
    ]);
    expect(explained.complete).toBe(true);
    expect(explained.noCodeReason).toBe('Documentation-only review.');
  });

  it('does not let a no-code reason hide changed but unattributed content', () => {
    const result = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest({ entries: [entry('src/changed.ts', HASH_A)] }),
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: 'Claimed no-code change',
    });

    expect(result.complete).toBe(false);
    expect(result.unattributed).toHaveLength(1);
    expect(result.unresolvedScopes).toEqual([
      expect.objectContaining({ kind: 'unattributed-change', path: 'src/changed.ts' }),
    ]);
  });

  it('is invariant to timestamps and input array order', () => {
    const baselineEntries = [entry('z.ts', HASH_A), entry('a.ts', HASH_B)];
    const currentEntries = [entry('z.ts', HASH_C), entry('a.ts', HASH_B)];
    const first = buildNativeImplementationScope({
      baseline: manifest({
        createdAt: '2026-01-01T00:00:00.000Z',
        entries: baselineEntries,
      }),
      current: manifest({
        createdAt: '2026-02-01T00:00:00.000Z',
        entries: currentEntries,
      }),
      contractHash: 'contract-v1',
      declaredArtifacts: [
        { path: 'z.ts', kind: 'file' },
        { path: 'a.ts', kind: 'file' },
      ],
      gitChangedPaths: ['z.ts', 'a.ts'],
    });
    const reordered = buildNativeImplementationScope({
      baseline: manifest({
        createdAt: '2030-01-01T00:00:00.000Z',
        entries: [...baselineEntries].reverse(),
      }),
      current: manifest({
        createdAt: '2031-01-01T00:00:00.000Z',
        entries: [...currentEntries].reverse(),
      }),
      contractHash: 'contract-v1',
      declaredArtifacts: [
        { path: 'a.ts', kind: 'file' },
        { path: 'z.ts', kind: 'file' },
      ],
      gitChangedPaths: ['a.ts', 'z.ts'],
    });

    expect(reordered).toEqual(first);
  });

  it('changes the content address when content, contract, or ownership changes', () => {
    const baseInput = {
      baseline: manifest({ entries: [entry('src/a.ts', HASH_A)] }),
      current: manifest({ entries: [entry('src/a.ts', HASH_B)] }),
      contractHash: 'contract-v1',
      declaredArtifacts: [{ path: 'src/a.ts', kind: 'file' } as const],
    };
    const original = buildNativeImplementationScope(baseInput);
    const contentChanged = buildNativeImplementationScope({
      ...baseInput,
      current: manifest({ entries: [entry('src/a.ts', HASH_C)] }),
    });
    const contractChanged = buildNativeImplementationScope({
      ...baseInput,
      contractHash: 'contract-v2',
    });
    const ownershipChanged = buildNativeImplementationScope({
      ...baseInput,
      declaredArtifacts: [{ path: 'src', kind: 'directory' }],
    });

    expect(contentChanged.currentProjectionHash).not.toBe(original.currentProjectionHash);
    expect(contentChanged.scopeHash).not.toBe(original.scopeHash);
    expect(contractChanged.scopeHash).not.toBe(original.scopeHash);
    expect(ownershipChanged.scopeHash).not.toBe(original.scopeHash);
  });

  it('keeps Git paths advisory and never uses them to decide completeness', () => {
    const withoutGit = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest(),
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: 'Snapshots contain no changes.',
    });
    const withGit = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest(),
      contractHash: 'contract-v1',
      declaredArtifacts: [],
      noCodeReason: 'Snapshots contain no changes.',
      gitChangedPaths: ['outside-snapshot.ts'],
    });

    expect(withoutGit.complete).toBe(true);
    expect(withGit.complete).toBe(true);
    expect(withGit.changes).toEqual([]);
    expect(withGit.unresolvedScopes).toEqual([]);
    expect(withGit.gitAdvisory).toEqual({
      advisoryOnly: true,
      changedPaths: ['outside-snapshot.ts'],
      pathsPresentInSnapshotChanges: [],
      pathsAbsentFromSnapshotChanges: ['outside-snapshot.ts'],
    });
  });

  it.each([
    ['absolute POSIX path', '/outside.ts'],
    ['absolute Windows path', 'C:/outside.ts'],
    ['drive-relative Windows path', 'C:outside.ts'],
    ['parent traversal', '../outside.ts'],
    ['embedded traversal', 'src/../../outside.ts'],
    ['backslash path', 'src\\outside.ts'],
    ['trailing slash path', 'src/'],
  ])('rejects %s across declarations, snapshots, and Git hints', (_label, invalidPath) => {
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest(),
        current: manifest(),
        contractHash: 'contract-v1',
        declaredArtifacts: [{ path: invalidPath, kind: 'file' }],
        noCodeReason: 'No changes.',
      }),
    ).toThrow(/project root|project-relative/u);
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest({ entries: [entry(invalidPath, HASH_A)] }),
        current: manifest(),
        contractHash: 'contract-v1',
        declaredArtifacts: [],
      }),
    ).toThrow(/project root|project-relative/u);
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest(),
        current: manifest(),
        contractHash: 'contract-v1',
        declaredArtifacts: [],
        noCodeReason: 'No changes.',
        gitChangedPaths: [invalidPath],
      }),
    ).toThrow(/project root|project-relative/u);
  });

  it('rejects conflicting declaration kinds and duplicate snapshot paths', () => {
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest(),
        current: manifest(),
        contractHash: 'contract-v1',
        declaredArtifacts: [
          { path: 'src/a.ts', kind: 'file' },
          { path: 'src/a.ts', kind: 'directory' },
        ],
        noCodeReason: 'No changes.',
      }),
    ).toThrow('conflicting kinds');

    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest({ entries: [entry('a.ts', HASH_A), entry('a.ts', HASH_A)] }),
        current: manifest(),
        contractHash: 'contract-v1',
        declaredArtifacts: [],
      }),
    ).toThrow('duplicate paths');
  });
});
