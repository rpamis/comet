import path from 'path';
import os from 'os';
import { checkbox, select } from '@inquirer/prompts';
import { PLATFORMS, getPlatformSkillsDir, type Platform } from '../core/platforms.js';
import { detectPlatforms, hasSkills, getBaseDir, type InstallScope } from '../core/detect.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  createWorkingDirs,
  type LanguageConfig,
} from '../core/skills.js';
import { installOpenSpec } from '../core/openspec.js';
import { installSuperpowersForPlatforms } from '../core/superpowers.js';
import { installCodegraph, filterSupportedPlatforms } from '../core/codegraph.js';

type InitOptions = {
  yes?: boolean;
  skipExisting?: boolean;
  overwrite?: boolean;
  json?: boolean;
  scope?: InstallScope;
};

type InstallStatus = 'installed' | 'skipped' | 'failed';
type ComponentAction = 'overwrite' | 'skip' | 'install';
type BulkOverwriteChoice = 'overwrite-all' | 'skip-all' | 'choose';

interface PlatformResult {
  platform: Platform;
  openspec: InstallStatus;
  superpowers: InstallStatus;
  comet: InstallStatus;
  codegraph: InstallStatus;
}

type ComponentPlan = {
  osAction: ComponentAction;
  spAction: ComponentAction;
  cmAction: ComponentAction;
};

const LANGUAGES: LanguageConfig[] = [
  { id: 'en', name: 'English', skillsDir: 'skills' },
  { id: 'zh', name: '中文', skillsDir: 'skills-zh' },
];

const COMET_BANNER = [
  `   ██████╗ ██████╗ ███╗   ███╗███████╗████████╗`,
  `  ██╔════╝██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝`,
  `  ██║     ██║   ██║██╔████╔██║█████╗     ██║   `,
  `  ██║     ██║   ██║██║╚██╔╝██║██╔══╝     ██║   `,
  `  ╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗   ██║   `,
  `   ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝   `,
  `            OpenSpec + Superpowers Workflow       `,
].join('\n');

async function selectScope(options: InitOptions): Promise<InstallScope> {
  if (options.scope) return options.scope;
  if (options.yes) return 'project';

  return select({
    message: 'Install scope:',
    choices: [
      { name: 'Project (current directory)', value: 'project' as const },
      { name: 'Global (home directory)', value: 'global' as const },
    ],
  });
}

async function selectLanguage(options: InitOptions): Promise<LanguageConfig> {
  if (options.yes) return LANGUAGES[0];

  const langId = await select({
    message: 'Language for Comet skills:',
    choices: LANGUAGES.map((lang) => ({ name: lang.name, value: lang.id })),
  });

  return LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0];
}

async function selectPlatforms(detected: Set<string>, options: InitOptions): Promise<string[]> {
  const choices = PLATFORMS.map((p) => ({
    name: `${p.name}${detected.has(p.id) ? ' (detected)' : ''}`,
    value: p.id,
    checked: detected.has(p.id),
  }));

  if (options.yes) {
    const selected = [...detected];
    return selected.length > 0 ? selected : PLATFORMS.map((p) => p.id);
  }

  return checkbox({ message: 'Select platforms to set up:', choices, required: true });
}

async function promptOverwriteChoice(
  componentName: string,
  platformName: string,
): Promise<'overwrite' | 'skip'> {
  return select({
    message: `${componentName} already installed on ${platformName}. What to do?`,
    choices: [
      { name: 'Overwrite', value: 'overwrite' as const },
      { name: 'Skip', value: 'skip' as const },
    ],
  });
}

async function promptBulkOverwriteChoice(
  platformName: string,
  components: string[],
): Promise<BulkOverwriteChoice> {
  return select({
    message: `${platformName} already has ${components.join(', ')} installed. What to do?`,
    choices: [
      { name: 'Overwrite all existing components', value: 'overwrite-all' as const },
      { name: 'Skip all existing components', value: 'skip-all' as const },
      { name: 'Choose per component', value: 'choose' as const },
    ],
  });
}

function applyBulkOverwriteChoice<T extends ComponentPlan>(
  plan: T,
  choice: Exclude<BulkOverwriteChoice, 'choose'>,
  hasExisting?: { os?: boolean; sp?: boolean; cm?: boolean },
): T {
  const action = choice === 'overwrite-all' ? 'overwrite' : 'skip';
  const shouldApply = (actionState: ComponentAction, exists?: boolean) =>
    actionState === 'install' && (hasExisting === undefined || exists === true);
  return {
    ...plan,
    osAction: shouldApply(plan.osAction, hasExisting?.os) ? action : plan.osAction,
    spAction: shouldApply(plan.spAction, hasExisting?.sp) ? action : plan.spAction,
    cmAction: shouldApply(plan.cmAction, hasExisting?.cm) ? action : plan.cmAction,
  };
}

function resolveAction(
  hasExisting: boolean,
  options: InitOptions,
): 'overwrite' | 'skip' | 'install' {
  if (!hasExisting) return 'install';
  if (options.overwrite) return 'overwrite';
  if (options.skipExisting) return 'skip';
  if (options.yes) return 'skip';
  return 'install';
}

function displaySummary(results: PlatformResult[], scope: InstallScope): void {
  const scopeLabel = scope === 'global' ? os.homedir() : 'project';

  console.log(`\n  Comet setup complete! (scope: ${scopeLabel})\n`);

  const installed = results.filter(
    (r) =>
      r.openspec === 'installed' ||
      r.superpowers === 'installed' ||
      r.comet === 'installed' ||
      r.codegraph === 'installed',
  );
  const skipped = results.filter(
    (r) =>
      r.openspec === 'skipped' &&
      r.superpowers === 'skipped' &&
      r.comet === 'skipped' &&
      r.codegraph === 'skipped',
  );
  const failed = results.filter(
    (r) =>
      r.openspec === 'failed' ||
      r.superpowers === 'failed' ||
      r.comet === 'failed' ||
      r.codegraph === 'failed',
  );

  if (installed.length > 0) {
    console.log(`  Installed:`);
    for (const r of installed) {
      console.log(`    ${r.platform.name} -> ${getPlatformSkillsDir(r.platform, scope)}/skills/`);
    }
  }
  if (skipped.length > 0) {
    console.log(`  Skipped: ${skipped.map((r) => r.platform.name).join(', ')}`);
  }
  if (failed.length > 0) {
    console.log(`  Failed: ${failed.map((r) => r.platform.name).join(', ')}`);
  }

  if (scope === 'project') {
    console.log(`\n  Working directories: docs/superpowers/specs/, docs/superpowers/plans/`);
  }

  console.log(`\n  Get started:`);
  console.log(`    /comet "your idea"  — Start a new change with full workflow`);
  console.log(`    /comet-hotfix       — Quick bug fix (skip brainstorming)`);
  console.log(`    /comet-tweak        — Small change (skip brainstorming and plan)\n`);
}

export async function initCommand(targetPath: string, options: InitOptions = {}): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  log(`\n${COMET_BANNER}\n`);
  log(`  Setting up Comet in ${projectPath}\n`);

  const detected = await detectPlatforms(projectPath);
  const scope = await selectScope(options);
  const language = await selectLanguage(options);
  log(`  Language: ${language.name}`);

  const selectedPlatformIds = await selectPlatforms(detected, options);
  if (selectedPlatformIds.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            projectPath,
            scope,
            language: language.id,
            selectedPlatforms: [],
            results: [],
          },
          null,
          2,
        ),
      );
      return;
    }
    log('\n  No platforms selected. Exiting.\n');
    return;
  }

  const selectedPlatforms = PLATFORMS.filter((p) => selectedPlatformIds.includes(p.id));
  const baseDir = getBaseDir(scope, projectPath);

  type PlatformPlan = ComponentPlan & {
    platform: Platform;
    hasOS: boolean;
    hasSP: boolean;
    hasCM: boolean;
  };

  const plans: PlatformPlan[] = [];

  for (const platform of selectedPlatforms) {
    const hasOS = await hasSkills(baseDir, platform, 'openspec', selectedPlatforms, scope);
    const hasSP = await hasSkills(baseDir, platform, 'superpowers', selectedPlatforms, scope);
    const hasCM = await hasSkills(baseDir, platform, 'comet', selectedPlatforms, scope);

    let osAction = resolveAction(hasOS, options);
    let spAction = resolveAction(hasSP, options);
    let cmAction = resolveAction(hasCM, options);

    if (!options.yes) {
      const existingComponents = [
        hasOS && osAction === 'install' ? 'OpenSpec' : null,
        hasSP && spAction === 'install' ? 'Superpowers' : null,
        hasCM && cmAction === 'install' ? 'Comet' : null,
      ].filter((component): component is string => Boolean(component));

      if (existingComponents.length > 1) {
        const bulkChoice = await promptBulkOverwriteChoice(platform.name, existingComponents);
        if (bulkChoice !== 'choose') {
          ({ osAction, spAction, cmAction } = applyBulkOverwriteChoice(
            { osAction, spAction, cmAction },
            bulkChoice,
            { os: hasOS, sp: hasSP, cm: hasCM },
          ));
        }
      }

      if (osAction === 'install' && hasOS) {
        osAction = await promptOverwriteChoice('OpenSpec', platform.name);
      }
      if (spAction === 'install' && hasSP) {
        spAction = await promptOverwriteChoice('Superpowers', platform.name);
      }
      if (cmAction === 'install' && hasCM) {
        cmAction = await promptOverwriteChoice('Comet', platform.name);
      }
    }

    plans.push({ platform, osAction, spAction, cmAction, hasOS, hasSP, hasCM });
  }

  const osToolIds = plans
    .filter((p) => p.osAction !== 'skip')
    .map((p) => p.platform.openspecToolId);

  let osGlobalStatus: InstallStatus = 'skipped';
  if (osToolIds.length > 0) {
    log(`\n  Installing OpenSpec for: ${osToolIds.join(', ')}`);
    osGlobalStatus = await installOpenSpec(projectPath, osToolIds, scope);
    log(`  OpenSpec: ${osGlobalStatus}`);
  } else {
    log(`\n  OpenSpec: all skipped`);
  }

  const spPlatformIds = plans.filter((p) => p.spAction !== 'skip').map((p) => p.platform.id);
  let spGlobalStatus: InstallStatus = 'skipped';

  if (spPlatformIds.length > 0) {
    log(`\n  Installing Superpowers for: ${spPlatformIds.join(', ')}`);
    spGlobalStatus = await installSuperpowersForPlatforms(projectPath, scope, spPlatformIds);
    log(`  Superpowers: ${spGlobalStatus}`);
  } else {
    log(`\n  Superpowers: all skipped`);
  }

  const results: PlatformResult[] = [];

  for (const plan of plans) {
    const { platform, cmAction } = plan;
    const platformSkillsDir = getPlatformSkillsDir(platform, scope);
    const skillsPath = `${scope === 'global' ? '~/' : ''}${platformSkillsDir}/skills/`;

    let cmStatus: InstallStatus = 'skipped';
    if (cmAction !== 'skip') {
      const { copied } = await copyCometSkillsForPlatform(
        baseDir,
        platform,
        cmAction === 'overwrite',
        language.skillsDir,
        scope,
      );
      cmStatus = copied > 0 ? 'installed' : 'skipped';
      log(`  Comet -> ${platform.name}: ${cmStatus} (${copied} files) -> ${skillsPath}`);
    } else {
      log(`  Comet -> ${platform.name}: skipped (already exists)`);
    }

    // Distribute anti-drift rules to platforms that support them
    if (cmAction !== 'skip') {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        platform,
        cmAction === 'overwrite',
        scope,
      );
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${platform.name}: ${ruleCopied} rule(s) installed`);
      }
    }

    // Install hooks for platforms that support them
    if (cmAction !== 'skip' && platform.supportsHooks) {
      const { installed, reason } = await installCometHooksForPlatform(baseDir, platform, scope);
      if (installed) {
        log(`  Comet hooks -> ${platform.name}: phase guard hook installed`);
      } else if (reason) {
        log(`  Comet hooks -> ${platform.name}: skipped (${reason})`);
      }
    }

    results.push({
      platform,
      openspec: osToolIds.includes(platform.openspecToolId) ? osGlobalStatus : 'skipped',
      superpowers: plan.spAction !== 'skip' ? spGlobalStatus : 'skipped',
      comet: cmStatus,
      codegraph: 'skipped',
    });
  }

  let cgGlobalStatus: InstallStatus;
  const { supported: cgSupported } = filterSupportedPlatforms(selectedPlatformIds);
  const shouldInstallCodegraph =
    cgSupported.length > 0 &&
    !options.json &&
    (options.yes ||
      (await select({
        message: 'Install CodeGraph for semantic code intelligence?',
        choices: [
          { name: 'Yes (recommended — saves ~16% cost · cuts ~58% tool calls)', value: true },
          { name: 'No', value: false },
        ],
      })));

  if (shouldInstallCodegraph) {
    log('\n  Installing CodeGraph...');
    cgGlobalStatus = await installCodegraph(projectPath, selectedPlatformIds, scope);
    log(`  CodeGraph: ${cgGlobalStatus}`);
    for (const r of results) {
      if (filterSupportedPlatforms([r.platform.id]).supported.length > 0) {
        r.codegraph = cgGlobalStatus;
      }
    }
  } else {
    log('\n  CodeGraph: skipped');
  }

  if (scope === 'project') {
    await createWorkingDirs(projectPath);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          projectPath,
          scope,
          language: language.id,
          selectedPlatforms: selectedPlatformIds,
          results: results.map((result) => ({
            platform: result.platform.id,
            platformName: result.platform.name,
            openspec: result.openspec,
            superpowers: result.superpowers,
            comet: result.comet,
            codegraph: result.codegraph,
          })),
          workingDirsCreated: scope === 'project',
        },
        null,
        2,
      ),
    );
    return;
  }

  displaySummary(results, scope);
}

export { applyBulkOverwriteChoice };
