import { promises as fs } from 'fs';
import path from 'path';

import {
  assertClassicLayoutReadable,
  assertClassicLayoutWritable,
  classicProjectRelative,
} from './classic-layout.js';
import {
  ensureClassicProjectDirectory,
  inspectClassicProjectTarget,
} from './classic-protected-path.js';

export interface ClassicChangeDirectory {
  label: string;
  directory: string;
}

export interface FindClassicArchiveChangeDirectoryOptions {
  preferredArchiveName?: string;
  skipExactCompatibility?: boolean;
}

export function openSpecChangeNameError(name: string | undefined): string | null {
  if (!name) return 'Change name cannot be empty';
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) {
    return `Invalid change name: '${name}'\nValid format: lowercase kebab-case (a-z, 0-9, single hyphens)`;
  }
  if (name.includes('..')) return "Change name cannot contain '..' (path traversal not allowed)";
  return null;
}

export function assertOpenSpecChangeName(name: string | undefined): asserts name is string {
  const error = openSpecChangeNameError(name);
  if (error) throw new Error(error);
}

function changeDirectory(projectRoot: string, directory: string): ClassicChangeDirectory {
  return {
    label: classicProjectRelative(projectRoot, directory),
    directory,
  };
}

async function inspectChangeDirectory(
  projectRoot: string,
  directory: string,
  label: string,
): Promise<{ change: ClassicChangeDirectory; exists: boolean; stateExists: boolean }> {
  const change = changeDirectory(projectRoot, directory);
  const inspection = await inspectClassicProjectTarget(projectRoot, directory, {
    label,
    expected: 'directory',
  });
  if (!inspection.exists) return { change, exists: false, stateExists: false };
  const state = await inspectClassicProjectTarget(
    projectRoot,
    path.join(directory, '.comet.yaml'),
    {
      label: `${label} state`,
      expected: 'file',
    },
  );
  return { change, exists: true, stateExists: state.exists };
}

function archiveNameMatchesChange(entryName: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`, 'u').test(entryName);
}

async function findArchiveChangeDirectory(
  projectRoot: string,
  archiveDir: string,
  name: string,
  options: Pick<FindClassicArchiveChangeDirectoryOptions, 'skipExactCompatibility'> = {},
): Promise<ClassicChangeDirectory | null> {
  if (!options.skipExactCompatibility) {
    const exact = await inspectChangeDirectory(
      projectRoot,
      path.join(archiveDir, name),
      `Classic archived change ${name}`,
    );
    if (exact.exists) return exact.change;
  }

  const archive = await inspectClassicProjectTarget(projectRoot, archiveDir, {
    label: 'Classic archive directory',
    expected: 'directory',
  });
  if (!archive.exists) return null;

  const matches: ClassicChangeDirectory[] = [];
  for (const entry of await fs.readdir(archiveDir, { withFileTypes: true })) {
    if (!archiveNameMatchesChange(entry.name, name)) continue;
    const candidate = await inspectChangeDirectory(
      projectRoot,
      path.join(archiveDir, entry.name),
      `Classic archived change ${entry.name}`,
    );
    if (candidate.exists && candidate.stateExists) matches.push(candidate.change);
  }
  return matches.sort((left, right) => right.directory.localeCompare(left.directory))[0] ?? null;
}

export async function inspectClassicActiveChangeDirectory(
  name: string,
  projectRoot = process.cwd(),
): Promise<ClassicChangeDirectory & { exists: boolean; stateExists: boolean }> {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  const inspection = await inspectChangeDirectory(
    layout.projectRoot,
    path.join(layout.changesDir, name),
    `Classic active change ${name}`,
  );
  return {
    ...inspection.change,
    exists: inspection.exists,
    stateExists: inspection.stateExists,
  };
}

export async function ensureClassicActiveChangeDirectory(
  name: string,
  projectRoot = process.cwd(),
): Promise<ClassicChangeDirectory> {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutWritable(projectRoot);
  const directory = path.join(layout.changesDir, name);
  const inspection = await inspectChangeDirectory(
    layout.projectRoot,
    directory,
    `Classic active change ${name}`,
  );
  if (!inspection.exists) {
    await ensureClassicProjectDirectory(
      layout.projectRoot,
      directory,
      `Classic active change ${name}`,
    );
  }
  return inspection.change;
}

export async function findClassicArchiveChangeDirectory(
  name: string,
  projectRoot = process.cwd(),
  options: FindClassicArchiveChangeDirectoryOptions = {},
): Promise<ClassicChangeDirectory | null> {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  if (options.preferredArchiveName !== undefined) {
    const preferred = options.preferredArchiveName;
    if (preferred !== name && !archiveNameMatchesChange(preferred, name)) {
      throw new Error(
        `Classic preferred archive name '${preferred}' does not belong to change '${name}'`,
      );
    }
    const inspection = await inspectChangeDirectory(
      layout.projectRoot,
      path.join(layout.archiveDir, preferred),
      `Classic preferred archived change ${preferred}`,
    );
    return inspection.exists && inspection.stateExists ? inspection.change : null;
  }
  return findArchiveChangeDirectory(layout.projectRoot, layout.archiveDir, name, options);
}

export async function resolveClassicChangeDirectory(
  name: string,
  projectRoot = process.cwd(),
): Promise<ClassicChangeDirectory> {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  const active = await inspectChangeDirectory(
    layout.projectRoot,
    path.join(layout.changesDir, name),
    `Classic active change ${name}`,
  );
  if (active.exists) return active.change;

  const archived = await findArchiveChangeDirectory(layout.projectRoot, layout.archiveDir, name);
  if (archived) return archived;

  // Fallback: return the active path even if the change doesn't exist in active or archive.
  // This is intentional — matches 0.3.9 behavior where downstream commands report
  // "not found" errors with the expected path, rather than failing silently here.
  return active.change;
}
