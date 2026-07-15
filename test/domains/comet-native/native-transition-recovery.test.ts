import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCheckpoint, readTrajectory } from '../../../domains/engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt } from '../../../domains/engine/storage-run.js';
import { archiveNativeChange } from '../../../domains/comet-native/native-archive.js';
import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  continueNativeTransition,
  inspectPendingNativeTransition,
  nativeTransitionJournalFile,
} from '../../../domains/comet-native/native-transition-journal.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type {
  NativeProjectPaths,
  NativeTransitionHooks,
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
    expect(recovered?.phase).toBe('build');
    expect((await readNativeChange(paths, 'recover-transition')).phase).toBe('build');
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
