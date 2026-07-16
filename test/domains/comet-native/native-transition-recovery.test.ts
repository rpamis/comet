import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCheckpoint, readTrajectory } from '../../../domains/engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt } from '../../../domains/engine/storage-run.js';
import { archiveNativeChange } from '../../../domains/comet-native/native-archive.js';
import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { doctorNativeProject } from '../../../domains/comet-native/native-doctor.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  nativeBaselineManifestFile,
  readNativeBaselineManifest,
} from '../../../domains/comet-native/native-snapshot.js';
import {
  continueNativeTransition,
  inspectPendingNativeTransition,
  nativeTransitionJournalFile,
} from '../../../domains/comet-native/native-transition-journal.js';
import { appendNativeTrajectoryEvent } from '../../../domains/comet-native/native-trajectory.js';
import { repairNativeTrajectoryTail } from '../../../domains/comet-native/native-trajectory-recovery.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeTransitionHooks,
  NativeTransitionJournal,
} from '../../../domains/comet-native/native-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_LEGACY_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_TRANSITION_SCHEMA,
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

const verification = `# Acceptance evidence
Scenario passed.
# Commands and results
Tests passed.
# Skipped checks
None.
# Spec consistency
Matches.
# Known limitations and risks
None.
# Conclusion
Pass.
`;

function legacyState(state: NativeChangeState): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...state };
  delete legacy.minimum_runtime_version;
  delete legacy.revision;
  return { ...legacy, schema: NATIVE_LEGACY_CHANGE_SCHEMA };
}

function legacyTransition(journal: NativeTransitionJournal): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...journal };
  delete legacy.minimum_runtime_version;
  delete legacy.revision;
  return {
    ...legacy,
    schema: NATIVE_LEGACY_TRANSITION_SCHEMA,
    previousState: legacyState(journal.previousState),
    nextState: legacyState(journal.nextState),
  };
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
      const changeFile = path.join(changeDir, 'change.yaml');
      const transitionFile = nativeTransitionJournalFile(paths, 'recover-transition');
      await fs.writeFile(changeFile, stringify(legacyState(stateAtCrash)));
      await fs.writeFile(
        transitionFile,
        JSON.stringify(legacyTransition(currentJournal), null, 2) + '\n',
      );
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
    const stateFile = path.join(changeDir, 'change.yaml');
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
    const originalReadFile = fs.readFile.bind(fs);
    let trajectoryReads = 0;
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (file, options) => {
      const value = await originalReadFile(file, options);
      if (path.resolve(String(file)) === path.resolve(trajectoryFile)) {
        trajectoryReads += 1;
        if (trajectoryReads === 2) {
          await fs.appendFile(trajectoryFile, appended);
          return originalReadFile(file, options);
        }
      }
      return value;
    });
    try {
      await expect(repairNativeTrajectoryTail(paths, 'recover-transition')).rejects.toThrow(
        'changed while preparing tail repair',
      );
    } finally {
      readSpy.mockRestore();
    }
    expect(await fs.readFile(trajectoryFile, 'utf8')).toBe(withoutNewline + appended);
  });

  it('clears a proven stale transition lock before automatic continuation', async () => {
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

    expect((await continueNativeTransition(paths, 'recover-transition'))?.phase).toBe('build');
    await Promise.all(
      [lockFile, rootLockFile].map((file) =>
        expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' }),
      ),
    );
  });

  it('finishes a pending Verify transition before archive starts', async () => {
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
    await fs.writeFile(path.join(changeDir, 'verification.md'), verification);
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

    const archived = await archiveNativeChange({
      paths,
      name: 'recover-transition',
      now: new Date('2026-07-15T00:00:00Z'),
    });
    expect(archived.archiveDir).toContain('2026-07-15-recover-transition');
  });
});
