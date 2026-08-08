import { existsSync, promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { normalizeWorkflowArtifactRoot } from '../workflow-contract/project-config.js';

import type { NativeProjectPaths } from './native-types.js';

export const PROJECT_CONFIG_FILE = '.comet/config.yaml';
const NATIVE_CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

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
  return normalizeWorkflowArtifactRoot(value);
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
  const resolvedProjectRoot = path.resolve(projectRoot);
  const runtimeDir = path.join(resolvedProjectRoot, '.comet', 'runtime', 'native');
  if (await isSymbolicLink(runtimeDir)) {
    throw new Error('The Native Runtime root must not be a symbolic link');
  }
  const [physicalProjectRoot, physicalRuntimeDir] = await Promise.all([
    fs.realpath(resolvedProjectRoot),
    physicalPath(runtimeDir),
  ]);
  if (!inside(physicalProjectRoot, physicalRuntimeDir)) {
    throw new Error('The Native Runtime root resolves outside the project root');
  }
  return {
    projectRoot: resolvedProjectRoot,
    configFile: path.join(projectRoot, ...PROJECT_CONFIG_FILE.split('/')),
    artifactRoot,
    artifactRootRef: normalized,
    nativeRoot,
    specsDir: path.join(nativeRoot, 'specs'),
    changesDir: path.join(nativeRoot, 'changes'),
    archiveDir: path.join(nativeRoot, 'archive'),
    runtimeDir,
    changesRuntimeDir: path.join(runtimeDir, 'changes'),
    locksDir: path.join(runtimeDir, 'locks'),
    transactionsDir: path.join(runtimeDir, 'transactions'),
  };
}

export async function ensureNativeDirectories(paths: NativeProjectPaths): Promise<void> {
  await Promise.all(
    [paths.specsDir, paths.changesDir, paths.archiveDir].map(async (directory) => {
      await resolveContainedNativePath(paths.nativeRoot, directory);
      await fs.mkdir(directory, { recursive: true });
    }),
  );
  await Promise.all(
    [paths.changesRuntimeDir, paths.locksDir, paths.transactionsDir].map(async (directory) => {
      await resolveContainedNativePath(paths.projectRoot, directory);
      await fs.mkdir(directory, { recursive: true });
    }),
  );
}

function assertNativeRuntimeChangeName(name: string): void {
  if (!NATIVE_CHANGE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid Native change name: ${name}`);
  }
}

export function nativePreferredChangeRuntimeDir(paths: NativeProjectPaths, name: string): string {
  assertNativeRuntimeChangeName(name);
  const target = path.join(paths.changesRuntimeDir, name);
  if (!isInsidePath(paths.changesRuntimeDir, target)) {
    throw new Error('Native change Runtime path escaped');
  }
  return target;
}

export function nativeLegacyChangeRuntimeDir(paths: NativeProjectPaths, name: string): string {
  assertNativeRuntimeChangeName(name);
  const target = path.join(paths.changesDir, name, 'runtime');
  if (!isInsidePath(paths.changesDir, target)) {
    throw new Error('Legacy Native change Runtime path escaped');
  }
  return target;
}

/**
 * Resolve the physical Runtime root for a change. New Runtime wins whenever it exists;
 * otherwise an existing legacy `<change>/runtime` remains readable until Doctor migrates it.
 * A missing Runtime resolves to the preferred new location so all new writes use `.comet`.
 */
export function nativeChangeRuntimeDir(paths: NativeProjectPaths, name: string): string {
  const preferred = nativePreferredChangeRuntimeDir(paths, name);
  if (existsSync(preferred)) return preferred;
  const legacy = nativeLegacyChangeRuntimeDir(paths, name);
  return existsSync(legacy) ? legacy : preferred;
}

export interface NativeRuntimeStorageInspection {
  status: 'available' | 'missing' | 'invalid';
  layout: 'project-local' | 'legacy' | 'missing';
  path: string;
  message?: string;
}

async function inspectRuntimeDirectory(
  target: string,
): Promise<'directory' | 'missing' | 'invalid'> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? 'directory' : 'invalid';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** Read-only storage health used by status/doctor before opening machine-owned files. */
export async function inspectNativeRuntimeStorage(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeRuntimeStorageInspection> {
  const preferred = nativePreferredChangeRuntimeDir(paths, name);
  const legacy = nativeLegacyChangeRuntimeDir(paths, name);
  const [preferredKind, legacyKind] = await Promise.all([
    inspectRuntimeDirectory(preferred),
    inspectRuntimeDirectory(legacy),
  ]);
  if (preferredKind === 'invalid') {
    return {
      status: 'invalid',
      layout: 'project-local',
      path: preferred,
      message: 'Native Runtime path must be a real directory',
    };
  }
  if (legacyKind === 'invalid') {
    return {
      status: 'invalid',
      layout: 'legacy',
      path: legacy,
      message: 'Legacy Native Runtime path must be a real directory',
    };
  }
  if (preferredKind === 'directory' && legacyKind === 'directory') {
    return {
      status: 'invalid',
      layout: 'project-local',
      path: preferred,
      message: 'Both project-local and legacy Native Runtime directories exist',
    };
  }
  if (preferredKind === 'directory') {
    return { status: 'available', layout: 'project-local', path: preferred };
  }
  if (legacyKind === 'directory') {
    return { status: 'available', layout: 'legacy', path: legacy };
  }
  return { status: 'missing', layout: 'missing', path: preferred };
}

export function nativeRuntimeRefFile(runtimeDir: string, ref: string): string {
  if (!ref.startsWith('runtime/') || path.isAbsolute(ref) || ref.split(/[\\/]/u).includes('..')) {
    throw new Error(`Invalid Native Runtime ref: ${ref}`);
  }
  const target = path.resolve(runtimeDir, ...ref.slice('runtime/'.length).split('/'));
  if (!isInsidePath(runtimeDir, target)) throw new Error(`Native Runtime ref escaped: ${ref}`);
  return target;
}

export function nativeStorageRoot(paths: NativeProjectPaths, target: string): string {
  const absolute = path.resolve(target);
  if (isInsidePath(paths.runtimeDir, absolute)) return paths.runtimeDir;
  if (isInsidePath(paths.nativeRoot, absolute)) return paths.nativeRoot;
  throw new Error(`Path is outside Native document and Runtime roots: ${target}`);
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
