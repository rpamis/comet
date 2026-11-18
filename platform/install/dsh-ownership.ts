import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { ensureDir, fileExists } from '../fs/file-system.js';
import { getPlatformSkillsDir, type Platform } from './platforms.js';
import type { InstallScope } from './types.js';

const DSH_OWNERSHIP_FILE = '.comet-ownership.json';

export type DshOwnershipKind = 'openspec' | 'superpowers';

interface DshOwnershipDocument {
  version: 1;
  openspec: string[];
  superpowers: string[];
}

export function dshRootPath(baseDir: string, platform: Platform, scope: InstallScope): string {
  return path.join(baseDir, getPlatformSkillsDir(platform, scope));
}

function dshOwnershipPath(baseDir: string, platform: Platform, scope: InstallScope): string {
  return path.join(dshRootPath(baseDir, platform, scope), 'skills', DSH_OWNERSHIP_FILE);
}

function normalizeDshOwnedPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    return null;
  }
  return normalized;
}

async function readDshOwnership(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<DshOwnershipDocument> {
  const ownershipPath = dshOwnershipPath(baseDir, platform, scope);
  if (!(await fileExists(ownershipPath))) {
    return { version: 1, openspec: [], superpowers: [] };
  }
  const parsed = JSON.parse(await readFile(ownershipPath, 'utf8')) as Partial<DshOwnershipDocument>;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.openspec) ||
    !Array.isArray(parsed.superpowers)
  ) {
    throw new Error(`Invalid dsh Comet ownership file: ${ownershipPath}`);
  }
  const openspec = parsed.openspec.map(normalizeDshOwnedPath);
  const superpowers = parsed.superpowers.map(normalizeDshOwnedPath);
  if (openspec.some((value) => value === null) || superpowers.some((value) => value === null)) {
    throw new Error(`Invalid dsh Comet ownership path: ${ownershipPath}`);
  }
  return {
    version: 1,
    openspec: [...new Set(openspec as string[])].sort(),
    superpowers: [...new Set(superpowers as string[])].sort(),
  };
}

export async function readDshOwnedPaths(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  kind: DshOwnershipKind,
): Promise<Set<string>> {
  const ownership = await readDshOwnership(baseDir, platform, scope);
  return new Set(ownership[kind]);
}

export async function addDshOwnedPaths(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  kind: DshOwnershipKind,
  paths: Iterable<string>,
): Promise<void> {
  const requested = [...paths];
  if (requested.length === 0) return;
  const ownership = await readDshOwnership(baseDir, platform, scope);
  const normalized = requested.map(normalizeDshOwnedPath);
  if (normalized.some((value) => value === null)) {
    throw new Error('Cannot record an invalid dsh Comet ownership path');
  }
  ownership[kind] = [...new Set([...ownership[kind], ...(normalized as string[])])].sort();
  await ensureDir(path.dirname(dshOwnershipPath(baseDir, platform, scope)));
  await writeFile(
    dshOwnershipPath(baseDir, platform, scope),
    `${JSON.stringify(ownership, null, 2)}\n`,
  );
}

export async function removeDshOwnedPaths(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  kind: DshOwnershipKind,
  paths: Iterable<string>,
): Promise<void> {
  const ownership = await readDshOwnership(baseDir, platform, scope);
  const toRemove = new Set(paths);
  ownership[kind] = ownership[kind].filter((value) => !toRemove.has(value));
  const ownershipPath = dshOwnershipPath(baseDir, platform, scope);
  if (ownership.openspec.length === 0 && ownership.superpowers.length === 0) {
    await rm(ownershipPath, { force: true });
    return;
  }
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
}
