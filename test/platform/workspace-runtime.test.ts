import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveWorkspaceIdentity,
  resolveWorkspaceRuntimeLocation,
  resolveWorkspaceRuntimeRootSync,
} from '../../platform/paths/workspace-runtime.js';

import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';

let temporary: string;
let project: string;

beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workspace-path-')));
  project = path.join(temporary, 'project');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'home-data'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('workspace runtime identity', () => {
  it('uses a complete digest and resolves without creating runtime directories', async () => {
    const location = resolveWorkspaceRuntimeLocation(project);
    expect(location.workspaceId).toMatch(/^[a-f0-9]{64}$/u);
    expect(location.runtimeRoot).toBe(
      path.join(temporary, 'home-data', 'workspaces', location.workspaceId, 'runtime'),
    );
    expect(resolveWorkspaceRuntimeRootSync(project)).toBe(location.runtimeRoot);
    await expect(fs.stat(path.join(temporary, 'home-data'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'refreshes a replaced data-root parent in the next read scope',
    async () => {
      const parent = path.join(temporary, 'data-parent');
      const replacement = path.join(temporary, 'replacement');
      await fs.mkdir(parent);
      await fs.mkdir(replacement);
      vi.stubEnv('COMET_DATA_DIR', path.join(parent, 'data'));
      const original = await runWithHookReadCache(async () => {
        const first = resolveWorkspaceRuntimeLocation(project);
        await fs.rename(parent, parent + '-old');
        await fs.symlink(replacement, parent);
        expect(resolveWorkspaceRuntimeLocation(project)).toEqual(first);
        return first;
      });
      const next = await runWithHookReadCache(async () => resolveWorkspaceRuntimeLocation(project));
      expect(next.dataRoot).toBe(path.join(replacement, 'data'));
      expect(next.runtimeRoot).not.toBe(original.runtimeRoot);
      expect(resolveWorkspaceRuntimeLocation(project)).toEqual(next);
    },
  );

  it('keys data-root parent observations by the current explicit target', async () => {
    await runWithHookReadCache(async () => {
      const original = resolveWorkspaceRuntimeLocation(project);
      vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'other-data'));
      const changed = resolveWorkspaceRuntimeLocation(project);
      expect(changed.dataRoot).toBe(path.join(temporary, 'other-data'));
      expect(changed.runtimeRoot).not.toBe(original.runtimeRoot);
      vi.stubEnv('COMET_DATA_DIR', 'relative-invalid');
      expect(() => resolveWorkspaceRuntimeLocation(project)).toThrow(/COMET_DATA_DIR/u);
    });
  });

  it('shares identity through workspace symlink aliases', async () => {
    const alias = path.join(temporary, 'alias');
    await fs.symlink(project, alias, 'junction');
    expect(resolveWorkspaceIdentity(alias)).toEqual(resolveWorkspaceIdentity(project));
  });

  it.runIf(process.platform === 'win32').for([false, true])(
    'keeps one workspace identity through Windows case aliases (Git=%s)',
    async (gitProject, context) => {
      const alias = path.join(temporary, 'Project');
      try {
        await fs.stat(alias);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          context.skip('当前目录区分大小写，不存在同目录大小写别名');
        throw error;
      }
      if (gitProject) execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
      expect(resolveWorkspaceIdentity(alias)).toEqual(resolveWorkspaceIdentity(project));
      expect(resolveWorkspaceRuntimeRootSync(alias)).toBe(resolveWorkspaceRuntimeRootSync(project));
    },
  );

  it('isolates clones with the same origin and linked Git worktrees', async () => {
    const git = (root: string, ...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git(project, 'init');
    git(
      project,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    );
    git(project, 'remote', 'add', 'origin', 'https://example.test/same.git');
    const clone = path.join(temporary, 'clone');
    git(temporary, 'clone', project, clone);
    git(clone, 'remote', 'set-url', 'origin', 'https://example.test/same.git');
    const worktree = path.join(temporary, 'worktree');
    git(project, 'worktree', 'add', '-b', 'second', worktree);
    const roots = [project, clone, worktree].map(resolveWorkspaceRuntimeRootSync);
    expect(new Set(roots).size).toBe(3);
    expect((await fs.stat(path.join(worktree, '.git'))).isFile()).toBe(true);
  });

  it('does not lowercase case-sensitive workspace paths', async (context) => {
    const other = path.join(temporary, 'Project');
    await fs.mkdir(other, { recursive: true });
    if ((await fs.realpath(other)) === (await fs.realpath(project)))
      context.skip('当前文件系统不区分路径大小写');
    expect(resolveWorkspaceRuntimeRootSync(other)).not.toBe(
      resolveWorkspaceRuntimeRootSync(project),
    );
  });

  it.runIf(process.platform === 'win32')(
    'keeps linked-worktree identity through equivalent Git metadata path casing',
    async () => {
      const git = (root: string, ...args: string[]) =>
        execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
      git(project, 'init');
      git(
        project,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      );
      const worktree = path.join(temporary, 'linked');
      git(project, 'worktree', 'add', '-b', 'child', worktree);
      const before = resolveWorkspaceIdentity(worktree);
      const pointer = path.join(worktree, '.git');
      const original = await fs.readFile(pointer, 'utf8');
      const alias = original.replace(/([\\/])worktrees([\\/])/u, '$1WORKTREES$2');
      expect(alias).not.toBe(original);
      // Git 的 Windows .git 指针可能带隐藏属性；等长替换不重新创建或截断文件。
      expect(Buffer.byteLength(alias)).toBe(Buffer.byteLength(original));
      await fs.writeFile(pointer, alias, { flag: 'r+' });
      expect(resolveWorkspaceIdentity(worktree)).toEqual(before);
    },
  );

  it('refuses broken worktree metadata rather than changing identity silently', async () => {
    await fs.writeFile(path.join(project, '.git'), 'gitdir: /missing-comet-worktree-metadata\n');
    expect(() => resolveWorkspaceRuntimeRootSync(project)).toThrow();
  });

  it('rejects relative and empty data roots', () => {
    vi.stubEnv('COMET_DATA_DIR', 'relative');
    expect(() => resolveWorkspaceRuntimeRootSync(project)).toThrow('COMET_DATA_DIR');
    vi.stubEnv('COMET_DATA_DIR', '');
    expect(() => resolveWorkspaceRuntimeRootSync(project)).toThrow('COMET_DATA_DIR');
  });
  it('refuses a data root inside the project', () => {
    vi.stubEnv('COMET_DATA_DIR', path.join(project, 'local-data'));
    expect(() => resolveWorkspaceRuntimeRootSync(project)).toThrow('不能位于当前工作区内');
  });
  it('isolates Git initialization from the prior non-Git runtime', async () => {
    const before = resolveWorkspaceRuntimeRootSync(project);
    await fs.mkdir(before, { recursive: true });
    await fs.writeFile(path.join(before, 'old-state.json'), '{\"old\":true}');
    execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
    expect(resolveWorkspaceRuntimeRootSync(project)).not.toBe(before);
    expect(await fs.readFile(path.join(before, 'old-state.json'), 'utf8')).toBe('{\"old\":true}');
  });
  it('isolates a recreated linked worktree at the same path and keeps its previous runtime', async () => {
    const git = (root: string, ...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git(project, 'init');
    git(
      project,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    );
    const worktree = path.join(temporary, 'worktree');
    git(project, 'worktree', 'add', '-b', 'child', worktree);
    const oldPointer = await fs.readFile(path.join(worktree, '.git'), 'utf8');
    const oldRoot = resolveWorkspaceRuntimeRootSync(worktree);
    await fs.mkdir(oldRoot, { recursive: true });
    await fs.writeFile(path.join(oldRoot, 'execution.json'), '{"old":true}');
    git(project, 'worktree', 'remove', '--force', worktree);
    git(project, 'worktree', 'add', worktree, 'child');
    expect(await fs.readFile(path.join(worktree, '.git'), 'utf8')).toBe(oldPointer);
    expect(resolveWorkspaceRuntimeRootSync(worktree)).not.toBe(oldRoot);
    expect(await fs.readFile(path.join(oldRoot, 'execution.json'), 'utf8')).toBe('{"old":true}');
    await expect(fs.stat(resolveWorkspaceRuntimeRootSync(worktree))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([false, true])(
    'isolates a recreated workspace directory at the same path (Git=%s)',
    async (gitProject) => {
      if (gitProject) execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
      const oldRoot = resolveWorkspaceRuntimeRootSync(project);
      await fs.mkdir(oldRoot, { recursive: true });
      await fs.writeFile(path.join(oldRoot, 'state.json'), '{"old":true}');
      await fs.rm(project, { recursive: true });
      await fs.mkdir(project);
      if (gitProject) execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
      expect(resolveWorkspaceRuntimeRootSync(project)).not.toBe(oldRoot);
      expect(await fs.readFile(path.join(oldRoot, 'state.json'), 'utf8')).toBe('{"old":true}');
    },
  );

  it('keeps identity stable through branch checkout and directory metadata changes', async () => {
    const git = (root: string, ...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git(project, 'init');
    git(
      project,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    );
    const mainRoot = resolveWorkspaceRuntimeRootSync(project);
    git(project, 'checkout', '-b', 'other');
    await fs.writeFile(path.join(project, 'ordinary-edit.txt'), 'changed');
    await fs.chmod(project, 0o700);
    expect(resolveWorkspaceRuntimeRootSync(project)).toBe(mainRoot);
    const worktree = path.join(temporary, 'worktree');
    git(project, 'worktree', 'add', '-b', 'child', worktree);
    const childRoot = resolveWorkspaceRuntimeRootSync(worktree);
    git(worktree, 'checkout', '-b', 'child-other');
    await fs.writeFile(path.join(worktree, 'ordinary-edit.txt'), 'changed');
    expect(resolveWorkspaceRuntimeRootSync(worktree)).toBe(childRoot);
    const alias = path.join(temporary, 'worktree-alias');
    await fs.symlink(worktree, alias, 'junction');
    expect(resolveWorkspaceRuntimeRootSync(alias)).toBe(childRoot);
  });
  it('isolates replacement of main Git metadata without recreating the workspace root', async () => {
    execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
    const oldRoot = resolveWorkspaceRuntimeRootSync(project);
    await fs.mkdir(oldRoot, { recursive: true });
    await fs.writeFile(path.join(oldRoot, 'old-state.json'), '{"old":true}');
    const before = await fs.stat(project, { bigint: true });
    await fs.rename(path.join(project, '.git'), path.join(temporary, 'old-git-metadata'));
    execFileSync('git', ['-C', project, 'init'], { stdio: 'pipe' });
    const after = await fs.stat(project, { bigint: true });
    expect([after.dev, after.ino, after.birthtimeNs]).toEqual([
      before.dev,
      before.ino,
      before.birthtimeNs,
    ]);
    expect(resolveWorkspaceRuntimeRootSync(project)).not.toBe(oldRoot);
    expect(await fs.readFile(path.join(oldRoot, 'old-state.json'), 'utf8')).toBe('{"old":true}');
  });

  it('keeps identity through Git maintenance and a new process', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
    git('init');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    );
    const before = resolveWorkspaceRuntimeRootSync(project);
    git('gc');
    git('repack', '-ad');
    expect(resolveWorkspaceRuntimeRootSync(project)).toBe(before);
    const bundle = path.join(temporary, 'workspace-runtime.mjs');
    await build({
      entryPoints: [
        fileURLToPath(new URL('../../platform/paths/workspace-runtime.ts', import.meta.url)),
      ],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
    });
    const moduleUrl = pathToFileURL(bundle).href;
    const script = `import { resolveWorkspaceRuntimeRootSync } from ${JSON.stringify(moduleUrl)}; process.stdout.write(resolveWorkspaceRuntimeRootSync(${JSON.stringify(project)}));`;
    const freshProcess = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(freshProcess).toBe(before);
  });
});
