import path from 'path';

import { getPlatformConfigDir, type Platform } from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';
import { installCometHooksForPlatform, type HookInstallResult } from './platform-install.js';
import { removeCometHooksForPlatform } from './uninstall.js';

export async function reconcileCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
  workflowSelection: InitWorkflowSelection = 'classic',
): Promise<HookInstallResult> {
  if (scope === 'project') {
    if (platform.supportsProjectHooks === false) {
      return {
        status: 'skipped',
        reason: `${platform.name} only executes user-scoped Hooks; run comet update --platform ${platform.id} --scope global --yes`,
      };
    }
    return installCometHooksForPlatform(baseDir, platform, scope, workflowSelection);
  }

  if (!platform.supportsHooks) {
    return { status: 'skipped', reason: 'platform does not support hooks' };
  }
  if (!platform.hookFormat) {
    return {
      status: 'failed',
      reason: 'hook-capable platform does not declare a hook format',
    };
  }

  if (platform.supportsGlobalHooks) {
    return installCometHooksForPlatform(baseDir, platform, scope, workflowSelection);
  }

  const cleanup = await removeCometHooksForPlatform(baseDir, platform, scope);
  if (cleanup.failed > 0) {
    return {
      status: 'failed',
      reason: `failed to remove ${cleanup.failed} legacy global Hook configuration(s)`,
      cleanupFailed: cleanup.failed,
    };
  }
  return {
    status: 'skipped',
    reason:
      cleanup.removed > 0
        ? `blocking Hooks are project-scoped; removed ${cleanup.removed} legacy global Hook${cleanup.removed === 1 ? '' : 's'}`
        : 'blocking Hooks are project-scoped',
  };
}

export async function reconcileProjectCometHooksForPlatform(
  projectRoot: string,
  platform: Platform,
  workflowSelection: InitWorkflowSelection,
  options: { globalBaseDir: string },
): Promise<HookInstallResult> {
  if (platform.supportsProjectHooks === false) {
    return reconcileCometHooksForPlatform(projectRoot, platform, 'project', workflowSelection);
  }
  const project = await installCometHooksForPlatform(
    projectRoot,
    platform,
    'project',
    workflowSelection,
  );
  if (project.status !== 'installed') return project;
  const activationMessage = platform.projectHookTrustMessage;
  const installed = activationMessage ? { ...project, reason: activationMessage } : project;
  if (
    path.relative(
      path.resolve(projectRoot, getPlatformConfigDir(platform, 'project')),
      path.resolve(options.globalBaseDir, getPlatformConfigDir(platform, 'global')),
    ) === ''
  ) {
    return installed;
  }

  const globalCleanup = await removeCometHooksForPlatform(
    options.globalBaseDir,
    platform,
    'global',
  );
  if (globalCleanup.failed > 0) {
    let reason = `project Router installed, but failed to remove ${globalCleanup.failed} historical global Hook configuration(s)`;
    if (platform.hookFormat === 'zcode') {
      const disabled = await installCometHooksForPlatform(
        projectRoot,
        platform,
        'project',
        workflowSelection,
        { disableZcodeRouter: true },
      );
      const cleanupError = globalCleanup.reason ? ` at ${globalCleanup.reason}` : '';
      const activation =
        disabled.status === 'installed'
          ? 'The project Router is disabled until you enable it in ZCode.'
          : `Disable the project Router in ZCode before continuing. Comet could not disable it: ${disabled.reason}`;
      reason = `Legacy ZCode user Hook cleanup failed${cleanupError}. ${activation} Fix the user configuration and rerun \`comet update --platform zcode --scope project --current-project --skip-self-update --yes\` before enabling the project Router.`;
    }
    return { status: 'failed', cleanupFailed: globalCleanup.failed, reason };
  }
  return activationMessage && globalCleanup.removed > 0
    ? { ...installed, reason: `Removed the legacy user-scoped Comet Hook. ${activationMessage}` }
    : installed;
}
