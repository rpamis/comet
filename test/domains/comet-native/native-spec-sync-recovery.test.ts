import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  confirmNativePortableShape,
  createNativePortableChange,
  nativePortableChangeDir,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  syncNativePortableSpecReferences,
} from '../../../domains/comet-native/native-portable-runtime.js';
import * as stateStorage from '../../../domains/comet-native/native-portable-state.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function setup(padding = '') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-spec-sync-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({ paths, name: 'change', language: 'en' });
  const changeDir = nativePortableChangeDir(paths, 'change');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Acceptance examples\n- The behavior works.\n',
  );
  const specDir = path.join(changeDir, 'specs', 'feature');
  await fs.mkdir(specDir, { recursive: true });
  const file = path.join(specDir, 'spec.md');
  const original = '# Requirement\nThe behavior MUST work. See [decision](old.md).\n' + padding;
  await fs.writeFile(file, original);
  await prepareNativePortableShapeConfirmation({ paths, name: 'change' });
  const before = await confirmNativePortableShape({ paths, name: 'change' });
  const input = {
    paths,
    name: 'change',
    capability: 'feature',
    actor: 'reviewer',
    reason: 'Correct ADR reference',
    expectedStateVersion: before.state_version,
    affectedAcceptanceIds: before.acceptance.map(({ id }) => id),
    replacements: [{ from: 'old.md', to: 'new.md' }],
  };
  const audits = async () =>
    (
      await fs
        .readdir(path.join(paths.runtimeDir, 'spec-sync'))
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        })
    ).filter((name) => name.endsWith('.json'));
  return { paths, file, original, before, input, audits };
}

describe('Native spec sync audit recovery', () => {
  it('syncs a large confirmed spec with a bounded audit of the requested reference edit', async () => {
    const { paths, input, file, original } = await setup('Background material.\n'.repeat(40000));
    const synced = await syncNativePortableSpecReferences(input);
    expect(await fs.readFile(file, 'utf8')).toBe(original.replace('(old.md)', '(new.md)'));
    const ref = synced.history.at(-1)!.summary.text.match(/spec-sync\/[a-f0-9-]+\.json/)![0];
    const text = await fs.readFile(path.join(paths.runtimeDir, ref), 'utf8');
    expect(Buffer.byteLength(text)).toBeLessThan(4096);
    expect(JSON.parse(text)).toMatchObject({
      schema: 'comet.native.spec-sync.v1',
      actor: 'reviewer',
      reason: 'Correct ADR reference',
      replacements: [{ from: 'old.md', to: 'new.md' }],
    });
  });

  it('rolls back the spec while retaining the attempted edit audit when state commit fails', async () => {
    const { paths, input, file, original, before, audits } = await setup();
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockRejectedValueOnce(
      new Error('state commit failed'),
    );
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('state commit failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await readNativePortableChange(paths, 'change')).toEqual(before);
    expect(await audits()).toHaveLength(1);
  });

  it('preserves the original failure if state cannot be inspected during rollback', async () => {
    const { input, audits } = await setup();
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockImplementationOnce(async () => {
      vi.spyOn(stateStorage, 'readNativePortableState').mockRejectedValueOnce(
        new Error('rollback read failed'),
      );
      throw new Error('state commit failed');
    });
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('state commit failed');
    // Unknown commit status must retain evidence for recovery.
    expect(await audits()).toHaveLength(1);
  });

  it('preserves an earlier audit when a new state commit fails', async () => {
    const { paths, input, file, original, audits } = await setup();
    const prior = path.join(paths.runtimeDir, 'spec-sync', 'earlier.json');
    await fs.mkdir(path.dirname(prior), { recursive: true });
    await fs.writeFile(prior, '{"actor":"earlier-reviewer"}');
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockRejectedValueOnce(
      new Error('state commit failed'),
    );
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('state commit failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fs.readFile(prior, 'utf8')).toBe('{"actor":"earlier-reviewer"}');
    expect(await audits()).toHaveLength(2);
  });

  it('retains the new spec and audit when failure occurs after state commit', async () => {
    const { paths, input, file, original, before, audits } = await setup();
    const commit = stateStorage.compareAndSwapNativePortableState;
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockImplementationOnce(
      async (options) => {
        await commit(options);
        throw new Error('post-commit failed');
      },
    );
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('post-commit failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original.replace('(old.md)', '(new.md)'));
    expect((await readNativePortableChange(paths, 'change')).state_version).toBe(
      before.state_version + 1,
    );
    expect(await audits()).toHaveLength(1);
  });
});
