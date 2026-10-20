import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFileRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { createApplicationStorageIndex } from '../../../domains/workflow-application/storage-index.js';

let root: string;
type Record = { runId: string; revision: number; held: boolean };
const store = () =>
  createFileRuntimeStore<Record>({ rootDir: root, writerProtocol: 'application-holder-v1' });
const read = vi.fn((id: string) => store().read(id));
const index = () =>
  createApplicationStorageIndex({
    rootDir: root,
    read,
    holds: (record: Record) => record.held,
    settle: (id) => store().settleRun(id),
  });
const key = (id: string) => createHash('sha256').update(JSON.stringify(id)).digest('hex');
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-holder-index-'));
  read.mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function write(id: string, held: boolean, revision = 1) {
  await index().begin(id, revision === 1);
  await store().compareAndSwap(id, revision === 1 ? null : revision - 1, {
    runId: id,
    revision,
    held,
  });
  await index().finish();
}
it('cold holder lookup does not open pending Run bodies or inventory', async () => {
  for (let n = 0; n < 25; n++) await write(`pending-${n}`, false);
  await write('holder', true);
  read.mockClear();
  const open = vi.spyOn(fs, 'open');
  expect((await index().holders()).map((record) => record.runId)).toEqual(['holder']);
  expect(read.mock.calls.map((call) => call[0])).toEqual(['holder']);
  expect(open.mock.calls.some((call) => String(call[0]).endsWith('inventory.json'))).toBe(false);
});
it('recovers committed and uncommitted pending intents without business replay', async () => {
  await write('writer', false);
  await index().begin('writer', false);
  await store().compareAndSwap('writer', 1, { runId: 'writer', revision: 2, held: true });
  expect((await index().holders()).map((record) => record.runId)).toEqual(['writer']);
  await index().begin('writer', false);
  expect((await index().holders()).map((record) => record.runId)).toEqual(['writer']);
  await write('writer', false, 3);
  expect(await index().holders()).toEqual([]);
});
it('audit detects registered records removed outside controlled writers', async () => {
  await write('pending', false);
  const state = (await index().inspect())!;
  await fs.rm(path.join(root, '.runtime-store-v2', key('pending'), 'checkpoint.json'));
  await expect(index().repair('audit', state.epoch)).rejects.toThrow();
});
it('audit can repair directory drift but cannot forget registered members', async () => {
  await write('pending', false);
  const state = (await index().inspect())!;
  const stray = path.join(root, 'stray');
  await fs.writeFile(stray, 'temporary external entry');
  await fs.rm(stray);
  await expect(index().holders()).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
  await index().repair('audit', state.epoch);
  expect(await index().holders()).toEqual([]);
  await expect(index().repair('audit', 'stale')).rejects.toMatchObject({
    code: 'STORE_INDEX_EPOCH_CHANGED',
  });
});
it('fences raw and old writers through the durable marker protocol', async () => {
  await write('pending', false);
  const marker = JSON.parse(await fs.readFile(path.join(root, key('pending')), 'utf8'));
  expect(marker.writerProtocol).toBe('application-holder-v1');
  await expect(
    createFileRuntimeStore<Record>({ rootDir: root }).compareAndSwap('pending', 1, {
      runId: 'pending',
      revision: 2,
      held: true,
    }),
  ).rejects.toMatchObject({ code: 'STORE_WRITER_FENCED' });
});

it('does not replace a published initialization inventory after a member disappears', async () => {
  await store().compareAndSwap('legacy', null, { runId: 'legacy', revision: 1, held: true });
  const rename = fs.rename.bind(fs);
  let interrupted = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    await rename(source, destination);
    if (!interrupted && path.basename(String(destination)) === 'inventory.json') {
      interrupted = true;
      throw new Error('after inventory publication');
    }
  });
  await expect(index().holders()).rejects.toThrow('after inventory publication');
  vi.restoreAllMocks();
  await fs.rm(path.join(root, key('legacy')));
  await fs.rm(path.join(root, '.runtime-store-v2', key('legacy')), { recursive: true });
  await expect(index().holders()).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
});

it('settles a registration interrupted after inventory publication', async () => {
  await index().begin('new', true);
  await store().compareAndSwap('new', null, { runId: 'new', revision: 1, held: true });
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    await rename(source, destination);
    if (path.basename(String(destination)) === 'inventory.json')
      throw new Error('after registration');
  });
  await expect(index().finish()).rejects.toThrow('after registration');
  vi.restoreAllMocks();
  expect((await index().holders()).map((record) => record.runId)).toEqual(['new']);
  expect(await index().inspect()).toMatchObject({ memberCount: 1, pending: null });
});

it('resumes rebuild after a new epoch is persisted before its inventory', async () => {
  await write('holder', true);
  const state = (await index().inspect())!;
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    const value =
      path.basename(String(destination)) === 'index.json'
        ? JSON.parse(await fs.readFile(source, 'utf8'))
        : null;
    await rename(source, destination);
    if (value?.state === 'building') throw new Error('after new epoch');
  });
  await expect(index().repair('rebuild', state.epoch)).rejects.toThrow('after new epoch');
  vi.restoreAllMocks();
  expect((await index().holders()).map((record) => record.runId)).toEqual(['holder']);
  expect((await index().inspect())?.epoch).not.toBe(state.epoch);
});

it('does not register an entirely deleted member as a new Run after audit', async () => {
  await write('member', false);
  const state = (await index().inspect())!;
  await fs.rm(path.join(root, key('member')));
  await fs.rm(path.join(root, '.runtime-store-v2', key('member')), { recursive: true });
  await expect(index().repair('rebuild', state.epoch)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  await expect(index().begin('member', true)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
});

it('explicit rebuild recovers a corrupt projection from independently checked inventory', async () => {
  await write('holder', true);
  const state = (await index().inspect())!;
  await fs.writeFile(path.join(root, '.runtime-store-coordination', 'index.json'), '{}');
  expect(await index().inspect()).toMatchObject({ state: 'corrupt', epoch: state.epoch });
  await expect(index().holders()).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
  await index().repair('rebuild', state.epoch);
  expect((await index().holders()).map((record) => record.runId)).toEqual(['holder']);
});

it('does not forget a committed registration whose Run disappeared after inventory publication', async () => {
  await index().begin('new', true);
  await store().compareAndSwap('new', null, { runId: 'new', revision: 1, held: true });
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    await rename(source, destination);
    if (path.basename(String(destination)) === 'inventory.json')
      throw new Error('after registration');
  });
  await expect(index().finish()).rejects.toThrow('after registration');
  vi.restoreAllMocks();
  await fs.rm(path.join(root, key('new')));
  await fs.rm(path.join(root, '.runtime-store-v2', key('new')), { recursive: true });
  await expect(index().holders()).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
  expect(await index().inspect()).toMatchObject({ pending: { runId: 'new', registering: true } });
});

it('abandons a never-committed new intent without creating an orphan Run', async () => {
  await index().begin('not-written', true);
  expect(await index().holders()).toEqual([]);
  expect(await index().inspect()).toMatchObject({ memberCount: 0, pending: null });
  await expect(fs.stat(path.join(root, '.runtime-store-v2'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
