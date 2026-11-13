import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPreparedNativeTransition } from '../../helpers/native-change-document.js';
import {
  nativeProjectPaths,
  nativeChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  continueNativeTransition,
  inspectPendingNativeTransition,
  nativeTransitionJournalFile,
} from '../../../domains/comet-native/native-transition-journal.js';
import { readNativeChange } from '../../../domains/comet-native/native-change.js';
import {
  readNativeRunState,
  readNativeTrajectory,
  readNativeCheckpoint,
} from '../../../domains/comet-native/native-run-store.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'native-transition-business-'));
  roots.push(home);
  vi.stubEnv('COMET_DATA_DIR', path.join(home, 'data'));
  const project = path.join(home, 'project');
  await fs.mkdir(project);
  await writeProjectConfig(project, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(project, '.');
  const frozen = await loadPreparedNativeTransition(paths);
  const name = frozen.name,
    dir = nativeChangeRuntimeDir(paths, name);
  return {
    home,
    project,
    paths,
    frozen,
    name,
    dir,
    wal: nativeTransitionJournalFile(paths, name),
  };
}
it('continues original published prepared WAL exactly once without rebuilding the old creator', async () => {
  const f = await fixture();
  const j = (await inspectPendingNativeTransition(f.paths, f.name))!;
  expect(j.previousRun).toBeNull();
  expect(await readNativeRunState(f.dir)).toBeNull();
  const result = await continueNativeTransition(f.paths, f.name);
  expect(result).toEqual(j.nextState);
  expect(await readNativeRunState(f.dir)).toEqual(j.nextRun);
  const events = await readNativeTrajectory(f.dir, j.nextRun.trajectoryRef);
  expect(events.filter((e) => e.type === 'run_started')).toHaveLength(1);
  expect(events.filter((e) => e.type === 'state_transitioned')).toHaveLength(1);
  expect(await readNativeCheckpoint(f.dir, j.nextRun.checkpointRef)).toMatchObject({
    runId: j.nextRun.runId,
    stateVersion: 1,
  });
  await expect(fs.access(f.wal)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await continueNativeTransition(f.paths, f.name)).toBeNull();
  expect(await readNativeTrajectory(f.dir, j.nextRun.trajectoryRef)).toEqual(events);
});
it('preserves original WAL and change when a different valid Run exists', async () => {
  const f = await fixture();
  const j = (await inspectPendingNativeTransition(f.paths, f.name))!;
  const { writeNativeRunState } = await import('../../../domains/comet-native/native-run-store.js');
  await writeNativeRunState(f.dir, {
    ...j.nextRun,
    runId: 'different-valid-run',
  });
  const before = await fs.readFile(f.wal, 'utf8'),
    state = await readNativeChange(f.paths, f.name);
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(/Run|source/);
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
  expect(await readNativeChange(f.paths, f.name)).toEqual(state);
});

import {
  inspectNativeTransitionJournalValue,
  inspectPendingNativeTransitionSchema,
} from '../../../domains/comet-native/native-transition-journal.js';
import { writeNativeChangeFile } from '../../../domains/comet-native/native-change.js';
import { writeNativeRunState } from '../../../domains/comet-native/native-run-store.js';
import { repairNativeTrajectoryTail } from '../../../domains/comet-native/native-trajectory-recovery.js';
import { appendNativeTrajectoryEvent } from '../../../domains/comet-native/native-trajectory.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';

async function currentJournal() {
  const f = await fixture();
  const journal = (await inspectPendingNativeTransition(f.paths, f.name))!;
  return { ...f, journal };
}
async function nonFirstFixture() {
  const f = await fixture(),
    frozen = JSON.parse(
      await fs.readFile(
        path.resolve(
          'test/fixtures/native-052-transition-journal/non-first-hop-build-to-verify.json',
        ),
        'utf8',
      ),
    );
  for (const x of frozen.nativeFiles) {
    const file = path.join(f.paths.nativeRoot, x.ref);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(x.bytesBase64, 'base64'));
  }
  for (const x of frozen.runtimeFiles.filter(
    (x: any) =>
      x.ref === 'transition.json' ||
      x.ref === 'run-state.json' ||
      x.ref === 'trajectory.jsonl' ||
      x.ref.startsWith('checkpoints/'),
  )) {
    const file = path.join(f.dir, x.ref);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(x.bytesBase64, 'base64'));
  }
  for (const x of frozen.projectFiles)
    await fs.writeFile(path.join(f.project, x.ref), Buffer.from(x.bytesBase64, 'base64'));
  return {
    ...f,
    journal: (await inspectPendingNativeTransition(f.paths, f.name))!,
  };
}
function mutated(journal: any, mutate: (j: any) => void) {
  const j = structuredClone(journal);
  mutate(j);
  return j;
}
it('validates an oversized original transition document by JSON/schema rather than retired snapshot budgets', async () => {
  const f = await fixture();
  await fs.writeFile(f.wal, 'x'.repeat(600 * 1024));
  await expect(inspectPendingNativeTransitionSchema(f.paths, f.name)).rejects.toThrow(
    /Unexpected token|JSON/,
  );
  expect((await fs.stat(f.wal)).size).toBe(600 * 1024);
});
it.each(['prepared', 'Run-write', 'change-write'])(
  'continues original WAL after an interruption at %s without incrementing twice',
  async (boundary) => {
    const f = await currentJournal();
    if (boundary !== 'prepared')
      await expect(
        continueNativeTransition(
          f.paths,
          f.name,
          boundary === 'Run-write'
            ? {
                afterRunStateWritten() {
                  throw Error('exact interrupted write');
                },
              }
            : {
                afterChangeStateWritten() {
                  throw Error('exact interrupted write');
                },
              },
        ),
      ).rejects.toThrow('exact interrupted write');
    await continueNativeTransition(f.paths, f.name);
    expect(await readNativeChange(f.paths, f.name)).toEqual(f.journal.nextState);
    expect(await readNativeRunState(f.dir)).toEqual(f.journal.nextRun);
    const events = await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef);
    expect(events.filter((e) => e.type === 'state_transitioned')).toHaveLength(1);
    expect(await continueNativeTransition(f.paths, f.name)).toBeNull();
    expect(await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).toEqual(events);
  },
);
it('rejects a waiting next Run in the retained persisted-journal reader without changing bytes', async () => {
  const f = await currentJournal();
  const j = mutated(f.journal, (j) => {
    j.nextRun.status = 'waiting';
    j.nextRun.pending = 'corrupt';
  });
  await fs.writeFile(f.wal, JSON.stringify(j));
  const before = await fs.readFile(f.wal, 'utf8');
  await expect(inspectPendingNativeTransitionSchema(f.paths, f.name)).rejects.toThrow(
    /status must be running/,
  );
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(/status must be running/);
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
  expect(await readNativeRunState(f.dir)).toBeNull();
});
it('rejects original non-first-hop identity refs counters and iteration tampering through the retained parser', async () => {
  const f = await nonFirstFixture();
  expect(f.journal.previousRun).not.toBeNull();
  const mutations: [string, (j: any) => void][] = [
    [
      'waiting next',
      (j) => {
        j.nextRun.status = 'waiting';
        j.nextRun.pending = 'bad';
      },
    ],
    ['pending', (j) => (j.nextRun.pending = 'bad')],
    ['iteration reuse', (j) => (j.nextRun.iteration = j.previousRun.iteration)],
    ['identity', (j) => (j.nextRun.runId = 'different-run')],
    ['metadata', (j) => (j.nextRun.skillHash = 'f'.repeat(64))],
    ['context', (j) => (j.nextRun.contextRef = 'runtime/other-context.md')],
    ['trajectory', (j) => (j.nextRun.trajectoryRef = 'runtime/other.jsonl')],
    ['retries', (j) => (j.nextRun.retries = { corrupt: 1 })],
    ['previous phase', (j) => (j.previousRun.currentStep = 'verify')],
    [
      'waiting previous',
      (j) => {
        j.previousRun.status = 'waiting';
        j.previousRun.pending = 'bad';
      },
    ],
  ];
  for (const generation of ['v1', 'v2', 'v3'] as const)
    for (const [label, mutation] of mutations)
      expect(
        () =>
          inspectNativeTransitionJournalValue(
            mutated(
              generation === 'v3' ? f.journal : oldSchemaVariant(f.journal, generation),
              mutation,
            ),
            f.name,
          ),
        generation + ': ' + label,
      ).toThrow();
});
it('rejects first-hop Run metadata iteration retry and previous-Run tampering from the published WAL', async () => {
  const f = await currentJournal();
  const mutations: [string, (j: any) => void][] = [
    ['pending', (j) => (j.nextRun.pending = 'bad')],
    ['iteration skip', (j) => (j.nextRun.iteration = 2)],
    ['retries', (j) => (j.nextRun.retries = { corrupt: 1 })],
    ['metadata', (j) => (j.nextRun.skill = 'other-runtime')],
    ['checkpoint ref', (j) => (j.nextRun.checkpointRef = 'runtime/checkpoints/other.json')],
    ['previous run id', (j) => (j.previousState.run_id = j.nextRun.runId)],
    [
      'unexpected previous',
      (j) => (j.previousRun = { ...j.nextRun, currentStep: 'shape', iteration: 0 }),
    ],
  ];
  for (const generation of ['v1', 'v2', 'v3'] as const)
    for (const [label, mutation] of mutations)
      expect(
        () =>
          inspectNativeTransitionJournalValue(
            mutated(
              generation === 'v3' ? f.journal : oldSchemaVariant(f.journal, generation),
              mutation,
            ),
            f.name,
          ),
        generation + ': ' + label,
      ).toThrow();
});
it('rejects phase skipping unknown event fields credential leaks and forged evidence from the original WAL', async () => {
  const f = await currentJournal();
  const mutations: [string, (j: any) => void][] = [
    [
      'phase skip',
      (j) => {
        j.nextState.phase = 'verify';
        j.nextRun.currentStep = 'verify';
        j.eventData.nextPhase = 'verify';
      },
    ],
    ['unknown', (j) => (j.eventData.extra = true)],
    ['missing', (j) => delete j.eventData.summary],
    ['credentials', (j) => (j.eventData.summary = 'api_key=raw-transition-secret')],
    ['text bound', (j) => (j.eventData.summary = 'x'.repeat(4097))],
    ['evidence identity', (j) => (j.eventData.evidenceHash = 'f'.repeat(64))],
    ['event phase', (j) => (j.eventData.previousPhase = 'build')],
    ['unearned pass', (j) => (j.eventData.verificationResult = 'pass')],
    ['unearned artifact', (j) => (j.eventData.artifacts = ['unexpected.ts'])],
  ];
  for (const generation of ['v1', 'v2', 'v3'] as const)
    for (const [label, mutation] of mutations)
      expect(
        () =>
          inspectNativeTransitionJournalValue(
            mutated(
              generation === 'v3' ? f.journal : oldSchemaVariant(f.journal, generation),
              mutation,
            ),
            f.name,
          ),
        generation + ': ' + label,
      ).toThrow();
});
it('requires current typed operation and rejects relabeling advance as spec-rebase', async () => {
  const f = await currentJournal();
  expect(() =>
    inspectNativeTransitionJournalValue(
      mutated(f.journal, (j) => delete j.operation),
      f.name,
    ),
  ).toThrow();
  expect(() =>
    inspectNativeTransitionJournalValue(
      mutated(f.journal, (j) => (j.operation = 'spec-rebase')),
      f.name,
    ),
  ).toThrow();
});
it('rejects unsupported future transition schema without inventing a migration route', async () => {
  const f = await currentJournal(),
    bad = mutated(f.journal, (j) => (j.schema = 'comet.native.transition.v999'));
  await fs.writeFile(f.wal, JSON.stringify(bad));
  const before = await fs.readFile(f.wal, 'utf8');
  await expect(inspectPendingNativeTransitionSchema(f.paths, f.name)).rejects.toThrow(
    /Unsupported/,
  );
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
});
it('preserves original WAL over a same-revision external change', async () => {
  const f = await currentJournal(),
    state = await readNativeChange(f.paths, f.name);
  await writeNativeChangeFile(path.join(f.paths.changesDir, f.name, 'comet-state.yaml'), {
    ...state,
    approval: 'implicit',
  });
  const before = await fs.readFile(f.wal, 'utf8');
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow();
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
  expect((await readNativeChange(f.paths, f.name)).approval).toBe('implicit');
});
it('does not accept an existing trajectory event whose complete content diverges from the original WAL', async () => {
  const f = await currentJournal();
  await expect(
    continueNativeTransition(f.paths, f.name, {
      afterChangeStateWritten() {
        throw Error('states persisted');
      },
    }),
  ).rejects.toThrow('states persisted');
  const run = (await readNativeRunState(f.dir))!;
  await appendNativeTrajectoryEvent({
    changeDir: f.dir,
    run,
    type: 'run_started',
    data: {
      runtime: 'comet-native',
      phase: 'shape',
      transitionId: f.journal.id,
    },
  });
  await appendNativeTrajectoryEvent({
    changeDir: f.dir,
    run,
    type: 'state_transitioned',
    data: {
      ...f.journal.eventData,
      transitionId: f.journal.id,
      summary: 'different event',
    },
  });
  const before = await fs.readFile(f.wal, 'utf8');
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(
    /event changed|does not match/,
  );
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
});
it('continues one published transition serially without duplicate events', async () => {
  const f = await currentJournal();
  const results = [
    await continueNativeTransition(f.paths, f.name),
    await continueNativeTransition(f.paths, f.name),
  ];
  expect(results.filter(Boolean)).toHaveLength(1);
  const events = await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef);
  expect(events.filter((e) => e.type === 'run_started')).toHaveLength(1);
  expect(events.filter((e) => e.type === 'state_transitioned')).toHaveLength(1);
});
it('has the real prepared WAL durable before any trajectory or Run side effect', async () => {
  const f = await currentJournal();
  await fs.rm(f.wal);
  await prepareNativeTransition({
    paths: f.paths,
    previousState: f.journal.previousState,
    nextState: f.journal.nextState,
    previousRun: f.journal.previousRun,
    nextRun: f.journal.nextRun,
    evidenceHash: f.journal.evidenceHash,
    eventData: f.journal.eventData,
    operation: f.journal.operation,
    transitionId: () => f.journal.id,
    now: new Date(f.journal.createdAt),
  });
  expect(await readNativeRunState(f.dir)).toBeNull();
  expect(await readNativeCheckpoint(f.dir, f.journal.nextRun.checkpointRef)).toBeNull();
  expect(await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).toEqual([]);
  expect(JSON.parse(await fs.readFile(f.wal, 'utf8'))).toEqual(f.journal);
});
it('explicitly truncates only an incomplete last trajectory line then continues the same WAL once', async () => {
  const f = await currentJournal(),
    trajectory = path.join(f.dir, 'trajectory.jsonl');
  await fs.writeFile(trajectory, '{"sequence":');
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(
    /incomplete|repair|trajectory/i,
  );
  await repairNativeTrajectoryTail(f.paths, f.name);
  await continueNativeTransition(f.paths, f.name);
  const events = await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef);
  expect(events.filter((e) => e.type === 'state_transitioned')).toHaveLength(1);
});
it('never truncates a malformed middle trajectory line or clears its original WAL', async () => {
  const f = await currentJournal(),
    trajectory = path.join(f.dir, 'trajectory.jsonl'),
    bad = '{bad-json}\n' + JSON.stringify({ sequence: 2, type: 'state_transitioned' }) + '\n';
  await fs.writeFile(trajectory, bad);
  const wal = await fs.readFile(f.wal, 'utf8');
  await expect(repairNativeTrajectoryTail(f.paths, f.name)).rejects.toThrow(
    /invalid|malformed|JSON/i,
  );
  await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow();
  expect(await fs.readFile(trajectory, 'utf8')).toBe(bad);
  expect(await fs.readFile(f.wal, 'utf8')).toBe(wal);
});
it('preserves concurrently appended trajectory bytes when preparing tail repair', async () => {
  const f = await currentJournal(),
    trajectory = path.join(f.dir, 'trajectory.jsonl');
  await fs.writeFile(trajectory, '{"partial":');
  const extra =
    '\n' +
    JSON.stringify({
      sequence: 2,
      type: 'checkpoint_written',
      data: { source: 'concurrent-writer' },
    }) +
    '\n';
  await expect(
    repairNativeTrajectoryTail(f.paths, f.name, {
      beforeCommit: () => fs.appendFile(trajectory, extra),
    }),
  ).rejects.toThrow(/changed while preparing/);
  expect(await fs.readFile(trajectory, 'utf8')).toBe('{"partial":' + extra);
});
it('continues the original WAL while preserving obsolete writer metadata without token confirmation', async () => {
  const f = await currentJournal();
  const file = path.join(f.paths.runtimeDir, 'locks', 'transition-' + f.name + '.lock');
  const bytes = JSON.stringify({
    id: 'SIMULATED obsolete writer',
    createdAt: '2026-07-15T00:00:00.000Z',
    operation: 'continue original WAL',
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  await continueNativeTransition(f.paths, f.name);
  expect(await inspectPendingNativeTransition(f.paths, f.name)).toBeNull();
  expect(
    (await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).filter(
      (e) => e.type === 'state_transitioned',
    ),
  ).toHaveLength(1);
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  expect(await continueNativeTransition(f.paths, f.name)).toBeNull();
});
it('does not archive through a pending unaccepted Verify transition or consume its WAL', async () => {
  const f = await nonFirstFixture(),
    before = await fs.readFile(f.wal, 'utf8'),
    state = await readNativeChange(f.paths, f.name);
  const result = await nativeArchiveCommand([f.name, '--confirmed'], f.project).catch((e) => ({
    exitCode: 65,
    error: String(e),
  }));
  expect(result.exitCode).not.toBe(0);
  expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
  expect(await readNativeChange(f.paths, f.name)).toEqual(state);
});
it.each(['prepared', 'yaml-committed'])(
  'explicitly imports a real published %s migration journal without recreating middle-schema engines',
  async (boundary) => {
    const f = await fixture(),
      frozen = JSON.parse(
        await fs.readFile(
          'test/fixtures/native-052-migration-journals/' + boundary + '.json',
          'utf8',
        ),
      );
    await fs.rm(f.wal);
    for (const x of frozen.changeFiles)
      await fs.writeFile(
        path.join(f.paths.changesDir, f.name, x.ref),
        Buffer.from(x.bytesBase64, 'base64'),
      );
    await fs.mkdir(f.paths.transactionsDir, { recursive: true });
    const wal = path.join(f.paths.transactionsDir, 'portable-migration-' + f.name + '.json');
    await fs.writeFile(wal, frozen.transactionText);
    const source = await fs.readFile(
        path.join(f.paths.changesDir, f.name, 'comet-state.yaml'),
        'utf8',
      ),
      diagnosis = await nativeDoctorCommand([f.name], f.project);
    expect(diagnosis.data).toMatchObject({ healthy: false, repaired: false });
    expect(await fs.readFile(wal, 'utf8')).toBe(frozen.transactionText);
    expect(
      await fs.readFile(path.join(f.paths.changesDir, f.name, 'comet-state.yaml'), 'utf8'),
    ).toBe(source);
    const repaired = await nativeDoctorCommand([f.name, '--repair'], f.project);
    expect(repaired.exitCode).toBe(0);
    await expect(fs.access(wal)).rejects.toMatchObject({ code: 'ENOENT' });
    const portable = await fs.readFile(
      path.join(f.paths.changesDir, f.name, 'comet-state.yaml'),
      'utf8',
    );
    expect(portable).toContain('schema: comet.native.v4');
    const again = await nativeDoctorCommand([f.name, '--repair'], f.project);
    expect(again.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(f.paths.changesDir, f.name, 'comet-state.yaml'), 'utf8'),
    ).toBe(portable);
  },
);

import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import { nativeSpecCommand } from '../../../domains/comet-native/native-spec-command.js';
import { readSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
it.each(['archive', 'next', 'spec-remove'])(
  'requires explicit Doctor import for ordinary %s and leaves original WAL state Run and owner unchanged',
  async (command) => {
    const f = await nonFirstFixture(),
      file = path.join(f.paths.changesDir, f.name, 'comet-state.yaml'),
      before = {
        wal: await fs.readFile(f.wal, 'utf8'),
        state: await fs.readFile(file, 'utf8'),
        run: await readNativeRunState(f.dir),
        owner: await readSdkChangeOwner(f.project, 'native', f.name),
      };
    let result: any;
    try {
      result =
        command === 'archive'
          ? await nativeArchiveCommand([f.name, '--confirmed'], f.project)
          : command === 'next'
            ? await nativeNextCommand([f.name], f.project)
            : await nativeSpecCommand(['remove', f.name, 'legacy-capability'], f.project);
    } catch (error) {
      result = { exitCode: 65, error: String(error) };
    }
    const after = {
      wal: await fs.readFile(f.wal, 'utf8').catch(() => null),
      state: await fs.readFile(file, 'utf8'),
      run: await readNativeRunState(f.dir),
      owner: await readSdkChangeOwner(f.project, 'native', f.name),
    };
    expect.soft(result.exitCode).not.toBe(0);
    expect.soft(after.wal).toBe(before.wal);
    expect.soft(after.state).toBe(before.state);
    expect.soft(after.run).toEqual(before.run);
    expect.soft(after.owner).toEqual(before.owner);
    expect.soft(JSON.stringify(result)).toMatch(/doctor.*--repair/);
    expect.soft(result.data?.archived).not.toBe(true);
  },
);

function oldSchemaVariant(journal: any, generation: 'v1' | 'v2') {
  const j = structuredClone(journal);
  for (const key of ['operation']) delete j[key];
  for (const which of ['previousState', 'nextState']) {
    const s = j[which];
    for (const key of [
      'verification_protocol',
      'approved_contract_hash',
      'implementation_scope',
      'verification_evidence',
      'partial_allowance',
    ])
      delete s[key];
    s.schema = 'comet.native.' + generation;
    if (generation === 'v1') {
      delete s.minimum_runtime_version;
      delete s.revision;
    } else s.minimum_runtime_version = 2;
  }
  j.schema = 'comet.native.transition.' + generation;
  if (generation === 'v1') {
    delete j.minimum_runtime_version;
    delete j.revision;
  } else j.minimum_runtime_version = 2;
  return j;
}
it.each(['v1', 'v2'] as const)(
  'reads %s historical journal schema without restoring its removed migration executor and rejects malformed Run data',
  async (generation) => {
    const f = await currentJournal(),
      legacy = oldSchemaVariant(f.journal, generation);
    expect(inspectNativeTransitionJournalValue(legacy, f.name).status).toBe('migration-required');
    for (const mutation of [
      (j: any) => (j.nextRun.status = 'waiting'),
      (j: any) => (j.nextRun.iteration = 2),
      (j: any) => (j.nextRun.retries = { corrupt: 1 }),
      (j: any) => (j.nextRun.checkpointRef = 'runtime/other.json'),
      (j: any) => (j.eventData.extra = true),
    ])
      expect(() =>
        inspectNativeTransitionJournalValue(mutated(legacy, mutation), f.name),
      ).toThrow();
    await fs.writeFile(f.wal, JSON.stringify(legacy));
    const before = await fs.readFile(f.wal, 'utf8');
    expect((await inspectPendingNativeTransitionSchema(f.paths, f.name))?.status).toBe(
      'migration-required',
    );
    await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(/migration|migrate/i);
    expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
    expect(await readNativeRunState(f.dir)).toBeNull();
  },
);

it.each(['first-hop', 'non-first-hop'])(
  'explicit Doctor repair completes original %s WAL once and retains original approval event Run and checkpoint history',
  async (kind) => {
    const f = kind === 'first-hop' ? await currentJournal() : await nonFirstFixture();
    const stateFile = path.join(f.paths.changesDir, f.name, 'comet-state.yaml'),
      source = await fs.readFile(stateFile, 'utf8'),
      before = await fs.readFile(f.wal, 'utf8');
    await nativeDoctorCommand([f.name], f.project);
    expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
    const result = await nativeDoctorCommand([f.name, '--repair'], f.project);
    expect(result.exitCode).toBe(0);
    expect(await readNativeRunState(f.dir)).toEqual(f.journal.nextRun);
    const events = await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef),
      accepted = events.filter(
        (e) => e.type === 'state_transitioned' && e.data.transitionId === f.journal.id,
      );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].data).toEqual({
      ...f.journal.eventData,
      transitionId: f.journal.id,
    });
    expect(await readNativeCheckpoint(f.dir, f.journal.nextRun.checkpointRef)).toMatchObject({
      runId: f.journal.nextRun.runId,
    });
    await expect(fs.access(f.wal)).rejects.toMatchObject({ code: 'ENOENT' });
    const portable = await fs.readFile(stateFile, 'utf8');
    expect(portable).toContain('schema: comet.native.v4');
    const originalRun = await readNativeRunState(f.dir);
    expect((await nativeDoctorCommand([f.name, '--repair'], f.project)).exitCode).toBe(0);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(portable);
    expect(await readNativeRunState(f.dir)).toEqual(originalRun);
    expect(await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).toEqual(events);
  },
);

import { sha256Text } from '../../../domains/comet-native/native-hash.js';
it.each(['v1', 'v2'] as const)(
  'keeps %s old spec-rebase semantics readable without recreating the removed intermediate migration',
  async (generation) => {
    const f = await nonFirstFixture(),
      j: any = structuredClone(f.journal),
      summary = 'Refresh the old spec base',
      hash = sha256Text('spec-rebase:' + f.name + ':' + summary);
    j.operation = 'spec-rebase';
    j.evidenceHash = hash;
    j.nextState.phase = 'build';
    j.nextState.verification_result = 'pending';
    j.nextState.verification_report = null;
    j.nextState.implementation_scope = null;
    j.nextState.verification_evidence = null;
    j.nextState.partial_allowance = null;
    j.nextRun.currentStep = 'build';
    j.eventData = {
      previousPhase: 'build',
      nextPhase: 'build',
      evidenceHash: hash,
      summary,
      reason: 'spec-rebase',
    };
    const legacy = oldSchemaVariant(j, generation),
      parsed = inspectNativeTransitionJournalValue(legacy, f.name);
    expect(parsed.status).toBe('migration-required');
    expect(parsed.journal.evidenceHash).toBe(hash);
    expect(parsed.journal.previousRun?.runId).toBe(f.journal.previousRun?.runId);
    expect(parsed.journal.nextRun.runId).toBe(f.journal.nextRun.runId);
    await fs.writeFile(f.wal, JSON.stringify(legacy));
    const before = await fs.readFile(f.wal, 'utf8');
    await expect(continueNativeTransition(f.paths, f.name)).rejects.toThrow(/migration|migrate/i);
    expect(await fs.readFile(f.wal, 'utf8')).toBe(before);
  },
);

import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
it('retains explicit Doctor tail repair and same-WAL continuation for the original incomplete-trajectory badcase', async () => {
  const f = await currentJournal();
  await expect(
    continueNativeTransition(f.paths, f.name, {
      afterChangeStateWritten() {
        throw Error('before trajectory');
      },
    }),
  ).rejects.toThrow('before trajectory');
  const file = path.join(f.dir, 'trajectory.jsonl');
  await fs.writeFile(file, '{"sequence":1');
  const before = await fs.readFile(file, 'utf8');
  expect(await inspectNativeStatus(f.paths, f.name)).toMatchObject({
    nextCommand: null,
    error: expect.stringContaining('incomplete final line'),
  });
  const diagnosis = await nativeDoctorCommand([f.name], f.project);
  expect(diagnosis.data).toMatchObject({ healthy: false, repaired: false });
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  let result: any;
  try {
    result = await nativeDoctorCommand([f.name, '--repair'], f.project);
  } catch (error) {
    result = { exitCode: 65, error: String(error) };
  }
  expect(result.exitCode).toBe(0);
  expect(
    (await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).map((e) => e.type),
  ).toEqual(['run_started', 'state_transitioned']);
  await expect(fs.access(f.wal)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves old root and transition lock bytes while continuing the same real WAL once', async () => {
  const f = await currentJournal();
  const files = ['root-move', 'transition-' + f.name].map((name) =>
    path.join(f.paths.runtimeDir, 'locks', name + '.lock'),
  );
  const bytes = 'SIMULATED obsolete writer bytes';
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  const wal = await fs.readFile(f.wal, 'utf8');
  expect(wal).toContain(f.journal.id);
  await continueNativeTransition(f.paths, f.name);
  expect(
    (await readNativeTrajectory(f.dir, f.journal.nextRun.trajectoryRef)).filter(
      (e) => e.type === 'state_transitioned',
    ),
  ).toHaveLength(1);
  for (const file of files) expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  expect(await continueNativeTransition(f.paths, f.name)).toBeNull();
});

it('keeps malformed middle trajectory bytes and original WAL unchanged during explicit Doctor repair', async () => {
  const f = await currentJournal();
  await expect(
    continueNativeTransition(f.paths, f.name, {
      afterChangeStateWritten() {
        throw Error('before trajectory');
      },
    }),
  ).rejects.toThrow('before trajectory');
  const file = path.join(f.dir, 'trajectory.jsonl'),
    bad = '{not-json}\n{"sequence":';
  await fs.writeFile(file, bad);
  const wal = await fs.readFile(f.wal, 'utf8'),
    stateFile = path.join(f.paths.changesDir, f.name, 'comet-state.yaml'),
    state = await fs.readFile(stateFile, 'utf8'),
    run = await readNativeRunState(f.dir);
  const result = await nativeDoctorCommand([f.name, '--repair'], f.project);
  expect(result.data).toMatchObject({
    healthy: false,
    repaired: false,
    findings: expect.arrayContaining([expect.objectContaining({ code: 'trajectory-invalid' })]),
  });
  expect(await fs.readFile(file, 'utf8')).toBe(bad);
  expect(await fs.readFile(f.wal, 'utf8')).toBe(wal);
  expect(await fs.readFile(stateFile, 'utf8')).toBe(state);
  expect(await readNativeRunState(f.dir)).toEqual(run);
  expect(result.data.findings).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'trajectory-tail-repaired' })]),
  );
});

import { prepareNativeTransition } from '../../../domains/comet-native/native-transition-journal.js';
