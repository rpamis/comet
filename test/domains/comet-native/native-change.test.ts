import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';

import {
  createNativeChange,
  listNativeChanges,
  readNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native change store', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-change-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('creates the visible Native change layout without claiming Shape is complete', async () => {
    const state = await createNativeChange({
      paths,
      name: 'add-authentication',
      language: 'zh-CN',
      now: new Date('2026-07-14T00:00:00Z'),
    });

    expect(state).toMatchObject({
      phase: 'shape',
      approval: null,
      verification_result: 'pending',
      created_at: '2026-07-14',
    });
    expect(state).not.toHaveProperty('confirmation_required');
    expect(await readNativeChange(paths, state.name)).toEqual(state);
    expect(await fs.stat(path.join(paths.changesDir, state.name, 'specs'))).toBeDefined();
    expect(
      await fs.stat(path.join(paths.changesDir, state.name, 'runtime', 'checkpoints')),
    ).toBeDefined();
  });

  it('round-trips create, replace, and remove spec operations', async () => {
    const state = await createNativeChange({ paths, name: 'update-auth', language: 'en' });
    state.spec_changes = [
      {
        capability: 'new-auth',
        operation: 'create',
        source: 'specs/new-auth/spec.md',
        base_hash: null,
      },
      {
        capability: 'old-auth',
        operation: 'replace',
        source: 'specs/old-auth/spec.md',
        base_hash: 'a'.repeat(64),
      },
      { capability: 'legacy-auth', operation: 'remove', base_hash: 'b'.repeat(64) },
    ];
    await writeNativeChange(paths, state);
    expect(await readNativeChange(paths, state.name)).toEqual(state);
  });

  it('lists multiple active changes in name order', async () => {
    await createNativeChange({ paths, name: 'zeta-change', language: 'en' });
    await createNativeChange({ paths, name: 'alpha-change', language: 'en' });
    expect((await listNativeChanges(paths)).map((state) => state.name)).toEqual([
      'alpha-change',
      'zeta-change',
    ]);
  });

  it.each([
    ['unknown field', { extra: true }],
    ['bad phase', { phase: 'design' }],
    ['bad date', { created_at: '2026-02-31' }],
    ['bad name', { name: '../escape' }],
  ])('rejects %s', async (_label, patch) => {
    const state = await createNativeChange({ paths, name: 'strict-change', language: 'en' });
    const file = path.join(paths.changesDir, state.name, 'change.yaml');
    const value = { ...state, ...patch };
    await fs.writeFile(file, stringify(value));
    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(Error);
  });

  it('rejects duplicate capabilities and path traversal sources', async () => {
    const state = await createNativeChange({ paths, name: 'strict-specs', language: 'en' });
    const file = path.join(paths.changesDir, state.name, 'change.yaml');
    await fs.writeFile(
      file,
      stringify({
        ...state,
        spec_changes: [
          {
            capability: 'auth',
            operation: 'create',
            source: 'specs/auth/spec.md',
            base_hash: null,
          },
          { capability: 'auth', operation: 'create', source: '../auth.md', base_hash: null },
        ],
      }),
    );
    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(Error);
  });
});
