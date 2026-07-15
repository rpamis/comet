import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  markNativeSpecRemoval,
  reconcileNativeSpecChanges,
} from '../../../domains/comet-native/native-specs.js';
import { nativeTransitionJournalFile } from '../../../domains/comet-native/native-transition-journal.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const brief = `# Outcome
Ship the feature.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The feature works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use existing APIs.
# Open questions

# Verification expectations
Run focused tests.
`;

describe('Native runtime-owned spec metadata', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-specs-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function proposed(change: string, capability: string, source: string): Promise<void> {
    const file = path.join(nativeChangeDir(paths, change), 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  }

  async function canonical(capability: string, source: string): Promise<string> {
    const file = path.join(paths.specsDir, capability, 'spec.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
    return file;
  }

  it('infers create and replace while preserving the first canonical base hash', async () => {
    let state = await createNativeChange({ paths, name: 'sync-specs', language: 'en' });
    const canonicalFile = await canonical('existing-capability', 'original\n');
    const originalHash = await sha256File(canonicalFile);
    await proposed('sync-specs', 'new-capability', 'new target\n');
    await proposed('sync-specs', 'existing-capability', 'replacement target\n');

    state = { ...state, spec_changes: await reconcileNativeSpecChanges(paths, state) };
    expect(state.spec_changes).toEqual([
      {
        capability: 'existing-capability',
        operation: 'replace',
        source: 'specs/existing-capability/spec.md',
        base_hash: originalHash,
      },
      {
        capability: 'new-capability',
        operation: 'create',
        source: 'specs/new-capability/spec.md',
        base_hash: null,
      },
    ]);

    await fs.writeFile(canonicalFile, 'concurrent change\n');
    expect(await reconcileNativeSpecChanges(paths, state)).toEqual(state.spec_changes);
  });

  it('records remove through a command-owned mutation and rejects a proposed/remove conflict', async () => {
    await createNativeChange({ paths, name: 'remove-spec', language: 'en' });
    const canonicalFile = await canonical('legacy-capability', 'legacy\n');
    const baseHash = await sha256File(canonicalFile);

    const removed = await markNativeSpecRemoval(paths, 'remove-spec', 'legacy-capability');
    expect(removed.spec_changes).toEqual([
      {
        capability: 'legacy-capability',
        operation: 'remove',
        base_hash: baseHash,
      },
    ]);
    expect((await readNativeChange(paths, 'remove-spec')).spec_changes).toEqual(
      removed.spec_changes,
    );

    await proposed('remove-spec', 'legacy-capability', 'keep it after all\n');
    await expect(reconcileNativeSpecChanges(paths, removed)).rejects.toThrow(
      'both a proposed spec and a remove intent',
    );
  });

  it('keeps the first remove hash when the canonical spec later changes', async () => {
    await createNativeChange({ paths, name: 'stable-remove', language: 'en' });
    const canonicalFile = await canonical('legacy-capability', 'legacy v1\n');
    const originalHash = await sha256File(canonicalFile);

    await markNativeSpecRemoval(paths, 'stable-remove', 'legacy-capability');
    await fs.writeFile(canonicalFile, 'legacy v2 from another change\n');
    const repeated = await markNativeSpecRemoval(paths, 'stable-remove', 'legacy-capability');

    expect(repeated.spec_changes).toEqual([
      {
        capability: 'legacy-capability',
        operation: 'remove',
        base_hash: originalHash,
      },
    ]);
  });

  it('continues a pending transition before recording a remove intent', async () => {
    const state = await createNativeChange({
      paths,
      name: 'remove-after-recovery',
      language: 'en',
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, state.name), 'brief.md'), brief);
    await canonical('legacy-capability', 'legacy\n');
    await expect(
      advanceNativeChange({
        paths,
        name: state.name,
        evidence: { summary: 'shape is ready' },
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt before spec remove');
          },
        },
      }),
    ).rejects.toThrow('interrupt before spec remove');

    const removed = await markNativeSpecRemoval(paths, state.name, 'legacy-capability');
    expect(removed).toMatchObject({
      phase: 'build',
      spec_changes: [{ capability: 'legacy-capability', operation: 'remove' }],
    });
    await expect(fs.access(nativeTransitionJournalFile(paths, state.name))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
