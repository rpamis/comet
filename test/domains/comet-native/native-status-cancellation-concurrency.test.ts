import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import * as ownership from '../../../domains/comet-native/native-runtime-ownership.js';
import * as cancellation from '../../../domains/comet-native/native-sdk-cancellation.js';
import * as status from '../../../domains/comet-native/native-sdk-status.js';
import { listDiscoveredNativeStatusPage } from '../../../domains/comet-native/native-status-discovery.js';
import * as worktrees from '../../../platform/paths/git-worktree.js';

let root: string;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-status-concurrency-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('limits cancellation checks to four across workspaces and waits for every check', async () => {
  const secondary = path.join(root, 'secondary');
  await fs.mkdir(secondary);
  await writeProjectConfig(secondary, defaultProjectConfig('docs', 'en'));
  vi.spyOn(worktrees, 'listGitWorktrees').mockReturnValue([
    { root, branch: 'main', detached: false },
    { root: secondary, branch: 'secondary', detached: false },
  ]);
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  vi.spyOn(ownership, 'listNativeSdkChangeNames').mockImplementation(async (projectRoot) =>
    projectRoot === root ? names.slice(0, 3) : names.slice(3),
  );
  const gates = new Map(names.map((name) => [name, deferred()]));
  let active = 0;
  let peak = 0;
  const completed: string[] = [];
  const probe = vi
    .spyOn(cancellation, 'isNativeSdkChangeCancellationComplete')
    .mockImplementation(async (_root, name) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await gates.get(name)!.promise;
        completed.push(name);
        return true;
      } finally {
        active--;
      }
    });
  const work = listDiscoveredNativeStatusPage({ projectRoot: root });
  try {
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(4));
    expect(active).toBe(4);
    gates.get('d')!.resolve();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(5));
    gates.get('e')!.resolve();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(6));
  } finally {
    for (const gate of gates.values()) gate.resolve();
  }
  expect((await work).items).toEqual([]);
  expect({ active, peak, count: completed.length }).toEqual({ active: 0, peak: 4, count: 6 });
  expect(probe.mock.calls.map(([, name]) => name)).toEqual(names);
  expect(probe.mock.calls.map(([projectRoot]) => projectRoot)).toEqual([
    root,
    root,
    root,
    secondary,
    secondary,
    secondary,
  ]);
});

it.each([false, true])(
  'retains failed probes in stable candidate order for full inspection (corrupt: %s)',
  async (corrupt) => {
    const names = ['e', 'd', 'c', 'b', 'a'];
    vi.spyOn(ownership, 'listNativeSdkChangeNames').mockResolvedValue(names);
    const gates = new Map(names.map((name) => [name, deferred()]));
    let active = 0;
    const probe = vi
      .spyOn(cancellation, 'isNativeSdkChangeCancellationComplete')
      .mockImplementation(async (_root, name) => {
        active++;
        try {
          await gates.get(name)!.promise;
          if (name === 'b') throw new Error('unreadable cancellation record');
          return name === 'c' || name === 'e';
        } finally {
          active--;
        }
      });
    const project = vi
      .spyOn(status, 'inspectNativeSdkStatus')
      .mockImplementation(async ({ name }) => {
        expect(active).toBe(0);
        if (corrupt && name === 'b') throw new Error('corrupt authoritative Run');
        return { name } as Awaited<ReturnType<typeof status.inspectNativeSdkStatus>>;
      });
    const work = listDiscoveredNativeStatusPage({ projectRoot: root });
    const outcome = work.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(4));
      gates.get('b')!.resolve();
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(5));
      expect(project).not.toHaveBeenCalled();
    } finally {
      for (const name of [...names].reverse()) gates.get(name)!.resolve();
    }
    const observed = await outcome;
    if (corrupt) {
      expect(observed).toEqual({ error: new Error('corrupt authoritative Run') });
    } else {
      expect('value' in observed && observed.value.items.map(({ name }) => name)).toEqual([
        'a',
        'b',
        'd',
      ]);
    }
    expect(project.mock.calls.map(([options]) => options.name)).toEqual(['a', 'b', 'd']);
  },
);
