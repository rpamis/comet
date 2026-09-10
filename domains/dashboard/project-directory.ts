import { createHash } from 'node:crypto';
import { promises as fs } from 'fs';
import path from 'path';

import {
  ProjectRegistryError,
  readProjectRegistry,
  type ProjectRegistryEntry,
} from '../../platform/install/project-registry.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import type { CometProjectWorkflow } from '../workflow-contract/types.js';

export type DashboardProjectAvailability = 'available' | 'missing' | 'unreadable';
export type DashboardProjectWorkflowSource = 'configured' | 'fallback';

export interface DashboardProjectEntry {
  id: string;
  name: string;
  path: string;
  lastSeenAt: string | null;
  availability: DashboardProjectAvailability;
  isCurrent: boolean;
  defaultWorkflow: CometProjectWorkflow;
  workflowSource: DashboardProjectWorkflowSource;
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

function projectId(canonicalPath: string): string {
  // Dashboard routes address a working directory, not a repository shared by worktrees.
  return `dashboard-${createHash('sha256').update(canonicalPath).digest('hex')}`;
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

async function projectWorkflow(
  projectPath: string,
  availability: DashboardProjectAvailability,
): Promise<Pick<DashboardProjectEntry, 'defaultWorkflow' | 'workflowSource'>> {
  if (availability !== 'available') {
    return { defaultWorkflow: 'classic', workflowSource: 'fallback' };
  }
  try {
    const config = await readWorkflowProjectConfig(projectPath);
    if (config?.default_workflow === 'native' || config?.default_workflow === 'classic') {
      return { defaultWorkflow: config.default_workflow, workflowSource: 'configured' };
    }
  } catch {
    // The project directory remains usable when an optional workflow hint cannot be read.
  }
  return { defaultWorkflow: 'classic', workflowSource: 'fallback' };
}

export async function collectDashboardProjectDirectory(
  currentProjectPath: string,
  options: DashboardProjectDirectoryOptions = {},
): Promise<DashboardProjectDirectory> {
  const currentPath = path.resolve(currentProjectPath);
  const currentKey = canonicalKey(await fs.realpath(currentPath).catch(() => currentPath));
  let registryProjects: ProjectRegistryEntry[] = [];
  let warning: string | undefined;

  try {
    registryProjects = (await readProjectRegistry({ homeDir: options.homeDir, strict: true }))
      .projects;
  } catch (error) {
    warning = registryWarning(error) ?? '无法读取项目索引，当前仅显示启动项目。';
  }

  const candidates = new Map<string, { path: string; lastSeenAt: string | null }>();
  candidates.set(currentKey, { path: currentPath, lastSeenAt: null });
  for (const entry of registryProjects) {
    const key = canonicalKey(entry.canonicalPath || entry.path);
    const existing = candidates.get(key);
    candidates.set(key, {
      path: entry.path,
      lastSeenAt: existing?.lastSeenAt ?? entry.lastSeenAt,
    });
  }

  const projects = await Promise.all(
    [...candidates.entries()].map(async ([key, candidate]) => {
      const availability = await availabilityOf(candidate.path);
      const workflow = await projectWorkflow(candidate.path, availability);
      return {
        id: projectId(key),
        name: projectName(candidate.path),
        path: candidate.path,
        lastSeenAt: candidate.lastSeenAt,
        availability,
        isCurrent: key === currentKey,
        ...workflow,
      };
    }),
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
