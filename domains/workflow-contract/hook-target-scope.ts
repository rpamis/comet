import { promises as fs } from 'fs';
import path from 'path';
import { normalizeCometHookTargets } from '../../platform/process/hook-adapter.js';

export interface ScopedCometHookTargets {
  projectTargets: string[];
  externalTargets: string[];
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function absoluteTargetWithoutCollapsingParents(base: string, target: string): string {
  return path.isAbsolute(target) ? target : `${base}${path.sep}${target}`;
}

async function physicalPathForPossiblyMissingTarget(target: string): Promise<string> {
  const absolute = absoluteTargetWithoutCollapsingParents(process.cwd(), target);
  const segments = (value: string) =>
    value.split(process.platform === 'win32' ? /[\\/]+/u : /\/+/u);
  const root = path.parse(absolute).root;
  let cursor = await fs.realpath(root);
  let pending = segments(absolute.slice(root.length));
  let links = 0;
  while (pending.length > 0) {
    const segment = pending.shift()!;
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      cursor = path.dirname(cursor);
      continue;
    }
    const next = path.join(cursor, segment);
    let entry;
    try {
      entry = await fs.lstat(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (pending.includes('..')) {
        cursor = next;
        continue;
      }
      return path.join(next, ...pending);
    }
    if (entry.isSymbolicLink()) {
      if (pending.includes('..'))
        throw new Error('Hook 目标经过链接后返回父级；请使用规范物理路径');
      if (++links > 40) throw new Error('Hook 目标链接解析超过 40 层，无法安全确定归属');
      const destination = await fs.readlink(next);
      if (path.isAbsolute(destination)) {
        const destinationRoot = path.parse(destination).root;
        cursor = await fs.realpath(destinationRoot);
        pending = [...segments(destination.slice(destinationRoot.length)), ...pending];
      } else {
        pending = [...segments(destination), ...pending];
      }
      continue;
    }
    if (pending.length > 0 && !entry.isDirectory())
      throw new Error('Hook 目标的中间路径不是目录；请使用规范物理路径');
    cursor = await fs.realpath(next);
  }
  return cursor;
}

/** Runtime 禁写兼容项目相对路径和宿主 cwd 相对路径，不改变普通 phase guard 的归属。 */
export function cometHookRuntimeTargetCandidates(
  projectRoot: string,
  target: string,
  cwd?: string,
): string[] {
  const candidates = [absoluteTargetWithoutCollapsingParents(projectRoot, target)];
  if (!path.isAbsolute(target) && cwd && path.isAbsolute(cwd)) {
    candidates.push(absoluteTargetWithoutCollapsingParents(cwd, target));
  }
  return [...new Set(candidates)];
}

/** 受管存储即使在项目外也不能写入；同时识别链接别名和尚未创建的目标。 */
export async function isCometHookTargetWithin(root: string, target: string): Promise<boolean> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (isWithin(resolvedRoot, resolvedTarget)) return true;
  const [physicalRoot, physicalTarget] = await Promise.all([
    physicalPathForPossiblyMissingTarget(resolvedRoot),
    physicalPathForPossiblyMissingTarget(target),
  ]);
  return physicalRoot !== null && physicalTarget !== null && isWithin(physicalRoot, physicalTarget);
}

export async function scopeCometHookTargets(
  projectRoot: string,
  targets: readonly string[],
): Promise<ScopedCometHookTargets> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const physicalProjectRoot = await fs.realpath(resolvedProjectRoot);
  const projectTargets: string[] = [];
  const externalTargets: string[] = [];

  for (const target of normalizeCometHookTargets(targets)) {
    const resolvedTarget = absoluteTargetWithoutCollapsingParents(resolvedProjectRoot, target);
    const physicalTarget = await physicalPathForPossiblyMissingTarget(resolvedTarget);
    const inside = physicalTarget
      ? isWithin(physicalProjectRoot, physicalTarget)
      : isWithin(resolvedProjectRoot, resolvedTarget);
    (inside ? projectTargets : externalTargets).push(target);
  }

  return { projectTargets, externalTargets };
}
