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
import { printVersionInfo } from '../../platform/version/version.js';
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
  installMode?: InstallMode;
  allProjects?: boolean;
  currentProject?: boolean;
  targetScopes?: InstallScope[];
  skipGlobalNpmUpdate?: boolean;
  failOnNpmFailure?: boolean;
}

type SkillLanguage = 'en' | 'zh';
type NpmStatus = 'updated' | 'failed' | 'skipped';
type CodegraphStatus = 'installed' | 'failed' | 'skipped';

interface NpmUpdateFailure extends Error {
  npmScope: InstallScope;
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

function buildNpmUpdateArgs(scope: InstallScope): string[] {
  return scope === 'global'
    ? ['install', '-g', `${PACKAGE_NAME}@latest`, '--registry', OFFICIAL_REGISTRY]
    : ['install', `${PACKAGE_NAME}@latest`, '--registry', OFFICIAL_REGISTRY];
}

function formatNpmUpdateCommand(scope: InstallScope): string {
  return ['npm', ...buildNpmUpdateArgs(scope)].join(' ');
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

function getNpmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function updateCometNpmPackage(
  scope: InstallScope,
  projectPath: string,
  log: (message: string) => void,
  jsonMode = false,
): Promise<{ success: boolean; exitCode: number | null; reason?: string }> {
  const args = buildNpmUpdateArgs(scope);
  const cwd = scope === 'global' ? process.cwd() : projectPath;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { success: boolean; exitCode: number | null; reason?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(getNpmExecutable(), args, {
      cwd,
      stdio: jsonMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: true,
    });
    if (jsonMode) {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on('error', (err) => {
      log(`  npm package: failed to launch npm — ${err.message}`);
      finish({ success: false, exitCode: null, reason: `failed to launch npm: ${err.message}` });
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        const captured = (stderr.trim() || stdout.trim()).slice(-4000);
        const reason = captured || `npm exited with code ${code ?? 'unknown'}`;
        log(`  npm package: update failed (exit code ${code ?? 'unknown'}): ${reason}`);
        finish({ success: false, exitCode: code, reason });
        return;
      }
      finish({ success: true, exitCode: code });
    });
  });
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
  let npmReason: string | undefined;
  const skipRepeatedGlobalNpm =
    !options.skipNpm && packageScope === 'global' && options.skipGlobalNpmUpdate === true;
  if (skipRepeatedGlobalNpm) {
    log(`  ${t(lang, 'updatingNpmPackage')}: skipped (global scope already attempted)`);
  } else if (!options.skipNpm) {
    log(`  ${t(lang, 'updatingNpmPackage')} (${packageScope} scope)...`);
    log(`    $ ${formatNpmUpdateCommand(packageScope)}`);
    const npmResult = await updateCometNpmPackage(
      packageScope,
      projectPath,
      log,
      options.json === true,
    );
    npmExitCode = npmResult.exitCode;
    npmReason = npmResult.reason;
    if (npmResult.success) {
      npmStatus = 'updated';
      log(`  ${t(lang, 'npmPackageUpdated')} ${PACKAGE_NAME}`);
    } else {
      npmStatus = 'failed';
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
        scope: options.skipNpm ? 'skipped' : packageScope,
        status: npmStatus,
        command:
          options.skipNpm || skipRepeatedGlobalNpm ? null : formatNpmUpdateCommand(packageScope),
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

  log(
    `\n  ${t(lang, 'copyingSkillsFiles')} ${(await getManifestSkills()).length} skill files...\n`,
  );

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
    if (nativeProjectTarget) {
      await prepareManagedSkillCopyTarget(baseDir, target.platform, target.scope);
    }
    const { copied, skipped, failed } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      targetInstallMode,
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
    if (scope === 'project' && nativeProject) continue;
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
      scope: options.skipNpm ? 'skipped' : packageScope,
      status: npmStatus,
      command:
        options.skipNpm || skipRepeatedGlobalNpm ? null : formatNpmUpdateCommand(packageScope),
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
};
export type { InstalledCometTarget, SkillLanguage, TranslationKey };
