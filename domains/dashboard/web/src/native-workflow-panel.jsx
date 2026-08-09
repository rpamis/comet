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
const LOOP_STAGE_LABELS = {
  shape: '需求澄清',
  building: '构建中',
  'verify-ready': '等待验证',
  repairing: '修复中',
  'archive-ready': '可归档',
  'await-user': '等待用户',
  blocked: '已阻塞',
  done: '已完成',
};
const ACTOR_LABELS = { builder: 'Builder', runtime: 'Runtime', verifier: 'Verifier' };
const LOCAL_STAGE_LABELS = {
  building: '构建',
  checking: '执行检查',
  verifying: '独立验证',
  archiving: '归档',
};
const VERIFICATION_LABELS = {
  pending: '待验证',
  pass: '验证通过',
  fail: '验证失败',
  blocked: '验证阻塞',
};
const ASSURANCE_PRESENTATION = {
  'host-attested': { label: '宿主身份校验', tone: 'ok' },
  'skill-coordinated': { label: 'Skill 协调', tone: 'warn' },
  'semantic-verification-unavailable': { label: '语义验收不可用', tone: 'danger' },
  'user-confirmed-degraded': { label: '用户确认降级通过', tone: 'warn' },
};
const ACCEPTANCE_LABELS = {
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  pending: '待验证',
};
const HISTORY_LABELS = {
  pass: '通过',
  fail: '失败',
  blocked: '阻塞',
  'execution-error': '执行异常',
  recovery: '恢复',
};
const LOCAL_REASON_LABELS = {
  current: '与当前 YAML 一致',
  idle: '当前无执行任务',
  missing: '可从 YAML 恢复',
  'version-mismatch': '本机状态已过期，可从 YAML 恢复',
  invalid: '本机状态不可读，可从 YAML 恢复',
  archived: '归档只读',
};
const MIGRATION_LABELS = {
  none: '当前格式',
  required: '需要迁移',
  failed: '迁移失败',
  'legacy-read-only': '旧归档只读',
  invalid: '状态无效',
};
const NATIVE_CHANGE_PAGE_SIZE = 5;

function portableText(value, fallback = '—') {
  return value?.text || fallback;
}

function changeKey(change) {
  return `${change.status}:${change.archiveName ?? ''}:${change.name}`;
}

function acceptanceProgress(change) {
  const acceptance = change.acceptance;
  if (!acceptance?.total) return null;
  const resolved = acceptance.total - acceptance.pending;
  return {
    resolved,
    total: acceptance.total,
    percent: Math.round((resolved / acceptance.total) * 100),
    complete: acceptance.pending === 0,
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
      const matchesTab = tab === 'all' || change.status === tab;
      const matchesQuery = !normalizedQuery || change.name.toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesQuery;
    });
  }, [native, normalizedQuery, pagedChanges, serverPaged, tab]);
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(
    () => setVisibleChangeCount(NATIVE_CHANGE_PAGE_SIZE),
    [normalizedQuery, serverPaged, tab],
  );

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
      if (element.getBoundingClientRect().bottom <= window.innerHeight + 32) loadMoreChanges();
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
  }, [visibleChanges]);
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
      <SectionHead title="Native 变更工作区" hint="查看循环、验收、阻塞与恢复状态" />
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
              selectedKey={selectedSummary ? changeKey(selectedSummary) : null}
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
  const hasArchivedChanges = (native?.archivedChangeCount ?? 0) > 0;
  const showArchiveShortcut = tab === 'active' && !query.trim() && hasArchivedChanges;
  return (
    <section className="native-workspace-empty flex min-h-[360px] items-center justify-center rounded-lg bg-bg p-8 text-center shadow-raised xl:col-span-1 2xl:col-span-2">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-softer text-xl text-accent">
          ◇
        </span>
        <h3 className="mt-5 text-lg font-semibold tracking-tight">
          {showArchiveShortcut ? '当前没有活跃的 Native change' : '没有匹配的 Native change'}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {showArchiveShortcut
            ? '当前 Native 工作均已归档，可查看只读历史。'
            : '调整搜索条件或切换筛选后重试。'}
        </p>
        {showArchiveShortcut && (
          <Button className="mt-5" type="primary" onClick={() => onTab('archived')}>
            查看已归档变更
          </Button>
        )}
      </div>
    </section>
  );
}

function suggestion(change) {
  if (!change) return '当前没有可展示的 Native change。';
  if (change.migration?.status === 'invalid')
    return change.migration.message ?? 'Native 状态无效。';
  if (change.migration?.status === 'required' || change.migration?.status === 'failed') {
    return change.migration.message ?? '需要先迁移 Native 状态。';
  }
  if (change.migration?.status === 'legacy-read-only') return '这是旧版归档，仅供查看。';
  if (change.blockers?.length) return portableText(change.blockers[0].reason, '当前变更已阻塞。');
  if (change.status === 'archived') return '当前变更已经归档，可查看验收与循环历史。';
  return change.loop?.nextAction ?? 'Runtime 将根据当前 YAML 状态继续执行。';
}

function NativeWorkflowSuggestion({ change }) {
  return (
    <section className="dashboard-priority-banner" role="status" aria-label="工作流建议">
      <div className="dashboard-priority-title">
        <BulbOutlined aria-hidden="true" />
        <span>下一步建议</span>
      </div>
      <p>{suggestion(change)}</p>
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
    loadedChanges.filter((change) => change.status === 'active').length;
  const readyToArchive = loadedChanges.filter(
    (change) => change.loop?.stage === 'archive-ready',
  ).length;
  const running = loadedChanges.filter(
    (change) => change.localExecution?.status === 'running',
  ).length;
  const attention = loadedChanges.filter(
    (change) =>
      ['fail', 'blocked'].includes(change.verificationResult) ||
      (change.acceptance?.failed ?? 0) > 0 ||
      (change.acceptance?.blocked ?? 0) > 0,
  ).length;
  const pending = loadedChanges.reduce((sum, change) => sum + (change.acceptance?.pending ?? 0), 0);
  const cards = [
    ['活跃变更', active, '当前 Native workflow', active ? '进行中' : '清零', FlagOutlined],
    [
      '可归档',
      readyToArchive,
      '已加载的循环状态',
      readyToArchive ? '就绪' : '暂无',
      CheckCircleOutlined,
    ],
    ['正在执行', running, '匹配当前 YAML 的本机任务', running ? '运行中' : '空闲', UserOutlined],
    [
      '失败或阻塞',
      attention,
      '已加载的验收与验证',
      attention ? '需处理' : '健康',
      SafetyCertificateOutlined,
    ],
    ['待验收项', pending, '已加载的验收条目', pending ? '待验证' : '已处理', ApartmentOutlined],
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
  selectedKey,
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
              const progress = acceptanceProgress(change);
              return (
                <div
                  key={changeKey(change)}
                  className={`native-change-list-item ${changeKey(change) === selectedKey ? 'selected' : ''}`}
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
                          {change.loop
                            ? ` · ${LOOP_STAGE_LABELS[change.loop.stage]} · 第${change.loop.iteration}轮/第${change.loop.attempt}次`
                            : ''}
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
                      <Pill tone={verificationTone(change.verificationResult)}>
                        {VERIFICATION_LABELS[change.verificationResult] ?? '状态未知'}
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
                : `state v${change.stateVersion ?? '—'}`}
            </span>
            <span>{MIGRATION_LABELS[change.migration?.status] ?? '状态未知'}</span>
            {change.loop?.actor && <span>当前执行者 {ACTOR_LABELS[change.loop.actor]}</span>}
          </div>
        </div>
        <Pill tone={phaseTone(change.phase)}>{PHASE_LABELS[change.phase] ?? '状态异常'}</Pill>
      </div>
      <div className="space-y-5 p-5">
        <NativePhaseStepper change={change} />
        <NativeArtifactList artifacts={change.artifacts} onPreview={onPreview} />
        <div className="grid gap-4 lg:grid-cols-2">
          <NativeLoopRecoveryCard change={change} />
          <NativeScopeCard change={change} />
        </div>
        <NativeAcceptanceCard change={change} />
        <NativeVerificationCard change={change} />
        <NativeBlockersCard blockers={change.blockers ?? []} />
        <NativeHistoryCard history={change.history ?? []} overflow={change.historyOverflow} />
      </div>
    </section>
  );
}

function NativeLoopRecoveryCard({ change }) {
  const loop = change.loop;
  const local = change.localExecution;
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">循环与恢复</h4>
        <Pill
          tone={
            local?.status === 'running'
              ? 'info'
              : local?.reason === 'invalid'
                ? 'danger'
                : 'neutral'
          }
        >
          {local?.status === 'running'
            ? '正在执行'
            : (LOCAL_REASON_LABELS[local?.reason] ?? '状态未知')}
        </Pill>
      </div>
      {loop ? (
        <dl className="space-y-3 text-sm">
          <SideFact label="循环阶段" value={LOOP_STAGE_LABELS[loop.stage] ?? loop.stage} />
          <SideFact label="Goal cycle" value={`${loop.goalCycle}`} />
          <SideFact label="轮次 / 尝试" value={`${loop.iteration} / ${loop.attempt}`} />
          <SideFact label="执行者" value={ACTOR_LABELS[loop.actor] ?? '当前无执行者'} />
          <SideFact label="检查请求轮次" value={`${local?.requestCheckRounds ?? 0}`} />
        </dl>
      ) : (
        <p className="text-sm leading-relaxed text-muted">旧版归档不包含可移植 Loop 状态。</p>
      )}
      <div className="mt-4 rounded-lg bg-surface-warm px-3 py-3">
        <div className="text-[11px] font-medium text-meta">恢复依据与下一步</div>
        <div className="mt-1 text-xs font-medium leading-relaxed text-fg-2">
          {local?.recoverableFromStage
            ? `可从 YAML 的 ${LOOP_STAGE_LABELS[local.recoverableFromStage] ?? local.recoverableFromStage} 阶段恢复。`
            : (loop?.nextAction ?? LOCAL_REASON_LABELS[local?.reason] ?? '无后续动作。')}
        </div>
      </div>
      {change.builderHandoff && (
        <div className="mt-3 border-t border-border-soft pt-3 text-xs">
          <div className="font-medium text-meta">
            Builder handoff · 第 {change.builderHandoff.iteration} 轮
          </div>
          <p className="mt-1 leading-relaxed text-fg-2">
            {portableText(change.builderHandoff.summary)}
          </p>
        </div>
      )}
      {(local?.checks ?? []).length > 0 && (
        <div className="mt-3 text-xs text-meta">
          本机检查摘要：{local.checks.filter((check) => check.status === 'passed').length} 通过 /{' '}
          {local.checks.filter((check) => check.status === 'failed').length} 失败 /{' '}
          {local.checks.filter((check) => ['planned', 'running'].includes(check.status)).length}{' '}
          进行中
        </div>
      )}
    </article>
  );
}

function NativeScopeCard({ change }) {
  const specs = change.specs;
  const capabilities = specs?.capabilities ?? [];
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
        <ScopeMetric label="修改" value={specs?.modify ?? 0} tone="warn" />
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
  const progress = acceptanceProgress(change);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold tracking-tight">验收状态</h4>
        <Pill tone={acceptanceTone(acceptance)}>
          {progress ? `${progress.percent}% 已处理` : '无可移植验收数据'}
        </Pill>
      </div>
      {progress && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
          <span
            className={`block h-full rounded-full transition-[width] ${progress.complete ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
      <div className="mt-4 grid grid-cols-4 gap-3 text-center">
        <AcceptanceMetric label="通过" value={acceptance?.passed ?? 0} />
        <AcceptanceMetric label="失败" value={acceptance?.failed ?? 0} />
        <AcceptanceMetric label="阻塞" value={acceptance?.blocked ?? 0} />
        <AcceptanceMetric label="待验证" value={acceptance?.pending ?? 0} />
      </div>
      {(change.acceptanceItems ?? []).length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-border-soft pt-4">
          {change.acceptanceItems.map((item) => (
            <li key={item.id} className="rounded-lg bg-surface px-3 py-3 text-xs">
              <div className="flex items-start gap-3">
                <span className="font-mono text-meta">{item.id}</span>
                <span className="min-w-0 flex-1 text-fg-2">{item.text}</span>
                <Pill tone={acceptanceResultTone(item.result)}>
                  {ACCEPTANCE_LABELS[item.result]}
                </Pill>
              </div>
              {item.reason && <p className="mt-2 pl-8 text-muted">{portableText(item.reason)}</p>}
            </li>
          ))}
        </ul>
      )}
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

function NativeVerificationCard({ change }) {
  const checks = change.checks ?? [];
  const assurance = ASSURANCE_PRESENTATION[change.verification?.assurance] ?? null;
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">检查结果</h4>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {assurance && <Pill tone={assurance.tone}>{assurance.label}</Pill>}
          <Pill tone={verificationTone(change.verificationResult)}>
            {VERIFICATION_LABELS[change.verificationResult] ?? '状态未知'}
          </Pill>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-fg-2">
        {portableText(change.verification?.summary, '尚无 Verifier 结论。')}
      </p>
      {(change.verification?.risks ?? []).length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
          {change.verification.risks.map((risk, index) => (
            <li key={`${portableText(risk)}-${index}`}>{portableText(risk)}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-2">
        {checks.length === 0 ? (
          <p className="rounded-lg bg-surface-warm px-3 py-3 text-xs text-muted">
            尚无持久化检查摘要。
          </p>
        ) : (
          checks.map((check) => (
            <div
              key={check.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-soft px-3 py-2.5 text-xs"
            >
              <span className="min-w-0 flex-1 text-fg-2">{portableText(check.name, check.id)}</span>
              <Pill
                tone={
                  check.status === 'passed' ? 'ok' : check.status === 'failed' ? 'danger' : 'warn'
                }
              >
                {check.status}
              </Pill>
              <span className="text-meta">{formatDuration(check.durationMs)}</span>
              {check.exitCode !== null && (
                <span className="font-mono text-meta">exit {check.exitCode}</span>
              )}
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function NativeBlockersCard({ blockers }) {
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">阻塞项</h4>
        <Pill tone={blockers.length ? 'danger' : 'ok'}>
          {blockers.length ? `${blockers.length} 项` : '无阻塞'}
        </Pill>
      </div>
      {blockers.length === 0 ? (
        <p className="mt-3 text-xs text-muted">当前没有持久化阻塞项。</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {blockers.map((blocker, index) => (
            <li
              key={`${blocker.owner}-${index}`}
              className="rounded-lg bg-surface px-3 py-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="warn">{ACTOR_LABELS[blocker.owner] ?? blocker.owner}</Pill>
                <span className="text-fg-2">{portableText(blocker.reason)}</span>
              </div>
              <div className="mt-2 text-meta">
                验收：{blocker.acceptanceIds.join(', ') || '—'} · 处理：{blocker.resolutionAction}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function NativeHistoryCard({ history, overflow }) {
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">执行历史</h4>
        <span className="font-mono text-xs text-meta">保留 {history.length} 条</span>
      </div>
      {overflow?.droppedEntries > 0 && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          更早的 {overflow.droppedEntries} 条历史已汇总，时间范围{' '}
          {formatTimestamp(overflow.firstDroppedAt)} 至 {formatTimestamp(overflow.lastDroppedAt)}。
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-xs text-muted">尚无完成的循环记录。</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {history.map((entry, index) => (
            <li
              key={`${entry.goalCycle}-${entry.iteration}-${entry.attempt}-${index}`}
              className="flex items-start gap-3 rounded-lg border border-border-soft px-3 py-3 text-xs"
            >
              <span className="font-mono text-meta">
                #{entry.iteration}.{entry.attempt}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-fg-2">{portableText(entry.summary)}</div>
                <div className="mt-1 text-meta">{formatTimestamp(entry.completedAt)}</div>
              </div>
              <Pill tone={historyTone(entry.outcome)}>
                {HISTORY_LABELS[entry.outcome] ?? entry.outcome}
              </Pill>
            </li>
          ))}
        </ol>
      )}
    </article>
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
        </div>
        <div className="space-y-0.5">
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

function NativePhaseStepper({ change }) {
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === change.phase),
  );
  const archived = change.status === 'archived';
  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-sm font-semibold">生命周期阶段</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? '已归档' : `当前 ${PHASE_LABELS[change.phase] ?? '状态异常'}`}
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
      {change.loop && (
        <p className="mt-4 text-center text-xs text-meta">
          Build ↔ Verify Loop · {LOOP_STAGE_LABELS[change.loop.stage]} · 第 {change.loop.iteration}{' '}
          轮 / 第 {change.loop.attempt} 次
        </p>
      )}
    </article>
  );
}

function NativeSidePanel({ change, git }) {
  const local = change.localExecution;
  const blockers = change.blockers ?? [];
  return (
    <aside className="space-y-5">
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">恢复状态</h3>
          <Pill tone={local?.status === 'running' ? 'info' : 'neutral'}>
            {local?.status === 'running' ? '执行中' : 'YAML 稳定边界'}
          </Pill>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <SideFact label="本机状态" value={LOCAL_REASON_LABELS[local?.reason] ?? '状态未知'} />
          <SideFact
            label="执行阶段"
            value={local?.stage ? (LOCAL_STAGE_LABELS[local.stage] ?? local.stage) : '—'}
          />
          <SideFact label="执行者" value={ACTOR_LABELS[local?.actor] ?? '—'} />
          <SideFact
            label="可恢复阶段"
            value={
              local?.recoverableFromStage
                ? (LOOP_STAGE_LABELS[local.recoverableFromStage] ?? local.recoverableFromStage)
                : '—'
            }
          />
        </dl>
      </section>
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">当前阻塞</h3>
          <Pill tone={blockers.length ? 'danger' : 'ok'}>
            {blockers.length ? `${blockers.length} 项` : '无'}
          </Pill>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {blockers.length ? portableText(blockers[0].reason) : '当前没有阻止 Loop 前进的事项。'}
        </p>
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

function verificationTone(result) {
  if (result === 'pass') return 'ok';
  if (result === 'fail') return 'danger';
  if (result === 'blocked') return 'warn';
  return 'neutral';
}

function acceptanceTone(acceptance) {
  if (!acceptance) return 'neutral';
  if (acceptance.failed > 0) return 'danger';
  if (acceptance.blocked > 0 || acceptance.pending > 0) return 'warn';
  return 'ok';
}

function acceptanceResultTone(result) {
  if (result === 'passed') return 'ok';
  if (result === 'failed') return 'danger';
  if (result === 'blocked') return 'warn';
  return 'neutral';
}

function historyTone(outcome) {
  if (outcome === 'pass' || outcome === 'recovery') return 'ok';
  if (outcome === 'fail' || outcome === 'execution-error') return 'danger';
  return 'warn';
}

function operationLabel(operation) {
  if (operation === 'create') return '新增';
  if (operation === 'modify') return '修改';
  if (operation === 'remove') return '删除';
  return '未知操作';
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
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
