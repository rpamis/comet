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
  removeSuperpowersSkillsForPlatform,
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
import type { CometWorkflow } from '../../domains/comet-entry/types.js';
import { readWorkflowProjectConfigSnapshot } from '../../domains/workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfigDocument } from '../../domains/workflow-contract/project-config-writer.js';

interface UninstallOptions {
  json?: boolean;
  scope?: InstallScope;
  force?: boolean;
  allProjects?: boolean;
  currentProject?: boolean;
  recoverProjectCleanup?: boolean;
  recoveryTargets?: ProjectRegistryTarget[];
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
  const detectedTargets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
    respectDetectionPaths: options.scope === undefined,
  });
  const targets = mergeCleanupTargets(
    detectedTargets,
    options.recoveryTargets ?? [],
    options.recoverProjectCleanup === true,
  );

  if (targets.length === 0 && !options.recoverProjectCleanup) {
    return null;
  }

  const scopeLabel = (scope: InstallScope) =>
    scope === 'global' ? 'global' : `project (${projectPath})`;

  if (targets.length > 0) {
    log('  Found Comet installations on the following targets:\n');
    for (const target of targets) {
      const skillsDir = getPlatformSkillsDir(target.platform, target.scope);
      const prefix = target.scope === 'global' ? '~/' : '';
      log(`    ${target.platform.name} (${scopeLabel(target.scope)})`);
      log(`      Path: ${prefix}${skillsDir}/skills/`);
    }
  } else {
    log('  Found an indexed project with follow-on cleanup still pending.\n');
  }

  let selectedTargets = targets;
  if (!options.force && !options.json) {
    if (targets.length === 1) {
      const confirmed = await select({
        message: `Uninstall Comet from ${targets[0].platform.name} (${targets[0].scope})?`,
        choices: [
          { name: 'Yes, uninstall', value: true },
          { name: 'No, cancel', value: false },
        ],
      });
      if (!confirmed) {
        log('\n  Cancelled.\n');
        return null;
      }
    } else {
      const selected = await checkbox({
        message: 'Select targets to uninstall:',
        choices: targets.map((t) => ({
          name: `${t.platform.name} (${t.scope})`,
          value: `${t.platform.id}:${t.scope}`,
          checked: true,
        })),
        required: true,
      });
      selectedTargets = targets.filter((t) => selected.includes(`${t.platform.id}:${t.scope}`));
      if (selectedTargets.length === 0) {
        log('\n  No targets selected. Cancelled.\n');
        return null;
      }
    }
  }

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
    const resolvedInstalledWorkflows =
      options.force || options.json
        ? (['native', 'classic'] as CometWorkflow[])
        : installedWorkflows.length > 0
          ? installedWorkflows
          : (['native', 'classic'] as CometWorkflow[]);
    let workflows = resolvedInstalledWorkflows;
    if (!options.force && !options.json && resolvedInstalledWorkflows.length > 1) {
      const selected = await checkbox({
        message: `Select workflows to uninstall from ${target.platform.name} (${target.scope}):`,
        choices: resolvedInstalledWorkflows.map((workflow) => ({
          name: workflow === 'native' ? 'Native workflow' : 'Classic workflow',
          value: workflow,
          checked: true,
        })),
        required: true,
      });
      const selectedWorkflows = (selected as CometWorkflow[] | undefined)?.filter((workflow) =>
        resolvedInstalledWorkflows.includes(workflow),
      );
      workflows =
        selectedWorkflows && selectedWorkflows.length > 0
          ? selectedWorkflows
          : resolvedInstalledWorkflows;
    }
    let companionSkills: Array<'openspec' | 'superpowers'> = [];
    if (!options.force && !options.json && workflows.includes('classic')) {
      const scopeWarning =
        target.scope === 'global' ? ' This affects global Skills that other projects may use.' : '';
      companionSkills =
        ((await checkbox({
          message: `Also remove Classic companion Skills from ${target.platform.name} (${target.scope})?${scopeWarning}`,
          choices: [
            { name: 'OpenSpec Skills', value: 'openspec', checked: false },
            { name: 'Superpowers Skills', value: 'superpowers', checked: false },
          ],
          required: false,
        })) as Array<'openspec' | 'superpowers'> | undefined) ?? [];
    }
    if (workflows.length > 0) {
      targetWorkflowSelections.push({
        target,
        installedWorkflows: resolvedInstalledWorkflows,
        workflows,
        companionSkills,
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
      log(`  ${target.platform.name} (${target.scope}): ${result.removed} OpenSpec Skills removed`);
    }
    if (hooksFailed === 0 && rulesResult.failed === 0 && companionSkills.includes('superpowers')) {
      const result = removeSuperpowersSkillsForPlatform(projectPath, target.platform, target.scope);
      totalSkills += result.removed;
      totalFailures += result.failed;
      log(
        `  ${target.platform.name} (${target.scope}): ${result.removed} Superpowers Skills removed`,
      );
    }

    log(
      `  ${target.platform.name} (${target.scope}): ${skillsResult.removed} skills, ${rulesResult.removed} rules, ${hooksRemoved} hooks removed`,
    );
    if (skillsResult.failed + rulesResult.failed + hooksFailed > 0) {
      log(
        `  ${target.platform.name} (${target.scope}): cleanup failed; uninstall incomplete and follow-on cleanup skipped`,
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

  let workingDirsRemoved = 0;
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
      log(`  Project instructions: ${projectInstructionsRemoved} managed block(s) removed`);
    }
  }

  if (hasProjectScope && totalFailures === 0) {
    const dirsResult = await removeWorkingDirs(
      projectPath,
      removingAllProjectWorkflows ? {} : { workflows: projectWorkflowsToRemove },
    );
    workingDirsRemoved = dirsResult.removed;
    totalFailures += dirsResult.failed;
    if (workingDirsRemoved > 0) {
      log(`  Working directories: ${workingDirsRemoved} removed`);
    }
    if (dirsResult.failed > 0) {
      log(`  Working directories: cleanup failed (${dirsResult.failed})`);
    }
  }

  if (hasProjectScope && !removingAllProjectWorkflows && totalFailures === 0) {
    try {
      await removeSelectedWorkflowsFromProjectConfig(projectPath, projectWorkflowsToRemove);
    } catch {
      totalFailures += 1;
      log('  Project config: cleanup failed; selected workflow remains configured');
    }
  }

  return {
    projectPath,
    projectScopeProcessed: hasProjectScope,
    targets: results,
    workingDirsRemoved,
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
    log(
      `  Comet will uninstall project-scope files from ${runnableProjects.length} indexed project(s):`,
    );
    for (const project of runnableProjects) {
      log(`    - ${project.projectPath}`);
      log(`      ${project.targets.map((target) => target.platform.name).join(', ')}`);
    }
    const confirmed = await select({
      message: 'Proceed with uninstalling all indexed projects?',
      choices: [
        { name: 'Yes, uninstall all indexed projects', value: true },
        { name: 'No, cancel', value: false },
      ],
    });
    if (!confirmed) {
      log('\n  Cancelled.\n');
      return;
    }
  }

  for (const project of runnableProjects) {
    const { projectPath, targets, registryProject } = project;
    try {
      const result = await uninstallSingleProject(
        projectPath,
        {
          ...options,
          scope: 'project',
          allProjects: false,
          currentProject: true,
          force: true,
          recoverProjectCleanup: true,
          recoveryTargets: registryProject.lastTargets,
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
    `\n  Uninstalled ${results.filter((result) => result.status === 'uninstalled').length} indexed project(s).`,
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

  log(`\n  Comet Uninstall\n`);

  const scopeMode = await resolveProjectScopeMode('uninstall', options, registryProjects.length);
  if (scopeMode === 'all-projects') {
    await uninstallAllIndexedProjects(options, log);
    return;
  }

  const registeredProject = await findProjectRegistryEntry(projectPath, registryProjects);
  const result = await uninstallSingleProject(
    projectPath,
    {
      ...options,
      recoverProjectCleanup: Boolean(registeredProject) && options.scope !== 'global',
      recoveryTargets: registeredProject?.lastTargets,
    },
    log,
  );

  if (!result) {
    if (options.json) {
      console.log(JSON.stringify(currentProjectJson(result), null, 2));
      return;
    }
    log('  No Comet installations found. Nothing to uninstall.\n');
    return;
  }

  await refreshRegistryAfterProjectUninstall(result);

  if (options.json) {
    console.log(JSON.stringify(currentProjectJson(result), null, 2));
    return;
  }

  log(`\n  Summary:`);
  log(`    Targets: ${result.summary.targetsProcessed}`);
  log(`    Skills removed: ${result.summary.totalSkillsRemoved}`);
  log(`    Rules removed: ${result.summary.totalRulesRemoved}`);
  log(`    Hooks removed: ${result.summary.totalHooksRemoved}`);
  if (result.summary.totalFailures > 0) {
    log(`    Cleanup failures: ${result.summary.totalFailures}`);
    log(`\n  Uninstall incomplete. Preserved remaining project state.\n`);
    return;
  }
  if (result.projectInstructionsRemoved > 0) {
    log(`    Project instructions removed: ${result.projectInstructionsRemoved}`);
  }
  log(`\n  Uninstall complete.\n`);
}
