import path from 'path';
import { lstat, readFile, rm, writeFile } from 'fs/promises';
import { isMap, isNode, isSeq, parseDocument } from 'yaml';

import { fileExists, ensureDir } from '../../platform/fs/file-system.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import { getDshProfilePatchPaths } from '../../platform/install/dsh-profiles.js';

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

const DSH_HOOK_ENTRY_ID = 'comet-workflow-guard';
const DSH_HOOK_PACKAGE = '@deepseek-ai/dsh-hooks-claude-code';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function managedConfig(
  value: unknown,
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): boolean {
  const config = record(value);
  const configPath = config?.configPath;
  const absolute = dshHooksConfigPath(baseDir, platform, scope).replaceAll('\\', '/');
  const relative = `./${getPlatformConfigDir(platform, scope).replaceAll('\\', '/')}/hooks.json`;
  return configPath === absolute || (scope === 'project' && configPath === relative);
}

function managedEntry(
  value: unknown,
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): boolean {
  const entry = record(value);
  if (!entry) return false;
  if (Object.hasOwn(entry, DSH_HOOK_PLUGIN_ID)) {
    return managedConfig(entry[DSH_HOOK_PLUGIN_ID], baseDir, platform, scope);
  }
  return (
    (entry.name === DSH_HOOK_PACKAGE || entry.name === DSH_HOOK_PLUGIN_ID) &&
    managedConfig(entry.config, baseDir, platform, scope)
  );
}

async function patchPaths(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<string[]> {
  if (scope === 'global') {
    const profiles = await getDshProfilePatchPaths(
      path.dirname(dshPatchPath(baseDir, platform, scope)),
    );
    if (profiles.length > 0) return profiles;
  }
  return [dshPatchPath(baseDir, platform, scope)];
}

async function readDshPatchDocument(patchPath: string) {
  const stat = await lstat(patchPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error(`dsh patch is not a regular file: ${patchPath}`);
  const document = stat ? parseDocument(await readFile(patchPath, 'utf8')) : parseDocument('[]\n');
  if (document.errors.length > 0) throw document.errors[0];
  if (!isSeq(document.contents))
    throw new Error(`dsh patch must contain a YAML sequence: ${patchPath}`);
  if (!stat) document.contents.flow = false;
  return document;
}

function removeManagedPatchRows(
  document: ReturnType<typeof parseDocument>,
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): number {
  if (!isSeq(document.contents)) throw new Error('dsh patch must contain a YAML sequence');
  let removed = 0;
  document.contents.items = document.contents.items.filter((node) => {
    if (managedEntry(isNode(node) ? node.toJSON() : node, baseDir, platform, scope)) {
      removed++;
      return false;
    }
    if (!isMap(node)) return true;
    const insert = node.get('insert', true);
    if (!isSeq(insert)) return true;
    const before = removed;
    insert.items = insert.items.filter((entry) => {
      if (!managedEntry(isNode(entry) ? entry.toJSON() : entry, baseDir, platform, scope))
        return true;
      removed++;
      return false;
    });
    return insert.items.length > 0 || removed === before;
  });
  return removed;
}

export async function reconcileDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<() => Promise<void>> {
  const destinations = await patchPaths(baseDir, platform, scope);
  const rootPatch = dshPatchPath(baseDir, platform, scope);
  const allPaths = [...new Set([...destinations, rootPatch])];
  // 先解析所有配置，避免某个 profile 损坏后留下已被修改的其他 profile。
  const documents = await Promise.all(
    allPaths.map(async (file) => ({
      file,
      document: await readDshPatchDocument(file),
      source: await readFile(file, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }),
    })),
  );
  for (const { file, document } of documents) {
    const patches = document.toJSON() as unknown[];
    for (const value of patches) {
      const patch = record(value);
      if (!Array.isArray(patch?.insert)) continue;
      if (
        patch.insert.some(
          (row) =>
            record(row)?.id === DSH_HOOK_ENTRY_ID && !managedEntry(row, baseDir, platform, scope),
        )
      ) {
        throw new Error(
          `dsh Hook entry id ${DSH_HOOK_ENTRY_ID} conflicts with an unmanaged entry: ${file}`,
        );
      }
    }
  }
  const changed = new Set<string>();
  const rollback = async (): Promise<void> => {
    const results = await Promise.allSettled(
      documents
        .filter(({ file }) => changed.has(file))
        .map(async ({ file, source }) => {
          if (source === null) await rm(file, { force: true });
          else if (
            (await readFile(file, 'utf8').catch((error) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            })) !== source
          )
            await writeFile(file, source);
        }),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0)
      throw new Error(`Could not restore ${failures.length} DSH patch file(s)`);
  };
  try {
    for (const { file, document } of documents) {
      const removed = removeManagedPatchRows(document, baseDir, platform, scope);
      if (destinations.includes(file)) {
        if (!isSeq(document.contents)) throw new Error('dsh patch must contain a YAML sequence');
        document.add({
          insert: [
            {
              id: DSH_HOOK_ENTRY_ID,
              name: DSH_HOOK_PACKAGE,
              config: {
                configPath: dshHooksConfigPath(baseDir, platform, scope).replaceAll('\\', '/'),
              },
            },
          ],
        });
        await ensureDir(path.dirname(file));
        changed.add(file);
        await writeFile(file, document.toString());
      } else if (removed > 0) {
        changed.add(file);
        if (isSeq(document.contents) && document.contents.items.length === 0)
          await rm(file, { force: true });
        else await writeFile(file, document.toString());
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return rollback;
}

export async function removeDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  try {
    const paths = [
      ...new Set([
        ...(await patchPaths(baseDir, platform, scope)),
        dshPatchPath(baseDir, platform, scope),
      ]),
    ];
    for (const file of paths) {
      try {
        if (!(await fileExists(file))) continue;
        const document = await readDshPatchDocument(file);
        const count = removeManagedPatchRows(document, baseDir, platform, scope);
        if (count === 0) continue;
        if (isSeq(document.contents) && document.contents.items.length === 0)
          await rm(file, { force: true });
        else await writeFile(file, document.toString());
        removed += count;
      } catch {
        failed++;
      }
    }
  } catch {
    failed++;
  }
  return { removed, failed };
}

export async function inspectDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<{ present: boolean; error?: string }> {
  try {
    const paths = await patchPaths(baseDir, platform, scope);
    const rootPatch = dshPatchPath(baseDir, platform, scope);
    const root = (await readDshPatchDocument(rootPatch)).toJSON() as unknown[];
    for (const file of paths) {
      const local =
        file === rootPatch ? root : ((await readDshPatchDocument(file)).toJSON() as unknown[]);
      // 桌面端可单独加载 profile；home patch 不能替代该 profile 的桥接插入。
      if (
        !local.some((value) => {
          const patch = record(value);
          return (
            !patch?.id &&
            Array.isArray(patch?.insert) &&
            patch.insert.some((row) => managedEntry(row, baseDir, platform, scope))
          );
        })
      )
        return {
          present: false,
          error: `dsh Cordis patch is missing the Comet Hook bridge insertion: ${file}`,
        };
      const patches = file === rootPatch ? local : [...local, ...root];
      const entries: Record<string, unknown>[] = [];
      for (const value of patches) {
        const patch = record(value);
        if (!patch) continue;
        if (!patch.id && Array.isArray(patch.insert)) {
          for (const row of patch.insert) {
            if (managedEntry(row, baseDir, platform, scope)) entries.push({ ...row });
          }
        } else if (patch.id && !patch.insert) {
          for (const entry of entries) {
            if (patch.id !== entry.id || (patch.name && patch.name !== entry.name)) continue;
            Object.assign(
              entry,
              Object.fromEntries(
                Object.entries(patch).filter(([key]) => key !== 'id' && key !== 'name'),
              ),
            );
          }
        }
      }
      if (
        entries.length !== 1 ||
        entries[0]?.name !== DSH_HOOK_PACKAGE ||
        entries[0]?.disabled === true ||
        !managedConfig(entries[0]?.config, baseDir, platform, scope)
      ) {
        return {
          present: false,
          error: `dsh Cordis patch cannot load exactly one enabled Comet Hook bridge: ${file}`,
        };
      }
    }
    return { present: true };
  } catch (error) {
    return { present: false, error: `dsh Cordis patch is invalid: ${(error as Error).message}` };
  }
}

export async function hasDshCordisPatch(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  return (await inspectDshCordisPatch(baseDir, platform, scope)).present;
}

export { dshInstructionPath, dshPatchPath, dshHooksConfigPath };
