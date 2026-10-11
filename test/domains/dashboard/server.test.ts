import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import http from 'http';
import { promises as fs } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { startDashboardServer } from '../../../domains/dashboard/server.js';
import { resolveDashboardStaticPath } from '../../../domains/dashboard/server.js';
import { upsertProjectInstallation } from '../../../platform/install/project-registry.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import type { DashboardGitPage } from '../../../domains/dashboard/types.js';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// vitest's bundled fetch (undici) refuses to bind a 127.0.0.1 outbound on
// some macOS configs (EADDRNOTAVAIL with Local 0.0.0.0). The native http
// client picks the right local address, so the server tests use it directly.
function request(
  port: number,
  urlPath: string,
  options: http.RequestOptions = {},
  body?: unknown,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', ...options },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function initializeGitProject(root: string, commitCount = 0): void {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
      .toString()
      .trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Comet Test');
  git('config', 'user.email', 'comet@test.local');
  git('config', 'commit.gpgsign', 'false');
  const tree = git('mktree');
  let parent: string | undefined;
  for (let index = 0; index < commitCount; index += 1) {
    parent = git('commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `commit-${index}`);
  }
  if (parent) git('update-ref', 'HEAD', parent);
}

describe('startDashboardServer', () => {
  let projectDir: string;
  let webDir: string;
  let handles: Array<{ close: () => Promise<void> }> = [];

  beforeEach(async () => {
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-srv-proj-')));
    webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-srv-web-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(webDir, 'home'));
    await fs.writeFile(
      path.join(webDir, 'index.html'),
      '<!doctype html><title>Dashboard</title><p>hi</p>',
    );
    await fs.writeFile(path.join(webDir, 'app.js'), 'console.log(1);');
  });

  afterEach(async () => {
    await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
    handles = [];
    vi.restoreAllMocks();
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(webDir, { recursive: true, force: true });
  });

  it('removes a missing project only through a trusted JSON POST without deleting files', async () => {
    const missing = path.join(webDir, 'missing-project');
    await upsertProjectInstallation(missing, [], 'init');
    await upsertProjectInstallation(projectDir, [], 'init');
    const handle = await startDashboardServer({
      projectPath: projectDir,
      webRoot: webDir,
      port: 0,
    });
    handles.push(handle);
    const directory = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body);
    const entry = directory.projects.find((project: { path: string }) => project.path === missing);
    const endpoint = `/api/dashboard/projects/${entry.id}/forget`;
    expect((await request(handle.port, endpoint)).status).toBe(405);
    expect(
      (
        await request(handle.port, endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://example.com',
          },
        })
      ).status,
    ).toBe(403);
    expect((await request(handle.port, endpoint, { method: 'POST' })).status).toBe(415);
    expect(
      (
        await request(handle.port, `/api/dashboard/projects/${directory.currentProjectId}/forget`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(409);
    // Recreated projects must be rechecked at mutation time.
    await fs.mkdir(missing);
    await fs.writeFile(path.join(missing, 'keep.txt'), 'keep');
    expect(
      (
        await request(handle.port, endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
        })
      ).status,
    ).toBe(409);
    expect(await fs.readFile(path.join(missing, 'keep.txt'), 'utf8')).toBe('keep');
    await fs.rm(missing, { recursive: true });
    const removed = await request(handle.port, endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });
    expect(removed.status).toBe(200);
    expect(JSON.parse(removed.body).projects).toHaveLength(1);
    expect(
      (
        await request(handle.port, endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
        })
      ).status,
    ).toBe(404);
  });

  it('preserves the launch identity after a symlink target is deleted', async () => {
    const alias = path.join(webDir, 'launch-alias');
    await fs.symlink(projectDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await upsertProjectInstallation(alias, [], 'init');
    const handle = await startDashboardServer({ projectPath: alias, webRoot: webDir, port: 0 });
    handles.push(handle);
    const before = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body);
    await fs.rm(projectDir, { recursive: true });
    const after = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body);
    expect(after.currentProjectId).toBe(before.currentProjectId);
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0].isCurrent).toBe(true);
    expect(
      (
        await request(handle.port, `/api/dashboard/projects/${before.currentProjectId}/forget`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(409);
  });

  it.each([false, true])(
    'keeps reads and writes bound to the launch target when an alias is retargeted (registered=%s)',
    async (registered) => {
      const alias = path.join(webDir, 'unregistered-launch-alias');
      const replacement = path.join(webDir, 'replacement-project');
      await fs.mkdir(replacement);
      await writeProjectConfig(projectDir, defaultProjectConfig('docs'));
      await writeProjectConfig(replacement, defaultProjectConfig('docs'));
      const replacementConfigPath = path.join(replacement, '.comet', 'config.yaml');
      const replacementConfig = await fs.readFile(replacementConfigPath, 'utf8');
      await fs.symlink(projectDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
      if (registered) await upsertProjectInstallation(alias, [], 'init');
      const handle = await startDashboardServer({ projectPath: alias, webRoot: webDir, port: 0 });
      handles.push(handle);
      const before = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body);
      const endpoint = `/api/dashboard/projects/${before.currentProjectId}/config`;
      const loadedResponse = await request(handle.port, endpoint);
      expect(loadedResponse.status).toBe(200);
      const loaded = JSON.parse(loadedResponse.body);
      await fs.unlink(alias);
      await fs.symlink(replacement, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const overview = JSON.parse(
        (await request(handle.port, `/api/dashboard/projects/${before.currentProjectId}/overview`))
          .body,
      );
      expect(overview.project.path).toBe(projectDir);
      const updated = await request(
        handle.port,
        endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        {
          expectedRevision: loaded.revision,
          config: {
            defaultWorkflow: loaded.defaultWorkflow,
            workflows: loaded.workflows,
            ambientResume: false,
            hookAllowPaths: loaded.hookAllowPaths,
            native: loaded.native,
            classic: loaded.classic,
          },
        },
      );
      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body).ambientResume).toBe(false);
      expect(await fs.readFile(replacementConfigPath, 'utf8')).toBe(replacementConfig);
    },
  );

  it('routes same-remote worktrees to their own overview and current change details', async () => {
    const linked = path.join(webDir, 'linked');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', projectDir, ...args], { stdio: 'pipe' });
    git('init', '-b', 'main');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
    git('remote', 'add', 'origin', 'https://example.com/team/shared.git');
    git('worktree', 'add', '-b', 'linked', linked);
    execFileSync(
      'git',
      [
        '-C',
        linked,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'linked fixture',
      ],
      { stdio: 'pipe' },
    );
    await upsertProjectInstallation(linked, [], 'init', { homeDir: os.homedir() });
    for (const [root, branch] of [
      [projectDir, 'main'],
      [linked, 'linked'],
    ]) {
      const changeDir = path.join(root, 'openspec', 'changes', 'same-name');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, '.comet.yaml'),
        `phase: build\nbound_branch: ${branch}\n`,
      );
      await fs.writeFile(path.join(changeDir, 'proposal.md'), `# ${branch} proposal\n`);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), `- [ ] ${branch} task\n`);
      await fs.writeFile(path.join(root, `${branch}.txt`), branch);
    }
    const handle = await startDashboardServer({
      projectPath: projectDir,
      webRoot: webDir,
      port: 0,
    });
    handles.push(handle);
    const directory = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body) as {
      projects: Array<{ id: string; path: string }>;
    };
    expect(new Set(directory.projects.map(({ id }) => id)).size).toBe(2);
    for (const entry of directory.projects) {
      const branch = entry.path === projectDir ? 'main' : 'linked';
      const base = `/api/dashboard/projects/${entry.id}`;
      const overview = await request(handle.port, `${base}/overview`);
      expect(overview.status).toBe(200);
      expect(JSON.parse(overview.body)).toMatchObject({
        project: { path: entry.path },
        git: { branch },
      });
      const commitsResponse = await request(handle.port, `${base}/git/commits?limit=1`);
      expect(commitsResponse.status).toBe(200);
      const commits = JSON.parse(commitsResponse.body) as DashboardGitPage;
      expect(commits.items[0]).toMatch(branch === 'main' ? / fixture$/u : / linked fixture$/u);
      expect(commits.nextCursor === null).toBe(branch === 'main');
      const filesResponse = await request(handle.port, `${base}/git/files`);
      expect(filesResponse.status).toBe(200);
      expect((JSON.parse(filesResponse.body) as DashboardGitPage).items).toContain(`${branch}.txt`);
      const page = await request(handle.port, `${base}/changes?status=active`);
      expect(page.status).toBe(200);
      const current = JSON.parse(page.body).items.find(
        (item: { workspace: { current: boolean } }) => item.workspace.current,
      );
      expect(current).toBeDefined();
      const detail = await request(
        handle.port,
        `${base}/change?changeLocator=${encodeURIComponent(current.locator)}`,
      );
      expect(detail.status).toBe(200);
      expect(JSON.parse(detail.body)).toMatchObject({
        path: await fs.realpath(path.join(entry.path, 'openspec', 'changes', 'same-name')),
        artifactPreviews: expect.arrayContaining([
          expect.objectContaining({ key: 'proposal', content: `# ${branch} proposal\n` }),
        ]),
      });
    }
  });

  it('serves on-demand Git pages with bounded limits, totals, and stable commit pagination', async () => {
    initializeGitProject(projectDir, 105);
    await fs.mkdir(path.join(projectDir, 'nested'));
    const files = Array.from(
      { length: 27 },
      (_, index) => `nested/文件 ${String(index).padStart(2, '0')}.txt`,
    );
    for (const file of files) await fs.writeFile(path.join(projectDir, file), file);
    const handle = await startDashboardServer({
      projectPath: projectDir,
      webRoot: webDir,
      port: 0,
    });
    handles.push(handle);
    const directory = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;
    const overview = JSON.parse((await request(handle.port, `${base}/overview`)).body);
    expect(overview.git).toMatchObject({
      recentCommits: expect.any(Array),
      recentCommitsHasMore: true,
      dirtyFiles: 27,
      dirtyFileListHasMore: true,
    });
    expect(overview.git.recentCommits).toHaveLength(5);
    expect(overview.git.dirtyFileList).toHaveLength(5);
    const firstResponse = await request(handle.port, `${base}/git/commits`);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers['cache-control']).toBe('no-store');
    const first = JSON.parse(firstResponse.body) as DashboardGitPage;
    expect(first.items).toHaveLength(50);
    expect(first.total).toBeNull();
    expect(first.nextCursor).toEqual(expect.any(String));
    execFileSync('git', ['-C', projectDir, 'commit', '--allow-empty', '-m', 'new after open'], {
      stdio: 'pipe',
    });
    const secondResponse = await request(
      handle.port,
      `${base}/git/commits?cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.status).toBe(200);
    const second = JSON.parse(secondResponse.body) as DashboardGitPage;
    const thirdResponse = await request(
      handle.port,
      `${base}/git/commits?cursor=${encodeURIComponent(second.nextCursor!)}`,
    );
    expect(thirdResponse.status).toBe(200);
    const third = JSON.parse(thirdResponse.body) as DashboardGitPage;
    expect(
      [...first.items, ...second.items, ...third.items].map((line) =>
        line.split(' ').slice(1).join(' '),
      ),
    ).toEqual(Array.from({ length: 105 }, (_, index) => `commit-${104 - index}`));
    expect(third.nextCursor).toBeNull();
    const maximumResponse = await request(handle.port, `${base}/git/commits?limit=100`);
    expect(maximumResponse.status).toBe(200);
    expect((JSON.parse(maximumResponse.body) as DashboardGitPage).items).toHaveLength(100);
    const filePages: DashboardGitPage[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        handle.port,
        `${base}/git/files?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(response.status).toBe(200);
      const page = JSON.parse(response.body) as DashboardGitPage;
      expect(page.total).toBe(27);
      filePages.push(page);
      cursor = page.nextCursor;
    } while (cursor);
    expect(filePages.map((page) => page.items.length)).toEqual([10, 10, 7]);
    expect(new Set(filePages.flatMap((page) => page.items))).toEqual(new Set(files));
    await fs.writeFile(path.join(projectDir, 'new.txt'), 'changed status');
    const stale = await request(
      handle.port,
      `${base}/git/files?cursor=${encodeURIComponent(filePages[0].nextCursor!)}`,
    );
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toEqual({ error: 'Git 文件列表已变化，请重新加载。' });
    for (const kind of ['commits', 'files']) {
      for (const limit of ['0', '-1', '1.5', '101', '--all', '99999999999999999999']) {
        const invalid = await request(
          handle.port,
          `${base}/git/${kind}?limit=${encodeURIComponent(limit)}`,
        );
        expect(invalid.status).toBe(400);
        expect(JSON.parse(invalid.body).error).toEqual(expect.any(String));
      }
      const invalid = await request(handle.port, `${base}/git/${kind}?cursor=--all`);
      expect(invalid.status).toBe(400);
    }
    const wrongList = await request(
      handle.port,
      `${base}/git/files?cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(wrongList.status).toBe(400);
    const unknown = await request(handle.port, '/api/dashboard/projects/unknown/git/commits');
    expect(unknown.status).toBe(404);
    const invalidId = await request(handle.port, '/api/dashboard/projects/%ZZ/git/files');
    expect(invalidId.status).toBe(400);
    const other = path.join(webDir, 'other-project');
    await fs.mkdir(other);
    initializeGitProject(other, 1);
    await upsertProjectInstallation(other, [], 'init', { homeDir: os.homedir() });
    const projects = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body) as {
      projects: Array<{ id: string; path: string }>;
    };
    const otherId = projects.projects.find((project) => project.path === other)!.id;
    const wrongProject = await request(
      handle.port,
      `/api/dashboard/projects/${otherId}/git/commits?cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(wrongProject.status).toBe(400);
  });

  it('distinguishes Git read failures from empty unborn repositories', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      webRoot: webDir,
      port: 0,
    });
    handles.push(handle);
    const directory = JSON.parse((await request(handle.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;
    for (const kind of ['commits', 'files']) {
      const failed = await request(handle.port, `${base}/git/${kind}`);
      expect(failed.status).toBe(500);
      expect(JSON.parse(failed.body)).toEqual({ error: expect.any(String) });
    }
    initializeGitProject(projectDir);
    const commits = await request(handle.port, `${base}/git/commits`);
    expect(commits.status).toBe(200);
    expect(JSON.parse(commits.body)).toEqual({ items: [], nextCursor: null, total: null });
    const files = await request(handle.port, `${base}/git/files`);
    expect(files.status).toBe(200);
    expect(JSON.parse(files.body)).toEqual({ items: [], nextCursor: null, total: 0 });
    await fs.writeFile(path.join(projectDir, '.git', 'index'), 'invalid Git index');
    const damaged = await request(handle.port, `${base}/git/files`);
    expect(damaged.status).toBe(500);
    expect(JSON.parse(damaged.body)).toEqual({ error: '读取 Git 文件列表失败。' });
  });

  it('serves /api/dashboard with a valid snapshot payload', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/api/dashboard');
    expect(res.status).toBe(200);
    const snap = JSON.parse(res.body) as Record<string, unknown>;

    expect(snap).toMatchObject({
      project: expect.objectContaining({ path: projectDir }),
      summary: expect.objectContaining({
        activeChanges: 0,
        archivedChanges: 0,
      }),
      changes: { active: [], archived: [] },
    });
  });

  it('lists the current project and only resolves snapshot requests by registered project id', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    expect(directoryResponse.status).toBe(200);
    const directory = JSON.parse(directoryResponse.body) as {
      currentProjectId: string;
      projects: Array<{ id: string; path: string }>;
    };
    expect(directory.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: projectDir })]),
    );

    const snapshotResponse = await request(
      handle.port,
      `/api/dashboard/projects/${directory.currentProjectId}`,
    );
    expect(snapshotResponse.status).toBe(200);
    expect(JSON.parse(snapshotResponse.body)).toMatchObject({
      project: expect.objectContaining({ path: projectDir }),
    });

    const unknownResponse = await request(handle.port, '/api/dashboard/projects/not-a-project-id');
    expect(unknownResponse.status).toBe(404);
    expect(JSON.parse(unknownResponse.body)).toEqual({ error: 'Unknown dashboard project id' });
  });

  it('serves paginated change rows and loads a selected change detail on demand', async () => {
    const changesRoot = path.join(projectDir, 'openspec', 'changes');
    await fs.mkdir(changesRoot, { recursive: true });
    for (let index = 0; index < 6; index += 1) {
      const changeDir = path.join(changesRoot, `server-${index}`);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, '.comet.yaml'), 'phase: build\n');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] pending\n');
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    }

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;

    const overviewResponse = await request(handle.port, `${base}/overview`);
    expect(overviewResponse.status).toBe(200);
    expect(JSON.parse(overviewResponse.body)).toMatchObject({
      summary: { activeChanges: 6 },
    });
    expect(JSON.parse(overviewResponse.body)).not.toHaveProperty('changes');

    const pageResponse = await request(handle.port, `${base}/changes?status=active&limit=5`);
    expect(pageResponse.status).toBe(200);
    const page = JSON.parse(pageResponse.body) as {
      items: Array<{ id: string; locator: string; status: string }>;
      total: number;
      nextCursor: string | null;
    };
    expect(page.total).toBe(6);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toEqual(expect.any(String));

    const detailResponse = await request(
      handle.port,
      `${base}/change?changeLocator=${encodeURIComponent(page.items[0].locator)}`,
    );
    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailResponse.body)).toMatchObject({
      id: page.items[0].id,
      locator: page.items[0].locator,
      artifacts: expect.any(Object),
      artifactPreviews: expect.any(Array),
    });
  });

  it('serves Native changes from a paginated endpoint instead of embedding them in overview', async () => {
    await writeProjectConfig(projectDir, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectDir, 'docs');
    for (let index = 0; index < 6; index += 1) {
      const state = await createNativeChange({
        paths,
        name: `native-server-${index}`,
        language: 'en',
      });
      await fs.writeFile(path.join(nativeChangeDir(paths, state.name), 'brief.md'), '# Outcome\n');
    }

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;

    const overviewResponse = await request(handle.port, `${base}/overview`);
    expect(overviewResponse.status).toBe(200);
    expect(JSON.parse(overviewResponse.body)).toMatchObject({
      native: {
        totalChangeCount: 6,
        activeChangeCount: 6,
        changes: [],
      },
    });

    const firstResponse = await request(
      handle.port,
      `${base}/native-changes?status=active&limit=5`,
    );
    expect(firstResponse.status).toBe(200);
    const first = JSON.parse(firstResponse.body) as {
      items: Array<{ name: string; status: string; locator: string }>;
      total: number;
      nextCursor: string | null;
    };
    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(5);
    expect(first.items.every((item) => item.status === 'active')).toBe(true);
    expect(first.items[0]).not.toHaveProperty('artifacts');
    expect(first.nextCursor).toEqual(expect.any(String));

    const detailResponse = await request(
      handle.port,
      `${base}/native-change?status=active&changeLocator=${encodeURIComponent(first.items[0].locator)}`,
    );
    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailResponse.body)).toMatchObject({
      name: first.items[0].name,
      locator: first.items[0].locator,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ key: 'comet-state.yaml' }),
        expect.objectContaining({ key: 'brief' }),
      ]),
    });

    const artifactQuery = `status=active&changeLocator=${encodeURIComponent(first.items[0].locator)}`;
    const artifactResponse = await request(
      handle.port,
      `${base}/native-artifact?${artifactQuery}&key=brief`,
    );
    expect(artifactResponse.status).toBe(200);
    expect(JSON.parse(artifactResponse.body)).toMatchObject({
      key: 'brief',
      exists: true,
      previewBytes: 48 * 1024,
    });
    expect(
      (await request(handle.port, `${base}/native-artifact?${artifactQuery}&key=../brief.md`))
        .status,
    ).toBe(404);
    expect((await request(handle.port, `${base}/native-artifact?${artifactQuery}`)).status).toBe(
      400,
    );

    const secondResponse = await request(
      handle.port,
      `${base}/native-changes?status=active&limit=5&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.status).toBe(200);
    expect(JSON.parse(secondResponse.body)).toMatchObject({
      total: 6,
      items: expect.arrayContaining([expect.objectContaining({ name: 'native-server-5' })]),
      nextCursor: null,
    });
  });

  it('rejects a Native page limit above the Classic Dashboard maximum', async () => {
    await writeProjectConfig(projectDir, defaultProjectConfig('docs'));

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const response = await request(
      handle.port,
      `/api/dashboard/projects/${directory.currentProjectId}/native-changes?status=active&limit=51`,
    );

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toContain('between 1 and 50');
  });

  it('serves the static index for the root path', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Dashboard');
  });

  it('serves static assets next to index.html', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body).toContain('console.log');
  });

  it('rejects static paths that escape its web root', () => {
    expect(resolveDashboardStaticPath(webDir, '/../etc/passwd')).toBeNull();
  });

  it('rejects encoded path traversal attempts', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const response = await request(handle.port, '/%2e%2e/etc/passwd');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'Not found' });
  });

  it('falls back to the next available port when the requested one is taken', async () => {
    const blocker = await new Promise<net.Server>((resolve) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    const blockedPort = (blocker.address() as net.AddressInfo).port;

    try {
      const handle = await startDashboardServer({
        projectPath: projectDir,
        port: blockedPort,
        webRoot: webDir,
      });
      handles.push(handle);
      expect(handle.port).toBeGreaterThan(blockedPort);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
