import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PLATFORMS,
  getOpenSpecGeneratorPlatform,
  getOpenSpecMirrorPlatforms,
  getPlatformSkillsDir,
} from '../../platform/install/platforms.js';
import { printCommandErrorDetails } from '../../platform/process/command-error.js';
import { quoteArgsForShell } from '../../platform/process/shell-quote.js';
import { atomicWriteContainedBytes } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';

import type { InstallScope } from '../../platform/install/types.js';

const VALID_TOOL_IDS = new Set(PLATFORMS.map((p) => p.openspecToolId));
const MINIMUM_OPENSPEC_VERSION = '1.5.0';
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

type ProjectMutationGuard = () => void | Promise<void>;
type OpenSpecFailureObserver = (error: Error) => void;

class ProjectMutationGuardError extends Error {
  override readonly name = 'ProjectMutationGuardError';
}

function isProjectMutationGuardError(error: unknown): error is ProjectMutationGuardError {
  return error instanceof ProjectMutationGuardError;
}

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

async function assertProjectMutationAllowed(
  guard: ProjectMutationGuard | undefined,
  checkpoint: 'before' | 'after-external',
  partialMutationPossible = false,
): Promise<void> {
  if (!guard) return;
  try {
    await guard();
  } catch (error) {
    const detail = (error as Error).message;
    if (checkpoint === 'after-external' || partialMutationPossible) {
      throw new ProjectMutationGuardError(
        `OpenSpec project update partial failure: project mutation guard rejected the update after project mutation may have started: ${detail}`,
      );
    }
    throw new ProjectMutationGuardError(
      `Project mutation guard failed before OpenSpec project mutation: ${detail}`,
    );
  }
}

async function runOpenSpecInit(
  targetPath: string,
  toolIds: string[],
  env: NodeJS.ProcessEnv,
  projectMutationGuard?: ProjectMutationGuard,
  projectMutationAlreadyStarted = false,
  commandMayMutateProject = true,
): Promise<void> {
  const useShell = process.platform === 'win32';
  const invocation = buildOpenSpecInitInvocation(targetPath, toolIds, 'project');
  try {
    await assertProjectMutationAllowed(
      projectMutationGuard,
      'before',
      projectMutationAlreadyStarted,
    );
    const initArgs = useShell ? quoteArgsForShell(invocation.args) : invocation.args;
    execFileSync(invocation.command, initArgs, {
      cwd: targetPath,
      env,
      stdio: ['inherit', 'inherit', 'pipe'],
      timeout: 120_000,
      shell: useShell,
    });
    await assertProjectMutationAllowed(
      projectMutationGuard,
      'after-external',
      projectMutationAlreadyStarted || commandMayMutateProject,
    );
  } catch (firstError) {
    const stderrText = (firstError as { stderr?: Buffer }).stderr?.toString() ?? '';
    if (!stderrText.includes('unknown option') || !stderrText.includes('--profile')) {
      throw firstError;
    }
    await assertProjectMutationAllowed(
      projectMutationGuard,
      'after-external',
      projectMutationAlreadyStarted || commandMayMutateProject,
    );
    console.warn('    OpenSpec does not support --profile flag, retrying without it...');
    const fallbackInvocation = buildOpenSpecInitInvocation(
      targetPath,
      toolIds,
      'project',
      os.homedir(),
      false,
    );
    const fallbackArgs = useShell
      ? quoteArgsForShell(fallbackInvocation.args)
      : fallbackInvocation.args;
    await assertProjectMutationAllowed(
      projectMutationGuard,
      'before',
      projectMutationAlreadyStarted || commandMayMutateProject,
    );
    execFileSync(fallbackInvocation.command, fallbackArgs, {
      cwd: targetPath,
      env,
      stdio: 'inherit',
      timeout: 120_000,
      shell: useShell,
    });
    await assertProjectMutationAllowed(
      projectMutationGuard,
      'after-external',
      projectMutationAlreadyStarted || commandMayMutateProject,
    );
  }
}

function projectRelativePath(projectPath: string, target: string, label: string): string {
  const root = path.resolve(projectPath);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return relative.split(path.sep).join('/');
}

/**
 * Whether a staged OpenSpec tool directory contains any files (recursively).
 *
 * The staging project is a private temporary directory freshly written by the
 * OpenSpec CLI, so the tree is small and bounded; walking it is cheap. This
 * distinguishes "no output at all" from "only empty directories" so a missing
 * or empty staged tool output fails the update instead of reporting success.
 */
async function hasGeneratedToolFiles(dir: string): Promise<boolean> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (await hasGeneratedToolFiles(path.join(dir, entry.name))) return true;
    } else {
      return true;
    }
  }
  return false;
}

async function copyGeneratedToolDirectory(
  stagingProject: string,
  source: string,
  projectPath: string,
  destination: string,
  projectMutationGuard?: ProjectMutationGuard,
): Promise<void> {
  const destinationRelative = projectRelativePath(
    projectPath,
    destination,
    'OpenSpec generated tool directory',
  );
  await assertProjectMutationAllowed(projectMutationGuard, 'before', true);
  await ensureProtectedProjectDirectory(projectPath, destinationRelative, {
    label: 'OpenSpec generated tool directory',
  });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`OpenSpec generated tool source must not contain links: ${entry.name}`);
    }
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyGeneratedToolDirectory(
        stagingProject,
        sourceEntry,
        projectPath,
        destinationEntry,
        projectMutationGuard,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`OpenSpec generated tool source must contain only files: ${entry.name}`);
    }
    const sourceRelative = path.relative(stagingProject, sourceEntry);
    if (
      path.isAbsolute(sourceRelative) ||
      sourceRelative === '..' ||
      sourceRelative.startsWith(`..${path.sep}`)
    ) {
      throw new Error('OpenSpec generated tool source escaped its staging root');
    }
    const destinationFileRelative = projectRelativePath(
      projectPath,
      destinationEntry,
      'OpenSpec generated tool file',
    );
    await assertProjectMutationAllowed(projectMutationGuard, 'before', true);
    await inspectProtectedProjectPath(projectPath, destinationFileRelative, {
      label: 'OpenSpec generated tool file',
      expected: 'file',
    });
    const bytes = await fs.promises.readFile(sourceEntry);
    await atomicWriteContainedBytes(destinationEntry, bytes, {
      containedRoot: projectPath,
      beforeCommit: async () => {
        await assertProjectMutationAllowed(projectMutationGuard, 'before', true);
        await inspectProtectedProjectPath(projectPath, destinationFileRelative, {
          label: 'OpenSpec generated tool file',
          expected: 'file',
        });
      },
    });
  }
}

interface GeneratedToolCopy {
  source: string;
  destination: string;
}

async function resolveGeneratedToolCopies(
  stagingProject: string,
  destBase: string,
  scope: InstallScope,
  toolIds: readonly string[],
  mirrorPlatformIds: readonly string[] = [],
  selectedPlatformIds: readonly string[] = [],
): Promise<GeneratedToolCopy[]> {
  const copies: GeneratedToolCopy[] = [];
  const mergedDestinations = new Set<string>();
  for (const toolId of toolIds) {
    const generator = getOpenSpecGeneratorPlatform(toolId);
    if (!generator) continue;
    const candidateDirs = [
      generator.openspecSkillsDir ?? generator.skillsDir,
      ...(generator.legacySkillsDirs ?? []),
    ];
    const sourceDir = candidateDirs.find((dir) => fs.existsSync(path.join(stagingProject, dir)));
    if (!sourceDir) {
      throw new Error(
        `OpenSpec generated no tool output for ${generator.id}: expected one of ${candidateDirs.join(', ')} under the staging project`,
      );
    }
    const source = path.join(stagingProject, sourceDir);
    if (!(await hasGeneratedToolFiles(source))) {
      throw new Error(
        `OpenSpec generated an empty tool output for ${generator.id}: ${sourceDir} contains no skills or commands`,
      );
    }
    const mirrors = getOpenSpecMirrorPlatforms(mirrorPlatformIds, generator.id);
    const writeGenerator =
      selectedPlatformIds.length > 0
        ? selectedPlatformIds.includes(generator.id)
        : mirrors.length === 0;
    const destinations = [
      ...(writeGenerator ? [path.join(destBase, getPlatformSkillsDir(generator, scope))] : []),
      ...mirrors.map((platform) => path.join(destBase, getPlatformSkillsDir(platform, scope))),
    ];
    for (const destination of destinations) {
      if (mergedDestinations.has(destination)) continue;
      copies.push({ source, destination });
      mergedDestinations.add(destination);
    }
  }
  return copies;
}

/**
 * Validates that every requested platform produced non-empty staged tool output
 * before any project file is written. Runs after the staging `openspec init`
 * and before the artifact-root init/merge, so a missing or empty later platform
 * cannot leave partially written artifacts or Skills behind.
 */
async function preflightGeneratedToolDirectories(
  stagingProject: string,
  destBase: string,
  scope: InstallScope,
  toolIds: readonly string[],
  mirrorPlatformIds: readonly string[] = [],
  selectedPlatformIds: readonly string[] = [],
): Promise<GeneratedToolCopy[]> {
  return resolveGeneratedToolCopies(
    stagingProject,
    destBase,
    scope,
    toolIds,
    mirrorPlatformIds,
    selectedPlatformIds,
  );
}

async function mergeGeneratedToolDirectories(
  copies: readonly GeneratedToolCopy[],
  stagingProject: string,
  destBase: string,
  projectMutationGuard?: ProjectMutationGuard,
): Promise<void> {
  for (const copy of copies) {
    await copyGeneratedToolDirectory(
      stagingProject,
      copy.source,
      destBase,
      copy.destination,
      projectMutationGuard,
    );
  }
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

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = value.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/u);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function isOpenSpecVersionCompatible(versionOutput: string): boolean {
  const actual = parseSemanticVersion(versionOutput);
  const minimum = parseSemanticVersion(MINIMUM_OPENSPEC_VERSION);
  if (!actual || !minimum) return false;
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (actual[field] > minimum[field]) return true;
    if (actual[field] < minimum[field]) return false;
  }
  return actual.prerelease === null;
}

function getOpenSpecVersion(): string | null {
  try {
    return execFileSync('openspec', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      shell: process.platform === 'win32',
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function isOpenSpecCliCompatible(): boolean {
  if (!isCommandAvailable('openspec')) return false;
  const version = getOpenSpecVersion();
  return version !== null && isOpenSpecVersionCompatible(version);
}

async function ensureOpenSpecCli(
  projectPath: string,
  shouldInstall = true,
): Promise<'ready' | 'missing' | 'incompatible' | 'failed'> {
  const alreadyInstalled = isCommandAvailable('openspec');
  if (!shouldInstall) {
    if (!alreadyInstalled) return 'missing';
    const version = getOpenSpecVersion();
    if (version && isOpenSpecVersionCompatible(version)) return 'ready';
    console.error(
      `    OpenSpec ${version || 'version unknown'} is incompatible; Comet requires >= ${MINIMUM_OPENSPEC_VERSION}. The OpenSpec upgrade was not selected; rerun comet init and select OpenSpec, or run: npm install -g @fission-ai/openspec@latest`,
    );
    return 'incompatible';
  }
  const label = alreadyInstalled ? 'Upgrading' : 'Installing';
  console.warn(`    ${label} OpenSpec CLI...`);
  try {
    // OpenSpec is invoked as a PATH command below; keep the CLI install global
    // regardless of Comet's project/global skill installation scope.
    const npmArgs = ['install', '-g', '@fission-ai/openspec@latest'];
    execFileSync(getNpmExecutable(), npmArgs, {
      cwd: os.homedir() || projectPath,
      stdio: 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
    if (isCommandAvailable('openspec')) return 'ready';
    console.error(
      '    OpenSpec CLI installation completed, but the command is still unavailable on PATH. Restart the terminal or install manually: npm install -g @fission-ai/openspec@latest',
    );
    return 'failed';
  } catch (error) {
    if (alreadyInstalled) {
      const version = getOpenSpecVersion();
      if (version && isOpenSpecVersionCompatible(version)) {
        console.warn(
          `    OpenSpec upgrade failed, using compatible existing version ${version}: ${(error as Error).message}`,
        );
        return 'ready';
      }
      console.error(
        `    OpenSpec upgrade failed and existing ${version || 'version could not be read'} is incompatible; Comet requires >= ${MINIMUM_OPENSPEC_VERSION}.`,
      );
      printCommandErrorDetails(error);
      return 'incompatible';
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
      throw new Error(
        `Failed to copy OpenSpec ${label} from ${from} to ${to}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}

async function installOpenSpec(
  projectPath: string,
  toolIds: string[],
  scope: InstallScope,
  shouldInstallCli = true,
  mirrorPlatformIds: string[] = [],
  artifactLayout: 'legacy' | 'docs' = 'legacy',
  projectMutationGuard?: ProjectMutationGuard,
  failureObserver?: OpenSpecFailureObserver,
  extraMirrorPlatformIds: string[] = [],
  moreMirrorPlatformIds: string[] = [],
  selectedPlatformIds: string[] = [],
): Promise<'installed' | 'failed' | 'skipped'> {
  const allMirrorPlatformIds = [
    ...new Set([...mirrorPlatformIds, ...extraMirrorPlatformIds, ...moreMirrorPlatformIds]),
  ];
  if (scope === 'project') {
    try {
      await assertProjectMutationAllowed(projectMutationGuard, 'before');
    } catch (error) {
      console.error(`    OpenSpec init failed: ${(error as Error).message}`);
      throw error;
    }
  }
  const cliStatus = await ensureOpenSpecCli(projectPath, shouldInstallCli);
  if (cliStatus === 'failed' || cliStatus === 'incompatible') {
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
  let stagingProject: string | undefined;
  let generatedToolCopies: GeneratedToolCopy[] | undefined;
  try {
    const openspecEnv = createOpenSpecAllWorkflowsEnv();
    configHome = openspecEnv.configHome;

    configBackup = writeAllWorkflowsToDefaultConfig();
    const destBase = scope === 'global' ? os.homedir() : projectPath;
    const usesStagedToolCopy =
      toolIds.length > 0 && (scope === 'project' || allMirrorPlatformIds.length > 0);

    if (usesStagedToolCopy) {
      stagingProject = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-tools-'));
      await runOpenSpecInit(
        stagingProject,
        toolIds,
        openspecEnv.env,
        scope === 'project' ? projectMutationGuard : undefined,
        false,
        false,
      );
      generatedToolCopies = await preflightGeneratedToolDirectories(
        stagingProject,
        destBase,
        scope,
        toolIds,
        allMirrorPlatformIds,
        selectedPlatformIds,
      );
    }

    if (scope === 'project') {
      await assertProjectMutationAllowed(projectMutationGuard, 'before');
      const artifactBase = artifactLayout === 'docs' ? path.join(projectPath, 'docs') : projectPath;
      let artifactMutationGuard = projectMutationGuard;
      if (artifactLayout === 'docs') {
        await ensureProtectedProjectDirectory(projectPath, 'docs', {
          label: 'OpenSpec docs artifact base',
        });
        artifactMutationGuard = async () => {
          await projectMutationGuard?.();
          await inspectProtectedProjectPath(projectPath, 'docs', {
            label: 'OpenSpec docs artifact base',
            expected: 'directory',
          });
        };
      }
      await runOpenSpecInit(artifactBase, ['none'], openspecEnv.env, artifactMutationGuard, true);
      if (stagingProject && generatedToolCopies) {
        await assertProjectMutationAllowed(projectMutationGuard, 'before', true);
        await mergeGeneratedToolDirectories(
          generatedToolCopies,
          stagingProject,
          destBase,
          projectMutationGuard,
        );
      }
      await assertProjectMutationAllowed(projectMutationGuard, 'after-external', true);
    } else if (allMirrorPlatformIds.length > 0 && stagingProject && generatedToolCopies) {
      await mergeGeneratedToolDirectories(generatedToolCopies, stagingProject, destBase);
    } else {
      await runOpenSpecInit(os.homedir(), toolIds, openspecEnv.env);
    }

    if (scope === 'global' && toolIds.includes('opencode')) {
      migrateOpenCodeOpenSpecPaths(os.homedir());
    }

    return 'installed';
  } catch (error) {
    failureObserver?.(error as Error);
    console.error(`    OpenSpec init failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    if (error instanceof ProjectMutationGuardError) {
      throw error;
    }
    return 'failed';
  } finally {
    restoreDefaultConfig(configBackup);
    if (configHome) {
      fs.rmSync(configHome, { recursive: true, force: true });
    }
    if (stagingProject) {
      fs.rmSync(stagingProject, { recursive: true, force: true });
    }
  }
}

export {
  MINIMUM_OPENSPEC_VERSION,
  installOpenSpec,
  isCommandAvailable,
  isOpenSpecVersionCompatible,
  getOpenSpecVersion,
  buildOpenSpecInitInvocation,
  getNpmExecutable,
  migrateOpenCodeOpenSpecPaths,
  migrateZCodeOpenSpecPaths,
  mirrorOpenCodeCompatibleOpenSpecPaths,
  isProjectMutationGuardError,
};
export type { ProjectMutationGuard };
