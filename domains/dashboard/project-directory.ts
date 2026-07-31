import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import {
  ProjectRegistryError,
  readProjectRegistry,
  type ProjectRegistryEntry,
} from '../../platform/install/project-registry.js';

export type DashboardProjectAvailability = 'available' | 'missing' | 'unreadable';

export interface DashboardProjectEntry {
  id: string;
  name: string;
  path: string;
  lastSeenAt: string | null;
  availability: DashboardProjectAvailability;
  isCurrent: boolean;
}

export interface DashboardProjectDirectory {
  currentProjectId: string;
  projects: DashboardProjectEntry[];
  warning?: string;
}

export interface DashboardProjectDirectoryOptions {
  homeDir?: string;
}

function canonicalKey(projectPath: string): string {
  const normalized = path.resolve(projectPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function projectId(projectPath: string): string {
  return createHash('sha256').update(canonicalKey(projectPath)).digest('base64url').slice(0, 22);
}

function projectName(projectPath: string): string {
  const parsed = path.parse(projectPath);
  return path.basename(projectPath) || parsed.root || projectPath;
}

async function availabilityOf(projectPath: string): Promise<DashboardProjectAvailability> {
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) return 'missing';
    await fs.access(projectPath);
    return 'available';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
}

function registryWarning(error: unknown): string | undefined {
  if (!(error instanceof ProjectRegistryError)) return undefined;
  return error.code === 'invalid-json'
    ? '项目索引无效，当前仅显示启动项目。'
    : '项目索引格式无效，当前仅显示启动项目。';
}

function sortEntries(left: DashboardProjectEntry, right: DashboardProjectEntry): number {
  if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
  const bySeen = (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? '');
  if (bySeen !== 0) return bySeen;
  return left.name.localeCompare(right.name);
}

export async function collectDashboardProjectDirectory(
  currentProjectPath: string,
  options: DashboardProjectDirectoryOptions = {},
): Promise<DashboardProjectDirectory> {
  const currentPath = path.resolve(currentProjectPath);
  let registryProjects: ProjectRegistryEntry[] = [];
  let warning: string | undefined;

  try {
    registryProjects = (await readProjectRegistry({ homeDir: options.homeDir, strict: true }))
      .projects;
  } catch (error) {
    warning = registryWarning(error) ?? '无法读取项目索引，当前仅显示启动项目。';
  }

  const candidates = new Map<string, { path: string; lastSeenAt: string | null }>();
  candidates.set(canonicalKey(currentPath), { path: currentPath, lastSeenAt: null });
  for (const entry of registryProjects) {
    const key = canonicalKey(entry.canonicalPath || entry.path);
    const existing = candidates.get(key);
    candidates.set(key, {
      path: entry.path,
      lastSeenAt: existing?.lastSeenAt ?? entry.lastSeenAt,
    });
  }

  const currentKey = canonicalKey(currentPath);
  const projects = await Promise.all(
    [...candidates.entries()].map(async ([key, candidate]) => ({
      id: projectId(candidate.path),
      name: projectName(candidate.path),
      path: candidate.path,
      lastSeenAt: candidate.lastSeenAt,
      availability: await availabilityOf(candidate.path),
      isCurrent: key === currentKey,
    })),
  );
  projects.sort(sortEntries);

  const current = projects.find((project) => project.isCurrent);
  if (!current) throw new Error('Dashboard project directory lost its current project');

  return {
    currentProjectId: current.id,
    projects,
    ...(warning ? { warning } : {}),
  };
}

export function findDashboardProject(
  directory: DashboardProjectDirectory,
  id: string,
): DashboardProjectEntry | undefined {
  return directory.projects.find((project) => project.id === id);
}
