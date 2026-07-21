import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCheckpoint, readTrajectory } from '../../../domains/engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt } from '../../../domains/engine/storage-run.js';
import { archiveNativeChange } from '../../../domains/comet-native/native-archive.js';
import { inspectNativeArchivePreflight } from '../../../domains/comet-native/native-archive-inspection.js';
import {
  compareAndSwapNativeChange,
  createNativeChange,
  NativeRuntimeCompatibilityError,
  NativeSchemaMigrationRequiredError,
  nativeChangeDir,
  readNativeChange,
  readNativeChangeFile,
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
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_V2_CHANGE_SCHEMA,
  type NativeChangeState,
  type NativePhase,
  type NativeProjectPaths,
  type NativeSchemaMigrationHooks,
} from '../../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

function legacyDocument(state: NativeChangeState): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...state };
  delete fields.minimum_runtime_version;
  delete fields.revision;
  delete fields.approved_contract_hash;
  delete fields.implementation_scope;
  delete fields.verification_evidence;
  delete fields.partial_allowance;
  return { ...fields, schema: NATIVE_LEGACY_CHANGE_SCHEMA };
}

function v2Document(state: NativeChangeState): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...state };
  delete fields.approved_contract_hash;
  delete fields.implementation_scope;
  delete fields.verification_evidence;
  delete fields.partial_allowance;
  return {
    ...fields,
    schema: NATIVE_V2_CHANGE_SCHEMA,
    minimum_runtime_version: 2,
  };
}

const brief = `# Outcome
Ship the feature.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The feature works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use existing APIs.
# Open questions

# Verification expectations
Run focused tests.
`;

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
    const file = path.join(nativeChangeDir(paths, name), 'comet-state.yaml');
    await fs.writeFile(file, stringify(legacyDocument(state)));
    await fs.rm(nativeBaselineManifestFile(paths, name), { force: true });
    return file;
  }

  async function seedCurrentPhase(
    name: string,
    phase: NativePhase,
  ): Promise<{ changeDir: string; state: NativeChangeState }> {
    const created = await createNativeChange({ paths, name, language: 'en' });
    const changeDir = nativeChangeDir(paths, created.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    if (phase !== 'shape') {
      await advanceNativeChange({
        paths,
        name,
        evidence: { summary: 'shape is ready' },
        runId: () => `${name}-run`,
        now: new Date('2026-07-17T00:00:00.000Z'),
      });
    }
    if (phase === 'verify' || phase === 'archive') {
      await fs.writeFile(path.join(projectRoot, `${name}.ts`), 'export const ready = true;\n');
      await advanceNativeChange({
        paths,
        name,
        evidence: { summary: 'build is ready', artifacts: [`${name}.ts`] },
        now: new Date('2026-07-17T00:01:00.000Z'),
      });
    }
    if (phase === 'archive') {
      await fs.writeFile(
        path.join(changeDir, 'verification.md'),
        await nativeVerificationFixtureReport({ paths, name, evidenceRefs: [`${name}.ts`] }),
      );
      await advanceNativeChange({
        paths,
        name,
        evidence: {
          summary: 'verification passed',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
        now: new Date('2026-07-17T00:02:00.000Z'),
      });
    }
    return { changeDir, state: await readNativeChange(paths, name) };
  }

  async function downgradeToV2(state: NativeChangeState): Promise<string> {
    const file = path.join(nativeChangeDir(paths, state.name), 'comet-state.yaml');
    await fs.writeFile(file, stringify(v2Document(state)));
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

  it('rejects an incomplete migration baseline before changing legacy state', async () => {
    const file = await seedLegacyChange('incomplete-migration-baseline');
    const originalState = await fs.readFile(file, 'utf8');
    await fs.writeFile(
      path.join(projectRoot, 'oversized-migration.bin'),
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );

    await expect(
      migrateNativeChange({ paths, name: 'incomplete-migration-baseline' }),
    ).rejects.toMatchObject({
      name: 'NativeBaselineIncompleteError',
      code: 'native-baseline-incomplete',
      omittedCount: 1,
      samplePaths: ['oversized-migration.bin'],
    });
    await expect(fs.readFile(file, 'utf8')).resolves.toBe(originalState);
    await expect(
      readNativeBaselineManifest(paths, 'incomplete-migration-baseline'),
    ).resolves.toBeNull();
    await expect(
      inspectPendingNativeSchemaMigration(paths, 'incomplete-migration-baseline'),
    ).resolves.toMatchObject({ fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA });
  });

  it('projects a v2 change as migration-required in status and show without rewriting it', async () => {
    const { state } = await seedCurrentPhase('v2-visible', 'shape');
    const file = await downgradeToV2(state);
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const before = await fs.readFile(file, 'utf8');

    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(
      NativeSchemaMigrationRequiredError,
    );
    expect(await inspectNativeStatus(paths, state.name)).toMatchObject({
      name: state.name,
      phase: 'shape',
      revision: state.revision,
      schema: NATIVE_V2_CHANGE_SCHEMA,
      migrationRequired: true,
      minimumRuntimeVersion: 2,
      nextCommand: null,
    });
    const shown = await runNativeCli(['show', state.name, '--json', '--project-root', projectRoot]);
    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout!)).toMatchObject({
      data: {
        name: state.name,
        schema: NATIVE_V2_CHANGE_SCHEMA,
        migrationRequired: true,
        minimumRuntimeVersion: 2,
      },
    });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it.each<NativePhase>(['shape', 'build'])(
    'migrates a stable v2 %s state to v3 without changing its phase or revision',
    async (phase) => {
      const name = `v2-${phase}`;
      const { changeDir, state } = await seedCurrentPhase(name, phase);
      await downgradeToV2(state);

      const migrated = await migrateNativeChange({
        paths,
        name,
        now: new Date('2026-07-17T01:00:00.000Z'),
        id: () => `migration-${phase}`,
      });
      expect(migrated).toMatchObject({
        schema: NATIVE_CHANGE_SCHEMA,
        minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
        phase,
        revision: state.revision,
        implementation_scope: null,
        verification_evidence: null,
        partial_allowance: null,
      });
      if (phase !== 'shape') {
        expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toMatchObject({
          runId: state.run_id,
          currentStep: phase,
        });
      }
      const status = await inspectNativeStatus(paths, name, { details: true });
      expect(status.phase).toBe(phase);
      expect((status.findings ?? []).map((finding) => finding.code)).not.toContain(
        'run-phase-mismatch',
      );
    },
  );

  it.each<NativePhase>(['build', 'verify', 'archive'])(
    'migrates a stable v1 %s state through v2 without leaving Run/state phase drift',
    async (phase) => {
      const name = `v1-${phase}`;
      const { changeDir, state } = await seedCurrentPhase(name, phase);
      const file = path.join(changeDir, 'comet-state.yaml');
      await fs.writeFile(file, stringify(legacyDocument(state)));

      const migrated = await migrateNativeChange({
        paths,
        name,
        now: new Date('2026-07-17T01:30:00.000Z'),
        id: () => `migration-v1-${phase}`,
      });
      const evidencePhase = phase === 'verify' || phase === 'archive';
      expect(migrated).toMatchObject({
        schema: NATIVE_CHANGE_SCHEMA,
        phase: evidencePhase ? 'build' : phase,
        revision: evidencePhase ? 2 : 1,
        implementation_scope: null,
        verification_evidence: null,
        partial_allowance: null,
      });
      if (evidencePhase) {
        expect(migrated).toMatchObject({
          verification_result: 'pending',
          verification_report: null,
        });
      }
      expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toMatchObject({
        runId: state.run_id,
        currentStep: evidencePhase ? 'build' : phase,
      });
      const status = await inspectNativeStatus(paths, name, { details: true });
      expect((status.findings ?? []).map((finding) => finding.code)).not.toEqual(
        expect.arrayContaining(['run-phase-mismatch', 'checkpoint-mismatch']),
      );
    },
  );

  it('retreats a stable v2 Archive state to Build and synchronizes Run history exactly once', async () => {
    const name = 'v2-archive';
    const { changeDir, state } = await seedCurrentPhase(name, 'archive');
    await downgradeToV2(state);

    const migrated = await migrateNativeChange({
      paths,
      name,
      now: new Date('2026-07-17T02:00:00.000Z'),
      id: () => 'migration-archive',
    });
    expect(migrated).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      phase: 'build',
      revision: state.revision + 1,
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
      archived: false,
    });
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    expect(run).toMatchObject({
      runId: state.run_id,
      currentStep: 'build',
      pending: null,
      status: 'running',
    });
    const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
    expect(
      trajectory.filter(
        (event) =>
          event.type === 'state_migrated' && event.data.migrationId === 'migration-archive',
      ),
    ).toHaveLength(1);
    expect(await readCheckpoint(changeDir, run.checkpointRef)).toMatchObject({
      runId: run.runId,
      stateVersion: run.iteration,
      trajectoryOffset: trajectory.length,
    });

    const status = await inspectNativeStatus(paths, name, { details: true });
    expect(status).toMatchObject({ phase: 'build', archiveReady: false });
    expect((status.findings ?? []).map((finding) => finding.code)).not.toEqual(
      expect.arrayContaining(['run-phase-mismatch', 'checkpoint-mismatch', 'trajectory-invalid']),
    );
    await migrateNativeChange({ paths, name });
    expect(await readTrajectory(changeDir, run.trajectoryRef)).toEqual(trajectory);
  });

  it.each<NativePhase>(['verify', 'archive'])(
    'retreats a stable v2 %s change to Build and lets the current runtime complete a fresh verified archive',
    async (phase) => {
      const name = `v2-${phase}-full-lifecycle`;
      const { state } = await seedCurrentPhase(name, phase);
      await downgradeToV2(state);

      const migrated = await migrateNativeChange({
        paths,
        name,
        now: new Date('2026-07-17T02:30:00.000Z'),
        id: () => `migration-${phase}-full-lifecycle`,
      });
      expect(migrated).toMatchObject({
        phase: 'build',
        revision: state.revision + 1,
        verification_result: 'pending',
        verification_report: null,
        implementation_scope: null,
        verification_evidence: null,
        archived: false,
      });

      const rebuilt = await advanceNativeChange({
        paths,
        name,
        evidence: {
          summary: 'implementation scope was re-established under the current runtime',
          artifacts: [`${name}.ts`],
          confirmed: true,
        },
        now: new Date('2026-07-17T02:31:00.000Z'),
      });
      expect(rebuilt.change).toMatchObject({
        phase: 'verify',
        approved_contract_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        implementation_scope: expect.stringMatching(
          /^runtime\/evidence\/scopes\/[a-f0-9]{64}\.json$/u,
        ),
      });

      await fs.writeFile(
        path.join(nativeChangeDir(paths, name), 'verification.md'),
        await nativeVerificationFixtureReport({ paths, name, evidenceRefs: [`${name}.ts`] }),
      );
      const verified = await advanceNativeChange({
        paths,
        name,
        evidence: {
          summary: 'fresh verification passed under the current runtime',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
        now: new Date('2026-07-17T02:32:00.000Z'),
      });
      expect(verified.change).toMatchObject({
        phase: 'archive',
        verification_result: 'pass',
        verification_evidence: expect.stringMatching(
          /^runtime\/evidence\/verifications\/[a-f0-9]{64}\.json$/u,
        ),
      });

      const preflight = await inspectNativeArchivePreflight({
        paths,
        name,
        now: new Date('2026-07-17T02:33:00.000Z'),
      });
      expect(preflight).toMatchObject({ ready: true, findingCodes: [] });
      const archived = await archiveNativeChange({
        paths,
        name,
        expectedPreflightHash: preflight.preflightHash,
        now: new Date('2026-07-17T02:33:00.000Z'),
      });
      expect(
        await readNativeChangeFile(path.join(archived.archiveDir, 'comet-state.yaml')),
      ).toMatchObject({
        phase: 'archive',
        archived: true,
      });
      expect(archived.archiveDir).toContain(name);
    },
  );

  it.each<{
    label: string;
    slug: string;
    hook: keyof NativeSchemaMigrationHooks;
  }>([
    { label: 'state write', slug: 'state', hook: 'afterStateWritten' },
    { label: 'Run state write', slug: 'run', hook: 'afterRunStateWritten' },
    { label: 'trajectory write', slug: 'trajectory', hook: 'afterTrajectoryWritten' },
    { label: 'checkpoint write', slug: 'checkpoint', hook: 'afterCheckpointWritten' },
  ])(
    'recovers a v2 Archive retreat interrupted after $label without duplicate migration events',
    async ({ slug, hook }) => {
      const name = `v2-archive-${slug}`;
      const { changeDir, state } = await seedCurrentPhase(name, 'archive');
      await downgradeToV2(state);
      const hooks = {
        [hook]: () => {
          throw new Error(`interrupt after ${slug}`);
        },
      } as NativeSchemaMigrationHooks;

      await expect(
        migrateNativeChange({
          paths,
          name,
          now: new Date('2026-07-17T03:00:00.000Z'),
          id: () => `migration-${slug}`,
          hooks,
        }),
      ).rejects.toThrow(`interrupt after ${slug}`);
      expect(await inspectPendingNativeSchemaMigration(paths, name)).not.toBeNull();

      const recovered = await migrateNativeChange({ paths, name });
      expect(recovered).toMatchObject({
        phase: 'build',
        verification_result: 'pending',
        verification_report: null,
        verification_evidence: null,
      });
      const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
      const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
      expect(
        trajectory.filter(
          (event) =>
            event.type === 'state_migrated' && event.data.migrationId === `migration-${slug}`,
        ),
      ).toHaveLength(1);
      expect(await readCheckpoint(changeDir, run.checkpointRef)).toMatchObject({
        runId: run.runId,
        stateVersion: run.iteration,
        trajectoryOffset: trajectory.length,
      });
      expect((await inspectNativeStatus(paths, name, { details: true })).findings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'run-phase-mismatch' }),
          expect.objectContaining({ code: 'checkpoint-mismatch' }),
        ]),
      );
    },
  );

  it('fails closed when a prepared migration target is changed without its content hash', async () => {
    const { state } = await seedCurrentPhase('tampered-migration', 'shape');
    const changeFile = await downgradeToV2(state);
    const source = await fs.readFile(changeFile, 'utf8');
    await expect(
      migrateNativeChange({
        paths,
        name: state.name,
        id: () => 'migration-tampered',
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt after prepared migration');
          },
        },
      }),
    ).rejects.toThrow('interrupt after prepared migration');
    const journalFile = nativeSchemaMigrationJournalFile(paths, state.name);
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8')) as {
      nextState: Record<string, unknown>;
    };
    journal.nextState.approval = 'implicit';
    await fs.writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n');

    await expect(inspectPendingNativeSchemaMigration(paths, state.name)).rejects.toThrow(
      'target hash does not match',
    );
    await expect(migrateNativeChange({ paths, name: state.name })).rejects.toThrow(
      'target hash does not match',
    );
    expect(await fs.readFile(changeFile, 'utf8')).toBe(source);
  });

  it('does not continue a prepared schema migration over a pending v2 checkpoint journal', async () => {
    const { changeDir, state } = await seedCurrentPhase('checkpoint-before-migration', 'shape');
    const changeFile = await downgradeToV2(state);
    const source = await fs.readFile(changeFile, 'utf8');
    await expect(
      migrateNativeChange({
        paths,
        name: state.name,
        id: () => 'migration-before-checkpoint',
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt before checkpoint appeared');
          },
        },
      }),
    ).rejects.toThrow('interrupt before checkpoint appeared');
    await fs.writeFile(path.join(changeDir, 'runtime', 'checkpoint-journal.json'), '{}\n');

    await expect(migrateNativeChange({ paths, name: state.name })).rejects.toThrow(
      'pending progress checkpoint',
    );
    expect(await fs.readFile(changeFile, 'utf8')).toBe(source);
    expect(await inspectPendingNativeSchemaMigration(paths, state.name)).not.toBeNull();
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
    const stateFile = path.join(
      nativeChangeDir(paths, 'interrupted-migration'),
      'comet-state.yaml',
    );
    const stateBeforeRecovery = await fs.readFile(stateFile, 'utf8');
    await expect(readNativeChange(paths, 'interrupted-migration')).rejects.toBeInstanceOf(
      NativeSchemaMigrationRequiredError,
    );
    expect(await inspectNativeStatus(paths, 'interrupted-migration')).toMatchObject({
      schema: NATIVE_V2_CHANGE_SCHEMA,
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
      data: { schema: NATIVE_V2_CHANGE_SCHEMA, migrationRequired: true },
    });
    expect(
      await fs.stat(nativeSchemaMigrationJournalFile(paths, 'interrupted-migration')),
    ).toBeDefined();
    expect(await readNativeBaselineManifest(paths, 'interrupted-migration')).toMatchObject({
      origin: 'legacy-migration',
      complete: true,
    });
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
    const file = path.join(nativeChangeDir(paths, state.name), 'comet-state.yaml');
    const source = stringify({
      ...state,
      schema: 'comet.native.v4',
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION + 1,
    });
    await fs.writeFile(file, source);

    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(
      NativeRuntimeCompatibilityError,
    );
    expect(await inspectNativeStatus(paths, state.name)).toMatchObject({
      phase: 'invalid',
      schema: 'comet.native.v4',
      minimumRuntimeVersion: NATIVE_RUNTIME_PROTOCOL_VERSION + 1,
      nextCommand: null,
    });
    const result = await doctorNativeProject({ paths, name: state.name, repair: true });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'change-runtime-incompatible', severity: 'error' }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  });

  it('fails closed on an unsupported older schema without inventing a migration route', async () => {
    const state = await createNativeChange({ paths, name: 'ancient-change', language: 'en' });
    const file = path.join(nativeChangeDir(paths, state.name), 'comet-state.yaml');
    const source = stringify({
      ...state,
      schema: 'comet.native.v0',
      minimum_runtime_version: 1,
    });
    await fs.writeFile(file, source);

    await expect(readNativeChange(paths, state.name)).rejects.toBeInstanceOf(
      NativeRuntimeCompatibilityError,
    );
    expect(await inspectNativeStatus(paths, state.name)).toMatchObject({
      phase: 'invalid',
      schema: 'comet.native.v0',
      minimumRuntimeVersion: 1,
      nextCommand: null,
    });
    const result = await doctorNativeProject({ paths, name: state.name, repair: true });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'change-runtime-incompatible', severity: 'error' }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  });
});
