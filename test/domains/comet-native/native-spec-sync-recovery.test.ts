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
  createNativePortableChange,
  nativePortableChangeDir,
  prepareNativePortableShapeConfirmation,
  confirmNativePortableShape,
  readNativePortableChange,
  syncNativePortableSpecReferences,
} from '../../../domains/comet-native/native-portable-runtime.js';
import * as stateStorage from '../../../domains/comet-native/native-portable-state.js';
import { readNativeVerificationReportSnapshot } from '../../../domains/comet-native/native-evidence-storage.js';
import * as evidenceStorage from '../../../domains/comet-native/native-evidence-storage.js';

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
    (await fs.readdir(paths.runtimeDir, { recursive: true })).filter((name) =>
      name.includes(`${path.sep}evidence${path.sep}reports${path.sep}`),
    );
  return { paths, file, original, before, input, audits };
}

describe('Native spec sync audit recovery', () => {
  it('syncs a large confirmed spec with a bounded and verifiable audit', async () => {
    const { paths, input, file, original } = await setup('Background material.\n'.repeat(40000));
    const synced = await syncNativePortableSpecReferences(input);
    expect(await fs.readFile(file, 'utf8')).toBe(original.replace('(old.md)', '(new.md)'));
    const ref = synced.history.at(-1)!.summary.text.match(/reports\/([a-f0-9]{64})\.json/)![1];
    const text = await readNativeVerificationReportSnapshot(paths, 'change', ref);
    expect(Buffer.byteLength(text)).toBeLessThan(4096);
    expect(JSON.parse(text)).toMatchObject({
      beforeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      afterHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      replacements: [{ from: 'old.md', to: 'new.md' }],
    });
  });

  it('rolls back the spec and newly created audit when state commit fails', async () => {
    const { paths, input, file, original, before, audits } = await setup();
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockRejectedValueOnce(
      new Error('state commit failed'),
    );
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('state commit failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await readNativePortableChange(paths, 'change')).toEqual(before);
    expect(await audits()).toEqual([]);
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

  it('preserves an already existing identical audit when the state commit fails', async () => {
    const { input, file, original, audits } = await setup();
    const write = evidenceStorage.writeNativeVerificationReportSnapshot;
    vi.spyOn(evidenceStorage, 'writeNativeVerificationReportSnapshot').mockImplementationOnce(
      async (options) => {
        // A preceding interrupted attempt can leave the same content-addressed audit.
        await write({ ...options, onCreated: undefined });
        return write(options);
      },
    );
    vi.spyOn(stateStorage, 'compareAndSwapNativePortableState').mockRejectedValueOnce(
      new Error('state commit failed'),
    );
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('state commit failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await audits()).toHaveLength(1);
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
