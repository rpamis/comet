import { promises as fs } from 'node:fs';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import path from 'node:path';

export const CLASSIC_STATE_FILE = 'comet-state.yaml';
export const LEGACY_CLASSIC_STATE_FILE = '.comet.yaml';
export const CLASSIC_STATE_FILES = [CLASSIC_STATE_FILE, LEGACY_CLASSIC_STATE_FILE] as const;

export class ClassicStateFileConflictError extends Error {}

export function isClassicStateFileName(name: string): boolean {
  return CLASSIC_STATE_FILES.some((candidate) => candidate === name);
}

/** 保留已有文件名；两个来源同时存在时拒绝读写，包括损坏的符号链接。 */
async function resolveClassicStateFileImpl(
  changeDir: string,
  options: { defaultFileName?: (typeof CLASSIC_STATE_FILES)[number] } = {},
): Promise<string> {
  const found: string[] = [];
  const unsafe: string[] = [];
  for (const name of CLASSIC_STATE_FILES) {
    try {
      const stat = await fs.lstat(path.join(changeDir, name));
      found.push(name);
      if (!stat.isFile() || stat.isSymbolicLink()) unsafe.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (found.length > 1) {
    throw new ClassicStateFileConflictError(
      `Classic state files are ambiguous in ${changeDir}: ${CLASSIC_STATE_FILES.join(' and ')} both exist; preserve both files and resolve the conflict before continuing`,
    );
  }
  if (unsafe.length)
    throw new Error(
      `Classic state must be a regular file, not a symlink or directory: ${path.join(changeDir, unsafe[0])}`,
    );
  return path.join(changeDir, found[0] ?? options.defaultFileName ?? CLASSIC_STATE_FILE);
}

const cachedResolveClassicStateFile = memoizedHookRead(
  'classicStateFile',
  (changeDir: string, options?: { defaultFileName?: (typeof CLASSIC_STATE_FILES)[number] }) =>
    resolveClassicStateFileImpl(changeDir, options),
);

export async function resolveClassicStateFile(
  changeDir: string,
  options: { defaultFileName?: (typeof CLASSIC_STATE_FILES)[number] } = {},
): Promise<string> {
  return cachedResolveClassicStateFile(changeDir, options);
}
