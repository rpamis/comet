import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isCommandAvailable, getNpmExecutable } from './openspec.js';
import { printCommandErrorDetails } from '../../platform/process/command-error.js';

import type { InstallScope } from '../../platform/install/types.js';

type CodegraphIndexStatus =
  | 'cli_missing'
  | 'cli_ready'
  | 'project_not_initialized'
  | 'index_incomplete'
  | 'index_stale'
  | 'index_ready'
  | 'status_unavailable';

interface CodegraphIndexDiagnostic {
  status: CodegraphIndexStatus;
  repairable: boolean;
  remediation: string | null;
  detail: string;
}

function getPnpmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function hasCodegraphProjectIndex(projectPath: string): boolean {
  const codegraphDir = path.join(projectPath, '.codegraph');
  try {
    if (!fs.statSync(codegraphDir).isDirectory()) return false;
    return fs.readdirSync(codegraphDir).some((entry) => entry !== '.gitignore');
  } catch {
    return false;
  }
}

function resolvePnpmGlobalCommand(command: string): string | null {
  try {
    const binDir = execFileSync(getPnpmExecutable(), ['bin', '-g'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      shell: process.platform === 'win32',
    }).trim();
    if (!binDir) return null;

    const candidates =
      process.platform === 'win32'
        ? [`${command}.cmd`, `${command}.exe`, `${command}.ps1`, command]
        : [command];

    for (const candidate of candidates) {
      const candidatePath = path.join(binDir, candidate);
      if (fs.existsSync(candidatePath)) return candidatePath;
    }
  } catch {
    // pnpm may not be installed or may not have a global bin configured.
  }

  return null;
}

function resolveCodegraphCommand(): string | null {
  if (isCommandAvailable('codegraph')) return 'codegraph';
  return resolvePnpmGlobalCommand('codegraph');
}

function numericField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inspectCodegraphIndex(projectPath: string): CodegraphIndexDiagnostic {
  const codegraphCommand = resolveCodegraphCommand();
  if (!codegraphCommand) {
    return {
      status: 'cli_missing',
      repairable: false,
      remediation: 'npm install -g @colbymchenry/codegraph',
      detail: 'CodeGraph CLI is not installed',
    };
  }

  if (!hasCodegraphProjectIndex(projectPath)) {
    return {
      status: 'project_not_initialized',
      repairable: true,
      remediation: 'codegraph init -i',
      detail: 'CodeGraph CLI is installed but this project has no usable index',
    };
  }

  try {
    const output = execFileSync(codegraphCommand, ['status', '--json', projectPath], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      shell: process.platform === 'win32',
    });
    const line = String(output).trim().split(/\r?\n/u).filter(Boolean).at(-1);
    if (!line) throw new Error('status returned no JSON');
    const payload = JSON.parse(line) as Record<string, unknown>;
    if (payload.initialized !== true) {
      return {
        status: 'project_not_initialized',
        repairable: true,
        remediation: 'codegraph init -i',
        detail: 'CodeGraph reports that this project is not initialized',
      };
    }

    const index =
      payload.index && typeof payload.index === 'object'
        ? (payload.index as Record<string, unknown>)
        : {};
    const indexState = typeof index.state === 'string' ? index.state : null;
    const pendingRefs = numericField(index.pendingRefs);
    const incompleteState =
      indexState === 'indexing' || indexState === 'partial' || indexState === 'failed';
    if (incompleteState || pendingRefs > 0) {
      return {
        status: 'index_incomplete',
        repairable: true,
        remediation: incompleteState ? 'codegraph index' : 'codegraph sync',
        detail:
          pendingRefs > 0
            ? `CodeGraph index has ${pendingRefs} unresolved reference(s)`
            : `CodeGraph index state is ${indexState}`,
      };
    }

    const pending =
      payload.pendingChanges && typeof payload.pendingChanges === 'object'
        ? (payload.pendingChanges as Record<string, unknown>)
        : {};
    const pendingChanges =
      numericField(pending.added) + numericField(pending.modified) + numericField(pending.removed);
    if (
      index.reindexRecommended === true ||
      pendingChanges > 0 ||
      (payload.worktreeMismatch !== null && payload.worktreeMismatch !== undefined)
    ) {
      const worktreeMismatch =
        payload.worktreeMismatch !== null && payload.worktreeMismatch !== undefined;
      return {
        status: 'index_stale',
        repairable: true,
        remediation: worktreeMismatch
          ? 'codegraph init -i'
          : index.reindexRecommended === true
            ? 'codegraph index'
            : 'codegraph sync',
        detail: worktreeMismatch
          ? 'CodeGraph is borrowing an index from another Git worktree'
          : index.reindexRecommended === true
            ? 'CodeGraph recommends rebuilding an index created by an older extraction version'
            : `CodeGraph index has ${pendingChanges} pending change(s)`,
      };
    }

    return {
      status: 'index_ready',
      repairable: false,
      remediation: null,
      detail: 'CodeGraph index is initialized and current',
    };
  } catch (error) {
    return {
      status: 'status_unavailable',
      repairable: false,
      remediation: 'codegraph status --json .',
      detail: `Unable to inspect CodeGraph index: ${(error as Error).message}`,
    };
  }
}

function repairCodegraphIndex(
  projectPath: string,
  status: Extract<
    CodegraphIndexStatus,
    'project_not_initialized' | 'index_incomplete' | 'index_stale'
  >,
  quiet = false,
): void {
  const codegraphCommand = resolveCodegraphCommand();
  if (!codegraphCommand) {
    throw new Error('CodeGraph CLI is not installed');
  }
  const args =
    status === 'project_not_initialized'
      ? ['init', '-i']
      : status === 'index_incomplete'
        ? ['index']
        : ['sync'];
  execFileSync(codegraphCommand, args, {
    cwd: projectPath,
    stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    timeout: status === 'index_stale' ? 300_000 : 600_000,
    shell: process.platform === 'win32',
  });
}

async function ensureCodegraphCli(
  projectPath: string,
  shouldInstall = true,
  quiet = false,
): Promise<string | null> {
  const existingCommand = resolveCodegraphCommand();
  if (existingCommand) return existingCommand;
  if (!shouldInstall) return null;

  if (!quiet) console.log('    Installing CodeGraph CLI...');
  try {
    execFileSync(getNpmExecutable(), ['install', '-g', '@colbymchenry/codegraph'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    return resolveCodegraphCommand();
  } catch (error) {
    console.error(`    Failed to install CodeGraph CLI: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return null;
  }
}

async function installCodegraph(
  projectPath: string,
  scope: InstallScope,
  shouldInstallCli = true,
  quiet = false,
): Promise<'installed' | 'failed' | 'skipped'> {
  if (hasCodegraphProjectIndex(projectPath)) {
    if (!quiet) console.log('    CodeGraph: existing .codegraph index detected');
    return 'skipped';
  }

  const codegraphCommand = await ensureCodegraphCli(projectPath, shouldInstallCli, quiet);
  if (!codegraphCommand) {
    if (!shouldInstallCli) {
      if (!quiet) console.log('    CodeGraph CLI not installed, skipping setup');
      return 'skipped';
    }
    console.error(
      '    CodeGraph CLI not available. Install manually: npm install -g @colbymchenry/codegraph',
    );
    return 'failed';
  }

  try {
    if (!quiet) console.log('    Running: codegraph install --yes');
    execFileSync(codegraphCommand, ['install', '--yes'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
  } catch (error) {
    console.error(`    CodeGraph install failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }

  if (scope === 'project') {
    try {
      if (!quiet) console.log('    Running: codegraph init -i');
      execFileSync(codegraphCommand, ['init', '-i'], {
        cwd: projectPath,
        stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
        timeout: 300_000,
        shell: process.platform === 'win32',
      });
    } catch (error) {
      console.error(`    CodeGraph init failed: ${(error as Error).message}`);
      printCommandErrorDetails(error);
      return 'failed';
    }
  }

  return 'installed';
}

async function initializeCodegraphProject(
  projectPath: string,
  shouldInstallCli = true,
  quiet = false,
): Promise<'installed' | 'failed' | 'skipped'> {
  if (hasCodegraphProjectIndex(projectPath)) {
    if (!quiet) console.log('    CodeGraph: existing .codegraph index detected');
    return 'skipped';
  }
  const codegraphCommand = await ensureCodegraphCli(projectPath, shouldInstallCli, quiet);
  if (!codegraphCommand) {
    if (!quiet) {
      console.error(
        '    CodeGraph CLI not available. Install manually: npm install -g @colbymchenry/codegraph',
      );
    }
    return shouldInstallCli ? 'failed' : 'skipped';
  }
  try {
    if (!quiet) console.log('    Running: codegraph init -i');
    execFileSync(codegraphCommand, ['init', '-i'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 600_000,
      shell: process.platform === 'win32',
    });
    return 'installed';
  } catch (error) {
    console.error(`    CodeGraph init failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }
}

export {
  installCodegraph,
  initializeCodegraphProject,
  hasCodegraphProjectIndex,
  inspectCodegraphIndex,
  repairCodegraphIndex,
  resolveCodegraphCommand,
};
export type { CodegraphIndexDiagnostic, CodegraphIndexStatus };
