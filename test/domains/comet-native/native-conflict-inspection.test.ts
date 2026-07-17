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
import {
  inspectNativeChangeConflicts,
  inspectNativeConflictRadar,
} from '../../../domains/comet-native/native-conflict-inspection.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';

const brief = `# Outcome
Ship the shared behavior.
# Scope
Update the shared implementation.
# Non-goals
No unrelated refactor.
# Acceptance examples
- The shared behavior works.
# Constraints and invariants
Keep callers stable.
# Decisions
Use the existing module.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

describe('Native conflict radar collection', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-conflict-inspection-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'shared.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function change(name: string): Promise<NativeChangeState> {
    const created = await createNativeChange({ paths, name, language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, name), 'brief.md'), brief);
    await fs.mkdir(path.join(nativeChangeDir(paths, name), 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(nativeChangeDir(paths, name), 'specs', 'shared-capability.md'),
      '# Shared capability\n',
    );
    const state: NativeChangeState = {
      ...created,
      phase: 'build',
      approval: 'implicit',
      spec_changes: [
        {
          capability: 'shared-capability',
          operation: 'replace',
          base_hash: 'a'.repeat(64),
          source: 'specs/shared-capability.md',
        },
      ],
    };
    await writeNativeChange(paths, state);
    return state;
  }

  it('collects current spec and content-addressed artifact overlap from one Native root', async () => {
    const alpha = await change('alpha-change');
    const beta = await change('beta-change');
    await fs.writeFile(path.join(projectRoot, 'src', 'shared.ts'), 'export const value = 2;\n');
    for (const state of [alpha, beta]) {
      const prepared = await prepareNativeBuildEvidence({
        paths,
        state,
        artifactRefs: ['src/shared.ts'],
      });
      await writeNativeChange(paths, {
        ...state,
        implementation_scope: prepared.scopeRef as NativeChangeState['implementation_scope'],
      });
    }

    const radar = await inspectNativeConflictRadar(paths);

    expect(radar).toMatchObject({
      changeCount: 2,
      relationshipCount: 1,
      counts: { definiteConflict: 1 },
      relationships: [
        {
          left: 'alpha-change',
          right: 'beta-change',
          classification: 'definite-conflict',
          signalCount: 2,
        },
      ],
    });
    await expect(inspectNativeChangeConflicts(paths, 'alpha-change')).resolves.toEqual({
      definiteConflictCount: 1,
      possibleOverlapCount: 0,
      findingCodes: ['native-change-conflict'],
    });
    const status = await inspectNativeStatus(paths, 'alpha-change', { details: true });
    expect(status.findings).toContainEqual(
      expect.objectContaining({ code: 'native-change-conflict' }),
    );
  });

  it('fails closed when a visible change points at invalid scope evidence', async () => {
    const state = await change('invalid-scope');
    await writeNativeChange(paths, {
      ...state,
      implementation_scope:
        `runtime/evidence/scopes/${'f'.repeat(64)}.json` as NativeChangeState['implementation_scope'],
    });

    await expect(inspectNativeConflictRadar(paths)).rejects.toThrow();
  });

  it('does not traverse a symlinked change directory', async () => {
    await change('real-change');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-conflict-outside-'));
    try {
      await fs.symlink(outside, path.join(paths.changesDir, 'linked-change'), 'junction');
      const radar = await inspectNativeConflictRadar(paths);
      expect(radar.changeCount).toBe(1);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
