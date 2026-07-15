import path from 'path';
import os from 'os';
import { checkbox, select } from '@inquirer/prompts';
import { platformSelectPrompt } from './platform-select-prompt.js';
import {
  PLATFORMS,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import {
  detectPlatforms,
  hasSkills,
  getBaseDir,
  type InstallScope,
} from '../../platform/install/detect.js';
import { upsertProjectInstallation } from '../../platform/install/project-registry.js';
import type { InstallMode } from '../../platform/install/types.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  createWorkingDirs,
  mergeProjectConfig,
  prepareNativeSkillInstallTarget,
} from '../../domains/skill/platform-install.js';
import { installCometProjectInstructions } from '../../domains/skill/project-instructions.js';
import { LANGUAGES, type LanguageConfig } from '../../domains/skill/languages.js';
import { resolveInitWorkflow } from '../../domains/comet-entry/init-workflow.js';
import type { CometWorkflow } from '../../domains/comet-entry/types.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../domains/comet-native/native-paths.js';
import { installOpenSpec, isCommandAvailable } from '../../domains/integrations/openspec.js';
import { installSuperpowersForPlatforms } from '../../domains/integrations/superpowers.js';
import {
  hasCodegraphProjectIndex,
  installCodegraph,
  resolveCodegraphCommand,
} from '../../domains/integrations/codegraph.js';
import { printVersionInfo } from '../../platform/version/version.js';
import { printCometBanner } from '../cli/comet-banner.js';
import { t, type TranslationKey } from './i18n.js';
import { detectInstalledCometTargets } from './update.js';

type InitOptions = {
  yes?: boolean;
  skipExisting?: boolean;
  overwrite?: boolean;
  json?: boolean;
  scope?: InstallScope;
  language?: string;
  installMode?: InstallMode;
  workflow?: CometWorkflow;
  artifactRoot?: string;
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

async function selectScope(options: InitOptions, lang: string): Promise<InstallScope> {
  if (options.scope) return options.scope;
  if (options.yes) return 'project';

  return select({
    message: t(lang, 'installScope'),
    choices: [
      { name: t(lang, 'scopeProject'), value: 'project' as const },
      { name: t(lang, 'scopeGlobal'), value: 'global' as const },
    ],
  });
}

async function selectLanguage(options: InitOptions): Promise<LanguageConfig> {
  if (options.language) {
    return LANGUAGES.find((l) => l.id === options.language) ?? LANGUAGES[0];
  }
  if (options.yes) return LANGUAGES[0];

  const langId = await select({
    message: t('en', 'languagePrompt'),
    choices: LANGUAGES.map((lang) => ({ name: lang.name, value: lang.id })),
  });

  return LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0];
}

async function selectInstallMode(options: InitOptions, lang: string): Promise<InstallMode> {
  if (options.installMode) return options.installMode;
  if (options.yes) return 'copy';

  return select({
    message: t(lang, 'installMode'),
    choices: [
      { name: t(lang, 'installModeCopy'), value: 'copy' as const },
      { name: t(lang, 'installModeSymlink'), value: 'symlink' as const },
    ],
  });
}

async function selectPlatforms(
  detected: Set<string>,
  options: InitOptions,
  lang: string,
): Promise<string[]> {
  const choices = PLATFORMS.map((p) => ({
    name: `${p.name}${detected.has(p.id) ? ` (${t(lang, 'detected')})` : ''}`,
    summaryName: p.name,
    value: p.id,
    checked: detected.has(p.id),
  }));

  if (options.yes) {
    const selected = [...detected];
    return selected.length > 0 ? selected : PLATFORMS.map((p) => p.id);
  }

  return platformSelectPrompt({
    message: t(lang, 'selectPlatforms'),
    choices,
    selectedLabel: t(lang, 'selectedPlatforms'),
    emptyLabel: t(lang, 'noneSelected'),
    requiredErrorLabel: t(lang, 'selectPlatformsRequired'),
    required: true,
  });
}

async function promptOverwriteChoice(
  componentName: string,
  platformName: string,
  lang: string,
): Promise<'overwrite' | 'skip'> {
  return select({
    message: `${componentName} ${t(lang, 'alreadyExists')} ${platformName}. ${t(lang, 'overwriteChoice')}`,
    choices: [
      { name: t(lang, 'overwrite'), value: 'overwrite' as const },
      { name: t(lang, 'skip'), value: 'skip' as const },
    ],
  });
}

async function promptBulkOverwriteChoice(
  platformName: string,
  components: string[],
  lang: string,
): Promise<BulkOverwriteChoice> {
  return select({
    message: `${platformName} ${t(lang, 'bulkOverwrite')} ${components.join(', ')}. ${t(lang, 'overwriteChoice')}`,
    choices: [
      { name: t(lang, 'overwriteAll'), value: 'overwrite-all' as const },
      { name: t(lang, 'skipAll'), value: 'skip-all' as const },
      { name: t(lang, 'choosePer'), value: 'choose' as const },
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

type NpmDepId = 'openspec' | 'superpowers' | 'codegraph';

interface NpmDepState {
  id: NpmDepId;
  installed: boolean;
}

async function selectNpmDeps(
  projectPath: string,
  spPlatformIds: string[],
  options: InitOptions,
  lang: string,
  workflow: CometWorkflow,
): Promise<Set<NpmDepId>> {
  if (workflow === 'native') return new Set();

  const openSpecInstalled = isCommandAvailable('openspec');
  const codegraphInstalled =
    hasCodegraphProjectIndex(projectPath) || resolveCodegraphCommand() !== null;
  const superpowersInstalled = spPlatformIds.length === 0 ? true : undefined;

  const states: NpmDepState[] = [
    { id: 'openspec', installed: openSpecInstalled },
    { id: 'superpowers', installed: Boolean(superpowersInstalled) },
    { id: 'codegraph', installed: codegraphInstalled },
  ];

  const depLabel: Record<NpmDepId, (installed: boolean) => string> = {
    openspec: (installed) =>
      installed ? t(lang, 'npmDepOpenSpecInstalled') : t(lang, 'npmDepOpenSpec'),
    superpowers: (installed) =>
      installed ? t(lang, 'npmDepSuperpowersInstalled') : t(lang, 'npmDepSuperpowers'),
    codegraph: (installed) =>
      installed ? t(lang, 'npmDepCodegraphInstalled') : t(lang, 'npmDepCodegraph'),
  };

  const depHint: Partial<Record<NpmDepId, string>> = {
    superpowers: t(lang, 'npmDepSuperpowersHint'),
  };

  const choices = states.map(({ id, installed }) => {
    const choice: {
      name: string;
      value: NpmDepId;
      checked: boolean;
      description?: string;
    } = {
      name: depLabel[id](installed),
      value: id,
      checked: !installed,
    };
    if (depHint[id]) {
      choice.description = depHint[id];
    }
    return choice;
  });

  if (options.yes) {
    return new Set(states.filter((s) => !s.installed).map((s) => s.id));
  }

  const selected = await checkbox({
    message: t(lang, 'selectNpmDeps'),
    choices,
  });
  return new Set(selected as NpmDepId[]);
}

function hasFailure(r: PlatformResult): boolean {
  return (
    r.openspec === 'failed' ||
    r.superpowers === 'failed' ||
    r.comet === 'failed' ||
    r.codegraph === 'failed'
  );
}

function hasInstall(r: PlatformResult): boolean {
  return (
    r.openspec === 'installed' ||
    r.superpowers === 'installed' ||
    r.comet === 'installed' ||
    r.codegraph === 'installed'
  );
}

function isAllSkipped(r: PlatformResult): boolean {
  return (
    r.openspec === 'skipped' &&
    r.superpowers === 'skipped' &&
    r.comet === 'skipped' &&
    r.codegraph === 'skipped'
  );
}

function displaySummary(
  results: PlatformResult[],
  scope: InstallScope,
  lang: string,
  workflow: CometWorkflow,
): void {
  const scopeLabel = scope === 'global' ? os.homedir() : 'project';
  const componentStatuses: Array<[keyof Omit<PlatformResult, 'platform'>, string]> = [
    ['openspec', 'OpenSpec'],
    ['superpowers', 'Superpowers'],
    ['comet', 'Comet'],
    ['codegraph', 'CodeGraph'],
  ];
  const failedDetails = (result: PlatformResult) =>
    componentStatuses
      .filter(([key]) => result[key] === 'failed')
      .map(([, label]) => `${label} ${t(lang, 'failedStatus')}`)
      .join(', ');

  console.log(`\n  ${t(lang, 'setupComplete')} (scope: ${scopeLabel})\n`);

  // A platform with both installed and failed components is shown as failed,
  // not both. Use priority: failed > installed > skipped.
  const failed = results.filter(hasFailure);
  const installed = results.filter((r) => !hasFailure(r) && hasInstall(r));
  const skipped = results.filter(isAllSkipped);

  if (installed.length > 0) {
    console.log(`  ${t(lang, 'installed')}`);
    for (const r of installed) {
      console.log(`    ${r.platform.name} -> ${getPlatformSkillsDir(r.platform, scope)}/skills/`);
    }
  }
  if (skipped.length > 0) {
    console.log(`  ${t(lang, 'skippedLabel')} ${skipped.map((r) => r.platform.name).join(', ')}`);
  }
  if (failed.length > 0) {
    console.log(`  ${t(lang, 'failedLabel')}`);
    for (const r of failed) {
      console.log(`    ${r.platform.name} (${failedDetails(r)})`);
    }
  }

  if (scope === 'project') {
    console.log(`\n  ${t(lang, 'workingDirs')}`);
  }

  console.log(`\n  ${t(lang, 'getStarted')}`);
  console.log(`    ${t(lang, 'getStartedComet')}`);
  if (workflow === 'classic') {
    console.log(`    ${t(lang, 'getStartedHotfix')}`);
    console.log(`    ${t(lang, 'getStartedTweak')}`);
  }
  console.log();
}

export async function initCommand(targetPath: string, options: InitOptions = {}): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  await printCometBanner({ enabled: !options.json });
  if (!options.json) {
    await printVersionInfo(log);
  }

  const language = await selectLanguage(options);
  const lang = language.id;

  log(`  ${t(lang, 'settingUp')} ${projectPath}\n`);

  const detected = await detectPlatforms(projectPath);
  const scope = await selectScope(options, lang);
  if (
    scope === 'global' &&
    (options.workflow !== undefined || options.artifactRoot !== undefined)
  ) {
    throw new Error('--workflow and --root are only valid for project-scope initialization');
  }
  const workflowDecision =
    scope === 'project'
      ? await resolveInitWorkflow(projectPath, {
          workflow: options.workflow,
          artifactRoot: options.artifactRoot,
        })
      : null;
  const workflow: CometWorkflow = workflowDecision?.workflow ?? 'classic';
  const workflowSource = workflowDecision?.source ?? 'global-install';
  const installMode = workflow === 'native' ? 'copy' : await selectInstallMode(options, lang);

  const selectedPlatformIds = await selectPlatforms(detected, options, lang);
  if (selectedPlatformIds.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            projectPath,
            scope,
            language: language.id,
            workflow,
            workflowSource,
            projectConfigCreated: false,
            projectConfigUpdated: false,
            nativeArtifactRoot: null,
            selectedPlatforms: [],
            results: [],
            workingDirsCreated: false,
          },
          null,
          2,
        ),
      );
      return;
    }
    log(`\n  ${t(lang, 'noPlatforms')}\n`);
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
    const hasOS =
      workflow === 'classic'
        ? await hasSkills(baseDir, platform, 'openspec', selectedPlatforms, scope)
        : false;
    const hasSP =
      workflow === 'classic'
        ? await hasSkills(baseDir, platform, 'superpowers', selectedPlatforms, scope)
        : false;
    const hasCM = await hasSkills(baseDir, platform, 'comet', selectedPlatforms, scope, {
      includeGlobalFallback: false,
    });

    let osAction = workflow === 'classic' ? resolveAction(hasOS, options) : 'skip';
    let spAction = workflow === 'classic' ? resolveAction(hasSP, options) : 'skip';
    let cmAction = resolveAction(hasCM, options);
    if (hasCM && options.yes && !options.skipExisting && !options.overwrite) {
      cmAction = 'install';
    }

    if (!options.yes) {
      const existingComponents = [
        hasOS && osAction === 'install' ? 'OpenSpec' : null,
        hasSP && spAction === 'install' ? 'Superpowers' : null,
        hasCM && cmAction === 'install' ? 'Comet' : null,
      ].filter((component): component is string => Boolean(component));

      if (existingComponents.length > 1) {
        const bulkChoice = await promptBulkOverwriteChoice(platform.name, existingComponents, lang);
        if (bulkChoice !== 'choose') {
          ({ osAction, spAction, cmAction } = applyBulkOverwriteChoice(
            { osAction, spAction, cmAction },
            bulkChoice,
            { os: hasOS, sp: hasSP, cm: hasCM },
          ));
        }
      }

      if (osAction === 'install' && hasOS) {
        osAction = await promptOverwriteChoice('OpenSpec', platform.name, lang);
      }
      if (spAction === 'install' && hasSP) {
        spAction = await promptOverwriteChoice('Superpowers', platform.name, lang);
      }
      if (cmAction === 'install' && hasCM) {
        cmAction = await promptOverwriteChoice('Comet', platform.name, lang);
      }
    }

    plans.push({ platform, osAction, spAction, cmAction, hasOS, hasSP, hasCM });
  }

  if (workflow === 'native' && scope === 'project') {
    for (const plan of plans) {
      const action =
        plan.cmAction === 'overwrite' ? 'overwrite' : plan.cmAction === 'install' ? 'fill' : 'skip';
      await prepareNativeSkillInstallTarget(
        baseDir,
        plan.platform,
        scope,
        language.skillsDir,
        action,
      );
    }
  }

  const osToolIds = Array.from(
    new Set(plans.filter((p) => p.osAction !== 'skip').map((p) => p.platform.openspecToolId)),
  );

  const spPlatformIds = plans.filter((p) => p.spAction !== 'skip').map((p) => p.platform.id);

  // OpenCode-compatible platforms reuse the opencode OpenSpec tool id; mirror
  // the opencode output into their platform-specific config directories.
  const selectedPlatformIdsForOs = plans
    .filter((p) => p.osAction !== 'skip')
    .map((p) => p.platform.id);
  const mirrorOpenCodePlatformIds = selectedPlatformIdsForOs.filter((id) =>
    ['zcode', 'mimocode'].includes(id),
  );

  const selectedNpmDeps = await selectNpmDeps(projectPath, spPlatformIds, options, lang, workflow);
  const shouldInstallOpenSpecCli = selectedNpmDeps.has('openspec');
  const shouldInstallSuperpowers = selectedNpmDeps.has('superpowers');
  const shouldInstallCodegraphCli = selectedNpmDeps.has('codegraph');

  let osGlobalStatus: InstallStatus = 'skipped';
  if (osToolIds.length > 0) {
    log(`\n  ${t(lang, 'installingOS')} ${osToolIds.join(', ')}`);
    osGlobalStatus = await installOpenSpec(
      projectPath,
      osToolIds,
      scope,
      shouldInstallOpenSpecCli,
      mirrorOpenCodePlatformIds,
    );
    if (osGlobalStatus === 'skipped' && !shouldInstallOpenSpecCli) {
      log(`  OpenSpec: ${t(lang, 'osSkippedNoCli')}`);
    } else {
      log(`  OpenSpec: ${osGlobalStatus}`);
    }
  } else {
    log(`\n  OpenSpec: ${t(lang, 'allSkipped')}`);
  }

  let spGlobalStatus: InstallStatus = 'skipped';

  if (spPlatformIds.length > 0) {
    if (!shouldInstallSuperpowers) {
      log(`\n  Superpowers: ${t(lang, 'spSkippedByUser')}`);
    } else {
      log(`\n  ${t(lang, 'installingSP')} ${spPlatformIds.join(', ')}`);
      spGlobalStatus = await installSuperpowersForPlatforms(
        projectPath,
        scope,
        spPlatformIds,
        true,
      );
      log(`  Superpowers: ${spGlobalStatus}`);
    }
  } else {
    log(`\n  Superpowers: ${t(lang, 'allSkipped')}`);
  }

  const results: PlatformResult[] = [];

  for (const plan of plans) {
    const { platform, cmAction } = plan;
    const platformSkillsDir = getPlatformSkillsDir(platform, scope);
    const skillsPath =
      installMode === 'symlink'
        ? `via .comet/skills/ in ${platformSkillsDir}/skills/`
        : `${scope === 'global' ? '~/' : ''}${platformSkillsDir}/skills/`;

    let cmStatus: InstallStatus = 'skipped';
    if (cmAction !== 'skip') {
      const { copied, failed } = await copyCometSkillsForPlatform(
        baseDir,
        platform,
        cmAction === 'overwrite',
        language.skillsDir,
        scope,
        installMode,
      );
      cmStatus = failed > 0 ? 'failed' : copied > 0 ? 'installed' : 'skipped';
      log(
        `  Comet -> ${platform.name}: ${cmStatus} (${copied} files${
          failed > 0 ? `, ${failed} failed` : ''
        }) -> ${skillsPath}`,
      );
    } else {
      log(`  Comet -> ${platform.name}: skipped (${t(lang, 'alreadyExists')})`);
    }

    if (workflow === 'classic' && cmAction !== 'skip') {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        platform,
        cmAction === 'overwrite',
        language.id,
        scope,
      );
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${platform.name}: ${ruleCopied} ${t(lang, 'rulesInstalled')}`);
      }
    }

    if (workflow === 'classic' && cmAction !== 'skip' && platform.supportsHooks) {
      const { installed, reason } = await installCometHooksForPlatform(baseDir, platform, scope);
      if (installed) {
        log(`  Comet hooks -> ${platform.name}: ${t(lang, 'hooksInstalled')}`);
      } else if (reason) {
        log(`  Comet hooks -> ${platform.name}: ${t(lang, 'hooksSkipped')} (${reason})`);
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

  const codegraphAlreadyIndexed = hasCodegraphProjectIndex(projectPath);

  // JSON mode never installs CodeGraph interactively (matches pre-i18n behavior).
  // If the project already has a .codegraph/ index, skip.
  // Otherwise, only install when the user selected codegraph in the npm-deps prompt.
  const shouldInstallCodegraph =
    !options.json && !codegraphAlreadyIndexed && shouldInstallCodegraphCli;

  if (shouldInstallCodegraph) {
    log(`\n  ${t(lang, 'installingCG')}`);
    const cgGlobalStatus = await installCodegraph(projectPath, scope, true);
    log(`  CodeGraph: ${cgGlobalStatus}`);
    for (const r of results) {
      r.codegraph = cgGlobalStatus;
    }
  } else if (!options.json && codegraphAlreadyIndexed) {
    log('\n  CodeGraph: skipped (existing .codegraph index detected)');
  } else if (!options.json) {
    log(`\n  CodeGraph: ${t(lang, 'cgSkippedByUser')}`);
  }

  let projectConfigCreated = false;
  let projectConfigUpdated = false;
  let nativeArtifactRoot: string | null = null;
  let workingDirsCreated = false;
  const cometInstallComplete =
    results.length > 0 && results.every((result) => result.comet !== 'failed');

  if (scope === 'project' && workflowDecision && cometInstallComplete) {
    if (workflow === 'native') {
      const paths = await nativeProjectPaths(projectPath, workflowDecision.artifactRoot);
      await ensureNativeDirectories(paths);
      nativeArtifactRoot = workflowDecision.artifactRoot;
    } else {
      await createWorkingDirs(projectPath, language.artifactLanguage);
    }
    workingDirsCreated = true;

    if (workflow === 'native') {
      await installCometProjectInstructions(projectPath, language.id);
    }

    const projectTargets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
    if (projectTargets.length > 0) {
      await upsertProjectInstallation(
        projectPath,
        projectTargets.map((target) => ({
          platform: target.platform.id,
          language: target.language,
        })),
        'init',
      );
    }

    // The project config activates the selected workflow. Commit it only after
    // every required project artifact has been written successfully so a
    // partial initialization cannot route later commands into Native.
    if (workflowDecision.writeProjectConfig) {
      const existing = await readProjectConfig(projectPath);
      const config = existing ?? defaultProjectConfig(workflowDecision.artifactRoot);
      config.default_workflow = workflowDecision.workflow;
      await writeProjectConfig(projectPath, config);
      projectConfigCreated = existing === null;
      projectConfigUpdated = existing !== null;
    }
  } else if (scope === 'global') {
    await mergeProjectConfig(baseDir, language.artifactLanguage);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          projectPath,
          scope,
          language: language.id,
          workflow,
          workflowSource,
          projectConfigCreated,
          projectConfigUpdated,
          nativeArtifactRoot,
          selectedPlatforms: selectedPlatformIds,
          results: results.map((result) => ({
            platform: result.platform.id,
            platformName: result.platform.name,
            openspec: result.openspec,
            superpowers: result.superpowers,
            comet: result.comet,
            codegraph: result.codegraph,
          })),
          workingDirsCreated,
        },
        null,
        2,
      ),
    );
    return;
  }

  displaySummary(results, scope, lang, workflow);
}

export { applyBulkOverwriteChoice };
export type { TranslationKey };
