import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDashboardMotion } from './dashboard-motion.jsx';
import { useDashboardViewState } from './dashboard-view-state.js';
import { Alert, Button, Collapse, Drawer, Empty, Input, Skeleton, Tabs, Tag, Tooltip } from 'antd';
import {
  AimOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  CopyOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { t, systemText, getDashboardLocale } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { navigateDashboard, useDashboardNavigation } from './dashboard-navigation.js';
import {
  groupApplicationRuns,
  preferredApplicationRun,
  applicationRunNeedsAttention as attention,
  groupApplicationSteps,
  initialApplicationRecord,
  mergeApplicationRunPages,
  refreshApplicationRunPage,
  refreshApplicationRunDetail,
  mergeApplicationRecordPage,
  fetchApplicationObservation,
  applicationWorkflowView,
} from './application-data.js';
import {
  ApplicationStatus,
  ApplicationStateIcon,
  ApplicationRecordInspector,
  ApplicationEvidenceView,
  ApplicationObservationDrawer,
  formatApplicationRecordType,
} from './application-record-inspector.jsx';
import { readApplicationDemo } from './application-demo.js';
import './any-workflow-panel.css';
import { ApplicationHistorySelector } from './application-history-selector.jsx';
import { ApplicationStepList } from './application-step-list.jsx';
import { ApplicationDeliveryModal } from './application-delivery-modal.jsx';
import { ApplicationWorkflowView } from './application-workflow-view.jsx';
import {
  ApplicationCreationSidebar,
  useApplicationVersionRuns,
} from './application-creation-sidebar.jsx';
import { creatorWorkflowView } from './application-data.js';
import { TransitionPaths } from './application-workflow-view.jsx';
import { ApplicationDefinitionInspector } from './application-step-definition.jsx';

const preferred = preferredApplicationRun;
const baseLabel = (base) =>
  base === 'native'
    ? t('Native 扩展')
    : base?.startsWith('classic-')
      ? t('Classic 组合')
      : base === 'standalone'
        ? t('独立工作流')
        : t('尚未确定应用');

export function AnyWorkflowPanel({
  projectId,
  projectPath,
  query = '',
  onQuery,
  refreshToken = 0,
  onPreview,
  onRelatedChange,
  demo = false,
  workspace = 'any',
  initialLocator = null,
  onNavigateWorkspace,
}) {
  useDashboardLanguage();
  const applicationWorkspace = workspace === 'application';
  const runKind = applicationWorkspace ? 'application' : 'creator';
  const listKind = applicationWorkspace ? 'application' : 'all';
  const pageMotion = useDashboardMotion('any', 'page');
  const workspaceElement = useRef(null);
  const bindWorkspace = useCallback(
    (element) => {
      workspaceElement.current = element;
      pageMotion(element);
    },
    [pageMotion],
  );
  const getReadingViewport = useCallback(() => {
    const shell = workspaceElement.current?.closest('.dashboard-content-shell');
    if (shell && ['auto', 'scroll'].includes(getComputedStyle(shell).overflowY)) {
      return { element: shell, top: shell.scrollTop, offset: shell.getBoundingClientRect().top };
    }
    return { element: window, top: window.scrollY, offset: 0 };
  }, []);
  const route = useDashboardNavigation();
  const viewScope = `${demo ? 'demo' : projectId}:${workspace}`;
  const [savedLocator, setSavedLocator] = useDashboardViewState(viewScope, 'selectedLocator', null);
  const [page, setPage] = useState(null),
    [pageError, setPageError] = useState(null),
    [pageLoading, setPageLoading] = useState(true),
    [moreLoading, setMoreLoading] = useState(false);
  const [detail, setDetail] = useState(null),
    [detailError, setDetailError] = useState(null),
    [detailLoading, setDetailLoading] = useState(false);
  const [locator, setLocator] = useState(
    () =>
      initialLocator ?? (route.workflow === workspace ? route.runLocator : null) ?? savedLocator,
  );
  const [recordId, setRecordId] = useState(() =>
    route.workflow === workspace ? (route.recordId ?? null) : null,
  );
  useEffect(() => {
    setSavedLocator(locator);
  }, [locator, setSavedLocator]);
  const [definitionStepId, setDefinitionStepId] = useState(null);
  const [flowLoading, setFlowLoading] = useState(null);
  const flowRequest = useRef(null);
  const definitionStepRef = useRef(definitionStepId);
  definitionStepRef.current = definitionStepId;
  const [tab, setTab] = useState(() =>
    route.workflow === workspace ? (route.runTab ?? 'steps') : 'steps',
  );
  const runMotion = useDashboardMotion(locator, 'panel');
  const tabMotion = useDashboardMotion(`${locator}:${tab}`, 'tab');
  const [filter, setFilter] = useDashboardViewState(viewScope, 'filter', 'all'),
    [scope, setScope] = useDashboardViewState(viewScope, 'scope', 'all'),
    [search, setSearch] = useState(query),
    [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useDashboardViewState(viewScope, 'expanded', {}),
    [manual, setManual] = useDashboardViewState(viewScope, 'manual', false),
    [news, setNews] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false),
    [drawer, setDrawer] = useState(null),
    [artifactLoading, setArtifactLoading] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const recordsRequest = useRef(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [rosters, setRosters] = useState({}),
    [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(null);
  const [goalExpanded, setGoalExpanded] = useDashboardViewState(viewScope, 'goalExpanded', false);
  const pageRequest = useRef(null),
    moreRequest = useRef(null),
    rosterRequest = useRef(null),
    rosterMoreRequest = useRef(null),
    pageContext = useRef(null),
    rosterContext = useRef(null),
    pageKey = useRef(null);
  const listKey = JSON.stringify([projectId, demo, search, scope, filter]);
  const listContext = useMemo(
    () => ({}),
    [projectId, demo, query, search, scope, filter, refreshToken, tick],
  );
  const currentListContext = useRef(listContext);
  useLayoutEffect(() => {
    currentListContext.current = listContext;
    pageRequest.current?.abort();
    moreRequest.current?.abort();
    setMoreLoading(false);
    return () => {
      pageRequest.current?.abort();
      moreRequest.current?.abort();
    };
  }, [listContext]);
  const latestRefreshToken = useRef(refreshToken),
    detailRequest = useRef(null),
    detailPending = useRef(false),
    parentStack = useRef([]),
    anchor = useRef(null),
    restoreScroll = useRef(null);
  const detailRef = useRef(detail),
    pageRef = useRef(page),
    manualRef = useRef(manual),
    recordRef = useRef(recordId);
  detailRef.current = detail;
  pageRef.current = page;
  manualRef.current = manual;
  recordRef.current = recordId;
  const request = useCallback(
    (endpoint, params, signal) =>
      demo
        ? Promise.resolve().then(() => readApplicationDemo(endpoint, params))
        : fetchApplicationObservation(projectId, endpoint, params, signal),
    [projectId, demo],
  );
  const remember = useCallback(
    (runLocator, selectedRecord, runTab) => {
      if (globalThis.__COMET_DASHBOARD_EMBED__ === true) return;
      navigateDashboard(
        {
          view: 'workflow',
          workflow: workspace,
          projectId,
          runLocator,
          recordId: selectedRecord,
          runTab,
        },
        { replace: true },
      );
    },
    [projectId, demo, workspace],
  );
  const chooseRun = useCallback(
    (next, { restore = null, keepParents = false } = {}) => {
      const target = next?.startsWith('creator:') ? 'any' : 'application';
      if (applicationWorkspace && target !== workspace && onNavigateWorkspace) {
        onNavigateWorkspace(target, next);
        return;
      }
      const nextRecord = restore?.recordId ?? (next === locator ? recordRef.current : null);
      if (!keepParents) parentStack.current = [];
      if (next !== locator) {
        detailRequest.current?.abort();
        recordsRequest.current?.abort();
      }
      setLocator(next);
      if (next !== locator) setDetail(null);
      setDetailError(null);
      setRecordId(nextRecord);
      setDefinitionStepId(null);
      flowRequest.current?.abort();
      setFlowLoading(null);
      setTab(restore?.tab ?? 'steps');
      setManual(Boolean(restore));
      setNews(false);
      setInspectorOpen(false);
      setDeliveryOpen(false);
      setGoalExpanded(restore?.goalExpanded ?? false);
      if (restore) setExpanded(restore.expanded);
      remember(next, nextRecord, restore?.tab ?? 'steps');
    },
    [remember, locator, workspace, onNavigateWorkspace],
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), page?.indexing ? 1000 : 30000);
    return () => clearInterval(timer);
  }, [page?.indexing]);
  useEffect(() => {
    if (
      !demo &&
      route.workflow === workspace &&
      route.projectId === projectId &&
      route.runLocator &&
      route.runLocator !== locator
    ) {
      setLocator(route.runLocator);
      setRecordId(route.recordId ?? null);
      setDefinitionStepId(null);
      flowRequest.current?.abort();
      setFlowLoading(null);
      setTab(route.runTab ?? 'steps');
      setDetail(null);
      setDetailError(null);
    }
  }, [route, demo, projectId, locator]);
  useEffect(() => {
    pageRequest.current?.abort();
    if (search !== query) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageLoading(!pageRef.current);
    const forceRefresh = latestRefreshToken.current !== refreshToken;
    latestRefreshToken.current = refreshToken;
    request(
      'application-runs',
      {
        q: search,
        scope,
        kind: listKind,
        status: 'all',
        limit: 100,
        ...(forceRefresh ? { refresh: 1 } : {}),
      },
      controller.signal,
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setPageError(null);
        if (pageRef.current && pageRef.current.fingerprint !== next.fingerprint) setNews(true);
        const sameList = pageKey.current === listKey;
        setPage((previous) =>
          controller.signal.aborted
            ? previous
            : sameList
              ? refreshApplicationRunPage(previous, next)
              : next,
        );
        pageKey.current = listKey;
        pageContext.current = listContext;
        if (!locator && next.items.length) {
          const first =
            preferred(next.items.filter((r) => r.kind === runKind)) ??
            (!applicationWorkspace ? preferred(next.items) : null);
          if (first) chooseRun(first.locator);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPageError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPageLoading(false);
      });
    return () => controller.abort();
  }, [request, listContext]);
  useEffect(() => {
    detailRequest.current?.abort();
  }, [locator, request, refreshToken]);
  useEffect(() => {
    if (!locator || (detailPending.current && !detailRequest.current?.signal.aborted)) return;
    detailRequest.current?.abort();
    recordsRequest.current?.abort();
    setRecordsLoading(false);
    const controller = new AbortController();
    detailRequest.current = controller;
    detailPending.current = true;
    setDetailLoading(!detailRef.current);
    request(
      'application-run',
      { locator, recordLimit: 40, recordId: recordRef.current },
      controller.signal,
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setDetailError(null);
        const old = detailRef.current;
        if (old && old.locator === next.locator && old.revision !== next.revision) {
          setNews(true);
          if (manualRef.current) {
            const element = workspaceElement.current
              ?.getRootNode()
              .getElementById(`any-record-${recordRef.current}`);
            if (element)
              anchor.current = { id: element.id, top: element.getBoundingClientRect().top };
          }
        }
        setDetail((previous) => refreshApplicationRunDetail(previous, next));
        if (next.locator !== locator) {
          setLocator(next.locator);
          remember(next.locator, recordRef.current, tab);
        }
        if (!recordRef.current && !definitionStepRef.current) {
          const first = initialApplicationRecord(next);
          setRecordId(first?.id ?? null);
          remember(next.locator, first?.id ?? null, tab);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(error);
      })
      .finally(() => {
        if (detailRequest.current === controller) detailPending.current = false;
        if (!controller.signal.aborted) setDetailLoading(false);
      });
  }, [locator, request, refreshToken, tick]);
  useLayoutEffect(() => {
    if (restoreScroll.current && detail?.locator === restoreScroll.current.locator) {
      getReadingViewport().element.scrollTo({
        top: restoreScroll.current.scrollTop,
        behavior: 'instant',
      });
      restoreScroll.current = null;
    }
    const saved = anchor.current;
    if (!saved) return;
    anchor.current = null;
    const element = workspaceElement.current?.getRootNode().getElementById(saved.id);
    if (element)
      getReadingViewport().element.scrollBy({
        top: element.getBoundingClientRect().top - saved.top,
        behavior: 'instant',
      });
  }, [detail, getReadingViewport]);
  useEffect(
    () => () => {
      pageRequest.current?.abort();
      detailRequest.current?.abort();
      recordsRequest.current?.abort();
      flowRequest.current?.abort();
    },
    [],
  );
  const loadMoreRecords = async () => {
    const current = detailRef.current;
    if (!current?.recordPage?.nextCursor || recordsLoading) return;
    recordsRequest.current?.abort();
    const controller = new AbortController();
    recordsRequest.current = controller;
    setRecordsLoading(true);
    try {
      const next = await request(
        'application-run-records',
        {
          locator: current.locator,
          cursor: current.recordPage.nextCursor,
          limit: 40,
        },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setDetail((previous) => mergeApplicationRecordPage(previous, next));
    } catch (error) {
      if (!controller.signal.aborted) {
        setDetailError(error);
        setNews(true);
      }
    } finally {
      if (!controller.signal.aborted) setRecordsLoading(false);
    }
  };
  const groups = useMemo(
    () =>
      groupApplicationRuns(
        (page?.items ?? []).filter((r) => !applicationWorkspace || r.kind === runKind),
      ),
    [page, runKind],
  );
  const selectedSummary = detail ?? page?.items.find((r) => r.locator === locator);
  const mode = selectedSummary?.kind ?? 'creator';
  const managedApplication = !applicationWorkspace && mode === 'application';
  const applicationId = selectedSummary?.applicationId;
  const versionHistory = useApplicationVersionRuns(
    request,
    applicationId,
    !applicationWorkspace,
    listContext,
  );
  const rosterGeneration = useMemo(() => ({}), [applicationId, listContext]);
  const currentRosterGeneration = useRef(rosterGeneration);
  useLayoutEffect(() => {
    currentRosterGeneration.current = rosterGeneration;
    rosterRequest.current?.abort();
    rosterMoreRequest.current?.abort();
    setRosterLoading(false);
    return () => {
      rosterRequest.current?.abort();
      rosterMoreRequest.current?.abort();
    };
  }, [rosterGeneration]);
  useLayoutEffect(() => {
    setRosters({});
  }, [request]);
  useEffect(() => {
    if (!applicationId) return;
    const controller = new AbortController();
    rosterRequest.current = controller;
    setRosterLoading(true);
    setRosterError(null);
    request('application-runs', { applicationId, kind: runKind, limit: 100 }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setRosters((v) =>
          controller.signal.aborted
            ? v
            : {
                ...v,
                [applicationId]: refreshApplicationRunPage(v[applicationId], next),
              },
        );
        rosterContext.current = rosterGeneration;
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRosterError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRosterLoading(false);
      });
    return () => controller.abort();
  }, [applicationId, request, rosterGeneration]);
  const roster = applicationId ? rosters[applicationId] : null;
  const selectedGroup = selectedSummary
    ? groupApplicationRuns([
        ...new Map(
          [
            ...(roster?.items ?? []),
            ...(versionHistory.page?.items ?? []),
            ...(groups.find((g) => g.records.some((r) => r.locator === locator))?.records ?? []),
            selectedSummary,
          ].map((r) => [r.locator, r]),
        ).values(),
      ]).find((g) => g.records.some((r) => r.locator === locator))
    : null;
  const visibleGroups = groups.filter(
    (g) =>
      (scope === 'all' || (scope === 'draft' ? !g.id : Boolean(g.id))) &&
      (filter === 'all' ||
        g.records.some((r) =>
          filter === 'attention'
            ? attention(r)
            : ['running', 'waiting', 'unknown'].includes(r.status),
        )),
  );
  const selectedRecord = detail?.records.find((r) => r.id === recordId) ?? null;
  const current = detail?.records.filter((r) => detail.currentIds.includes(r.id)) ?? [];
  const steps = useMemo(() => groupApplicationSteps(detail?.records ?? []), [detail]);
  const flow = useMemo(
    () =>
      applicationWorkspace
        ? applicationWorkflowView(detail)
        : (creatorWorkflowView(detail) ?? applicationWorkflowView(detail)),
    [detail, applicationWorkspace],
  );
  const selectedDefinition = flow?.nodes.find((node) => node.stepId === definitionStepId);

  const counts = [
    ['running', '项执行中'],
    ['pending', '项待执行'],
    ['waiting', '项等待确认'],
    ['evidence', '项等待证据'],
    ['child', '项等待子流程'],
    ['unknown', '项待核对'],
    ['failed', '项失败'],
  ]
    .map(([value, label]) => ({
      value,
      label,
      count: current.filter((r) => r.status === value).length,
    }))
    .filter((c) => c.count);
  const selectRecord = (record, { locate = false } = {}) => {
    flowRequest.current?.abort();
    setFlowLoading(null);
    setDefinitionStepId(null);
    setRecordId(record.id);
    const phase = flow?.nodes.find((node) => node.stepId === record.stepId)?.phase;
    setExpanded((v) => ({
      ...v,
      [`${locator}:${record.phase}`]: true,
      ...(phase ? { [`${locator}:flow:${phase}`]: true } : {}),
    }));
    setManual(!locate);
    if (locate) {
      setTab('steps');
      setNews(false);
    }
    remember(locator, record.id, locate ? 'steps' : tab);
    setInspectorOpen(true);
  };
  const selectFlowRecord = async (node, id) => {
    const loaded = detail?.records.find((record) => record.id === id);
    if (loaded) return selectRecord(loaded);
    flowRequest.current?.abort();
    const controller = new AbortController();
    flowRequest.current = controller;
    setDefinitionStepId(node.stepId);
    setRecordId(id);
    setManual(true);
    setFlowLoading(node.stepId);
    remember(locator, id, tab);
    setInspectorOpen(true);
    try {
      const next = await request(
        'application-run',
        { locator, recordId: id, recordLimit: 40 },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setDetail((previous) =>
        previous?.locator === next.locator && previous.revision > next.revision
          ? previous
          : refreshApplicationRunDetail(previous, next),
      );
      if (next.records.some((record) => record.id === id)) setDefinitionStepId(null);
      setDetailError(null);
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(error);
    } finally {
      if (!controller.signal.aborted) setFlowLoading(null);
    }
  };
  const selectFlowStep = (node) => {
    if (!node) return;
    const id = node.activeRecordIds[0] ?? node.latestRecordId;
    if (id) return selectFlowRecord(node, id);
    flowRequest.current?.abort();
    setFlowLoading(null);
    setDefinitionStepId(node.stepId);
    setRecordId(null);
    setManual(true);
    remember(locator, null, tab);
    setInspectorOpen(true);
  };
  const locateCurrent = () => {
    const record = initialApplicationRecord(detail);
    if (!record) return;
    selectRecord(record, { locate: true });
    requestAnimationFrame(() => {
      const element = workspaceElement.current
        ?.getRootNode()
        .getElementById(`any-record-${record.id}`);
      if (element) {
        const target = element.closest('.any-flow-node') ?? element;
        const viewport = getReadingViewport();
        viewport.element.scrollTo({
          top: viewport.top + target.getBoundingClientRect().top - viewport.offset - 24,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    });
  };
  const selectGroup = (group) => {
    const chosen =
      preferred(group.records.filter((r) => r.kind === runKind)) ??
      (!applicationWorkspace ? preferred(group.records) : null);
    if (chosen) chooseRun(chosen.locator);
  };
  const openChild = (record) => {
    parentStack.current.push({
      locator,
      recordId: record.id,
      tab,
      expanded,
      goalExpanded,
      scrollTop: getReadingViewport().top,
    });
    chooseRun(record.childLocator, { keepParents: true });
  };
  const backParent = () => {
    const parent = parentStack.current.pop();
    if (!parent) {
      if (detail?.parentLocator) chooseRun(detail.parentLocator);
      return;
    }
    restoreScroll.current = parent;
    chooseRun(parent.locator, { restore: parent, keepParents: true });
    anchor.current = null;
  };
  const openEvidence = (e) =>
    setDrawer({
      title: t({ local: '本地校验', model: '模型 Eval', host: '宿主验证' }[e.kind]),
      runId: detail.runId,
      version: e.version,
      message: e.summary,
      evidence: e,
    });
  const openAttempt = (record, attempt) =>
    setDrawer({
      title: attempt.label,
      runId: detail.runId,
      version: detail.application?.version,
      recordId: record.id,
      record: { actionId: record.data.id, stepId: record.stepId, ...attempt.data },
    });
  const openArtifact = async (artifact) => {
    setArtifactLoading(artifact.id);
    try {
      const preview = await request('application-run-artifact', {
        locator,
        artifactId: artifact.id,
      });
      onPreview?.({
        key: preview.key,
        name:
          preview.status === 'changed' ? t('{0}（内容已变化）', [artifact.label]) : artifact.label,
        preview,
      });
      if (preview.status === 'changed' || preview.status === 'unavailable')
        setDrawer({
          title: t('产物读取状态'),
          runId: detail.runId,
          version: detail.application?.version,
          message:
            preview.status === 'changed'
              ? t('产物内容与原记录的摘要不匹配，当前内容不能作为原执行证据。')
              : preview.error,
          record: preview,
        });
    } catch (error) {
      setDrawer({
        title: t('产物无法读取'),
        runId: detail.runId,
        message: error.message,
        record: { artifactId: artifact.id },
      });
    } finally {
      setArtifactLoading(null);
    }
  };
  const openEval = (id) =>
    navigateDashboard({
      view: 'eval',
      projectId,
      runId: id,
      returnTo: {
        view: 'workflow',
        workflow: workspace,
        projectId,
        runLocator: locator,
        recordId,
        runTab: tab,
      },
    });
  const copyContext = async () => {
    const text = JSON.stringify(
      {
        runId: detail.runId,
        revision: detail.revision,
        application: detail.application,
        inspection: detail.inspection,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      setDrawer({
        title: t('已复制只读检查上下文'),
        runId: detail.runId,
        version: detail.application?.version,
        message: t('先读取最新 Run，再由 Agent 根据 Runtime 指引处理。'),
        record: detail.inspection,
      });
    } catch {
      setDrawer({ title: t('只读检查上下文'), runId: detail.runId, record: detail.inspection });
    }
  };
  const loadMore = async () => {
    if (
      !page?.nextCursor ||
      moreLoading ||
      pageContext.current !== listContext ||
      currentListContext.current !== listContext ||
      (moreRequest.current && !moreRequest.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    moreRequest.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted &&
      currentListContext.current === listContext &&
      moreRequest.current === controller;
    setMoreLoading(true);
    try {
      const next = await request(
        'application-runs',
        {
          q: search,
          kind: listKind,
          scope,
          status: 'all',
          limit: 100,
          cursor: page.nextCursor,
        },
        controller.signal,
      );
      if (!isCurrent()) return;
      setPage((p) =>
        !controller.signal.aborted && currentListContext.current === listContext
          ? mergeApplicationRunPages(p, next)
          : p,
      );
    } catch (error) {
      if (!isCurrent()) return;
      if (error.code === 'STALE_APPLICATION_CURSOR') {
        setNews(true);
        setTick((v) => v + 1);
      } else setPageError(error);
    } finally {
      if (isCurrent()) {
        moreRequest.current = null;
        setMoreLoading(false);
      }
    }
  };
  const loadRoster = async () => {
    if (
      !roster?.nextCursor ||
      rosterLoading ||
      rosterContext.current !== rosterGeneration ||
      currentRosterGeneration.current !== rosterGeneration ||
      (rosterMoreRequest.current && !rosterMoreRequest.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    rosterMoreRequest.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted &&
      currentRosterGeneration.current === rosterGeneration &&
      rosterMoreRequest.current === controller;
    setRosterLoading(true);
    try {
      const next = await request(
        'application-runs',
        {
          applicationId,
          kind: runKind,
          limit: 100,
          cursor: roster.nextCursor,
        },
        controller.signal,
      );
      if (!isCurrent()) return;
      setRosters((v) =>
        !controller.signal.aborted && currentRosterGeneration.current === rosterGeneration
          ? {
              ...v,
              [applicationId]: mergeApplicationRunPages(v[applicationId], next),
            }
          : v,
      );
    } catch (error) {
      if (!isCurrent()) return;
      setDrawer({ title: t('历史列表读取失败'), runId: detail?.runId, message: error.message });
      if (error.code === 'STALE_APPLICATION_CURSOR') setTick((v) => v + 1);
    } finally {
      if (isCurrent()) {
        rosterMoreRequest.current = null;
        setRosterLoading(false);
      }
    }
  };
  const currentWork = (
    <div className="any-active-list">
      {current.map((r) => (
        <button
          key={r.id}
          className={recordId === r.id ? 'selected' : ''}
          onClick={() => selectRecord(r, { locate: true })}
        >
          <ApplicationStateIcon status={r.status} />
          <span>{r.title === r.stepId ? r.title : t(r.title)}</span>
          <ApplicationStatus value={r.status} />
          <RightOutlined />
        </button>
      ))}
    </div>
  );
  const inspector = selectedDefinition ? (
    <ApplicationDefinitionInspector step={selectedDefinition} />
  ) : (
    <ApplicationRecordInspector
      detail={detail}
      record={selectedRecord}
      definitionStep={flow?.nodes.find((node) => node.stepId === selectedRecord?.stepId)}
      onChild={openChild}
      onArtifact={openArtifact}
      onEvidence={openEvidence}
      onEvidenceTab={() => {
        setTab('evidence');
        setInspectorOpen(false);
        remember(locator, recordId, 'evidence');
      }}
      onAttempt={openAttempt}
    />
  );
  const time = detail?.readAt ?? page?.readAt;
  const error = detailError ?? pageError;
  const missing = Boolean(detailError && detailError.status === 404);

  return (
    <section
      ref={bindWorkspace}
      className={`any-workspace ${applicationWorkspace ? 'is-application' : 'is-creator'}`}
      data-dashboard-motion="page"
      aria-label={t(applicationWorkspace ? '自定义工作流工作区' : 'Comet Any 工作区')}
    >
      <div className="any-workspace-heading">
        <div>
          <h1>{t(applicationWorkspace ? '自定义工作流' : 'Comet Any')}</h1>
          <p>
            {t(
              applicationWorkspace
                ? '每次运行，一条独立的流程与轨迹'
                : '从需求、方案与确认，到构建、验证和交付',
            )}
          </p>
        </div>
        <Button
          disabled={!applicationWorkspace && Boolean(applicationId) && !selectedGroup?.runs.length}
          onClick={() =>
            onNavigateWorkspace?.(
              applicationWorkspace ? 'any' : 'application',
              applicationWorkspace
                ? (selectedGroup?.creators[0]?.locator ?? locator)
                : selectedGroup?.runs[0]?.locator,
            )
          }
        >
          {t(applicationWorkspace ? '管理创作与分发' : '查看自定义工作流')}
        </Button>
      </div>
      <div className="any-columns">
        <aside className="any-panel any-explorer" data-dashboard-scroll="any-explorer">
          <div className="any-panel-heading">
            <b>{t(applicationWorkspace ? '应用' : '应用与创作')}</b>
            <span>{demo ? t('示例数据') : t('当前项目')}</span>
          </div>
          {!applicationWorkspace && (
            <div className="any-overview">
              <div className="any-stat-strip">
                {[
                  ['all', '全部', groups.length],
                  ...(!applicationWorkspace
                    ? [['draft', '未关联应用', groups.filter((g) => !g.id).length]]
                    : []),
                  ['apps', '应用', groups.filter((g) => g.id).length],
                ].map(([value, label, count]) => (
                  <button
                    key={value}
                    className={scope === value ? 'selected' : ''}
                    aria-pressed={scope === value}
                    title={
                      value === 'apps'
                        ? t('应用可能仍在创作中，是否可用请查看验证与安装状态。')
                        : undefined
                    }
                    onClick={() => setScope(value)}
                  >
                    <span>{t(label)}</span>
                    <b>{count}</b>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="any-search">
            <Input
              aria-label={t('搜索目标或应用')}
              prefix={<SearchOutlined />}
              value={query}
              onChange={(e) => onQuery?.(e.target.value)}
              placeholder={t('搜索目标或应用…')}
              allowClear
            />
          </div>
          <div className="any-filter-line">
            {[
              ['all', '全部'],
              ['attention', '需关注'],
              ['active', '进行中'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'selected' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {pageLoading && !page ? (
            <div className="any-loading">
              <Skeleton active paragraph={{ rows: 8 }} />
            </div>
          ) : (
            <div className="any-entity-list">
              {page?.indexing && (
                <p role="status">
                  {t('正在同步列表')} · {page.indexedCount} / {page.sourceCount}
                </p>
              )}
              {[
                ['draft', '未关联应用的创作'],
                ['apps', '应用'],
              ].map(([section, label]) => {
                const list = visibleGroups.filter((g) =>
                  section === 'draft' ? !g.id : Boolean(g.id),
                );
                return (
                  list.length > 0 && (
                    <section key={section}>
                      <div className="any-list-label">
                        {t(label)}
                        <span>{list.length}</span>
                      </div>
                      {list.map((entry) => {
                        const group = selectedGroup?.key === entry.key ? selectedGroup : entry;
                        return (
                          <div key={group.key} className="any-app-group">
                            <button
                              aria-pressed={selectedGroup?.key === group.key}
                              className={
                                'any-app-row ' +
                                (selectedGroup?.key === group.key ? 'selected' : '')
                              }
                              onClick={() => selectGroup(group)}
                            >
                              <span className="any-app-title">
                                {group.id ? <AppstoreOutlined /> : <FileTextOutlined />}
                                <b>{group.title}</b>
                              </span>
                              <span className="any-app-description">{baseLabel(group.base)}</span>
                              <span className="any-app-summary">
                                <span className="any-app-counts">
                                  {applicationWorkspace
                                    ? t('已加载 {0} 次独立运行', [group.runs.length])
                                    : t('{0} 条创作记录', [group.creators.length])}
                                </span>
                                <span className="any-app-state" hidden={applicationWorkspace}>
                                  {group.creators.length ? (
                                    <>
                                      <span>{t('创作')}</span>
                                      <ApplicationStatus value={preferred(group.creators).status} />
                                    </>
                                  ) : (
                                    <span>{t('无创作记录')}</span>
                                  )}
                                </span>
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </section>
                  )
                );
              })}
              {!visibleGroups.length && !page?.indexing && (
                <Empty
                  description={
                    pageError
                      ? t('列表暂时无法读取')
                      : page?.errors?.length
                        ? t('运行数据源无法读取')
                        : t('暂无匹配的创作或应用运行')
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </div>
          )}
          {pageError && (
            <Alert
              type="warning"
              showIcon
              title={t('列表刷新失败')}
              description={systemText(pageError.message)}
            />
          )}
          {page?.errors?.map((e) => (
            <Alert
              key={e.source}
              type="warning"
              showIcon
              title={t('部分运行数据无法读取')}
              description={systemText(e.message)}
            />
          ))}
          {page?.nextCursor && (
            <Button block onClick={loadMore} loading={moreLoading}>
              {t('加载更多记录')}
            </Button>
          )}
          <div className="any-explorer-foot">
            <span>
              {page
                ? t('已加载 {0} / {1} 条记录', [page.items.length, page.total])
                : t('正在读取记录')}
            </span>
            {!applicationWorkspace && <small>{t('未关联应用的创作按目标显示。')}</small>}
          </div>
        </aside>
        <section className="any-panel any-run-panel" data-dashboard-scroll="any-workspace">
          {selectedSummary && (
            <ApplicationHistorySelector
              viewScope={viewScope}
              group={selectedGroup}
              selected={selectedSummary}
              applicationWorkspace={applicationWorkspace}
              onSelect={chooseRun}
              loading={rosterLoading}
              error={rosterError}
              hasMore={Boolean(roster?.nextCursor)}
              onMore={loadRoster}
              onRetry={() => setTick((value) => value + 1)}
              versionHistory={applicationWorkspace ? null : versionHistory}
            />
          )}
          {(parentStack.current.length > 0 || detail?.parentLocator) && (
            <Button
              className="any-parent-back"
              type="link"
              icon={<ArrowLeftOutlined />}
              onClick={backParent}
            >
              {t('返回父运行')}
            </Button>
          )}
          {!selectedSummary ? (
            <div className="any-run-empty">
              {pageLoading ? (
                <Skeleton active paragraph={{ rows: 8 }} />
              ) : (
                <Empty description={t('选择创作或运行记录')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
          ) : (
            <>
              <div ref={runMotion} className="any-run-header" data-dashboard-motion="panel">
                <div className="any-run-title">
                  <div>
                    <h2>
                      <span className="any-run-name">
                        {managedApplication
                          ? selectedSummary.title
                          : (selectedSummary.goal ?? selectedSummary.title)}
                      </span>
                      <ApplicationStatus value={selectedSummary.status} />
                      {selectedSummary.isChild && <Tag>{t('子流程')}</Tag>}
                      {selectedSummary.archive && <Tag>{t('历史实验 · 只读')}</Tag>}
                    </h2>
                  </div>
                </div>
                <div className="any-version-line">
                  <span className="any-run-identity">
                    {t(
                      managedApplication
                        ? '版本来源'
                        : selectedSummary.kind === 'application'
                          ? '运行轨迹'
                          : '创作记录',
                    )}{' '}
                    <code>{selectedSummary.runId ?? t('无法读取')}</code>
                  </span>
                  {selectedSummary.application ? (
                    <>
                      <Tooltip
                        title={t(
                          selectedSummary.kind === 'creator' ? '本次创作版本' : '本次运行固定版本',
                        )}
                      >
                        <span className="any-version">v{selectedSummary.application.version}</span>
                      </Tooltip>
                      <span>{baseLabel(selectedSummary.application.base)}</span>
                    </>
                  ) : (
                    <span>{t('尚未生成或无法读取固定应用版本')}</span>
                  )}
                </div>
                {!applicationWorkspace &&
                  !selectedSummary.archive &&
                  (managedApplication || selectedSummary.status === 'delivered') &&
                  selectedSummary.application && (
                    <div className="any-delivery-trigger">
                      <Tooltip title={t('完成创作并校验固定版本后，可分发或导出完整应用。')}>
                        <Button
                          size="small"
                          disabled={
                            !detail ||
                            detailLoading ||
                            detail.material.status !== 'matched' ||
                            (detail.kind === 'creator' && detail.status !== 'delivered')
                          }
                          onClick={() => setDeliveryOpen(true)}
                        >
                          {t('分发 / 导出')}
                        </Button>
                      </Tooltip>
                    </div>
                  )}
                <Collapse
                  className="any-run-context"
                  ghost
                  activeKey={goalExpanded ? ['goal'] : []}
                  onChange={(keys) => setGoalExpanded(keys.includes('goal'))}
                  items={[
                    {
                      key: 'goal',
                      label: t('目标与运行信息'),
                      children: (
                        <>
                          <p>{selectedSummary.goal ?? t('查看本次运行的步骤、决定与验收证据。')}</p>
                          <small>{selectedSummary.runId}</small>
                        </>
                      ),
                    },
                  ]}
                />
              </div>
              {error && (
                <Alert
                  className="any-error"
                  type="warning"
                  showIcon
                  title={missing ? t('所选运行记录已移除') : t('运行记录刷新失败')}
                  description={systemText(error.message)}
                  action={
                    !detail && (
                      <Button size="small" onClick={() => setTick((v) => v + 1)}>
                        {t('重试读取')}
                      </Button>
                    )
                  }
                />
              )}
              {detailLoading && !detail ? (
                <div className="any-loading">
                  <Skeleton active paragraph={{ rows: 8 }} />
                </div>
              ) : detail?.error ? (
                <div className="any-run-empty">
                  <Empty
                    description={systemText(detail.error.message)}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => setTick((v) => v + 1)}>
                    {t('重试读取')}
                  </Button>
                </div>
              ) : detail ? (
                managedApplication ? (
                  <div className="any-package-overview">
                    <h3>{t('版本与分发')}</h3>
                    <p>
                      {t(
                        '这是已安装的固定应用版本。创作记录缺失时仍可核对内容、分发与导出；每次使用的轨迹在自定义工作流中查看。',
                      )}
                    </p>
                    <ApplicationEvidenceView
                      detail={detail}
                      onEvidence={openEvidence}
                      onSource={chooseRun}
                      onEval={openEval}
                    />
                    <Button onClick={() => onNavigateWorkspace?.('application', locator)}>
                      {t('查看此版本的运行')}
                    </Button>
                  </div>
                ) : (
                  <>
                    {detail.material.status === 'changed' ||
                    detail.material.status === 'unavailable' ? (
                      <Alert
                        className="any-error"
                        type="warning"
                        showIcon
                        title={t('固定应用内容需要核对')}
                        description={systemText(
                          detail.material.message ??
                            t('当前候选内容无法核对，保存的 Run 与历史结果仍可查看。'),
                        )}
                      />
                    ) : null}
                    <details className="any-current-disclosure" open={!applicationWorkspace}>
                      <summary>
                        <span>{t('当前工作')}</span>
                        {counts.map((c) => (
                          <span key={c.value}>
                            {c.count} {t(c.label)}
                          </span>
                        ))}
                      </summary>
                      <div className="any-current">
                        <div className="any-current-heading">
                          <b>{t(current.length ? '当前工作' : '本次记录没有活动项')}</b>
                          <span>{t(manual ? '正在查看所选记录' : '已定位需处理项')}</span>
                        </div>
                        <div className="any-current-counts">
                          {counts.map((c) => (
                            <span key={c.value}>
                              <b>{c.count}</b> {t(c.label)}
                            </span>
                          ))}
                        </div>
                        {applicationWorkspace ? (
                          <Collapse
                            ghost
                            size="small"
                            items={[
                              { key: 'active', label: t('查看当前工作'), children: currentWork },
                            ]}
                          />
                        ) : (
                          currentWork
                        )}
                        {!current.length && (
                          <p>{t('已有步骤、决定与产物继续保留，可展开查看历史。')}</p>
                        )}
                        {current.some((r) => r.status === 'running') && (
                          <small>{t('已领取表示等待宿主回传，不代表宿主当前在线。')}</small>
                        )}
                        {!detail.archive && (
                          <div className="any-continue-context">
                            <span>{t('在 Agent 中继续处理，先读取最新运行。')}</span>
                            <Button size="small" icon={<CopyOutlined />} onClick={copyContext}>
                              {t('复制只读检查上下文')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </details>
                    <div className="any-run-activity">
                      <div className={'any-follow-bar ' + (news ? 'has-news' : '')}>
                        <span aria-live="polite">
                          {(news || manual) &&
                            t(news ? '有新进展，当前阅读位置已保留' : '已保留你的阅读位置')}
                        </span>
                        <Button
                          size="small"
                          type="link"
                          icon={<AimOutlined />}
                          onClick={locateCurrent}
                        >
                          {t('回到当前工作')}
                        </Button>
                      </div>
                      <div className={'any-sync-line ' + (error ? 'has-error' : '')} role="status">
                        <span>
                          {error ? t('刷新失败，正在显示上次成功读取') : t('上次成功读取')}{' '}
                          {time
                            ? new Date(time).toLocaleString(getDashboardLocale())
                            : t('尚未成功读取')}
                        </span>
                        {error && (
                          <Button size="small" type="link" onClick={() => setTick((v) => v + 1)}>
                            {t('重试读取')}
                          </Button>
                        )}
                      </div>
                    </div>
                    {recordId && !selectedRecord && !flowLoading && (
                      <Alert
                        className="any-error"
                        type="info"
                        title={t('所选执行记录已不在当前快照中，请重新选择。')}
                      />
                    )}
                    <Tabs
                      className="any-tabs"
                      size="small"
                      activeKey={tab}
                      onChange={(value) => {
                        setTab(value);
                        setManual(true);
                        remember(locator, recordId, value);
                      }}
                      items={[
                        { key: 'steps', label: t(applicationWorkspace ? '步骤' : '创作流程') },
                        { key: 'history', label: t('执行记录') },
                        {
                          key: 'artifacts',
                          label: t(applicationWorkspace ? '产物' : '方案与产物'),
                        },
                        {
                          key: 'evidence',
                          label: t(applicationWorkspace ? '版本与证据' : '验证证据'),
                        },
                      ]}
                    />
                    <div
                      ref={tabMotion}
                      className="dashboard-motion-surface any-tab-content"
                      data-dashboard-motion="tab"
                    >
                      {['steps', 'history'].includes(tab) && detail.recordPage?.nextCursor && (
                        <Button loading={recordsLoading} onClick={loadMoreRecords}>
                          {t('加载更多执行记录')}
                        </Button>
                      )}
                      {tab === 'steps' && flow && (
                        <ApplicationWorkflowView
                          layout={applicationWorkspace ? 'graph' : 'stages'}
                          creator={!applicationWorkspace}
                          flow={flow}
                          locator={locator}
                          recordId={recordId}
                          stepId={definitionStepId}
                          expanded={expanded}
                          setExpanded={setExpanded}
                          selectStep={selectFlowStep}
                          selectRecordId={selectFlowRecord}
                          loading={flowLoading}
                        />
                      )}
                      {tab === 'steps' && !flow && (
                        <>
                          {detail.definition?.status &&
                            detail.definition.status !== 'available' && (
                              <Alert
                                className="any-error"
                                showIcon
                                type={detail.definition.status === 'missing' ? 'info' : 'warning'}
                                title={t('完整流程定义暂不可用，继续展示实际执行记录。')}
                                description={
                                  detail.definition.message
                                    ? systemText(detail.definition.message)
                                    : undefined
                                }
                              />
                            )}
                          <ApplicationStepList
                            steps={steps}
                            locator={locator}
                            recordId={recordId}
                            expanded={expanded}
                            setExpanded={setExpanded}
                            selectRecord={selectRecord}
                          />
                        </>
                      )}
                      {tab === 'history' && (
                        <div className="any-history">
                          {[...detail.records].reverse().map((r) => (
                            <button
                              key={r.id}
                              id={`any-record-${r.id}`}
                              data-record-id={r.id}
                              className={recordId === r.id ? 'selected' : ''}
                              onClick={() => selectRecord(r)}
                            >
                              <span className="any-sequence">
                                {r.sequence === null ? '—' : `#${r.sequence}`}
                              </span>
                              <span>
                                <b>{r.title === r.stepId ? r.title : t(r.title)}</b>
                                <small>
                                  {formatApplicationRecordType(r.type)} ·{' '}
                                  {r.attempt === null ? t('等待记录') : t('尝试 {0}', [r.attempt])}
                                </small>
                              </span>
                              <ApplicationStatus value={r.status} />
                              <RightOutlined />
                            </button>
                          ))}
                          <p className="any-footnote">
                            {t('按 SDK 记录顺序展示；旧尝试的完整输入输出可能未被保存。')}
                          </p>
                        </div>
                      )}
                      {tab === 'artifacts' && (
                        <div className="any-artifact-list">
                          {detail.artifacts.map((a) => (
                            <button
                              key={a.id}
                              disabled={artifactLoading === a.id}
                              onClick={() => openArtifact(a)}
                            >
                              <FileTextOutlined />
                              <span>
                                <b>{a.label}</b>
                                <small>{a.uri ?? t('保存的输出快照')}</small>
                              </span>
                              <RightOutlined />
                            </button>
                          ))}
                          {!detail.artifacts.length && (
                            <Empty
                              description={t('尚未收到产物')}
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                            />
                          )}
                        </div>
                      )}
                      {tab === 'evidence' && (
                        <ApplicationEvidenceView
                          detail={detail}
                          onEvidence={openEvidence}
                          onSource={chooseRun}
                          onEval={openEval}
                        />
                      )}
                    </div>
                    {detail.relatedChange && (
                      <div className="any-related">
                        <Button type="link" onClick={() => onRelatedChange?.(detail.relatedChange)}>
                          {t('查看对应 {0} 变更', [
                            detail.relatedChange.workflow === 'native' ? 'Native' : 'Classic',
                          ])}
                        </Button>
                      </div>
                    )}
                  </>
                )
              ) : null}
            </>
          )}
        </section>
        <aside className="any-panel any-inspector" data-dashboard-scroll="any-inspector">
          {!applicationWorkspace && (
            <ApplicationCreationSidebar
              detail={detail}
              hasRuns={Boolean(selectedGroup?.runs.length)}
              onEvidence={openEvidence}
              onRuns={() =>
                onNavigateWorkspace?.('application', preferred(selectedGroup?.runs ?? [])?.locator)
              }
            />
          )}
        </aside>
      </div>
      {deliveryOpen && detail?.application && (
        <ApplicationDeliveryModal
          key={locator}
          projectId={projectId}
          projectPath={projectPath}
          detail={detail}
          demo={demo}
          onClose={() => setDeliveryOpen(false)}
        />
      )}
      <p className="any-page-foot">
        <InfoCircleOutlined /> {t('只读观测：运行状态、用户决定和证据均来自保存的 SDK Run。')}
      </p>
      <Drawer
        title={t('步骤与验证详情')}
        rootClassName="any-detail-drawer"
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        size={420}
      >
        {inspector}
        {flow &&
          (() => {
            const node =
              selectedDefinition ?? flow.nodes.find((n) => n.stepId === selectedRecord?.stepId);
            return node ? (
              <div className="any-step-extra">
                <TransitionPaths
                  node={node}
                  byId={new Map(flow.nodes.map((n) => [n.stepId, n]))}
                  selectStep={selectFlowStep}
                />
                <h4>{t('执行历史')}</h4>
                {detail.recordPage?.nextCursor && (
                  <Button loading={recordsLoading} onClick={loadMoreRecords}>
                    {t('加载更多执行记录')}
                  </Button>
                )}
                {node.records.map((record) => (
                  <button
                    key={record.id}
                    className="any-round-row"
                    data-record-id={record.id}
                    onClick={() => selectFlowRecord(node, record.id)}
                  >
                    <span>#{record.sequence ?? '—'}</span>
                    <ApplicationStatus value={record.status} />
                  </button>
                ))}
              </div>
            ) : null;
          })()}
      </Drawer>
      <Drawer
        title={drawer?.title}
        rootClassName="any-detail-drawer"
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        size={530}
      >
        <ApplicationObservationDrawer data={drawer} />
      </Drawer>
    </section>
  );
}
