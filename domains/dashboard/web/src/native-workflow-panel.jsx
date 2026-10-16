import { SummaryFilterBar } from './workflow-summary.jsx';
import { t, localized, getDashboardLocale } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CopyOutlined,
  DownOutlined,
  FlagOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Empty, Pagination, Skeleton, Tooltip } from 'antd';
import {
  isNativePhaseRunning,
  nativeChangeBlockers,
  nativeChangeStatusPresentation,
} from './native-status-presentation.js';
import { useAnimatedNumber } from './use-animated-number.js';
import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
import { DashboardWorkspaceRegion } from './workspace-layout.jsx';

const PHASES = [
  ['shape', 'Shape'],
  ['build', 'Build'],
  ['verify', 'Verify'],
  ['archive', 'Archive'],
];
const PHASE_LABELS = Object.fromEntries(PHASES);
const LOOP_STAGE_LABELS = localized({
  shape: '需求澄清',
  building: '构建中',
  'verify-ready': '等待验证',
  repairing: '修复中',
  'archive-ready': '可归档',
  'await-user': '等待用户',
  blocked: '已阻塞',
  done: '已完成',
});
const ACTOR_LABELS = { builder: 'Builder', runtime: 'Runtime', verifier: 'Verifier' };
const LOCAL_STAGE_LABELS = localized({
  building: '构建',
  checking: '执行检查',
  verifying: '独立验证',
  archiving: '归档',
});
const VERIFICATION_LABELS = localized({
  pending: '待验证',
  pass: '验收通过',
  fail: '验证失败',
  blocked: '验证阻塞',
});
const ASSURANCE_PRESENTATION = localized({
  'host-attested': {
    label: '已完成独立验证',
    description: '可信运行环境已经完成独立验证。',
    tone: 'ok',
  },
  'skill-coordinated': {
    label: '已完成检查，但需要你确认验证结果',
    description: '检查已完成，但系统无法确认验证者是否独立，需要你确认。',
    tone: 'warn',
  },
  'semantic-verification-unavailable': {
    label: '无法完成完整验证，只完成了自动检查',
    description: '没有可用的语义验证，当前只有 Runtime 自动检查结果。',
    tone: 'danger',
  },
  'user-confirmed-degraded': {
    label: '你已确认接受不完整验证结果',
    description: '你已明确接受只有自动检查、缺少语义验证的结果。',
    tone: 'warn',
  },
});
function assurancePresentation(change) {
  const assurance = change.verification?.assurance;
  const presentation = ASSURANCE_PRESENTATION[assurance] ?? null;
  if (
    assurance === 'skill-coordinated' &&
    (change.status === 'archived' ||
      (change.phase === 'archive' && change.loop?.nextAction === 'archive'))
  ) {
    return {
      ...presentation,
      label: t('已完成检查，验证结果已确认'),
      description: t('检查已完成，你已经确认接受这次验证结果。'),
    };
  }
  return presentation;
}
const ACCEPTANCE_LABELS = localized({
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  pending: '待验证',
});
const HISTORY_LABELS = localized({
  pass: '通过',
  fail: '失败',
  blocked: '阻塞',
  'execution-error': '执行异常',
  recovery: '恢复',
});
const LOCAL_REASON_LABELS = localized({
  current: '与当前 YAML 一致',
  idle: '当前无执行任务',
  missing: '可从 YAML 恢复',
  'version-mismatch': '本机状态已过期，可从 YAML 恢复',
  invalid: '本机状态不可读，可从 YAML 恢复',
  archived: '归档只读',
});
const MIGRATION_LABELS = localized({
  none: '当前格式',
  required: '需要迁移',
  failed: '迁移失败',
  'legacy-read-only': '旧归档只读',
  invalid: '状态无效',
});
const CHILD_STATUS_LABELS = localized({
  pending: '等待依赖',
  ready: '可开始',
  active: '进行中',
  done: '已完成',
  verified: '已验收',
  integrated: '已集成',
  archived: '已归档',
  'needs-reverify': '需要重新验收',
  blocked: '已阻塞',
});
const CHILD_STATUS_TONES = {
  pending: 'neutral',
  ready: 'info',
  active: 'warn',
  done: 'ok',
  verified: 'ok',
  integrated: 'ok',
  archived: 'neutral',
  'needs-reverify': 'warn',
  blocked: 'danger',
};
const CHILD_STATUS_DESCRIPTIONS = localized({
  pending: '等待前置子任务完成',
  ready: '等待开始执行',
  active: '正在执行',
  done: '执行完成',
  verified: '验收通过',
  integrated: '已合入集成分支',
  archived: '归档完成',
  'needs-reverify': '等待重新验收',
  blocked: '等待解除阻塞',
});
const NATIVE_CHANGE_PAGE_SIZE = 5;

function portableText(value, fallback = '—') {
  return value?.text || fallback;
}

function changeKey(change) {
  return change.locator ?? `${change.status}:${change.archiveName ?? ''}:${change.name}`;
}

function childChangeReference(child) {
  if (!child.locator || !child.changeStatus) return null;
  return {
    ...child,
    workflow: 'native',
    locator: child.locator,
    name: child.name,
    status: child.changeStatus,
    ...(child.archiveName ? { archiveName: child.archiveName } : {}),
    workspace: child.workspace,
    children: [],
  };
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
  summaryTarget,
  summaryData,
  summaryFilter,
  onSummaryAction,
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
  const dashboardLanguage = useDashboardLanguage();
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
      const matchesQuery =
        !normalizedQuery ||
        [
          change.name,
          change.workspace?.label,
          change.workspace?.branch,
          ...(change.children ?? []).flatMap((child) => [
            child.name,
            child.workspace?.label,
            child.workspace?.branch,
            child.message,
          ]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesTab && matchesQuery;
    });
  }, [native, normalizedQuery, pagedChanges, serverPaged, tab, dashboardLanguage]);
  const [selectedKey, setSelectedKey] = useState(null);
  useEffect(() => {
    if (summaryTarget) setSelectedKey(changeKey(summaryTarget));
  }, [summaryTarget]);

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
  const visibleChanges = useMemo(
    () => (serverPaged ? sourceChanges : sourceChanges.slice(0, visibleChangeCount)),
    [serverPaged, sourceChanges, visibleChangeCount, dashboardLanguage],
  );
  const hasMoreChanges = serverPaged ? hasMore : visibleChanges.length < sourceChanges.length;
  const selectableChanges = useMemo(
    () =>
      visibleChanges.flatMap((change) => [
        change,
        ...(change.children ?? []).map(childChangeReference).filter(Boolean),
      ]),
    [visibleChanges, dashboardLanguage],
  );

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
      if (selectableChanges.some((change) => changeKey(change) === current)) return current;
      return selectableChanges[0] ? changeKey(selectableChanges[0]) : null;
    });
  }, [selectableChanges]);
  const selectedSummary =
    selectableChanges.find((change) => changeKey(change) === selectedKey) ??
    selectableChanges[0] ??
    null;
  const selectedSummaryKey = selectedSummary ? changeKey(selectedSummary) : null;
  const selectedSummaryRef = useRef(selectedSummary);
  selectedSummaryRef.current = selectedSummary;
  useEffect(() => {
    if (selectedSummaryRef.current) onSelect?.(selectedSummaryRef.current);
  }, [onSelect, selectedSummaryKey]);
  const selected = serverPaged
    ? selectedDetail && selectedSummary && changeKey(selectedDetail) === changeKey(selectedSummary)
      ? selectedDetail
      : null
    : selectedSummary;
  const locatedSummaryTarget = useRef(null);
  useEffect(() => {
    if (
      locatedSummaryTarget.current === summaryTarget ||
      !summaryTarget ||
      !selected ||
      changeKey(summaryTarget) !== changeKey(selected)
    )
      return;
    locatedSummaryTarget.current = summaryTarget;
    const frame = requestAnimationFrame(() =>
      document.querySelector('.native-change-detail')?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [summaryTarget, selected]);
  const detailPending = Boolean(selectedSummary && !selected && (detailLoading || !detailError));
  const hasNativeChanges = Boolean(native && native.totalChangeCount > 0);
  const isEmptyView = !pageLoading && visibleChanges.length === 0;
  const isLoadingView = pageLoading && visibleChanges.length === 0;

  return (
    <div className="mx-auto min-w-0 max-w-dashboard">
      <SectionHead
        title={t('项目概览')}
        hint={
          native
            ? t('Native 状态生成于 {0}', [formatTimestamp(native.generatedAt)])
            : t('当前项目尚无 Native 状态')
        }
      />
      <NativeWorkflowSuggestion change={selected ?? selectedSummary} />
      <NativeSummaryCards
        native={native}
        loadedChanges={summaryData.rows}
        unavailable={!summaryData.ready || Boolean(summaryData.error)}
        selectedKey={summaryFilter ?? tab}
        onAction={onSummaryAction}
      />
      <SummaryFilterBar filter={summaryFilter} summary={summaryData} onClear={() => onTab('all')} />
      <SectionHead title={t('Native 变更工作区')} hint={t('查看循环、验收、阻塞与恢复状态')} />
      <DashboardWorkspaceRegion
        stableFrame
        leftClassName="native-workspace-left"
        left={
          <NativeChangesExplorer
            changes={visibleChanges}
            total={serverPaged ? (total ?? sourceChanges.length) : sourceChanges.length}
            selectedKey={selectedSummary ? changeKey(selectedSummary) : null}
            query={query}
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
          isEmptyView && summaryFilter ? (
            <section className="dashboard-workspace-empty-panel">
              <Empty
                description={t(summaryData.error ? '统计读取失败' : '没有符合当前筛选的变更')}
              />
            </section>
          ) : isEmptyView ? (
            <NativeEmptyChangeDetail
              native={native}
              tab={tab}
              query={query}
              onTab={onTab}
              emptyProject={!hasNativeChanges}
            />
          ) : isLoadingView || detailPending ? (
            <NativeChangeDetailSkeleton />
          ) : selected ? (
            <NativeChangeDetail
              change={selected}
              onPreview={onPreview}
              onCopyChangeName={onCopyChangeName}
            />
          ) : detailError ? (
            <div className="native-change-detail dashboard-change-detail-loading min-w-0 rounded-lg border border-border bg-bg p-10 text-center text-sm text-danger shadow-raised">
              <p role="alert">
                {t('Native 变更详情加载失败：')}
                {t(detailError.reason)}
              </p>
              <Button className="mt-4" onClick={onRetryDetail}>
                {t('重新加载')}
              </Button>
            </div>
          ) : (
            <NativeEmptyChangeDetail native={native} tab={tab} query={query} onTab={onTab} />
          )
        }
        right={
          isEmptyView ? (
            <NativeEmptySidePanel />
          ) : isLoadingView || detailPending ? (
            <NativeSidePanelSkeleton />
          ) : selected ? (
            <NativeSidePanel change={selected} git={git} />
          ) : null
        }
      />
    </div>
  );
}

function NativeEmptyChangeDetail({ native, tab, query = '', onTab, emptyProject = false }) {
  useDashboardLanguage();
  const hasArchivedChanges = (native?.archivedChangeCount ?? 0) > 0;
  const hasActiveChanges = (native?.activeChangeCount ?? 0) > 0;
  const showArchiveShortcut = tab === 'active' && !query.trim() && hasArchivedChanges;
  const showActiveShortcut = tab === 'archived' && !query.trim() && hasActiveChanges;
  const title = emptyProject
    ? t('还没有 Native change')
    : showArchiveShortcut
      ? t('当前没有活跃的 Native change')
      : showActiveShortcut
        ? t('还没有已归档的 Native change')
        : t('没有匹配的 Native change');
  const description = emptyProject
    ? t('启动 Native 工作流后，变更进度、验收结果和恢复状态会集中显示在这里。')
    : showArchiveShortcut
      ? t('当前工作区没有进行中的变更，你可以继续查看已归档的历史记录。')
      : showActiveShortcut
        ? t('当前还没有归档记录，你可以返回查看正在进行的变更。')
        : t('调整顶部搜索条件，或切换变更范围后再试。');
  return (
    <section className="native-change-detail native-change-detail-empty min-w-0 rounded-lg border border-border bg-bg shadow-raised">
      <div className="dashboard-workspace-empty-detail text-center">
        <span className="native-workspace-empty-icon" aria-hidden="true">
          <FlagOutlined />
        </span>
        <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
        {showArchiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab?.('archived')}>
            {t('查看已归档变更')}
          </Button>
        ) : showActiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab?.('active')}>
            {t('查看活跃变更')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function NativeEmptySidePanel() {
  useDashboardLanguage();
  return (
    <aside className="dashboard-workspace-side-empty" aria-label={t('Native 变更状态')}>
      <div>
        <span className="native-workspace-empty-icon" aria-hidden="true">
          <FlagOutlined />
        </span>
        <h3>{t('暂无变更数据')}</h3>
        <p>{t('选择或创建 Native change 后，这里会显示恢复状态、阻塞信息和 Git 摘要。')}</p>
      </div>
    </aside>
  );
}

function suggestion(change) {
  if (!change) return t('当前没有可展示的 Native change。');
  if (change.migration?.status === 'invalid')
    return change.migration.message ?? t('Native 状态无效。');
  if (change.migration?.status === 'required' || change.migration?.status === 'failed') {
    return change.migration.message ?? t('需要先迁移 Native 状态。');
  }
  if (change.migration?.status === 'legacy-read-only') return t('这是旧版归档，仅供查看。');
  const blockers = nativeChangeBlockers(change);
  if (blockers.length) return portableText(blockers[0].reason, t('当前变更已阻塞。'));
  if (change.status === 'archived') return t('当前变更已经归档，可查看验收与循环历史。');
  return change.loop?.nextAction ?? t('Runtime 将根据当前 YAML 状态继续执行。');
}

function NativeWorkflowSuggestion({ change }) {
  useDashboardLanguage();
  return (
    <section className="dashboard-priority-banner" role="status" aria-label={t('工作流建议')}>
      <div className="dashboard-priority-title">
        <BulbOutlined aria-hidden="true" />
        <span>{t('下一步建议')}</span>
      </div>
      <p>{suggestion(change)}</p>
    </section>
  );
}

function SectionHead({ title, hint }) {
  useDashboardLanguage();
  return (
    <div className="mb-4 mt-6 flex flex-wrap items-baseline gap-3 first:mt-2">
      <h2 className="dashboard-section-heading text-[20px] font-semibold leading-[1.3] tracking-[-0.018em]">
        {title}
      </h2>
      <span className="dashboard-section-hint text-[13px] leading-5 text-muted">{hint}</span>
    </div>
  );
}

function NativeSummaryCards({ native, loadedChanges = [], unavailable, selectedKey, onAction }) {
  useDashboardLanguage();

  const active =
    native?.activeChangeCount ??
    loadedChanges.filter((change) => change.status === 'active').length;
  const archived =
    native?.archivedChangeCount ??
    loadedChanges.filter((change) => change.status === 'archived').length;
  const running = loadedChanges.filter(
    (change) => change.localExecution?.status === 'running',
  ).length;
  const attention = loadedChanges.filter(
    (change) =>
      ['fail', 'blocked'].includes(change.verificationResult) ||
      (change.acceptance?.failed ?? 0) > 0 ||
      (change.acceptance?.blocked ?? 0) > 0 ||
      nativeChangeBlockers(change).length > 0,
  ).length;
  const pending = loadedChanges.reduce((sum, change) => sum + (change.acceptance?.pending ?? 0), 0);
  const cards = [
    [
      t('活跃变更'),
      active,
      t('当前 Native workflow'),
      active ? t('进行中') : t('清零'),
      FlagOutlined,
    ],
    [
      t('已归档变更'),
      archived,
      t('历史变更已归档'),
      archived ? t('已完成') : t('暂无'),
      CheckCircleOutlined,
    ],
    [
      t('正在执行'),
      running,
      t('匹配当前 YAML 的本机任务'),
      running ? t('运行中') : t('空闲'),
      UserOutlined,
    ],
    [
      t('失败或阻塞'),
      attention,
      t('全部活跃变更'),
      attention ? t('需处理') : t('健康'),
      SafetyCertificateOutlined,
    ],
    [
      t('待验收项'),
      pending,
      t('全部活跃变更的验收条目'),
      pending ? t('待验证') : t('已处理'),
      ApartmentOutlined,
    ],
  ];
  return (
    <section className="dashboard-summary-strip dashboard-overview-summary-strip native-summary-strip">
      {cards.map(([label, value, note, tag, Icon], index) => (
        <NativeSummaryCard
          key={label}
          label={label}
          value={index > 1 && unavailable ? null : value}
          note={note}
          tag={tag}
          icon={Icon}
          tone={`dashboard-summary-tone-${Math.min(index + 1, 5)}`}
          selected={
            selectedKey === ['active', 'archived', 'running', 'attention', 'pending'][index]
          }
          onClick={() => onAction(['active', 'archived', 'running', 'attention', 'pending'][index])}
        />
      ))}
    </section>
  );
}

function NativeSummaryCard({ label, value, note, tag, icon: Icon, tone, selected, onClick }) {
  useDashboardLanguage();
  const animatedValue = useAnimatedNumber(value ?? 0, 850, value ?? 0);
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
            {value == null ? '—' : Math.round(animatedValue)}
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
  query,
  tab,
  onTab,
  onSelect,
  listRef,
  loadMoreRef,
  hasMore,
  pageLoading,
  onScroll,
}) {
  useDashboardLanguage();
  // Badge 使用字符串 "0" 保留数位 DOM；数值 0 会被 AntD 渲染成静态文本。
  const [badgeTotal, setBadgeTotal] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBadgeTotal(total);
      return undefined;
    }
    // Native 的总数可在首屏挂载前已知；先绘制初值，再触发 AntD 与 Classic 相同的数位滚动。
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setBadgeTotal(total));
    });
    return () => cancelAnimationFrame(frame);
  }, [total]);
  const [expandedParents, setExpandedParents] = useState(() => new Set());
  const knownParentsRef = useRef(new Set());
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const parentKeys = new Set(
      changes.filter((change) => change.children?.length).map((change) => changeKey(change)),
    );
    // 状态更新可延后执行，先保存更新 ref 之前的父任务集合。
    const knownParents = knownParentsRef.current;
    setExpandedParents((current) => {
      const next = new Set([...current].filter((key) => parentKeys.has(key)));
      for (const change of changes) {
        const children = change.children ?? [];
        if (children.length === 0) continue;
        const key = changeKey(change);
        const isNew = !knownParents.has(key);
        const selectedChild = children.some((child) => child.locator === selectedKey);
        const matchingChild =
          normalizedQuery &&
          children.some((child) =>
            [child.name, child.workspace?.label, child.workspace?.branch, child.message]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(normalizedQuery),
          );
        if (
          selectedChild ||
          matchingChild ||
          (isNew &&
            change.status === 'active' &&
            children.some(({ status }) => !RESOLVED_CHILD_STATUSES.has(status)))
        ) {
          next.add(key);
        }
      }
      return next;
    });
    knownParentsRef.current = parentKeys;
  }, [changes, normalizedQuery, selectedKey]);

  const toggleParent = useCallback((key) => {
    setExpandedParents((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <aside className="native-changes-explorer flex min-h-0 flex-col rounded-lg border border-border bg-bg shadow-raised">
      <div className="native-changes-explorer-header flex flex-none items-center border-b border-border-soft">
        <h3 className="font-semibold">
          Changes Explorer{' '}
          <Badge count={String(badgeTotal)} showZero className="native-changes-count ml-2" />
        </h3>
      </div>
      <div className="native-changes-explorer-body flex min-h-0 flex-1 flex-col">
        <div className="native-changes-explorer-tabs mb-4 flex flex-none items-end gap-8 border-b border-border-soft">
          {[
            ['active', t('活跃')],
            ['archived', t('已归档')],
            ['all', t('全部')],
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
              <NativeChangeListSkeleton />
            ) : (
              <div className="py-8 text-center text-sm text-muted">
                {tab === 'active'
                  ? t('暂无活跃变更')
                  : tab === 'archived'
                    ? t('暂无已归档变更')
                    : t('没有匹配的 Native change')}
              </div>
            )
          ) : (
            changes.map((change) => {
              const children = change.children ?? [];
              const hasChildren = children.length > 0;
              const key = changeKey(change);
              const expanded = hasChildren && expandedParents.has(key);
              const progress = childrenProgress(change) ?? acceptanceProgress(change);
              const statusPresentation = nativeChangeStatusPresentation(change);
              const childrenId = `native-children-${change.workspace?.id ?? 'local'}-${change.name.replace(/[^a-z0-9_-]/giu, '-')}`;
              const selectedChild = children.some((child) => child.locator === selectedKey);
              return (
                <div
                  key={key}
                  className={`native-change-list-item ${key === selectedKey ? 'selected' : ''} ${selectedChild ? 'has-selected-child' : ''}`}
                >
                  <div className="native-change-row-shell">
                    {hasChildren ? (
                      <button
                        type="button"
                        className="native-change-disclosure"
                        aria-label={t('{0} {1} 的子变更', [
                          expanded ? t('收起') : t('展开'),
                          change.name,
                        ])}
                        aria-expanded={expanded}
                        aria-controls={childrenId}
                        onClick={() => toggleParent(key)}
                      >
                        {expanded ? <DownOutlined /> : <RightOutlined />}
                      </button>
                    ) : (
                      <span className="native-change-disclosure-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="native-change-row"
                      onClick={() => onSelect(change)}
                    >
                      <div className="flex w-full items-center gap-2.5 text-left">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{change.name}</div>
                          <div className="mt-1 truncate whitespace-nowrap text-xs text-meta">
                            {PHASE_LABELS[change.phase] ?? t('状态异常')}
                            {hasChildren
                              ? t(' · {0}/{1} 子变更', [progress.resolved, progress.total])
                              : change.loop
                                ? t(' · {0} · 第{1}轮/第{2}次', [
                                    LOOP_STAGE_LABELS[change.loop.stage],
                                    change.loop.iteration,
                                    change.loop.attempt,
                                  ])
                                : ''}
                          </div>
                          {change.workspace && !change.workspace.current ? (
                            <span className="dashboard-workspace-label mt-1 inline-flex max-w-full truncate">
                              {change.workspace.label}
                            </span>
                          ) : null}
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
                        <Pill tone={statusPresentation.tone}>{statusPresentation.label}</Pill>
                      </div>
                    </button>
                  </div>
                  {expanded ? (
                    <div id={childrenId} className="native-child-change-list" role="group">
                      {children.map((child) => {
                        const reference = childChangeReference(child);
                        const childSelected = child.locator === selectedKey;
                        return (
                          <button
                            key={child.name}
                            type="button"
                            className={`native-child-change-row ${childSelected ? 'selected' : ''}`}
                            disabled={!reference}
                            title={child.message ?? undefined}
                            onClick={() => reference && onSelect(reference)}
                          >
                            <span
                              className={`native-child-status-dot native-child-status-${child.status}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 text-left">
                              <strong className="block truncate font-medium">{child.name}</strong>
                              <span className="mt-0.5 block truncate text-[11px] text-meta">
                                {child.phase
                                  ? (PHASE_LABELS[child.phase] ?? child.phase)
                                  : (CHILD_STATUS_DESCRIPTIONS[child.status] ??
                                    t('阶段信息不可用'))}
                                {child.workspace?.label ? ` · ${child.workspace.label}` : ''}
                              </span>
                            </span>
                            <Pill tone={CHILD_STATUS_TONES[child.status] ?? 'neutral'}>
                              {CHILD_STATUS_LABELS[child.status] ?? child.status}
                            </Pill>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {hasMore && changes.length > 0 && (
            <div
              ref={loadMoreRef}
              className="py-2 text-center text-xs text-meta"
              aria-live="polite"
            >
              {pageLoading ? <NativeChangeListSkeleton compact /> : t('继续下滑加载更多')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NativeChangeListSkeleton({ compact = false }) {
  useDashboardLanguage();
  return (
    <div
      className={`native-change-list-skeleton ${compact ? 'is-compact' : ''}`}
      aria-label={compact ? t('正在加载更多 Native 变更') : t('正在加载 Native 变更列表')}
      aria-busy="true"
    >
      <Skeleton
        active
        title={{ width: compact ? '36%' : '48%' }}
        paragraph={{
          rows: compact ? 1 : 6,
          width: compact ? '72%' : ['76%', '58%', '88%', '66%', '82%', '54%'],
        }}
      />
    </div>
  );
}

const NativeChangeDetail = React.memo(function NativeChangeDetail({
  change,
  onPreview,
  onCopyChangeName,
}) {
  useDashboardLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [change.name]);
  return (
    <section className="native-change-detail min-w-0 rounded-lg border border-border bg-bg shadow-raised">
      <div className="flex items-start gap-4 border-b border-border-soft px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-semibold">{change.name}</h3>
            <Tooltip title={t('复制 Change 名称')}>
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                aria-label={copied ? t('已复制 Change 名称') : t('复制 Change 名称')}
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
                ? t('归档于 {0}', [change.archivedAt ?? t('未知时间')])
                : `state v${change.stateVersion ?? '—'}`}
            </span>
            <span>{MIGRATION_LABELS[change.migration?.status] ?? t('状态未知')}</span>
            {change.loop?.actor && (
              <span>
                {t('当前执行者 ')}
                {ACTOR_LABELS[change.loop.actor]}
              </span>
            )}
          </div>
        </div>
        <Pill tone={phaseTone(change.phase)}>{PHASE_LABELS[change.phase] ?? t('状态异常')}</Pill>
      </div>
      <div className="space-y-5 p-5">
        <NativePhaseStepper change={change} />
        <NativeArtifactList artifacts={change.artifacts} onPreview={onPreview} />
        <div className="grid gap-4 lg:grid-cols-2">
          <NativeLoopRecoveryCard change={change} />
          <NativeScopeCard change={change} />
        </div>
        <NativeAcceptanceCard key={changeKey(change)} change={change} />
        <NativeVerificationCard key={changeKey(change)} change={change} />
        <NativeBlockersCard blockers={nativeChangeBlockers(change)} />
        <NativeHistoryCard
          key={changeKey(change)}
          history={change.history ?? []}
          overflow={change.historyOverflow}
        />
      </div>
    </section>
  );
});

function NativeChangeDetailSkeleton() {
  useDashboardLanguage();
  return (
    <section
      className="native-change-detail native-change-detail-skeleton min-w-0 rounded-lg border border-border bg-bg shadow-raised"
      aria-label={t('正在加载 Native 变更详情')}
      aria-busy="true"
    >
      <div className="border-b border-border-soft px-5 py-5">
        <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 1, width: '58%' }} />
      </div>
      <div className="space-y-6 p-5">
        <Skeleton active title={{ width: '24%' }} paragraph={{ rows: 3 }} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton active title={{ width: '42%' }} paragraph={{ rows: 4 }} />
          <Skeleton active title={{ width: '42%' }} paragraph={{ rows: 4 }} />
        </div>
        <Skeleton active title={{ width: '28%' }} paragraph={{ rows: 4 }} />
      </div>
    </section>
  );
}

function NativeLoopRecoveryCard({ change }) {
  useDashboardLanguage();
  const loop = change.loop;
  const local = change.localExecution;
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('循环与恢复')}</h4>
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
            ? t('正在执行')
            : (LOCAL_REASON_LABELS[local?.reason] ?? t('状态未知'))}
        </Pill>
      </div>
      {loop ? (
        <dl className="space-y-3 text-sm">
          <SideFact label={t('循环阶段')} value={LOOP_STAGE_LABELS[loop.stage] ?? loop.stage} />
          <SideFact label="Goal cycle" value={`${loop.goalCycle}`} />
          <SideFact label={t('轮次 / 尝试')} value={`${loop.iteration} / ${loop.attempt}`} />
          <SideFact label={t('执行者')} value={ACTOR_LABELS[loop.actor] ?? t('当前无执行者')} />
          <SideFact label={t('检查请求轮次')} value={`${local?.requestCheckRounds ?? 0}`} />
        </dl>
      ) : (
        <p className="text-sm leading-relaxed text-muted">
          {t('旧版归档不包含可移植 Loop 状态。')}
        </p>
      )}
      <div className="mt-4 rounded-lg bg-surface-warm px-3 py-3">
        <div className="text-[11px] font-medium text-meta">{t('恢复依据与下一步')}</div>
        <div className="mt-1 text-xs font-medium leading-relaxed text-fg-2">
          {local?.recoverableFromStage
            ? t('可从 YAML 的 {0} 阶段恢复。', [
                LOOP_STAGE_LABELS[local.recoverableFromStage] ?? local.recoverableFromStage,
              ])
            : (loop?.nextAction ?? LOCAL_REASON_LABELS[local?.reason] ?? t('无后续动作。'))}
        </div>
      </div>
      {change.builderHandoff && (
        <div className="mt-3 border-t border-border-soft pt-3 text-xs">
          <div className="font-medium text-meta">
            {t('Builder handoff · 第 ')}
            {change.builderHandoff.iteration}
            {t(' 轮')}
          </div>
          <p className="mt-1 leading-relaxed text-fg-2">
            {portableText(change.builderHandoff.summary)}
          </p>
        </div>
      )}
      {(local?.checks ?? []).length > 0 && (
        <div className="mt-3 text-xs text-meta">
          {t('本机检查摘要：')}
          {local.checks.filter((check) => check.status === 'passed').length}
          {t(' 通过 /')} {local.checks.filter((check) => check.status === 'failed').length}
          {t(' 失败 /')}{' '}
          {local.checks.filter((check) => ['planned', 'running'].includes(check.status)).length}{' '}
          {t('进行中')}
        </div>
      )}
    </article>
  );
}

function NativeScopeCard({ change }) {
  useDashboardLanguage();
  const specs = change.specs;
  const capabilities = specs?.capabilities ?? [];
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('变更范围')}</h4>
        <span className="rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {specs?.total ?? 0}
          {t(' 个 capability')}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <ScopeMetric label={t('新增')} value={specs?.create ?? 0} tone="info" />
        <ScopeMetric label={t('修改')} value={specs?.modify ?? 0} tone="warn" />
        <ScopeMetric label={t('删除')} value={specs?.remove ?? 0} tone="danger" />
      </div>
      <div className="mt-4 space-y-2">
        {capabilities.length === 0 ? (
          <p className="rounded-lg bg-surface-warm px-3 py-3 text-xs text-muted">
            {t('尚未声明 Spec 变更。')}
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
  useDashboardLanguage();
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

function useDetailPage(items) {
  const [page, setPage] = useState(1);
  const current = Math.min(page, Math.max(1, Math.ceil(items.length / 20)));
  return {
    items: items.slice((current - 1) * 20, current * 20),
    pagination:
      items.length > 20 ? (
        <Pagination
          className="mt-3"
          size="small"
          current={current}
          pageSize={20}
          total={items.length}
          showSizeChanger={false}
          onChange={setPage}
        />
      ) : null,
  };
}

function NativeAcceptanceCard({ change }) {
  useDashboardLanguage();
  const acceptance = change.acceptance;
  const progress = acceptanceProgress(change);
  const page = useDetailPage(change.acceptanceItems ?? []);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('验收状态')}</h4>
        <Pill tone={acceptanceTone(acceptance)}>
          {progress ? t('{0}% 已处理', [progress.percent]) : t('无可移植验收数据')}
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
        <AcceptanceMetric label={t('通过')} value={acceptance?.passed ?? 0} />
        <AcceptanceMetric label={t('失败')} value={acceptance?.failed ?? 0} />
        <AcceptanceMetric label={t('阻塞')} value={acceptance?.blocked ?? 0} />
        <AcceptanceMetric label={t('待验证')} value={acceptance?.pending ?? 0} />
      </div>
      {(change.acceptanceItems ?? []).length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-border-soft pt-4">
          {page.items.map((item) => (
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
      {page.pagination}
    </article>
  );
}

function AcceptanceMetric({ label, value }) {
  useDashboardLanguage();
  return (
    <div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-meta">{label}</div>
    </div>
  );
}

function NativeVerificationCard({ change }) {
  useDashboardLanguage();
  const checks = change.checks ?? [];
  const page = useDetailPage(checks);
  const assurance = assurancePresentation(change);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('检查结果')}</h4>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {assurance && (
            <Tooltip title={assurance.description}>
              <span>
                <Pill tone={assurance.tone}>{assurance.label}</Pill>
              </span>
            </Tooltip>
          )}
          <Pill tone={verificationTone(change.verificationResult)}>
            {VERIFICATION_LABELS[change.verificationResult] ?? t('状态未知')}
          </Pill>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-fg-2">
        {portableText(change.verification?.summary, t('尚无 Verifier 结论。'))}
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
            {t('尚无持久化检查摘要。')}
          </p>
        ) : (
          page.items.map((check) => (
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
      {page.pagination}
    </article>
  );
}

function NativeBlockersCard({ blockers }) {
  useDashboardLanguage();
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('阻塞项')}</h4>
        <Pill tone={blockers.length ? 'danger' : 'ok'}>
          {blockers.length ? t('{0} 项', [blockers.length]) : t('无阻塞')}
        </Pill>
      </div>
      {blockers.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('当前没有持久化阻塞项。')}</p>
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
                {t('验收：')}
                {blocker.acceptanceIds.join(', ') || '—'}
                {t(' · 处理：')}
                {blocker.resolutionAction}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function NativeHistoryCard({ history, overflow }) {
  useDashboardLanguage();
  const page = useDetailPage(history);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{t('执行历史')}</h4>
        <span className="font-mono text-xs text-meta">
          {t('保留 ')}
          {history.length}
          {t(' 条')}
        </span>
      </div>
      {overflow?.droppedEntries > 0 && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {t('更早的 ')}
          {overflow.droppedEntries}
          {t(' 条历史已汇总，时间范围')} {formatTimestamp(overflow.firstDroppedAt)}
          {t(' 至 ')}
          {formatTimestamp(overflow.lastDroppedAt)}。
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('尚无完成的循环记录。')}</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {page.items.map((entry, index) => (
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
      {page.pagination}
    </article>
  );
}

function NativeArtifactList({ artifacts, onPreview }) {
  useDashboardLanguage();
  const source = artifacts ?? [];
  const ready = source.filter((artifact) => artifact.exists).length;
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">{t('关键产物')}</h4>
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
                {artifact.exists ? t(artifact.label) : t('未生成')}
              </span>
            </button>
          ))}
          {source.length === 0 && (
            <div className="py-6 text-center text-sm text-muted">{t('暂无可预览产物')}</div>
          )}
        </div>
      </div>
    </article>
  );
}

function NativePhaseStepper({ change }) {
  useDashboardLanguage();
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === change.phase),
  );
  const archived = change.status === 'archived';
  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-sm font-semibold">{t('生命周期阶段')}</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? t('已归档') : t('当前 {0}', [PHASE_LABELS[change.phase] ?? t('状态异常')])}
        </span>
      </div>
      <WorkflowPhaseTrack
        phases={PHASES}
        currentIndex={currentIndex}
        archived={archived}
        currentPhaseRunning={isNativePhaseRunning(change)}
        ariaLabel={t('Native 生命周期阶段')}
      />
      {change.loop && (
        <p className="mt-4 text-center text-xs text-meta">
          Build ↔ Verify Loop · {LOOP_STAGE_LABELS[change.loop.stage]}
          {t(' · 第 ')}
          {change.loop.iteration} {t('轮 / 第 ')}
          {change.loop.attempt}
          {t(' 次')}
        </p>
      )}
    </article>
  );
}

function NativeSidePanel({ change, git }) {
  useDashboardLanguage();
  const local = change.localExecution;
  const blockers = nativeChangeBlockers(change);
  return (
    <aside className="space-y-5">
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('恢复状态')}</h3>
          <Pill tone={local?.status === 'running' ? 'info' : 'neutral'}>
            {local?.status === 'running' ? t('执行中') : t('YAML 稳定边界')}
          </Pill>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <SideFact
            label={t('本机状态')}
            value={LOCAL_REASON_LABELS[local?.reason] ?? t('状态未知')}
          />
          <SideFact
            label={t('执行阶段')}
            value={local?.stage ? (LOCAL_STAGE_LABELS[local.stage] ?? local.stage) : '—'}
          />
          <SideFact label={t('执行者')} value={ACTOR_LABELS[local?.actor] ?? '—'} />
          <SideFact
            label={t('可恢复阶段')}
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
          <h3 className="text-sm font-semibold">{t('当前阻塞')}</h3>
          <Pill tone={blockers.length ? 'danger' : 'ok'}>
            {blockers.length ? t('{0} 项', [blockers.length]) : t('无')}
          </Pill>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {blockers.length ? portableText(blockers[0].reason) : t('当前没有阻止 Loop 前进的事项。')}
        </p>
      </section>
      {git && (
        <section className="rounded-lg bg-bg p-5 shadow-raised">
          <h3 className="text-sm font-semibold">{t('Git 摘要')}</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <SideFact label={t('分支')} value={git.branch ?? '—'} />
            <SideFact label="HEAD" value={git.head ?? '—'} />
            <SideFact label={t('未提交文件')} value={t('{0} 个', [git.dirtyFiles ?? 0])} />
          </dl>
        </section>
      )}
    </aside>
  );
}

function NativeSidePanelSkeleton() {
  useDashboardLanguage();
  return (
    <aside
      className="native-side-panel-skeleton space-y-5"
      aria-label={t('正在加载 Native 变更侧栏')}
      aria-busy="true"
    >
      {[3, 2, 3].map((rows, index) => (
        <section key={index} className="rounded-lg bg-bg p-5 shadow-raised">
          <Skeleton active title={{ width: '42%' }} paragraph={{ rows }} />
        </section>
      ))}
    </aside>
  );
}

function SideFact({ label, value }) {
  useDashboardLanguage();
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-soft pb-3 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg-2">{value}</dd>
    </div>
  );
}

function Pill({ tone = 'neutral', children }) {
  useDashboardLanguage();
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
  if (operation === 'create') return t('新增');
  if (operation === 'modify') return t('修改');
  if (operation === 'remove') return t('删除');
  return t('未知操作');
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
  return new Intl.DateTimeFormat(getDashboardLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const RESOLVED_CHILD_STATUSES = new Set(['done', 'verified', 'integrated', 'archived']);

function childrenProgress(change) {
  const children = change.children ?? [];
  if (children.length === 0) return null;
  const resolved = children.filter(({ status }) => RESOLVED_CHILD_STATUSES.has(status)).length;
  return {
    resolved,
    total: children.length,
    percent: Math.round((resolved / children.length) * 100),
    complete: resolved === children.length,
  };
}
