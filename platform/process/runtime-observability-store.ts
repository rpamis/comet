import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRuntimeLocation } from '../paths/workspace-runtime.js';

export async function runtimeObservabilityDatabasePath(
  projectRoot: string,
  create: boolean,
): Promise<string> {
  const location = resolveWorkspaceRuntimeLocation(projectRoot);
  const directory = path.join(location.workspaceRoot, 'observability');
  let current = location.dataRoot;
  for (const segment of ['', 'workspaces', location.workspaceId, 'observability']) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs
        .mkdir(current, { recursive: segment === '' })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Runtime 统计目录必须是普通目录');
  }
  const file = path.join(directory, 'performance.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const stat = await fs.lstat(file + suffix);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
        throw new Error('Runtime 统计文件无效');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return file;
}
