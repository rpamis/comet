import { createHash } from 'node:crypto';

export const SEMANTIC_MEMORY_EVAL_RUBRIC = Object.freeze({
  version: 'semantic-memory-rubric-v1',
  required: ['action', 'scope', 'language'],
  conditional: [
    'independent-evidence',
    'idempotency',
    'skip',
    'retrieval',
    'forget',
    'safety',
    'downstream',
  ],
});

export const SEMANTIC_MEMORY_EVAL_RUBRIC_HASH = `sha256:${createHash('sha256')
  .update(JSON.stringify(SEMANTIC_MEMORY_EVAL_RUBRIC))
  .digest('hex')}`;

export interface SemanticMemoryJudgeInput {
  readonly actualAction?: string;
  readonly scopeCorrect: boolean;
  readonly languageCorrect: boolean;
  readonly firstCandidate?: boolean;
  readonly secondActivated?: boolean;
  readonly idempotent: boolean;
  readonly skipped: boolean;
  readonly retrieved: boolean;
  readonly securityRejected: boolean;
  readonly forgetVerified?: boolean;
  readonly downstream?: {
    readonly semanticCorrect: boolean;
  };
}

export interface SemanticMemoryJudgeCase {
  readonly expectedAction: string;
  readonly kind: string;
}

export interface SemanticMemoryJudgeResult {
  readonly mode: 'frozen-rubric-deterministic-judge';
  readonly rubricHash: string;
  readonly score: number;
  readonly evidence: readonly string[];
}

/** Independent deterministic judge. It consumes only the frozen rubric and case result. */
export function judgeSemanticCase(
  result: SemanticMemoryJudgeInput,
  input: SemanticMemoryJudgeCase,
): SemanticMemoryJudgeResult {
  const checks: Array<[string, boolean]> = [
    [`action=${result.actualAction ?? 'unknown'}`, result.actualAction === input.expectedAction],
    ['scope', result.scopeCorrect],
    ['language', result.languageCorrect],
  ];
  if (input.expectedAction === 'activate') {
    checks.push([
      'independent-evidence',
      result.firstCandidate === true && result.secondActivated === true,
    ]);
  }
  if (input.expectedAction === 'candidate') checks.push(['idempotency', result.idempotent]);
  if (input.expectedAction === 'skip') checks.push(['skip', result.skipped]);
  if (input.expectedAction === 'retrieve') checks.push(['retrieval', result.retrieved]);
  if (input.expectedAction === 'manage') checks.push(['forget', result.forgetVerified === true]);
  if (input.kind.includes('secret')) checks.push(['safety', result.securityRejected]);
  if (result.downstream !== undefined)
    checks.push(['downstream', result.downstream.semanticCorrect]);
  const passed = checks.filter(([, value]) => value).length;
  return {
    mode: 'frozen-rubric-deterministic-judge',
    rubricHash: SEMANTIC_MEMORY_EVAL_RUBRIC_HASH,
    score: checks.length === 0 ? 1 : passed / checks.length,
    evidence: checks.map(([name, value]) => `${name}:${value ? 'pass' : 'fail'}`),
  };
}
