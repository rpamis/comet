import path from 'path';
import { realpathSync } from 'fs';
import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

import { discoverNativeProject } from '../comet-native/native-paths.js';
import {
  assertClassicLayoutReadable,
  discoverClassicProject,
} from '../comet-classic/classic-layout.js';
import {
  COMET_HOOK_PLATFORM_IDS,
  readCometHookRequest,
  renderCometHookDecision,
} from './hook-adapter.js';
import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';
import { inspectCometHook } from './hook-router.js';
import type { CometHookDecision } from './hook-types.js';
import { resolveCometHookProjectRoot } from './hook-project-root.js';

const USAGE = 'Usage: comet-hook-router --platform <platform-id> [--project-root <project-root>]';

interface ParsedArgs {
  platformId: string;
  projectRoot?: string;
}

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

export async function projectRootFrom(
  parsed: ParsedArgs,
  request?: ReturnType<typeof readCometHookRequest>,
): Promise<string | null> {
  if (parsed.projectRoot) {
    return request ? resolveCometHookProjectRoot(parsed.projectRoot, request) : parsed.projectRoot;
  }
  // A Router without --project-root is a legacy/global installation. It must
  // use the host-provided working directory when one is available; the
  // process cwd is often the directory where the global Hook was installed,
  // not the project that owns the current tool request. Without a trusted
  // request cwd there is no safe project to inspect, so leave the legacy Hook
  // neutral instead of applying another project's phase guard.
  if (!request?.cwd) return null;

  const discoveryStart = request.cwd;
  const discovered = await discoverNativeProject(discoveryStart);
  for (const marker of [['.comet', 'config.yaml'], ['.git']]) {
    try {
      await fs.lstat(path.join(discovered, ...marker));
      return discovered;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const classic = await discoverClassicProject(discoveryStart);
  const layout = await assertClassicLayoutReadable(classic);
  try {
    await fs.lstat(layout.changesDir);
    return classic;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return null;
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
    const request = readCometHookRequest();
    const projectRoot = await projectRootFrom(parsed, request);
    decision = projectRoot
      ? await runWithHookReadCache(() => inspectCometHook(projectRoot, request))
      : { allowed: true, reason: 'No Comet project discovered' };
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
