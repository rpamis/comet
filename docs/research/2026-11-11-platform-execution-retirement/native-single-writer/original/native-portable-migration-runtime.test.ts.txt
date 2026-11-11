import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isWorkspaceRuntimeMigrationFence } from '../../../domains/workflow-contract/workspace-runtime.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { withNativeMutationLock } from '../../../domains/comet-native/native-mutation-lock.js';
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
    await fs.cp(localRuntime, legacyRuntime, { recursive: true });
    await fs.rm(localRuntime, { recursive: true });
    await nativeProjectPaths(paths.projectRoot, 'docs');
    return { paths, localRuntime, legacyRuntime };
  }

  it('does not treat a validated migration fence as incomplete portable migration', async () => {
    const { paths, localRuntime, legacyRuntime } = await migratedPortableChange();
    const stateFile = path.join(localRuntime, 'state.json');
    const stateBefore = await fs.readFile(stateFile);
    const fenceBefore = await fs.readFile(legacyRuntime);
    await expect(hasIncompleteNativePortableMigration(paths, 'portable-change')).resolves.toBe(
      false,
    );
    await migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' });
    expect(await fs.readFile(stateFile)).toEqual(stateBefore);
    expect(await fs.readFile(legacyRuntime)).toEqual(fenceBefore);
  });

  it.for(['invalid-json', 'unknown-schema', 'different-change', 'symlink'] as const)(
    'refuses migration cleanup with %s local state and preserves all evidence',
    async (caseName, context) => {
      if (caseName === 'symlink') await requireFileSymlink(context);
      const { paths, localRuntime, legacyRuntime } = await migratedPortableChange();
      const stateFile = path.join(localRuntime, 'state.json');
      const value = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (caseName === 'unknown-schema') value.schema = 'comet.native.local-execution.future';
      if (caseName === 'different-change') value.change = 'another-change';
      const bytes = caseName === 'invalid-json' ? '{broken' : JSON.stringify(value);
      if (caseName === 'symlink') {
        const outside = path.join(paths.projectRoot, 'outside-state.json');
        await fs.writeFile(outside, bytes);
        await fs.unlink(stateFile);
        await fs.symlink(outside, stateFile);
      } else {
        await fs.writeFile(stateFile, bytes);
      }
      const projection = path.join(paths.changesDir, 'portable-change', 'checkpoint.md');
      const evidence = path.join(localRuntime, 'check.log');
      await fs.writeFile(projection, 'old projection');
      await fs.writeFile(evidence, 'retained evidence');
      const fenceBefore = await fs.readFile(legacyRuntime);

      await expect(
        migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' }),
      ).rejects.toThrow();
      await expect(
        nativeDoctorCommand(['portable-change', '--repair'], paths.projectRoot),
      ).rejects.toThrow();
      expect(await fs.readFile(stateFile, 'utf8')).toBe(bytes);
      expect(await fs.readFile(projection, 'utf8')).toBe('old projection');
      expect(await fs.readFile(evidence, 'utf8')).toBe('retained evidence');
      expect(await fs.readFile(legacyRuntime)).toEqual(fenceBefore);
      if (caseName === 'symlink') expect((await fs.lstat(stateFile)).isSymbolicLink()).toBe(true);
    },
  );

  it('rejects a changed fence target when repairing with captured project paths', async () => {
    const { paths, localRuntime, legacyRuntime } = await migratedPortableChange();
    const fence = JSON.parse(await fs.readFile(legacyRuntime, 'utf8'));
    fence.target = path.join(paths.changesRuntimeDir, 'another-change');
    const changedFence = JSON.stringify(fence);
    await fs.writeFile(legacyRuntime, changedFence);
    const stateBefore = await fs.readFile(path.join(localRuntime, 'state.json'));

    await expect(hasIncompleteNativePortableMigration(paths, 'portable-change')).rejects.toThrow();
    await expect(
      migrateNativeLegacyChangeToPortable({ paths, name: 'portable-change' }),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(localRuntime, 'state.json'))).toEqual(stateBefore);
    expect(await fs.readFile(legacyRuntime, 'utf8')).toBe(changedFence);
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

  it('commits portable YAML before cleaning legacy Runtime and is idempotent', async () => {
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
      'state.json',
    ]);
    await expect(
      fs.stat(path.join(paths.changesDir, 'legacy-change', 'evidence.md')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.stat(path.join(paths.changesDir, 'legacy-change', 'verification.md')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await migrateNativeLegacyChangeToPortable({ paths, name: 'legacy-change' })).toEqual(
      migrated,
    );
  });

  it('finishes cleanup and rebuilds local state when the portable YAML outlives its transaction', async () => {
    const paths = await legacyChange();
    const migrated = await migrateNativeLegacyChangeToPortable({
      paths,
      name: 'legacy-change',
    });
    const activeDir = path.join(paths.changesDir, 'legacy-change');
    const legacyRuntime = path.join(activeDir, 'runtime');
    const localRuntime = path.join(paths.changesRuntimeDir, 'legacy-change');
    await fs.mkdir(legacyRuntime, { recursive: true });
    await fs.writeFile(path.join(legacyRuntime, 'trajectory.jsonl'), '{"type":"legacy-history"}\n');
    await fs.writeFile(path.join(activeDir, 'checkpoint.md'), 'legacy projection');
    await fs.rm(localRuntime, { recursive: true, force: true });

    const recovered = await migrateNativeLegacyChangeToPortable({
      paths,
      name: 'legacy-change',
    });

    expect(recovered).toEqual(migrated);
    expect(await isWorkspaceRuntimeMigrationFence(legacyRuntime, localRuntime)).toBe(true);
    await expect(fs.stat(path.join(activeDir, 'checkpoint.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await fs.readdir(localRuntime)).sort()).toEqual(['state.json', 'trajectory.jsonl']);
    expect(await fs.readFile(path.join(localRuntime, 'trajectory.jsonl'), 'utf8')).toBe(
      '{"type":"legacy-history"}\n',
    );
    expect(
      JSON.parse(await fs.readFile(path.join(localRuntime, 'state.json'), 'utf8')),
    ).toMatchObject({
      schema: 'comet.native.local-execution.v4',
      change: 'legacy-change',
      basedOnStateVersion: migrated.state_version,
      execution: null,
      checks: [],
    });
  });

  it('recognizes only valid portable migration journals and lets that migration resume itself', async () => {
    const paths = await legacyChange();
    await fs.writeFile(path.join(paths.transactionsDir, 'notes.json'), '{"status":"prepared"}');
    await expect(
      withNativeMutationLock(paths, 'unrelated file probe', async () => 'allowed'),
    ).resolves.toBe('allowed');

    const invalidTransaction = path.join(
      paths.transactionsDir,
      'portable-migration-invalid-change.json',
    );
    await fs.writeFile(invalidTransaction, '{}\n');
    await expect(
      withNativeMutationLock(paths, 'invalid transaction probe', async () => 'blocked'),
    ).rejects.toThrow('transaction recovery is required');
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
    await expect(
      withNativeMutationLock(paths, 'completed transaction probe', async () => 'allowed'),
    ).resolves.toBe('allowed');
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
