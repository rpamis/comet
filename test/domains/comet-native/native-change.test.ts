import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';

import {
  compareAndSwapNativeChange,
  createNativeChange,
  listNativeChanges,
  NativeChangeRevisionConflictError,
  readNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { readNativeBaselineManifest } from '../../../domains/comet-native/native-snapshot.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  type NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';

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
      schema: NATIVE_CHANGE_SCHEMA,
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
      revision: 1,
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
    expect(await readNativeBaselineManifest(paths, state.name)).toMatchObject({
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      complete: true,
      entries: [],
    });
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
    expect(state.revision).toBe(2);
    expect(await readNativeChange(paths, state.name)).toEqual(state);
  });

  it('rejects a stale change write instead of silently overwriting a newer revision', async () => {
    const created = await createNativeChange({ paths, name: 'revision-conflict', language: 'en' });
    const first = structuredClone(created);
    const stale = structuredClone(created);
    first.approval = 'implicit';
    stale.approval = 'confirmed';

    await compareAndSwapNativeChange(paths, first, created.revision);
    expect(first.revision).toBe(2);
    await expect(compareAndSwapNativeChange(paths, stale, created.revision)).rejects.toBeInstanceOf(
      NativeChangeRevisionConflictError,
    );
    expect(await readNativeChange(paths, created.name)).toMatchObject({
      revision: 2,
      approval: 'implicit',
    });
  });

  it('allows only one competing writer to advance the same revision', async () => {
    const created = await createNativeChange({ paths, name: 'concurrent-cas', language: 'en' });
    const left = { ...structuredClone(created), approval: 'implicit' as const };
    const right = { ...structuredClone(created), approval: 'confirmed' as const };
    const results = await Promise.allSettled([
      compareAndSwapNativeChange(paths, left, created.revision),
      compareAndSwapNativeChange(paths, right, created.revision),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await readNativeChange(paths, created.name)).revision).toBe(2);
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
