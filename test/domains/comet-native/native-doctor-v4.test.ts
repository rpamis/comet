import '../../helpers/isolated-agent-home.js';
import { continueNativeTransition } from '../../../domains/comet-native/native-transition-journal.js';
import { readNativeChange } from '../../../domains/comet-native/native-change.js';
import { readNativeRunState } from '../../../domains/comet-native/native-run-store.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  nativeProjectPaths,
  nativeChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  readNativePortableChange,
  createNativePortableChange,
} from '../../../domains/comet-native/native-portable-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const fixtures = path.resolve('test/fixtures/native-052-migration-journals');
async function materialize(boundary: 'prepared' | 'yaml-committed', journal = true) {
  const frozen = JSON.parse(await fs.readFile(path.join(fixtures, boundary + '.json'), 'utf8')),
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-published-migration-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.');
  for (const item of frozen.changeFiles) {
    const file = path.join(paths.changesDir, frozen.name, ...item.ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(item.bytesBase64, 'base64'));
  }
  const txn = path.join(paths.transactionsDir, 'portable-migration-' + frozen.name + '.json');
  if (journal) {
    await fs.mkdir(path.dirname(txn), { recursive: true });
    await fs.writeFile(txn, frozen.transactionText);
  }
  return {
    root,
    paths,
    frozen,
    txn,
    stateFile: path.join(paths.changesDir, frozen.name, 'comet-state.yaml'),
  };
}
for (const boundary of ['prepared', 'yaml-committed'] as const) {
  for (const mode of ['named', 'global'] as const) {
    it(`${mode === 'named' ? 'reports and resumes a persisted portable migration transaction' : 'repairs a persisted portable transaction from project-wide Doctor'} from published 052 ${boundary}`, async () => {
      const f = await materialize(boundary),
        stateBefore = await fs.readFile(f.stateFile),
        txnBefore = await fs.readFile(f.txn),
        args = mode === 'named' ? [f.frozen.name] : [];
      const read = await nativeDoctorCommand([...args], f.root);
      expect(read.data).toMatchObject({
        healthy: false,
        repaired: false,
        transactions: [
          expect.objectContaining({
            kind: 'migration',
            change: f.frozen.name,
            status: boundary,
          }),
        ],
      });
      expect(await fs.readFile(f.stateFile)).toEqual(stateBefore);
      expect(await fs.readFile(f.txn)).toEqual(txnBefore);
      const result = await nativeDoctorCommand([...args, '--repair'], f.root);
      expect(result.data).toMatchObject({ healthy: true, repaired: true });
      if (mode === 'global') expect(result.data).toMatchObject({ transactions: [] });
      await expect(fs.stat(f.txn)).rejects.toMatchObject({ code: 'ENOENT' });
      const state = await readNativePortableChange(f.paths, f.frozen.name);
      expect(state).toMatchObject({
        schema: 'comet.native.v4',
        name: f.frozen.name,
        phase: 'shape',
        verification_result: 'pending',
      });
      expect(state.builder_handoff).toBeNull();
      expect(state.verification).toBeNull();
    });
  }
}
it('merges current portable statuses with a published unmigrated legacy change without implicit conversion', async () => {
  const f = await materialize('prepared', false);
  const second = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-mixed-current-'));
  roots.push(second);
  await writeProjectConfig(second, defaultProjectConfig('.', 'en'));
  const secondPaths = await nativeProjectPaths(second, '.');
  await createNativePortableChange({
    paths: secondPaths,
    name: 'current-portable',
    language: 'en',
  });
  await fs.cp(
    path.join(secondPaths.changesDir, 'current-portable'),
    path.join(f.paths.changesDir, 'current-portable'),
    { recursive: true },
  );
  const before = await fs.readFile(f.stateFile);
  const result = await nativeDoctorCommand([], f.root);
  expect(await fs.readFile(f.stateFile)).toEqual(before);
  expect(result.data).toMatchObject({
    healthy: false,
    changes: expect.arrayContaining([
      expect.objectContaining({
        name: f.frozen.name,
        schema: 'comet.native.v3',
        phase: 'shape',
        recoveryCommandArgs: ['comet', 'native', 'doctor', f.frozen.name, '--repair'],
      }),
      expect.objectContaining({
        name: 'current-portable',
        schema: 'comet.native.v4',
        phase: 'shape',
      }),
    ]),
  });
  expect(JSON.stringify(result.data)).toContain('current-portable');
  expect(JSON.stringify(result.data)).toContain('doctor');
});
it('reports malformed published legacy Run trajectory with its exact path without changing or repairing its bytes', async () => {
  const f = await materialize('prepared', false),
    runtime = nativeChangeRuntimeDir(f.paths, f.frozen.name),
    file = path.join(runtime, 'trajectory.jsonl'),
    raw = Buffer.from('{not-json}\n');
  await fs.mkdir(runtime, { recursive: true });
  const old = JSON.parse(
    await fs.readFile(
      path.resolve('test/fixtures/native-052-transition-journal/remove-after-recovery.json'),
      'utf8',
    ),
  );
  await fs.writeFile(path.join(runtime, 'transition.json'), old.journalText);
  await continueNativeTransition(f.paths, f.frozen.name);
  const publishedState = await readNativeChange(f.paths, f.frozen.name);
  expect(publishedState).toMatchObject({
    phase: 'build',
    approval: 'confirmed',
    run_id: old.journal.nextRun.runId,
  });
  expect((await readNativeRunState(runtime))?.runId).toBe(old.journal.nextRun.runId);
  await fs.appendFile(file, raw);
  const originalTrajectory = await fs.readFile(file);
  const before = await fs.readFile(f.stateFile);
  for (const flags of [[], ['--repair']]) {
    const result = await nativeDoctorCommand([f.frozen.name, ...flags], f.root);
    expect(await fs.readFile(file)).toEqual(originalTrajectory);
    expect(await fs.readFile(f.stateFile)).toEqual(before);
    expect(result.data).toMatchObject({
      healthy: false,
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: 'trajectory-invalid',
          severity: 'error',
          path: file,
        }),
      ]),
    });
  }
});
import { loadPreparedNativeArchive } from '../../helpers/native-archive-wal.js';
it('keeps an invalid published migration journal unchanged on explicit project repair instead of converting its old state', async () => {
  const f = await materialize('prepared');
  const malformed = JSON.stringify({
    ...f.frozen.transaction,
    futureProgress: 'SIMULATED unknown business data',
  });
  await fs.writeFile(f.txn, malformed);
  const before = await fs.readFile(f.stateFile);
  const result = await nativeDoctorCommand(['--repair'], f.root);
  expect(result.data).toMatchObject({
    healthy: false,
    repaired: false,
    transactions: expect.arrayContaining([
      expect.objectContaining({ kind: 'migration', status: 'invalid' }),
    ]),
  });
  expect(await fs.readFile(f.txn, 'utf8')).toBe(malformed);
  expect(await fs.readFile(f.stateFile)).toEqual(before);
});
it('does not continue an actual prepared Archive WAL through generic Doctor repair', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-no-implicit-archive-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, '.'),
    frozen = await loadPreparedNativeArchive(paths, 'replace-create'),
    file = path.join(paths.transactionsDir, frozen.journal.id, 'transaction.json'),
    before = await fs.readFile(file);
  const canonical = path.join(paths.specsDir, 'authentication/spec.md'),
    canonicalBefore = await fs.readFile(canonical);
  const result = await nativeDoctorCommand(['--repair'], root);
  expect(result.data).toMatchObject({
    healthy: false,
    repaired: false,
    transactions: expect.arrayContaining([
      expect.objectContaining({ id: frozen.journal.id, status: 'prepared' }),
    ]),
  });
  expect(await fs.readFile(file)).toEqual(before);
  expect(await fs.readFile(canonical)).toEqual(canonicalBefore);
  await expect(fs.stat(path.join(paths.changesDir, frozen.state.name))).resolves.toBeTruthy();
});
it('does not infer incomplete migration from five ordinary document names or delete their original contents', async () => {
  const f = await materialize('yaml-committed', false),
    dir = path.join(f.paths.changesDir, f.frozen.name),
    docs = new Map(
      ['evidence.md', 'repair.md', 'archive.md', 'checkpoint.md', 'verification.md'].map((name) => [
        name,
        Buffer.from('SIMULATED USER original ' + name + '\r\n'),
      ]),
    );
  for (const [name, bytes] of docs) await fs.writeFile(path.join(dir, name), bytes);
  const before = await fs.readFile(f.stateFile);
  for (const args of [[f.frozen.name], [f.frozen.name, '--repair']]) {
    const result = await nativeDoctorCommand(args, f.root);
    expect(result.data).toMatchObject({ healthy: true, repaired: false });
    expect(await fs.readFile(f.stateFile)).toEqual(before);
    for (const [name, bytes] of docs)
      expect(await fs.readFile(path.join(dir, name))).toEqual(bytes);
  }
  await expect(fs.stat(f.txn)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('keeps a fresh portable change healthy in named and project-wide Doctor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-fresh-portable-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.');
  await createNativePortableChange({
    paths,
    name: 'fresh-portable',
    language: 'en',
  });
  const file = path.join(paths.changesDir, 'fresh-portable', 'comet-state.yaml'),
    before = await fs.readFile(file);
  const named = await nativeDoctorCommand(['fresh-portable'], root),
    global = await nativeDoctorCommand([], root);
  expect(named.data).toMatchObject({
    healthy: true,
    repaired: false,
    runtimeFormat: 'compat',
    state: { name: 'fresh-portable', phase: 'shape' },
  });
  expect(global.data).toMatchObject({
    healthy: true,
    repaired: false,
    changes: expect.arrayContaining([
      expect.objectContaining({
        name: 'fresh-portable',
        schema: 'comet.native.v4',
        phase: 'shape',
        status: 'current',
      }),
    ]),
  });
  expect(await fs.readFile(file)).toEqual(before);
});
it('keeps a generated portable verification report out of migration findings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-report-view-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.');
  await createNativePortableChange({
    paths,
    name: 'verified-portable',
    language: 'en',
  });
  const file = path.join(paths.changesDir, 'verified-portable', 'verification.md'),
    report = Buffer.from('# Verification\r\n\r\nOriginal generated report input\r\n'),
    stateFile = path.join(paths.changesDir, 'verified-portable', 'comet-state.yaml'),
    before = await fs.readFile(stateFile);
  await fs.writeFile(file, report);
  for (const flags of [[], ['--repair']]) {
    const result = await nativeDoctorCommand(['verified-portable', ...flags], root);
    expect(result.data).toMatchObject({ healthy: true, repaired: false });
    expect(await fs.readFile(stateFile)).toEqual(before);
    expect(await fs.readFile(file)).toEqual(report);
  }
  expect((await nativeDoctorCommand([], root)).data).toMatchObject({
    healthy: true,
  });
});
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
it('keeps the original SDK Run authoritative and preserves a retired Supervisor overlay as uninterpreted data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-overlay-is-not-authority-'));
  roots.push(root);
  const name = 'current-sdk',
    created = await runNativeCli(['new', name, '--project-root', root, '--json']);
  expect(created.exitCode, created.stdout).toBe(0);
  const paths = await nativeProjectPaths(root, 'docs'),
    before = (await inspectNativeSdkRun(root, name)).run,
    file = path.join(nativeChangeRuntimeDir(paths, name), 'supervisor/state.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const extra of [
    {
      schema: 'comet.native.supervisor.v2',
      parent: 'different-parent',
      history: [],
    },
    {
      schema: 'comet.native.supervisor.v2',
      parent: name,
      children: [{ name: 'untrusted-child', futureProgress: 'keep exact raw data' }],
      integration: { headCommit: 'SIMULATED old local progress' },
      futureProgress: 'unknown',
    },
  ]) {
    const bytes = Buffer.from(JSON.stringify(extra));
    await fs.writeFile(file, bytes);
    for (const flags of [[], ['--repair']]) {
      const result = await nativeDoctorCommand([name, ...flags], root);
      expect(result.data).toMatchObject({ healthy: true, repaired: false });
      expect((await inspectNativeSdkRun(root, name)).run).toEqual(before);
      expect(await fs.readFile(file)).toEqual(bytes);
    }
  }
});
it('does not treat an unarchived Shape copy in an archive-named directory as completed conflicting history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-doctor-no-archive-name-radar-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    name = 'layout-conflict';
  await createNativePortableChange({ paths, name, language: 'en' });
  const active = path.join(paths.changesDir, name),
    archived = path.join(paths.archiveDir, '2026-08-09-' + name);
  await fs.cp(active, archived, { recursive: true });
  const file = path.join(active, 'comet-state.yaml'),
    copied = path.join(archived, 'comet-state.yaml'),
    before = await fs.readFile(file);
  const result = await nativeDoctorCommand([name], root);
  expect(result.data).toMatchObject({ healthy: true, repaired: false });
  expect(await fs.readFile(file)).toEqual(before);
  expect(await fs.readFile(copied)).toEqual(before);
  expect((await readNativePortableChange(paths, name)).archived).toBe(false);
});
