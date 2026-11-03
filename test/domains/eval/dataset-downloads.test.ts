import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  listDatasetDownloads,
  startDatasetDownload,
} from '../../../domains/eval/dataset-downloads.js';
const runner = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/process/run-owned-command.js', () => ({ runOwnedCommand: runner }));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-download-'));
  roots.push(root);
  return root;
}
it('lists both datasets without downloading or creating storage', async () => {
  const root = await project();
  const rows = await listDatasetDownloads(root);
  expect(rows.map((row) => row.status)).toEqual(['not-downloaded', 'not-downloaded']);
  expect(runner).not.toHaveBeenCalled();
  expect(await fs.readdir(root)).toEqual([]);
});
it('requires explicit license acceptance for WorkBuddy', async () => {
  const root = await project();
  await expect(startDatasetDownload(root, 'workbuddy-code', false)).rejects.toThrow(/许可/);
  expect(runner).not.toHaveBeenCalled();
});
it('starts once on explicit request and exposes failure for retry', async () => {
  const root = await project();
  let reject: (error: Error) => void = () => {};
  runner.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  expect((await startDatasetDownload(root, 'skillsbench', false)).status).toBe('downloading');
  await startDatasetDownload(root, 'skillsbench', false);
  await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
  reject(new Error('network failure'));
  await vi.waitFor(async () => expect((await listDatasetDownloads(root))[1].status).toBe('failed'));
  expect((await listDatasetDownloads(root))[1].error).toContain('network failure');
});

it('reuses a matching cache and reports mismatched versions without downloading', async () => {
  const root = await project();
  const selected = (await listDatasetDownloads(root))[1];
  await fs.mkdir(path.join(selected.root, 'tasks'), { recursive: true });
  const receipt = path.join(selected.root, 'dataset-source.json');
  await fs.writeFile(
    receipt,
    JSON.stringify({
      dataset: 'skillsbench',
      revision: 'b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af',
      archiveSha256: '525bf1559a1eb3511ca2daaf2a307e2dd882efd646c130a730de0f9f37da34d7',
    }),
  );
  expect((await startDatasetDownload(root, 'skillsbench', false)).status).toBe('cached');
  expect(runner).not.toHaveBeenCalled();
  await fs.writeFile(receipt, JSON.stringify({ dataset: 'skillsbench', revision: 'old' }));
  expect((await listDatasetDownloads(root))[1].status).toBe('version-mismatch');
  await fs.writeFile(receipt, '{');
  expect((await listDatasetDownloads(root))[1].status).toBe('version-mismatch');
  expect(runner).not.toHaveBeenCalled();
});
