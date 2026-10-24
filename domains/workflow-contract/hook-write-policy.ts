import path from 'path';

import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import { readWorkflowProjectConfig } from './project-config-reader.js';
import { isCometHookTargetWithin, scopeCometHookTargets } from './hook-target-scope.js';

export interface HookWritePolicy {
  allow_paths: readonly string[];
}

const readHookWritePolicy = memoizedHookRead(
  'hookWritePolicy',
  async (projectRoot: string): Promise<HookWritePolicy> => {
    const config = await readWorkflowProjectConfig(projectRoot);
    return config?.hook ?? { allow_paths: [] };
  },
);

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function projectRelativePath(projectRoot: string, target: string): string | null {
  const absoluteTarget = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(projectRoot, target);
  const relative = path.relative(path.resolve(projectRoot), absoluteTarget);
  if (relative === '' || path.isAbsolute(relative) || relative === '..') return null;
  if (relative.startsWith(`..${path.sep}`)) return null;
  return relative.replaceAll('\\', '/');
}

function comparisonKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/**
 * Returns the configured directory that allows `target`, or null when the
 * target must continue through the workflow phase guard.
 */
export async function configuredHookWritePath(
  projectRoot: string,
  target: string,
  reservedPaths: readonly string[] = [],
): Promise<string | null> {
  const absoluteTarget = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(projectRoot, target);
  const absoluteProjectRoot = path.resolve(projectRoot);
  if (!isWithin(absoluteProjectRoot, absoluteTarget)) return null;
  const relative = projectRelativePath(projectRoot, target);
  if (!relative) return null;
  const policy = await readHookWritePolicy(projectRoot);
  const matched = policy.allow_paths.find((allowPath) => {
    const key = comparisonKey(relative);
    const prefix = comparisonKey(allowPath);
    return key === prefix || key.startsWith(`${prefix}/`);
  });
  if (!matched) return null;
  // 放行目录中的中间链接也可能指向项目外或 Runtime，不能只检查词法前缀。
  const scoped = await scopeCometHookTargets(projectRoot, [target]);
  const physicalTarget = path.isAbsolute(target)
    ? target
    : `${absoluteProjectRoot}${path.sep}${target}`;
  if (scoped.projectTargets.length !== 1) return null;
  const protectedPaths = [
    path.join(absoluteProjectRoot, '.git'),
    path.join(absoluteProjectRoot, '.comet'),
    ...reservedPaths,
  ];
  for (const reservedPath of protectedPaths) {
    if (await isCometHookTargetWithin(path.resolve(reservedPath), physicalTarget)) return null;
  }
  return `${relative} (configured Hook allow path: ${matched})`;
}
