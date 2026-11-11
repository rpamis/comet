import {
  NATIVE_REQUEST_REVIEW_RESULTS,
  NATIVE_VERIFIER_ACCEPTANCE_RESULTS,
  NATIVE_VERIFIER_RESPONSE_KINDS,
  NATIVE_VERIFIER_VERDICTS,
  nativeEnumText,
} from './native-input-enum.js';
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
  requestReview?: { result: (typeof NATIVE_REQUEST_REVIEW_RESULTS)[number]; reason: string };
}

export interface NativeVerifierResponse {
  kind: 'final-result';
  result: NativeVerifierFinalResult;
}

export interface NativeVerifierBinding {
  candidateId: string;
  identityProvider: string;
  builderExecutionRef: string;
  requireIndependentSession?: boolean;
  iteration: number;
  attempt: number;
  /** Acceptance IDs required in this Verifier response. */
  acceptanceIds: readonly string[];
  /** Every acceptance ID that belongs to the current change. Defaults to acceptanceIds. */
  knownAcceptanceIds?: readonly string[];
  /** Known out-of-scope IDs that may be repeated only as passed. */
  previouslyPassedAcceptanceIds?: readonly string[];
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
    const result = nativeEnumText(
      item.result,
      NATIVE_VERIFIER_ACCEPTANCE_RESULTS,
      `Native Verifier acceptance ${id} result`,
    );
    return {
      id,
      result,
      reason: text(item.reason, `Native Verifier acceptance ${id} reason`),
    };
  });
}

function parseFinalResult(value: unknown, inputPath: string): NativeVerifierFinalResult {
  const input = plainRecord(value, 'Native Verifier final result');
  exactKeys(
    input,
    [
      'iteration',
      'attempt',
      'verdict',
      'acceptance',
      'risks',
      'summary',
      ...(Object.hasOwn(input, 'requestReview') ? ['requestReview'] : []),
    ],
    'Native Verifier final result',
    inputPath,
  );
  const verdict = nativeEnumText(
    input.verdict,
    NATIVE_VERIFIER_VERDICTS,
    'Native Verifier verdict',
  );
  if (!Array.isArray(input.risks) || !input.risks.every((risk) => typeof risk === 'string')) {
    throw new Error('Native Verifier risks must be text entries');
  }
  let requestReview: NativeVerifierFinalResult['requestReview'];
  if (input.requestReview !== undefined) {
    const review = plainRecord(input.requestReview, 'Native requestReview');
    exactKeys(review, ['result', 'reason'], 'Native requestReview', `${inputPath}/requestReview`);
    requestReview = {
      result: nativeEnumText(
        review.result,
        NATIVE_REQUEST_REVIEW_RESULTS,
        'Native requestReview result',
      ),
      reason: text(review.reason, 'Native requestReview reason'),
    };
  }
  return {
    ...(requestReview ? { requestReview } : {}),
    iteration: integer(input.iteration, 'Native Verifier iteration'),
    attempt: integer(input.attempt, 'Native Verifier attempt'),
    verdict,
    acceptance: parseNativeVerifierAcceptance(input.acceptance, `${inputPath}/acceptance`),
    risks: input.risks as string[],
    summary: text(input.summary, 'Native Verifier summary'),
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
  throw new Error(
    `Native Verifier response kind must be one of: ${NATIVE_VERIFIER_RESPONSE_KINDS.join(', ')}`,
  );
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
  if (
    binding.requireIndependentSession !== false &&
    envelope.verifierExecutionRef === binding.builderExecutionRef
  ) {
    throw new Error('Native Builder and Verifier must be different executions');
  }
  const response = parseNativeVerifierResponse(envelope.payload);
  const iteration = response.result.iteration;
  const attempt = response.result.attempt;
  if (iteration !== binding.iteration || attempt !== binding.attempt) {
    throw new Error(
      `Native Verifier result is stale for the current iteration or attempt: expected iteration=${binding.iteration}, attempt=${binding.attempt}; received iteration=${iteration}, attempt=${attempt}. Inspect the current action and use its outputTemplate before submitting a new outcomeId`,
    );
  }

  const acceptance = validateAndScopeNativeVerifierFinalResult(response.result, binding);
  return {
    ...response,
    result: {
      ...response.result,
      acceptance,
    },
  };
}

export function validateAndScopeNativeVerifierFinalResult(
  result: Pick<NativeVerifierFinalResult, 'verdict' | 'acceptance'>,
  binding: Pick<
    NativeVerifierBinding,
    | 'acceptanceIds'
    | 'knownAcceptanceIds'
    | 'previouslyPassedAcceptanceIds'
    | 'requiredChecksPassed'
  >,
): NativeVerifierAcceptanceResult[] {
  parseNativeVerifierAcceptance(result.acceptance);
  const expected = [...binding.acceptanceIds];
  const known = new Set(binding.knownAcceptanceIds ?? expected);
  const previouslyPassed = new Set(binding.previouslyPassedAcceptanceIds ?? []);
  const invalidExpected = expected.filter((id) => !known.has(id));
  const invalidPassed = [...previouslyPassed].filter((id) => !known.has(id));
  if (invalidExpected.length > 0 || invalidPassed.length > 0) {
    throw new Error('Native Verifier acceptance binding is internally inconsistent');
  }
  const expectedSet = new Set(expected);
  const actual = result.acceptance.map(({ id }) => id);
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  const unknown = actual.filter((id) => !known.has(id));
  const missing = expected.filter((id) => !actual.includes(id));
  const outOfScopeConflicts = result.acceptance
    .filter(({ id, result: acceptanceResult }) => {
      if (expectedSet.has(id) || !known.has(id)) return false;
      return !previouslyPassed.has(id) || acceptanceResult !== 'passed';
    })
    .map(({ id, result: acceptanceResult }) => `${id}=${acceptanceResult}`);
  if (
    duplicates.length > 0 ||
    unknown.length > 0 ||
    missing.length > 0 ||
    outOfScopeConflicts.length > 0
  ) {
    throw new Error(
      `Native Verifier acceptance coverage is invalid (duplicate: ${[...new Set(duplicates)].join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}; out-of-scope: ${outOfScopeConflicts.join(', ') || 'none'}). Return each required scope ID exactly once and no other acceptance IDs.`,
    );
  }
  const scopedAcceptance = result.acceptance.filter(({ id }) => expectedSet.has(id));
  if (!binding.requiredChecksPassed && result.verdict === 'pass') {
    throw new Error('Native verification cannot pass before every required check succeeds');
  }
  const results = scopedAcceptance.map(({ result }) => result);
  if (result.verdict === 'pass' && results.some((result) => result !== 'passed')) {
    throw new Error('Native pass requires every acceptance criterion to pass');
  }
  if (result.verdict === 'fail' && !results.includes('failed')) {
    throw new Error('Native fail requires at least one failed acceptance criterion');
  }
  if (result.verdict === 'blocked' && !results.includes('blocked')) {
    throw new Error('Native blocked verdict requires at least one blocked acceptance criterion');
  }
  return scopedAcceptance;
}
