import path from 'path';

import {
  inspectNativeCheckpointFreshness,
  NATIVE_CHECKPOINT_LIMITS,
  readNativeCheckpointJournal,
  nativeCheckpointJournalFile,
} from './native-checkpoint-storage.js';
import { nativeChangeDir } from './native-change.js';
import type {
  NativeChangeState,
  NativeCheckpointCompactView,
  NativeCheckpointDetailView,
  NativeFinding,
  NativeInspectionDetailView,
  NativeInspectionView,
  NativeProjectPaths,
} from './native-types.js';

const COMPACT_TEXT_BUDGET = 240;
const COMPACT_REASON_CODE_BUDGET = 8;
export const NATIVE_INSPECTION_REASON_DETAIL_BUDGET = 50;

function compactText(value: string): string {
  const characters = Array.from(value);
  return characters.length <= COMPACT_TEXT_BUDGET
    ? value
    : `${characters.slice(0, COMPACT_TEXT_BUDGET - 1).join('')}…`;
}

function reasonCode(reason: string): string {
  const separator = reason.indexOf(':');
  return separator < 0 ? reason : reason.slice(0, separator);
}

function inspectionViews(reasons: readonly string[]): {
  inspection: NativeInspectionView;
  inspectionDetails: NativeInspectionDetailView;
} {
  const codes = [...new Set(reasons.map(reasonCode))];
  const inspection: NativeInspectionView = {
    freshness:
      reasons.length === 0 || (reasons.length === 1 && reasons[0] === 'no-checkpoint')
        ? 'fresh'
        : 'stale',
    codes: codes.slice(0, COMPACT_REASON_CODE_BUDGET),
    reasonCount: reasons.length,
    codesTruncated: codes.length > COMPACT_REASON_CODE_BUDGET,
  };
  return {
    inspection,
    inspectionDetails: {
      ...inspection,
      reasons: reasons.slice(0, NATIVE_INSPECTION_REASON_DETAIL_BUDGET),
      reasonsTruncated: reasons.length > NATIVE_INSPECTION_REASON_DETAIL_BUDGET,
    },
  };
}

export async function buildNativeResumeView(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
}): Promise<{
  inspection: NativeInspectionView;
  inspectionDetails: NativeInspectionDetailView;
  checkpoint: NativeCheckpointCompactView | null;
  checkpointDetails: NativeCheckpointDetailView | null;
  findings: NativeFinding[];
  maxCheckpointArtifacts: number;
}> {
  let pendingFinding: NativeFinding | null = null;
  try {
    const pending = await readNativeCheckpointJournal(options.paths, options.state.name);
    if (pending) {
      pendingFinding = {
        code: 'checkpoint-progress-incomplete',
        message: `Native progress checkpoint ${pending.id} requires deterministic recovery`,
        path: nativeCheckpointJournalFile(options.paths, options.state.name),
      };
    }
  } catch (error) {
    pendingFinding = {
      code: 'checkpoint-progress-invalid',
      message: `Native progress checkpoint journal is invalid: ${(error as Error).message}. Automatic repair is unavailable; inspect and move the invalid checkpoint journal aside before retrying`,
      path: nativeCheckpointJournalFile(options.paths, options.state.name),
    };
  }
  const inspected = await inspectNativeCheckpointFreshness({
    paths: options.paths,
    name: options.state.name,
    stateRevision: options.state.revision,
  });
  const allReasons = pendingFinding
    ? [pendingFinding.code, ...inspected.reasons]
    : inspected.reasons;
  const views = inspectionViews(allReasons);
  if (!inspected.checkpoint) {
    return {
      inspection: views.inspection,
      inspectionDetails: views.inspectionDetails,
      checkpoint: null,
      checkpointDetails: null,
      findings: pendingFinding ? [pendingFinding, ...inspected.findings] : inspected.findings,
      maxCheckpointArtifacts: NATIVE_CHECKPOINT_LIMITS.maxArtifacts,
    };
  }
  const compact: NativeCheckpointCompactView = {
    id: inspected.checkpoint.id,
    createdAt: inspected.checkpoint.createdAt,
    phase: inspected.checkpoint.phase,
    stateRevision: inspected.checkpoint.stateRevision,
    summary: compactText(inspected.checkpoint.summary),
    nextAction: compactText(inspected.checkpoint.nextAction),
    artifactCount: inspected.checkpoint.artifactCount,
  };
  const details: NativeCheckpointDetailView | null = inspected.manifest
    ? {
        ...compact,
        summary: inspected.checkpoint.summary,
        nextAction: inspected.checkpoint.nextAction,
        manifestHash: inspected.checkpoint.manifestHash,
        manifestRef: path
          .relative(
            options.paths.projectRoot,
            path.join(
              nativeChangeDir(options.paths, options.state.name),
              ...inspected.checkpoint.manifestRef.split('/'),
            ),
          )
          .replaceAll('\\', '/'),
        artifacts: inspected.manifest.artifacts,
        totalBytes: inspected.manifest.totalBytes,
      }
    : null;
  return {
    inspection: views.inspection,
    inspectionDetails: views.inspectionDetails,
    checkpoint: compact,
    checkpointDetails: details,
    findings: pendingFinding ? [pendingFinding, ...inspected.findings] : inspected.findings,
    maxCheckpointArtifacts: NATIVE_CHECKPOINT_LIMITS.maxArtifacts,
  };
}
