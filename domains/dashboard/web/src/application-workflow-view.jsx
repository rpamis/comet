import React, { useRef } from 'react';
import { Button, Collapse, Tag, Tooltip } from 'antd';
import { ArrowRightOutlined, BranchesOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
import { applicationPhaseState } from './application-data.js';
import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
import { ApplicationWorkflowGraph } from './application-workflow-graph.jsx';
import {
  ApplicationStatus,
  ApplicationStateIcon,
  formatApplicationRecordType,
} from './application-record-inspector.jsx';

export function TransitionPaths({ node, byId, selectStep }) {
  const groups = new Map();
  for (const edge of node.connections) {
    if (!groups.has(edge.on)) groups.set(edge.on, []);
    groups.get(edge.on).push(edge);
  }
  const conditions = {
    succeeded: '完成后',
    failed: '失败时',
    approved: '批准后',
    rejected: '拒绝后',
    revise: '修订后',
    cancelled: '取消后',
  };
  return (
    <div className="any-flow-paths">
      {node.join?.length > 0 && (
        <div className="any-flow-join">
          <BranchesOutlined />
          <span>
            {t('汇合依赖：{0}', [node.join.map((id) => byId.get(id)?.title ?? id).join(' · ')])}
          </span>
        </div>
      )}
      {node.commands.length > 0 && (
        <div className="any-flow-join">{t('命令入口：{0}', [node.commands.join(' · ')])}</div>
      )}
      {groups.size > 0 && (
        <div className="any-flow-connections" aria-label={t('后续路径')}>
          {[...groups].map(([event, edges]) => (
            <div className="any-flow-path-group" key={event}>
              <div className="any-flow-condition">
                <span>{Object.hasOwn(conditions, event) ? t(conditions[event]) : event}</span>
                {edges.some((edge) => edge.parallel) && <Tag>{t('同时启动')}</Tag>}
              </div>
              <div className="any-flow-targets">
                {edges.map((edge, index) => (
                  <button key={`${edge.to}:${index}`} onClick={() => selectStep(byId.get(edge.to))}>
                    <ArrowRightOutlined />
                    <span>{byId.get(edge.to)?.title ?? edge.to}</span>
                    {edge.cyclic && <span className="any-flow-loop">{t('循环路径')}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowNode({
  node,
  byId,
  recordId,
  stepId,
  selectStep,
  selectRecordId,
  loading,
  compact = false,
}) {
  const selected = stepId === node.stepId || node.records.some((record) => record.id === recordId);
  const active = node.activeRecordIds;
  const single =
    active.length === 1 ? node.records.find((record) => record.id === active[0]) : null;
  const primaryId = active.length === 1 ? active[0] : null;
  const status = primaryId
    ? (single?.status ??
      (node.latestRecordId === primaryId ? node.latestStatus : null) ??
      'unknown')
    : node.latestStatus;
  const history = node.records.filter((record) => !active.includes(record.id));
  const paths = node.connections.length > 0 || node.join?.length > 0 || node.commands.length > 0;
  const disclosures = [];
  if (paths)
    disclosures.push({
      key: 'paths',
      label: (
        <span className="any-flow-disclosure-label">
          <span>{t('查看路径')}</span>
          <span>{node.connections.length || node.join?.length || node.commands.length}</span>
        </span>
      ),
      children: <TransitionPaths node={node} byId={byId} selectStep={selectStep} />,
    });
  if (node.recordCount > 0 && (history.length > 0 || node.recordCount > node.records.length))
    disclosures.push({
      key: 'records',
      label: (
        <span className="any-flow-disclosure-label">
          <span>{t('查看执行记录')}</span>
          <span>{node.recordCount}</span>
        </span>
      ),
      children: (
        <div className="any-flow-history">
          {history.map((record) => (
            <button
              key={record.id}
              id={`any-record-${record.id}`}
              data-record-id={record.id}
              className={'any-round-row ' + (recordId === record.id ? 'selected' : '')}
              onClick={() => selectRecordId(node, record.id)}
            >
              <span>
                {record.sequence == null ? '—' : `#${record.sequence}`}
                {record.attempt > 1 && ` · ${t('尝试 {0}', [record.attempt])}`}
              </span>
              <ApplicationStatus value={record.status} />
            </button>
          ))}
          {node.recordCount > node.records.length && (
            <p className="any-footnote">
              {t('已加载 {0} / {1} 条记录，可在上方加载更多执行记录。', [
                node.records.length,
                node.recordCount,
              ])}
            </p>
          )}
          {!node.records.some((record) => record.id === node.latestRecordId) &&
            node.latestRecordId && (
              <Button size="small" onClick={() => selectRecordId(node, node.latestRecordId)}>
                {t('读取最新记录')}
              </Button>
            )}
        </div>
      ),
    });
  return (
    <section
      id={`any-flow-step-${node.stepId}`}
      className={'any-flow-node ' + (selected ? 'selected' : '')}
      data-step-id={node.stepId}
    >
      <button
        className={'any-step-row ' + (selected ? 'selected' : '')}
        id={primaryId ? `any-record-${primaryId}` : undefined}
        data-record-id={primaryId ?? undefined}
        aria-pressed={selected}
        onClick={() => selectStep(node)}
        disabled={loading === node.stepId}
      >
        <ApplicationStateIcon status={status} />
        <span className="any-step-copy">
          <b>{node.title === node.stepId ? node.title : t(node.title)}</b>
          <small>
            {formatApplicationRecordType(node.type)}
            {single?.sequence != null && ` · #${single.sequence}`}
            {node.recordCount > 0 && ` · ${t('{0} 条执行记录', [node.recordCount])}`}
          </small>
        </span>
        <span className="any-flow-tags">
          {node.entry && <span className="any-flow-entry">{t('入口')}</span>}
          {active.length > 1 ? (
            <Tag color="processing">{t('{0} 项当前工作', [active.length])}</Tag>
          ) : node.recordCount || active.length ? (
            <ApplicationStatus value={status ?? 'unknown'} />
          ) : (
            <span className="any-flow-unstarted">
              {t(
                node.unloaded ? '尚未读取该步骤的记录' : node.planned ? '尚无执行记录' : '尚未开始',
              )}
            </span>
          )}
        </span>
      </button>
      {active.length > 1 && (
        <div className="any-flow-activations" aria-label={t('当前执行记录')}>
          {active.map((id) => {
            const record = node.records.find((item) => item.id === id);
            return (
              <button
                key={id}
                id={`any-record-${id}`}
                data-record-id={id}
                className={'any-round-row ' + (recordId === id ? 'selected' : '')}
                onClick={() => selectRecordId(node, id)}
              >
                <span>
                  {record?.sequence == null ? t('已准备就绪') : t('顺序 {0}', [record.sequence])}
                </span>
                {record ? (
                  <ApplicationStatus value={record.status} />
                ) : (
                  <span>{t('读取执行记录')}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {!compact && disclosures.length > 0 && (
        <Collapse className="any-flow-details" ghost size="small" items={disclosures} />
      )}
    </section>
  );
}

export function ApplicationWorkflowView({
  flow,
  locator,
  recordId,
  stepId,
  expanded,
  setExpanded,
  selectStep,
  selectRecordId,
  loading,
  layout = 'stages',
  creator = false,
}) {
  const element = useRef(null);
  const byId = new Map(flow.nodes.map((node) => [node.stepId, node]));
  const allExpanded = flow.phaseGroups.every(
    ({ phase, nodes }) =>
      expanded[`${locator}:flow:${phase}`] ??
      (!creator || nodes.some((node) => node.activeRecordIds.length > 0)),
  );
  return (
    <div ref={element} className="any-step-list any-workflow-view" aria-label={t('完整流程')}>
      <div className="any-flow-heading">
        <div>
          <b>{t(flow.title)}</b>
          {flow.description && <p>{creator ? t(flow.description) : flow.description}</p>}
        </div>
        {creator && (
          <Button
            type="text"
            size="small"
            onClick={() =>
              setExpanded((value) => ({
                ...value,
                ...Object.fromEntries(
                  flow.phases.map((phase) => [`${locator}:flow:${phase}`, !allExpanded]),
                ),
              }))
            }
          >
            {t(allExpanded ? '收起所有阶段' : '展开所有阶段')}
          </Button>
        )}
        <Tooltip
          trigger={['hover', 'focus']}
          title={t(
            '连接表示定义允许的路径；状态来自实际记录。尚未开始的分支不代表失败，也不计入完成百分比。',
          )}
        >
          <button type="button" className="any-flow-help" aria-label={t('流程说明')}>
            <InfoCircleOutlined />
          </button>
        </Tooltip>
      </div>
      <nav className="any-flow-phases" aria-label={t('阶段导航')}>
        <WorkflowPhaseTrack
          ariaLabel={t(creator ? '创作阶段' : '应用阶段')}
          phases={flow.phases.map((phase) => [
            phase,
            t(creator && phase === '模型评估' ? '模型评估（可选）' : phase),
          ])}
          phaseStates={flow.phaseGroups.map(({ phase, nodes }) => {
            if (creator && phase === '模型评估' && flow.modelSkipped)
              return { state: 'pending', running: false, label: t('已跳过') };
            const state = applicationPhaseState(nodes);
            return { ...state, label: t(state.label) };
          })}
          onPhaseSelect={(phase, index) => {
            if (layout === 'graph') {
              const node = flow.phaseGroups[index].nodes[0];
              selectStep(node);
              element.current
                ?.getRootNode()
                .getElementById(`any-flow-step-${node.stepId}`)
                ?.scrollIntoView({ block: 'nearest' });
              return;
            }
            setExpanded((value) => ({ ...value, [`${locator}:flow:${phase}`]: true }));
            requestAnimationFrame(() =>
              element.current
                ?.getRootNode()
                .getElementById(`any-flow-phase-${index}`)
                ?.scrollIntoView({ block: 'nearest' }),
            );
          }}
        />
      </nav>
      {layout === 'graph' ? (
        <ApplicationWorkflowGraph
          flow={flow}
          renderNode={(node) => (
            <WorkflowNode
              key={node.stepId}
              compact
              {...{ node, byId, recordId, stepId, selectStep, selectRecordId, loading }}
            />
          )}
        />
      ) : (
        flow.phaseGroups.map(({ phase, nodes }, phaseIndex) => {
          const key = `${locator}:flow:${phase}`;
          return (
            <div key={phase} id={`any-flow-phase-${phaseIndex}`} className="any-step-phase">
              <Collapse
                ghost
                activeKey={
                  (expanded[key] ??
                  (!creator || nodes.some((node) => node.activeRecordIds.length > 0)))
                    ? [phase]
                    : []
                }
                onChange={(keys) =>
                  setExpanded((value) => ({ ...value, [key]: keys.includes(phase) }))
                }
                items={[
                  {
                    key: phase,
                    label: (
                      <span className="any-phase-title">
                        <span>{t(phase)}</span>
                        <small>{t('{0} 个步骤', [nodes.length])}</small>
                      </span>
                    ),
                    children: nodes.map((node) => (
                      <WorkflowNode
                        key={node.stepId}
                        {...{ node, byId, recordId, stepId, selectStep, selectRecordId, loading }}
                      />
                    )),
                  },
                ]}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
