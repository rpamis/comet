import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';

import {
  compareAndSwapNativeChange,
  createNativeChange,
  listNativeChanges,
  NATIVE_CHANGE_DOCUMENT_MAX_BYTES,
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
      approved_contract_hash: null,
      verification_result: 'pending',
      created_at: '2026-07-14',
    });
    expect(state).not.toHaveProperty('confirmation_required');
    expect(await readNativeChange(paths, state.name)).toEqual(state);
    await expect(
      fs.access(path.join(paths.changesDir, state.name, 'comet-state.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(paths.changesDir, state.name, 'change.yaml')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('fails at change creation when the baseline snapshot is incomplete', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'oversized-baseline.bin'),
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );

    await expect(
      createNativeChange({ paths, name: 'incomplete-baseline', language: 'en' }),
    ).rejects.toMatchObject({
      name: 'NativeBaselineIncompleteError',
      code: 'native-baseline-incomplete',
      omittedCount: 1,
      samplePaths: ['oversized-baseline.bin'],
      sampleTruncated: false,
    });
    await expect(
      fs.access(path.join(paths.changesDir, 'incomplete-baseline')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads older v3 state without an approval hash and canonicalizes it to null', async () => {
    const state = await createNativeChange({ paths, name: 'legacy-v3-state', language: 'en' });
    const file = path.join(paths.changesDir, state.name, 'comet-state.yaml');
    const legacy = { ...state } as Record<string, unknown>;
    delete legacy.approved_contract_hash;
    await fs.writeFile(file, stringify(legacy));

    const parsed = await readNativeChange(paths, state.name);
    expect(parsed.approved_contract_hash).toBeNull();
    await writeNativeChange(paths, parsed);
    expect(await fs.readFile(file, 'utf8')).toContain('approved_contract_hash: null');
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

  it('fails closed before parsing an oversized change document', async () => {
    const state = await createNativeChange({ paths, name: 'oversized-change', language: 'en' });
    await fs.writeFile(
      path.join(paths.changesDir, state.name, 'comet-state.yaml'),
      'x'.repeat(NATIVE_CHANGE_DOCUMENT_MAX_BYTES + 1),
    );

    await expect(readNativeChange(paths, state.name)).rejects.toThrow(
      `exceeds ${NATIVE_CHANGE_DOCUMENT_MAX_BYTES} bytes`,
    );
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
    const file = path.join(paths.changesDir, state.name, 'comet-state.yaml');
    const value = { ...state, ...patch };
    await fs.writeFile(file, stringify(value));
    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(Error);
  });

  it('requires field-specific change-relative content-addressed evidence refs', async () => {
    const state = await createNativeChange({ paths, name: 'strict-evidence', language: 'en' });
    const file = path.join(paths.changesDir, state.name, 'comet-state.yaml');
    const hash = 'a'.repeat(64);
    await fs.writeFile(
      file,
      stringify({
        ...state,
        implementation_scope: `runtime/evidence/scopes/${hash}.json`,
        verification_evidence: `runtime/evidence/verifications/${hash}.json`,
        partial_allowance: `runtime/evidence/allowances/${hash}.json`,
      }),
    );
    await expect(readNativeChange(paths, state.name)).resolves.toMatchObject({
      implementation_scope: `runtime/evidence/scopes/${hash}.json`,
      verification_evidence: `runtime/evidence/verifications/${hash}.json`,
      partial_allowance: `runtime/evidence/allowances/${hash}.json`,
    });

    for (const patch of [
      { implementation_scope: `runtime/evidence/verifications/${hash}.json` },
      { verification_evidence: `runtime/evidence/verifications/${'A'.repeat(64)}.json` },
      { partial_allowance: `runtime/evidence/allowances/../${hash}.json` },
      { implementation_scope: `runtime/evidence/${hash}.json` },
    ]) {
      await fs.writeFile(file, stringify({ ...state, ...patch }));
      await expect(readNativeChange(paths, state.name)).rejects.toThrow(
        /must be null or runtime\/evidence/iu,
      );
    }

    const missing = { ...state } as Record<string, unknown>;
    delete missing.verification_evidence;
    await fs.writeFile(file, stringify(missing));
    await expect(readNativeChange(paths, state.name)).rejects.toThrow(
      /Native verification_evidence must be null/iu,
    );
  });

  it('rejects duplicate capabilities and path traversal sources', async () => {
    const state = await createNativeChange({ paths, name: 'strict-specs', language: 'en' });
    const file = path.join(paths.changesDir, state.name, 'comet-state.yaml');
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
