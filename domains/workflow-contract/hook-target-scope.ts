import { promises as fs } from 'fs';
import path from 'path';

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

async function physicalPathForPossiblyMissingTarget(target: string): Promise<string | null> {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const missingSegments: string[] = [];
  let cursor = resolved;

  while (cursor && cursor !== root) {
    try {
      const physicalBase = await fs.realpath(cursor);
      return path.join(physicalBase, ...missingSegments.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      missingSegments.push(path.basename(cursor));
      cursor = path.dirname(cursor);
    }
  }

  try {
    const physicalRoot = await fs.realpath(root);
    return path.join(physicalRoot, ...missingSegments.reverse());
  } catch {
    return null;
  }
}

export async function scopeCometHookTargets(
  projectRoot: string,
  targets: readonly string[],
): Promise<ScopedCometHookTargets> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const physicalProjectRoot = await fs.realpath(resolvedProjectRoot);
  const projectTargets: string[] = [];
  const externalTargets: string[] = [];

  for (const target of targets) {
    const resolvedTarget = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(resolvedProjectRoot, target);
    const physicalTarget = await physicalPathForPossiblyMissingTarget(resolvedTarget);
    const inside = physicalTarget
      ? isWithin(physicalProjectRoot, physicalTarget)
      : isWithin(resolvedProjectRoot, resolvedTarget);
    (inside ? projectTargets : externalTargets).push(target);
  }

  return { projectTargets, externalTargets };
}
