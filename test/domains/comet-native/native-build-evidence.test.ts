import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  inspectNativeBuildEvidence,
  persistNativeBuildEvidence,
  prepareNativeBuildEvidence,
} from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { readNativeImplementationScope } from '../../../domains/comet-native/native-evidence-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeContentSnapshotManifest,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';

const execFileAsync = promisify(execFile);
const snapshotMock = vi.hoisted(() => ({
  next: null as NativeContentSnapshotManifest | null,
  filtered: null as NativeContentSnapshotManifest | null,
}));

vi.mock('../../../domains/comet-native/native-snapshot.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../domains/comet-native/native-snapshot.js')>();
  return {
    ...actual,
    createNativeContentSnapshot: async (
      ...args: Parameters<typeof actual.createNativeContentSnapshot>
    ) => {
      if (snapshotMock.next !== null) {
        const next = snapshotMock.next;
        snapshotMock.next = null;
        return next;
      }
      return actual.createNativeContentSnapshot(...args);
    },
    filterNativeContentSnapshotToProjectScope: async (
      ...args: Parameters<typeof actual.filterNativeContentSnapshotToProjectScope>
    ) => {
      if (snapshotMock.filtered !== null) {
        const filtered = snapshotMock.filtered;
        snapshotMock.filtered = null;
        return filtered;
      }
      return actual.filterNativeContentSnapshotToProjectScope(...args);
    },
  };
});

const brief = `# Outcome
Ship the focused behavior.
# Scope
Update the declared implementation.
# Non-goals
No unrelated refactor.
# Acceptance examples
- The focused behavior works.
# Constraints and invariants
Keep existing callers stable.
# Decisions
Use the existing module.
# Open questions
None.
# Verification expectations
Run the focused tests.
`;

function changedGitSelectionSnapshot(
  origin: NativeContentSnapshotManifest['origin'] = 'explicit',
): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin,
    capture: {
      provider: 'git',
      gitSelection: {
        schema: 'comet.native.git-selection.v1',
        status: 'changed',
        stageBefore: {
          hash: 'a'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 80,
          overflow: false,
        },
        combined: {
          hash: 'b'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 20,
          overflow: false,
        },
        stageAfter: {
          hash: 'c'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 80,
          overflow: false,
        },
        finalStageBefore: {
          hash: 'c'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 80,
          overflow: false,
        },
        finalCombined: {
          hash: 'b'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 20,
          overflow: false,
        },
        finalStageAfter: {
          hash: 'c'.repeat(64),
          recordCount: 1,
          storedRecordCount: 1,
          stdoutBytes: 80,
          overflow: false,
        },
      },
    },
    createdAt: '2026-07-17T01:00:00.000Z',
    complete: false,
    limits: {
      maxFiles: 10_000,
      maxFileBytes: 16 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      maxManifestBytes: 1024 * 1024,
    },
    entries: [],
    omitted: [
      {
        path: '.',
        size: null,
        type: 'directory',
        reason: 'git-selection-changed',
      },
    ],
    omittedCount: 1,
  };
}

function changedPhysicalSelectionSnapshot(
  origin: NativeContentSnapshotManifest['origin'] = 'explicit',
): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin,
    capture: {
      provider: 'physical-tree',
      physicalSelection: {
        schema: 'comet.native.physical-selection.v1',
        status: 'changed',
        before: {
          hash: 'a'.repeat(64),
          visitedNodeCount: 1,
          recordCount: 1,
          storedRecordCount: 1,
          encodedBytes: 16,
          overflow: false,
          unstable: false,
        },
        after: {
          hash: 'b'.repeat(64),
          visitedNodeCount: 1,
          recordCount: 1,
          storedRecordCount: 1,
          encodedBytes: 16,
          overflow: false,
          unstable: false,
        },
      },
    },
    createdAt: '2026-07-17T01:00:00.000Z',
    complete: false,
    limits: {
      maxFiles: 10_000,
      maxFileBytes: 16 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      maxManifestBytes: 1024 * 1024,
    },
    entries: [],
    omitted: [
      {
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-selection-changed',
      },
    ],
    omittedCount: 1,
  };
}

describe('Native Build evidence preparation', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;

  beforeEach(async () => {
    snapshotMock.next = null;
    snapshotMock.filtered = null;
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-build-evidence-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'focused-change',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, created.name), 'brief.md'), brief);
    state = { ...created, phase: 'build', approval: 'implicit' };
    await writeNativeChange(paths, state);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('derives a complete content-addressed scope from declared project artifacts', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');

    const result = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
      now: new Date('2026-07-17T01:00:00.000Z'),
    });

    expect(result).toMatchObject({ findings: [], allowance: null, allowanceRef: null });
    expect(result.bundle.scope).toMatchObject({
      complete: true,
      declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' }],
      unattributed: [],
    });
    expect(result.bundle.authority).not.toHaveProperty('gitChangedPaths');
    expect(result.bundle.scope).not.toHaveProperty('gitAdvisory');
    await expect(
      readNativeImplementationScope(paths, state.name, result.scopeRef),
    ).resolves.toEqual(result.bundle.scope);
  });

  it('persists deterministic partial scope IDs and only allows their exact confirmed set', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await fs.writeFile(path.join(projectRoot, 'src', 'unrelated.ts'), 'export const extra = 1;\n');
    const partial = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
    });
    const scopeIds = partial.unresolvedScopes.map((scope) => scope.id);
    expect(partial.findings).toHaveLength(scopeIds.length);
    expect(partial.bundle.scope.complete).toBe(false);
    expect(partial.allowanceRef).toBeNull();

    await expect(
      prepareNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'The unrelated file belongs to the user.',
        confirmedSummary: 'The user accepted this exact boundary.',
        confirmed: true,
      }),
    ).rejects.toThrow('does not match the current implementation scope');

    const confirmed = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
      allowPartialScopeHash: partial.bundle.scope.scopeHash,
      partialReason: 'The unrelated file belongs to the user.',
      confirmedSummary: 'The user accepted this exact boundary.',
      confirmed: true,
      now: new Date('2026-07-17T02:00:00.000Z'),
    });
    expect(confirmed.findings).toEqual([]);
    expect(confirmed.allowanceRef).toMatch(/^runtime\/evidence\/allowances\/[a-f0-9]{64}\.json$/u);
    expect(confirmed.allowance?.scopeIds).toEqual(scopeIds);
  });

  it('infers a removed baseline file without requiring a now-missing artifact', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await execFileAsync('git', ['add', 'src/feature.ts'], { cwd: projectRoot });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: projectRoot },
    );
    await execFileAsync('git', ['rm', 'src/feature.ts'], { cwd: projectRoot });

    const result = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
    });

    expect(result.bundle.scope).toMatchObject({
      complete: true,
      declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' }],
      changes: [{ path: 'src/feature.ts', kind: 'removed' }],
    });
  });

  it('preserves a Git baseline removal after the deleted path becomes ignored', async () => {
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '');
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await execFileAsync('git', ['add', '.gitignore', 'src/feature.ts'], { cwd: projectRoot });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: projectRoot },
    );
    const created = await createNativeChange({
      paths,
      name: 'git-removal',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, created.name), 'brief.md'), brief);
    const gitState = { ...created, phase: 'build' as const, approval: 'implicit' as const };
    await writeNativeChange(paths, gitState);

    await fs.writeFile(path.join(projectRoot, '.gitignore'), 'src/feature.ts\n');
    await execFileAsync('git', ['add', '.gitignore'], { cwd: projectRoot });
    await execFileAsync('git', ['rm', 'src/feature.ts'], { cwd: projectRoot });

    const result = await inspectNativeBuildEvidence({
      paths,
      state: gitState,
      artifactRefs: ['.gitignore', 'src/feature.ts'],
    });

    expect(result.bundle.scope.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/feature.ts', kind: 'removed' }),
      ]),
    );
  });

  it.each(['.env.local', '.npmrc', 'comet/runtime/run-state.json', 'missing.ts'])(
    'rejects sensitive or unprovable artifact %s',
    async (artifact) => {
      await expect(
        prepareNativeBuildEvidence({
          paths,
          state,
          artifactRefs: [artifact],
        }),
      ).rejects.toThrow(/excluded|does not exist/iu);
    },
  );

  it('does not accept partial confirmation flags for a complete scope', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await expect(
      prepareNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'No partial boundary exists.',
        confirmedSummary: 'Should not be accepted.',
        confirmed: true,
      }),
    ).rejects.toThrow('must not include a partial allowance');
  });

  it('rejects a changed Git selection even when partial evidence is explicitly confirmed', async () => {
    snapshotMock.next = changedGitSelectionSnapshot();

    await expect(
      inspectNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'Accept the incomplete selection.',
        confirmedSummary: 'Confirmed despite the index race.',
        confirmed: true,
      }),
    ).rejects.toThrow(/Git selection changed.*stabilize the Git index.*retry/iu);
  });

  it('rejects a changed Git selection while projecting a legacy baseline', async () => {
    snapshotMock.filtered = changedGitSelectionSnapshot('change-created');

    await expect(
      inspectNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'Accept the incomplete baseline projection.',
        confirmedSummary: 'Confirmed despite the baseline index race.',
        confirmed: true,
      }),
    ).rejects.toThrow(
      /Git selection changed.*baseline projection.*stabilize the Git index.*retry/iu,
    );
  });

  it('rejects an unstable physical selection even when partial evidence is explicitly confirmed', async () => {
    snapshotMock.next = changedPhysicalSelectionSnapshot();

    await expect(
      inspectNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'Accept the incomplete physical selection.',
        confirmedSummary: 'Confirmed despite the project tree race.',
        confirmed: true,
      }),
    ).rejects.toThrow(/physical selection.*stable bounded project tree/iu);
  });

  it('rejects an unstable physical selection while projecting a legacy baseline', async () => {
    snapshotMock.filtered = changedPhysicalSelectionSnapshot('change-created');

    await expect(
      inspectNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
      }),
    ).rejects.toThrow(/physical selection.*baseline projection.*stable bounded project tree/iu);
  });

  it('never converts an incomplete baseline into waivable partial Build evidence', async () => {
    snapshotMock.filtered = {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      capture: { provider: 'physical-tree' },
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: false,
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 16 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
        maxManifestBytes: 1024 * 1024,
      },
      entries: [],
      omitted: [
        {
          path: 'src/feature.ts',
          size: 17 * 1024 * 1024,
          type: 'file',
          reason: 'file-size',
        },
      ],
      omittedCount: 1,
    };

    await expect(
      inspectNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/feature.ts'],
        allowPartialScopeHash: 'f'.repeat(64),
        partialReason: 'Accept the incomplete baseline.',
        confirmedSummary: 'Confirmed despite the baseline omission.',
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      name: 'NativeBaselineIncompleteError',
      code: 'native-baseline-incomplete',
      change: state.name,
      omittedCount: 1,
      omittedByReason: { 'file-size': 1 },
      samplePaths: ['src/feature.ts'],
    });
  });

  it('rejects a complete oversized baseline when its 1 MiB evidence projection becomes partial', async () => {
    const entries = Array.from({ length: 2_500 }, (_, index) => ({
      path: `generated/${String(index).padStart(4, '0')}-${'x'.repeat(450)}.ts`,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file' as const,
    }));
    snapshotMock.filtered = {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      capture: { provider: 'physical-tree' },
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: true,
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000_000,
        maxManifestBytes: 8 * 1024 * 1024,
      },
      entries,
      omitted: [],
      omittedCount: 0,
    };

    const error = await inspectNativeBuildEvidence({
      paths,
      state,
      artifactRefs: [],
      allowPartialScopeHash: 'f'.repeat(64),
      partialReason: 'Accept the compacted baseline projection.',
      confirmedSummary: 'Confirmed despite hidden baseline entries.',
      confirmed: true,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'NativeBaselineIncompleteError',
      code: 'native-baseline-incomplete',
      change: state.name,
      omittedCount: expect.any(Number),
      omittedByReason: { 'manifest-size': expect.any(Number) },
      samplePaths: expect.any(Array),
      sampleTruncated: true,
    });
    const structured = error as {
      omittedCount: number;
      omittedByReason: Record<string, number>;
      samplePaths: string[];
    };
    expect(structured.omittedCount).toBeGreaterThan(0);
    expect(structured.omittedByReason['manifest-size']).toBe(structured.omittedCount);
    expect(structured.samplePaths).toHaveLength(20);
    expect(structured.samplePaths[0]).toMatch(/^generated\//u);
  });

  it('returns and persists bounded partial evidence for a large unrelated tree', async () => {
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        fs.writeFile(
          path.join(projectRoot, 'src', `unrelated-${String(index).padStart(4, '0')}.ts`),
          `export const value${index} = ${index};\n`,
        ),
      ),
    );

    const preparation = await inspectNativeBuildEvidence({
      paths,
      state,
      artifactRefs: [],
    });

    expect(preparation.findings.length).toBeLessThan(500);
    expect(preparation.unresolvedScopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'scope-detail-overflow' })]),
    );
    await expect(
      persistNativeBuildEvidence({ paths, state, preparation }),
    ).resolves.toBeUndefined();
    await expect(
      readNativeImplementationScope(paths, state.name, preparation.scopeRef),
    ).resolves.toEqual(preparation.bundle.scope);
  });
});
