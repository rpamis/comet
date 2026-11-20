import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
import type { NativeBuilderAcceptanceReview } from './native-builder-acceptance-review.js';
import {
  nativeSupervisorContractRef,
  type NativeChildrenContract,
} from './native-children-contract.js';
import { parseNativeReportedChecks } from './native-portable-state.js';
import type { NativeBuilderCheckSummary, NativePortableState } from './native-portable-types.js';
import { redactNativeCredentialText } from './native-redaction.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';

type Criterion = Pick<NativePortableState['acceptance'][number], 'id' | 'source' | 'text'>;
type Verdict = {
  id: string;
  result: NativePortableState['acceptance'][number]['result'];
  reason: string | null;
};

type ChildActivation = {
  child?: string;
  worktree?: string;
  candidateCommit?: string;
  builderSessionId?: string;
  contractRef?: string;
  contractHash?: string;
};

function childActivation(action: RuntimeAction): ChildActivation | undefined {
  return (action.input as { activation?: ChildActivation }).activation;
}

function confirmedChildren(run: Readonly<WorkflowRun>, state: NativePortableState) {
  if (state.phase === 'shape' || !state.children_contract_ref) return;
  const shape = run.actions.find((action) => action.id === state.children_contract_ref);
  const proposal = (shape?.outcome?.output ?? run.outputs['shape.prepare']?.value) as
    { children?: { contract?: NativeChildrenContract } } | undefined;
  return state.children_contract ?? proposal?.children?.contract;
}

export function nativeSdkAcceptanceEvidenceChildren(
  run: Readonly<WorkflowRun>,
  state: NativePortableState,
): string[] {
  return confirmedChildren(run, state)?.children.map(({ name }) => name) ?? [];
}

export function nativeSdkReportedCheckView(check: NativeBuilderCheckSummary) {
  return {
    name: check.name.text,
    result: check.result,
    note: check.note?.text ?? null,
    ...(check.acceptance_ids ? { acceptanceIds: check.acceptance_ids } : {}),
    ...(check.reason ? { reason: check.reason.text } : {}),
  };
}

function projectItems(
  criteria: readonly Criterion[],
  candidate?: {
    builderReview?: readonly NativeBuilderAcceptanceReview[];
    buildChecks: readonly NativeBuilderCheckSummary[];
    verifyChecks?: readonly NativeBuilderCheckSummary[];
    verdicts?: readonly Verdict[];
  },
) {
  const reviews = new Map(candidate?.builderReview?.map((row) => [row.id, row]));
  const verdicts = new Map(candidate?.verdicts?.map((row) => [row.id, row]));
  const checks = new Map<
    string,
    Array<ReturnType<typeof nativeSdkReportedCheckView> & { stage: 'build' | 'verify' }>
  >();
  for (const [stage, reported] of [
    ['build', candidate?.buildChecks],
    ['verify', candidate?.verifyChecks],
  ] as const) {
    for (const check of reported ?? []) {
      for (const id of check.acceptance_ids ?? []) {
        const linked = checks.get(id) ?? [];
        linked.push({ stage, ...nativeSdkReportedCheckView(check) });
        checks.set(id, linked);
      }
    }
  }
  return criteria.map(({ id, source, text }) => {
    const review = reviews.get(id);
    const verdict = verdicts.get(id);
    const linked = checks.get(id) ?? [];
    const evidence = (review?.evidence ?? []).map(redactNativeCredentialText);
    const hasEvidence =
      evidence.length > 0 ||
      linked.some((check) => check.result === 'passed') ||
      Boolean(verdict?.reason);
    return {
      id,
      source,
      text,
      result: verdict?.result ?? 'pending',
      reason: verdict?.reason ? redactNativeCredentialText(verdict.reason) : null,
      evidence,
      builderStatus: review?.status ?? null,
      builderNote: review ? redactNativeCredentialText(review.note) : null,
      checks: linked,
      gap: !candidate
        ? ('no-candidate' as const)
        : hasEvidence
          ? null
          : ('no-linked-evidence' as const),
    };
  });
}

/** Read the candidate associated with the current Run and worktree. This is advisory evidence. */
export function projectNativeSdkAcceptanceEvidence(
  run: Readonly<WorkflowRun>,
  state: NativePortableState,
  projectRoot: string,
  child?: string,
) {
  if (child) {
    const contract = confirmedChildren(run, state);
    const plan = contract?.children.find(({ name }) => name === child);
    const criteria =
      contract && plan && plan.covers.length === 0
        ? supervisorAcceptanceScope(contract, child)
        : state.acceptance.filter(({ id }) => plan?.covers.includes(id));
    const actions = currentNativeSdkSupervisorActions(run)
      .filter((action) => {
        const activation = childActivation(action);
        return (
          action.status !== 'cancelled' &&
          activation?.child === child &&
          nativeSupervisorContractRef(activation, run) === state.children_contract_ref
        );
      })
      .reverse();
    const latestBuilder = actions.find((action) => action.stepId === 'supervisor.child.builder');
    const builder = latestBuilder?.status === 'succeeded' ? latestBuilder : undefined;
    const output = builder?.outcome?.output as
      | {
          candidateCommit?: string;
          acceptanceReview?: NativeBuilderAcceptanceReview[];
          checks?: unknown;
        }
      | undefined;
    const worktree = latestBuilder && childActivation(latestBuilder)?.worktree;
    const candidateCommit = output?.candidateCommit ?? null;
    const verifier =
      builder && candidateCommit
        ? actions.slice(0, actions.indexOf(builder)).find((action) => {
            const scope = childActivation(action);
            return (
              action.stepId === 'supervisor.child.verifier' &&
              scope?.candidateCommit === candidateCommit &&
              scope.worktree === worktree &&
              scope.builderSessionId === builder.claim?.sessionId
            );
          })
        : undefined;
    const verified =
      verifier?.status === 'succeeded'
        ? (verifier.outcome?.output as {
            candidateCommit?: string;
            evidence?: { acceptance: Verdict[]; checks?: unknown };
          })
        : undefined;
    const result = verified?.candidateCommit === candidateCommit ? verified?.evidence : undefined;
    return {
      runId: run.runId,
      candidateId: candidateCommit ? builder!.id : null,
      candidateCommit,
      projectRoot: worktree ?? projectRoot,
      child,
      items: projectItems(
        criteria,
        candidateCommit
          ? {
              builderReview: output?.acceptanceReview,
              buildChecks: parseNativeReportedChecks(output?.checks ?? []),
              verifyChecks: parseNativeReportedChecks(result?.checks ?? []),
              verdicts: result?.acceptance,
            }
          : undefined,
      ),
    };
  }

  const handoff = state.builder_handoff;
  const verification =
    handoff && state.verification?.candidate_id === handoff.candidate_id
      ? state.verification
      : null;
  const current = state.phase === 'verify' || state.phase === 'archive' ? handoff : null;
  const previous = state.phase === 'build' && verification?.verdict === 'fail' ? handoff : null;
  const candidateItems =
    handoff && (current || previous)
      ? projectItems(state.acceptance, {
          builderReview: handoff.acceptance_review,
          buildChecks: handoff.checks,
          verifyChecks: verification?.reported_checks,
          verdicts: verification
            ? state.acceptance.map(({ id, result, reason }) => ({
                id,
                result,
                reason: reason?.text ?? null,
              }))
            : undefined,
        })
      : undefined;
  const supervisor = state.children_contract_ref
    ? (run.outputs['supervisor.prepare']?.value as { integrationWorktree?: string } | undefined)
    : undefined;
  const parentBuilder =
    supervisor && current
      ? run.actions.find(
          (action) =>
            action.id === current.candidate_id && action.stepId === 'supervisor.parent.builder',
        )
      : undefined;
  return {
    runId: run.runId,
    candidateId: current?.candidate_id ?? null,
    candidateCommit: parentBuilder ? nativeSdkSupervisorParentCandidateCommit(parentBuilder) : null,
    projectRoot: supervisor?.integrationWorktree ?? projectRoot,
    child: null,
    items: current && candidateItems ? candidateItems : projectItems(state.acceptance),
    ...(previous && candidateItems
      ? { previousCandidate: { candidateId: previous.candidate_id, items: candidateItems } }
      : {}),
  };
}
