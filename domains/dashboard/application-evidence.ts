import path from 'node:path';
import type { ApplicationRunRecord } from '../workflow-application/application-run-record.js';
import { readApplicationEvaluationEvidence } from '../workflow-application/evaluation-evidence.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { readEvalRun } from '../eval/index.js';
import {
  hash,
  object,
  sanitizeApplicationObservation,
  text,
} from './application-observation-values.js';
import type {
  DashboardApplicationEvidence,
  DashboardApplicationIdentity,
  DashboardApplicationRunDetail,
  DashboardApplicationRunSummary,
} from './application-types.js';

type CreatorEvidenceSource = {
  summary: Pick<DashboardApplicationRunSummary, 'locator' | 'runId' | 'application'>;
  run: ApplicationRunRecord['run'] | null;
};

export const emptyEvidence = (
  kind: DashboardApplicationEvidence['kind'],
  identity: DashboardApplicationIdentity | null,
): DashboardApplicationEvidence => ({
  kind,
  status: 'not-recorded',
  version: identity?.version ?? null,
  contentHash: identity?.contentHash ?? identity?.packageHash ?? null,
  sourceLocator: null,
  sourceRunId: null,
  report: null,
  evalRunId: null,
  summary:
    kind === 'host'
      ? '没有独立 Agent 平台验证记录；本地校验和模型评估不能替代 Agent 平台验收'
      : '当前固定内容没有此类验证记录',
  details: null,
});

/** 证据由已选中的固定包和 Creator 记录决定，索引只负责定位来源。 */
export async function projectDashboardApplicationEvidence(
  projectRoot: string,
  input: {
    summary: Pick<DashboardApplicationRunSummary, 'locator' | 'application'>;
    packageHash: string | null | undefined;
    creatorMaterialChanged: boolean;
    current: CreatorEvidenceSource | undefined;
    history: { summary: DashboardApplicationRunSummary; evidenceKinds?: ('local' | 'model')[] }[];
    failures: { summary: DashboardApplicationRunSummary; message: string }[];
  },
): Promise<Pick<DashboardApplicationRunDetail, 'evidence' | 'otherEvidence' | 'sourceCreators'>> {
  const { summary, packageHash, creatorMaterialChanged, current, history, failures } = input;
  const identity = summary.application;
  const local = emptyEvidence('local', identity);
  if (current?.run) {
    const record = object(current.run.outputs.verify?.value);
    const action = current.run.actions.filter((a) => a.stepId === 'verify').at(-1);
    if (record.packageHash && record.packageHash === packageHash) {
      local.status = 'passed';
      local.summary = record.artifactVerification
        ? '本地应用与阶段产物的正常、异常样例验收已完成'
        : '本地应用、固定依赖与 Runtime 契约校验已完成';
      local.details = sanitizeApplicationObservation(record);
    } else if (action?.status === 'failed') {
      local.status = 'failed';
      local.summary = action.reason ?? action.outcome?.summary ?? '本地校验失败';
      local.details = sanitizeApplicationObservation(action.outcome);
    }
    if (local.status !== 'not-recorded') {
      local.sourceLocator = current.summary.locator;
      local.sourceRunId = current.summary.runId;
      local.contentHash = packageHash ?? null;
    }
  }
  const model = emptyEvidence('model', identity);
  if (identity && packageHash) {
    try {
      const result = await readApplicationEvaluationEvidence(projectRoot, identity.id, packageHash);
      model.status = result.status === 'not-evaluated' ? 'not-recorded' : result.status;
      model.summary = result.limitations.join('；') || '模型评估报告已绑定当前应用内容';
      model.report = result.report ?? null;
      model.details = sanitizeApplicationObservation(result);
    } catch (error) {
      model.status = 'unavailable';
      model.summary = error instanceof Error ? error.message : String(error);
    }
  }
  if (current?.run) {
    const result = object(current.run.outputs.evaluate?.value);
    const resultIdentity = object(result.application);
    const selection = current.run.waits.filter((w) => w.stepId === 'confirm-eval').at(-1);
    if (
      !model.report &&
      resultIdentity.contentHash === packageHash &&
      resultIdentity.id === identity?.id &&
      ['passed', 'failed', 'incomplete'].includes(String(result.status))
    ) {
      model.status = result.status as 'passed' | 'failed' | 'incomplete';
      model.details = sanitizeApplicationObservation(result);
      model.summary = '模型评估结果绑定当前候选';
      const experimentId = text(result.experimentId);
      if (!experimentId || !/^[A-Za-z0-9_-]{1,200}$/u.test(experimentId)) {
        model.status = 'stale';
        model.summary = '原 Eval 报告缺少有效实验身份，不能用于当前候选';
      } else {
        const ref = `.comet/eval/runs/${experimentId}/application-result.json`;
        try {
          const bytes = (
            await readProtectedProjectFile(projectRoot, ref, 2 * 1024 * 1024, {
              label: 'Creator Eval 报告',
            })
          ).bytes;
          if (hash(JSON.parse(bytes.toString('utf8'))) !== hash(result))
            throw new Error('原 Eval 报告内容已变化');
          model.report = path.join(projectRoot, '.comet/eval/runs', experimentId, 'summary.md');
        } catch (error) {
          model.status = 'stale';
          model.summary = error instanceof Error ? error.message : String(error);
        }
      }
    }
    if (selection?.decision?.choice === 'skip' && model.status === 'not-recorded') {
      model.status = 'skipped';
      model.summary = '本次创作明确跳过模型评估';
    }
    if (model.status !== 'not-recorded') {
      model.sourceLocator = current.summary.locator;
      model.sourceRunId = current.summary.runId;
      model.contentHash = packageHash ?? null;
    }
  }
  if (creatorMaterialChanged) {
    if (['passed', 'failed', 'incomplete'].includes(local.status)) {
      local.status = 'stale';
      local.summary = '原本地校验结果保留，当前候选包已变化或无法读取';
    }
    if (['passed', 'failed', 'incomplete'].includes(model.status)) {
      model.status = 'stale';
      model.summary = '原模型评估结果保留，当前候选包已变化或无法读取';
    }
  }
  if (model.report) {
    const ref = path.relative(projectRoot, model.report).replaceAll('\\', '/');
    const match = /^\.comet\/eval\/runs\/([^/]+)\/(?:summary\.md|summary\.html)$/u.exec(ref);
    if (match) {
      const linked = await readEvalRun(projectRoot, match[1]).catch(() => null);
      if (linked) model.evalRunId = match[1];
    }
  }
  if (!current && failures.length) {
    local.status = 'unavailable';
    local.summary = `关联创作记录无法读取：${failures.map((failure) => failure.message).join('；')}`;
    local.sourceLocator = failures[0].summary.locator;
    local.sourceRunId = failures[0].summary.runId;
    local.contentHash = packageHash ?? null;
    if (model.status === 'not-recorded') {
      model.status = 'unavailable';
      model.summary = local.summary;
      model.sourceLocator = local.sourceLocator;
      model.sourceRunId = local.sourceRunId;
      model.contentHash = packageHash ?? null;
    }
  }
  const other: DashboardApplicationEvidence[] = history
    .filter(
      (ref) =>
        ref.summary.locator !== current?.summary.locator && ref.summary.locator !== summary.locator,
    )
    .flatMap((ref) =>
      (ref.evidenceKinds ?? []).map((kind) => ({
        ...emptyEvidence(kind, ref.summary.application),
        contentHash: ref.summary.application?.packageHash ?? null,
        status: 'stale' as const,
        sourceLocator: ref.summary.locator,
        sourceRunId: ref.summary.runId,
        summary: '原验收结果保留；打开时读取对应创作记录，不能用于当前候选',
      })),
    );
  return {
    evidence: [local, model, emptyEvidence('host', identity)],
    otherEvidence: other,
    sourceCreators:
      current?.summary.runId && current.summary.application
        ? [
            {
              locator: current.summary.locator,
              runId: current.summary.runId,
              version: current.summary.application.version,
            },
          ]
        : [],
  };
}
