import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  compareAndSwapNativeChange,
  createNativeChange,
  NativeRuntimeCompatibilityError,
  NativeSchemaMigrationRequiredError,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { doctorNativeProject } from '../../../domains/comet-native/native-doctor.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  inspectPendingNativeSchemaMigration,
  migrateNativeChange,
  nativeSchemaMigrationJournalFile,
} from '../../../domains/comet-native/native-schema-migration.js';
import {
  nativeBaselineManifestFile,
  readNativeBaselineManifest,
} from '../../../domains/comet-native/native-snapshot.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  type NativeChangeState,
  type NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';

function legacyDocument(state: NativeChangeState): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...state };
  delete fields.minimum_runtime_version;
  delete fields.revision;
  return { ...fields, schema: NATIVE_LEGACY_CHANGE_SCHEMA };
}

describe('Native schema compatibility and journalized migration', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-schema-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function seedLegacyChange(name: string): Promise<string> {
    const state = await createNativeChange({ paths, name, language: 'en' });
    const file = path.join(nativeChangeDir(paths, name), 'change.yaml');
    await fs.writeFile(file, stringify(legacyDocument(state)));
    await fs.rm(nativeBaselineManifestFile(paths, name), { force: true });
    return file;
  }

  it('projects a legacy change read-only and migrates it only during explicit doctor repair', async () => {
    const file = await seedLegacyChange('legacy-change');
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const before = await fs.readFile(file, 'utf8');

    await expect(readNativeChange(paths, 'legacy-change')).rejects.toBeInstanceOf(
      NativeSchemaMigrationRequiredError,
    );
    expect(await inspectNativeStatus(paths, 'legacy-change')).toMatchObject({
      name: 'legacy-change',
      phase: 'shape',
      schema: NATIVE_LEGACY_CHANGE_SCHEMA,
      migrationRequired: true,
      minimumRuntimeVersion: 1,
      nextCommand: null,
    });
    const shown = await runNativeCli([
      'show',
      'legacy-change',
      '--json',
      '--project-root',
      projectRoot,
    ]);
    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout!)).toMatchObject({
      command: 'show',
      data: {
        name: 'legacy-change',
        schema: NATIVE_LEGACY_CHANGE_SCHEMA,
        migrationRequired: true,
        minimumRuntimeVersion: 1,
      },
    });
    const inspected = await doctorNativeProject({ paths, name: 'legacy-change' });
    expect(inspected.findings).toContainEqual(
      expect.objectContaining({
        code: 'schema-migration-required',
        severity: 'error',
        repair: 'migrate',
      }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await readNativeBaselineManifest(paths, 'legacy-change')).toBeNull();

    const repaired = await doctorNativeProject({
      paths,
      name: 'legacy-change',
      repair: true,
    });
    expect(repaired.findings).toContainEqual(
      expect.objectContaining({ code: 'schema-migrated', severity: 'info' }),
    );
    expect(await readNativeChange(paths, 'legacy-change')).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
      revision: 1,
    });
    expect(await readNativeBaselineManifest(paths, 'legacy-change')).toMatchObject({
      origin: 'legacy-migration',
    });
  });

  it('recovers a migration journal when the state write completed before interruption', async () => {
    await seedLegacyChange('interrupted-migration');
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await expect(
      migrateNativeChange({
        paths,
        name: 'interrupted-migration',
        now: new Date('2026-07-17T01:00:00.000Z'),
        id: () => 'migration-1',
        hooks: {
          afterStateWritten: () => {
            throw new Error('interrupt after migration state write');
          },
        },
      }),
    ).rejects.toThrow('interrupt after migration state write');
    const stateFile = path.join(nativeChangeDir(paths, 'interrupted-migration'), 'change.yaml');
    const stateBeforeRecovery = await fs.readFile(stateFile, 'utf8');
    await expect(readNativeChange(paths, 'interrupted-migration')).rejects.toBeInstanceOf(
      NativeSchemaMigrationRequiredError,
    );
    expect(await inspectNativeStatus(paths, 'interrupted-migration')).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      migrationRequired: true,
      nextCommand: null,
    });
    const shown = await runNativeCli([
      'show',
      'interrupted-migration',
      '--json',
      '--project-root',
      projectRoot,
    ]);
    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout!)).toMatchObject({
      data: { schema: NATIVE_CHANGE_SCHEMA, migrationRequired: true },
    });
    expect(
      await fs.stat(nativeSchemaMigrationJournalFile(paths, 'interrupted-migration')),
    ).toBeDefined();
    expect(await readNativeBaselineManifest(paths, 'interrupted-migration')).toBeNull();
    const pending = (await inspectPendingNativeSchemaMigration(paths, 'interrupted-migration'))!;
    await expect(
      compareAndSwapNativeChange(
        paths,
        { ...pending.nextState, approval: 'implicit' },
        pending.nextState.revision,
      ),
    ).rejects.toBeInstanceOf(NativeSchemaMigrationRequiredError);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(stateBeforeRecovery);

    const inspected = await doctorNativeProject({ paths, name: 'interrupted-migration' });
    expect(inspected.findings).toContainEqual(
      expect.objectContaining({ code: 'schema-migration-incomplete', repair: 'migrate' }),
    );
    const repaired = await doctorNativeProject({
      paths,
      name: 'interrupted-migration',
      repair: true,
    });
    expect(repaired.findings).toContainEqual(
      expect.objectContaining({ code: 'schema-migration-recovered', severity: 'info' }),
    );
    await expect(
      fs.access(nativeSchemaMigrationJournalFile(paths, 'interrupted-migration')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readNativeBaselineManifest(paths, 'interrupted-migration')).toMatchObject({
      origin: 'legacy-migration',
      createdAt: '2026-07-17T01:00:00.000Z',
    });
    expect(await readNativeChange(paths, 'interrupted-migration')).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      revision: 1,
    });
    await doctorNativeProject({ paths, name: 'interrupted-migration', repair: true });
    expect((await readNativeChange(paths, 'interrupted-migration')).revision).toBe(1);
  });

  it('fails closed on a schema that requires a newer runtime without rewriting it', async () => {
    const state = await createNativeChange({ paths, name: 'future-change', language: 'en' });
    const file = path.join(nativeChangeDir(paths, state.name), 'change.yaml');
    const source = stringify({
      ...state,
      schema: 'comet.native.v3',
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION + 1,
    });
    await fs.writeFile(file, source);

    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(
      NativeRuntimeCompatibilityError,
    );
    expect(await inspectNativeStatus(paths, state.name)).toMatchObject({
      phase: 'invalid',
      schema: 'comet.native.v3',
      minimumRuntimeVersion: NATIVE_RUNTIME_PROTOCOL_VERSION + 1,
      nextCommand: null,
    });
    const result = await doctorNativeProject({ paths, name: state.name, repair: true });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'change-runtime-incompatible', severity: 'error' }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  });
});
