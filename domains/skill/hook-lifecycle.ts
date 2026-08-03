import type { Platform } from '../../platform/install/platforms.js';
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
