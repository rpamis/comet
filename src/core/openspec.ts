import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PLATFORMS } from './platforms.js';
import { printCommandErrorDetails } from './command-error.js';

import type { InstallScope } from './types.js';

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
): { command: string; args: string[] } {
  const targetPath = scope === 'global' ? homeDir : projectPath;
  return {
    command: 'openspec',
    args: ['init', targetPath, '--tools', toolIds.join(','), '--profile', 'custom'],
  };
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

async function ensureOpenSpecCli(scope: InstallScope, projectPath: string): Promise<boolean> {
  if (isCommandAvailable('openspec')) {
    return true;
  }

  console.log(`    Installing OpenSpec CLI...`);
  try {
    const npmArgs =
      scope === 'global'
        ? ['install', '-g', '@fission-ai/openspec@latest']
        : ['install', '@fission-ai/openspec@latest'];
    execFileSync(getNpmExecutable(), npmArgs, {
      cwd: projectPath,
      stdio: 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
    return isCommandAvailable('openspec');
  } catch (error) {
    console.error(`    Failed to install OpenSpec CLI: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return false;
  }
}

function migrateOpenCodeOpenSpecPaths(homeDir: string): void {
  const opencodePlatform = PLATFORMS.find((p) => p.id === 'opencode');
  if (!opencodePlatform?.globalSkillsDir) return;

  // OpenSpec hardcodes skillsDir as '.opencode' in its AI_TOOLS, so it writes
  // to ~/.opencode/ even for global installs. OpenCode actually reads from
  // ~/.config/opencode/ (Comet's globalSkillsDir). Move the files over.
  const wrongDir = path.join(homeDir, opencodePlatform.skillsDir);
  const correctDir = path.join(homeDir, opencodePlatform.globalSkillsDir);

  const migrations: Array<[string, string, string]> = [
    [path.join(wrongDir, 'skills'), path.join(correctDir, 'skills'), 'skills'],
    [path.join(wrongDir, 'commands'), path.join(correctDir, 'commands'), 'commands'],
  ];

  for (const [srcDir, destDir, label] of migrations) {
    if (srcDir === destDir) continue;
    if (!fs.existsSync(srcDir)) continue;
    try {
      const entries = fs.readdirSync(srcDir);
      if (entries.length === 0) continue;

      fs.mkdirSync(destDir, { recursive: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry);
        const destPath = path.join(destDir, entry);
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      }
      fs.rmSync(srcDir, { recursive: true, force: true });
    } catch (error) {
      console.error(
        `    Warning: failed to migrate OpenSpec ${label} from ${srcDir} to ${destDir}: ${(error as Error).message}`,
      );
    }
  }

  // Remove wrong parent directory if both skills and commands have been migrated
  if (fs.existsSync(wrongDir)) {
    try {
      const remaining = fs.readdirSync(wrongDir);
      if (remaining.length === 0) {
        fs.rmdirSync(wrongDir);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

async function installOpenSpec(
  projectPath: string,
  toolIds: string[],
  scope: InstallScope,
): Promise<'installed' | 'failed' | 'skipped'> {
  const cliReady = await ensureOpenSpecCli(scope, projectPath);
  if (!cliReady) {
    console.error(
      `    OpenSpec CLI not available. Install manually: npm install -g @fission-ai/openspec@latest`,
    );
    return 'failed';
  }

  const unknownIds = toolIds.filter((id) => !VALID_TOOL_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown tool IDs: ${unknownIds.join(', ')}`);
  }

  let configHome: string | undefined;
  let configBackup: ConfigBackup | null = null;
  try {
    const openspecEnv = createOpenSpecAllWorkflowsEnv();
    const invocation = buildOpenSpecInitInvocation(projectPath, toolIds, scope);
    configHome = openspecEnv.configHome;

    configBackup = writeAllWorkflowsToDefaultConfig();

    execFileSync(invocation.command, invocation.args, {
      cwd: projectPath,
      env: openspecEnv.env,
      stdio: 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });

    if (scope === 'global' && toolIds.includes('opencode')) {
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
};
