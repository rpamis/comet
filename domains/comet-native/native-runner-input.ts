import { nativeEnumText, NATIVE_VERIFIER_VERDICTS } from './native-input-enum.js';
import { assertNativeSupervisorVerifierWorkspace } from './native-supervisor-workspace.js';
import { randomUUID } from 'node:crypto';
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { resolveGitRef } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import { parseNativeBuilderAcceptanceReview } from './native-builder-acceptance-review.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { parseNativeReportedChecks } from './native-portable-state.js';
import { readNativePortableChange, nativePortableChangeDir } from './native-portable-storage.js';
import {
  confirmNativePortableVerifierStart,
  dispatchNativePortableVerifier,
  recordNativePortableVerifierFailure,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from './native-portable-verification.js';
import { createNativeRunnerChannel, NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import {
  applyNativeSupervisorBuilderResult,
  applyNativeSupervisorVerifierResult,
  cancelNativeSupervisorTask,
  createNativeSupervisorTask,
  integrateNativeSupervisorChild,
  projectNativeSupervisorTask,
  reconnectNativeSupervisorTaskWithState,
  retryNativeSupervisorBuilder,
  type NativeSupervisorIntegrationCheck,
  type NativeSupervisorVerificationEvidence,
} from './native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { withNativeMutation } from './native-mutation.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';
import { nativeVerifierActionExecutionRef } from './native-verifier-action.js';
import { parseNativeVerifierResponse } from './native-verifier-protocol.js';
import { assertNativeInputKeys } from './native-input-error.js';
const KINDS = [
  'builder-handoff',
  'dispatch-verifier',
  'retry-checks',
  'verifier-response',
  'verifier-started',
  'verifier-execution-error',
  'verifier-unavailable',
  'supervisor-builder-result',
  'supervisor-builder-failure',
  'supervisor-retry-builder',
  'supervisor-reconnect',
  'supervisor-cancel',
  'supervisor-verifier-result',
  'supervisor-checks',
  'supervisor-integrate',
] as const;
export type NativeRunnerInput = {
  kind: (typeof KINDS)[number];
} & Record<string, unknown>;
const INPUT_FIELDS: Record<NativeRunnerInput['kind'], readonly string[]> = {
  'builder-handoff': [
    'kind',
    'summary',
    'addressed_acceptance_ids',
    'acceptance_review',
    'checks',
    'known_limits',
    'review',
    'builderExecutionRef',
  ],
  'dispatch-verifier': ['kind', 'checks', 'verifierExecutionRef'],
  'retry-checks': ['kind', 'check_ids'],
  'verifier-response': ['kind', 'candidateId', 'verifierExecutionRef', 'response'],
  'verifier-started': ['kind', 'candidateId', 'verifierExecutionRef'],
  'verifier-execution-error': [
    'kind',
    'summary',
    'stateVersion',
    'iteration',
    'attempt',
    'verifierExecutionRef',
  ],
  'verifier-unavailable': [
    'kind',
    'summary',
    'stateVersion',
    'iteration',
    'attempt',
    'verifierExecutionRef',
  ],
  'supervisor-builder-result': [
    'kind',
    'child',
    'runId',
    'candidateCommit',
    'checks',
    'requireIndependentReview',
  ],
  'supervisor-builder-failure': ['kind', 'child', 'runId', 'reason'],
  'supervisor-retry-builder': ['kind', 'child', 'stateVersion'],
  'supervisor-reconnect': ['kind', 'child', 'runId'],
  'supervisor-cancel': ['kind', 'child', 'runId', 'reason'],
  'supervisor-verifier-result': ['kind', 'child', 'runId', 'verdict', 'evidence'],
  'supervisor-checks': ['kind', 'child', 'runId', 'checks', 'materials', 'retry_check_ids'],
  'supervisor-integrate': ['kind', 'child', 'integrationCommit', 'checks', 'retry_check_ids'],
};
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(label + ' requires nonempty text');
  return value;
}
export function parseNativeRunnerInput(value: unknown): NativeRunnerInput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !KINDS.includes((value as NativeRunnerInput).kind)
  )
    throw new Error('Unsupported Native input kind');
  const input = value as NativeRunnerInput;
  assertNativeInputKeys(
    input,
    INPUT_FIELDS[input.kind].filter((key) => Object.hasOwn(input, key)),
    'Native platform result',
  );
  if (input.kind === 'builder-handoff') {
    text(input.summary, 'Builder summary');
    if (
      !Array.isArray(input.addressed_acceptance_ids) ||
      input.addressed_acceptance_ids.some((id) => typeof id !== 'string')
    )
      throw new Error('Builder acceptance IDs must be strings');
    parseNativeReportedChecks(input.checks ?? []);
    if (input.acceptance_review !== undefined)
      parseNativeBuilderAcceptanceReview(input.acceptance_review);
  }
  if (input.kind === 'supervisor-verifier-result')
    nativeEnumText(input.verdict, NATIVE_VERIFIER_VERDICTS, 'Native Supervisor Verifier verdict');
  if (input.kind.startsWith('supervisor-')) {
    text(input.child, 'Child');
    if (!['supervisor-integrate', 'supervisor-retry-builder'].includes(input.kind))
      text(input.runId, 'Original task runId');
  }
  if (['verifier-response', 'verifier-started'].includes(input.kind)) {
    text(input.candidateId, 'Candidate');
    text(input.verifierExecutionRef, 'Verifier session');
  }
  if (input.kind === 'verifier-response') parseNativeVerifierResponse(input.response);
  return input;
}
export async function readNativeRunnerInput(file: string, projectRoot = process.cwd()) {
  const { resolve } = await import('node:path');
  const read = await readFileRaceSafe(resolve(projectRoot, file), Number.MAX_SAFE_INTEGER, {
    label: 'Native platform result',
  });
  return parseNativeRunnerInput(JSON.parse(read.bytes.toString('utf8').replace(/^\uFEFF/u, '')));
}
export async function validateNativeRunnerInputBoundary(options: {
  paths: NativeProjectPaths;
  name: string;
  state: NativePortableState;
  input: NativeRunnerInput;
  projectRoot?: string;
}) {
  const { state, input } = options;
  if (state.archived) throw new Error('Archived changes do not accept task results');
  if (input.kind === 'builder-handoff' && state.phase !== 'build')
    throw new Error('Builder results require Build');
  if (input.kind.startsWith('verifier-') && state.phase !== 'verify')
    throw new Error('Verifier results require Verify');
  if (
    ['verifier-response', 'verifier-started'].includes(input.kind) &&
    input.candidateId !== state.builder_handoff?.candidate_id
  )
    throw new Error('Verifier result belongs to another candidate');
  if (input.kind.startsWith('supervisor-')) {
    const supervisor = await readNativeSupervisorState(options.paths, options.name);
    if (!supervisor) throw new Error('Supervisor business state is missing');
    const child = supervisor.children.find((child) => child.name === input.child);
    if (!child) throw new Error('Unknown Supervisor child');
    if (input.runId !== undefined && child.task?.runId !== input.runId)
      throw new Error('Task result belongs to another Child task');
  }
}
export async function applyNativeRunnerInput(options: {
  paths: NativeProjectPaths;
  name: string;
  input: NativeRunnerInput;
  maxVerifyFailures: number;
  inputFile?: string;
}) {
  const { paths, name, input } = options;
  let state = await readNativePortableChange(paths, name);
  await validateNativeRunnerInputBoundary({ paths, name, state, input });
  if (input.kind === 'retry-checks' || input.kind === 'supervisor-checks')
    return {
      state,
      platformWork: {
        instruction:
          '在 Agent 平台核对原命令的实际结果；仅补需要的检查，然后提交本业务任务的完整报告。Comet 不执行或自动重放这些命令。',
      },
      continuation: nativePortableContinuation(state),
    };
  if (input.kind.startsWith('supervisor-'))
    return withNativeMutation(paths, async () => {
      let supervisor = await readNativeSupervisorState(paths, name);
      if (!supervisor) throw new Error('Supervisor state is missing');
      const child = text(input.child, 'Child'),
        runId = typeof input.runId === 'string' ? input.runId : '';
      let task;
      if (input.kind === 'supervisor-builder-result') {
        const current = supervisor.children.find((entry) => entry.name === child)?.task;
        if (!current || resolveGitRef(current.projectRoot, 'HEAD') !== input.candidateCommit)
          throw new Error('Builder candidate differs from its task workspace');
        try {
          runGitCommand(current.projectRoot, [
            'merge-base',
            '--is-ancestor',
            current.baseCommit,
            input.candidateCommit as string,
          ]);
        } catch {
          throw new Error(
            'Native Supervisor Builder base commit is not an ancestor of its candidate',
          );
        }
        supervisor = applyNativeSupervisorBuilderResult(supervisor, {
          child,
          runId,
          candidateCommit: text(input.candidateCommit, 'Candidate commit'),
        });
        const created = createNativeSupervisorTask(supervisor, {
          child,
          role: 'verifier',
          projectRoot: current.projectRoot,
          runId: randomUUID(),
        });
        supervisor = created.state;
        task = created.task;
      } else if (input.kind === 'supervisor-verifier-result') {
        const current = supervisor.children.find((entry) => entry.name === child)?.task;
        const evidence = input.evidence as NativeSupervisorVerificationEvidence;
        if (
          !current ||
          !evidence ||
          typeof evidence.summary !== 'string' ||
          !Array.isArray(evidence.checks) ||
          evidence.checks.some((value) => typeof value !== 'string')
        )
          throw new Error('Submit the original Verifier task and actual acceptance/check reports');
        assertNativeSupervisorVerifierWorkspace(
          current.projectRoot,
          'comet/supervisor/' + name + '/' + child,
          current.baseCommit,
        );
        supervisor = applyNativeSupervisorVerifierResult(supervisor, {
          child,
          runId,
          verdict: input.verdict as 'pass' | 'fail' | 'blocked',
          evidence: { ...evidence, execution: structuredClone(current) },
        });
      } else if (input.kind === 'supervisor-builder-failure' || input.kind === 'supervisor-cancel')
        supervisor = cancelNativeSupervisorTask(supervisor, {
          child,
          runId,
          reason: text(input.reason, 'Task failure'),
        });
      else if (input.kind === 'supervisor-retry-builder')
        supervisor = retryNativeSupervisorBuilder(supervisor, {
          child,
          expectedStateVersion: input.stateVersion as number,
        });
      else if (input.kind === 'supervisor-reconnect') {
        const connected = reconnectNativeSupervisorTaskWithState(supervisor, {
          child,
          runId,
        });
        supervisor = connected.state;
        task = connected.task;
      } else if (input.kind === 'supervisor-integrate') {
        if (typeof input.integrationCommit !== 'string')
          return {
            state,
            platformWork: {
              instruction:
                '由 Agent 使用平台工具集成已验收的 Child，并执行必要检查；随后提交实际 integrationCommit 和 checks（name/status/reason）。',
              child,
              workspace: supervisor.integration.worktree,
              candidateCommit: supervisor.children.find((entry) => entry.name === child)
                ?.verifiedCommit,
            },
            continuation: nativePortableContinuation(state),
          };
        if (
          resolveGitRef(supervisor.integration.worktree, supervisor.integration.branch) !==
          input.integrationCommit
        )
          throw new Error('Integration result differs from the actual branch');
        const original = supervisor.children.find((entry) => entry.name === child);
        if (!original?.verifiedCommit) throw new Error('Child has no accepted candidate');
        runGitCommand(supervisor.integration.worktree, [
          'merge-base',
          '--is-ancestor',
          supervisor.integration.headCommit,
          input.integrationCommit,
        ]);
        runGitCommand(supervisor.integration.worktree, [
          'merge-base',
          '--is-ancestor',
          original.verifiedCommit,
          input.integrationCommit,
        ]);
        if (
          !Array.isArray(input.checks) ||
          input.checks.some(
            (check) =>
              !check ||
              typeof check !== 'object' ||
              typeof check.name !== 'string' ||
              !['passed', 'failed', 'incomplete'].includes(check.status),
          )
        )
          throw new Error('Submit actual integration checks');
        supervisor = integrateNativeSupervisorChild(supervisor, {
          name: child,
          integrationCommit: input.integrationCommit,
          checks: input.checks as NativeSupervisorIntegrationCheck[],
        });
      }
      await writeNativeSupervisorState(paths, supervisor);
      return {
        state,
        supervisorState: supervisor,
        ...(task
          ? {
              supervisorTask: projectNativeSupervisorTask(task, name, paths.projectRoot),
            }
          : {}),
        continuation: nativePortableContinuation(state),
      };
    });
  if (input.kind === 'builder-handoff') {
    const channel = createNativeRunnerChannel();
    const review = input.review as {
      status: 'passed';
      summary: string;
      reviewer_execution_ref: string;
    } | null;
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: channel.captureExecutionIdentity({
          identityProvider: NATIVE_SKILL_COORDINATION,
          executionRef:
            typeof input.builderExecutionRef === 'string'
              ? input.builderExecutionRef
              : 'platform-builder-' + randomUUID(),
        }),
        summary: input.summary as string,
        addressedAcceptanceIds: input.addressed_acceptance_ids as string[],
        ...(input.acceptance_review === undefined
          ? {}
          : {
              acceptanceReview: parseNativeBuilderAcceptanceReview(input.acceptance_review),
            }),
        checks: input.checks as never,
        knownLimits: input.known_limits as string[] | undefined,
        review: review
          ? {
              status: review.status,
              summary: review.summary,
              reviewerExecutionRef: review.reviewer_execution_ref,
            }
          : null,
      },
    });
  } else if (input.kind === 'dispatch-verifier')
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId:
        typeof input.verifierExecutionRef === 'string'
          ? input.verifierExecutionRef
          : 'platform-verifier-' + randomUUID(),
    });
  else if (input.kind === 'verifier-started')
    state = await confirmNativePortableVerifierStart({
      paths,
      name,
      expected: {
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: input.verifierExecutionRef as string,
      },
    });
  else if (input.kind === 'verifier-response') {
    const channel = createNativeRunnerChannel();
    const result = await submitNativePortableVerifierResult({
      paths,
      name,
      maxVerifyFailures: options.maxVerifyFailures,
      envelope: channel.envelopeVerifierResponse({
        candidateId: input.candidateId as string,
        identity: channel.captureExecutionIdentity({
          identityProvider: state.builder_handoff!.identity_provider,
          executionRef: input.verifierExecutionRef as string,
        }),
        payload: input.response,
      }),
    });
    state = result.state;
  } else if (input.kind === 'verifier-execution-error' || input.kind === 'verifier-unavailable')
    state = await recordNativePortableVerifierFailure({
      paths,
      name,
      summary: text(input.summary, 'Verifier failure'),
      expected: {
        stateVersion: input.stateVersion as number,
        iteration: input.iteration as number,
        attempt: input.attempt as number,
        verifierExecutionRef: text(input.verifierExecutionRef, 'Verifier session'),
      },
    });
  const executionRef = state.verifier_action
    ? nativeVerifierActionExecutionRef(state.verifier_action)
    : null;
  return {
    state,
    ...(input.kind === 'dispatch-verifier'
      ? {
          verifierDispatch: {
            projectRoot: paths.projectRoot,
            verificationRoot: state.children_contract_ref
              ? ((await readNativeSupervisorState(paths, name))?.integration.worktree ??
                paths.projectRoot)
              : paths.projectRoot,
            changeDir: nativePortableChangeDir(paths, name),
            briefRef: state.brief,
            specRefs: state.spec_changes
              .filter((change) => change.source)
              .map((change) => ({ ref: change.source })),
            candidateId: state.builder_handoff?.candidate_id,
            verifierExecutionRef: executionRef,
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            acceptance: state.acceptance,
            checks: state.builder_handoff?.checks,
            recoveryContext: [...state.history]
              .reverse()
              .find(
                (entry) =>
                  entry.outcome === 'recovery' &&
                  entry.goal_cycle === state.loop.goal_cycle &&
                  entry.iteration === state.loop.iteration,
              )?.summary,
            instruction:
              '使用 Agent 平台继续同一只读验收任务，核对全部验收项并提交实际结果；超时与清理由平台处理。',
          },
        }
      : {}),
    continuation: nativePortableContinuation(state),
  };
}
