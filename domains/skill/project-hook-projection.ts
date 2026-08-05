import path from 'path';

import { copyFile, fileExists } from '../../platform/fs/file-system.js';
import { getPlatformSkillsDir } from '../../platform/install/platforms.js';
import { resolveCanonicalSkillRootOwners } from '../../platform/install/skill-root-owner.js';
import type { InstallScope } from '../../platform/install/types.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';
import { reconcileProjectCometHooksForPlatform } from './hook-lifecycle.js';
import { getAssetsDir } from './platform-install.js';

const HOOK_ROUTER_RUNTIME = ['comet', 'scripts', 'comet-hook-router.mjs'] as const;

export interface ProjectHookProjectionFailure {
  platform: string;
  reason: string;
}

export interface ProjectHookProjectionResult {
  installedPlatforms: string[];
  failures: ProjectHookProjectionFailure[];
}

export async function projectCometHooksFromInstalledScope(
  targetProjectRoot: string,
  sourceBaseDir: string,
  sourceScope: InstallScope,
  workflowSelection: InitWorkflowSelection,
  options: { globalBaseDir: string },
): Promise<ProjectHookProjectionResult> {
  const installedPlatforms: string[] = [];
  const failures: ProjectHookProjectionFailure[] = [];
  const packagedRouter = path.join(getAssetsDir(), 'skills', ...HOOK_ROUTER_RUNTIME);
  const owners = await resolveCanonicalSkillRootOwners(sourceBaseDir, sourceScope);

  for (const { platform, canonicalSkillsDir } of owners) {
    if (!platform.supportsHooks || !platform.hookFormat) continue;

    const installedRouter = path.join(
      sourceBaseDir,
      canonicalSkillsDir,
      'skills',
      ...HOOK_ROUTER_RUNTIME,
    );
    if (!(await fileExists(installedRouter))) continue;

    try {
      const projectRouter = path.join(
        targetProjectRoot,
        getPlatformSkillsDir(platform, 'project'),
        'skills',
        ...HOOK_ROUTER_RUNTIME,
      );
      await copyFile(packagedRouter, projectRouter);
      const result = await reconcileProjectCometHooksForPlatform(
        targetProjectRoot,
        platform,
        workflowSelection,
        options,
      );
      if (result.status !== 'installed') {
        failures.push({
          platform: platform.id,
          reason: result.reason ?? 'project Hook installation did not complete',
        });
        continue;
      }
      installedPlatforms.push(platform.id);
    } catch (error) {
      failures.push({
        platform: platform.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { installedPlatforms, failures };
}
