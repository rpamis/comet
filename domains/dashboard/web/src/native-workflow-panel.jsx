import { ReferenceIcon } from './reference-icon.jsx';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  FlagOutlined,
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
  DashboardExplorerFolderIcon,
  DashboardExplorerRowContent,
  DashboardExplorerRowTooltip,
  DashboardExplorerTitle,
  DashboardWorkspaceRegion,
} from './workspace-layout.jsx';
import { AnimatedNumber, useNumberTransition } from './number-transition.jsx';
import { useExplorerPagination } from './use-explorer-pagination.js';
import { DashboardChangeSuggestion } from './change-suggestion.jsx';

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
const CHILD_STATUS_DESCRIPTIONS = {
  pending: '等待前置子任务完成',
  ready: '等待开始执行',
  active: '正在执行',
  done: '执行完成',
  verified: '验收通过',
  integrated: '已合入集成分支',
  archived: '归档完成',
  'needs-reverify': '等待重新验收',
  blocked: '等待解除阻塞',
};
const NATIVE_CHANGE_PAGE_SIZE = 5;

function portableText(value, fallback = '—') {
  return value?.text || fallback;
}

function changeKey(change) {
  return change.locator ?? `${change.status}:${change.archiveName ?? ''}:${change.name}`;
}

function nativeChangeDescription(change, progress = null) {
  return `${PHASE_LABELS[change.phase] ?? '状态异常'}${
    progress
      ? ` · ${progress.resolved}/${progress.total} 子变更`
      : change.loop
        ? ` · ${LOOP_STAGE_LABELS[change.loop.stage]} · 第${change.loop.iteration}轮/第${change.loop.attempt}次`
        : ''
  }`;
}

function nativeChildDescription(child) {
  return (
    <>
      {child.phase
        ? (PHASE_LABELS[child.phase] ?? child.phase)
        : (CHILD_STATUS_DESCRIPTIONS[child.status] ?? '阶段信息不可用')}
      {child.workspace?.label ? ` · ${child.workspace.label}` : ''}
    </>
  );
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
  projectContext,
  scrollResetKey,
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
  onReadArtifact,
  onCopyChangeName,
}) {
  const serverPaged = Array.isArray(pagedChanges);
  const listRef = useRef(null);
  const loadMoreRef = useRef(null);
  const workspaceRef = useRef(null);
  const [detailHeight, setDetailHeight] = useState(0);
  const [explorerTitleHeight, setExplorerTitleHeight] = useState(48);
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
  const [detailTabSelection, setDetailTabSelection] = useState({
    changeKey: null,
    phase: undefined,
    defaultTab: 'acceptance',
    tab: 'acceptance',
  });

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
  const detailChangeKey = selectedSummary ? changeKey(selectedSummary) : null;
  const detailPhase = selected?.phase;
  const hasCurrentFailure =
    ['fail', 'blocked'].includes(selected?.verificationResult) ||
    (selected?.acceptance?.failed ?? 0) > 0 ||
    (selected?.acceptance?.blocked ?? 0) > 0 ||
    // 已通过后的用户确认阻塞不代表当前失败。
    (selected?.verificationResult !== 'pass' && (selected?.blockers?.length ?? 0) > 0) ||
    (['current', 'idle'].includes(selected?.localExecution?.reason) &&
      selected?.localExecution?.checks?.some((check) => check.status === 'failed'));
  const defaultDetailTab = hasCurrentFailure
    ? 'blockers'
    : detailPhase === 'shape' || detailPhase === 'build'
      ? 'details'
      : 'acceptance';
  const hasCurrentDetailTab =
    detailTabSelection.changeKey === detailChangeKey &&
    (!selected ||
      (detailTabSelection.phase === detailPhase &&
        detailTabSelection.defaultTab === defaultDetailTab));
  if (selectedSummary && !hasCurrentDetailTab) {
    setDetailTabSelection({
      changeKey: detailChangeKey,
      phase: detailPhase,
      defaultTab: defaultDetailTab,
      tab: defaultDetailTab,
    });
  }
  const detailTab = hasCurrentDetailTab ? detailTabSelection.tab : defaultDetailTab;
  const detailPending = Boolean(selectedSummary && !selected && (detailLoading || !detailError));
  const hasNativeChanges = Boolean(native && native.totalChangeCount > 0);
  const isEmptyView = !pageLoading && visibleChanges.length === 0;
  const isLoadingView = pageLoading && visibleChanges.length === 0;
  useLayoutEffect(() => {
    const detail = workspaceRef.current?.querySelector(
      '.native-change-shell .native-change-detail',
    );
    if (!detail) {
      setDetailHeight(0);
      setExplorerTitleHeight(48);
      return;
    }
    const shell = detail.closest('.native-change-shell');
    const detailHead = detail.querySelector(':scope > .ant-card-head');
    const explorerTabs = shell.querySelector('.native-changes-explorer .ant-tabs-nav');
    const measure = () => {
      const style = getComputedStyle(shell);
      const borders =
        Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      setDetailHeight(Math.ceil(detail.getBoundingClientRect().height + borders));
      setExplorerTitleHeight(
        Math.max(
          48,
          (detailHead?.getBoundingClientRect().height ?? 0) -
            (explorerTabs?.getBoundingClientRect().height ?? 0),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(detail);
    if (detailHead) observer.observe(detailHead);
    if (explorerTabs) observer.observe(explorerTabs);
    return () => observer.disconnect();
  }, [selected, detailTab, isEmptyView, isLoadingView, detailPending, detailError]);
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
    <div
      ref={workspaceRef}
      className="native-dashboard mx-auto min-w-0"
      style={{
        '--native-detail-height': `${detailHeight}px`,
        '--native-explorer-title-height': `${explorerTitleHeight}px`,
      }}
    >
      <NativeSummaryCards
        native={native}
        loadedChanges={visibleChanges}
        numberIdentity={summaryNumberIdentity}
        numberEntryKey={numberEntryKey}
        numberPageReady={numberPageReady}
      />
      <div className="native-change-workspace">
        <DashboardWorkspaceRegion
          className="native-change-overview native-change-shell"
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
              onLoadMore={loadMoreChanges}
              scrollResetKey={scrollResetKey ?? paginationIdentity}
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
                projectContext={projectContext}
              />
            ) : isLoadingView || detailPending ? (
              <NativeChangeDetailSkeleton projectContext={projectContext} />
            ) : selected ? (
              <NativeChangeDetail
                key={changeKey(selected)}
                change={selected}
                detailTab={detailTab}
                onDetailTabChange={(tab) =>
                  setDetailTabSelection({
                    changeKey: detailChangeKey,
                    phase: detailPhase,
                    defaultTab: defaultDetailTab,
                    tab,
                  })
                }
                numberIdentity={JSON.stringify([numberIdentity, changeKey(selected)])}
                numberEntryKey={detailNumberEntryKey}
                onPreview={onPreview}
                onReadArtifact={onReadArtifact}
                onCopyChangeName={onCopyChangeName}
                projectContext={projectContext}
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
                <NativeProjectGit projectContext={projectContext} />
              </DashboardChangeDetail>
            ) : (
              <NativeEmptyChangeDetail
                native={native}
                tab={tab}
                query={query}
                onTab={onTab}
                projectContext={projectContext}
              />
            )
          }
        />
        <aside className="native-project-context" aria-label="Native 执行与恢复">
          <NativeExecutionRecoveryCard
            key={`recovery:${selected ? changeKey(selected) : 'empty'}`}
            change={!isEmptyView && !detailPending ? selected : null}
            loading={isLoadingView || detailPending}
          />
        </aside>
      </div>
    </div>
  );
}

function NativeEmptyChangeDetail({
  native,
  tab,
  query = '',
  onTab,
  emptyProject = false,
  projectContext,
}) {
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
      <NativeProjectGit projectContext={projectContext} />
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
  if (change.blockers?.length) return `先处理当前 ${change.blockers.length} 项阻塞。`;
  if (change.status === 'archived') return '当前变更已经归档，可查看验收与循环历史。';
  return change.loop?.nextAction ?? 'Runtime 将根据当前 YAML 状态继续执行。';
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
  onLoadMore,
  scrollResetKey,
}) {
  const [expandedParents, setExpandedParents] = useState(() => new Set());
  const knownParentsRef = useRef(new Set());
  const knownQueryRef = useRef('');
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const parentKeys = new Set(
      changes.filter((change) => change.children?.length).map((change) => changeKey(change)),
    );
    const knownParents = knownParentsRef.current;
    const queryChanged = knownQueryRef.current !== normalizedQuery;
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
          (matchingChild && (isNew || queryChanged)) ||
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
    knownQueryRef.current = normalizedQuery;
  }, [changes, normalizedQuery, selectedKey]);

  useExplorerPagination({
    listRef,
    sentinelRef: loadMoreRef,
    resetKey: scrollResetKey,
    itemCount: changes.length,
    layoutKey: expandedParents,
    hasMore,
    loading: pageLoading,
    onLoadMore,
  });

  const toggleParent = (change, event) => {
    const key = changeKey(change);
    const collapsingSelectedChild =
      expandedParents.has(key) &&
      (change.children ?? []).some((child) => child.locator === selectedKey);
    if (collapsingSelectedChild) onSelect(change);
    setExpandedParents((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (collapsingSelectedChild) {
      const row = event.currentTarget.closest('.native-change-row-shell');
      window.requestAnimationFrame(() => {
        const list = listRef.current;
        if (!list || !row) return;
        const bounds = list.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        if (rowBounds.top < bounds.top) list.scrollTop -= bounds.top - rowBounds.top;
        else if (rowBounds.bottom > bounds.bottom)
          list.scrollTop += rowBounds.bottom - bounds.bottom;
      });
    }
  };

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
        <div ref={listRef} className="native-change-list min-h-0 flex-1 overflow-y-auto">
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
                  <div className={`native-change-row-shell${hasChildren ? ' has-children' : ''}`}>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="native-change-disclosure"
                        aria-label={`${expanded ? '收起' : '展开'} ${change.name} 的子变更`}
                        aria-expanded={expanded}
                        aria-controls={childrenId}
                        onClick={(event) => toggleParent(change, event)}
                      >
                        <DashboardExplorerFolderIcon expanded={expanded} />
                      </button>
                    ) : null}
                    <DashboardExplorerRowTooltip
                      name={change.name}
                      status={statusPresentation.label}
                      description={nativeChangeDescription(change, progress)}
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
                          showIcon={!hasChildren}
                          name={change.name}
                          description={
                            progress
                              ? (PHASE_LABELS[change.phase] ?? '状态异常')
                              : nativeChangeDescription(change)
                          }
                          count={
                            progress ? (
                              <>
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
                                {' 子变更'}
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
                            description={nativeChildDescription(child)}
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
                                description={nativeChildDescription(child)}
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
  detailTab,
  onDetailTabChange,
  numberIdentity,
  numberEntryKey,
  onPreview,
  onReadArtifact,
  onCopyChangeName,
  projectContext,
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
      extra={
        !PHASE_LABELS[change.phase] ? <Pill tone={phaseTone(change.phase)}>状态异常</Pill> : null
      }
      suggestion={
        <DashboardChangeSuggestion
          key={numberIdentity}
          text={suggestion(change)}
          identity={numberIdentity}
        />
      }
    >
      <NativePhaseStepper change={change} />
      <Tabs
        className="native-detail-tabs"
        activeKey={detailTab}
        onChange={onDetailTabChange}
        destroyOnHidden
        items={[
          {
            key: 'details',
            label: '变更详情',
            children: (
              <>
                <div className="native-detail-source">
                  <NativeArtifactList
                    change={change}
                    onPreview={onPreview}
                    onReadArtifact={onReadArtifact}
                  />
                  <NativeScopeCard
                    change={change}
                    numberIdentity={numberIdentity}
                    numberEntryKey={numberEntryKey}
                  />
                </div>
                <NativeProjectGit projectContext={projectContext} />
              </>
            ),
          },
          {
            key: 'acceptance',
            label: '验收状态',
            children: (
              <div className="native-acceptance-page">
                <NativeAcceptanceCard
                  change={change}
                  numberIdentity={numberIdentity}
                  numberEntryKey={numberEntryKey}
                />
                <NativeVerificationCard change={change} />
              </div>
            ),
          },
          {
            key: 'blockers',
            label: '当前阻塞',
            children: <NativeBlockersCard blockers={change.blockers ?? []} />,
          },
          {
            key: 'history',
            label: '执行历史',
            children: (
              <NativeHistoryCard history={change.history ?? []} overflow={change.historyOverflow} />
            ),
          },
        ]}
      />
    </DashboardChangeDetail>
  );
}

function NativeChangeDetailSkeleton({ projectContext }) {
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
      <NativeProjectGit projectContext={projectContext} />
    </DashboardChangeDetail>
  );
}

function NativeProjectGit({ projectContext }) {
  return projectContext ? <div className="native-detail-project-git">{projectContext}</div> : null;
}

function NativeHandoffContent({ handoff }) {
  return handoff ? (
    <div className="native-handoff-content">
      <p className="mt-3 text-xs text-meta">
        Builder handoff · 第 {handoff.iteration} 轮（已提交）
      </p>
      <p className="native-long-text mt-2 text-sm leading-relaxed text-fg-2">
        {portableText(handoff.summary)}
      </p>
      {handoff.summary?.truncated && (
        <p className="mt-2 text-xs text-muted">交接摘要已在 Runtime 中截断。</p>
      )}
    </div>
  ) : (
    <p className="mt-3 text-xs text-muted">尚无 Builder 交接详情。</p>
  );
}

function NativeScopeCard({ change, numberIdentity, numberEntryKey }) {
  const specs = change.specs;
  const capabilities = specs?.capabilities ?? [];
  return (
    <article className="native-scope-card native-secondary-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">变更范围</h4>
      </div>
      <div className="native-scope-metrics">
        <ScopeMetric
          label="capability 总数"
          value={specs?.total ?? 0}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
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
      <div className="native-scope-list mt-4 space-y-2">
        {capabilities.length === 0 ? (
          <p className="text-xs text-muted">尚未声明 Spec 变更。</p>
        ) : (
          <>
            {capabilities.slice(0, 3).map((item) => (
              <NativeCapabilityRow key={item.capability} item={item} />
            ))}
            {capabilities.length > 3 && (
              <details key={change.name} className="native-disclosure">
                <summary>展开其余 {capabilities.length - 3} 项能力</summary>
                <div
                  className="native-expanded-list"
                  tabIndex={0}
                  role="region"
                  aria-label="其余能力"
                >
                  {capabilities.slice(3).map((item) => (
                    <NativeCapabilityRow key={item.capability} item={item} />
                  ))}
                </div>
              </details>
            )}
            {specs?.capabilitiesTruncated && (
              <p className="text-xs text-warn">
                当前数据只提供 {capabilities.length} / {specs.total}{' '}
                项能力，刷新详情以读取完整列表。
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function NativeCapabilityRow({ item }) {
  return (
    <details className="native-capability-row">
      <summary>
        <span className="truncate font-mono">{item.capability}</span>
        <span className="text-meta">{operationLabel(item.operation)}</span>
      </summary>
      <p className="native-long-text font-mono">{item.capability}</p>
    </details>
  );
}

function ScopeMetric({ label, value, tone, numberIdentity, numberEntryKey }) {
  const toneClass = {
    info: 'bg-info-soft text-info',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return (
    <Card size="small" className="native-statistic-card">
      <Statistic
        title={label}
        value={value}
        className={value && toneClass ? toneClass : 'text-fg-2'}
        formatter={() => (
          <AnimatedNumber value={value} identity={numberIdentity} numberEntryKey={numberEntryKey} />
        )}
      />
    </Card>
  );
}

function NativeAcceptanceCard({ change, numberIdentity, numberEntryKey }) {
  const acceptance = change.acceptance;
  const progress = acceptanceProgress(change);
  const items = change.acceptanceItems ?? [];
  const allPassed = Boolean(acceptance?.total && acceptance.passed === acceptance.total);
  return (
    <article className="native-acceptance-card native-primary-card">
      <div className="native-acceptance-header flex flex-wrap items-center justify-between gap-3">
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
            className={`block h-full rounded-full transition-[width] ${allPassed ? 'bg-success' : acceptance.failed > 0 ? 'bg-danger' : acceptance.blocked > 0 ? 'bg-warn' : 'bg-accent'}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
      <p className="native-acceptance-note mt-3 text-xs text-muted">
        已处理包含通过、失败和阻塞；是否通过以各项结果与验证结论为准。
      </p>
      <div className="native-acceptance-metrics">
        <AcceptanceMetric
          label="通过"
          value={acceptance?.passed}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="失败"
          value={acceptance?.failed}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="阻塞"
          value={acceptance?.blocked}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
        <AcceptanceMetric
          label="待验证"
          value={acceptance?.pending}
          numberIdentity={numberIdentity}
          numberEntryKey={numberEntryKey}
        />
      </div>
      {items.length > 0 && (
        <div className="native-expanded-list" tabIndex={0} role="region" aria-label="完整验收条目">
          <NativeAcceptanceItems items={items} />
        </div>
      )}
    </article>
  );
}

function NativeAcceptanceItems({ items }) {
  return (
    <ul className="native-acceptance-items">
      {items.map((item) => (
        <li key={item.id} className={`rounded-lg bg-surface px-3 py-3 text-xs is-${item.result}`}>
          <div className="native-acceptance-item-header">
            <span className="native-acceptance-item-id font-mono text-meta">{item.id}</span>
            <span className="min-w-0 flex-1 native-long-text text-fg-2">{item.text}</span>
            <Pill tone={acceptanceResultTone(item.result)}>{ACCEPTANCE_LABELS[item.result]}</Pill>
          </div>
          {item.reason && (
            <p className="native-acceptance-item-reason native-long-text mt-2 text-muted">
              {portableText(item.reason)}
            </p>
          )}
          {item.reason?.truncated && <p className="mt-1 text-muted">原因摘要已截断。</p>}
        </li>
      ))}
    </ul>
  );
}

function AcceptanceMetric({ label, value, numberIdentity, numberEntryKey }) {
  return (
    <Card size="small" className="native-statistic-card">
      <Statistic
        title={label}
        value={value}
        formatter={() =>
          typeof value === 'number' ? (
            <AnimatedNumber
              value={value}
              identity={numberIdentity}
              numberEntryKey={numberEntryKey}
            />
          ) : (
            '—'
          )
        }
      />
    </Card>
  );
}

function NativeVerificationCard({ change }) {
  const assurance = assurancePresentation(change);
  const verification = change.verification;
  const hasCandidate =
    typeof verification?.candidateId === 'string' && verification.candidateId.trim().length > 0;
  const hasIteration = Number.isInteger(verification?.iteration) && verification.iteration > 0;
  const hasAttempt = Number.isInteger(verification?.attempt) && verification.attempt > 0;
  const priorResult =
    hasCandidate &&
    hasIteration &&
    hasAttempt &&
    change.phase === 'build' &&
    change.loop?.stage === 'repairing' &&
    Number.isInteger(change.loop?.iteration) &&
    verification.iteration === change.loop.iteration - 1;
  const checks = change.checks ?? [];
  const issues = checks.filter((check) => check.status !== 'passed').slice(0, 3);
  const previewIds = new Set(issues.map((check) => check.id));
  const remaining = checks.filter((check) => !previewIds.has(check.id));
  return (
    <article className="native-verification-card native-primary-card">
      <div className="native-verification-header flex flex-wrap items-center justify-between gap-3">
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
      {(hasCandidate || hasIteration || hasAttempt) && (
        <div className="native-verification-binding mt-3 text-xs text-meta">
          {hasCandidate && <span>候选：{verification.candidateId}</span>}
          {hasIteration && hasAttempt ? (
            <span>
              验证轮次 / 尝试：{verification.iteration} / {verification.attempt}
            </span>
          ) : (
            <>
              {hasIteration && <span>验证轮次：{verification.iteration}</span>}
              {hasAttempt && <span>验证尝试：{verification.attempt}</span>}
            </>
          )}
          {priorResult && <Pill tone="warn">上一轮候选结果 · 修复中</Pill>}
        </div>
      )}
      <p className="native-long-text mt-3 text-sm leading-relaxed text-fg-2">
        {portableText(verification?.summary, '尚无 Verifier 结论。')}
      </p>
      {verification?.summary?.truncated && <p className="text-xs text-muted">验证摘要已截断。</p>}
      {(verification?.risks ?? []).length > 0 && (
        <div className="native-verification-risks">
          <p className="mt-3 text-xs text-muted">{verification.risks.length} 项验证风险</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-xs text-muted">
            {verification.risks.map((risk, index) => (
              <li key={index} className="native-long-text">
                {portableText(risk)}
                {risk.truncated && '（摘要已截断）'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {verification?.risksTruncated && (
        <p className="mt-2 text-xs text-warn">风险列表已在来源中截断。</p>
      )}
      <p className="mt-2 text-xs text-muted">Runtime 持久化命令结果，与行为验收分别统计。</p>
      <div className="native-check-list mt-4 space-y-2">
        {checks.length === 0 ? (
          <p className="text-xs text-muted">尚无持久化检查摘要。</p>
        ) : (
          <>
            {issues.map((check) => (
              <NativeCheckRow key={check.id} check={check} />
            ))}
            {remaining.map((check) => (
              <NativeCheckRow key={check.id} check={check} />
            ))}
          </>
        )}
      </div>
    </article>
  );
}

function NativeCheckRow({ check }) {
  return (
    <details className={`native-check-row is-${check.status}`}>
      <summary>
        <span className="native-check-name">{portableText(check.name, check.id)}</span>
        <Pill
          tone={check.status === 'passed' ? 'ok' : check.status === 'failed' ? 'danger' : 'warn'}
        >
          {check.status}
        </Pill>
        <span className="text-meta">{formatDuration(check.durationMs)}</span>
        {check.exitCode != null && (
          <span className="font-mono text-meta">exit {check.exitCode}</span>
        )}
      </summary>
      <p className="native-long-text mt-2 text-xs text-fg-2">
        {portableText(check.name, check.id)}
      </p>
      {check.name?.truncated && <p className="text-xs text-muted">检查名称已在来源中截断。</p>}
    </details>
  );
}

function NativeBlockersCard({ blockers }) {
  return (
    <article className={`native-blockers-card${blockers.length ? ' has-blockers' : ' is-empty'}`}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">当前阻塞</h4>
        <Pill tone={blockers.length ? 'danger' : 'ok'}>
          {blockers.length ? `${blockers.length} 项` : '无阻塞'}
        </Pill>
      </div>
      <div className="native-context-content" role="region" aria-label="当前阻塞内容" tabIndex={0}>
        {blockers.length === 0 ? (
          <p className="mt-3 text-xs text-muted">当前没有持久化阻塞项。</p>
        ) : (
          <ul className="dashboard-guidance-items mt-4">
            {blockers.map((blocker, index) => (
              <li
                key={`${blocker.owner}-${index}`}
                className="dashboard-guidance-item rounded-lg bg-surface px-3 py-3 text-xs"
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
      </div>
    </article>
  );
}

function NativeHistoryCard({ history, overflow }) {
  return (
    <article className="native-history-card">
      <div className="flex items-center justify-between gap-3">
        <h4 className="dashboard-detail-section-title">执行历史</h4>
        <span className="font-mono text-xs text-meta">保留 {history.length} 条</span>
      </div>
      {overflow?.droppedEntries > 0 && (
        <p className="mt-3 text-xs text-muted">
          更早的 {overflow.droppedEntries} 条历史已汇总，时间范围{' '}
          {formatTimestamp(overflow.firstDroppedAt)} 至 {formatTimestamp(overflow.lastDroppedAt)}
          ；未提供这些记录的完整明细。
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-xs text-muted">尚无完成的循环记录。</p>
      ) : (
        <ol
          className="native-expanded-list mt-3 space-y-2"
          tabIndex={0}
          role="region"
          aria-label="保留执行历史"
        >
          {history.map((entry, index) => (
            <li
              key={`${entry.goalCycle}-${entry.iteration}-${entry.attempt}-${index}`}
              className="rounded-lg border border-border-soft px-3 py-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-meta">
                  Goal cycle {entry.goalCycle} · #{entry.iteration}.{entry.attempt}
                </span>
                <Pill tone={historyTone(entry.outcome)}>
                  {HISTORY_LABELS[entry.outcome] ?? entry.outcome}
                </Pill>
              </div>
              <p className="native-long-text mt-2 text-fg-2">{portableText(entry.summary)}</p>
              {entry.summary?.truncated && <p className="text-muted">记录摘要已截断。</p>}
              {entry.unresolvedIds?.length > 0 && (
                <p className="native-long-text mt-1 text-muted">
                  未解决验收：{entry.unresolvedIds.join(', ')}
                </p>
              )}
              <p className="mt-1 text-meta">{formatTimestamp(entry.completedAt)}</p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function NativeArtifactList({ change, onPreview, onReadArtifact }) {
  const previews = change.artifacts ?? [];
  const references = change.artifactReferences ?? previews;
  const previewByKey = new Map(previews.map((artifact) => [artifact.key, artifact]));
  const [loadingKey, setLoadingKey] = useState(null);
  const [error, setError] = useState('');
  const requestRef = useRef(null);
  useEffect(() => {
    setError('');
    setLoadingKey(null);
    requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [change.name, change.locator]);
  const openPreview = async (reference, trigger) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError('');
    setLoadingKey(reference.key);
    try {
      const preview =
        previewByKey.get(reference.key) ??
        (await onReadArtifact?.(change, reference, controller.signal));
      if (controller.signal.aborted) return;
      if (!preview) throw new Error('未提供该产物的预览，请刷新变更详情。');
      if (!preview.exists) throw new Error('该产物未生成或无法读取，请确认文件后重试。');
      onPreview({
        key: reference.key,
        name: reference.label,
        preview,
        nativePreview: true,
        returnFocus: trigger,
      });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || '产物读取失败，请重试。');
    } finally {
      if (!controller.signal.aborted) setLoadingKey(null);
    }
  };
  const rows = (items) =>
    items.map((reference) => {
      const preview = previewByKey.get(reference.key);
      return (
        <Button
          key={reference.key}
          type="text"
          className="native-artifact-row"
          disabled={preview?.exists === false}
          loading={loadingKey === reference.key}
          onClick={(event) => openPreview(reference, event.currentTarget)}
        >
          <ReferenceIcon name="artifact" />
          <span className="truncate" title={reference.path}>
            {reference.key}
          </span>
          <span className="native-artifact-label" title={reference.label}>
            {preview?.exists === false ? '未生成' : reference.label}
          </span>
        </Button>
      );
    });
  return (
    <article className="native-artifacts-card native-secondary-card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h4 className="dashboard-detail-section-title">关键产物</h4>
        <span className="text-xs text-meta">{references.length} 项引用</span>
      </div>
      <p className="mb-3 text-xs text-muted">Comet Native · 点击读取预览，正文最多 48 KiB。</p>
      {references.length === 0 ? (
        <p className="text-xs text-muted">暂无可预览产物</p>
      ) : (
        rows(references)
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error} 可再次点击该产物重试。
        </p>
      )}
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
      <div className="native-progress-details">
        {change.loop ? (
          <p className="dashboard-phase-note">
            Build ↔ Verify Loop · 循环阶段{' '}
            {LOOP_STAGE_LABELS[change.loop.stage] ?? change.loop.stage} · Goal cycle{' '}
            {change.loop.goalCycle} · 第 {change.loop.iteration} 轮 / 第 {change.loop.attempt} 次
          </p>
        ) : (
          <p className="dashboard-phase-note">未提供可移植 Loop 状态。</p>
        )}
        {change.loop?.nextAction && suggestion(change) !== change.loop.nextAction && (
          <p className="dashboard-phase-note native-long-text">下一步：{change.loop.nextAction}</p>
        )}
      </div>
    </WorkflowPhaseTrack>
  );
}

function NativeExecutionRecoveryCard({ change, loading = false }) {
  const local = change?.localExecution;
  const loop = change?.loop;
  return (
    <aside className="native-recovery-status">
      <section className="rounded-lg bg-bg p-5 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <h4 className="dashboard-detail-section-title">执行与恢复</h4>
          {change && (local || loop) && (
            <Pill
              tone={
                local?.status === 'running'
                  ? 'info'
                  : local?.status === 'interrupted' || local?.reason === 'invalid'
                    ? 'danger'
                    : 'neutral'
              }
            >
              {local?.status === 'running'
                ? '执行中'
                : local?.status === 'interrupted'
                  ? '执行中断'
                  : 'YAML 稳定边界'}
            </Pill>
          )}
        </div>
        <div
          className="native-context-content"
          role="region"
          aria-label="执行与恢复内容"
          tabIndex={0}
        >
          {loading ? (
            <Skeleton active title={false} paragraph={{ rows: 5 }} />
          ) : !change ? (
            <p className="text-xs text-muted">选择变更后查看执行与恢复信息。</p>
          ) : (
            <>
              <section className="native-recovery-group">
                {local ? (
                  <>
                    <h5>当前执行</h5>
                    <dl className="space-y-3 text-sm">
                      <SideFact
                        label="本机状态"
                        value={LOCAL_REASON_LABELS[local.reason] ?? '状态未知'}
                      />
                      <SideFact
                        label="执行阶段"
                        value={local.stage ? (LOCAL_STAGE_LABELS[local.stage] ?? local.stage) : '—'}
                      />
                      <SideFact
                        label="执行者"
                        value={ACTOR_LABELS[local.actor] ?? '当前无执行者'}
                      />
                      <SideFact label="检查请求轮次" value={`${local.requestCheckRounds ?? '—'}`} />
                    </dl>
                    {(local.checks ?? []).length > 0 && (
                      <p className="mt-3 text-xs text-meta">
                        本机检查摘要：
                        {local.checks.filter((check) => check.status === 'passed').length} 通过 /{' '}
                        {local.checks.filter((check) => check.status === 'failed').length} 失败 /{' '}
                        {
                          local.checks.filter((check) =>
                            ['planned', 'running'].includes(check.status),
                          ).length
                        }{' '}
                        进行中
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted">未提供本机执行状态。</p>
                )}
              </section>
              <section className="native-recovery-group">
                {loop ? (
                  <>
                    <h5>循环进度</h5>
                    <dl className="space-y-3 text-sm">
                      <SideFact
                        label="循环阶段"
                        value={LOOP_STAGE_LABELS[loop.stage] ?? loop.stage}
                      />
                      <SideFact label="Goal cycle" value={`${loop.goalCycle}`} />
                      <SideFact label="轮次 / 尝试" value={`${loop.iteration} / ${loop.attempt}`} />
                    </dl>
                  </>
                ) : (
                  <p className="text-xs text-muted">未提供可移植 Loop 状态。</p>
                )}
              </section>
              <section className="native-recovery-group">
                {(local?.recoverableFromStage || loop?.nextAction || change.builderHandoff) && (
                  <h5>恢复与交接</h5>
                )}
                {local?.recoverableFromStage && (
                  <p className="native-long-text text-xs text-fg-2">
                    可从 YAML 的{' '}
                    {LOOP_STAGE_LABELS[local.recoverableFromStage] ?? local.recoverableFromStage}{' '}
                    阶段恢复。
                  </p>
                )}
                {loop?.nextAction && (
                  <p className="native-long-text mt-2 text-xs text-fg-2">
                    下一步：{loop.nextAction}
                  </p>
                )}
                <NativeHandoffContent handoff={change.builderHandoff} />
              </section>
            </>
          )}
        </div>
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
