import { promises as fs } from 'fs';

import {
  validateNativeBrief,
  validateNativeSpecChanges,
  validateNativeVerification,
} from './native-artifacts.js';
import { canonicalHash } from './native-canonical-hash.js';
import { inspectNativeChange, nativeChangeDir } from './native-change.js';
import { nativeContinuation } from './native-continuation.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import { inspectNativeRuntimeStorage, nativeChangeArtifactPaths } from './native-paths.js';
import { captureNativeProtectedDirectoryGuard } from './native-protected-file.js';
import { inspectNativeRunConsistency } from './native-run-consistency.js';
import { readNativeSelectionRecord } from './native-selection.js';

import { inspectPendingNativeTransition } from './native-transition-journal.js';
import {
  inspectNativeTrajectoryTail,
  NativeTrajectoryRepairRequiredError,
} from './native-trajectory-recovery.js';
import type {
  NativeChangeArtifactPaths,
  NativeChangeState,
  NativeClarificationMode,
  NativeFinding,
  NativeProjectPaths,
  NativeStatusPageProjection,
  NativeStatusProjection,
} from './native-types.js';
import { projectNativeWorkspace } from './native-workspace.js';

function statusArtifactPaths(
  paths: NativeProjectPaths,
  name: string,
): NativeChangeArtifactPaths | undefined {
  try {
    return nativeChangeArtifactPaths(paths, name);
  } catch {
    // Status must still report malformed/untrusted directory names as invalid;
    // do not turn a diagnostic listing into a path-validation exception.
    return undefined;
  }
}

const NATIVE_STATUS_CURSOR_PATTERN =
  /^native-status-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

export const NATIVE_STATUS_PAGE_LIMITS = Object.freeze({
  maxItems: 24,
  maxChanges: 4_096,
  maxSerializedBytes: 512 * 1024,
});

function displayCommandArgs(args: readonly string[]): string {
  return args
    .map((value) => (/^[A-Za-z0-9_./:=+@-]+$/u.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

async function selectedName(paths: NativeProjectPaths): Promise<string | null> {
  return (await readNativeSelectionRecord(paths))?.change ?? null;
}

export function nativeNextCommand(
  state: NativeChangeState,
  archiveReady: boolean,
  evidenceRetreat = false,
  _clarificationMode?: NativeClarificationMode,
): string | null {
  return nativeContinuation({ state, archiveReady, evidenceRetreat }).command;
}

async function statusFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  const changeDir = nativeChangeDir(paths, state.name);
  const findings = [
    ...(await validateNativeBrief(changeDir, state.brief)).findings,
    ...(await validateNativeSpecChanges(paths, state)).findings,
    ...(await inspectNativeRunConsistency(paths, state)),
  ];
  if (state.phase === 'build') {
    try {
      const current = await collectNativeContractFiles({
        changeDir,
        briefRef: state.brief,
        specChanges: state.spec_changes,
      });
      if ((state.approved_contract_hash ?? null) !== current.contract.contractHash) {
        findings.push({
          code: 'contract-changed-after-approval',
          message:
            state.approval === null ||
            state.approved_contract_hash === null ||
            state.approved_contract_hash === undefined
              ? 'Native approval is not bound to a contract hash; re-confirm the current contract'
              : 'Native contract changed after approval; re-confirm the current contract',
        });
      }
    } catch (error) {
      findings.push({
        code: 'contract-inspection-invalid',
        message: `Native approved contract could not be inspected safely: ${(error as Error).message}`,
      });
    }
  }
  try {
    if (await inspectPendingNativeTransition(paths, state.name)) {
      findings.unshift({
        code: 'transition-incomplete',
        message: 'Native phase transition recovery is pending',
      });
    }
  } catch (error) {
    findings.unshift({
      code: 'transition-invalid',
      message: `Native transition journal is invalid: ${(error as Error).message}`,
    });
  }
  if (state.verification_report) {
    findings.push(
      ...(await validateNativeVerification(changeDir, state.verification_report)).findings,
    );
  } else if (
    state.phase === 'verify' ||
    state.phase === 'archive' ||
    state.verification_result === 'pass'
  ) {
    findings.push({
      code: 'verification-report-missing',
      message: 'Native change has no verification report',
    });
  }
  return findings;
}

export async function inspectNativeStatus(
  paths: NativeProjectPaths,
  name: string,
  _options?: {
    details?: boolean;
    acceptanceCursor?: string;
    includeConflictFindings?: boolean;
    clarificationMode?: NativeClarificationMode;
    maxVerifyFailures?: number;
  },
): Promise<NativeStatusProjection> {
  const selected = (await selectedName(paths)) === name;
  const runtime = await inspectNativeRuntimeStorage(paths, name);
  const workspace = await projectNativeWorkspace(paths, name);
  let state: NativeChangeState;
  try {
    const inspection = await inspectNativeChange(paths, name);
    if (inspection.status === 'migration-required' && inspection.state) {
      return {
        name,
        artifacts: statusArtifactPaths(paths, name),
        phase: inspection.state.phase,
        revision: 'revision' in inspection.state ? inspection.state.revision : null,
        approval: inspection.state.approval,
        verificationResult: inspection.state.verification_result,
        specChanges: inspection.state.spec_changes.length,
        selected,
        nextCommand: null,
        archiveReady: false,
        inspection: {
          freshness: 'stale',
          codes: ['migration-required'],
          reasonCount: 1,
          codesTruncated: false,
        },
        findingSummary: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false,
        },
        detailsCommand: `comet native status ${name} --details`,
        checkpoint: null,
        continuation: null,
        workspace,
        runtime,
        schema: inspection.schema,
        migrationRequired: true,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message,
      };
    }
    if (inspection.status !== 'current' || !inspection.state) {
      return {
        name,
        artifacts: statusArtifactPaths(paths, name),
        phase: 'invalid',
        revision: null,
        approval: null,
        verificationResult: 'pending',
        specChanges: 0,
        selected,
        nextCommand: null,
        archiveReady: false,
        inspection: {
          freshness: 'stale',
          codes: ['runtime-incompatible'],
          reasonCount: 1,
          codesTruncated: false,
        },
        findingSummary: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false,
        },
        detailsCommand: `comet native status ${name} --details`,
        checkpoint: null,
        continuation: null,
        workspace,
        runtime,
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message ?? `Native change ${name} is incompatible`,
      };
    }
    state = inspection.state as NativeChangeState;
  } catch (error) {
    return {
      name,
      artifacts: statusArtifactPaths(paths, name),
      phase: 'invalid',
      revision: null,
      approval: null,
      verificationResult: 'pending',
      specChanges: 0,
      selected,
      nextCommand: null,
      archiveReady: false,
      inspection: {
        freshness: 'stale',
        codes: ['change-invalid'],
        reasonCount: 1,
        codesTruncated: false,
      },
      findingSummary: {
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0,
        requiresUserDecision: false,
        codes: [],
        truncated: false,
      },
      detailsCommand: `comet native status ${name} --details`,
      checkpoint: null,
      continuation: null,
      workspace,
      runtime,
      error: (error as Error).message,
    };
  }
  const trajectory = await inspectNativeTrajectoryTail(paths, name);
  return {
    name: state.name,
    artifacts: statusArtifactPaths(paths, state.name),
    phase: state.phase,
    revision: state.revision,
    approval: state.approval,
    verificationResult: state.verification_result,
    specChanges: state.spec_changes.length,
    selected,
    nextCommand:
      trajectory.status === 'clean' ? 'comet native doctor ' + state.name + ' --repair' : null,
    archiveReady: false,
    inspection: {
      freshness: 'stale',
      codes: ['legacy-content-proof-removed'],
      reasonCount: 1,
      codesTruncated: false,
    },
    findingSummary: {
      total: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      requiresUserDecision: false,
      codes: [],
      truncated: false,
    },
    detailsCommand: null,
    checkpoint: null,
    continuation: null,
    workspace,
    runtime,
    schema: state.schema,
    migrationRequired: true,
    minimumRuntimeVersion: state.minimum_runtime_version,
    ...(trajectory.status === 'clean'
      ? {}
      : { error: new NativeTrajectoryRepairRequiredError(trajectory).message }),
  };
}

export async function listNativeChangeNames(paths: NativeProjectPaths): Promise<string[]> {
  let guard: Awaited<ReturnType<typeof captureNativeProtectedDirectoryGuard>>;
  try {
    guard = await captureNativeProtectedDirectoryGuard({
      root: paths.nativeRoot,
      directory: paths.changesDir,
      label: 'Native status changes directory',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  const directory = await fs.opendir(paths.changesDir);
  try {
    for await (const entry of directory) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      names.push(entry.name);
      if (names.length > NATIVE_STATUS_PAGE_LIMITS.maxChanges) {
        throw new Error(
          `Native status exceeds ${NATIVE_STATUS_PAGE_LIMITS.maxChanges} visible changes`,
        );
      }
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
    });
  }
  await guard.verify();
  return names.sort();
}

function nativeStatusCursor(namesHash: string, offset: number): string {
  const encodedOffset = offset.toString(36);
  const integrity = canonicalHash('comet.native.status-cursor.v1', { namesHash, offset });
  return `native-status-v1.${namesHash}.${encodedOffset}.${integrity}`;
}

function nativeStatusOffset(options: {
  namesHash: string;
  total: number;
  cursor?: string | null;
}): number {
  if (options.cursor === undefined || options.cursor === null) return 0;
  const match = NATIVE_STATUS_CURSOR_PATTERN.exec(options.cursor);
  if (!match) throw new Error('Native status cursor is invalid');
  if (match[1] !== options.namesHash) throw new Error('Native status cursor is stale');
  const offset = Number.parseInt(match[2], 36);
  if (
    !Number.isSafeInteger(offset) ||
    offset <= 0 ||
    offset >= options.total ||
    offset.toString(36) !== match[2]
  ) {
    throw new Error('Native status cursor offset is invalid');
  }
  const expected = canonicalHash('comet.native.status-cursor.v1', {
    namesHash: options.namesHash,
    offset,
  });
  if (match[3] !== expected) throw new Error('Native status cursor integrity check failed');
  return offset;
}

export async function listNativeStatusPage(
  paths: NativeProjectPaths,
  options?: {
    cursor?: string | null;
    clarificationMode?: NativeClarificationMode;
    maxVerifyFailures?: number;
  },
): Promise<NativeStatusPageProjection> {
  const names = await listNativeChangeNames(paths);
  const namesHash = canonicalHash('comet.native.status-names.v1', names);
  const offset = nativeStatusOffset({
    namesHash,
    total: names.length,
    cursor: options?.cursor,
  });
  const candidates = await Promise.all(
    names.slice(offset, offset + NATIVE_STATUS_PAGE_LIMITS.maxItems).map((name) =>
      inspectNativeStatus(paths, name, {
        includeConflictFindings: false,
        clarificationMode: options?.clarificationMode,
        maxVerifyFailures: options?.maxVerifyFailures,
      }),
    ),
  );
  const items: NativeStatusProjection[] = [];
  for (const candidate of candidates) {
    const trialItems = [...items, candidate];
    const nextOffset = offset + trialItems.length;
    const trial: NativeStatusPageProjection = {
      schema: 'comet.native.status-page.v1',
      total: names.length,
      offset,
      items: trialItems,
      nextCursor: nextOffset < names.length ? nativeStatusCursor(namesHash, nextOffset) : null,
      nextPageCommand:
        nextOffset < names.length
          ? displayCommandArgs([
              'comet',
              'native',
              'status',
              '--cursor',
              nativeStatusCursor(namesHash, nextOffset),
            ])
          : null,
      nextPageArgs:
        nextOffset < names.length
          ? ['comet', 'native', 'status', '--cursor', nativeStatusCursor(namesHash, nextOffset)]
          : null,
      limits: { ...NATIVE_STATUS_PAGE_LIMITS },
    };
    if (
      Buffer.byteLength(JSON.stringify(trial), 'utf8') >
      NATIVE_STATUS_PAGE_LIMITS.maxSerializedBytes
    ) {
      if (items.length === 0) {
        throw new Error('Native status item exceeds its page serialization budget');
      }
      break;
    }
    items.push(candidate);
  }
  const nextOffset = offset + items.length;
  const nextCursor = nextOffset < names.length ? nativeStatusCursor(namesHash, nextOffset) : null;
  const nextPageArgs = nextCursor ? ['comet', 'native', 'status', '--cursor', nextCursor] : null;
  return {
    schema: 'comet.native.status-page.v1',
    total: names.length,
    offset,
    items,
    nextCursor,
    nextPageCommand: nextPageArgs ? displayCommandArgs(nextPageArgs) : null,
    nextPageArgs,
    limits: { ...NATIVE_STATUS_PAGE_LIMITS },
  };
}

/** Compatibility projection for in-process callers; CLI consumers receive the resumable page. */
export async function listNativeStatus(
  paths: NativeProjectPaths,
  options?: { clarificationMode?: NativeClarificationMode; maxVerifyFailures?: number },
): Promise<NativeStatusProjection[]> {
  return (
    await listNativeStatusPage(paths, {
      clarificationMode: options?.clarificationMode,
      maxVerifyFailures: options?.maxVerifyFailures,
    })
  ).items;
}

export async function inspectNativeArtifactFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  return statusFindings(paths, state);
}
