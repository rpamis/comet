import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Select, Skeleton, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { t, getDashboardLocale } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { useDashboardViewState } from './dashboard-view-state.js';
import { DEMO_CHANGE_TRACES, DEMO_CHANGE_TRACE_INDEX } from './change-trace-demo.js';
import { DashboardModal } from './dashboard-modal.jsx';
import './change-trace-panel.css';
import { inObservabilityRange, observabilityRangeQuery } from './observability-time-range.js';

const statusLabel = (status) =>
  t(
    {
      pending: '待执行',
      running: '执行中',
      waiting: '等待中',
      succeeded: '成功',
      failed: '失败',
      cancelled: '已取消',
      unknown: '待核对',
    }[status] ?? '未知',
  );
const kindLabel = (kind) =>
  t(
    {
      workflow: '工作流',
      action: '动作',
      wait: '用户确认',
      evidence: '等待证据',
      command: '命令执行',
      check: '检查执行',
      retrieval: '上下文检索',
    }[kind] ?? kind,
  );
const number = (value) =>
  new Intl.NumberFormat(getDashboardLocale(), { maximumFractionDigits: 1 }).format(value);
const duration = (value) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value < 1000
      ? `${number(value)} ms`
      : value < 60000
        ? `${number(value / 1000)} s`
        : `${number(value / 60000)} min`;
const timestamp = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(getDashboardLocale())
    : '—';
const recordTime = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(getDashboardLocale(), {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
const phaseLabel = (name) =>
  ({
    open: t('启动'),
    spec: t('目标 Spec'),
    design: t('设计'),
    build: t('构建'),
    verify: t('验证'),
    archive: t('归档'),
  })[name] ?? name;
const nodeName = (node) => (node.timing === 'range' ? phaseLabel(node.name) : t(node.name));
const elapsed = (node, now) => {
  if (!node.startedAt || (!node.endedAt && !['running', 'waiting'].includes(node.status)))
    return null;
  const value = (node.endedAt ? Date.parse(node.endedAt) : now) - Date.parse(node.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

function treeRows(nodes, collapsed) {
  const children = new Map();
  const ids = new Set(nodes.map((node) => node.spanId));
  for (const node of nodes) {
    const parent = ids.has(node.parentSpanId) ? node.parentSpanId : null;
    const group = children.get(parent) ?? [];
    group.push(node);
    children.set(parent, group);
  }
  const rows = [],
    visited = new Set();
  const walk = (parent, depth) => {
    for (const node of (children.get(parent) ?? []).sort(
      (a, b) =>
        (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0) ||
        a.spanId.localeCompare(b.spanId),
    )) {
      if (visited.has(node.spanId)) continue;
      visited.add(node.spanId);
      rows.push({ node, depth, hasChildren: Boolean(children.get(node.spanId)?.length) });
      if (!collapsed.has(node.spanId)) walk(node.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function ChangeTracePanel({ projectId, demo, refreshToken, timeRange }) {
  useDashboardLanguage();
  const rangeQuery = observabilityRangeQuery(timeRange);
  const scope = `${demo ? 'demo' : projectId}:change-trace`;
  const [workflow, setWorkflow] = useDashboardViewState(scope, 'workflow', 'all');
  const [change, setChange] = useDashboardViewState(scope, 'change', 'all');
  const [traceId, setTraceId] = useDashboardViewState(scope, 'trace', null);
  const [nodeId, setNodeId] = useDashboardViewState(scope, 'node', null);
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0),
    [indexState, setIndexState] = useState(null),
    [detailState, setDetailState] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const host = useRef(null);
  const [compact, setCompact] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const selectNode = (id) => {
    setNodeId(id);
    if (compact) setDetailOpen(true);
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width <= 1150));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const cache = useRef(new Map());
  useEffect(() => {
    if (demo) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 15000);
    return () => clearInterval(timer);
  }, [demo]);
  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController(),
      key = `index:${projectId}:${workflow}:${rangeQuery}`;
    setIndexState({ key, data: cache.current.get(key), loading: true });
    fetch(
      `/api/dashboard/projects/${encodeURIComponent(projectId)}/change-traces?workflow=${workflow}${rangeQuery}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(t('Change 链路读取失败'));
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          cache.current.set(key, data);
          setIndexState({ key, data });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setIndexState({ key, data: cache.current.get(key), error: error.message });
      });
    return () => controller.abort();
  }, [projectId, demo, workflow, refreshToken, tick, rangeQuery]);
  const indexKey = `index:${projectId}:${workflow}:${rangeQuery}`;
  const currentIndex = indexState?.key === indexKey ? indexState : null;
  const index = demo ? DEMO_CHANGE_TRACE_INDEX : currentIndex?.data;
  const traces = (index?.traces ?? []).filter(
    (trace) =>
      (workflow === 'all' || trace.workflow === workflow) &&
      inObservabilityRange(trace.startedAt, timeRange),
  );
  const changes = [...new Set(traces.map((trace) => `${trace.workflow}:${trace.change}`))];
  const visible = traces.filter(
    (trace) =>
      (change === 'all' || `${trace.workflow}:${trace.change}` === change) &&
      `${trace.change} ${trace.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const activeId = visible.some((trace) => trace.traceId === traceId)
    ? traceId
    : (visible.find((item) => item.kind === 'workflow') ?? visible[0])?.traceId;
  useEffect(() => {
    if (!traceId && activeId) setTraceId(activeId);
  }, [activeId, traceId, setTraceId]);
  useEffect(() => {
    if (demo || !activeId) return undefined;
    const controller = new AbortController(),
      key = `trace:${projectId}:${activeId}`;
    setDetailState({ key, data: cache.current.get(key), loading: true });
    fetch(
      `/api/dashboard/projects/${encodeURIComponent(projectId)}/change-trace?traceId=${encodeURIComponent(activeId)}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(t('执行链路详情读取失败'));
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          cache.current.set(key, data);
          setDetailState({ key, data });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDetailState({ key, data: cache.current.get(key), error: error.message });
      });
    return () => controller.abort();
  }, [projectId, demo, activeId, refreshToken, tick]);
  const detailKey = `trace:${projectId}:${activeId}`;
  const currentDetail = detailState?.key === detailKey ? detailState : null;
  const trace = demo ? DEMO_CHANGE_TRACES[activeId] : currentDetail?.data;
  const nodes = trace?.nodes ?? [];
  const selected =
    nodes.find((node) => node.spanId === nodeId) ??
    nodes.find((node) => !node.parentSpanId) ??
    nodes[0];
  const rows = useMemo(() => treeRows(nodes, collapsed), [nodes, collapsed]);
  const now = Date.parse(trace?.observedAt) || Date.now();
  const start = Math.min(
    ...nodes.map((node) => Date.parse(node.startedAt)).filter(Number.isFinite),
  );
  const end = Math.max(
    ...nodes
      .map((node) =>
        node.startedAt
          ? node.endedAt
            ? Date.parse(node.endedAt)
            : ['running', 'waiting'].includes(node.status)
              ? now
              : Date.parse(node.startedAt)
          : NaN,
      )
      .filter(Number.isFinite),
  );
  const range = Math.max(1, end - start);
  const error = currentIndex?.error ?? currentDetail?.error;
  const cards = trace
    ? [
        [
          t('已观测执行时长'),
          duration(trace.observedWorkMs),
          t('动作从领取到结果记录的时长；并行区间合并，显式等待单独统计，不代表纯模型计算时间。'),
        ],
        [t('等待时长'), duration(trace.waitMs), t('仅统计有起止记录的用户确认和证据等待。')],
        [
          t('动作首轮成功率'),
          trace.firstPassRate == null ? '—' : `${number(trace.firstPassRate * 100)}%`,
          t('首轮成功率仅统计成功或失败的已结束动作，等待、取消和未知状态不计入分母。'),
        ],
        [
          t('重试次数'),
          number(trace.retries),
          t('按同一动作的执行尝试统计，历史缺失的尝试不补造。'),
        ],
      ]
    : [];
  const details =
    selected && trace ? (
      <aside
        key={selected.spanId}
        className="change-trace-inspector"
        aria-label={t('链路节点详情')}
      >
        <header>
          <span>{kindLabel(selected.kind)}</span>
          <h3>{nodeName(selected)}</h3>
          <Tag
            color={
              selected.status === 'failed'
                ? 'error'
                : selected.status === 'succeeded'
                  ? 'success'
                  : selected.status === 'running'
                    ? 'processing'
                    : 'default'
            }
          >
            {statusLabel(selected.status)}
          </Tag>
        </header>
        <Descriptions
          column={1}
          layout="horizontal"
          size="small"
          items={[
            { key: 'start', label: t('开始时间'), children: timestamp(selected.startedAt) },
            {
              key: 'end',
              label: t('结束时间'),
              children: selected.endedAt
                ? timestamp(selected.endedAt)
                : selected.startedAt && ['running', 'waiting'].includes(selected.status)
                  ? t('进行中')
                  : '—',
            },
            { key: 'time', label: t('耗时'), children: duration(elapsed(selected, now)) },
            ...(selected.attempt
              ? [{ key: 'attempt', label: t('执行尝试'), children: selected.attempt }]
              : []),
            ...(selected.attributes?.executor
              ? [
                  {
                    key: 'executor',
                    label: t('执行者'),
                    children: selected.attributes.executor,
                  },
                ]
              : []),
            {
              key: 'input',
              label: t('输入字段'),
              children: selected.attributes?.inputFields?.join(', ') || '—',
            },
            ...(selected.attributes?.decision
              ? [
                  {
                    key: 'decision',
                    label: t('用户决定'),
                    children: String(selected.attributes.decision),
                  },
                ]
              : []),
            {
              key: 'output',
              label: t('输出字段'),
              children: selected.attributes?.outputFields?.join(', ') || '—',
            },
          ]}
        />
        {selected.summary && (
          <section>
            <h4>{t('结果摘要')}</h4>
            <p>{t(selected.summary)}</p>
          </section>
        )}
        {selected.attributes?.artifacts?.length > 0 && (
          <section>
            <h4>{t('相关产物')}</h4>
            {selected.attributes.artifacts.map((uri) => (
              <code key={uri}>{uri}</code>
            ))}
          </section>
        )}
        {selected.attributes?.childRunIds?.length > 0 && (
          <section>
            <h4>{t('子运行')}</h4>
            {selected.attributes.childRunIds.map((id) => {
              const linked = traces.find((item) => item.runId === id && item.kind === 'workflow');
              return linked ? (
                <Button
                  key={id}
                  type="link"
                  onClick={() => {
                    setWorkflow(linked.workflow);
                    setChange(`${linked.workflow}:${linked.change}`);
                    setQuery('');
                    setTraceId(linked.traceId);
                    setNodeId(null);
                    setDetailOpen(false);
                  }}
                >
                  {id}
                </Button>
              ) : (
                <code key={id}>
                  {id} · {t('当前样本无子运行详情')}
                </code>
              );
            })}
          </section>
        )}
        <p className="change-trace-privacy">
          {t('默认保存字段摘要与脱敏结果，不记录原始输入输出。')}
        </p>
      </aside>
    ) : null;
  return (
    <section ref={host} className="change-trace-panel" aria-label={t('Change 链路')}>
      <div className="change-trace-toolbar">
        <Select
          aria-label={t('链路工作流')}
          value={workflow}
          onChange={(value) => {
            setWorkflow(value);
            setChange('all');
            setTraceId(null);
            setNodeId(null);
          }}
          options={[
            { value: 'all', label: t('全部工作流') },
            { value: 'native', label: 'Native' },
            { value: 'classic', label: 'Classic' },
          ]}
        />
        <Select
          aria-label={t('选择 Change')}
          value={change}
          onChange={(value) => {
            setChange(value);
            setTraceId(null);
            setNodeId(null);
          }}
          showSearch
          optionFilterProp="label"
          options={[
            { value: 'all', label: t('全部 Change') },
            ...changes.map((key) => ({
              value: key,
              label: `${key.slice(key.indexOf(':') + 1)} · ${key.startsWith('native:') ? 'Native' : 'Classic'}`,
            })),
          ]}
        />
        <Input
          aria-label={t('搜索执行链路')}
          prefix={<SearchOutlined />}
          placeholder={t('搜索 Change 或执行名称')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        <div className="change-trace-refresh">
          <span className={demo ? '' : 'change-trace-sync'}>
            {demo ? t('演示数据') : t('每 15 秒同步')}
          </span>
          <Button
            icon={<ReloadOutlined />}
            loading={!demo && Boolean(currentIndex?.loading || currentDetail?.loading)}
            onClick={() => setTick((value) => value + 1)}
          >
            {t('刷新链路')}
          </Button>
        </div>
      </div>
      {error && (
        <Alert
          type="warning"
          showIcon
          title={t(index || trace ? '最新数据同步失败，当前显示缓存' : 'Change 链路读取失败')}
          description={error}
          action={<Button onClick={() => setTick((value) => value + 1)}>{t('重试')}</Button>}
        />
      )}
      {(index?.truncated || index?.unreadable > 0) && (
        <Alert type="info" showIcon title={t('部分链路记录不可用或已截断，当前仅展示可读样本。')} />
      )}
      {!index && currentIndex?.loading ? (
        <Skeleton active />
      ) : !traces.length ? (
        <Empty
          description={t('尚无 Change 链路；执行 Native 或 Classic 后，这里会显示已采集的记录。')}
        />
      ) : (
        <div className="change-trace-layout">
          <aside className="change-trace-list" aria-label={t('Change 执行记录')}>
            <header>
              <h4>{t('执行记录')}</h4>
              <span>{visible.length}</span>
            </header>
            {visible.map((item) => (
              <button
                type="button"
                key={item.traceId}
                className={item.traceId === activeId ? 'is-selected' : ''}
                aria-pressed={item.traceId === activeId}
                onClick={() => {
                  setTraceId(item.traceId);
                  setNodeId(null);
                  setCollapsed(new Set());
                }}
              >
                <span className="change-trace-record-meta">
                  <span>{item.workflow === 'native' ? 'Native' : 'Classic'}</span>
                  <span className={`trace-status is-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </span>
                <strong>{item.change}</strong>
                <span>
                  {kindLabel(item.kind)} · {t(item.name)}
                </span>
                <small className="change-trace-record-time">
                  {item.snapshot ? (
                    t('历史快照 · 耗时未知')
                  ) : (
                    <>
                      <Tooltip title={timestamp(item.startedAt ?? item.updatedAt)}>
                        <time dateTime={item.startedAt ?? item.updatedAt}>
                          {recordTime(item.startedAt ?? item.updatedAt)}
                        </time>
                      </Tooltip>
                      <span>
                        <ClockCircleOutlined /> {duration(item.observedWorkMs)}
                      </span>
                    </>
                  )}
                </small>
              </button>
            ))}
            {!visible.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('没有符合筛选条件的链路')}
              />
            )}
          </aside>
          <main className="change-trace-main">
            {!trace ? (
              currentDetail?.loading ? (
                <Skeleton active />
              ) : (
                <Empty description={t('选择一条执行记录查看链路')} />
              )
            ) : (
              <>
                <section className="change-trace-overview" key={activeId}>
                  <div className="change-trace-heading">
                    <div>
                      <span>
                        {trace.workflow === 'native' ? 'Native' : 'Classic'} ·{' '}
                        {kindLabel(trace.kind)}
                      </span>
                      <h3>{trace.change}</h3>
                    </div>
                    <Tag
                      icon={
                        trace.status === 'succeeded' ? (
                          <CheckCircleOutlined />
                        ) : (
                          <ClockCircleOutlined />
                        )
                      }
                      color={
                        trace.status === 'failed'
                          ? 'error'
                          : trace.status === 'succeeded'
                            ? 'success'
                            : 'default'
                      }
                    >
                      {statusLabel(trace.status)}
                    </Tag>
                  </div>
                  {trace.snapshot && (
                    <Alert
                      type="info"
                      showIcon
                      title={t(
                        '历史记录仅有状态快照，没有完整计时；以下保留结构与状态，耗时显示为未知。',
                      )}
                    />
                  )}
                  {!trace.snapshot && trace.unknownTiming > 0 && (
                    <Alert
                      type="info"
                      showIcon
                      title={t('部分节点缺少起止时间，时长统计仅包含已观测的区间。')}
                    />
                  )}
                  <dl className="change-trace-metrics">
                    {cards.map(([label, value, help]) => (
                      <div key={label}>
                        <dt>
                          <Tooltip title={help}>
                            <span tabIndex={0}>
                              {label} <InfoCircleOutlined />
                            </span>
                          </Tooltip>
                        </dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="change-trace-waterfall-card" aria-label={t('执行瀑布图')}>
                  <header>
                    <h4>{t('执行链路')}</h4>
                    <span>{t('{0} 个节点', [nodes.length])}</span>
                  </header>
                  <div
                    className="change-trace-waterfall"
                    tabIndex={0}
                    aria-label={t('可横向滚动的链路时间轴')}
                  >
                    <div className="change-trace-axis">
                      <span>{t('节点与状态')}</span>
                      <div>
                        <span>0</span>
                        {Number.isFinite(start) && <span>{duration(range / 2)}</span>}
                        <span>{Number.isFinite(start) ? duration(range) : t('耗时未知')}</span>
                      </div>
                      <span>{t('耗时')}</span>
                    </div>
                    <div role="list" aria-label={t('链路节点')} key={activeId}>
                      {rows.map(({ node, depth, hasChildren }, rowIndex) => {
                        const offset =
                          Number.isFinite(start) && node.startedAt
                            ? ((Date.parse(node.startedAt) - start) / range) * 100
                            : 0;
                        const width =
                          elapsed(node, now) == null
                            ? 0
                            : Math.max(0.6, (elapsed(node, now) / range) * 100);
                        return (
                          <div
                            role="listitem"
                            className={`change-trace-row ${selected?.spanId === node.spanId ? 'is-selected' : ''}`}
                            key={node.spanId}
                            style={{
                              '--trace-order': Math.min(rowIndex, 10),
                              '--trace-depth': Math.min(depth, 4),
                            }}
                          >
                            <div
                              className={`change-trace-node-label${depth ? ' has-depth' : ''}`}
                              style={{ paddingLeft: Math.min(depth, 4) * 12 }}
                            >
                              {hasChildren ? (
                                <button
                                  type="button"
                                  className="change-trace-expander"
                                  aria-label={t(
                                    collapsed.has(node.spanId) ? '展开节点 {0}' : '折叠节点 {0}',
                                    [nodeName(node)],
                                  )}
                                  aria-expanded={!collapsed.has(node.spanId)}
                                  onClick={() =>
                                    setCollapsed((previous) => {
                                      const next = new Set(previous);
                                      if (next.has(node.spanId)) next.delete(node.spanId);
                                      else next.add(node.spanId);
                                      return next;
                                    })
                                  }
                                >
                                  {collapsed.has(node.spanId) ? (
                                    <RightOutlined />
                                  ) : (
                                    <DownOutlined />
                                  )}
                                </button>
                              ) : (
                                <span className="change-trace-expander" />
                              )}
                              <button
                                type="button"
                                className="change-trace-node-select"
                                aria-label={t('查看节点 {0}', [nodeName(node)])}
                                aria-pressed={selected?.spanId === node.spanId}
                                aria-description={[
                                  statusLabel(node.status),
                                  node.attempt ? t('第 {0} 次', [node.attempt]) : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                                onClick={() => selectNode(node.spanId)}
                              >
                                <Tooltip title={nodeName(node)}>
                                  <strong>{nodeName(node)}</strong>
                                </Tooltip>
                                <span className={`trace-status is-${node.status}`}>
                                  {statusLabel(node.status)}
                                  {node.attempt > 1 ? ` · ${t('第 {0} 次', [node.attempt])}` : ''}
                                </span>
                              </button>
                            </div>
                            <button
                              type="button"
                              className="change-trace-bar-track"
                              aria-label={t('查看节点时间 {0}', [nodeName(node)])}
                              onClick={() => selectNode(node.spanId)}
                            >
                              {node.startedAt ? (
                                <span
                                  className={`change-trace-bar is-${node.status} kind-${node.kind} ${node.timing === 'range' ? 'is-range' : ''}`}
                                  style={{
                                    left: `${Math.max(0, offset)}%`,
                                    width: `${Math.min(100 - offset, width)}%`,
                                  }}
                                />
                              ) : (
                                <span className="change-trace-no-time">{t('耗时未知')}</span>
                              )}
                            </button>
                            <span className="change-trace-row-duration">
                              {duration(elapsed(node, now))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <footer>
                    <div className="change-trace-legend" aria-label={t('时间轴图例')}>
                      <span>
                        <i />
                        {t('动作')}
                      </span>
                      <span>
                        <i className="is-retrieval" />
                        {t('上下文检索')}
                      </span>
                      <span>
                        <i className="is-wait" />
                        {t('等待')}
                      </span>
                      <span>
                        <i className="is-failed" />
                        {t('失败')}
                      </span>
                    </div>
                    <span>{t('阶段条显示子节点的时间范围；展开可查看真实动作、等待和重试。')}</span>
                    {trace.truncated ? ` ${t('记录已截断')}` : ''}
                  </footer>
                </section>
              </>
            )}
          </main>
          {!compact && details}
        </div>
      )}
      <DashboardModal
        open={compact && detailOpen && Boolean(selected)}
        title={t('链路节点详情')}
        ariaLabel={t('链路节点详情')}
        onClose={() => setDetailOpen(false)}
        width={640}
        showCloseButton
        className="change-trace-detail-modal"
        footer={<Button onClick={() => setDetailOpen(false)}>{t('关闭详情')}</Button>}
      >
        {details}
      </DashboardModal>
      <footer className="change-trace-retention">
        {t(
          '按执行开始时间筛选，计时记录保留最近 7 天；没有开始时间的历史快照不参与时间筛选。未采集的模型、工具、Token 与费用保持未知。',
        )}
      </footer>
    </section>
  );
}
