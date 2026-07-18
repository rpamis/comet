import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import type { NativeProjectPaths } from './native-types.js';

export const PROJECT_CONFIG_FILE = '.comet/config.yaml';

async function isFileOrDirectory(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function declaresNativeProjectConfig(target: string): Promise<boolean> {
  try {
    const source = await fs.readFile(target, 'utf8');
    return /^schema:\s*comet\.project\.v1\s*$/mu.test(source);
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

async function isSymbolicLink(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function discoverNativeProject(startPath: string): Promise<string> {
  let cursor = path.resolve(startPath);
  try {
    if (!(await fs.stat(cursor)).isDirectory()) cursor = path.dirname(cursor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const fallback = cursor;
  const home = path.resolve(os.homedir());
  while (true) {
    const isHomeBoundary = cursor === home && fallback !== home;
    if (!isHomeBoundary) {
      const configFile = path.join(cursor, ...PROJECT_CONFIG_FILE.split('/'));
      const configMarksProject =
        cursor === fallback || (await declaresNativeProjectConfig(configFile));
      if ((await isFileOrDirectory(configFile)) && configMarksProject) {
        return cursor;
      }
    }
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
  if (await isSymbolicLink(nativeRoot)) {
    throw new Error('The configured Native comet root must not be a symbolic link');
  }
  const [physicalArtifactRoot, physicalNativeRoot] = await Promise.all([
    physicalPath(artifactRoot),
    physicalPath(nativeRoot),
  ]);
  if (!inside(physicalArtifactRoot, physicalNativeRoot)) {
    throw new Error('The configured Native comet root resolves outside its artifact root');
  }
  return {
    projectRoot: path.resolve(projectRoot),
    configFile: path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/')),
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

export async function ensureNativeDirectories(paths: NativeProjectPaths): Promise<void> {
  const directories = [
    paths.specsDir,
    paths.changesDir,
    paths.archiveDir,
    paths.locksDir,
    paths.transactionsDir,
  ];
  await Promise.all(
    directories.map(async (directory) => {
      await resolveContainedNativePath(paths.nativeRoot, directory);
      await fs.mkdir(directory, { recursive: true });
    }),
  );
}

export function isInsidePath(parent: string, target: string): boolean {
  return inside(path.resolve(parent), path.resolve(target));
}

export async function resolveContainedNativePath(root: string, target: string): Promise<string> {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(target);
  if (!inside(lexicalRoot, lexicalTarget)) {
    throw new Error(`Path is outside the Native root: ${target}`);
  }
  if (await isSymbolicLink(lexicalRoot)) {
    throw new Error(`Native root must not be a symbolic link: ${root}`);
  }
  const [physicalRoot, physicalTarget] = await Promise.all([
    physicalPath(lexicalRoot),
    physicalPath(lexicalTarget),
  ]);
  if (!inside(physicalRoot, physicalTarget)) {
    throw new Error(`Path resolves outside the Native root: ${target}`);
  }
  return lexicalTarget;
}
