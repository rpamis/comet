import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { readNativeImplementationScope } from '../../../domains/comet-native/native-evidence-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import type { GitRepositoryInspection } from '../../../platform/process/git-repository.js';

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

const unavailableRepository: GitRepositoryInspection = {
  available: false,
  head: null,
  branch: null,
  worktreeRoot: null,
  commonDir: null,
  changedPaths: null,
  failure: { kind: 'not-repository', operation: 'discovery' },
};

function availableRepository(projectRoot: string, changedPaths: string[]): GitRepositoryInspection {
  return {
    available: true,
    head: 'a'.repeat(40),
    branch: 'feature/native',
    worktreeRoot: projectRoot,
    commonDir: path.join(projectRoot, '.git'),
    changedPaths,
    failure: null,
  };
}

describe('Native Build evidence preparation', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;

  beforeEach(async () => {
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
      inspectRepository: async () => availableRepository(projectRoot, ['src/feature.ts']),
      now: new Date('2026-07-17T01:00:00.000Z'),
    });

    expect(result).toMatchObject({ findings: [], allowance: null, allowanceRef: null });
    expect(result.bundle.scope).toMatchObject({
      complete: true,
      declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' }],
      unattributed: [],
    });
    await expect(
      readNativeImplementationScope(paths, state.name, result.scopeRef),
    ).resolves.toEqual(result.bundle.scope);
  });

  it('persists deterministic partial scope IDs and only allows their exact confirmed set', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await fs.writeFile(path.join(projectRoot, 'src', 'unrelated.ts'), 'export const extra = 1;\n');
    const inspectRepository = async () =>
      availableRepository(projectRoot, ['src/feature.ts', 'src/unrelated.ts']);

    const partial = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
      inspectRepository,
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
        inspectRepository,
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
      inspectRepository,
      now: new Date('2026-07-17T02:00:00.000Z'),
    });
    expect(confirmed.findings).toEqual([]);
    expect(confirmed.allowanceRef).toMatch(/^runtime\/evidence\/allowances\/[a-f0-9]{64}\.json$/u);
    expect(confirmed.allowance?.scopeIds).toEqual(scopeIds);
  });

  it('infers a removed baseline file without requiring a now-missing artifact', async () => {
    await fs.rm(path.join(projectRoot, 'src', 'feature.ts'));

    const result = await prepareNativeBuildEvidence({
      paths,
      state,
      artifactRefs: ['src/feature.ts'],
      inspectRepository: async () => unavailableRepository,
    });

    expect(result.bundle.scope).toMatchObject({
      complete: true,
      declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' }],
      changes: [{ path: 'src/feature.ts', kind: 'removed' }],
    });
  });

  it.each(['.env.local', '.npmrc', 'comet/runtime/run-state.json', 'missing.ts'])(
    'rejects sensitive or unprovable artifact %s',
    async (artifact) => {
      await expect(
        prepareNativeBuildEvidence({
          paths,
          state,
          artifactRefs: [artifact],
          inspectRepository: async () => unavailableRepository,
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
        inspectRepository: async () => unavailableRepository,
      }),
    ).rejects.toThrow('must not include a partial allowance');
  });
});
