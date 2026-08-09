import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { migrateNativeLegacyChangeToPortable } from '../../../domains/comet-native/native-portable-migration-runtime.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native portable Doctor', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-doctor-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function createPortable(name: string): Promise<void> {
    await createNativePortableChange({ paths, name, language: 'en' });
  }

  async function createLegacy(name: string): Promise<void> {
    const changeDir = path.join(paths.changesDir, name);
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Preserve the legacy behavior.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'comet-state.yaml'),
      stringify({
        schema: 'comet.native.v3',
        minimum_runtime_version: 3,
        revision: 1,
        verification_protocol: 'legacy-v1',
        name,
        language: 'en',
        phase: 'shape',
        brief: 'brief.md',
        approval: null,
        approved_contract_hash: null,
        spec_changes: [],
        verification_result: 'pending',
        verification_report: null,
        implementation_scope: null,
        verification_evidence: null,
        partial_allowance: null,
        archived: false,
        created_at: '2026-08-01',
        run_id: null,
      }),
    );
    await fs.mkdir(path.join(paths.changesRuntimeDir, name), { recursive: true });
  }

  it('keeps a fresh portable change healthy in named and project-wide Doctor', async () => {
    await createPortable('fresh-portable');

    await expect(nativeDoctorCommand(['fresh-portable'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', change: 'fresh-portable' },
    });
    await expect(nativeDoctorCommand([], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        workflow: 'native-portable',
        findings: [],
      },
    });
  });

  it('merges portable statuses with legacy migration findings in a mixed project', async () => {
    await createPortable('portable-change');
    await createLegacy('legacy-change');

    const result = await nativeDoctorCommand([], projectRoot);

    expect(result).toMatchObject({
      command: 'doctor',
      exitCode: 65,
      data: {
        healthy: false,
        workflow: 'native-mixed',
        changes: [{ name: 'portable-change', schema: 'comet.native.status.v2' }],
        legacyChanges: ['legacy-change'],
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            code: 'portable-migration-required',
            repair: 'migrate',
          }),
        ]),
      },
      error: { code: 'invalid-data', message: 'Native project needs attention' },
    });
  });

  it('reports an active and archived portable change with the same name as unhealthy', async () => {
    const name = 'layout-conflict';
    await createPortable(name);
    const archiveDir = path.join(paths.archiveDir, `2026-08-09-${name}`);
    await fs.cp(path.join(paths.changesDir, name), archiveDir, { recursive: true });

    const result = await nativeDoctorCommand([name], projectRoot);

    expect(result).toMatchObject({
      command: 'doctor',
      exitCode: 65,
      data: {
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        findings: [
          {
            severity: 'error',
            code: 'portable-active-archive-conflict',
            path: archiveDir,
          },
        ],
      },
      error: { code: 'invalid-data', message: 'Native project needs attention' },
    });
  });

  it('finishes an incomplete portable migration through named Doctor repair', async () => {
    const name = 'migration-recovery';
    await createLegacy(name);
    const state = await migrateNativeLegacyChangeToPortable({ paths, name });
    const activeDir = path.join(paths.changesDir, name);
    const legacyRuntime = path.join(activeDir, 'runtime');
    await fs.mkdir(legacyRuntime, { recursive: true });
    await fs.writeFile(path.join(legacyRuntime, 'trajectory.jsonl'), 'legacy');
    await fs.writeFile(path.join(activeDir, 'evidence.md'), 'legacy projection');
    await fs.rm(path.join(paths.changesRuntimeDir, name), { recursive: true, force: true });

    const inspected = await nativeDoctorCommand([name], projectRoot);
    expect(inspected).toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [{ code: 'portable-migration-incomplete', repair: 'migrate' }],
      },
    });

    const repaired = await nativeDoctorCommand([name, '--repair'], projectRoot);
    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        repaired: true,
        migration: { recovered: true, to: 'comet.native.v4', stateVersion: state.state_version },
      },
    });
    await expect(fs.stat(legacyRuntime)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(activeDir, 'evidence.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readdir(path.join(paths.changesRuntimeDir, name))).toEqual(['state.json']);
  });

  it('reports and resumes a persisted portable migration transaction', async () => {
    const name = 'migration-transaction';
    await createLegacy(name);
    const file = path.join(paths.transactionsDir, `portable-migration-${name}.json`);
    await fs.writeFile(
      file,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: name,
        fromSchema: 'comet.native.v3',
        status: 'prepared',
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    await expect(nativeDoctorCommand([name], projectRoot)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        findings: [
          expect.objectContaining({
            code: 'portable-migration-incomplete',
            path: file,
            repair: 'migrate',
          }),
        ],
      },
    });
    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        repaired: true,
        migration: { recovered: true, to: 'comet.native.v4' },
      },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs a persisted portable transaction from project-wide Doctor', async () => {
    const name = 'project-migration-transaction';
    await createLegacy(name);
    const file = path.join(paths.transactionsDir, `portable-migration-${name}.json`);
    await fs.writeFile(
      file,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: name,
        fromSchema: 'comet.native.v3',
        status: 'prepared',
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    const repaired = await nativeDoctorCommand(['--repair'], projectRoot);

    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        workflow: 'native-portable',
        repaired: true,
        repairedPortableTransactions: [
          { kind: 'migration', change: name, transactionId: expect.any(String) },
        ],
      },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
