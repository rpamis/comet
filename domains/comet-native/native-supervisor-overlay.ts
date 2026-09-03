import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeChildrenContract } from './native-children.js';
import {
  nativeSupervisorStateFile,
  readNativeSupervisorState,
  type NativeSupervisorState,
} from './native-supervisor.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export type NativeSupervisorOverlayInspection =
  | {
      status: 'missing' | 'compatible';
      file: string;
      message: string | null;
      snapshot: string | null;
    }
  | {
      status: 'repairable-legacy-overlay';
      file: string;
      message: string;
      snapshot: string;
    }
  | {
      status: 'incompatible';
      file: string;
      message: string;
      snapshot: string;
    };

const SUPERVISOR_KEYS = new Set([
  'schema',
  'stateVersion',
  'parent',
  'integration',
  'children',
  'history',
  'finalVerification',
]);
const INTEGRATION_KEYS = new Set([
  'branch',
  'worktree',
  'targetBranch',
  'targetCommit',
  'headCommit',
]);
const CHILD_KEYS = new Set([
  'name',
  'summary',
  'dependsOn',
  'status',
  'baseCommit',
  'candidateCommit',
  'verifiedCommit',
  'integrationCommit',
  'verification',
  'checks',
  'blocker',
  'projectRoot',
  'task',
]);
const FINAL_VERIFICATION_KEYS = new Set(['status', 'summary']);

function record(value: unknown, _label: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string,
): string | null {
  const actual = new Set(Object.keys(value));
  const missing = [...expected].filter((key) => !actual.has(key));
  const unexpected = [...actual].filter((key) => !expected.has(key));
  if (missing.length === 0 && unexpected.length === 0) return null;
  return `${label} fields must be exact (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`;
}

function sameArray(left: unknown, right: readonly unknown[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function incompatible(
  file: string,
  snapshot: string,
  message: string,
): NativeSupervisorOverlayInspection {
  return { status: 'incompatible', file, snapshot, message };
}

function isEmptySupervisorShell(
  value: unknown,
  state: NativePortableState,
  contract: NonNullable<Awaited<ReturnType<typeof readNativeChildrenContract>>>['contract'],
  parsed: NativeSupervisorState,
): string | null {
  const supervisor = record(value, 'Native Supervisor overlay');
  if (!supervisor) return 'Native Supervisor overlay must be a JSON object';
  const supervisorError = exactKeys(supervisor, SUPERVISOR_KEYS, 'Native Supervisor overlay');
  if (supervisorError) return supervisorError;
  if (parsed.stateVersion !== 1) return 'Native Supervisor overlay stateVersion is not 1';
  if (parsed.parent !== state.name) {
    return `Native Supervisor overlay parent ${parsed.parent} does not match ${state.name}`;
  }

  const integration = record(supervisor.integration, 'Native Supervisor integration');
  if (!integration) return 'Native Supervisor integration must be an object';
  const integrationError = exactKeys(
    integration,
    INTEGRATION_KEYS,
    'Native Supervisor integration',
  );
  if (integrationError) return integrationError;
  if (parsed.integration.headCommit !== parsed.integration.targetCommit) {
    return 'Native Supervisor integration headCommit has advanced beyond targetCommit';
  }

  if (!Array.isArray(supervisor.history) || supervisor.history.length !== 0) {
    return 'Native Supervisor overlay history is not empty';
  }

  const finalVerification = record(
    supervisor.finalVerification,
    'Native Supervisor finalVerification',
  );
  if (!finalVerification) return 'Native Supervisor finalVerification must be an object';
  const finalVerificationError = exactKeys(
    finalVerification,
    FINAL_VERIFICATION_KEYS,
    'Native Supervisor finalVerification',
  );
  if (finalVerificationError) return finalVerificationError;
  if (parsed.finalVerification.status !== 'pending' || parsed.finalVerification.summary !== null) {
    return 'Native Supervisor final verification already contains progress';
  }

  if (!Array.isArray(supervisor.children)) return 'Native Supervisor children must be an array';
  if (supervisor.children.length !== contract.children.length) {
    return 'Native Supervisor child count does not match the legacy children contract';
  }
  for (const [index, entry] of supervisor.children.entries()) {
    const child = record(entry, `Native Supervisor child ${index}`);
    if (!child) return `Native Supervisor child ${index} must be an object`;
    const childError = exactKeys(child, CHILD_KEYS, `Native Supervisor child ${index}`);
    if (childError) return childError;
    const definition = contract.children[index];
    if (
      child.name !== definition.name ||
      child.summary !== definition.summary ||
      !sameArray(child.dependsOn, definition.depends_on)
    ) {
      return `Native Supervisor child ${definition.name} does not match the legacy children contract`;
    }
    const expectedStatus = definition.depends_on.length === 0 ? 'ready' : 'pending';
    if (child.status !== expectedStatus) {
      return `Native Supervisor child ${definition.name} has progressed beyond its initial ${expectedStatus} status`;
    }
    if (
      child.baseCommit !== null ||
      child.candidateCommit !== null ||
      child.verifiedCommit !== null ||
      child.integrationCommit !== null ||
      child.verification !== null ||
      child.blocker !== null ||
      child.projectRoot !== null ||
      child.task !== null
    ) {
      return `Native Supervisor child ${definition.name} contains execution progress`;
    }
    if (!Array.isArray(child.checks) || child.checks.length !== 0) {
      return `Native Supervisor child ${definition.name} contains integration checks`;
    }
  }
  return null;
}

export async function inspectNativeSupervisorOverlay(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativeSupervisorOverlayInspection> {
  const file = nativeSupervisorStateFile(options.paths, options.state.name);
  let snapshot: string;
  try {
    const fileStat = await fs.lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return incompatible(file, '', 'Native Supervisor overlay is not a regular file');
    }
    snapshot = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', file, message: null, snapshot: null };
    }
    return incompatible(
      file,
      '',
      `Native Supervisor overlay cannot be read: ${(error as Error).message}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(snapshot);
  } catch (error) {
    return incompatible(
      file,
      snapshot,
      `Native Supervisor overlay is invalid JSON: ${(error as Error).message}`,
    );
  }

  const changeDir = path.join(options.paths.changesDir, options.state.name);
  let children: Awaited<ReturnType<typeof readNativeChildrenContract>>;
  try {
    children = await readNativeChildrenContract({
      changeDir,
      acceptanceIds: options.state.acceptance.map(({ id }) => id),
      policy: 'advisory',
    });
  } catch (error) {
    return incompatible(
      file,
      snapshot,
      `Native children contract cannot be validated: ${(error as Error).message}`,
    );
  }
  if (!children || children.contract.schema !== 'comet.native.children.v1') {
    return {
      status: 'compatible',
      file,
      message: 'The current Native children contract is not legacy children.v1',
      snapshot,
    };
  }

  let supervisor: NativeSupervisorState | null;
  try {
    supervisor = await readNativeSupervisorState(options.paths, options.state.name);
  } catch (error) {
    return incompatible(
      file,
      snapshot,
      `Native Supervisor overlay is invalid: ${(error as Error).message}`,
    );
  }
  if (!supervisor)
    return incompatible(file, snapshot, 'Native Supervisor overlay disappeared during inspection');
  const reason = isEmptySupervisorShell(parsedJson, options.state, children.contract, supervisor);
  return reason
    ? incompatible(file, snapshot, reason)
    : {
        status: 'repairable-legacy-overlay',
        file,
        message:
          'An exact unstarted v2 Supervisor overlay is stale beside a legacy children.v1 contract',
        snapshot,
      };
}

export async function removeNativeSupervisorOverlayIfUnchanged(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  expected: Extract<NativeSupervisorOverlayInspection, { status: 'repairable-legacy-overlay' }>;
}): Promise<void> {
  const current = await inspectNativeSupervisorOverlay({
    paths: options.paths,
    state: options.state,
  });
  if (
    current.status !== 'repairable-legacy-overlay' ||
    current.snapshot !== options.expected.snapshot
  ) {
    throw new Error('Native Supervisor overlay changed before the safe repair could be applied');
  }
  await fs.rm(current.file, { force: false });
}
