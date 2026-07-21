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
import {
  readProjectRegistry,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';
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
import type { CometWorkflow, InitWorkflowSelection } from '../../domains/comet-entry/types.js';
import { migrateLegacyClassicSelection } from '../../domains/comet-entry/current-selection.js';
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
import type { CommandExecutionResult } from './command-result.js';

type InitOptions = {
  yes?: boolean;
  skipExisting?: boolean;
  overwrite?: boolean;
  json?: boolean;
  scope?: InstallScope;
  language?: string;
  installMode?: InstallMode;
  workflow?: InitWorkflowSelection;
  artifactRoot?: string;
};

function workflowChoiceNames(lang: string): Array<{
  name: string;
  value: InitWorkflowSelection;
}> {
  if (lang === 'zh') {
    return [
      {
        name: 'Native — 面向强模型的轻量自主流程，自带澄清、状态、检查与自动推进，不依赖外部 Skill',
        value: 'native',
      },
      {
        name: 'Classic — 面向高约束或较弱模型的完整 Spec/TDD 阶段流程，使用 OpenSpec 与 Superpowers',
        value: 'classic',
      },
      {
        name: '两者 — 同时安装两套独立入口；/comet 默认使用 Native，也可显式进入 Classic',
        value: 'both',
      },
    ];
  }
  return [
    {
      name: 'Native — lightweight autonomy for strong models, with clarification, state, checks, and auto-progression; no external skills',
      value: 'native',
    },
    {
      name: 'Classic — full Spec/TDD phases for high-control work or weaker models, using OpenSpec and Superpowers',
      value: 'classic',
    },
    {
      name: 'Both — install two independent entries; /comet defaults to Native and Classic remains explicit',
      value: 'both',
    },
  ];
}

async function selectWorkflow(
  options: InitOptions,
  lang: string,
  suggested: CometWorkflow,
): Promise<InitWorkflowSelection> {
  if (options.workflow) return options.workflow;
  if (options.yes || options.json) return suggested;
  return select({
    message: lang === 'zh' ? '选择要初始化的 Comet 模式：' : 'Select Comet workflow(s):',
    choices: workflowChoiceNames(lang),
    default: suggested,
  });
}

function includesWorkflow(selection: InitWorkflowSelection, workflow: CometWorkflow): boolean {
  return selection === 'both' || selection === workflow;
}

type InstallStatus = 'installed' | 'skipped' | 'failed';
type ComponentAction = 'overwrite' | 'skip' | 'install' | 'reuse';
type BulkOverwriteChoice = 'overwrite-all' | 'skip-all' | 'choose';

interface PlatformResult {
  platform: Platform;
  openspec: InstallStatus;
  superpowers: InstallStatus;
  comet: InstallStatus;
  codegraph: InstallStatus;
  failures: InitFailureDetail[];
}

interface InitFailureDetail {
  platform: string;
  platformName: string;
  component: 'OpenSpec' | 'Superpowers' | 'Comet' | 'Rule' | 'Hook' | 'CodeGraph' | 'Finalization';
  reason: string;
}

type ComponentPlan = {
  osAction: ComponentAction;
  spAction: ComponentAction;
  cmAction: ComponentAction;
};

async function selectScope(options: InitOptions, lang: string): Promise<InstallScope> {
  if (options.scope) return options.scope;
  if (options.yes || options.json) return 'project';

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
  if (options.yes || options.json) return LANGUAGES[0];

  const langId = await select({
    message: t('en', 'languagePrompt'),
    choices: LANGUAGES.map((lang) => ({ name: lang.name, value: lang.id })),
  });

  return LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0];
}

async function selectInstallMode(options: InitOptions, lang: string): Promise<InstallMode> {
  if (options.installMode) return options.installMode;
  if (options.yes || options.json) return 'copy';

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

  if (options.yes || options.json) {
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
  if (options.yes || options.json) return 'skip';
  return 'install';
}

function resolveCometAction(hasExisting: boolean, options: InitOptions): ComponentAction {
  if (hasExisting && (options.yes || options.json) && !options.overwrite && !options.skipExisting)
    return 'reuse';
  return resolveAction(hasExisting, options);
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

  if (options.yes || options.json) {
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
  workflowSelection: InitWorkflowSelection,
  nativeArtifactRoot: string | null,
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

  // A platform with both installed and failed components is shown as failed,
  // not both. Use priority: failed > installed > skipped.
  const failed = results.filter(hasFailure);
  const installed = results.filter((r) => !hasFailure(r) && hasInstall(r));
  const skipped = results.filter(isAllSkipped);
  const failures = results.flatMap((result) => result.failures);

  console.log(
    `\n  ${failures.length > 0 ? (lang === 'zh' ? 'Comet 设置未完成。' : 'Comet setup incomplete.') : t(lang, 'setupComplete')} (scope: ${scopeLabel})\n`,
  );

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
      for (const failure of r.failures) {
        console.log(`      ${failure.component}: ${failure.reason}`);
      }
    }
  }

  const showNativeWorkspace =
    scope === 'project' &&
    includesWorkflow(workflowSelection, 'native') &&
    nativeArtifactRoot !== null;
  const showClassicWorkspace =
    scope === 'project' && includesWorkflow(workflowSelection, 'classic');
  if (showNativeWorkspace || showClassicWorkspace) {
    console.log(`\n  ${t(lang, 'workingDirs')}`);
    if (showNativeWorkspace) {
      const root = nativeArtifactRoot === '.' ? '' : `${nativeArtifactRoot}/`;
      console.log(`    ${t(lang, 'nativeWorkingDir')} ${root}comet/`);
    }
    if (showClassicWorkspace) {
      console.log(`    ${t(lang, 'classicWorkingDirs')}`);
    }
  }

  if (failures.length === 0) {
    console.log(`\n  ${t(lang, 'getStarted')}`);
    console.log(`    ${t(lang, 'getStartedComet')}`);
    if (includesWorkflow(workflowSelection, 'classic')) {
      console.log(`    ${t(lang, 'getStartedHotfix')}`);
      console.log(`    ${t(lang, 'getStartedTweak')}`);
    }
  }
  console.log();
}

export async function initCommand(
  targetPath: string,
  options: InitOptions = {},
): Promise<CommandExecutionResult> {
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
  if (scope === 'project') {
    await readProjectRegistry({ strict: true });
  }
  const suggestedWorkflowDecision =
    scope === 'project'
      ? await resolveInitWorkflow(projectPath, {
          workflow: options.workflow === 'both' ? 'native' : options.workflow,
          artifactRoot: options.artifactRoot,
        })
      : null;
  const workflowSelection =
    scope === 'project'
      ? await selectWorkflow(options, lang, suggestedWorkflowDecision?.workflow ?? 'native')
      : 'classic';
  const workflow: CometWorkflow = workflowSelection === 'both' ? 'native' : workflowSelection;
  const workflowDecision =
    scope === 'project'
      ? options.workflow === undefined && (options.yes || options.json)
        ? suggestedWorkflowDecision
        : await resolveInitWorkflow(projectPath, {
            workflow,
            artifactRoot: options.artifactRoot,
          })
      : null;
  const workflowSource = workflowDecision?.source ?? 'global-install';
  const installMode =
    workflowSelection === 'native' ? 'copy' : await selectInstallMode(options, lang);

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
            initializedWorkflows:
              workflowSelection === 'both' ? ['native', 'classic'] : [workflowSelection],
            workflowSource,
            projectConfigCreated: false,
            projectConfigUpdated: false,
            nativeArtifactRoot: null,
            selectedPlatforms: [],
            status: 'incomplete',
            failures: [{ component: 'Comet', reason: 'no platforms selected' }],
            results: [],
            workingDirsCreated: false,
          },
          null,
          2,
        ),
      );
      return { status: 'incomplete' };
    }
    log(`\n  ${t(lang, 'noPlatforms')}\n`);
    return { status: 'incomplete' };
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
    const hasOS = includesWorkflow(workflowSelection, 'classic')
      ? await hasSkills(baseDir, platform, 'openspec', selectedPlatforms, scope)
      : false;
    const hasSP = includesWorkflow(workflowSelection, 'classic')
      ? await hasSkills(baseDir, platform, 'superpowers', selectedPlatforms, scope)
      : false;
    const hasCM = await hasSkills(baseDir, platform, 'comet', selectedPlatforms, scope, {
      includeGlobalFallback: false,
    });

    let osAction = includesWorkflow(workflowSelection, 'classic')
      ? resolveAction(hasOS, options)
      : 'skip';
    let spAction = includesWorkflow(workflowSelection, 'classic')
      ? resolveAction(hasSP, options)
      : 'skip';
    let cmAction =
      workflowSelection === 'classic'
        ? resolveCometAction(hasCM, options)
        : resolveAction(hasCM, options);
    if (
      includesWorkflow(workflowSelection, 'native') &&
      hasCM &&
      (options.yes || options.json) &&
      !options.skipExisting &&
      !options.overwrite
    ) {
      cmAction = 'install';
    }

    if (!options.yes && !options.json) {
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

  if (includesWorkflow(workflowSelection, 'native') && scope === 'project') {
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

  const selectedNpmDeps = await selectNpmDeps(
    projectPath,
    spPlatformIds,
    options,
    lang,
    includesWorkflow(workflowSelection, 'classic') ? 'classic' : 'native',
  );
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
  let projectRouterInstalled = false;

  for (const plan of plans) {
    const { platform, cmAction } = plan;
    const platformSkillsDir = getPlatformSkillsDir(platform, scope);
    const skillsPath =
      installMode === 'symlink'
        ? `via .comet/skills/ in ${platformSkillsDir}/skills/`
        : `${scope === 'global' ? '~/' : ''}${platformSkillsDir}/skills/`;

    let cmStatus: InstallStatus = 'skipped';
    const platformFailures: InitFailureDetail[] = [];
    let cometComponentInstalled = false;
    let skillFailed = false;
    if (cmAction !== 'skip') {
      const { copied, failed } = await copyCometSkillsForPlatform(
        baseDir,
        platform,
        cmAction === 'overwrite',
        language.skillsDir,
        scope,
        installMode,
        workflowSelection,
      );
      skillFailed = failed > 0;
      cmStatus = failed > 0 ? 'failed' : copied > 0 ? 'installed' : 'skipped';
      cometComponentInstalled = copied > 0;
      if (failed > 0) {
        platformFailures.push({
          platform: platform.id,
          platformName: platform.name,
          component: 'Comet',
          reason: `${failed} Skill file(s) failed to install`,
        });
      }
      if (cmAction === 'reuse' && copied === 0 && failed === 0) {
        log(`  Comet -> ${platform.name}: reused (${t(lang, 'alreadyExists')})`);
      } else {
        log(
          `  Comet -> ${platform.name}: ${cmStatus} (${copied} files${
            failed > 0 ? `, ${failed} failed` : ''
          }) -> ${skillsPath}`,
        );
      }
    } else {
      log(`  Comet -> ${platform.name}: skipped (${t(lang, 'alreadyExists')})`);
    }

    if (cmAction !== 'skip' && !skillFailed) {
      try {
        const { copied: ruleCopied, failed: ruleFailed } = await copyCometRulesForPlatform(
          baseDir,
          platform,
          cmAction === 'overwrite',
          language.id,
          scope,
          workflowSelection,
        );
        cometComponentInstalled ||= ruleCopied > 0;
        if (ruleCopied > 0) {
          log(`  Comet rules -> ${platform.name}: ${ruleCopied} ${t(lang, 'rulesInstalled')}`);
        }
        if (ruleFailed > 0) {
          cmStatus = 'failed';
          platformFailures.push({
            platform: platform.id,
            platformName: platform.name,
            component: 'Rule',
            reason: `${ruleFailed} Rule file(s) failed to install`,
          });
          log(`  Comet rules -> ${platform.name}: ${t(lang, 'rulesFailed')} (${ruleFailed})`);
        }
      } catch (err) {
        cmStatus = 'failed';
        platformFailures.push({
          platform: platform.id,
          platformName: platform.name,
          component: 'Rule',
          reason: (err as Error).message,
        });
        log(
          `  Comet rules -> ${platform.name}: ${t(lang, 'rulesFailed')} (${(err as Error).message})`,
        );
      }
    }

    if (cmAction !== 'skip' && !skillFailed) {
      try {
        const {
          status,
          reason,
          cleanupFailed = 0,
        } = await installCometHooksForPlatform(baseDir, platform, scope, workflowSelection);
        cometComponentInstalled ||= status === 'installed';
        if (status === 'installed') {
          if (scope === 'project') projectRouterInstalled = true;
          log(`  Comet hooks -> ${platform.name}: ${t(lang, 'hooksInstalled')}`);
          if (cleanupFailed > 0) {
            cmStatus = 'failed';
            platformFailures.push({
              platform: platform.id,
              platformName: platform.name,
              component: 'Hook',
              reason: reason ?? `legacy Hook cleanup failed (${cleanupFailed})`,
            });
            log(`  Comet hooks -> ${platform.name}: ${reason}`);
          }
        } else if (status === 'failed') {
          cmStatus = 'failed';
          platformFailures.push({
            platform: platform.id,
            platformName: platform.name,
            component: 'Hook',
            reason: reason ?? 'Hook installation failed',
          });
          log(`  Comet hooks -> ${platform.name}: ${t(lang, 'hooksFailed')} (${reason})`);
        } else if (reason && platform.supportsHooks) {
          log(`  Comet hooks -> ${platform.name}: ${t(lang, 'hooksSkipped')} (${reason})`);
        }
      } catch (err) {
        cmStatus = 'failed';
        platformFailures.push({
          platform: platform.id,
          platformName: platform.name,
          component: 'Hook',
          reason: (err as Error).message,
        });
        log(
          `  Comet hooks -> ${platform.name}: ${t(lang, 'hooksFailed')} (${(err as Error).message})`,
        );
      }
    }

    if (cmAction !== 'skip' && cmStatus !== 'failed') {
      cmStatus = cometComponentInstalled ? 'installed' : 'skipped';
    }

    results.push({
      platform,
      openspec: osToolIds.includes(platform.openspecToolId) ? osGlobalStatus : 'skipped',
      superpowers: plan.spAction !== 'skip' ? spGlobalStatus : 'skipped',
      comet: cmStatus,
      codegraph: 'skipped',
      failures: [
        ...(osToolIds.includes(platform.openspecToolId) && osGlobalStatus === 'failed'
          ? [
              {
                platform: platform.id,
                platformName: platform.name,
                component: 'OpenSpec' as const,
                reason: 'OpenSpec installation failed; see the preceding diagnostic for details',
              },
            ]
          : []),
        ...(plan.spAction !== 'skip' && spGlobalStatus === 'failed'
          ? [
              {
                platform: platform.id,
                platformName: platform.name,
                component: 'Superpowers' as const,
                reason: 'Superpowers installation failed; see the preceding diagnostic for details',
              },
            ]
          : []),
        ...platformFailures,
      ],
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
      if (cgGlobalStatus === 'failed') {
        r.failures.push({
          platform: r.platform.id,
          platformName: r.platform.name,
          component: 'CodeGraph',
          reason: 'CodeGraph installation failed; see the preceding diagnostic for details',
        });
      }
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
  let finalizationFailure: string | undefined;
  const cometInstallComplete =
    results.length > 0 && results.every((result) => result.comet !== 'failed');

  if (
    scope === 'project' &&
    projectRouterInstalled &&
    cometInstallComplete &&
    includesWorkflow(workflowSelection, 'classic')
  ) {
    if (await migrateLegacyClassicSelection(projectPath)) {
      log('  Comet current selection -> migrated Classic v1 to shared v2');
    }
  }

  try {
    if (scope === 'project' && workflowDecision && cometInstallComplete) {
      if (includesWorkflow(workflowSelection, 'native')) {
        const paths = await nativeProjectPaths(projectPath, workflowDecision.artifactRoot);
        await ensureNativeDirectories(paths);
        nativeArtifactRoot = workflowDecision.artifactRoot;
      }
      if (includesWorkflow(workflowSelection, 'classic')) {
        await createWorkingDirs(projectPath, language.artifactLanguage);
      }
      workingDirsCreated = true;

      if (includesWorkflow(workflowSelection, 'native')) {
        await installCometProjectInstructions(projectPath, language.id);
      }

      const projectTargets = await detectInstalledCometTargets(projectPath, {
        scopes: ['project'],
      });
      const successfulCometPlatforms = new Set(
        results
          .filter(
            (result) =>
              result.comet !== 'failed' &&
              plans.some(
                (plan) => plan.platform.id === result.platform.id && plan.cmAction !== 'skip',
              ),
          )
          .map((result) => result.platform.id),
      );
      const completeProjectTargets = projectTargets.filter((target) =>
        successfulCometPlatforms.has(target.platform.id),
      );
      if (completeProjectTargets.length > 0) {
        await upsertProjectInstallation(
          projectPath,
          completeProjectTargets.map((target) => ({
            platform: target.platform.id,
            language: target.language,
          })),
          'init',
        );
      }

      // The project config activates the selected workflow. Commit it only after
      // every required project artifact has been written successfully so a
      // partial initialization cannot route later commands into Native.
      const existing = await readProjectConfig(projectPath);
      const selectedWorkflows =
        workflowSelection === 'both' ? (['native', 'classic'] as const) : [workflowSelection];
      const configuredWorkflows =
        existing?.workflows ?? (existing ? [existing.default_workflow] : []);
      const workflowsChanged =
        configuredWorkflows.length !== selectedWorkflows.length ||
        selectedWorkflows.some((selected) => !configuredWorkflows.includes(selected));
      if (workflowDecision.writeProjectConfig || (existing !== null && workflowsChanged)) {
        const config =
          existing ??
          defaultProjectConfig(workflowDecision.artifactRoot, language.artifactLanguage);
        config.default_workflow = workflowDecision.workflow;
        config.workflows = [...selectedWorkflows];
        await writeProjectConfig(projectPath, config);
        projectConfigCreated = existing === null;
        projectConfigUpdated = existing !== null;
      }
    } else if (scope === 'global') {
      await mergeProjectConfig(baseDir, language.artifactLanguage);
    }
  } catch (error) {
    finalizationFailure = (error as Error).message;
    const target = results[0];
    if (target) {
      target.comet = 'failed';
      target.failures.push({
        platform: target.platform.id,
        platformName: target.platform.name,
        component: 'Finalization',
        reason: finalizationFailure,
      });
    }
    log(`  Comet finalization failed: ${finalizationFailure}`);
  }

  const failures = results.flatMap((result) => result.failures);
  const completionStatus = failures.length > 0 || finalizationFailure ? 'incomplete' : 'complete';

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          status: completionStatus,
          failures,
          projectPath,
          scope,
          language: language.id,
          workflow,
          initializedWorkflows:
            workflowSelection === 'both' ? ['native', 'classic'] : [workflowSelection],
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
    return { status: completionStatus };
  }

  displaySummary(results, scope, lang, workflowSelection, nativeArtifactRoot);
  return { status: completionStatus };
}

export { applyBulkOverwriteChoice, workflowChoiceNames };
export type { TranslationKey };
