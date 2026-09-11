import { assertNativeInputKeys as exactKeys } from './native-input-error.js';
import { stripUtf8Bom } from '../../platform/fs/strip-bom.js';
import { nativeWorkspaceIsClean } from './native-workspace-config.js';
import { inspectNativeChildren } from './native-children.js';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runGitCommand } from '../../platform/process/git.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import { preflightNativeCheckPlans, type NativeCheckPlan } from './native-check-executor.js';
import {
  executeNativeSupervisorChecks,
  readNativeSupervisorCheckEvidence,
  type NativeSupervisorMaterial,
} from './native-supervisor-evidence.js';
import {
  parseNativeVerifierAcceptance,
  parseNativeVerifierResponse,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
import { readNativeLocalExecution } from './native-local-execution.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  retryNativePortableCheckPlan,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  recordNativePortableVerifierFailure,
  recordNativePortableVerifierUnavailable,
  returnNativePortableChangeToBuild,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
  inspectNativeSupervisorParentReviewReadiness,
} from './native-portable-runtime.js';
import {
  applyNativeSupervisorBuilderResult,
  applyNativeSupervisorVerifierResult,
  advanceNativeSupervisorFinalVerificationHead,
  blockNativeSupervisorTask,
  cancelNativeSupervisorTask,
  createNativeSupervisorTask,
  integrateNativeSupervisorChildWorkspace,
  nativeSupervisorStateFile,
  recordNativeSupervisorPortableFinalVerification,
  readNativeSupervisorState,
  reconnectNativeSupervisorTaskWithState,
  projectNativeSupervisorTask,
  writeNativeSupervisorState,
  type NativeSupervisorState,
  type NativeSupervisorVerificationEvidence,
} from './native-supervisor.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { inspectNativeSupervisorOverlay } from './native-supervisor-overlay.js';
import { createNativeRunnerChannel, NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type {
  NativeBuilderHandoff,
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

interface RunnerBuilderInput {
  kind: 'builder-handoff';
  summary: string;
  addressed_acceptance_ids: string[];
  checks: Array<{
    name: string;
    result: 'passed' | 'failed' | 'not-run';
    note: string | null;
  }>;
  known_limits: string[];
  review: {
    status: 'passed';
    summary: string;
    reviewer_execution_ref: string;
  } | null;
}

interface RunnerDispatchInput {
  kind: 'dispatch-verifier';
  checks: NativeCheckPlan[];
}

interface RunnerRetryChecksInput {
  kind: 'retry-checks';
  check_ids: string[];
}

interface RunnerVerifierInput {
  kind: 'verifier-response';
  candidateId: string;
  verifierExecutionRef: string;
  response: NativeVerifierResponse;
}

interface RunnerExecutionErrorInput {
  kind: 'verifier-execution-error';
  summary: string;
  stateVersion: number;
  iteration: number;
  attempt: number;
  verifierExecutionRef: string;
}

interface RunnerVerifierUnavailableInput {
  kind: 'verifier-unavailable';
  summary: string;
  stateVersion: number;
  iteration: number;
  attempt: number;
  verifierExecutionRef: string;
}

interface RunnerSupervisorBuilderInput {
  kind: 'supervisor-builder-result';
  child: string;
  runId: string;
  candidateCommit: string;
}

interface RunnerSupervisorBuilderFailureInput {
  kind: 'supervisor-builder-failure';
  child: string;
  runId: string;
  reason: string;
}

interface RunnerSupervisorReconnectInput {
  kind: 'supervisor-reconnect';
  child: string;
  runId: string;
}

interface RunnerSupervisorCancelInput {
  kind: 'supervisor-cancel';
  child: string;
  runId: string;
  reason: string;
}

interface RunnerSupervisorVerifierInput {
  kind: 'supervisor-verifier-result';
  child: string;
  runId: string;
  verdict: 'pass' | 'fail' | 'blocked';
  evidence: NativeSupervisorVerificationEvidence;
}

interface RunnerSupervisorChecksInput {
  kind: 'supervisor-checks';
  child: string;
  runId: string;
  checks: NativeCheckPlan[];
  materials: NativeSupervisorMaterial[];
  retry_check_ids?: string[];
}

interface RunnerSupervisorIntegrateInput {
  kind: 'supervisor-integrate';
  child: string;
  checks: NativeCheckPlan[];
  retry_check_ids?: string[];
}

export type NativeRunnerInput =
  | RunnerBuilderInput
  | RunnerDispatchInput
  | RunnerRetryChecksInput
  | RunnerVerifierInput
  | RunnerExecutionErrorInput
  | RunnerVerifierUnavailableInput
  | RunnerSupervisorBuilderInput
  | RunnerSupervisorBuilderFailureInput
  | RunnerSupervisorReconnectInput
  | RunnerSupervisorCancelInput
  | RunnerSupervisorVerifierInput
  | RunnerSupervisorChecksInput
  | RunnerSupervisorIntegrateInput;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`${label} must be non-empty text`);
  }
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function builderChecks(value: unknown): RunnerBuilderInput['checks'] {
  if (!Array.isArray(value)) throw new Error('Native Builder checks must be an array');
  return value.map((entry, index) => {
    const input = record(entry, `Native Builder check ${index}`);
    exactKeys(
      input,
      ['name', 'result', 'note'],
      `Native Builder check ${index}`,
      `/checks/${index}`,
    );
    if (!['passed', 'failed', 'not-run'].includes(String(input.result))) {
      throw new Error(`Native Builder check ${index} result is invalid`);
    }
    if (input.note !== null && typeof input.note !== 'string') {
      throw new Error(`Native Builder check ${index} note is invalid`);
    }
    return {
      name: text(input.name, `Native Builder check ${index} name`),
      result: input.result as RunnerBuilderInput['checks'][number]['result'],
      note: input.note as string | null,
    };
  });
}

function checkPlans(value: unknown): NativeCheckPlan[] {
  if (!Array.isArray(value)) throw new Error('Native Runtime checks must be an array');
  return value.map((entry, index) => {
    const input = record(entry, `Native Runtime check ${index}`);
    exactKeys(
      input,
      ['id', 'name', 'executable', 'argv', 'cwdRef', 'timeoutMs', 'repeatable'],
      `Native Runtime check ${index}`,
      `/checks/${index}`,
    );
    if (!Array.isArray(input.argv) || !input.argv.every((part) => typeof part === 'string')) {
      throw new Error(`Native Runtime check ${index} argv is invalid`);
    }
    if (!Number.isSafeInteger(input.timeoutMs) || (input.timeoutMs as number) < 1) {
      throw new Error(`Native Runtime check ${index} timeoutMs is invalid`);
    }
    if (typeof input.repeatable !== 'boolean') {
      throw new Error(`Native Runtime check ${index} repeatable is invalid`);
    }
    return {
      id: text(input.id, `Native Runtime check ${index} id`),
      name: text(input.name, `Native Runtime check ${index} name`),
      executable: text(input.executable, `Native Runtime check ${index} executable`),
      argv: [...(input.argv as string[])],
      cwdRef: text(input.cwdRef, `Native Runtime check ${index} cwdRef`),
      timeoutMs: input.timeoutMs as number,
      repeatable: input.repeatable,
    };
  });
}

function verifierAttemptBinding(
  input: Record<string, unknown>,
  label: string,
): Pick<
  RunnerExecutionErrorInput,
  'stateVersion' | 'iteration' | 'attempt' | 'verifierExecutionRef'
> {
  const stateVersion = input.stateVersion;
  const iteration = input.iteration;
  const attempt = input.attempt;
  if (!Number.isSafeInteger(stateVersion) || (stateVersion as number) < 1) {
    throw new Error(`${label} stateVersion is invalid`);
  }
  if (!Number.isSafeInteger(iteration) || (iteration as number) < 1) {
    throw new Error(`${label} iteration is invalid`);
  }
  if (!Number.isSafeInteger(attempt) || (attempt as number) < 1) {
    throw new Error(`${label} attempt is invalid`);
  }
  return {
    stateVersion: stateVersion as number,
    iteration: iteration as number,
    attempt: attempt as number,
    verifierExecutionRef: text(input.verifierExecutionRef, `${label} verifierExecutionRef`),
  };
}

function supervisorEvidence(value: unknown): NativeSupervisorVerificationEvidence {
  const input = record(value, 'Native Supervisor evidence');
  exactKeys(
    input,
    ['summary', 'checks', 'acceptance', 'receiptRef'],
    'Native Supervisor evidence',
    '/evidence',
  );
  return {
    summary: text(input.summary, 'Native Supervisor evidence summary'),
    checks: strings(input.checks, 'Native Supervisor evidence checks'),
    acceptance: parseNativeVerifierAcceptance(input.acceptance, '/evidence/acceptance'),
    ...(input.receiptRef === null
      ? {}
      : { receiptRef: text(input.receiptRef, 'Native Supervisor receipt ref') }),
  };
}

export function parseNativeRunnerInput(value: unknown): NativeRunnerInput {
  const input = record(value, 'Native Runner input');
  if (input.kind === 'builder-handoff') {
    const builderKeys = ['kind', 'summary', 'addressed_acceptance_ids', 'checks', 'known_limits'];
    exactKeys(
      input,
      Object.hasOwn(input, 'review') ? [...builderKeys, 'review'] : builderKeys,
      'Native Runner Builder input',
    );
    let review: RunnerBuilderInput['review'] = null;
    if (input.review !== undefined && input.review !== null) {
      const reviewInput = record(input.review, 'Native Builder review');
      exactKeys(
        reviewInput,
        ['status', 'summary', 'reviewer_execution_ref'],
        'Native Builder review',
        '/review',
      );
      if (reviewInput.status !== 'passed') {
        throw new Error('Native Builder review status must be passed when supplied');
      }
      review = {
        status: 'passed',
        summary: text(reviewInput.summary, 'Native Builder review summary'),
        reviewer_execution_ref: text(
          reviewInput.reviewer_execution_ref,
          'Native Builder reviewer execution ref',
        ),
      };
    }
    return {
      kind: 'builder-handoff',
      summary: text(input.summary, 'Native Builder summary'),
      addressed_acceptance_ids: strings(
        input.addressed_acceptance_ids,
        'Native Builder addressed acceptance IDs',
      ),
      checks: builderChecks(input.checks),
      known_limits: strings(input.known_limits, 'Native Builder known limits'),
      review,
    };
  }
  if (input.kind === 'dispatch-verifier') {
    exactKeys(input, ['kind', 'checks'], 'Native Runner dispatch input');
    return { kind: 'dispatch-verifier', checks: checkPlans(input.checks) };
  }
  if (input.kind === 'retry-checks') {
    exactKeys(input, ['kind', 'check_ids'], 'Native Runner check retry input');
    return {
      kind: 'retry-checks',
      check_ids: strings(input.check_ids, 'Native check retry IDs'),
    };
  }
  if (input.kind === 'verifier-response') {
    exactKeys(
      input,
      ['kind', 'candidateId', 'verifierExecutionRef', 'response'],
      'Native Runner Verifier input',
    );
    return {
      kind: 'verifier-response',
      candidateId: text(input.candidateId, 'Native Runner Verifier candidateId'),
      verifierExecutionRef: text(
        input.verifierExecutionRef,
        'Native Runner Verifier verifierExecutionRef',
      ),
      response: parseNativeVerifierResponse(input.response, '/response'),
    };
  }
  if (input.kind === 'verifier-execution-error') {
    exactKeys(
      input,
      ['kind', 'summary', 'stateVersion', 'iteration', 'attempt', 'verifierExecutionRef'],
      'Native Runner execution error input',
    );
    return {
      kind: 'verifier-execution-error',
      summary: text(input.summary, 'Native Verifier execution error summary'),
      ...verifierAttemptBinding(input, 'Native Runner execution error input'),
    };
  }
  if (input.kind === 'verifier-unavailable') {
    exactKeys(
      input,
      ['kind', 'summary', 'stateVersion', 'iteration', 'attempt', 'verifierExecutionRef'],
      'Native Runner unavailable Verifier input',
    );
    return {
      kind: 'verifier-unavailable',
      summary: text(input.summary, 'Native unavailable Verifier summary'),
      ...verifierAttemptBinding(input, 'Native Runner unavailable Verifier input'),
    };
  }
  if (input.kind === 'supervisor-builder-result') {
    exactKeys(
      input,
      ['kind', 'child', 'runId', 'candidateCommit'],
      'Native Supervisor Builder input',
    );
    return {
      kind: 'supervisor-builder-result',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
      candidateCommit: text(input.candidateCommit, 'Native Supervisor candidate commit'),
    };
  }
  if (input.kind === 'supervisor-builder-failure') {
    exactKeys(
      input,
      ['kind', 'child', 'runId', 'reason'],
      'Native Supervisor Builder failure input',
    );
    return {
      kind: 'supervisor-builder-failure',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
      reason: text(input.reason, 'Native Supervisor Builder failure reason'),
    };
  }
  if (input.kind === 'supervisor-reconnect') {
    exactKeys(input, ['kind', 'child', 'runId'], 'Native Supervisor reconnect input');
    return {
      kind: 'supervisor-reconnect',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
    };
  }
  if (input.kind === 'supervisor-cancel') {
    exactKeys(input, ['kind', 'child', 'runId', 'reason'], 'Native Supervisor cancel input');
    return {
      kind: 'supervisor-cancel',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
      reason: text(input.reason, 'Native Supervisor cancellation reason'),
    };
  }
  if (input.kind === 'supervisor-verifier-result') {
    exactKeys(
      input,
      ['kind', 'child', 'runId', 'verdict', 'evidence'],
      'Native Supervisor Verifier input',
    );
    if (!['pass', 'fail', 'blocked'].includes(String(input.verdict))) {
      throw new Error('Native Supervisor Verifier verdict is invalid');
    }
    return {
      kind: 'supervisor-verifier-result',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
      verdict: input.verdict as RunnerSupervisorVerifierInput['verdict'],
      evidence: supervisorEvidence(input.evidence),
    };
  }
  if (input.kind === 'supervisor-checks') {
    const keys = ['kind', 'child', 'runId', 'checks', 'materials'];
    exactKeys(
      input,
      Object.hasOwn(input, 'retry_check_ids') ? [...keys, 'retry_check_ids'] : keys,
      'Native Supervisor checks',
    );
    if (!Array.isArray(input.materials))
      throw new Error('Native Supervisor materials must be an array');
    return {
      kind: 'supervisor-checks',
      child: text(input.child, 'Native Supervisor child'),
      runId: text(input.runId, 'Native Supervisor runId'),
      checks: checkPlans(input.checks),
      ...(input.retry_check_ids === undefined
        ? {}
        : { retry_check_ids: strings(input.retry_check_ids, 'Native Supervisor retry IDs') }),
      materials: input.materials.map((value, index) => {
        const material = record(value, 'Native Supervisor material');
        exactKeys(
          material,
          ['name', 'content'],
          'Native Supervisor material',
          `/materials/${index}`,
        );
        return {
          name: text(material.name, 'Native Supervisor material name'),
          content: text(material.content, 'Native Supervisor material content'),
        };
      }),
    };
  }
  if (input.kind === 'supervisor-integrate') {
    const keys = ['kind', 'child', 'checks'];
    exactKeys(
      input,
      Object.hasOwn(input, 'retry_check_ids') ? [...keys, 'retry_check_ids'] : keys,
      'Native Supervisor integration input',
    );
    return {
      kind: 'supervisor-integrate',
      child: text(input.child, 'Native Supervisor child'),
      checks: checkPlans(input.checks),
      ...(input.retry_check_ids === undefined
        ? {}
        : { retry_check_ids: strings(input.retry_check_ids, 'Native Supervisor retry IDs') }),
    };
  }
  throw new Error('Native Runner input kind is invalid');
}

export async function readNativeRunnerInput(
  file: string,
  projectRoot: string,
): Promise<NativeRunnerInput> {
  const target = path.resolve(projectRoot, file);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Native Runner input must be a regular non-symlink file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(await fs.readFile(target, 'utf8')));
  } catch (error) {
    throw new Error('Native Runner input must be valid JSON', { cause: error });
  }
  return parseNativeRunnerInput(parsed);
}

function isGenericPortableRunnerInput(input: NativeRunnerInput): boolean {
  return (
    input.kind === 'builder-handoff' ||
    input.kind === 'dispatch-verifier' ||
    input.kind === 'retry-checks' ||
    input.kind === 'verifier-response' ||
    input.kind === 'verifier-execution-error' ||
    input.kind === 'verifier-unavailable'
  );
}

function isSupervisorRunnerInput(input: NativeRunnerInput): boolean {
  return input.kind.startsWith('supervisor-');
}

function verifierCheckPlans(input: Extract<NativeRunnerInput, { kind: 'verifier-response' }>) {
  if (input.response.kind !== 'request-checks') return [];
  return input.response.checks.map(
    ({ id, name, executable, argv, cwdRef, timeoutMs, repeatable }) => ({
      id,
      name,
      executable,
      argv: [...argv],
      cwdRef,
      timeoutMs,
      repeatable,
    }),
  );
}

function assertPortableVerifyReadyBoundary(state: NativePortableState): void {
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready'
  ) {
    throw new Error('Native Runner check input requires an active Verify-ready candidate');
  }
}

function assertPortableVerifierResultBoundary(state: NativePortableState): void {
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result'
  ) {
    throw new Error('Native Runner Verifier input requires an active Verifier attempt');
  }
}

function assertBuilderAcceptanceIds(state: NativePortableState, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error('Native Builder addressed acceptance IDs contain duplicates');
  }
  const known = new Set(state.acceptance.map(({ id }) => id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Native Builder addressed acceptance IDs contain unknown IDs: ${unknown.join(', ')}`,
    );
  }
}

async function currentVerifierExecution(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NonNullable<NativeLocalExecutionState['execution']>> {
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
  );
  const execution = local?.execution;
  if (
    local === null ||
    local.basedOnStateVersion !== options.state.state_version ||
    !execution ||
    execution.stage !== 'verifying' ||
    execution.actor !== 'verifier' ||
    execution.status !== 'running' ||
    execution.executionId === null
  ) {
    throw new Error('Native Runner Verifier input requires an active Runtime Verifier execution');
  }
  return execution;
}

/**
 * Validate a parsed Runner input against the current persisted boundary
 * without recovering, reserving, writing, or starting a process.
 */
export async function validateNativeRunnerInputBoundary(options: {
  paths: NativeProjectPaths;
  name: string;
  state: NativePortableState;
  input: NativeRunnerInput;
  projectRoot: string;
}): Promise<void> {
  const overlay = await inspectNativeSupervisorOverlay({
    paths: options.paths,
    state: options.state,
  });
  if (overlay.status === 'incompatible') throw new Error(overlay.message);
  const supervisor =
    overlay.status === 'repairable-legacy-overlay'
      ? null
      : await readNativeSupervisorState(options.paths, options.name);
  const supervisorParentVerification =
    supervisor !== null &&
    options.state.phase === 'verify' &&
    supervisor.children.every(({ status }) => status === 'integrated' || status === 'archived');
  const supervisorParentReview =
    supervisor !== null &&
    options.state.phase === 'build' &&
    supervisor.children.every(({ status }) => status === 'integrated' || status === 'archived');
  const children = await inspectNativeChildren({ paths: options.paths, state: options.state });

  if (isSupervisorRunnerInput(options.input) && supervisor === null) {
    throw new Error('Native Supervisor Runner input requires a current Supervisor state');
  }
  if (
    supervisor &&
    isGenericPortableRunnerInput(options.input) &&
    !supervisorParentVerification &&
    !(options.input.kind === 'builder-handoff' && supervisorParentReview)
  ) {
    throw new Error(
      'Native Supervisor accepts only Supervisor task result inputs until every Child is integrated',
    );
  }

  if (options.input.kind === 'builder-handoff') {
    if (options.state.phase !== 'build' || options.state.status !== 'active') {
      throw new Error('Native Builder input requires an active Build boundary');
    }
    assertBuilderAcceptanceIds(options.state, options.input.addressed_acceptance_ids);
    if (children && (!children.confirmed || !children.allDone)) {
      throw new Error(
        'Native parent Build advances child changes and does not accept a Builder handoff',
      );
    }
    if (
      supervisorParentReview &&
      options.state.loop.stage === 'repairing' &&
      options.state.verification_result === 'fail'
    ) {
      throw new Error('Native parent verification failed; complete the repair child first');
    }
    return;
  }

  const executionRoot =
    supervisorParentVerification && supervisor
      ? supervisor.integration.worktree
      : options.projectRoot;

  if (options.input.kind === 'dispatch-verifier') {
    assertPortableVerifyReadyBoundary(options.state);
    if (supervisorParentVerification && options.input.checks.length === 0) {
      throw new Error('Native Supervisor parent verification requires at least one check');
    }
    preflightNativeCheckPlans(executionRoot, options.input.checks);
    return;
  }
  if (options.input.kind === 'retry-checks') {
    assertPortableVerifyReadyBoundary(options.state);
    if (
      options.input.check_ids.length === 0 ||
      new Set(options.input.check_ids).size !== options.input.check_ids.length
    ) {
      throw new Error('Native check retry list must contain unique IDs');
    }
    const local = await readNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, options.name),
    );
    for (const id of options.input.check_ids) {
      const check = local?.checks.find((entry) => entry.id === id);
      if (!check || check.status !== 'interrupted') {
        throw new Error(`Native check retry ID is not an interrupted current check: ${id}`);
      }
      if (!check.repeatable) {
        throw new Error(`Native check ${id} is not repeatable and cannot be retried`);
      }
      if (check.executionCount >= 3) {
        throw new Error(`Native check retry limit (3) reached: ${id}`);
      }
    }
    return;
  }
  if (options.input.kind === 'verifier-response') {
    assertPortableVerifierResultBoundary(options.state);
    const execution = await currentVerifierExecution({
      paths: options.paths,
      state: options.state,
    });
    if (
      options.input.candidateId !== options.state.builder_handoff?.candidate_id ||
      options.input.verifierExecutionRef !== execution.executionId
    ) {
      throw new Error(
        'Native Runner Verifier input is stale for the current candidate or execution',
      );
    }
    preflightNativeCheckPlans(executionRoot, verifierCheckPlans(options.input));
    return;
  }
  if (
    options.input.kind === 'verifier-execution-error' ||
    options.input.kind === 'verifier-unavailable'
  ) {
    assertPortableVerifierResultBoundary(options.state);
    const execution = await currentVerifierExecution({
      paths: options.paths,
      state: options.state,
    });
    if (
      options.input.stateVersion !== options.state.state_version ||
      options.input.iteration !== options.state.loop.iteration ||
      options.input.attempt !== options.state.loop.attempt ||
      options.input.verifierExecutionRef !== execution.executionId
    ) {
      throw new Error('Native Runner Verifier input is stale for the current attempt');
    }
    return;
  }

  if (options.input.kind === 'supervisor-checks') {
    const input = options.input;
    if (
      input.checks.length === 0 ||
      new Set(input.checks.map(({ id }) => id)).size !== input.checks.length
    ) {
      throw new Error('Native Supervisor checks require a non-empty plan with unique IDs');
    }
    if (input.checks.some(({ repeatable }) => !repeatable)) {
      throw new Error('Native Supervisor checks must be repeatable for safe recovery');
    }
    const task = supervisor?.children.find(({ name }) => name === input.child)?.task;
    if (!task || task.role !== 'verifier' || task.runId !== input.runId) {
      throw new Error('Native Supervisor check runId is not current');
    }
    if (
      input.retry_check_ids !== undefined &&
      (input.retry_check_ids.length === 0 ||
        new Set(input.retry_check_ids).size !== input.retry_check_ids.length)
    ) {
      throw new Error('Native Supervisor retry IDs must be non-empty and unique');
    }
    preflightNativeCheckPlans(task.projectRoot, input.checks);
    return;
  }
  if (options.input.kind === 'supervisor-integrate') {
    const input = options.input;
    if (
      input.checks.length === 0 ||
      new Set(input.checks.map(({ id }) => id)).size !== input.checks.length
    ) {
      throw new Error('Native Supervisor integration requires non-empty checks with unique IDs');
    }
    if (input.checks.some(({ repeatable }) => !repeatable)) {
      throw new Error('Native Supervisor integration checks must be repeatable for safe recovery');
    }
    if (
      input.retry_check_ids !== undefined &&
      (input.retry_check_ids.length === 0 ||
        new Set(input.retry_check_ids).size !== input.retry_check_ids.length)
    ) {
      throw new Error('Native Supervisor retry IDs must be non-empty and unique');
    }
    preflightNativeCheckPlans(supervisor!.integration.worktree, input.checks);
  }
}

function skillExecutionRef(role: 'builder' | 'verifier'): string {
  return `${NATIVE_SKILL_COORDINATION}:${role}:${randomUUID()}`;
}

function assertSupervisorTaskCommit(
  task: { projectRoot: string; baseCommit: string },
  commit: string,
  role: 'builder' | 'verifier',
  expectedBranch: string,
): void {
  const root = path.resolve(runGitCommand(task.projectRoot, ['rev-parse', '--show-toplevel']));
  if (root !== path.resolve(task.projectRoot)) {
    throw new Error(`Native Supervisor ${role} worktree identity is invalid`);
  }
  const branch = runGitCommand(task.projectRoot, ['branch', '--show-current']);
  if (branch !== expectedBranch) {
    throw new Error(`Native Supervisor ${role} result came from the wrong Child worktree branch`);
  }
  if (!nativeWorkspaceIsClean(task.projectRoot)) {
    throw new Error(`Native Supervisor ${role} worktree must be clean before returning a commit`);
  }
  const head = runGitCommand(task.projectRoot, ['rev-parse', 'HEAD']);
  if (head !== commit) {
    throw new Error(`Native Supervisor ${role} result is not bound to the worktree HEAD`);
  }
  try {
    runGitCommand(task.projectRoot, ['merge-base', '--is-ancestor', task.baseCommit, commit]);
  } catch (error) {
    throw new Error(`Native Supervisor ${role} result is not based on its task base commit`, {
      cause: error,
    });
  }
}

function assertSupervisorTaskWorkspaceIdentity(
  task: { projectRoot: string; baseCommit: string; role: 'builder' | 'verifier' },
  expectedBranch: string,
): void {
  const identity = inspectGitWorktree(task.projectRoot);
  const root = path.resolve(identity.currentWorktreeRoot ?? '');
  if (!identity.isGitWorktree || root !== path.resolve(task.projectRoot)) {
    throw new Error('Native Supervisor task worktree identity is invalid');
  }
  if (identity.currentBranch !== expectedBranch) {
    throw new Error('Native Supervisor task is attached to the wrong Child branch');
  }
  const head = runGitCommand(task.projectRoot, ['rev-parse', 'HEAD']);
  if (task.role === 'verifier') {
    if (!nativeWorkspaceIsClean(task.projectRoot) || head !== task.baseCommit) {
      throw new Error('Native Supervisor Verifier task worktree is not at its candidate commit');
    }
    return;
  }
  try {
    runGitCommand(task.projectRoot, ['merge-base', '--is-ancestor', task.baseCommit, head]);
  } catch (error) {
    throw new Error('Native Supervisor Builder task base commit is not an ancestor of its HEAD', {
      cause: error,
    });
  }
}

function assertSkillCoordinatedCandidate(state: NativePortableState): NativeBuilderHandoff {
  if (state.builder_handoff === null) {
    throw new Error('Native Skill coordination has no current Builder candidate');
  }
  if (state.builder_handoff.identity_provider !== NATIVE_SKILL_COORDINATION) {
    throw new Error(
      'Native candidate is owned by a host identity adapter and cannot use the generic Skill coordination bridge',
    );
  }
  return state.builder_handoff;
}

function latestRecoveryContext(state: NativePortableState) {
  return [...state.history].reverse().find(({ outcome }) => outcome === 'recovery')?.summary;
}

function verifierDispatch(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  checks: readonly NativePortableCheckSummary[];
  verifierExecutionRef: string;
  supervisor: NativeSupervisorState | null;
}) {
  const { paths, state, checks, verifierExecutionRef, supervisor } = options;
  const handoff = assertSkillCoordinatedCandidate(state);
  const recoveryContext = latestRecoveryContext(state);
  const scopeIds = state.acceptance
    .filter(({ result }) => result === 'pending')
    .map(({ id }) => id);
  return {
    coordination: NATIVE_SKILL_COORDINATION,
    change: state.name,
    candidateId: handoff.candidate_id,
    stateVersion: state.state_version,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
    verifierExecutionRef,
    projectRoot: paths.projectRoot,
    verificationRoot: supervisor?.integration.worktree ?? paths.projectRoot,
    changeDir: nativePortableChangeDir(paths, state.name),
    supervisorStateRef: supervisor ? nativeSupervisorStateFile(paths, state.name) : null,
    briefRef: state.brief,
    specRefs: state.spec_changes.map(({ capability, operation, source }) => ({
      capability,
      operation,
      ref: source,
    })),
    acceptanceCount: state.acceptance.length,
    scopeIds,
    detailsPageArgs: [
      'comet',
      'native',
      'status',
      state.name,
      '--details',
      '--json',
      '--project-root',
      paths.projectRoot,
    ],
    ...(recoveryContext === undefined ? {} : { recoveryContext }),
    builderReview: handoff.review
      ? {
          status: handoff.review.status,
          summary: handoff.review.summary,
        }
      : null,
    runtimeChecks: checks.map((check) => ({ ...check })),
  };
}

async function currentSkillVerifierExecutionRef(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<string> {
  assertSkillCoordinatedCandidate(options.state);
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
  );
  if (
    local === null ||
    local.change !== options.state.name ||
    local.basedOnStateVersion !== options.state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running' ||
    local.execution.executionId === null
  ) {
    throw new Error('Native Skill coordination has no active Verifier attempt');
  }
  return local.execution.executionId;
}

export async function applyNativeRunnerInput(options: {
  paths: NativeProjectPaths;
  name: string;
  input: NativeRunnerInput;
  maxVerifyFailures: number;
}) {
  const input = options.input;
  const portableBeforeInput = await readNativePortableChange(options.paths, options.name);
  const supervisorOverlay = await inspectNativeSupervisorOverlay({
    paths: options.paths,
    state: portableBeforeInput,
  });
  if (supervisorOverlay.status === 'incompatible') {
    throw new Error(supervisorOverlay.message);
  }
  const supervisor =
    supervisorOverlay.status === 'repairable-legacy-overlay'
      ? null
      : await readNativeSupervisorState(options.paths, options.name);
  const supervisorParentVerification =
    supervisor !== null &&
    portableBeforeInput?.phase === 'verify' &&
    supervisor.children.every(({ status }) => status === 'integrated' || status === 'archived');
  const supervisorParentReview =
    supervisor !== null &&
    portableBeforeInput?.phase === 'build' &&
    supervisor.children.every(({ status }) => status === 'integrated' || status === 'archived');
  if (supervisor && input.kind === 'supervisor-checks') {
    const execution = await executeNativeSupervisorChecks({
      paths: options.paths,
      parent: options.name,
      child: input.child,
      runId: input.runId,
      plans: input.checks,
      materials: input.materials,
      ...(input.retry_check_ids === undefined ? {} : { retryCheckIds: input.retry_check_ids }),
    });
    const updatedSupervisor = await readNativeSupervisorState(options.paths, options.name);
    const updatedTask = updatedSupervisor?.children.find(({ name }) => name === input.child)?.task;
    return {
      state: portableBeforeInput,
      supervisorState: updatedSupervisor,
      supervisorTask:
        updatedTask && updatedTask.runId === input.runId
          ? projectNativeSupervisorTask(updatedTask, options.name, options.paths.projectRoot)
          : null,
      checks: [],
      checkExecution: execution,
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(portableBeforeInput),
    };
  }
  if (supervisor && input.kind === 'supervisor-builder-result') {
    return withNativeMutationLock(
      options.paths,
      `apply Native Supervisor Builder result ${input.child}`,
      async () => {
        const current = await readNativeSupervisorState(options.paths, options.name);
        if (!current) throw new Error(`Native Supervisor state is missing for ${options.name}`);
        const child = current.children.find(({ name }) => name === input.child);
        if (!child?.task || child.task.role !== 'builder') {
          throw new Error(`Native Supervisor Builder task is not active for ${input.child}`);
        }
        try {
          assertSupervisorTaskCommit(
            child.task,
            input.candidateCommit,
            'builder',
            `comet/supervisor/${current.parent}/${input.child}`,
          );
        } catch (error) {
          await writeNativeSupervisorState(
            options.paths,
            blockNativeSupervisorTask(current, {
              child: input.child,
              runId: input.runId,
              reason: (error as Error).message,
            }),
          );
          throw error;
        }
        const projectRoot = child.task.projectRoot;
        const candidate = applyNativeSupervisorBuilderResult(current, input);
        const verifier = createNativeSupervisorTask(candidate, {
          role: 'verifier',
          child: input.child,
          projectRoot,
          runId: randomUUID(),
        });
        await writeNativeSupervisorState(options.paths, verifier.state);
        const portableState = await readNativePortableChange(options.paths, options.name);
        return {
          state: portableState,
          supervisorTask: projectNativeSupervisorTask(
            verifier.task,
            options.name,
            options.paths.projectRoot,
          ),
          checks: [],
          requestChecks: null,
          verifierDispatch: null,
          continuation: nativePortableContinuation(portableState),
        };
      },
    );
  }
  if (supervisor && input.kind === 'supervisor-builder-failure') {
    return withNativeMutationLock(
      options.paths,
      `cancel Native Supervisor Builder task ${input.child}`,
      async () => {
        const current = await readNativeSupervisorState(options.paths, options.name);
        if (!current) throw new Error(`Native Supervisor state is missing for ${options.name}`);
        const child = current.children.find(({ name }) => name === input.child);
        if (!child?.task || child.task.role !== 'builder') {
          throw new Error(`Native Supervisor Builder failure is not valid for ${input.child}`);
        }
        const state = cancelNativeSupervisorTask(current, {
          child: input.child,
          runId: input.runId,
          reason: input.reason,
        });
        await writeNativeSupervisorState(options.paths, state);
        const portableState = await readNativePortableChange(options.paths, options.name);
        return {
          state: portableState,
          supervisorState: state,
          supervisorTask: null,
          checks: [],
          requestChecks: null,
          verifierDispatch: null,
          continuation: nativePortableContinuation(portableState),
        };
      },
    );
  }
  if (supervisor && input.kind === 'supervisor-reconnect') {
    return withNativeMutationLock(
      options.paths,
      `reconnect Native Supervisor task ${input.child}`,
      async () => {
        const current = await readNativeSupervisorState(options.paths, options.name);
        if (!current) throw new Error(`Native Supervisor state is missing for ${options.name}`);
        const task = current.children.find(({ name }) => name === input.child)?.task;
        if (!task || task.runId !== input.runId) {
          throw new Error(`Native Supervisor task runId is not current for ${input.child}`);
        }
        try {
          assertSupervisorTaskWorkspaceIdentity(
            task,
            `comet/supervisor/${current.parent}/${input.child}`,
          );
        } catch (error) {
          await writeNativeSupervisorState(
            options.paths,
            blockNativeSupervisorTask(current, {
              child: input.child,
              runId: input.runId,
              reason: (error as Error).message,
            }),
          );
          throw error;
        }
        const reconnected = reconnectNativeSupervisorTaskWithState(current, {
          child: input.child,
          runId: input.runId,
        });
        await writeNativeSupervisorState(options.paths, reconnected.state);
        const portableState = await readNativePortableChange(options.paths, options.name);
        return {
          state: portableState,
          supervisorState: reconnected.state,
          supervisorTask: projectNativeSupervisorTask(
            reconnected.task,
            options.name,
            options.paths.projectRoot,
          ),
          checks: [],
          requestChecks: null,
          verifierDispatch: null,
          continuation: nativePortableContinuation(portableState),
        };
      },
    );
  }
  if (supervisor && input.kind === 'supervisor-cancel') {
    return withNativeMutationLock(
      options.paths,
      `cancel Native Supervisor task ${input.child}`,
      async () => {
        const current = await readNativeSupervisorState(options.paths, options.name);
        if (!current) throw new Error(`Native Supervisor state is missing for ${options.name}`);
        const state = cancelNativeSupervisorTask(current, {
          child: input.child,
          runId: input.runId,
          reason: input.reason,
        });
        await writeNativeSupervisorState(options.paths, state);
        const portableState = await readNativePortableChange(options.paths, options.name);
        return {
          state: portableState,
          supervisorState: state,
          supervisorTask: null,
          checks: [],
          requestChecks: null,
          verifierDispatch: null,
          continuation: nativePortableContinuation(portableState),
        };
      },
    );
  }
  if (supervisor && input.kind === 'supervisor-verifier-result') {
    return withNativeMutationLock(
      options.paths,
      `apply Native Supervisor Verifier result ${input.child}`,
      async () => {
        const current = await readNativeSupervisorState(options.paths, options.name);
        if (!current) throw new Error(`Native Supervisor state is missing for ${options.name}`);
        const child = current.children.find(({ name }) => name === input.child);
        if (!child?.task || child.task.role !== 'verifier' || !child.candidateCommit) {
          throw new Error(`Native Supervisor Verifier task is not active for ${input.child}`);
        }
        try {
          assertSupervisorTaskCommit(
            child.task,
            child.candidateCommit,
            'verifier',
            `comet/supervisor/${current.parent}/${input.child}`,
          );
        } catch (error) {
          await writeNativeSupervisorState(
            options.paths,
            blockNativeSupervisorTask(current, {
              child: input.child,
              runId: input.runId,
              reason: (error as Error).message,
            }),
          );
          throw error;
        }
        const evidence =
          input.evidence.receiptRef || input.verdict === 'pass'
            ? await readNativeSupervisorCheckEvidence({
                paths: options.paths,
                parent: options.name,
                task: child.task,
                receiptRef: input.evidence.receiptRef ?? '',
              })
            : null;
        if (
          input.verdict === 'pass' &&
          (!evidence ||
            evidence.checks.some(({ status, exitCode }) => status !== 'passed' || exitCode !== 0))
        )
          throw new Error(
            'Native Supervisor verification cannot pass before every Runtime check succeeds',
          );
        const state = applyNativeSupervisorVerifierResult(current, {
          ...input,
          evidence: {
            ...input.evidence,
            checks: evidence?.checks.map(({ name, status }) => `${name}: ${status}`) ?? [],
            execution: structuredClone(child.task),
          },
        });
        await writeNativeSupervisorState(options.paths, state);
        const portableState = await readNativePortableChange(options.paths, options.name);
        return {
          state: portableState,
          supervisorState: state,
          supervisorTask: null,
          checks: [],
          requestChecks: null,
          verifierDispatch: null,
          continuation: nativePortableContinuation(portableState),
        };
      },
    );
  }
  if (supervisor && input.kind === 'supervisor-integrate') {
    const state = await integrateNativeSupervisorChildWorkspace({
      paths: options.paths,
      state: supervisor,
      name: input.child,
      checks: [],
      checkPlans: input.checks,
      ...(input.retry_check_ids === undefined ? {} : { retryCheckIds: input.retry_check_ids }),
    });
    const parentAdvance = await inspectNativeSupervisorParentReviewReadiness({
      paths: options.paths,
      name: options.name,
      trigger: 'v2-integrate',
    });
    const finalState = parentAdvance.state;
    return {
      state: finalState,
      supervisorState: state,
      supervisorTask: null,
      checks: input.checks,
      requestChecks: null,
      verifierDispatch: null,
      parentAdvance: parentAdvance.parentAdvance,
      continuation: nativePortableContinuation(finalState),
    };
  }
  if (
    supervisor &&
    (input.kind === 'builder-handoff' ||
      input.kind === 'dispatch-verifier' ||
      input.kind === 'retry-checks' ||
      input.kind === 'verifier-response' ||
      input.kind === 'verifier-execution-error' ||
      input.kind === 'verifier-unavailable' ||
      input.kind === 'supervisor-builder-result' ||
      input.kind === 'supervisor-builder-failure' ||
      input.kind === 'supervisor-reconnect' ||
      input.kind === 'supervisor-cancel' ||
      input.kind === 'supervisor-verifier-result') &&
    !supervisorParentVerification &&
    !(input.kind === 'builder-handoff' && supervisorParentReview)
  ) {
    throw new Error(
      'Native Supervisor accepts only Supervisor task result inputs until every Child is integrated',
    );
  }
  if (input.kind === 'builder-handoff') {
    const runner = createNativeRunnerChannel();
    const identity = runner.captureExecutionIdentity({
      identityProvider: NATIVE_SKILL_COORDINATION,
      executionRef: skillExecutionRef('builder'),
    });
    const state = await submitNativePortableBuilderCandidate({
      paths: options.paths,
      name: options.name,
      input: {
        identity,
        summary: input.summary,
        addressedAcceptanceIds: input.addressed_acceptance_ids,
        checks: input.checks,
        knownLimits: input.known_limits,
        review: input.review
          ? {
              status: input.review.status,
              summary: input.review.summary,
              reviewerExecutionRef: input.review.reviewer_execution_ref,
            }
          : null,
      },
    });
    return {
      state,
      checks: [],
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(state),
    };
  }
  if (input.kind === 'retry-checks') {
    if (supervisor && !supervisorParentVerification) {
      throw new Error(
        'Native Supervisor check retry is only valid after every Child is integrated',
      );
    }
    const ready = await readNativePortableChange(options.paths, options.name);
    assertSkillCoordinatedCandidate(ready);
    const result = await retryNativePortableCheckPlan({
      paths: options.paths,
      name: options.name,
      checkIds: input.check_ids,
      ...(supervisorParentVerification && supervisor
        ? { projectRoot: supervisor.integration.worktree }
        : {}),
    });
    const interrupted = result.checks
      .filter(({ status }) => status === 'interrupted')
      .map(({ id }) => id);
    return {
      state: result.state,
      checks: result.checks,
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(result.state, undefined, {
        retryCheckIds: interrupted.length > 0 ? interrupted : undefined,
      }),
    };
  }
  if (input.kind === 'dispatch-verifier') {
    if (supervisorParentVerification && input.checks.length === 0) {
      throw new Error('Native Supervisor parent verification requires at least one check');
    }
    const ready = await readNativePortableChange(options.paths, options.name);
    if (
      ready.builder_handoff !== null &&
      ready.builder_handoff.identity_provider !== NATIVE_SKILL_COORDINATION
    ) {
      const state = await returnNativePortableChangeToBuild({
        paths: options.paths,
        name: options.name,
        reason:
          'The previous Builder identity provider is unavailable to the generic Skill bridge; submit a new Builder candidate before dispatching a Verifier.',
      });
      return {
        state,
        checks: [],
        requestChecks: null,
        verifierDispatch: null,
        continuation: nativePortableContinuation(state),
      };
    }
    assertSkillCoordinatedCandidate(ready);
    const executedChecks = (
      await executeNativePortableCheckPlan({
        paths: options.paths,
        name: options.name,
        plans: input.checks,
        ...(supervisorParentVerification && supervisor
          ? { projectRoot: supervisor.integration.worktree }
          : {}),
      })
    ).checks;
    const interruptedIds = executedChecks
      .filter(({ status }) => status === 'interrupted')
      .map(({ id }) => id);
    if (interruptedIds.length > 0) {
      const nonRepeatable = input.checks
        .filter(({ id, repeatable }) => interruptedIds.includes(id) && !repeatable)
        .map(({ id }) => id);
      if (nonRepeatable.length > 0) {
        throw new Error(
          `Native non-repeatable checks were interrupted and require a new Builder candidate: ${nonRepeatable.join(', ')}`,
        );
      }
      const ready = await readNativePortableChange(options.paths, options.name);
      return {
        state: ready,
        checks: executedChecks,
        requestChecks: null,
        verifierDispatch: null,
        continuation: nativePortableContinuation(ready, undefined, {
          retryCheckIds: interruptedIds,
        }),
      };
    }
    const verifierExecutionRef = skillExecutionRef('verifier');
    const state = await dispatchNativePortableVerifier({
      paths: options.paths,
      name: options.name,
      checks: executedChecks,
      verifierExecutionId: verifierExecutionRef,
      ...(supervisorParentVerification && supervisor
        ? { projectRoot: supervisor.integration.worktree }
        : {}),
    });
    return {
      state,
      checks: executedChecks,
      requestChecks: null,
      verifierDispatch: verifierDispatch({
        paths: options.paths,
        state,
        checks: executedChecks,
        verifierExecutionRef,
        supervisor: supervisorParentVerification ? supervisor : null,
      }),
      continuation: nativePortableContinuation(state, undefined, { verifierExecutionRef }),
    };
  }
  if (input.kind === 'verifier-execution-error') {
    const current = await readNativePortableChange(options.paths, options.name);
    assertSkillCoordinatedCandidate(current);
    await currentSkillVerifierExecutionRef({ paths: options.paths, state: current });
    const state = await recordNativePortableVerifierFailure({
      paths: options.paths,
      name: options.name,
      summary: input.summary,
      expected: input,
      requireSkillCoordination: true,
    });
    return {
      state,
      checks: [],
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(state),
    };
  }
  if (input.kind === 'verifier-unavailable') {
    const state = await recordNativePortableVerifierUnavailable({
      paths: options.paths,
      name: options.name,
      summary: input.summary,
      expected: input,
      requireSkillCoordination: true,
    });
    return {
      state,
      checks: state.verification?.checks ?? [],
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(state),
    };
  }
  if (input.kind !== 'verifier-response') {
    throw new Error('Native Runner input kind is invalid for the portable verifier bridge');
  }
  const state = await readNativePortableChange(options.paths, options.name);
  const handoff = assertSkillCoordinatedCandidate(state);
  const executionRef = await currentSkillVerifierExecutionRef({ paths: options.paths, state });
  if (input.candidateId !== handoff.candidate_id || input.verifierExecutionRef !== executionRef) {
    throw new Error('Native Runner Verifier input is stale for the current candidate or execution');
  }
  const runner = createNativeRunnerChannel();
  const verifierIdentity = runner.captureExecutionIdentity({
    identityProvider: NATIVE_SKILL_COORDINATION,
    executionRef,
  });
  let supervisorForFinalResult: NativeSupervisorState | null = null;
  if (
    supervisorParentVerification &&
    typeof input.response === 'object' &&
    input.response !== null &&
    'kind' in input.response &&
    input.response.kind === 'final-result'
  ) {
    const currentSupervisor = await readNativeSupervisorState(options.paths, options.name);
    if (!currentSupervisor)
      throw new Error('Native Supervisor state disappeared before final verification');
    supervisorForFinalResult = advanceNativeSupervisorFinalVerificationHead(currentSupervisor);
  }
  const applied = await submitNativePortableVerifierResult({
    paths: options.paths,
    name: options.name,
    envelope: runner.envelopeVerifierResponse({
      candidateId: handoff.candidate_id,
      identity: verifierIdentity,
      payload: input.response,
    }),
    checks: [],
    maxVerifyFailures: options.maxVerifyFailures,
    ...(supervisorParentVerification && supervisor
      ? { projectRoot: supervisor.integration.worktree }
      : {}),
  });
  if (supervisorParentVerification && applied.response.kind === 'final-result') {
    if (
      applied.state.verification_result === 'pass' &&
      (applied.checks.length === 0 || applied.checks.some(({ status }) => status !== 'passed'))
    ) {
      throw new Error(
        'Native Supervisor parent verification cannot pass without completed integration checks',
      );
    }
    const supervisorState =
      supervisorForFinalResult ?? (await readNativeSupervisorState(options.paths, options.name));
    if (!supervisorState)
      throw new Error('Native Supervisor state disappeared during verification');
    const nextSupervisor = recordNativeSupervisorPortableFinalVerification(
      supervisorState,
      applied.state,
    );
    await writeNativeSupervisorState(options.paths, nextSupervisor);
    return {
      ...applied,
      supervisorState: nextSupervisor,
      verifierDispatch: null,
      continuation: nativePortableContinuation(applied.state),
    };
  }
  return {
    ...applied,
    verifierDispatch:
      applied.requestChecks === null
        ? null
        : verifierDispatch({
            paths: options.paths,
            state: applied.state,
            checks: applied.checks,
            verifierExecutionRef: await currentSkillVerifierExecutionRef({
              paths: options.paths,
              state: applied.state,
            }),
            supervisor: supervisorParentVerification ? supervisor : null,
          }),
    continuation: nativePortableContinuation(applied.state, undefined, {
      verifierExecutionRef: executionRef,
    }),
  };
}
