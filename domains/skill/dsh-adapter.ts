import path from 'path';
import { readFile, rm, writeFile } from 'fs/promises';
import { isSeq, parse, parseDocument } from 'yaml';

import { fileExists, ensureDir } from '../../platform/fs/file-system.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';

export const DSH_RULE_START = '<!-- COMET:DSH:START -->';
export const DSH_RULE_END = '<!-- COMET:DSH:END -->';
export const DSH_HOOK_PLUGIN_ID = 'dsh-hooks-claude-code';
const DSH_OWNERSHIP_FILE = '.comet-ownership.json';

export type DshOwnershipKind = 'openspec' | 'superpowers';

interface DshOwnershipDocument {
  version: 1;
  openspec: string[];
  superpowers: string[];
}

const DSH_MANAGED_BLOCK = new RegExp(
  `${escapeRegExp(DSH_RULE_START)}[\\s\\S]*?${escapeRegExp(DSH_RULE_END)}`,
  'u',
);

type DshPatchEntry = Record<string, unknown>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function dshInstructionPath(baseDir: string, platform: Platform, scope: InstallScope): string {
  if (scope === 'project') return path.join(baseDir, 'AGENTS.local.md');
  return path.join(baseDir, getPlatformSkillsDir(platform, 'global'), 'AGENTS.md');
}

function dshPatchPath(baseDir: string, platform: Platform, scope: InstallScope): string {
  return path.join(baseDir, getPlatformConfigDir(platform, scope), 'cordis.patch.yml');
}

function dshHooksConfigPath(baseDir: string, platform: Platform, scope: InstallScope): string {
  return path.join(baseDir, getPlatformConfigDir(platform, scope), 'hooks.json');
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

function renderDshInstructionBlock(content: string): string {
  return `${DSH_RULE_START}\n${content.trimEnd()}\n${DSH_RULE_END}`;
}

export async function mergeDshInstruction(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  content: string,
  overwrite: boolean,
): Promise<{ copied: number; skipped: number; failed: number }> {
  const destination = dshInstructionPath(baseDir, platform, scope);
  try {
    const existing = (await fileExists(destination)) ? await readFile(destination, 'utf8') : '';
    const managed = existing.match(DSH_MANAGED_BLOCK);
    if (managed && !overwrite) return { copied: 0, skipped: 1, failed: 0 };

    const block = renderDshInstructionBlock(content);
    const next = managed
      ? `${existing.slice(0, managed.index)}${block}${existing.slice(
          (managed.index ?? 0) + managed[0].length,
        )}`
      : existing.trimEnd()
        ? `${existing.trimEnd()}\n\n${block}\n`
        : `${block}\n`;
    if (next === existing) return { copied: 0, skipped: 1, failed: 0 };

    await ensureDir(path.dirname(destination));
    await writeFile(destination, next, 'utf8');
    return { copied: 1, skipped: 0, failed: 0 };
  } catch (error) {
    console.error(
      `    Failed to merge dsh instruction file ${destination}: ${(error as Error).message}`,
    );
    return { copied: 0, skipped: 0, failed: 1 };
  }
}

export async function removeDshInstruction(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<{ removed: number; failed: number }> {
  const destination = dshInstructionPath(baseDir, platform, scope);
  try {
    if (!(await fileExists(destination))) return { removed: 0, failed: 0 };
    const existing = await readFile(destination, 'utf8');
    const managed = existing.match(DSH_MANAGED_BLOCK);
    if (!managed || managed.index === undefined) return { removed: 0, failed: 0 };

    const remaining = `${existing.slice(0, managed.index)}${existing.slice(
      managed.index + managed[0].length,
    )}`.replace(/(?:\r?\n){2,}$/u, '\n');
    if (remaining.trim().length === 0) {
      await rm(destination, { force: true });
    } else {
      await writeFile(destination, remaining, 'utf8');
    }
    return { removed: 1, failed: 0 };
  } catch {
    return { removed: 0, failed: 1 };
  }
}

export async function hasDshInstruction(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  const destination = dshInstructionPath(baseDir, platform, scope);
  if (!(await fileExists(destination))) return false;
  return DSH_MANAGED_BLOCK.test(await readFile(destination, 'utf8'));
}

function isDshPatchEntry(value: unknown): value is DshPatchEntry {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, DSH_HOOK_PLUGIN_ID),
  );
}

function isManagedDshPatchEntry(
  value: unknown,
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): value is DshPatchEntry {
  if (!isDshPatchEntry(value)) return false;
  const config = value[DSH_HOOK_PLUGIN_ID];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const expectedConfigPath =
    scope === 'project'
      ? `./${getPlatformConfigDir(platform, scope).replaceAll('\\', '/')}/hooks.json`
      : dshHooksConfigPath(baseDir, platform, scope).replaceAll('\\', '/');
  return (
    (config as Record<string, unknown>).configPath === expectedConfigPath &&
    (scope !== 'project' || (config as Record<string, unknown>).projectDir === '.')
  );
}

async function readDshPatchEntries(patchPath: string): Promise<DshPatchEntry[]> {
  if (!(await fileExists(patchPath))) return [];
  const parsed = parse(await readFile(patchPath, 'utf8'));
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed))
    throw new Error(`dsh patch must contain a YAML sequence: ${patchPath}`);
  return parsed as DshPatchEntry[];
}

async function readDshPatchDocument(patchPath: string) {
  const exists = await fileExists(patchPath);
  const document = exists
    ? parseDocument(await readFile(patchPath, 'utf8'))
    : parseDocument('[]\n');
  if (document.errors.length > 0) {
    throw document.errors[0];
  }
  if (!isSeq(document.contents)) {
    throw new Error(`dsh patch must contain a YAML sequence: ${patchPath}`);
  }
  if (!exists) document.contents.flow = false;
  return document;
}

function dshPatchNodeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'toJSON' in value &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

interface DshYamlSequence {
  items: unknown[];
  add(value: unknown): void;
}

function dshPatchSequence(document: ReturnType<typeof parseDocument>): DshYamlSequence {
  const contents = document.contents as unknown;
  if (!isSeq(contents)) {
    throw new Error('dsh patch must contain a YAML sequence');
  }
  return contents as DshYamlSequence;
}

function buildDshPatchEntry(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): DshPatchEntry {
  const configPath =
    scope === 'project'
      ? `./${getPlatformConfigDir(platform, scope).replaceAll('\\', '/')}/hooks.json`
      : dshHooksConfigPath(baseDir, platform, scope).replaceAll('\\', '/');
  const config: Record<string, string> = { configPath };
  if (scope === 'project') config.projectDir = '.';
  return { [DSH_HOOK_PLUGIN_ID]: config };
}

export async function reconcileDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<void> {
  const patchPath = dshPatchPath(baseDir, platform, scope);
  const document = await readDshPatchDocument(patchPath);
  const contents = dshPatchSequence(document);
  contents.items = contents.items.filter(
    (entry) => !isManagedDshPatchEntry(dshPatchNodeValue(entry), baseDir, platform, scope),
  );
  contents.add(buildDshPatchEntry(baseDir, platform, scope));
  await ensureDir(path.dirname(patchPath));
  await writeFile(patchPath, document.toString());
}

export async function removeDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<{ removed: number; failed: number }> {
  const patchPath = dshPatchPath(baseDir, platform, scope);
  try {
    if (!(await fileExists(patchPath))) return { removed: 0, failed: 0 };
    const document = await readDshPatchDocument(patchPath);
    const contents = dshPatchSequence(document);
    const before = contents.items.length;
    contents.items = contents.items.filter(
      (entry) => !isManagedDshPatchEntry(dshPatchNodeValue(entry), baseDir, platform, scope),
    );
    const removed = before - contents.items.length;
    if (removed === 0) return { removed: 0, failed: 0 };
    if (contents.items.length === 0) {
      await rm(patchPath, { force: true });
    } else {
      await writeFile(patchPath, document.toString());
    }
    return { removed, failed: 0 };
  } catch {
    return { removed: 0, failed: 1 };
  }
}

export async function hasDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  try {
    const entries = await readDshPatchEntries(dshPatchPath(baseDir, platform, scope));
    return entries.some((entry) => isManagedDshPatchEntry(entry, baseDir, platform, scope));
  } catch {
    return false;
  }
}

export { dshInstructionPath, dshPatchPath, dshHooksConfigPath };
