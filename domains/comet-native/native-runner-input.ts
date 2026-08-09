import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

export type NativeRunnerInput =
  | RunnerBuilderInput
  | RunnerDispatchInput
  | RunnerVerifierInput
  | RunnerExecutionErrorInput
  | RunnerVerifierUnavailableInput;

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
  if (options.input.kind === 'builder-handoff') {
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
        summary: options.input.summary,
        addressedAcceptanceIds: options.input.addressed_acceptance_ids,
        checks: options.input.checks,
        knownLimits: options.input.known_limits,
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
  if (options.input.kind === 'dispatch-verifier') {
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
      plans: options.input.checks,
    });
    const verifierExecutionRef = skillExecutionRef('verifier');
    const state = await dispatchNativePortableVerifier({
      paths: options.paths,
      name: options.name,
      checks: executed.checks,
      verifierExecutionId: verifierExecutionRef,
    });
    return {
      state,
      checks: executed.checks,
      requestChecks: null,
      verifierDispatch: verifierDispatch(state, executed.checks, verifierExecutionRef),
      continuation: nativePortableContinuation(state),
    };
  }
  if (options.input.kind === 'verifier-execution-error') {
    const current = await readNativePortableChange(options.paths, options.name);
    assertSkillCoordinatedCandidate(current);
    await currentSkillVerifierExecutionRef({ paths: options.paths, state: current });
    const state = await recordNativePortableVerifierFailure({
      paths: options.paths,
      name: options.name,
      summary: options.input.summary,
      expected: options.input,
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
  if (options.input.kind === 'verifier-unavailable') {
    const state = await recordNativePortableVerifierUnavailable({
      paths: options.paths,
      name: options.name,
      summary: options.input.summary,
      expected: options.input,
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
      payload: options.input.response,
    }),
    checks: [],
    maxVerifyFailures: options.maxVerifyFailures,
  });
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
