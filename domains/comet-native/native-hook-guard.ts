import { promises as fs, readFileSync } from 'fs';
import path from 'path';

import { readNativeChange } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { resolveSelectedNativeChange } from './native-selection.js';

export interface NativeHookGuardResult {
  allowed: boolean;
  reason: string;
  phase?: string;
  change?: string;
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function readNativeHookTarget(): Promise<string | null> {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (process.stdin.isTTY) return null;
  try {
    const source = readFileSync(0, 'utf8');
    if (!source.trim()) return null;
    const input = JSON.parse(source) as {
      tool_input?: { file_path?: unknown; path?: unknown };
      file_path?: unknown;
    };
    const target = input.tool_input?.file_path ?? input.tool_input?.path ?? input.file_path;
    return typeof target === 'string' && target.length > 0 ? target : null;
  } catch {
    return null;
  }
}

export async function inspectNativeHookGuard(
  projectRoot: string,
  targetPath: string | null,
): Promise<NativeHookGuardResult> {
  const config = await readProjectConfig(projectRoot);
  if (!config || !(config.workflows ?? [config.default_workflow]).includes('native')) {
    return { allowed: true, reason: 'Native workflow is not enabled' };
  }
  if (!targetPath) return { allowed: true, reason: 'No write target was provided' };

  const target = path.resolve(projectRoot, targetPath);
  if (!isWithin(projectRoot, target)) {
    return { allowed: true, reason: 'Write target is outside the guarded project' };
  }

  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
  if (relative === '.comet/config.yaml' || isWithin(paths.nativeRoot, target)) {
    return { allowed: true, reason: 'Native control artifact write' };
  }
  if (relative.startsWith('.')) {
    return { allowed: true, reason: 'Platform configuration write' };
  }

  let entries;
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { allowed: true, reason: 'No Native changes exist' };
    }
    throw error;
  }

  const active = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const state = await readNativeChange(paths, entry.name);
    if (!state.archived) active.push(state);
  }
  if (active.length === 0) return { allowed: true, reason: 'No active Native change' };
  let change = active[0];
  if (active.length > 1) {
    const selectedName = await resolveSelectedNativeChange(paths);
    const selected = active.find((candidate) => candidate.name === selectedName);
    if (!selected) {
      return {
        allowed: false,
        reason:
          'Multiple Native changes are active; select the change to resume before writing code',
      };
    }
    change = selected;
  }

  if (change.phase === 'build') {
    return {
      allowed: true,
      reason: 'Native change is in Build',
      phase: change.phase,
      change: change.name,
    };
  }
  return {
    allowed: false,
    reason: `Native change ${change.name} is in ${change.phase}; implementation writes are only allowed in build. Resume /comet-native to continue safely`,
    phase: change.phase,
    change: change.name,
  };
}
