import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DashboardIndexStore,
  resolveDashboardIndexPath,
} from '../../../domains/dashboard/index-store.js';

const tempRoots: string[] = [];
const openStores: DashboardIndexStore[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-index-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(openStores.splice(0).map((store) => store.close()));
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('DashboardIndexStore', () => {
  it('stores and reads the serialized Native index without project files', async () => {
    const projectRoot = await createTempRoot();
    const cacheRoot = await createTempRoot();
    const store = new DashboardIndexStore({ projectRoot, cacheRoot });
    openStores.push(store);
    const nativeIndex = {
      active: [{ locator: 'native-1', entry: { name: 'change-1', status: 'active' } }],
      archived: [],
      all: [{ locator: 'native-1', entry: { name: 'change-1', status: 'active' } }],
      activeChangeCount: 1,
      archivedChangeCount: 0,
    };

    await store.open();
    await store.replaceNativeIndex(nativeIndex);

    await expect(store.readNativeIndex()).resolves.toEqual(nativeIndex);
    expect(store.databasePath).toBe(resolveDashboardIndexPath(projectRoot, cacheRoot));
    expect(await fs.stat(store.databasePath)).toBeTruthy();
    expect(await fs.readdir(projectRoot)).toEqual([]);

    await store.close();
  });

  it('queries Native root rows through SQLite filters and pagination', async () => {
    const projectRoot = await createTempRoot();
    const cacheRoot = await createTempRoot();
    const store = new DashboardIndexStore({ projectRoot, cacheRoot });
    openStores.push(store);
    const nativeIndex = {
      active: [
        {
          locator: 'native-1',
          entry: { name: 'alpha', status: 'active' },
          source: { workspace: { label: 'main', branch: 'main' } },
          children: [],
        },
        {
          locator: 'native-2',
          entry: { name: 'beta', status: 'active' },
          source: { workspace: { label: 'feature', branch: 'feature/beta' } },
          children: [],
        },
      ],
      archived: [],
      all: [],
      activeChangeCount: 2,
      archivedChangeCount: 0,
    };

    await store.open();
    await store.replaceNativeIndex(nativeIndex);

    await expect(
      store.queryNativeIndex<{ entry: { name: string } }>({
        status: 'active',
        query: 'feature',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({ total: 1, rows: [{ entry: { name: 'beta' } }] });
    await store.close();
  });
});
