import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { gitWorktreeIsClean, runGitCommand } from '../../platform/process/git.js';

import type { NativeCheckPlan } from './native-check-executor.js';
import { readNativeLocalExecution } from './native-local-execution.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativeLocalExecutionFile,
  readNativePortableChange,
  recordNativePortableVerifierFailure,
  recordNativePortableVerifierUnavailable,
  returnNativePortableChangeToBuild,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from './native-portable-runtime.js';
import {
  applyNativeSupervisorBuilderResult,
  applyNativeSupervisorVerifierResult,
  createNativeSupervisorTask,
  integrateNativeSupervisorChildWorkspace,
  recordNativeSupervisorFinalVerification,
  readNativeSupervisorState,
  writeNativeSupervisorState,
  type NativeSupervisorIntegrationCheck,
  type NativeSupervisorVerificationEvidence,
} from './native-supervisor.js';
import { createNativeRunnerChannel, NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type {
  NativeBuilderHandoff,
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
}

interface RunnerDispatchInput {
  kind: 'dispatch-verifier';
  checks: NativeCheckPlan[];
}

interface RunnerVerifierInput {
  kind: 'verifier-response';
  response: unknown;
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

interface RunnerSupervisorVerifierInput {
  kind: 'supervisor-verifier-result';
  child: string;
  runId: string;
  verdict: 'pass' | 'fail' | 'incomplete';
  evidence: NativeSupervisorVerificationEvidence;
}

interface RunnerSupervisorIntegrateInput {
  kind: 'supervisor-integrate';
  child: string;
  checks: NativeSupervisorIntegrationCheck[];
}

export type NativeRunnerInput =
  | RunnerBuilderInput
  | RunnerDispatchInput
  | RunnerVerifierInput
  | RunnerExecutionErrorInput
  | RunnerVerifierUnavailableInput
  | RunnerSupervisorBuilderInput
  | RunnerSupervisorVerifierInput
  | RunnerSupervisorIntegrateInput;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
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
    exactKeys(input, ['name', 'result', 'note'], `Native Builder check ${index}`);
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
  exactKeys(input, ['summary', 'checks'], 'Native Supervisor evidence');
  return {
    summary: text(input.summary, 'Native Supervisor evidence summary'),
    checks: strings(input.checks, 'Native Supervisor evidence checks'),
  };
}

function supervisorIntegrationChecks(value: unknown): NativeSupervisorIntegrationCheck[] {
  if (!Array.isArray(value))
    throw new Error('Native Supervisor integration checks must be an array');
  return value.map((entry, index) => {
    const input = record(entry, `Native Supervisor integration check ${index}`);
    const allowed = new Set(['name', 'status', 'reason']);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new Error(`Native Supervisor integration check ${index} fields are invalid`);
    }
    if (!Object.hasOwn(input, 'name') || !Object.hasOwn(input, 'status')) {
      throw new Error(`Native Supervisor integration check ${index} fields are invalid`);
    }
    if (!['passed', 'failed', 'incomplete'].includes(String(input.status))) {
      throw new Error(`Native Supervisor integration check ${index} status is invalid`);
    }
    if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') {
      throw new Error(`Native Supervisor integration check ${index} reason is invalid`);
    }
    return {
      name: text(input.name, `Native Supervisor integration check ${index} name`),
      status: input.status as NativeSupervisorIntegrationCheck['status'],
      reason: (input.reason as string | null | undefined) ?? null,
    };
  });
}

export function parseNativeRunnerInput(value: unknown): NativeRunnerInput {
  const input = record(value, 'Native Runner input');
  if (input.kind === 'builder-handoff') {
    exactKeys(
      input,
      ['kind', 'summary', 'addressed_acceptance_ids', 'checks', 'known_limits'],
      'Native Runner Builder input',
    );
    return {
      kind: 'builder-handoff',
      summary: text(input.summary, 'Native Builder summary'),
      addressed_acceptance_ids: strings(
        input.addressed_acceptance_ids,
        'Native Builder addressed acceptance IDs',
      ),
      checks: builderChecks(input.checks),
      known_limits: strings(input.known_limits, 'Native Builder known limits'),
    };
  }
  if (input.kind === 'dispatch-verifier') {
    exactKeys(input, ['kind', 'checks'], 'Native Runner dispatch input');
    return { kind: 'dispatch-verifier', checks: checkPlans(input.checks) };
  }
  if (input.kind === 'verifier-response') {
    exactKeys(input, ['kind', 'response'], 'Native Runner Verifier input');
    return {
      kind: 'verifier-response',
      response: input.response,
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
  if (input.kind === 'supervisor-verifier-result') {
    exactKeys(
      input,
      ['kind', 'child', 'runId', 'verdict', 'evidence'],
      'Native Supervisor Verifier input',
    );
    if (!['pass', 'fail', 'incomplete'].includes(String(input.verdict))) {
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
  if (input.kind === 'supervisor-integrate') {
    exactKeys(input, ['kind', 'child', 'checks'], 'Native Supervisor integration input');
    return {
      kind: 'supervisor-integrate',
      child: text(input.child, 'Native Supervisor child'),
      checks: supervisorIntegrationChecks(input.checks),
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
    parsed = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    throw new Error('Native Runner input must be valid JSON', { cause: error });
  }
  return parseNativeRunnerInput(parsed);
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
  if (!gitWorktreeIsClean(task.projectRoot)) {
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

function publicBuilderHandoff(handoff: NativeBuilderHandoff) {
  return {
    iteration: handoff.iteration,
    summary: handoff.summary,
    addressedAcceptanceIds: [...handoff.addressed_acceptance_ids],
    checks: handoff.checks.map((check) => ({
      name: check.name,
      result: check.result,
      note: check.note,
    })),
    checksTruncated: handoff.checks_truncated,
    knownLimits: handoff.known_limits.map((entry) => ({ ...entry })),
    knownLimitsTruncated: handoff.known_limits_truncated,
    submittedAt: handoff.submitted_at,
  };
}

function verifierDispatch(
  state: NativePortableState,
  checks: readonly NativePortableCheckSummary[],
  verifierExecutionRef: string,
) {
  const handoff = assertSkillCoordinatedCandidate(state);
  return {
    coordination: NATIVE_SKILL_COORDINATION,
    change: state.name,
    candidateId: handoff.candidate_id,
    stateVersion: state.state_version,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
    verifierExecutionRef,
    briefRef: state.brief,
    specRefs: state.spec_changes.map(({ capability, operation, source }) => ({
      capability,
      operation,
      ref: source,
    })),
    acceptance: state.acceptance.map(({ id, source, text: acceptanceText }) => ({
      id,
      source,
      text: acceptanceText,
    })),
    builderHandoff: publicBuilderHandoff(handoff),
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
  const supervisor = await readNativeSupervisorState(options.paths, options.name);
  const input = options.input;
  const portableBeforeInput = supervisor
    ? await readNativePortableChange(options.paths, options.name)
    : null;
  const supervisorParentVerification =
    supervisor !== null &&
    portableBeforeInput?.phase === 'verify' &&
    supervisor.children.every(({ status }) => status === 'integrated' || status === 'archived');
  if (supervisor && input.kind === 'supervisor-builder-result') {
    const child = supervisor.children.find(({ name }) => name === input.child);
    if (!child?.task || child.task.role !== 'builder') {
      throw new Error(`Native Supervisor Builder task is not active for ${input.child}`);
    }
    assertSupervisorTaskCommit(
      child.task,
      input.candidateCommit,
      'builder',
      `comet/supervisor/${supervisor.parent}/${input.child}`,
    );
    const projectRoot = child.task.projectRoot;
    const candidate = applyNativeSupervisorBuilderResult(supervisor, input);
    const verifier = createNativeSupervisorTask(candidate, {
      role: 'verifier',
      child: input.child,
      projectRoot,
      runId: randomUUID(),
    });
    const portableState = await readNativePortableChange(options.paths, options.name);
    await writeNativeSupervisorState(options.paths, verifier.state);
    return {
      state: portableState,
      supervisorTask: verifier.task,
      checks: [],
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(
        await readNativePortableChange(options.paths, options.name),
      ),
    };
  }
  if (supervisor && input.kind === 'supervisor-verifier-result') {
    const child = supervisor.children.find(({ name }) => name === input.child);
    if (!child?.task || child.task.role !== 'verifier' || !child.candidateCommit) {
      throw new Error(`Native Supervisor Verifier task is not active for ${input.child}`);
    }
    assertSupervisorTaskCommit(
      child.task,
      child.candidateCommit,
      'verifier',
      `comet/supervisor/${supervisor.parent}/${input.child}`,
    );
    const state = applyNativeSupervisorVerifierResult(supervisor, input);
    await writeNativeSupervisorState(options.paths, state);
    return {
      state: await readNativePortableChange(options.paths, options.name),
      supervisorState: state,
      supervisorTask: null,
      checks: [],
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(
        await readNativePortableChange(options.paths, options.name),
      ),
    };
  }
  if (supervisor && input.kind === 'supervisor-integrate') {
    const state = await integrateNativeSupervisorChildWorkspace({
      paths: options.paths,
      state: supervisor,
      name: input.child,
      checks: input.checks,
    });
    return {
      state: await readNativePortableChange(options.paths, options.name),
      supervisorState: state,
      supervisorTask: null,
      checks: input.checks,
      requestChecks: null,
      verifierDispatch: null,
      continuation: nativePortableContinuation(
        await readNativePortableChange(options.paths, options.name),
      ),
    };
  }
  if (
    supervisor &&
    (input.kind === 'builder-handoff' ||
      input.kind === 'dispatch-verifier' ||
      input.kind === 'verifier-response' ||
      input.kind === 'verifier-execution-error' ||
      input.kind === 'verifier-unavailable') &&
    !supervisorParentVerification
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
    const executed = await executeNativePortableCheckPlan({
      paths: options.paths,
      name: options.name,
      plans: input.checks,
      ...(supervisorParentVerification && supervisor
        ? { projectRoot: supervisor.integration.worktree }
        : {}),
    });
    const verifierExecutionRef = skillExecutionRef('verifier');
    const state = await dispatchNativePortableVerifier({
      paths: options.paths,
      name: options.name,
      checks: executed.checks,
      verifierExecutionId: verifierExecutionRef,
      ...(supervisorParentVerification && supervisor
        ? { projectRoot: supervisor.integration.worktree }
        : {}),
    });
    return {
      state,
      checks: executed.checks,
      requestChecks: null,
      verifierDispatch: verifierDispatch(state, executed.checks, verifierExecutionRef),
      continuation: nativePortableContinuation(state),
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
  const runner = createNativeRunnerChannel();
  const verifierIdentity = runner.captureExecutionIdentity({
    identityProvider: NATIVE_SKILL_COORDINATION,
    executionRef,
  });
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
  if (supervisorParentVerification) {
    if (
      applied.state.verification_result === 'pass' &&
      (applied.checks.length === 0 || applied.checks.some(({ status }) => status !== 'passed'))
    ) {
      throw new Error(
        'Native Supervisor parent verification cannot pass without completed integration checks',
      );
    }
    const supervisorState = await readNativeSupervisorState(options.paths, options.name);
    if (!supervisorState)
      throw new Error('Native Supervisor state disappeared during verification');
    const integrationHead = runGitCommand(supervisorState.integration.worktree, [
      'rev-parse',
      'HEAD',
    ]);
    const responseResult =
      applied.response.kind === 'final-result' ? applied.response.result : null;
    const parentSummary =
      responseResult?.summary ?? 'Native Supervisor parent verification completed';
    const childVerification = supervisorState.children.every(
      ({ status, verification }) =>
        (status === 'integrated' || status === 'archived') && verification !== null,
    );
    const parentIntegration =
      applied.checks.length > 0 && applied.checks.every(({ status }) => status === 'passed');
    const nextSupervisor = recordNativeSupervisorFinalVerification(supervisorState, {
      status:
        applied.state.verification_result === 'pass'
          ? 'passed'
          : applied.state.verification_result === 'blocked'
            ? 'incomplete'
            : 'failed',
      summary: parentSummary,
      headCommit: integrationHead,
      layers: {
        childVerification: childVerification ? 'complete' : 'incomplete',
        parentIntegration: parentIntegration ? 'complete' : 'incomplete',
        parentChecks: applied.checks.map(({ name }) => name.text),
        notRerun: supervisorState.children.flatMap(
          ({ verification }) => verification?.checks ?? [],
        ),
        incomplete: applied.checks
          .filter(({ status }) => status !== 'passed')
          .map(({ name }) => name.text),
      },
    });
    await writeNativeSupervisorState(options.paths, nextSupervisor);
    return {
      ...applied,
      supervisorState: nextSupervisor,
      continuation: nativePortableContinuation(applied.state),
    };
  }
  return {
    ...applied,
    verifierDispatch:
      applied.requestChecks === null
        ? null
        : verifierDispatch(
            applied.state,
            applied.checks,
            await currentSkillVerifierExecutionRef({ paths: options.paths, state: applied.state }),
          ),
    continuation: nativePortableContinuation(applied.state),
  };
}
