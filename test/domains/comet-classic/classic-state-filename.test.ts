import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { resolveClassicStateFile } from '../../../domains/workflow-contract/classic-state-file.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(format: 'sdk' | 'compat' = 'sdk') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-filename-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const cli = (...args: string[]) =>
    runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
  const created = await cli('state', 'init', 'demo', 'hotfix', '--runtime', format, '--json');
  expect(created.exitCode, created.stderr ?? created.stdout).toBe(0);
  const dir = path.join(root, 'openspec/changes/demo');
  return {
    root,
    dir,
    cli,
    modern: path.join(dir, 'comet-state.yaml'),
    legacy: path.join(dir, '.comet.yaml'),
  };
}
function watchWrites() {
  return (['mkdir', 'writeFile', 'rename', 'unlink', 'rm'] as const).map((method) =>
    vi.spyOn(fs, method),
  );
}

describe('Classic state filename compatibility', () => {
  it('creates only the modern file for SDK and only the legacy file for compat', async () => {
    for (const format of ['sdk', 'compat'] as const) {
      const f = await fixture(format);
      expect(await resolveClassicStateFile(f.dir)).toBe(format === 'sdk' ? f.modern : f.legacy);
      await expect(fs.lstat(format === 'sdk' ? f.legacy : f.modern)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  });

  it.each(['comet-state.yaml', '.comet.yaml'])(
    'reads, writes and restores SDK %s in place, including after Archive',
    async (name) => {
      const f = await fixture();
      if (name === '.comet.yaml') await fs.rename(f.modern, f.legacy);
      const file = path.join(f.dir, name);
      const store = createClassicSdkStateStore(f.root);
      expect((await f.cli('state', 'set', 'demo', 'language', 'zh-CN', '--json')).exitCode).toBe(0);
      let run = (await store.read('demo'))!;
      expect(parse(await fs.readFile(file, 'utf8')).language).toBe('zh-CN');
      await fs.rm(resolveWorkspaceRuntimeRootSync(f.root), { recursive: true });
      expect((await store.read('demo'))!.state).toEqual(run.state);
      run = (await store.read('demo'))!;
      await store.compareAndSwap('demo', run.revision, {
        ...run,
        revision: run.revision + 1,
        state: { ...(run.state as object), phase: 'archive', archived: true },
      });
      const archived = path.join(f.root, 'openspec/changes/archive/2026-10-11-demo');
      await fs.rename(f.dir, archived);
      await store.read('demo');
      await fs.rm(resolveWorkspaceRuntimeRootSync(f.root), { recursive: true });
      expect((await store.read('demo'))!.state).toMatchObject({
        archived: true,
        phase: 'archive',
        language: 'zh-CN',
      });
      expect(await resolveClassicStateFile(archived)).toBe(path.join(archived, name));
      await expect(
        fs.lstat(path.join(archived, name === '.comet.yaml' ? 'comet-state.yaml' : '.comet.yaml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.for(['file', 'dangling-symlink'] as const)(
    'rejects two names with %s before CLI or SDK writes',
    async (kind, context) => {
      if (kind === 'dangling-symlink') await requireFileSymlink(context);
      const f = await fixture();
      const store = createClassicSdkStateStore(f.root);
      const run = (await store.read('demo'))!;
      const backing = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/classic'),
      });
      const source = await fs.readFile(f.modern, 'utf8');
      if (kind === 'file') await fs.writeFile(f.legacy, source);
      else await fs.symlink(path.join(f.root, 'missing'), f.legacy);
      const writes = watchWrites();
      for (const args of [
        ['state', 'init', 'demo', 'hotfix', '--runtime', 'sdk'],
        ['state', 'next', 'demo'],
        ['state', 'set', 'demo', 'language', 'en'],
        ['state', 'select', 'demo'],
        ['state', 'restore', 'demo', '--confirmed'],
        ['guard', 'demo', 'open', '--apply'],
        ['archive', 'demo'],
        ['handoff', 'demo', 'design', '--write'],
      ]) {
        const result = await f.cli(...args, '--json');
        expect(result.exitCode, args.join(' ')).not.toBe(0);
        expect(`${result.stderr ?? ''}${result.stdout ?? ''}`, args.join(' ')).toContain(
          'ambiguous',
        );
      }
      await expect(store.read('demo')).rejects.toThrow(/ambiguous/u);
      await expect(
        store.compareAndSwap('demo', run.revision, { ...run, revision: run.revision + 1 }),
      ).rejects.toThrow(/ambiguous/u);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(await backing.read('demo')).toEqual(run);
      expect(await fs.readFile(f.modern, 'utf8')).toBe(source);
    },
  );

  it('rejects a lone symbolic state file before establishing runtime storage', async (context) => {
    await requireFileSymlink(context);
    const f = await fixture();
    const outside = path.join(f.root, 'saved-state.yaml');
    await fs.rename(f.modern, outside);
    await fs.symlink(outside, f.modern);
    await fs.rm(resolveWorkspaceRuntimeRootSync(f.root), { recursive: true });
    const writes = watchWrites();
    await expect(createClassicSdkStateStore(f.root).read('demo')).rejects.toThrow(/regular file/u);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});
