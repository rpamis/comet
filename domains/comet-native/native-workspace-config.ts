import { randomUUID } from 'node:crypto';
import { promises as fs, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';

import { gitStatusPaths, runGitCommand } from '../../platform/process/git.js';
import { atomicWriteJson } from './native-atomic-file.js';

const CONFIG = '.comet/config.yaml';
const snapshotFile = (root: string) =>
  path.join(resolveWorkspaceRuntimeRootSync(root), 'native', 'workspace-config.json');

/** Runtime 创建记录只说明配置路径归属；内容由 Agent 判断。 */
export function managedConfigMatches(root: string): boolean {
  try {
    if (runGitCommand(root, ['ls-files', '--', CONFIG])) return false;
    const file = path.join(root, CONFIG);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
    const saved = snapshotFile(root);
    for (const directory of [runtimeRoot, path.dirname(saved)]) {
      const metadata = lstatSync(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) return false;
    }
    const metadata = lstatSync(saved);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      realpathSync(saved) !== path.resolve(saved)
    )
      return false;
    const snapshot = JSON.parse(readFileSync(saved, 'utf8')) as {
      created?: boolean;
      hash?: string;
    };
    return snapshot.created === true || typeof snapshot.hash === 'string';
  } catch {
    return false;
  }
}

export async function recordNativeWorkspaceConfig(root: string): Promise<void> {
  const file = path.join(root, CONFIG);

  try {
    await fs.access(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(root);
  const snapshot = snapshotFile(root);
  await fs.mkdir(path.dirname(snapshot), { recursive: true });
  await atomicWriteJson(snapshot, { created: true }, { containedRoot: runtimeRoot });
}

export function nativeWorkspaceIsClean(root: string, allowed: readonly string[] = []): boolean {
  return gitStatusPaths(root).every(
    (candidate) =>
      allowed.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`)) ||
      (candidate === CONFIG && managedConfigMatches(root)),
  );
}

/** 清理已知 Runtime 配置前保留实际正文，用户编辑无需通过内容证明。 */
export async function removeNativeWorkspaceConfig(root: string): Promise<void> {
  if (!managedConfigMatches(root)) return;
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(root);
  const ref = 'native/preserved-configs/' + randomUUID() + '.yaml';
  const target = path.join(runtimeRoot, ref);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, CONFIG), target);
  await atomicWriteJson(
    snapshotFile(root),
    { created: true, preservedRef: ref },
    { containedRoot: runtimeRoot },
  );
  await fs.unlink(path.join(root, CONFIG));
}
