import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { runGitCommand } from '../process/git.js';

type WorktreeRootScope = { active: boolean; roots: Map<string, string> };
const worktreeRootScope = new AsyncLocalStorage<WorktreeRootScope>();

/** 只复用当前请求已确认的根目录，结束后重新读取 Git。 */
export function withProjectWorktreeRootScope<T>(operation: () => T): T {
  const scope: WorktreeRootScope = { active: true, roots: new Map() };
  const close = () => {
    scope.active = false;
    scope.roots.clear();
  };
  return worktreeRootScope.run(scope, () => {
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

/** Use one source and review queue for paths inside the same checkout. */
export function resolveProjectWorktreeRoot(projectPath: string): string {
  const root = path.resolve(projectPath);
  const currentScope = worktreeRootScope.getStore();
  const roots = currentScope?.active ? currentScope.roots : undefined;
  const cached = roots?.get(root);
  if (cached) return cached;
  try {
    const topLevel = path.resolve(runGitCommand(root, ['rev-parse', '--show-toplevel']));
    roots?.set(root, topLevel);
    roots?.set(topLevel, topLevel);
    return topLevel;
  } catch {
    return root;
  }
}
