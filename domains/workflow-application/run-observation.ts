import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  listFileRuntimeStoreRuns,
  listFileRuntimeStoreRunSources,
  hashRuntimeValue,
  parseWorkflowRun,
} from '../engine/runtime.js';
import { readWorkspaceRuntimeRoots } from '../workflow-contract/workspace-runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readWorkflowApplicationRunRecord, type ApplicationRunRecord } from './application.js';
import {
  readApplicationFiles,
  applicationFilesHash,
  adaptApplicationSkill,
} from './skill-adapter.js';
import type { ApplicationIdentity, WorkflowApplicationManifest } from './types.js';

export interface WorkflowApplicationRunObservation {
  applicationId: string;
  storageKey: string;
  runId: string | null;
  record: ApplicationRunRecord | null;
  error: { code: string; message: string } | null;
}

export async function listWorkflowApplicationRunSources(
  projectRoot: string,
  options: { excludeApplications?: readonly string[] } = {},
) {
  const result = [];
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
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      if (options.excludeApplications?.includes(entry.name)) continue;
      const applicationId = entry.name;
      if (
        !/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(applicationId) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        result.push({
          applicationId,
          rootDir: target,
          storageKey: applicationId,
          runId: null,
          fingerprint: applicationId,
          error: { code: 'APPLICATION_UNREADABLE', message: '应用 Runtime 目录项目无效' },
        });
        continue;
      }
      for (const source of await listFileRuntimeStoreRunSources({
        rootDir: path.join(target, applicationId),
        mirroredRevisionPaths: ['run.revision'],
      }))
        result.push({ ...source, applicationId, rootDir: path.join(target, applicationId) });
    }
  }
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
): Promise<WorkflowApplicationRunObservation[]> {
  const roots = await readWorkspaceRuntimeRoots(projectRoot);
  const discovered = new Map<
    string,
    {
      applicationId: string;
      storageKey: string;
      runId: string | null;
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
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const applicationId = entry.name;
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
        for (const item of await listFileRuntimeStoreRuns<ApplicationRunRecord>({
          rootDir: path.join(target, applicationId),
          mirroredRevisionPaths: ['run.revision'],
        })) {
          const key = `${applicationId}:${item.runId ?? item.storageKey}`;
          const previous = discovered.get(key);
          discovered.set(key, {
            applicationId,
            storageKey: item.storageKey,
            runId: item.runId,
            error: previous?.error ?? item.error,
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
  return Promise.all(
    [...discovered.values()].map(async (item) => {
      if (!item.runId || item.error) return { ...item, record: null };
      try {
        const record = await readWorkflowApplicationRunRecord(
          projectRoot,
          item.applicationId,
          item.runId,
        );
        if (!record) throw new Error('应用 Run 已消失，请重新读取列表');
        record.run = parseWorkflowRun(record.run, item.runId);
        const root = await fs.realpath(projectRoot);
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
    }),
  );
}

/** 校验当前包与固定身份；只读取字节和 Skill 契约，不 import 应用实现。 */
export async function inspectWorkflowApplicationMaterial(identity: ApplicationIdentity): Promise<{
  status: 'matched' | 'changed' | 'unavailable';
  packageHash?: string;
  manifest?: WorkflowApplicationManifest;
  message?: string;
}> {
  try {
    const files = await readApplicationFiles(identity.packageRoot);
    const manifest = JSON.parse(
      Buffer.from(files['application.json'] ?? '', 'base64').toString('utf8'),
    ) as WorkflowApplicationManifest;
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
    return {
      status: contentHash === identity.contentHash ? 'matched' : 'changed',
      packageHash,
      manifest,
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
  message?: string;
}> {
  try {
    const packageHash = applicationFilesHash(await readApplicationFiles(packageRoot));
    return {
      status: packageHash === expectedPackageHash ? 'matched' : 'changed',
      packageHash,
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
