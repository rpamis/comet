import React from 'react';
import { useDashboardMotion } from './dashboard-motion.jsx';
import { Button, Collapse, Tag, Descriptions, Empty, Alert } from 'antd';
import {
  FileTextOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  BranchesOutlined,
  RightOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { t, systemText } from './dashboard-i18n.js';
import { ApplicationStepDefinition } from './application-step-definition.jsx';

const statusLabels = {
  succeeded: '已完成',
  pending: '待执行',
  running: '执行中',
  waiting: '待确认',
  evidence: '等待证据',
  child: '等待子流程',
  unknown: '结果待核对',
  failed: '执行失败',
  cancelled: '已取消',
  completed: '已完成',
  delivered: '已交付',
  stopped: '已停止',
  unreadable: '无法读取',
  stale: '失效',
  rejected: '结果被拒收',
  resolved: '已决定',
};
const colors = {
  succeeded: 'success',
  completed: 'success',
  delivered: 'success',
  running: 'processing',
  waiting: 'gold',
  evidence: 'gold',
  child: 'blue',
  unknown: 'orange',
  failed: 'error',
  rejected: 'error',
};
export function ApplicationStatus({ value }) {
  return <Tag color={colors[value]}>{t(statusLabels[value] ?? value)}</Tag>;
}
export function formatApplicationRecordType(value) {
  return t(
    {
      handoff: '交给 Agent 执行',
      invoke_skill: '调用 Skill',
      call_tool: '调用工具',
      child_workflow: '子流程',
      ask_user: '用户决定',
      await_evidence: '等待证据',
      user_decision: '用户决定',
      'host-proof': '宿主验证',
    }[value] ?? value,
  );
}
const kindLabels = {
  action: '执行动作',
  decision: '用户决定',
  evidence: '等待证据',
  ready: '待执行工作',
};
const evidenceLabels = { local: '本地校验', model: '模型 Eval', host: '宿主验证' };
const evidenceStates = {
  passed: '通过',
  failed: '失败',
  incomplete: '未完成',
  stale: '失效',
  'not-recorded': '无记录',
  unavailable: '无法读取',
  skipped: '已跳过',
};
export function ApplicationEvidenceCards({ detail, onEvidence }) {
  return (
    <div className="any-evidence-cards">
      {detail.evidence.map((e) => (
        <button key={e.kind} className="any-evidence-card" onClick={() => onEvidence(e)}>
          <span>
            <b>{t(evidenceLabels[e.kind])}</b>
            <Tag
              color={
                e.status === 'passed'
                  ? 'success'
                  : e.status === 'failed'
                    ? 'error'
                    : e.status === 'stale'
                      ? 'warning'
                      : undefined
              }
            >
              {t(evidenceStates[e.status])}
            </Tag>
          </span>
          <small>{systemText(e.summary)}</small>
          <em>
            {e.version ? `v${e.version}` : t('尚未生成版本')}
            {e.sourceRunId ? ` · ${e.sourceRunId}` : ''}
          </em>
        </button>
      ))}
    </div>
  );
}
export function ApplicationRecordInspector({
  detail,
  record,
  definitionStep,
  onChild,
  onArtifact,
  onEvidence,
  onEvidenceTab,
  onAttempt,
}) {
  const motion = useDashboardMotion(
    `${detail?.summary?.locator ?? ''}:${record?.id ?? ''}`,
    'detail',
  );
  if (!detail)
    return (
      <div className="any-inspector-empty">
        <Empty description={t('选择创作或运行记录')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  if (detail.error)
    return (
      <div className="any-inspector-empty">
        <Empty description={t('等待重新读取当前记录')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  if (!record)
    return (
      <div className="any-inspector-empty">
        <Empty description={t('没有已发生的步骤记录')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  const data = record.data ?? {};
  const history = [
    ...(data.reconciliations ?? []).map((r, i) => ({
      key: `reconcile:${i}`,
      label: t('第 {0} 次尝试 · 已核对', [r.attempt]),
      data: r,
      status: 'reconciled',
    })),
    ...(data.rejectedOutcomes ?? []).map((r, i) => ({
      key: `rejected:${i}`,
      label: t('第 {0} 次尝试 · 结果被拒收', [r.outcome.attempt]),
      data: r,
      status: 'rejected',
    })),
    ...(data.outcome
      ? [
          {
            key: 'outcome',
            label: t('第 {0} 次尝试 · 最终回报', [data.outcome.attempt]),
            data: data.outcome,
            status: data.outcome.status,
          },
        ]
      : record.kind === 'action'
        ? [
            {
              key: 'current',
              label: t('第 {0} 次尝试 · 当前状态', [record.attempt]),
              data: {
                attempt: record.attempt,
                status: record.status,
                claim: data.claim,
                reason: data.reason,
              },
              status: record.status,
            },
          ]
        : []),
  ];
  const artifacts = detail.artifacts.filter((a) => a.recordId === record.id);
  return (
    <div ref={motion} className="any-inspector-inner" data-dashboard-motion="detail">
      <div className="any-panel-heading">
        <b>{t('步骤详情')}</b>
        <span>{t(kindLabels[record.kind])}</span>
      </div>
      <div className="any-detail-content">
        <h3>{record.title === record.stepId ? record.title : t(record.title)}</h3>
        <ApplicationStatus value={record.status} />
        <p>
          {record.kind === 'action'
            ? record.status === 'running'
              ? t('已领取，等待原宿主回传结果；这不是宿主心跳。')
              : record.status === 'unknown'
                ? t('执行结果需要核对，保留原 Action 后由 Agent 继续。')
                : (data.reason ?? data.outcome?.summary ?? t('保存的执行动作与回报'))
            : record.kind === 'decision'
              ? t('查看当前提案、选项及其对应决定')
              : record.kind === 'evidence'
                ? t('查看所需证据类型、回执与失效原因')
                : t('此步骤已准备就绪，等待 Runtime 调度')}
        </p>
        {record.childLocator && (
          <Button block icon={<BranchesOutlined />} onClick={() => onChild(record)}>
            {t('进入子流程')}
          </Button>
        )}
        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: 'sequence',
              label: t('执行顺序'),
              children: record.sequence === null ? t('尚未分配') : `#${record.sequence}`,
            },
            {
              key: 'type',
              label: t('执行方式'),
              children: formatApplicationRecordType(record.type),
            },
            { key: 'attempt', label: t('动作尝试'), children: record.attempt ?? t('不适用') },
          ]}
        />
        <ApplicationStepDefinition step={definitionStep} record={record} />
        {record.kind === 'decision' && (
          <>
            <h4>{t('提案与用户决定')}</h4>
            <div className="any-choice-tags">
              {(data.choices ?? []).map((choice) => (
                <Tag key={choice}>
                  {t(
                    {
                      approved: '批准',
                      rejected: '拒绝',
                      revise: '修订',
                      skip: '跳过',
                      cancel: '取消',
                    }[choice] ?? choice,
                  )}
                </Tag>
              ))}
            </div>
            {data.decision && <p>{t('已记录决定：{0}', [data.decision.choice])}</p>}
            <details key={record.id} className="any-proposal-disclosure">
              <summary>
                <RightOutlined aria-hidden="true" />
                {t('完整提案与决定')}
              </summary>
              <div className="any-proposal-body">
                <pre>
                  {JSON.stringify(
                    {
                      proposal: data.proposal,
                      choices: data.choices,
                      proposalHash: data.proposalHash,
                      decision: data.decision,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </details>
            <div className="any-note">
              {t(
                detail.archive
                  ? '历史实验 · 只读'
                  : '本页只读；决定必须由 Agent 按当前提案继续处理。',
              )}
            </div>
          </>
        )}
        {record.kind === 'evidence' && (
          <>
            <h4>{t('证据要求')}</h4>
            <pre>
              {JSON.stringify(
                { kind: data.kind, receipt: data.receipt, invalidation: data.invalidation },
                null,
                2,
              )}
            </pre>
          </>
        )}
        {history.length > 0 && (
          <>
            <h4>{t('执行与返工')}</h4>
            <Collapse
              key={record.id}
              size="small"
              defaultActiveKey={[history.at(-1).key]}
              items={history.map((h) => ({
                key: h.key,
                label: (
                  <span>
                    {h.label}
                    {h.status !== 'reconciled' && <ApplicationStatus value={h.status} />}
                  </span>
                ),
                children: (
                  <>
                    <p>
                      {h.data.reason ??
                        h.data.summary ??
                        (h.status === 'reconciled'
                          ? t('已核对原执行；核对记录本身不是一次新的执行。')
                          : t('此记录绑定同一 Action 的对应尝试。'))}
                    </p>
                    <Button type="link" size="small" onClick={() => onAttempt(record, h)}>
                      {t('查看这次记录')}
                    </Button>
                  </>
                ),
              }))}
            />
            {record.attempt > 1 && (
              <p className="any-footnote">
                {t('部分历史尝试只保存核对或拒收记录，未保存的结果不会补写。')}
              </p>
            )}
          </>
        )}
        {artifacts.length > 0 && (
          <>
            <h4>{t('关联产物')}</h4>
            {artifacts.map((a) => (
              <button key={a.id} className="any-artifact-link" onClick={() => onArtifact(a)}>
                <FileTextOutlined />
                <span>{a.label}</span>
                <RightOutlined />
              </button>
            ))}
          </>
        )}
        <h4>{t('应用版本的验证证据')}</h4>
        {detail.application ? (
          <>
            <ApplicationEvidenceCards detail={detail} onEvidence={onEvidence} />
            <Button type="link" size="small" onClick={onEvidenceTab}>
              {t('查看证据来源与历史')}
            </Button>
          </>
        ) : (
          <p className="any-muted">{t('应用尚未生成，暂时没有版本验证证据。')}</p>
        )}
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: 'record',
              label: t('运行标识与原始记录'),
              children: (
                <pre>
                  {JSON.stringify(
                    {
                      runId: detail.runId,
                      revision: detail.revision,
                      application: detail.application,
                      recordId: record.id,
                      type: record.type,
                      ...data,
                    },
                    null,
                    2,
                  )}
                </pre>
              ),
            },
          ]}
        />
      </div>
      <div className="any-inspector-foot">
        {t(detail.archive ? '历史实验 · 只读' : '只读观测 · 决定与恢复由 Agent 继续')}
      </div>
    </div>
  );
}
export function ApplicationEvidenceView({ detail, onEvidence, onSource, onEval }) {
  return (
    <div className="any-evidence-page">
      <h3>
        {detail.application
          ? `v${detail.application.version} · ${t('验证证据')}`
          : t('应用尚未生成')}
      </h3>
      <p>{t('本地校验、模型行为和宿主执行分别记录，缺少证据时保留无记录状态。')}</p>
      <ApplicationEvidenceCards detail={detail} onEvidence={onEvidence} />
      {detail.sourceCreators.map((c) => (
        <Button key={c.locator} type="link" onClick={() => onSource(c.locator)}>
          {t('查看对应创作')} · {c.runId}
        </Button>
      ))}
      {detail.evidence
        .filter((e) => e.evalRunId)
        .map((e) => (
          <Button
            key={e.kind}
            type="link"
            icon={<ExportOutlined />}
            onClick={() => onEval(e.evalRunId)}
          >
            {t('进入 Eval 详情')}
          </Button>
        ))}
      {detail.otherEvidence.length > 0 && (
        <Collapse
          items={[
            {
              key: 'history',
              label: t(detail.archive ? '原 Creator 评估决定' : '历史证据 · 对应其他版本或内容'),
              children: detail.otherEvidence.map((e, i) => (
                <button key={i} className="any-history-evidence" onClick={() => onEvidence(e)}>
                  <span>
                    {t(evidenceLabels[e.kind])} · v{e.version}
                  </span>
                  <ApplicationStatus value="stale" />
                </button>
              )),
            },
          ]}
        />
      )}
      <Collapse
        ghost
        items={[
          {
            key: 'identity',
            label: t('固定身份与内容摘要'),
            children: (
              <pre>
                {JSON.stringify(
                  {
                    application: detail.application,
                    material: detail.material,
                    workflow: detail.workflow,
                  },
                  null,
                  2,
                )}
              </pre>
            ),
          },
        ]}
      />
    </div>
  );
}
export function ApplicationObservationDrawer({ data }) {
  if (!data) return null;
  return (
    <div className="any-observation-drawer">
      <Tag>{t('保存的观测记录')}</Tag>
      <h2>{data.title}</h2>
      <p>{data.message ? systemText(data.message) : null}</p>
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: 'run', label: t('查看记录'), children: data.runId },
          {
            key: 'version',
            label: t('应用版本'),
            children: data.version ? `v${data.version}` : t('尚未生成'),
          },
          {
            key: 'source',
            label: t('证据来源'),
            children: data.evidence?.sourceRunId ?? data.recordId ?? t('无记录'),
          },
        ]}
      />
      {data.evidence?.status === 'stale' && (
        <Alert
          type="warning"
          showIcon
          title={t('失效表示不适用于当前候选，原报告的结果仍保留。')}
        />
      )}
      <pre>{JSON.stringify(data.evidence ?? data.record, null, 2)}</pre>
    </div>
  );
}

export function ApplicationStateIcon({ status }) {
  return ['succeeded', 'completed', 'delivered'].includes(status) ? (
    <CheckCircleFilled className="any-ok" />
  ) : ['failed', 'unknown', 'stale'].includes(status) ? (
    <ExclamationCircleOutlined className="any-warn" />
  ) : ['waiting', 'evidence', 'child'].includes(status) ? (
    <ClockCircleOutlined className="any-warn" />
  ) : status === 'running' ? (
    <span className="any-activity-dot" />
  ) : (
    <span className="any-empty-dot" />
  );
}
