import { describe, expect, it } from 'vitest';

import { canonicalHash } from '../../../domains/comet-native/native-canonical-hash.js';
import {
  buildNativeImplementationScopeBundle,
  buildNativeImplementationScope,
  MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
  NATIVE_IMPLEMENTATION_SCOPE_SCHEMA,
  parseNativeImplementationScopeBundle,
  parseNativeImplementationScope,
} from '../../../domains/comet-native/native-verification-scope.js';
import type {
  NativeContentSnapshotManifest,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
} from '../../../domains/comet-native/native-types.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function overflowGitSelection(combinedHash: string) {
  return {
    schema: 'comet.native.git-selection.v1' as const,
    status: 'overflow' as const,
    stageBefore: {
      hash: HASH_A,
      recordCount: 1,
      storedRecordCount: 1,
      stdoutBytes: 80,
      overflow: false,
    },
    combined: {
      hash: combinedHash,
      recordCount: 200,
      storedRecordCount: 128,
      stdoutBytes: 10_000,
      overflow: true,
    },
    stageAfter: {
      hash: HASH_A,
      recordCount: 1,
      storedRecordCount: 1,
      stdoutBytes: 80,
      overflow: false,
    },
    finalStageBefore: {
      hash: HASH_A,
      recordCount: 1,
      storedRecordCount: 1,
      stdoutBytes: 80,
      overflow: false,
    },
    finalCombined: {
      hash: combinedHash,
      recordCount: 200,
      storedRecordCount: 128,
      stdoutBytes: 10_000,
      overflow: true,
    },
    finalStageAfter: {
      hash: HASH_A,
      recordCount: 1,
      storedRecordCount: 1,
      stdoutBytes: 80,
      overflow: false,
    },
  };
}

function changedPhysicalSelection(afterHash: string) {
  return {
    schema: 'comet.native.physical-selection.v1' as const,
    status: 'changed' as const,
    before: {
      hash: HASH_A,
      visitedNodeCount: 1,
      recordCount: 1,
      storedRecordCount: 1,
      encodedBytes: 16,
      overflow: false,
      unstable: false,
    },
    after: {
      hash: afterHash,
      visitedNodeCount: 1,
      recordCount: 1,
      storedRecordCount: 1,
      encodedBytes: 16,
      overflow: false,
      unstable: false,
    },
  };
}

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
    capture?: NativeContentSnapshotManifest['capture'];
  } = {},
): NativeContentSnapshotManifest {
  const omitted = options.omitted ?? [];
  const omittedCount = options.omittedCount ?? omitted.length;
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: options.origin ?? 'explicit',
    ...(options.capture ? { capture: options.capture } : {}),
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
      contractHash: HASH_B,
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

  it('does not infer removals from paths absent in an incomplete current snapshot', () => {
    const result = buildNativeImplementationScope({
      baseline: manifest({
        entries: [entry('src/stable.ts', HASH_A), entry('src/unknown.ts', HASH_B)],
      }),
      current: manifest({
        entries: [entry('src/stable.ts', HASH_C)],
        omitted: [
          {
            path: 'src/unknown.ts',
            size: null,
            type: 'file',
            reason: 'changed-during-read',
          },
        ],
      }),
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'src', kind: 'directory' }],
    });

    expect(result.changes.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: 'src/stable.ts', kind: 'modified' },
    ]);
    expect(result.unresolvedScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'snapshot-incomplete', source: 'current' }),
        expect.objectContaining({ kind: 'snapshot-omission', path: 'src/unknown.ts' }),
      ]),
    );
  });

  it('does not infer removals when current omissions exist only in overflow metadata', () => {
    const overflow = {
      ref: `native-snapshot://omitted-overflow/${HASH_C}`,
      hash: HASH_C,
      count: 1,
    } as const;
    const result = buildNativeImplementationScope({
      baseline: manifest({ entries: [entry('src/unknown.ts', HASH_A)] }),
      current: manifest({ omittedCount: 1, overflow }),
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'src/unknown.ts', kind: 'file' }],
    });

    expect(result.changes).toEqual([]);
    expect(result.unresolvedScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'snapshot-incomplete', source: 'current' }),
        expect.objectContaining({ kind: 'snapshot-omission-overflow', source: 'current' }),
      ]),
    );
  });

  it('preserves a root-level Git enumeration omission as bounded partial evidence', () => {
    const bundle = buildNativeImplementationScopeBundle({
      baseline: manifest(),
      current: manifest({
        capture: { provider: 'git', gitSelection: overflowGitSelection(HASH_C) },
        omitted: [
          {
            path: '.',
            size: null,
            type: 'directory',
            reason: 'git-enumeration-limit',
          },
        ],
      }),
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: 'No selected content changed.',
    });

    expect(bundle.scope.unresolvedScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'snapshot-omission', path: '.', source: 'current' }),
      ]),
    );
    expect(parseNativeImplementationScopeBundle(bundle)).toEqual(bundle);
  });

  it('binds Git selection evidence into the snapshot projection and scope hashes', () => {
    const current = (combinedHash: string) =>
      manifest({
        capture: { provider: 'git', gitSelection: overflowGitSelection(combinedHash) },
        omitted: [
          {
            path: '.',
            size: null,
            type: 'directory',
            reason: 'git-enumeration-limit',
          },
        ],
      });
    const authority = {
      baseline: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [] as const,
      noCodeReason: 'No selected content changed.',
    };
    const first = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_B),
    });
    const second = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_C),
    });

    expect(first.current.capture?.gitSelection?.combined.hash).toBe(HASH_B);
    expect(second.scope.currentProjectionHash).not.toBe(first.scope.currentProjectionHash);
    expect(second.scope.scopeHash).not.toBe(first.scope.scopeHash);
    expect(parseNativeImplementationScopeBundle(first)).toEqual(first);
  });

  it('binds legacy physical-to-Git projection evidence into scope hashes', () => {
    const current = (combinedHash: string) =>
      manifest({
        capture: {
          provider: 'physical-tree',
          projection: {
            provider: 'git',
            selection: overflowGitSelection(combinedHash),
          },
        },
        omitted: [
          {
            path: '.',
            size: null,
            type: 'directory',
            reason: 'git-enumeration-limit',
          },
        ],
      });
    const authority = {
      baseline: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [] as const,
      noCodeReason: 'No selected content changed.',
    };
    const first = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_B),
    });
    const second = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_C),
    });

    expect(first.current.capture?.projection?.selection?.combined.hash).toBe(HASH_B);
    expect(second.scope.currentProjectionHash).not.toBe(first.scope.currentProjectionHash);
    expect(second.scope.scopeHash).not.toBe(first.scope.scopeHash);
    expect(parseNativeImplementationScopeBundle(first)).toEqual(first);
  });

  it('binds physical selection evidence into the snapshot projection and scope hashes', () => {
    const current = (afterHash: string) =>
      manifest({
        capture: {
          provider: 'physical-tree',
          physicalSelection: changedPhysicalSelection(afterHash),
        },
        omitted: [
          {
            path: '.',
            size: null,
            type: 'directory',
            reason: 'physical-selection-changed',
          },
        ],
      });
    const authority = {
      baseline: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [] as const,
      noCodeReason: 'No selected content changed.',
    };
    const first = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_B),
    });
    const second = buildNativeImplementationScopeBundle({
      ...authority,
      current: current(HASH_C),
    });

    expect(first.current.capture?.physicalSelection?.after.hash).toBe(HASH_B);
    expect(second.scope.currentProjectionHash).not.toBe(first.scope.currentProjectionHash);
    expect(second.scope.scopeHash).not.toBe(first.scope.scopeHash);
    expect(parseNativeImplementationScopeBundle(first)).toEqual(first);
  });

  it('never compacts away a root-level physical selection blocker', () => {
    const omitted = Array.from({ length: 999 }, (_, index) => ({
      path:
        'generated/omitted-' + String(index).padStart(4, '0') + '-' + 'x'.repeat(1_200) + '.bin',
      size: 2_000,
      type: 'file' as const,
      reason: 'file-size' as const,
    }));
    const rootSelectionBlocker: NativeSnapshotOmission = {
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-selection-changed',
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: manifest(),
      current: {
        ...manifest({
          capture: {
            provider: 'physical-tree',
            physicalSelection: changedPhysicalSelection(HASH_B),
          },
          omitted: [rootSelectionBlocker, ...omitted],
        }),
        limits: {
          maxFiles: 100,
          maxFileBytes: 1_000,
          maxTotalBytes: 10_000,
          maxManifestBytes: 8 * 1024 * 1024,
        },
      },
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: 'No selected content changed.',
    });

    expect(bundle.current.omitted).toContainEqual(rootSelectionBlocker);
    expect(bundle.current.omissionOverflow).toBeDefined();
    expect(bundle.scope.unresolvedScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'snapshot-omission',
          path: '.',
          source: 'current',
        }),
      ]),
    );
    expect(parseNativeImplementationScopeBundle(bundle)).toEqual(bundle);
  });

  it('keeps a complete Git scope stable when only staging state changes', () => {
    const unchangedWorkingTree = manifest({
      capture: { provider: 'git' },
      entries: [entry('src/feature.ts', HASH_A)],
    });
    const authority = {
      baseline: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' as const }],
    };
    const beforeStaging = buildNativeImplementationScopeBundle({
      ...authority,
      current: unchangedWorkingTree,
    });
    const afterStaging = buildNativeImplementationScopeBundle({
      ...authority,
      current: { ...unchangedWorkingTree, createdAt: '2030-01-01T00:00:00.000Z' },
    });

    expect(beforeStaging.current.capture).toEqual({ provider: 'git' });
    expect(afterStaging.scope.currentProjectionHash).toBe(
      beforeStaging.scope.currentProjectionHash,
    );
    expect(afterStaging.scope.scopeHash).toBe(beforeStaging.scope.scopeHash);
  });

  it('summarizes oversized change details into a stable bounded unresolved scope', () => {
    const entries = Array.from({ length: 500 }, (_, index) =>
      entry(`generated/${String(index).padStart(4, '0')}-${'x'.repeat(80)}.ts`, HASH_A),
    );
    const largeManifest = (values: NativeSnapshotEntry[]): NativeContentSnapshotManifest => ({
      ...manifest(),
      limits: {
        maxFiles: 1_000,
        maxFileBytes: 1_000,
        maxTotalBytes: 1_000_000,
        maxManifestBytes: 1_000_000,
      },
      entries: values,
    });
    const input = {
      baseline: largeManifest([]),
      current: largeManifest(entries),
      contractHash: HASH_B,
      declaredArtifacts: [] as const,
    };

    const first = buildNativeImplementationScopeBundle(input);
    const second = buildNativeImplementationScopeBundle(input);
    const overflow = first.scope.unresolvedScopes.find(
      (scope) => scope.kind === 'scope-detail-overflow',
    );

    expect(first.scope.changes.length).toBeLessThan(entries.length);
    expect(first.scope.unattributed.length).toBeLessThan(entries.length);
    expect(overflow).toMatchObject({
      source: 'implementation-scope',
      path: null,
      reason: expect.stringMatching(/additional change details/iu),
    });
    expect(Buffer.byteLength(JSON.stringify(first.scope, null, 2) + '\n')).toBeLessThanOrEqual(
      1024 * 1024,
    );
    expect(second).toEqual(first);
    expect(parseNativeImplementationScopeBundle(first)).toEqual(first);
  });

  it('bounds long omission details by serialized bytes and folds the remainder stably', () => {
    const omitted = Array.from({ length: 1_000 }, (_, index) => ({
      path: `generated/omitted-${String(index).padStart(4, '0')}-${'x'.repeat(450)}.bin`,
      size: 2_000,
      type: 'file' as const,
      reason: 'file-size' as const,
    }));
    const largeOmissionManifest: NativeContentSnapshotManifest = {
      ...manifest(),
      complete: false,
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000,
        maxManifestBytes: 8 * 1024 * 1024,
      },
      omitted,
      omittedCount: omitted.length,
    };
    const input = {
      baseline: largeOmissionManifest,
      current: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [] as const,
      noCodeReason: 'No readable project content changed.',
    };

    const first = buildNativeImplementationScopeBundle(input);
    const second = buildNativeImplementationScopeBundle(input);

    expect(
      first.scope.unresolvedScopes.filter((scope) => scope.kind === 'snapshot-omission').length,
    ).toBeLessThan(omitted.length);
    expect(first.scope.unresolvedScopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'scope-detail-overflow' })]),
    );
    expect(
      [first.baseline, first.current, first.scope].every(
        (document) =>
          Buffer.byteLength(JSON.stringify(document, null, 2) + '\n', 'utf8') <=
          MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
      ),
    ).toBe(true);
    expect(second).toEqual(first);
    expect(parseNativeImplementationScopeBundle(first)).toEqual(first);
  });

  it('binds the content hashes of entries folded into projection overflow', () => {
    const entries = Array.from({ length: 2_500 }, (_, index) =>
      entry(`generated/${String(index).padStart(4, '0')}-${'x'.repeat(450)}.ts`, HASH_A),
    );
    const oversizedManifest = (values: NativeSnapshotEntry[]): NativeContentSnapshotManifest => ({
      ...manifest(),
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000_000,
        maxManifestBytes: 8 * 1024 * 1024,
      },
      entries: values,
    });
    const authority = {
      baseline: oversizedManifest([]),
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'generated', kind: 'directory' as const }],
    };
    const first = buildNativeImplementationScopeBundle({
      ...authority,
      current: oversizedManifest(entries),
    });
    const sameSizeContentChange = entries.map((value, index) =>
      index === entries.length - 1 ? { ...value, hash: HASH_C } : value,
    );
    const second = buildNativeImplementationScopeBundle({
      ...authority,
      current: oversizedManifest(sameSizeContentChange),
    });

    expect(first.current.omissionOverflow).toBeDefined();
    expect(first.current.entries.some((value) => value.path === entries.at(-1)!.path)).toBe(false);
    expect(second.current.omissionOverflow?.hash).not.toBe(first.current.omissionOverflow?.hash);
    expect(second.scope.currentProjectionHash).not.toBe(first.scope.currentProjectionHash);
    expect(second.scope.scopeHash).not.toBe(first.scope.scopeHash);
  });

  it('keeps a Git path present when its snapshot change is beyond the detailed prefix', () => {
    const entries = Array.from({ length: 200 }, (_, index) =>
      entry(`generated/${String(index).padStart(4, '0')}.ts`, HASH_A),
    );
    const current: NativeContentSnapshotManifest = {
      ...manifest(),
      limits: {
        maxFiles: 1_000,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000,
        maxManifestBytes: 1_000_000,
      },
      entries,
    };
    const lastPath = entries.at(-1)!.path;
    const bundle = buildNativeImplementationScopeBundle({
      baseline: manifest(),
      current,
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'generated', kind: 'directory' }],
      gitChangedPaths: [lastPath],
    });

    expect(bundle.scope.changes).toHaveLength(128);
    expect(bundle.scope.gitAdvisory).toEqual({
      advisoryOnly: true,
      changedPaths: [lastPath],
      pathsPresentInSnapshotChanges: [lastPath],
      pathsAbsentFromSnapshotChanges: [],
    });
    expect(parseNativeImplementationScopeBundle(bundle)).toEqual(bundle);
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
      contractHash: HASH_B,
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
      contractHash: HASH_B,
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
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: '   ',
    });
    const explained = buildNativeImplementationScope({
      baseline: unchanged,
      current: { ...unchanged, createdAt: '2026-07-18T00:00:00.000Z' },
      contractHash: HASH_B,
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
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: 'Claimed no-code change',
    });

    expect(result.complete).toBe(false);
    expect(result.unattributed).toHaveLength(1);
    expect(result.unresolvedScopes).toEqual([
      expect.objectContaining({ kind: 'unattributed-change', path: 'src/changed.ts' }),
    ]);
  });

  it('does not let a self-rehashed persisted document erase unresolved implementation work', () => {
    const original = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest({ entries: [entry('src/changed.ts', HASH_A)] }),
      contractHash: HASH_B,
      declaredArtifacts: [],
    });
    const forged = structuredClone(original);
    forged.complete = true;
    forged.unattributed = [];
    forged.unresolvedScopes = [];
    const content = { ...forged } as Partial<typeof forged>;
    delete content.scopeHash;
    forged.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);

    expect(() => parseNativeImplementationScope(forged)).toThrow(
      /unattributed changes|derived scopes|unresolved scopes/iu,
    );
  });

  it('rebuilds snapshot omissions instead of trusting a self-rehashed complete scope', () => {
    const omission: NativeSnapshotOmission = {
      path: 'secret.ts',
      size: 1,
      type: 'file',
      reason: 'file-size',
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: manifest({ omitted: [omission] }),
      current: manifest(),
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: 'No visible content changed.',
    });
    const forged = structuredClone(bundle);
    forged.scope.complete = true;
    forged.scope.unresolvedScopes = [];
    const content = { ...forged.scope } as Partial<typeof forged.scope>;
    delete content.scopeHash;
    forged.scope.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);

    expect(() => parseNativeImplementationScope(forged.scope)).not.toThrow();
    expect(() => parseNativeImplementationScopeBundle(forged)).toThrow(
      'does not match its authoritative bundle',
    );
  });

  it('does not let a caller rewrite scope attribution outside the build authority', () => {
    const bundle = buildNativeImplementationScopeBundle({
      baseline: manifest(),
      current: manifest({ entries: [entry('src/changed.ts', HASH_A)] }),
      contractHash: HASH_B,
      declaredArtifacts: [],
    });
    const forged = structuredClone(bundle);
    const declaration = { path: 'src/changed.ts', kind: 'file' as const };
    forged.scope.declaredArtifacts = [declaration];
    forged.scope.changes[0].attributedTo = [declaration];
    forged.scope.unattributed = [];
    forged.scope.unresolvedScopes = [];
    forged.scope.complete = true;
    const content = { ...forged.scope } as Partial<typeof forged.scope>;
    delete content.scopeHash;
    forged.scope.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);

    expect(() => parseNativeImplementationScope(forged.scope)).not.toThrow();
    expect(() => parseNativeImplementationScopeBundle(forged)).toThrow(
      'does not match its authoritative bundle',
    );
  });

  it('is invariant to timestamps and input array order', () => {
    const baselineEntries = [entry('z.ts', HASH_A), entry('a.ts', HASH_B)];
    const currentEntries = [entry('z.ts', HASH_C), entry('a.ts', HASH_B)];
    const firstBundle = buildNativeImplementationScopeBundle({
      baseline: manifest({
        createdAt: '2026-01-01T00:00:00.000Z',
        entries: baselineEntries,
      }),
      current: manifest({
        createdAt: '2026-02-01T00:00:00.000Z',
        entries: currentEntries,
      }),
      contractHash: HASH_B,
      declaredArtifacts: [
        { path: 'z.ts', kind: 'file' },
        { path: 'a.ts', kind: 'file' },
      ],
      gitChangedPaths: ['z.ts', 'a.ts'],
    });
    const reorderedBundle = buildNativeImplementationScopeBundle({
      baseline: manifest({
        createdAt: '2030-01-01T00:00:00.000Z',
        entries: [...baselineEntries].reverse(),
      }),
      current: manifest({
        createdAt: '2031-01-01T00:00:00.000Z',
        entries: [...currentEntries].reverse(),
      }),
      contractHash: HASH_B,
      declaredArtifacts: [
        { path: 'a.ts', kind: 'file' },
        { path: 'z.ts', kind: 'file' },
      ],
      gitChangedPaths: ['a.ts', 'z.ts'],
    });

    expect(reorderedBundle).toEqual(firstBundle);
    expect(reorderedBundle.scope.baselineProjectionRef).toBe(
      firstBundle.scope.baselineProjectionRef,
    );
    expect(reorderedBundle.scope.currentProjectionRef).toBe(firstBundle.scope.currentProjectionRef);
  });

  it('changes the content address when content, contract, or ownership changes', () => {
    const baseInput = {
      baseline: manifest({ entries: [entry('src/a.ts', HASH_A)] }),
      current: manifest({ entries: [entry('src/a.ts', HASH_B)] }),
      contractHash: HASH_B,
      declaredArtifacts: [{ path: 'src/a.ts', kind: 'file' } as const],
    };
    const original = buildNativeImplementationScope(baseInput);
    const contentChanged = buildNativeImplementationScope({
      ...baseInput,
      current: manifest({ entries: [entry('src/a.ts', HASH_C)] }),
    });
    const contractChanged = buildNativeImplementationScope({
      ...baseInput,
      contractHash: HASH_C,
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
      contractHash: HASH_B,
      declaredArtifacts: [],
      noCodeReason: 'Snapshots contain no changes.',
    });
    const withGit = buildNativeImplementationScope({
      baseline: manifest(),
      current: manifest(),
      contractHash: HASH_B,
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
        contractHash: HASH_B,
        declaredArtifacts: [{ path: invalidPath, kind: 'file' }],
        noCodeReason: 'No changes.',
      }),
    ).toThrow(/project root|project-relative/u);
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest({ entries: [entry(invalidPath, HASH_A)] }),
        current: manifest(),
        contractHash: HASH_B,
        declaredArtifacts: [],
      }),
    ).toThrow(/project root|project-relative/u);
    expect(() =>
      buildNativeImplementationScope({
        baseline: manifest(),
        current: manifest(),
        contractHash: HASH_B,
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
        contractHash: HASH_B,
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
        contractHash: HASH_B,
        declaredArtifacts: [],
      }),
    ).toThrow('duplicate paths');
  });
});
