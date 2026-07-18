import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';

export function liveGitBranch(cwd: string): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

export function isGitWorkTree(cwd: string): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

export type BranchBindingVerdict =
  | { status: 'not-applicable' }
  | { status: 'ok' }
  | { status: 'needs-heal'; branch: string }
  | { status: 'unbound-detached' }
  | { status: 'drift'; boundBranch: string; currentBranch: string | null };

export const BOUND_BRANCH_ISOLATIONS = ['current', 'branch', 'worktree'] as const;

export function requiresBranchBinding(isolation: string | null): boolean {
  return BOUND_BRANCH_ISOLATIONS.includes(isolation as (typeof BOUND_BRANCH_ISOLATIONS)[number]);
}

export function evaluateBranchBinding(input: {
  isolation: string | null;
  boundBranch: string | null;
  currentBranch: string | null;
  gitWorkTree?: boolean;
}): BranchBindingVerdict {
  if (!requiresBranchBinding(input.isolation)) return { status: 'not-applicable' };
  if (input.boundBranch === null && input.currentBranch === null && input.gitWorkTree === false) {
    return { status: 'not-applicable' };
  }
  if (input.boundBranch === null) {
    return input.currentBranch === null
      ? { status: 'unbound-detached' }
      : { status: 'needs-heal', branch: input.currentBranch };
  }
  if (input.currentBranch === input.boundBranch) return { status: 'ok' };
  return { status: 'drift', boundBranch: input.boundBranch, currentBranch: input.currentBranch };
}

export async function healBoundBranch(changeDir: string, branch: string): Promise<void> {
  const file = path.join(changeDir, '.comet.yaml');
  const document = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: false });
  document.set('bound_branch', branch);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, document.toString(), 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function branchLabel(currentBranch: string | null): string {
  return currentBranch ?? 'detached HEAD';
}

export function driftBlockedMessage(
  change: string,
  boundBranch: string,
  currentBranch: string | null,
): string {
  return (
    `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'.\n` +
    `Next: ask the user to confirm — switch back to '${boundBranch}', or run \`comet state rebind ${change}\` after explicit confirmation.`
  );
}

export function driftStaleReason(
  change: string,
  boundBranch: string,
  currentBranch: string | null,
): string {
  return `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'`;
}

export function unboundDetachedMessage(change: string): string {
  return `change '${change}' uses a branch-bound workspace mode but has no bound branch and HEAD is detached; checkout a branch first before continuing.`;
}
