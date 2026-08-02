import path from 'path';
import { checkbox, select } from '@inquirer/prompts';

import { getBaseDir, type InstallScope } from '../../platform/install/detect.js';
import {
  PLATFORMS,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
} from '../../platform/install/platforms.js';
import { fileExists } from '../../platform/fs/file-system.js';
import {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
  removeCometProjectInstructions,
  removeOpenSpecSkillsForPlatform,
  removeSuperpowersSkillsForPlatforms,
} from '../../domains/skill/uninstall.js';
import { detectInstalledCometTargets, type InstalledCometTarget } from './update.js';
import {
  listProjectRegistryEntries,
  findProjectRegistryEntry,
  removeProjectInstallation,
  upsertProjectInstallation,
  type ProjectRegistryTarget,
} from '../../platform/install/project-registry.js';
import { assertProjectScopeOptions, resolveProjectScopeMode } from './project-scope-selection.js';
import { platformSelectPrompt } from './platform-select-prompt.js';
import type { CometWorkflow } from '../../domains/comet-entry/types.js';
import { readWorkflowProjectConfigSnapshot } from '../../domains/workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfigDocument } from '../../domains/workflow-contract/project-config-writer.js';
import { t, type Language, type TranslationKey } from './i18n.js';

interface UninstallOptions {
  json?: boolean;
  scope?: InstallScope;
  force?: boolean;
  allProjects?: boolean;
  currentProject?: boolean;
  recoverProjectCleanup?: boolean;
  recoveryTargets?: ProjectRegistryTarget[];
  targetPlatforms?: string[];
  workflows?: CometWorkflow[];
  companionSkills?: Array<'openspec' | 'superpowers'>;
  language?: Language;
}

interface TargetUninstallResult {
  scope: InstallScope;
  platform: string;
  platformName: string;
  skillsRemoved: number;
  rulesRemoved: number;
  hooksRemoved: number;
  skillsFailed: number;
  rulesFailed: number;
  hooksFailed: number;
  workingDirsRemoved: number;
}

type TargetWorkflowSelection = {
  target: InstalledCometTarget;
  installedWorkflows: CometWorkflow[];
  workflows: CometWorkflow[];
  companionSkills: Array<'openspec' | 'superpowers'>;
};

const ALL_WORKFLOWS: CometWorkflow[] = ['native', 'classic'];

function formatMessage(
  lang: Language,
  key: TranslationKey,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    t(lang, key),
  );
}

async function resolveUninstallLanguage(
  projectPath: string,
  fallbackTargets: readonly ProjectRegistryTarget[] = [],
): Promise<Language> {
  try {
    const snapshot = await readWorkflowProjectConfigSnapshot(projectPath, {
      allowPartialProject: true,
    });
    const configuredLanguages = [
      snapshot.document?.native?.language,
      snapshot.document?.classic?.language,
    ];
    if (configuredLanguages.includes('zh-CN')) return 'zh';
  } catch {
    // A malformed or absent project config must not prevent uninstalling.
  }
  return fallbackTargets.some((target) => target.language === 'zh') ? 'zh' : 'en';
}

async function resolveTargetSelection(
  targets: InstalledCometTarget[],
  options: UninstallOptions,
  log: (message: string) => void,
  lang: Language,
): Promise<InstalledCometTarget[] | null> {
  if (options.targetPlatforms !== undefined) {
    return targets.filter((target) => options.targetPlatforms!.includes(target.platform.id));
  }
  if (options.force || options.json || targets.length === 0) return targets;

  const detectedPlatforms = new Set(targets.map((target) => target.platform.id));
  const selectedPlatformIds = await platformSelectPrompt({
    message: t(lang, 'selectPlatformsToUninstall'),
    choices: PLATFORMS.map((platform) => ({
      name: `${platform.name}${detectedPlatforms.has(platform.id) ? ` (${t(lang, 'detected')})` : ''}`,
      summaryName: platform.name,
      value: platform.id,
      checked: detectedPlatforms.has(platform.id),
    })),
    selectedLabel: t(lang, 'uninstallSelectedPlatforms'),
    emptyLabel: t(lang, 'uninstallNoneSelected'),
    requiredErrorLabel: t(lang, 'uninstallPlatformsRequired'),
    required: true,
  });
  const selectedTargets = targets.filter((target) =>
    selectedPlatformIds.includes(target.platform.id),
  );
  if (selectedTargets.length === 0) {
    log(`\n  ${t(lang, 'noInstalledPlatformsSelected')}\n`);
    return null;
  }
  return selectedTargets;
}

async function resolveWorkflowSelection(
  options: UninstallOptions,
  lang: Language,
): Promise<{ workflows: CometWorkflow[]; companionSkills: Array<'openspec' | 'superpowers'> }> {
  if (options.workflows) {
    return {
      workflows: options.workflows,
      companionSkills: options.companionSkills ?? [],
    };
  }
  if (options.force || options.json) {
    return { workflows: [...ALL_WORKFLOWS], companionSkills: [] };
  }

  const selected = await checkbox({
    message: t(lang, 'selectWorkflowsToUninstall'),
    choices: [
      { name: t(lang, 'nativeWorkflow'), value: 'native' as const, checked: true },
      { name: t(lang, 'classicWorkflow'), value: 'classic' as const, checked: true },
    ],
    required: true,
  });
  const workflows = (selected as CometWorkflow[] | undefined)?.filter((workflow) =>
    ALL_WORKFLOWS.includes(workflow),
  );
  const resolvedWorkflows = workflows && workflows.length > 0 ? workflows : [...ALL_WORKFLOWS];
  if (!resolvedWorkflows.includes('classic')) {
    return { workflows: resolvedWorkflows, companionSkills: [] };
  }

  const companionSkills =
    ((await checkbox({
      message: t(lang, 'removeClassicCompanionSkills'),
      choices: [
        { name: t(lang, 'openSpecSkills'), value: 'openspec', checked: false },
        { name: t(lang, 'superpowersSkills'), value: 'superpowers', checked: false },
      ],
      required: false,
    })) as Array<'openspec' | 'superpowers'> | undefined) ?? [];
  return { workflows: resolvedWorkflows, companionSkills };
}

async function detectInstalledWorkflows(target: InstalledCometTarget, projectPath: string) {
  const baseDir = getBaseDir(target.scope, projectPath);
  const workflows: CometWorkflow[] = [];
  for (const workflow of ['native', 'classic'] as const) {
    const skill = workflow === 'native' ? 'comet-native' : 'comet-classic';
    if (
      await Promise.all(
        getPlatformSkillsDirs(target.platform, target.scope).map((skillsDir) =>
          fileExists(path.join(baseDir, skillsDir, 'skills', skill, 'SKILL.md')),
        ),
      ).then((results) => results.some(Boolean))
    ) {
      workflows.push(workflow);
    }
  }
  return workflows;
}

async function removeSelectedWorkflowsFromProjectConfig(
  projectPath: string,
  workflowsToRemove: readonly CometWorkflow[],
): Promise<boolean> {
  const snapshot = await readWorkflowProjectConfigSnapshot(projectPath, {
    allowPartialProject: true,
  });
  const config = snapshot.document?.config;
  if (!config) return false;
  const configured = config.workflows ?? [config.default_workflow];
  const remaining = configured.filter((workflow) => !workflowsToRemove.includes(workflow));
  if (remaining.length === 0) return false;

  const document = { ...(snapshot.document?.value ?? {}) };
  document.workflows = remaining;
  document.default_workflow = remaining.includes(config.default_workflow)
    ? config.default_workflow
    : remaining[0];
  for (const workflow of workflowsToRemove) delete document[workflow];
  const language =
    (document.native as { language?: unknown } | undefined)?.language === 'zh-CN' ||
    (document.classic as { language?: unknown } | undefined)?.language === 'zh-CN'
      ? 'zh-CN'
      : 'en';
  await writeWorkflowProjectConfigDocument(projectPath, document, language, {
    expectedIdentity: snapshot.identity,
  });
  return true;
}

interface SingleProjectUninstallResult {
  projectPath: string;
  projectScopeProcessed: boolean;
  targets: TargetUninstallResult[];
  workingDirsRemoved: number;
  workingDirsPreserved: string[];
  workingDirsFailureReason?: string;
  projectInstructionsRemoved: number;
  summary: {
    targetsProcessed: number;
    totalSkillsRemoved: number;
    totalRulesRemoved: number;
    totalHooksRemoved: number;
    totalFailures: number;
  };
}

function mergeCleanupTargets(
  detectedTargets: InstalledCometTarget[],
  recoveryTargets: ProjectRegistryTarget[],
  recoverProjectCleanup: boolean,
): InstalledCometTarget[] {
  const targets = [...detectedTargets];
  if (!recoverProjectCleanup) return targets;

  const seen = new Set(targets.map((target) => `${target.scope}:${target.platform.id}`));
  for (const recoveryTarget of recoveryTargets) {
    const platform = PLATFORMS.find((candidate) => candidate.id === recoveryTarget.platform);
    if (!platform) continue;

    const key = `project:${platform.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ scope: 'project', platform, language: recoveryTarget.language });
  }

  return targets;
}

function currentProjectJson(result: SingleProjectUninstallResult | null): {
  targets: Array<{
    scope: InstallScope;
    platform: string;
    platformName: string;
    skillsRemoved: number;
    rulesRemoved: number;
    hooksRemoved: number;
    skillsFailed: number;
    rulesFailed: number;
    hooksFailed: number;
  }>;
  workingDirsRemoved: number;
  workingDirsPreserved: string[];
  workingDirsFailureReason?: string;
  summary: SingleProjectUninstallResult['summary'];
  projectInstructionsRemoved: number;
} {
  return {
    targets:
      result?.targets.map((r) => ({
        scope: r.scope,
        platform: r.platform,
        platformName: r.platformName,
        skillsRemoved: r.skillsRemoved,
        rulesRemoved: r.rulesRemoved,
        hooksRemoved: r.hooksRemoved,
        skillsFailed: r.skillsFailed,
        rulesFailed: r.rulesFailed,
        hooksFailed: r.hooksFailed,
      })) ?? [],
    workingDirsRemoved: result?.workingDirsRemoved ?? 0,
    workingDirsPreserved: result?.workingDirsPreserved ?? [],
    workingDirsFailureReason: result?.workingDirsFailureReason,
    summary: result?.summary ?? {
      targetsProcessed: 0,
      totalSkillsRemoved: 0,
      totalRulesRemoved: 0,
      totalHooksRemoved: 0,
      totalFailures: 0,
    },
    projectInstructionsRemoved: result?.projectInstructionsRemoved ?? 0,
  };
}

async function uninstallSingleProject(
  projectPath: string,
  options: UninstallOptions = {},
  log: (message: string) => void,
): Promise<SingleProjectUninstallResult | null> {
  const targetScope = options.scope ?? 'project';
  const detectedTargets = await detectInstalledCometTargets(projectPath, {
    scopes: [targetScope],
    respectDetectionPaths: false,
  });
  const targets = mergeCleanupTargets(
    detectedTargets,
    options.recoveryTargets ?? [],
    options.recoverProjectCleanup === true,
  );
  const lang =
    options.language ??
    (await resolveUninstallLanguage(projectPath, options.recoveryTargets ?? []));

  if (targets.length === 0 && !options.recoverProjectCleanup) {
    return null;
  }

  const scopeLabel = (scope: InstallScope) =>
    scope === 'global' ? t(lang, 'globalScope') : `${t(lang, 'projectScope')} (${projectPath})`;
  const scopeName = (scope: InstallScope) =>
    scope === 'global' ? t(lang, 'globalScope') : t(lang, 'projectScope');

  if (targets.length > 0) {
    log(`  ${t(lang, 'foundCometInstallations')}\n`);
    for (const target of targets) {
      const skillsDir = getPlatformSkillsDir(target.platform, target.scope);
      const prefix = target.scope === 'global' ? '~/' : '';
      log(`    ${target.platform.name} (${scopeLabel(target.scope)})`);
      log(`      ${t(lang, 'pathLabel')} ${prefix}${skillsDir}/skills/`);
    }
  } else {
    log(`  ${t(lang, 'foundIndexedProjectCleanup')}\n`);
  }

  const selectedTargets = await resolveTargetSelection(targets, options, log, lang);
  if (!selectedTargets) return null;
  const workflowSelection = await resolveWorkflowSelection(options, lang);

  const installedWorkflowsByTarget = new Map<string, CometWorkflow[]>();
  for (const target of targets) {
    installedWorkflowsByTarget.set(
      `${target.scope}:${target.platform.id}`,
      await detectInstalledWorkflows(target, projectPath),
    );
  }

  const targetWorkflowSelections: TargetWorkflowSelection[] = [];
  for (const target of selectedTargets) {
    const installedWorkflows =
      installedWorkflowsByTarget.get(`${target.scope}:${target.platform.id}`) ?? [];
    if (workflowSelection.workflows.length > 0) {
      targetWorkflowSelections.push({
        target,
        installedWorkflows,
        workflows: workflowSelection.workflows,
        companionSkills: workflowSelection.companionSkills,
      });
    }
  }

  log('');
  const results: TargetUninstallResult[] = [];
  let totalSkills = 0;
  let totalRules = 0;
  let totalHooks = 0;
  let totalFailures = 0;
  let projectInstructionsRemoved = 0;
  const superpowersTargetsByScope = new Map<InstallScope, InstalledCometTarget[]>();

  for (const {
    target,
    installedWorkflows,
    workflows,
    companionSkills,
  } of targetWorkflowSelections) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const retainedWorkflows = installedWorkflows.filter(
      (workflow) => !workflows.includes(workflow),
    );
    const removingAllWorkflows = retainedWorkflows.length === 0;

    let hooksRemoved = 0;
    let hooksFailed = 0;
    if (removingAllWorkflows && target.platform.supportsHooks) {
      const hooksResult = await removeCometHooksForPlatform(baseDir, target.platform, target.scope);
      hooksRemoved = hooksResult.removed;
      hooksFailed = hooksResult.failed;
      totalHooks += hooksResult.removed;
      totalFailures += hooksResult.failed;
    }

    const rulesResult = removingAllWorkflows
      ? await removeCometRulesForPlatform(baseDir, target.platform, target.scope)
      : { removed: 0, failed: 0 };
    totalRules += rulesResult.removed;
    totalFailures += rulesResult.failed;

    const skillsResult =
      hooksFailed === 0 && rulesResult.failed === 0
        ? await removeCometSkillsForPlatform(
            baseDir,
            target.platform,
            target.scope,
            workflows,
            retainedWorkflows,
          )
        : { removed: 0, failed: 0 };
    totalSkills += skillsResult.removed;
    totalFailures += skillsResult.failed;

    if (hooksFailed === 0 && rulesResult.failed === 0 && companionSkills.includes('openspec')) {
      const result = await removeOpenSpecSkillsForPlatform(baseDir, target.platform, target.scope);
      totalSkills += result.removed;
      totalFailures += result.failed;
      log(
        `  ${target.platform.name} (${scopeName(target.scope)}): ${result.removed} ${t(lang, 'openSpecSkillsRemoved')}`,
      );
    }
    if (hooksFailed === 0 && rulesResult.failed === 0 && companionSkills.includes('superpowers')) {
      const targetsForScope = superpowersTargetsByScope.get(target.scope) ?? [];
      targetsForScope.push(target);
      superpowersTargetsByScope.set(target.scope, targetsForScope);
    }

    log(
      `  ${target.platform.name} (${scopeName(target.scope)}): ${formatMessage(
        lang,
        'targetAssetsRemoved',
        {
          skills: skillsResult.removed,
          rules: rulesResult.removed,
          hooks: hooksRemoved,
        },
      )}`,
    );
    if (skillsResult.failed + rulesResult.failed + hooksFailed > 0) {
      log(
        `  ${target.platform.name} (${scopeName(target.scope)}): ${t(lang, 'targetCleanupFailed')}`,
      );
    }

    results.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      skillsRemoved: skillsResult.removed,
      rulesRemoved: rulesResult.removed,
      hooksRemoved,
      skillsFailed: skillsResult.failed,
      rulesFailed: rulesResult.failed,
      hooksFailed,
      workingDirsRemoved: 0,
    });
  }

  for (const [scope, superpowersTargets] of superpowersTargetsByScope) {
    const selectedPlatformIds = new Set(superpowersTargets.map((target) => target.platform.id));
    const removeSharedStorage = targets
      .filter((target) => target.scope === scope)
      .every((target) => selectedPlatformIds.has(target.platform.id));
    const result = await removeSuperpowersSkillsForPlatforms(
      projectPath,
      superpowersTargets.map((target) => target.platform),
      scope,
      { removeSharedStorage },
    );
    totalSkills += result.removed;
    totalFailures += result.failed;
    log(
      `  ${formatMessage(lang, 'superpowersSkillsRemoved', {
        platforms: superpowersTargets.map((target) => target.platform.name).join(', '),
        scope: scope === 'global' ? t(lang, 'globalScope') : t(lang, 'projectScope'),
        count: result.removed,
      })}`,
    );
  }

  let workingDirsRemoved = 0;
  let workingDirsPreserved: string[] = [];
  let workingDirsFailureReason: string | undefined;
  const selectedProjectWorkflows = [
    ...new Set(
      targetWorkflowSelections
        .filter(({ target }) => target.scope === 'project')
        .flatMap(({ workflows }) => workflows),
    ),
  ] as CometWorkflow[];
  const hasProjectScope =
    options.recoverProjectCleanup === true || selectedTargets.some((t) => t.scope === 'project');
  const selectedTargetKeys = new Set(
    targetWorkflowSelections.map(({ target }) => `${target.scope}:${target.platform.id}`),
  );
  const projectWorkflowsAfterUninstall = new Set<CometWorkflow>();
  for (const target of targets) {
    if (target.scope !== 'project') continue;
    const key = `${target.scope}:${target.platform.id}`;
    const installed = installedWorkflowsByTarget.get(key) ?? [];
    const selection = selectedTargetKeys.has(key)
      ? targetWorkflowSelections.find(
          ({ target: selectedTarget }) =>
            `${selectedTarget.scope}:${selectedTarget.platform.id}` === key,
        )
      : undefined;
    for (const workflow of installed) {
      if (!selection || !selection.workflows.includes(workflow)) {
        projectWorkflowsAfterUninstall.add(workflow);
      }
    }
  }
  const projectWorkflowsToRemove = selectedProjectWorkflows.filter(
    (workflow) => !projectWorkflowsAfterUninstall.has(workflow),
  );
  const removingAllProjectWorkflows =
    hasProjectScope &&
    selectedProjectWorkflows.length > 0 &&
    projectWorkflowsAfterUninstall.size === 0;
  if (hasProjectScope && removingAllProjectWorkflows && totalFailures === 0) {
    const removeResult = await removeCometProjectInstructions(projectPath);
    projectInstructionsRemoved = removeResult.removed;
    if (projectInstructionsRemoved > 0) {
      log(
        `  ${formatMessage(lang, 'projectInstructionsRemoved', {
          count: projectInstructionsRemoved,
        })}`,
      );
    }
  }

  if (hasProjectScope && totalFailures === 0) {
    const dirsResult = await removeWorkingDirs(
      projectPath,
      removingAllProjectWorkflows ? {} : { workflows: projectWorkflowsToRemove },
    );
    workingDirsRemoved = dirsResult.removed;
    workingDirsPreserved = dirsResult.preserved ?? [];
    workingDirsFailureReason = dirsResult.reason;
    totalFailures += dirsResult.failed;
    if (workingDirsRemoved > 0) {
      log(`  ${formatMessage(lang, 'workingDirectoriesRemoved', { count: workingDirsRemoved })}`);
    }
    if (workingDirsPreserved.length > 0) {
      const relativePaths = workingDirsPreserved.map((entry) => path.relative(projectPath, entry));
      log(`  ${t(lang, 'workingDirectoriesPreserved')} ${relativePaths.join(', ')}`);
      log(`    ${t(lang, 'workingDirectoriesPreservedReason')}`);
      log(`    ${t(lang, 'workingDirectoriesPreservedImpact')}`);
    }
    if (dirsResult.failed > 0) {
      log(
        `  ${formatMessage(lang, 'workingDirectoriesCleanupFailed', {
          count: dirsResult.failed,
        })}`,
      );
      if (workingDirsFailureReason) {
        log(`    ${t(lang, 'workingDirectoriesFailureReason')} ${workingDirsFailureReason}`);
      }
    }
  }

  if (hasProjectScope && !removingAllProjectWorkflows && totalFailures === 0) {
    try {
      await removeSelectedWorkflowsFromProjectConfig(projectPath, projectWorkflowsToRemove);
    } catch {
      totalFailures += 1;
      log(`  ${t(lang, 'projectConfigCleanupFailed')}`);
    }
  }

  return {
    projectPath,
    projectScopeProcessed: hasProjectScope,
    targets: results,
    workingDirsRemoved,
    workingDirsPreserved,
    workingDirsFailureReason,
    projectInstructionsRemoved,
    summary: {
      targetsProcessed: results.length,
      totalSkillsRemoved: totalSkills,
      totalRulesRemoved: totalRules,
      totalHooksRemoved: totalHooks,
      totalFailures,
    },
  };
}

async function refreshRegistryAfterProjectUninstall(
  result: SingleProjectUninstallResult | null,
): Promise<void> {
  if (!result?.projectScopeProcessed) return;
  if (result.summary.totalFailures > 0) return;

  const remaining = await detectInstalledCometTargets(result.projectPath, { scopes: ['project'] });
  if (remaining.length === 0) {
    await removeProjectInstallation(result.projectPath);
    return;
  }

  await upsertProjectInstallation(
    result.projectPath,
    remaining.map((target) => ({ platform: target.platform.id, language: target.language })),
    'repair',
  );
}

async function uninstallAllIndexedProjects(
  options: UninstallOptions,
  log: (message: string) => void,
  lang: Language,
): Promise<void> {
  const registryProjects = await listProjectRegistryEntries({ strict: true });
  const results = [];
  const runnableProjects = [];
  const staleRemoved = 0;

  for (const registryProject of registryProjects) {
    const projectPath = registryProject.path;
    try {
      const targets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
      if (targets.length === 0) {
        runnableProjects.push({ projectPath, targets, registryProject });
        continue;
      }
      runnableProjects.push({ projectPath, targets, registryProject });
    } catch (error) {
      results.push({
        projectPath,
        status: 'skipped',
        reason: `unable to inspect project: ${(error as Error).message}`,
        targets: [],
      });
    }
  }

  if (!options.force && !options.json) {
    log(`  ${t(lang, 'allIndexedProjects')}: ${runnableProjects.length}`);
    for (const project of runnableProjects) {
      log(`    - ${project.projectPath}`);
      log(`      ${project.targets.map((target) => target.platform.name).join(', ')}`);
    }
    const confirmed = await select({
      message: t(lang, 'uninstallAllProjectsPrompt'),
      choices: [
        { name: t(lang, 'uninstallAllProjectsYes'), value: true },
        { name: t(lang, 'uninstallAllProjectsNo'), value: false },
      ],
    });
    if (!confirmed) {
      log(`\n  ${t(lang, 'cancelled')}\n`);
      return;
    }
  }

  const selectableTargets = runnableProjects.flatMap(({ targets, registryProject }) =>
    mergeCleanupTargets(targets, registryProject.lastTargets, true),
  );
  const selectedTargets = await resolveTargetSelection(selectableTargets, options, log, lang);
  if (!selectedTargets) return;
  const selectedPlatformIds = [...new Set(selectedTargets.map((target) => target.platform.id))];
  const workflowSelection = await resolveWorkflowSelection(options, lang);

  for (const project of runnableProjects) {
    const { projectPath, targets, registryProject } = project;
    const projectTargets = mergeCleanupTargets(targets, registryProject.lastTargets, true);
    if (!projectTargets.some((target) => selectedPlatformIds.includes(target.platform.id))) {
      results.push({
        projectPath,
        status: 'skipped',
        reason: 'no installed platforms selected for this project',
        targets: [],
      });
      continue;
    }
    try {
      const result = await uninstallSingleProject(
        projectPath,
        {
          ...options,
          scope: 'project',
          allProjects: false,
          currentProject: true,
          force: true,
          targetPlatforms: selectedPlatformIds,
          recoverProjectCleanup: true,
          recoveryTargets: registryProject.lastTargets,
          workflows: workflowSelection.workflows,
          companionSkills: workflowSelection.companionSkills,
        },
        log,
      );

      await refreshRegistryAfterProjectUninstall(result);

      results.push({
        projectPath,
        status: result ? (result.summary.totalFailures > 0 ? 'failed' : 'uninstalled') : 'skipped',
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
        summary: result?.summary ?? {
          targetsProcessed: 0,
          totalSkillsRemoved: 0,
          totalRulesRemoved: 0,
          totalHooksRemoved: 0,
          totalFailures: 0,
        },
        projectInstructionsRemoved: result?.projectInstructionsRemoved ?? 0,
        workingDirsRemoved: result?.workingDirsRemoved ?? 0,
      });
    } catch (error) {
      results.push({
        projectPath,
        status: 'failed',
        reason: (error as Error).message,
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
      });
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
    `\n  ${t(lang, 'uninstalledIndexedProjects')} ${results.filter((result) => result.status === 'uninstalled').length}`,
  );
}

export async function uninstallCommand(
  targetPath: string,
  options: UninstallOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  assertProjectScopeOptions(options);
  const registryProjects = await listProjectRegistryEntries({
    strict: options.allProjects === true,
  });
  const registeredProject = await findProjectRegistryEntry(projectPath, registryProjects);
  const lang = await resolveUninstallLanguage(projectPath, registeredProject?.lastTargets);

  log(`\n  ${t(lang, 'uninstallTitle')}\n`);

  const scopeMode = await resolveProjectScopeMode(
    'uninstall',
    options,
    registryProjects.length,
    lang,
  );
  if (scopeMode === 'all-projects') {
    await uninstallAllIndexedProjects(options, log, lang);
    return;
  }

  const result = await uninstallSingleProject(
    projectPath,
    {
      ...options,
      scope: options.scope ?? 'project',
      recoverProjectCleanup: Boolean(registeredProject) && options.scope !== 'global',
      recoveryTargets: registeredProject?.lastTargets,
      language: lang,
    },
    log,
  );

  if (!result) {
    if (options.json) {
      console.log(JSON.stringify(currentProjectJson(result), null, 2));
      return;
    }
    log(`  ${t(lang, 'noCometInstallationsFound')}\n`);
    return;
  }

  await refreshRegistryAfterProjectUninstall(result);

  if (options.json) {
    console.log(JSON.stringify(currentProjectJson(result), null, 2));
    return;
  }

  log(`\n  ${t(lang, 'summary')}`);
  log(`    ${t(lang, 'summaryTargets')} ${result.summary.targetsProcessed}`);
  log(`    ${t(lang, 'summarySkillsRemoved')} ${result.summary.totalSkillsRemoved}`);
  log(`    ${t(lang, 'summaryRules')} ${result.summary.totalRulesRemoved}`);
  log(`    ${t(lang, 'summaryHooks')} ${result.summary.totalHooksRemoved}`);
  if (result.summary.totalFailures > 0) {
    log(`    ${t(lang, 'cleanupFailures')} ${result.summary.totalFailures}`);
    log(`\n  ${t(lang, 'uninstallIncomplete')}\n`);
    return;
  }
  if (result.projectInstructionsRemoved > 0) {
    log(
      `    ${formatMessage(lang, 'projectInstructionsRemoved', {
        count: result.projectInstructionsRemoved,
      })}`,
    );
  }
  log(`\n  ${t(lang, 'uninstallComplete')}\n`);
}
