import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-readonly-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const result = await runClassicCli(
    ['state', 'init', 'demo', 'full', '--runtime', 'sdk', '--json'],
    undefined,
    {
      projectRoot: root,
      invocationCwd: root,
    },
  );
  expect(result.exitCode, result.stdout).toBe(0);
  const runRoot = path.join(root, '.comet/runtime/sdk-runs/classic');
  const backing = createFileRuntimeStore<WorkflowRun>({ rootDir: runRoot });
  return {
    root,
    runRoot,
    backing,
    store: createClassicSdkStateStore(root, { store: backing, readOnly: true }),
    stateFile: path.join(root, 'openspec/changes/demo/.comet.yaml'),
    markerFile: path.join(root, '.comet/runtime/state-projections/classic/demo.json'),
  };
}

async function snapshot(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  async function visit(directory: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      result[path.relative(root, file)] = {
        kind: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
        mtime: stat.mtimeMs,
        ...(stat.isFile() ? { source: (await fs.readFile(file)).toString('base64') } : {}),
      };
      if (stat.isDirectory()) await visit(file);
    }
  }
  await visit(root);
  return result;
}

function watchWrites() {
  const methods = ['mkdir', 'writeFile', 'rename', 'unlink', 'rm'] as const;
  return methods.map((method) => vi.spyOn(fs, method));
}

describe('Classic SDK read-only diagnostics', () => {
  it('reads the existing Run once without locks, directories, projection writes or CAS', async () => {
    const { root, backing, store, stateFile } = await fixture();
    const expected = await backing.read('demo');
    const before = await snapshot(root);
    const read = vi.spyOn(backing, 'read');
    const cas = vi.spyOn(backing, 'compareAndSwap');
    const writes = watchWrites();
    const opened = vi.spyOn(fs, 'open');
    expect(await store.read('demo')).toEqual(expected);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cas).not.toHaveBeenCalled();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(opened.mock.calls.some(([file]) => String(file).endsWith('.lock'))).toBe(false);
    expect(opened.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(await snapshot(root)).toEqual(before);
  });

  it('forwards read-only inspection without mutating any project file', async () => {
    const { root, backing } = await fixture();
    const expected = await backing.read('demo');
    const before = await snapshot(root);
    const writes = watchWrites();
    expect((await inspectClassicSdkRun(root, 'demo', { readOnly: true })).run).toEqual(expected);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await snapshot(root)).toEqual(before);
  });

  it('validates a matching state in memory without recreating the absent marker directory', async () => {
    const { root, store, markerFile, backing } = await fixture();
    const expected = await backing.read('demo');
    await fs.rm(path.dirname(markerFile), { recursive: true });
    const before = await snapshot(root);
    expect(await store.read('demo')).toEqual(expected);
    expect(await snapshot(root)).toEqual(before);
  });

  it.each(['run', 'state', 'settings', 'checkpoint'] as const)(
    'reports named recovery for missing or stale %s without repairing it',
    async (problem) => {
      const { root, store, stateFile, runRoot } = await fixture();
      if (problem === 'run') await fs.rm(runRoot, { recursive: true });
      else if (problem === 'state') await fs.rm(stateFile);
      else {
        const source = await fs.readFile(stateFile, 'utf8');
        await fs.writeFile(
          stateFile,
          problem === 'settings'
            ? source.replace(/^language: en$/mu, 'language: zh-CN')
            : `${source}run_checkpoint: { schema: stale }\n`,
        );
      }
      const before = await snapshot(root);
      const writes = watchWrites();
      await expect(store.read('demo')).rejects.toThrow(/comet state next demo --json/u);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(await snapshot(root)).toEqual(before);
    },
  );

  it('rejects Runtime-owned state edits and invalid marker revisions without writes', async () => {
    const { root, store, stateFile, markerFile } = await fixture();
    await createClassicSdkStateStore(root).read('demo');
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace(/^phase: open$/mu, 'phase: archive'));
    let before = await snapshot(root);
    await expect(store.read('demo')).rejects.toThrow(/Runtime-owned field/u);
    expect(await snapshot(root)).toEqual(before);
    await fs.writeFile(stateFile, source);
    const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
    await fs.writeFile(markerFile, JSON.stringify({ ...marker, revision: -1 }));
    before = await snapshot(root);
    await expect(store.read('demo')).rejects.toThrow(/projection marker is invalid/u);
    expect(await snapshot(root)).toEqual(before);
  });

  it('rejects writes before invoking the backing store', async () => {
    const { root, store, backing } = await fixture();
    const current = (await backing.read('demo'))!;
    const before = await snapshot(root);
    const cas = vi.spyOn(backing, 'compareAndSwap');
    await expect(
      store.compareAndSwap('demo', current.revision, {
        ...current,
        revision: current.revision + 1,
      }),
    ).rejects.toThrow(/read-only store/u);
    expect(cas).not.toHaveBeenCalled();
    expect(await snapshot(root)).toEqual(before);
  });
});
