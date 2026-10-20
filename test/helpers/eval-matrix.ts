import { createHash } from 'node:crypto';
export function evalMatrix(cases: Array<{ task: string; treatment: string; rep: number }>) {
  const value = {
    cases: cases
      .map(({ task, treatment, rep }) => ({ rep, task, treatment }))
      .sort(
        (a, b) =>
          (a.task < b.task ? -1 : a.task > b.task ? 1 : 0) ||
          (a.treatment < b.treatment ? -1 : a.treatment > b.treatment ? 1 : 0) ||
          a.rep - b.rep,
      ),
    schema: 'comet.eval.expected-case-matrix.v1',
  };
  return {
    ...value,
    matrix_hash: 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}
