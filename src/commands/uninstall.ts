import path from 'path';
import { select } from '@inquirer/prompts';

import { getBaseDir, type InstallScope } from '../core/detect.js';
import { getPlatformSkillsDir } from '../core/platforms.js';
import {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
} from '../core/uninstall.js';
import { detectInstalledCometTargets } from './update.js';

interface UninstallOptions {
  json?: boolean;
  scope?: InstallScope;
  force?: boolean;
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

export async function uninstallCommand(
  targetPath: string,
  options: UninstallOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  log(`\n  Comet Uninstall\n`);

  // 1. Detect installed targets
  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ targets: [], results: [] }, null, 2));
      return;
    }
    log('  No Comet installations found. Nothing to uninstall.\n');
    return;
  }

  // 2. Preview what will be removed
  const scopeLabel = (scope: InstallScope) =>
    scope === 'global' ? 'global' : `project (${projectPath})`;

  log('  Found Comet installations on the following targets:\n');
  for (const target of targets) {
    const skillsDir = getPlatformSkillsDir(target.platform, target.scope);
    const prefix = target.scope === 'global' ? '~/' : '';
    log(`    ${target.platform.name} (${scopeLabel(target.scope)})`);
    log(`      Path: ${prefix}${skillsDir}/skills/`);
  }

  // 3. Confirm with user (unless --force)
  if (!options.force && !options.json) {
    const confirmed = await select({
      message: 'Remove all Comet skills, rules, and hooks from these targets?',
      choices: [
        { name: 'Yes, uninstall all', value: true },
        { name: 'No, cancel', value: false },
      ],
    });

    if (!confirmed) {
      log('\n  Cancelled.\n');
      return;
    }
  }

  // 4. Execute removal for each target
  log('');
  const results: TargetUninstallResult[] = [];
  let totalSkills = 0;
  let totalRules = 0;
  let totalHooks = 0;

  for (const target of targets) {
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

  // 5. Working directories (project scope only)
  let workingDirsRemoved = 0;
  const hasProjectScope = targets.some((t) => t.scope === 'project');
  if (hasProjectScope) {
    const dirsResult = await removeWorkingDirs(projectPath);
    workingDirsRemoved = dirsResult.removed;
    if (workingDirsRemoved > 0) {
      log(`  Working directories: ${workingDirsRemoved} removed`);
    }
  }

  // 6. Summary
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          targets: results.map((r) => ({
            scope: r.scope,
            platform: r.platform,
            platformName: r.platformName,
            skillsRemoved: r.skillsRemoved,
            rulesRemoved: r.rulesRemoved,
            hooksRemoved: r.hooksRemoved,
          })),
          workingDirsRemoved,
          summary: {
            targetsProcessed: results.length,
            totalSkillsRemoved: totalSkills,
            totalRulesRemoved: totalRules,
            totalHooksRemoved: totalHooks,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  log(`\n  Summary:`);
  log(`    Targets: ${results.length}`);
  log(`    Skills removed: ${totalSkills}`);
  log(`    Rules removed: ${totalRules}`);
  log(`    Hooks removed: ${totalHooks}`);
  log(`\n  Uninstall complete.\n`);
}
