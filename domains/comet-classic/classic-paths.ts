import { resolveClassicStateFile } from './classic-state-file.js';
import { classicOperationObservation } from './classic-command-context.js';
import { promises as fs } from 'fs';
import path from 'path';

import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
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

export async function collectClassicSpecFiles(
  projectRoot: string,
  specsDir: string,
): Promise<string[]> {
  const files: string[] = [];
  const ancestors = new Set<string>();
  async function visit(directory: string, capability: boolean): Promise<void> {
    const inspection = await inspectClassicProjectTarget(projectRoot, directory, {
      label: 'Classic capability directory',
      expected: 'directory',
    });
    if (!inspection.exists) return;
    const real = await fs.realpath(inspection.target);
    if (ancestors.has(real)) throw new Error(`Classic capability directory cycle: ${directory}`);
    ancestors.add(real);
    if (capability) {
      const spec = `${directory}/spec.md`;
      const target = await inspectClassicProjectTarget(projectRoot, spec, {
        label: 'Classic capability spec',
        expected: 'file',
      });
      if (target.exists) files.push(spec);
    }
    const entries = (await fs.readdir(inspection.target, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.name === 'spec.md') continue;
        await visit(`${directory}/${entry.name}`, true);
      }
    }
    ancestors.delete(real);
  }
  await visit(specsDir.replaceAll('\\', '/'), false);
  return files;
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

/** 只读检查状态文件并返回 SDK 恢复候选；不要求已有 Classic 项目配置。 */
export async function inspectClassicStateFileCandidates(
  projectRoot: string,
  name: string,
): Promise<string[]> {
  assertOpenSpecChangeName(name);
  const files: string[] = [];
  const candidate = async (directory: string) => {
    await inspectProtectedProjectPath(projectRoot, path.relative(projectRoot, directory), {
      label: 'Classic change directory',
      expected: 'directory',
    });
    return resolveClassicStateFile(directory);
  };
  for (const rootRef of ['openspec/changes', 'docs/openspec/changes']) {
    files.push(await candidate(path.join(projectRoot, rootRef, name)));
    const archiveDir = path.join(projectRoot, rootRef, 'archive');
    const entries = await inspectClassicArchiveChangeNames(projectRoot, archiveDir, name);
    for (const entry of entries ?? []) {
      if (entry === name) {
        // 历史 compat 无日期归档也须检查，但不扩大 SDK checkpoint 的恢复范围。
        await candidate(path.join(archiveDir, entry));
      } else if (archiveNameMatchesChange(entry, name)) {
        files.push(await candidate(path.join(archiveDir, entry)));
      }
    }
  }
  return files;
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
    await resolveClassicStateFile(directory),
    {
      label: `${label} state`,
      expected: 'file',
    },
  );
  return { change, exists: true, stateExists: state.exists };
}

const ARCHIVE_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/u;

function archiveNameMatchesChange(entryName: string, name: string): boolean {
  return entryName.slice(11) === name && ARCHIVE_DATE_PREFIX.test(entryName);
}

/** 只复用本次命令中未变化的目录列表；候选路径与状态文件仍须逐次检查。 */
export async function inspectClassicArchiveChangeNames(
  projectRoot: string,
  archiveDir: string,
  name: string,
): Promise<readonly string[] | null> {
  assertOpenSpecChangeName(name);
  const inspect = () =>
    inspectProtectedProjectPath(projectRoot, path.relative(projectRoot, archiveDir), {
      label: 'Classic Archive directory',
      expected: 'directory',
    });
  const archive = await inspect();
  if (!archive.exists) return null;
  const fingerprint = async () => {
    const stat = await fs.lstat(archive.target, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Classic Archive directory must be a real directory');
    }
    return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  };
  const before = await fingerprint();
  const entries = await classicOperationObservation(
    `classic-archive:${JSON.stringify([archive.target, name, before])}`,
    async () => {
      const entries = await fs.readdir(archive.target);
      if ((await fingerprint()) !== before) {
        throw new Error('Classic Archive directory changed while inspecting state files');
      }
      return entries.filter((entry) => entry === name || archiveNameMatchesChange(entry, name));
    },
  );
  // 缓存命中也检查路径链和目录身份，拒绝并发替换、移动或新增目录。
  if (!(await inspect()).exists || (await fingerprint()) !== before) {
    throw new Error('Classic Archive directory changed while inspecting state files');
  }
  return entries;
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

  const entries = await inspectClassicArchiveChangeNames(projectRoot, archiveDir, name);
  const matches: ClassicChangeDirectory[] = [];
  for (const entry of entries ?? []) {
    if (entry === name) continue;
    const candidate = await inspectChangeDirectory(
      projectRoot,
      path.join(archiveDir, entry),
      `Classic archived change ${entry}`,
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
