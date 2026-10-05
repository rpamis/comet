import { inspectNativeSdkRun, loadOwnedNativeSdkRuntime } from './native-runtime-ownership.js';
import { applicationSkillWork } from '../workflow-application/index.js';
import { nativeProjectPaths } from './native-paths.js';
import { projectNativePortableWorkspace } from './native-portable-status.js';
import { nativePortableStateSummary } from './native-portable-summary.js';

export async function inspectNativeSdkStatus(options: {
  projectRoot: string;
  name: string;
  details?: boolean;
}) {
  const { run, state, artifactRootRef } = await inspectNativeSdkRun(
    options.projectRoot,
    options.name,
  );
  const paths = await nativeProjectPaths(options.projectRoot, artifactRootRef);
  const summary = nativePortableStateSummary(state, paths);
  const { application } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
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
      actions: run.actions.map(({ id, stepId, status, attempt, inputHash }) => ({
        id,
        stepId,
        status,
        attempt,
        inputHash,
      })),
      waits: run.waits.map(({ id, stepId, status, proposalHash, choices }) => ({
        id,
        stepId,
        status,
        proposalHash,
        choices,
      })),
      evidenceWaits: (run.evidenceWaits ?? []).map(({ id, stepId, kind, status }) => ({
        id,
        stepId,
        kind,
        status,
      })),
    },
    ...(options.details ? { details: { state } } : {}),
  };
}

export type NativeSdkStatusProjection = Awaited<ReturnType<typeof inspectNativeSdkStatus>>;
