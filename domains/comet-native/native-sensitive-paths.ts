import path from 'path';

import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.gradle',
  '.mypy_cache',
  '.next',
  '.npm',
  '.pnpm-store',
  '.pytest_cache',
  '.turbo',
  '.venv',
  '.yarn',
  '__pycache__',
  'node_modules',
  'venv',
]);

export function isNativeEnvFileName(name: string): boolean {
  return name.toLowerCase().startsWith('.env');
}

/** Returns a stable exclusion reason for project-relative sensitive paths. */
export function nativeSensitiveRelativePathReason(relativeRef: string): string | null {
  const segments = relativeRef.replaceAll('\\', '/').split('/').filter(Boolean);
  const lower = segments.map((segment) => segment.toLowerCase());
  if (lower.some((segment) => isNativeEnvFileName(segment))) return 'environment-file';
  if (lower.includes('.git')) return 'git-metadata';
  if (lower.some((segment) => NATIVE_EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    return 'dependency-or-cache';
  }
  if (lower.join('/') === 'comet.config.yaml') return 'comet-config';
  return null;
}

export function nativeSensitiveArtifactReason(
  paths: NativeProjectPaths,
  relativeRef: string,
): string | null {
  const generic = nativeSensitiveRelativePathReason(relativeRef);
  if (generic) return generic;
  const target = path.resolve(paths.projectRoot, ...relativeRef.split('/'));
  const relativeNativeRoot = path
    .relative(paths.projectRoot, paths.nativeRoot)
    .replaceAll('\\', '/');
  const normalized = relativeRef.replaceAll('\\', '/');
  if (
    normalized === relativeNativeRoot ||
    normalized.startsWith(`${relativeNativeRoot}/`) ||
    target === path.resolve(paths.configFile)
  ) {
    return 'native-runtime';
  }
  return null;
}
