import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeBoundedTextFile } from '../comet-native/native-bounded-file.js';
import {
  NATIVE_CHANGE_STATE_FILE,
  readNativeChange,
  readNativeChangeFile,
} from '../comet-native/native-change.js';
import { inspectNativeArchivePreflight } from '../comet-native/native-archive-inspection.js';
import { readProjectConfig } from '../comet-native/native-config.js';
import { inspectNativeConflictRadar } from '../comet-native/native-conflict-inspection.js';
import { collectNativeContractFiles } from '../comet-native/native-contract-files.js';
import { listNativeStatusPage } from '../comet-native/native-diagnostics.js';
import {
  readNativeImplementationScope,
  readNativeVerificationEvidence,
} from '../comet-native/native-evidence-storage.js';
import { nativeProjectPaths, resolveContainedNativePath } from '../comet-native/native-paths.js';
import type { NativeChangeState, NativeProjectPaths } from '../comet-native/native-types.js';
import {
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
  type NativeDashboardArtifactPreview,
  type NativeDashboardAcceptanceSummary,
  type NativeDashboardChangeProjection,
  type NativeDashboardImplementationSummary,
  type NativeDashboardSpecSummary,
  type NativeDashboardProjection,
} from './native-adapter.js';

const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;

function artifactDescriptors(state: NativeChangeState): Array<[string, string, string]> {
  const descriptors: Array<[string, string, string]> = [['brief', '需求简报', state.brief]];
  for (const spec of state.spec_changes) {
    if (!spec.source) continue;
    descriptors.push([`spec-${spec.capability}`, `${spec.capability} Spec`, spec.source]);
  }
  if (state.verification_report) {
    descriptors.push(['verification', '验证报告', state.verification_report]);
  }
  return descriptors.slice(0, NATIVE_DASHBOARD_LIMITS.maxArtifactPreviews);
}

async function readArtifactPreview(
  root: string,
  [key, label, ref]: [string, string, string],
): Promise<NativeDashboardArtifactPreview> {
  const preview: NativeDashboardArtifactPreview = {
    key,
    label,
    path: ref,
    exists: false,
  };
  try {
    const artifact = await readNativeBoundedTextFile({ root, ref });
    const bytes = Buffer.from(artifact.text, 'utf8');
    const truncated = bytes.length > NATIVE_DASHBOARD_LIMITS.maxArtifactPreviewBytes;
    return {
      ...preview,
      exists: true,
      content: truncated
        ? bytes.subarray(0, NATIVE_DASHBOARD_LIMITS.maxArtifactPreviewBytes).toString('utf8')
        : artifact.text,
      truncated,
      size: artifact.size,
    };
  } catch {
    return preview;
  }
}

async function collectArtifacts(
  changeDir: string,
  state: NativeChangeState,
): Promise<NativeDashboardArtifactPreview[]> {
  return Promise.all(
    artifactDescriptors(state).map((descriptor) => readArtifactPreview(changeDir, descriptor)),
  );
}

function specSummary(state: NativeChangeState): NativeDashboardSpecSummary {
  const capabilities = [...state.spec_changes]
    .sort((left, right) => left.capability.localeCompare(right.capability))
    .slice(0, NATIVE_DASHBOARD_LIMITS.maxCapabilities)
    .map(({ capability, operation }) => ({ capability, operation }));
  return {
    total: state.spec_changes.length,
    create: state.spec_changes.filter(({ operation }) => operation === 'create').length,
    replace: state.spec_changes.filter(({ operation }) => operation === 'replace').length,
    remove: state.spec_changes.filter(({ operation }) => operation === 'remove').length,
    capabilities,
    capabilitiesTruncated: state.spec_changes.length > capabilities.length,
  };
}

async function acceptanceSummary(
  paths: NativeProjectPaths,
  changeDir: string,
  state: NativeChangeState,
  includeRuntimeEvidence: boolean,
): Promise<NativeDashboardAcceptanceSummary | null> {
  try {
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: state.brief,
      specChanges: state.spec_changes,
    });
    const total = contract.contract.acceptance.length;
    if (!includeRuntimeEvidence || !state.verification_evidence) {
      return { total, evidenced: 0, skipped: 0, missing: total };
    }
    const evidence = await readNativeVerificationEvidence(
      paths,
      state.name,
      state.verification_evidence,
    );
    return {
      total: evidence.acceptanceTrace.total,
      evidenced: evidence.acceptanceTrace.evidenced,
      skipped: evidence.acceptanceTrace.skipped,
      missing: Math.max(
        0,
        evidence.acceptanceTrace.total -
          evidence.acceptanceTrace.evidenced -
          evidence.acceptanceTrace.skipped,
      ),
    };
  } catch {
    return null;
  }
}

async function implementationSummary(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeDashboardImplementationSummary | null> {
  if (!state.implementation_scope) return null;
  try {
    const scope = await readNativeImplementationScope(
      paths,
      state.name,
      state.implementation_scope,
    );
    return {
      complete: scope.complete,
      declaredArtifactCount: scope.declaredArtifacts.length,
      changeCount: scope.changes.length,
      unattributedCount: scope.unattributed.length,
      unresolvedCount: scope.unresolvedScopes.length,
    };
  } catch {
    return null;
  }
}

async function collectChangeFacts(
  paths: NativeProjectPaths,
  changeDir: string,
  state: NativeChangeState,
  includeRuntimeEvidence: boolean,
): Promise<
  Pick<
    NativeDashboardChangeProjection,
    'artifacts' | 'specs' | 'acceptance' | 'implementation' | 'approval'
  > & { createdAt: string }
> {
  const [artifacts, acceptance, implementation] = await Promise.all([
    collectArtifacts(changeDir, state),
    acceptanceSummary(paths, changeDir, state, includeRuntimeEvidence),
    includeRuntimeEvidence ? implementationSummary(paths, state) : Promise.resolve(null),
  ]);
  return {
    artifacts,
    specs: specSummary(state),
    acceptance,
    implementation,
    approval: state.approval,
    createdAt: state.created_at,
  };
}

async function collectArchivedChanges(
  paths: NativeProjectPaths,
): Promise<NativeDashboardChangeProjection[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const archived: NativeDashboardChangeProjection[] = [];
  for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
    if (!entry.isDirectory()) continue;
    const match = ARCHIVE_NAME_PATTERN.exec(entry.name);
    if (!match) continue;
    const changeDir = path.join(paths.archiveDir, entry.name);
    await resolveContainedNativePath(paths.nativeRoot, changeDir);
    try {
      const state = await readNativeChangeFile(path.join(changeDir, NATIVE_CHANGE_STATE_FILE));
      if (!state.archived || entry.name !== `${match[1]}-${state.name}`) continue;
      const facts = await collectChangeFacts(paths, changeDir, state, false);
      archived.push({
        workflow: 'native',
        name: state.name,
        status: 'archived',
        archivedAt: match[1],
        phase: 'archive',
        revision: state.revision,
        selected: false,
        approval: facts.approval,
        nextCommand: null,
        verificationResult: state.verification_result,
        verificationFreshness: state.verification_result === 'pass' ? 'complete' : 'unknown',
        archiveReady: true,
        continuation: {
          disposition: 'done',
          action: 'none',
          command: null,
          requiresUserDecision: false,
          requiredInputs: [],
          requiredInputsTruncated: false,
        },
        findings: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false,
        },
        archive: {
          ready: true,
          evidenceFreshness: state.verification_result === 'pass' ? 'complete' : 'unknown',
          operationCount: state.spec_changes.length,
          findingCodes: [],
          findingCodesTruncated: false,
          preflightHash: null,
        },
        conflicts: {
          visibleDefiniteConflict: 0,
          visiblePossibleOverlap: 0,
          peers: [],
          peersTruncated: false,
        },
        artifacts: facts.artifacts,
        progress: {
          createdAt: facts.createdAt,
          checkpointAt: null,
          checkpointPhase: null,
          summary: 'Native change 已完成并归档。',
          nextAction: null,
          artifactCount: facts.artifacts.filter(({ exists }) => exists).length,
        },
        specs: facts.specs,
        acceptance: facts.acceptance,
        implementation: null,
        repair: null,
      });
    } catch {
      // Invalid or unreadable archives are omitted from the read-only Dashboard projection.
    }
  }
  return archived;
}

/** Collect a fresh, read-only Native Dashboard projection when this project enables Native. */
export async function collectNativeDashboardProjection(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  if (!config) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const statuses = [];
  let statusCursor: string | null = null;
  let totalStatusCount: number | undefined;
  do {
    const page = await listNativeStatusPage(paths, { cursor: statusCursor });
    totalStatusCount ??= page.total;
    if (page.total !== totalStatusCount) {
      throw new Error('Native status total changed during Dashboard pagination');
    }
    statuses.push(...page.items.slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges - statuses.length));
    statusCursor = page.nextCursor;
  } while (statusCursor !== null && statuses.length < NATIVE_DASHBOARD_LIMITS.maxChanges);
  const preflightEntries = await Promise.all(
    statuses.map(async (status) => {
      if (status.phase === 'invalid' || status.revision === null) {
        return [status.name, null] as const;
      }
      try {
        return [
          status.name,
          await inspectNativeArchivePreflight({ paths, name: status.name, now: options.now }),
        ] as const;
      } catch {
        return [status.name, null] as const;
      }
    }),
  );
  const conflictRadar = await inspectNativeConflictRadar(paths).catch(() => null);
  const projection = adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    statuses,
    preflights: Object.fromEntries(preflightEntries),
    conflictRadar,
    omittedSourceChangeCount: Math.max(0, (totalStatusCount ?? 0) - statuses.length),
  });
  const active = await Promise.all(
    projection.changes.map(async (change) => {
      try {
        const state = await readNativeChange(paths, change.name);
        const facts = await collectChangeFacts(
          paths,
          path.join(paths.changesDir, change.name),
          state,
          true,
        );
        return {
          ...change,
          ...facts,
          progress: { ...change.progress, createdAt: facts.createdAt },
        };
      } catch {
        return change;
      }
    }),
  );
  const archived = await collectArchivedChanges(paths);
  const visible = [...active, ...archived].slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges);
  const totalChangeCount = projection.totalChangeCount + archived.length;
  const result: NativeDashboardProjection = {
    ...projection,
    totalChangeCount,
    visibleChangeCount: visible.length,
    omittedChangeCount: totalChangeCount - visible.length,
    changesTruncated: totalChangeCount > visible.length,
    changes: visible,
  };
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') > NATIVE_DASHBOARD_LIMITS.maxSerializedBytes
  ) {
    throw new Error('Native Dashboard projection exceeds its serialized output budget');
  }
  return result;
}
