import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function preparedChange() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-sdk-read-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const created = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
    runClassicCli(['state', 'init', 'demo', 'tweak', '--json']),
  );
  expect(created.exitCode, created.stderr).toBe(0);
  return {
    root,
    store: createClassicSdkStateStore(root),
    stateFile: path.join(root, 'openspec/changes/demo/.comet.yaml'),
    markerFile: path.join(root, '.comet/runtime/state-projections/classic/demo.json'),
  };
}

describe('Classic SDK read work budgets', () => {
  it('reads stable state once without rewriting either projection', async () => {
    const { store, stateFile, markerFile } = await preparedChange();
    const before = await store.read('demo');
    const timestamp = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(stateFile, timestamp, timestamp);
    await fs.utimes(markerFile, timestamp, timestamp);
    const reads = vi.spyOn(fs, 'open');
    const renames = vi.spyOn(fs, 'rename');
    expect(await store.read('demo')).toEqual(before);
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
    expect((await fs.stat(stateFile)).mtimeMs).toBe(timestamp.getTime());
    expect((await fs.stat(markerFile)).mtimeMs).toBe(timestamp.getTime());
  });

  it('imports user settings once, advances its marker, and still rejects Runtime-owned edits', async () => {
    const { store, stateFile, markerFile } = await preparedChange();
    const before = (await store.read('demo'))!;
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace(/^language: en$/mu, 'language: zh-CN'));
    const renames = vi.spyOn(fs, 'rename');
    const imported = (await store.read('demo'))!;
    expect(imported.revision).toBe(before.revision + 1);
    expect(imported.state).toMatchObject({ language: 'zh-CN' });
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      1,
    );
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(imported.revision);
    renames.mockClear();
    expect((await store.read('demo'))?.revision).toBe(imported.revision);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
    await fs.writeFile(
      stateFile,
      (await fs.readFile(stateFile, 'utf8')).replace(/^phase: .*$/mu, 'phase: archive'),
    );
    await expect(store.read('demo')).rejects.toThrow(/Runtime-owned field/u);
  });

  it('rejects a stale CAS and repairs a missing marker without changing revision', async () => {
    const { store, markerFile } = await preparedChange();
    const before = (await store.read('demo'))!;
    expect(
      await store.compareAndSwap('demo', before.revision + 1, {
        ...before,
        revision: before.revision + 2,
      }),
    ).toBe(false);
    await fs.rm(markerFile);
    expect((await store.read('demo'))?.revision).toBe(before.revision);
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(before.revision);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an equal-content projection marker replaced by a symlink',
    async () => {
      const { root, store, markerFile } = await preparedChange();
      await store.read('demo');
      const target = path.join(root, 'copied-marker.json');
      const source = await fs.readFile(markerFile, 'utf8');
      await fs.writeFile(target, source);
      await fs.rm(markerFile);
      await fs.symlink(target, markerFile);
      await expect(store.read('demo')).rejects.toThrow(/symbolic link/u);
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    },
  );
});
