import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { select } from '@inquirer/prompts';
import { fileExists, readDir, readJson } from '../../platform/fs/file-system.js';
import { getBaseDir } from '../../platform/install/detect.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  getManifestSkills,
  mergeProjectConfig,
} from '../../domains/skill/platform-install.js';
import {
  PLATFORMS,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import {
  hasCodegraphProjectIndex,
  installCodegraph,
} from '../../domains/integrations/codegraph.js';
import type { InstallScope, InstallMode } from '../../platform/install/types.js';
import { printVersionInfo } from '../../platform/version/version.js';
import { t, type TranslationKey } from './i18n.js';

const PACKAGE_NAME = '@rpamis/comet';
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

interface UpdateOptions {
  json?: boolean;
  language?: string;
  scope?: InstallScope;
  skipNpm?: boolean;
  installMode?: InstallMode;
}

type SkillLanguage = 'en' | 'zh';

interface InstalledCometTarget {
  scope: InstallScope;
  platform: Platform;
  language: SkillLanguage;
}

interface DetectTargetsOptions {
  scopes?: InstallScope[];
  globalBaseDir?: string;
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
  const dirs = [path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills')];
  if (scope === 'global' && platform.id === 'pi') {
    dirs.push(path.join(baseDir, platform.skillsDir, 'skills'));
  }
  return [...new Set(dirs)];
}

async function hasLocalCometSkills(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  for (const skillsDir of getInstalledCometSkillsDirs(baseDir, platform, scope)) {
    if (!(await fileExists(skillsDir))) continue;
    const entries = await readDir(skillsDir);
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
    if (!(await fileExists(skillsDir))) continue;
    const entries = (await readDir(skillsDir)).filter((entry) => entry.startsWith('comet'));

    for (const entry of entries) {
      const skillPath = path.join(skillsDir, entry, 'SKILL.md');
      if (!(await fileExists(skillPath))) continue;

      try {
        const content = await fs.readFile(skillPath, 'utf-8');
        if (/[㐀-鿿]/u.test(content)) return 'zh';
      } catch {
        // Fall through to the default English asset set if the file cannot be read.
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

    for (const platform of PLATFORMS) {
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
    return `symlink .comet/skills/ -> ${destPrefix}${getPlatformSkillsDir(platform, scope)}/skills/ (${scope})`;
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

export async function updateCommand(
  targetPath: string,
  options: UpdateOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  const lang = options.language ?? 'en';

  log(`\n  ${t(lang, 'updateTitle')}`);
  if (!options.json) {
    await printVersionInfo(log);
  }
  log('');

  const packageScope = options.scope ?? (await detectCometPackageScope(projectPath));
  let npmStatus: 'updated' | 'failed' | 'skipped' = 'skipped';
  if (!options.skipNpm) {
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
      log(`  ${t(lang, 'npmPackageFailed')}`);
    }
  }

  const installMode = await selectInstallMode(options, lang);

  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            npm: {
              scope: options.skipNpm ? 'skipped' : packageScope,
              status: npmStatus,
              command: options.skipNpm ? null : formatNpmUpdateCommand(packageScope),
            },
            skills: { totalCopied: 0, targets: [] },
            rules: { totalCopied: 0 },
            hooks: { totalInstalled: 0 },
            codegraph: 'skipped',
          },
          null,
          2,
        ),
      );
      return;
    }
    log(`\n  ${t(lang, 'noInstallsFound')}\n`);
    return;
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
  let totalRulesCopied = 0;
  let totalHooksInstalled = 0;
  const targetResults = [];
  for (const target of targets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    const { copied, skipped } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      installMode,
    );
    totalCopied += copied;
    targetResults.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      language: options.language ?? target.language,
      source: languageSkillsDir,
      copied,
      skipped,
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

    try {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        target.platform,
        true,
        languageId,
        target.scope,
      );
      totalRulesCopied += ruleCopied;
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${target.platform.name}: ${ruleCopied} ${t(lang, 'rulesUpdated')}`);
      }
    } catch (err) {
      log(
        `  Comet rules -> ${target.platform.name}: ${t(lang, 'rulesFailed')} (${(err as Error).message})`,
      );
    }

    if (target.platform.supportsHooks) {
      try {
        const { installed, reason } = await installCometHooksForPlatform(
          baseDir,
          target.platform,
          target.scope,
        );
        if (installed) {
          totalHooksInstalled++;
          log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksUpdated')}`);
        } else if (reason) {
          log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksSkipped')} (${reason})`);
        }
      } catch (err) {
        log(
          `  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksFailed')} (${(err as Error).message})`,
        );
      }
    }
  }

  const hasProjectTargets = targets.some((target) => target.scope === 'project');
  if (hasProjectTargets) {
    await mergeProjectConfig(projectPath);
    log(`  ${t(lang, 'configMerged')}`);
  }

  let codegraphStatus: 'installed' | 'failed' | 'skipped' = 'skipped';
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

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          npm: {
            scope: options.skipNpm ? 'skipped' : packageScope,
            status: npmStatus,
            command: options.skipNpm ? null : formatNpmUpdateCommand(packageScope),
          },
          skills: {
            totalCopied,
            installMode,
            targets: targetResults,
          },
          rules: { totalCopied: totalRulesCopied },
          hooks: { totalInstalled: totalHooksInstalled },
          codegraph: codegraphStatus,
        },
        null,
        2,
      ),
    );
    return;
  }

  const languages = [...new Set(targetResults.map((target) => target.language))].join(', ');
  const scopes = [...new Set(targetResults.map((target) => target.scope))].join(', ');
  log(`\n  ${t(lang, 'summary')}`);
  log(`    ${t(lang, 'summaryNpm')} ${npmStatus}${options.skipNpm ? '' : ` (${packageScope})`}`);
  log(`    ${t(lang, 'summarySkills')} ${targets.length} target(s), ${totalCopied} files updated`);
  log(`    ${t(lang, 'summaryCodegraph')} ${codegraphStatus}`);
  log(`    ${t(lang, 'summaryScope')} ${scopes}`);
  log(`    ${t(lang, 'summaryLanguage')} ${languages}`);
  log(`\n  ${t(lang, 'updateComplete')}\n`);
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
