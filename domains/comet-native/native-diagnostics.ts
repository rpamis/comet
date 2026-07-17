import { promises as fs, type Dirent } from 'fs';

import {
  validateNativeBrief,
  validateNativeSpecChanges,
  validateNativeVerification,
} from './native-artifacts.js';
import { inspectNativeChange, nativeChangeDir } from './native-change.js';
import { nativeSelectionFile } from './native-selection.js';
import { inspectNativeRunConsistency } from './native-run-consistency.js';
import { inspectPendingNativeTransition } from './native-transition-journal.js';
import { nativeContinuation } from './native-continuation.js';
import { structureNativeFindings, summarizeNativeFindings } from './native-findings.js';
import {
  buildNativeResumeView,
  NATIVE_INSPECTION_REASON_DETAIL_BUDGET,
} from './native-resume-view.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import type {
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
  NativeStatusProjection,
} from './native-types.js';

async function selectedName(paths: NativeProjectPaths): Promise<string | null> {
  try {
    const value = JSON.parse(await fs.readFile(nativeSelectionFile(paths), 'utf8')) as {
      schema?: unknown;
      change?: unknown;
    };
    return value.schema === 'comet.native.selection.v1' && typeof value.change === 'string'
      ? value.change
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export function nativeNextCommand(
  state: NativeChangeState,
  archiveReady: boolean,
  evidenceRetreat = false,
): string | null {
  if (state.phase === 'archive') {
    return archiveReady
      ? `comet native archive ${state.name} --dry-run`
      : evidenceRetreat
        ? `comet native next ${state.name} --summary "<summary>"`
        : null;
  }
  return `comet native next ${state.name} --summary "<summary>"`;
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
  options?: { details?: boolean },
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
    ...archiveFindings,
  ].filter(
    (finding, index, values) =>
      values.findIndex(
        (candidate) => candidate.code === finding.code && candidate.path === finding.path,
      ) === index,
  );
  const findings = structureNativeFindings({ paths, state, findings: rawFindings });
  const archiveReady =
    state.phase === 'archive' && archivePreflight?.ready === true && findings.length === 0;
  const evidenceRetreat =
    state.phase === 'archive' &&
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
    );
  const mutationBlocked = findings.some(
    (finding) =>
      finding.code === 'trajectory-tail-incomplete' || finding.code === 'trajectory-invalid',
  );
  return {
    name: state.name,
    phase: state.phase,
    revision: state.revision,
    approval: state.approval,
    verificationResult: state.verification_result,
    specChanges: state.spec_changes.length,
    selected,
    nextCommand: mutationBlocked ? null : nativeNextCommand(state, archiveReady, evidenceRetreat),
    archiveReady,
    inspection: resume.inspection,
    findingSummary: summarizeNativeFindings(findings),
    detailsCommand: `comet native status ${state.name} --details`,
    checkpoint: resume.checkpoint,
    continuation: nativeContinuation({ state, findings, archiveReady, evidenceRetreat }),
    ...(options?.details
      ? {
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
    ...(findings[0] ? { error: findings[0].message } : {}),
  };
}

export async function listNativeStatus(
  paths: NativeProjectPaths,
): Promise<NativeStatusProjection[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => inspectNativeStatus(paths, name)));
}

export async function inspectNativeArtifactFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  return statusFindings(paths, state);
}
