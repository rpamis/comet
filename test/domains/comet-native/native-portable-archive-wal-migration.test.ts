import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { applyNativeArchiveTransactionV2 } from '../../../domains/comet-native/native-archive-transaction.js';
import { recoverArchiveTransaction } from '../../../domains/comet-native/native-archive.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { loadPreparedNativeArchive } from '../../helpers/native-archive-wal.js';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});
async function fixture(variant: 'remove' | 'replace-create' = 'replace-create') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-wal-migration-extra-'));
  roots.push(root);
  const paths = await nativeProjectPaths(root, '.');
  return { root, paths, frozen: await loadPreparedNativeArchive(paths, variant) };
}
it('source portable remove journal: resumes without deleting an externally recreated Spec', async () => {
  const f = await fixture('remove');
  const canonical = path.join(f.paths.specsDir, 'legacy-auth/spec.md');
  await expect(
    applyNativeArchiveTransactionV2(f.paths, f.frozen.journal, {
      afterOperation(op) {
        if (op.type === 'remove') throw Error('SIMULATED crash after real remove');
      },
    }),
  ).rejects.toThrow('SIMULATED crash');
  await fs.mkdir(path.dirname(canonical), { recursive: true });
  await fs.writeFile(canonical, 'External author recreated this Spec\n');
  await expect(
    recoverArchiveTransaction({
      paths: f.paths,
      transactionId: f.frozen.journal.id,
      strategy: 'continue',
    }),
  ).rejects.toThrow(/content changed|object identity changed/);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
        'utf8',
      ),
    ).id,
  ).toBe(f.frozen.journal.id);
  expect(await fs.readFile(canonical, 'utf8')).toBe('External author recreated this Spec\n');
});
it('source portable applied Spec edit: retains the same transaction and never overwrites later canonical content', async () => {
  const f = await fixture();
  const canonical = path.join(f.paths.specsDir, 'authentication/spec.md');
  await expect(
    applyNativeArchiveTransactionV2(f.paths, f.frozen.journal, {
      afterOperation(_op, count) {
        if (count === 1) throw Error('SIMULATED crash after real first write');
      },
    }),
  ).rejects.toThrow('SIMULATED crash');
  await fs.writeFile(canonical, 'External author edited applied canonical Spec\n');
  await expect(
    recoverArchiveTransaction({
      paths: f.paths,
      transactionId: f.frozen.journal.id,
      strategy: 'continue',
    }),
  ).rejects.toThrow(/content changed|object identity changed/);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
        'utf8',
      ),
    ).id,
  ).toBe(f.frozen.journal.id);
  expect(await fs.readFile(canonical, 'utf8')).toBe(
    'External author edited applied canonical Spec\n',
  );
});
it('source portable project-wide Doctor: exposes a genuine prepared Archive transaction without mutating it', async () => {
  const f = await fixture();
  const before = await fs.readFile(
    path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
    'utf8',
  );
  const result = await nativeDoctorCommand([], f.root);
  await fs.writeFile(
    path.join(f.root, 'doctor-prepared-observation.json'),
    JSON.stringify(result, null, 2),
  );
  expect(
    await fs.readFile(
      path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
      'utf8',
    ),
  ).toBe(before);
  expect((result.data as any).healthy).toBe(false);
  for (const args of [[f.frozen.state.name], [f.frozen.state.name, '--repair']]) {
    const named = await nativeDoctorCommand(args, f.root);
    expect((named.data as any).healthy).toBe(false);
    expect((named.data as any).transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: f.frozen.journal.id,
          change: f.frozen.state.name,
          status: 'prepared',
        }),
      ]),
    );
    expect(
      await fs.readFile(
        path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
        'utf8',
      ),
    ).toBe(before);
  }
});
it('source portable public recovery: explicit Doctor continues a genuine prepared Archive transaction', async () => {
  const f = await fixture();
  const result = await nativeDoctorCommand(
    ['--transaction', f.frozen.journal.id, '--repair', '--strategy', 'continue'],
    f.root,
  );
  expect(result.exitCode).toBe(0);
  expect((result.data as any).transaction.id).toBe(f.frozen.journal.id);
  expect((result.data as any).transaction.status).toBe('committed');
  expect(await fs.readFile(path.join(f.paths.specsDir, 'authentication/spec.md'), 'utf8')).toBe(
    'new auth\n',
  );
});
import { createNativeSdkChange } from '../../../domains/comet-native/native-sdk-create.js';
import { returnNativePortableChangeToShape } from '../../../domains/comet-native/native-portable-runtime.js';
it('source portable mutation boundary: a real pending WAL blocks both Shape return and new SDK change', async () => {
  const f = await fixture();
  const file = path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
    before = await fs.readFile(file, 'utf8');
  await expect(
    returnNativePortableChangeToShape({
      paths: f.paths,
      name: f.frozen.state.name,
      reason: 'SIMULATED user requested changed requirements',
    }),
  ).rejects.toThrow('transaction recovery is required');
  await expect(
    createNativeSdkChange({
      paths: f.paths,
      name: 'other-change',
      language: 'en',
      workspaceBinding: { isolation: 'current', changeBranch: null, targetBranch: null },
    }),
  ).rejects.toThrow('transaction recovery is required');
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await expect(
    recoverArchiveTransaction({
      paths: f.paths,
      transactionId: f.frozen.journal.id,
      strategy: 'continue',
    }),
  ).resolves.toMatchObject({ status: 'committed' });
});
it.each(['after-write', 'after-move'] as const)(
  'source portable lost transaction: never fabricates successful recovery (%s)',
  async (stage) => {
    const f = await fixture();
    await expect(
      applyNativeArchiveTransactionV2(f.paths, f.frozen.journal, {
        afterOperation(op, count) {
          if (
            (stage === 'after-write' && count === 1) ||
            (stage === 'after-move' && op.id === 'archive-change')
          )
            throw Error('SIMULATED actual WAL boundary interruption');
        },
      }),
    ).rejects.toThrow('SIMULATED actual');
    const canonical = path.join(f.paths.specsDir, 'authentication/spec.md'),
      before = await fs.readFile(canonical),
      file = path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json');
    await fs.rm(file);
    await expect(
      recoverArchiveTransaction({
        paths: f.paths,
        transactionId: f.frozen.journal.id,
        strategy: 'continue',
      }),
    ).rejects.toThrow();
    expect(await fs.readFile(canonical)).toEqual(before);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('source portable moved archive Doctor: diagnoses by original name without active directory and continues only the explicit transaction', async () => {
  const f = await fixture();
  await expect(
    applyNativeArchiveTransactionV2(f.paths, f.frozen.journal, {
      afterOperation(op) {
        if (op.id === 'archive-change')
          throw Error('SIMULATED real archive moved before finalization');
      },
    }),
  ).rejects.toThrow('SIMULATED real archive moved');
  await expect(fs.stat(path.join(f.paths.changesDir, f.frozen.state.name))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const file = path.join(f.paths.transactionsDir, f.frozen.journal.id, 'transaction.json'),
    before = await fs.readFile(file, 'utf8');
  const result = await nativeDoctorCommand([f.frozen.state.name], f.root);
  expect((result.data as any).healthy).toBe(false);
  expect((result.data as any).transactions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: f.frozen.journal.id,
        change: f.frozen.state.name,
        status: 'applying',
      }),
    ]),
  );
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  const repaired = await nativeDoctorCommand(
    ['--transaction', f.frozen.journal.id, '--repair', '--strategy', 'continue'],
    f.root,
  );
  expect((repaired.data as any).transaction.status).toBe('committed');
});
