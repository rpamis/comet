import path from 'node:path';
import { runGitCommand } from '../process/git.js';

/** Use one source and review queue for paths inside the same checkout. */
export function resolveProjectWorktreeRoot(projectPath: string): string {
  const root = path.resolve(projectPath);
  try {
    const topLevel = path.resolve(runGitCommand(root, ['rev-parse', '--show-toplevel']));
    return topLevel;
  } catch {
    return root;
  }
}
