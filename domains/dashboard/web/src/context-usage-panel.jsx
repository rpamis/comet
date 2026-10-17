import React, { useState } from 'react';
import { Button, Collapse, Empty, Popover, Tag, Tooltip } from 'antd';
import { ArrowRightOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { t, getDashboardLocale, systemText } from './dashboard-i18n.js';
import { DashboardModal } from './dashboard-modal.jsx';
import {
  UsageDeliveryChart,
  UsageFeedbackChart,
  UsageHitBreakdown,
  UsageLatencyChart,
  UsageMiniLatency,
  UsageOutcomeChart,
} from './context-usage-charts.jsx';
import './context-usage-panel.css';

const outcomeLabel = (outcome) =>
  ({
    'used-successfully': t('成功使用'),
    corrected: t('已纠正'),
    'contributed-to-failure': t('导致失败'),
    ignored: t('未采用'),
    overridden: t('已覆盖'),
  })[outcome] ?? t('尚无反馈');

export function ContextUsagePanel({ snapshot, title, rangeLabel = t('最近 7 天') }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState([]);
  const known = snapshot?.available === true;
  const percent = (value) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(getDashboardLocale(), {
          maximumFractionDigits: 1,
        }).format(value * 100);
  const count = (value) => (known ? (value ?? 0) : '—');
  const metrics = [
    {
      label: t('上下文命中率'),
      value: percent(known ? snapshot.hitRate : null),
      unit: known && snapshot.hitRate != null ? '%' : '',
      detail: known
        ? t('{0}/{1} 次请求有适用内容', [snapshot.hits, snapshot.requests])
        : t('暂无可用统计'),
      help: t(
        '已记录的任务请求中返回适用候选的比例，包含零结果请求。不含目录索引，不代表召回准确性。',
      ),
    },
    {
      label: t('全文交付'),
      value: count(snapshot?.fullDeliveries),
      detail: t('含按需展开，按应用记录去重'),
      help: t('仅推荐摘要不算全文交付。交付不代表 Agent 已采用。'),
    },
    {
      label: t('使用成功率'),
      value: percent(known ? snapshot.successRate : null),
      unit: known && snapshot.successRate != null ? '%' : '',
      detail: known
        ? t('{0}/{1} 次实际使用反馈成功', [
            snapshot.successes,
            snapshot.successes + snapshot.corrections + snapshot.failures,
          ])
        : t('尚无使用反馈'),
      help:
        t(
          '依据 Agent 回报的成功、纠正和导致失败计算。未采用和已覆盖单独列出；任务完成不自动算成功。',
        ) +
        (known
          ? ` ${t('成功 {0}，纠正 {1}，导致失败 {2}，未采用 {3}，已覆盖 {4}', [snapshot.successes, snapshot.corrections, snapshot.failures, snapshot.ignored, snapshot.overridden])}`
          : ''),
    },
    {
      label: t('反馈覆盖率'),
      value: percent(known ? snapshot.feedbackRate : null),
      unit: known && snapshot.feedbackRate != null ? '%' : '',
      detail: known
        ? t('{0}/{1} 条推荐有结果反馈', [snapshot.feedbackCount, snapshot.recommendations])
        : t('尚无使用反馈'),
      help: t('包含摘要推荐和全文交付。没有反馈保持未知，不计为失败。'),
    },
    {
      label: t('检索耗时 P95'),
      value: known && snapshot.p95Ms != null ? Math.round(snapshot.p95Ms) : '—',
      unit: known && snapshot.p95Ms != null ? ' ms' : '',
      detail:
        known && snapshot.lastQueryMs != null
          ? t('最近一次 {0} ms', [Math.round(snapshot.lastQueryMs)])
          : t('尚无耗时记录'),
      help: t('95% 已记录请求的检索耗时不超过此值；不包含 CLI 启动或模型思考时间。'),
    },
  ];
  const recent = known ? (snapshot.recentTasks ?? []) : [];
  const openHistory = (index = null) => {
    setSelectedTask(index === null ? [] : [`${recent[index].episodeId}:${index}`]);
    setHistoryOpen(true);
  };
  const renderMetric = (index, chart = null) => {
    const metric = metrics[index];
    return (
      <div key={metric.label} className={`usage-summary-stat usage-summary-stat-${index}`}>
        <dt>
          <Tooltip title={metric.help}>
            <span tabIndex={0}>
              {metric.label} <InfoCircleOutlined />
            </span>
          </Tooltip>
        </dt>
        <dd title={metric.detail}>
          {metric.value}
          <span className="dashboard-context-usage-unit">{metric.unit}</span>
        </dd>
        <small>{metric.detail}</small>
        {chart}
      </div>
    );
  };
  return (
    <section className="dashboard-context-usage" aria-label={title}>
      <dl className="usage-overview-grid">
        {renderMetric(0, <UsageHitBreakdown snapshot={snapshot} />)}
        {renderMetric(1, <UsageDeliveryChart snapshot={snapshot} />)}
        {renderMetric(4, <UsageMiniLatency recent={recent} />)}
      </dl>
      <div className="usage-analysis-grid">
        <section className="usage-card usage-latency-card" aria-label={t('最近检索耗时')}>
          <header>
            <h4>{t('最近检索耗时')}</h4>
            <span>
              {known && snapshot.lastQueryMs != null
                ? t('最近一次 {0} ms', [Math.round(snapshot.lastQueryMs)])
                : t('尚无耗时记录')}
            </span>
          </header>
          <UsageLatencyChart recent={recent} demo={snapshot?.demo} onSelect={openHistory} />
        </section>
        <section className="usage-card usage-feedback-card" aria-label={t('使用反馈')}>
          <header>
            <h4>{t('使用反馈')}</h4>
            <Tooltip title={t('没有反馈保持未知，不计为失败。')} trigger={['hover', 'focus']}>
              <Button
                type="text"
                size="small"
                className="usage-help-button"
                aria-label={t('了解使用反馈')}
                icon={<InfoCircleOutlined />}
              />
            </Tooltip>
          </header>
          <UsageFeedbackChart snapshot={snapshot}>
            <dl className="usage-feedback-metrics">
              {renderMetric(2)}
              {renderMetric(3)}
            </dl>
          </UsageFeedbackChart>
        </section>
      </div>
      <div className="usage-details-grid">
        <section className="usage-card usage-outcome-card" aria-label={t('反馈结果分布')}>
          <header>
            <h4>{t('反馈结果分布')}</h4>
            <span>{rangeLabel}</span>
          </header>
          <UsageOutcomeChart snapshot={snapshot} />
        </section>
        <div className="dashboard-context-usage-recent">
          <div className="dashboard-context-usage-recent-heading">
            <h4>{t('最近检索记录')}</h4>
            <Button
              size="small"
              type="text"
              disabled={!recent.length}
              onClick={() => openHistory()}
            >
              {t('查看最近任务')}
              <ArrowRightOutlined />
            </Button>
          </div>
          {recent.length ? (
            <div className="dashboard-context-usage-recent-list">
              {recent.slice(0, 3).map((row, index) => (
                <button
                  type="button"
                  key={`${row.episodeId}:${index}`}
                  className="dashboard-context-usage-recent-row"
                  onClick={() => openHistory(index)}
                >
                  <span className="dashboard-context-usage-recent-copy">
                    <strong>{snapshot.demo ? t(row.task) : row.task}</strong>
                    <span>
                      {new Date(row.occurredAt).toLocaleString(getDashboardLocale())}
                      {row.elapsedMs != null ? ` · ${Math.round(row.elapsedMs)} ms` : ''}
                    </span>
                  </span>
                  <Tag color={row.limited ? 'warning' : undefined}>
                    {row.limited
                      ? t('结果受限')
                      : row.counted
                        ? t('{0} 个适用候选', [row.candidateCount])
                        : t('按需展开')}
                  </Tag>
                  <ArrowRightOutlined
                    className="dashboard-context-usage-row-arrow"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-context-usage-empty">
              <strong>{known ? t('等待下一次任务检索') : t('暂无可用统计')}</strong>
              <p>{t('Agent 执行任务后，可在这里查看检索内容与使用反馈。')}</p>
            </div>
          )}
        </div>
      </div>
      <footer>
        <span>
          {!known
            ? t('暂无可用统计')
            : snapshot.requests > 0
              ? t('{0} 次请求受限或异常', [snapshot.limitedRequests])
              : t('统计从后续任务开始，不补造历史数据')}
          {known && snapshot.requests > 0 && snapshot.trackingStartedAt
            ? ` · ${t('自 {0} 开始记录', [new Date(snapshot.trackingStartedAt).toLocaleDateString(getDashboardLocale())])}`
            : ''}
        </span>
        <Popover
          trigger="click"
          title={t('统计范围与准确性')}
          content={
            <div className="dashboard-context-usage-help">
              <p>
                {t(
                  '只统计实际任务的上下文请求，合并同一次请求的并行读取。Dashboard 管理、预览和 Hook 快速读取不计入。',
                )}
              </p>
              <p>
                {t(
                  '当前项目的两类统计合计保留最近 7 天最多 {0} 条请求与展开记录。每次最多保留 24 条内容，超出上限会标明截断。',
                  [snapshot?.sampleLimit ?? 500],
                )}
              </p>
              <p>
                {t(
                  '真实召回率需要知道本应召回哪些内容。当前没有可用的项目标注评估结果，日常命中率不能替代召回率。',
                )}
              </p>
            </div>
          }
        >
          <Button size="small" type="link">
            {t('准确性评估：暂无标注结果')}
          </Button>
        </Popover>
      </footer>
      <DashboardModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('最近任务的上下文使用')}
        footer={null}
        width={780}
      >
        <p className="dashboard-context-usage-history-note">
          {t('最多展示最近 10 条请求与展开记录。使用结果来自 Agent 反馈；缺少反馈时保持未知。')}
        </p>
        {recent.length ? (
          <Collapse
            activeKey={selectedTask}
            onChange={setSelectedTask}
            items={recent.map((row, index) => ({
              key: `${row.episodeId}:${index}`,
              label: (
                <div className="dashboard-context-usage-task">
                  <strong>{snapshot.demo ? t(row.task) : row.task}</strong>
                  <span>
                    {new Date(row.occurredAt).toLocaleString(getDashboardLocale())}
                    {row.phase ? ` · ${row.phase}` : ''}
                  </span>
                </div>
              ),
              extra: row.limited ? (
                <Tag color="warning">{t('结果受限')}</Tag>
              ) : (
                <Tag>{row.counted ? t('{0} 个适用候选', [row.candidateCount]) : t('按需展开')}</Tag>
              ),
              children: (
                <div className="dashboard-context-usage-items">
                  {row.items.length ? (
                    row.items.map((item, itemIndex) => (
                      <article key={`${item.candidateId}:${itemIndex}`}>
                        <strong>{snapshot.demo ? t(item.title) : item.title}</strong>
                        <div>
                          <Tag>{item.delivery === 'full' ? t('已交付全文') : t('仅推荐摘要')}</Tag>
                          <Tag color={item.outcome === 'used-successfully' ? 'success' : undefined}>
                            {outcomeLabel(item.outcome)}
                          </Tag>
                        </div>
                        {item.whyApplied && <p>{systemText(item.whyApplied)}</p>}
                      </article>
                    ))
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        row.candidateCount > 0
                          ? t('有适用候选，本次未新增交付；可能已交付或超出预算')
                          : t('本次没有返回适用内容')
                      }
                    />
                  )}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description={t('尚无请求统计')} />
        )}
      </DashboardModal>
    </section>
  );
}
