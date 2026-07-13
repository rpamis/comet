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
import type { InstallScope, InstallMode } from '../../platform/install/types.js';
import { printVersionInfo } from '../../platform/version/version.js';
import { t, type TranslationKey } from './i18n.js';
import { assertProjectScopeOptions, resolveProjectScopeMode } from './project-scope-selection.js';

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

function createNpmUpdateFailure(scope: InstallScope): NpmUpdateFailure {
  const error = new Error(`npm package update failed (${scope} scope)`) as NpmUpdateFailure;
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

interface AllProjectsUpdateResult {
  projectPath: string;
  status: 'updated' | 'skipped' | 'failed';
  reason?: string;
  targets: Array<{
    scope: InstallScope;
    platform: string;
    platformName: string;
    language: SkillLanguage;
  }>;
  failures?: ComponentFailureDetail[];
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
): Promise<boolean> {
  const args = buildNpmUpdateArgs(scope);
  const cwd = scope === 'global' ? process.cwd() : projectPath;

  return new Promise((resolve) => {
    // In JSON mode, discard npm's stdout/stderr so it cannot corrupt the JSON
    // document emitted on stdout. 'ignore' avoids the pipe backpressure a
    // verbose npm install could otherwise cause.
    const child = spawn(getNpmExecutable(), args, {
      cwd,
      stdio: jsonMode ? 'ignore' : 'inherit',
      shell: true,
    });
    child.on('error', (err) => {
      log(`  npm package: failed to launch npm — ${err.message}`);
      resolve(false);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        log(
          `  npm package: update failed (exit code ${code}). Unable to reach the official npm registry at ${OFFICIAL_REGISTRY}.`,
        );
        log(`  Check your network connection or firewall settings and try again.`);
      }
      resolve(code === 0);
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
    status: hasComponentFailures(result) ? 'incomplete' : 'complete',
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

function componentFailureReason(result: SingleProjectUpdateResult): string {
  const reasons: string[] = [];
  if (result.skills.totalFailed > 0) {
    reasons.push(`Skill update failed (${result.skills.totalFailed})`);
  }
  if (result.rules.totalFailed > 0) {
    reasons.push(`Rule update failed (${result.rules.totalFailed})`);
  }
  if (result.hooks.totalFailed > 0) {
    reasons.push(`Hook update failed (${result.hooks.totalFailed})`);
  }
  if (result.skills.cleanupFailed > 0) {
    reasons.push(`legacy Skill cleanup failed (${result.skills.cleanupFailed})`);
  }
  return reasons.join('; ');
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
  projectPath: string,
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<SingleProjectUpdateResult> {
  const lang = options.language ?? 'en';
  const packageScope =
    options.scope && !options.targetScopes
      ? options.scope
      : await detectCometPackageScope(projectPath);
  let npmStatus: NpmStatus = 'skipped';
  const skipRepeatedGlobalNpm =
    !options.skipNpm && packageScope === 'global' && options.skipGlobalNpmUpdate === true;
  if (skipRepeatedGlobalNpm) {
    log(`  ${t(lang, 'updatingNpmPackage')}: skipped (global scope already attempted)`);
  } else if (!options.skipNpm) {
    log(`  ${t(lang, 'updatingNpmPackage')} (${packageScope} scope)...`);
    log(`    $ ${formatNpmUpdateCommand(packageScope)}`);
    const npmUpdated = await updateCometNpmPackage(
      packageScope,
      projectPath,
      log,
      options.json === true,
    );
    if (npmUpdated) {
      npmStatus = 'updated';
      log(`  ${t(lang, 'npmPackageUpdated')} ${PACKAGE_NAME}`);
    } else {
      npmStatus = 'failed';
      log(
        `  ${t(lang, options.failOnNpmFailure ? 'npmPackageFailedBlocking' : 'npmPackageFailed')}`,
      );
      if (options.failOnNpmFailure) {
        throw createNpmUpdateFailure(packageScope);
      }
    }
  }

  const installMode = await selectInstallMode(options, lang);

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
      },
      skills: { totalCopied: 0, totalFailed: 0, cleanupFailed: 0, targets: [] },
      rules: { totalCopied: 0, totalFailed: 0, targets: [] },
      hooks: { totalInstalled: 0, totalFailed: 0, targets: [] },
      projectInstructions: { updated: 0 },
      codegraph: 'skipped',
    };
  }

  log(`\n  ${t(lang, 'updatingSkillsOnTargets')} ${targets.length} target(s):`);
  for (const target of targets) {
    const language = options.language ?? target.language;
    const scopeLabel = target.scope === 'global' ? 'global' : `project (${projectPath})`;
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    log(`    - ${target.platform.name} (${scopeLabel}, ${language})`);
    log(
      `      $ ${formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir, installMode)}`,
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
    const { copied, skipped, failed } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      installMode,
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
        installMode,
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
      const { status, reason } = await installCometHooksForPlatform(
        baseDir,
        target.platform,
        target.scope,
      );
      const hookFailed = status === 'failed' ? 1 : 0;
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
    },
    skills: {
      totalCopied,
      totalFailed,
      cleanupFailed: totalCleanupFailed,
      installMode,
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
  if (hasComponentFailures(result)) {
    log(`\n  Update incomplete. ${componentFailureReason(result)}.\n`);
  } else {
    log(`\n  ${t(lang, 'updateComplete')}\n`);
  }
}

async function updateAllIndexedProjects(
  registryProjects: ProjectRegistryEntry[],
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<void> {
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
        status: 'skipped',
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
      return;
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
  for (const project of runnableProjects) {
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

      if (hasComponentFailures(result)) {
        results.push({
          projectPath,
          status: 'failed',
          reason: componentFailureReason(result),
          targets: summarizeUpdatedTargets(result.skills.targets),
          failures: collectComponentFailures(result),
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
      results.push({
        projectPath,
        status: 'failed',
        reason: (error as Error).message,
        targets: summarizeTargets(targets),
      });
      if (isGlobalNpmUpdateFailure(error)) break;
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'all-projects',
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
    return;
  }

  log(
    `\n  Updated ${results.filter((result) => result.status === 'updated').length} indexed project(s).`,
  );
}

export async function updateCommand(
  targetPath: string,
  options: UpdateOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;
  const lang = options.language ?? 'en';

  assertProjectScopeOptions(options);
  const registryProjects = await listProjectRegistryEntries({
    strict: options.allProjects === true,
  });

  log(`\n  ${t(lang, 'updateTitle')}`);
  if (!options.json) {
    await printVersionInfo(log);
  }
  log('');

  const scopeMode = await resolveProjectScopeMode('update', options, registryProjects.length);
  if (scopeMode === 'all-projects') {
    await updateAllIndexedProjects(registryProjects, options, log);
    return;
  }

  const result = await updateSingleProject(projectPath, options, log);
  if (result.skills.targets.length === 0) {
    if (options.json) {
      console.log(JSON.stringify(currentProjectJson(result), null, 2));
      return;
    }
    log(`\n  ${t(lang, 'noInstallsFound')}\n`);
    return;
  }

  if (!hasComponentFailures(result)) {
    await upsertUpdatedProjectTargets(projectPath, result);
  }

  if (options.json) {
    console.log(JSON.stringify(currentProjectJson(result), null, 2));
    return;
  }

  logSingleProjectSummary(result, options, log);
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
