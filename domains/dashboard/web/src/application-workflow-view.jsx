import React from 'react';
import { Button, Collapse, Tag } from 'antd';
import { ArrowRightOutlined, BranchesOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
import {
  ApplicationStatus,
  ApplicationStateIcon,
  formatApplicationRecordType,
} from './application-record-inspector.jsx';

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
}) {
  const byId = new Map(flow.nodes.map((node) => [node.stepId, node]));
  return (
    <div className="any-step-list any-workflow-view" aria-label={t('完整流程')}>
      <div className="any-flow-heading">
        <b>{flow.title}</b>
        {flow.description && <p>{flow.description}</p>}
        <p className="any-footnote">
          {t(
            '连接表示定义允许的路径；状态来自实际记录。尚未开始的分支不代表失败，也不计入完成百分比。',
          )}
        </p>
      </div>
      <nav className="any-flow-phases" aria-label={t('阶段导航')}>
        {flow.phases.map((phase, index) => (
          <Button
            key={phase}
            size="small"
            onClick={() => {
              setExpanded((value) => ({ ...value, [`${locator}:flow:${phase}`]: true }));
              requestAnimationFrame(() =>
                document
                  .getElementById(`any-flow-phase-${index}`)
                  ?.scrollIntoView({ block: 'nearest' }),
              );
            }}
          >
            {t(phase)}
          </Button>
        ))}
      </nav>
      {flow.phaseGroups.map(({ phase, nodes }, phaseIndex) => {
        const key = `${locator}:flow:${phase}`;
        return (
          <Collapse
            key={phase}
            id={`any-flow-phase-${phaseIndex}`}
            ghost
            activeKey={expanded[key] === false ? [] : [phase]}
            onChange={(keys) => setExpanded((value) => ({ ...value, [key]: keys.includes(phase) }))}
            items={[
              {
                key: phase,
                label: (
                  <span className="any-phase-title">
                    <span>{t(phase)}</span>
                    <small>{t('{0} 个步骤', [nodes.length])}</small>
                  </span>
                ),
                children: nodes.map((node) => {
                  const selected =
                    stepId === node.stepId || node.records.some((record) => record.id === recordId);
                  const active = node.activeRecordIds;
                  const history = node.records.filter((record) => !active.includes(record.id));
                  const edges = node.connections;
                  return (
                    <section
                      key={node.stepId}
                      className={'any-flow-node ' + (selected ? 'selected' : '')}
                      data-step-id={node.stepId}
                    >
                      <button
                        className="any-step-row"
                        aria-pressed={selected}
                        onClick={() => selectStep(node)}
                        disabled={loading === node.stepId}
                      >
                        <ApplicationStateIcon status={node.latestStatus} />
                        <span className="any-step-copy">
                          <b>{node.title}</b>
                          <small>
                            {formatApplicationRecordType(node.type)}
                            {node.recordCount > 0 &&
                              ` · ${t('{0} 条执行记录', [node.recordCount])}`}
                          </small>
                        </span>
                        <span className="any-flow-tags">
                          {node.entry && <Tag>{t('入口')}</Tag>}
                          {!active.length &&
                            (node.recordCount ? (
                              <ApplicationStatus value={node.latestStatus ?? 'unknown'} />
                            ) : (
                              <Tag>{t('尚未开始')}</Tag>
                            ))}
                          {active.length > 0 && (
                            <Tag color="processing">{t('{0} 项当前工作', [active.length])}</Tag>
                          )}
                        </span>
                      </button>
                      {active.length > 0 && (
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
                                  {record?.sequence == null
                                    ? t('已准备就绪')
                                    : t('顺序 {0}', [record.sequence])}
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
                      {node.join?.length > 0 && (
                        <div className="any-flow-join">
                          <BranchesOutlined />
                          <span>
                            {t('汇合依赖：{0}', [
                              node.join.map((id) => byId.get(id)?.title ?? id).join(' · '),
                            ])}
                          </span>
                        </div>
                      )}
                      {node.commands.length > 0 && (
                        <div className="any-flow-join">
                          {t('命令入口：{0}', [node.commands.join(' · ')])}
                        </div>
                      )}
                      {edges.length > 0 && (
                        <div className="any-flow-connections" aria-label={t('后续路径')}>
                          {edges.map((edge, index) => (
                            <button
                              key={`${edge.to}:${edge.on}:${index}`}
                              onClick={() => selectStep(byId.get(edge.to))}
                            >
                              <ArrowRightOutlined />
                              <span>
                                {edge.on} → {byId.get(edge.to)?.title ?? edge.to}
                              </span>
                              {edge.parallel && <Tag>{t('同时启动')}</Tag>}
                              {edge.cyclic && <Tag>{t('循环路径')}</Tag>}
                            </button>
                          ))}
                        </div>
                      )}
                      {node.recordCount > 0 && (
                        <Collapse
                          className="any-step-history"
                          ghost
                          items={[
                            {
                              key: 'records',
                              label: t('查看执行记录'),
                              children: (
                                <>
                                  {history.map((record) => (
                                    <button
                                      key={record.id}
                                      id={`any-record-${record.id}`}
                                      data-record-id={record.id}
                                      className={
                                        'any-round-row ' +
                                        (recordId === record.id ? 'selected' : '')
                                      }
                                      onClick={() => selectRecordId(node, record.id)}
                                    >
                                      <span>
                                        {record.sequence == null ? '—' : `#${record.sequence}`}
                                        {record.attempt > 1 &&
                                          ` · ${t('尝试 {0}', [record.attempt])}`}
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
                                  {!node.records.some(
                                    (record) => record.id === node.latestRecordId,
                                  ) &&
                                    node.latestRecordId && (
                                      <Button
                                        size="small"
                                        onClick={() => selectRecordId(node, node.latestRecordId)}
                                      >
                                        {t('读取最新记录')}
                                      </Button>
                                    )}
                                </>
                              ),
                            },
                          ]}
                        />
                      )}
                    </section>
                  );
                }),
              },
            ]}
          />
        );
      })}
    </div>
  );
}
