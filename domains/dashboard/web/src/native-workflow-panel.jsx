import { ReferenceIcon } from './reference-icon.jsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  DownOutlined,
  FlagOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Card, Skeleton, Statistic, Tabs, Tooltip } from 'antd';
import {
  isNativePhaseRunning,
  nativeChangeStatusPresentation,
  nativePhaseIconStatuses,
  nativePhaseStatuses,
} from './native-status-presentation.js';
import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
import {
  DashboardChangeDetail,
  DashboardExplorerRowContent,
  DashboardExplorerRowTooltip,
  DashboardExplorerTitle,
  DashboardWorkspaceRegion,
} from './workspace-layout.jsx';
import { AnimatedNumber, useNumberTransition } from './number-transition.jsx';

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
  pass: '验收通过',
  fail: '验证失败',
  blocked: '验证阻塞',
};
const ASSURANCE_PRESENTATION = {
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
};
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
      label: '已完成检查，验证结果已确认',
      description: '检查已完成，你已经确认接受这次验证结果。',
    };
  }
  return presentation;
}
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
const CHILD_STATUS_LABELS = {
  pending: '等待依赖',
  ready: '可开始',
  active: '进行中',
  done: '已完成',
  verified: '已验收',
  integrated: '已集成',
  archived: '已归档',
  'needs-reverify': '需要重新验收',
  blocked: '已阻塞',
};
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
  native,
  numberIdentity,
  numberEntryKey = null,
  onNumberEntryComplete,
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
  const paginationIdentity = JSON.stringify([normalizedQuery, serverPaged, tab]);
  const [resetPaginationIdentity, setResetPaginationIdentity] = useState(paginationIdentity);
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
  }, [native, normalizedQuery, pagedChanges, serverPaged, tab]);
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    setVisibleChangeCount(NATIVE_CHANGE_PAGE_SIZE);
    setResetPaginationIdentity(paginationIdentity);
  }, [paginationIdentity]);

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
    [serverPaged, sourceChanges, visibleChangeCount],
  );
  const hasMoreChanges = serverPaged ? hasMore : visibleChanges.length < sourceChanges.length;
  const selectableChanges = useMemo(
    () =>
      visibleChanges.flatMap((change) => [
        change,
        ...(change.children ?? []).map(childChangeReference).filter(Boolean),
      ]),
    [visibleChanges],
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
  useEffect(() => {
    if (selectedSummary) onSelect?.(selectedSummary);
  }, [onSelect, selectedSummary]);
  const selected = serverPaged
    ? selectedDetail && selectedSummary && changeKey(selectedDetail) === changeKey(selectedSummary)
      ? selectedDetail
      : null
    : selectedSummary;
  const detailPending = Boolean(selectedSummary && !selected && (detailLoading || !detailError));
  const hasNativeChanges = Boolean(native && native.totalChangeCount > 0);
  const isEmptyView = !pageLoading && visibleChanges.length === 0;
  const isLoadingView = pageLoading && visibleChanges.length === 0;
  const summaryNumberIdentity = serverPaged
    ? numberIdentity
    : JSON.stringify([numberIdentity, resetPaginationIdentity === paginationIdentity]);
  const numberPageReady = !pageLoading || visibleChanges.length > 0;
  const numberEntryRef = useRef(null);
  if (numberEntryKey !== null && numberEntryRef.current?.key !== numberEntryKey) {
    numberEntryRef.current = { key: numberEntryKey, rowKeys: null, selectedKey: null };
  }
  if (numberEntryKey !== null && numberPageReady && numberEntryRef.current.rowKeys === null) {
    numberEntryRef.current.rowKeys = new Set(visibleChanges.map(changeKey));
    numberEntryRef.current.selectedKey = selectedSummary ? changeKey(selectedSummary) : null;
  }
  const numberEntrySelection = numberEntryRef.current?.selectedKey;
  const detailNumberEntryKey =
    numberEntryKey !== null && selected && changeKey(selected) === numberEntrySelection
      ? numberEntryKey
      : null;
  const numberEntryDetailReady =
    !numberEntrySelection ||
    Boolean(selected && changeKey(selected) === numberEntrySelection) ||
    Boolean(detailError?.change && changeKey(detailError.change) === numberEntrySelection) ||
    !selectableChanges.some((change) => changeKey(change) === numberEntrySelection);
  useEffect(() => {
    if (numberEntryKey !== null && (!native || (numberPageReady && numberEntryDetailReady))) {
      onNumberEntryComplete?.(numberEntryKey);
    }
  }, [native, numberEntryKey, numberEntryDetailReady, numberPageReady, onNumberEntryComplete]);

  return (
    <div className="mx-auto min-w-0">
      <NativeSummaryCards
        native={native}
        loadedChanges={visibleChanges}
        numberIdentity={summaryNumberIdentity}
        numberEntryKey={numberEntryKey}
        numberPageReady={numberPageReady}
      />
      <DashboardWorkspaceRegion
        stableFrame
        leftClassName="native-workspace-left"
        left={
          <NativeChangesExplorer
            changes={visibleChanges}
            numberIdentity={numberIdentity}
            numberEntryKey={numberEntryKey}
            numberEntryRows={numberEntryRef.current?.rowKeys}
            total={serverPaged ? (total ?? sourceChanges.length) : sourceChanges.length}
            selectedKey={selectedSummary ? changeKey(selectedSummary) : null}
            query={query}
            tab={tab}
            onTab={onTab}
            onSelect={(change) => {
              if (numberEntryKey !== null) onNumberEntryComplete?.(numberEntryKey);
              setSelectedKey(changeKey(change));
            }}
            listRef={listRef}
            loadMoreRef={loadMoreRef}
            hasMore={hasMoreChanges}
            pageLoading={pageLoading}
            onScroll={handleListScroll}
          />
        }
        center={
          isEmptyView ? (
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
              numberIdentity={JSON.stringify([numberIdentity, changeKey(selected)])}
              numberEntryKey={detailNumberEntryKey}
              onPreview={onPreview}
              onCopyChangeName={onCopyChangeName}
            />
          ) : detailError ? (
            <DashboardChangeDetail
              className="native-change-detail dashboard-change-detail-loading"
              title="Native 变更详情"
            >
              <div className="text-center text-sm text-danger">
                <p role="alert">Native 变更详情加载失败：{detailError.reason}</p>
                <Button className="mt-4" onClick={onRetryDetail}>
                  重新加载
                </Button>
              </div>
            </DashboardChangeDetail>
          ) : (
            <NativeEmptyChangeDetail native={native} tab={tab} query={query} onTab={onTab} />
          )
        }
      />
    </div>
  );
}

function NativeEmptyChangeDetail({ native, tab, query = '', onTab, emptyProject = false }) {
  const hasArchivedChanges = (native?.archivedChangeCount ?? 0) > 0;
  const hasActiveChanges = (native?.activeChangeCount ?? 0) > 0;
  const showArchiveShortcut = tab === 'active' && !query.trim() && hasArchivedChanges;
  const showActiveShortcut = tab === 'archived' && !query.trim() && hasActiveChanges;
  const title = emptyProject
    ? '还没有 Native change'
    : showArchiveShortcut
      ? '当前没有活跃的 Native change'
      : showActiveShortcut
        ? '还没有已归档的 Native change'
        : '没有匹配的 Native change';
  const description = emptyProject
    ? '启动 Native 工作流后，变更进度、验收结果和恢复状态会集中显示在这里。'
    : showArchiveShortcut
      ? '当前工作区没有进行中的变更，你可以继续查看已归档的历史记录。'
      : showActiveShortcut
        ? '当前还没有归档记录，你可以返回查看正在进行的变更。'
        : '调整顶部搜索条件，或切换变更范围后再试。';
  return (
    <DashboardChangeDetail
      className="native-change-detail native-change-detail-empty dashboard-change-detail-empty"
      title={<h3 className="m-0 text-sm font-semibold">{title}</h3>}
    >
      <div className="dashboard-workspace-empty-detail text-center">
        <span className="native-workspace-empty-icon" aria-hidden="true">
          <FlagOutlined />
        </span>
        <p>{description}</p>
        {showArchiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab?.('archived')}>
            查看已归档变更
          </Button>
        ) : showActiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab?.('active')}>
            查看活跃变更
          </Button>
        ) : null}
      </div>
    </DashboardChangeDetail>
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
      <h4 className="dashboard-priority-title dashboard-detail-section-title">
        <BulbOutlined aria-hidden="true" />
        下一步建议
      </h4>
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

function NativeSummaryCards({
  native,
  loadedChanges = [],
  numberIdentity,
  numberEntryKey,
  numberPageReady,
}) {
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
          numberIdentity={numberIdentity}
          numberEntryKey={index === 0 || numberPageReady ? numberEntryKey : null}
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

function NativeSummaryCard({
  label,
  value,
  numberIdentity,
  numberEntryKey,
  note,
  tag,
  icon: Icon,
  tone,
  selected,
  onClick,
}) {
  const displayedValue = useNumberTransition(value, numberIdentity, numberEntryKey);
  return (
    <Card
      size="small"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label} ${value} ${note} ${tag}`}
      className={`dashboard-overview-summary-card dashboard-summary-card dashboard-summary-metric-cell ${tone} ${selected ? 'dashboard-summary-primary' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="dashboard-summary-card-top">
        <Statistic
          title={
            <>
              <div className="dashboard-summary-title">
                <span className="dashboard-summary-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span>{label}</span>
                <span className="dashboard-summary-status">{tag}</span>
              </div>
              <div className="dashboard-summary-note">{note}</div>
            </>
          }
          value={displayedValue}
          classNames={{ content: 'dashboard-summary-metric' }}
          styles={{ content: { minWidth: `${value.toLocaleString('en-US').length}ch` } }}
        />
      </div>
    </Card>
  );
}

function NativeChangesExplorer({
  changes,
  numberIdentity,
  numberEntryKey,
  numberEntryRows,
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
  const [expandedParents, setExpandedParents] = useState(() => new Set());
  const knownParentsRef = useRef(new Set());
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const parentKeys = new Set(
      changes.filter((change) => change.children?.length).map((change) => changeKey(change)),
    );
    setExpandedParents((current) => {
      const next = new Set([...current].filter((key) => parentKeys.has(key)));
      for (const change of changes) {
        const children = change.children ?? [];
        if (children.length === 0) continue;
        const key = changeKey(change);
        const isNew = !knownParentsRef.current.has(key);
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
    <aside className="dashboard-changes-explorer native-changes-explorer flex min-h-0 flex-col rounded-lg border border-border bg-bg shadow-raised">
      <div className="native-changes-explorer-header flex flex-none items-center border-b border-border-soft">
        <DashboardExplorerTitle count={total} badgeClassName="native-changes-count" />
      </div>
      <div className="native-changes-explorer-body flex min-h-0 flex-1 flex-col">
        <Tabs
          className="native-changes-explorer-tabs"
          activeKey={tab}
          onChange={onTab}
          tabBarGutter={24}
          items={[
            { key: 'active', label: '活跃' },
            { key: 'archived', label: '已归档' },
            { key: 'all', label: '全部' },
          ]}
        />
        <div
          ref={listRef}
          className="native-change-list min-h-0 flex-1 overflow-y-auto"
          onScroll={onScroll}
        >
          {changes.length === 0 ? (
            pageLoading ? (
              <NativeChangeListSkeleton />
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
              const children = change.children ?? [];
              const hasChildren = children.length > 0;
              const key = changeKey(change);
              const changeNumberIdentity = JSON.stringify([numberIdentity, key]);
              const changeNumberEntryKey = numberEntryRows?.has(key) ? numberEntryKey : null;
              const expanded = hasChildren && expandedParents.has(key);
              const progress = childrenProgress(change);
              const statusPresentation = nativeChangeStatusPresentation(change);
              const childrenId = `native-children-${change.workspace?.id ?? 'local'}-${change.name.replace(/[^a-z0-9_-]/giu, '-')}`;
              return (
                <div key={key} className="native-change-list-item">
                  <div className="native-change-row-shell">
                    {hasChildren ? (
                      <button
                        type="button"
                        className="native-change-disclosure"
                        aria-label={`${expanded ? '收起' : '展开'} ${change.name} 的子变更`}
                        aria-expanded={expanded}
                        aria-controls={childrenId}
                        onClick={() => toggleParent(key)}
                      >
                        {expanded ? <DownOutlined /> : <RightOutlined />}
                      </button>
                    ) : (
                      <span className="native-change-disclosure-spacer" aria-hidden="true" />
                    )}
                    <DashboardExplorerRowTooltip
                      name={change.name}
                      status={statusPresentation.label}
                      workspace={
                        change.workspace && !change.workspace.current ? change.workspace : null
                      }
                    >
                      <button
                        type="button"
                        className={`native-change-row dashboard-explorer-row ${key === selectedKey ? 'selected' : ''}`}
                        aria-pressed={key === selectedKey}
                        onClick={() => onSelect(change)}
                      >
                        <DashboardExplorerRowContent
                          name={change.name}
                          count={
                            progress ? (
                              <>
                                子变更{' '}
                                <AnimatedNumber
                                  value={progress.resolved}
                                  identity={changeNumberIdentity}
                                  numberEntryKey={changeNumberEntryKey}
                                />
                                /
                                <AnimatedNumber
                                  value={progress.total}
                                  identity={changeNumberIdentity}
                                  numberEntryKey={changeNumberEntryKey}
                                />
                              </>
                            ) : null
                          }
                          status={
                            <Pill tone={statusPresentation.tone}>{statusPresentation.label}</Pill>
                          }
                        />
                      </button>
                    </DashboardExplorerRowTooltip>
                  </div>
                  {expanded ? (
                    <div id={childrenId} className="native-child-change-list" role="group">
                      {children.map((child) => {
                        const reference = childChangeReference(child);
                        const childSelected = child.locator === selectedKey;
                        const childStatus = CHILD_STATUS_LABELS[child.status] ?? child.status;
                        return (
                          <DashboardExplorerRowTooltip
                            key={child.name}
                            name={child.name}
                            status={childStatus}
                            workspace={child.workspace}
                            message={
                              child.message ??
                              (!reference ? '无法定位子变更，详情暂不可用' : undefined)
                            }
                          >
                            <button
                              type="button"
                              className={`native-child-change-row dashboard-explorer-row ${childSelected ? 'selected' : ''}`}
                              aria-pressed={childSelected}
                              aria-disabled={!reference}
                              onClick={() => reference && onSelect(reference)}
                            >
                              <DashboardExplorerRowContent
                                name={child.name}
                                status={
                                  <Pill tone={CHILD_STATUS_TONES[child.status] ?? 'neutral'}>
                                    {childStatus}
                                  </Pill>
                                }
                              />
                            </button>
                          </DashboardExplorerRowTooltip>
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
              {pageLoading ? <NativeChangeListSkeleton compact /> : '继续下滑加载更多'}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NativeChangeListSkeleton({ compact = false }) {
  return (
    <div
      className={`native-change-list-skeleton ${compact ? 'is-compact' : ''}`}
      aria-label={compact ? '正在加载更多 Native 变更' : '正在加载 Native 变更列表'}
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

function NativeChangeDetail({
  change,
  numberIdentity,
  numberEntryKey,
  onPreview,
  onCopyChangeName,
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [change.name]);
  return (
    <DashboardChangeDetail
      className="native-change-detail"
      title={
        <>
          <h3 className="text-base font-semibold">当前变更 · {change.name}</h3>
          <Tooltip title="复制 Change 名称">
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <ReferenceIcon name="copy" />}
              aria-label={copied ? '已复制 Change 名称' : '复制 Change 名称'}
              onClick={() =>
                onCopyChangeName?.(change.name)?.then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                })
              }
            />
          </Tooltip>
        </>
      }
      meta={
        <>
          <span>native</span>
          <span>
            {change.status === 'archived'
              ? `归档于 ${change.archivedAt ?? '未知时间'}`
              : `state v${change.stateVersion ?? '—'}`}
          </span>
          <span>{MIGRATION_LABELS[change.migration?.status] ?? '状态未知'}</span>
          {change.loop?.actor && <span>当前执行者 {ACTOR_LABELS[change.loop.actor]}</span>}
        </>
      }
      extra={<Pill tone={phaseTone(change.phase)}>{PHASE_LABELS[change.phase] ?? '状态异常'}</Pill>}
    >
      <NativePhaseStepper change={change} />
      <div className="change-guidance">
        <NativeWorkflowSuggestion change={change} />
        <NativeBlockersCard blockers={change.blockers ?? []} />
      </div>
      <div className="native-detail-facts">
        <div>
          <NativeArtifactList artifacts={change.artifacts} onPreview={onPreview} />
          <NativeScopeCard
            change={change}
            numberIdentity={numberIdentity}
            numberEntryKey={numberEntryKey}
          />
        </div>
        <NativeLoopRecoveryCard change={change} />
        <NativeRecoveryStatus change={change} />
      </div>
      <NativeAcceptanceCard
        change={change}
        numberIdentity={numberIdentity}
        numberEntryKey={numberEntryKey}
      />
      <NativeVerificationCard change={change} />
      <NativeHistoryCard history={change.history ?? []} overflow={change.historyOverflow} />
    </DashboardChangeDetail>
  );
}

function NativeChangeDetailSkeleton() {
  return (
    <DashboardChangeDetail
      className="native-change-detail native-change-detail-skeleton"
      aria-label="正在加载 Native 变更详情"
      aria-busy="true"
      title={<Skeleton active title={{ width: '38%' }} paragraph={{ rows: 1, width: '58%' }} />}
    >
      <Skeleton active title={{ width: '24%' }} paragraph={{ rows: 3 }} />
      <div className="dashboard-detail-skeleton-panels">
        <Skeleton active title={{ width: '42%' }} paragraph={{ rows: 4 }} />
        <Skeleton active title={{ width: '42%' }} paragraph={{ rows: 4 }} />
      </div>
      <Skeleton active title={{ width: '28%' }} paragraph={{ rows: 4 }} />
    </DashboardChangeDetail>
  );
}

function NativeLoopRecoveryCard({ change }) {
  const loop = change.loop;
  const local = change.localExecution;
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">循环与恢复</h4>
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

function NativeScopeCard({ change, numberIdentity, numberEntryKey }) {
  const specs = change.specs;
  const capabilities = specs?.capabilities ?? [];
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">变更范围</h4>
        <span className="rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          <AnimatedNumber
            value={specs?.total ?? 0}
            identity={numberIdentity}
            numberEntryKey={numberEntryKey}
          />{' '}
          个 capability
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <ScopeMetric
          label="新增"
          value={specs?.create ?? 0}
          tone="info"
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <ScopeMetric
          label="修改"
          value={specs?.modify ?? 0}
          tone="warn"
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <ScopeMetric
          label="删除"
          value={specs?.remove ?? 0}
          tone="danger"
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
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

function ScopeMetric({ label, value, tone, numberIdentity, numberEntryKey }) {
  const toneClass = {
    info: 'bg-info-soft text-info',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return (
    <div className="rounded-lg bg-surface-warm px-2 py-3">
      <div className={`text-lg font-bold tabular-nums ${value ? toneClass : 'text-fg-2'}`}>
        <AnimatedNumber value={value} identity={numberIdentity} numberEntryKey={numberEntryKey} />
      </div>
      <div className="mt-1 text-[11px] text-meta">{label}</div>
    </div>
  );
}

function NativeAcceptanceCard({ change, numberIdentity, numberEntryKey }) {
  const acceptance = change.acceptance;
  const progress = acceptanceProgress(change);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="dashboard-detail-section-title">验收状态</h4>
        <Pill tone={acceptanceTone(acceptance)}>
          {progress ? (
            <>
              <AnimatedNumber
                value={progress.percent}
                identity={numberIdentity}
                numberEntryKey={numberEntryKey}
              />
              % 已处理
            </>
          ) : (
            '无可移植验收数据'
          )}
        </Pill>
      </div>
      {progress && (
        <div className="native-acceptance-progress mt-4 h-2 overflow-hidden rounded-full bg-surface">
          <span
            key={numberIdentity}
            className={`block h-full rounded-full transition-[width] ${progress.complete ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
      <div className="mt-4 grid grid-cols-4 gap-3 text-center">
        <AcceptanceMetric
          label="通过"
          value={acceptance?.passed ?? 0}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="失败"
          value={acceptance?.failed ?? 0}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="阻塞"
          value={acceptance?.blocked ?? 0}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="待验证"
          value={acceptance?.pending ?? 0}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
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

function AcceptanceMetric({ label, value, numberIdentity, numberEntryKey }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums">
        <AnimatedNumber value={value} identity={numberIdentity} numberEntryKey={numberEntryKey} />
      </div>
      <div className="mt-1 text-[11px] text-meta">{label}</div>
    </div>
  );
}

function NativeVerificationCard({ change }) {
  const checks = change.checks ?? [];
  const assurance = assurancePresentation(change);
  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">检查结果</h4>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {assurance && (
            <Tooltip title={assurance.description}>
              <span>
                <Pill tone={assurance.tone}>{assurance.label}</Pill>
              </span>
            </Tooltip>
          )}
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
    <article
      className={`native-blockers-card rounded-xl border border-border-soft bg-bg px-5 py-4${blockers.length ? ' has-blockers' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">当前阻塞</h4>
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
        <h4 className="dashboard-detail-section-title">执行历史</h4>
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
        <h4 className="dashboard-detail-section-title">关键产物</h4>
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
                <ReferenceIcon name="artifact" />
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
  return (
    <WorkflowPhaseTrack
      key={change.locator ?? change.name}
      phases={PHASES}
      phaseStatuses={nativePhaseStatuses(change)}
      phaseIconStatuses={nativePhaseIconStatuses(change)}
      currentPhase={change.phase}
      errorLabels={{ verify: change.verificationResult === 'blocked' ? '验证阻塞' : '验证失败' }}
      currentPhaseRunning={isNativePhaseRunning(change)}
      currentPhaseLabel={nativeChangeStatusPresentation(change).label}
      ariaLabel="Native 生命周期阶段"
    >
      {change.loop && (
        <p className="dashboard-phase-note">
          Build ↔ Verify Loop · {LOOP_STAGE_LABELS[change.loop.stage]} · 第 {change.loop.iteration}{' '}
          轮 / 第 {change.loop.attempt} 次
        </p>
      )}
    </WorkflowPhaseTrack>
  );
}

function NativeRecoveryStatus({ change }) {
  const local = change.localExecution;
  return (
    <aside className="native-recovery-status">
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h4 className="dashboard-detail-section-title">恢复状态</h4>
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
      className={`dashboard-status-pill inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
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

const RESOLVED_CHILD_STATUSES = new Set(['done', 'verified', 'integrated', 'archived']);

function childrenProgress(change) {
  const children = change.children ?? [];
  if (children.length === 0) return null;
  const resolved = children.filter(({ status }) => RESOLVED_CHILD_STATUSES.has(status)).length;
  return {
    resolved,
    total: children.length,
  };
}
