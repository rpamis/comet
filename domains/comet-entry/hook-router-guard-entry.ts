import path from 'path';
import { promises as fs } from 'fs';

import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';
import { inspectCometHook, inspectCometRuntimeWriteTargets } from './hook-router.js';
import type { CometHookDecision } from '../workflow-contract/hook.js';
import type { CometHookRequest } from './hook-types.js';
import { resolveCometHookProjectRoot } from './hook-project-root.js';
import { readHookCurrentSelection } from '../workflow-contract/current-selection.js';
import { discoverCachedNativeProject, readCachedProjectConfig } from './entry-reads.js';

export interface ParsedArgs {
  platformId: string;
  projectRoot?: string;
}

export async function projectRootFrom(
  parsed: ParsedArgs,
  request?: CometHookRequest,
): Promise<string | null> {
  if (parsed.projectRoot) {
    const candidate = request
      ? await resolveCometHookProjectRoot(parsed.projectRoot, request)
      : parsed.projectRoot;
    if (request && (await inspectCometRuntimeWriteTargets(candidate, request, parsed.projectRoot)))
      return candidate;
    return configuredProjectFrom(candidate);
  }
  // A Router without --project-root is a legacy/global installation. It must
  // use the host-provided working directory when one is available; the
  // process cwd is often the directory where the global Hook was installed,
  // not the project that owns the current tool request. Without a trusted
  // request cwd there is no safe project to inspect, so leave the legacy Hook
  // neutral instead of applying another project's phase guard.
  if (!request?.cwd) return null;

  const discoveryStart = request.cwd;
  const discovered = await discoverCachedNativeProject(discoveryStart);
  if (await inspectCometRuntimeWriteTargets(discovered, request)) return discovered;
  return configuredProjectFrom(discoveryStart);
}

async function configuredProjectFrom(projectRoot: string): Promise<string | null> {
  let cursor = path.resolve(projectRoot);
  while (true) {
    const selection = await readHookCurrentSelection(cursor);
    if (selection.status === 'selected' && selection.selection.workflow === 'application')
      return cursor;
    try {
      await fs.lstat(path.join(cursor, '.git'));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const discovered = await discoverCachedNativeProject(projectRoot);
  return (await readCachedProjectConfig(discovered)) === null ? null : discovered;
}

/**
 * Heavy half of the Hook Router. The entry script keeps only the cheap
 * pre-checks and loads this module on demand, so requests that can be allowed
 * without project inspection never pay for the Classic/Native guard graph.
 */
export async function runCometHookRouterGuard(
  parsed: ParsedArgs,
  request: CometHookRequest,
): Promise<CometHookDecision> {
  return runWithHookReadCache(async () => {
    const projectRoot = await projectRootFrom(parsed, request);
    if (!projectRoot) return { allowed: true, reason: 'No Comet project discovered' };
    if (parsed.projectRoot && projectRoot !== parsed.projectRoot) {
      const runtimeDecision = await inspectCometRuntimeWriteTargets(
        projectRoot,
        request,
        parsed.projectRoot,
      );
      if (runtimeDecision) return runtimeDecision;
    }
    return inspectCometHook(projectRoot, request);
  });
}
