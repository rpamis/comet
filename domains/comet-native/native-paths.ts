import { promises as fs } from 'fs';
import path from 'path';

import type { NativeProjectPaths } from './native-types.js';

export const PROJECT_CONFIG_FILE = 'comet.config.yaml';

async function isFileOrDirectory(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function physicalPath(target: string): Promise<string> {
  const missing: string[] = [];
  let cursor = target;
  while (!(await isFileOrDirectory(cursor))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.push(path.basename(cursor));
    cursor = parent;
  }
  const existing = await fs.realpath(cursor);
  return path.resolve(existing, ...missing.reverse());
}

export async function discoverNativeProject(startPath: string): Promise<string> {
  let cursor = path.resolve(startPath);
  try {
    if (!(await fs.stat(cursor)).isDirectory()) cursor = path.dirname(cursor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const fallback = cursor;
  while (true) {
    if (await isFileOrDirectory(path.join(cursor, PROJECT_CONFIG_FILE))) return cursor;
    if (await isFileOrDirectory(path.join(cursor, '.git'))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return fallback;
    cursor = parent;
  }
}

export function normalizeArtifactRootRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || path.isAbsolute(trimmed) || /^(?:[A-Za-z]:|~|[\\/])/u.test(trimmed)) {
    throw new Error('native.artifact_root must be a project-relative path');
  }
  const segments = trimmed.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) {
    throw new Error('native.artifact_root must stay inside the project root');
  }
  const normalized = path.posix.normalize(segments.filter((segment) => segment !== '').join('/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('native.artifact_root must stay inside the project root');
  }
  return normalized === '' ? '.' : normalized;
}

export async function resolveArtifactRoot(projectRoot: string, value: string): Promise<string> {
  const normalized = normalizeArtifactRootRef(value);
  const lexical = path.resolve(projectRoot, ...normalized.split('/'));
  const physicalProject = await fs.realpath(projectRoot);
  const physicalTarget = await physicalPath(lexical);
  if (!inside(physicalProject, physicalTarget)) {
    throw new Error('native.artifact_root resolves outside the project root');
  }
  return lexical;
}

export async function nativeProjectPaths(
  projectRoot: string,
  artifactRootRef: string,
): Promise<NativeProjectPaths> {
  const normalized = normalizeArtifactRootRef(artifactRootRef);
  const artifactRoot = await resolveArtifactRoot(projectRoot, normalized);
  const nativeRoot = path.join(artifactRoot, 'comet');
  return {
    projectRoot: path.resolve(projectRoot),
    configFile: path.join(projectRoot, PROJECT_CONFIG_FILE),
    artifactRoot,
    artifactRootRef: normalized,
    nativeRoot,
    specsDir: path.join(nativeRoot, 'specs'),
    changesDir: path.join(nativeRoot, 'changes'),
    archiveDir: path.join(nativeRoot, 'archive'),
    runtimeDir: path.join(nativeRoot, 'runtime'),
    locksDir: path.join(nativeRoot, 'runtime', 'locks'),
    transactionsDir: path.join(nativeRoot, 'runtime', 'transactions'),
  };
}

export function isInsidePath(parent: string, target: string): boolean {
  return inside(path.resolve(parent), path.resolve(target));
}
