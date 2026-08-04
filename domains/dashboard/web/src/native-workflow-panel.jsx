import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CopyOutlined,
  FlagOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Spin, Tooltip } from 'antd';
import { useAnimatedNumber } from './use-animated-number.js';
import { DashboardWorkspaceRegion } from './workspace-layout.jsx';

const PHASES = [
  ['shape', 'Shape'],
  ['build', 'Build'],
  ['verify', 'Verify'],
  ['archive', 'Archive'],
];

const PHASE_LABELS = Object.fromEntries(PHASES);

const FRESHNESS_LABELS = {
  missing: '尚无验证',
  invalid: '验证无效',
  stale: '验证已过期',
  complete: '验证完整',
  partial: '部分验证',
  unknown: '状态未知',
};

const DISPOSITION_LABELS = {
  continue: '可继续',
  'await-user': '等待用户',
  blocked: '已阻塞',
  done: '已完成',
};

const ACTION_LABELS = {
  'work-phase': '继续当前阶段',
  'advance-phase': '推进阶段',
  repair: '修复后重试',
  archive: '准备归档',
  none: '无需动作',
};

const CONFLICT_LABELS = {
  'definite-conflict': '明确冲突',
  'possible-overlap': '可能重叠',
};

const NATIVE_CHANGE_PAGE_SIZE = 5;

function nativeChangeAcceptanceProgress(change) {
  const acceptance = change.acceptance;
  if (!acceptance?.total) return null;

  const covered = acceptance.evidenced + acceptance.skipped;
  return {
    covered,
    total: acceptance.total,
    percent: Math.round((covered / acceptance.total) * 100),
    complete: acceptance.missing === 0,
  };
}

export function NativeWorkflowPanel({
  native,
  git,
  query,
  tab = 'active',
  onTab,
  pagedChanges = null,
  total,
  hasMore = false,
  pageLoading = false,
  onLoadMore,
  selectedDetail = null,
  detailLoading = false,
  detailError = null,
  onSelect,
  onRetryDetail,
  onPreview,
  onCopyChangeName,
}) {
  const serverPaged = Array.isArray(pagedChanges);
  const listRef = useRef(null);
  const loadMoreRef = useRef(null);
  const [visibleChangeCount, setVisibleChangeCount] = useState(NATIVE_CHANGE_PAGE_SIZE);
  const normalizedQuery = query.trim().toLowerCase();
  const sourceChanges = useMemo(() => {
    const source = serverPaged ? pagedChanges : (native?.changes ?? []);
    if (serverPaged) return source;
    return source.filter((change) => {
      const matchesTab =
        tab === 'all' || (tab === 'active' && change.status === 'active') || change.status === tab;
      const matchesQuery = !normalizedQuery || change.name.toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesQuery;
    });
  }, [native, normalizedQuery, pagedChanges, serverPaged, tab]);
  const [selectedKey, setSelectedKey] = useState(null);

  const changeKey = useCallback(
    (change) => `${change.status}:${change.archiveName ?? ''}:${change.name}`,
    [],
  );

  useEffect(() => {
    setVisibleChangeCount(NATIVE_CHANGE_PAGE_SIZE);
  }, [normalizedQuery, serverPaged, tab]);

  const loadMoreChanges = useCallback(() => {
    if (serverPaged) {
      if (!pageLoading && hasMore) onLoadMore?.();
      return;
    }
    setVisibleChangeCount((current) =>
      Math.min(current + NATIVE_CHANGE_PAGE_SIZE, sourceChanges.length),
    );
  }, [hasMore, onLoadMore, pageLoading, serverPaged, sourceChanges.length]);
  const visibleChanges = serverPaged ? sourceChanges : sourceChanges.slice(0, visibleChangeCount);
  const hasMoreChanges = serverPaged ? hasMore : visibleChanges.length < sourceChanges.length;

  useEffect(() => {
    if (!serverPaged || !hasMoreChanges) return undefined;
    const target = loadMoreRef.current;
    if (!target) return undefined;

    const scrollContainer = listRef.current?.closest('.dashboard-content-shell');
    const root =
      scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight
        ? scrollContainer
        : null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !pageLoading) loadMoreChanges();
      },
      { root, rootMargin: '0px 0px 32px' },
    );
    observer.observe(target);
    const frame = window.requestAnimationFrame(() => {
      const targetRect = target.getBoundingClientRect();
      const rootRect = root?.getBoundingClientRect();
      const viewportTop = rootRect?.top ?? 0;
      const viewportBottom = rootRect?.bottom ?? window.innerHeight;
      if (
        targetRect.top <= viewportBottom + 32 &&
        targetRect.bottom >= viewportTop &&
        !pageLoading
      ) {
        loadMoreChanges();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hasMoreChanges, loadMoreChanges, pageLoading, serverPaged]);

  useEffect(() => {
    const element = listRef.current;
    if (!element || !hasMoreChanges) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const fitsInList = element.scrollHeight <= element.clientHeight + 1;
      const listBottom = element.getBoundingClientRect().bottom;
      const fitsInViewport = listBottom <= window.innerHeight + 32;
      if (fitsInList && (window.innerWidth >= 1024 || fitsInViewport)) loadMoreChanges();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasMoreChanges, loadMoreChanges, visibleChangeCount]);

  useEffect(() => {
    if (!hasMoreChanges || window.innerWidth >= 1024) return undefined;

    const handleWindowScroll = () => {
      const element = listRef.current;
      if (!element || pageLoading) return;
      const { bottom } = element.getBoundingClientRect();
      if (bottom <= window.innerHeight + 32) loadMoreChanges();
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, [hasMoreChanges, loadMoreChanges, pageLoading]);

  const handleListScroll = useCallback(
    (event) => {
      if (!hasMoreChanges || pageLoading) return;
      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
      if (scrollTop + clientHeight >= scrollHeight - 32) loadMoreChanges();
    },
    [hasMoreChanges, loadMoreChanges, pageLoading],
  );

  useEffect(() => {
    setSelectedKey((current) => {
      if (visibleChanges.some((change) => changeKey(change) === current)) return current;
      return visibleChanges[0] ? changeKey(visibleChanges[0]) : null;
    });
  }, [changeKey, visibleChanges]);

  const selectedSummary =
    visibleChanges.find((change) => changeKey(change) === selectedKey) ?? visibleChanges[0] ?? null;
  useEffect(() => {
    if (selectedSummary) onSelect?.(selectedSummary);
  }, [onSelect, selectedSummary]);
  const selected = serverPaged ? selectedDetail : selectedSummary;
  const hasNativeChanges = Boolean(native && native.totalChangeCount > 0);

  return (
    <div className="mx-auto min-w-0 max-w-dashboard">
      <SectionHead
        title="项目概览"
        hint={
          native
            ? `Native 状态生成于 ${formatTimestamp(native.generatedAt)}`
            : '当前项目尚无 Native 状态'
        }
      />
      <NativeWorkflowSuggestion change={selected ?? selectedSummary} />
      <NativeSummaryCards native={native} loadedChanges={visibleChanges} />
      <SectionHead title="Native 变更工作区" hint="查看轻量状态、验证结果与冲突摘要" />
      {!native || !hasNativeChanges ? (
        <EmptyState />
      ) : (
        <DashboardWorkspaceRegion
          stableFrame
          leftClassName="native-workspace-left"
          left={
            <NativeChangesExplorer
              changes={visibleChanges}
              total={serverPaged ? (total ?? sourceChanges.length) : sourceChanges.length}
              selectedName={selectedSummary?.name ?? null}
              tab={tab}
              onTab={onTab}
              onSelect={(change) => setSelectedKey(changeKey(change))}
              listRef={listRef}
              loadMoreRef={loadMoreRef}
              hasMore={hasMoreChanges}
              pageLoading={pageLoading}
              onScroll={handleListScroll}
            />
          }
          center={
            selected ? (
              <NativeChangeDetail
                change={selected}
                onPreview={onPreview}
                onCopyChangeName={onCopyChangeName}
              />
            ) : selectedSummary && (detailLoading || !detailError) ? (
              <div className="native-change-detail dashboard-change-detail-loading min-w-0 rounded-lg border border-border bg-bg p-10 text-center text-sm text-muted shadow-raised">
                正在加载 Native 变更详情…
              </div>
            ) : detailError ? (
              <div className="native-change-detail dashboard-change-detail-loading min-w-0 rounded-lg border border-border bg-bg p-10 text-center text-sm text-danger shadow-raised">
                <p role="alert">Native 变更详情加载失败：{detailError.reason}</p>
                <Button className="mt-4" onClick={onRetryDetail}>
                  重新加载
                </Button>
              </div>
            ) : (
              <NativeWorkspaceEmptyState native={native} tab={tab} query={query} onTab={onTab} />
            )
          }
          right={selected ? <NativeSidePanel change={selected} git={git} /> : null}
        />
      )}
    </div>
  );
}

function NativeWorkspaceEmptyState({ native, tab, query, onTab }) {
  const hasArchivedChanges =
    (native?.archivedChangeCount ?? 0) > 0 ||
    (native?.changes ?? []).some((change) => change.status === 'archived');
  const showArchiveShortcut = tab === 'active' && !query.trim() && hasArchivedChanges;
  const title = showArchiveShortcut ? '当前没有活跃的 Native change' : '没有匹配的 Native change';
  const description = showArchiveShortcut
    ? '当前项目的 Native 工作已全部归档。你可以查看历史验证记录与变更范围。'
    : '调整搜索条件或切换筛选，即可继续查看项目中的 Native change。';

  return (
    <section className="native-workspace-empty flex min-h-[360px] items-center justify-center rounded-lg bg-bg p-8 text-center shadow-raised xl:col-span-1 2xl:col-span-2">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-softer text-xl text-accent">
          ◇
        </span>
        <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
        {showArchiveShortcut && (
          <Button className="mt-5" type="primary" onClick={() => onTab('archived')}>
            查看已归档变更
          </Button>
        )}
      </div>
    </section>
  );
}

function NativeWorkflowSuggestion({ change }) {
  return (
    <section className="dashboard-priority-banner" role="status" aria-label="工作流建议">
      <div className="dashboard-priority-title">
        <BulbOutlined aria-hidden="true" />
        <span>下一步建议</span>
      </div>
      <p>
        {change
          ? change.status === 'archived'
            ? '当前变更已经归档，可继续查看验证证据与历史进展。'
            : (change.progress?.nextAction ?? continuationLabel(change.continuation))
          : '当前没有可展示的 Native change。'}
      </p>
    </section>
  );
}

function SectionHead({ title, hint }) {
  return (
    <div className="mb-4 mt-6 flex flex-wrap items-baseline gap-3 first:mt-2">
      <h2 className="dashboard-section-heading text-[20px] font-semibold leading-[1.3] tracking-[-0.018em]">
        {title}
      </h2>
      <span className="dashboard-section-hint text-[13px] leading-5 text-muted">{hint}</span>
    </div>
  );
}

function NativeSummaryCards({ native, loadedChanges = [] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const active =
    native?.activeChangeCount ??
    loadedChanges.filter((change) => change.phase !== 'archive').length;
  const archiveReady = loadedChanges.filter((change) => change.archiveReady).length;
  const awaitingUser = loadedChanges.filter(
    (change) => change.continuation?.requiresUserDecision,
  ).length;
  const verificationAttention = loadedChanges.filter((change) =>
    ['invalid', 'stale', 'partial'].includes(change.verificationFreshness),
  ).length;
  const conflicts = native
    ? native.conflicts.definiteConflict + native.conflicts.possibleOverlap
    : 0;
  const cards = [
    ['活跃变更', active, '当前 Native workflow', active ? '进行中' : '清零', FlagOutlined],
    [
      '已加载可归档',
      archiveReady,
      '当前已加载结果',
      archiveReady ? '就绪' : '暂无',
      CheckCircleOutlined,
    ],
    [
      '已加载等待用户',
      awaitingUser,
      '当前已加载结果',
      awaitingUser ? '待确认' : '无需',
      UserOutlined,
    ],
    [
      '已加载验证需关注',
      verificationAttention,
      '当前已加载结果',
      verificationAttention ? '复核' : '健康',
      SafetyCertificateOutlined,
    ],
    ['关联冲突', conflicts, 'Native change 关系', conflicts ? '关注' : '无冲突', ApartmentOutlined],
  ];

  return (
    <section className="dashboard-summary-strip dashboard-overview-summary-strip">
      {cards.map(([label, value, note, tag, Icon], index) => (
        <NativeSummaryCard
          key={label}
          label={label}
          value={value}
          note={note}
          tag={tag}
          icon={Icon}
          tone={`dashboard-summary-tone-${index + 1}`}
          selected={selectedIndex === index}
          onClick={() => setSelectedIndex(index)}
        />
      ))}
    </section>
  );
}

function NativeSummaryCard({ label, value, note, tag, icon: Icon, tone, selected, onClick }) {
  // 进入页面或数值变化时，从 0 滚动到目标值；数值不变则保持，避免每次自动刷新都重滚。
  const animatedValue = useAnimatedNumber(value, 850, value);
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`dashboard-overview-summary-card dashboard-summary-card dashboard-summary-metric-cell ${tone} ${selected ? 'dashboard-summary-primary' : ''}`}
      onClick={onClick}
    >
      <div className="dashboard-summary-card-top">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="dashboard-summary-metric mt-1 text-[28px] font-semibold leading-none tabular-nums">
            {Math.round(animatedValue)}
          </div>
        </div>
        <span className="dashboard-summary-icon" aria-hidden="true">
          <Icon />
        </span>
      </div>
      <span className="dashboard-summary-status">{tag}</span>
      <div className="mt-2 truncate text-[11px] text-meta">{note}</div>
    </button>
  );
}

function NativeChangesExplorer({
  changes,
  total,
  selectedName,
  tab,
  onTab,
  onSelect,
  listRef,
  loadMoreRef,
  hasMore,
  pageLoading,
  onScroll,
}) {
  return (
    <aside className="native-changes-explorer flex min-h-0 flex-col rounded-lg border border-border bg-bg shadow-raised">
      <div className="native-changes-explorer-header flex flex-none items-center border-b border-border-soft">
        <h3 className="font-semibold">
          Changes Explorer <span className="native-changes-count">{total}</span>
        </h3>
      </div>
      <div className="native-changes-explorer-body flex min-h-0 flex-1 flex-col">
        <div className="native-changes-explorer-tabs mb-4 flex flex-none items-end gap-8 border-b border-border-soft">
          {[
            ['active', '活跃'],
            ['archived', '已归档'],
            ['all', '全部'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`native-change-tab ${tab === value ? 'active' : ''}`}
              onClick={() => onTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          ref={listRef}
          className="native-change-list min-h-0 flex-1 space-y-2 overflow-y-auto"
          onScroll={onScroll}
        >
          {changes.length === 0 ? (
            pageLoading ? (
              <div className="flex justify-center py-8">
                <Spin aria-label="正在加载 Native 变更列表" />
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted">
                {tab === 'active'
                  ? '暂无活跃变更'
                  : tab === 'archived'
                    ? '暂无已归档变更'
                    : '没有匹配的 Native change'}
              </div>
            )
          ) : (
            changes.map((change) => {
              const progress = nativeChangeAcceptanceProgress(change);
              return (
                <div
                  key={change.name}
                  className={`native-change-list-item ${change.name === selectedName ? 'selected' : ''}`}
                >
                  <button
                    type="button"
                    className="native-change-row"
                    onClick={() => onSelect(change)}
                  >
                    <div className="flex w-full items-center gap-2.5 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{change.name}</div>
                        <div className="mt-1 text-xs text-meta">
                          {PHASE_LABELS[change.phase] ?? '状态异常'}
                          {progress ? ` · ${progress.covered}/${progress.total}` : ''}
                        </div>
                        {progress && (
                          <div
                            className={`native-change-progress mt-1 ${progress.complete ? 'complete' : ''}`}
                            role="progressbar"
                            aria-valuenow={progress.percent}
                            aria-valuemin="0"
                            aria-valuemax="100"
                          >
                            <span style={{ width: `${progress.percent}%` }} />
                          </div>
                        )}
                      </div>
                      <Pill tone={freshnessTone(change.verificationFreshness)}>
                        {FRESHNESS_LABELS[change.verificationFreshness] ?? '状态未知'}
                      </Pill>
                    </div>
                  </button>
                </div>
              );
            })
          )}
          {hasMore && (
            <div
              ref={loadMoreRef}
              className="py-2 text-center text-xs text-meta"
              aria-live="polite"
            >
              继续下滑加载更多
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NativeChangeDetail({ change, onPreview, onCopyChangeName }) {
  const findingCodes = change.findings.codes;
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [change.name]);

  return (
    <section className="native-change-detail min-w-0 rounded-lg border border-border bg-bg shadow-raised">
      <div className="flex items-start gap-4 border-b border-border-soft px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-semibold">{change.name}</h3>
            <Tooltip title="复制 Change 名称">
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                aria-label={copied ? '已复制 Change 名称' : '复制 Change 名称'}
                onClick={() =>
                  onCopyChangeName?.(change.name)?.then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                }
              />
            </Tooltip>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-meta">
            <span>native</span>
            <span>
              {change.status === 'archived'
                ? `归档于 ${change.archivedAt ?? '未知时间'}`
                : change.selected
                  ? '当前选中变更'
                  : '并行变更'}
            </span>
            <span>{approvalLabel(change.approval)}</span>
          </div>
        </div>
        <Pill tone={phaseTone(change.phase)}>{PHASE_LABELS[change.phase] ?? '状态异常'}</Pill>
      </div>
      <div className="space-y-5 p-5">
        <NativePhaseStepper phase={change.phase} archived={change.status === 'archived'} />
        <NativeArtifactList artifacts={change.artifacts} onPreview={onPreview} />
        <div className="grid gap-4 lg:grid-cols-2">
          <NativeProgressCard change={change} />
          <NativeScopeCard change={change} />
        </div>
        <NativeAcceptanceCard change={change} />
        {findingCodes.length > 0 && (
          <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
            <div className="mb-4 flex items-baseline justify-between">
              <h4 className="text-sm font-semibold tracking-tight">结构化发现</h4>
              <span className="font-mono text-[12px] text-meta">{findingCodes.length} 项</span>
            </div>
            <ul className="space-y-2">
              {findingCodes.map((code) => (
                <li
                  key={code}
                  className="break-all rounded-lg bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-fg-2"
                >
                  {code}
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </section>
  );
}

function NativeProgressCard({ change }) {
  const progress = change.progress;
  const hasCheckpoint = Boolean(progress?.checkpointAt);

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">最近进展</h4>
        <Pill tone={hasCheckpoint ? 'info' : 'neutral'}>
          {hasCheckpoint ? '已记录 Checkpoint' : '尚无 Checkpoint'}
        </Pill>
      </div>
      <p className="min-h-10 text-sm leading-relaxed text-fg-2">
        {progress?.summary ?? '当前阶段还没有持久化进展摘要。'}
      </p>
      <div className="mt-4 space-y-3 border-t border-border-soft pt-4 text-xs">
        <TimelineFact label="创建 change" value={formatTimestamp(progress?.createdAt)} />
        <TimelineFact
          label="最近 checkpoint"
          value={formatTimestamp(progress?.checkpointAt)}
          active={hasCheckpoint}
        />
      </div>
      <div className="mt-4 rounded-lg bg-surface-warm px-3 py-3">
        <div className="text-[11px] font-medium text-meta">下一步</div>
        <div className="mt-1 text-xs font-medium leading-relaxed text-fg-2">
          {change.status === 'archived'
            ? '已完成 · 无需后续操作'
            : (progress?.nextAction ?? continuationLabel(change.continuation))}
        </div>
      </div>
    </article>
  );
}

function TimelineFact({ label, value, active = true }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`size-2 shrink-0 rounded-full ${active ? 'bg-accent' : 'border border-border'}`}
      />
      <span className="text-muted">{label}</span>
      <span className="ml-auto text-right font-mono text-fg-2">{value}</span>
    </div>
  );
}

function NativeScopeCard({ change }) {
  const specs = change.specs;
  const capabilities = specs?.capabilities ?? [];
  const implementation = change.implementation;

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">变更范围</h4>
        <span className="rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {specs?.total ?? 0} 个 capability
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <ScopeMetric label="新增" value={specs?.create ?? 0} tone="info" />
        <ScopeMetric label="替换" value={specs?.replace ?? 0} tone="warn" />
        <ScopeMetric label="删除" value={specs?.remove ?? 0} tone="danger" />
      </div>
      <div className="mt-4 space-y-2">
        {capabilities.length === 0 ? (
          <p className="rounded-lg bg-surface-warm px-3 py-3 text-xs text-muted">
            尚未声明 Spec 变更。
          </p>
        ) : (
          capabilities.map((item) => (
            <div
              key={`${item.capability}-${item.operation}`}
              className="flex items-center gap-3 rounded-lg border border-border-soft px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2">
                {item.capability}
              </span>
              <span className="text-[11px] text-meta">{operationLabel(item.operation)}</span>
            </div>
          ))
        )}
      </div>
      {implementation && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-soft pt-4 text-xs">
          <SideFact label="实现变更" value={`${implementation.changeCount} 项`} />
          <SideFact label="声明产物" value={`${implementation.declaredArtifactCount} 项`} />
          <SideFact label="未归属" value={`${implementation.unattributedCount} 项`} />
          <SideFact label="未解决范围" value={`${implementation.unresolvedCount} 项`} />
        </div>
      )}
    </article>
  );
}

function ScopeMetric({ label, value, tone }) {
  const toneClass = {
    info: 'bg-info-soft text-info',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return (
    <div className="rounded-lg bg-surface-warm px-2 py-3">
      <div className={`text-lg font-bold tabular-nums ${value ? toneClass : 'text-fg-2'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-meta">{label}</div>
    </div>
  );
}

function NativeAcceptanceCard({ change }) {
  const acceptance = change.acceptance;
  const covered = acceptance ? acceptance.evidenced + acceptance.skipped : 0;
  const percent = acceptance?.total ? Math.round((covered / acceptance.total) * 100) : 0;

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold tracking-tight">验收覆盖</h4>
        <Pill tone={acceptance && acceptance.missing === 0 ? 'ok' : 'warn'}>
          {acceptance ? `${percent}% 已处理` : '尚无验收投影'}
        </Pill>
        <span className="ml-auto text-xs text-meta">
          {FRESHNESS_LABELS[change.verificationFreshness] ?? '状态未知'}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
        <span
          className={`block h-full rounded-full transition-[width] ${acceptance?.missing === 0 ? 'bg-success' : 'bg-accent'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3 text-center">
        <AcceptanceMetric label="总计" value={acceptance?.total ?? 0} />
        <AcceptanceMetric label="有证据" value={acceptance?.evidenced ?? 0} />
        <AcceptanceMetric label="已跳过" value={acceptance?.skipped ?? 0} />
        <AcceptanceMetric label="待补充" value={acceptance?.missing ?? 0} />
      </div>
    </article>
  );
}

function AcceptanceMetric({ label, value }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-meta">{label}</div>
    </div>
  );
}

function NativeArtifactList({ artifacts, onPreview }) {
  const source = artifacts ?? [];
  const ready = source.filter((artifact) => artifact.exists).length;

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">关键产物</h4>
        <span className="font-mono text-[12px] text-meta">
          {ready}/{source.length}
        </span>
      </div>
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[12px] font-medium uppercase tracking-wider text-muted">
            Comet Native
          </span>
          <span className="h-px flex-1 bg-border-soft" />
        </div>
        <div className="space-y-px">
          {source.map((artifact) => (
            <button
              key={artifact.key}
              type="button"
              className={`group grid w-full grid-cols-[16px_1fr_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${artifact.exists ? 'cursor-pointer hover:bg-surface' : 'cursor-default opacity-50'}`}
              disabled={!artifact.exists}
              onClick={() =>
                onPreview({ key: artifact.key, name: artifact.label, preview: artifact })
              }
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <span
                  className={`h-2 w-2 rounded-full ${artifact.exists ? 'bg-accent' : 'border border-border'}`}
                />
              </span>
              <span className="min-w-0 truncate text-[13px] text-fg">{artifact.key}</span>
              <span className="whitespace-nowrap pl-4 text-right text-[12px] text-muted">
                {artifact.exists ? artifact.label : '未生成'}
              </span>
            </button>
          ))}
          {source.length === 0 && (
            <div className="py-6 text-center text-sm text-muted">暂无可预览产物</div>
          )}
        </div>
      </div>
    </article>
  );
}

function NativePhaseStepper({ phase, archived }) {
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === phase),
  );

  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-sm font-semibold">生命周期阶段</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? '已归档' : `当前 ${PHASE_LABELS[phase] ?? '状态异常'}`}
        </span>
      </div>
      <div className="flex">
        {PHASES.map(([key, label], index) => {
          const state =
            archived || index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'pending';
          return (
            <div key={key} className="relative flex flex-1 flex-col items-center gap-2 text-center">
              {index > 0 && (
                <span
                  className={`absolute left-0 right-1/2 top-4 h-px ${index <= currentIndex ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              {index < PHASES.length - 1 && (
                <span
                  className={`absolute left-1/2 right-0 top-4 h-px ${index < currentIndex ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              <span
                aria-label={`${label} ${state === 'done' ? '已完成' : state === 'current' ? '当前阶段' : '待进行'}`}
                className={`relative z-10 grid size-8 place-items-center rounded-full border text-sm font-bold ${state === 'done' ? 'border-accent bg-accent text-white' : state === 'current' ? 'border-accent bg-bg text-accent' : 'border-border bg-bg text-fg-2'}`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span
                className={`text-[13px] font-semibold ${state === 'pending' ? 'text-fg-2' : 'text-accent'}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function NativeSidePanel({ change, git }) {
  const conflictPeers = change.conflicts.peers;
  const continuation = change.continuation;

  return (
    <aside className="space-y-5">
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <h3 className="text-sm font-semibold">继续与归档</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <SideFact
            label="继续状态"
            value={
              change.status === 'archived' ? '已完成 · 已归档' : continuationLabel(continuation)
            }
          />
          <SideFact
            label="用户决策"
            value={continuation?.requiresUserDecision ? '需要' : '不需要'}
          />
          <SideFact label="归档预检" value={change.archiveReady ? '已就绪' : '尚未就绪'} />
        </dl>
      </section>
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Repair 状态</h3>
          <Pill tone={repairTone(change.repair)}>{repairLabel(change.repair)}</Pill>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {change.repair
            ? change.repair.overrideRecorded
              ? '已记录一次用户覆盖决定；后续重复失败仍会停止。'
              : '检测到重复失败，Native 已停止自动修复。'
            : '当前没有需要人工介入的重复失败。'}
        </p>
      </section>
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center">
          <h3 className="text-sm font-semibold">关联冲突</h3>
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs text-fg-2">
            {conflictPeers.length} 个
          </span>
        </div>
        {conflictPeers.length === 0 ? (
          <p className="mt-4 rounded-lg bg-surface-warm px-3 py-3 text-xs text-muted">
            未发现冲突变更。
          </p>
        ) : (
          <ul className="native-conflict-list space-y-2">
            {conflictPeers.map((peer) => (
              <li
                key={`${peer.change}-${peer.classification}`}
                className="rounded-xl border border-border-soft px-3 py-3"
              >
                <div className="break-all font-mono text-xs text-fg-2">{peer.change}</div>
                <div className="mt-1 text-[11px] text-meta">
                  {CONFLICT_LABELS[peer.classification] ?? '可能重叠'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {git && (
        <section className="rounded-lg bg-bg p-5 shadow-raised">
          <h3 className="text-sm font-semibold">Git 摘要</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <SideFact label="分支" value={git.branch ?? '—'} />
            <SideFact label="HEAD" value={git.head ?? '—'} />
            <SideFact label="未提交文件" value={`${git.dirtyFiles ?? 0} 个`} />
          </dl>
        </section>
      )}
    </aside>
  );
}

function SideFact({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-soft pb-3 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg-2">{value}</dd>
    </div>
  );
}

function Pill({ tone = 'neutral', children }) {
  const className =
    {
      ok: 'bg-ok-soft text-success',
      warn: 'bg-warn-soft text-warn',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      neutral: 'bg-surface text-fg-2',
    }[tone] ?? 'bg-surface text-fg-2';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-tight ${className}`}
    >
      <span className="break-words">{children}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg bg-bg p-12 text-center shadow-raised">
      <div className="text-lg font-semibold">当前没有 Native change</div>
      <p className="mt-2 text-sm text-muted">Native 状态出现后会在这里展示。</p>
    </div>
  );
}

function phaseTone(phase) {
  if (phase === 'archive') return 'ok';
  if (phase === 'invalid') return 'danger';
  if (phase === 'verify') return 'warn';
  return 'info';
}

function freshnessTone(freshness) {
  if (freshness === 'complete') return 'ok';
  if (freshness === 'partial' || freshness === 'stale') return 'warn';
  if (freshness === 'invalid') return 'danger';
  return 'neutral';
}

function continuationLabel(continuation) {
  if (!continuation) return '状态未知';
  const disposition = DISPOSITION_LABELS[continuation.disposition] ?? '状态未知';
  const action = ACTION_LABELS[continuation.action] ?? '无需动作';
  return continuation.requiresUserDecision
    ? `${disposition} · 需要用户决定`
    : `${disposition} · ${action}`;
}

function continuationTone(continuation) {
  if (!continuation) return 'neutral';
  if (continuation.disposition === 'done') return 'ok';
  if (continuation.disposition === 'blocked') return 'danger';
  if (continuation.disposition === 'await-user') return 'warn';
  return 'info';
}

function approvalLabel(approval) {
  if (approval === 'confirmed') return '需求已确认';
  if (approval === 'implicit') return '需求已隐式确认';
  return '需求待确认';
}

function operationLabel(operation) {
  if (operation === 'create') return '新增';
  if (operation === 'replace') return '替换';
  if (operation === 'remove') return '删除';
  return '未知操作';
}

function repairLabel(repair) {
  if (!repair) return '正常';
  return repair.disposition === 'hard-stop' ? '已硬停止' : '等待人工处理';
}

function repairTone(repair) {
  if (!repair) return 'ok';
  return repair.disposition === 'hard-stop' ? 'danger' : 'warn';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
