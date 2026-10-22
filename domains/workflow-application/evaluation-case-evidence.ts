import { createHash } from 'node:crypto';

export type EvalEvidenceObject = Record<string, unknown>;
const object = (value: unknown): EvalEvidenceObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as EvalEvidenceObject) : {};
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
export interface EvaluationCaseIdentity {
  task: string;
  treatment: string;
  rep: number;
}
export const evaluationCaseKey = (item: EvaluationCaseIdentity): string =>
  JSON.stringify([item.task, item.treatment, item.rep]);
export function parseEvaluationMatrix(
  value: unknown,
  declaredHash?: unknown,
): EvaluationCaseIdentity[] {
  const matrix = object(value);
  const fail = (): never => {
    throw new Error('固定用例矩阵身份、排序或摘要无效');
  };
  if (
    Object.keys(matrix).sort().join(',') !== 'cases,matrix_hash,schema' ||
    matrix.schema !== 'comet.eval.expected-case-matrix.v1' ||
    !Array.isArray(matrix.cases)
  )
    fail();
  const cases = (matrix.cases as unknown[]).map((raw) => {
    const item = object(raw);
    if (
      Object.keys(item).sort().join(',') !== 'rep,task,treatment' ||
      typeof item.task !== 'string' ||
      !identifier.test(item.task) ||
      typeof item.treatment !== 'string' ||
      !identifier.test(item.treatment) ||
      !Number.isSafeInteger(item.rep) ||
      Number(item.rep) < 1
    )
      fail();
    return {
      rep: item.rep as number,
      task: item.task as string,
      treatment: item.treatment as string,
    };
  });
  const compare = (a: EvaluationCaseIdentity, b: EvaluationCaseIdentity) =>
    (a.task < b.task ? -1 : a.task > b.task ? 1 : 0) ||
    (a.treatment < b.treatment ? -1 : a.treatment > b.treatment ? 1 : 0) ||
    a.rep - b.rep;
  const hash =
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify({ cases, schema: matrix.schema }))
      .digest('hex');
  if (
    cases.some((item, i) => i > 0 && compare(cases[i - 1], item) >= 0) ||
    matrix.matrix_hash !== hash ||
    (declaredHash !== undefined && declaredHash !== hash)
  )
    fail();
  return cases;
}
/** 唯一旧格式适配边界：只接受名称、sample、文件名及固定矩阵相互证明的旧 rep=1。 */
export function validateEvaluationCase(
  raw: unknown,
  experiment: string,
  file: string,
  expected: EvaluationCaseIdentity[],
): EvaluationCaseIdentity {
  return createEvaluationCaseValidator(expected)(raw, experiment, file);
}

/** 一次固定矩阵快照供逐份报告共用；每份报告仍核对完整身份与旧格式证明。 */
export function createEvaluationCaseValidator(expected: readonly EvaluationCaseIdentity[]) {
  const keys = new Set(expected.map(evaluationCaseKey));
  return (raw: unknown, experiment: string, file: string): EvaluationCaseIdentity =>
    validateCaseIdentity(raw, experiment, file, keys);
}

function validateCaseIdentity(
  raw: unknown,
  experiment: string,
  file: string,
  expected: ReadonlySet<string>,
): EvaluationCaseIdentity {
  const report = object(raw),
    events = object(report.events_summary);
  const fail = (): never => {
    throw new Error('逐例报告身份与固定矩阵不一致');
  };
  if (
    typeof events.task !== 'string' ||
    !identifier.test(events.task) ||
    typeof events.treatment !== 'string' ||
    !identifier.test(events.treatment) ||
    !Number.isSafeInteger(report.rep) ||
    Number(report.rep) < 1 ||
    events.sample !== report.rep ||
    typeof report.passed !== 'boolean' ||
    typeof report.name !== 'string'
  )
    fail();
  let rep = report.rep as number;
  const prefix = `${events.task}-${events.treatment}`;
  const name = report.name as string;
  if (name !== prefix && name !== `${prefix}-r${rep}`) {
    const match = /^-r([1-9]\d*)$/u.exec(name.slice(prefix.length));
    if (
      !name.startsWith(prefix) ||
      !match ||
      rep !== 1 ||
      file !== `${name.replaceAll('-', '_')}_rep1_report.json`
    )
      fail();
    rep = Number(match![1]);
  }
  const identity = { task: events.task as string, treatment: events.treatment as string, rep };
  if (!expected.has(evaluationCaseKey(identity))) fail();
  const declared = object(report.case_identity);
  if (
    report.case_identity !== undefined &&
    (Object.keys(declared).sort().join(',') !== 'experiment,repetition,schema,task,treatment' ||
      declared.schema !== 'comet.eval.case-identity.v1' ||
      declared.experiment !== experiment ||
      declared.task !== identity.task ||
      declared.treatment !== identity.treatment ||
      declared.repetition !== rep)
  )
    fail();
  if (events.experiment_id !== undefined && events.experiment_id !== experiment) fail();
  return identity;
}
