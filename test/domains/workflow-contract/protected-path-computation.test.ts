import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  inspectProtectedProjectPath,
  createProtectedProjectReadSession,
} from '../../../domains/workflow-contract/protected-project-path.js';
import {
  invalidateHookReadCache,
  runWithHookReadCache,
} from '../../../platform/process/hook-read-cache.js';

describe('protected chain pure path computations', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-path-computation-')));
    await fs.writeFile(path.join(root, 'file'), 'fixture');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  // 不指定 expected，避开既有整体检查缓存，确保每次都执行路径链安全检查。
  const inspect = (projectRoot: string, relative = 'file') =>
    inspectProtectedProjectPath(projectRoot, relative, { label: 'Fixture' });

  it('rejects a cached directory replaced by a junction before reading its leaf', async () => {
    const source = path.join(root, 'source');
    const saved = path.join(root, 'source-saved');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-path-session-outside-'));
    try {
      await fs.mkdir(source);
      await fs.writeFile(path.join(source, 'file'), 'inside');
      await fs.writeFile(path.join(outside, 'file'), 'outside');
      const session = await createProtectedProjectReadSession(root, 'Observed inputs');
      await session.observeDirectory('source');
      await fs.rename(source, saved);
      await fs.symlink(outside, source, process.platform === 'win32' ? 'junction' : 'dir');
      const opened = vi.spyOn(fs, 'open');
      await expect(session.hash('source/file')).rejects.toThrow(/outside|junction|symbolic link/);
      expect(
        opened.mock.calls.some(([target]) => String(target) === path.join(source, 'file')),
      ).toBe(false);
      await fs.unlink(source);
      await fs.rename(saved, source);
      await expect(session.finish()).rejects.toThrow('directory changed');
      expect(await fs.readFile(path.join(outside, 'file'), 'utf8')).toBe('outside');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('allows an excluded directory entry but rejects a newly added input', async () => {
    await fs.mkdir(path.join(root, '.next'));
    await fs.writeFile(path.join(root, '.next', 'input'), 'bound input');
    const options = {
      ignoredDirectoryEntries: (ref: string) =>
        ref === '.next' ? (entry: import('node:fs').Dirent) => entry.name === 'trace' : undefined,
    };
    const first = await createProtectedProjectReadSession(root, 'Observed inputs', options);
    await first.hash('.next/input');
    await fs.writeFile(path.join(root, '.next', 'trace'), 'volatile trace');
    await expect(first.finish()).resolves.toEqual({ changedDirectories: ['.next'] });
    const second = await createProtectedProjectReadSession(root, 'Observed inputs', options);
    await second.hash('.next/input');
    await fs.writeFile(path.join(root, '.next', 'new-input'), 'new bound input');
    await expect(second.finish()).rejects.toThrow('directory changed');
  });

  it('reuses only containment arithmetic within a scope and clears it on invalidation and exit', async () => {
    const relative = vi.spyOn(path, 'relative');
    const target = path.join(root, 'file');
    const comparisons = () =>
      relative.mock.calls.filter(([from, to]) => from === root && to === target).length;
    await runWithHookReadCache(async () => {
      await inspect(root);
      expect(comparisons()).toBe(2); // 词法与物理路径各检查一次
      await inspect(root);
      expect(comparisons()).toBe(3); // 仍执行词法检查
      invalidateHookReadCache();
      await inspect(root);
      expect(comparisons()).toBe(5);
    });
    await runWithHookReadCache(() => inspect(root));
    expect(comparisons()).toBe(7);
    await inspect(root);
    await inspect(root);
    expect(comparisons()).toBe(11); // 无作用域时，每次都执行两种检查
  });

  it('separates both full realpath roots and targets without normalizing their keys', async () => {
    const secondRoot = path.join(root, 'second');
    await fs.mkdir(secondRoot);
    await fs.writeFile(path.join(secondRoot, 'file'), 'fixture');
    await fs.writeFile(path.join(root, 'other'), 'fixture');
    const actualRealpath = fs.realpath.bind(fs);
    const sharedTarget = path.join(root, 'file');
    vi.spyOn(fs, 'realpath').mockImplementation(async (target, options) => {
      if (target === path.join(secondRoot, 'file')) return sharedTarget;
      if (target === path.join(root, 'other')) return path.join(path.dirname(root), 'outside');
      return actualRealpath(target, options);
    });
    await runWithHookReadCache(async () => {
      await expect(inspect(root)).resolves.toMatchObject({ exists: true, kind: 'file' });
      await expect(inspect(secondRoot)).rejects.toThrow(
        'Fixture resolves outside the project root',
      );
      await expect(inspect(root, 'other')).rejects.toThrow(
        'Fixture resolves outside the project root',
      );
    });
  });

  it('preserves exact ancestor and symbolic-link diagnostics', async () => {
    await expect(inspect(root, 'file/child')).rejects.toThrow(
      'Fixture ancestor file must be a real directory',
    );
    const link = path.join(root, 'link');
    await fs.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(inspect(root, 'link/file')).rejects.toThrow(
      'Fixture crosses a symbolic link or junction at link',
    );
  });

  it('uses the host absolute-path semantics, including case differences', async () => {
    await fs.mkdir(path.join(root, 'MixedCase'));
    await fs.writeFile(path.join(root, 'MixedCase', 'file'), 'fixture');
    const actualRealpath = fs.realpath.bind(fs);
    const target = path.join(root, 'MixedCase', 'file');
    const canonical = target.toUpperCase();
    expect(path.isAbsolute(root)).toBe(true);
    expect(path.isAbsolute(canonical)).toBe(true);
    vi.spyOn(fs, 'realpath').mockImplementation(async (value, options) =>
      value === target ? canonical : actualRealpath(value, options),
    );
    const relative = path.relative(root, canonical);
    const inside =
      relative === '' ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
    await runWithHookReadCache(async () => {
      for (let count = 0; count < 2; count += 1) {
        if (inside)
          await expect(inspect(root, 'MixedCase/file')).resolves.toMatchObject({ exists: true });
        else
          await expect(inspect(root, 'MixedCase/file')).rejects.toThrow(
            'Fixture resolves outside the project root',
          );
      }
    });
  });
});
