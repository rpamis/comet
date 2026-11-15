import path from 'path';
import os from 'os';
import { promises as fs, realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  COMET_HOOK_PLATFORM_IDS,
  readCometHookRequest,
  renderCometHookDecision,
  type CometHookRequest,
} from '../../platform/process/hook-adapter.js';
import type { CometHookDecision } from '../workflow-contract/hook.js';
import type { ParsedArgs } from './hook-router-guard-entry.js';

const USAGE = 'Usage: comet-hook-router --platform <platform-id> [--project-root <project-root>]';

function parseArgs(args: readonly string[]): ParsedArgs {
  let platformId: string | undefined;
  let projectRoot: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--platform') {
      platformId = args[++index];
      continue;
    }
    if (arg === '--project-root') {
      projectRoot = args[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!platformId || platformId.startsWith('--')) throw new Error('--platform is required');
  if (!COMET_HOOK_PLATFORM_IDS.has(platformId)) {
    throw new Error(`unsupported Hook platform: ${platformId}`);
  }
  if (projectRoot?.startsWith('--')) throw new Error('--project-root requires a value');
  return { platformId, ...(projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}) };
}

/**
 * Cheap filesystem probe mirroring the heavy discovery boundaries: walk up
 * from the start directory; a `.comet` entry marks a possible project, a
 * `.git` entry is where discovery stops and reports that directory, whose
 * `.comet` absence was already checked this round. The home directory gets
 * the same pass the heavy discovery gives it, so a user-level `.comet` state
 * directory above the real project chain does not force the heavy path.
 */
async function hasCometTrace(startDirectory: string): Promise<boolean> {
  let cursor = path.resolve(startDirectory);
  try {
    if (!(await fs.stat(cursor)).isDirectory()) cursor = path.dirname(cursor);
  } catch {
    cursor = path.dirname(cursor);
  }
  const fallback = cursor;
  const home = path.resolve(os.homedir());
  while (true) {
    const isHomeBoundary = cursor === home && fallback !== home;
    if (!isHomeBoundary) {
      try {
        await fs.lstat(path.join(cursor, '.comet'));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    try {
      await fs.lstat(path.join(cursor, '.git'));
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

type CometHookGuardModule = typeof import('./hook-router-guard-entry.js');
let guardModule: Promise<CometHookGuardModule> | undefined;

// In source form this resolves to the sibling TS module. The runtime build
// rewrites the specifier to the sibling bundle `comet-hook-router-guard.mjs`,
// so the guard graph is only parsed when a decision actually needs it.
function loadCometHookGuard(): Promise<CometHookGuardModule> {
  guardModule ??= (async () => {
    try {
      // Match the CLI startup optimization for standalone Hook processes.
      // Missing support or an unwritable cache never changes the decision.
      const { enableCompileCache } = await import('node:module');
      enableCompileCache?.();
    } catch {
      // Continue with the same fresh Runtime reads when caching is unavailable.
    }
    return import('./hook-router-guard-entry.js');
  })();
  return guardModule;
}

/** Shared decision path for standalone Hooks and plugin events already read from stdin. */
export async function inspectCometHookRequest(
  parsed: ParsedArgs,
  request: CometHookRequest,
): Promise<CometHookDecision> {
  // 确定不写文件的事件不依赖项目配置或 Git worktree 归属。
  // context 事件仍进入项目发现，以便加载当前任务上下文。
  if (request.intent === 'non-write') {
    return { allowed: true, reason: 'Hook event is not a write' };
  } else if (!parsed.projectRoot && !request.cwd) {
    return { allowed: true, reason: 'No Comet project discovered' };
  } else if (
    request.intent !== 'write' &&
    !parsed.projectRoot &&
    request.cwd &&
    !(await hasCometTrace(request.cwd))
  ) {
    return { allowed: true, reason: 'No Comet project discovered' };
  } else {
    // 项目记录丢失时，写入事件仍须检查用户级 Runtime，不能按无项目记录直接放行。
    const guard = await loadCometHookGuard();
    return guard.runCometHookRouterGuard(parsed, request);
  }
}

export async function runCometHookRouter(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 64;
  }

  let decision: CometHookDecision;
  try {
    decision = await inspectCometHookRequest(parsed, await readCometHookRequest());
  } catch (error) {
    decision = {
      allowed: false,
      reason: `Comet Hook Router failed closed during project discovery: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const output = renderCometHookDecision(parsed.platformId, decision);
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr) process.stderr.write(output.stderr);
  return output.exitCode;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runCometHookRouter(argv);
}

export function isDirectEntry(
  entry: string | undefined,
  moduleUrl: string = import.meta.url,
): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return moduleUrl === pathToFileURL(entry).href;
  }
}

const entry = process.argv[1];
if (isDirectEntry(entry)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
