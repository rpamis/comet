import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createFileRuntimeStore,
  listFileRuntimeStoreRuns,
  type RuntimeRecord,
} from '../engine/runtime.js';
import {
  parseChangeRuntimeOwner,
  registerSdkChangeOwner,
  registerCompatChangeOwner,
  closeSdkChangeOwner,
  readChangeRuntimeOwner,
} from './change-runtime-owner.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from './protected-project-path.js';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  ensureWorkspaceRuntimeRoot,
  isWorkspaceRuntimeMigrationFence,
} from './workspace-runtime.js';

/** 项目升级/明确导入入口。仅导入业务数据；源目录和旧物理 revision 原样保留。 */
export async function importLegacyWorkspaceRuntimeData(projectRoot: string) {
  const source = await inspectProtectedProjectPath(projectRoot, '.comet/runtime', {
    label: '旧 Runtime 业务导入',
  });
  if (!source.exists || (await isWorkspaceRuntimeMigrationFence(source.target)))
    return { imported: [] as string[], preservedSource: source.target };
  if (!(await fs.lstat(source.target)).isDirectory())
    throw new Error('旧 Runtime 业务来源必须是真实目录');
  const target = await ensureWorkspaceRuntimeRoot(projectRoot),
    imported: string[] = [];
  const names = async (root: string, ref: string) => {
    const entry = await inspectProtectedProjectPath(root, ref, {
      label: '旧业务目录',
      expected: 'directory',
    });
    return entry.exists ? await fs.readdir(entry.target) : [];
  };
  for (const relative of [
    'sdk-runs/native',
    'sdk-runs/classic',
    ...(await names(source.target, 'applications')).map((id) => 'applications/' + id),
  ]) {
    const application = relative.startsWith('applications/');
    const options = {
      rootDir: path.join(source.target, relative),
      ...(!application ? { singleWriter: true as const } : {}),
      ...(application ? { mirroredRevisionPaths: ['run.revision'] as const } : {}),
    };
    const from = createFileRuntimeStore<RuntimeRecord>(options),
      to = createFileRuntimeStore<RuntimeRecord>({
        ...options,
        rootDir: path.join(target, relative),
      });
    for (const item of await listFileRuntimeStoreRuns<RuntimeRecord>(options)) {
      if (item.error || !item.record)
        throw new Error(
          '旧 Run 无法导入：' +
            relative +
            '/' +
            item.storageKey +
            ' ' +
            (item.error?.message ?? '记录缺失'),
        );
      const record = item.record;
      if (await to.read(record.runId)) continue;
      if (await to.restoreCheckpoint!(record.runId, null, record)) {
        if ((await from.readDisposition(record.runId)) === 'closed')
          await to.closeRun!(record.runId, record.revision);
        imported.push(relative + '/' + record.runId);
      }
    }
  }
  for (const partition of ['change-owners', 'change-owner-history'])
    for (const workflow of ['native', 'classic'] as const) {
      for (const file of await names(source.target, partition + '/' + workflow)) {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.json$/u.test(file)) continue;
        const ref = partition + '/' + workflow + '/' + file;
        const owner = parseChangeRuntimeOwner(
          JSON.parse(
            (
              await readProtectedProjectFile(source.target, ref, 16384, { label: '旧需求归属' })
            ).bytes.toString('utf8'),
          ),
          workflow,
          file.slice(0, -5),
        );
        const existing = await readChangeRuntimeOwner(projectRoot, workflow, owner.change);
        if (existing) {
          if (
            existing.format !== owner.format ||
            (existing.format === 'sdk' &&
              owner.format === 'sdk' &&
              (existing.application !== owner.application || existing.runId !== owner.runId))
          )
            throw new Error('旧需求与当前归属不一致：' + owner.change);
          continue;
        }
        if (owner.format === 'sdk') {
          const root =
            owner.application === 'native'
              ? 'sdk-runs/native'
              : owner.application.startsWith('classic-')
                ? 'sdk-runs/classic'
                : 'applications/' + owner.application;
          if (
            !(await createFileRuntimeStore<RuntimeRecord>({
              rootDir: path.join(target, root),
              ...(root.startsWith('applications/')
                ? { mirroredRevisionPaths: ['run.revision'] as const }
                : {}),
            }).read(owner.runId))
          )
            throw new Error('旧需求缺少原 Run：' + owner.change);
          await registerSdkChangeOwner(projectRoot, owner);
          if (partition === 'change-owner-history') await closeSdkChangeOwner(projectRoot, owner);
        } else await registerCompatChangeOwner(projectRoot, owner);
        imported.push(ref);
      }
    }
  // 只保留业务记录及真实归档事务，不复制检查缓存、进程记录、锁、SQLite 或工作区迁移日志。
  const copy = async (ref: string) =>
    importLegacyBusinessFile(source.target, ref, target, ref, imported);
  const copyTree = async (ref: string): Promise<void> => {
    const directory = await inspectProtectedProjectPath(source.target, ref, {
      label: '旧业务记录目录',
      expected: 'directory',
    });
    if (!directory.exists) return;
    for (const entry of await fs.readdir(directory.target, { withFileTypes: true })) {
      const child = ref + '/' + entry.name;
      if (entry.isDirectory()) await copyTree(child);
      else if (entry.isFile()) await copy(child);
      else throw new Error('旧业务记录不能包含链接：' + child);
    }
  };
  for (const id of await names(source.target, 'native/changes')) {
    for (const file of [
      'workspace.json',
      'supervisor/state.json',
      'run-state.json',
      'trajectory.jsonl',
      'checkpoint.json',
    ])
      await copy('native/changes/' + id + '/' + file);
    await copyTree('native/changes/' + id + '/checkpoints');
  }
  for (const partition of ['native/transactions', 'native/transaction-history']) {
    for (const entry of await names(source.target, partition)) {
      if (entry.startsWith('portable-archive-') && entry.endsWith('.json'))
        await copy(partition + '/' + entry);
      else if (!entry.includes('.')) {
        const transaction = partition + '/' + entry;
        for (const file of ['transaction.json', 'events.jsonl'])
          await copy(transaction + '/' + file);
        for (const directory of ['staged', 'backups'])
          await copyTree(transaction + '/' + directory);
      }
    }
  }
  for (const file of await names(source.target, 'native/sdk-archive-receipts'))
    if (file.endsWith('.json')) await copy('native/sdk-archive-receipts/' + file);
  for (const id of await names(source.target, 'classic-changes'))
    for (const file of [
      'run-state.json',
      'pending-action.json',
      'trajectory.jsonl',
      'context.md',
      'artifacts.json',
      'checkpoint.json',
      'coordination.json',
      'subagent-progress.md',
    ])
      await importLegacyBusinessFile(
        source.target,
        'classic-changes/' + id + '/.comet/' + file,
        target,
        'classic-changes/' + id + '/.comet/' + file,
        imported,
      );
  for (const file of await names(source.target, 'classic-delivery-receipts'))
    if (file.endsWith('.json'))
      await importLegacyBusinessFile(
        source.target,
        'classic-delivery-receipts/' + file,
        target,
        'classic-delivery-receipts/' + file,
        imported,
      );
  return { imported, preservedSource: source.target };
}

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
