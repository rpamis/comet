import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Segmented, Skeleton, Table, Tag } from 'antd';
import { t, getDashboardLocale } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { useDashboardViewState } from './dashboard-view-state.js';
import { DashboardModal } from './dashboard-modal.jsx';
import { UsageLatencyChart } from './context-usage-charts.jsx';
import { getDemoRuntimePerformance } from './runtime-performance-demo.js';
import { observabilityRangeQuery } from './observability-time-range.js';
import { RuntimeInsightsPanel, RuntimeCommandInsights } from './runtime-insights-panel.jsx';
import './runtime-performance-panel.css';

const workflowName = (value) => (value === 'native' ? 'Native' : 'Classic');
const number = (value) =>
  value == null
    ? '—'
    : new Intl.NumberFormat(getDashboardLocale(), { maximumFractionDigits: 1 }).format(value);

export function RuntimePerformancePanel({
  projectId,
  demo,
  refreshToken,
  timeRange,
  rangeLabel,
  timeSelection,
  cacheRef,
  insightsCacheRef,
}) {
  useDashboardLanguage();
  const scope = `${demo ? 'demo' : projectId}:runtime-performance`;
  const [workflow, setWorkflow] = useDashboardViewState(scope, 'workflow', 'all');
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null);
  const localCache = useRef(new Map());
  const cache = cacheRef ?? localCache;
  const rangeQuery = observabilityRangeQuery(timeRange);
  // 滚动时间范围刷新后沿用相同筛选的快照，失败时仍可阅读上次结果。
  const requestKey = `${projectId}:${workflow}:${timeSelection ? JSON.stringify(timeSelection) : rangeQuery}`;
  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController();
    setState({ key: requestKey, data: cache.current.get(requestKey), loading: true });
    fetch(
      `/api/dashboard/projects/${encodeURIComponent(projectId)}/runtime-performance?workflow=${workflow}${rangeQuery}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(t('运行性能读取失败'));
        const data = await response.json();
        if (
          !data?.commands ||
          !data?.checks ||
          !Array.isArray(data.workflows) ||
          !Array.isArray(data.slowest)
        )
          throw new Error(t('运行性能读取失败'));
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        cache.current.set(requestKey, data);
        setState({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key: requestKey, data: cache.current.get(requestKey), error: error.message });
      });
    return () => controller.abort();
  }, [projectId, demo, workflow, refreshToken, retry, requestKey, rangeQuery, cache]);
  useEffect(() => setSelected(null), [requestKey]);
  const current = state?.key === requestKey ? state : null;
  const data = demo
    ? getDemoRuntimePerformance(workflow, timeRange)
    : (current?.data ?? cache.current.get(requestKey));
  const commands = data?.commands;
  const checks = data?.checks;
  const recent = data?.recent ?? [];
  const requestRows = recent.map((row) => ({
    ...row,
    episodeId: row.id,
    counted: true,
    elapsedMs: row.durationMs,
    task: `${workflowName(row.workflow)} · ${row.command}`,
  }));
  const cards = commands
    ? [
        [t('命令调用次数'), commands.count, '', t('仅统计已采集的命令')],
        [
          t('命令成功率'),
          commands.successRate == null ? null : commands.successRate * 100,
          '%',
          t('{0}/{1} 次命令成功返回', [commands.successes, commands.count]),
        ],
        [
          t('一秒内成功响应'),
          commands.fastSuccessRate == null ? null : commands.fastSuccessRate * 100,
          '%',
          t('{0}/{1} 次命令在 1 秒内成功返回', [commands.fastSuccesses, commands.count]),
        ],
        [t('命令耗时 P50'), commands.p50Ms, 'ms', t('一半命令的处理耗时不超过此值')],
        [t('命令耗时 P95'), commands.p95Ms, 'ms', t('95% 命令的处理耗时不超过此值')],
        [
          t('检查通过率'),
          checks?.successRate == null ? null : checks.successRate * 100,
          '%',
          t('{0}/{1} 次实际检查通过', [checks?.successes ?? 0, checks?.count ?? 0]),
        ],
      ]
    : [];
  const columns = [
    {
      title: t('工作流'),
      dataIndex: 'workflow',
      width: 90,
      render: (value) => <Tag>{workflowName(value)}</Tag>,
    },
    {
      title: t('类型'),
      dataIndex: 'kind',
      width: 80,
      render: (value) => t(value === 'check' ? '检查执行' : '命令执行'),
    },
    {
      title: t('命令'),
      dataIndex: 'command',
      render: (value, row) => (
        <Button type="link" className="runtime-record-link" onClick={() => setSelected(row)}>
          {value}
        </Button>
      ),
    },
    {
      title: t('处理耗时'),
      dataIndex: 'durationMs',
      align: 'right',
      width: 110,
      render: (value) => `${number(value)} ms`,
    },
    {
      title: t('结果'),
      dataIndex: 'exitCode',
      width: 90,
      render: (value) => (
        <Tag color={value === 0 ? 'success' : 'error'}>{t(value === 0 ? '成功' : '失败')}</Tag>
      ),
    },
    {
      title: t('记录时间'),
      dataIndex: 'occurredAt',
      width: 160,
      render: (value) => new Date(value).toLocaleString(getDashboardLocale()),
    },
  ];
  const comparisonMax = Math.max(1, ...(data?.workflows ?? []).map((row) => row.p95Ms ?? 0));
  return (
    <section className="dashboard-context-usage runtime-performance" aria-label={t('运行性能')}>
      <div className="runtime-performance-toolbar">
        <Segmented
          aria-label={t('运行工作流')}
          value={workflow}
          onChange={setWorkflow}
          options={[
            { label: t('全部'), value: 'all' },
            { label: 'Native', value: 'native' },
            { label: 'Classic', value: 'classic' },
          ]}
        />
        {demo && <Tag>{t('演示数据')}</Tag>}
        {data?.truncated && <Tag color="warning">{t('记录已截断')}</Tag>}
        {!demo && <span className="runtime-performance-sync">{t('每 30 秒同步')}</span>}
      </div>
      {current?.error && (
        <Alert
          type="warning"
          showIcon
          message={t(data ? '读取失败，保留上次统计' : '运行性能读取失败')}
          action={
            <Button size="small" onClick={() => setRetry((value) => value + 1)}>
              {t('重试')}
            </Button>
          }
        />
      )}
      {!data ? (
        current?.error ? (
          <Empty description={t('暂无可用统计')} />
        ) : (
          <Skeleton active paragraph={{ rows: 8 }} />
        )
      ) : (
        <>
          <dl className="runtime-performance-metrics">
            {cards.map(([label, value, unit, detail]) => (
              <div className="usage-summary-stat" key={label}>
                <dt>{label}</dt>
                <dd>
                  {number(value)}
                  {value != null && <span className="dashboard-context-usage-unit">{unit}</span>}
                </dd>
                <small>{detail}</small>
              </div>
            ))}
          </dl>
          {!commands.count && !checks.count && (
            <Alert
              className="runtime-performance-notice"
              type="info"
              showIcon
              message={t('尚无运行记录')}
              description={t('后续执行 Native 或 Classic 命令后会开始记录，不补造历史数据。')}
            />
          )}
          <div className="usage-analysis-grid">
            <section className="usage-card" aria-label={t('最近命令耗时')}>
              <header>
                <h4>{t('最近命令耗时')}</h4>
                <span>{t('最近 {0} 条', [recent.length])}</span>
              </header>
              <UsageLatencyChart
                requestType="command"
                recent={requestRows}
                onSelect={(index) => setSelected(recent[index])}
              />
            </section>
            <section
              className="usage-card runtime-workflow-comparison"
              aria-label={t('工作流耗时对比')}
            >
              <header>
                <h4>{t('工作流耗时对比')}</h4>
                <span>P95</span>
              </header>
              <div className="runtime-workflow-bars">
                {data.workflows.map((row) => (
                  <div key={row.workflow}>
                    <div>
                      <strong>{workflowName(row.workflow)}</strong>
                      <span>
                        {number(row.p95Ms)}
                        {row.p95Ms != null ? ' ms' : ''}
                      </span>
                    </div>
                    <div className="usage-hit-track">
                      <span style={{ width: `${((row.p95Ms ?? 0) / comparisonMax) * 100}%` }} />
                    </div>
                    <small>{t('{0} 次命令 · {1} 次失败', [row.count, row.failures])}</small>
                  </div>
                ))}
              </div>
              <p className="usage-chart-caption">{t('对比当前项目同一采样窗口中的两种工作流。')}</p>
              <div className="runtime-check-summary" aria-label={t('检查执行统计')}>
                <strong>{t('检查执行统计')}</strong>
                <dl>
                  <div>
                    <dt>{t('检查次数')}</dt>
                    <dd>{number(checks.count)}</dd>
                  </div>
                  <div>
                    <dt>{t('检查耗时 P95')}</dt>
                    <dd>
                      {number(checks.p95Ms)}
                      {checks.p95Ms != null ? ' ms' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('检查失败次数')}</dt>
                    <dd>{number(checks.failures)}</dd>
                  </div>
                </dl>
                <p className="usage-chart-caption">
                  {t('检查单独统计，不与命令耗时相加；复用的检查不计为新执行。')}
                </p>
              </div>
            </section>
          </div>
          <RuntimeCommandInsights data={data} rangeLabel={rangeLabel} />
          <RuntimeInsightsPanel
            projectId={projectId}
            demo={demo}
            refreshToken={refreshToken}
            cacheRef={insightsCacheRef}
          />
          <section className="usage-card runtime-slowest" aria-label={t('慢命令与检查')}>
            <header>
              <h4>{t('慢命令与检查')}</h4>
              <span>{t('按处理耗时排序，最多 20 条')}</span>
            </header>
            <Table
              size="small"
              rowKey="id"
              columns={columns}
              dataSource={data.slowest}
              pagination={{ pageSize: 5, hideOnSinglePage: true, showSizeChanger: false }}
              scroll={{ x: 650 }}
              locale={{ emptyText: t('尚无运行记录') }}
            />
          </section>
          <p className="runtime-performance-footnote">
            {t('仅统计当前工作区最近 7 天已采集的记录，最多保留 10,000 条，读取最近 {0} 条。', [
              data.sampleLimit,
            ])}
            {data.truncated ? ` ${t('记录已截断')}` : ''}
          </p>
          <p className="usage-chart-caption">
            {t('处理耗时不含 CLI 启动和模型思考时间；帮助、Hook 与 Dashboard 预览不参与采集。')}
          </p>
        </>
      )}
      <DashboardModal
        open={!!selected}
        onClose={() => setSelected(null)}
        showCloseButton
        title={t('运行记录详情')}
        footer={null}
      >
        {selected && (
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: 'workflow', label: t('工作流'), children: workflowName(selected.workflow) },
              {
                key: 'kind',
                label: t('类型'),
                children: t(selected.kind === 'check' ? '检查执行' : '命令执行'),
              },
              { key: 'command', label: t('命令'), children: selected.command },
              {
                key: 'time',
                label: t('记录时间'),
                children: new Date(selected.occurredAt).toLocaleString(getDashboardLocale()),
              },
              {
                key: 'duration',
                label: t('处理耗时'),
                children: `${number(selected.durationMs)} ms`,
              },
              { key: 'exit', label: t('退出码'), children: selected.exitCode },
              { key: 'git', label: t('Git 调用次数'), children: selected.gitCommands },
              {
                key: 'gitTime',
                label: t('Git 累计耗时'),
                children: `${number(selected.gitDurationMs)} ms`,
              },
            ]}
          />
        )}
      </DashboardModal>
    </section>
  );
}
