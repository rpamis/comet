#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (
    !['--project-root', '--base', '--head'].includes(flag) ||
    value === undefined ||
    (value === '' && flag !== '--base') ||
    value.startsWith('--')
  ) {
    console.error(
      '用法：check-sdk-fixtures.mjs --base <比较基线> [--head <候选>] [--project-root <项目>]',
    );
    process.exit(1);
  }
  options.set(flag, value);
}
const projectRoot = path.resolve(options.get('--project-root') ?? repositoryRoot);
function git(args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function commit(ref, label) {
  try {
    return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`${label}不可用：${ref}；获取完整 Git 历史后重新检查`);
  }
}
try {
  const requestedBase = options.get('--base');
  const base = commit(
    !requestedBase || /^0{40}$/u.test(requestedBase) ? 'origin/master' : requestedBase,
    '比较基线',
  );
  const head = commit(options.get('--head') ?? 'HEAD', '候选提交');
  const baselineFiles = git(['ls-tree', '-r', '-z', '--name-only', base, '--', 'test/fixtures'])
    .split('\0')
    .filter(Boolean);
  const frozenRoots = new Set(
    baselineFiles
      .map((file) => file.match(/^test\/fixtures\/runtime-sdk[^/]+\//u)?.[0])
      .filter(Boolean),
  );
  const changed = git([
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    head,
    '--',
    'test/fixtures',
  ])
    .split('\0')
    .filter(Boolean);
  const invalid = changed.filter((file) => [...frozenRoots].some((root) => file.startsWith(root)));
  if (invalid.length) {
    throw new Error(
      `已存在的 SDK 恢复快照不能改写、删除或补写资源；新增版本目录并保留旧快照：\n${invalid.join('\n')}`,
    );
  }
  console.log(
    `SDK 恢复快照检查通过：保留 ${frozenRoots.size} 个基线版本目录；比较 ${base}..${head}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
