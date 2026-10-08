import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
