import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  EvalRunError,
  evalRunPath,
  readEvalJson,
  readEvalRun,
  evalValueHash,
  evalStoragePath,
} from './eval-run-store.js';
import { isPathWithin } from './standalone-context.js';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export interface EvalRetrySelection {
  sourceRunId: string;
  taskSourceRunId: string;
  targetId: string;
  cases: Array<{
    task: string;
    treatment: string;
    repetition: number;
    caseHash: string;
    validatorHash: string;
  }>;
  manifestPath?: string;
  sourceHash: string;
}
export async function readEvalRetrySelection(
  project: string,
  id: string,
): Promise<EvalRetrySelection> {
  const run = await readEvalRun(project, id);
  if (!['completed', 'stopped', 'interrupted'].includes(run.executionStatus))
    throw new EvalRunError('原评估尚未结束，请先停止并核对执行状态', 409);
  if (run.integrity !== 'valid') throw new EvalRunError('原始用例证据身份无效，不能重跑', 409);
  const failed = run.cases.filter((item) => item.passed === false);
  if (!failed.length)
    throw new EvalRunError('没有已判定失败的用例；未执行的用例请通过完整评估补齐', 409);
  if (failed.some((item) => !item.caseHash || !item.validatorHash || !item.task || !item.treatment))
    throw new EvalRunError('原记录缺少固定用例身份，请先进行一次完整评估', 409);
  let manifestPath: string | undefined;
  for (const item of failed) {
    const report = await readEvalJson(await evalRunPath(project, id, `reports/${item.id}`));
    const events = object(report?.events_summary);
    const generation = object(events.eval_generation);
    const authored = object(object(events.case_manifest).authored_hashes);
    const candidate =
      generation.manifest_path ?? (authored.manifest_hash ? events.eval_manifest : undefined);
    const expected = generation.manifest_hash ?? authored.manifest_hash;
    if (candidate !== undefined) {
      if (
        typeof candidate !== 'string' ||
        typeof expected !== 'string' ||
        !/\.ya?ml$/iu.test(candidate)
      )
        throw new EvalRunError('原固定用例清单缺少完整身份，请重新进行完整评估', 409);
      const canonical = await fs.realpath(candidate).catch(() => {
        throw new EvalRunError('原固定用例清单已不可用，请恢复文件或进行完整评估', 409);
      });
      const evalRoot = await evalStoragePath(project);
      if (
        !isPathWithin(evalRoot, canonical) &&
        !(
          run.target.type === 'skill' &&
          path.isAbsolute(run.target.id) &&
          isPathWithin(run.target.id, canonical)
        )
      )
        throw new EvalRunError('原用例清单越过评估目录或原 Skill，不能重跑', 409);
      const stat = await fs.stat(canonical);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
        throw new EvalRunError('原固定用例清单无效', 409);
      const bytes = await fs.readFile(canonical);
      const digest = createHash('sha256');
      if (!generation?.manifest_hash) digest.update(`F\0${path.basename(canonical)}\0`);
      digest.update(bytes);
      if (!generation?.manifest_hash) digest.update('\0');
      if (`sha256:${digest.digest('hex')}` !== expected)
        throw new EvalRunError(
          '原用例清单已变化，不能只重跑原失败用例；请恢复原清单或进行完整评估',
          409,
        );
      if (manifestPath && manifestPath !== canonical)
        throw new EvalRunError('失败用例来自不同清单，请分别进行评估', 409);
      manifestPath = canonical;
    }
  }
  const cases = failed.map((item) => ({
    task: item.task,
    treatment: item.treatment,
    repetition: item.repetition,
    caseHash: item.caseHash!,
    validatorHash: item.validatorHash!,
  }));
  if (
    new Set(cases.map((item) => JSON.stringify([item.task, item.treatment, item.repetition])))
      .size !== cases.length
  )
    throw new EvalRunError('原失败用例存在重复身份，请检查原报告', 409);
  return {
    sourceRunId: id,
    taskSourceRunId: run.config.previousExperimentId ?? id,
    targetId: run.target.id,
    cases,
    ...(manifestPath ? { manifestPath } : {}),
    sourceHash: evalValueHash(cases),
  };
}
