import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

/** 定位当前 Runtime 的发布资源；安装与宿主预览复用同一来源。 */
export async function applicationRuntimeRoot(): Promise<string> {
  let cursor = path.dirname(fileURLToPath(import.meta.url));
  let runtimeRoot: string | undefined;
  while (cursor !== path.dirname(cursor)) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(cursor, 'package.json'), 'utf8'));
      if (pkg.name === '@rpamis/comet') {
        runtimeRoot = await fs.realpath(cursor);
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
  if (!runtimeRoot) throw new Error('找不到已安装的 Comet Runtime；保留应用并修复 Runtime 安装');
  return runtimeRoot;
}

/** 为用户目录中的应用提供当前已安装的 Runtime；链接位于版本包之外。 */
export async function ensureApplicationRuntimeDependency(storageRoot: string): Promise<void> {
  const runtimeRoot = await applicationRuntimeRoot();
  const namespace = path.join(storageRoot, 'node_modules/@rpamis');
  for (const directory of [path.dirname(namespace), namespace]) {
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime 依赖目录存在冲突');
  }
  const destination = path.join(namespace, 'comet');
  try {
    if ((await fs.realpath(destination)) !== runtimeRoot)
      throw new Error('Runtime 依赖已指向其他安装；保留现场并修复');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.symlink(runtimeRoot, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
}
