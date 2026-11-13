import { readNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { withNativeMutation } from '../../../domains/comet-native/native-mutation.js';
import {
  hasIncompleteNativePortableMigration,
  migrateNativeLegacyChangeToPortable,
} from '../../../domains/comet-native/native-portable-migration-runtime.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';
import { writeNativeWorkspaceIdentity } from '../../../domains/comet-native/native-workspace.js';

describe('Native portable migration Runtime', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function legacyChange(): Promise<NativeProjectPaths> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-migrate-runtime-'));
    roots.push(root);
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    const changeDir = path.join(paths.changesDir, 'legacy-change');
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Migrated behavior remains pending verification.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'comet-state.yaml'),
      stringify({
        schema: 'comet.native.v3',
        minimum_runtime_version: 3,
        revision: 4,
        verification_protocol: 'legacy-v1',
        name: 'legacy-change',
        language: 'en',
        phase: 'verify',
        brief: 'brief.md',
        approval: 'confirmed',
        approved_contract_hash: 'a'.repeat(64),
        spec_changes: [],
        verification_result: 'pass',
        verification_report: 'verification.md',
        implementation_scope: `runtime/evidence/scopes/${'b'.repeat(64)}.json`,
        verification_evidence: `runtime/evidence/verifications/${'c'.repeat(64)}.json`,
        partial_allowance: null,
        archived: false,
        created_at: '2026-08-01',
        run_id: 'legacy-run',
      }),
    );
    await fs.mkdir(path.join(paths.changesRuntimeDir, 'legacy-change', 'evidence'), {
      recursive: true,
    });
    await fs.writeFile(path.join(changeDir, 'evidence.md'), 'legacy evidence');
    await fs.writeFile(path.join(changeDir, 'verification.md'), 'legacy verification: passed');
    return paths;
  }

  async function portableChange(): Promise<NativeProjectPaths> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-report-'));
    roots.push(root);
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'portable-change', language: 'en' });
    return paths;
  }

  async function migratedPortableChange() {
    const paths = await portableChange();
    const localRuntime = path.join(paths.changesRuntimeDir, 'portable-change');
    const legacyRuntime = path.join(paths.changesDir, 'portable-change', 'runtime');
    await fs.mkdir(legacyRuntime, { recursive: true });
    return { paths, localRuntime, legacyRuntime };
  }

  it('keeps committed portable business without rebuilding a retired fence or execution mirror', async () => {
    const { paths, localRuntime, legacyRuntime } = await migratedPortableChange(),
      file = path.join(paths.changesDir, 'portable-change', 'comet-state.yaml'),
      before = await fs.readFile(file),
      state = await readNativePortableState(file);
    await expect(hasIncompleteNativePortableMigration(paths, 'portable-change')).resolves.toBe(
      false,
    );
    expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' })).toEqual(
      state,
    );
    expect(await fs.readFile(file)).toEqual(before);
    expect((await fs.lstat(legacyRuntime)).isDirectory()).toBe(true);
    await expect(fs.access(path.join(localRuntime, 'state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.for(['invalid-json', 'unknown-schema', 'different-change', 'symlink'] as const)(
    'preserves ignored %s local cache without changing portable business',
    async (kind, context) => {
      if (kind === 'symlink') await requireFileSymlink(context);
      const { paths, localRuntime } = await migratedPortableChange(),
        file = path.join(paths.changesDir, 'portable-change', 'comet-state.yaml'),
        before = await fs.readFile(file),
        state = await readNativePortableState(file),
        cache = path.join(localRuntime, 'state.json');
      await fs.mkdir(localRuntime, { recursive: true });
      const source =
        kind === 'invalid-json'
          ? '{SIMULATED retired cache'
          : JSON.stringify({
              schema:
                kind === 'unknown-schema'
                  ? 'SIMULATED-future-cache'
                  : 'comet.native.local-execution.v4',
              change: 'another-change',
              execution: { status: 'failed' },
            });
      if (kind === 'symlink') {
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'native-retired-cache-target-'));
        roots.push(outside);
        const target = path.join(outside, 'state.json');
        await fs.writeFile(target, source);
        await fs.symlink(target, cache);
      } else await fs.writeFile(cache, source);
      expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' })).toEqual(
        state,
      );
      expect(await fs.readFile(file)).toEqual(before);
      expect(await fs.readFile(cache, 'utf8')).toBe(source);
      expect((await fs.lstat(cache)).isSymbolicLink()).toBe(kind === 'symlink');
    },
  );

  it('does not use replaced legacy cache paths as portable business authority', async () => {
    const { paths, legacyRuntime } = await migratedPortableChange(),
      file = path.join(paths.changesDir, 'portable-change', 'comet-state.yaml'),
      bytes = await fs.readFile(file),
      state = await readNativePortableState(file),
      original = legacyRuntime + '-original';
    await fs.writeFile(path.join(legacyRuntime, 'cache.txt'), 'SIMULATED original retired cache');
    await fs.rename(legacyRuntime, original);
    await fs.mkdir(legacyRuntime);
    await fs.writeFile(path.join(legacyRuntime, 'cache.txt'), 'SIMULATED replaced retired cache');
    expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' })).toEqual(
      state,
    );
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(await fs.readFile(path.join(original, 'cache.txt'), 'utf8')).toBe(
      'SIMULATED original retired cache',
    );
    expect(await fs.readFile(path.join(legacyRuntime, 'cache.txt'), 'utf8')).toBe(
      'SIMULATED replaced retired cache',
    );
  });

  it('does not treat a portable verification report as incomplete migration', async () => {
    const paths = await portableChange();
    await fs.writeFile(
      path.join(paths.changesDir, 'portable-change', 'verification.md'),
      '# Verification\n\nPassed\n',
    );

    await expect(hasIncompleteNativePortableMigration(paths, 'portable-change')).resolves.toBe(
      false,
    );
  });

  it('commits portable YAML while retaining legacy evidence and is idempotent', async () => {
    const paths = await legacyChange();
    const migrated = await migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' });
    expect(migrated).toMatchObject({
      schema: 'comet.native.v4',
      phase: 'build',
      verification_result: 'pending',
      builder_handoff: null,
      loop: { iteration: 1, attempt: 0 },
    });
    expect(JSON.stringify(migrated)).not.toContain('a'.repeat(64));
    expect((await fs.readdir(path.join(paths.changesRuntimeDir, 'legacy-change'))).sort()).toEqual([
      'evidence',
    ]);
    expect(
      await fs.readFile(path.join(paths.changesDir, 'legacy-change', 'evidence.md'), 'utf8'),
    ).toBe('legacy evidence');
    expect(
      await fs.readFile(path.join(paths.changesDir, 'legacy-change', 'verification.md'), 'utf8'),
    ).toBe('legacy verification: passed');
    expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' })).toEqual(
      migrated,
    );
  });

  it('retains committed portable history without rebuilding retired local projections', async () => {
    const paths = await legacyChange(),
      migrated = await migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' }),
      active = path.join(paths.changesDir, 'legacy-change'),
      legacyRuntime = path.join(active, 'runtime'),
      localRuntime = path.join(paths.changesRuntimeDir, 'legacy-change');
    await fs.mkdir(legacyRuntime, { recursive: true });
    await fs.writeFile(path.join(legacyRuntime, 'trajectory.jsonl'), '{"type":"legacy-history"}\n');
    await fs.writeFile(path.join(active, 'checkpoint.md'), 'legacy projection');
    await fs.rm(localRuntime, { recursive: true, force: true });
    const file = path.join(active, 'comet-state.yaml'),
      bytes = await fs.readFile(file);
    expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' })).toEqual(
      migrated,
    );
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(await fs.readFile(path.join(legacyRuntime, 'trajectory.jsonl'), 'utf8')).toBe(
      '{"type":"legacy-history"}\n',
    );
    expect(await fs.readFile(path.join(active, 'checkpoint.md'), 'utf8')).toBe('legacy projection');
    await expect(fs.access(localRuntime)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recognizes only valid portable migration journals and lets that migration resume itself', async () => {
    const paths = await legacyChange();
    await fs.writeFile(path.join(paths.transactionsDir, 'notes.json'), '{"status":"prepared"}');
    await expect(withNativeMutation(paths, async () => 'allowed')).resolves.toBe('allowed');

    const invalidTransaction = path.join(
      paths.transactionsDir,
      'portable-migration-invalid-change.json',
    );
    await fs.writeFile(invalidTransaction, '{}\n');
    await expect(withNativeMutation(paths, async () => 'blocked')).rejects.toThrow(
      'transaction recovery is required',
    );
    await fs.rm(invalidTransaction);

    const transactionFile = path.join(
      paths.transactionsDir,
      'portable-migration-legacy-change.json',
    );
    await fs.writeFile(
      transactionFile,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: 'legacy-change',
        fromSchema: 'comet.native.v3',
        status: 'prepared',
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    await expect(
      createNativePortableChange({ paths, name: 'blocked-by-migration', language: 'en' }),
    ).rejects.toThrow('transaction recovery is required');
    const migrated = await migrateNativeLegacyChangeToPortable({
      paths,
      name: 'legacy-change',
    });
    expect(migrated).toMatchObject({ schema: 'comet.native.v4', name: 'legacy-change' });
    await expect(fs.stat(transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });

    await fs.writeFile(
      transactionFile,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: 'legacy-change',
        fromSchema: 'comet.native.v3',
        status: 'committed',
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    await expect(withNativeMutation(paths, async () => 'allowed')).resolves.toBe('allowed');
    await expect(
      migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' }),
    ).resolves.toEqual(migrated);
    await expect(fs.stat(transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to migrate an isolated legacy change from the wrong checkout', async () => {
    const paths = await legacyChange();
    await writeNativeWorkspaceIdentity({
      paths,
      name: 'legacy-change',
      revision: 4,
      binding: {
        isolation: 'branch',
        changeBranch: 'comet/legacy-change',
        targetBranch: 'main',
      },
    });

    await expect(
      migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' }),
    ).rejects.toThrow('requires its bound Git branch or worktree');
    await expect(
      fs.readFile(path.join(paths.changesDir, 'legacy-change', 'comet-state.yaml'), 'utf8'),
    ).resolves.toContain('schema: comet.native.v3');
  });

  it('refuses to migrate a current legacy change when its saved branch does not match', async () => {
    const paths = await legacyChange();
    await writeNativeWorkspaceIdentity({
      paths,
      name: 'legacy-change',
      revision: 4,
      binding: {
        isolation: 'current',
        changeBranch: 'comet/legacy-change',
        targetBranch: null,
      },
    });

    await expect(
      migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' }),
    ).rejects.toThrow('requires its bound Git branch or worktree');
    await expect(
      fs.readFile(path.join(paths.changesDir, 'legacy-change', 'comet-state.yaml'), 'utf8'),
    ).resolves.toContain('schema: comet.native.v3');
  });
});
