import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { cp, mkdir, mkdtemp, readdir, rm } from 'fs/promises';

import { printCommandErrorDetails } from './command-error.js';
import { getPlatformSkillsDir, PLATFORMS } from './platforms.js';
import type { InstallScope } from './types.js';

const SKILLS_AGENT_MAP: Record<string, string | null> = {
  claude: 'claude-code',
  cursor: 'cursor',
  codex: 'codex',
  opencode: 'opencode',
  windsurf: 'windsurf',
  cline: 'cline',
  roocode: 'roo',
  continue: 'continue',
  'github-copilot': 'github-copilot',
  gemini: 'gemini-cli',
  'amazon-q': 'universal',
  qwen: 'qwen-code',
  kilocode: 'kilo',
  auggie: 'augment',
  kiro: 'kiro-cli',
  kimicode: 'kimi-code-cli',
  lingma: null,
  junie: 'junie',
  codebuddy: 'codebuddy',
  costrict: 'universal',
  crush: 'crush',
  factory: 'droid',
  iflow: 'iflow-cli',
  pi: 'pi',
  qoder: 'qoder',
  antigravity: 'antigravity',
  // antigravity2 reuses the antigravity skills CLI agent (OpenSpec tool id is shared)
  antigravity2: 'antigravity',
  bob: 'bob',
  forgecode: 'forgecode',
  trae: 'trae',
};

const VALID_PLATFORM_IDS = new Set(Object.keys(SKILLS_AGENT_MAP));
const SUPERPOWERS_INSTALL_TIMEOUT_MS = 300_000;
const LINGMA_PLATFORM_ID = 'lingma';
const LINGMA_STAGE_AGENT = 'claude-code';

function buildSuperpowersInstallCommand(
  _projectPath: string,
  scope: InstallScope,
  platformIds: string[],
): { command: string; args: string[] } {
  const unknownIds = platformIds.filter((id) => !VALID_PLATFORM_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown platform IDs: ${unknownIds.join(', ')}`);
  }

  const agentNames = [
    ...new Set(
      platformIds.map((id) => SKILLS_AGENT_MAP[id]).filter((name): name is string => Boolean(name)),
    ),
  ];

  if (agentNames.length === 0) {
    throw new Error(`No skills CLI agent names resolved for platforms: ${platformIds.join(', ')}`);
  }

  const args = ['skills', 'add', 'obra/superpowers', '-y'];
  if (scope === 'global') {
    args.push('-g');
  }
  for (const name of agentNames) {
    args.push('--agent', name);
  }
  return { command: getNpxExecutable(), args };
}

function buildLingmaSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: ['skills', 'add', 'obra/superpowers', '-y', '--agent', LINGMA_STAGE_AGENT],
  };
}

function getNpxExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

async function copyDirectoryContents(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(srcDir, entry.name), path.join(destDir, entry.name), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }
}

async function installSuperpowersForLingma(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  const lingmaPlatform = PLATFORMS.find((platform) => platform.id === LINGMA_PLATFORM_ID);
  if (!lingmaPlatform) {
    console.error('    Superpowers install failed: Lingma platform is not registered');
    return 'failed';
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'comet-lingma-superpowers-'));
  try {
    const stageCommand = buildLingmaSuperpowersStageCommand();
    execFileSync(stageCommand.command, stageCommand.args, {
      cwd: tempDir,
      stdio: 'inherit',
      timeout: SUPERPOWERS_INSTALL_TIMEOUT_MS,
      shell: process.platform === 'win32',
    });

    const stagedSkillsDir = path.join(tempDir, '.claude', 'skills');
    const baseDir = scope === 'global' ? os.homedir() : projectPath;
    const lingmaSkillsDir = path.join(
      baseDir,
      getPlatformSkillsDir(lingmaPlatform, scope),
      'skills',
    );
    await copyDirectoryContents(stagedSkillsDir, lingmaSkillsDir);
    return 'installed';
  } catch (error) {
    console.error(`    Lingma Superpowers install failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function installSuperpowersForPlatforms(
  projectPath: string,
  scope: InstallScope,
  platformIds: string[],
  shouldInstall = true,
): Promise<'installed' | 'failed' | 'skipped'> {
  if (!shouldInstall) {
    return 'skipped';
  }

  const unknownIds = platformIds.filter((id) => !VALID_PLATFORM_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown platform IDs: ${unknownIds.join(', ')}`);
  }

  const skillsCliPlatformIds = platformIds.filter((id) => SKILLS_AGENT_MAP[id]);
  const shouldInstallLingma = platformIds.includes(LINGMA_PLATFORM_ID);
  let failed = false;

  if (skillsCliPlatformIds.length > 0) {
    const command = buildSuperpowersInstallCommand(projectPath, scope, skillsCliPlatformIds);

    try {
      execFileSync(command.command, command.args, {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: SUPERPOWERS_INSTALL_TIMEOUT_MS,
        shell: process.platform === 'win32',
      });
    } catch (error) {
      console.error(`    Superpowers install failed: ${(error as Error).message}`);
      printCommandErrorDetails(error);
      failed = true;
    }
  }

  if (shouldInstallLingma) {
    const lingmaStatus = await installSuperpowersForLingma(projectPath, scope);
    if (lingmaStatus === 'failed') failed = true;
  }

  return failed ? 'failed' : 'installed';
}

export {
  installSuperpowersForPlatforms,
  buildSuperpowersInstallCommand,
  buildLingmaSuperpowersStageCommand,
  SKILLS_AGENT_MAP,
};
