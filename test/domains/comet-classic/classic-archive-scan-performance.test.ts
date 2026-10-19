import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  withClassicCommandContext,
  runWithoutClassicOperationObservations,
  classicCommandProjectRoot,
  classicCommandInvocationCwd,
} from '../../../domains/comet-classic/classic-command-context.js';
import { inspectClassicStateFileCandidates } from '../../../domains/comet-classic/classic-paths.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Classic archive scan work budgets', () => {
  let root: string;
  let archive: string;
  let active: string;
  const operation = <T>(work: () => Promise<T>) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, work);
  const inspect = () => inspectClassicStateFileCandidates(root, 'demo');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-archive-scan-'));
    roots.push(root);
    await prepareClassicLegacyProject(root);
    active = path.join(root, 'openspec/changes/demo');
    archive = path.join(root, 'openspec/changes/archive');
    await fs.mkdir(archive, { recursive: true });
    await fs.mkdir(active, { recursive: true });
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        fs.mkdir(path.join(archive, `2026-10-01-unrelated-${index}`)),
      ),
    );
  });

  it('enumerates each archive once per operation and never reuses a later operation', async () => {
    const scans = vi.spyOn(fs, 'readdir');
    await operation(async () => {
      const before = await inspect();
      expect(await inspect()).toEqual(before);
      expect(await inspect()).toEqual(before);
    });
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(1);
    await operation(inspect);
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(2);
    await inspect();
    await inspect();
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(4);
  });

  it('keeps project context but drops observations throughout and after a mutation scope', async () => {
    const scans = vi.spyOn(fs, 'readdir');
    await operation(async () => {
      await inspect();
      await expect(
        runWithoutClassicOperationObservations(async () => {
          expect(classicCommandProjectRoot()).toBe(root);
          expect(classicCommandInvocationCwd()).toBe(root);
          await inspect();
          await inspect();
          throw new Error('interrupted mutation');
        }),
      ).rejects.toThrow('interrupted mutation');
      await inspect();
      await inspect();
    });
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(4);
  });

  it('bounds archive scans for active and archived SDK command reads', async () => {
    const cli = (...args: string[]) =>
      runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
    const created = await cli('state', 'init', 'demo', 'tweak', '--runtime', 'sdk', '--json');
    expect(created.exitCode, created.stderr).toBe(0);
    const scans = vi.spyOn(fs, 'readdir');
    const activeRead = await cli('state', 'get', 'demo', 'phase', '--json');
    expect(activeRead.exitCode, activeRead.stderr).toBe(0);
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(1);

    const store = createClassicSdkStateStore(root);
    const run = (await store.read('demo'))!;
    expect(
      await store.compareAndSwap('demo', run.revision, {
        ...run,
        revision: run.revision + 1,
        state: { ...(run.state as object), phase: 'archive', archived: true },
      }),
    ).toBe(true);
    await fs.rename(active, path.join(archive, '2026-10-19-demo'));
    scans.mockClear();
    const archivedRead = await cli('state', 'get', 'demo', 'phase', '--json');
    expect(archivedRead.exitCode, archivedRead.stderr).toBe(0);
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(1);
  });

  it.each(['compare-and-swap', 'import-settings'] as const)(
    'rechecks archive candidates before %s even when directory metadata stays unchanged',
    async (mutation) => {
      const created = await runClassicCli(
        ['state', 'init', 'demo', 'tweak', '--runtime', 'sdk', '--isolation', 'current', '--json'],
        undefined,
        { projectRoot: root, invocationCwd: root },
      );
      expect(created.exitCode, created.stderr).toBe(0);
      const store = createClassicSdkStateStore(root);
      const original = (await store.read('demo'))!;
      const lstat = fs.lstat.bind(fs);
      const fingerprint = await fs.lstat(archive, { bigint: true });
      vi.spyOn(fs, 'lstat').mockImplementation(async (...args) =>
        String(args[0]) === archive && typeof args[1] === 'object' && args[1]?.bigint
          ? fingerprint
          : lstat(...args),
      );
      await operation(async () => {
        await store.read('demo');
        const added = path.join(archive, '2026-10-19-demo');
        await fs.mkdir(added);
        await fs.writeFile(path.join(added, 'comet-state.yaml'), 'workflow: tweak\n');
        await fs.writeFile(path.join(added, '.comet.yaml'), 'workflow: tweak\n');
        if (mutation === 'compare-and-swap') {
          await expect(
            store.compareAndSwap('demo', original.revision, {
              ...original,
              revision: original.revision + 1,
            }),
          ).rejects.toThrow(/state files are ambiguous/u);
        } else {
          const stateFile = path.join(active, 'comet-state.yaml');
          const source = await fs.readFile(stateFile, 'utf8');
          await fs.writeFile(stateFile, source.replace(/^language:.*$/mu, 'language: zh-CN'));
          await expect(store.read('demo')).rejects.toThrow(/state files are ambiguous/u);
        }
      });
      await fs.rm(path.join(archive, '2026-10-19-demo'), { recursive: true });
      // 读取原始 Run，避免再次导入尚未提交的 YAML 设置。
      const { readClassicSdkRunRecord } =
        await import('../../../domains/comet-classic/classic-sdk-state-store.js');
      expect((await readClassicSdkRunRecord(root, 'demo'))?.revision).toBe(original.revision);
    },
  );

  it('discovers archives created after an earlier scan in the same operation', async () => {
    const scans = vi.spyOn(fs, 'readdir');
    await operation(async () => {
      await inspect();
      const added = path.join(archive, '2026-10-19-demo');
      await fs.mkdir(added);
      await fs.writeFile(path.join(added, 'comet-state.yaml'), 'workflow: tweak\n');
      expect(await inspect()).toContain(path.join(added, 'comet-state.yaml'));
    });
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(2);
  });

  it('shares a concurrent scan only while its directory identity remains unchanged', async () => {
    const scans = vi.spyOn(fs, 'readdir');
    await operation(async () => {
      const results = await Promise.all([inspect(), inspect(), inspect()]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toEqual(results[2]);
    });
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(1);
  });

  it('rejects a directory changed during enumeration and retries its next inspection', async () => {
    const readdir = fs.readdir.bind(fs);
    const added = path.join(archive, '2026-10-19-demo');
    const scans = vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args) => {
      const names = await readdir(...args);
      await fs.mkdir(added);
      return names;
    });
    await operation(async () => {
      await expect(inspect()).rejects.toThrow(/directory changed while inspecting/u);
      expect(await inspect()).toContain(path.join(added, 'comet-state.yaml'));
    });
    expect(scans.mock.calls.filter(([target]) => String(target) === archive)).toHaveLength(2);
  });

  it('invalidates a replaced archive even when its mtime was restored', async () => {
    const previousTime = (await fs.stat(archive)).mtime;
    await operation(async () => {
      await inspect();
      await fs.rename(archive, path.join(root, 'previous-archive'));
      await fs.mkdir(path.join(archive, '2026-10-19-demo'), { recursive: true });
      await fs.utimes(archive, previousTime, previousTime);
      expect(await inspect()).toContain(path.join(archive, '2026-10-19-demo/comet-state.yaml'));
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects cached archive and candidate paths replaced by symbolic links',
    async () => {
      const dated = path.join(archive, '2026-10-19-demo');
      await fs.mkdir(dated);
      await operation(async () => {
        await inspect();
        await fs.rename(dated, path.join(root, 'previous-change'));
        await fs.symlink(path.join(root, 'previous-change'), dated);
        await expect(inspect()).rejects.toThrow(/symbolic link|junction/u);
        await fs.unlink(dated);
        await fs.rename(path.join(root, 'previous-change'), dated);
        await inspect();
        await fs.rename(archive, path.join(root, 'previous-archive'));
        await fs.symlink(path.join(root, 'previous-archive'), archive);
        await expect(inspect()).rejects.toThrow(/symbolic link|junction/u);
      });
    },
  );

  it.each(['active', 'dated', 'compat'] as const)(
    'still rejects a new filename conflict in an existing %s directory',
    async (kind) => {
      const directory =
        kind === 'active'
          ? active
          : path.join(archive, kind === 'dated' ? '2026-10-19-demo' : 'demo');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'comet-state.yaml'), 'workflow: tweak\n');
      await operation(async () => {
        await inspect();
        await fs.writeFile(path.join(directory, '.comet.yaml'), 'workflow: tweak\n');
        await expect(inspect()).rejects.toThrow(/state files are ambiguous/u);
      });
    },
  );

  it('checks both layouts and never confuses a longer archive suffix with the change', async () => {
    const otherArchive = path.join(root, 'docs/openspec/changes/archive');
    await fs.mkdir(otherArchive, { recursive: true });
    for (const directory of [archive, otherArchive]) {
      await fs.mkdir(path.join(directory, '2026-10-19-other-demo'));
      await fs.mkdir(path.join(directory, '2026-10-19-demo'));
    }
    await operation(async () => {
      const files = await inspect();
      expect(files.filter((file) => file.includes(`${path.sep}archive${path.sep}`))).toEqual([
        path.join(archive, '2026-10-19-demo/comet-state.yaml'),
        path.join(otherArchive, '2026-10-19-demo/comet-state.yaml'),
      ]);
      await fs.writeFile(
        path.join(otherArchive, '2026-10-19-demo/comet-state.yaml'),
        'workflow: tweak\n',
      );
      await fs.writeFile(
        path.join(otherArchive, '2026-10-19-demo/.comet.yaml'),
        'workflow: tweak\n',
      );
      await expect(inspect()).rejects.toThrow(/state files are ambiguous/u);
    });
  });
});
