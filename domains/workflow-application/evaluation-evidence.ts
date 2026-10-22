import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import {
  parseEvaluationMatrix,
  createEvaluationCaseValidator,
  evaluationCaseKey,
} from './evaluation-case-evidence.js';
import { hashRuntimeValue } from '../engine/runtime.js';
import { applicationFilesHash, readApplicationFiles } from './skill-adapter.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';

export interface ApplicationEvaluationEvidence {
  status: 'not-evaluated' | 'passed' | 'failed' | 'incomplete' | 'stale';
  agent?: string;
  model?: string;
  taskNames?: string[];
  report?: string;
  limitations: string[];
}

function evidenceRef(id: string, contentHash: string) {
  if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(id) || !/^[a-f\d]{64}$/u.test(contentHash))
    throw new Error('评估证据的应用身份无效');
  return `.comet/eval/applications/${id}/${contentHash}.json`;
}

interface EvaluationReport {
  schema: string;
  status: 'passed' | 'failed' | 'incomplete';
  settings: { agent: string; model?: string };
  taskNames: string[];
  limitations: string[];
  report: string;
}
function summarize(result: EvaluationReport, resultFile: string): ApplicationEvaluationEvidence {
  if (
    result.schema !== 'comet.workflow.application.eval.result.v1' ||
    !['passed', 'failed', 'incomplete'].includes(result.status) ||
    !Array.isArray(result.taskNames) ||
    !Array.isArray(result.limitations) ||
    !result.settings?.agent ||
    !['summary.md', 'summary.html'].includes(result.report)
  )
    throw new Error('评估报告格式无效');
  return {
    status: result.status,
    agent: result.settings.agent,
    ...(result.settings.model ? { model: result.settings.model } : {}),
    taskNames: result.taskNames,
    report: path.join(path.dirname(resultFile), result.report),
    limitations: result.limitations,
  };
}

/** 完整结论必须仍有固定用例、预期矩阵和逐例报告；历史摘要不能代替缺失证据。 */
export async function validateApplicationEvaluationCompletion(
  projectRoot: string,
  resultFile: string,
  result: unknown,
): Promise<void> {
  const value = result as EvaluationReport & {
    experimentId: string;
    confirmationHash: string;
    snapshotHash: string;
    total: number;
    passed: number;
    taskSet?: {
      manifestPath: string;
      manifestHash: string;
      sourceRoot?: string;
      sourceSnapshotHash?: string;
    };
  };
  if (value.status === 'incomplete') return;
  const root = await fs.realpath(projectRoot);
  const read = async (file: string) => {
    const ref = path.relative(root, path.resolve(file)).replaceAll('\\', '/');
    return (
      await readProtectedProjectFile(root, ref, 8 * 1024 * 1024, { label: '应用完整评估证据' })
    ).bytes;
  };
  const fail = (): never => {
    throw new Error('应用评估证据未覆盖完整固定用例矩阵；保留原报告并重新评估');
  };
  const reportRef = path.relative(root, path.resolve(resultFile)).replaceAll('\\', '/');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/u.test(value.experimentId) ||
    reportRef !== `.comet/eval/runs/${value.experimentId}/application-result.json`
  )
    fail();
  const directory = path.dirname(path.resolve(resultFile));
  const matrix = JSON.parse(
    (await read(path.join(directory, 'expected-case-matrix.json'))).toString('utf8'),
  );
  const expected = parseEvaluationMatrix(matrix);
  const validateCase = createEvaluationCaseValidator(expected);
  const key = evaluationCaseKey;
  const metadataFile = path.join(directory, 'metadata.json');
  if (
    await fs.lstat(metadataFile).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })
  ) {
    const metadata = JSON.parse((await read(metadataFile)).toString('utf8'));
    if (
      metadata.pytest_errors ||
      (metadata.pytest_exitstatus !== undefined &&
        metadata.pytest_exitstatus !== 0 &&
        !(metadata.pytest_exitstatus === 1 && value.status === 'failed'))
    )
      fail();
    const declared = metadata.expected_case_matrix;
    if (
      !declared ||
      declared.schema !== matrix.schema ||
      declared.matrix_hash !== matrix.matrix_hash ||
      declared.case_count !== expected.length ||
      declared.path !== 'expected-case-matrix.json'
    )
      fail();
  }
  const names = expected.map((item: (typeof expected)[number]) => item.task).sort();
  // 应用 Eval 固定为每个生成用例执行一次，不能拿其它 treatment 或重复轮次补齐数量。
  if (
    names.length < 2 ||
    names.length > 4 ||
    new Set(names).size !== names.length ||
    JSON.stringify(names) !== JSON.stringify([...value.taskNames].sort()) ||
    value.total !== expected.length
  )
    fail();
  const taskSet = value.taskSet;
  if (!taskSet || typeof taskSet.manifestPath !== 'string') return fail();
  const receiptFile = path.join(directory, 'application-task-set.json');
  if (
    await fs.lstat(receiptFile).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })
  ) {
    const receipt = JSON.parse((await read(receiptFile)).toString('utf8'));
    if (
      receipt.schema !== 'comet.workflow.application.eval.task-set.v1' ||
      receipt.experimentId !== value.experimentId ||
      receipt.confirmationHash !== value.confirmationHash ||
      receipt.snapshotHash !== value.snapshotHash ||
      receipt.matrixHash !== matrix.matrix_hash ||
      hashRuntimeValue(receipt.taskSet) !== hashRuntimeValue(taskSet)
    )
      fail();
  }
  const manifestRef = path.relative(
    path.join(root, '.comet/eval/generated'),
    path.resolve(taskSet.manifestPath),
  );
  if (
    !manifestRef ||
    manifestRef === '..' ||
    manifestRef.startsWith('..' + path.sep) ||
    path.isAbsolute(manifestRef)
  )
    fail();
  const manifest = await read(taskSet.manifestPath);
  if ('sha256:' + createHash('sha256').update(manifest).digest('hex') !== taskSet.manifestHash)
    fail();
  const tasks = parse(manifest.toString('utf8'))?.evaluation?.tasks;
  if (
    !Array.isArray(tasks) ||
    tasks.some((task: { name?: unknown } | null) => typeof task?.name !== 'string') ||
    JSON.stringify(tasks.map((task: { name: string }) => task.name).sort()) !==
      JSON.stringify(names)
  )
    fail();
  if (taskSet.sourceRoot) {
    const sourceRef = path.relative(root, path.resolve(taskSet.sourceRoot)).replaceAll('\\', '/');
    if (!/^\.comet\/eval\/cache\/application-[a-f0-9]{64}\/skill$/u.test(sourceRef)) fail();
    await read(path.join(taskSet.sourceRoot, 'SKILL.md'));
    if (
      applicationFilesHash(await readApplicationFiles(taskSet.sourceRoot)) !==
      taskSet.sourceSnapshotHash
    )
      fail();
  }
  const reportRoot = path.join(directory, 'reports');
  // 检查目录自身，包含空目录与符号链接目录的情形。
  const reportStat = await fs.lstat(reportRoot);
  if (reportStat.isSymbolicLink() || !reportStat.isDirectory()) fail();
  const files = (await fs.readdir(reportRoot)).filter((file) => file.endsWith('.json'));
  if (files.length !== expected.length) fail();
  const actual = [];
  let passed = 0;
  for (const file of files) {
    const report = JSON.parse((await read(path.join(reportRoot, file))).toString('utf8'));
    const events = report.events_summary;
    if (
      typeof report.passed !== 'boolean' ||
      !events ||
      (report.sample_quality ?? events.sample_quality)?.status !== 'included'
    )
      fail();
    actual.push(key(validateCase(report, value.experimentId, file)));
    if (report.passed) passed++;
  }
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual.sort()) !== JSON.stringify(expected.map(key).sort()) ||
    passed !== value.passed ||
    (value.status === 'passed') !== (passed === expected.length)
  )
    fail();
}

/** 分发只读当前内容的证据，不依赖 Eval 执行器，也不要求用户必须评估。 */
export async function readApplicationEvaluationEvidence(
  projectRoot: string,
  id: string,
  contentHash: string,
): Promise<ApplicationEvaluationEvidence> {
  const ref = evidenceRef(id, contentHash);
  if (!(await fs.stat(path.join(projectRoot, ref)).catch(() => null)))
    return {
      status: 'not-evaluated',
      limitations: ['当前应用内容没有 Eval 证据；安装支持不代表真实宿主验收。'],
    };
  const stored = JSON.parse(
    (
      await readProtectedProjectFile(projectRoot, ref, 1024 * 1024, { label: '应用评估证据' })
    ).bytes.toString('utf8'),
  );
  if (
    stored.id !== id ||
    stored.contentHash !== contentHash ||
    typeof stored.reportRef !== 'string' ||
    !/^\.comet\/eval\/runs\/[A-Za-z0-9-]+\/application-result\.json$/u.test(stored.reportRef)
  )
    throw new Error('应用评估证据归属无效');
  const result = await readProtectedProjectFile(projectRoot, stored.reportRef, 1024 * 1024, {
    label: '应用评估报告',
  }).catch(() => null);
  if (!result || createHash('sha256').update(result.bytes).digest('hex') !== stored.reportHash)
    return { status: 'stale', limitations: ['原 Eval 报告缺失或发生变化，需要重新评估。'] };
  const actual = JSON.parse(result.bytes.toString('utf8'));
  if (actual.application?.id !== id || actual.application?.contentHash !== contentHash)
    throw new Error('评估报告绑定了其他应用内容');
  try {
    await validateApplicationEvaluationCompletion(
      projectRoot,
      path.join(projectRoot, stored.reportRef),
      actual,
    );
  } catch {
    return {
      status: 'stale',
      limitations: ['原 Eval 完整用例证据缺失、损坏或不匹配；保留报告并重新评估。'],
    };
  }
  return summarize(actual, path.join(projectRoot, stored.reportRef));
}

/** 结果保存在项目 Eval 目录；应用包和依赖字节保持不变。 */
export async function recordApplicationEvaluationEvidence(projectRoot: string, resultFile: string) {
  const root = await fs.realpath(projectRoot);
  const reportRef = path.relative(root, path.resolve(resultFile)).replaceAll('\\', '/');
  if (!/^\.comet\/eval\/runs\/[A-Za-z0-9-]+\/application-result\.json$/u.test(reportRef))
    throw new Error('评估报告必须属于当前项目');
  const { bytes } = await readProtectedProjectFile(root, reportRef, 1024 * 1024, {
    label: '应用评估报告',
  });
  const result = JSON.parse(bytes.toString('utf8'));
  if (
    result.schema !== 'comet.workflow.application.eval.result.v1' ||
    !['passed', 'failed', 'incomplete'].includes(result.status)
  )
    throw new Error('评估报告格式无效');
  const ref = evidenceRef(result.application.id, result.application.contentHash);
  const destination = path.join(root, ref);
  let directory = root;
  for (const part of path.dirname(ref).split('/')) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
      throw new Error('评估证据目录含异常路径');
    if (!stat) await fs.mkdir(directory);
  }
  if ((await fs.lstat(destination).catch(() => null))?.isSymbolicLink())
    throw new Error('评估证据文件不能是符号链接');
  await validateApplicationEvaluationCompletion(root, resultFile, result);
  const summary = summarize(result, resultFile);
  await atomicWriteContainedText(
    destination,
    JSON.stringify({
      id: result.application.id,
      contentHash: result.application.contentHash,
      reportRef,
      reportHash: createHash('sha256').update(bytes).digest('hex'),
    }),
    { containedRoot: root },
  );
  return summary;
}
