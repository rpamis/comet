import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyNativeArchiveTransactionV2,
  createNativeArchiveTransactionV2,
  finalizeNativeArchiveTransactionV2,
  nativeArchiveTransactionPaths,
  readNativeArchiveTransactionV2,
  rollbackNativeArchiveTransactionV2,
} from '../../../domains/comet-native/native-archive-transaction.js';
import { inspectNativeArchiveContent } from '../../../domains/comet-native/native-archive-content.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  appendNativeTransactionEvent,
  type NativeArchiveTransactionJournalV2,
} from '../../../domains/comet-native/native-transaction.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native Archive transaction V2 public lifecycle', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-transaction-'));
    paths = await nativeProjectPaths(root, '.');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function journal(
    id: string,
    change: string,
    status: NativeArchiveTransactionJournalV2['status'] = 'prepared',
  ) {
    const source = path.join(paths.changesDir, change);
    await fs.mkdir(source, { recursive: true });
    const sourceContent = await inspectNativeArchiveContent(source);
    return {
      schema: 'comet.native.transaction.v2',
      id,
      kind: 'archive',
      status,
      change,
      createdAt: '2026-08-12T00:00:00.000Z',
      preflightHash: 'a'.repeat(64),
      operations: [
        {
          id: 'archive-change',
          type: 'move',
          source: `changes/${change}`,
          target: `archive/2026-08-12-${change}`,
          expectedSourceHash: sourceContent?.hash ?? 'b'.repeat(64),
          expectedTargetHash: null,
        },
      ],
    } satisfies NativeArchiveTransactionJournalV2;
  }

  it('creates, reads, applies, and finalizes an empty transaction', async () => {
    const initial = await journal('12345678-abcd', 'transaction-change');
    await createNativeArchiveTransactionV2(paths, initial);
    await expect(readNativeArchiveTransactionV2(paths, initial.id)).resolves.toMatchObject({
      status: 'prepared',
      operations: [{ id: 'archive-change', type: 'move' }],
    });

    const applying = await applyNativeArchiveTransactionV2(paths, initial);
    expect(applying.status).toBe('applying');
    const alreadyApplying = await applyNativeArchiveTransactionV2(paths, applying);
    expect(alreadyApplying.status).toBe('applying');

    await finalizeNativeArchiveTransactionV2(
      paths,
      alreadyApplying,
      'archive-finalization-started',
    );
    const finalized = await finalizeNativeArchiveTransactionV2(
      paths,
      alreadyApplying,
      'archive-finalized',
    );
    expect(finalized.status).toBe('applying');
    const committed = await finalizeNativeArchiveTransactionV2(paths, finalized, 'commit');
    expect(committed.status).toBe('committed');
    expect(nativeArchiveTransactionPaths(paths, initial.id).journal).toContain(initial.id);
  });

  it('retries a transient archive directory sharing violation without repeating completed moves', async () => {
    const initial = await journal('62345678-abcd', 'watched-change');
    await createNativeArchiveTransactionV2(paths, initial);
    const original = fs.rename.bind(fs);
    let attempts = 0;
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(source) === path.join(paths.changesDir, 'watched-change') && ++attempts === 1)
        throw Object.assign(new Error('watcher holds directory'), { code: 'EPERM' });
      return original(source, target);
    });
    try {
      const applied = await applyNativeArchiveTransactionV2(paths, initial);
      await applyNativeArchiveTransactionV2(paths, applied);
      expect(attempts).toBe(2);
      expect(
        await inspectNativeArchiveContent(path.join(paths.archiveDir, '2026-08-12-watched-change')),
      ).toMatchObject({ hash: initial.operations[0].expectedSourceHash });
    } finally {
      rename.mockRestore();
    }
  });

  it.runIf(process.platform === 'win32')(
    'preserves and resumes the same Archive transaction after a real Windows directory handle is released',
    async () => {
      const initial = await journal('72345678-abcd', 'locked-change');
      await createNativeArchiveTransactionV2(paths, initial);
      const script = path.join(root, 'directory-lock.ps1');
      await fs.writeFile(
        script,
        `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DirectoryLock {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$handle = [DirectoryLock]::CreateFile($env:COMET_TEST_LOCK_DIRECTORY, 2147483648, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
if ($handle -eq [IntPtr](-1)) { throw 'Cannot acquire test directory handle' }
try { [Console]::WriteLine('ready'); [Console]::Out.Flush(); while (-not (Test-Path -LiteralPath $env:COMET_TEST_LOCK_RELEASE)) { Start-Sleep -Milliseconds 50 } }
finally { [DirectoryLock]::CloseHandle($handle) | Out-Null }
`,
      );
      const release = path.join(root, 'release-lock');
      const holder = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', script],
        {
          windowsHide: true,
          env: {
            ...process.env,
            COMET_TEST_LOCK_DIRECTORY: path.join(paths.changesDir, 'locked-change'),
            COMET_TEST_LOCK_RELEASE: release,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      try {
        await new Promise<void>((resolve, reject) => {
          holder.once('error', reject);
          holder.once('exit', (code) =>
            reject(new Error(`Directory holder exited early: ${code}`)),
          );
          holder.stdout.on('data', (data) => {
            if (String(data).includes('ready')) resolve();
          });
        });
        await expect(applyNativeArchiveTransactionV2(paths, initial)).rejects.toThrow(
          /目录句柄.*原事务/u,
        );
        expect(
          await inspectNativeArchiveContent(path.join(paths.changesDir, 'locked-change')),
        ).toMatchObject({ hash: initial.operations[0].expectedSourceHash });
        const exited = new Promise<void>((resolve) => holder.once('exit', () => resolve()));
        await fs.writeFile(release, 'release');
        await exited;
        const recorded = await readNativeArchiveTransactionV2(paths, initial.id);
        expect(recorded.id).toBe(initial.id);
        const applied = await applyNativeArchiveTransactionV2(paths, recorded);
        await applyNativeArchiveTransactionV2(paths, applied);
        expect(
          await inspectNativeArchiveContent(
            path.join(paths.archiveDir, '2026-08-12-locked-change'),
          ),
        ).toMatchObject({ hash: initial.operations[0].expectedSourceHash });
        expect(
          await inspectNativeArchiveContent(path.join(paths.changesDir, 'locked-change')),
        ).toBeNull();
      } finally {
        holder.kill();
      }
    },
  );

  it('publishes same-volume candidates when user data is on another volume and cleans staging', async () => {
    const initial = await journal('52345678-abcd', 'cross-volume-change');
    const tx = nativeArchiveTransactionPaths(paths, initial.id);
    const staged = path.join(tx.staged, 'specs', 'sample', 'spec.md');
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.writeFile(staged, 'new spec\n');
    const content = await inspectNativeArchiveContent(staged);
    const target = path.join(paths.specsDir, 'sample', 'spec.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    initial.operations.unshift({
      id: 'write-spec',
      type: 'write',
      target: 'specs/sample/spec.md',
      staged: `runtime/transactions/${initial.id}/staged/specs/sample/spec.md`,
      expectedTargetHash: null,
      stagedHash: content!.hash,
    });
    await createNativeArchiveTransactionV2(paths, initial);
    const originalLink = fs.link.bind(fs);
    const linked: string[] = [];
    const link = vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      const fromRuntime = String(source).startsWith(paths.runtimeDir + path.sep);
      const toRuntime = String(destination).startsWith(paths.runtimeDir + path.sep);
      if (fromRuntime !== toRuntime) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      if (String(destination) === target) linked.push(String(source));
      await originalLink(source, destination);
    });
    try {
      const applying = await applyNativeArchiveTransactionV2(paths, initial);
      expect(await fs.readFile(target, 'utf8')).toBe('new spec\n');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toContain(path.join(path.dirname(target), '.comet-archive-staging'));
      await finalizeNativeArchiveTransactionV2(paths, applying, 'archive-finalization-started');
      await finalizeNativeArchiveTransactionV2(paths, applying, 'archive-finalized');
      await finalizeNativeArchiveTransactionV2(paths, applying, 'commit');
      await expect(
        fs.access(path.join(path.dirname(target), '.comet-archive-staging')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      link.mockRestore();
    }
  });

  it('rejects invalid lifecycle transitions and finalization rollback', async () => {
    const committed = await journal('22345678-abcd', 'committed-change', 'committed');
    await createNativeArchiveTransactionV2(paths, committed);
    await expect(applyNativeArchiveTransactionV2(paths, committed)).rejects.toThrow(
      'cannot apply from committed',
    );

    const rollback = await journal('32345678-abcd', 'rollback-change');
    await createNativeArchiveTransactionV2(paths, rollback);
    await expect(rollbackNativeArchiveTransactionV2(paths, rollback)).resolves.toMatchObject({
      status: 'rolled-back',
    });

    const irreversible = await journal('42345678-abcd', 'irreversible-change');
    await createNativeArchiveTransactionV2(paths, irreversible);
    await appendNativeTransactionEvent(paths, irreversible.id, 'archive-finalization-started');
    await expect(rollbackNativeArchiveTransactionV2(paths, irreversible)).rejects.toThrow(
      'finalization started',
    );
  });
});
