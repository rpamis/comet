import { promises as fs } from 'fs';
import path from 'path';

import { parseCometHookRequest, readCometHookRequest } from '../comet-entry/hook-adapter.js';
import type {
  CometHookDecision,
  CometHookIntent,
  CometHookRequest,
} from '../comet-entry/hook-types.js';
import { readNativeChange } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { resolveSelectedNativeChange } from './native-selection.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';

export type NativeHookIntent = CometHookIntent;
export interface NativeHookRequest extends Omit<CometHookRequest, 'toolName'> {
  toolName?: string | null;
}

export type NativeHookGuardResult = CometHookDecision;

export interface ActiveNativeHookChange {
  workflow: 'native';
  name: string;
  phase: NativeChangeState['phase'];
}

interface ActiveNativeContext {
  paths: NativeProjectPaths;
  changes: NativeChangeState[];
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requestTargetsAreControlOnly(
  projectRoot: string,
  nativeRoot: string,
  request: NativeHookRequest,
): boolean {
  return (
    request.targets.length > 0 &&
    request.targets.every((targetPath) => {
      const target = path.resolve(projectRoot, targetPath);
      if (!isWithin(projectRoot, target)) return true;
      const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
      return relative === '.comet/config.yaml' || isWithin(nativeRoot, target);
    })
  );
}

async function activeNativeContext(projectRoot: string): Promise<ActiveNativeContext | null> {
  const config = await readProjectConfig(projectRoot);
  if (!config || !(config.workflows ?? [config.default_workflow]).includes('native')) return null;

  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  let entries;
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { paths, changes: [] };
    throw error;
  }

  const changes: NativeChangeState[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const state = await readNativeChange(paths, entry.name);
    if (!state.archived) changes.push(state);
  }
  return { paths, changes };
}

export async function listActiveNativeHookChanges(
  projectRoot: string,
): Promise<ActiveNativeHookChange[]> {
  const context = await activeNativeContext(projectRoot);
  return (context?.changes ?? []).map((change) => ({
    workflow: 'native',
    name: change.name,
    phase: change.phase,
  }));
}

export function parseNativeHookRequest(source: string): NativeHookRequest {
  const { intent, targets } = parseCometHookRequest(source);
  return { intent, targets };
}

export async function readNativeHookRequest(): Promise<NativeHookRequest> {
  const { intent, targets } = await readCometHookRequest();
  return { intent, targets };
}

export async function inspectNativeHookGuard(
  projectRoot: string,
  request: NativeHookRequest,
  selectedChangeName?: string,
): Promise<NativeHookGuardResult> {
  const context = await activeNativeContext(projectRoot);
  if (!context) return { allowed: true, reason: 'Native workflow is not enabled' };
  if (request.intent === 'non-write') {
    return { allowed: true, reason: 'Hook event is not a write' };
  }
  if (context.changes.length === 0) {
    return {
      allowed: true,
      reason: requestTargetsAreControlOnly(projectRoot, context.paths.nativeRoot, request)
        ? 'Native control artifact write'
        : 'No Native changes exist',
    };
  }

  let change: NativeChangeState | undefined;
  if (selectedChangeName) {
    change = context.changes.find((candidate) => candidate.name === selectedChangeName);
    if (!change) {
      return {
        allowed: false,
        reason: `Selected Native change ${selectedChangeName} is missing or archived; resume /comet-native before retrying`,
        workflow: 'native',
        change: selectedChangeName,
      };
    }
  } else if (context.changes.length === 1) {
    change = context.changes[0];
  } else {
    const selectedName = await resolveSelectedNativeChange(context.paths);
    change = context.changes.find((candidate) => candidate.name === selectedName);
    if (!change) {
      return {
        allowed: false,
        reason:
          'Multiple Native changes are active; select the change to resume before writing code',
        workflow: 'native',
      };
    }
  }

  if (change.phase === 'build') {
    return {
      allowed: true,
      reason: 'Native change is in Build',
      workflow: 'native',
      phase: change.phase,
      change: change.name,
    };
  }
  if (request.intent === 'unknown' || request.targets.length === 0) {
    return {
      allowed: false,
      reason: `Hook write target could not be determined while Native change ${change.name} is in ${change.phase}; resume /comet-native before retrying`,
      workflow: 'native',
      phase: change.phase,
      change: change.name,
    };
  }

  let controlTarget = false;
  let externalTarget = false;
  for (const targetPath of request.targets) {
    const target = path.resolve(projectRoot, targetPath);
    if (!isWithin(projectRoot, target)) {
      externalTarget = true;
      continue;
    }
    const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
    if (relative === '.comet/config.yaml' || isWithin(context.paths.nativeRoot, target)) {
      controlTarget = true;
      continue;
    }
    return {
      allowed: false,
      reason: `Native change ${change.name} is in ${change.phase}; implementation writes are only allowed in build. Resume /comet-native to continue safely`,
      workflow: 'native',
      phase: change.phase,
      change: change.name,
    };
  }

  return {
    allowed: true,
    reason: controlTarget
      ? 'Native control artifact write'
      : externalTarget
        ? 'Write target is outside the guarded project'
        : 'No guarded write target was provided',
    workflow: 'native',
    phase: change.phase,
    change: change.name,
  };
}
