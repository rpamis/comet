import { memoizedHookReadSync } from '../process/hook-read-cache.js';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, type BigIntStats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WorkspaceRuntimeLocation {
  readonly projectRoot: string;
  readonly dataRoot: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly runtimeRoot: string;
}

function directoryGeneration(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

/** Windows 原生解析返回磁盘上的实际大小写，避免同一目录产生不同身份。 */
function canonicalExistingPath(target: string): string {
  return process.platform === 'win32' ? realpathSync.native(target) : realpathSync(target);
}

// 身份解析含多次 realpathSync；同一决策内对同一根重复解析数百次（探针遍历归档），
// 仅在激活读缓存的作用域内复用，其余调用保持逐次解析。
const cachedWorkspaceIdentity = memoizedHookReadSync('workspaceIdentity', computeWorkspaceIdentity);

export function resolveWorkspaceIdentity(projectRoot: string): {
  projectRoot: string;
  workspaceId: string;
} {
  return cachedWorkspaceIdentity(projectRoot);
}

/** 工作区身份关联这份 checkout 的创建实例；远端地址、分支和修改时间均不参与。 */
function computeWorkspaceIdentity(projectRoot: string): {
  projectRoot: string;
  workspaceId: string;
} {
  const root = canonicalExistingPath(path.resolve(projectRoot));
  const rootStat = lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory()) throw new Error(`工作区必须是目录：${projectRoot}`);
  const rootGeneration = directoryGeneration(rootStat);
  const identityFor = (gitDirectory: string, gitGeneration: string | null) => ({
    projectRoot: root,
    workspaceId: createHash('sha256')
      .update(
        JSON.stringify(['comet.workspace.v2', root, rootGeneration, gitDirectory, gitGeneration]),
      )
      .digest('hex'),
  });
  const dotGit = path.join(root, '.git');
  let gitDirectory: string;
  let gitGeneration: string;
  try {
    const stat = lstatSync(dotGit);
    if (stat.isSymbolicLink()) throw new Error(`工作区 .git 不能是符号链接：${dotGit}`);
    if (stat.isDirectory()) {
      gitDirectory = canonicalExistingPath(dotGit);
      gitGeneration = directoryGeneration(lstatSync(gitDirectory, { bigint: true }));
    } else if (stat.isFile()) {
      if (stat.size > 16 * 1024) throw new Error(`工作区 .git 文件过大：${dotGit}`);
      const match = /^gitdir: (.+)\r?\n?$/u.exec(readFileSync(dotGit, 'utf8'));
      if (!match) throw new Error(`工作区 .git 文件格式无效：${dotGit}`);
      gitDirectory = canonicalExistingPath(path.resolve(root, match[1].trim()));
      const gitStat = lstatSync(gitDirectory, { bigint: true });
      if (!gitStat.isDirectory()) throw new Error(`工作区 Git 元数据必须是目录：${gitDirectory}`);
      gitGeneration = directoryGeneration(gitStat);
    } else throw new Error(`工作区 .git 类型无效：${dotGit}`);
  } catch (error) {
    // 仅缺少 .git 可以按普通工作目录处理；损坏的 worktree 指针不能换成另一身份。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      lstatSync(dotGit);
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === 'ENOENT') {
        return identityFor(dotGit, null);
      }
      throw missing;
    }
    throw error;
  }
  return identityFor(gitDirectory, gitGeneration);
}

/** 规范化受信任的父目录，但保留数据根本身，供调用方拒绝其符号链接。 */
function canonicalParent(target: string): string {
  const parent = path.dirname(target);
  if (parent === target) return target;
  try {
    return path.join(canonicalExistingPath(parent), path.basename(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.join(canonicalParent(parent), path.basename(target));
  }
}

// 仅共享当前只读请求中同一显式目标的父目录解析；数据根自身仍由调用方校验。
const cachedCanonicalParent = memoizedHookReadSync('workspaceRuntimeParent', canonicalParent);

/** 纯路径解析，不创建目录；COMET_DATA_DIR 替代整个用户级 .comet 数据根。 */
export function resolveWorkspaceRuntimeLocation(projectRoot: string): WorkspaceRuntimeLocation {
  const identity = resolveWorkspaceIdentity(projectRoot);
  const configured = process.env.COMET_DATA_DIR;
  if (configured !== undefined && (!configured.trim() || !path.isAbsolute(configured)))
    throw new Error('COMET_DATA_DIR 必须是非空绝对路径');
  const dataRoot = cachedCanonicalParent(configured ?? path.join(os.homedir(), '.comet'));
  const relativeData = path.relative(identity.projectRoot, dataRoot);
  if (
    relativeData === '' ||
    (!path.isAbsolute(relativeData) &&
      relativeData !== '..' &&
      !relativeData.startsWith(`..${path.sep}`))
  )
    throw new Error('用户级 Runtime 数据根不能位于当前工作区内');
  const workspaceRoot = path.join(dataRoot, 'workspaces', identity.workspaceId);
  return {
    ...identity,
    dataRoot,
    workspaceRoot,
    runtimeRoot: path.join(workspaceRoot, 'runtime'),
  };
}

export function resolveWorkspaceRuntimeRootSync(projectRoot: string): string {
  return resolveWorkspaceRuntimeLocation(projectRoot).runtimeRoot;
}
