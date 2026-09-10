import { assertNativeInputKeys as exactKeys } from './native-input-error.js';
import {
  isNativeTrustedVerifierEnvelope,
  type NativeTrustedVerifierEnvelope,
} from './native-runner-protocol.js';

export type NativeAcceptanceVerdict = 'passed' | 'failed' | 'blocked';

export interface NativeVerifierAcceptanceResult {
  id: string;
  result: NativeAcceptanceVerdict;
  reason: string;
}

export interface NativeVerifierFinalResult {
  iteration: number;
  attempt: number;
  verdict: 'pass' | 'fail' | 'blocked';
  acceptance: NativeVerifierAcceptanceResult[];
  risks: string[];
  summary: string;
}

export interface NativeVerifierCheckRequest {
  id: string;
  name: string;
  executable: string;
  argv: string[];
  cwdRef: string;
  timeoutMs: number;
  repeatable: boolean;
}

export type NativeVerifierResponse =
  | {
      kind: 'request-checks';
      iteration: number;
      attempt: number;
      checks: NativeVerifierCheckRequest[];
    }
  | {
      kind: 'final-result';
      result: NativeVerifierFinalResult;
    };

export interface NativeVerifierBinding {
  candidateId: string;
  identityProvider: string;
  builderExecutionRef: string;
  iteration: number;
  attempt: number;
  acceptanceIds: readonly string[];
  requiredChecksPassed: boolean;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be non-empty text`);
  }
  return value;
}

export function parseNativeVerifierAcceptance(
  value: unknown,
  inputPath = '/acceptance',
): NativeVerifierAcceptanceResult[] {
  if (!Array.isArray(value)) throw new Error('Native Verifier acceptance must be an array');
  return value.map((entry, index) => {
    const item = plainRecord(entry, `Native Verifier acceptance ${index}`);
    exactKeys(
      item,
      ['id', 'result', 'reason'],
      `Native Verifier acceptance ${index}`,
      `${inputPath}/${index}`,
    );
    const id = text(item.id, `Native Verifier acceptance ${index} ID`);
    if (!['passed', 'failed', 'blocked'].includes(String(item.result))) {
      throw new Error(`Native Verifier acceptance ${id} result is invalid`);
    }
    return {
      id,
      result: item.result as NativeAcceptanceVerdict,
      reason: text(item.reason, `Native Verifier acceptance ${id} reason`),
    };
  });
}

function parseFinalResult(value: unknown, inputPath: string): NativeVerifierFinalResult {
  const input = plainRecord(value, 'Native Verifier final result');
  exactKeys(
    input,
    ['iteration', 'attempt', 'verdict', 'acceptance', 'risks', 'summary'],
    'Native Verifier final result',
    inputPath,
  );
  if (!['pass', 'fail', 'blocked'].includes(String(input.verdict))) {
    throw new Error('Native Verifier verdict is invalid');
  }
  if (!Array.isArray(input.risks) || !input.risks.every((risk) => typeof risk === 'string')) {
    throw new Error('Native Verifier risks must be text entries');
  }
  return {
    iteration: integer(input.iteration, 'Native Verifier iteration'),
    attempt: integer(input.attempt, 'Native Verifier attempt'),
    verdict: input.verdict as NativeVerifierFinalResult['verdict'],
    acceptance: parseNativeVerifierAcceptance(input.acceptance, `${inputPath}/acceptance`),
    risks: input.risks as string[],
    summary: text(input.summary, 'Native Verifier summary'),
  };
}

function parseCheckRequest(
  value: unknown,
  index: number,
  inputPath: string,
): NativeVerifierCheckRequest {
  const input = plainRecord(value, `Native Verifier check request ${index}`);
  exactKeys(
    input,
    ['id', 'name', 'executable', 'argv', 'cwdRef', 'timeoutMs', 'repeatable'],
    `Native Verifier check request ${index}`,
    `${inputPath}/${index}`,
  );
  if (!Array.isArray(input.argv) || !input.argv.every((entry) => typeof entry === 'string')) {
    throw new Error(`Native Verifier check request ${index} argv is invalid`);
  }
  if (typeof input.repeatable !== 'boolean') {
    throw new Error(`Native Verifier check request ${index} repeatable is invalid`);
  }
  const timeoutMs = integer(input.timeoutMs, `Native Verifier check request ${index} timeout`);
  if (timeoutMs < 1) throw new Error('Native Verifier check timeout must be positive');
  return {
    id: text(input.id, `Native Verifier check request ${index} ID`),
    name: text(input.name, `Native Verifier check request ${index} name`),
    executable: text(input.executable, `Native Verifier check request ${index} executable`),
    argv: input.argv as string[],
    cwdRef: text(input.cwdRef, `Native Verifier check request ${index} cwd`),
    timeoutMs,
    repeatable: input.repeatable,
  };
}

export function parseNativeVerifierResponse(
  value: unknown,
  inputPath = '',
): NativeVerifierResponse {
  const input = plainRecord(value, 'Native Verifier response');
  if (input.kind === 'final-result') {
    exactKeys(input, ['kind', 'result'], 'Native Verifier response', inputPath);
    return { kind: 'final-result', result: parseFinalResult(input.result, `${inputPath}/result`) };
  }
  if (input.kind === 'request-checks') {
    exactKeys(
      input,
      ['kind', 'iteration', 'attempt', 'checks'],
      'Native Verifier response',
      inputPath,
    );
    if (!Array.isArray(input.checks) || input.checks.length === 0) {
      throw new Error('Native Verifier check request batch must be non-empty');
    }
    return {
      kind: 'request-checks',
      iteration: integer(input.iteration, 'Native Verifier iteration'),
      attempt: integer(input.attempt, 'Native Verifier attempt'),
      checks: input.checks.map((entry, index) =>
        parseCheckRequest(entry, index, `${inputPath}/checks`),
      ),
    };
  }
  throw new Error('Native Verifier response kind is invalid');
}

export function normalizeNativeCheckRequestId(request: NativeVerifierCheckRequest): string {
  return JSON.stringify([
    request.id,
    request.executable,
    request.argv,
    request.cwdRef.replaceAll('\\', '/'),
  ]);
}

export function validateNativeTrustedVerifierEnvelope(options: {
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
  binding: NativeVerifierBinding;
}): NativeVerifierResponse {
  if (!isNativeTrustedVerifierEnvelope<unknown>(options.envelope)) {
    throw new Error('Native Verifier result must come from the trusted Runner channel');
  }
  const { envelope, binding } = options;
  if (envelope.candidateId !== binding.candidateId) {
    throw new Error('Native Verifier result does not match the current candidate');
  }
  if (envelope.identityProvider !== binding.identityProvider) {
    throw new Error('Native Verifier identity provider does not match the Builder provider');
  }
  if (envelope.verifierExecutionRef === binding.builderExecutionRef) {
    throw new Error('Native Builder and Verifier must be different executions');
  }
  const response = parseNativeVerifierResponse(envelope.payload);
  const iteration =
    response.kind === 'final-result' ? response.result.iteration : response.iteration;
  const attempt = response.kind === 'final-result' ? response.result.attempt : response.attempt;
  if (iteration !== binding.iteration || attempt !== binding.attempt) {
    throw new Error('Native Verifier result is stale for the current iteration or attempt');
  }
  if (response.kind === 'request-checks') return response;

  validateNativeVerifierFinalResultConsistency(response.result, binding);
  return response;
}

export function validateNativeVerifierFinalResultConsistency(
  result: Pick<NativeVerifierFinalResult, 'verdict' | 'acceptance'>,
  binding: Pick<NativeVerifierBinding, 'acceptanceIds' | 'requiredChecksPassed'>,
): void {
  parseNativeVerifierAcceptance(result.acceptance);
  const expected = [...binding.acceptanceIds];
  const actual = result.acceptance.map(({ id }) => id);
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  const unknown = actual.filter((id) => !expected.includes(id));
  const missing = expected.filter((id) => !actual.includes(id));
  if (duplicates.length > 0 || unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `Native Verifier acceptance coverage is invalid (duplicate: ${[...new Set(duplicates)].join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`,
    );
  }
  if (!binding.requiredChecksPassed && result.verdict === 'pass') {
    throw new Error('Native verification cannot pass before every required check succeeds');
  }
  const results = result.acceptance.map(({ result }) => result);
  if (result.verdict === 'pass' && results.some((result) => result !== 'passed')) {
    throw new Error('Native pass requires every acceptance criterion to pass');
  }
  if (result.verdict === 'fail' && !results.includes('failed')) {
    throw new Error('Native fail requires at least one failed acceptance criterion');
  }
  if (result.verdict === 'blocked' && !results.includes('blocked')) {
    throw new Error('Native blocked verdict requires at least one blocked acceptance criterion');
  }
}
