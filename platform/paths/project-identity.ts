import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { runGitCommand } from '../process/git.js';
import { resolvePortablePath } from './portable-path.js';

export interface ProjectIdentityOptions {
  readonly runGit?: (projectRoot: string, args: readonly string[]) => string;
}

type IdentityObservation = { identity: string; name: string };
type IdentityScope = {
  active: boolean;
  observations: Map<
    string,
    Map<NonNullable<ProjectIdentityOptions['runGit']>, IdentityObservation>
  >;
};
const identityScope = new AsyncLocalStorage<IdentityScope>();

/** Share only this request's observations; a later request always re-reads Git. */
export function withProjectIdentityScope<T>(operation: () => T): T {
  const scope: IdentityScope = { active: true, observations: new Map() };
  const close = () => {
    scope.active = false;
    scope.observations.clear();
  };
  return identityScope.run(scope, () => {
    try {
      const result = operation();
      if (result instanceof Promise) return result.finally(close) as T;
      close();
      return result;
    } catch (error) {
      close();
      throw error;
    }
  });
}

function observeProjectIdentity(
  projectRoot: string,
  options: ProjectIdentityOptions,
): IdentityObservation {
  const root = resolvePortablePath(projectRoot);
  const run = options.runGit ?? runGitCommand;
  const currentScope = identityScope.getStore();
  const scope = currentScope?.active ? currentScope.observations : undefined;
  const cached = scope?.get(root)?.get(run);
  if (cached) return cached;
  let source = root;
  try {
    const remote = run(root, ['remote', 'get-url', 'origin']).trim();
    if (remote) source = remote;
    else throw new Error('No origin');
  } catch {
    try {
      const commonDir = run(root, ['rev-parse', '--git-common-dir']).trim();
      if (commonDir) source = resolvePortablePath(root, commonDir);
    } catch {
      // Non-Git directories retain the existing canonical path fallback.
    }
  }
  const observation = { identity: normalizeIdentity(source), name: readableProjectName(source) };
  if (scope) {
    const roots = scope.get(root) ?? new Map();
    roots.set(run, observation);
    scope.set(root, roots);
  }
  return observation;
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
  return observeProjectIdentity(projectRoot, options).identity;
}

export function stableProjectId(identity: string): string {
  const normalized = normalizeIdentity(identity);
  const leaf = normalized.split(/[/:]/u).filter(Boolean).at(-1) ?? 'project';
  const slug = trimBoundaryDashes(leaf.replace(/[^a-z0-9._-]+/gu, '-')) || 'project';
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
  return observeProjectIdentity(projectRoot, options).name;
}

function readableProjectName(value: string): string {
  const normalized = trimTrailingSlashes(
    value
      .trim()
      .replace(/\\/gu, '/')
      .replace(/\.git$/iu, ''),
  );
  const leaf = normalized.split(/[/:]/u).filter(Boolean).at(-1) ?? 'project';
  return trimBoundaryDashes(leaf.replace(/[^a-zA-Z0-9._-]+/gu, '-')) || 'project';
}

function normalizeIdentity(value: string): string {
  const normalized = trimTrailingSlashes(
    value
      .trim()
      .replace(/\\/gu, '/')
      .replace(/\.git$/iu, ''),
  ).toLocaleLowerCase();
  if (!normalized) return 'project';
  return normalized;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

function trimBoundaryDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start++;
  while (end > start && value[end - 1] === '-') end--;
  return value.slice(start, end);
}
