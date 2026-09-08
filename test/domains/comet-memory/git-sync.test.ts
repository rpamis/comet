import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitMemorySync } from '../../../domains/comet-memory/repository.js';

describe('real memory Git synchronization', () => {
  let root: string;
  let remote: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  async function client(name: string, branch: string) {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    git(directory, 'init', '--initial-branch', branch);
    git(directory, 'config', 'user.name', 'Memory test');
    git(directory, 'config', 'user.email', 'memory@example.invalid');
    git(directory, 'config', 'core.autocrlf', 'false');
    const sync = new GitMemorySync(directory);
    await sync.configureRemote(remote);
    return { directory, sync };
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-git-'));
    remote = path.join(root, 'remote.git');
    git(root, 'init', '--bare', '--initial-branch', 'main', remote);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('bootstraps an empty remote, connects another client and synchronizes later changes', async () => {
    const first = await client('first', 'personal');
    await fs.writeFile(path.join(first.directory, 'profile.md'), 'Use concise explanations.\n');
    expect(await first.sync.sync()).toMatchObject({ status: 'synced' });
    expect(git(first.directory, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe(
      'origin/personal',
    );
    const second = await client('second', 'different-local-name');
    expect(await second.sync.sync()).toMatchObject({ status: 'synced' });
    expect(await fs.readFile(path.join(second.directory, 'profile.md'), 'utf8')).toContain(
      'concise',
    );
    await fs.appendFile(path.join(second.directory, 'profile.md'), 'Cite test results.\n');
    expect(await second.sync.sync()).toMatchObject({ status: 'synced' });
    expect(await first.sync.sync()).toMatchObject({ status: 'synced' });
    expect(await fs.readFile(path.join(first.directory, 'profile.md'), 'utf8')).toContain(
      'Cite test results.',
    );
  });

  it('preserves an existing remote README when connecting local memory history', async () => {
    const seed = await client('seed', 'main');
    await fs.writeFile(path.join(seed.directory, 'README.md'), 'Private memories\n');
    git(seed.directory, 'add', 'README.md');
    git(seed.directory, 'commit', '-m', 'Seed remote');
    git(seed.directory, 'push', '-u', 'origin', 'main');
    const local = await client('local', 'personal');
    await fs.writeFile(path.join(local.directory, 'profile.md'), 'Local preference\n');
    expect(await local.sync.sync()).toMatchObject({ status: 'synced' });
    expect(await fs.readFile(path.join(local.directory, 'README.md'), 'utf8')).toBe(
      'Private memories\n',
    );
    expect(git(root, '--git-dir', remote, 'show', 'main:profile.md')).toBe('Local preference\n');
  });

  it('reports genuine conflicts without overwriting the remote', async () => {
    const first = await client('first', 'main');
    await fs.writeFile(path.join(first.directory, 'profile.md'), 'Remote preference\n');
    expect(await first.sync.sync()).toMatchObject({ status: 'synced' });
    const remoteHead = git(root, '--git-dir', remote, 'rev-parse', 'main');
    const second = await client('second', 'main');
    await fs.writeFile(path.join(second.directory, 'profile.md'), 'Different local preference\n');
    expect(await second.sync.sync()).toMatchObject({ status: 'conflict' });
    expect(git(root, '--git-dir', remote, 'rev-parse', 'main')).toBe(remoteHead);
    expect(git(second.directory, 'diff', '--name-only', '--diff-filter=U')).toContain('profile.md');
  });

  it('does not label a missing remote as a merge conflict', async () => {
    const local = await client('local', 'main');
    await fs.writeFile(path.join(local.directory, 'profile.md'), 'Preference\n');
    await local.sync.configureRemote(path.join(root, 'missing.git'));
    expect(await local.sync.sync()).toMatchObject({ status: 'failed' });
  });

  it('isolates memory inside a parent repository without changing or pushing parent history', async () => {
    const parent = await client('home', 'main');
    await fs.writeFile(path.join(parent.directory, 'private.txt'), 'Unrelated home document\n');
    git(parent.directory, 'add', 'private.txt');
    git(parent.directory, 'commit', '-m', 'Private history');
    const parentHead = git(parent.directory, 'rev-parse', 'HEAD');
    const directory = path.join(parent.directory, '.comet', 'memory');
    await fs.mkdir(directory, { recursive: true });
    const sync = new GitMemorySync(directory);
    expect(await sync.remote()).toBeNull();
    expect(await sync.sync()).toMatchObject({ status: 'local-only' });
    git(directory, 'config', 'user.name', 'Memory test');
    git(directory, 'config', 'user.email', 'memory@example.invalid');
    const memoryRemote = path.join(root, 'memory.git');
    git(root, 'init', '--bare', memoryRemote);
    await sync.configureRemote(memoryRemote);
    await fs.writeFile(path.join(directory, 'profile.md'), 'Memory preference\n');
    expect(await sync.sync()).toMatchObject({ status: 'synced' });
    expect(git(parent.directory, 'remote', 'get-url', 'origin').trim()).toBe(remote);
    expect(git(parent.directory, 'rev-parse', 'HEAD')).toBe(parentHead);
    expect(git(root, '--git-dir', memoryRemote, 'log', '--all', '--format=%s')).not.toContain(
      'Private history',
    );
    expect(
      git(root, '--git-dir', memoryRemote, 'ls-tree', '-r', '--name-only', '--full-tree', 'HEAD'),
    ).not.toContain('private.txt');
    const another = path.join(parent.directory, 'second-memory');
    const configured = new GitMemorySync(another);
    await configured.configureRemote(memoryRemote);
    expect(await configured.remote()).toBe(memoryRemote);
    expect(git(parent.directory, 'remote', 'get-url', 'origin').trim()).toBe(remote);
  });
});
