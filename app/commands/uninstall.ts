import path from 'path';
import { checkbox, select } from '@inquirer/prompts';

import { getBaseDir, type InstallScope } from '../../platform/install/detect.js';
import { getPlatformSkillsDir } from '../../platform/install/platforms.js';
import {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
  removeCometProjectInstructions,
} from '../../domains/skill/uninstall.js';
import { detectInstalledCometTargets } from './update.js';
import {
  listProjectRegistryEntries,
  removeProjectInstallation,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';
import { assertProjectScopeOptions, resolveProjectScopeMode } from './project-scope-selection.js';

interface UninstallOptions {
  json?: boolean;
  scope?: InstallScope;
  force?: boolean;
  allProjects?: boolean;
  currentProject?: boolean;
}

interface TargetUninstallResult {
  scope: InstallScope;
  platform: string;
  platformName: string;
  skillsRemoved: number;
  rulesRemoved: number;
  hooksRemoved: number;
  workingDirsRemoved: number;
}

interface SingleProjectUninstallResult {
  projectPath: string;
  targets: TargetUninstallResult[];
  workingDirsRemoved: number;
  projectInstructionsRemoved: number;
  summary: {
    targetsProcessed: number;
    totalSkillsRemoved: number;
    totalRulesRemoved: number;
    totalHooksRemoved: number;
  };
}

function currentProjectJson(result: SingleProjectUninstallResult | null): {
  targets: Array<{
    scope: InstallScope;
    platform: string;
    platformName: string;
    skillsRemoved: number;
    rulesRemoved: number;
    hooksRemoved: number;
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
      })) ?? [],
    workingDirsRemoved: result?.workingDirsRemoved ?? 0,
    summary: result?.summary ?? {
      targetsProcessed: 0,
      totalSkillsRemoved: 0,
      totalRulesRemoved: 0,
      totalHooksRemoved: 0,
    },
    projectInstructionsRemoved: result?.projectInstructionsRemoved ?? 0,
  };
}

async function uninstallSingleProject(
  projectPath: string,
  options: UninstallOptions = {},
  log: (message: string) => void,
): Promise<SingleProjectUninstallResult | null> {
  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) {
    return null;
  }

  const scopeLabel = (scope: InstallScope) =>
    scope === 'global' ? 'global' : `project (${projectPath})`;

  log('  Found Comet installations on the following targets:\n');
  for (const target of targets) {
    const skillsDir = getPlatformSkillsDir(target.platform, target.scope);
    const prefix = target.scope === 'global' ? '~/' : '';
    log(`    ${target.platform.name} (${scopeLabel(target.scope)})`);
    log(`      Path: ${prefix}${skillsDir}/skills/`);
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

  log('');
  const results: TargetUninstallResult[] = [];
  let totalSkills = 0;
  let totalRules = 0;
  let totalHooks = 0;
  let projectInstructionsRemoved = 0;

  for (const target of selectedTargets) {
    const baseDir = getBaseDir(target.scope, projectPath);

    const skillsResult = await removeCometSkillsForPlatform(baseDir, target.platform, target.scope);
    totalSkills += skillsResult.removed;

    const rulesResult = await removeCometRulesForPlatform(baseDir, target.platform, target.scope);
    totalRules += rulesResult.removed;

    let hooksRemoved = 0;
    if (target.platform.supportsHooks) {
      const hooksResult = await removeCometHooksForPlatform(baseDir, target.platform, target.scope);
      hooksRemoved = hooksResult.removed;
      totalHooks += hooksResult.removed;
    }

    log(
      `  ${target.platform.name} (${target.scope}): ${skillsResult.removed} skills, ${rulesResult.removed} rules, ${hooksRemoved} hooks removed`,
    );

    results.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      skillsRemoved: skillsResult.removed,
      rulesRemoved: rulesResult.removed,
      hooksRemoved,
      workingDirsRemoved: 0,
    });
  }

  let workingDirsRemoved = 0;
  const hasProjectScope = selectedTargets.some((t) => t.scope === 'project');
  if (hasProjectScope) {
    const removeResult = await removeCometProjectInstructions(projectPath);
    projectInstructionsRemoved = removeResult.removed;
    if (projectInstructionsRemoved > 0) {
      log(`  Project instructions: ${projectInstructionsRemoved} managed block(s) removed`);
    }
  }

  if (hasProjectScope) {
    const dirsResult = await removeWorkingDirs(projectPath);
    workingDirsRemoved = dirsResult.removed;
    if (workingDirsRemoved > 0) {
      log(`  Working directories: ${workingDirsRemoved} removed`);
    }
  }

  return {
    projectPath,
    targets: results,
    workingDirsRemoved,
    projectInstructionsRemoved,
    summary: {
      targetsProcessed: results.length,
      totalSkillsRemoved: totalSkills,
      totalRulesRemoved: totalRules,
      totalHooksRemoved: totalHooks,
    },
  };
}

async function refreshRegistryAfterProjectUninstall(
  result: SingleProjectUninstallResult | null,
): Promise<void> {
  if (!result?.targets.some((target) => target.scope === 'project')) return;

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
    const { projectPath, targets } = project;
    try {
      const result = await uninstallSingleProject(
        projectPath,
        { ...options, scope: 'project', allProjects: false, currentProject: true, force: true },
        log,
      );

      await refreshRegistryAfterProjectUninstall(result);

      results.push({
        projectPath,
        status: result ? 'uninstalled' : 'skipped',
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

  const result = await uninstallSingleProject(projectPath, options, log);

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
  if (result.projectInstructionsRemoved > 0) {
    log(`    Project instructions removed: ${result.projectInstructionsRemoved}`);
  }
  log(`\n  Uninstall complete.\n`);
}
