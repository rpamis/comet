import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import { applicationSkillWork } from '../workflow-application/index.js';
import { nativeProjectPaths } from './native-paths.js';
import { projectNativePortableWorkspace } from './native-portable-status.js';
import { projectNativeSdkContinuation } from './native-sdk-continuation.js';
import { nativePortableStateSummary } from './native-portable-summary.js';

const SDK_STATUS_SETTLED_LIMIT = 12;

/** 保留全部未完成工作和最近的终态记录，历史不影响当前任务可见性。 */
function statusRecords<T extends { status: string }>(records: readonly T[], details?: boolean) {
  if (details) return { items: records, omitted: 0 };
  const live = new Set(['pending', 'running', 'unknown']);
  let settled = 0;
  let latestFailureRetained = false;
  const items: T[] = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const latestFailure = record.status === 'failed' && !latestFailureRetained;
    if (record.status === 'failed') latestFailureRetained = true;
    if (live.has(record.status) || settled++ < SDK_STATUS_SETTLED_LIMIT || latestFailure)
      items.push(record);
  }
  items.reverse();
  return { items, omitted: records.length - items.length };
}

export async function inspectNativeSdkStatus(options: {
  projectRoot: string;
  name: string;
  details?: boolean;
  readOnly?: boolean;
}) {
  const inspection = await inspectNativeSdkRun(options.projectRoot, options.name, {
    readOnly: options.readOnly,
  });
  return projectNativeSdkStatus(options, inspection);
}

/** Project one inspected or committed Run without synchronizing its state file again. */
export async function projectNativeSdkStatus(
  options: { projectRoot: string; name: string; details?: boolean },
  { run, state, artifactRootRef, application }: Awaited<ReturnType<typeof inspectNativeSdkRun>>,
) {
  const paths = await nativeProjectPaths(options.projectRoot, artifactRootRef);
  const summary = nativePortableStateSummary(state, paths);
  const actions = statusRecords(run.actions, options.details);
  const waits = statusRecords(run.waits, options.details);
  const evidenceWaits = statusRecords(run.evidenceWaits ?? [], options.details);
  return {
    schema: 'comet.native.sdk-status.v1' as const,
    ...(application
      ? { application: application.identity, skillWork: applicationSkillWork(application, run) }
      : {}),
    name: options.name,
    language: state.language,
    phase: state.phase,
    status: state.status,
    stateVersion: state.state_version,
    acceptance: summary.acceptance,
    unresolvedAcceptanceIds: summary.unresolved_acceptance_ids,
    verificationResult: state.verification_result,
    blockers: summary.blockers,
    workspace: projectNativePortableWorkspace(paths, state),
    run: {
      id: run.runId,
      revision: run.revision,
      status: run.status,
      history: {
        settledLimit: SDK_STATUS_SETTLED_LIMIT,
        actions: {
          total: run.actions.length,
          omitted: actions.omitted,
          truncated: actions.omitted > 0,
        },
        waits: { total: run.waits.length, omitted: waits.omitted, truncated: waits.omitted > 0 },
        evidenceWaits: {
          total: (run.evidenceWaits ?? []).length,
          omitted: evidenceWaits.omitted,
          truncated: evidenceWaits.omitted > 0,
        },
        ...(actions.omitted + waits.omitted + evidenceWaits.omitted > 0
          ? {
              detailsCommandArgs: [
                'comet',
                'native',
                'status',
                options.name,
                '--details',
                '--json',
              ],
            }
          : {}),
      },
      actions: actions.items.map(({ id, stepId, status, attempt, inputHash }) => ({
        id,
        stepId,
        status,
        attempt,
        inputHash,
      })),
      waits: waits.items.map(({ id, stepId, status, proposalHash, choices }) => ({
        id,
        stepId,
        status,
        proposalHash,
        choices,
      })),
      evidenceWaits: evidenceWaits.items.map(({ id, stepId, kind, status }) => ({
        id,
        stepId,
        kind,
        status,
      })),
    },
    ...(await projectNativeSdkContinuation({
      run,
      state,
      projectRoot: options.projectRoot,
      applicationId: application?.identity.id,
      skillExecutors: application?.implementation.executors,
    })),
    ...(options.details ? { details: { state } } : {}),
  };
}

export type NativeSdkStatusProjection = Awaited<ReturnType<typeof inspectNativeSdkStatus>>;
