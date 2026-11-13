import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recoverArchiveTransaction } from '../../../domains/comet-native/native-archive.js';
import {
  applyNativeArchiveTransactionV2,
  nativeArchiveTransactionPaths,
} from '../../../domains/comet-native/native-archive-transaction.js';
import {
  nativeChangeDocument,
  readNativeChangeFile,
} from '../../../domains/comet-native/native-change.js';
import { stringify } from 'yaml';
import {
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import { resolveSelectedNativeChange } from '../../../domains/comet-native/native-selection.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { loadPreparedNativeArchive } from '../../helpers/native-archive-wal.js';

describe('Native archive', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('applies create, replace, and remove specs before archiving the active change', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'all-spec');
    const changeDir = path.join(paths.changesDir, fixture.state.name);
    const archiveDir = path.join(paths.archiveDir, '2026-07-24-archive-fixture');
    await fs.writeFile(
      path.join(projectRoot, '.comet/current-change.json'),
      JSON.stringify({
        schema: 'comet.selection.v2',
        branch: null,
        workflow: 'native',
        change: fixture.state.name,
      }),
    );
    const result = await recoverArchiveTransaction({
      paths,
      transactionId: fixture.journal.id,
      strategy: 'continue',
    });
    expect(await fs.readFile(path.join(paths.specsDir, 'sessions/spec.md'), 'utf8')).toBe(
      'new sessions\n',
    );
    expect(await fs.readFile(path.join(paths.specsDir, 'authentication/spec.md'), 'utf8')).toBe(
      'new auth\n',
    );
    await expect(fs.access(path.join(paths.specsDir, 'legacy-auth/spec.md'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readNativeChangeFile(path.join(archiveDir, 'comet-state.yaml'))).toMatchObject({
      archived: true,
      phase: 'archive',
    });
    // 历史记录留在原 Runtime，恢复不再递归删除 Run 与结果。
    await expect(
      fs.access(nativePreferredChangeRuntimeDir(paths, fixture.state.name)),
    ).resolves.toBeUndefined();
    expect(await readNativeTransaction(paths, result.id)).toMatchObject({
      schema: 'comet.native.transaction.v2',
      kind: 'archive',
      status: 'committed',
      preflightHash: fixture.journal.preflightHash,
    });
    const journal = JSON.parse(
      await fs.readFile(nativeArchiveTransactionPaths(paths, result.id).journal, 'utf8'),
    );
    expect(journal).not.toHaveProperty('projectRoot');
    expect(journal).not.toHaveProperty('nativeRoot');
    expect(JSON.stringify(journal)).not.toContain(projectRoot);
    expect(journal.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'write',
          expectedTargetHash: null,
          stagedHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        expect.objectContaining({
          type: 'move',
          expectedSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          expectedTargetHash: null,
        }),
      ]),
    );
    await expect(
      fs.access(path.join(projectRoot, '.comet/current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('supports an archive with no spec changes', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'no-spec');
    const result = await recoverArchiveTransaction({
      paths,
      transactionId: fixture.journal.id,
      strategy: 'continue',
    });
    expect(result.status).toBe('committed');
    expect(await fs.readdir(paths.specsDir).catch(() => [])).toEqual([]);
    expect(
      await readNativeChangeFile(
        path.join(paths.archiveDir, '2026-07-24-archive-fixture/comet-state.yaml'),
      ),
    ).toMatchObject({ archived: true });
  });

  it('preserves the current selection when archiving a different Native change', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'no-spec');
    const selection = path.join(projectRoot, '.comet/current-change.json');
    await fs.mkdir(path.join(paths.changesDir, 'selected-change'), { recursive: true });
    await fs.writeFile(
      path.join(paths.changesDir, 'selected-change/comet-state.yaml'),
      stringify(
        nativeChangeDocument({
          ...fixture.state,
          name: 'selected-change',
          phase: 'shape',
          archived: false,
        }),
      ),
    );
    const original = JSON.stringify({
      schema: 'comet.selection.v2',
      branch: null,
      workflow: 'native',
      change: 'selected-change',
    });
    await fs.writeFile(selection, original);
    await recoverArchiveTransaction({
      paths,
      transactionId: fixture.journal.id,
      strategy: 'continue',
    });
    expect(await resolveSelectedNativeChange(paths)).toBe('selected-change');
    expect(await fs.readFile(selection, 'utf8')).toBe(original);
  });

  it('refuses a transactions junction that would stage archive data outside comet', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'replace-create');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transactions-outside-'));
    try {
      await fs.rm(paths.transactionsDir, { recursive: true, force: true });
      await fs.symlink(
        outside,
        paths.transactionsDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(applyNativeArchiveTransactionV2(paths, fixture.journal)).rejects.toThrow(
        /outside|real directory|symbolic link/u,
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('returns structured base-hash conflicts and leaves canonical specs unchanged', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'replace-create');
    const canonical = path.join(paths.specsDir, 'authentication/spec.md');
    await fs.writeFile(canonical, 'current canonical\n');
    await expect(applyNativeArchiveTransactionV2(paths, fixture.journal)).rejects.toMatchObject({
      message: expect.stringMatching(/content changed|hash/u),
    });
    expect(await fs.readFile(canonical, 'utf8')).toBe('current canonical\n');
    await expect(fs.stat(path.join(paths.changesDir, fixture.state.name))).resolves.toBeTruthy();
  });

  it('never overwrites an existing date-prefixed archive target', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'no-spec');
    const target = path.join(paths.archiveDir, '2026-07-24-archive-fixture');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'sentinel.txt'), 'keep');
    await expect(applyNativeArchiveTransactionV2(paths, fixture.journal)).rejects.toThrow(
      /target|content|exists/u,
    );
    expect(await fs.readFile(path.join(target, 'sentinel.txt'), 'utf8')).toBe('keep');
    await expect(fs.stat(path.join(paths.changesDir, fixture.state.name))).resolves.toBeTruthy();
  });

  it('refuses canonical spec junctions that would write outside comet', async () => {
    const fixture = await loadPreparedNativeArchive(paths, 'replace-create');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-spec-outside-'));
    try {
      const parent = path.join(paths.specsDir, 'sessions');
      await fs.rm(parent, { recursive: true, force: true });
      await fs.symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(applyNativeArchiveTransactionV2(paths, fixture.journal)).rejects.toThrow(
        /real directory|outside|symbolic link/u,
      );
      await expect(fs.access(path.join(outside, 'spec.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
