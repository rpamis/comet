import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';

import { printCommandErrorDetails } from '../../platform/process/command-error.js';
import { fileExists } from '../../platform/fs/file-system.js';
import {
  getPlatformSkillsDir,
  PLATFORMS,
  type Platform,
} from '../../platform/install/platforms.js';
import { addDshOwnedPaths, dshRootPath, readDshOwnedPaths } from '../skill/dsh-adapter.js';
import type { InstallScope } from '../../platform/install/types.js';

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
  // Grok has no Skills CLI agent; stage through Claude and copy into .grok/skills.
  grok: null,
  'amazon-q': 'universal',
  qwen: 'qwen-code',
  kilocode: 'kilo',
  auggie: 'augment',
  kiro: 'kiro-cli',
  kimicode: 'kimi-code-cli',
  lingma: null,
  junie: 'junie',
  codebuddy: 'codebuddy',
  // WorkBuddy does not expose a Skills CLI agent id; stage through the
  // portable Claude target and copy the result into .workbuddy/skills.
  workbuddy: null,
  costrict: 'universal',
  crush: 'crush',
  factory: 'droid',
  iflow: 'iflow-cli',
  pi: 'pi',
  // The Skills CLI does not yet ship an Oh My Pi target. Stage through the
  // portable Claude layout and copy into OMP's native skills root.
  'oh-my-pi': null,
  // dsh has a native Skill root but no Skills CLI agent id. Stage through the
  // portable Claude layout and copy into .dsh/skills.
  dsh: null,
  qoder: 'qoder',
  antigravity: 'antigravity',
  // antigravity2 reuses the antigravity skills CLI agent (OpenSpec tool id is shared)
  antigravity2: 'antigravity',
  bob: 'bob',
  forgecode: 'forgecode',
  trae: 'trae',
  'trae-cn': 'trae-cn',
  // zcode/mimocode are not skills CLI agents; Superpowers are installed via
  // the claude-code staging flow and copied into their OpenCode-style dirs.
  zcode: null,
  mimocode: null,
};

const VALID_PLATFORM_IDS = new Set(Object.keys(SKILLS_AGENT_MAP));
const SUPERPOWERS_INSTALL_TIMEOUT_MS = 300_000;
const LINGMA_PLATFORM_ID = 'lingma';
const ZCODE_PLATFORM_ID = 'zcode';
const MIMOCODE_PLATFORM_ID = 'mimocode';
const WORKBUDDY_PLATFORM_ID = 'workbuddy';
const OH_MY_PI_PLATFORM_ID = 'oh-my-pi';
const DSH_PLATFORM_ID = 'dsh';
const GROK_PLATFORM_ID = 'grok';
const STAGE_AGENT = 'claude-code';
const SUPERPOWERS_SOURCE = 'obra/superpowers';
const EXCLUDED_SUPERPOWERS_SKILL = 'using-superpowers';
// The Skills CLI accepts an allowlist but has no exclude flag. Keep this list
// aligned with the public skill directories in obra/superpowers so the
// bootstrap skill never enters a project or user-scoped installation.
const SUPERPOWERS_SKILL_NAMES = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
] as const;
export const STAGED_SUPERPOWERS_MANIFEST_FILE = '.comet-superpowers.json';

function buildSuperpowersInstallArgs(): string[] {
  return [
    'skills',
    'add',
    SUPERPOWERS_SOURCE,
    '-y',
    ...SUPERPOWERS_SKILL_NAMES.flatMap((skillName) => ['--skill', skillName]),
  ];
}

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

  const args = buildSuperpowersInstallArgs();
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
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildZCodeSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildMimoCodeSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildWorkBuddySuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildOhMyPiSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildDshSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function buildGrokSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: [...buildSuperpowersInstallArgs(), '--agent', STAGE_AGENT],
  };
}

function isExcludedSuperpowersSkill(name: string): boolean {
  return name.toLowerCase() === EXCLUDED_SUPERPOWERS_SKILL;
}

function getNpxExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

async function copyDirectoryContents(srcDir: string, destDir: string): Promise<string[]> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  const skillNames: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isExcludedSuperpowersSkill(entry.name)) continue;
    await cp(path.join(srcDir, entry.name), path.join(destDir, entry.name), {
      recursive: true,
      force: true,
      dereference: true,
    });
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      skillNames.push(entry.name);
    }
  }
  return skillNames;
}

function getStagedSuperpowersManifestPath(baseDir: string, skillsRoot: string): string {
  return path.join(baseDir, skillsRoot, STAGED_SUPERPOWERS_MANIFEST_FILE);
}

async function writeStagedSuperpowersManifest(
  filePath: string,
  skillNames: string[],
): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        source: SUPERPOWERS_SOURCE,
        skills: [...new Set(skillNames)].sort(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function readStagedSuperpowersSkillNames(
  baseDir: string,
  platforms: readonly Platform[],
  scope: InstallScope,
): Promise<string[]> {
  const names = new Set<string>();
  for (const platform of platforms) {
    const filePath = getStagedSuperpowersManifestPath(
      baseDir,
      getPlatformSkillsDir(platform, scope),
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.source !== SUPERPOWERS_SOURCE || !Array.isArray(record.skills)) continue;
    for (const name of record.skills) {
      if (typeof name !== 'string' || name.length === 0) continue;
      if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue;
      names.add(name);
    }
  }
  return [...names];
}

async function removeStagedSuperpowersManifests(
  baseDir: string,
  platforms: readonly Platform[],
  scope: InstallScope,
): Promise<void> {
  for (const platform of platforms) {
    const filePath = getStagedSuperpowersManifestPath(
      baseDir,
      getPlatformSkillsDir(platform, scope),
    );
    await rm(filePath, { force: true });
  }
}

async function copyDshSuperpowersContents(
  srcDir: string,
  baseDir: string,
  platform: (typeof PLATFORMS)[number],
  scope: InstallScope,
): Promise<void> {
  const destDir = path.join(dshRootPath(baseDir, platform, scope), 'skills');
  const owned = await readDshOwnedPaths(baseDir, platform, scope, 'superpowers');
  const copied: string[] = [];
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (entry.isDirectory() && isExcludedSuperpowersSkill(entry.name)) continue;
    const relative = `skills/${entry.name}`;
    const destination = path.join(destDir, entry.name);
    if ((await fileExists(destination)) && !owned.has(relative)) continue;
    await cp(path.join(srcDir, entry.name), destination, {
      recursive: true,
      force: true,
      dereference: true,
    });
    copied.push(relative);
  }
  await addDshOwnedPaths(baseDir, platform, scope, 'superpowers', copied);
}

async function installSuperpowersForLingma(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    LINGMA_PLATFORM_ID,
    buildLingmaSuperpowersStageCommand(),
    projectPath,
    scope,
    'Lingma',
  );
}

async function installSuperpowersForZCode(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    ZCODE_PLATFORM_ID,
    buildZCodeSuperpowersStageCommand(),
    projectPath,
    scope,
    'ZCode',
  );
}

async function installSuperpowersForMimoCode(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    MIMOCODE_PLATFORM_ID,
    buildMimoCodeSuperpowersStageCommand(),
    projectPath,
    scope,
    'MimoCode',
  );
}

async function installSuperpowersForWorkBuddy(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    WORKBUDDY_PLATFORM_ID,
    buildWorkBuddySuperpowersStageCommand(),
    projectPath,
    scope,
    'WorkBuddy',
  );
}

async function installSuperpowersForOhMyPi(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    OH_MY_PI_PLATFORM_ID,
    buildOhMyPiSuperpowersStageCommand(),
    projectPath,
    scope,
    'Oh My Pi',
  );
}

async function installSuperpowersForDsh(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    DSH_PLATFORM_ID,
    buildDshSuperpowersStageCommand(),
    projectPath,
    scope,
    'dsh',
  );
}

async function installSuperpowersForGrok(
  projectPath: string,
  scope: InstallScope,
): Promise<'installed' | 'failed'> {
  return stageAndCopySuperpowers(
    GROK_PLATFORM_ID,
    buildGrokSuperpowersStageCommand(),
    projectPath,
    scope,
    'Grok',
  );
}

/**
 * Shared staging flow for platforms whose agent is not supported by the skills CLI
 * (e.g. Lingma, WorkBuddy, Oh My Pi, ZCode, MimoCode). Superpowers are staged into a temp dir via
 * the claude-code agent and then copied into the target platform's skills directory.
 */
async function stageAndCopySuperpowers(
  platformId: string,
  stageCommand: { command: string; args: string[] },
  projectPath: string,
  scope: InstallScope,
  label: string,
): Promise<'installed' | 'failed'> {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) {
    console.error(`    Superpowers install failed: ${label} platform is not registered`);
    return 'failed';
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `comet-${platformId}-superpowers-`));
  try {
    execFileSync(stageCommand.command, stageCommand.args, {
      cwd: tempDir,
      stdio: 'inherit',
      timeout: SUPERPOWERS_INSTALL_TIMEOUT_MS,
      shell: process.platform === 'win32',
    });

    const stagedSkillsDir = path.join(tempDir, '.claude', 'skills');
    const baseDir = scope === 'global' ? os.homedir() : projectPath;
    if (platformId === DSH_PLATFORM_ID) {
      await copyDshSuperpowersContents(stagedSkillsDir, baseDir, platform, scope);
    } else {
      const platformSkillsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
      const skillNames = await copyDirectoryContents(stagedSkillsDir, platformSkillsDir);
      await writeStagedSuperpowersManifest(
        getStagedSuperpowersManifestPath(baseDir, getPlatformSkillsDir(platform, scope)),
        skillNames,
      );
    }
    return 'installed';
  } catch (error) {
    console.error(`    ${label} Superpowers install failed: ${(error as Error).message}`);
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
  const shouldInstallZCode = platformIds.includes(ZCODE_PLATFORM_ID);
  const shouldInstallMimoCode = platformIds.includes(MIMOCODE_PLATFORM_ID);
  const shouldInstallWorkBuddy = platformIds.includes(WORKBUDDY_PLATFORM_ID);
  const shouldInstallOhMyPi = platformIds.includes(OH_MY_PI_PLATFORM_ID);
  const shouldInstallDsh = platformIds.includes(DSH_PLATFORM_ID);
  const shouldInstallGrok = platformIds.includes(GROK_PLATFORM_ID);
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

  if (shouldInstallZCode) {
    const zcodeStatus = await installSuperpowersForZCode(projectPath, scope);
    if (zcodeStatus === 'failed') failed = true;
  }

  if (shouldInstallMimoCode) {
    const mimocodeStatus = await installSuperpowersForMimoCode(projectPath, scope);
    if (mimocodeStatus === 'failed') failed = true;
  }

  if (shouldInstallWorkBuddy) {
    const workbuddyStatus = await installSuperpowersForWorkBuddy(projectPath, scope);
    if (workbuddyStatus === 'failed') failed = true;
  }

  if (shouldInstallOhMyPi) {
    const ohMyPiStatus = await installSuperpowersForOhMyPi(projectPath, scope);
    if (ohMyPiStatus === 'failed') failed = true;
  }

  if (shouldInstallDsh) {
    const dshStatus = await installSuperpowersForDsh(projectPath, scope);
    if (dshStatus === 'failed') failed = true;
  }

  if (shouldInstallGrok) {
    const grokStatus = await installSuperpowersForGrok(projectPath, scope);
    if (grokStatus === 'failed') failed = true;
  }

  return failed ? 'failed' : 'installed';
}

export {
  installSuperpowersForPlatforms,
  buildSuperpowersInstallCommand,
  buildLingmaSuperpowersStageCommand,
  buildZCodeSuperpowersStageCommand,
  buildMimoCodeSuperpowersStageCommand,
  buildWorkBuddySuperpowersStageCommand,
  buildOhMyPiSuperpowersStageCommand,
  buildDshSuperpowersStageCommand,
  buildGrokSuperpowersStageCommand,
  getStagedSuperpowersManifestPath,
  readStagedSuperpowersSkillNames,
  removeStagedSuperpowersManifests,
  SKILLS_AGENT_MAP,
  SUPERPOWERS_SKILL_NAMES,
};
