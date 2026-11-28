import path from 'path';

import { copyFile, fileExists } from '../../platform/fs/file-system.js';
import { getPlatformSkillsDir } from '../../platform/install/platforms.js';
import { resolveCanonicalSkillRootOwners } from '../../platform/install/skill-root-owner.js';
import type { InstallScope } from '../../platform/install/types.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';
import {
  reconcileCometHooksForPlatform,
  reconcileProjectCometHooksForPlatform,
} from './hook-lifecycle.js';
import { inspectCometHooksForPlatform } from './platform-inspect.js';
import { getAssetsDir } from './platform-install.js';

const HOOK_ROUTER_RUNTIME = ['comet', 'scripts', 'comet-hook-router.mjs'] as const;

export interface ProjectHookProjectionFailure {
  platform: string;
  reason: string;
}

export interface ProjectHookProjectionResult {
  installedPlatforms: string[];
  failures: ProjectHookProjectionFailure[];
  notices: string[];
}

export async function projectCometHooksFromInstalledScope(
  targetProjectRoot: string,
  sourceBaseDir: string,
  sourceScope: InstallScope,
  workflowSelection: InitWorkflowSelection,
  options: { globalBaseDir: string; migrateLegacyZcode?: boolean },
): Promise<ProjectHookProjectionResult> {
  const installedPlatforms: string[] = [];
  const failures: ProjectHookProjectionFailure[] = [];
  const notices: string[] = [];
  const packagedRouter = path.join(getAssetsDir(), 'skills', ...HOOK_ROUTER_RUNTIME);
  const owners = await resolveCanonicalSkillRootOwners(sourceBaseDir, sourceScope);

  for (const { platform, canonicalSkillsDir } of owners) {
    if (!platform.supportsHooks || !platform.hookFormat || platform.supportsProjectHooks === false)
      continue;

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
      await copyFile(
        path.join(path.dirname(packagedRouter), 'comet-hook-router-guard.mjs'),
        path.join(path.dirname(projectRouter), 'comet-hook-router-guard.mjs'),
      );
      const deferLegacyMigration =
        platform.hookFormat === 'zcode' && options.migrateLegacyZcode === false;
      const result = deferLegacyMigration
        ? await reconcileCometHooksForPlatform(
            targetProjectRoot,
            platform,
            'project',
            workflowSelection,
          )
        : await reconcileProjectCometHooksForPlatform(
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
      if (deferLegacyMigration) {
        const legacy = await inspectCometHooksForPlatform(
          options.globalBaseDir,
          platform,
          'global',
        );
        if (legacy.present || legacy.managedPresent || legacy.legacyPresent) {
          notices.push(
            'A legacy user-scoped Comet Hook is still in your ZCode configuration. Before enabling this project Router, run `comet update --platform zcode --scope project --current-project --skip-self-update --yes` to remove the old Hook for your account. Other projects that used it will need their own Router.',
          );
        }
      }
      const notice = result.reason ?? platform.projectHookTrustMessage;
      if (notice) notices.push(notice);
    } catch (error) {
      failures.push({
        platform: platform.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { installedPlatforms, failures, notices };
}
