import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectCheckSnapshot,
  hashGitPaths,
} from '../../../domains/comet-classic/classic-check-snapshot.js';
import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic snapshot work budgets', () => {
  let root: string;
  let change: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const snapshot = () =>
    collectCheckSnapshot(root, change, undefined, { verificationReport: null });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-check-budget-'));
    await prepareClassicLegacyProject(root);
    change = path.join(root, 'openspec', 'changes', 'demo');
    await fs.mkdir(change, { recursive: true });
    git('init');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps 1000 dirty inputs plus one deleted tracked input within 50 Git calls', async () => {
    const names = Array.from(
      { length: 1001 },
      (_, index) => `input-${String(index).padStart(4, '0')}.txt`,
    );
    await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), 'old')));
    git('add', '.');
    git('commit', '-m', 'baseline');
    const before = await snapshot();
    await Promise.all(names.slice(1).map((name) => fs.writeFile(path.join(root, name), 'new')));
    await fs.unlink(path.join(root, names[0]));
    const { result, metrics } = await withCometRuntimeMetrics(snapshot);
    expect(metrics.gitCommands).toBeLessThanOrEqual(50);
    expect(result.digest).not.toBe(before.digest);
    expect(result.entries.find(({ p }) => p === names[0])?.h).toBe('missing');
    expect(
      result.entries.filter(({ p, h }) => p.startsWith('input-') && h.startsWith('git:')),
    ).toHaveLength(1000);
  });

  it('preserves successful batches around missing paths and directories', async () => {
    const names = Array.from({ length: 70 }, (_, index) => `input-${index}.txt`);
    await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), name)));
    await fs.mkdir(path.join(root, 'directory'));
    const paths = [...names.slice(0, 32), 'missing', 'directory', ...names.slice(32)];
    const { result, metrics } = await withCometRuntimeMetrics(async () =>
      hashGitPaths(root, paths),
    );
    expect([...result.keys()]).toEqual(names);
    expect(metrics.gitCommands).toBeLessThanOrEqual(17);
  });

  it('excludes output and runtime files before Git hashing', async () => {
    const identity = { argv: [process.execPath, '-e', ''], cwd: '.' };
    await fs.writeFile(
      path.join(root, '.comet', 'check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [{ ...identity, outputs: ['dist/**'] }],
      }),
    );
    await fs.writeFile(path.join(root, 'source.js'), 'source');
    git('add', '.');
    git('commit', '-m', 'baseline');
    const collect = () =>
      collectCheckSnapshot(root, change, identity, { verificationReport: null });
    const before = await withCometRuntimeMetrics(collect);
    const outputDirs = [
      path.join(root, 'dist'),
      path.join(change, '.comet', 'checks'),
      path.join(root, '.comet', 'runtime'),
    ];
    for (const directory of outputDirs) {
      await fs.mkdir(directory, { recursive: true });
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          fs.writeFile(path.join(directory, `${index}.log`), 'output'),
        ),
      );
    }
    const after = await withCometRuntimeMetrics(collect);
    expect(after.result.digest).toBe(before.result.digest);
    expect(after.metrics.gitCommands).toBe(before.metrics.gitCommands);
  });

  it('does not trust cached stat identities after same-size edits with restored timestamps', async () => {
    const identity = { argv: [process.execPath, '-e', ''], cwd: '.' };
    await fs.writeFile(
      path.join(root, '.comet', 'check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [{ ...identity, files: ['input.txt'] }],
      }),
    );
    const file = path.join(root, 'input.txt');
    await fs.writeFile(file, 'old');
    const original = await fs.stat(file);
    const options = { verificationReport: null, contentCache: new Map<string, string>() };
    // 模拟粗粒度文件系统：所有 lstat 时间戳均保持不变，仍必须读取内容。
    const lstat = fs.lstat.bind(fs);
    const stable = await fs.lstat(file, { bigint: true });
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await lstat(...args);
      if (String(args[0]) === file && typeof stat.size === 'bigint') {
        return Object.assign(stat, { mtimeNs: stable.mtimeNs, ctimeNs: stable.ctimeNs });
      }
      return stat;
    });
    const before = await collectCheckSnapshot(root, change, identity, options);
    await fs.writeFile(file, 'new');
    await fs.utimes(file, original.atime, original.mtime);
    const after = await collectCheckSnapshot(root, change, identity, {
      ...options,
      baseline: before.entries,
    });
    expect(after.digest).not.toBe(before.digest);
    expect(after.entries.find(({ p }) => p === 'input.txt')?.h).not.toBe(
      before.entries.find(({ p }) => p === 'input.txt')?.h,
    );
  });
});
