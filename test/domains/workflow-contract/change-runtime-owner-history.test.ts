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

it('rejects symlink history entries and directories instead of hiding an active identity', async () => {
  const historyDirectory = path.dirname(path.join(runtimeRoot, historyRef));
  await fs.mkdir(historyDirectory, { recursive: true });
  await fs.symlink(path.join(runtimeRoot, activeRef), path.join(runtimeRoot, historyRef), 'file');
  await expect(listSdkChangePartitions(root, 'native')).rejects.toThrow(
    'Invalid native change runtime owner entry',
  );
  await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow('symbolic link');
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

it('serializes competing partition moves without losing the owner', async () => {
  await Promise.all([closeSdkChangeOwner(root, owner), closeSdkChangeOwner(root, owner)]);
  await Promise.all([reopenSdkChangeOwner(root, owner), reopenSdkChangeOwner(root, owner)]);
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: ['first'], history: [] });
});

it('detects a complete reopen between active and history enumeration rather than returning an empty snapshot', async () => {
  await closeSdkChangeOwner(root, owner);
  const readdir = fs.readdir.bind(fs);
  let reopened = false;
  vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
    const result = await readdir(...args);
    if (!reopened && args[0] === path.join(runtimeRoot, 'change-owners/native')) {
      reopened = true;
      await reopenSdkChangeOwner(root, owner);
    }
    return result;
  });
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: ['first'],
    history: [],
  });
  expect(reopened).toBe(true);
});

it('blocks interrupted tokens without writing and exposes explicit named recovery', async () => {
  await closeSdkChangeOwner(root, owner);
  const tokenFile = path.join(runtimeRoot, '.change-owner-partitions.json');
  const token = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
  token.state = 'writing';
  await fs.writeFile(tokenFile, JSON.stringify(token));
  const before = await fs.readFile(tokenFile, 'utf8');
  await expect(listSdkChangePartitions(root, 'native', { readOnly: true })).rejects.toThrow(
    'incomplete or in progress',
  );
  await expect(readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).rejects.toThrow(
    'incomplete or in progress',
  );
  expect(await fs.readFile(tokenFile, 'utf8')).toBe(before);
  expect(await listSdkChangeOwnerRecoveryNames(root, 'native')).toEqual(['first']);
  expect(await recoverSdkChangeOwnerToActive(root, 'native', 'first')).toEqual(owner);
  expect(await listSdkChangePartitions(root, 'native')).toEqual({ active: ['first'], history: [] });
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

it.each(['{bad', JSON.stringify({ schema: 'future', token: 'x', state: 'stable' })])(
  'rejects invalid partition metadata without treating it as legacy absence',
  async (source) => {
    await fs.writeFile(path.join(runtimeRoot, '.change-owner-partitions.json'), source);
    await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
      'Invalid change owner partition token',
    );
    await expect(closeSdkChangeOwner(root, owner)).rejects.toThrow(
      'Invalid change owner partition token',
    );
  },
);

it('reads legacy owners without a partition token without creating metadata', async () => {
  const token = path.join(runtimeRoot, '.change-owner-partitions.json');
  await fs.unlink(token);
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

it('recovers an interrupted first registration with no owner through locked recovery enumeration', async () => {
  await fs.unlink(path.join(runtimeRoot, activeRef));
  const tokenFile = path.join(runtimeRoot, '.change-owner-partitions.json');
  const token = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
  token.state = 'writing';
  await fs.writeFile(tokenFile, JSON.stringify(token));
  await expect(listSdkChangePartitions(root, 'native', { readOnly: true })).rejects.toThrow(
    'incomplete or in progress',
  );
  expect(await listSdkChangeOwnerRecoveryNames(root, 'native')).toEqual([]);
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toEqual({
    active: [],
    history: [],
  });
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

it('reads the partition token twice for an entire owner batch, validates every body and keeps standalone reads guarded', async () => {
  for (let index = 0; index < 11; index += 1) {
    const change = `batch-${index}`;
    await registerSdkChangeOwner(root, { ...owner, change, runId: change });
  }
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  const tokenReads = () =>
    read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json').length;
  expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toHaveLength(12);
  expect(tokenReads()).toBe(2);
  expect(
    read.mock.calls.filter((call) => call[1].startsWith('change-owners/native/')),
  ).toHaveLength(12);
  read.mockClear();
  expect(await listSdkChangePartitions(root, 'native', { readOnly: true })).toMatchObject({
    history: [],
  });
  expect(tokenReads()).toBe(2);
  read.mockClear();
  await readSdkChangeOwner(root, 'native', 'first', { readOnly: true });
  expect(tokenReads()).toBe(2);
  read.mockClear();
  await listSdkChangeNames(root, 'native', { readOnly: true });
  expect(tokenReads()).toBe(2);
});

it('retries the entire batch when registration completes while an owner body is being read', async () => {
  const original = protectedFiles.readProtectedProjectFile;
  let inserted = false;
  let firstReads = 0;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === activeRef) {
      firstReads += 1;
      if (!inserted) {
        inserted = true;
        await registerSdkChangeOwner(root, { ...owner, change: 'late', runId: 'late' });
      }
    }
    return result;
  });
  expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual(['first', 'late']);
  expect(firstReads).toBe(2);
});

it('does not reuse a pre-mutation body when the fence requires a retry', async () => {
  const original = protectedFiles.readProtectedProjectFile;
  let changed = false;
  let firstReads = 0;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === activeRef) {
      firstReads += 1;
      if (!changed) {
        changed = true;
        await registerSdkChangeOwner(root, { ...owner, change: 'late', runId: 'late' });
        await fs.writeFile(path.join(runtimeRoot, activeRef), '{}');
      }
    }
    return result;
  });
  await expect(
    runWithHookReadCache(() => listSdkChangeNames(root, 'native', { readOnly: true })),
  ).rejects.toThrow('Invalid change runtime owner');
  expect(firstReads).toBe(2);
});

it('waits for all failing batch reads before validating the final token', async () => {
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
  expect(tokens).toBe(2);
  expect(completed).toBe(10);
});

it('bounds retries when a writer changes the partition token on every batch attempt', async () => {
  const original = protectedFiles.readProtectedProjectFile;
  let attempts = 0;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === activeRef) {
      attempts += 1;
      await registerSdkChangeOwner(root, { ...owner, change: 'late', runId: 'late' });
    }
    return result;
  });
  await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
    'changed during discovery',
  );
  expect(attempts).toBe(3);
});

it('rejects unknown token metadata published during a batch rather than accepting its owner list', async () => {
  const original = protectedFiles.readProtectedProjectFile;
  vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === activeRef) {
      await fs.writeFile(
        path.join(runtimeRoot, '.change-owner-partitions.json'),
        '{"schema":"future"}',
      );
    }
    return result;
  });
  await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
    'Invalid change owner partition token',
  );
});

it('does not borrow a batch fence for a nested read from a different project', async () => {
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-other-owner-batch-'));
  try {
    await fs.mkdir(path.join(otherRoot, '.git'));
    await registerSdkChangeOwner(otherRoot, owner);
    const otherRuntime = await resolveWorkspaceRuntimeRoot(otherRoot);
    const original = protectedFiles.readProtectedProjectFile;
    let otherTokens = 0;
    let nested = false;
    vi.spyOn(protectedFiles, 'readProtectedProjectFile').mockImplementation(async (...args) => {
      if (args[0] === otherRuntime && args[1] === '.change-owner-partitions.json') otherTokens += 1;
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
    expect(otherTokens).toBe(2);
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
    ).toHaveLength(2);
    expect(
      read.mock.calls.filter((call) => call[1].startsWith('change-owners/native/')),
    ).toHaveLength(6);
  });
  read.mockClear();
  await runWithHookReadCache(() => readSdkChangeOwner(root, 'native', 'first', { readOnly: true }));
  expect(
    read.mock.calls.filter((call) => call[1] === '.change-owner-partitions.json'),
  ).toHaveLength(2);
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
      const tokenFile = path.join(runtimeRoot, '.change-owner-partitions.json');
      const token = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
      token.token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await fs.writeFile(tokenFile, JSON.stringify(token));
      expect(await listSdkChangeNames(root, 'native', { readOnly: true })).toEqual([]);
      expect(await readSdkChangeOwner(root, 'native', 'first', { readOnly: true })).toBeNull();
    });
  },
);

it('does not publish body results when final token validation fails', async () => {
  const tokenFile = path.join(runtimeRoot, '.change-owner-partitions.json');
  const validToken = await fs.readFile(tokenFile, 'utf8');
  const original = protectedFiles.readProtectedProjectFile;
  await runWithHookReadCache(async () => {
    const read = vi
      .spyOn(protectedFiles, 'readProtectedProjectFile')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        if (args[1] === activeRef) await fs.writeFile(tokenFile, '{bad');
        return result;
      });
    await expect(listSdkChangeNames(root, 'native', { readOnly: true })).rejects.toThrow(
      'Invalid change owner partition token',
    );
    read.mockRestore();
    await fs.writeFile(tokenFile, validToken);
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
