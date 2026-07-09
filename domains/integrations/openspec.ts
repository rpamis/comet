import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PLATFORMS, getPlatformSkillsDir } from '../../platform/install/platforms.js';
import { printCommandErrorDetails } from '../../platform/process/command-error.js';
import { quoteArgsForShell } from '../../platform/process/shell-quote.js';

import type { InstallScope } from '../../platform/install/types.js';

const VALID_TOOL_IDS = new Set(PLATFORMS.map((p) => p.openspecToolId));
const ALL_OPENSPEC_WORKFLOWS = [
  'propose',
  'explore',
  'new',
  'continue',
  'apply',
  'ff',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
] as const;

function getNpmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function buildOpenSpecInitInvocation(
  projectPath: string,
  toolIds: string[],
  scope: InstallScope,
  homeDir = os.homedir(),
  includeProfileFlag = true,
): { command: string; args: string[] } {
  const targetPath = scope === 'global' ? homeDir : projectPath;
  const args = ['init', targetPath, '--tools', toolIds.join(',')];
  if (includeProfileFlag) {
    args.push('--profile', 'custom');
  }
  return { command: 'openspec', args };
}

const ALL_WORKFLOWS_CONFIG =
  JSON.stringify(
    {
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: [...ALL_OPENSPEC_WORKFLOWS],
    },
    null,
    2,
  ) + '\n';

function getOpenSpecDefaultConfigDir(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, 'openspec');
    }
    return path.join(os.homedir(), 'AppData', 'Roaming', 'openspec');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'openspec');
  }
  return path.join(os.homedir(), '.config', 'openspec');
}

function getOpenSpecDefaultConfigPath(): string {
  return path.join(getOpenSpecDefaultConfigDir(), 'config.json');
}

function createOpenSpecAllWorkflowsEnv(): { env: NodeJS.ProcessEnv; configHome: string } {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-profile-'));
  try {
    const openspecConfigDir = path.join(configHome, 'openspec');
    fs.mkdirSync(openspecConfigDir, { recursive: true });
    fs.writeFileSync(path.join(openspecConfigDir, 'config.json'), ALL_WORKFLOWS_CONFIG, 'utf-8');

    return {
      configHome,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
      },
    };
  } catch (error) {
    fs.rmSync(configHome, { recursive: true, force: true });
    throw error;
  }
}

interface ConfigBackup {
  configPath: string;
  backupPath: string;
  hadExisting: boolean;
}

function writeAllWorkflowsToDefaultConfig(): ConfigBackup | null {
  const configPath = getOpenSpecDefaultConfigPath();
  const backupPath = configPath + '.comet-backup';
  let hadExisting = false;

  try {
    hadExisting = fs.existsSync(configPath);
    if (hadExisting) {
      fs.copyFileSync(configPath, backupPath);
    }

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, ALL_WORKFLOWS_CONFIG, 'utf-8');

    return { configPath, backupPath, hadExisting };
  } catch {
    if (hadExisting) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Best-effort cleanup
      }
    }
    return null;
  }
}

function restoreDefaultConfig(backup: ConfigBackup | null): void {
  if (!backup) return;
  try {
    if (backup.hadExisting) {
      fs.copyFileSync(backup.backupPath, backup.configPath);
      fs.unlinkSync(backup.backupPath);
    } else {
      if (fs.existsSync(backup.configPath)) {
        fs.unlinkSync(backup.configPath);
      }
    }
  } catch {
    // Best-effort restore
  }
}

function isCommandAvailable(command: string): boolean {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(checker, [command], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureOpenSpecCli(
  projectPath: string,
  shouldInstall = true,
): Promise<'ready' | 'missing' | 'failed'> {
  const alreadyInstalled = isCommandAvailable('openspec');
  if (!shouldInstall) {
    return alreadyInstalled ? 'ready' : 'missing';
  }
  const label = alreadyInstalled ? 'Upgrading' : 'Installing';
  console.warn(`    ${label} OpenSpec CLI...`);
  try {
    // OpenSpec is invoked as a PATH command below; keep the CLI install global
    // regardless of Comet's project/global skill installation scope.
    const npmArgs = ['install', '-g', '@fission-ai/openspec@latest'];
    execFileSync(getNpmExecutable(), npmArgs, {
      cwd: projectPath,
      stdio: 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
    return isCommandAvailable('openspec') ? 'ready' : 'failed';
  } catch (error) {
    if (alreadyInstalled) {
      console.warn(
        `    OpenSpec upgrade failed, using existing version: ${(error as Error).message}`,
      );
      return 'ready';
    }
    console.error(`    Failed to install OpenSpec CLI: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }
}

function migrateOpenCodeOpenSpecPaths(homeDir: string): void {
  const opencodePlatform = PLATFORMS.find((p) => p.id === 'opencode');
  if (!opencodePlatform?.globalSkillsDir) return;

  // OpenSpec hardcodes skillsDir as '.opencode' in its AI_TOOLS, so it writes
  // to ~/.opencode/ even for global installs. OpenCode actually reads from
  // ~/.config/opencode/ (Comet's globalSkillsDir). Move the files over.
  migrateOpenSpecPaths(
    path.join(homeDir, opencodePlatform.skillsDir),
    path.join(homeDir, opencodePlatform.globalSkillsDir),
  );
}

/**
 * OpenCode-compatible platforms can reuse openspec's opencode tool id. The
 * openspec CLI writes into the opencode directory, so mirror those skills and
 * commands into each platform-specific config directory.
 */
function mirrorOpenCodeCompatibleOpenSpecPaths(
  baseDir: string,
  scope: InstallScope,
  platformIds: string[],
): void {
  const opencodePlatform = PLATFORMS.find((p) => p.id === 'opencode');
  if (!opencodePlatform) return;

  const srcDir = path.join(baseDir, opencodePlatform.skillsDir);
  for (const platformId of [...new Set(platformIds)]) {
    const platform = PLATFORMS.find((p) => p.id === platformId);
    if (!platform || platform.id === 'opencode') continue;
    const destDir = path.join(baseDir, getPlatformSkillsDir(platform, scope));
    copyOpenSpecPaths(srcDir, destDir);
  }
}

function migrateZCodeOpenSpecPaths(baseDir: string, scope: InstallScope): void {
  mirrorOpenCodeCompatibleOpenSpecPaths(baseDir, scope, ['zcode']);
}

/**
 * Move openspec skills/commands from srcDir to destDir (used by opencode whose
 * global dir differs from where openspec writes).
 */
function migrateOpenSpecPaths(srcDir: string, destDir: string): void {
  if (srcDir === destDir) return;
  const migrations: Array<[string, string, string]> = [
    [path.join(srcDir, 'skills'), path.join(destDir, 'skills'), 'skills'],
    [path.join(srcDir, 'commands'), path.join(destDir, 'commands'), 'commands'],
  ];

  for (const [from, to, label] of migrations) {
    if (from === to) continue;
    if (!fs.existsSync(from)) continue;
    try {
      const entries = fs.readdirSync(from);
      if (entries.length === 0) continue;

      fs.mkdirSync(to, { recursive: true });
      for (const entry of entries) {
        const srcPath = path.join(from, entry);
        const destPath = path.join(to, entry);
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      }
      fs.rmSync(from, { recursive: true, force: true });
    } catch (error) {
      console.error(
        `    Warning: failed to migrate OpenSpec ${label} from ${from} to ${to}: ${(error as Error).message}`,
      );
    }
  }

  // Remove wrong parent directory if both skills and commands have been migrated
  if (fs.existsSync(srcDir)) {
    try {
      const remaining = fs.readdirSync(srcDir);
      if (remaining.length === 0) {
        fs.rmdirSync(srcDir);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Copy openspec skills/commands from srcDir to destDir (used by zcode which
 * mirrors the opencode output without removing the source).
 */
function copyOpenSpecPaths(srcDir: string, destDir: string): void {
  if (srcDir === destDir) return;
  const copies: Array<[string, string, string]> = [
    [path.join(srcDir, 'skills'), path.join(destDir, 'skills'), 'skills'],
    [path.join(srcDir, 'commands'), path.join(destDir, 'commands'), 'commands'],
  ];

  for (const [from, to, label] of copies) {
    if (from === to) continue;
    if (!fs.existsSync(from)) continue;
    try {
      const entries = fs.readdirSync(from);
      if (entries.length === 0) continue;

      fs.mkdirSync(to, { recursive: true });
      for (const entry of entries) {
        const srcPath = path.join(from, entry);
        const destPath = path.join(to, entry);
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(
        `    Warning: failed to copy OpenSpec ${label} from ${from} to ${to}: ${(error as Error).message}`,
      );
    }
  }
}

async function installOpenSpec(
  projectPath: string,
  toolIds: string[],
  scope: InstallScope,
  shouldInstallCli = true,
  mirrorOpenCodePlatformIds: string[] = [],
): Promise<'installed' | 'failed' | 'skipped'> {
  const cliStatus = await ensureOpenSpecCli(projectPath, shouldInstallCli);
  if (cliStatus === 'failed') {
    console.error(
      `    OpenSpec CLI not available. Install manually: npm install -g @fission-ai/openspec@latest`,
    );
    return 'failed';
  }
  if (cliStatus === 'missing') {
    return 'skipped';
  }

  const unknownIds = toolIds.filter((id) => !VALID_TOOL_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown tool IDs: ${unknownIds.join(', ')}`);
  }

  let configHome: string | undefined;
  let configBackup: ConfigBackup | null = null;
  try {
    const openspecEnv = createOpenSpecAllWorkflowsEnv();
    configHome = openspecEnv.configHome;

    configBackup = writeAllWorkflowsToDefaultConfig();

    // Windows 上 openspec 是 .cmd shim，必须经 shell 解析才能执行。
    // shell:true 时 Node.js 不对含空格的参数加引号，会导致形如
    // "C:\Users\Test User\project" 的路径被拆成多个参数（issue #123），
    // 因此在启用 shell 时对参数逐个引用。
    const useShell = process.platform === 'win32';

    const invocation = buildOpenSpecInitInvocation(projectPath, toolIds, scope);
    try {
      const initArgs = useShell ? quoteArgsForShell(invocation.args) : invocation.args;
      execFileSync(invocation.command, initArgs, {
        cwd: projectPath,
        env: openspecEnv.env,
        stdio: ['inherit', 'inherit', 'pipe'],
        timeout: 120_000,
        shell: useShell,
      });
    } catch (firstError) {
      const stderrText = (firstError as { stderr?: Buffer }).stderr?.toString() ?? '';
      if (stderrText.includes('unknown option') && stderrText.includes('--profile')) {
        console.warn('    OpenSpec does not support --profile flag, retrying without it...');
        const fallbackInvocation = buildOpenSpecInitInvocation(
          projectPath,
          toolIds,
          scope,
          os.homedir(),
          false,
        );
        const fallbackArgs = useShell
          ? quoteArgsForShell(fallbackInvocation.args)
          : fallbackInvocation.args;
        execFileSync(fallbackInvocation.command, fallbackArgs, {
          cwd: projectPath,
          env: openspecEnv.env,
          stdio: 'inherit',
          timeout: 120_000,
          shell: useShell,
        });
      } else {
        throw firstError;
      }
    }

    const openspecWritesGlobal = scope === 'global';
    const openspecTargetBase = openspecWritesGlobal ? os.homedir() : projectPath;

    // Mirror OpenCode-compatible platforms first, before the opencode global
    // migration potentially moves the source away.
    if (mirrorOpenCodePlatformIds.length > 0 && toolIds.includes('opencode')) {
      mirrorOpenCodeCompatibleOpenSpecPaths(openspecTargetBase, scope, mirrorOpenCodePlatformIds);
    }

    if (openspecWritesGlobal && toolIds.includes('opencode')) {
      migrateOpenCodeOpenSpecPaths(os.homedir());
    }

    return 'installed';
  } catch (error) {
    console.error(`    OpenSpec init failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  } finally {
    restoreDefaultConfig(configBackup);
    if (configHome) {
      fs.rmSync(configHome, { recursive: true, force: true });
    }
  }
}

export {
  installOpenSpec,
  isCommandAvailable,
  buildOpenSpecInitInvocation,
  getNpmExecutable,
  migrateOpenCodeOpenSpecPaths,
  migrateZCodeOpenSpecPaths,
  mirrorOpenCodeCompatibleOpenSpecPaths,
};
