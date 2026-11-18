import path from 'node:path';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from './protected-project-path.js';
import { isWorkspaceRuntimeMigrationFence } from './workspace-runtime.js';

/** 已知业务文件的单次导入；不覆盖当前数据，不搬迁或删除原文件。 */
export async function importLegacyBusinessFile(
  sourceRoot: string,
  sourceRef: string,
  targetRoot: string,
  targetRef: string,
  imported: string[] = [],
): Promise<void> {
  const source = await inspectProtectedProjectPath(sourceRoot, sourceRef, {
    label: '旧业务材料',
    expected: 'file',
  });
  if (!source.exists || (await isWorkspaceRuntimeMigrationFence(source.target))) return;
  const current = await inspectProtectedProjectPath(targetRoot, targetRef, {
    label: '当前业务材料',
    expected: 'file',
  });
  if (current.exists) return;
  const bytes = (
    await readProtectedProjectFile(sourceRoot, sourceRef, Number.MAX_SAFE_INTEGER, {
      label: '旧业务材料',
    })
  ).bytes;
  await ensureProtectedProjectDirectory(targetRoot, path.posix.dirname(targetRef), {
    label: '业务导入目录',
  });
  try {
    await atomicWriteContainedText(current.target, bytes.toString('utf8'), {
      containedRoot: targetRoot,
      exclusive: true,
    });
    imported.push(targetRef);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
