import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  applicationRuntimeRoot,
  ensureApplicationRuntimeDependency,
} from '../../platform/install/application-runtime.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-link-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const destination = () => path.join(root, 'node_modules/@rpamis/comet');
const owner = () => path.join(root, 'node_modules/@rpamis/.comet-runtime-link.json');
const link = async (target: string) =>
  fs.symlink(target, destination(), process.platform === 'win32' ? 'junction' : 'dir');

it('creates a managed link and serializes concurrent re-entry', async () => {
  await Promise.all(Array.from({ length: 5 }, () => ensureApplicationRuntimeDependency(root)));
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
  expect(JSON.parse(await fs.readFile(owner(), 'utf8')).target).toBe(
    await applicationRuntimeRoot(),
  );
});
it('repairs a managed dangling previous installation without touching its target', async () => {
  await ensureApplicationRuntimeDependency(root);
  const previous = path.join(root, 'removed-runtime');
  const record = JSON.parse(await fs.readFile(owner(), 'utf8'));
  record.target = previous;
  await fs.writeFile(owner(), JSON.stringify(record));
  await fs.unlink(destination());
  await link(previous);
  await ensureApplicationRuntimeDependency(root);
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
  await expect(fs.lstat(previous)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('replays an interrupted rebind intent while preserving the previous installation', async () => {
  await ensureApplicationRuntimeDependency(root);
  const previous = path.join(root, 'old-runtime');
  await fs.mkdir(previous);
  await fs.writeFile(path.join(previous, 'keep'), 'original');
  const record = JSON.parse(await fs.readFile(owner(), 'utf8'));
  record.previousTarget = previous;
  await fs.writeFile(owner(), JSON.stringify(record));
  await fs.unlink(destination());
  await link(previous);
  await ensureApplicationRuntimeDependency(root);
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
  expect(await fs.readFile(path.join(previous, 'keep'), 'utf8')).toBe('original');
});
it('requires exact target confirmation for an unmarked legacy dangling link', async () => {
  await fs.mkdir(path.dirname(destination()), { recursive: true });
  const previous = path.join(root, 'legacy-missing');
  await link(previous);
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow('核对以下旧目标');
  const expectedLinkTarget = await fs.readlink(destination());
  expect(path.toNamespacedPath(path.resolve(expectedLinkTarget))).toBe(
    path.toNamespacedPath(previous),
  );
  await expect(
    ensureApplicationRuntimeDependency(root, { expectedLinkTarget: 'wrong' }),
  ).rejects.toThrow('目标已变化');
  await ensureApplicationRuntimeDependency(root, { expectedLinkTarget });
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
});
it('never replaces a real directory or a namespace symlink', async () => {
  await fs.mkdir(destination(), { recursive: true });
  await fs.writeFile(path.join(destination(), 'keep'), 'user');
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow('不是托管符号链接');
  expect(await fs.readFile(path.join(destination(), 'keep'), 'utf8')).toBe('user');
  const other = await fs.mkdtemp(path.join(root, 'other-'));
  await fs.symlink(
    path.join(root, 'node_modules'),
    path.join(other, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(ensureApplicationRuntimeDependency(other)).rejects.toThrow('目录存在冲突');
});
it('rejects tampered ownership metadata rather than trusting another destination', async () => {
  await ensureApplicationRuntimeDependency(root);
  const record = JSON.parse(await fs.readFile(owner(), 'utf8'));
  record.destination += '-other';
  await fs.writeFile(owner(), JSON.stringify(record));
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow('托管记录无效');
});

it('rejects ownership metadata replaced between inspection and open', async () => {
  await ensureApplicationRuntimeDependency(root);
  const originalOpen = fs.open.bind(fs);
  let replaced = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === owner() && !replaced) {
      replaced = true;
      const content = await fs.readFile(owner());
      await fs.rename(owner(), `${owner()}.saved`);
      await fs.writeFile(owner(), content);
    }
    return originalOpen(...args);
  });
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow(/changed|变化/);
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
});
it('rejects a namespace replaced while reading ownership metadata without publishing outside', async () => {
  await ensureApplicationRuntimeDependency(root);
  const namespace = path.dirname(destination());
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.copyFile(owner(), path.join(outside, path.basename(owner())));
  const originalOpen = fs.open.bind(fs);
  let replaced = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === owner() && !replaced) {
      replaced = true;
      await fs.rename(namespace, `${namespace}.saved`);
      await fs.symlink(outside, namespace, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return originalOpen(...args);
  });
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow(/changed|变化/);
  expect(await fs.readdir(outside)).toEqual([path.basename(owner())]);
});
it('rejects oversized ownership metadata before reading it', async () => {
  await ensureApplicationRuntimeDependency(root);
  await fs.writeFile(owner(), ' '.repeat(16385));
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow(/exceeds|过大/);
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
});

it('recovers an intent left by a failed link publication', async () => {
  await ensureApplicationRuntimeDependency(root);
  const previous = path.join(root, 'old-runtime');
  await fs.mkdir(previous);
  await fs.writeFile(path.join(previous, 'keep'), 'original');
  const record = JSON.parse(await fs.readFile(owner(), 'utf8'));
  record.target = previous;
  await fs.writeFile(owner(), JSON.stringify(record));
  await fs.unlink(destination());
  await link(previous);
  const originalSymlink = fs.symlink.bind(fs);
  let failed = false;
  const injection = vi
    .spyOn(fs, 'symlink')
    .mockImplementation(async (...args: Parameters<typeof fs.symlink>) => {
      if (String(args[1]).endsWith('.link') && !failed) {
        failed = true;
        throw new Error('injected publication failure');
      }
      return originalSymlink(...args);
    });
  await expect(ensureApplicationRuntimeDependency(root)).rejects.toThrow(
    'injected publication failure',
  );
  injection.mockRestore();
  expect(JSON.parse(await fs.readFile(owner(), 'utf8')).previousTarget).toBe(
    await fs.readlink(destination()),
  );
  await ensureApplicationRuntimeDependency(root);
  expect(await fs.realpath(destination())).toBe(await applicationRuntimeRoot());
  expect(await fs.readFile(path.join(previous, 'keep'), 'utf8')).toBe('original');
});
