import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  parseEvaluationMatrix,
  createEvaluationCaseValidator,
  evaluationCaseKey,
} from '../workflow-application/index.js';
import {
  EvalRunError,
  evalRunPath,
  readEvalJson,
  readEvalRun,
  readEvalEvidenceRevision,
  writeEvalJson,
} from './eval-run-store.js';

/** 人工确认停止之后，只从完整原始逐例证据重建汇总；损坏原件始终保留。 */
export async function repairEvalResults(
  project: string,
  id: string,
  expectedRevision: string,
  confirmedStopped: boolean,
) {
  if (!confirmedStopped || !/^[a-f0-9]{64}$/u.test(expectedRevision))
    throw new EvalRunError('修复前必须确认执行已停止并提供当前证据版本', 409);
  const root = await evalRunPath(project, id);
  await withRecoverableFileLock(path.join(root, '.results-repair.lock'), async () => {
    if ((await readEvalEvidenceRevision(project, id)) !== expectedRevision)
      throw new EvalRunError('原始证据已变化，请刷新后重新确认', 409);
    const run = await readEvalRun(project, id, { includeCaseContent: false });
    if (
      [
        'queued',
        'preparing',
        'generating',
        'running',
        'judging',
        'finalizing',
        'stopping',
      ].includes(run.executionStatus)
    )
      throw new EvalRunError('运行仍处于活动状态，不能修复结果', 409);
    const matrix = await readEvalJson(await evalRunPath(project, id, 'expected-case-matrix.json'));
    const expected = parseEvaluationMatrix(matrix);
    const validateCase = createEvaluationCaseValidator(expected);
    const files = (await fs.readdir(await evalRunPath(project, id, 'reports')))
      .filter((file) => file.endsWith('_report.json'))
      .sort();
    const actual: string[] = [];
    let passed = 0;
    const reports: unknown[] = [];
    let readBytes = 0,
      summaryBytes = 0;
    const started = Date.now();
    for (const file of files) {
      const reportPath = await evalRunPath(project, id, 'reports', file);
      const reportSize = (await fs.stat(reportPath)).size;
      if (reportSize > 8 * 1024 * 1024) throw new EvalRunError('逐例报告超过 8MiB 读取预算', 413);
      readBytes += reportSize;
      if (readBytes > 1024 * 1024 * 1024 || Date.now() - started > 60000)
        throw new EvalRunError('修复证据超过 1GiB 或 60 秒读取预算', 413);
      const bytes = await fs.readFile(reportPath);
      if (bytes.length > 8 * 1024 * 1024) throw new EvalRunError('逐例报告超过 8MiB 读取预算', 413);
      const report = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      const identity = validateCase(report, id, file);
      const events = report?.events_summary as Record<string, unknown>;
      const quality = (report?.sample_quality ?? events?.sample_quality) as Record<string, unknown>;
      if (quality?.status !== 'included')
        throw new EvalRunError('样本质量不完整，不能重建有效汇总', 409);
      actual.push(evaluationCaseKey(identity));
      if (report?.passed === true) passed++;
      const summary = structuredClone(report!);
      const summaryEvents = summary.events_summary as Record<string, unknown>;
      const prompt = summaryEvents.prompt;
      if (typeof prompt === 'string') {
        summaryEvents.prompt = prompt.slice(0, 2048);
        summaryEvents.prompt_truncated = prompt.length > 2048;
      }
      delete summaryEvents.final_response;
      summaryBytes += Buffer.byteLength(JSON.stringify(summary)) + 256;
      if (summaryBytes > 8 * 1024 * 1024) throw new EvalRunError('修复发布索引超过 8MiB 预算', 413);
      reports.push({
        file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        summary,
      });
    }
    if (
      !expected.length ||
      new Set(actual).size !== actual.length ||
      JSON.stringify(actual.sort()) !== JSON.stringify(expected.map(evaluationCaseKey).sort())
    )
      throw new EvalRunError('逐例证据没有完整覆盖固定矩阵，不能修复结果', 409);
    if ((await readEvalEvidenceRevision(project, id)) !== expectedRevision)
      throw new EvalRunError('修复期间证据已变化，请重新确认', 409);
    const retained = `retained-results-${randomUUID()}`;
    await fs.mkdir(path.join(root, retained));
    const metadataPath = await evalRunPath(project, id, 'metadata.json');
    const bytes = await fs.readFile(metadataPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (bytes)
      await fs.writeFile(path.join(root, retained, 'metadata.json'), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    const publicationPath = await evalRunPath(project, id, 'report-generation.json');
    const originalPublication = await fs
      .readFile(publicationPath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (originalPublication)
      await fs.writeFile(path.join(root, retained, 'report-generation.json'), originalPublication, {
        flag: 'wx',
        mode: 0o600,
      });
    await writeEvalJson(publicationPath, {
      schema: 'comet.eval.report-generation.v1',
      experiment: id,
      generation: randomUUID(),
      reports,
    });
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(bytes?.toString('utf8') ?? '{}');
    } catch {
      /* 保留坏字节，不从损坏摘要推断结果。 */
    }
    await writeEvalJson(metadataPath, {
      ...previous,
      experiment_id: id,
      repaired_at: new Date().toISOString(),
      expected_case_matrix: {
        schema: matrix!.schema,
        matrix_hash: matrix!.matrix_hash,
        path: 'expected-case-matrix.json',
        case_count: expected.length,
      },
      total_runs: actual.length,
      total_passed: passed,
      // 不抹去已知执行异常；恢复摘要不等于修复运行环境。
      repaired_from_reports: true,
    });
    await writeEvalJson(path.join(root, 'results-repair.json'), {
      schema: 'comet.eval.results-repair.v1',
      expectedRevision,
      retained,
      passed,
      total: actual.length,
      repairedAt: new Date().toISOString(),
    });
  });
  return readEvalRun(project, id, { includeCaseContent: false });
}
