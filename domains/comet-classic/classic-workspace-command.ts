import type { ClassicCommandHandler } from './classic-cli.js';
import { classicCommandProjectRoot } from './classic-command-context.js';
import {
  classicWorkspaceCommandResult,
  prepareClassicWorkspace,
  resolveClassicWorkspace,
  type ClassicWorkspaceIsolation,
} from './classic-workspace.js';

function usage(): never {
  throw new Error(
    'Usage: comet classic workspace prepare <change-name> --isolation <current|branch|worktree> [--change-branch <branch>] [--target-branch <branch>] [--worktree-path <path>] | comet classic workspace resolve <change-name>',
  );
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export const classicWorkspaceCommand: ClassicCommandHandler = async (args) => {
  const [action, name, ...rest] = args;
  if (!action || !name) usage();
  if (action === 'resolve') {
    if (rest.length > 0) usage();
    return classicWorkspaceCommandResult(
      'resolve',
      await resolveClassicWorkspace({ projectRoot: classicCommandProjectRoot(), name }),
    );
  }
  if (action !== 'prepare') usage();
  const isolation = option(rest, '--isolation') as ClassicWorkspaceIsolation | undefined;
  if (!isolation || !['current', 'branch', 'worktree'].includes(isolation)) {
    throw new Error('--isolation must be current, branch, or worktree');
  }
  const changeBranch = option(rest, '--change-branch');
  const targetBranch = option(rest, '--target-branch');
  const worktreePath = option(rest, '--worktree-path');
  if (rest.length > 0) usage();
  return classicWorkspaceCommandResult(
    'prepare',
    await prepareClassicWorkspace({
      projectRoot: classicCommandProjectRoot(),
      name,
      isolation,
      ...(changeBranch ? { changeBranch } : {}),
      ...(targetBranch ? { targetBranch } : {}),
      ...(worktreePath ? { worktreePath } : {}),
    }),
  );
};
