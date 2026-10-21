import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  listFileRuntimeStoreRuns,
  createFileRuntimeStore,
  readRuntimeProjection,
  iterateFileRuntimeStoreRunSources,
  hashRuntimeValue,
  parseWorkflowRun,
} from '../engine/runtime.js';
import { createApplicationStorageIndex } from './storage-index.js';
import { readWorkspaceRuntimeRoots } from '../workflow-contract/workspace-runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  parseWorkflowApplicationManifest,
  readWorkflowApplicationRunRecord,
  type ApplicationRunRecord,
} from './application.js';
import {
  readApplicationFiles,
  applicationFilesHash,
  adaptApplicationSkill,
} from './skill-adapter.js';
import type { ApplicationIdentity, WorkflowApplicationManifest } from './types.js';
import {
  readWorkflowApplicationDefinition,
  type WorkflowApplicationDefinition,
} from './application-definition.js';

export interface WorkflowApplicationRunObservation {
  applicationId: string;
  storageKey: string;
  runId: string | null;
  record: ApplicationRunRecord | null;
  error: { code: string; message: string } | null;
}

export async function* iterateWorkflowApplicationRunSources(
  projectRoot: string,
  options: { excludeApplications?: readonly string[] } = {},
) {
  for (const root of await readWorkspaceRuntimeRoots(projectRoot)) {
    const target = path.join(root, 'applications');
    const volume = path.parse(root).root;
    if (
      !(
        await inspectProtectedProjectPath(
          volume,
          path.relative(volume, target).replaceAll('\\', '/'),
          { label: '应用 Runtime 观测', expected: 'directory' },
        )
      ).exists
    )
      continue;
    for await (const entry of await fs.opendir(target)) {
      if (options.excludeApplications?.includes(entry.name)) continue;
      const applicationId = entry.name;
      if (
        !/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(applicationId) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        yield {
          applicationId,
          rootDir: target,
          storageKey: applicationId,
          runId: null,
          fingerprint: applicationId,
          error: { code: 'APPLICATION_UNREADABLE', message: '应用 Runtime 目录项目无效' },
        };
        continue;
      }
      for await (const source of iterateFileRuntimeStoreRunSources({
        rootDir: path.join(target, applicationId),
        mirroredRevisionPaths: ['run.revision'],
      }))
        yield { ...source, applicationId, rootDir: path.join(target, applicationId) };
    }
  }
}

export async function listWorkflowApplicationRunSources(
  projectRoot: string,
  options: { excludeApplications?: readonly string[] } = {},
) {
  const result = [];
  for await (const source of iterateWorkflowApplicationRunSources(projectRoot, options))
    result.push(source);
  return result;
}

export async function readWorkflowApplicationRunObservation(
  projectRoot: string,
  applicationId: string,
  runId: string,
): Promise<WorkflowApplicationRunObservation> {
  const item = { applicationId, runId, storageKey: hashRuntimeValue(runId) };
  try {
    const record = await readWorkflowApplicationRunRecord(projectRoot, applicationId, runId);
    if (!record) throw new Error('应用 Run 已消失，请重新读取列表');
    record.run = parseWorkflowRun(record.run, runId);
    if (
      path.resolve(record.application.projectRoot) !== (await fs.realpath(projectRoot)) ||
      !record.application.version ||
      !/^[a-f0-9]{64}$/u.test(record.application.contentHash)
    )
      throw new Error('应用固定身份与当前工作区不匹配');
    return { ...item, record, error: null };
  } catch (error) {
    return {
      ...item,
      record: null,
      error: {
        code: 'APPLICATION_UNREADABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** 返回固定身份和 SDK 保存的状态；单条失败不会遮住其他 Run。 */
export async function listWorkflowApplicationRunRecords(
  projectRoot: string,
  options: {
    applicationId?: string;
    excludeClosed?: boolean;
    excludeAbortedRegistrations?: boolean;
  } = {},
): Promise<WorkflowApplicationRunObservation[]> {
  const roots = await readWorkspaceRuntimeRoots(projectRoot);
  const discovered = new Map<
    string,
    {
      applicationId: string;
      storageKey: string;
      runId: string | null;
      record?: ApplicationRunRecord | null;
      error: WorkflowApplicationRunObservation['error'];
    }
  >();
  for (const root of roots) {
    const volume = path.parse(root).root;
    const target = path.join(root, 'applications');
    const inspection = await inspectProtectedProjectPath(
      volume,
      path.relative(volume, target).replaceAll('\\', '/'),
      { label: '应用 Runtime 观测', expected: 'directory' },
    );
    if (!inspection.exists) continue;
    for (const entry of (await fs.readdir(target, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const applicationId = entry.name;
      if (options.applicationId && applicationId !== options.applicationId) continue;
      if (
        !/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(applicationId) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        discovered.set(`invalid:${applicationId}`, {
          applicationId,
          storageKey: applicationId,
          runId: null,
          error: { code: 'APPLICATION_UNREADABLE', message: '应用 Runtime 目录项目无效' },
        });
        continue;
      }
      try {
        const rootDir = path.join(target, applicationId);
        const store = createFileRuntimeStore<ApplicationRunRecord>({
          rootDir,
          mirroredRevisionPaths: ['run.revision'],
        });
        const index = createApplicationStorageIndex({
          rootDir,
          read: (runId) => store.read(runId),
          holds: () => false,
        });
        for (const item of await listFileRuntimeStoreRuns<ApplicationRunRecord>(
          {
            rootDir: path.join(target, applicationId),
            mirroredRevisionPaths: ['run.revision'],
          },
          { excludeClosed: options.excludeClosed },
        )) {
          if (
            options.excludeAbortedRegistrations &&
            item.runId &&
            item.error &&
            (await index.isAbortedRegistration(item.runId).catch(() => false))
          )
            continue;
          const key = `${applicationId}:${item.runId ?? item.storageKey}`;
          const previous = discovered.get(key);
          discovered.set(key, {
            applicationId,
            storageKey: item.storageKey,
            runId: item.runId,
            record: item.record,
            error: previous
              ? {
                  code: 'APPLICATION_UNREADABLE',
                  message: '新旧应用 Runtime 同时存在，拒绝选择写入权威',
                }
              : item.error,
          });
        }
      } catch (error) {
        discovered.set(`${applicationId}:unreadable`, {
          applicationId,
          storageKey: applicationId,
          runId: null,
          error: {
            code: 'APPLICATION_UNREADABLE',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }
  const root = await fs.realpath(projectRoot);
  return [...discovered.values()].map((item) => {
    if (!item.runId || item.error) return { ...item, record: null };
    try {
      const record = item.record;
      if (!record) throw new Error('应用 Run 已消失，请重新读取列表');
      if (
        record.application.id !== item.applicationId ||
        record.runId !== record.run.runId ||
        record.revision !== record.run.revision
      )
        throw new Error('应用归属与 SDK Run 不一致');
      record.run = parseWorkflowRun(record.run, item.runId);
      if (
        path.resolve(record.application.projectRoot) !== root ||
        !record.application.version ||
        !/^[a-f0-9]{64}$/u.test(record.application.contentHash)
      )
        throw new Error('应用固定身份与当前工作区不匹配');
      return { ...item, record };
    } catch (error) {
      return {
        ...item,
        record: null,
        error: {
          code: 'APPLICATION_UNREADABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

/** 校验当前包与固定身份；只读取字节和 Skill 契约，不 import 应用实现。 */
export async function inspectWorkflowApplicationMaterial(identity: ApplicationIdentity): Promise<{
  status: 'matched' | 'changed' | 'unavailable';
  packageHash?: string;
  manifest?: WorkflowApplicationManifest;
  definition?: WorkflowApplicationDefinition;
  message?: string;
}> {
  try {
    const files = await readApplicationFiles(identity.packageRoot);
    const manifest = parseWorkflowApplicationManifest(
      JSON.parse(Buffer.from(files['application.json'] ?? '', 'base64').toString('utf8')),
    );
    if (
      manifest.schema !== 'comet.workflow.application.v1' ||
      manifest.id !== identity.id ||
      manifest.version !== identity.version ||
      !Array.isArray(manifest.skills)
    )
      throw new Error('应用清单与保存的固定版本不匹配');
    const skills = await Promise.all(
      manifest.skills.map((s) => adaptApplicationSkill(s, identity.packageRoot)),
    );
    const packageHash = applicationFilesHash(files);
    const contentHash = hashRuntimeValue({
      package: packageHash,
      skills: skills.map((s) => ({ id: s.id, contentHash: s.contentHash })),
    });
    const definition =
      contentHash === identity.contentHash
        ? readWorkflowApplicationDefinition(files, manifest)
        : undefined;
    return {
      status: contentHash === identity.contentHash ? 'matched' : 'changed',
      packageHash,
      manifest,
      ...(definition ? { definition } : {}),
      ...(contentHash === identity.contentHash
        ? {}
        : { message: '当前包或依赖内容已变化；保存的 Run 仍绑定原固定内容' }),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectWorkflowApplicationPackage(
  packageRoot: string,
  expectedPackageHash: string,
): Promise<{
  status: 'matched' | 'changed' | 'unavailable';
  packageHash?: string;
  manifest?: WorkflowApplicationManifest;
  definition?: WorkflowApplicationDefinition;
  message?: string;
}> {
  try {
    const files = await readApplicationFiles(packageRoot);
    const packageHash = applicationFilesHash(files);
    const manifest =
      packageHash === expectedPackageHash
        ? parseWorkflowApplicationManifest(
            JSON.parse(Buffer.from(files['application.json'] ?? '', 'base64').toString('utf8')),
          )
        : undefined;
    const definition = manifest ? readWorkflowApplicationDefinition(files, manifest) : undefined;
    return {
      status: packageHash === expectedPackageHash ? 'matched' : 'changed',
      packageHash,
      ...(manifest ? { manifest } : {}),
      ...(definition ? { definition } : {}),
      ...(packageHash === expectedPackageHash
        ? {}
        : { message: '当前候选包内容与保存的编译结果不匹配' }),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 只读逻辑投影保留池化载荷，不执行应用模块，也不迁移工作区。 */
export async function readWorkflowApplicationRunProjection(
  projectRoot: string,
  applicationId: string,
  runId: string,
) {
  if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(applicationId)) throw new Error('应用身份无效');
  const found = [];
  for (const root of await readWorkspaceRuntimeRoots(projectRoot)) {
    const projection = await readRuntimeProjection(
      createFileRuntimeStore<ApplicationRunRecord>({
        rootDir: path.join(root, 'applications', applicationId),
        mirroredRevisionPaths: ['run.revision'],
      }),
      runId,
    ).catch((error) => {
      if (error?.code === 'RUN_NOT_FOUND') return null;
      throw error;
    });
    if (projection) found.push(projection);
  }
  if (found.length > 1) throw new Error('新旧应用 Runtime 同时存在，拒绝选择读取权威');
  const projection = found[0];
  if (!projection) return null;
  const record = projection.record as ApplicationRunRecord;
  const identity = record.application;
  if (
    !identity ||
    identity.id !== applicationId ||
    path.resolve(identity.projectRoot) !== (await fs.realpath(projectRoot)) ||
    !identity.version ||
    !/^[a-f0-9]{64}$/u.test(identity.contentHash)
  )
    throw new Error('应用固定身份与当前工作区不匹配');
  return { application: identity, projection };
}
