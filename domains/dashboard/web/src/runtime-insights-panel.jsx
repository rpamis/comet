import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Segmented, Skeleton, Tag } from 'antd';
import { getDashboardLocale, t } from './dashboard-i18n.js';
import { DEMO_RUNTIME_INSIGHTS } from './runtime-performance-demo.js';

const number = (value) =>
  value == null
    ? '—'
    : new Intl.NumberFormat(getDashboardLocale(), { maximumFractionDigits: 1 }).format(value);
const percent = (value) => (value == null ? '—' : `${number(value * 100)}%`);

export function RuntimeCommandInsights({ data, rangeLabel = t('最近 7 天') }) {
  const [order, setOrder] = useState('time');
  const rows = [...(data.hotspots ?? [])]
    .sort((a, b) => (order === 'time' ? b.totalDurationMs - a.totalDurationMs : b.count - a.count))
    .slice(0, 5);
  const value = (row) => (order === 'time' ? row.totalDurationMs : row.count);
  const maximum = Math.max(1, ...rows.map(value));
  const failures = (data.outcomes ?? []).filter((row) => row.exitCode !== 0);
  return (
    <div className="runtime-insight-grid">
      <section className="usage-card runtime-hotspots" aria-label={t('命令热点')}>
        <header>
          <h4>{t('命令热点')}</h4>
          <Segmented
            size="small"
            value={order}
            onChange={setOrder}
            options={[
              { label: t('累计耗时'), value: 'time' },
              { label: t('调用次数'), value: 'count' },
            ]}
          />
        </header>
        <div className="runtime-insight-body">
          {rows.length ? (
            rows.map((row) => (
              <div className="runtime-hotspot-row" key={`${row.workflow}:${row.command}`}>
                <div>
                  <strong>
                    {row.workflow === 'native' ? 'Native' : 'Classic'} <code>{row.command}</code>
                  </strong>
                  <span>
                    {number(value(row))}
                    {order === 'time' ? ' ms' : ''}
                  </span>
                </div>
                <div className="usage-hit-track" aria-hidden="true">
                  <span style={{ width: `${(value(row) / maximum) * 100}%` }} />
                </div>
                <small>
                  {t('{0} 次调用 · 成功率 {1} · P95 {2} ms', [
                    row.count,
                    percent(row.successRate),
                    number(row.p95Ms),
                  ])}
                </small>
              </div>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('尚无运行记录')} />
          )}
          <p className="usage-chart-caption">
            {t('Git 调用 {0} 次 · 累计 {1} ms', [
              number(data.commands.gitCommands),
              number(data.commands.gitDurationMs),
            ])}
          </p>
          <p className="usage-chart-caption">
            {t('仅聚合命令，不重复计入检查；并行 Git 耗时可能超过命令耗时。')}
          </p>
        </div>
      </section>
      <section className="usage-card runtime-outcomes" aria-label={t('命令结果分布')}>
        <header>
          <h4>{t('命令结果分布')}</h4>
          <span>{rangeLabel}</span>
        </header>
        <div className="runtime-insight-body">
          <div className="runtime-insight-headline">
            <strong>{percent(data.commands.successRate)}</strong>
            <span>{t('命令成功率')}</span>
          </div>
          <div className="runtime-result-track" aria-hidden="true">
            <span style={{ width: `${(data.commands.successRate ?? 0) * 100}%` }} />
            <i style={{ width: `${(data.commands.failureRate ?? 0) * 100}%` }} />
          </div>
          <div className="usage-chart-key">
            <span>
              <i />
              {t('成功')} {number(data.commands.successes)}
            </span>
            <span>
              <i className="runtime-warning-key" />
              {t('非零退出')} {number(data.commands.failures)}
            </span>
          </div>
          <ul className="runtime-failure-list">
            {failures.map((row) => (
              <li key={`${row.workflow}:${row.command}:${row.exitCode}`}>
                <span>
                  {row.workflow === 'native' ? 'Native' : 'Classic'} <code>{row.command}</code>
                  <small>
                    {t('退出码')} {row.exitCode}
                  </small>
                </span>
                <strong>{number(row.count)}</strong>
              </li>
            ))}
          </ul>
          {!failures.length && (
            <p className="usage-chart-caption">
              {t(data.commands.count ? '采样窗口内暂无非零退出记录' : '尚无运行记录')}
            </p>
          )}
          <p className="usage-chart-caption">
            {t('非零退出也可能表示业务阻塞，请结合记录详情判断。')}
          </p>
        </div>
      </section>
    </div>
  );
}

export function RuntimeInsightsPanel({ projectId, demo, refreshToken, cacheRef }) {
  const [state, setState] = useState({});
  const [retry, setRetry] = useState(0);
  const localCache = useRef(null);
  const cache = cacheRef ?? localCache;
  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController();
    setState({ data: cache.current, loading: true });
    fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/runtime-insights`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          cache.current = data;
          setState({ data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ data: cache.current, error: true });
      });
    return () => controller.abort();
  }, [projectId, demo, refreshToken, retry, cache]);
  const data = demo ? DEMO_RUNTIME_INSIGHTS : (state.data ?? cache.current);
  const health = data?.health;
  const quality = data?.quality;
  const healthStats =
    health?.state === 'running'
      ? [
          [t('常驻处理请求'), health.requestCount, ''],
          [t('活动命令'), health.activeRequests, ''],
          [t('进程内存 RSS'), health.memoryRssBytes / 1048576, 'MiB'],
          [t('已用堆内存'), health.memoryHeapUsedBytes / 1048576, 'MiB'],
          [t('进程运行时长'), health.uptimeSeconds / 60, t('分钟')],
          [t('最近处理耗时'), health.lastDurationMs, 'ms'],
        ]
      : [];
  return (
    <>
      {state.error && (
        <Alert
          className="runtime-performance-notice"
          type="warning"
          showIcon
          message={t(data ? '观测读取失败，保留上次快照' : '健康与执行质量暂不可用')}
          action={
            <Button size="small" onClick={() => setRetry((value) => value + 1)}>
              {t('重试')}
            </Button>
          }
        />
      )}
      <div className="runtime-insight-grid">
        <section className="usage-card" aria-label={t('Runtime 健康')}>
          <header>
            <h4>{t('Runtime 健康')}</h4>
            <Tag>{t('即时快照')}</Tag>
          </header>
          <div className="runtime-insight-body">
            {!health ? (
              state.error ? (
                <Empty description={t('健康与执行质量暂不可用')} />
              ) : (
                <Skeleton active paragraph={{ rows: 4 }} />
              )
            ) : (
              <>
                <div className={`runtime-health-status is-${health.state}`}>
                  <i />
                  <strong>
                    {t(
                      health.state === 'running'
                        ? '常驻服务已连接'
                        : health.state === 'idle'
                          ? '当前无常驻进程'
                          : '暂时无法读取状态',
                    )}
                  </strong>
                </div>
                {healthStats.length > 0 && (
                  <dl className="runtime-compact-metrics">
                    {healthStats.map(([label, value, unit]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {number(value)}
                          <small>{value == null ? '' : unit}</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="usage-chart-caption">
                  {t('只观测当前版本与环境的进程；按需启动，空闲退出不代表异常。')}
                </p>
                <p className="usage-chart-caption">
                  {t('状态查询不会启动进程，也不计入命令处理次数。')}
                </p>
              </>
            )}
          </div>
        </section>
        <section className="usage-card" aria-label={t('SDK 执行质量')}>
          <header>
            <h4>{t('SDK 执行质量')}</h4>
            <Tag>{t('当前快照')}</Tag>
          </header>
          <div className="runtime-insight-body">
            {!quality ? (
              state.error ? (
                <Empty description={t('执行记录暂不可读')} />
              ) : (
                <Skeleton active paragraph={{ rows: 4 }} />
              )
            ) : !quality.available ? (
              <Empty description={t('执行记录暂不可读')} />
            ) : (
              <>
                <div className="runtime-insight-headline">
                  <strong>{percent(quality.firstPassRate)}</strong>
                  <span>{t('动作首轮成功率')}</span>
                </div>
                <div className="usage-hit-track" aria-hidden="true">
                  <span style={{ width: `${(quality.firstPassRate ?? 0) * 100}%` }} />
                </div>
                <p className="usage-chart-caption">
                  {t('{0}/{1} 个已结束动作在首次尝试成功', [
                    quality.firstPassSucceeded,
                    quality.terminalActions,
                  ])}
                </p>
                <dl className="runtime-compact-metrics">
                  {[
                    [t('已成功动作'), quality.succeededActions],
                    [t('重试次数'), quality.retries],
                    [t('进行中动作'), quality.activeActions],
                    [t('等待确认'), quality.waitingDecisions],
                    [t('待核对动作'), quality.unknownActions],
                    [t('完成运行'), quality.completedRuns],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{number(value)}</dd>
                    </div>
                  ))}
                </dl>
                {(quality.unreadableRuns > 0 || quality.sourceErrors > 0 || quality.truncated) && (
                  <Tag color="warning">{t('部分样本')}</Tag>
                )}
                <p className="usage-chart-caption">
                  {t(
                    '当前项目 SDK 快照：读取 {0} 个运行，最多 {1} 个；不随工作流筛选，也不限定最近 7 天。',
                    [quality.sampledRuns, quality.sampleLimit],
                  )}
                </p>
                <p className="usage-chart-caption">
                  {t('首轮成功率仅统计成功或失败的已结束动作，等待、取消和未知状态不计入分母。')}
                </p>
                {(quality.unreadableRuns > 0 || quality.sourceErrors > 0) && (
                  <p className="usage-chart-caption">
                    {t('{0} 个运行不可读，{1} 个数据源读取失败；统计仅包含可读样本。', [
                      quality.unreadableRuns,
                      quality.sourceErrors,
                    ])}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
