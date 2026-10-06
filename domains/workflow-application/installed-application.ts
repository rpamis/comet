import path from 'node:path';
import {
  readProtectedProjectFile,
  inspectProtectedProjectPath,
  ensureProtectedProjectDirectory,
} from '../workflow-contract/protected-project-path.js';
import { workflowApplicationStorageRoot } from '../../platform/paths/workflow-application-storage.js';
import { applicationError, applicationFilesHash, readApplicationFiles } from './skill-adapter.js';
import type { ApplicationDeliveryOptions } from './delivery.js';
export interface InstalledApplication {
  schema: 'comet.workflow.application.install.v1';
  id: string;
  version: string;
  contentHash: string;
  packageRef: string;
  entry?: { root: string; contentHash: string };
}

export function safeId(id: string): string {
  if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(id)) applicationError('应用身份无效');
  return id;
}

function storagePath(root: string, ref: string) {
  const absolute = path.resolve(root, ref);
  const volume = path.parse(absolute).root;
  return { volume, ref: path.relative(volume, absolute).replaceAll('\\', '/') };
}
export async function inspectStorage(root: string, ref: string, expected: 'file' | 'directory') {
  const location = storagePath(root, ref);
  return inspectProtectedProjectPath(location.volume, location.ref, {
    expected,
    label: 'SDK application installation',
  });
}
export async function ensureStorage(root: string, ref: string) {
  const location = storagePath(root, ref);
  return ensureProtectedProjectDirectory(location.volume, location.ref, {
    label: 'SDK application installation',
  });
}
export async function readInstalled(
  root: string,
  id: string,
): Promise<InstalledApplication | null> {
  const ref = `${safeId(id)}/current.json`;
  if (!(await inspectStorage(root, ref, 'file')).exists) return null;
  const location = storagePath(root, ref);
  const { bytes } = await readProtectedProjectFile(location.volume, location.ref, 1024 * 1024, {
    label: 'SDK application installation',
  });
  const value = JSON.parse(bytes.toString('utf8')) as InstalledApplication;
  if (
    value.schema !== 'comet.workflow.application.install.v1' ||
    value.id !== id ||
    !value.version?.trim() ||
    !/^[a-f\d]{64}$/u.test(value.contentHash) ||
    value.packageRef !== `${id}/versions/${value.contentHash}`
  )
    applicationError('安装记录无效；保留文件并重新预览');
  if (value.entry) {
    const base = path.dirname(path.dirname(root));
    const parent = path.dirname(value.entry.root ?? '');
    if (
      !path.isAbsolute(value.entry.root) ||
      ![path.join(base, '.claude/skills'), path.join(base, '.agents/skills')].includes(parent) ||
      !/^[a-f\d]{64}$/u.test(value.entry.contentHash) ||
      !/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(path.basename(value.entry.root))
    )
      applicationError('宿主入口安装记录无效；保留文件并核对原安装');
  }
  return value;
}

/** 查找新 Run 的默认版本；现有 Run 始终使用原不可变 packageRoot。 */
export async function resolveInstalledWorkflowApplication(
  options: ApplicationDeliveryOptions,
  id: string,
): Promise<string | null> {
  const root = workflowApplicationStorageRoot(options.projectRoot, options.scope, options.userRoot);
  const installed = await readInstalled(root, id);
  if (!installed) return null;
  const file = `${installed.packageRef}/application.json`;
  await inspectStorage(root, file, 'file');
  if (
    applicationFilesHash(await readApplicationFiles(path.join(root, installed.packageRef))) !==
    installed.contentHash
  )
    applicationError('已安装版本内容发生漂移；恢复原包后继续');
  return path.join(root, file);
}
