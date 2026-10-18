import * as nativeCollector from '../../../domains/dashboard/native-collector.js';
import { writeClassicProjectText } from '../../../domains/comet-classic/classic-protected-path.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { snapshotCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import {
  collectDashboardChangeDetail,
  collectDashboardChangePage,
  collectDashboardChangeSummary,
  collectDashboardOverview,
  collectDashboardSnapshot,
} from '../../../domains/dashboard/collector.js';

interface ChangeFixture {
  name: string;
  yaml?: Record<string, string>;
  stateFileName?: 'comet-state.yaml' | '.comet.yaml';
  tasks?: string;
  proposal?: boolean;
  design?: boolean;
  plan?: boolean;
  verifyReport?: string | null; // body or null to skip the file
  status?: 'active' | 'archived';
  changesPath?: 'openspec/changes' | 'docs/openspec/changes';
}

async function writeChange(root: string, fixture: ChangeFixture): Promise<void> {
  const status = fixture.status ?? 'active';
  const changesPath = fixture.changesPath ?? 'openspec/changes';
  const baseDir =
    status === 'archived'
      ? path.join(root, ...changesPath.split('/'), 'archive', fixture.name)
      : path.join(root, ...changesPath.split('/'), fixture.name);
  await fs.mkdir(baseDir, { recursive: true });

  if (fixture.yaml) {
    const lines = Object.entries(fixture.yaml).map(([k, v]) => `${k}: ${v}`);
    await fs.writeFile(
      path.join(baseDir, fixture.stateFileName ?? '.comet.yaml'),
      `${lines.join('\n')}\n`,
    );
  }
  if (fixture.tasks !== undefined) {
    await fs.writeFile(path.join(baseDir, 'tasks.md'), fixture.tasks);
  }
  if (fixture.proposal) {
    await fs.writeFile(path.join(baseDir, 'proposal.md'), '# Proposal\n');
  }
  if (fixture.design) {
    await fs.writeFile(path.join(baseDir, 'design.md'), '# Design\n');
  }
  if (fixture.plan) {
    await fs.writeFile(path.join(baseDir, 'plan.md'), '# Plan\n');
  }
  if (fixture.verifyReport != null) {
    const reportDir = path.join(baseDir, '.comet');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, 'verify-result.md'), fixture.verifyReport);
  }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  }).trim();
}

describe('collectDashboardSnapshot', () => {
  let root: string;
  let cacheRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-collector-'));
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-collector-home-'));
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CACHE_HOME'])
      vi.stubEnv(key, cacheRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(cacheRoot, { recursive: true, force: true });
  });

  it('reads complete Classic summary once beyond page limits and checks external edits', async () => {
    await Promise.all(
      Array.from({ length: 70 }, (_, index) =>
        writeChange(root, {
          name: `change-${String(index).padStart(3, '0')}`,
          tasks: '- [ ] Work\n',
          yaml: { phase: 'build', workflow: 'full' },
        }),
      ),
    );
    await writeChange(root, { name: '2026-01-01-old', status: 'archived' });
    const summary = await collectDashboardChangeSummary(root);
    expect(summary.total).toBe(70);
    expect(summary.items).toHaveLength(70);
    expect(summary.nextCursor).toBeNull();
    const expanded = await collectDashboardChangeSummary(root, { limit: 60 });
    expect(expanded.items).toHaveLength(60);
    const tail = await collectDashboardChangePage(root, {
      status: 'active',
      cursor: expanded.nextCursor!,
      limit: 50,
    });
    expect([...expanded.items, ...tail.items].map((item) => item.id)).toEqual(
      summary.items.map((item) => item.id),
    );
    const filtered = await collectDashboardChangeSummary(root, {
      status: 'all',
      query: 'change-06',
    });
    expect(filtered.total).toBe(10);
    const page = await collectDashboardChangePage(root, { status: 'active', limit: 50 });
    const second = await collectDashboardChangePage(root, {
      status: 'active',
      limit: 50,
      cursor: page.nextCursor!,
    });
    expect(summary.items.map((item) => item.id)).toEqual(
      [...page.items, ...second.items].map((item) => item.id),
    );
    await fs.writeFile(path.join(root, 'openspec/changes/change-000/tasks.md'), '- [x] Work\n');
    await fs.rm(path.join(root, 'openspec/changes/change-001'), { recursive: true });
    const refreshed = await collectDashboardChangeSummary(root);
    expect(refreshed.total).toBe(69);
    expect(refreshed.items.find((item) => item.name === 'change-000')?.tasks.completed).toBe(1);
    expect(refreshed.items.some((item) => item.name === 'change-001')).toBe(false);
  });

  it('bounds selected Classic detail path inspection independently of overview', async () => {
    await writeChange(root, {
      name: 'selected',
      yaml: { phase: 'build', workflow: 'full' },
      tasks: '- [ ] Work\n',
      proposal: true,
      design: true,
      plan: true,
    });
    const lstat = vi.spyOn(fs, 'lstat');
    const realpath = vi.spyOn(fs, 'realpath');
    try {
      const detail = await collectDashboardChangeDetail(root, 'openspec/changes/selected');
      expect(detail?.name).toBe('selected');
      console.info(
        'Classic selected detail path calls',
        lstat.mock.calls.length,
        realpath.mock.calls.length,
      );
      expect(lstat.mock.calls.length + realpath.mock.calls.length).toBeLessThan(250);
    } finally {
      lstat.mockRestore();
      realpath.mockRestore();
    }
  });

  it('reuses worktree discovery for consecutive detail reads and observes branch changes', async () => {
    git(root, ['init', '-q']);
    git(root, ['remote', 'add', 'origin', 'https://example.invalid/detail-performance.git']);
    await writeChange(root, { name: 'selected', yaml: { phase: 'build' } });
    await collectDashboardChangeDetail(root, 'openspec/changes/selected');
    const before = snapshotCometRuntimeMetrics().gitCommands;
    expect((await collectDashboardChangeDetail(root, 'openspec/changes/selected'))?.name).toBe(
      'selected',
    );
    expect(snapshotCometRuntimeMetrics().gitCommands - before).toBeLessThanOrEqual(1);
    git(root, ['symbolic-ref', 'HEAD', 'refs/heads/renamed']);
    expect(
      (await collectDashboardChangeDetail(root, 'openspec/changes/selected'))?.workspace.branch,
    ).toBe('renamed');
  });

  it('bounds overview path inspection across linked worktrees and archived changes', async () => {
    git(root, ['init', '-q']);
    git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-qm',
      'seed',
    ]);
    const workspaces = [root];
    for (let index = 1; index < 6; index += 1) {
      const worktree = path.join(root, '.worktrees', `workspace-${index}`);
      git(root, ['worktree', 'add', '-qb', `dashboard-${index}`, worktree]);
      workspaces.push(worktree);
    }
    for (const [workspaceIndex, workspace] of workspaces.entries()) {
      for (let index = 0; index < 24; index += 1) {
        await writeChange(workspace, {
          name:
            index < 4
              ? `active-${workspaceIndex}-${index}`
              : `2026-10-15-archived-${workspaceIndex}-${index}`,
          status: index < 4 ? 'active' : 'archived',
          yaml: { phase: index < 4 ? 'build' : 'archive', workflow: 'full' },
          tasks: '- [ ] Task\n',
          proposal: true,
          design: true,
          plan: true,
        });
      }
    }
    const lstat = vi.spyOn(fs, 'lstat');
    const realpath = vi.spyOn(fs, 'realpath');
    try {
      const overview = await collectDashboardOverview(root);
      expect(overview.summary).toMatchObject({ activeChanges: 24, archivedChanges: 120 });
      const calls = { lstat: lstat.mock.calls.length, realpath: realpath.mock.calls.length };
      console.info('Dashboard overview filesystem calls', calls);
      // 活跃与归档摘要均须校验可变依赖。
      expect(calls.lstat + calls.realpath).toBeLessThan(10000);
      lstat.mockClear();
      realpath.mockClear();
      await collectDashboardOverview(root);
      const warm = { lstat: lstat.mock.calls.length, realpath: realpath.mock.calls.length };
      console.info('Unchanged Dashboard overview filesystem calls', warm);
      expect(warm.lstat + warm.realpath).toBeLessThan(1500);
      // 归档也检查元数据，避免遗漏文件原地修改。
      expect(lstat.mock.calls.some(([file]) => String(file).includes('archived-'))).toBe(true);
    } finally {
      lstat.mockRestore();
      realpath.mockRestore();
    }
  });

  it('counts shared large task candidates once and still invalidates changed task files', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeChange(root, {
        name: `large-${index}`,
        yaml: { workflow: 'comet', phase: 'build' },
        tasks: '- [ ] ' + 'x'.repeat(1_900_000) + '\n',
      });
    }
    const open = vi.spyOn(fs, 'open');
    const taskReads = () =>
      open.mock.calls.filter(([file]) => String(file).endsWith('tasks.md')).length;
    try {
      const cold = await collectDashboardChangePage(root, { status: 'active', limit: 50 });
      expect(cold.total).toBe(5);
      expect(taskReads()).toBe(5);
      open.mockClear();
      const warm = await collectDashboardChangePage(root, { status: 'active', limit: 50 });
      expect(warm).toEqual(cold);
      expect(taskReads()).toBe(0);
      await fs.writeFile(path.join(root, 'openspec/changes/large-0/tasks.md'), '- [x] complete\n');
      open.mockClear();
      const updated = await collectDashboardChangePage(root, { status: 'active', limit: 50 });
      expect(taskReads()).toBe(1);
      expect(updated.items.find((item) => item.name === 'large-0')?.tasks.completed).toBe(1);
    } finally {
      open.mockRestore();
    }
  });

  it('retains the unique-content cache size limit without truncating large tasks', async () => {
    for (let index = 0; index < 9; index += 1) {
      await writeChange(root, {
        name: `over-budget-${index}`,
        yaml: { workflow: 'comet', phase: 'build' },
        tasks: '- [ ] ' + 'x'.repeat(1_900_000) + '\n',
      });
    }
    const open = vi.spyOn(fs, 'open');
    try {
      for (let round = 0; round < 2; round += 1) {
        open.mockClear();
        const page = await collectDashboardChangePage(root, { status: 'active', limit: 50 });
        expect(page.total).toBe(9);
        expect(page.items.every((item) => item.tasks.total === 1)).toBe(true);
        expect(open.mock.calls.filter(([file]) => String(file).endsWith('tasks.md'))).toHaveLength(
          9,
        );
      }
    } finally {
      open.mockRestore();
    }
  });

  it('refreshes cached Classic summaries after active files and external report changes', async () => {
    await writeChange(root, {
      name: 'cached',
      yaml: { phase: 'build', verification_report: 'reports/result.md' },
      tasks: '- [ ] Work\n',
    });
    expect((await collectDashboardOverview(root)).summary.tasksIncomplete).toBe(1);
    const dir = path.join(root, 'openspec/changes/cached');
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [x] Work\n');
    expect((await collectDashboardOverview(root)).summary.tasksIncomplete).toBe(0);
    await fs.mkdir(path.join(root, 'reports'));
    await fs.writeFile(path.join(root, 'reports/result.md'), '# Failed check\n');
    expect((await collectDashboardOverview(root)).summary.verifyFailed).toBe(1);
    await fs.rm(path.join(root, 'reports/result.md'));
    expect((await collectDashboardOverview(root)).summary.verifyFailed).toBe(0);
    await fs.writeFile(path.join(dir, '.comet.yaml'), 'phase: verify\n');
    expect((await collectDashboardOverview(root)).initialChanges.items[0].phase).toBe('verify');
  });

  it('rereads only changed active or archived summaries and discovers additions and removals', async () => {
    await writeChange(root, { name: 'one', yaml: { phase: 'build' }, tasks: '- [ ] Work\n' });
    await writeChange(root, { name: 'two', yaml: { phase: 'build' }, tasks: '- [ ] Work\n' });
    await writeChange(root, {
      name: '2026-10-15-old',
      status: 'archived',
      yaml: { phase: 'archive' },
      tasks: '- [ ] Work\n',
    });
    await collectDashboardOverview(root);
    const open = vi.spyOn(fs, 'open');
    try {
      await fs.writeFile(path.join(root, 'openspec/changes/one/tasks.md'), '- [x] Work\n');
      expect((await collectDashboardOverview(root)).summary.tasksIncomplete).toBe(1);
      const reads = open.mock.calls.map(([file]) => String(file));
      expect(reads.some((file) => file.includes('/one/'))).toBe(true);
      expect(reads.some((file) => file.includes('/two/') || file.includes('/archive/'))).toBe(
        false,
      );
      open.mockClear();
      await fs.writeFile(
        path.join(root, 'openspec/changes/archive/2026-10-15-old/tasks.md'),
        '- [x] Work\n',
      );
      const page = await collectDashboardChangePage(root, { status: 'archived' });
      expect(page.items[0].tasks.completed).toBe(1);
      expect(
        open.mock.calls.some(
          ([file]) => String(file).includes('/one/') || String(file).includes('/two/'),
        ),
      ).toBe(false);
      await writeChange(root, {
        name: '2026-10-16-new',
        status: 'archived',
        yaml: { phase: 'archive' },
      });
      expect((await collectDashboardOverview(root)).summary.archivedChanges).toBe(2);
      await fs.rm(path.join(root, 'openspec/changes/archive/2026-10-15-old'), { recursive: true });
      expect((await collectDashboardOverview(root)).summary.archivedChanges).toBe(1);
    } finally {
      open.mockRestore();
    }
  });

  it('rejects a change directory replaced by a junction after a cached overview', async () => {
    await writeChange(root, { name: 'cached', yaml: { phase: 'build' } });
    expect((await collectDashboardOverview(root)).summary.activeChanges).toBe(1);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-cache-outside-'));
    try {
      await fs.writeFile(path.join(outside, '.comet.yaml'), 'phase: verify\nworkflow: secret\n');
      const dir = path.join(root, 'openspec/changes/cached');
      await fs.rename(dir, path.join(root, 'retained-change'));
      await fs.symlink(outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
      const overview = await collectDashboardOverview(root);
      expect(overview.summary.activeChanges).toBe(0);
      expect(JSON.stringify(overview)).not.toContain('secret');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('invalidates archived summaries when a cached report becomes a symlink', async () => {
    await writeChange(root, {
      name: '2026-10-15-guarded',
      status: 'archived',
      yaml: { phase: 'archive', verification_report: 'reports/result.md' },
    });
    const report = path.join(root, 'reports/result.md');
    await fs.mkdir(path.dirname(report), { recursive: true });
    await fs.writeFile(report, '# Verification failed\n');
    const page = () => collectDashboardChangePage(root, { status: 'archived' });
    expect((await page()).items[0].verify.result).toBe('fail');
    await fs.rm(report);
    await fs.symlink(
      path.join(root, 'openspec/changes/archive/2026-10-15-guarded/.comet.yaml'),
      report,
    );
    expect((await page()).items[0].verify.result).toBe('unknown');
    await fs.rm(report);
    await fs.writeFile(report, '# Repaired\n');
    expect((await page()).items[0].verify.result).toBe('fail');
  });

  it('shows Classic checkpoint and progress from user Runtime without recreating project records', async () => {
    await writeChange(root, {
      name: 'local-runtime-preview',
      yaml: { phase: 'build', workflow: 'classic' },
    });
    const change = path.join(root, 'openspec/changes/local-runtime-preview');
    const checkpoint = path.join(change, '.comet/checkpoint.json');
    const progress = path.join(change, '.comet/subagent-progress.md');
    await writeClassicProjectText(root, checkpoint, '{"summary":"retained checkpoint"}\n', {
      label: 'test checkpoint',
    });
    await writeClassicProjectText(root, progress, '# Child progress\nStill working.\n', {
      label: 'test progress',
    });
    await expect(fs.access(checkpoint)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(progress)).rejects.toMatchObject({ code: 'ENOENT' });
    const detail = await collectDashboardChangeDetail(
      root,
      'openspec/changes/local-runtime-preview',
    );
    const previews = detail.artifactPreviews!;
    expect(previews.find((item) => item.key === 'checkpoint')).toMatchObject({
      exists: true,
      content: '{"summary":"retained checkpoint"}\n',
    });
    expect(previews.find((item) => item.key === 'subagentProgress')).toMatchObject({
      exists: true,
      content: '# Child progress\nStill working.\n',
    });
  });

  it.each([
    ['comet-state.yaml', 'openspec/changes'],
    ['.comet.yaml', 'openspec/changes'],
    ['comet-state.yaml', 'docs/openspec/changes'],
    ['.comet.yaml', 'docs/openspec/changes'],
  ] as const)(
    'reads %s in %s across Classic dashboard views',
    async (stateFileName, changesPath) => {
      await writeChange(root, {
        name: 'active-state',
        stateFileName,
        changesPath,
        yaml: { phase: 'build', workflow: 'full' },
      });
      await writeChange(root, {
        name: '2026-10-11-archived-state',
        stateFileName,
        changesPath,
        status: 'archived',
        yaml: { phase: 'archive', workflow: 'full', archived: 'true' },
      });
      const snapshot = await collectDashboardSnapshot(root);
      expect(snapshot.classicError).toBeUndefined();
      expect(snapshot.changes.active[0]).toMatchObject({
        name: 'active-state',
        phase: 'build',
        artifacts: { cometYaml: true },
      });
      expect(snapshot.changes.archived[0].artifacts.cometYaml).toBe(true);
      const overview = await collectDashboardOverview(root);
      expect(overview.classicError).toBeUndefined();
      expect(overview.summary).toMatchObject({ activeChanges: 1, archivedChanges: 1 });
      const page = await collectDashboardChangePage(root, { status: 'all' });
      expect(page.total).toBe(2);
      const detail = await collectDashboardChangeDetail(root, `${changesPath}/active-state`);
      expect(detail?.artifacts.grouped).toContainEqual(
        expect.objectContaining({
          key: 'cometYaml',
          label: stateFileName,
          path: path.join(root, ...changesPath.split('/'), 'active-state', stateFileName),
          exists: true,
        }),
      );
    },
  );

  it.each(['file', 'dangling-symlink'] as const)(
    'surfaces conflicting Classic state names including a %s without writes',
    async (legacyKind) => {
      await writeChange(root, {
        name: 'healthy',
        yaml: { phase: 'build' },
        stateFileName: 'comet-state.yaml',
      });
      await writeChange(root, {
        name: 'conflict',
        yaml: { phase: 'build' },
        stateFileName: 'comet-state.yaml',
      });
      const changeDir = path.join(root, 'openspec/changes/conflict');
      const legacyPath = path.join(changeDir, '.comet.yaml');
      if (legacyKind === 'file') {
        await fs.writeFile(legacyPath, 'phase: verify\n');
      } else {
        try {
          await fs.symlink('missing-state.yaml', legacyPath, 'file');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }
      }
      const before = await fs.readFile(path.join(changeDir, 'comet-state.yaml'));
      // 隔离 Native 的独立索引缓存，只观察 Classic 收集与状态文件的读写。
      const nativeReads = [
        vi.spyOn(nativeCollector, 'collectNativeDashboardProjection').mockResolvedValue(null),
        vi.spyOn(nativeCollector, 'collectNativeDashboardOverview').mockResolvedValue(null),
      ];
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const writes = [
        vi.spyOn(fs, 'mkdir'),
        vi.spyOn(fs, 'writeFile'),
        vi.spyOn(fs, 'rename'),
        vi.spyOn(fs, 'unlink'),
      ];
      try {
        const snapshot = await collectDashboardSnapshot(root);
        expect(snapshot.changes.active.map((change) => change.name)).toEqual(['healthy']);
        expect(snapshot.classicError?.message).toMatch(/comet-state\.yaml.*\.comet\.yaml/u);
        const overview = await collectDashboardOverview(root);
        expect(overview.initialChanges.items.map((change) => change.name)).toEqual(['healthy']);
        expect(overview.classicError?.message).toMatch(/comet-state\.yaml.*\.comet\.yaml/u);
        await expect(collectDashboardChangePage(root, { status: 'active' })).rejects.toThrow(
          /comet-state\.yaml.*\.comet\.yaml/u,
        );
        await expect(
          collectDashboardChangeDetail(root, 'openspec/changes/conflict'),
        ).rejects.toThrow(/comet-state\.yaml.*\.comet\.yaml/u);
        for (const write of writes) expect(write).not.toHaveBeenCalled();
        expect(await fs.readFile(path.join(changeDir, 'comet-state.yaml'))).toEqual(before);
        if (legacyKind === 'file') {
          expect(await fs.readFile(legacyPath, 'utf8')).toBe('phase: verify\n');
        } else {
          expect(await fs.readlink(legacyPath)).toBe('missing-state.yaml');
        }
      } finally {
        warn.mockRestore();
        for (const write of writes) write.mockRestore();
        for (const read of nativeReads) read.mockRestore();
      }
    },
  );

  it('treats missing Classic roots as an empty state without configuration', async () => {
    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active).toEqual([]);
    expect(snap.changes.archived).toEqual([]);
    expect(snap.summary.activeChanges).toBe(0);
    expect(snap.summary.archivedChanges).toBe(0);
    expect(snap.classicError).toBeUndefined();
  });

  it('collects Classic changes for a Native-only project', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeChange(root, {
      name: 'classic-discovered-alongside-native',
      yaml: { phase: 'build', workflow: 'classic' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual([
      'classic-discovered-alongside-native',
    ]);
    expect(snap.changes.archived).toEqual([]);
    expect(snap.classicError).toBeUndefined();
  });

  it('collects Classic changes from the configured docs layout', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
    );
    const changeDir = path.join(root, 'docs', 'openspec', 'changes', 'docs-layout');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      ['phase: build', 'workflow: hotfix', 'archived: false', ''].join('\n'),
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] todo\n');

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['docs-layout']);
    expect(snap.changes.active[0].path).toBe(changeDir);
    expect(snap.changes.active[0].relativePath).toBe('docs/openspec/changes/docs-layout');
    expect(snap.classicError).toBeUndefined();
  });

  it('lists and opens independent same-name Classic changes from linked worktrees', async () => {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'comet@test.local']);
    git(root, ['config', 'user.name', 'Comet Test']);
    await fs.writeFile(path.join(root, 'README.md'), '# Dashboard worktrees\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'test: seed worktrees']);
    const worktreeA = path.join(root, '.worktrees', 'classic-a');
    const worktreeB = path.join(root, '.worktrees', 'classic-b');
    git(root, ['worktree', 'add', '-q', '-b', 'classic/a', worktreeA]);
    git(root, ['worktree', 'add', '-q', '-b', 'classic/b', worktreeB]);

    await writeChange(worktreeA, {
      name: 'independent-change',
      yaml: {
        phase: 'build',
        workflow: 'classic',
        isolation: 'worktree',
        bound_branch: 'classic/a',
      },
      proposal: true,
    });
    await fs.writeFile(
      path.join(worktreeA, 'openspec', 'changes', 'independent-change', 'proposal.md'),
      '# Proposal A\n',
    );
    await writeChange(worktreeB, {
      name: 'independent-change',
      yaml: {
        phase: 'verify',
        workflow: 'classic',
        isolation: 'worktree',
        bound_branch: 'classic/b',
      },
      proposal: true,
    });
    await fs.writeFile(
      path.join(worktreeB, 'openspec', 'changes', 'independent-change', 'proposal.md'),
      '# Proposal B\n',
    );

    const page = await collectDashboardChangePage(root, { status: 'active', limit: 5 });
    const items = page.items
      .slice()
      .sort((left, right) => left.workspace.label.localeCompare(right.workspace.label));
    expect(page.total).toBe(2);
    expect(items.map(({ name }) => name)).toEqual(['independent-change', 'independent-change']);
    expect(items.map(({ workspace }) => workspace.label)).toEqual(['classic/a', 'classic/b']);
    expect(new Set(items.map(({ locator }) => locator)).size).toBe(2);

    const details = await Promise.all(
      items.map(({ locator }) => collectDashboardChangeDetail(root, locator)),
    );
    expect(details.map((detail) => detail?.workspace.label)).toEqual(['classic/a', 'classic/b']);
    expect(details.map((detail) => detail?.phase)).toEqual(['build', 'verify']);
    expect(
      details.map(
        (detail) => detail?.artifactPreviews.find(({ key }) => key === 'proposal')?.content,
      ),
    ).toEqual(['# Proposal A\n', '# Proposal B\n']);
  });

  it('deduplicates an inherited Classic artifact in favor of its bound branch', async () => {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'comet@test.local']);
    git(root, ['config', 'user.name', 'Comet Test']);
    await writeChange(root, {
      name: 'bound-owner',
      yaml: {
        phase: 'build',
        workflow: 'classic',
        isolation: 'branch',
        bound_branch: 'main',
      },
    });
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'test: commit bound Classic change']);
    const secondary = path.join(root, '.worktrees', 'classic-copy');
    git(root, ['worktree', 'add', '-q', '-b', 'classic/copy', secondary]);

    const page = await collectDashboardChangePage(secondary, { status: 'active', limit: 5 });
    expect(page).toMatchObject({
      total: 1,
      items: [
        {
          name: 'bound-owner',
          workspace: { label: 'main', current: false },
        },
      ],
    });
  });

  it('scans Classic roots despite invalid project config', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'classic: invalid\n');
    await writeChange(root, {
      name: 'must-not-be-guessed',
      yaml: { phase: 'build', workflow: 'hotfix' },
      tasks: '- [ ] todo\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['must-not-be-guessed']);
    expect(snap.classicError).toBeUndefined();
  });

  it('scans Classic roots despite malformed project config', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'schema: [broken\n');
    await writeChange(root, {
      name: 'must-not-be-scanned',
      yaml: { phase: 'build', workflow: 'hotfix' },
      tasks: '- [ ] todo\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['must-not-be-scanned']);
    expect(snap.classicError).toBeUndefined();
  });

  it('merges both Classic roots and keeps duplicate names distinct by relative path', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
    );
    await writeChange(root, {
      name: 'shared-change',
      changesPath: 'openspec/changes',
      yaml: { phase: 'build', workflow: 'legacy' },
    });
    await writeChange(root, {
      name: 'shared-change',
      changesPath: 'docs/openspec/changes',
      yaml: { phase: 'build', workflow: 'docs' },
    });
    await writeChange(root, {
      name: '2026-07-01-shared-archive',
      changesPath: 'openspec/changes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });
    await writeChange(root, {
      name: '2026-07-01-shared-archive',
      changesPath: 'docs/openspec/changes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active).toHaveLength(2);
    expect(snap.changes.active.map((change) => change.id)).toEqual(
      expect.arrayContaining([
        'openspec/changes/shared-change',
        'docs/openspec/changes/shared-change',
      ]),
    );
    expect(snap.changes.archived).toHaveLength(2);
    expect(snap.changes.archived.map((change) => change.id)).toEqual(
      expect.arrayContaining([
        'openspec/changes/archive/2026-07-01-shared-archive',
        'docs/openspec/changes/archive/2026-07-01-shared-archive',
      ]),
    );
    expect(snap.classicError).toBeUndefined();
  });

  it('collects active changes and ignores the archive directory entry', async () => {
    await writeChange(root, {
      name: 'dashboard-v0',
      yaml: { phase: 'build', workflow: 'full' },
      tasks: '## A\n- [x] done\n- [ ] todo\n',
      proposal: true,
      design: true,
      plan: true,
    });
    // archive/ subdirectory should not appear as an active candidate
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'archive'), { recursive: true });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((c) => c.name)).toEqual(['dashboard-v0']);
    expect(snap.changes.active[0].phase).toBe('build');
    expect(snap.changes.active[0].tasks).toMatchObject({ completed: 1, total: 2 });
    expect(snap.changes.active[0].next).toMatchObject({ command: '/comet-build' });
    expect(snap.changes.active[0].artifacts).toMatchObject({
      proposal: true,
      design: true,
      tasks: true,
      plan: true,
      verifyReport: false,
      cometYaml: true,
    });
    expect(snap.changes.active[0].artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'proposal', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'design', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'tasks', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'plan', source: 'superpowers', exists: true }),
      ]),
    );
    expect(snap.changes.active[0].artifactPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'proposal',
          label: '提案',
          exists: true,
          content: '# Proposal\n',
        }),
        expect.objectContaining({
          key: 'verifyReport',
          label: '验证报告',
          exists: false,
        }),
      ]),
    );
  });

  it('parses archived changes including date and original name', async () => {
    await writeChange(root, {
      name: '2026-06-20-context-graph-notes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
      tasks: '## Foo\n- [x] done\n',
      proposal: true,
      design: true,
      plan: true,
      verifyReport: '# Verify\nAll passed.',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.archived).toHaveLength(1);
    const archived = snap.changes.archived[0];
    expect(archived.id).toBe('openspec/changes/archive/2026-06-20-context-graph-notes');
    expect(archived.status).toBe('archived');
    expect(archived.displayName).toBe('context-graph-notes');
    expect(archived.archive).toMatchObject({
      archiveName: '2026-06-20-context-graph-notes',
      originalName: 'context-graph-notes',
      archivedAt: '2026-06-20',
    });
    expect(archived.next).toBeUndefined();
    expect(archived.verify.result).toBe('pass');
    expect(archived.verify.reportExists).toBe(true);
  });

  it('resolves archived Superpowers artifacts from docs/superpowers path pointers', async () => {
    const designDocPath = path.join(root, 'docs', 'superpowers', 'specs', 'demo-design.md');
    const planPath = path.join(root, 'docs', 'superpowers', 'plans', 'demo-plan.md');
    const verifyPath = path.join(root, 'docs', 'superpowers', 'reports', 'demo-verify.md');
    await fs.mkdir(path.dirname(designDocPath), { recursive: true });
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.mkdir(path.dirname(verifyPath), { recursive: true });
    await fs.writeFile(designDocPath, '# Design Doc\n');
    await fs.writeFile(planPath, '# Plan\n');
    await fs.writeFile(verifyPath, '# Verify\nAll passed.');

    await writeChange(root, {
      name: '2026-07-09-demo',
      status: 'archived',
      yaml: {
        phase: 'archive',
        archived: 'true',
        verify_result: 'pass',
        design_doc: 'docs/superpowers/specs/demo-design.md',
        plan: 'docs/superpowers/plans/demo-plan.md',
        verification_report: 'docs/superpowers/reports/demo-verify.md',
      },
    });

    const snap = await collectDashboardSnapshot(root);
    const archived = snap.changes.archived[0];

    expect(archived.artifacts.plan).toBe(true);
    expect(archived.artifacts.verifyReport).toBe(true);
    expect(archived.verify.reportExists).toBe(true);
    expect(archived.artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'designDoc',
          source: 'superpowers',
          exists: true,
          path: designDocPath,
        }),
        expect.objectContaining({
          key: 'plan',
          source: 'superpowers',
          exists: true,
          path: planPath,
        }),
        expect.objectContaining({
          key: 'verifyReport',
          source: 'superpowers',
          exists: true,
          path: verifyPath,
        }),
      ]),
    );
    expect(archived.artifactPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'plan',
          exists: true,
          content: '# Plan\n',
        }),
        expect.objectContaining({
          key: 'verifyReport',
          exists: true,
          content: '# Verify\nAll passed.',
        }),
      ]),
    );
  });

  it('does not expose artifacts through project traversal pointers', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-outside-'));
    try {
      const outsidePlan = path.join(outsideRoot, 'plan.md');
      await fs.writeFile(outsidePlan, '# Outside plan\n');
      await writeChange(root, {
        name: 'unsafe-pointer',
        yaml: {
          phase: 'build',
          workflow: 'full',
          plan: path.relative(root, outsidePlan).replaceAll('\\', '/'),
        },
      });

      const snap = await collectDashboardSnapshot(root);
      const change = snap.changes.active[0];

      expect(change.artifacts.plan).toBe(false);
      expect(change.artifacts.grouped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            exists: false,
          }),
        ]),
      );
      expect(change.artifactPreviews).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            content: '# Outside plan\n',
          }),
        ]),
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not expose artifacts through a junction outside the project', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-outside-'));
    const linkedDirectory = path.join(root, 'docs', 'linked-plans');
    try {
      await fs.writeFile(path.join(outsideRoot, 'plan.md'), '# Outside plan\n');
      await fs.mkdir(path.dirname(linkedDirectory), { recursive: true });
      try {
        await fs.symlink(outsideRoot, linkedDirectory, 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await writeChange(root, {
        name: 'unsafe-junction',
        yaml: {
          phase: 'build',
          workflow: 'full',
          plan: 'docs/linked-plans/plan.md',
        },
      });

      const snap = await collectDashboardSnapshot(root);
      const change = snap.changes.active[0];

      expect(change.artifacts.plan).toBe(false);
      expect(change.artifactPreviews).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            content: '# Outside plan\n',
          }),
        ]),
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('skips a change directory junction instead of reading project-external state', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-change-outside-'));
    const changesRoot = path.join(root, 'openspec', 'changes');
    const linkedChange = path.join(changesRoot, 'external-change');
    try {
      await fs.writeFile(
        path.join(outsideRoot, '.comet.yaml'),
        'phase: build\nworkflow: TOP_SECRET\n',
      );
      await fs.writeFile(path.join(outsideRoot, 'tasks.md'), '- [ ] external secret task\n');
      await fs.mkdir(path.join(outsideRoot, 'specs', 'secret'), { recursive: true });
      await fs.writeFile(
        path.join(outsideRoot, 'specs', 'secret', 'spec.md'),
        '# External secret\n',
      );
      await fs.mkdir(changesRoot, { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          linkedChange,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const snap = await collectDashboardSnapshot(root);

      expect(snap.changes.active).toEqual([]);
      expect(JSON.stringify(snap)).not.toContain('TOP_SECRET');
      expect(JSON.stringify(snap)).not.toContain('external secret');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(['changes', 'archive'] as const)(
    'reports Classic unavailable when the %s root is a junction',
    async (kind) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-root-outside-'));
      const openSpecRoot = path.join(root, 'openspec');
      try {
        await fs.mkdir(openSpecRoot, { recursive: true });
        const target =
          kind === 'changes'
            ? path.join(openSpecRoot, 'changes')
            : path.join(openSpecRoot, 'changes', 'archive');
        if (kind === 'archive') {
          await fs.mkdir(path.dirname(target), { recursive: true });
        }
        try {
          await fs.symlink(outsideRoot, target, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }

        const snap = await collectDashboardSnapshot(root);

        expect(snap.changes.active).toEqual([]);
        expect(snap.changes.archived).toEqual([]);
        expect(snap.classicError).toMatchObject({
          code: 'classic-dashboard-unavailable',
          message: expect.stringMatching(/symbolic link or junction/iu),
        });
      } finally {
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('keeps the readable docs root when the legacy changes root is a junction', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-root-outside-'));
    const openSpecRoot = path.join(root, 'openspec');
    const linkedChanges = path.join(openSpecRoot, 'changes');
    try {
      await fs.mkdir(openSpecRoot, { recursive: true });
      await writeChange(root, {
        name: 'docs-survivor',
        changesPath: 'docs/openspec/changes',
        yaml: { phase: 'build', workflow: 'docs' },
      });
      try {
        await fs.symlink(
          outsideRoot,
          linkedChanges,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const snap = await collectDashboardSnapshot(root);

      expect(snap.changes.active.map((change) => change.id)).toEqual([
        'docs/openspec/changes/docs-survivor',
      ]);
      expect(snap.classicError).toMatchObject({
        code: 'classic-dashboard-unavailable',
        message: expect.stringMatching(/symbolic link or junction/iu),
      });
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('sorts active changes by risk, then updatedAt, then name', async () => {
    await writeChange(root, {
      name: 'docs-cleanup',
      yaml: { phase: 'design', workflow: 'full' },
      tasks: '- [x] outline\n',
      proposal: true,
    });
    await writeChange(root, {
      name: 'auth-refactor',
      yaml: { phase: 'verify', verify_result: 'fail', workflow: 'full' },
      tasks: '- [x] done\n',
      proposal: true,
      design: true,
      plan: true,
    });
    await writeChange(root, {
      name: 'dashboard-v0',
      yaml: { phase: 'build', workflow: 'full' },
      tasks: '- [x] one\n- [ ] two\n',
      proposal: true,
      design: true,
      plan: true,
    });

    const snap = await collectDashboardSnapshot(root);

    // fail risk first, then warning (build with incomplete), then info-only design
    expect(snap.changes.active.map((c) => c.name)).toEqual([
      'auth-refactor',
      'dashboard-v0',
      'docs-cleanup',
    ]);
  });

  it('sorts archived changes by archivedAt descending', async () => {
    await writeChange(root, {
      name: '2026-06-15-dashboard-command',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'fail' },
    });
    await writeChange(root, {
      name: '2026-06-20-context-graph-notes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
    });
    await writeChange(root, {
      name: '2026-06-18-agent-workflow',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.archived.map((c) => c.archive?.archivedAt)).toEqual([
      '2026-06-20',
      '2026-06-18',
      '2026-06-15',
    ]);
  });

  it('counts incomplete tasks across active changes in the summary', async () => {
    await writeChange(root, {
      name: 'a',
      yaml: { phase: 'build' },
      tasks: '- [x] one\n- [ ] two\n- [ ] three\n',
    });
    await writeChange(root, {
      name: 'b',
      yaml: { phase: 'build' },
      tasks: '- [x] one\n- [x] two\n',
    });
    await writeChange(root, {
      name: 'c-archived',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
      tasks: '- [ ] should-not-count\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.summary.tasksIncomplete).toBe(2);
    expect(snap.summary.activeChanges).toBe(2);
    expect(snap.summary.archivedChanges).toBe(1);
  });

  it('marks unknown phase and surfaces a risk', async () => {
    await writeChange(root, {
      name: 'mystery',
      yaml: { workflow: 'full' },
      tasks: '',
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.phase).toBe('unknown');
    expect(item.risks.some((r) => r.code === 'UNKNOWN_PHASE')).toBe(true);
    expect(item.next).toMatchObject({ command: null });
  });

  it('uses project basename and the provided clock for generatedAt', async () => {
    const now = new Date('2026-06-23T10:42:00Z');
    const snap = await collectDashboardSnapshot(root, { now });

    expect(snap.project.path).toBe(root);
    expect(snap.project.name).toBe(path.basename(root));
    expect(snap.project.generatedAt).toBe(now.toISOString());
  });

  it('skips a single broken change without aborting the whole sweep', async () => {
    await writeChange(root, {
      name: 'healthy',
      yaml: { phase: 'build' },
      tasks: '- [ ] one\n',
    });

    // Plant an unreadable .comet.yaml (a directory where a file should be)
    // so the per-change build throws when it tries to read it.
    const bogusDir = path.join(root, 'openspec', 'changes', 'bogus');
    await fs.mkdir(path.join(bogusDir, '.comet.yaml'), { recursive: true });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const snap = await collectDashboardSnapshot(root);
      expect(snap.changes.active.map((c) => c.name)).toEqual(['healthy']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bogus'));
    } finally {
      warn.mockRestore();
    }
  });

  it('resolves plan from yaml path-pointer in docs/superpowers/', async () => {
    // Create plan in docs/superpowers/ (not in change dir)
    const planDir = path.join(root, 'docs', 'superpowers', 'plans');
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, '2026-06-28-my-feature.md'), '# Plan\n');

    await writeChange(root, {
      name: 'my-feature',
      yaml: { phase: 'build', plan: 'docs/superpowers/plans/2026-06-28-my-feature.md' },
      tasks: '- [ ] one\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.artifacts.plan).toBe(true);
    expect(item.artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'plan',
          source: 'superpowers',
          exists: true,
          path: expect.stringContaining('2026-06-28-my-feature.md'),
        }),
      ]),
    );
  });

  it('resolves verify report from yaml path-pointer in docs/superpowers/', async () => {
    // Create verify report in docs/superpowers/
    const reportDir = path.join(root, 'docs', 'superpowers', 'reports');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, '2026-06-28-verify.md'), '# Verify\nAll passed.');

    await writeChange(root, {
      name: 'my-feature',
      yaml: {
        phase: 'verify',
        verify_result: 'pass',
        verification_report: 'docs/superpowers/reports/2026-06-28-verify.md',
      },
      tasks: '- [x] done\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.verify.reportExists).toBe(true);
    expect(item.verify.result).toBe('pass');
    expect(item.artifacts.verifyReport).toBe(true);
  });

  it('groups artifacts by source (openspec vs superpowers)', async () => {
    const planDir = path.join(root, 'docs', 'superpowers', 'plans');
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, '2026-06-28-f.md'), '# Plan\n');

    await writeChange(root, {
      name: 'feat-x',
      yaml: { phase: 'build', plan: 'docs/superpowers/plans/2026-06-28-f.md' },
      tasks: '- [ ] one\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const grouped = snap.changes.active[0].artifacts.grouped;

    const openspecKeys = grouped.filter((a) => a.source === 'openspec').map((a) => a.key);
    const superpowersKeys = grouped.filter((a) => a.source === 'superpowers').map((a) => a.key);

    expect(openspecKeys).toContain('proposal');
    expect(openspecKeys).toContain('design');
    expect(openspecKeys).toContain('tasks');
    expect(superpowersKeys).toContain('plan');
  });

  it('returns paginated lightweight change rows without hidden artifact previews', async () => {
    for (let index = 0; index < 6; index += 1) {
      await writeChange(root, {
        name: `active-${index}`,
        yaml: { phase: 'build', workflow: 'classic' },
        tasks: '- [ ] pending\n',
        proposal: true,
        design: true,
        plan: true,
      });
    }

    const first = await collectDashboardChangePage(root, {
      status: 'active',
      limit: 5,
    });

    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toMatchObject({
      status: 'active',
      phase: 'build',
      tasks: { completed: 0, total: 1 },
      verify: { result: 'unknown' },
    });
    expect(first.items[0]).not.toHaveProperty('artifactPreviews');

    const second = await collectDashboardChangePage(root, {
      status: 'active',
      limit: 5,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('combines active and archived rows for the all tab with a stable page size', async () => {
    await writeChange(root, {
      name: 'active-one',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
    });
    await writeChange(root, {
      name: '2026-06-20-archived-one',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
      tasks: '- [x] done\n',
    });

    const page = await collectDashboardChangePage(root, {
      status: 'all',
      limit: 1,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('active');
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('loads full change details only through the detail lookup', async () => {
    await writeChange(root, {
      name: 'detail-only',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
      proposal: true,
    });

    const detail = await collectDashboardChangeDetail(root, 'openspec/changes/detail-only');

    expect(detail).toMatchObject({
      id: 'openspec/changes/detail-only',
      name: 'detail-only',
      artifacts: { proposal: true },
    });
    expect(detail?.artifactPreviews.length).toBeGreaterThan(0);
    await expect(
      collectDashboardChangeDetail(root, 'openspec/changes/not-registered'),
    ).resolves.toBeNull();
    await expect(
      collectDashboardChangeDetail(root, 'openspec/changes/..\\outside'),
    ).resolves.toBeNull();
  });

  it('builds the dashboard overview without embedding Classic change details', async () => {
    await writeChange(root, {
      name: 'overview-active',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
    });
    await writeChange(root, {
      name: '2026-06-20-overview-archived',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });

    const overview = await collectDashboardOverview(root);

    expect(overview).toMatchObject({
      summary: { activeChanges: 1, archivedChanges: 1, tasksIncomplete: 1 },
      project: { path: root },
    });
    expect(overview).not.toHaveProperty('changes');
  });
});
