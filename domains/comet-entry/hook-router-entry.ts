import path from 'path';
import { promises as fs } from 'fs';

import { discoverNativeProject } from '../comet-native/native-paths.js';
import {
  COMET_HOOK_PLATFORM_IDS,
  readCometHookRequest,
  renderCometHookDecision,
} from './hook-adapter.js';
import { inspectCometHook } from './hook-router.js';
import type { CometHookDecision } from './hook-types.js';

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

export async function projectRootFrom(parsed: ParsedArgs): Promise<string | null> {
  if (parsed.projectRoot) return parsed.projectRoot;
  const discovered = await discoverNativeProject(process.cwd());
  for (const marker of [['.comet', 'config.yaml'], ['.git'], ['openspec', 'changes']]) {
    try {
      await fs.lstat(path.join(discovered, ...marker));
      return discovered;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  let cursor = path.resolve(process.cwd());
  while (true) {
    try {
      await fs.lstat(path.join(cursor, 'openspec', 'changes'));
      return cursor;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
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
    const projectRoot = await projectRootFrom(parsed);
    decision = projectRoot
      ? await inspectCometHook(projectRoot, readCometHookRequest())
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

process.exitCode = await runCometHookRouter(process.argv.slice(2));
