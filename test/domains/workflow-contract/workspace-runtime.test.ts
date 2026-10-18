import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileRuntimeStore } from '../../../domains/engine/runtime-store.js';

import {
  assertWorkspaceRuntimeMigrationQuiescent,
  ensureWorkspaceRuntimeMigrationFence,
  isWorkspaceRuntimeMigrationFence,
  isWorkspaceRuntimeMigrationFenceSync,
  migrateWorkspaceRuntimeDirectory,
  migrateWorkspaceRuntimePath,
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../../../domains/workflow-contract/workspace-runtime.js';

let temporary: string;
let project: string;
let data: string;
let legacy: string;

async function write(file: string, value: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workspace-runtime-'));
  project = path.join(temporary, 'project');
  data = path.join(temporary, 'user-data');
  legacy = path.join(project, '.comet', 'runtime');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', data);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('workspace runtime resolution and migration', () => {
  it.runIf(process.platform === 'win32')(
    'reads the same saved run and lock through a Windows case alias',
    async (context) => {
      const alias = path.join(temporary, 'Project');
      try {
        await fs.stat(alias);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          context.skip('当前目录区分大小写，不存在同目录大小写别名');
        throw error;
      }
      const runtime = await resolveWorkspaceRuntimeRoot(project);
      const record = { runId: 'retained', revision: 1, state: { progress: 'saved' } };
      const store = (root: string) => createFileRuntimeStore({ rootDir: path.join(root, 'runs') });
      expect(await store(runtime).compareAndSwap(record.runId, null, record)).toBe(true);
      await write(path.join(runtime, 'saved-run.lock'), 'same execution owner');
      const reopened = await resolveWorkspaceRuntimeRoot(alias);
      expect(reopened).toBe(runtime);
      expect(resolveWorkspaceRuntimeRootSync(alias)).toBe(runtime);
      expect(await store(reopened).read(record.runId)).toEqual(record);
      expect(await fs.readFile(path.join(reopened, 'saved-run.lock'), 'utf8')).toBe(
        'same execution owner',
      );
    },
  );

  it('validates the volume root without attempting mkdir when the root would reject it', async () => {
    const volumeRoot = path.parse(data).root;
    const mkdir = fs.mkdir.bind(fs);
    const create = vi.spyOn(fs, 'mkdir').mockImplementation(async (directory, options) => {
      if (path.resolve(String(directory)) === volumeRoot) {
        throw Object.assign(new Error('EPERM: operation not permitted, mkdir volume root'), {
          code: 'EPERM',
        });
      }
      return mkdir(directory, options);
    });
    const stat = vi.spyOn(fs, 'lstat');
    const runtime = await resolveWorkspaceRuntimeRoot(project);
    expect(runtime).toBe(resolveWorkspaceRuntimeRootSync(project));
    expect((await fs.stat(runtime)).isDirectory()).toBe(true);
    expect(await isWorkspaceRuntimeMigrationFence(legacy, runtime)).toBe(true);
    expect(stat).toHaveBeenCalledWith(volumeRoot);
    expect(
      create.mock.calls.some(([directory]) => path.resolve(String(directory)) === volumeRoot),
    ).toBe(false);
  });

  it.each(['file', 'symlink'] as const)(
    'rejects a nonphysical volume root reported as a %s before creating directories',
    async (kind) => {
      const volumeRoot = path.parse(data).root;
      const rootStat = await fs.lstat(volumeRoot);
      vi.spyOn(rootStat, 'isDirectory').mockReturnValue(kind !== 'file');
      vi.spyOn(rootStat, 'isSymbolicLink').mockReturnValue(kind === 'symlink');
      const lstat = fs.lstat.bind(fs);
      const stat = vi.spyOn(fs, 'lstat').mockImplementation(async (file, options) => {
        if (path.resolve(String(file)) === volumeRoot) return rootStat;
        return lstat(file, options);
      });
      const mkdir = vi.spyOn(fs, 'mkdir');
      await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('必须是真实目录');
      expect(stat).toHaveBeenCalledWith(volumeRoot);
      expect(mkdir).not.toHaveBeenCalled();
    },
  );

  it.each(['ENOENT', 'EACCES', 'EPERM'] as const)(
    'preserves a volume root lstat %s error without attempting mkdir',
    async (code) => {
      const volumeRoot = path.parse(data).root;
      const error = Object.assign(new Error(`${code}: lstat volume root`), {
        code,
        path: volumeRoot,
        syscall: 'lstat',
      });
      const lstat = fs.lstat.bind(fs);
      vi.spyOn(fs, 'lstat').mockImplementation(async (file, options) => {
        if (path.resolve(String(file)) === volumeRoot) throw error;
        return lstat(file, options);
      });
      const mkdir = vi.spyOn(fs, 'mkdir');
      await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toBe(error);
      expect(mkdir).not.toHaveBeenCalled();
    },
  );

  it('checks read-only fence ownership without following a foreign target', async () => {
    const runtime = await resolveWorkspaceRuntimeRoot(project);
    await expect(
      isWorkspaceRuntimeMigrationFence(legacy, `${runtime}-wrong`, {
        projectRoot: project,
        ignoreForeignWorkspaceFence: true,
      }),
    ).rejects.toThrow(/其他路径/u);
    const copied = path.join(temporary, 'copied');
    await fs.mkdir(copied);
    const foreignFence = path.join(copied, 'runtime');
    await fs.copyFile(legacy, foreignFence);
    const before = await fs.readFile(foreignFence, 'utf8');
    await fs.rm(runtime, { recursive: true });
    expect(
      await isWorkspaceRuntimeMigrationFence(
        foreignFence,
        resolveWorkspaceRuntimeRootSync(copied),
        {
          projectRoot: copied,
          ignoreForeignWorkspaceFence: true,
        },
      ),
    ).toBe(true);
    expect(await fs.readFile(foreignFence, 'utf8')).toBe(before);
    await expect(fs.access(runtime)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      isWorkspaceRuntimeMigrationFence(foreignFence, runtime, {
        projectRoot: copied,
      }),
    ).rejects.toThrow(/其他工作区/u);
    expect(
      await isWorkspaceRuntimeMigrationFence(legacy, runtime, {
        projectRoot: project,
      }),
    ).toBe(true);
  });

  it('creates the user-level runtime and its compatibility fence with concurrent initialization', async () => {
    const roots = await Promise.all(
      Array.from({ length: 8 }, () => resolveWorkspaceRuntimeRoot(project)),
    );
    expect(new Set(roots).size).toBe(1);
    expect((await fs.stat(roots[0])).isDirectory()).toBe(true);
    expect(await fs.readdir(project)).toEqual(['.comet']);
    expect(await fs.readdir(path.join(project, '.comet'))).toEqual(['runtime']);
    expect(await isWorkspaceRuntimeMigrationFence(legacy, roots[0])).toBe(true);
    await expect(fs.mkdir(path.join(legacy, 'old-writer'), { recursive: true })).rejects.toThrow();
  });

  it('migrates the entire legacy tree, preserves evidence, and leaves only one fence', async () => {
    await write(
      path.join(legacy, 'sdk-runs', 'native', 'change', 'run.json'),
      '{"status":"waiting"}',
    );
    await write(path.join(legacy, 'native', 'checks', 'evidence.log'), 'checked\n\0complete');
    const target = resolveWorkspaceRuntimeRootSync(project);
    const roots = await Promise.all([
      resolveWorkspaceRuntimeRoot(project),
      resolveWorkspaceRuntimeRoot(project),
    ]);
    expect(roots).toEqual([target, target]);
    expect(await fs.readFile(path.join(target, 'native', 'checks', 'evidence.log'), 'utf8')).toBe(
      'checked\n\0complete',
    );
    expect(
      await fs.readFile(path.join(target, 'sdk-runs', 'native', 'change', 'run.json'), 'utf8'),
    ).toBe('{"status":"waiting"}');
    expect(await isWorkspaceRuntimeMigrationFence(legacy, target)).toBe(true);
    expect(isWorkspaceRuntimeMigrationFenceSync(legacy, target)).toBe(true);
    expect(await fs.readdir(path.dirname(legacy))).toEqual(['runtime']);
    expect(await fs.readdir(path.dirname(target))).toEqual(['runtime']);
    await expect(fs.mkdir(path.join(legacy, 'old-writer'), { recursive: true })).rejects.toThrow();
    expect(await resolveWorkspaceRuntimeRoot(project)).toBe(target);
  });

  it('supports separate files with a directory fence that blocks legacy writes', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const source = path.join(project, 'changes', 'one', '.comet', 'runtime-cache.json');
    const target = path.join(root, 'classic-changes', 'one', 'runtime-cache.json');
    await write(source, '{"result":true}');
    await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
    expect(await fs.readFile(target, 'utf8')).toBe('{"result":true}');
    expect(await isWorkspaceRuntimeMigrationFence(source, target)).toBe(true);
    expect(isWorkspaceRuntimeMigrationFenceSync(source, target)).toBe(true);
    await expect(fs.writeFile(source, 'old writer')).rejects.toThrow();
    await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
  });

  it('copies across filesystem boundaries and only renames within each filesystem', async () => {
    await write(path.join(legacy, 'evidence.bin'), 'portable');
    const rename = fs.rename.bind(fs);
    const calls: Array<[string, string]> = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      calls.push([String(from), String(to)]);
      const side = (file: string) => (file.startsWith(project) ? 'project' : 'home');
      if (side(String(from)) !== side(String(to)))
        throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      await rename(from, to);
    });
    const target = await resolveWorkspaceRuntimeRoot(project);
    expect(await fs.readFile(path.join(target, 'evidence.bin'), 'utf8')).toBe('portable');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([from, to]) => path.dirname(from) === path.dirname(to))).toBe(true);
  });

  it.each([
    'native/locks/root-move.lock',
    'native/check.json.tmp',
    'sdk-runs/one/store.lock.contenders/old.ticket',
  ])('refuses old lock or in-flight writer %s without modifying the source', async (relative) => {
    await write(path.join(legacy, relative), '{}');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow(/锁|未完成/u);
    expect(await fs.readFile(path.join(legacy, relative), 'utf8')).toBe('{}');
    expect(await fs.readdir(path.dirname(legacy))).toEqual(['runtime']);
  });

  it('refuses unfinished transactions and active execution owners', async () => {
    await write(path.join(legacy, 'native', 'transactions', 'move.json'), '{"status":"prepared"}');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('未完成事务');
    await fs.rm(path.join(legacy, 'native', 'transactions'), { recursive: true });
    await write(
      path.join(legacy, 'native', 'execution.json'),
      JSON.stringify({ phase: 'running', owner: { pid: process.pid } }),
    );
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('活跃执行');
  });

  it('keeps completed transaction and execution evidence', async () => {
    await write(path.join(legacy, 'native', 'transactions', 'move.json'), '{"status":"committed"}');
    await write(
      path.join(legacy, 'native', 'execution.json'),
      '{"phase":"completed","owner":{"pid":123}}',
    );
    const root = await resolveWorkspaceRuntimeRoot(project);
    expect(
      await fs.readFile(path.join(root, 'native', 'transactions', 'move.json'), 'utf8'),
    ).toContain('committed');
  });

  it.each(['prepared', 'committed', 'rolled-back'])(
    'checks repeated journal names while preserving %s transaction evidence',
    async (status) => {
      const relative = path.join('native', `prefix-${'journal'.repeat(20)}.json`);
      const content = JSON.stringify({ status });
      await write(path.join(legacy, relative), content);
      if (status === 'prepared') {
        await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('未完成事务');
        expect(await fs.readFile(path.join(legacy, relative), 'utf8')).toBe(content);
      } else {
        const migrated = await resolveWorkspaceRuntimeRoot(project);
        expect(await fs.readFile(path.join(migrated, relative), 'utf8')).toBe(content);
      }
    },
  );

  it('does not interpret journal-like evidence with another suffix as transaction state', async () => {
    const name = `${'journal'.repeat(20)}.json.log`;
    await write(path.join(legacy, name), 'unstructured evidence');
    const migrated = await resolveWorkspaceRuntimeRoot(project);
    expect(await fs.readFile(path.join(migrated, name), 'utf8')).toBe('unstructured evidence');
  });

  it('rejects a symlink inside the source and a symlinked data subtree', async () => {
    await fs.mkdir(legacy, { recursive: true });
    await fs.symlink(temporary, path.join(legacy, 'escape'), 'junction');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow(/符号链接/u);
    await fs.unlink(path.join(legacy, 'escape'));
    await fs.rm(data, { recursive: true });
    await fs.mkdir(data);
    await fs.symlink(temporary, path.join(data, 'workspaces'), 'junction');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow(/真实目录/u);
  });

  it('rejects hardlinks instead of migrating data another path can change', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    await fs.link(path.join(legacy, 'one.log'), path.join(legacy, 'two.log'));
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('硬链接');
  });

  it('never merges an existing target even when its bytes match', async () => {
    const target = resolveWorkspaceRuntimeRootSync(project);
    await write(path.join(legacy, 'one.log'), 'same');
    await write(path.join(target, 'one.log'), 'same');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('拒绝覆盖或合并');
    expect(await fs.readFile(path.join(legacy, 'one.log'), 'utf8')).toBe('same');
    expect(await fs.readFile(path.join(target, 'one.log'), 'utf8')).toBe('same');
  });

  it.each(['afterJournal', 'afterFence', 'afterCopy', 'afterPublish'] as const)(
    'retains recovery records and safely completes on retry after a crash at %s',
    async (hook) => {
      await write(path.join(legacy, 'evidence.log'), 'keep');
      const target = resolveWorkspaceRuntimeRootSync(project);
      await expect(
        migrateWorkspaceRuntimeDirectory(legacy, target, {
          projectRoot: project,
          testHooks: {
            [hook]: () => {
              throw new Error('simulated crash');
            },
          },
        }),
      ).rejects.toThrow('已保留可恢复数据');
      const journalFile = path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json');
      const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
      const preserved = hook === 'afterJournal' ? legacy : journal.backup;
      expect(await fs.readFile(path.join(preserved, 'evidence.log'), 'utf8')).toBe('keep');
      expect(await resolveWorkspaceRuntimeRoot(project)).toBe(target);
      await expect(fs.stat(journalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(path.join(target, 'evidence.log'), 'utf8')).toBe('keep');
      if (hook === 'afterPublish')
        expect(await fs.readFile(path.join(target, 'evidence.log'), 'utf8')).toBe('keep');
    },
  );

  it('detects a writer changing the quarantined source before publication', async () => {
    await write(path.join(legacy, 'evidence.log'), 'initial');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterCopy: async () => {
            const journal = JSON.parse(
              await fs.readFile(
                path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json'),
                'utf8',
              ),
            );
            await fs.writeFile(path.join(journal.backup, 'evidence.log'), 'changed');
          },
        },
      }),
    ).rejects.toThrow('复制后继续变化');
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('isolates a copied foreign fence without following its recorded target', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    await resolveWorkspaceRuntimeRoot(project);
    const clone = path.join(temporary, 'clone');
    await write(path.join(clone, '.comet', 'runtime'), await fs.readFile(legacy, 'utf8'));
    const original = resolveWorkspaceRuntimeRootSync(project);
    const isolated = await resolveWorkspaceRuntimeRoot(clone);
    expect(isolated).not.toBe(original);
    expect(await fs.readdir(isolated)).toEqual([]);
    expect(await fs.readFile(path.join(original, 'one.log'), 'utf8')).toBe('one');
  });

  it('rejects source or destination outside the current workspace runtime', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    await expect(
      migrateWorkspaceRuntimePath(path.join(temporary, 'other'), path.join(root, 'target'), {
        projectRoot: project,
      }),
    ).rejects.toThrow('迁移源必须');
    await expect(
      migrateWorkspaceRuntimePath(path.join(project, 'old'), path.join(temporary, 'other'), {
        projectRoot: project,
      }),
    ).rejects.toThrow('迁移源必须');
  });
  it('accepts a same-workspace fence after moving a change into archive', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const source = path.join(project, 'changes', 'one', 'runtime');
    const target = path.join(root, 'classic-changes', 'one');
    await write(path.join(source, 'evidence.log'), 'one');
    await migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project });
    const archived = path.join(project, 'changes', 'archived-one');
    await fs.rename(path.dirname(source), archived);
    const moved = path.join(archived, 'runtime');
    expect(await isWorkspaceRuntimeMigrationFence(moved, target)).toBe(true);
    await migrateWorkspaceRuntimeDirectory(moved, target, { projectRoot: project });
  });

  it('refuses changing the home root for a fence belonging to this workspace', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    await resolveWorkspaceRuntimeRoot(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'new-home'));
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('工作区或目标无效');
  });

  it('does not treat an old SDK revision as the current active execution', async () => {
    const revisions = path.join(legacy, 'sdk-runs', 'native', 'one');
    await write(
      path.join(revisions, '0000000000000001.json'),
      JSON.stringify({
        runId: 'one',
        revision: 1,
        action: { status: 'running', claim: { pid: 42 } },
      }),
    );
    await write(
      path.join(revisions, '0000000000000002.json'),
      JSON.stringify({ runId: 'one', revision: 2, action: { status: 'completed' } }),
    );
    const root = await resolveWorkspaceRuntimeRoot(project);
    expect(await fs.readdir(path.join(root, 'sdk-runs', 'native', 'one'))).toHaveLength(2);
  });

  it('refuses an invalid latest revision and an incomplete history', async () => {
    const revisions = path.join(legacy, 'sdk-runs', 'native', 'one');
    await write(
      path.join(revisions, '0000000000000002.json'),
      JSON.stringify({ runId: 'one', revision: 2, action: { status: 'completed' } }),
    );
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('版本记录无效或不连续');
  });

  it('preserves completed transaction backups without interpreting them as journals', async () => {
    await write(
      path.join(legacy, 'native', 'transactions', 'one', 'transaction.json'),
      '{"status":"committed"}',
    );
    await write(
      path.join(legacy, 'native', 'transactions', 'one', 'backups', 'state.json'),
      '{"action":{"status":"running"}}',
    );
    const root = await resolveWorkspaceRuntimeRoot(project);
    expect(
      await fs.readFile(
        path.join(root, 'native', 'transactions', 'one', 'backups', 'state.json'),
        'utf8',
      ),
    ).toContain('running');
  });

  it('migrates large ordinary files without attempting to parse them as fences', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const source = path.join(project, 'change', '.comet', 'large-evidence.log');
    const target = path.join(root, 'classic-changes', 'one', 'large-evidence.log');
    const large = 'x'.repeat(2 * 1024 * 1024);
    await write(source, large);
    await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
    expect(await fs.readFile(target, 'utf8')).toBe(large);
  });
  it('migrates through a workspace alias and coalesces alias and physical callers', async () => {
    const alias = path.join(temporary, 'alias');
    await fs.symlink(project, alias, 'junction');
    const source = path.join(project, 'change', 'runtime');
    const target = path.join(await resolveWorkspaceRuntimeRoot(project), 'native', 'one');
    await write(path.join(source, 'one.log'), 'one');
    await Promise.all([
      migrateWorkspaceRuntimeDirectory(path.join(alias, 'change', 'runtime'), target, {
        projectRoot: alias,
      }),
      migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project }),
    ]);
    expect(await fs.readFile(path.join(target, 'one.log'), 'utf8')).toBe('one');
  });

  it('accepts an explicitly contained Git metadata source and rejects its siblings', async () => {
    const sourceRoot = path.join(temporary, 'git-common');
    const source = path.join(sourceRoot, 'comet', 'receipt.json');
    const target = path.join(
      await resolveWorkspaceRuntimeRoot(project),
      'classic-deliveries',
      'receipt.json',
    );
    await write(source, '{"result":"complete"}');
    await migrateWorkspaceRuntimePath(source, target, { projectRoot: project, sourceRoot });
    expect(await fs.readFile(target, 'utf8')).toBe('{"result":"complete"}');
    await expect(
      migrateWorkspaceRuntimePath(path.join(temporary, 'outside'), target, {
        projectRoot: project,
        sourceRoot,
      }),
    ).rejects.toThrow('迁移源必须');
  });

  it('pairs Classic command execution events before migrating any sibling artifact', async () => {
    const source = path.join(project, 'change', '.comet', 'context.md');
    const trajectory = path.join(path.dirname(source), 'trajectory.jsonl');
    const target = path.join(
      await resolveWorkspaceRuntimeRoot(project),
      'classic-changes',
      'one',
      'context.md',
    );
    const action = { id: 'check-1', inputHash: 'hash', attempt: 1, status: 'running' };
    const started = {
      runId: 'one',
      type: 'command_check_started',
      data: { scope: 'verify', action },
    };
    const finished = {
      ...started,
      type: 'command_check_executed',
      data: { ...started.data, action: { ...action, status: 'succeeded' } },
    };
    await write(source, 'context');
    await write(trajectory, JSON.stringify(started) + '\n');
    await expect(
      migrateWorkspaceRuntimePath(source, target, { projectRoot: project }),
    ).rejects.toThrow('尚未记录执行结束');
    const wrong = {
      ...finished,
      data: { ...finished.data, action: { ...finished.data.action, attempt: 2 } },
    };
    await fs.appendFile(trajectory, JSON.stringify(wrong) + '\n');
    await expect(
      migrateWorkspaceRuntimePath(source, target, { projectRoot: project }),
    ).rejects.toThrow('尚未记录执行结束');
    await fs.appendFile(trajectory, JSON.stringify(finished) + '\n');
    await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
    expect(await fs.readFile(target, 'utf8')).toBe('context');
  });

  it('preserves a pending handoff and an unknown action without migration', async () => {
    await write(path.join(legacy, 'native', 'pending-action.json'), '{"type":"handoff"}');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('pending action');
    await fs.rm(path.join(legacy, 'native', 'pending-action.json'));
    await write(path.join(legacy, 'sdk-runs', 'run.json'), '{"action":{"status":"unknown"}}');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('活跃执行');
  });

  it.each([1, 2])(
    'migrates a valid legacy restored checkpoint at physical slot %s',
    async (slot) => {
      const canonical = (value: unknown): string =>
        JSON.stringify(value, (_key, item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(
                Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              )
            : item,
        );
      const checkpoint = {
        runId: 'one',
        revision: 10,
        run: { revision: 10 },
        action: { status: 'running' },
      };
      const wrapped = {
        schema: 'comet.runtime-store-checkpoint.v1',
        record: checkpoint,
        hash: createHash('sha256').update(canonical(checkpoint)).digest('hex'),
      };
      const revisions = path.join(legacy, 'sdk-runs', 'native', 'one');
      if (slot === 2)
        await write(
          path.join(revisions, '0000000000000001.json'),
          JSON.stringify({ ...checkpoint, revision: 1, run: { revision: 1 } }),
        );
      await write(
        path.join(revisions, `${String(slot).padStart(16, '0')}.json`),
        JSON.stringify(wrapped),
      );
      await write(
        path.join(revisions, '0000000000000011.json'),
        JSON.stringify({
          ...checkpoint,
          revision: 11,
          run: { revision: 11 },
          action: { status: 'completed' },
        }),
      );
      const root = await resolveWorkspaceRuntimeRoot(project);
      expect(
        await fs.readFile(
          path.join(root, 'sdk-runs', 'native', 'one', '0000000000000011.json'),
          'utf8',
        ),
      ).toContain('completed');
    },
  );

  it('resumes a migration whose recorded local process has exited', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterCopy: () => {
            throw new Error('crash');
          },
        },
      }),
    ).rejects.toThrow();
    const journalFile = path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json');
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
    journal.pid = 2147483647;
    await fs.writeFile(journalFile, JSON.stringify(journal));
    expect(await resolveWorkspaceRuntimeRoot(project)).toBe(target);
    expect(await fs.readFile(path.join(target, 'one.log'), 'utf8')).toBe('one');
  });

  it('refuses recovery when the old owner belongs to another host', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterFence: () => {
            throw new Error('crash');
          },
        },
      }),
    ).rejects.toThrow();
    const journalFile = path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json');
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
    journal.hostname = 'another-machine';
    await fs.writeFile(journalFile, JSON.stringify(journal));
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('无法确认退出');
    expect(await fs.readFile(path.join(journal.backup, 'one.log'), 'utf8')).toBe('one');
  });

  it('refuses recovery after copied evidence is changed or a conflicting target appears', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterCopy: () => {
            throw new Error('crash');
          },
        },
      }),
    ).rejects.toThrow();
    const journalFile = path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json');
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
    await fs.writeFile(path.join(journal.stage, 'one.log'), 'changed');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('摘要不一致');
    await write(path.join(target, 'external.log'), 'external');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('同时存在');
    expect(await fs.readFile(path.join(journal.backup, 'one.log'), 'utf8')).toBe('one');
    expect(await fs.readFile(path.join(target, 'external.log'), 'utf8')).toBe('external');
  });
  it('rebuilds a proven partial copy from its unchanged backup', async () => {
    await write(path.join(legacy, 'one.log'), 'prefix-complete');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterFence: () => {
            throw new Error('crash');
          },
        },
      }),
    ).rejects.toThrow();
    const journal = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json'),
        'utf8',
      ),
    );
    await write(path.join(journal.stage, 'one.log'), 'prefix');
    expect(await resolveWorkspaceRuntimeRoot(project)).toBe(target);
    expect(await fs.readFile(path.join(target, 'one.log'), 'utf8')).toBe('prefix-complete');
  });

  it('keeps unknown files in a partial stage and fails closed', async () => {
    await write(path.join(legacy, 'one.log'), 'one');
    const target = resolveWorkspaceRuntimeRootSync(project);
    await expect(
      migrateWorkspaceRuntimeDirectory(legacy, target, {
        projectRoot: project,
        testHooks: {
          afterFence: () => {
            throw new Error('crash');
          },
        },
      }),
    ).rejects.toThrow();
    const journal = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(legacy), '.runtime.comet-runtime-migration.json'),
        'utf8',
      ),
    );
    await write(path.join(journal.stage, 'new.log'), 'unique');
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('拒绝删除');
    expect(await fs.readFile(path.join(journal.stage, 'new.log'), 'utf8')).toBe('unique');
    expect(await fs.readFile(path.join(journal.backup, 'one.log'), 'utf8')).toBe('one');
  });
  it('checks old locks and migration journals without creating directories', async () => {
    const change = path.join(project, 'change');
    const source = path.join(change, '.comet');
    await write(path.join(change, '.comet-state.lock'), '{}');
    await expect(
      assertWorkspaceRuntimeMigrationQuiescent(source, { projectRoot: project }),
    ).rejects.toThrow('锁');
    await expect(fs.stat(data)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(path.join(change, '.comet-state.lock'));
    await write(path.join(source, '.runtime.comet-runtime-migration.json'), '{}');
    await expect(
      assertWorkspaceRuntimeMigrationQuiescent(source, { projectRoot: project }),
    ).rejects.toThrow('未完成');
    expect(await fs.readdir(path.join(project))).toEqual(['change']);
  });
  it('recreates a lost current-workspace runtime for portable checkpoint recovery', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    await write(path.join(root, 'native', 'local.json'), '{"status":"waiting"}');
    const fence = await fs.readFile(legacy, 'utf8');
    await fs.rm(root, { recursive: true });
    expect(await resolveWorkspaceRuntimeRoot(project)).toBe(root);
    expect(await fs.readdir(root)).toEqual([]);
    expect(await fs.readFile(legacy, 'utf8')).toBe(fence);
  });

  it('does not recreate a lost runtime when its fence points to a different target', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    await fs.rm(root, { recursive: true });
    const fence = JSON.parse(await fs.readFile(legacy, 'utf8'));
    fence.target = path.join(temporary, 'unexpected-target');
    await fs.writeFile(legacy, JSON.stringify(fence));
    await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow('工作区或目标无效');
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('allows portable recovery after a migrated Native change runtime is lost', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const source = path.join(project, 'changes', 'one', 'runtime');
    const target = path.join(root, 'native', 'changes', 'one');
    await write(path.join(source, 'run-state.json'), '{"status":"waiting"}');
    await migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project });
    const fence = await fs.readFile(source, 'utf8');
    await fs.rm(root, { recursive: true });
    await resolveWorkspaceRuntimeRoot(project);
    await migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(source, 'utf8')).toBe(fence);
  });

  it('leaves lost Classic run-state and checkpoint files absent for portable recovery', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const entries = ['run-state.json', 'checkpoint.json'].map((name) => ({
      source: path.join(project, 'changes', 'one', '.comet', name),
      target: path.join(root, 'classic-changes', 'one', '.comet', name),
    }));
    for (const { source, target } of entries) {
      await write(source, '{"status":"waiting"}');
      await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
    }
    await fs.rm(root, { recursive: true });
    await resolveWorkspaceRuntimeRoot(project);
    for (const { source, target } of entries) {
      await migrateWorkspaceRuntimePath(source, target, { projectRoot: project });
      expect(await isWorkspaceRuntimeMigrationFence(source, target)).toBe(true);
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('still rejects a changed per-record fence target after local data loss', async () => {
    const root = await resolveWorkspaceRuntimeRoot(project);
    const source = path.join(project, 'changes', 'one', 'runtime');
    const target = path.join(root, 'native', 'one');
    await write(path.join(source, 'state.json'), '{"status":"waiting"}');
    await migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project });
    await fs.rm(root, { recursive: true });
    await resolveWorkspaceRuntimeRoot(project);
    const fence = JSON.parse(await fs.readFile(source, 'utf8'));
    fence.target = path.join(root, 'native', 'other');
    await fs.writeFile(source, JSON.stringify(fence));
    await expect(
      migrateWorkspaceRuntimeDirectory(source, target, { projectRoot: project }),
    ).rejects.toThrow('工作区或目标无效');
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('seals a missing legacy file lock without creating a home lock', async () => {
    const source = path.join(project, 'change', '.comet-state.lock');
    await fs.mkdir(path.dirname(source));
    const target = path.join(resolveWorkspaceRuntimeRootSync(project), 'classic-legacy-state.lock');
    await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project }),
      ),
    );
    expect(await isWorkspaceRuntimeMigrationFence(source, target)).toBe(true);
    expect(await fs.readdir(source)).toEqual(['.comet-runtime-migration.json']);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.open(source, 'wx')).rejects.toThrow();
    await assertWorkspaceRuntimeMigrationQuiescent(path.join(project, 'change', '.comet'), {
      projectRoot: project,
    });
  });

  it('never replaces an existing legacy lock or an unknown directory while sealing', async () => {
    const source = path.join(project, 'change', '.comet-state.lock');
    const target = path.join(resolveWorkspaceRuntimeRootSync(project), 'classic-legacy-state.lock');
    await write(source, JSON.stringify({ pid: process.pid }));
    await expect(
      ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project }),
    ).rejects.toThrow('拒绝覆盖');
    expect(await fs.readFile(source, 'utf8')).toContain(String(process.pid));
    await fs.rm(source);
    await write(path.join(source, 'unknown.json'), 'keep');
    await expect(
      ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project }),
    ).rejects.toThrow('拒绝覆盖');
    expect(await fs.readFile(path.join(source, 'unknown.json'), 'utf8')).toBe('keep');
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a sealed legacy lock valid across archive moves while rejecting target drift', async () => {
    const source = path.join(project, 'change', '.comet-state.lock');
    const target = path.join(resolveWorkspaceRuntimeRootSync(project), 'classic-legacy-state.lock');
    await fs.mkdir(path.dirname(source));
    await ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project });
    const archived = path.join(project, 'archived-change');
    await fs.rename(path.dirname(source), archived);
    const moved = path.join(archived, '.comet-state.lock');
    await ensureWorkspaceRuntimeMigrationFence(moved, target, { projectRoot: project });
    await expect(
      ensureWorkspaceRuntimeMigrationFence(moved, `${target}.different`, { projectRoot: project }),
    ).rejects.toThrow('其他工作区或目标');
    await assertWorkspaceRuntimeMigrationQuiescent(moved, { projectRoot: project });
  });

  it('only accepts a copied legacy lock fence with explicit foreign-workspace permission', async () => {
    const source = path.join(project, 'change', '.comet-state.lock');
    const target = path.join(resolveWorkspaceRuntimeRootSync(project), 'classic-legacy-state.lock');
    await fs.mkdir(path.dirname(source));
    await ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project });
    const clone = path.join(temporary, 'clone');
    const copied = path.join(clone, 'change', '.comet-state.lock');
    await fs.mkdir(path.dirname(copied), { recursive: true });
    await fs.cp(source, copied, { recursive: true });
    const isolated = path.join(resolveWorkspaceRuntimeRootSync(clone), 'classic-legacy-state.lock');
    await expect(
      ensureWorkspaceRuntimeMigrationFence(copied, isolated, { projectRoot: clone }),
    ).rejects.toThrow('其他工作区或目标');
    await ensureWorkspaceRuntimeMigrationFence(copied, isolated, {
      projectRoot: clone,
      ignoreForeignWorkspaceFence: true,
    });
    await expect(fs.stat(isolated)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not leave a half fence when interrupted after staging mkdir', async () => {
    const source = path.join(project, 'change', '.comet-state.lock');
    const target = path.join(resolveWorkspaceRuntimeRootSync(project), 'classic-legacy-state.lock');
    await fs.mkdir(path.dirname(source));
    let staging: string | undefined;
    await expect(
      ensureWorkspaceRuntimeMigrationFence(source, target, {
        projectRoot: project,
        testHooks: {
          afterStagingDirectory: (directory) => {
            staging = directory;
            throw new Error('interrupted after mkdir');
          },
        },
      }),
    ).rejects.toThrow('interrupted after mkdir');
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    // 模拟进程直接退出时未执行 finally 遗留的空 staging，重试也不能被阻断。
    await fs.mkdir(staging!);
    await ensureWorkspaceRuntimeMigrationFence(source, target, { projectRoot: project });
    expect(await isWorkspaceRuntimeMigrationFence(source, target)).toBe(true);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['file', 'directory'] as const)(
    'does not replace a legacy %s appearing before fence publication',
    async (kind) => {
      const source = path.join(project, 'change', '.comet-state.lock');
      const target = path.join(
        resolveWorkspaceRuntimeRootSync(project),
        'classic-legacy-state.lock',
      );
      await fs.mkdir(path.dirname(source));
      await expect(
        ensureWorkspaceRuntimeMigrationFence(source, target, {
          projectRoot: project,
          testHooks: {
            beforePublish: async () => {
              if (kind === 'directory') await fs.mkdir(source);
              else await fs.writeFile(source, 'legacy owner');
            },
          },
        }),
      ).rejects.toThrow('拒绝覆盖');
      expect((await fs.stat(source)).isDirectory()).toBe(kind === 'directory');
      if (kind === 'file') expect(await fs.readFile(source, 'utf8')).toBe('legacy owner');
      else expect(await fs.readdir(source)).toEqual([]);
      expect(await fs.readdir(path.dirname(source))).toEqual(['.comet-state.lock']);
    },
  );
  it('keeps non-Git runtime evidence isolated after git init without following its old fence', async () => {
    const oldRoot = await resolveWorkspaceRuntimeRoot(project);
    await write(
      path.join(oldRoot, 'native', 'execution.json'),
      '{"status":"running","owner":{"pid":123}}',
    );
    const previousFence = await fs.readFile(legacy, 'utf8');
    execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
    const newRoot = await resolveWorkspaceRuntimeRoot(project);
    expect(newRoot).not.toBe(oldRoot);
    expect(await fs.readdir(newRoot)).toEqual([]);
    expect(await fs.readFile(path.join(oldRoot, 'native', 'execution.json'), 'utf8')).toContain(
      'running',
    );
    expect(await fs.readFile(legacy, 'utf8')).toBe(previousFence);
  });
});
