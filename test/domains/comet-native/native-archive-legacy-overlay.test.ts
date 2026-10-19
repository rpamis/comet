import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNativeLegacyArchiveOverlay,
  withNativeLegacyArchiveMaterials,
} from '../../../domains/comet-native/native-archive-legacy-overlay.js';
import { nativeCandidateInputGate } from '../../../domains/comet-native/native-portable-checks.js';
import { nativeTotalSpecHash } from '../../../domains/comet-native/native-delta-spec.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type { NativePortableArchiveTransaction } from '../../../domains/comet-native/native-portable-transactions.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(original: string | null, artifactRoot = 'docs') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-archive-overlay-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.test');
  await writeProjectConfig(root, defaultProjectConfig(artifactRoot, 'en'));
  const paths = await nativeProjectPaths(root, artifactRoot);
  const target = path.join(paths.specsDir, 'feature', 'spec.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (original !== null) await fs.writeFile(target, original);
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const answer = 42;\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const gateOptions = {
    projectRoot: root,
    candidateId: 'candidate',
    managedArtifactRoot: paths.artifactRoot,
  };
  // 仅构造冻结事务输入以验证只读重建；不伪造或推进 Runtime 状态。
  const transaction: NativePortableArchiveTransaction = {
    schema: 'comet.native.archive-transaction.v4',
    id: 'd6e3c18e-1ab2-49c8-b0a9-43e022962fac',
    change: 'test-change',
    start_state_version: 5,
    archive_ref: '2026-10-19-test-change',
    status: 'specs-applied',
    next_spec_index: 1,
    spec_changes: [
      {
        capability: 'feature',
        operation: 'create',
        source: 'specs/feature/spec.md',
        content: '# New\n',
        expected_target_hash: original === null ? null : nativeTotalSpecHash(original),
        result_hash: nativeTotalSpecHash('# New\n'),
      },
    ],
    created_at: '2026-10-19T00:00:00.000Z',
  };
  return {
    root,
    paths,
    target,
    gateOptions,
    transaction,
    git,
    ref: path.relative(root, target).replaceAll('\\', '/'),
  };
}

describe('legacy Archive candidate overlay', () => {
  it('treats an artifact root containing pathspec characters literally', async () => {
    const f = await fixture('# Original\n', 'docs[old]');
    const before = await nativeCandidateInputGate(f.gateOptions);
    expect(before).not.toBeNull();
    await fs.writeFile(f.target, '# New\n');
    const overlay = createNativeLegacyArchiveOverlay({
      paths: f.paths,
      transaction: f.transaction,
    });
    expect(
      await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
    ).toBe(before);
  });
  it('preserves an already-staged old Spec exactly', async () => {
    const f = await fixture('# Original\n');
    await fs.writeFile(f.target, '# Staged original\n');
    f.git('add', f.ref);
    f.transaction.spec_changes[0].expected_target_hash = nativeTotalSpecHash('# Staged original\n');
    const before = await nativeCandidateInputGate(f.gateOptions);
    await fs.writeFile(f.target, '# New\n');
    const overlay = createNativeLegacyArchiveOverlay({
      paths: f.paths,
      transaction: f.transaction,
    });
    expect(
      await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
    ).toBe(before);
  });

  it.each([true, false])(
    'reconstructs moved materials, including binary files, with tracked=%s',
    async (tracked) => {
      const f = await fixture('# Original\n');
      const active = path.join(f.paths.changesDir, f.transaction.change);
      const archived = path.join(f.paths.archiveDir, f.transaction.archive_ref);
      await fs.mkdir(active, { recursive: true });
      await fs.writeFile(path.join(active, 'brief.md'), '# Candidate\n');
      await fs.writeFile(path.join(active, 'sample.bin'), Buffer.from([0, 255, 128, 2]));
      if (tracked) {
        f.git('add', '.');
        f.git('commit', '-m', 'candidate materials');
      }
      const before = await nativeCandidateInputGate(f.gateOptions);
      expect(before).not.toBeNull();
      await fs.writeFile(f.target, '# New\n');
      await fs.mkdir(f.paths.archiveDir, { recursive: true });
      await fs.rename(active, archived);
      f.transaction.status = 'moved';
      const inspect = async () =>
        withNativeLegacyArchiveMaterials({
          paths: f.paths,
          transaction: f.transaction,
          overlay: createNativeLegacyArchiveOverlay({ paths: f.paths, transaction: f.transaction }),
        });
      const overlay = await inspect();
      expect(
        await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
      ).toBe(before);
      await fs.writeFile(path.join(archived, 'brief.md'), '# Changed candidate\n');
      expect(
        await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: await inspect() }),
      ).not.toBe(before);
      await expect(fs.stat(active)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('preserves unrelated staged renames in the old candidate', async () => {
    const f = await fixture('# Original\n');
    f.git('mv', 'implementation.js', 'renamed.js');
    const before = await nativeCandidateInputGate(f.gateOptions);
    expect(before).not.toBeNull();
    await fs.writeFile(f.target, '# New\n');
    const overlay = createNativeLegacyArchiveOverlay({
      paths: f.paths,
      transaction: f.transaction,
    });
    expect(
      await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
    ).toBe(before);
  });

  it.each(['create', 'replace', 'remove'])(
    'reconstructs %s without changing files or the index',
    async (kind) => {
      const f = await fixture(kind === 'create' ? null : '# Original\n');
      const before = await nativeCandidateInputGate(f.gateOptions);
      expect(before).not.toBeNull();
      if (kind === 'remove') await fs.rm(f.target);
      else await fs.writeFile(f.target, '# New\n');
      expect(await nativeCandidateInputGate(f.gateOptions)).not.toBe(before);
      const index = f.git('ls-files', '--stage');
      const status = f.git('status', '--porcelain=v1', '-z', '--untracked-files=all');
      const overlay = createNativeLegacyArchiveOverlay({
        paths: f.paths,
        transaction: f.transaction,
      });
      expect(
        await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
      ).toBe(before);
      expect(f.git('ls-files', '--stage')).toBe(index);
      expect(f.git('status', '--porcelain=v1', '-z', '--untracked-files=all')).toBe(status);
      if (kind === 'remove')
        await expect(fs.stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await fs.readFile(f.target, 'utf8')).toBe('# New\n');
    },
  );

  it('does not conceal an implementation change outside the original transaction', async () => {
    const f = await fixture('# Original\n');
    const before = await nativeCandidateInputGate(f.gateOptions);
    await fs.writeFile(f.target, '# New\n');
    await fs.writeFile(path.join(f.root, 'implementation.js'), 'throw new Error("changed");\n');
    const overlay = createNativeLegacyArchiveOverlay({
      paths: f.paths,
      transaction: f.transaction,
    });
    expect(
      await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
    ).not.toBe(before);
  });

  it('requires the matching original backup for an uncommitted old Spec', async () => {
    const f = await fixture('# Committed\n');
    const original = '# Uncommitted original\n';
    await fs.writeFile(f.target, original);
    f.transaction.spec_changes[0].expected_target_hash = nativeTotalSpecHash(original);
    const before = await nativeCandidateInputGate(f.gateOptions);
    await fs.writeFile(f.target, '# New\n');
    expect(() =>
      createNativeLegacyArchiveOverlay({ paths: f.paths, transaction: f.transaction }),
    ).toThrow(/原文备份/u);
    expect(() =>
      createNativeLegacyArchiveOverlay({
        paths: f.paths,
        transaction: f.transaction,
        originals: new Map([[f.ref, '# Wrong\n']]),
      }),
    ).toThrow(/原文备份/u);
    const overlay = createNativeLegacyArchiveOverlay({
      paths: f.paths,
      transaction: f.transaction,
      originals: new Map([[f.ref, original]]),
    });
    expect(
      await nativeCandidateInputGate({ ...f.gateOptions, legacyArchiveOverlay: overlay }),
    ).toBe(before);
    expect(await fs.readFile(f.target, 'utf8')).toBe('# New\n');
  });

  it('rejects missing original hashes and backup paths outside the transaction', async () => {
    const f = await fixture('# Original\n');
    expect(() =>
      createNativeLegacyArchiveOverlay({
        paths: f.paths,
        transaction: f.transaction,
        originals: new Map([['implementation.js', 'replacement']]),
      }),
    ).toThrow(/不属于原 Archive/u);
    delete f.transaction.spec_changes[0].expected_target_hash;
    expect(() =>
      createNativeLegacyArchiveOverlay({ paths: f.paths, transaction: f.transaction }),
    ).toThrow(/原目标摘要/u);
  });
});
