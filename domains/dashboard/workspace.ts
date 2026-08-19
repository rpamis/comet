import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree, listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';
import { PROJECT_CONFIG_FILE } from '../comet-native/native-paths.js';

const DASHBOARD_CHANGE_LOCATOR_PREFIX = 'dashboard-change-v1';
const WORKSPACE_ID_PATTERN = /^[a-f0-9]{64}$/u;

export interface DashboardWorkspaceIdentity {
  id: string;
  label: string;
  branch: string | null;
  current: boolean;
}

export interface DashboardWorkspaceSource extends DashboardWorkspaceIdentity {
  projectRoot: string;
}

export interface DashboardChangeLocator {
  workspaceId: string;
  identity: string;
}

function normalizedPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function sameDashboardPath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

export function dashboardWorkspaceId(projectRoot: string): string {
  return createHash('sha256').update(normalizedPath(projectRoot), 'utf8').digest('hex');
}

function workspaceLabel(projectRoot: string, branch: string | null): string {
  return branch ?? `detached:${path.basename(projectRoot)}`;
}

function hasProjectConfig(root: string): boolean {
  return existsSync(path.join(root, ...PROJECT_CONFIG_FILE.split('/')));
}

/**
 * Treat every registered worktree in one Git common repository as a Dashboard
 * discovery source. Non-Git projects retain the previous single-root behavior.
 * When the requested directory is a monorepo subdirectory that carries the
 * Comet project config, the subdirectory (not the worktree root) is the
 * workspace root, and sibling worktrees map to the same relative subdirectory.
 */
export function collectDashboardWorkspaceSources(projectRoot: string): DashboardWorkspaceSource[] {
  const requestedRoot = path.resolve(projectRoot);
  const requestedContext = inspectGitWorktree(requestedRoot);
  const worktreeRoot = requestedContext.currentWorktreeRoot ?? requestedRoot;
  const requestedSubdir = path.relative(worktreeRoot, requestedRoot);
  const monorepoSubdir =
    requestedSubdir !== '' &&
    !requestedSubdir.startsWith('..') &&
    !path.isAbsolute(requestedSubdir) &&
    hasProjectConfig(requestedRoot)
      ? requestedSubdir
      : null;
  const currentRoot = monorepoSubdir ? requestedRoot : worktreeRoot;
  const discovered = listGitWorktreeRoots(worktreeRoot).map((root) => {
    if (!monorepoSubdir) return root;
    const candidate = path.join(root, monorepoSubdir);
    return hasProjectConfig(candidate) ? candidate : root;
  });
  const roots = discovered.length > 0 ? discovered : [requestedRoot];
  if (!roots.some((candidate) => sameDashboardPath(candidate, currentRoot))) {
    roots.push(currentRoot);
  }

  const unique = new Map<string, string>();
  for (const candidate of roots) {
    const resolved = path.resolve(candidate);
    unique.set(normalizedPath(resolved), resolved);
  }

  return [...unique.values()]
    .map((candidate): DashboardWorkspaceSource => {
      const context = inspectGitWorktree(candidate);
      const branch = context.currentBranch;
      return {
        id: dashboardWorkspaceId(candidate),
        label: workspaceLabel(candidate, branch),
        branch,
        current: sameDashboardPath(candidate, currentRoot),
        projectRoot: candidate,
      };
    })
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return (
        left.label.localeCompare(right.label) || left.projectRoot.localeCompare(right.projectRoot)
      );
    });
}

export function dashboardWorkspaceIdentity(
  source: DashboardWorkspaceSource,
): DashboardWorkspaceIdentity {
  return {
    id: source.id,
    label: source.label,
    branch: source.branch,
    current: source.current,
  };
}

export function encodeDashboardChangeLocator(workspaceId: string, identity: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId) || !identity || identity.length > 4096) {
    throw new Error('Dashboard change locator input is invalid');
  }
  return `${DASHBOARD_CHANGE_LOCATOR_PREFIX}.${workspaceId}.${Buffer.from(identity, 'utf8').toString('base64url')}`;
}

export function parseDashboardChangeLocator(value: string): DashboardChangeLocator | null {
  const parts = value.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== DASHBOARD_CHANGE_LOCATOR_PREFIX ||
    !WORKSPACE_ID_PATTERN.test(parts[1]) ||
    !parts[2]
  ) {
    return null;
  }
  try {
    const identity = Buffer.from(parts[2], 'base64url').toString('utf8');
    if (!identity || identity.length > 4096) return null;
    return { workspaceId: parts[1], identity };
  } catch {
    return null;
  }
}
