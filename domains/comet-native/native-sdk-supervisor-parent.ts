import type { RuntimeAction, RuntimeOutcome } from '../engine/runtime.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export function nativeSdkSupervisorParentCandidateCommit(
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome> | null | undefined = action.outcome,
): string {
  const activation = (action.input as { activation?: { integrationCommit?: unknown } }).activation;
  const output = outcome?.output as { candidateCommit?: unknown } | null | undefined;
  const commit = output?.candidateCommit ?? activation?.integrationCommit;
  if (
    action.stepId !== 'supervisor.parent.builder' ||
    typeof activation?.integrationCommit !== 'string' ||
    !COMMIT_PATTERN.test(activation.integrationCommit) ||
    typeof commit !== 'string' ||
    !COMMIT_PATTERN.test(commit)
  ) {
    throw new Error('Native Supervisor parent candidate has no valid Git commit');
  }
  return commit;
}
