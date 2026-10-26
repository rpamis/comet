import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  gitStatusPaths,
  parseGitStatusPaths,
  parseGitStatusUntrackedPaths,
  readGitStatusPorcelain,
  readGitBlobs,
  runGitCommandAsync,
  readGitStatusPorcelainAsync,
  readGitStatusObservationAsync,
  parseGitStatusObservation,
} from '../../platform/process/git.js';

describe('Git process helpers', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-process-'));
    execFileSync('git', ['init', '-b', 'master'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'git-process@example.com'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Git Process Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), '{}\n');
    execFileSync('git', ['add', '.comet/current-change.json'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'test: add selection'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('derives exactly the untracked paths from the existing full porcelain observation', async () => {
    await fs.mkdir(path.join(projectRoot, 'nested'));
    for (const ref of ['two words.txt', '中文.txt', 'nested/added.txt', 'excluded.txt'])
      await fs.writeFile(path.join(projectRoot, ref), 'new\n');
    if (process.platform !== 'win32')
      await fs.writeFile(path.join(projectRoot, 'literal\\backslash'), 'new\n');
    await fs.writeFile(path.join(projectRoot, '.gitignore'), 'ignored/\n');
    await fs.mkdir(path.join(projectRoot, 'ignored'));
    await fs.writeFile(path.join(projectRoot, 'ignored', 'output'), 'ignored\n');
    execFileSync('git', ['mv', '.comet/current-change.json', 'renamed'], { cwd: projectRoot });
    const paths = ['.', ':(exclude,literal)excluded.txt'];
    const legacy = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths],
      { cwd: projectRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
      .sort();
    expect(
      parseGitStatusUntrackedPaths(await readGitStatusPorcelainAsync(projectRoot, paths)),
    ).toEqual(legacy);
    expect(
      parseGitStatusUntrackedPaths(
        'R  renamed\0?? rename source\0C  copied\0?? copy source\0?? untracked\nline\0?? space \0!! ignored\0',
      ),
    ).toEqual(['space ', 'untracked\nline']);
    expect(() => parseGitStatusUntrackedPaths('R  target\0')).toThrow('incomplete rename');
    expect(parseGitStatusUntrackedPaths('?? literal\\backslash\0')).toEqual(['literal\\backslash']);
  });

  it('binds HEAD and branch to the same observation while preserving exact legacy porcelain bytes', async () => {
    const check = async () => {
      const [head, ref] = execFileSync(
        'git',
        ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'],
        { cwd: projectRoot, encoding: 'utf8' },
      )
        .trim()
        .split(/\r?\n/u);
      expect(await readGitStatusObservationAsync(projectRoot)).toEqual({
        head,
        branch: ref.startsWith('refs/heads/') ? ref.slice(11) : '',
        status: readGitStatusPorcelain(projectRoot),
      });
    };
    await check();
    execFileSync('git', ['mv', '.comet/current-change.json', 'renamed space'], {
      cwd: projectRoot,
    });
    await fs.writeFile(path.join(projectRoot, 'renamed space'), 'changed\n');
    await fs.writeFile(path.join(projectRoot, '中文.txt'), 'new\n');
    await check();
    execFileSync('git', ['add', '.'], { cwd: projectRoot });
    execFileSync('git', ['commit', '-m', 'updated'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['switch', '--detach', 'HEAD'], { cwd: projectRoot, stdio: 'ignore' });
    await check();
    const id = 'a'.repeat(64);
    for (const branch of ['(detached)', '(NULL)', '(null)']) {
      execFileSync('git', ['switch', '-c', branch], { cwd: projectRoot, stdio: 'ignore' });
      await check();
    }
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: projectRoot });
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/remotes/origin/main'], { cwd: projectRoot });
    await check();
    expect(
      parseGitStatusObservation(
        `# branch.oid ${id}\0# branch.head feature/test\0# future ignored\0? literal\\path\0`,
      ),
    ).toEqual({ head: id, branch: 'feature/test', status: '?? literal\\path\0' });
    expect(() => parseGitStatusObservation('# branch.oid (initial)\0# branch.head main\0')).toThrow(
      'HEAD',
    );
    expect(() =>
      parseGitStatusObservation(`# branch.oid ${id}\0# branch.head main\0unknown\0`),
    ).toThrow();
  });

  it('preserves a leading dot when a tracked path is deleted', async () => {
    await fs.rm(path.join(projectRoot, '.comet', 'current-change.json'));

    expect(gitStatusPaths(projectRoot)).toEqual(['.comet/current-change.json']);
  });

  it('preserves legacy status for conflicts, submodule changes, exclusions and malformed observations', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const compare = async (paths: string[] = []) =>
      expect((await readGitStatusObservationAsync(projectRoot, paths)).status).toBe(
        readGitStatusPorcelain(projectRoot, paths),
      );
    await fs.writeFile(path.join(projectRoot, 'conflict'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('switch', '-c', 'other');
    await fs.writeFile(path.join(projectRoot, 'conflict'), 'other\n');
    git('commit', '-am', 'other');
    git('switch', 'master');
    await fs.writeFile(path.join(projectRoot, 'conflict'), 'master\n');
    git('commit', '-am', 'master');
    expect(() => git('merge', 'other')).toThrow();
    await compare();
    git('merge', '--abort');
    const child = path.join(projectRoot, 'child');
    await fs.mkdir(child);
    const sub = (...args: string[]) => execFileSync('git', args, { cwd: child, stdio: 'ignore' });
    sub('init');
    sub('config', 'user.name', 'Test');
    sub('config', 'user.email', 'test@example.com');
    await fs.writeFile(path.join(child, 'tracked'), 'base\n');
    sub('add', '.');
    sub('commit', '-m', 'base');
    git('add', 'child');
    git('commit', '-m', 'child');
    await fs.writeFile(path.join(child, 'untracked'), 'new\n');
    await compare();
    await fs.writeFile(path.join(child, 'tracked'), 'modified\n');
    await compare();
    sub('commit', '-am', 'next');
    await compare();
    await fs.writeFile(path.join(projectRoot, 'excluded'), 'new\n');
    if (process.platform !== 'win32') {
      await fs.writeFile(path.join(projectRoot, 'line\nspace '), 'new\n');
      await fs.writeFile(path.join(projectRoot, 'literal\\path'), 'new\n');
    }
    await compare(['.', ':(exclude,literal)excluded']);
    const header = `# branch.oid ${'a'.repeat(40)}\0# branch.head main\0`;
    for (const suffix of [
      '? ',
      '? path',
      '1 .M N... 100644',
      '2 R. N... 100644 100644 100644 ' + 'a'.repeat(40) + ' ' + 'a'.repeat(40) + ' R100 target\0',
    ])
      expect(() => parseGitStatusObservation(header + suffix)).toThrow();
    expect(() => parseGitStatusObservation(header + '# branch.head main\0')).toThrow();
  });

  it('reads asynchronous Git queries without changing porcelain bytes or hiding failures', async () => {
    await fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), 'edited\n');
    await fs.writeFile(path.join(projectRoot, 'untracked space '), 'new\n');
    expect(await readGitStatusPorcelainAsync(projectRoot)).toBe(
      readGitStatusPorcelain(projectRoot),
    );
    expect(await runGitCommandAsync(projectRoot, ['rev-parse', 'HEAD'])).toMatch(/^[a-f0-9]{40}$/u);
    expect(
      await runGitCommandAsync(path.relative(process.cwd(), projectRoot), ['rev-parse', 'HEAD']),
    ).toBe(await runGitCommandAsync(projectRoot, ['rev-parse', 'HEAD']));
    await expect(
      runGitCommandAsync(projectRoot, ['rev-parse', '--verify', 'missing-ref']),
    ).rejects.toThrow('git rev-parse --verify missing-ref failed');
  });

  it('parses both rename paths and preserves leading status whitespace and path whitespace', () => {
    expect(parseGitStatusPaths(' M .hidden\0R  new name\0old name\0?? trailing \0')).toEqual([
      '.hidden',
      'new name',
      'old name',
      'trailing ',
    ]);
    expect(() => parseGitStatusPaths('R  target\0')).toThrow('incomplete rename');
  });

  it('reuses the excluded porcelain observation without dropping renamed source paths', async () => {
    await fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), 'changed\n');
    await fs.writeFile(path.join(projectRoot, 'excluded'), 'ignored\n');
    const raw = readGitStatusPorcelain(projectRoot, ['.', ':(exclude,literal)excluded']);
    expect(raw.startsWith(' M ')).toBe(true);
    expect(parseGitStatusPaths(raw)).toEqual(['.comet/current-change.json']);
    execFileSync('git', ['mv', '.comet/current-change.json', 'renamed'], { cwd: projectRoot });
    expect(
      parseGitStatusPaths(readGitStatusPorcelain(projectRoot, ['.', ':(exclude,literal)excluded'])),
    ).toEqual(['.comet/current-change.json', 'renamed']);
  });

  it('preserves UTF-8, empty content, and newlines while omitting oversized or missing blobs', () => {
    const put = (source: string) =>
      execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: projectRoot,
        input: source,
        encoding: 'utf8',
      }).trim();
    const text = ' \n中文\nline\n\n';
    const id = put(text);
    const empty = put('');
    const large = put('x'.repeat(129));
    expect(readGitBlobs(projectRoot, [id, empty, id, large, '0'.repeat(40)], 128)).toEqual(
      new Map([
        [id, text],
        [empty, ''],
      ]),
    );
    expect(() => readGitBlobs(projectRoot, ['HEAD:secret'])).toThrow('Invalid Git blob id');
    expect(readGitBlobs(projectRoot, [])).toEqual(new Map());
  });
});
