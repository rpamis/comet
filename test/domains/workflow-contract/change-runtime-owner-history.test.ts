import { requireFileSymlink } from '../../helpers/file-symlink.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import * as contained from '../../../domains/workflow-contract/contained-atomic-write.js';
import * as protectedFiles from '../../../domains/workflow-contract/protected-project-path.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  closeSdkChangeOwner,
  recoverSdkChangeOwnerToActive,
  listSdkChangeOwnerRecoveryNames,
  reopenSdkChangeOwner,
  listSdkChangeNames,
  listSdkChangePartitions,
  readSdkChangeOwner,
  registerSdkChangeOwner,
  type SdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

let root: string;
let runtimeRoot: string;
const owner: SdkChangeOwner = {
  schema: 'comet.change-owner.v1',
  workflow: 'native',
  change: 'first',
  format: 'sdk',
  application: 'native',
  runId: 'first',
};
const activeRef = 'change-owners/native/first.json';
const historyRef = 'change-owner-history/native/first.json';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-owner-history-'));
  await fs.mkdir(path.join(root, '.git'));
  await registerSdkChangeOwner(root, owner);
  runtimeRoot = await resolveWorkspaceRuntimeRoot(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('reads a bound canonical owner without partition tokens, no partition body reads and no writes', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  const write = vi.spyOn(contained, 'atomicWriteContainedText');
  expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
  expect(
    read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json'),
  ).toHaveLength(0);
  expect(read.mock.calls.filter((call) => [activeRef, historyRef].includes(call[1]))).toHaveLength(
    0,
  );
  expect(write).not.toHaveBeenCalled();
});

it('falls back after a legacy writer moves or rewrites an owner without refreshing its canonical record', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const canonical = path.join(runtimeRoot, 'change-owner-records/native/first.json');
  const source = await fs.readFile(canonical, 'utf8');
  await fs.mkdir(path.dirname(path.join(runtimeRoot, historyRef)), { recursive: true });
  await fs.copyFile(path.join(runtimeRoot, activeRef), path.join(runtimeRoot, historyRef));
  await fs.unlink(path.join(runtimeRoot, activeRef));
  expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: ['first'],
  });
  expect(await fs.readFile(canonical, 'utf8')).toBe(source);
  await fs.writeFile(path.join(runtimeRoot, historyRef), '{}');
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Invalid change runtime owner',
  );
});

it('does not hide double owners behind a previously bound canonical record', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  await fs.mkdir(path.dirname(path.join(runtimeRoot, historyRef)), { recursive: true });
  await fs.copyFile(path.join(runtimeRoot, activeRef), path.join(runtimeRoot, historyRef));
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Conflicting active and history',
  );
  expect(await recoverSdkChangeOwnerToActive(root, 'native', 'first')).toEqual(owner);
  expect(await readSdkChangeOwner(root, 'native', 'first')).toEqual(owner);
});

it('rejects a junction substituted beneath a canonical owner binding', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const directory = path.dirname(path.join(runtimeRoot, activeRef));
  const external = path.join(root, 'external-owner');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'first.json'), JSON.stringify(owner));
  await fs.rename(directory, `${directory}-original`);
  await fs.symlink(external, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).rejects.toThrow(
    /symbolic link|junction/u,
  );
});

it('recovers an interrupted canonical publication from the original legacy owner and refreshes reopen bindings', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const original = contained.atomicLinkContainedFile;
  const write = vi
    .spyOn(contained, 'atomicLinkContainedFile')
    .mockImplementation(async (source, target, ...args) => {
      if (target.includes('change-owner-records'))
        throw new Error('injected canonical publication interruption');
      return original(source, target, ...args);
    });
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('injected canonical');
  write.mockRestore();
  expect(await readSdkChangeOwner(root, 'native', 'first')).toEqual(owner);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: ['first'],
  });
  await reopenSdkChangeOwner(root, owner);
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
  expect(read.mock.calls.filter((call) => [activeRef, historyRef].includes(call[1]))).toHaveLength(
    0,
  );
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: ['first'],
    history: [],
  });
});

it('reads canonical bytes from the actual linked owner instead of trusting cached metadata', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const canonical = path.join(runtimeRoot, 'change-owner-records/native/first.json');
  const active = path.join(runtimeRoot, activeRef);
  expect((await fs.stat(canonical)).ino).toBe((await fs.stat(active)).ino);
  expect(JSON.parse(await fs.readFile(canonical, 'utf8'))).toEqual(owner);
  await fs.writeFile(active, '{}');
  expect(await fs.readFile(canonical, 'utf8')).toBe('{}');
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Invalid change runtime owner',
  );
});

it('keeps legacy ownership readable when canonical hard links are unsupported', async () => {
  vi.spyOn(contained, 'atomicLinkContainedFile').mockRejectedValue(
    Object.assign(new Error('unsupported link'), { code: 'ENOTSUP' }),
  );
  await registerSdkChangeOwner(root, owner, { canonical: true });
  expect(await readSdkChangeOwner(root, 'native', 'first')).toEqual(owner);
  expect(JSON.parse(await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8'))).toEqual(owner);
});

it('rebuilds a damaged detached canonical entry only through validated named recovery', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  const canonical = path.join(runtimeRoot, 'change-owner-records/native/first.json');
  await fs.unlink(canonical);
  await fs.writeFile(canonical, '{}');
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Invalid change runtime owner',
  );
  expect(await recoverSdkChangeOwnerToActive(root, 'native', 'first')).toEqual(owner);
  expect(await readSdkChangeOwner(root, 'native', 'first')).toEqual(owner);
  expect((await fs.stat(canonical)).ino).toBe(
    (await fs.stat(path.join(runtimeRoot, activeRef))).ino,
  );
});

it('keeps default discovery and direct reads compatible while active discovery excludes sealed identities', async () => {
  await closeSdkChangeOwner(root, owner);
  await closeSdkChangeOwner(root, owner);
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: [], history: ['first'] });
  expect(await listSdkChangeNames(root, 'native')).toEqual(['first']);
  expect(await readSdkChangeOwner(root, 'native', 'first')).toEqual(owner);
  await expect(registerSdkChangeOwner(root, owner)).rejects.toThrow('is in history');
  await reopenSdkChangeOwner(root, owner);
  await reopenSdkChangeOwner(root, owner);
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: ['first'], history: [] });
  await registerSdkChangeOwner(root, owner);
});

it('enumerates history identities without reading their bodies but full reads reject corruption', async () => {
  await closeSdkChangeOwner(root, owner);
  await fs.writeFile(path.join(runtimeRoot, historyRef), '{}');
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: ['first'],
  });
  expect(
    read.mock.calls.filter((call) => call[1].startsWith('change-owner-history/')),
  ).toHaveLength(0);
  await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
    'Invalid change runtime owner',
  );
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Invalid change runtime owner',
  );
});

it.each(['history', 'active'] as const)(
  'retains an interrupted move to %s as an explicit conflict and retries without losing identity',
  async (destination) => {
    if (destination === 'active') await closeSdkChangeOwner(root, owner);
    const remove = vi
      .spyOn(contained, 'removeContainedFile')
      .mockRejectedValueOnce(new Error('injected interruption'));
    const move = destination === 'history' ? closeSdkChangeOwner : reopenSdkChangeOwner;
    await expect(move(root, owner)).rejects.toThrow('injected interruption');
    expect(JSON.parse(await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8'))).toEqual(owner);
    expect(JSON.parse(await fs.readFile(path.join(runtimeRoot, historyRef), 'utf8'))).toEqual(
      owner,
    );
    await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
      'Conflicting active and history',
    );
    await expect(listSdkChangeNames(root, 'native', { partition: 'active' })).rejects.toThrow(
      'Conflicting active and history',
    );
    expect(await listSdkChangeNames(root, 'native', { partition: 'history' })).toEqual([]);
    remove.mockRestore();
    await move(root, owner);
    expect(await listSdkChangeNames(root, 'native', { partition: destination })).toEqual(['first']);
  },
);

it('refuses mismatched identities and custom applications without deleting either copy', async () => {
  await expect(closeSdkChangeOwner(root, { ...owner, application: 'custom' })).rejects.toThrow(
    'Only builtin Native',
  );
  await fs.mkdir(path.dirname(path.join(runtimeRoot, historyRef)), { recursive: true });
  await fs.writeFile(
    path.join(runtimeRoot, historyRef),
    JSON.stringify({ ...owner, application: 'custom' }),
  );
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('identity changed');
  await expect(reopenSdkChangeOwner(root, owner)).rejects.toThrow('identity changed');
  expect(await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8')).toContain('native');
  expect(await fs.readFile(path.join(runtimeRoot, historyRef), 'utf8')).toContain('custom');
});

it('rejects symlink history entries and directories instead of hiding an active identity', async (context) => {
  await requireFileSymlink(context);
  const historyDirectory = path.dirname(path.join(runtimeRoot, historyRef));
  await fs.mkdir(historyDirectory, { recursive: true });
  await fs.symlink(path.join(runtimeRoot, activeRef), path.join(runtimeRoot, historyRef), 'file');
  await expect(listSdkChangePartitions(root, 'native')).rejects.toThrow(
    'Invalid native change runtime owner entry',
  );
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('regular file');
  await fs.unlink(path.join(runtimeRoot, historyRef));
  await fs.rmdir(historyDirectory);
  await fs.symlink(
    path.join(runtimeRoot, 'change-owners/native'),
    historyDirectory,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(listSdkChangePartitions(root, 'native')).rejects.toThrow('symbolic link');
});

it('invalidates read-only discovery before moving and restores active visibility in the same request', async () => {
  await runWithHookReadCache(async () => {
    expect(
      await listSdkChangeNames(root, 'native', { readOnly: true, partition: 'active' }),
    ).toEqual(['first']);
    await closeSdkChangeOwner(root, owner);
    expect(
      await listSdkChangeNames(root, 'native', { readOnly: true, partition: 'active' }),
    ).toEqual([]);
    await reopenSdkChangeOwner(root, owner);
    expect(
      await listSdkChangeNames(root, 'native', { readOnly: true, partition: 'active' }),
    ).toEqual(['first']);
  });
});

it('recovers matching double owners after a fresh read failed', async () => {
  vi.spyOn(contained, 'removeContainedFile').mockRejectedValueOnce(new Error('crash'));
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('crash');
  vi.restoreAllMocks();
  await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
    'Conflicting active and history',
  );
  expect(await recoverSdkChangeOwnerToActive(root, 'native', 'first')).toEqual(owner);
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: ['first'], history: [] });
});

it('ignores only ordinary writer UUID temporary files and rejects other unexpected entries', async () => {
  const directory = path.join(runtimeRoot, 'change-owners/native');
  await fs.writeFile(
    path.join(directory, '.first.json.12345678-1234-1234-1234-123456789abc.tmp'),
    'incomplete',
  );
  expect(await listSdkChangeNames(root, 'native')).toEqual(['first']);
  await fs.writeFile(path.join(directory, 'unknown.tmp'), 'unknown');
  await expect(listSdkChangeNames(root, 'native')).rejects.toThrow(
    'Invalid native change runtime owner entry',
  );
});

it('reads legacy owners without a partition token without creating metadata', async () => {
  const token = path.join(runtimeRoot, '.change-owner-partitions.json');
  await expect(fs.lstat(token)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual(['first']);
  await expect(fs.lstat(token)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves Classic active lock artifacts and custom active recovery without permitting their history closure', async () => {
  const classic: SdkChangeOwner = { ...owner, workflow: 'classic', application: 'classic-full' };
  await registerSdkChangeOwner(root, classic);
  const directory = path.join(runtimeRoot, 'change-owners/classic');
  await fs.writeFile(path.join(directory, 'first.lock'), '{}');
  await fs.mkdir(path.join(directory, 'first.lock.contenders'));
  expect(await listSdkChangeNames(root, 'classic')).toEqual(['first']);
  expect(await recoverSdkChangeOwnerToActive(root, 'classic', 'first')).toEqual(classic);
  await expect(closeSdkChangeOwner(root, classic)).rejects.toThrow('Only builtin Native');
});

it('enumerates an interrupted first registration with no owner without creating coordination metadata', async () => {
  await fs.unlink(path.join(runtimeRoot, activeRef));
  expect(await listSdkChangeOwnerRecoveryNames(root, 'native')).toEqual([]);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: [],
  });
  await expect(
    fs.lstat(path.join(runtimeRoot, '.change-owner-partitions.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps the active owner when target ancestor directory synchronization fails', async () => {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    if (args[0] === path.join(runtimeRoot, 'change-owner-history') && args[1] === 'r') {
      throw Object.assign(new Error('injected directory sync failure'), { code: 'EIO' });
    }
    return open(...args);
  });
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('injected directory sync failure');
  expect(JSON.parse(await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8'))).toEqual(owner);
  expect(JSON.parse(await fs.readFile(path.join(runtimeRoot, historyRef), 'utf8'))).toEqual(owner);
  vi.restoreAllMocks();
  await recoverSdkChangeOwnerToActive(root, 'native', 'first');
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: ['first'], history: [] });
});

it('validates every owner body in one batch without partition tokens', async () => {
  for (let index = 0; index < 11; index += 1) {
    const change = `batch-${index}`;
    await registerSdkChangeOwner(root, { ...owner, change, runId: change });
  }
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  const tokenReads = () =>
    read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json').length;
  expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toHaveLength(12);
  expect(tokenReads()).toBe(0);
  expect(
    read.mock.calls.filter((call) => call[1].startsWith('change-owners/native/')),
  ).toHaveLength(12);
  read.mockClear();
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toMatchObject({
    history: [],
  });
  expect(tokenReads()).toBe(0);
  read.mockClear();
  await readSdkChangeOwner(root, 'native', 'first', { readOnly: true });
  expect(tokenReads()).toBe(0);
  read.mockClear();
  await listSdkChangeNames(root, 'native', { readOnly: true });
  expect(tokenReads()).toBe(0);
});

it('rejects a malformed owner on the next serial read instead of reusing an earlier request body', async () => {
  await runWithHookReadCache(async () => {
    expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual(['first']);
    await fs.writeFile(path.join(runtimeRoot, activeRef), '{}');
    await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
      'Invalid change runtime owner',
    );
  });
});

it('waits for every owner body before returning a failed batch without coordination tokens', async () => {
  for (let index = 0; index < 9; index += 1) {
    const change = `settle-${index}`;
    await registerSdkChangeOwner(root, { ...owner, change, runId: change });
  }
  const original = protectedFiles.readProtectedProjectFile;
  let completed = 0;
  let tokens = 0;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    if (args[1] === '.change-owner-partitions.json') {
      tokens += 1;
      if (tokens === 2) expect(completed).toBe(10);
    }
    if (args[1].startsWith('change-owners/native/')) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (args[1] === activeRef) throw new Error('injected owner failure');
        return await original(...args);
      } finally {
        completed += 1;
      }
    }
    return original(...args);
  });
  await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
    'injected owner failure',
  );
  expect(tokens).toBe(0);
  expect(completed).toBe(10);
});

it('keeps nested owner reads bound to their own project without partition fences', async () => {
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-other-owner-batch-'));
  try {
    await fs.mkdir(path.join(otherRoot, '.git'));
    await registerSdkChangeOwner(otherRoot, owner);
    const otherRuntime = await resolveWorkspaceRuntimeRoot(otherRoot);
    const original = protectedFiles.readProtectedProjectFile;
    let otherBodies = 0;
    let nested = false;
    vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
      if (args[0] === otherRuntime && args[1] === activeRef) otherBodies += 1;
      const result = await original(...args);
      if (!nested && args[0] === runtimeRoot && args[1] === activeRef) {
        nested = true;
        expect(await readSdkChangeOwner(otherRoot, 'native', 'first', { readOnly: true })).toEqual(
          owner,
        );
      }
      return result;
    });
    expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual(['first']);
    expect(otherBodies).toBe(1);
  } finally {
    await fs.rm(otherRoot, { recursive: true, force: true });
  }
});

it('publishes only a successful batch into the caller request cache for subsequent global-status owner reads', async () => {
  for (let index = 0; index < 5; index += 1) {
    const change = `global-${index}`;
    await registerSdkChangeOwner(root, { ...owner, change, runId: change });
  }
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  await runWithHookReadCache(async () => {
    const names = await listSdkChangeNames(root, 'native', { readOnly: true });
    for (const name of names) {
      expect(await readSdkChangeOwner(root, 'native', name, { readOnly: true })).toMatchObject({
        change: name,
      });
    }
    expect(
      read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json'),
    ).toHaveLength(0);
    expect(
      read.mock.calls.filter((call) => call[1].startsWith('change-owners/native/')),
    ).toHaveLength(6);
  });
  read.mockClear();
  await runWithHookReadCache(() => readSdkChangeOwner(root, 'native', 'first', { readOnly: true }));
  expect(
    read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json'),
  ).toHaveLength(0);
});

it.each(['deleted', 'compat'] as const)(
  'replaces an earlier request cache after an external writer makes an owner %s',
  async (mode) => {
    await runWithHookReadCache(async () => {
      expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
      if (mode === 'deleted') await fs.unlink(path.join(runtimeRoot, activeRef));
      else
        await fs.writeFile(
          path.join(runtimeRoot, activeRef),
          JSON.stringify({
            schema: owner.schema,
            workflow: owner.workflow,
            change: owner.change,
            format: 'compat',
          }),
        );
      expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual([]);
      expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toBeNull();
    });
  },
);

it('does not publish owner bodies from a failed batch into the request cache', async () => {
  await registerSdkChangeOwner(root, { ...owner, change: 'broken', runId: 'broken' });
  await fs.writeFile(path.join(runtimeRoot, 'change-owners/native/broken.json'), '{}');
  await runWithHookReadCache(async () => {
    await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
      'Invalid change runtime owner',
    );
    await fs.writeFile(path.join(runtimeRoot, activeRef), '{}');
    await expect(readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).rejects.toThrow(
      'Invalid change runtime owner',
    );
  });
});

it('keeps mutation owner reads uncached despite a previously published read-only batch', async () => {
  await runWithHookReadCache(async () => {
    await listSdkChangeNames(root, 'native', { readOnly: true });
    expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
    const lstat = vi.spyOn(fs, 'lstat');
    await fs.writeFile(
      path.join(runtimeRoot, activeRef),
      JSON.stringify({
        schema: owner.schema,
        workflow: owner.workflow,
        change: owner.change,
        format: 'compat',
      }),
    );
    expect(await readSdkChangeOwner(root, 'native', 'first')).toBeNull();
    const firstProbes = lstat.mock.calls.filter((call) => call[0] === runtimeRoot).length;
    expect(firstProbes).toBeGreaterThan(0);
    await fs.writeFile(path.join(runtimeRoot, activeRef), '{}');
    await expect(readSdkChangeOwner(root, 'native', 'first')).rejects.toThrow(
      'Invalid change runtime owner',
    );
    expect(lstat.mock.calls.filter((call) => call[0] === runtimeRoot).length).toBeGreaterThan(
      firstProbes,
    );
  });
});
it('keeps serial owner moves visible without publishing partition coordination metadata', async () => {
  await registerSdkChangeOwner(root, owner, { canonical: true });
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: ['first'],
    history: [],
  });
  await closeSdkChangeOwner(root, owner);
  expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toEqual(owner);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: ['first'],
  });
  await reopenSdkChangeOwner(root, owner);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: ['first'],
    history: [],
  });
  for (const ref of ['.change-owner-partitions.json', '.change-owner-partitions.lock'])
    await expect(fs.lstat(path.join(runtimeRoot, ref))).rejects.toMatchObject({ code: 'ENOENT' });
  const before = await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8');
  await expect(registerSdkChangeOwner(root, { ...owner, application: 'custom' })).rejects.toThrow(
    'another Runtime',
  );
  expect(await fs.readFile(path.join(runtimeRoot, activeRef), 'utf8')).toBe(before);
});
