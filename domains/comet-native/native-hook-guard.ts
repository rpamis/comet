import { promises as fs } from 'fs';
import path from 'path';

import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
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
import {
  isNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
  returnNativePortableChangeToBuild,
  returnNativePortableChangeToShape,
} from './native-portable-runtime.js';
import type { NativePortableState } from './native-portable-types.js';

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
  changes: Array<
    { kind: 'legacy'; state: NativeChangeState } | { kind: 'portable'; state: NativePortableState }
  >;
}

async function inspectPortableWriteTargets(options: {
  projectRoot: string;
  paths: NativeProjectPaths;
  state: NativePortableState;
  request: NativeHookRequest;
}): Promise<NativeHookGuardResult> {
  const { projectRoot, paths, state, request } = options;
  const changeDir = nativePortableChangeDir(paths, state.name);
  const formalTargets: string[] = [];
  const implementationTargets: string[] = [];
  let controlTarget = false;
  let externalTarget = false;

  for (const targetPath of request.targets) {
    const target = path.resolve(projectRoot, targetPath);
    if (!isWithin(projectRoot, target)) {
      externalTarget = true;
      continue;
    }
    const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
    if (relative === '.comet/config.yaml') {
      controlTarget = true;
      continue;
    }
    if (!isWithin(paths.nativeRoot, target)) {
      implementationTargets.push(relative);
      continue;
    }
    if (!isWithin(changeDir, target)) {
      return {
        allowed: false,
        reason: 'Portable Native control state is Runtime-owned',
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      };
    }
    const changeRelative = path.relative(changeDir, target).replaceAll('\\', '/');
    if (changeRelative === 'brief.md' || changeRelative.startsWith('specs/')) {
      formalTargets.push(changeRelative);
      continue;
    }
    return {
      allowed: false,
      reason: `${changeRelative || 'change directory'} is Runtime-owned and cannot be edited by the Agent`,
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }

  if (formalTargets.length > 0 && implementationTargets.length > 0) {
    return {
      allowed: false,
      reason:
        'Formal Native requirements and implementation files must be edited in separate actions',
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }
  if (formalTargets.length > 0) {
    if (state.phase !== 'shape') {
      const returned = await returnNativePortableChangeToShape({
        paths,
        name: state.name,
        reason: `Formal requirement write requested for ${formalTargets.join(', ')}`,
      });
      return {
        allowed: true,
        reason: `Native requirements changed; returned to Shape goal cycle ${returned.loop.goal_cycle}`,
        workflow: 'native',
        phase: 'shape',
        change: state.name,
      };
    }
    return {
      allowed: true,
      reason: 'Native control artifact write',
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }
  if (implementationTargets.length > 0) {
    if (state.phase === 'build') {
      return {
        allowed: true,
        reason: 'Native change is in Build',
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      };
    }
    if (state.phase === 'verify' || state.phase === 'archive') {
      const returned = await returnNativePortableChangeToBuild({
        paths,
        name: state.name,
        reason: `Observed implementation write before ${implementationTargets.join(', ')}`,
      });
      return {
        allowed: true,
        reason: `Native candidate was invalidated and returned to Build iteration ${returned.loop.iteration}`,
        workflow: 'native',
        phase: 'build',
        change: state.name,
      };
    }
    return {
      allowed: false,
      reason: `Native change ${state.name} is in ${state.phase}; implementation writes are only allowed in Build`,
      workflow: 'native',
      phase: state.phase,
      change: state.name,
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
    phase: state.phase,
    change: state.name,
  };
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

async function activeNativeContextImpl(projectRoot: string): Promise<ActiveNativeContext | null> {
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

  const changes: ActiveNativeContext['changes'] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (await isNativePortableChange(paths, entry.name)) {
      const state = await readNativePortableChange(paths, entry.name);
      if (!state.archived) changes.push({ kind: 'portable', state });
    } else {
      const state = await readNativeChange(paths, entry.name);
      if (!state.archived) changes.push({ kind: 'legacy', state });
    }
  }
  return { paths, changes };
}

// `activeNativeContext` is invoked once by `listActiveNativeHookChanges`
// (router) and again by `inspectNativeHookGuard`. Within a single Hook
// decision the changes directory is immutable, so memoize the enumeration to
// avoid a second readdir + per-change state read.
const activeNativeContext = memoizedHookRead('nativeActiveContext', (projectRoot: string) =>
  activeNativeContextImpl(projectRoot),
);

export async function listActiveNativeHookChanges(
  projectRoot: string,
): Promise<ActiveNativeHookChange[]> {
  const context = await activeNativeContext(projectRoot);
  return (context?.changes ?? []).map((change) => ({
    workflow: 'native',
    name: change.state.name,
    phase: change.state.phase,
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

  let change: ActiveNativeContext['changes'][number] | undefined;
  if (selectedChangeName) {
    change = context.changes.find((candidate) => candidate.state.name === selectedChangeName);
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
    change = context.changes.find((candidate) => candidate.state.name === selectedName);
    if (!change) {
      return {
        allowed: false,
        reason:
          'Multiple Native changes are active; select the change to resume before writing code',
        workflow: 'native',
      };
    }
  }

  const state = change.state;
  if (change.kind === 'legacy' && state.phase === 'build') {
    return {
      allowed: true,
      reason: 'Native change is in Build',
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }
  if (request.intent === 'unknown' || request.targets.length === 0) {
    return {
      allowed: true,
      reason: 'Hook write target was not attributed to the guarded project',
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }
  if (change.kind === 'portable') {
    return inspectPortableWriteTargets({
      projectRoot,
      paths: context.paths,
      state: change.state,
      request,
    });
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
    if (relative === '.comet/config.yaml') {
      controlTarget = true;
      continue;
    }
    if (isWithin(context.paths.nativeRoot, target)) {
      controlTarget = true;
      continue;
    }
    return {
      allowed: false,
      reason: `Native change ${state.name} is in ${state.phase}; implementation writes are only allowed in build. If this belongs to the current change, confirm the scope and run comet native next ${state.name} --summary "<reason>" --return-to-build; otherwise create or select a separate Native change`,
      workflow: 'native',
      phase: state.phase,
      change: state.name,
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
    phase: state.phase,
    change: state.name,
  };
}
