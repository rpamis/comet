import { promises as fs } from 'fs';

import {
  validateNativeBrief,
  validateNativeSpecChanges,
  validateNativeVerification,
} from './native-artifacts.js';
import { projectNativeAcceptancePage } from './native-acceptance.js';
import { canonicalHash } from './native-canonical-hash.js';
import { inspectNativeChange, nativeChangeDir } from './native-change.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import { readNativeSelectionRecord } from './native-selection.js';
import { inspectNativeRunConsistency } from './native-run-consistency.js';
import {
  filterNativeContentSnapshotToProjectScope,
  readNativeBaselineManifest,
} from './native-snapshot.js';
import { inspectPendingNativeTransition } from './native-transition-journal.js';
import { nativeContinuation } from './native-continuation.js';
import { structureNativeFindings, summarizeNativeFindings } from './native-findings.js';
import {
  buildNativeResumeView,
  NATIVE_INSPECTION_REASON_DETAIL_BUDGET,
} from './native-resume-view.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import { inspectNativeChangeConflicts } from './native-conflict-inspection.js';
import { inspectNativeRepairStatus } from './native-repair-integration.js';
import { inspectNativeImplementationScopeFreshness } from './native-verification-runtime.js';
import {
  inspectNativeWorkspaceAdvisory,
  isNativeWorkspaceAdvisoryCode,
  readNativeWorkspaceIdentity,
} from './native-workspace.js';
import { captureNativeProtectedDirectoryGuard } from './native-protected-file.js';
import type {
  NativeChangeState,
  NativeClarificationMode,
  NativeFinding,
  NativeProjectPaths,
  NativeStatusPageProjection,
  NativeStatusProjection,
} from './native-types.js';

const NATIVE_STATUS_CURSOR_PATTERN =
  /^native-status-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

export const NATIVE_STATUS_PAGE_LIMITS = Object.freeze({
  maxItems: 24,
  maxChanges: 4_096,
  maxSerializedBytes: 512 * 1024,
});

async function selectedName(paths: NativeProjectPaths): Promise<string | null> {
  try {
    return (await readNativeSelectionRecord(paths))?.change ?? null;
  } catch {
    return null;
  }
}

export function nativeNextCommand(
  state: NativeChangeState,
  archiveReady: boolean,
  evidenceRetreat = false,
  clarificationMode?: NativeClarificationMode,
): string | null {
  if (state.phase === 'archive') {
    return archiveReady
      ? `comet native archive ${state.name} --dry-run`
      : evidenceRetreat
        ? `comet native next ${state.name} --summary "<summary>"`
        : null;
  }
  return `comet native next ${state.name} --summary "<summary>"${
    state.phase === 'shape' && clarificationMode === 'sequential' ? ' --confirmed' : ''
  }`;
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
  if (state.phase === 'shape' || state.phase === 'build') {
    try {
      const capturedBaseline = await readNativeBaselineManifest(paths, state.name);
      if (capturedBaseline === null) {
        findings.push({
          code: 'baseline-snapshot-missing',
          message: 'Native baseline is missing; restore a trusted baseline before advancing',
        });
      } else {
        const baseline = await filterNativeContentSnapshotToProjectScope(paths, capturedBaseline);
        if (!baseline.complete) {
          findings.push({
            code: 'baseline-snapshot-incomplete',
            message: `Native baseline is incomplete within the project-owned scope (${baseline.omittedCount} omitted entries); resolve the omissions before advancing`,
          });
        }
      }
    } catch (error) {
      findings.push({
        code: 'baseline-snapshot-invalid',
        message: `Native baseline could not be inspected safely: ${(error as Error).message}`,
      });
    }
  }
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
  options?: {
    details?: boolean;
    acceptanceCursor?: string;
    clarificationMode?: NativeClarificationMode;
  },
): Promise<NativeStatusProjection> {
  const selected = (await selectedName(paths)) === name;
  let state: NativeChangeState;
  try {
    const inspection = await inspectNativeChange(paths, name);
    if (inspection.status === 'migration-required' && inspection.state) {
      return {
        name,
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
        schema: inspection.schema,
        migrationRequired: true,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message,
      };
    }
    if (inspection.status !== 'current' || !inspection.state) {
      return {
        name,
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
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message ?? `Native change ${name} is incompatible`,
      };
    }
    state = inspection.state as NativeChangeState;
  } catch (error) {
    return {
      name,
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
      error: (error as Error).message,
    };
  }
  const resume = await buildNativeResumeView({ paths, state });
  let acceptancePage: NativeStatusProjection['acceptancePage'];
  if (options?.details && (state.phase === 'verify' || state.phase === 'archive')) {
    try {
      const contract = await collectNativeContractFiles({
        changeDir: nativeChangeDir(paths, state.name),
        briefRef: state.brief,
        specChanges: state.spec_changes,
      });
      acceptancePage = projectNativeAcceptancePage({
        criteria: contract.contract.acceptance,
        acceptanceHash: contract.contract.acceptanceHash,
        ...(options.acceptanceCursor ? { cursor: options.acceptanceCursor } : {}),
      });
    } catch (error) {
      if (options.acceptanceCursor) throw error;
      acceptancePage = undefined;
    }
  }
  const conflictFindings: NativeFinding[] = [];
  try {
    const conflicts = await inspectNativeChangeConflicts(paths, state.name);
    conflictFindings.push(
      ...conflicts.findingCodes.map((code) => ({
        code,
        message: `Native change overlap is visible in the current root: ${code}`,
      })),
    );
  } catch {
    conflictFindings.push({
      code: 'native-conflict-inspection-invalid',
      message: 'Native change overlap could not be recomputed safely',
    });
  }
  const workspaceFindings: NativeFinding[] = [];
  try {
    const identity = await readNativeWorkspaceIdentity(paths, state.name);
    if (identity) {
      const workspace = await inspectNativeWorkspaceAdvisory({
        paths,
        identity,
      });
      workspaceFindings.push(
        ...workspace.findingCodes.map((code) => ({
          code,
          message: `Native workspace advisory changed: ${code} (${workspace.driftComponents.join(', ') || 'no-component'})`,
        })),
      );
    }
  } catch {
    workspaceFindings.push({
      code: 'workspace-inspection-unavailable',
      message: 'Native workspace advisory could not be recomputed safely',
    });
  }
  const verifyScopeFindings: NativeFinding[] = [];
  let verifyEvidenceRetreat = false;
  if (state.phase === 'verify') {
    const freshness = await inspectNativeImplementationScopeFreshness({ paths, state });
    verifyEvidenceRetreat = freshness.freshness !== 'fresh';
    verifyScopeFindings.push(
      ...freshness.findingCodes.map((code) => ({
        code,
        message: `Native Verify implementation scope is not current: ${code}`,
      })),
    );
  }
  let repair: Awaited<ReturnType<typeof inspectNativeRepairStatus>> = null;
  const repairFindings: NativeFinding[] = [];
  if (state.phase === 'build' && state.verification_result === 'fail') {
    try {
      repair = await inspectNativeRepairStatus(paths, state);
      if (repair) {
        const code =
          repair.disposition === 'hard-stop'
            ? 'repair-iteration-limit'
            : repair.overrideRecorded
              ? 'repair-override-exhausted'
              : 'repair-stagnation-stop';
        repairFindings.push({
          code,
          message: `Native repair is stopped at failure signature: ${repair.signatureHash}`,
        });
      }
    } catch {
      repairFindings.push({
        code: 'trajectory-invalid',
        message: 'Native repair history could not be reconstructed safely',
      });
    }
  }
  let archivePreflight: Awaited<ReturnType<typeof inspectNativeArchivePreflight>> | null = null;
  const archiveFindings: NativeFinding[] = [];
  if (state.phase === 'archive') {
    try {
      archivePreflight = await inspectNativeArchivePreflight({ paths, name: state.name });
      archiveFindings.push(
        ...archivePreflight.findingCodes.map((code) => ({
          code,
          message: `Native Archive is blocked: ${code}`,
        })),
      );
    } catch {
      archiveFindings.push({
        code: 'archive-preflight-invalid',
        message: 'Native Archive preflight could not be recomputed safely',
      });
    }
  }
  const rawFindings = [
    ...(await statusFindings(paths, state)),
    ...resume.findings,
    ...conflictFindings,
    ...workspaceFindings,
    ...verifyScopeFindings,
    ...repairFindings,
    ...archiveFindings,
  ].filter(
    (finding, index, values) =>
      values.findIndex(
        (candidate) => candidate.code === finding.code && candidate.path === finding.path,
      ) === index,
  );
  const findings = structureNativeFindings({ paths, state, findings: rawFindings });
  const archiveBlockingFindings = findings.filter(
    (finding) => !isNativeWorkspaceAdvisoryCode(finding.code),
  );
  const archiveReady =
    state.phase === 'archive' &&
    archivePreflight?.ready === true &&
    archiveBlockingFindings.length === 0;
  const evidenceRetreat =
    verifyEvidenceRetreat ||
    (state.phase === 'archive' &&
      (archivePreflight?.findingCodes ?? []).some((code) =>
        new Set([
          'verification-evidence-stale',
          'verification-evidence-invalid',
          'verification-evidence-missing',
          'verification-contract-stale',
          'verification-implementation-stale',
          'verification-report-stale',
          'verification-state-mismatch',
        ]).has(code),
      ));
  const mutationBlocked = findings.some(
    (finding) =>
      finding.code === 'trajectory-tail-incomplete' || finding.code === 'trajectory-invalid',
  );
  const repairBlocked = repair !== null;
  const firstErrorFinding = findings.find((finding) => finding.severity === 'error');
  return {
    name: state.name,
    phase: state.phase,
    revision: state.revision,
    approval: state.approval,
    verificationResult: state.verification_result,
    specChanges: state.spec_changes.length,
    selected,
    nextCommand:
      mutationBlocked || repairBlocked
        ? null
        : nativeNextCommand(state, archiveReady, evidenceRetreat, options?.clarificationMode),
    archiveReady,
    inspection: resume.inspection,
    findingSummary: summarizeNativeFindings(findings),
    detailsCommand: `comet native status ${state.name} --details`,
    checkpoint: resume.checkpoint,
    continuation: nativeContinuation({
      state,
      findings,
      archiveReady,
      evidenceRetreat,
      clarificationMode: options?.clarificationMode,
    }),
    repair,
    ...(options?.details
      ? {
          ...(acceptancePage ? { acceptancePage } : {}),
          findings: findings.slice(0, 50),
          inspectionDetails: resume.inspectionDetails,
          checkpointDetails: resume.checkpointDetails,
          budgets: {
            maxFindings: 50,
            maxInspectionReasons: NATIVE_INSPECTION_REASON_DETAIL_BUDGET,
            maxCheckpointArtifacts: resume.maxCheckpointArtifacts,
            findingsTruncated: findings.length > 50,
            inspectionReasonsTruncated: resume.inspectionDetails.reasonsTruncated,
            checkpointArtifactsTruncated: false,
          },
        }
      : {}),
    schema: state.schema,
    minimumRuntimeVersion: state.minimum_runtime_version,
    ...(firstErrorFinding ? { error: firstErrorFinding.message } : {}),
  };
}

async function boundedNativeChangeNames(paths: NativeProjectPaths): Promise<string[]> {
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
  options?: { cursor?: string | null; clarificationMode?: NativeClarificationMode },
): Promise<NativeStatusPageProjection> {
  const names = await boundedNativeChangeNames(paths);
  const namesHash = canonicalHash('comet.native.status-names.v1', names);
  const offset = nativeStatusOffset({
    namesHash,
    total: names.length,
    cursor: options?.cursor,
  });
  const candidates = await Promise.all(
    names.slice(offset, offset + NATIVE_STATUS_PAGE_LIMITS.maxItems).map((name) =>
      inspectNativeStatus(paths, name, {
        clarificationMode: options?.clarificationMode,
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
  return {
    schema: 'comet.native.status-page.v1',
    total: names.length,
    offset,
    items,
    nextCursor: nextOffset < names.length ? nativeStatusCursor(namesHash, nextOffset) : null,
    limits: { ...NATIVE_STATUS_PAGE_LIMITS },
  };
}

/** Compatibility projection for in-process callers; CLI consumers receive the resumable page. */
export async function listNativeStatus(
  paths: NativeProjectPaths,
  options?: { clarificationMode?: NativeClarificationMode },
): Promise<NativeStatusProjection[]> {
  return (
    await listNativeStatusPage(paths, {
      clarificationMode: options?.clarificationMode,
    })
  ).items;
}

export async function inspectNativeArtifactFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  return statusFindings(paths, state);
}
