import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { select } from '@inquirer/prompts';
import { fileExists, readDir, readJson } from '../utils/file-system.js';
import { getBaseDir } from '../core/detect.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  getManifestSkills,
} from '../core/skills.js';
import { PLATFORMS, getPlatformSkillsDir, type Platform } from '../core/platforms.js';
import { installCodegraph, filterSupportedPlatforms } from '../core/codegraph.js';
import type { InstallScope } from '../core/types.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');
const PACKAGE_NAME = '@rpamis/comet';

interface UpdateOptions {
  json?: boolean;
  language?: string;
  scope?: InstallScope;
  skipNpm?: boolean;
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

function languageToSkillsDir(language: string | undefined, fallback: SkillLanguage): string {
  return (language ?? fallback) === 'zh' ? 'skills-zh' : 'skills';
}

function getScopedBaseDir(
  scope: InstallScope,
  projectPath: string,
  globalBaseDir = os.homedir(),
): string {
  return scope === 'global' ? globalBaseDir : projectPath;
}

async function hasLocalCometSkills(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  const skillsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  if (!(await fileExists(skillsDir))) return false;

  const entries = await readDir(skillsDir);
  return entries.some((entry) => entry.startsWith('comet'));
}

async function detectInstalledCometLanguage(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<SkillLanguage> {
  const skillsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  if (!(await fileExists(skillsDir))) return 'en';

  const entries = (await readDir(skillsDir)).filter((entry) => entry.startsWith('comet'));

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry, 'SKILL.md');
    if (!(await fileExists(skillPath))) continue;

    try {
      const content = await fs.readFile(skillPath, 'utf-8');
      if (/[\u3400-\u9fff]/u.test(content)) return 'zh';
    } catch {
      // Fall through to the default English asset set if the file cannot be read.
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
    ? ['install', '-g', `${PACKAGE_NAME}@latest`]
    : ['install', `${PACKAGE_NAME}@latest`];
}

function formatNpmUpdateCommand(scope: InstallScope): string {
  return ['npm', ...buildNpmUpdateArgs(scope)].join(' ');
}

function formatSkillUpdateCommand(
  scope: InstallScope,
  platform: Platform,
  languageSkillsDir: string,
): string {
  const destPrefix = scope === 'global' ? '~/' : '';
  return `copy assets/${languageSkillsDir} -> ${destPrefix}${getPlatformSkillsDir(platform, scope)}/skills/ (${scope})`;
}

function getNpmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function updateCometNpmPackage(scope: InstallScope, projectPath: string): Promise<boolean> {
  const args = buildNpmUpdateArgs(scope);
  const cwd = scope === 'global' ? process.cwd() : projectPath;

  return new Promise((resolve) => {
    const child = spawn(getNpmExecutable(), args, { cwd, stdio: 'inherit', shell: true });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

export async function updateCommand(
  targetPath: string,
  options: UpdateOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  log(`\n  Comet Update v${version}\n`);

  const packageScope = options.scope ?? (await detectCometPackageScope(projectPath));
  let npmStatus: 'updated' | 'failed' | 'skipped' = 'skipped';
  if (!options.skipNpm) {
    log(`  Updating npm package (${packageScope} scope)...`);
    log(`    $ ${formatNpmUpdateCommand(packageScope)}`);
    const npmUpdated = await updateCometNpmPackage(packageScope, projectPath);
    if (npmUpdated) {
      npmStatus = 'updated';
      log(`  npm package: updated to latest ${PACKAGE_NAME}`);
    } else {
      npmStatus = 'failed';
      log(`  npm package: update failed, continuing with bundled skills`);
    }
  }

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
          },
          null,
          2,
        ),
      );
      return;
    }
    log('\n  No platforms with comet skills installed. Run `comet init` first.\n');
    return;
  }

  log(`\n  Updating comet skills on ${targets.length} installed target(s):`);
  for (const target of targets) {
    const language = options.language ?? target.language;
    const scopeLabel = target.scope === 'global' ? 'global' : `project (${projectPath})`;
    const languageSkillsDir = languageToSkillsDir(options.language, target.language);
    log(`    - ${target.platform.name} (${scopeLabel}, ${language})`);
    log(`      $ ${formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir)}`);
  }

  // Copy skills for each platform (overwrite)
  log(`\n  Copying ${(await getManifestSkills()).length} skill files...\n`);

  let totalCopied = 0;
  let totalRulesCopied = 0;
  let totalHooksInstalled = 0;
  const targetResults = [];
  for (const target of targets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const languageSkillsDir = languageToSkillsDir(options.language, target.language);
    const { copied, skipped } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
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
      command: formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir),
    });
    log(
      `  ${target.platform.name} (${target.scope}, ${languageSkillsDir}): ${copied} copied, ${skipped} skipped`,
    );

    // Distribute anti-drift rules to platforms that support them
    try {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        target.platform,
        true,
        target.scope,
      );
      totalRulesCopied += ruleCopied;
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${target.platform.name}: ${ruleCopied} rule(s) updated`);
      }
    } catch (err) {
      log(`  Comet rules -> ${target.platform.name}: failed (${(err as Error).message})`);
    }

    // Install hooks for platforms that support them
    if (target.platform.supportsHooks) {
      try {
        const { installed, reason } = await installCometHooksForPlatform(
          baseDir,
          target.platform,
          target.scope,
        );
        if (installed) {
          totalHooksInstalled++;
          log(`  Comet hooks -> ${target.platform.name}: phase guard hook updated`);
        } else if (reason) {
          log(`  Comet hooks -> ${target.platform.name}: skipped (${reason})`);
        }
      } catch (err) {
        log(`  Comet hooks -> ${target.platform.name}: failed (${(err as Error).message})`);
      }
    }
  }

  // CodeGraph optional step
  let codegraphStatus: 'installed' | 'failed' | 'skipped' = 'skipped';
  const detectedPlatformIds = [...new Set(targets.map((t) => t.platform.id))];
  const { supported: cgSupported } = filterSupportedPlatforms(detectedPlatformIds);
  const primaryScope = targets[0]?.scope ?? 'project';

  if (cgSupported.length > 0 && !options.json) {
    const shouldInstallCodegraph = await select({
      message: 'Install/update CodeGraph for semantic code intelligence?',
      choices: [
        { name: 'Yes (recommended — saves ~16% cost · cuts ~58% tool calls)', value: true },
        { name: 'No', value: false },
      ],
    });

    if (shouldInstallCodegraph) {
      log('\n  Installing CodeGraph...');
      codegraphStatus = await installCodegraph(projectPath, detectedPlatformIds, primaryScope);
      log(`  CodeGraph: ${codegraphStatus}`);
    } else {
      log('\n  CodeGraph: skipped');
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
  log(`\n  Summary:`);
  log(`    npm: ${npmStatus}${options.skipNpm ? '' : ` (${packageScope})`}`);
  log(`    skills: ${targets.length} target(s), ${totalCopied} files updated`);
  log(`    codegraph: ${codegraphStatus}`);
  log(`    scope: ${scopes}`);
  log(`    language: ${languages}`);
  log(`\n  Update complete.\n`);
}

export {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
};
export type { InstalledCometTarget, SkillLanguage };
