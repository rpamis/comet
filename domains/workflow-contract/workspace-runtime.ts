import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRuntimeRootSync } from '../../platform/paths/workspace-runtime.js';
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
export { resolveWorkspaceRuntimeRootSync };

/** 普通路径解析不创建目录、迁移旧布局或核对目录世代。 */
export async function resolveWorkspaceRuntimeRoot(projectRoot: string): Promise<string> {
  return resolveWorkspaceRuntimeRootSync(projectRoot);
}
export async function readWorkspaceRuntimeRoots(projectRoot: string): Promise<string[]> {
  return [resolveWorkspaceRuntimeRootSync(projectRoot)];
}
async function ensureDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) {
    await ensureDirectory(parent);
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Runtime 路径必须是真实目录：' + directory);
}
/** 仅在实际写入入口创建当前数据目录。 */
export async function ensureWorkspaceRuntimeRoot(projectRoot: string): Promise<string> {
  const root = resolveWorkspaceRuntimeRootSync(projectRoot);
  await ensureDirectory(root);
  return root;
}

/** 只识别已经存在的旧标记；不访问标记声明的路径，也不恢复旧迁移。 */
export async function isWorkspaceRuntimeMigrationFence(
  source: string,
  _target?: string,
  _options?: { projectRoot: string; ignoreForeignWorkspaceFence?: boolean },
): Promise<boolean> {
  try {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('旧 Runtime 路径不能是符号链接：' + source);
    const file = stat.isDirectory() ? path.join(source, '.comet-runtime-migration.json') : source;
    const fileStat = await fs.lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;
    let value;
    try {
      value = JSON.parse(
        (
          await readFileRaceSafe(file, Number.MAX_SAFE_INTEGER, { label: '旧 Runtime 标记' })
        ).bytes.toString('utf8'),
      );
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
    if (
      value?.schema !== 'comet.workspace-runtime-migration.v1' ||
      typeof value.workspaceId !== 'string' ||
      typeof value.source !== 'string' ||
      typeof value.target !== 'string' ||
      !['file', 'directory'].includes(value.kind)
    )
      return false;
    return (
      !stat.isDirectory() ||
      (await fs.readdir(source)).every((name) => name === '.comet-runtime-migration.json')
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
