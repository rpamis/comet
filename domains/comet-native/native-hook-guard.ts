import { promises as fs } from 'fs';
import path from 'path';

import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import {
  parseCometHookRequest,
  readCometHookRequest,
} from '../../platform/process/hook-adapter.js';
import type { CometHookIntent, CometHookRequest } from '../../platform/process/hook-adapter.js';
import type { CometHookDecision } from '../workflow-contract/hook.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { configuredHookWritePath } from '../workflow-contract/hook-write-policy.js';
import { resolveSelectedNativeChange } from './native-selection.js';
import { NATIVE_DELTA_FILE } from './native-delta-spec.js';
import { NAME_PATTERN } from './native-portable-storage.js';
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

const NATIVE_CHANGE_CONTROL_FILES = new Set([
  'brief.md',
  'children.yaml',
  'comet-state.yaml',
  'verification.md',
  'capability-association.yaml',
]);

const NATIVE_CHANGE_RUNTIME_FILES = new Set([
  'comet-state.yaml',
  'verification.md',
  'capability-association.yaml',
]);

function isNativeSpecArtifactRelative(relative: string): boolean {
  const parts = relative.split('/');
  return (
    parts.length === 3 &&
    parts[0] === 'specs' &&
    parts[1] !== undefined &&
    NAME_PATTERN.test(parts[1]) &&
    (parts[2] === 'spec.md' || parts[2] === NATIVE_DELTA_FILE)
  );
}

function nativeFormalTargetReference(
  changesDir: string,
  target: string,
): { name: string; relative: string } | null {
  if (!isWithin(changesDir, target)) return null;
  const relative = path.relative(changesDir, target).replaceAll('\\', '/');
  const [name, ...rest] = relative.split('/');
  if (!name || !NAME_PATTERN.test(name)) return null;
  if (rest.length === 0) return { name, relative: '' };
  const changeRelative = rest.join('/');
  if (NATIVE_CHANGE_CONTROL_FILES.has(changeRelative)) return { name, relative: changeRelative };
  if (isNativeSpecArtifactRelative(changeRelative)) {
    return { name, relative: changeRelative };
  }
  return null;
}

function nativeRuntimeManagedTarget(paths: NativeProjectPaths, target: string): boolean {
  return (
    isWithin(paths.runtimeDir, target) ||
    path.relative(paths.projectRoot, target).replaceAll('\\', '/') === '.comet/current-change.json'
  );
}

function nativeKnownMisrootTarget(
  paths: NativeProjectPaths,
  target: string,
  registeredChanges: ReadonlySet<string>,
): { name: string; relative: string } | null {
  const knownCometRoot = path.join(paths.projectRoot, '.comet', 'comet');
  if (
    isWithin(paths.nativeRoot, target) ||
    path.resolve(knownCometRoot) === path.resolve(paths.nativeRoot)
  ) {
    return null;
  }
  const formal = nativeFormalTargetReference(path.join(knownCometRoot, 'changes'), target);
  return formal && registeredChanges.has(formal.name) ? formal : null;
}

function artifactResponsePath(relative: string): string {
  if (relative === 'brief.md') return 'data.artifacts.briefPath';
  if (relative === 'children.yaml') return 'data.artifacts.childrenPath';
  if (relative.startsWith('specs/')) return 'data.artifacts.specsDir';
  return 'data.artifacts.changeDir';
}

function nativeUnownedTargetDecision(
  projectRoot: string,
  paths: NativeProjectPaths,
  target: string,
  options: {
    allowCanonicalFormal?: boolean;
    registeredChanges?: ReadonlySet<string>;
  } = {},
): NativeHookGuardResult | null {
  if (!isWithin(projectRoot, target)) return null;
  if (nativeRuntimeManagedTarget(paths, target)) {
    const runtimeRelative = path.relative(paths.projectRoot, target).replaceAll('\\', '/');
    const runtimeChange = runtimeRelative.match(
      /^\.comet\/runtime\/native\/changes\/([^/]+)(?:\/|$)/u,
    )?.[1];
    return {
      allowed: false,
      reason: `Native Runtime-owned path ${runtimeRelative}. Run ${runtimeChange ? `comet native status ${runtimeChange} --json` : 'comet native status --json'} in ${paths.projectRoot}, follow its continuation, and retry; do not edit Runtime files directly.`,
      workflow: 'native',
      ...(runtimeChange ? { change: runtimeChange } : {}),
    };
  }
  const misroot = nativeKnownMisrootTarget(paths, target, options.registeredChanges ?? new Set());
  if (misroot) {
    const canonical = path.join(paths.changesDir, misroot.name, misroot.relative);
    return {
      allowed: false,
      reason: `Native formal artifact target ${path.relative(projectRoot, target).replaceAll('\\', '/')} is outside the configured artifact root. Use ${canonical} in ${paths.projectRoot}; read existing content and merge the original edit instead of overwriting it.`,
      workflow: 'native',
      change: misroot.name,
    };
  }
  const formal = nativeFormalTargetReference(paths.changesDir, target);
  if (!formal) return null;
  if (NATIVE_CHANGE_RUNTIME_FILES.has(formal.relative)) {
    const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
    return {
      allowed: false,
      reason: `Native Runtime-owned artifact ${relative}. Run comet native status ${formal.name} --json in ${paths.projectRoot} and follow its continuation; do not infer a mutation or edit the file directly.`,
      workflow: 'native',
      change: formal.name,
    };
  }
  if (options.allowCanonicalFormal === false) return null;
  const canonical = path.join(paths.changesDir, formal.name, formal.relative);
  return {
    allowed: false,
    reason: `Native formal artifact target ${path.relative(projectRoot, target).replaceAll('\\', '/')} is not registered. Run comet native new ${formal.name} in ${paths.projectRoot}. Use the response ${artifactResponsePath(formal.relative)} to locate ${canonical}; read initialized or existing content and merge the original edit instead of overwriting it.`,
    workflow: 'native',
    change: formal.name,
  };
}

function combineNativeTargetDecisions(
  decisions: readonly NativeHookGuardResult[],
): NativeHookGuardResult | null {
  if (decisions.length === 0) return null;
  if (decisions.length === 1) return decisions[0];
  return {
    ...decisions[0],
    reason: decisions.map((decision) => decision.reason).join('\n'),
  };
}

function foreignNativeFormalTargetDecision(
  projectRoot: string,
  paths: NativeProjectPaths,
  selectedChange: string,
  formal: { name: string; relative: string },
  target: string,
  registered: boolean,
): NativeHookGuardResult {
  const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
  const canonical = path.join(paths.changesDir, formal.name, formal.relative);
  return {
    allowed: false,
    reason: registered
      ? `Native formal artifact target ${relative} belongs to registered change ${formal.name}, not selected change ${selectedChange}. Run comet native select ${formal.name} in ${paths.projectRoot}, then read ${canonical} and merge the original edit.`
      : `Native formal artifact target ${relative} belongs to unregistered change ${formal.name}, not selected change ${selectedChange}. Run comet native new ${formal.name} --isolation worktree in ${paths.projectRoot}. Use the response ${artifactResponsePath(formal.relative)} to locate ${canonical}; read initialized or existing content and merge the original edit.`,
    workflow: 'native',
    change: selectedChange,
  };
}

interface ActiveNativeContext {
  paths: NativeProjectPaths;
  changes: Array<
    { kind: 'legacy'; state: NativeChangeState } | { kind: 'portable'; state: NativePortableState }
  >;
}

function implementationWriteDeniedReason(state: {
  name: string;
  phase: NativeChangeState['phase'] | NativePortableState['phase'];
}): string {
  const prefix = `Native change ${state.name} is in ${state.phase}; implementation writes are only allowed in Build.`;
  if (state.phase === 'shape') {
    return `${prefix} Reread the latest continuation, complete requirement clarification, and execute the Shape confirmation command after user confirmation.`;
  }
  if (state.phase === 'verify') {
    return `${prefix} Select and execute the matching commandAlternative from the latest continuation, preserving --expected-state-version and --expected-action.`;
  }
  if (state.phase === 'archive') {
    return `${prefix} Continue finalizing the accepted result; do not run Verify-only revision commands from Archive.`;
  }
  return `${prefix} Create or select a separate Native change if this write belongs to different work.`;
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
  const invalidFormalTargets: string[] = [];
  const implementationTargets: string[] = [];
  const targetDecisions: NativeHookGuardResult[] = [];
  let configuredTarget = false;
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
      if (
        await configuredHookWritePath(projectRoot, target, [
          path.join(projectRoot, '.comet'),
          paths.nativeRoot,
        ])
      ) {
        configuredTarget = true;
        continue;
      }
      implementationTargets.push(relative);
      continue;
    }
    if (!isWithin(changeDir, target)) {
      targetDecisions.push({
        allowed: false,
        reason: isWithin(paths.specsDir, target)
          ? `Published Native specs are updated through Archive. Stage the complete target spec in ${path.join(changeDir, 'specs', path.relative(paths.specsDir, target))}; use comet native spec sync for reference-only corrections, or revise-requirements for requirement changes.`
          : 'Portable Native control state is Runtime-owned',
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      });
      continue;
    }
    const changeRelative = path.relative(changeDir, target).replaceAll('\\', '/');
    if (
      changeRelative === 'brief.md' ||
      changeRelative === 'children.yaml' ||
      (changeRelative.startsWith('specs/') && isPortableFormalTarget(changeRelative))
    ) {
      formalTargets.push(changeRelative);
      continue;
    }
    if (changeRelative.startsWith('specs/')) {
      invalidFormalTargets.push(changeRelative);
      continue;
    }
    targetDecisions.push({
      allowed: false,
      reason: `${changeRelative || 'change directory'} is Runtime-owned and cannot be edited by the Agent`,
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    });
  }

  if (invalidFormalTargets.length > 0) {
    targetDecisions.push({
      allowed: false,
      reason: invalidFormalTargets.map(portableFormalTargetReason).join('\n'),
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    });
  }
  if (targetDecisions.length > 0) {
    return combineNativeTargetDecisions(targetDecisions)!;
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
    if (state.children_contract_hash) {
      return {
        allowed: false,
        reason: 'Native parent Build advances child changes instead of editing implementation',
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      };
    }
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
      reason: implementationWriteDeniedReason(state),
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    };
  }
  if (configuredTarget) {
    return {
      allowed: true,
      reason: 'Native configured Hook allow path',
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

function portableFormalTargetReason(changeRelative: string): string {
  const parts = changeRelative.split('/');
  const capability =
    parts[0] === 'specs' && parts[1] && NAME_PATTERN.test(parts[1]) ? parts[1] : null;
  const expected = capability
    ? `specs/${capability}/spec.md (or specs/${capability}/${NATIVE_DELTA_FILE} for delta metadata)`
    : `specs/<capability>/spec.md (or specs/<capability>/${NATIVE_DELTA_FILE} for delta metadata)`;
  return `Native formal Spec artifacts must use ${expected}; received ${changeRelative}`;
}

function isPortableFormalTarget(changeRelative: string): boolean {
  return isNativeSpecArtifactRelative(changeRelative);
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

/** Inspect only targets that can be attributed to Native before workflow ownership is resolved. */
export async function inspectNativeUnownedHookTargets(
  projectRoot: string,
  request: NativeHookRequest,
  options: { allowCanonicalFormal?: boolean } = {},
): Promise<NativeHookGuardResult | null> {
  if (request.intent !== 'write' || request.targets.length === 0) return null;
  const config = await readProjectConfig(projectRoot);
  if (!config || !(config.workflows ?? [config.default_workflow]).includes('native')) return null;
  const context = await activeNativeContext(projectRoot);
  if (!context) return null;
  const paths = context.paths;
  const registeredChanges = new Set(context.changes.map(({ state }) => state.name));
  const decisions: NativeHookGuardResult[] = [];
  for (const targetPath of request.targets) {
    const decision = nativeUnownedTargetDecision(
      projectRoot,
      paths,
      path.resolve(projectRoot, targetPath),
      {
        allowCanonicalFormal: options.allowCanonicalFormal ?? false,
        registeredChanges,
      },
    );
    if (decision) decisions.push(decision);
  }
  return combineNativeTargetDecisions(decisions);
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
    const decisions: NativeHookGuardResult[] = [];
    for (const targetPath of request.targets) {
      const decision = nativeUnownedTargetDecision(
        projectRoot,
        context.paths,
        path.resolve(projectRoot, targetPath),
      );
      if (decision) decisions.push(decision);
    }
    const combinedDecision = combineNativeTargetDecisions(decisions);
    if (combinedDecision) return combinedDecision;
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
  const registeredChanges = new Set(context.changes.map(({ state: candidate }) => candidate.name));
  const preDecisions: NativeHookGuardResult[] = [];
  for (const targetPath of request.targets) {
    const target = path.resolve(projectRoot, targetPath);
    const unowned = nativeUnownedTargetDecision(projectRoot, context.paths, target, {
      allowCanonicalFormal: false,
      registeredChanges,
    });
    if (unowned) {
      preDecisions.push(unowned);
      continue;
    }
    const formal = nativeFormalTargetReference(context.paths.changesDir, target);
    if (formal && formal.name !== state.name) {
      preDecisions.push(
        foreignNativeFormalTargetDecision(
          projectRoot,
          context.paths,
          state.name,
          formal,
          target,
          registeredChanges.has(formal.name),
        ),
      );
      continue;
    }
    if (!isWithin(projectRoot, target)) continue;
    if (isWithin(context.paths.specsDir, target)) {
      const selectedChangeDir =
        change.kind === 'portable'
          ? nativePortableChangeDir(context.paths, state.name)
          : nativeChangeDir(context.paths, state.name);
      preDecisions.push({
        allowed: false,
        reason: `Published Native specs are updated through Archive. Stage the complete target spec in ${path.join(selectedChangeDir, 'specs', path.relative(context.paths.specsDir, target))}; use comet native spec sync for reference-only corrections, or revise-requirements for requirement changes.`,
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      });
      continue;
    }
    if (!isWithin(context.paths.nativeRoot, target)) continue;
    const selectedChangeDir =
      change.kind === 'portable'
        ? nativePortableChangeDir(context.paths, state.name)
        : nativeChangeDir(context.paths, state.name);
    if (isWithin(selectedChangeDir, target)) {
      const changeRelative = path.relative(selectedChangeDir, target).replaceAll('\\', '/');
      if (
        changeRelative === 'brief.md' ||
        changeRelative === 'children.yaml' ||
        isNativeSpecArtifactRelative(changeRelative)
      ) {
        continue;
      }
      preDecisions.push({
        allowed: false,
        reason: changeRelative.startsWith('specs/')
          ? portableFormalTargetReason(changeRelative)
          : `${changeRelative || 'change directory'} is Runtime-owned. Run comet native status ${state.name} --json in ${context.paths.projectRoot} and follow its continuation; do not edit it directly.`,
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      });
      continue;
    }
    const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
    preDecisions.push({
      allowed: false,
      reason: `Native-managed path ${relative} is not an editable artifact for ${state.name}. Run comet native status ${state.name} --json in ${context.paths.projectRoot} and follow its continuation.`,
      workflow: 'native',
      phase: state.phase,
      change: state.name,
    });
  }
  const preDecision = combineNativeTargetDecisions(preDecisions);
  if (preDecision) return preDecision;
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
  let configuredTarget = false;
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
      const formal = nativeFormalTargetReference(context.paths.changesDir, target);
      if (formal?.name === state.name) {
        if (NATIVE_CHANGE_RUNTIME_FILES.has(formal.relative)) {
          return {
            allowed: false,
            reason: `Native control state is Runtime-owned; use the CLI for ${relative}`,
            workflow: 'native',
            phase: state.phase,
            change: state.name,
          };
        }
        controlTarget = true;
        continue;
      }
      return {
        allowed: false,
        reason: `Native control state is Runtime-owned; use the CLI for ${relative}`,
        workflow: 'native',
        phase: state.phase,
        change: state.name,
      };
    }
    if (
      await configuredHookWritePath(projectRoot, target, [
        path.join(projectRoot, '.comet'),
        context.paths.nativeRoot,
      ])
    ) {
      configuredTarget = true;
      continue;
    }
    return {
      allowed: false,
      reason: implementationWriteDeniedReason(state),
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
        : configuredTarget
          ? 'Native configured Hook allow path'
          : 'No guarded write target was provided',
    workflow: 'native',
    phase: state.phase,
    change: state.name,
  };
}
