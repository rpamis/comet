import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Collapse, Empty, Skeleton, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CopyOutlined,
  FlagOutlined,
  PauseCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { DashboardWorkspaceRegion } from './workspace-layout.jsx';
import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
import {
  WorkflowSectionHead as SectionHead,
  WorkflowSummaryCard as SummaryCard,
  WorkflowSideFact as SideFact,
  WorkflowPill as Pill,
} from './workflow-presentation.jsx';

const STATUS_LABELS = {
  running: '运行中',
  completed: '已完成',
  blocked: '已阻塞',
  paused: '已暂停',
  failed: '失败',
  invalid: '状态无效',
};

async function fetchAny(projectId, endpoint, params, signal) {
  const response = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/${endpoint}?${new URLSearchParams(params)}`,
    { signal },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404 ? '记录已不存在，请刷新列表。' : 'Comet Any 状态读取失败，请重试。',
    );
  return response.json();
}

export function AnyWorkflowPanel({
  projectId,
  query,
  refreshToken,
  git,
  onPreview,
  onCopyName,
  demo = false,
}) {
  const [selectedMetric, setSelectedMetric] = useState(0);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('active');
  const [pageNumber, setPageNumber] = useState(0);
  const [page, setPage] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const request = demo
      ? Promise.resolve({ items: [], total: 0, nextCursor: null, diagnostics: [] })
      : fetchAny(
          projectId,
          'any-workflows',
          { status, q: query, limit: '10', cursor: String(pageNumber * 10) },
          controller.signal,
        );
    request
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.items.length === 0 && pageNumber > 0) {
          setPageNumber(0);
          return;
        }
        setPage(next);
        setSelected((current) =>
          next.items.some((item) => item.locator === current)
            ? current
            : (next.items[0]?.locator ?? null),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setPage(null);
          setSelected(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, status, query, pageNumber, refreshToken, retry, demo]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail((current) => (current?.locator === selected ? current : null));
    setDetailError(null);
    setDetailLoading(Boolean(selected));
    if (selected && !demo) {
      fetchAny(projectId, 'any-workflow', { locator: selected }, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setDetail(next);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setDetailError(reason.message);
            setDetail(null);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false);
        });
    }
    return () => controller.abort();
  }, [projectId, selected, refreshToken, retry, demo]);

  const reset = (setter, value) => {
    setter(value);
    setPageNumber(0);
    setSelected(null);
    setDetail(null);
    setPage(null);
  };
  const current = detail ?? page?.items.find((item) => item.locator === selected);
  const summary = page?.summary;
  const metrics = [
    ['活跃运行', summary?.active ?? 0, '当前 Comet Any workflow', '未完成', FlagOutlined],
    ['已完成', summary?.completed ?? 0, '已记录完成的运行', '已完成', CheckCircleOutlined],
    ['已暂停', summary?.paused ?? 0, '状态文件中的暂停记录', '已记录', PauseCircleOutlined],
    [
      '失败或阻塞',
      summary?.attention ?? 0,
      '状态文件中的失败或阻塞',
      '需关注',
      SafetyCertificateOutlined,
    ],
    ['状态异常', summary?.invalid ?? 0, '无法读取或格式无效', '待检查', ApartmentOutlined],
  ];
  const suggestion =
    error ||
    detailError ||
    (current?.status === 'invalid'
      ? '状态文件不可读取，请检查详情中的诊断信息。'
      : detail?.blocker ||
        (current?.completed
          ? '当前运行已完成，可查看节点证据与产物。'
          : current?.currentNode
            ? '从当前节点 ' +
              current.currentNode +
              ' 继续；请在原 Skill 中执行，Dashboard 不推进工作流。'
            : '选择一个已初始化的 Skill 运行，查看节点、证据和产物。'));
  const tone = (value) =>
    ['blocked', 'failed', 'invalid'].includes(value)
      ? 'danger'
      : value === 'completed'
        ? 'ok'
        : value === 'paused'
          ? 'warn'
          : 'info';
  const pageTo = (number) => {
    setPageNumber(number);
    setSelected(null);
    setDetail(null);
    setPage(null);
  };
  const empty = !loading && !page?.items.length;
  return (
    <section
      className="any-workflow-panel mx-auto min-w-0 max-w-dashboard"
      aria-label="Comet Any 工作流"
    >
      <SectionHead
        title="项目概览"
        hint={
          'Comet Any 状态生成于 ' + (refreshToken ? new Date(refreshToken).toLocaleString() : '—')
        }
      />
      <section className="dashboard-priority-banner" role="status" aria-label="工作流建议">
        <div className="dashboard-priority-title">
          <BulbOutlined aria-hidden="true" />
          <span>下一步建议</span>
        </div>
        <p>{suggestion}</p>
      </section>
      <section
        className="dashboard-summary-strip dashboard-overview-summary-strip"
        aria-label="Comet Any 项目指标"
      >
        {metrics.map(([label, value, note, tag, Icon], index) => (
          <SummaryCard
            key={label}
            label={label}
            value={value}
            note={note}
            tag={tag}
            icon={Icon}
            tone={'dashboard-summary-tone-' + (index + 1)}
            selected={selectedMetric === index}
            onClick={() => setSelectedMetric(index)}
          />
        ))}
      </section>
      <SectionHead title="Comet Any 运行工作区" hint="查看生成 Skill 的节点、证据、阻塞与产物" />
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>}
        />
      )}
      {page?.diagnostics?.map((warning) => (
        <Alert key={warning} type="warning" title={warning} className="mb-3" />
      ))}
      <DashboardWorkspaceRegion
        stableFrame
        leftClassName="native-workspace-left"
        left={
          <aside className="native-changes-explorer flex min-h-0 flex-col rounded-lg border border-border bg-bg shadow-raised">
            <div className="native-changes-explorer-header flex flex-none items-center border-b border-border-soft">
              <h3 className="font-semibold">
                Runs Explorer{' '}
                <Badge count={page?.total ?? 0} showZero className="native-changes-count ml-2" />
              </h3>
            </div>
            <div className="native-changes-explorer-body flex min-h-0 flex-1 flex-col">
              <div
                className="native-changes-explorer-tabs mb-4 flex flex-none items-end gap-8 border-b border-border-soft"
                role="tablist"
                aria-label="运行范围"
              >
                {[
                  ['active', '活跃'],
                  ['completed', '已完成'],
                  ['all', '全部'],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={status === value}
                    key={value}
                    className={'native-change-tab ' + (status === value ? 'active' : '')}
                    onClick={() => reset(setStatus, value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="native-change-list min-h-0 flex-1 space-y-2 overflow-y-auto">
                {loading && !page ? (
                  <Skeleton active />
                ) : page?.items.length ? (
                  page.items.map((item) => {
                    const progress = detail?.locator === item.locator ? detail : item;
                    const percent = progress.totalNodes
                      ? Math.min(100, (progress.completedNodes / progress.totalNodes) * 100)
                      : null;
                    return (
                      <div
                        key={item.locator}
                        className={
                          'native-change-list-item ' + (item.locator === selected ? 'selected' : '')
                        }
                      >
                        <button
                          type="button"
                          className="native-change-row"
                          aria-pressed={item.locator === selected}
                          onClick={() => {
                            setSelected(item.locator);
                            setCopied(false);
                          }}
                        >
                          <div className="flex w-full items-center gap-2.5 text-left">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-semibold" title={item.name}>
                                {item.name}
                              </div>
                              <div className="mt-1 text-xs text-meta truncate">
                                {item.currentNode ?? '—'} ·{' '}
                                {STATUS_LABELS[item.status] ?? item.status}
                              </div>
                              <span className="dashboard-workspace-label mt-1 inline-flex max-w-full truncate">
                                {item.workspace.label}
                              </span>
                              {percent !== null && (
                                <div
                                  className={
                                    'native-change-progress mt-1 ' +
                                    (percent === 100 ? 'complete' : '')
                                  }
                                  role="progressbar"
                                  aria-label="节点完成进度"
                                  aria-valuenow={percent}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <span style={{ width: percent + '%' }} />
                                </div>
                              )}
                            </div>
                            <Pill tone={tone(item.status)}>
                              {STATUS_LABELS[item.status] ?? item.status}
                            </Pill>
                          </div>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-sm text-muted">
                    {query ? '没有匹配的运行记录' : '暂无工作流运行记录'}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-between gap-2">
                <Button
                  size="small"
                  disabled={loading || pageNumber === 0}
                  onClick={() => pageTo(pageNumber - 1)}
                >
                  上一页
                </Button>
                <Button
                  size="small"
                  disabled={loading || !page?.nextCursor}
                  onClick={() => pageTo(pageNumber + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </aside>
        }
        center={
          (detailLoading && !detail) || (loading && !page) ? (
            <section className="native-change-detail rounded-lg border border-border bg-bg p-5 shadow-raised">
              <Skeleton active paragraph={{ rows: 10 }} />
            </section>
          ) : detailError ? (
            <section className="native-change-detail rounded-lg border border-border bg-bg p-5 shadow-raised">
              <Alert
                type="error"
                title={detailError}
                action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>}
              />
            </section>
          ) : detail ? (
            <section className="native-change-detail min-w-0 rounded-lg border border-border bg-bg shadow-raised">
              <div className="flex items-start gap-4 border-b border-border-soft px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-base font-semibold" title={detail.name}>
                      {detail.name}
                    </h3>
                    <Tooltip title="复制工作流名称">
                      <Button
                        type="text"
                        size="small"
                        aria-label={copied ? '已复制工作流名称' : '复制工作流名称'}
                        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={() =>
                          onCopyName?.(detail.name)?.then((success) => setCopied(success === true))
                        }
                      />
                    </Tooltip>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-meta">
                    <span>comet-any</span>
                    <span>{detail.status === 'invalid' ? '状态无效' : 'state v1'}</span>
                    <span>只读观测</span>
                  </div>
                </div>
                <Pill tone={tone(detail.status)}>
                  {STATUS_LABELS[detail.status] ?? detail.status}
                </Pill>
              </div>
              <div className="space-y-5 p-5">
                <article>
                  <div className="mb-4 flex items-center gap-2">
                    <h4 className="text-sm font-semibold">工作流节点</h4>
                    <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
                      {detail.currentNode
                        ? '当前 ' + detail.currentNode
                        : detail.completed
                          ? '已完成'
                          : '状态未知'}
                    </span>
                  </div>
                  {detail.nodes.length ? (
                    <div className="overflow-x-auto">
                      <div
                        style={{
                          minWidth: detail.nodes.length > 4 ? detail.nodes.length * 85 : undefined,
                        }}
                      >
                        <WorkflowPhaseTrack
                          phases={detail.nodes.map((node) => [node.id, node.label])}
                          phaseStates={Object.fromEntries(
                            detail.nodes.map((node) => [node.id, node.status]),
                          )}
                          currentIndex={detail.nodes.findIndex((node) => node.status === 'current')}
                          currentPhaseRunning={false}
                          ariaLabel="Comet Any 工作流节点"
                        />
                      </div>
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的节点" />
                  )}
                  <p className="mt-4 text-center text-xs text-meta">
                    {detail.completedNodes} / {detail.totalNodes ?? '?'} 节点
                  </p>
                  {detail.goal && (
                    <p className="mt-3 text-sm leading-relaxed text-fg-2">{detail.goal}</p>
                  )}
                </article>
                <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
                  <div className="mb-4 flex items-baseline justify-between">
                    <h4 className="text-sm font-semibold tracking-tight">关键产物</h4>
                    <span className="font-mono text-[12px] text-meta">
                      {detail.artifacts.filter((artifact) => artifact.status === 'present').length}/
                      {detail.artifacts.length}
                    </span>
                  </div>
                  <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-muted">
                    Comet Any
                  </div>
                  {detail.artifacts.map((artifact, index) => (
                    <div key={index}>
                      <button
                        type="button"
                        className={
                          'group grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left ' +
                          (artifact.content !== undefined
                            ? 'hover:bg-surface cursor-pointer'
                            : 'cursor-default opacity-60')
                        }
                        disabled={artifact.content === undefined}
                        title={artifact.path}
                        onClick={() =>
                          onPreview?.({
                            key: artifact.path,
                            name: artifact.path,
                            preview: {
                              key: artifact.path,
                              label: artifact.node,
                              path: artifact.path,
                              exists: true,
                              content: artifact.content,
                            },
                          })
                        }
                      >
                        <span
                          className={
                            'h-2 w-2 rounded-full ' +
                            (artifact.status === 'present' ? 'bg-accent' : 'border border-border')
                          }
                        />
                        <span className="truncate text-[13px] text-fg">{artifact.path}</span>
                        <span className="text-right text-[12px] text-muted">
                          {artifact.status === 'present'
                            ? artifact.node
                            : artifact.status === 'missing'
                              ? '未生成'
                              : '不可读取'}
                        </span>
                      </button>
                      {artifact.diagnostic && (
                        <p className="mt-1 break-words text-xs text-warn">{artifact.diagnostic}</p>
                      )}
                    </div>
                  ))}
                  {!detail.artifacts.length && (
                    <p className="py-6 text-center text-sm text-muted">暂无可预览产物</p>
                  )}
                </article>
                <div className="grid gap-4 lg:grid-cols-2">
                  <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
                    <h4 className="mb-4 text-sm font-semibold">运行信息</h4>
                    <dl className="space-y-3 text-sm">
                      <SideFact label="工作区" value={detail.workspace.label} />
                      <SideFact label="当前节点" value={detail.currentNode ?? '—'} />
                      <SideFact label="已完成节点" value={String(detail.completedNodes)} />
                    </dl>
                    <div className="mt-4 rounded-lg bg-surface-warm p-3 text-xs leading-relaxed text-muted break-all">
                      状态文件
                      <br />
                      {detail.relativePath}
                    </div>
                  </article>
                  <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
                    <h4 className="mb-4 text-sm font-semibold">证据与历史</h4>
                    <Collapse
                      items={[
                        {
                          key: 'evidence',
                          label: '已记录证据',
                          children: (
                            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
                              {JSON.stringify(detail.evidence, null, 2)}
                            </pre>
                          ),
                        },
                        {
                          key: 'history',
                          label: '最近运行历史',
                          children: (
                            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
                              {JSON.stringify(detail.history, null, 2)}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  </article>
                </div>
                {detail.references.length > 0 && (
                  <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
                    <h4 className="mb-3 text-sm font-semibold">流程定义</h4>
                    {detail.references.map((reference) => (
                      <p className="break-all text-xs text-muted" key={reference.path}>
                        {reference.path}
                      </p>
                    ))}
                  </article>
                )}
                <Collapse
                  items={[
                    {
                      key: 'diagnostics',
                      label:
                        '观测边界与诊断' +
                        (detail.diagnostics.length ? ' · ' + detail.diagnostics.length : ''),
                      children: detail.diagnostics.map((warning) => (
                        <Alert key={warning} className="mb-3" type="warning" title={warning} />
                      )),
                    },
                  ]}
                />
              </div>
            </section>
          ) : (
            <section className="native-change-detail native-change-detail-empty min-w-0 rounded-lg border border-border bg-bg shadow-raised">
              <div className="dashboard-workspace-empty-detail text-center">
                <span className="native-workspace-empty-icon" aria-hidden="true">
                  <FlagOutlined />
                </span>
                <h3 className="mt-5 text-lg font-semibold">
                  {empty ? '还没有匹配的 Skill 运行' : '选择一条运行记录'}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                  生成的 Skill 初始化运行状态后，节点、证据与产物会集中显示在这里。
                </p>
              </div>
            </section>
          )
        }
        right={
          detail ? (
            <aside className="space-y-5">
              <section className="rounded-lg bg-bg p-5 shadow-raised">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">运行状态</h3>
                  <Pill tone={tone(detail.status)}>
                    {STATUS_LABELS[detail.status] ?? detail.status}
                  </Pill>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <SideFact label="状态来源" value="已持久化 JSON" />
                  <SideFact label="当前节点" value={detail.currentNode ?? '—'} />
                  <SideFact label="实时执行者" value="未记录" />
                  <SideFact
                    label="更新时间"
                    value={detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : '未知'}
                  />
                </dl>
              </section>
              <section className="rounded-lg bg-bg p-5 shadow-raised">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">当前阻塞</h3>
                  <Pill tone={['blocked', 'failed'].includes(detail.status) ? 'danger' : 'neutral'}>
                    {['blocked', 'failed'].includes(detail.status) ? '已记录' : '未记录'}
                  </Pill>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  {detail.blocker ||
                    (['blocked', 'failed'].includes(detail.status)
                      ? '状态标记为失败或阻塞，但未保存原因。'
                      : '没有已持久化的阻塞原因；终端中的临时检查失败不在此列。')}
                </p>
              </section>
              {git && (
                <section className="rounded-lg bg-bg p-5 shadow-raised">
                  <h3 className="text-sm font-semibold">Git 摘要</h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    <SideFact label="项目分支" value={git.branch ?? '—'} />
                    <SideFact label="HEAD" value={git.head?.slice(0, 12) ?? '—'} />
                    <SideFact label="未提交文件" value={String(git.dirtyFiles ?? 0) + ' 个'} />
                  </dl>
                  {!detail.workspace.current && (
                    <p className="mt-3 text-xs text-muted">
                      当前选择的是其他 worktree；此处 Git 摘要属于顶部选定项目。
                    </p>
                  )}
                </section>
              )}
            </aside>
          ) : (
            <aside className="dashboard-workspace-side-empty">
              <div>
                <span className="native-workspace-empty-icon" aria-hidden="true">
                  <FlagOutlined />
                </span>
                <h3>暂无运行数据</h3>
                <p>选择一条运行记录后，这里会显示运行状态、阻塞信息和 Git 摘要。</p>
              </div>
            </aside>
          )
        }
      />
    </section>
  );
}
