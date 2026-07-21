import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCheckpoint, readTrajectory } from '../../../domains/engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt, writeRunStateAt } from '../../../domains/engine/storage-run.js';
import { archiveNativeChange } from '../../../domains/comet-native/native-archive.js';
import { inspectNativeArchivePreflight } from '../../../domains/comet-native/native-archive-inspection.js';
import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { doctorNativeProject } from '../../../domains/comet-native/native-doctor.js';
import { sha256Text } from '../../../domains/comet-native/native-hash.js';
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
  continueNativeTransition,
  inspectPendingNativeTransition,
  inspectPendingNativeTransitionSchema,
  inspectNativeTransitionJournalValue,
  NATIVE_TRANSITION_JOURNAL_MAX_BYTES,
  nativeTransitionJournalFile,
} from '../../../domains/comet-native/native-transition-journal.js';
import { appendNativeTrajectoryEvent } from '../../../domains/comet-native/native-trajectory.js';
import { repairNativeTrajectoryTail } from '../../../domains/comet-native/native-trajectory-recovery.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSchemaMigrationHooks,
  NativeTransitionHooks,
  NativeTransitionJournal,
} from '../../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';
import { readyNativeArchivePreflight } from '../../helpers/native-archive.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_LEGACY_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_TRANSITION_SCHEMA,
  NATIVE_V2_CHANGE_SCHEMA,
  NATIVE_V2_TRANSITION_SCHEMA,
} from '../../../domains/comet-native/native-types.js';

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

function legacyState(state: NativeChangeState): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...state };
  delete legacy.minimum_runtime_version;
  delete legacy.revision;
  delete legacy.operation;
  delete legacy.approved_contract_hash;
  delete legacy.implementation_scope;
  delete legacy.verification_evidence;
  delete legacy.partial_allowance;
  return { ...legacy, schema: NATIVE_LEGACY_CHANGE_SCHEMA };
}

function legacyTransition(journal: NativeTransitionJournal): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...journal };
  delete legacy.minimum_runtime_version;
  delete legacy.revision;
  delete legacy.operation;
  return {
    ...legacy,
    schema: NATIVE_LEGACY_TRANSITION_SCHEMA,
    previousState: legacyState(journal.previousState),
    nextState: legacyState(journal.nextState),
  };
}

function v2State(state: NativeChangeState): Record<string, unknown> {
  const previous: Record<string, unknown> = { ...state };
  delete previous.approved_contract_hash;
  delete previous.implementation_scope;
  delete previous.verification_evidence;
  delete previous.partial_allowance;
  return {
    ...previous,
    schema: NATIVE_V2_CHANGE_SCHEMA,
    minimum_runtime_version: 2,
  };
}

function v2Transition(journal: NativeTransitionJournal): Record<string, unknown> {
  const previous: Record<string, unknown> = {
    ...journal,
    schema: NATIVE_V2_TRANSITION_SCHEMA,
    minimum_runtime_version: 2,
    previousState: v2State(journal.previousState),
    nextState: v2State(journal.nextState),
  };
  delete previous.operation;
  return previous;
}

function transitionForGeneration(
  journal: NativeTransitionJournal,
  generation: 'v1' | 'v2' | 'v3',
): Record<string, unknown> {
  return structuredClone(
    generation === 'v1'
      ? legacyTransition(journal)
      : generation === 'v2'
        ? v2Transition(journal)
        : journal,
  ) as Record<string, unknown>;
}

describe('Native transition recovery', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transition-recovery-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({ paths, name: 'recover-transition', language: 'en' });
    changeDir = nativeChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('bounds the protected transition journal before JSON parsing', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'prepare an oversized journal fixture' },
        hooks: {
          afterPrepared: () => {
            throw new Error('seed oversized transition');
          },
        },
      }),
    ).rejects.toThrow('seed oversized transition');
    await fs.writeFile(
      nativeTransitionJournalFile(paths, 'recover-transition'),
      'x'.repeat(NATIVE_TRANSITION_JOURNAL_MAX_BYTES + 1),
    );

    await expect(inspectPendingNativeTransitionSchema(paths, 'recover-transition')).rejects.toThrow(
      `exceeds ${NATIVE_TRANSITION_JOURNAL_MAX_BYTES} bytes`,
    );
  });

  it.each<{
    label: string;
    hooks: NativeTransitionHooks;
  }>([
    {
      label: 'prepared journal',
      hooks: {
        afterPrepared: () => {
          throw new Error('interrupt after prepared');
        },
      },
    },
    {
      label: 'Run state write',
      hooks: {
        afterRunStateWritten: () => {
          throw new Error('interrupt after Run state');
        },
      },
    },
    {
      label: 'change state write',
      hooks: {
        afterChangeStateWritten: () => {
          throw new Error('interrupt after change state');
        },
      },
    },
  ])('continues after an interruption at $label', async ({ hooks }) => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape is ready' },
        runId: () => 'recoverable-run',
        now: new Date('2026-07-15T00:00:00Z'),
        hooks,
      }),
    ).rejects.toThrow('interrupt');
    expect(await fs.stat(nativeTransitionJournalFile(paths, 'recover-transition'))).toBeDefined();

    const recovered = await continueNativeTransition(paths, 'recover-transition');
    expect(recovered).toMatchObject({ phase: 'build', revision: 2 });
    expect(await readNativeChange(paths, 'recover-transition')).toMatchObject({
      phase: 'build',
      revision: 2,
    });
    const run = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
    expect(run?.currentStep).toBe('build');
    const events = await readTrajectory(changeDir, run!.trajectoryRef);
    expect(events.filter((event) => event.type === 'state_transitioned')).toHaveLength(1);
    expect(await readCheckpoint(changeDir, run!.checkpointRef)).toMatchObject({
      runId: 'recoverable-run',
      stateVersion: 1,
    });
    await expect(
      fs.access(nativeTransitionJournalFile(paths, 'recover-transition')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['v1', 'v2', 'v3'] as const)(
    'fails closed on a %s transition journal whose next Run is still waiting',
    async (generation) => {
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'prepare corrupt Run journal' },
          runId: () => `corrupt-${generation}-run`,
          transitionId: () => `corrupt-${generation}-transition`,
          hooks: {
            afterPrepared: () => {
              throw new Error('seed corrupt transition');
            },
          },
        }),
      ).rejects.toThrow('seed corrupt transition');
      const currentJournal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      const stateAtCrash = await readNativeChange(paths, 'recover-transition');
      const changeFile = path.join(changeDir, 'comet-state.yaml');
      const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
      const journal = transitionForGeneration(currentJournal, generation);
      Object.assign(journal.nextRun as Record<string, unknown>, {
        status: 'waiting',
        pending: 'corrupt-action',
      });
      if (generation === 'v1') {
        await fs.writeFile(changeFile, stringify(legacyState(stateAtCrash)));
      } else if (generation === 'v2') {
        await fs.writeFile(changeFile, stringify(v2State(stateAtCrash)));
      }
      await fs.writeFile(transitionFile, JSON.stringify(journal, null, 2) + '\n');
      const [changeBefore, transitionBefore] = await Promise.all([
        fs.readFile(changeFile, 'utf8'),
        fs.readFile(transitionFile, 'utf8'),
      ]);

      await expect(
        inspectPendingNativeTransitionSchema(paths, 'recover-transition'),
      ).rejects.toThrow(/status must be running/iu);
      if (generation === 'v3') {
        await expect(continueNativeTransition(paths, 'recover-transition')).rejects.toThrow(
          /status must be running/iu,
        );
      } else {
        await expect(migrateNativeChange({ paths, name: 'recover-transition' })).rejects.toThrow(
          /status must be running/iu,
        );
      }
      expect(await fs.readFile(changeFile, 'utf8')).toBe(changeBefore);
      expect(await fs.readFile(transitionFile, 'utf8')).toBe(transitionBefore);
      expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toBeNull();
      await expect(
        fs.access(path.join(changeDir, 'runtime', 'schema-migration.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['v1', 'v2', 'v3'] as const)(
    'rejects %s non-first-hop Run identity, ref, retry, and iteration tampering',
    async (generation) => {
      await advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape ready for invariant matrix' },
        runId: () => `matrix-${generation}-run`,
      });
      await fs.writeFile(
        path.join(projectRoot, 'matrix-feature.ts'),
        'export const ready = true;\n',
      );
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'build ready', artifacts: ['matrix-feature.ts'] },
          hooks: {
            afterPrepared: () => {
              throw new Error('seed non-first transition');
            },
          },
        }),
      ).rejects.toThrow('seed non-first transition');
      const current = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      expect(current.previousRun).not.toBeNull();

      const mutations: Array<{
        label: string;
        apply: (journal: Record<string, unknown>) => void;
      }> = [
        {
          label: 'waiting next Run',
          apply: (journal) =>
            Object.assign(journal.nextRun as Record<string, unknown>, {
              status: 'waiting',
              pending: 'corrupt-action',
            }),
        },
        {
          label: 'pending next Run action',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).pending = 'corrupt-action';
          },
        },
        {
          label: 'iteration reuse',
          apply: (journal) => {
            const previous = journal.previousRun as Record<string, unknown>;
            (journal.nextRun as Record<string, unknown>).iteration = previous.iteration;
          },
        },
        {
          label: 'run identity',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).runId = 'different-run';
          },
        },
        {
          label: 'runtime metadata',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).skillHash = 'f'.repeat(64);
          },
        },
        {
          label: 'context ref',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).contextRef = 'runtime/other-context.md';
          },
        },
        {
          label: 'trajectory ref',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).trajectoryRef =
              'runtime/other-trajectory.jsonl';
          },
        },
        {
          label: 'retry counters',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).retries = { corrupt: 1 };
          },
        },
        {
          label: 'previous phase',
          apply: (journal) => {
            (journal.previousRun as Record<string, unknown>).currentStep = 'verify';
          },
        },
        {
          label: 'waiting previous Run',
          apply: (journal) =>
            Object.assign(journal.previousRun as Record<string, unknown>, {
              status: 'waiting',
              pending: 'corrupt-action',
            }),
        },
      ];

      for (const mutation of mutations) {
        const journal = transitionForGeneration(current, generation);
        mutation.apply(journal);
        expect(
          () => inspectNativeTransitionJournalValue(journal, 'recover-transition'),
          mutation.label,
        ).toThrow(/Native transition journal/iu);
      }
    },
  );

  it.each(['v1', 'v2', 'v3'] as const)(
    'rejects %s first-hop Run metadata, iteration, retry, and previous-run tampering',
    async (generation) => {
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'shape ready for first-hop matrix' },
          runId: () => `first-hop-${generation}-run`,
          hooks: {
            afterPrepared: () => {
              throw new Error('seed first-hop transition');
            },
          },
        }),
      ).rejects.toThrow('seed first-hop transition');
      const current = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      expect(current.previousRun).toBeNull();

      const mutations: Array<{
        label: string;
        apply: (journal: Record<string, unknown>) => void;
      }> = [
        {
          label: 'first pending action',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).pending = 'corrupt-action';
          },
        },
        {
          label: 'first iteration skip',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).iteration = 2;
          },
        },
        {
          label: 'first retries',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).retries = { corrupt: 1 };
          },
        },
        {
          label: 'first runtime metadata',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).skill = 'other-runtime';
          },
        },
        {
          label: 'first storage ref',
          apply: (journal) => {
            (journal.nextRun as Record<string, unknown>).checkpointRef =
              'runtime/checkpoints/other.json';
          },
        },
        {
          label: 'first previous state run id',
          apply: (journal) => {
            (journal.previousState as Record<string, unknown>).run_id = (
              journal.nextRun as Record<string, unknown>
            ).runId;
          },
        },
        {
          label: 'unexpected previous Run',
          apply: (journal) => {
            journal.previousRun = {
              ...(journal.nextRun as Record<string, unknown>),
              currentStep: 'shape',
              iteration: 0,
            };
          },
        },
      ];

      for (const mutation of mutations) {
        const journal = transitionForGeneration(current, generation);
        mutation.apply(journal);
        expect(
          () => inspectNativeTransitionJournalValue(journal, 'recover-transition'),
          mutation.label,
        ).toThrow(/Native transition journal/iu);
      }
    },
  );

  it.each(['v1', 'v2', 'v3'] as const)(
    'rejects %s non-adjacent phases and non-canonical event evidence',
    async (generation) => {
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'shape ready for semantic matrix' },
          runId: () => `semantics-${generation}-run`,
          hooks: {
            afterPrepared: () => {
              throw new Error('seed semantic transition');
            },
          },
        }),
      ).rejects.toThrow('seed semantic transition');
      const current = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      const mutations: Array<{
        label: string;
        apply: (journal: Record<string, unknown>) => void;
      }> = [
        {
          label: 'Shape skips Build',
          apply: (journal) => {
            (journal.nextState as Record<string, unknown>).phase = 'verify';
            (journal.nextRun as Record<string, unknown>).currentStep = 'verify';
            (journal.eventData as Record<string, unknown>).nextPhase = 'verify';
          },
        },
        {
          label: 'event has an unknown key',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).extra = true;
          },
        },
        {
          label: 'event omits a canonical key',
          apply: (journal) => {
            delete (journal.eventData as Record<string, unknown>).summary;
          },
        },
        {
          label: 'event contains unredacted credentials',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).summary =
              'Transition used api_key=raw-transition-secret';
          },
        },
        {
          label: 'event exceeds its text budget',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).summary = 'x'.repeat(4_097);
          },
        },
        {
          label: 'event evidence hash diverges',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).evidenceHash = 'f'.repeat(64);
          },
        },
        {
          label: 'event phase diverges',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).previousPhase = 'build';
          },
        },
        {
          label: 'Shape claims verification evidence',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).verificationResult = 'pass';
          },
        },
        {
          label: 'Shape claims build artifacts',
          apply: (journal) => {
            (journal.eventData as Record<string, unknown>).artifacts = ['unexpected.ts'];
          },
        },
      ];

      for (const mutation of mutations) {
        const journal = transitionForGeneration(current, generation);
        mutation.apply(journal);
        expect(
          () => inspectNativeTransitionJournalValue(journal, 'recover-transition'),
          mutation.label,
        ).toThrow(/Native transition journal/iu);
      }
    },
  );

  it('requires a typed v3 operation and does not let spec-rebase bypass advance semantics', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape ready for typed operation checks' },
        hooks: {
          afterPrepared: () => {
            throw new Error('seed typed operation transition');
          },
        },
      }),
    ).rejects.toThrow('seed typed operation transition');
    const current = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    const missing = structuredClone(current) as unknown as Record<string, unknown>;
    delete missing.operation;
    expect(() => inspectNativeTransitionJournalValue(missing, 'recover-transition')).toThrow(
      /operation is invalid/iu,
    );
    const spoofed = structuredClone(current);
    spoofed.operation = 'spec-rebase';
    expect(() => inspectNativeTransitionJournalValue(spoofed, 'recover-transition')).toThrow(
      /spec rebase semantics are invalid/iu,
    );
  });

  it.each(['v1', 'v2'] as const)(
    'deterministically migrates an old %s spec-rebase journal into the typed operation',
    async (generation) => {
      await advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape ready before old rebase' },
        runId: () => `old-${generation}-rebase-run`,
      });
      await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const ready = true;\n');
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'seed source journal', artifacts: ['feature.ts'] },
          hooks: {
            afterPrepared: () => {
              throw new Error('seed old spec rebase');
            },
          },
        }),
      ).rejects.toThrow('seed old spec rebase');
      const current = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      const summary = 'Refresh the old spec base';
      const legacyHash = sha256Text(`spec-rebase:${current.change}:${summary}`);
      const rebase = structuredClone(current);
      rebase.operation = 'spec-rebase';
      rebase.evidenceHash = legacyHash;
      rebase.nextState.phase = 'build';
      rebase.nextState.verification_result = 'pending';
      rebase.nextState.verification_report = null;
      rebase.nextState.implementation_scope = null;
      rebase.nextState.verification_evidence = null;
      rebase.nextState.partial_allowance = null;
      rebase.nextRun.currentStep = 'build';
      rebase.eventData = {
        previousPhase: 'build',
        nextPhase: 'build',
        evidenceHash: legacyHash,
        summary,
        artifacts: [],
        noCodeReason: null,
        verificationResult: null,
      };
      const old = transitionForGeneration(rebase, generation);
      old.eventData = {
        previousPhase: 'build',
        nextPhase: 'build',
        evidenceHash: legacyHash,
        summary,
        reason: 'spec-rebase',
      };
      const state = await readNativeChange(paths, 'recover-transition');
      await fs.writeFile(
        path.join(changeDir, 'comet-state.yaml'),
        stringify(generation === 'v1' ? legacyState(state) : v2State(state)),
      );
      await fs.writeFile(
        nativeTransitionJournalFile(paths, 'recover-transition'),
        JSON.stringify(old, null, 2) + '\n',
      );

      await migrateNativeChange({ paths, name: 'recover-transition' });
      const migrated = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      expect(migrated).toMatchObject({
        operation: 'spec-rebase',
        previousState: { phase: 'build' },
        nextState: {
          phase: 'build',
          verification_result: 'pending',
          verification_report: null,
          implementation_scope: null,
          verification_evidence: null,
          partial_allowance: null,
        },
      });
      expect(migrated.evidenceHash).not.toBe(legacyHash);
      await continueNativeTransition(paths, 'recover-transition');
      const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
      const event = (await readTrajectory(changeDir, run.trajectoryRef)).at(-1)!;
      expect(event).toMatchObject({
        type: 'state_transitioned',
        data: {
          previousPhase: 'build',
          nextPhase: 'build',
          summary,
          artifacts: [],
          noCodeReason: null,
          verificationResult: null,
          transitionId: current.id,
        },
      });
      expect(Object.keys(event.data).sort()).toEqual(
        [
          'artifacts',
          'evidenceHash',
          'nextPhase',
          'noCodeReason',
          'previousPhase',
          'summary',
          'transitionId',
          'verificationResult',
        ].sort(),
      );
    },
  );

  it('preserves a pending journal when the same-revision change content diverges', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'seed change CAS recovery' },
        hooks: {
          afterPrepared: () => {
            throw new Error('seed pending change CAS');
          },
        },
      }),
    ).rejects.toThrow('seed pending change CAS');
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    const changeFile = path.join(changeDir, 'comet-state.yaml');
    const current = await readNativeChange(paths, 'recover-transition');
    await fs.writeFile(changeFile, stringify({ ...current, approval: 'confirmed' }));
    const [changeBefore, journalBefore] = await Promise.all([
      fs.readFile(changeFile, 'utf8'),
      fs.readFile(transitionFile, 'utf8'),
    ]);

    await expect(continueNativeTransition(paths, 'recover-transition')).rejects.toThrow(
      /change content changed/iu,
    );
    expect(await fs.readFile(changeFile, 'utf8')).toBe(changeBefore);
    expect(await fs.readFile(transitionFile, 'utf8')).toBe(journalBefore);
    expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toBeNull();
  });

  it('preserves a pending journal when a different valid Run is present', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'seed Run CAS recovery' },
        hooks: {
          afterPrepared: () => {
            throw new Error('seed pending Run CAS');
          },
        },
      }),
    ).rejects.toThrow('seed pending Run CAS');
    const journal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    await writeRunStateAt(
      changeDir,
      { ...journal.nextRun, runId: 'other-valid-run' },
      NATIVE_RUN_STORAGE,
    );
    const [changeBefore, journalBefore] = await Promise.all([
      fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8'),
      fs.readFile(transitionFile, 'utf8'),
    ]);

    await expect(continueNativeTransition(paths, 'recover-transition')).rejects.toThrow(
      /Run content changed/iu,
    );
    expect(await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8')).toBe(changeBefore);
    expect(await fs.readFile(transitionFile, 'utf8')).toBe(journalBefore);
    expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toMatchObject({
      runId: 'other-valid-run',
    });
  });

  it('rejects an existing transition event whose full content does not match the journal', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'seed trajectory collision' },
        transitionId: () => '55555555-6666-4777-8888-999999999999',
        hooks: {
          afterPrepared: () => {
            throw new Error('seed pending trajectory collision');
          },
        },
      }),
    ).rejects.toThrow('seed pending trajectory collision');
    const journal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    await appendNativeTrajectoryEvent({
      changeDir,
      run: journal.nextRun,
      type: 'run_started',
      data: {
        runtime: 'comet-native',
        phase: journal.previousState.phase,
        transitionId: journal.id,
      },
      now: new Date(journal.createdAt),
    });
    await appendNativeTrajectoryEvent({
      changeDir,
      run: journal.nextRun,
      type: 'state_transitioned',
      data: { ...journal.eventData, summary: 'tampered summary', transitionId: journal.id },
      now: new Date(journal.createdAt),
    });
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    const journalBefore = await fs.readFile(transitionFile, 'utf8');

    await expect(continueNativeTransition(paths, 'recover-transition')).rejects.toThrow(
      /trajectory event changed/iu,
    );
    expect(await fs.readFile(transitionFile, 'utf8')).toBe(journalBefore);
    expect(await readRunStateAt(changeDir, NATIVE_RUN_STORAGE)).toBeNull();
    expect((await readNativeChange(paths, 'recover-transition')).phase).toBe('shape');
  });

  it.each<{
    label: string;
    hooks: NativeTransitionHooks;
    prewriteEvents?: boolean;
  }>([
    {
      label: 'prepared journal',
      hooks: {
        afterPrepared: () => {
          throw new Error('legacy interruption after prepared');
        },
      },
    },
    {
      label: 'Run state write',
      hooks: {
        afterRunStateWritten: () => {
          throw new Error('legacy interruption after Run state');
        },
      },
    },
    {
      label: 'change state write',
      hooks: {
        afterChangeStateWritten: () => {
          throw new Error('legacy interruption after change state');
        },
      },
    },
    {
      label: 'trajectory event write',
      hooks: {
        afterChangeStateWritten: () => {
          throw new Error('legacy interruption before seeded trajectory events');
        },
      },
      prewriteEvents: true,
    },
  ])(
    'doctor migrates and exactly-once continues a v1 transition interrupted at $label',
    async ({ hooks, prewriteEvents }) => {
      const capabilityDir = path.join(changeDir, 'specs', 'character-counting');
      await fs.mkdir(capabilityDir, { recursive: true });
      await fs.writeFile(
        path.join(capabilityDir, 'spec.md'),
        '# Character counting\nCount every input character.\n',
      );
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'Shape was complete before the process stopped' },
          runId: () => 'native-recovery-eval-run',
          transitionId: () => '11111111-2222-4333-8444-555555555555',
          now: new Date('2026-07-15T00:00:00.000Z'),
          hooks,
        }),
      ).rejects.toThrow('legacy interruption');

      const currentJournal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      expect(currentJournal).toMatchObject({
        schema: NATIVE_TRANSITION_SCHEMA,
        minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
        revision: 1,
      });
      const preservedEvents: string[] = [];
      if (prewriteEvents) {
        const started = await appendNativeTrajectoryEvent({
          changeDir,
          run: currentJournal.nextRun,
          type: 'run_started',
          data: {
            runtime: 'comet-native',
            phase: currentJournal.previousState.phase,
            transitionId: currentJournal.id,
          },
          now: new Date(currentJournal.createdAt),
        });
        const transitioned = await appendNativeTrajectoryEvent({
          changeDir,
          run: currentJournal.nextRun,
          type: 'state_transitioned',
          data: { ...currentJournal.eventData, transitionId: currentJournal.id },
          now: new Date(currentJournal.createdAt),
        });
        preservedEvents.push(JSON.stringify(started), JSON.stringify(transitioned));
      }

      const stateAtCrash = await readNativeChange(paths, 'recover-transition');
      const changeFile = path.join(changeDir, 'comet-state.yaml');
      const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
      const legacyJournal = legacyTransition(currentJournal);
      const legacyNextRun = legacyJournal.nextRun as Record<string, unknown>;
      legacyNextRun.skillVersion = '1';
      legacyNextRun.skillHash = sha256Text('comet-native-runtime:v1');
      await fs.writeFile(changeFile, stringify(legacyState(stateAtCrash)));
      await fs.writeFile(transitionFile, JSON.stringify(legacyJournal, null, 2) + '\n');
      await fs.rm(nativeBaselineManifestFile(paths, 'recover-transition'), { force: true });
      const [changeBefore, transitionBefore] = await Promise.all([
        fs.readFile(changeFile, 'utf8'),
        fs.readFile(transitionFile, 'utf8'),
      ]);

      expect(await inspectNativeStatus(paths, 'recover-transition')).toMatchObject({
        schema: NATIVE_LEGACY_CHANGE_SCHEMA,
        migrationRequired: true,
        nextCommand: null,
      });
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: { summary: 'must fail closed before doctor migration' },
        }),
      ).rejects.toThrow('requires doctor migration');
      const inspected = await doctorNativeProject({ paths, name: 'recover-transition' });
      expect(inspected.findings).toContainEqual(
        expect.objectContaining({ code: 'schema-migration-required', repair: 'migrate' }),
      );
      expect(inspected.findings).not.toContainEqual(
        expect.objectContaining({ code: 'transition-invalid' }),
      );
      expect(await fs.readFile(changeFile, 'utf8')).toBe(changeBefore);
      expect(await fs.readFile(transitionFile, 'utf8')).toBe(transitionBefore);

      const repaired = await doctorNativeProject({
        paths,
        name: 'recover-transition',
        repair: true,
        recoveryStrategy: 'continue',
      });
      expect(repaired.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'schema-migrated', severity: 'info' }),
          expect.objectContaining({ code: 'transition-recovered', severity: 'info' }),
        ]),
      );
      expect(await readNativeChange(paths, 'recover-transition')).toMatchObject({
        schema: NATIVE_CHANGE_SCHEMA,
        minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
        revision: 2,
        phase: 'build',
        run_id: 'native-recovery-eval-run',
      });
      expect(await readNativeBaselineManifest(paths, 'recover-transition')).toMatchObject({
        origin: 'legacy-migration',
      });
      await expect(fs.access(transitionFile)).rejects.toMatchObject({ code: 'ENOENT' });

      const events = await readTrajectory(changeDir, currentJournal.nextRun.trajectoryRef);
      expect(
        events.filter(
          (event) => event.type === 'run_started' && event.data.transitionId === currentJournal.id,
        ),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.type === 'state_transitioned' && event.data.transitionId === currentJournal.id,
        ),
      ).toHaveLength(1);
      expect(
        events.filter((event) => preservedEvents.includes(JSON.stringify(event))),
      ).toHaveLength(preservedEvents.length);

      await doctorNativeProject({
        paths,
        name: 'recover-transition',
        repair: true,
        recoveryStrategy: 'continue',
      });
      expect((await readNativeChange(paths, 'recover-transition')).revision).toBe(2);
      const replayedEvents = await readTrajectory(changeDir, currentJournal.nextRun.trajectoryRef);
      expect(replayedEvents).toEqual(events);
    },
  );

  it('migrates and continues a directly persisted v2 transition exactly once', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape was ready under v2' },
        runId: () => 'v2-transition-run',
        transitionId: () => '22222222-3333-4444-8555-666666666666',
        now: new Date('2026-07-17T04:00:00.000Z'),
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt v2 transition');
          },
        },
      }),
    ).rejects.toThrow('interrupt v2 transition');
    const currentJournal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    const changeFile = path.join(changeDir, 'comet-state.yaml');
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    await fs.writeFile(
      changeFile,
      stringify(v2State(await readNativeChange(paths, 'recover-transition'))),
    );
    await fs.writeFile(
      transitionFile,
      JSON.stringify(v2Transition(currentJournal), null, 2) + '\n',
    );

    expect(await inspectNativeStatus(paths, 'recover-transition')).toMatchObject({
      schema: NATIVE_V2_CHANGE_SCHEMA,
      migrationRequired: true,
      nextCommand: null,
    });
    const repaired = await doctorNativeProject({
      paths,
      name: 'recover-transition',
      repair: true,
      recoveryStrategy: 'continue',
    });
    expect(repaired.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'schema-migrated', severity: 'info' }),
        expect.objectContaining({ code: 'transition-recovered', severity: 'info' }),
      ]),
    );
    expect(await readNativeChange(paths, 'recover-transition')).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      phase: 'build',
      revision: 2,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
    });
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    expect(run).toMatchObject({ runId: 'v2-transition-run', currentStep: 'build' });
    const events = await readTrajectory(changeDir, run.trajectoryRef);
    expect(
      events.filter(
        (event) =>
          event.type === 'state_transitioned' && event.data.transitionId === currentJournal.id,
      ),
    ).toHaveLength(1);
    await expect(fs.access(transitionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a v1 transition migration interrupted after writing the v2 journal', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape ready before migration interruption' },
        runId: () => 'transition-migration-run',
        transitionId: () => '44444444-5555-4666-8777-888888888888',
        hooks: {
          afterPrepared: () => {
            throw new Error('seed pending transition');
          },
        },
      }),
    ).rejects.toThrow('seed pending transition');
    const currentJournal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    const changeFile = path.join(changeDir, 'comet-state.yaml');
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    await fs.writeFile(
      changeFile,
      stringify(legacyState(await readNativeChange(paths, 'recover-transition'))),
    );
    await fs.writeFile(
      transitionFile,
      JSON.stringify(legacyTransition(currentJournal), null, 2) + '\n',
    );

    await expect(
      migrateNativeChange({
        paths,
        name: 'recover-transition',
        id: () => 'interrupted-transition-migration',
        hooks: {
          afterTransitionWritten: () => {
            throw new Error('interrupt after v2 transition write');
          },
        },
      }),
    ).rejects.toThrow('interrupt after v2 transition write');
    expect(await inspectPendingNativeSchemaMigration(paths, 'recover-transition')).toMatchObject({
      fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA,
      toSchema: NATIVE_V2_CHANGE_SCHEMA,
      transition: {
        nextJournal: { schema: NATIVE_V2_TRANSITION_SCHEMA },
      },
    });

    await migrateNativeChange({ paths, name: 'recover-transition' });
    await continueNativeTransition(paths, 'recover-transition');
    expect(await readNativeChange(paths, 'recover-transition')).toMatchObject({
      schema: NATIVE_CHANGE_SCHEMA,
      phase: 'build',
      revision: 2,
    });
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    expect(
      (await readTrajectory(changeDir, run.trajectoryRef)).filter(
        (event) =>
          event.type === 'state_transitioned' && event.data.transitionId === currentJournal.id,
      ),
    ).toHaveLength(1);
  });

  it('supersedes a durable v2 Archive transition through the schema-migration journal', async () => {
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'shape ready' },
      runId: () => 'v2-archive-transition-run',
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const ready = true;\n');
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'build ready', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'recover-transition',
        evidenceRefs: ['feature.ts'],
      }),
    );
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: {
          summary: 'verification passed under v2',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
        transitionId: () => '33333333-4444-4555-8666-777777777777',
        now: new Date('2026-07-17T05:00:00.000Z'),
        hooks: {
          afterChangeStateWritten: () => {
            throw new Error('interrupt after archive state');
          },
        },
      }),
    ).rejects.toThrow('interrupt after archive state');
    const currentJournal = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
    await appendNativeTrajectoryEvent({
      changeDir,
      run: currentJournal.nextRun,
      type: 'state_transitioned',
      data: { ...currentJournal.eventData, transitionId: currentJournal.id },
      now: new Date(currentJournal.createdAt),
    });

    const changeFile = path.join(changeDir, 'comet-state.yaml');
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    await fs.writeFile(
      changeFile,
      stringify(v2State(await readNativeChange(paths, 'recover-transition'))),
    );
    await fs.writeFile(
      transitionFile,
      JSON.stringify(v2Transition(currentJournal), null, 2) + '\n',
    );

    await doctorNativeProject({
      paths,
      name: 'recover-transition',
      repair: true,
      recoveryStrategy: 'continue',
    });
    const state = await readNativeChange(paths, 'recover-transition');
    expect(state).toMatchObject({
      phase: 'build',
      revision: currentJournal.nextState.revision + 1,
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
    });
    const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
    expect(run).toMatchObject({
      currentStep: 'build',
      iteration: currentJournal.nextRun.iteration + 1,
      pending: null,
      status: 'running',
    });
    const events = await readTrajectory(changeDir, run.trajectoryRef);
    expect(
      events.filter(
        (event) =>
          event.type === 'state_transitioned' && event.data.transitionId === currentJournal.id,
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'state_migrated' &&
          event.data.supersededTransitionId === currentJournal.id &&
          event.data.previousPhase === 'archive' &&
          event.data.nextPhase === 'build',
      ),
    ).toHaveLength(1);
    await expect(fs.access(transitionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readCheckpoint(changeDir, run.checkpointRef)).toMatchObject({
      runId: run.runId,
      stateVersion: run.iteration,
      trajectoryOffset: events.length,
    });
    const status = await inspectNativeStatus(paths, 'recover-transition', { details: true });
    expect((status.findings ?? []).map((finding) => finding.code)).not.toEqual(
      expect.arrayContaining(['run-phase-mismatch', 'checkpoint-mismatch', 'trajectory-invalid']),
    );
  });

  it.each<{
    label: string;
    slug: string;
    hook: keyof NativeSchemaMigrationHooks;
  }>([
    { label: 'prepared plan', slug: 'prepared', hook: 'afterPrepared' },
    { label: 'state write', slug: 'state', hook: 'afterStateWritten' },
    { label: 'Run write', slug: 'run', hook: 'afterRunStateWritten' },
    { label: 'migration event', slug: 'event', hook: 'afterTrajectoryWritten' },
    { label: 'checkpoint', slug: 'checkpoint', hook: 'afterCheckpointWritten' },
    {
      label: 'source transition removal',
      slug: 'transition',
      hook: 'afterTransitionSuperseded',
    },
  ])(
    'recovers a pending v2 Archive supersede interrupted after $label exactly once',
    async ({ slug, hook }) => {
      await advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape ready for supersede recovery' },
        runId: () => `supersede-${slug}-run`,
      });
      await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const ready = true;\n');
      await advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'build ready for supersede recovery', artifacts: ['feature.ts'] },
      });
      await fs.writeFile(
        path.join(changeDir, 'verification.md'),
        await nativeVerificationFixtureReport({
          paths,
          name: 'recover-transition',
          evidenceRefs: ['feature.ts'],
        }),
      );
      await expect(
        advanceNativeChange({
          paths,
          name: 'recover-transition',
          evidence: {
            summary: 'verification passed before supersede recovery',
            verificationResult: 'pass',
            verificationReport: 'verification.md',
          },
          transitionId: () => `superseded-${slug}-transition`,
          now: new Date('2026-07-17T06:00:00.000Z'),
          hooks: {
            afterChangeStateWritten: () => {
              throw new Error('seed durable Archive transition');
            },
          },
        }),
      ).rejects.toThrow('seed durable Archive transition');
      const pending = (await inspectPendingNativeTransition(paths, 'recover-transition'))!;
      await appendNativeTrajectoryEvent({
        changeDir,
        run: pending.nextRun,
        type: 'state_transitioned',
        data: { ...pending.eventData, transitionId: pending.id },
        now: new Date(pending.createdAt),
      });
      const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
      await fs.writeFile(
        path.join(changeDir, 'comet-state.yaml'),
        stringify(v2State(await readNativeChange(paths, 'recover-transition'))),
      );
      await fs.writeFile(transitionFile, JSON.stringify(v2Transition(pending), null, 2) + '\n');
      const hooks = {
        [hook]: () => {
          throw new Error(`interrupt supersede after ${slug}`);
        },
      } as NativeSchemaMigrationHooks;

      await expect(
        migrateNativeChange({
          paths,
          name: 'recover-transition',
          id: () => `supersede-migration-${slug}`,
          now: new Date('2026-07-17T06:01:00.000Z'),
          hooks,
        }),
      ).rejects.toThrow(`interrupt supersede after ${slug}`);
      expect(await inspectPendingNativeSchemaMigration(paths, 'recover-transition')).toMatchObject({
        transitionSupersede: {
          transitionId: pending.id,
          eventData: { reason: 'implementation-scope-required' },
        },
      });

      const recovered = await migrateNativeChange({ paths, name: 'recover-transition' });
      expect(recovered).toMatchObject({
        phase: 'build',
        verification_result: 'pending',
        verification_report: null,
      });
      const run = (await readRunStateAt(changeDir, NATIVE_RUN_STORAGE))!;
      const events = await readTrajectory(changeDir, run.trajectoryRef);
      expect(
        events.filter(
          (event) => event.type === 'state_transitioned' && event.data.transitionId === pending.id,
        ),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) =>
            event.type === 'state_migrated' &&
            event.data.migrationId === `supersede-migration-${slug}` &&
            event.data.supersededTransitionId === pending.id,
        ),
      ).toHaveLength(1);
      await expect(fs.access(transitionFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(nativeSchemaMigrationJournalFile(paths, 'recover-transition')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readCheckpoint(changeDir, run.checkpointRef)).toMatchObject({
        runId: run.runId,
        stateVersion: run.iteration,
      });
    },
  );

  it('serializes concurrent transitions for the same change', async () => {
    let markPrepared!: () => void;
    let releaseFirst!: () => void;
    const prepared = new Promise<void>((resolve) => {
      markPrepared = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'first shape transition' },
      hooks: {
        afterPrepared: async () => {
          markPrepared();
          await blocked;
        },
      },
    });
    await prepared;

    const second = advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'concurrent shape transition' },
    });
    const secondResult = await second.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    releaseFirst();
    const firstResult = await first.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    expect(firstResult).toMatchObject({
      status: 'fulfilled',
      value: { change: { phase: 'build' } },
    });
    expect(secondResult).toMatchObject({ status: 'rejected' });
    expect((secondResult as { error: Error }).error.message).toContain('lock is already held');
  });

  it('writes the prepared journal before the first trajectory event', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape is ready' },
        hooks: {
          afterPrepared: () => {
            throw new Error('inspect journal-first ordering');
          },
        },
      }),
    ).rejects.toThrow('inspect journal-first ordering');

    const journal = await inspectPendingNativeTransition(paths, 'recover-transition');
    expect(journal).not.toBeNull();
    expect(await readTrajectory(changeDir, journal!.nextRun.trajectoryRef)).toEqual([]);
    await continueNativeTransition(paths, 'recover-transition');
    const events = await readTrajectory(changeDir, journal!.nextRun.trajectoryRef);
    expect(events.map((event) => event.type)).toEqual(['run_started', 'state_transitioned']);
  });

  it('doctor atomically removes only an incomplete final trajectory line before continuing', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape is ready' },
        runId: () => 'tail-recovery-run',
        transitionId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        hooks: {
          afterChangeStateWritten: () => {
            throw new Error('crash before trajectory append completed');
          },
        },
      }),
    ).rejects.toThrow('crash before trajectory append completed');
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    const runFile = path.join(changeDir, NATIVE_RUN_STORAGE.stateRef);
    const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
    const trajectoryFile = path.join(changeDir, NATIVE_RUN_STORAGE.trajectoryRef);
    await fs.appendFile(trajectoryFile, '{"sequence":1');
    const before = await Promise.all([
      fs.readFile(stateFile, 'utf8'),
      fs.readFile(runFile, 'utf8'),
      fs.readFile(transitionFile, 'utf8'),
      fs.readFile(trajectoryFile, 'utf8'),
    ]);

    expect(await inspectNativeStatus(paths, 'recover-transition')).toMatchObject({
      nextCommand: null,
    });
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'must not write through a broken trajectory tail' },
      }),
    ).rejects.toThrow('incomplete final line');
    expect(
      await Promise.all([
        fs.readFile(stateFile, 'utf8'),
        fs.readFile(runFile, 'utf8'),
        fs.readFile(transitionFile, 'utf8'),
        fs.readFile(trajectoryFile, 'utf8'),
      ]),
    ).toEqual(before);

    const inspected = await doctorNativeProject({ paths, name: 'recover-transition' });
    expect(inspected.findings).toContainEqual(
      expect.objectContaining({
        code: 'trajectory-tail-incomplete',
        repair: 'truncate-tail',
      }),
    );
    expect(await fs.readFile(trajectoryFile, 'utf8')).toBe('{"sequence":1');

    const repaired = await doctorNativeProject({
      paths,
      name: 'recover-transition',
      repair: true,
      recoveryStrategy: 'continue',
    });
    expect(repaired.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'trajectory-tail-repaired', severity: 'info' }),
        expect.objectContaining({ code: 'transition-recovered', severity: 'info' }),
      ]),
    );
    const events = await readTrajectory(changeDir, NATIVE_RUN_STORAGE.trajectoryRef);
    expect(events.map((event) => event.type)).toEqual(['run_started', 'state_transitioned']);
    expect((await readNativeChange(paths, 'recover-transition')).revision).toBe(2);
  });

  it('never truncates a malformed middle trajectory line', async () => {
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'shape is ready' },
      runId: () => 'middle-corruption-run',
    });
    const trajectoryFile = path.join(changeDir, NATIVE_RUN_STORAGE.trajectoryRef);
    await fs.appendFile(trajectoryFile, '{not-json}\n{"sequence":');
    const before = await fs.readFile(trajectoryFile, 'utf8');

    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'must fail before mutation' },
      }),
    ).rejects.toThrow('Native trajectory is invalid');
    const repaired = await doctorNativeProject({
      paths,
      name: 'recover-transition',
      repair: true,
    });
    expect(repaired.findings).toContainEqual(
      expect.objectContaining({ code: 'trajectory-invalid', severity: 'error' }),
    );
    expect(repaired.findings).not.toContainEqual(
      expect.objectContaining({ code: 'trajectory-tail-repaired' }),
    );
    expect(await fs.readFile(trajectoryFile, 'utf8')).toBe(before);
    expect(await inspectNativeStatus(paths, 'recover-transition')).toMatchObject({
      nextCommand: null,
    });
  });

  it('refuses to overwrite trajectory events appended after tail inspection', async () => {
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'shape is ready' },
      runId: () => 'trajectory-cas-run',
    });
    const trajectoryFile = path.join(changeDir, NATIVE_RUN_STORAGE.trajectoryRef);
    const withoutNewline = (await fs.readFile(trajectoryFile, 'utf8')).trimEnd();
    await fs.writeFile(trajectoryFile, withoutNewline);
    const appended =
      '\n' +
      JSON.stringify({
        sequence: 3,
        timestamp: '2026-07-17T00:00:00.000Z',
        type: 'checkpoint_written',
        runId: 'trajectory-cas-run',
        data: { source: 'concurrent-writer' },
      }) +
      '\n';
    await expect(
      repairNativeTrajectoryTail(paths, 'recover-transition', {
        beforeCommit: () => fs.appendFile(trajectoryFile, appended),
      }),
    ).rejects.toThrow('changed while preparing tail repair');
    expect(await fs.readFile(trajectoryFile, 'utf8')).toBe(withoutNewline + appended);
  });

  it('requires explicit doctor takeover before continuing stale transition locks', async () => {
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: { summary: 'shape is ready' },
        hooks: {
          afterPrepared: () => {
            throw new Error('simulate a stopped transition process');
          },
        },
      }),
    ).rejects.toThrow('simulate a stopped transition process');

    const lockFile = path.join(paths.locksDir, 'transition-recover-transition.lock');
    const rootLockFile = path.join(paths.locksDir, 'root-move.lock');
    const staleOwner = {
      id: 'stale-transition-owner',
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: '2026-07-15T00:00:00.000Z',
      operation: 'advance recover-transition',
    };
    await Promise.all([
      fs.writeFile(lockFile, JSON.stringify(staleOwner)),
      fs.writeFile(rootLockFile, JSON.stringify({ ...staleOwner, id: 'stale-root-owner' })),
    ]);

    await expect(continueNativeTransition(paths, 'recover-transition')).rejects.toThrow(
      /already held/u,
    );
    await expect(fs.access(lockFile)).resolves.toBeUndefined();
    await expect(fs.access(rootLockFile)).resolves.toBeUndefined();

    const repaired = await doctorNativeProject({
      paths,
      name: 'recover-transition',
      repair: true,
      recoveryStrategy: 'continue',
    });
    expect(repaired.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'stale-recovery-lock-removed', severity: 'info' }),
        expect.objectContaining({ code: 'transition-recovered', severity: 'info' }),
      ]),
    );
    expect((await readNativeChange(paths, 'recover-transition')).phase).toBe('build');
    await Promise.all(
      [lockFile, rootLockFile].map((file) =>
        expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' }),
      ),
    );
  });

  it('requires pending Verify recovery before archive preview and commit', async () => {
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'shape is ready' },
    });
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const feature = true;\n');
    await advanceNativeChange({
      paths,
      name: 'recover-transition',
      evidence: { summary: 'build is ready', artifacts: ['feature.ts'] },
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'recover-transition',
        evidenceRefs: ['feature.ts'],
      }),
    );
    await expect(
      advanceNativeChange({
        paths,
        name: 'recover-transition',
        evidence: {
          summary: 'verification passed',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
        hooks: {
          afterRunStateWritten: () => {
            throw new Error('interrupt before archive');
          },
        },
      }),
    ).rejects.toThrow('interrupt before archive');

    const now = new Date('2026-07-15T00:00:00Z');
    await expect(
      inspectNativeArchivePreflight({ paths, name: 'recover-transition', now }),
    ).resolves.toMatchObject({
      ready: false,
      findingCodes: expect.arrayContaining(['pending-journal']),
    });

    await continueNativeTransition(paths, 'recover-transition');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'recover-transition',
      now,
    });
    const archived = await archiveNativeChange({
      paths,
      name: 'recover-transition',
      expectedPreflightHash,
      now,
    });
    expect(archived.archiveDir).toContain('2026-07-15-recover-transition');
  });
});
