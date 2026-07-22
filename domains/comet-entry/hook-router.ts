import {
  inspectClassicHookGuard,
  listActiveClassicHookChanges,
} from '../comet-classic/classic-hook-guard.js';
import { resolveCurrentChange } from '../comet-classic/classic-current-change.js';
import {
  inspectNativeHookGuard,
  listActiveNativeHookChanges,
} from '../comet-native/native-hook-guard.js';
import { readProjectConfig } from '../comet-native/native-config.js';
import { readCometCurrentSelection } from './current-selection.js';
import type { CometHookDecision, CometHookRequest } from './hook-types.js';
import type { CometWorkflow } from './types.js';

export interface ActiveHookChange {
  workflow: CometWorkflow;
  name: string;
  phase: string;
}

export type HookWorkflowOwnerResolution =
  | { status: 'none' }
  | { status: 'owned' | 'inferred'; owner: ActiveHookChange }
  | { status: 'ambiguous'; candidates: ActiveHookChange[] }
  | {
      status: 'stale';
      code:
        | 'selection-unreadable'
        | 'change-state-unreadable'
        | 'workflow-disabled'
        | 'target-missing'
        | 'classic-selection-invalid';
      reason: string;
    };

interface HookRouterDependencies {
  listNative: typeof listActiveNativeHookChanges;
  listClassic: typeof listActiveClassicHookChanges;
  inspectNative: typeof inspectNativeHookGuard;
  inspectClassic: typeof inspectClassicHookGuard;
}

const DEFAULT_DEPENDENCIES: HookRouterDependencies = {
  listNative: listActiveNativeHookChanges,
  listClassic: listActiveClassicHookChanges,
  inspectNative: inspectNativeHookGuard,
  inspectClassic: inspectClassicHookGuard,
};

function enabledWorkflows(config: Awaited<ReturnType<typeof readProjectConfig>>): CometWorkflow[] {
  if (!config) return ['classic'];
  return config.workflows ?? [config.default_workflow];
}

export async function resolveHookWorkflowOwner(
  projectRoot: string,
  dependencies: Pick<HookRouterDependencies, 'listNative' | 'listClassic'> = DEFAULT_DEPENDENCIES,
): Promise<HookWorkflowOwnerResolution> {
  const config = await readProjectConfig(projectRoot);
  const enabled = enabledWorkflows(config);
  let current;
  try {
    current = await readCometCurrentSelection(projectRoot);
  } catch (error) {
    return {
      status: 'stale',
      code: 'selection-unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (current.status === 'selected') {
    const selection = current.selection;
    if (!enabled.includes(selection.workflow)) {
      return {
        status: 'stale',
        code: 'workflow-disabled',
        reason: `selected workflow '${selection.workflow}' is not enabled for this project`,
      };
    }
    let selectedCandidates: ActiveHookChange[];
    try {
      selectedCandidates =
        selection.workflow === 'native'
          ? await dependencies.listNative(projectRoot)
          : await dependencies.listClassic(projectRoot);
    } catch (error) {
      return {
        status: 'stale',
        code: 'change-state-unreadable',
        reason: `cannot safely enumerate active Comet changes: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const owner = selectedCandidates.find((candidate) => candidate.name === selection.change);
    if (!owner) {
      return {
        status: 'stale',
        code: 'target-missing',
        reason: `selected ${selection.workflow} change '${selection.change}' is missing or archived`,
      };
    }
    if (selection.workflow === 'classic') {
      const resolved = await resolveCurrentChange(projectRoot);
      if (resolved.status !== 'selected') {
        return {
          status: 'stale',
          code: 'classic-selection-invalid',
          reason:
            resolved.status === 'stale'
              ? resolved.reason
              : `selected Classic change '${selection.change}' is no longer active`,
        };
      }
    }
    return { status: 'owned', owner };
  }

  let native: ActiveHookChange[];
  let classic: ActiveHookChange[];
  try {
    [native, classic] = await Promise.all([
      enabled.includes('native') ? dependencies.listNative(projectRoot) : Promise.resolve([]),
      enabled.includes('classic') ? dependencies.listClassic(projectRoot) : Promise.resolve([]),
    ]);
  } catch (error) {
    return {
      status: 'stale',
      code: 'change-state-unreadable',
      reason: `cannot safely enumerate active Comet changes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const candidates: ActiveHookChange[] = [...native, ...classic];

  if (candidates.length === 0) return { status: 'none' };
  if (candidates.length === 1) return { status: 'inferred', owner: candidates[0] };
  return { status: 'ambiguous', candidates };
}

export async function inspectCometHook(
  projectRoot: string,
  request: CometHookRequest,
  dependencies: HookRouterDependencies = DEFAULT_DEPENDENCIES,
): Promise<CometHookDecision> {
  if (request.intent === 'non-write') {
    return { allowed: true, reason: 'Hook event is not a write' };
  }

  try {
    const resolution = await resolveHookWorkflowOwner(projectRoot, dependencies);
    if (resolution.status === 'none') {
      return { allowed: true, reason: 'No active Comet change' };
    }
    if (resolution.status === 'stale') {
      return {
        allowed: false,
        reason: `${resolution.reason}. Resume /comet-native or /comet-classic and select the current change before retrying`,
      };
    }
    if (resolution.status === 'ambiguous') {
      return {
        allowed: false,
        reason: `Multiple active Comet changes require one current selection: ${resolution.candidates
          .map((candidate) => `${candidate.workflow}:${candidate.name}`)
          .join(', ')}`,
      };
    }

    const owner = resolution.owner;
    return owner.workflow === 'native'
      ? dependencies.inspectNative(projectRoot, request, owner.name)
      : dependencies.inspectClassic(projectRoot, owner.name, request);
  } catch (error) {
    return {
      allowed: false,
      reason: `Comet Hook Router failed closed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
