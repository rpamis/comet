import { createHash } from 'node:crypto';

import { runGitCommand } from '../process/git.js';
import { resolvePortablePath } from './portable-path.js';

export interface ProjectIdentityOptions {
  readonly runGit?: (projectRoot: string, args: readonly string[]) => string;
}

/**
 * Resolve an identity that survives a worktree, directory move, or fresh clone.
 * A configured origin is preferred; the shared Git directory and path are only
 * fallbacks for repositories without a remote.
 */
export function resolveProjectIdentity(
  projectRoot: string,
  options: ProjectIdentityOptions = {},
): string {
  const root = resolvePortablePath(projectRoot);
  const run = options.runGit ?? runGitCommand;
  try {
    const remote = run(root, ['remote', 'get-url', 'origin']).trim();
    if (remote) return normalizeIdentity(remote);
  } catch {
    // A repository may not have an origin; continue with its shared Git dir.
  }
  try {
    const commonDir = run(root, ['rev-parse', '--git-common-dir']).trim();
    if (commonDir) return normalizeIdentity(resolvePortablePath(root, commonDir));
  } catch {
    // Continue with the canonical project path for non-Git directories.
  }
  return normalizeIdentity(root);
}

export function stableProjectId(identity: string): string {
  const normalized = normalizeIdentity(identity);
  const leaf = normalized.split(/[/:]/u).filter(Boolean).at(-1) ?? 'project';
  const slug = leaf.replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'project';
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 8);
  return `${slug.slice(0, 40)}-${digest}`;
}

export function resolveStableProjectId(
  projectRoot: string,
  options: ProjectIdentityOptions = {},
): string {
  return stableProjectId(resolveProjectIdentity(projectRoot, options));
}

export function resolveProjectName(
  projectRoot: string,
  options: ProjectIdentityOptions = {},
): string {
  const root = resolvePortablePath(projectRoot);
  const run = options.runGit ?? runGitCommand;
  try {
    const remote = run(root, ['remote', 'get-url', 'origin']).trim();
    if (remote) return readableProjectName(remote);
  } catch {
    // Continue with the shared Git directory when no origin is configured.
  }
  try {
    const commonDir = run(root, ['rev-parse', '--git-common-dir']).trim();
    if (commonDir) return readableProjectName(resolvePortablePath(root, commonDir));
  } catch {
    // Continue with the current project path for non-Git directories.
  }
  return readableProjectName(root);
}

function readableProjectName(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\.git$/iu, '')
    .replace(/\/+$/u, '');
  const leaf = normalized.split(/[/:]/u).filter(Boolean).at(-1) ?? 'project';
  return leaf.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'project';
}

function normalizeIdentity(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\.git$/iu, '')
    .replace(/\/+$/u, '')
    .toLocaleLowerCase();
  if (!normalized) return 'project';
  return normalized;
}
