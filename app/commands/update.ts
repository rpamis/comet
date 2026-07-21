import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { select } from '@inquirer/prompts';
import { fileExists, readJson } from '../../platform/fs/file-system.js';
import { getBaseDir } from '../../platform/install/detect.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  getManifestSkills,
  mergeProjectConfig,
  prepareManagedSkillCopyTarget,
} from '../../domains/skill/platform-install.js';
import { removeLegacyCometSkillsForPlatform } from '../../domains/skill/uninstall.js';
import { installCometProjectInstructions } from '../../domains/skill/project-instructions.js';
import { LANGUAGES } from '../../domains/skill/languages.js';
import {
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import { resolveCanonicalSkillRootOwners } from '../../platform/install/skill-root-owner.js';
import {
  listProjectRegistryEntries,
  removeProjectInstallation,
  upsertProjectInstallation,
  type ProjectRegistryEntry,
} from '../../platform/install/project-registry.js';
import {
  hasCodegraphProjectIndex,
  installCodegraph,
} from '../../domains/integrations/codegraph.js';
import { discoverNativeProject } from '../../domains/comet-native/native-paths.js';
import { readProjectConfig } from '../../domains/comet-native/native-config.js';
import { resolveCometEntry } from '../../domains/comet-entry/resolve-entry.js';
import type { InitWorkflowSelection } from '../../domains/comet-entry/types.js';
import { migrateLegacyClassicSelection } from '../../domains/comet-entry/current-selection.js';
import type { InstallScope, InstallMode } from '../../platform/install/types.js';
import { getLatestVersion, printVersionInfo } from '../../platform/version/version.js';
import { t, type TranslationKey } from './i18n.js';
import { assertProjectScopeOptions, resolveProjectScopeMode } from './project-scope-selection.js';
import type { CommandExecutionResult } from './command-result.js';

const PACKAGE_NAME = '@rpamis/comet';
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

interface UpdateOptions {
  json?: boolean;
  language?: string;
  scope?: InstallScope;
  skipNpm?: boolean;
  skipSelfUpdate?: boolean;
  selfUpdate?: boolean;
  installMode?: InstallMode;
  allProjects?: boolean;
  currentProject?: boolean;
  targetScopes?: InstallScope[];
  skipGlobalNpmUpdate?: boolean;
  failOnNpmFailure?: boolean;
  npmSkipReason?: string;
  skipPackageSelfUpdate?: boolean;
}

type SkillLanguage = 'en' | 'zh';
type NpmStatus = 'updated' | 'failed' | 'skipped';
type CodegraphStatus = 'installed' | 'failed' | 'skipped';

interface NpmUpdateFailure extends Error {
  npmScope: InstallScope;
}

type NpmSelfUpdatePlan =
  | { action: 'update'; version: string }
  | { action: 'skip'; reason: string }
  | { action: 'fail'; reason: string };

interface CapturedProcessResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
}

interface CapturedProcessLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

const CANDIDATE_COMMAND_LIMITS: CapturedProcessLimits = {
  timeoutMs: 15_000,
  maxOutputBytes: 256 * 1024,
};

const NPM_INSPECTION_LIMITS: CapturedProcessLimits = {
  timeoutMs: 15_000,
  maxOutputBytes: 64 * 1024,
};

const CANDIDATE_INSTALL_LIMITS: CapturedProcessLimits = {
  timeoutMs: 3 * 60_000,
  maxOutputBytes: 4 * 1024 * 1024,
};

const NPM_MUTATION_LIMITS: CapturedProcessLimits = {
  timeoutMs: 10 * 60_000,
  maxOutputBytes: 8 * 1024 * 1024,
};

interface InstalledCometPackage {
  packageRoot: string;
  version: string;
  binPath: string;
  projectMetadataRoots?: string[];
}

interface FileSnapshot {
  filePath: string;
  content: Buffer | null;
}

function createNpmUpdateFailure(scope: InstallScope, reason?: string): NpmUpdateFailure {
  const detail = reason ? `: ${reason}` : '';
  const error = new Error(
    `npm package update failed (${scope} scope)${detail}`,
  ) as NpmUpdateFailure;
  error.npmScope = scope;
  return error;
}

function isGlobalNpmUpdateFailure(error: unknown): boolean {
  return (error as Partial<NpmUpdateFailure> | undefined)?.npmScope === 'global';
}

interface InstalledCometTarget {
  scope: InstallScope;
  platform: Platform;
  language: SkillLanguage;
}

interface SingleProjectUpdateResult {
  projectPath: string;
  npm: {
    scope: InstallScope | 'skipped';
    status: NpmStatus;
    command: string | null;
    exitCode: number | null;
    reason?: string;
  };
  skills: {
    totalCopied: number;
    totalFailed: number;
    cleanupFailed: number;
    installMode?: InstallMode;
    targets: Array<{
      scope: InstallScope;
      platform: string;
      platformName: string;
      language: SkillLanguage;
      source: string;
      copied: number;
      skipped: number;
      failed: number;
      reason?: string;
      cleanupFailed: number;
      command: string;
    }>;
  };
  rules: {
    totalCopied: number;
    totalFailed: number;
    targets: Array<{
      scope: InstallScope;
      platform: string;
      platformName: string;
      copied: number;
      skipped: number;
      failed: number;
      status: 'copied' | 'skipped' | 'failed';
      reason?: string;
    }>;
  };
  hooks: {
    totalInstalled: number;
    totalFailed: number;
    targets: Array<{
      scope: InstallScope;
      platform: string;
      platformName: string;
      failed: number;
      status: 'installed' | 'skipped' | 'failed';
      reason?: string;
    }>;
  };
  projectInstructions: { updated: number };
  codegraph: CodegraphStatus;
}

interface ComponentFailureDetail {
  scope: InstallScope;
  platform: string;
  platformName: string;
  component: 'Skill' | 'Rule' | 'Hook';
  status: 'failed';
  failed: number;
  reason: string;
}

interface CommandFailureDetail {
  component: 'npm' | 'CodeGraph' | 'Skill' | 'Rule' | 'Hook';
  reason: string;
  scope?: InstallScope;
  platform?: string;
  platformName?: string;
  failed?: number;
}

interface AllProjectsUpdateResult {
  projectPath: string;
  status: 'updated' | 'skipped' | 'failed' | 'not_attempted';
  reason?: string;
  targets: Array<{
    scope: InstallScope;
    platform: string;
    platformName: string;
    language: SkillLanguage;
  }>;
  failures?: CommandFailureDetail[];
  summary?: {
    skillsCopied: number;
    rulesCopied: number;
    hooksInstalled: number;
    projectInstructionsUpdated: number;
  };
}

interface DetectTargetsOptions {
  scopes?: InstallScope[];
  globalBaseDir?: string;
  respectDetectionPaths?: boolean;
}

function resolveTargetLanguage(
  language: string | undefined,
  fallback: SkillLanguage,
): SkillLanguage {
  return (language ?? fallback) === 'zh' ? 'zh' : 'en';
}

function languageToSkillsDir(languageId: SkillLanguage): string {
  return languageId === 'zh' ? 'skills-zh' : 'skills';
}

function languageToArtifactLanguage(languageId: SkillLanguage): 'en' | 'zh-CN' {
  return LANGUAGES.find((entry) => entry.id === languageId)!.artifactLanguage;
}

function getScopedBaseDir(
  scope: InstallScope,
  projectPath: string,
  globalBaseDir = os.homedir(),
): string {
  return scope === 'global' ? globalBaseDir : projectPath;
}

function getInstalledCometSkillsDirs(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): string[] {
  const skillsDirs = [
    ...getPlatformSkillsDirs(platform, scope),
    ...(scope === 'global' && platform.id === 'pi' ? [platform.skillsDir] : []),
  ];
  return [...new Set(skillsDirs)].map((skillsDir) => path.join(baseDir, skillsDir, 'skills'));
}

function isMissingInspectionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function targetPathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isMissingInspectionError(error)) return false;
    throw error;
  }
}

async function readTargetDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    if (isMissingInspectionError(error)) return [];
    throw error;
  }
}

async function hasLocalCometSkills(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  for (const skillsDir of getInstalledCometSkillsDirs(baseDir, platform, scope)) {
    if (!(await targetPathExists(skillsDir))) continue;
    const entries = await readTargetDir(skillsDir);
    if (entries.some((entry) => entry.startsWith('comet'))) return true;
  }
  return false;
}

async function detectInstalledCometLanguage(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<SkillLanguage> {
  for (const skillsDir of getInstalledCometSkillsDirs(baseDir, platform, scope)) {
    if (!(await targetPathExists(skillsDir))) continue;
    const entries = (await readTargetDir(skillsDir)).filter((entry) => entry.startsWith('comet'));

    for (const entry of entries) {
      const skillPath = path.join(skillsDir, entry, 'SKILL.md');
      if (!(await targetPathExists(skillPath))) continue;

      try {
        const content = await fs.readFile(skillPath, 'utf-8');
        if (/[㐀-鿿]/u.test(content)) return 'zh';
      } catch (error) {
        if (!isMissingInspectionError(error)) throw error;
      }
    }
  }

  return 'en';
}

async function detectInstalledCometTargets(
  projectPath: string,
  options: DetectTargetsOptions = {},
): Promise<InstalledCometTarget[]> {
  const scopes = options.scopes ?? (['project', 'global'] as InstallScope[]);
  const targets: InstalledCometTarget[] = [];

  for (const scope of scopes) {
    const baseDir = getScopedBaseDir(scope, projectPath, options.globalBaseDir);

    const owners = await resolveCanonicalSkillRootOwners(baseDir, scope, {
      respectDetectionPaths: options.respectDetectionPaths,
    });
    for (const { platform } of owners) {
      if (!(await hasLocalCometSkills(baseDir, platform, scope))) continue;

      targets.push({
        scope,
        platform,
        language: await detectInstalledCometLanguage(baseDir, platform, scope),
      });
    }
  }

  return targets;
}

function isSameOrInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function detectCometPackageScope(
  projectPath: string,
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
): Promise<InstallScope> {
  const localPackageRoot = path.join(projectPath, 'node_modules', '@rpamis', 'comet');
  if (isSameOrInside(packageRoot, localPackageRoot)) return 'project';

  const packageJsonPath = path.join(projectPath, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }>(packageJsonPath);

    if (
      pkg.dependencies?.[PACKAGE_NAME] ||
      pkg.devDependencies?.[PACKAGE_NAME] ||
      pkg.optionalDependencies?.[PACKAGE_NAME]
    ) {
      return 'project';
    }
  }

  return 'global';
}

function buildNpmUpdateArgs(scope: InstallScope, version = 'latest'): string[] {
  const packageSpec = `${PACKAGE_NAME}@${version}`;
  return scope === 'global'
    ? ['install', '-g', packageSpec, '--registry', OFFICIAL_REGISTRY]
    : ['install', packageSpec, '--registry', OFFICIAL_REGISTRY];
}

function formatNpmUpdateCommand(scope: InstallScope, version = 'latest'): string {
  return ['npm', ...buildNpmUpdateArgs(scope, version)].join(' ');
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      version,
    );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function compareSemverVersions(left: ParsedSemver, right: ParsedSemver): number {
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease);
}

function resolveNpmSelfUpdatePlan(
  currentVersion: string,
  registryVersion: string,
): NpmSelfUpdatePlan {
  const current = parseSemver(currentVersion);
  const registry = parseSemver(registryVersion);
  if (!current) {
    return {
      action: 'fail',
      reason: `current Comet version is not valid semver: ${currentVersion}`,
    };
  }
  if (!registry) {
    return {
      action: 'fail',
      reason: `registry Comet version is not valid semver: ${registryVersion}`,
    };
  }

  const comparison = compareSemverVersions(registry, current);
  if (comparison < 0) {
    return {
      action: 'skip',
      reason: `registry version ${registryVersion} is older than current version ${currentVersion}`,
    };
  }
  if (comparison === 0) {
    return { action: 'skip', reason: `Comet ${currentVersion} is already installed` };
  }
  return { action: 'update', version: registryVersion };
}

function formatSkillUpdateCommand(
  scope: InstallScope,
  platform: Platform,
  languageSkillsDir: string,
  installMode: InstallMode = 'copy',
): string {
  const destPrefix = scope === 'global' ? '~/' : '';
  if (installMode === 'symlink') {
    return `symlink via .comet/skills/ in ${destPrefix}${getPlatformSkillsDir(platform, scope)}/skills/ (${scope})`;
  }
  return `copy assets/${languageSkillsDir} -> ${destPrefix}${getPlatformSkillsDir(platform, scope)}/skills/ (${scope})`;
}

async function selectInstallMode(options: UpdateOptions, lang: string): Promise<InstallMode> {
  if (options.installMode) return options.installMode;
  if (options.json) return 'copy';

  return select({
    message: t(lang, 'installMode'),
    choices: [
      { name: t(lang, 'installModeCopy'), value: 'copy' as const },
      { name: t(lang, 'installModeSymlink'), value: 'symlink' as const },
    ],
  });
}

async function resolveNpmCliPath(): Promise<string> {
  const candidates = new Set<string>();
  const addStandardCandidates = (baseDir: string) => {
    candidates.add(path.join(baseDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    candidates.add(path.resolve(baseDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  };

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && path.basename(npmExecPath).toLowerCase() === 'npm-cli.js') {
    candidates.add(path.resolve(npmExecPath));
  }
  addStandardCandidates(path.dirname(process.execPath));

  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    addStandardCandidates(entry);
    const npmExecutable = path.join(entry, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    try {
      const resolved = await fs.realpath(npmExecutable);
      if (path.basename(resolved).toLowerCase() === 'npm-cli.js') candidates.add(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  for (const candidate of candidates) {
    try {
      return await resolveRegularContainedFile(
        candidate,
        path.resolve(candidate, '..', '..'),
        'npm CLI',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Unable to locate npm CLI (npm-cli.js) without using a shell');
}

function runCapturedProcess(
  command: string,
  args: string[],
  cwd: string,
  limits?: CapturedProcessLimits,
): Promise<CapturedProcessResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let spawnError: Error | null = null;
    let limitReason: string | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const terminate = (reason: string) => {
      if (limitReason !== null) return;
      limitReason = reason;
      child.kill();
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      forceKillTimer.unref?.();
    };
    const capture = (target: Buffer[], chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (!limits) {
        target.push(bytes);
        return;
      }
      const remaining = Math.max(0, limits.maxOutputBytes - capturedBytes);
      if (remaining > 0) target.push(bytes.subarray(0, remaining));
      capturedBytes += bytes.length;
      if (capturedBytes > limits.maxOutputBytes) {
        terminate(`process output exceeded ${limits.maxOutputBytes} bytes`);
      }
    };
    child.stdout?.on('data', (chunk) => capture(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk) => capture(stderrChunks, chunk));
    child.on('error', (error) => {
      spawnError = error;
    });
    const timeout = limits
      ? setTimeout(
          () => terminate(`process timed out after ${limits.timeoutMs}ms`),
          limits.timeoutMs,
        )
      : null;
    timeout?.unref?.();
    child.on('close', (exitCode) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const success = spawnError === null && limitReason === null && exitCode === 0;
      const captured = (stderr.trim() || stdout.trim()).slice(-4000);
      resolve({
        success,
        exitCode,
        stdout,
        stderr,
        reason: success
          ? undefined
          : (limitReason ??
            (spawnError
              ? `failed to launch ${command}: ${spawnError.message}`
              : captured || `${command} exited with code ${exitCode ?? 'unknown'}`)),
      });
    });
  });
}

function runNpmCli(
  npmCliPath: string,
  args: string[],
  cwd: string,
  limits: CapturedProcessLimits = NPM_INSPECTION_LIMITS,
): Promise<CapturedProcessResult> {
  return runCapturedProcess(process.execPath, [npmCliPath, ...args], cwd, limits);
}

async function removeDirectoryWithRetry(directory: string, attempts = 3): Promise<Error | null> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return null;
    } catch (error) {
      lastError = error as Error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  }
  return lastError;
}

async function resolveRegularContainedFile(
  file: string,
  root: string,
  label: string,
): Promise<string> {
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  const stat = await fs.lstat(realFile);
  if (!stat.isFile() || stat.isSymbolicLink() || !isSameOrInside(realFile, realRoot)) {
    throw new Error(`${label} must be a regular file inside ${realRoot}`);
  }
  return realFile;
}

async function readCometPackage(packageRoot: string): Promise<InstalledCometPackage> {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const realPackageRoot = await fs.realpath(resolvedPackageRoot);
  const packageRootStat = await fs.lstat(realPackageRoot);
  if (!packageRootStat.isDirectory() || packageRootStat.isSymbolicLink()) {
    throw new Error(`Comet package root is not a real directory: ${packageRoot}`);
  }
  const packageJsonPath = await resolveRegularContainedFile(
    path.join(resolvedPackageRoot, 'package.json'),
    resolvedPackageRoot,
    'Comet package.json',
  );
  const pkg = await readJson<{ version?: unknown; bin?: string | Record<string, string> }>(
    packageJsonPath,
  );
  if (typeof pkg.version !== 'string') {
    throw new Error(`Comet package has no valid version: ${packageJsonPath}`);
  }
  const binReference = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.comet;
  if (!binReference) throw new Error(`Comet package has no comet bin: ${packageJsonPath}`);
  const binPath = path.resolve(resolvedPackageRoot, binReference);
  if (!isSameOrInside(binPath, resolvedPackageRoot)) {
    throw new Error(`Comet package bin is invalid: ${binReference}`);
  }
  let realBinPath: string;
  try {
    realBinPath = await resolveRegularContainedFile(
      binPath,
      resolvedPackageRoot,
      'Comet package bin',
    );
  } catch (error) {
    throw new Error(`Comet package bin is invalid: ${binReference}`, { cause: error });
  }
  return { packageRoot: resolvedPackageRoot, version: pkg.version, binPath: realBinPath };
}

async function readInstalledCometPackage(
  scope: InstallScope,
  projectPath: string,
  npmCliPath: string,
): Promise<InstalledCometPackage> {
  if (scope === 'project') {
    const [rootResult, prefixResult] = await Promise.all([
      runNpmCli(npmCliPath, ['root'], projectPath),
      runNpmCli(npmCliPath, ['prefix'], projectPath),
    ]);
    const npmRoot = parseNpmAbsolutePath(rootResult, 'npm root');
    const npmPrefix = parseNpmAbsolutePath(prefixResult, 'npm prefix');
    const installedPackage = await readCometPackage(path.join(npmRoot, '@rpamis', 'comet'));
    return {
      ...installedPackage,
      projectMetadataRoots: [...new Set([path.resolve(projectPath), npmPrefix])],
    };
  }

  const rootResult = await runNpmCli(npmCliPath, ['root', '--global'], projectPath);
  const npmRoot = parseNpmAbsolutePath(rootResult, 'npm root --global');
  return readCometPackage(path.join(npmRoot, '@rpamis', 'comet'));
}

function parseNpmAbsolutePath(result: CapturedProcessResult, command: string): string {
  if (!result.success) {
    throw new Error(`Unable to resolve ${command}: ${result.reason ?? 'unknown error'}`);
  }
  const outputPath = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error(`${command} returned an invalid path: ${outputPath ?? '<empty>'}`);
  }
  return path.resolve(outputPath);
}

async function validateCometPackageCommands(
  candidate: InstalledCometPackage,
  expectedVersion: string,
): Promise<CapturedProcessResult> {
  const checks: Array<{
    args: string[];
    accepts: (stdout: string) => boolean;
    label: string;
  }> = [
    {
      args: ['--version'],
      accepts: (stdout) => stdout.trim() === expectedVersion,
      label: 'version command',
    },
    {
      args: ['workflow', 'resolve', '--help'],
      accepts: (stdout) => stdout.includes('Usage: comet workflow resolve'),
      label: 'workflow resolve command',
    },
    {
      args: ['native', '--help'],
      accepts: (stdout) => stdout.includes('Usage: comet native'),
      label: 'native command',
    },
  ];

  for (const check of checks) {
    const result = await runCapturedProcess(
      process.execPath,
      [candidate.binPath, ...check.args],
      candidate.packageRoot,
      CANDIDATE_COMMAND_LIMITS,
    );
    if (!result.success || !check.accepts(result.stdout)) {
      return {
        ...result,
        success: false,
        reason: `candidate ${check.label} failed: ${result.reason ?? 'unexpected command contract'}`,
      };
    }
  }
  return { success: true, exitCode: 0, stdout: '', stderr: '' };
}

async function validateRegistryCometPackage(
  version: string,
  npmCliPath: string,
): Promise<CapturedProcessResult> {
  let validationDir: string;
  try {
    validationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-self-update-'));
  } catch (error) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      reason: `unable to create candidate prefix: ${(error as Error).message}`,
    };
  }

  let result: CapturedProcessResult;
  try {
    const install = await runNpmCli(
      npmCliPath,
      [
        'install',
        '--prefix',
        validationDir,
        '--ignore-scripts',
        '--no-save',
        '--package-lock=false',
        `${PACKAGE_NAME}@${version}`,
        '--registry',
        OFFICIAL_REGISTRY,
      ],
      validationDir,
      CANDIDATE_INSTALL_LIMITS,
    );
    if (!install.success) {
      result = {
        ...install,
        reason: `candidate package install failed: ${install.reason ?? 'unknown error'}`,
      };
    } else {
      const candidate = await readCometPackage(
        path.join(validationDir, 'node_modules', '@rpamis', 'comet'),
      );
      if (candidate.version !== version) {
        result = {
          success: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          reason: `candidate package version mismatch: expected ${version}, got ${candidate.version}`,
        };
      } else {
        result = await validateCometPackageCommands(candidate, version);
      }
    }
  } catch (error) {
    result = {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      reason: `candidate package validation failed: ${(error as Error).message}`,
    };
  }

  const cleanupError = await removeDirectoryWithRetry(validationDir);
  if (!cleanupError) return result;
  return {
    ...result,
    success: false,
    reason: result.reason
      ? `${result.reason}; temporary cleanup failed: ${cleanupError.message}`
      : `candidate validation temporary cleanup failed: ${cleanupError.message}`,
  };
}

const PROJECT_INSTALL_METADATA = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

async function snapshotProjectInstallMetadata(metadataRoots: string[]): Promise<FileSnapshot[]> {
  const filePaths = [
    ...new Set(
      metadataRoots.flatMap((metadataRoot) =>
        PROJECT_INSTALL_METADATA.map((relativePath) => path.join(metadataRoot, relativePath)),
      ),
    ),
  ];
  return Promise.all(
    filePaths.map(async (filePath): Promise<FileSnapshot> => {
      try {
        return { filePath, content: await fs.readFile(filePath) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { filePath, content: null };
        throw error;
      }
    }),
  );
}

async function restoreProjectInstallMetadata(snapshots: FileSnapshot[]): Promise<string | null> {
  const failures: string[] = [];
  for (const snapshot of snapshots) {
    try {
      if (snapshot.content === null) {
        await fs.rm(snapshot.filePath, { force: true });
      } else {
        await fs.writeFile(snapshot.filePath, snapshot.content);
      }
    } catch (error) {
      failures.push(`${path.basename(snapshot.filePath)}: ${(error as Error).message}`);
    }
  }
  return failures.length > 0 ? failures.join('; ') : null;
}

async function installCometNpmVersion(
  npmCliPath: string,
  scope: InstallScope,
  projectPath: string,
  version: string,
): Promise<CapturedProcessResult> {
  const cwd = scope === 'global' ? process.cwd() : projectPath;
  return runNpmCli(npmCliPath, buildNpmUpdateArgs(scope, version), cwd, NPM_MUTATION_LIMITS);
}

async function updateCometNpmPackage(
  npmCliPath: string,
  scope: InstallScope,
  projectPath: string,
  targetVersion: string,
  installedPackage: InstalledCometPackage,
  log: (message: string) => void,
): Promise<{ success: boolean; exitCode: number | null; reason?: string }> {
  const validation = await validateRegistryCometPackage(targetVersion, npmCliPath);
  if (!validation.success) {
    log(`  npm package: candidate validation failed: ${validation.reason}`);
    return { success: false, exitCode: validation.exitCode, reason: validation.reason };
  }

  let metadata: FileSnapshot[] | undefined;
  if (scope === 'project') {
    try {
      metadata = await snapshotProjectInstallMetadata(
        installedPackage.projectMetadataRoots ?? [projectPath],
      );
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        reason: `unable to snapshot project package metadata: ${(error as Error).message}`,
      };
    }
  }
  const install = await installCometNpmVersion(npmCliPath, scope, projectPath, targetVersion);
  let installReason = install.reason;
  if (install.success) {
    try {
      const installedAfterUpdate = await readCometPackage(installedPackage.packageRoot);
      if (installedAfterUpdate.version === targetVersion) {
        return { success: true, exitCode: install.exitCode };
      }
      installReason = `installed package version mismatch: expected ${targetVersion}, got ${installedAfterUpdate.version}`;
    } catch (error) {
      installReason = `unable to verify installed package: ${(error as Error).message}`;
    }
  }

  const primaryReason = installReason ?? 'npm package installation failed';
  log(`  npm package: update failed; restoring ${installedPackage.version}...`);
  const rollback = await installCometNpmVersion(
    npmCliPath,
    scope,
    projectPath,
    installedPackage.version,
  );
  let rollbackReason: string | null = rollback.reason ?? null;
  if (rollback.success) {
    try {
      const restored = await readCometPackage(installedPackage.packageRoot);
      if (restored.version !== installedPackage.version) {
        rollbackReason = `restored package version mismatch: expected ${installedPackage.version}, got ${restored.version}`;
      }
    } catch (error) {
      rollbackReason = `unable to verify restored package: ${(error as Error).message}`;
    }
  }

  const metadataRestoreError = metadata ? await restoreProjectInstallMetadata(metadata) : null;
  const details = [
    primaryReason,
    rollbackReason
      ? `rollback to ${installedPackage.version} failed: ${rollbackReason}`
      : `restored ${installedPackage.version}`,
    metadataRestoreError ? `project metadata restore failed: ${metadataRestoreError}` : null,
  ].filter((detail): detail is string => detail !== null);
  return { success: false, exitCode: install.exitCode, reason: details.join('; ') };
}

async function promptCodegraphInstall(lang: string): Promise<boolean> {
  return select({
    message: t(lang, 'installCodegraph'),
    choices: [
      { name: t(lang, 'codegraphYes'), value: true },
      { name: t(lang, 'codegraphNo'), value: false },
    ],
  });
}

function currentProjectJson(result: SingleProjectUpdateResult): Record<string, unknown> {
  return {
    status: hasUpdateFailures(result) ? 'incomplete' : 'complete',
    failures: collectCommandFailures(result),
    npm: result.npm,
    skills: {
      totalCopied: result.skills.totalCopied,
      totalFailed: result.skills.totalFailed,
      cleanupFailed: result.skills.cleanupFailed,
      installMode: result.skills.installMode,
      targets: result.skills.targets,
    },
    rules: result.rules,
    hooks: result.hooks,
    projectInstructions: result.projectInstructions,
    codegraph: result.codegraph,
  };
}

function hasComponentFailures(result: SingleProjectUpdateResult): boolean {
  return (
    result.skills.totalFailed > 0 ||
    result.skills.cleanupFailed > 0 ||
    result.rules.totalFailed > 0 ||
    result.hooks.totalFailed > 0
  );
}

function hasUpdateFailures(result: SingleProjectUpdateResult): boolean {
  return (
    result.npm.status === 'failed' || result.codegraph === 'failed' || hasComponentFailures(result)
  );
}

function collectComponentFailures(result: SingleProjectUpdateResult): ComponentFailureDetail[] {
  const skillFailures = result.skills.targets.flatMap((target): ComponentFailureDetail[] => {
    const failed = target.failed + target.cleanupFailed;
    if (failed === 0 || !target.reason) return [];
    return [
      {
        scope: target.scope,
        platform: target.platform,
        platformName: target.platformName,
        component: 'Skill',
        status: 'failed',
        failed,
        reason: target.reason,
      },
    ];
  });
  const ruleFailures = result.rules.targets.flatMap((target): ComponentFailureDetail[] => {
    if (target.failed === 0 || !target.reason) return [];
    return [
      {
        scope: target.scope,
        platform: target.platform,
        platformName: target.platformName,
        component: 'Rule',
        status: 'failed',
        failed: target.failed,
        reason: target.reason,
      },
    ];
  });
  const hookFailures = result.hooks.targets.flatMap((target): ComponentFailureDetail[] => {
    if (target.failed === 0 || !target.reason) return [];
    return [
      {
        scope: target.scope,
        platform: target.platform,
        platformName: target.platformName,
        component: 'Hook',
        status: 'failed',
        failed: target.failed,
        reason: target.reason,
      },
    ];
  });
  return [...skillFailures, ...ruleFailures, ...hookFailures];
}

function collectCommandFailures(result: SingleProjectUpdateResult): CommandFailureDetail[] {
  const failures: CommandFailureDetail[] = [];
  if (result.npm.status === 'failed') {
    failures.push({
      component: 'npm',
      scope: result.npm.scope === 'skipped' ? undefined : result.npm.scope,
      reason: result.npm.reason ?? 'npm package update failed',
    });
  }
  failures.push(...collectComponentFailures(result));
  if (result.codegraph === 'failed') {
    failures.push({ component: 'CodeGraph', reason: 'CodeGraph installation failed' });
  }
  return failures;
}

function summarizeTargets(targets: InstalledCometTarget[]): AllProjectsUpdateResult['targets'] {
  return targets.map((target) => ({
    scope: target.scope,
    platform: target.platform.id,
    platformName: target.platform.name,
    language: target.language,
  }));
}

function summarizeUpdatedTargets(
  targets: SingleProjectUpdateResult['skills']['targets'],
): AllProjectsUpdateResult['targets'] {
  return targets.map((target) => ({
    scope: target.scope,
    platform: target.platform,
    platformName: target.platformName,
    language: target.language,
  }));
}

async function upsertUpdatedProjectTargets(
  projectPath: string,
  result: SingleProjectUpdateResult,
): Promise<void> {
  const projectTargets = result.skills.targets.filter((target) => target.scope === 'project');
  if (projectTargets.length === 0) return;

  await upsertProjectInstallation(
    projectPath,
    projectTargets.map((target) => ({
      platform: target.platform,
      language: target.language,
    })),
    'update',
  );
}

async function updateSingleProject(
  startPath: string,
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<SingleProjectUpdateResult> {
  const lang = options.language ?? 'en';
  const includesProjectScope = options.targetScopes
    ? options.targetScopes.includes('project')
    : options.scope !== 'global';
  const projectPath = includesProjectScope ? await discoverNativeProject(startPath) : startPath;
  const projectEntry = includesProjectScope ? await resolveCometEntry(projectPath) : null;
  const projectConfig = includesProjectScope ? await readProjectConfig(projectPath) : null;
  const configuredWorkflows =
    projectConfig?.workflows ?? (projectConfig ? [projectConfig.default_workflow] : null);
  const nativeProject = configuredWorkflows
    ? configuredWorkflows.includes('native')
    : projectEntry?.workflow === 'native';
  const classicProject = configuredWorkflows
    ? configuredWorkflows.includes('classic')
    : projectEntry?.workflow === 'classic';
  const projectWorkflowSelection: InitWorkflowSelection =
    nativeProject && classicProject ? 'both' : nativeProject ? 'native' : 'classic';
  const packageScope =
    options.scope && !options.targetScopes
      ? options.scope
      : await detectCometPackageScope(projectPath);
  let npmStatus: NpmStatus = 'skipped';
  let npmExitCode: number | null = null;
  let npmReason: string | undefined = options.npmSkipReason;
  let npmCommand: string | null = null;
  const skipPackageSelfUpdate = options.skipPackageSelfUpdate ?? options.skipNpm === true;
  const skipRepeatedGlobalNpm =
    !skipPackageSelfUpdate && packageScope === 'global' && options.skipGlobalNpmUpdate === true;
  if (skipRepeatedGlobalNpm) {
    npmReason = 'global scope self-update already attempted';
    log(`  ${t(lang, 'updatingNpmPackage')}: skipped (global scope already attempted)`);
  } else if (!skipPackageSelfUpdate) {
    let npmCliPath: string | null = null;
    let installedPackage: InstalledCometPackage | null = null;
    try {
      npmCliPath = await resolveNpmCliPath();
      installedPackage = await readInstalledCometPackage(packageScope, projectPath, npmCliPath);
    } catch (error) {
      npmStatus = 'failed';
      npmReason = `unable to inspect installed Comet package: ${(error as Error).message}`;
    }

    const registryVersion = installedPackage ? await getLatestVersion() : null;
    if (installedPackage && registryVersion === null) {
      npmStatus = 'failed';
      npmReason = 'unable to resolve the latest Comet version from the npm registry';
    } else if (installedPackage && registryVersion && npmCliPath) {
      const plan = resolveNpmSelfUpdatePlan(installedPackage.version, registryVersion);
      if (plan.action === 'skip') {
        npmStatus = 'skipped';
        npmReason = plan.reason;
        log(`  ${t(lang, 'updatingNpmPackage')}: skipped (${plan.reason})`);
      } else if (plan.action === 'fail') {
        npmStatus = 'failed';
        npmReason = plan.reason;
      } else {
        npmCommand = formatNpmUpdateCommand(packageScope, plan.version);
        log(`  ${t(lang, 'updatingNpmPackage')} (${packageScope} scope)...`);
        log(`    $ ${npmCommand}`);
        const npmResult = await updateCometNpmPackage(
          npmCliPath,
          packageScope,
          projectPath,
          plan.version,
          installedPackage,
          log,
        );
        npmExitCode = npmResult.exitCode;
        npmReason = npmResult.reason;
        if (npmResult.success) {
          npmStatus = 'updated';
          log(`  ${t(lang, 'npmPackageUpdated')} ${PACKAGE_NAME}@${plan.version}`);
        } else {
          npmStatus = 'failed';
        }
      }
    }
    if (npmStatus === 'failed') {
      log(
        `  ${t(lang, options.failOnNpmFailure ? 'npmPackageFailedBlocking' : 'npmPackageFailed')}`,
      );
      if (options.failOnNpmFailure) {
        throw createNpmUpdateFailure(packageScope, npmReason);
      }
    }
  }

  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.targetScopes ?? (options.scope ? [options.scope] : undefined),
    respectDetectionPaths: options.scope === undefined,
  });

  if (targets.length === 0) {
    return {
      projectPath,
      npm: {
        scope: skipPackageSelfUpdate ? 'skipped' : packageScope,
        status: npmStatus,
        command: npmCommand,
        exitCode: npmExitCode,
        reason: npmReason,
      },
      skills: { totalCopied: 0, totalFailed: 0, cleanupFailed: 0, targets: [] },
      rules: { totalCopied: 0, totalFailed: 0, targets: [] },
      hooks: { totalInstalled: 0, totalFailed: 0, targets: [] },
      projectInstructions: { updated: 0 },
      codegraph: 'skipped',
    };
  }

  const hasClassicCompatibleTarget = targets.some(
    (target) => target.scope === 'global' || classicProject,
  );
  const selectedInstallMode = hasClassicCompatibleTarget
    ? await selectInstallMode(options, lang)
    : 'copy';
  const installModeFor = (target: InstalledCometTarget): InstallMode =>
    nativeProject && target.scope === 'project' ? 'copy' : selectedInstallMode;
  const reportedInstallMode = targets.every((target) => nativeProject && target.scope === 'project')
    ? 'copy'
    : selectedInstallMode;

  log(`\n  ${t(lang, 'updatingSkillsOnTargets')} ${targets.length} target(s):`);
  for (const target of targets) {
    const language = options.language ?? target.language;
    const scopeLabel = target.scope === 'global' ? 'global' : `project (${projectPath})`;
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    const targetInstallMode = installModeFor(target);
    log(`    - ${target.platform.name} (${scopeLabel}, ${language})`);
    log(
      `      $ ${formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir, targetInstallMode)}`,
    );
  }

  const targetWorkflowSelections = targets.map((target) =>
    target.scope === 'global' ? 'classic' : projectWorkflowSelection,
  );
  const updateSkillPaths = new Set(
    (
      await Promise.all(
        [...new Set(targetWorkflowSelections)].map((selection) => getManifestSkills(selection)),
      )
    ).flat(),
  );
  log(`\n  ${t(lang, 'copyingSkillsFiles')} ${updateSkillPaths.size} skill files...\n`);

  let totalCopied = 0;
  let totalFailed = 0;
  let totalCleanupFailed = 0;
  let totalRulesCopied = 0;
  let totalRulesFailed = 0;
  let totalHooksInstalled = 0;
  let totalHooksFailed = 0;
  let projectInstructionsUpdated = 0;
  const targetResults: SingleProjectUpdateResult['skills']['targets'] = [];
  const ruleTargetResults: SingleProjectUpdateResult['rules']['targets'] = [];
  const hookTargetResults: SingleProjectUpdateResult['hooks']['targets'] = [];
  for (const target of targets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    const targetInstallMode = installModeFor(target);
    const nativeProjectTarget = nativeProject && target.scope === 'project';
    const targetWorkflowSelection =
      target.scope === 'global' ? 'classic' : projectWorkflowSelection;
    if (nativeProjectTarget) {
      await prepareManagedSkillCopyTarget(
        baseDir,
        target.platform,
        target.scope,
        targetWorkflowSelection,
      );
    }
    const { copied, skipped, failed } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      targetInstallMode,
      targetWorkflowSelection,
    );
    const cleanupResult =
      failed === 0
        ? await removeLegacyCometSkillsForPlatform(baseDir, target.platform, target.scope)
        : { removed: 0, failed: 0 };
    totalCleanupFailed += cleanupResult.failed;
    totalCopied += copied;
    totalFailed += failed;
    targetResults.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      language: languageId,
      source: languageSkillsDir,
      copied,
      skipped,
      failed,
      reason:
        failed > 0
          ? `${failed} Skill file(s) failed to install`
          : cleanupResult.failed > 0
            ? `legacy Skill cleanup failed (${cleanupResult.failed})`
            : undefined,
      cleanupFailed: cleanupResult.failed,
      command: formatSkillUpdateCommand(
        target.scope,
        target.platform,
        languageSkillsDir,
        targetInstallMode,
      ),
    });
    log(
      `  ${target.platform.name} (${target.scope}, ${languageSkillsDir}): ${copied} ${t(lang, 'skillsCopiedSkipped')} ${skipped} skipped`,
    );
    if (cleanupResult.failed > 0) {
      log(
        `  ${target.platform.name} (${target.scope}): legacy Skill cleanup failed; update incomplete`,
      );
    }

    if (failed > 0) {
      const dependencyReason = 'skipped because Skill installation failed';
      ruleTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        copied: 0,
        skipped: 0,
        failed: 0,
        status: 'skipped',
        reason: dependencyReason,
      });
      hookTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        failed: 0,
        status: 'skipped',
        reason: dependencyReason,
      });
      continue;
    }

    try {
      const ruleResult = await copyCometRulesForPlatform(
        baseDir,
        target.platform,
        true,
        languageId,
        target.scope,
        target.scope === 'global' ? 'classic' : projectWorkflowSelection,
      );
      totalRulesCopied += ruleResult.copied;
      totalRulesFailed += ruleResult.failed;
      const ruleStatus =
        ruleResult.failed > 0 ? 'failed' : ruleResult.copied > 0 ? 'copied' : 'skipped';
      const ruleReason =
        ruleResult.failed > 0
          ? `${ruleResult.failed} Rule file(s) failed to install`
          : !target.platform.rulesDir || !target.platform.rulesFormat
            ? 'platform does not support rules'
            : undefined;
      ruleTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        ...ruleResult,
        status: ruleStatus,
        reason: ruleReason,
      });
      if (ruleResult.copied > 0) {
        log(
          `  Comet rules -> ${target.platform.name}: ${ruleResult.copied} ${t(lang, 'rulesUpdated')}`,
        );
      }
      if (ruleResult.failed > 0) {
        log(`  Comet rules -> ${target.platform.name}: ${t(lang, 'rulesFailed')} (${ruleReason})`);
      }
    } catch (err) {
      totalRulesFailed++;
      const reason = (err as Error).message;
      ruleTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        copied: 0,
        skipped: 0,
        failed: 1,
        status: 'failed',
        reason,
      });
      log(`  Comet rules -> ${target.platform.name}: ${t(lang, 'rulesFailed')} (${reason})`);
    }

    try {
      const {
        status,
        reason,
        cleanupFailed = 0,
      } = await installCometHooksForPlatform(
        baseDir,
        target.platform,
        target.scope,
        target.scope === 'global' ? 'classic' : projectWorkflowSelection,
      );
      const hookFailed = status === 'failed' ? 1 : cleanupFailed;
      totalHooksFailed += hookFailed;
      hookTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        failed: hookFailed,
        status,
        reason,
      });
      if (status === 'installed') {
        totalHooksInstalled++;
        log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksUpdated')}`);
        if (cleanupFailed > 0) {
          log(`  Comet hooks -> ${target.platform.name}: ${reason}`);
        }
      } else if (status === 'failed') {
        log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksFailed')} (${reason})`);
      } else if (reason && target.platform.supportsHooks) {
        log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksSkipped')} (${reason})`);
      }
    } catch (err) {
      totalHooksFailed++;
      const reason = (err as Error).message;
      hookTargetResults.push({
        scope: target.scope,
        platform: target.platform.id,
        platformName: target.platform.name,
        failed: 1,
        status: 'failed',
        reason,
      });
      log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksFailed')} (${reason})`);
    }
  }

  const projectRouterInstalled = hookTargetResults.some(
    (target) => target.scope === 'project' && target.status === 'installed',
  );
  const projectHookFailed = hookTargetResults.some(
    (target) => target.scope === 'project' && target.status === 'failed',
  );
  if (
    includesProjectScope &&
    projectRouterInstalled &&
    !projectHookFailed &&
    (projectWorkflowSelection === 'classic' || projectWorkflowSelection === 'both')
  ) {
    if (await migrateLegacyClassicSelection(projectPath)) {
      log('  Comet current selection -> migrated Classic v1 to shared v2');
    }
  }

  for (const scope of ['project', 'global'] as const) {
    const scopeTargets = targets.filter((candidate) => candidate.scope === scope);
    if (scopeTargets.length === 0) continue;
    // An explicit --language always wins. Otherwise only force the persisted language when
    // every platform installed at this scope agrees — if two platforms disagree (e.g. one
    // installed with English skills, another with Chinese) and the user didn't say which one
    // they mean, guessing from array order would silently override whatever language they
    // (or a prior install) already configured. Pass null in that case so mergeProjectConfig
    // preserves the existing config's language instead of guessing.
    const agreedLanguage = scopeTargets.every((t) => t.language === scopeTargets[0].language)
      ? scopeTargets[0].language
      : undefined;
    const languageId = options.language
      ? resolveTargetLanguage(options.language, scopeTargets[0].language)
      : agreedLanguage;
    const configRoot = getBaseDir(scope, projectPath);
    await mergeProjectConfig(
      configRoot,
      languageId ? languageToArtifactLanguage(languageId) : null,
    );
    log(`  ${t(lang, 'configMerged')}`);
  }

  const projectTarget = targets.find((target) => target.scope === 'project');
  if (projectTarget) {
    const projectLanguageId = resolveTargetLanguage(options.language, projectTarget.language);
    const projectInstructionResult = await installCometProjectInstructions(
      projectPath,
      projectLanguageId,
    );
    projectInstructionsUpdated = projectInstructionResult.changed;
    if (projectInstructionsUpdated > 0) {
      log(`  Comet project instructions -> ${projectInstructionsUpdated} file(s) updated`);
    }
  }

  let codegraphStatus: CodegraphStatus = 'skipped';
  const primaryScope = targets[0]?.scope ?? 'project';
  const codegraphAlreadyIndexed = hasCodegraphProjectIndex(projectPath);

  if (options.json) {
    codegraphStatus = 'skipped';
  } else if (nativeProject) {
    codegraphStatus = 'skipped';
  } else if (codegraphAlreadyIndexed) {
    log('\n  CodeGraph: skipped (existing .codegraph index detected)');
  } else {
    const shouldInstallCodegraph = options.skipNpm ? false : await promptCodegraphInstall(lang);

    if (shouldInstallCodegraph) {
      log(`\n  ${t(lang, 'installingCG')}`);
      codegraphStatus = await installCodegraph(projectPath, primaryScope, true);
      log(`  CodeGraph: ${codegraphStatus}`);
    } else {
      log(`\n  CodeGraph: ${t(lang, 'cgSkippedByUser')}`);
    }
  }

  return {
    projectPath,
    npm: {
      scope: skipPackageSelfUpdate ? 'skipped' : packageScope,
      status: npmStatus,
      command: npmCommand,
      exitCode: npmExitCode,
      reason: npmReason,
    },
    skills: {
      totalCopied,
      totalFailed,
      cleanupFailed: totalCleanupFailed,
      installMode: reportedInstallMode,
      targets: targetResults,
    },
    rules: {
      totalCopied: totalRulesCopied,
      totalFailed: totalRulesFailed,
      targets: ruleTargetResults,
    },
    hooks: {
      totalInstalled: totalHooksInstalled,
      totalFailed: totalHooksFailed,
      targets: hookTargetResults,
    },
    projectInstructions: { updated: projectInstructionsUpdated },
    codegraph: codegraphStatus,
  };
}

function logSingleProjectSummary(
  result: SingleProjectUpdateResult,
  options: UpdateOptions,
  log: (message: string) => void,
): void {
  const lang = options.language ?? 'en';
  const languages = [...new Set(result.skills.targets.map((target) => target.language))].join(', ');
  const scopes = [...new Set(result.skills.targets.map((target) => target.scope))].join(', ');
  log(`\n  ${t(lang, 'summary')}`);
  log(
    `    ${t(lang, 'summaryNpm')} ${result.npm.status}${
      options.skipNpm ? '' : ` (${result.npm.scope})`
    }`,
  );
  log(
    `    ${t(lang, 'summarySkills')} ${result.skills.targets.length} target(s), ${result.skills.totalCopied} files updated`,
  );
  if (result.skills.cleanupFailed > 0) {
    log(`    Skill cleanup failures: ${result.skills.cleanupFailed} (update incomplete)`);
  }
  if (result.skills.totalFailed > 0) {
    log(`    Skill failures: ${result.skills.totalFailed} (update incomplete)`);
  }
  if (result.rules.totalFailed > 0) {
    log(`    Rule failures: ${result.rules.totalFailed} (update incomplete)`);
  }
  if (result.hooks.totalFailed > 0) {
    log(`    Hook failures: ${result.hooks.totalFailed} (update incomplete)`);
  }
  for (const failure of collectComponentFailures(result)) {
    log(
      `    ${failure.platformName} (${failure.scope}) ${failure.component}: ${failure.status} (${failure.failed}) - ${failure.reason}`,
    );
  }
  log(`    ${t(lang, 'summaryCodegraph')} ${result.codegraph}`);
  log(`    ${t(lang, 'summaryScope')} ${scopes}`);
  log(`    ${t(lang, 'summaryLanguage')} ${languages}`);
  if (hasUpdateFailures(result)) {
    const reasons = collectCommandFailures(result)
      .map((failure) => failure.reason)
      .join('; ');
    log(`\n  Update incomplete. ${reasons}.\n`);
  } else {
    log(`\n  ${t(lang, 'updateComplete')}\n`);
  }
}

async function updateAllIndexedProjects(
  registryProjects: ProjectRegistryEntry[],
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<CommandExecutionResult> {
  const lang = options.language ?? 'en';
  const results: AllProjectsUpdateResult[] = [];
  const runnableProjects: Array<{ projectPath: string; targets: InstalledCometTarget[] }> = [];
  let staleRemoved = 0;

  for (const project of registryProjects) {
    const projectPath = project.path;
    try {
      const targets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
      if (targets.length === 0) {
        if (await removeProjectInstallation(projectPath)) staleRemoved++;
        results.push({
          projectPath,
          status: 'skipped',
          reason: 'no project-scope Comet install detected',
          targets: [],
        });
        continue;
      }
      runnableProjects.push({ projectPath, targets });
    } catch (error) {
      results.push({
        projectPath,
        status: 'failed',
        reason: `unable to inspect project: ${(error as Error).message}`,
        targets: [],
      });
    }
  }

  if (!options.json) {
    log(`  Comet will update ${runnableProjects.length} indexed project(s):`);
    for (const project of runnableProjects) {
      log(`    - ${project.projectPath}`);
      log(`      ${project.targets.map((target) => target.platform.name).join(', ')}`);
    }
    const confirmed = await select({
      message: t(lang, 'updateAllProjectsPrompt'),
      choices: [
        { name: t(lang, 'updateAllProjectsYes'), value: true },
        { name: t(lang, 'updateAllProjectsNo'), value: false },
      ],
    });
    if (!confirmed) {
      log(`\n  ${t(lang, 'cancelled')}\n`);
      return { status: 'complete' };
    }
  }

  const runOptions: UpdateOptions = {
    ...options,
    scope: undefined,
    targetScopes: ['project'],
    currentProject: true,
    allProjects: false,
    failOnNpmFailure: true,
  };
  if (!options.json && !runOptions.installMode) {
    runOptions.installMode = await selectInstallMode(options, lang);
  }

  let globalNpmAttempted = false;
  for (let index = 0; index < runnableProjects.length; index++) {
    const project = runnableProjects[index];
    const { projectPath, targets } = project;
    try {
      const result = await updateSingleProject(
        projectPath,
        { ...runOptions, skipGlobalNpmUpdate: globalNpmAttempted },
        log,
      );
      if (result.npm.scope === 'global' && result.npm.status !== 'skipped') {
        globalNpmAttempted = true;
      }
      if (result.skills.targets.length === 0) {
        if (await removeProjectInstallation(projectPath)) staleRemoved++;
        results.push({
          projectPath,
          status: 'skipped',
          reason: 'no project-scope Comet install detected',
          targets: [],
        });
        continue;
      }

      if (hasUpdateFailures(result)) {
        results.push({
          projectPath,
          status: 'failed',
          reason: collectCommandFailures(result)
            .map((failure) => failure.reason)
            .join('; '),
          targets: summarizeUpdatedTargets(result.skills.targets),
          failures: collectCommandFailures(result),
        });
        continue;
      }

      await upsertUpdatedProjectTargets(projectPath, result);
      results.push({
        projectPath,
        status: 'updated',
        targets: summarizeUpdatedTargets(result.skills.targets),
        summary: {
          skillsCopied: result.skills.totalCopied,
          rulesCopied: result.rules.totalCopied,
          hooksInstalled: result.hooks.totalInstalled,
          projectInstructionsUpdated: result.projectInstructions.updated,
        },
      });
    } catch (error) {
      const npmFailure = isGlobalNpmUpdateFailure(error);
      results.push({
        projectPath,
        status: 'failed',
        reason: (error as Error).message,
        targets: summarizeTargets(targets),
        failures: npmFailure
          ? [
              {
                component: 'npm',
                scope: 'global',
                reason: (error as Error).message,
              },
            ]
          : undefined,
      });
      if (npmFailure) {
        for (const remaining of runnableProjects.slice(index + 1)) {
          results.push({
            projectPath: remaining.projectPath,
            status: 'not_attempted',
            reason: 'not attempted because the global npm package update failed',
            targets: summarizeTargets(remaining.targets),
          });
        }
        break;
      }
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'all-projects',
          status: results.some(
            (result) => result.status === 'failed' || result.status === 'not_attempted',
          )
            ? 'incomplete'
            : 'complete',
          registry: {
            projectsFound: registryProjects.length,
            staleRemoved,
          },
          projects: results,
        },
        null,
        2,
      ),
    );
    return {
      status: results.some(
        (result) => result.status === 'failed' || result.status === 'not_attempted',
      )
        ? 'incomplete'
        : 'complete',
    };
  }

  log(
    `\n  Updated ${results.filter((result) => result.status === 'updated').length} indexed project(s).`,
  );
  for (const result of results.filter((candidate) => candidate.status !== 'updated')) {
    log(`    ${result.projectPath}: ${result.status} (${result.reason ?? 'no reason provided'})`);
  }
  return {
    status: results.some(
      (result) => result.status === 'failed' || result.status === 'not_attempted',
    )
      ? 'incomplete'
      : 'complete',
  };
}

function resolveSelfUpdateOptions(
  options: UpdateOptions,
  refreshesOnlyCurrentProject: boolean,
): UpdateOptions {
  if (options.selfUpdate && (options.skipSelfUpdate || options.skipNpm)) {
    throw new Error('--self-update cannot be combined with --skip-self-update or --skip-npm');
  }

  if (options.skipSelfUpdate || options.skipNpm) {
    return {
      ...options,
      skipPackageSelfUpdate: true,
      npmSkipReason: options.skipSelfUpdate
        ? 'self-update disabled by --skip-self-update'
        : 'self-update disabled by --skip-npm',
    };
  }
  if (refreshesOnlyCurrentProject && !options.selfUpdate) {
    return {
      ...options,
      skipPackageSelfUpdate: true,
      npmSkipReason:
        'self-update disabled for current-project updates; pass --self-update to opt in',
    };
  }
  return { ...options, skipPackageSelfUpdate: false };
}

export async function updateCommand(
  targetPath: string,
  options: UpdateOptions = {},
): Promise<CommandExecutionResult> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;
  const lang = options.language ?? 'en';

  assertProjectScopeOptions(options);
  const registryProjects = await listProjectRegistryEntries({ strict: true });

  log(`\n  ${t(lang, 'updateTitle')}`);
  if (!options.json) {
    await printVersionInfo(log);
  }
  log('');

  const scopeMode = await resolveProjectScopeMode('update', options, registryProjects.length);
  options = resolveSelfUpdateOptions(
    options,
    options.currentProject === true || scopeMode === 'current-project',
  );
  if (scopeMode === 'all-projects') {
    return updateAllIndexedProjects(registryProjects, options, log);
  }

  const result = await updateSingleProject(projectPath, options, log);
  if (result.skills.targets.length === 0) {
    if (options.json) {
      console.log(JSON.stringify(currentProjectJson(result), null, 2));
      return { status: hasUpdateFailures(result) ? 'incomplete' : 'complete' };
    }
    log(`\n  ${t(lang, 'noInstallsFound')}\n`);
    return { status: hasUpdateFailures(result) ? 'incomplete' : 'complete' };
  }

  if (!hasUpdateFailures(result)) {
    await upsertUpdatedProjectTargets(result.projectPath, result);
  }

  if (options.json) {
    console.log(JSON.stringify(currentProjectJson(result), null, 2));
    return { status: hasUpdateFailures(result) ? 'incomplete' : 'complete' };
  }

  logSingleProjectSummary(result, options, log);
  return { status: hasUpdateFailures(result) ? 'incomplete' : 'complete' };
}

export {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
  resolveNpmSelfUpdatePlan,
};
export type { InstalledCometTarget, SkillLanguage, TranslationKey };
