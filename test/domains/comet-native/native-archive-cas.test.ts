import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recoverArchiveTransaction } from '../../../domains/comet-native/native-archive.js';
import {
  applyNativeArchiveTransactionV2,
  readNativeArchiveTransactionV2,
  rollbackNativeArchiveTransactionV2,
} from '../../../domains/comet-native/native-archive-transaction.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeProjectPaths,
  NativeSpecChange,
} from '../../../domains/comet-native/native-types.js';
import {
  loadPreparedNativeArchive,
  type FrozenNativeArchive,
} from '../../helpers/native-archive-wal.js';

describe('Native Archive target CAS', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let fixture: FrozenNativeArchive;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-cas-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function preparedChange(_name: string) {
    fixture = await loadPreparedNativeArchive(paths, 'replace-create');
    return {
      canonical: path.join(paths.specsDir, 'authentication/spec.md'),
      now: new Date(fixture.journal.createdAt),
      hash: fixture.journal.preflightHash,
    };
  }
  async function preparedRemoveChange(_name: string) {
    fixture = await loadPreparedNativeArchive(paths, 'remove');
    return {
      canonical: path.join(paths.specsDir, 'legacy-auth/spec.md'),
      now: new Date(fixture.journal.createdAt),
      hash: fixture.journal.preflightHash,
    };
  }
  async function archiveCasQuarantines(canonical: string): Promise<string[]> {
    return (await fs.readdir(path.dirname(canonical)))
      .filter((entry) => entry.includes('.comet-archive-cas-'))
      .map((entry) => path.join(path.dirname(canonical), entry));
  }

  it.each([
    ['same content', 'old auth\n'],
    ['different content', 'external auth\n'],
  ])(
    'preserves a %s external replacement after the original object was bound',
    async (_label, replacement) => {
      const name = replacement === 'old auth\n' ? 'same-object-race' : 'different-object-race';
      const { canonical, now, hash } = await preparedChange(name);
      const displaced = path.join(path.dirname(canonical), `original-${name}.md`);
      let injected = false;

      await expect(
        applyNativeArchiveTransactionV2(paths, fixture.journal, {
          async afterArchiveTargetBound(phase, operation, target) {
            if (phase !== 'apply' || operation.type !== 'write' || injected) return;
            injected = true;
            await fs.rename(target, displaced);
            await fs.writeFile(target, replacement);
          },
        }),
      ).rejects.toThrow(/content changed|object identity changed/u);

      expect(await fs.readFile(canonical, 'utf8')).toBe(replacement);
      expect(await fs.readFile(displaced, 'utf8')).toBe('old auth\n');
      expect(await archiveCasQuarantines(canonical)).toEqual([]);
    },
  );

  it('continues after crashing immediately after the original target was quarantined', async () => {
    const { canonical, now, hash } = await preparedChange('quarantine-crash');
    const transactionId = fixture.journal.id;
    let crashed = false;

    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        afterArchiveTargetQuarantined(phase, operation) {
          if (phase === 'apply' && operation.type === 'write' && !crashed) {
            crashed = true;
            throw new Error('crash after target quarantine');
          }
        },
      }),
    ).rejects.toThrow('crash after target quarantine');

    await expect(fs.access(canonical)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await archiveCasQuarantines(canonical)).toHaveLength(1);

    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe('applying');
    const repaired = await runNativeCli([
      'doctor',
      '--transaction',
      transactionId,
      '--repair',
      '--strategy',
      'continue',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
    expect(await archiveCasQuarantines(canonical)).toEqual([]);
  });

  it('preserves a same-content external replacement instead of removing it', async () => {
    const { canonical, now, hash } = await preparedRemoveChange('remove-object-race');
    const displaced = path.join(path.dirname(canonical), 'original-remove-object-race.md');
    let injected = false;

    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        async afterArchiveTargetBound(phase, operation, target) {
          if (phase !== 'apply' || operation.type !== 'remove' || injected) return;
          injected = true;
          await fs.rename(target, displaced);
          await fs.writeFile(target, 'legacy auth\n');
        },
      }),
    ).rejects.toThrow(/content changed|object identity changed/u);

    expect(await fs.readFile(canonical, 'utf8')).toBe('legacy auth\n');
    expect(await fs.readFile(displaced, 'utf8')).toBe('legacy auth\n');
    expect(await archiveCasQuarantines(canonical)).toEqual([]);
  });

  it('never overwrites a target created between quarantine and exclusive install', async () => {
    const { canonical, now, hash } = await preparedChange('exclusive-install-race');
    const transactionId = fixture.journal.id;
    let injected = false;

    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        async beforeArchiveTargetInstall(phase, operation, target) {
          if (phase !== 'apply' || operation.type !== 'write' || injected) return;
          injected = true;
          await fs.writeFile(target, 'external auth\n');
        },
      }),
    ).rejects.toThrow('created before exclusive install');

    expect(await fs.readFile(canonical, 'utf8')).toBe('external auth\n');
    const quarantines = await archiveCasQuarantines(canonical);
    expect(quarantines).toHaveLength(1);
    expect(await fs.readFile(quarantines[0], 'utf8')).toBe('old auth\n');
    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'continue' }),
    ).rejects.toThrow(/external object|object identity changed/u);
    expect(await fs.readFile(canonical, 'utf8')).toBe('external auth\n');

    await fs.unlink(canonical);
    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
    expect(await archiveCasQuarantines(canonical)).toEqual([]);
  });

  it('continues after the exclusive target link is durable but its identity record is not', async () => {
    const { canonical, now, hash } = await preparedChange('install-record-crash');
    const transactionId = fixture.journal.id;
    let crashed = false;

    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        afterArchiveTargetInstalled(phase, operation) {
          if (phase === 'apply' && operation.type === 'write' && !crashed) {
            crashed = true;
            throw new Error('crash after exclusive install');
          }
        },
      }),
    ).rejects.toThrow('crash after exclusive install');

    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
    expect(await archiveCasQuarantines(canonical)).toEqual([]);
  });

  it('refuses to roll back over a same-content external replacement', async () => {
    const { canonical, now, hash } = await preparedChange('rollback-same-content');
    const transactionId = fixture.journal.id;
    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        afterOperation(operation) {
          if (operation.type === 'write') throw new Error('crash after canonical write');
        },
      }),
    ).rejects.toThrow('crash after canonical write');
    const displaced = path.join(path.dirname(canonical), 'transaction-write.md');
    await fs.rename(canonical, displaced);
    await fs.writeFile(canonical, 'new auth\n');

    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'rollback' }),
    ).rejects.toThrow(/external object|object identity changed/u);
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
    expect(await fs.readFile(displaced, 'utf8')).toBe('new auth\n');
    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe(
      'rolling-back',
    );
  });

  it('refuses to restore a removed spec over a same-content external recreation', async () => {
    const { canonical, now, hash } = await preparedRemoveChange('rollback-remove-recreation');
    const transactionId = fixture.journal.id;
    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        afterOperation(operation) {
          if (operation.type === 'remove') throw new Error('crash after canonical remove');
        },
      }),
    ).rejects.toThrow('crash after canonical remove');
    await fs.writeFile(canonical, 'legacy auth\n');

    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'rollback' }),
    ).rejects.toThrow(/external object|object identity changed/u);
    expect(await fs.readFile(canonical, 'utf8')).toBe('legacy auth\n');
    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe(
      'rolling-back',
    );
  });

  it('resumes rollback after crashing with the transaction write quarantined', async () => {
    const { canonical, now, hash } = await preparedChange('rollback-quarantine-crash');
    const transactionId = fixture.journal.id;
    await expect(
      applyNativeArchiveTransactionV2(paths, fixture.journal, {
        afterOperation(operation) {
          if (operation.type === 'write') throw new Error('crash after canonical write');
        },
      }),
    ).rejects.toThrow('crash after canonical write');
    const journal = await readNativeArchiveTransactionV2(paths, transactionId);
    let crashed = false;
    await expect(
      rollbackNativeArchiveTransactionV2(paths, journal, {
        afterArchiveTargetQuarantined(phase) {
          if (phase === 'rollback' && !crashed) {
            crashed = true;
            throw new Error('crash after rollback quarantine');
          }
        },
      }),
    ).rejects.toThrow('crash after rollback quarantine');
    await expect(fs.access(canonical)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await archiveCasQuarantines(canonical)).toHaveLength(2);

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'rollback',
    });
    expect(recovered.status).toBe('rolled-back');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    expect(await archiveCasQuarantines(canonical)).toEqual([]);
  });
});
