import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Form,
  Input,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import {
  Alert,
  Badge,
  Card as AntCard,
  Drawer,
  Empty,
  Layout,
  Menu,
  Modal,
  Progress,
  Steps,
  Tabs,
} from 'antd';
import {
  AppstoreOutlined,
  BranchesOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FlagOutlined,
  MenuOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  SyncOutlined,
  UndoOutlined,
  UserOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import { createRoot } from 'react-dom/client';
import {
  extractToc,
  renderJsonPreview,
  renderMarkdown,
  renderYamlTable,
  runMermaid,
} from './markdown-preview.js';
import { NativeWorkflowPanel } from './native-workflow-panel.jsx';
import { useAnimatedNumber } from './use-animated-number.js';
import { DashboardWorkspaceRegion } from './workspace-layout.jsx';
import {
  dashboardChangeKey,
  dashboardResponseError,
  isStaleNativeDashboardCursorError,
  nativeDashboardChangeKey,
  refreshDashboardPage,
  refreshNativeDashboardPage,
  shouldAutoLoadDashboardDetail,
  shouldShowDashboardDetailLoading,
} from './dashboard-web-state.js';
import './styles.css';

const AUTO_REFRESH_MS = 30_000;
const MEMORY_COLLAPSE_THRESHOLD = 240;
const DASHBOARD_FONT_FAMILY =
  "'Segoe UI Variable', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif";
const DASHBOARD_MONO_FONT_FAMILY = "Bahnschrift, 'Cascadia Mono', Consolas, monospace";

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem('comet-theme');
    const initial =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    // 同步设置属性，避免首次渲染闪烁
    document.documentElement.setAttribute('data-theme', initial);
    return initial;
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    localStorage.setItem('comet-theme', theme);

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}

const PHASES = [
  ['open', '启动'],
  ['design', '设计'],
  ['build', '构建'],
  ['verify', '验证'],
  ['archive', '归档'],
];

const ARTIFACTS = [
  ['proposal', 'proposal.md', '提案'],
  ['design', 'design.md', '设计文档'],
  ['tasks', 'tasks.md', '任务清单'],
  ['plan', 'plan.md', '实施计划'],
  ['verifyReport', 'verify-result.md', '验证报告'],
  ['cometYaml', '.comet.yaml', '变更配置'],
];

const SOURCE_LABELS = {
  openspec: 'OpenSpec 产物',
  superpowers: 'Superpowers 产物',
  comet: 'Comet 中间产物',
};

const VERIFY_LABEL = {
  pass: '通过',
  fail: '验证失败',
  pending: '待验证',
  unknown: '未知',
};

const VERIFY_TONE = {
  pass: 'ok',
  fail: 'danger',
  pending: 'warn',
  unknown: 'neutral',
};

function App() {
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: theme === 'dark' ? '#7fa8ff' : '#255ed8',
          colorBgContainer: theme === 'dark' ? '#151923' : '#ffffff',
          colorBgElevated: theme === 'dark' ? '#1a202b' : '#ffffff',
          colorBgLayout: theme === 'dark' ? '#0e1420' : '#eef1f5',
          colorText: theme === 'dark' ? '#edf2fb' : '#101827',
          colorTextSecondary: theme === 'dark' ? '#aab5c8' : '#5f6979',
          colorBorder: theme === 'dark' ? '#293345' : '#e3e8ef',
          colorSplit: theme === 'dark' ? '#293345' : '#edf0f4',
          colorFillAlter: theme === 'dark' ? '#182131' : '#f6f8fb',
          colorInfoBg: theme === 'dark' ? '#1a202b' : '#e6f4ff',
          colorInfoBorder: theme === 'dark' ? '#34597f' : '#91caff',
          borderRadius: 12,
          fontFamily: DASHBOARD_FONT_FAMILY,
          fontFamilyCode: DASHBOARD_MONO_FONT_FAMILY,
          fontSize: 14,
          fontSizeHeading2: 26,
          fontSizeHeading3: 18,
          fontSizeHeading4: 15,
        },
      }}
    >
      <AntApp>
        <DashboardApp theme={theme} onToggleTheme={toggleTheme} />
      </AntApp>
    </ConfigProvider>
  );
}

function DashboardApp({ theme, onToggleTheme }) {
  const [snapshot, setSnapshot] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [workflow, setWorkflow] = useState('classic');
  const [pluginSelection, setPluginSelection] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('comet.personal-memory');
  const [pluginPages, setPluginPages] = useState([]);
  const [pluginPage, setPluginPage] = useState(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginError, setPluginError] = useState(null);
  const [pluginRefreshToken, setPluginRefreshToken] = useState(0);
  const pluginSelectionRef = useRef(null);
  const pluginProjectRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [pages, setPages] = useState({ active: null, archived: null, all: null });
  const [nativePages, setNativePages] = useState({ active: null, archived: null, all: null });
  const [pageLoading, setPageLoading] = useState(null);
  const [nativePageLoading, setNativePageLoading] = useState(null);
  const [nativeSelectedDetail, setNativeSelectedDetail] = useState(null);
  const [nativeDetailLoading, setNativeDetailLoading] = useState(false);
  const [nativeDetailError, setNativeDetailError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [artifact, setArtifact] = useState(null);
  const snapshotRequestRef = useRef(null);
  const pageRequestRef = useRef(null);
  const nativePageRequestRef = useRef(null);
  const nativeDetailRequestRef = useRef(null);
  const detailRequestRef = useRef(null);
  const selectedIdRef = useRef(null);
  const pagesRef = useRef({ active: null, archived: null, all: null });
  const nativePagesRef = useRef({ active: null, archived: null, all: null });
  const nativeSelectedDetailRef = useRef(null);
  const lastLoadedQueryRef = useRef('');
  const { message: messageApi } = AntApp.useApp();
  const toast = useCallback((content, type = 'success') => messageApi[type](content), [messageApi]);

  const useDemo = new URLSearchParams(window.location.search).has('demo');
  const queryRef = useRef(query);
  const tabRef = useRef(tab);
  const workflowRef = useRef(workflow);
  const activePluginPageId = settingsOpen ? settingsSection : pluginSelection;
  queryRef.current = query;
  tabRef.current = tab;
  workflowRef.current = workflow;
  nativeSelectedDetailRef.current = nativeSelectedDetail;
  pluginSelectionRef.current = activePluginPageId;
  pluginProjectRef.current = activeProjectId;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const refresh = useCallback(
    async (manual = false) => {
      if (!useDemo && !activeProjectId) return;
      snapshotRequestRef.current?.abort();
      const controller = new AbortController();
      snapshotRequestRef.current = controller;
      if (manual) setLoading(true);
      try {
        const next = useDemo
          ? await loadDemoSnapshot()
          : await fetchDashboardOverview(activeProjectId, controller.signal, queryRef.current);
        if (snapshotRequestRef.current !== controller || controller.signal.aborted) return;

        if (useDemo) {
          setSnapshot(next);
          const nextId = pickSelected(next, selectedIdRef.current);
          setSelectedId(nextId);
          setSelectedDetail(findChange(next, nextId));
          lastLoadedQueryRef.current = query;
        } else {
          const initialPage = next.initialChanges;
          const currentTab = tabRef.current;
          const currentQuery = queryRef.current;
          const queryChanged = currentQuery !== lastLoadedQueryRef.current;
          const nextPages = queryChanged
            ? { active: initialPage, archived: null, all: null }
            : {
                ...pagesRef.current,
                active: refreshDashboardPage(pagesRef.current.active, initialPage),
              };
          const currentPage = currentTab === 'active' ? nextPages.active : nextPages[currentTab];
          setSnapshot(materializeOverview(next, initialPage));
          pagesRef.current = nextPages;
          setPages(nextPages);
          const nextNativePages = queryChanged
            ? { active: null, archived: null, all: null }
            : nativePagesRef.current;
          nativePagesRef.current = nextNativePages;
          setNativePages(nextNativePages);
          if (!queryChanged && workflowRef.current === 'native' && next.native) {
            const selectedNative = nativeSelectedDetailRef.current;
            const selectedNativeKey = selectedNative
              ? nativeDashboardChangeKey(selectedNative)
              : null;
            const nativeRefreshes = [];
            if (nextNativePages[currentTab]) {
              nativeRefreshes.push(
                fetchDashboardNativeChangePage(activeProjectId, currentTab, {
                  query: currentQuery,
                  signal: controller.signal,
                }).then((freshPage) => {
                  if (snapshotRequestRef.current !== controller || controller.signal.aborted)
                    return;
                  const currentNativePages = nativePagesRef.current;
                  const refreshedPage = refreshNativeDashboardPage(
                    currentNativePages[currentTab],
                    freshPage,
                  );
                  const refreshedPages = {
                    ...currentNativePages,
                    [currentTab]: refreshedPage,
                  };
                  nativePagesRef.current = refreshedPages;
                  setNativePages(refreshedPages);
                }),
              );
            }
            if (selectedNative) {
              nativeRefreshes.push(
                fetchDashboardNativeChangeDetail(
                  activeProjectId,
                  selectedNative,
                  controller.signal,
                ).then((freshDetail) => {
                  if (snapshotRequestRef.current !== controller || controller.signal.aborted)
                    return;
                  const currentSelected = nativeSelectedDetailRef.current;
                  if (
                    currentSelected &&
                    selectedNativeKey === nativeDashboardChangeKey(currentSelected)
                  ) {
                    nativeSelectedDetailRef.current = freshDetail;
                    setNativeSelectedDetail(freshDetail);
                  }
                }),
              );
            }
            await Promise.allSettled(nativeRefreshes);
          }
          const nextId = pickSelectedFromPage(
            queryChanged && currentTab !== 'active' ? nextPages[currentTab] : currentPage,
            selectedIdRef.current,
          );
          const previousSelectedId = selectedIdRef.current;
          setSelectedId(nextId);
          selectedIdRef.current = nextId;
          if (nextId !== previousSelectedId) {
            setSelectedDetail(null);
            setDetailError(null);
            setDetailLoading(false);
          }
          lastLoadedQueryRef.current = currentQuery;
        }
        if (manual) toast('状态已刷新');
      } catch (error) {
        if (controller.signal.aborted) return;
        toast(`刷新失败：${error.message}`, 'error');
      } finally {
        if (snapshotRequestRef.current === controller) {
          snapshotRequestRef.current = null;
          if (manual) setLoading(false);
        }
      }
    },
    [activeProjectId, toast, useDemo],
  );

  useEffect(() => {
    if (!useDemo && (!projectsReady || !activeProjectId)) return undefined;
    void refresh(false);

    const timer = window.setInterval(() => {
      void refresh(false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [activeProjectId, projectsReady, refresh, useDemo]);

  useEffect(
    () => () => {
      snapshotRequestRef.current?.abort();
      pageRequestRef.current?.abort();
      nativePageRequestRef.current?.abort();
      nativeDetailRequestRef.current?.abort();
      nativeDetailRequestRef.current?.abort();
      detailRequestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (useDemo) return undefined;
    let cancelled = false;
    void fetchDashboardProjects()
      .then((directory) => {
        if (cancelled) return;
        setProjects(directory.projects ?? []);
        const available = (directory.projects ?? []).filter(
          (project) => project.availability === 'available',
        );
        const remembered = localStorage.getItem('comet-dashboard-project');
        const next =
          available.find((project) => project.id === remembered)?.id ?? directory.currentProjectId;
        setActiveProjectId((previous) => previous ?? next);
        setProjectsReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectsReady(true);
        toast(`项目列表加载失败：${error.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [useDemo]);

  const reloadPluginPages = useCallback(async () => {
    if (useDemo || !activeProjectId) return;
    const requestedProjectId = activeProjectId;
    try {
      const nextPages = await fetchDashboardPluginPages(requestedProjectId);
      if (pluginProjectRef.current !== requestedProjectId) return;
      const availablePages = nextPages.pages ?? [];
      setPluginPages(availablePages);
      return availablePages;
    } catch (error) {
      toast(`插件页面加载失败：${error.message}`, 'error');
      return undefined;
    }
  }, [activeProjectId, toast, useDemo]);

  useEffect(() => {
    if (useDemo || !activeProjectId) return undefined;
    let cancelled = false;
    setPluginSelection(null);
    setSettingsOpen(false);
    setPluginPage(null);
    setPluginError(null);
    void fetchDashboardPluginPages(activeProjectId)
      .then((response) => {
        if (!cancelled) setPluginPages(response.pages ?? []);
      })
      .catch((error) => {
        if (!cancelled) toast(`插件页面加载失败：${error.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, toast, useDemo]);

  useEffect(() => {
    if (useDemo || !activeProjectId || !activePluginPageId) return undefined;
    let cancelled = false;
    setPluginLoading(true);
    setPluginError(null);
    void fetchDashboardPluginPage(activeProjectId, activePluginPageId)
      .then((page) => {
        if (!cancelled) setPluginPage(page);
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginPage(null);
          setPluginError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setPluginLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePluginPageId, activeProjectId, pluginRefreshToken, settingsOpen, useDemo]);

  const invokePlugin = useCallback(
    async (pluginId, capability, input) => {
      if (!activeProjectId) return;
      const requestedProjectId = activeProjectId;
      const requestedPluginId = pluginId;
      const result = await invokeDashboardPlugin(requestedProjectId, pluginId, capability, input);
      if (
        pluginProjectRef.current === requestedProjectId &&
        pluginSelectionRef.current === requestedPluginId
      ) {
        setPluginPage((current) =>
          reconcilePluginInvocationResult(current, requestedPluginId, capability, result),
        );
      }
      const [nextPage] = await Promise.all([
        fetchDashboardPluginPage(requestedProjectId, pluginId),
        reloadPluginPages(),
      ]);
      if (
        pluginProjectRef.current !== requestedProjectId ||
        pluginSelectionRef.current !== requestedPluginId
      )
        return result;
      setPluginPage(
        reconcilePluginInvocationResult(nextPage, requestedPluginId, capability, result),
      );
      return result;
    },
    [activeProjectId, reloadPluginPages],
  );

  const invokeActivePlugin = useCallback(
    async (pluginId, capability, input) => {
      try {
        let result;
        if (capability === 'lifecycle') {
          await lifecycleDashboardPlugin(activeProjectId, pluginId, input.action);
          if (input.action === 'uninstall') {
            const nextPages = (await reloadPluginPages()) ?? [];
            setPluginPage(null);
            setPluginError(null);
            if (settingsOpen) {
              const nextSection = nextPages.find((page) => page.pluginId !== pluginId)?.pluginId;
              if (nextSection) setSettingsSection(nextSection);
              else setSettingsOpen(false);
            } else {
              setPluginSelection(null);
            }
          } else {
            setPluginRefreshToken((value) => value + 1);
            await reloadPluginPages();
          }
        } else {
          result = await invokePlugin(pluginId, capability, input);
        }
        toast('插件状态已更新');
        return result;
      } catch (error) {
        toast(`插件操作失败：${error.message}`, 'error');
        return undefined;
      }
    },
    [activeProjectId, invokePlugin, reloadPluginPages, settingsOpen, toast],
  );

  const loadPage = useCallback(
    async (nextTab, append = false) => {
      if (useDemo || !activeProjectId) return;
      if (append && pageRequestRef.current) return;
      const existing = pagesRef.current[nextTab];
      if (append && !existing?.nextCursor) return;
      pageRequestRef.current?.abort();
      const controller = new AbortController();
      pageRequestRef.current = controller;
      setPageLoading(nextTab);
      try {
        const page = await fetchDashboardChangePage(activeProjectId, nextTab, {
          cursor: append ? existing?.nextCursor : undefined,
          query,
          signal: controller.signal,
        });
        if (pageRequestRef.current !== controller || controller.signal.aborted) return;
        const merged =
          append && existing ? { ...page, items: [...existing.items, ...page.items] } : page;
        setPages((previous) => ({ ...previous, [nextTab]: merged }));
        setSnapshot((previous) =>
          previous ? updateSnapshotChangeRows(previous, nextTab, merged.items) : previous,
        );
        lastLoadedQueryRef.current = query;
      } catch (error) {
        if (controller.signal.aborted) return;
        toast(`变更列表加载失败：${error.message}`, 'error');
      } finally {
        if (pageRequestRef.current === controller) {
          pageRequestRef.current = null;
          setPageLoading(null);
        }
      }
    },
    [activeProjectId, query, toast, useDemo],
  );

  useEffect(() => {
    if (useDemo || !snapshot || !activeProjectId || query === lastLoadedQueryRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      snapshotRequestRef.current?.abort();
      pageRequestRef.current?.abort();
      nativePageRequestRef.current?.abort();
      setPages({ active: null, archived: null, all: null });
      pagesRef.current = { active: null, archived: null, all: null };
      setNativePages({ active: null, archived: null, all: null });
      nativePagesRef.current = { active: null, archived: null, all: null };
      setNativeSelectedDetail(null);
      nativeSelectedDetailRef.current = null;
      setNativeDetailError(null);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, query, snapshot, useDemo]);

  useEffect(() => {
    if (useDemo || !snapshot || !activeProjectId || pages[tab]) return;
    void loadPage(tab);
  }, [activeProjectId, loadPage, pages, snapshot, tab, useDemo]);

  const loadNativePage = useCallback(
    async (nextTab, append = false) => {
      if (useDemo || workflow !== 'native' || !activeProjectId || !snapshot?.native) return;
      if (append && nativePageRequestRef.current) return;
      const existing = nativePagesRef.current[nextTab];
      if (append && !existing?.nextCursor) return;
      nativePageRequestRef.current?.abort();
      const controller = new AbortController();
      nativePageRequestRef.current = controller;
      setNativePageLoading(nextTab);
      try {
        const page = await fetchDashboardNativeChangePage(activeProjectId, nextTab, {
          cursor: append ? existing?.nextCursor : undefined,
          query,
          signal: controller.signal,
        });
        if (nativePageRequestRef.current !== controller || controller.signal.aborted) return;
        const merged =
          append && existing ? { ...page, items: [...existing.items, ...page.items] } : page;
        const nextPages = { ...nativePagesRef.current, [nextTab]: merged };
        nativePagesRef.current = nextPages;
        setNativePages(nextPages);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (append && isStaleNativeDashboardCursorError(error)) {
          const resetPages = { ...nativePagesRef.current, [nextTab]: null };
          nativePagesRef.current = resetPages;
          setNativePages(resetPages);
          toast('Native 变更列表已更新，正在重新加载第一页。', 'info');
          return;
        }
        toast(`Native 变更列表加载失败：${error.message}`, 'error');
      } finally {
        if (nativePageRequestRef.current === controller) {
          nativePageRequestRef.current = null;
          setNativePageLoading(null);
        }
      }
    },
    [activeProjectId, query, snapshot, toast, useDemo, workflow],
  );

  const selectNativeChange = useCallback(
    async (change) => {
      if (!change) return;
      setNativeDetailError(null);
      if (
        nativeSelectedDetailRef.current &&
        nativeDashboardChangeKey(nativeSelectedDetailRef.current) !==
          nativeDashboardChangeKey(change)
      ) {
        nativeSelectedDetailRef.current = null;
        setNativeSelectedDetail(null);
      }
      if (useDemo) {
        setNativeSelectedDetail(change);
        nativeSelectedDetailRef.current = change;
        return;
      }
      if (!activeProjectId) return;
      nativeDetailRequestRef.current?.abort();
      const controller = new AbortController();
      nativeDetailRequestRef.current = controller;
      setNativeDetailLoading(true);
      try {
        const detail = await fetchDashboardNativeChangeDetail(
          activeProjectId,
          change,
          controller.signal,
        );
        if (nativeDetailRequestRef.current !== controller || controller.signal.aborted) return;
        setNativeSelectedDetail(detail);
        nativeSelectedDetailRef.current = detail;
      } catch (error) {
        if (controller.signal.aborted) return;
        setNativeDetailError({
          change,
          reason: error instanceof Error ? error.message : String(error),
        });
        toast(`Native 变更详情加载失败：${error.message}`, 'error');
      } finally {
        if (nativeDetailRequestRef.current === controller) {
          nativeDetailRequestRef.current = null;
          setNativeDetailLoading(false);
        }
      }
    },
    [activeProjectId, toast, useDemo],
  );

  useEffect(() => {
    if (useDemo || workflow !== 'native' || !snapshot?.native || nativePages[tab]) return;
    void loadNativePage(tab);
  }, [loadNativePage, nativePages, snapshot, tab, useDemo, workflow]);

  const selected = selectedDetail;
  const visible = useMemo(
    () => (useDemo ? filterChanges(snapshot, tab, query) : (pages[tab]?.items ?? [])),
    [pages, query, snapshot, tab, useDemo],
  );
  const activePage = pages[tab];
  const visibleTotal = useDemo ? visible.length : (activePage?.total ?? visible.length);
  const nativePage = nativePages[tab];
  const nativeOverviewTotal =
    tab === 'active'
      ? (snapshot?.native?.activeChangeCount ?? 0)
      : tab === 'archived'
        ? (snapshot?.native?.archivedChangeCount ?? 0)
        : (snapshot?.native?.totalChangeCount ?? 0);
  const nativeVisibleTotal = useDemo
    ? (snapshot?.native?.changes?.length ?? 0)
    : (nativePage?.total ?? nativeOverviewTotal);

  const selectChange = useCallback(
    async (id) => {
      selectedIdRef.current = id;
      setSelectedId(id);
      setDetailError(null);
      if (useDemo) {
        setSelectedDetail(findChange(snapshot, id));
        return;
      }
      if (!activeProjectId) return;
      detailRequestRef.current?.abort();
      const controller = new AbortController();
      detailRequestRef.current = controller;
      setDetailLoading(true);
      try {
        const detail = await fetchDashboardChangeDetail(activeProjectId, id, controller.signal);
        if (detailRequestRef.current !== controller || controller.signal.aborted) return;
        setSelectedDetail(detail);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDetailError({ id, message: error instanceof Error ? error.message : String(error) });
        toast(`变更详情加载失败：${error.message}`, 'error');
      } finally {
        if (detailRequestRef.current === controller) {
          detailRequestRef.current = null;
          setDetailLoading(false);
        }
      }
    },
    [activeProjectId, snapshot, toast, useDemo],
  );

  useEffect(() => {
    if (useDemo || !snapshot || !activeProjectId) return;
    if (
      !shouldAutoLoadDashboardDetail({
        detailLoading,
        selectedId,
        selectedDetailId: selectedDetail ? dashboardChangeKey(selectedDetail) : null,
        visibleIds: visible.map(dashboardChangeKey),
        failedDetailId: detailError?.id ?? null,
      })
    )
      return;

    const nextId = visible[0] ? dashboardChangeKey(visible[0]) : null;
    detailRequestRef.current?.abort();
    if (!nextId) {
      selectedIdRef.current = null;
      setSelectedId(null);
      setSelectedDetail(null);
      setDetailLoading(false);
      return;
    }
    void selectChange(nextId);
  }, [
    activeProjectId,
    detailLoading,
    detailError,
    selectChange,
    selectedDetail,
    selectedId,
    snapshot,
    useDemo,
    visible,
  ]);

  const selectTab = useCallback((nextTab) => setTab(nextTab), []);

  return (
    <main className="dashboard-workbench min-h-screen bg-surface text-fg antialiased lg:grid lg:grid-cols-[var(--rail-w)_1fr]">
      <AntSidebar
        open={railOpen}
        workflow={workflow}
        onWorkflow={(nextWorkflow) => {
          setSettingsOpen(false);
          setWorkflow(nextWorkflow);
        }}
        pluginPages={pluginPages}
        pluginSelection={pluginSelection}
        settingsOpen={settingsOpen}
        onSettings={() => {
          const preferredSection =
            pluginSelection ??
            pluginPages.find((page) => page.pluginId === 'comet.personal-memory')?.pluginId ??
            pluginPages[0]?.pluginId ??
            null;
          setSettingsSection(preferredSection);
          setSettingsOpen(true);
          setPluginSelection(null);
          setPluginPage(null);
          setPluginError(null);
        }}
        onPluginSelect={(pluginId) => {
          setSettingsOpen(false);
          setPluginSelection(pluginId);
          setPluginPage(null);
          setPluginError(null);
        }}
        onClose={() => setRailOpen(false)}
      />
      {railOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          aria-label="关闭导航"
          onClick={() => setRailOpen(false)}
        />
      )}
      <section className="min-w-0">
        <Topbar
          project={snapshot?.project}
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectSelect={(nextProjectId) => {
            localStorage.setItem('comet-dashboard-project', nextProjectId);
            snapshotRequestRef.current?.abort();
            pageRequestRef.current?.abort();
            nativePageRequestRef.current?.abort();
            nativeDetailRequestRef.current?.abort();
            detailRequestRef.current?.abort();
            setActiveProjectId(nextProjectId);
            setSnapshot(null);
            setPages({ active: null, archived: null, all: null });
            pagesRef.current = { active: null, archived: null, all: null };
            setNativePages({ active: null, archived: null, all: null });
            nativePagesRef.current = { active: null, archived: null, all: null };
            setNativeSelectedDetail(null);
            nativeSelectedDetailRef.current = null;
            setNativeDetailError(null);
            setSelectedId(null);
            selectedIdRef.current = null;
            setSelectedDetail(null);
            setDetailError(null);
            setQuery('');
            setSettingsOpen(false);
            setPluginSelection(null);
            setPluginPages([]);
            setPluginPage(null);
            setPluginError(null);
            setRailOpen(false);
          }}
          loading={loading}
          query={query}
          onQuery={setQuery}
          onMenu={() => setRailOpen(true)}
          onRefresh={async () => {
            await refresh(true);
            await reloadPluginPages();
            if (activePluginPageId) setPluginRefreshToken((value) => value + 1);
          }}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
        <div className="dashboard-content-shell">
          <div className="dashboard-content-inner">
            {!snapshot ? (
              <LoadingState />
            ) : settingsOpen ? (
              <DashboardSettingsPage
                section={settingsSection}
                pages={pluginPages}
                page={pluginPage}
                loading={pluginLoading}
                error={pluginError}
                onSection={(pluginId) => {
                  setSettingsSection(pluginId);
                  setPluginPage(null);
                  setPluginError(null);
                }}
                onRetry={() => {
                  setPluginPage(null);
                  setPluginError(null);
                  setPluginRefreshToken((value) => value + 1);
                }}
                onInvoke={(capability, input) =>
                  invokeActivePlugin(settingsSection, capability, input)
                }
              />
            ) : pluginSelection ? (
              <PluginCenterPage
                page={pluginPage}
                loading={pluginLoading}
                error={pluginError}
                onRetry={() => {
                  setPluginPage(null);
                  setPluginError(null);
                  setPluginRefreshToken((value) => value + 1);
                }}
                onInvoke={(capability, input) =>
                  invokeActivePlugin(pluginSelection, capability, input)
                }
              />
            ) : workflow === 'native' ? (
              <NativeWorkflowPanel
                native={snapshot.native}
                git={snapshot.git}
                query={query}
                tab={tab}
                onTab={selectTab}
                pagedChanges={useDemo ? null : (nativePage?.items ?? [])}
                total={nativeVisibleTotal}
                hasMore={Boolean(nativePage?.nextCursor)}
                pageLoading={nativePageLoading === tab || (!useDemo && !nativePage)}
                onLoadMore={() => loadNativePage(tab, true)}
                selectedDetail={nativeSelectedDetail}
                detailLoading={nativeDetailLoading}
                detailError={nativeDetailError}
                onSelect={selectNativeChange}
                onRetryDetail={() =>
                  nativeDetailError?.change && selectNativeChange(nativeDetailError.change)
                }
                onPreview={setArtifact}
                onCopyChangeName={(name) =>
                  copyText(name)
                    .then(() => toast('Change 名称已复制'))
                    .catch(() => toast('复制 Change 名称失败', 'error'))
                }
              />
            ) : (
              <Dashboard
                snapshot={snapshot}
                visible={visible}
                visibleTotal={visibleTotal}
                selected={selected}
                selectedId={selectedId}
                tab={tab}
                onTab={selectTab}
                onSelect={selectChange}
                hasMore={Boolean(activePage?.nextCursor)}
                pageLoading={pageLoading === tab}
                onLoadMore={() => loadPage(tab, true)}
                detailLoading={detailLoading}
                detailError={detailError}
                onRetryDetail={() => selectedId && selectChange(selectedId)}
                onPreview={setArtifact}
              />
            )}
          </div>
        </div>
      </section>
      <ArtifactDrawer artifact={artifact} onClose={() => setArtifact(null)} />
    </main>
  );
}

function Topbar({
  project,
  loading,
  query,
  onQuery,
  projects,
  activeProjectId,
  onProjectSelect,
  onMenu,
  onRefresh,
  theme,
  onToggleTheme,
}) {
  return (
    <header className="comet-workbench-header sticky top-0 z-30 border-b border-border-soft bg-surface/90 backdrop-blur-xl">
      <Button
        className="comet-header-menu lg:hidden"
        type="text"
        icon={<MenuOutlined />}
        onClick={onMenu}
        aria-label="打开导航"
      />
      <div className="comet-header-context">
        <Select
          className="comet-project-select"
          value={activeProjectId ?? undefined}
          placeholder={project?.name ?? '选择项目'}
          showSearch
          optionFilterProp="searchText"
          optionLabelProp="selectedLabel"
          classNames={{ popup: { root: 'comet-project-select-dropdown' } }}
          onChange={onProjectSelect}
          options={projects.map((entry) => ({
            value: entry.id,
            disabled: entry.availability !== 'available',
            searchText: `${entry.name} ${entry.path}`,
            selectedLabel: entry.name,
            label: (
              <span className="comet-project-option">
                <strong className="comet-project-option-name">{entry.name}</strong>
                <small className="comet-project-option-path">{entry.path}</small>
              </span>
            ),
          }))}
        />
      </div>
      <div className="comet-header-search">
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          prefix={<SearchOutlined className="text-meta" />}
          placeholder="搜索变更、产物或文件…"
          allowClear
        />
      </div>
      <div className="comet-header-actions">
        <Tooltip title="立即刷新">
          <Button
            className="comet-refresh-button"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
            aria-label="立即刷新"
          />
        </Tooltip>
        <Tooltip title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}>
          <Button
            className="hidden sm:inline-flex"
            type="text"
            icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          />
        </Tooltip>
      </div>
    </header>
  );
}

function Dashboard({
  snapshot,
  visible,
  visibleTotal,
  selected,
  selectedId,
  tab,
  onTab,
  onSelect,
  hasMore,
  pageLoading,
  onLoadMore,
  detailLoading,
  detailError,
  onRetryDetail,
  onPreview,
}) {
  const hasClassicChanges = snapshot.summary.activeChanges + snapshot.summary.archivedChanges > 0;
  const classicWarning = snapshot.classicError && hasClassicChanges;
  const detailPending = shouldShowDashboardDetailLoading({
    detailLoading,
    selectedId,
    selectedDetailId: selected?.id ?? null,
    failedDetailId: detailError?.id ?? null,
  });
  return (
    <div className="mx-auto min-w-0 max-w-dashboard">
      <SectionHead
        title="项目概览"
        hint={`生成于 ${formatTimestamp(snapshot.project.generatedAt)}`}
      />
      <WorkflowSuggestion
        command={selected?.next?.command}
        description={selected?.next?.description}
      />
      <AntSummaryCards snapshot={snapshot} />
      <SectionHead title="变更工作区" hint="查看文件产物与项目进度" />
      {snapshot.classicError && !hasClassicChanges ? (
        <ClassicErrorState error={snapshot.classicError} />
      ) : !hasClassicChanges ? (
        <EmptyState />
      ) : (
        <>
          {classicWarning ? <ClassicWarning error={snapshot.classicError} /> : null}
          <DashboardWorkspaceRegion
            leftClassName="dashboard-workspace-left-inner-scroll"
            stableFrame
            left={
              <AntChangesExplorer
                visible={visible}
                total={visibleTotal}
                selectedId={selectedId}
                tab={tab}
                onTab={onTab}
                onSelect={onSelect}
                hasMore={hasMore}
                pageLoading={pageLoading}
                onLoadMore={onLoadMore}
              />
            }
            center={
              selected ? (
                <AntChangeDetail change={selected} onPreview={onPreview} />
              ) : detailPending ? (
                <div className="change-detail dashboard-change-detail-loading min-w-0 rounded-lg bg-bg p-10 text-center text-sm text-muted shadow-raised">
                  正在加载变更详情…
                </div>
              ) : detailError ? (
                <div className="change-detail min-w-0 rounded-lg bg-bg p-10 text-center text-sm text-danger shadow-raised">
                  <p role="alert">变更详情加载失败：{detailError.message}</p>
                  <Button className="mt-4" onClick={onRetryDetail}>
                    重试
                  </Button>
                </div>
              ) : null
            }
            right={
              selected ? (
                <SidePanel change={selected} git={snapshot.git} onPreview={onPreview} />
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}

function WorkflowSuggestion({ command, description }) {
  return (
    <section className="dashboard-priority-banner" role="status" aria-label="工作流建议">
      <div className="dashboard-priority-title">
        <BulbOutlined aria-hidden="true" />
        <span>下一步建议</span>
      </div>
      <p>
        {command ? (
          <>
            优先执行 <code>{command}</code>
            {description ? `，${description}` : '，完成当前工作流阶段。'}
          </>
        ) : (
          '当前变更没有待执行动作，可以继续检查产物与验证结果。'
        )}
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

function PluginCenterHeader({ icon: Icon, title, description, meta = [], actions = null }) {
  return (
    <header className="dashboard-tool-header">
      <div className="dashboard-tool-heading">
        <span className="dashboard-tool-icon" aria-hidden="true">
          <Icon />
        </span>
        <div className="dashboard-tool-heading-copy">
          <span className="dashboard-tool-eyebrow">插件中心</span>
          <div className="dashboard-tool-title-row">
            <h2>{title}</h2>
            {meta.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className={`dashboard-tool-chip dashboard-tool-chip-${item.tone ?? 'neutral'}`}
              >
                <span className="dashboard-tool-chip-label">{item.label}</span>
                {item.value}
              </span>
            ))}
          </div>
          <p>{description}</p>
        </div>
      </div>
      {actions && <div className="dashboard-tool-actions">{actions}</div>}
    </header>
  );
}

function PhaseStepper({ phase, archived, next }) {
  const current = archived ? 'archive' : phase;
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === current),
  );
  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-sm font-semibold">生命周期阶段</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? `归档 ${phase}` : `下一步 ${next?.command ?? '—'}`}
        </span>
      </div>
      <div className="flex">
        {PHASES.map(([key, label], index) => {
          const state =
            index < currentIndex || archived
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'pending';
          return (
            <div key={key} className="relative flex flex-1 flex-col items-center gap-2 text-center">
              {index > 0 && (
                <span
                  className={`absolute left-0 right-1/2 top-4 h-px ${index <= currentIndex || archived ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              {index < PHASES.length - 1 && (
                <span
                  className={`absolute left-1/2 right-0 top-4 h-px ${index < currentIndex || archived ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              <span
                className={`relative z-10 grid size-8 place-items-center rounded-full border text-sm font-bold ${state === 'done' ? 'border-accent bg-accent text-white' : state === 'current' ? 'border-accent bg-bg text-accent' : 'border-border bg-bg text-fg-2'}`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span
                className={`text-[13px] font-semibold ${state === 'current' ? 'text-accent' : state === 'done' ? 'text-accent' : 'text-fg-2'}`}
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

function ArtifactList({ change, onPreview }) {
  const previewByKey = new Map(
    (change.artifactPreviews ?? []).map((preview) => [preview.key, preview]),
  );
  const grouped = change.artifacts?.grouped ?? [];
  const total = grouped.length;
  const ready = grouped.filter((a) => a.exists).length;
  const openspecArtifacts = grouped.filter((a) => a.source === 'openspec');
  const superpowersArtifacts = grouped.filter((a) => a.source === 'superpowers');
  const cometArtifacts = grouped.filter((a) => a.source === 'comet');

  return (
    <article className="min-w-0 rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">关键产物</h4>
        <span className="font-mono text-[12px] text-meta">
          {ready}/{total}
        </span>
      </div>
      <div className="space-y-3">
        <ArtifactGroup
          title="OpenSpec"
          artifacts={openspecArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
        <ArtifactGroup
          title="Superpowers"
          artifacts={superpowersArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
        <ArtifactGroup
          title="Comet"
          artifacts={cometArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
      </div>
    </article>
  );
}

function ArtifactGroup({ title, artifacts, previewByKey, onPreview }) {
  if (artifacts.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wider text-muted">{title}</span>
        <span className="h-px flex-1 bg-border-soft" />
      </div>
      <div className="space-y-px">
        {artifacts.map((artifact) => {
          const preview = previewByKey.get(artifact.key);
          return (
            <ArtifactRow
              key={artifact.key}
              artifact={artifact}
              preview={preview}
              onPreview={onPreview}
            />
          );
        })}
      </div>
    </div>
  );
}

function ArtifactRow({ artifact, preview, onPreview }) {
  const exists = artifact.exists;
  const notApplicable = artifact.notApplicable;
  const statusLabel = exists ? artifact.label : notApplicable ? '无需生成' : '未生成';

  return (
    <button
      className={`group grid w-full grid-cols-[16px_1fr_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${
        exists ? 'cursor-pointer hover:bg-surface' : 'cursor-default opacity-50'
      }`}
      disabled={!exists}
      onClick={() => onPreview({ key: artifact.key, name: artifact.label, preview })}
    >
      {/* status dot */}
      <span className="flex h-4 w-4 items-center justify-center">
        {exists ? (
          <span className="h-2 w-2 rounded-full bg-accent" />
        ) : notApplicable ? (
          <span className="h-2 w-2 rounded-full border border-border bg-surface" />
        ) : (
          <span className="h-2 w-2 rounded-full border border-border" />
        )}
      </span>
      <span className="min-w-0 truncate text-[13px] text-fg">{artifact.key}</span>
      <span className="whitespace-nowrap pl-4 text-right text-[12px] text-muted">
        {statusLabel}
      </span>
    </button>
  );
}

function TaskProgress({ change }) {
  const total = change.tasks.total;
  const completed = change.tasks.completed;
  const remaining = Math.max(0, total - completed);
  const archived = change.status === 'archived';
  const doneSections = change.tasks.sections.filter((s) => s.status === 'done').length;
  const totalSections = change.tasks.sections.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const animationKey = dashboardChangeKey(change);
  const animatedPercent = useAnimatedNumber(percent, 900, animationKey);
  const animatedCompleted = useAnimatedNumber(completed, 900, animationKey);
  const animatedRemaining = useAnimatedNumber(remaining, 900, animationKey);
  const animatedDoneSections = useAnimatedNumber(doneSections, 900, animationKey);
  const animatedRemainingValue = Math.round(animatedRemaining);
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - animatedPercent / 100);

  const isComplete = remaining === 0 && total > 0;
  const hintTone =
    archived || isComplete ? 'bg-ok-soft text-success' : 'bg-accent-softer text-fg-2';
  const dotTone = archived || isComplete ? 'bg-success' : 'bg-accent';
  const hintText = archived
    ? '已归档完成，流程已结束'
    : isComplete
      ? `所有任务已完成，可以进入 ${change.phase === 'verify' ? '归档' : 'Verify'}`
      : `剩余 ${animatedRemainingValue} 项未完成，完成后进入 ${
          change.phase === 'verify' ? '归档' : 'Verify'
        }`;

  return (
    <article className="min-w-0 rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">任务进度</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isComplete ? 'bg-ok-soft text-success' : 'bg-accent-soft text-accent'}`}
        >
          {isComplete ? '全部完成' : `${animatedRemainingValue} 项待办`}
        </span>
      </div>

      {/* Donut */}
      <div className="flex justify-center">
        <div className="relative h-[110px] w-[110px]">
          <svg
            className="block size-full -rotate-90"
            viewBox="0 0 120 120"
            role="img"
            aria-label={`任务完成度 ${percent}%`}
          >
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--color-border-soft)"
              strokeWidth="7"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={isComplete ? 'var(--color-success)' : 'var(--color-accent)'}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[26px] font-bold leading-none tabular-nums">
              {Math.round(animatedPercent)}%
            </span>
            <span className="mt-0.5 text-[10px] text-muted">完成度</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center justify-center gap-6 text-center">
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedCompleted)}
          </div>
          <div className="mt-1 text-[11px] text-muted">已完成</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {animatedRemainingValue}
          </div>
          <div className="mt-1 text-[11px] text-muted">剩余</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedDoneSections)}/{totalSections}
          </div>
          <div className="mt-1 text-[11px] text-muted">分组</div>
        </div>
      </div>

      {/* Compact section bars */}
      {change.tasks.sections.length > 0 && (
        <div className="mt-4 space-y-2.5 border-t border-border-soft pt-4">
          {change.tasks.sections.map((section) => {
            const sp = section.total ? Math.round((section.completed / section.total) * 100) : 0;
            const done = section.status === 'done';
            return (
              <div key={section.title}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-[11px] text-fg-2">{section.title}</span>
                  <span className="shrink-0 pl-2 font-mono text-[10px] text-muted">
                    {section.completed}/{section.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-success' : 'bg-accent'}`}
                    style={{ width: `${sp}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Next hint */}
      <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${hintTone}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
        <span>{hintText}</span>
      </div>
    </article>
  );
}

function SidePanel({ change, git, onPreview }) {
  return (
    <aside className="min-h-[480px] space-y-4">
      {change.status === 'archived' ? (
        <ArchiveSummary change={change} />
      ) : (
        <NextAction change={change} />
      )}
      <RiskCard change={change} />
      <GitSnapshot git={git} />
    </aside>
  );
}

function NextAction({ change }) {
  return (
    <Card title="下一步建议" tag={phaseLabel(change.phase)}>
      <div className="rounded-xl bg-fg px-4 py-3 font-mono text-[13px] text-bg">
        <span className="text-success">$ </span>
        {change.next?.command ?? '—'}
      </div>
      <p className="text-sm text-fg-2">{change.next?.reason ?? '暂无建议'}</p>
      <p className="text-[13px] leading-relaxed text-muted">{change.next?.description ?? ''}</p>
    </Card>
  );
}

function ArchiveSummary({ change }) {
  return (
    <Card title="归档摘要" tag="已归档">
      <div className="break-words rounded-xl bg-accent-soft px-4 py-3 font-mono text-[13px] text-accent">
        {change.archive?.archiveName ?? change.name}
      </div>
      <p className="break-words text-sm text-fg-2">
        原名：{change.archive?.originalName ?? change.name} · 归档于：
        {change.archive?.archivedAt ?? '—'}
      </p>
      <p className="break-words text-[13px] leading-relaxed text-muted">
        归档路径：{change.archive?.archivePath ?? change.path} · 任务：{change.tasks.completed} /{' '}
        {change.tasks.total}
      </p>
    </Card>
  );
}

function RiskCard({ change }) {
  const risks = change.risks ?? [];
  return (
    <Card title="风险提示" tag={`${risks.length} 项`}>
      {risks.length === 0 ? (
        <div className="rounded-xl bg-surface-warm p-3 text-sm text-muted">
          当前未发现阻塞风险。
        </div>
      ) : (
        <div className="space-y-2">
          {risks.map((risk) => (
            <div
              key={`${risk.code}-${risk.message}`}
              className="rounded-xl border border-border-soft p-3"
            >
              <div className="flex gap-2 text-sm font-semibold">
                <span
                  className={
                    risk.level === 'error'
                      ? 'text-danger'
                      : risk.level === 'warning'
                        ? 'text-warn'
                        : 'text-meta'
                  }
                >
                  ●
                </span>
                <span>{risk.message}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-meta">{risk.code}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GitSnapshot({ git }) {
  return (
    <Card title="Git 快照" tag={`${git.dirtyFiles} 个未提交`}>
      <KeyValue k="分支" v={git.branch ?? '—'} />
      <KeyValue k="HEAD" v={git.head ?? '—'} />
      <div className="pt-2 text-[11px] font-semibold uppercase text-meta">最近提交</div>
      <ul className="space-y-1">
        {git.recentCommits.map((commit) => (
          <li key={commit} className="truncate text-sm text-fg-2">
            {commit}
          </li>
        ))}
      </ul>
      <div className="pt-2 text-[11px] font-semibold uppercase text-meta">未提交文件</div>
      <ul className="space-y-1">
        {git.dirtyFileList.slice(0, 5).map((file) => (
          <li key={file} className="break-all font-mono text-xs text-warn">
            {file}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Card({ title, tag, children }) {
  return (
    <article className="rounded-lg bg-bg p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <h4 className="font-semibold">{title}</h4>
        {tag && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs text-fg-2">{tag}</span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </article>
  );
}

function KeyValue({ k, v }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 truncate font-mono text-[13px]">{v}</span>
    </div>
  );
}

function ArtifactDrawer({ artifact, onClose }) {
  const [loadState, setLoadState] = useState({ status: 'idle' });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toc, setToc] = useState([]);
  const [activeTocId, setActiveTocId] = useState('');
  const articleRef = useRef(null);
  const contentScrollRef = useRef(null);

  useEffect(() => {
    if (!artifact) {
      setIsFullscreen(false);
      return;
    }
    const scrollY = window.scrollY;
    const previousBodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    return () => {
      setIsFullscreen(false);
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.right = previousBodyStyle.right;
      document.body.style.width = previousBodyStyle.width;
      window.scrollTo(0, scrollY);
    };
  }, [artifact]);

  useEffect(() => {
    if (!artifact) {
      setLoadState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setLoadState({ status: 'loading' });

    const preview = artifact.preview;
    const previewPath = preview?.path ?? '';
    const isYamlPreview = artifact.key === 'cometYaml' || /\.ya?ml$/i.test(previewPath);
    const isJsonPreview =
      artifact.key === 'handoff' || artifact.key === 'checkpoint' || /\.json$/i.test(previewPath);
    const useStructuredPreview = isYamlPreview || isJsonPreview;

    const content = preview?.exists
      ? useStructuredPreview
        ? preview.content?.trimEnd() || ''
        : `${preview.content?.trimEnd() || '这个产物是空文件。'}${preview.truncated ? '\n\n> 内容过长，已截取前 256KB。' : ''}`
      : preview
        ? `尚未生成 ${artifact.name}。`
        : '这个产物文件存在，但当前 dashboard 服务返回的数据里没有全文内容。请重启 dashboard 服务后再刷新页面。';

    (async () => {
      try {
        let html;
        if (preview?.exists && useStructuredPreview) {
          if (!content.trim()) {
            html = isJsonPreview ? await renderJsonPreview('') : await renderYamlTable('');
          } else {
            html = isJsonPreview
              ? await renderJsonPreview(content)
              : await renderYamlTable(content);
            if (preview.truncated) {
              html += '<p><em>内容过长，已截取前 256KB。</em></p>';
            }
          }
        } else {
          html = await renderMarkdown(content);
        }
        if (cancelled) return;
        if (!html.trim()) {
          setLoadState({ status: 'empty' });
          return;
        }
        setLoadState({ status: 'success', html });
      } catch (err) {
        if (cancelled) return;
        setLoadState({
          status: 'error',
          message: err instanceof Error ? err.message : '产物预览渲染失败，请重试',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifact]);

  useEffect(() => {
    if (loadState.status === 'success' && articleRef.current) {
      runMermaid(articleRef.current);
      const items = extractToc(articleRef.current);
      setToc(items);
      if (items.length > 0) setActiveTocId(items[0].id);
    } else {
      setToc([]);
      setActiveTocId('');
    }
  }, [loadState]);

  useEffect(() => {
    if (!isFullscreen) return;
    const scrollEl = contentScrollRef.current;
    const article = articleRef.current;
    if (!scrollEl || !article || toc.length === 0) return;

    const onScroll = () => {
      const headings = toc.map(({ id }) => document.getElementById(id)).filter(Boolean);

      let current = headings[0]?.id ?? '';
      for (const el of headings) {
        const rect = el.getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        if (rect.top - containerRect.top <= 80) {
          current = el.id;
        }
      }
      setActiveTocId(current);
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [toc, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, onClose]);

  if (!artifact) return null;
  const preview = artifact.preview;
  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[90] flex'
          : 'fixed inset-0 z-[90] grid grid-cols-[minmax(0,1fr)_minmax(360px,760px)] max-sm:grid-cols-1'
      }
    >
      {!isFullscreen && (
        <button aria-label="关闭产物预览" className="bg-black/30 max-sm:hidden" onClick={onClose} />
      )}
      <section
        className={[
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg',
          isFullscreen
            ? 'h-full w-full'
            : 'border-l border-border shadow-[-20px_0_44px_rgba(0,0,0,0.12)]',
        ].join(' ')}
      >
        <header className="flex items-start gap-3 border-b border-border-soft p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{artifact.name}</h2>
            <div className="mt-1 flex items-center gap-1.5">
              {preview?.path && (
                <button
                  type="button"
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg-2"
                  aria-label="复制文件路径"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(preview.path);
                      toast('路径已复制');
                    } catch {
                      toast('复制失败', 'error');
                    }
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              )}
              <p className="artifact-preview-path min-w-0 flex-1 break-all font-mono text-xs text-meta">
                {preview?.path ?? '当前服务未返回全文内容'}
              </p>
            </div>
            {(preview?.size != null || preview?.updatedAt) && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
                {preview?.size != null && <span>{formatFileSize(preview.size)}</span>}
                {preview?.updatedAt && <span>更新于 {formatTimestamp(preview.updatedAt)}</span>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="grid size-10 place-items-center rounded-xl text-fg-2 hover:bg-surface"
              onClick={() => setIsFullscreen((value) => !value)}
              aria-label={isFullscreen ? '退出全屏' : '全屏展示'}
            >
              {isFullscreen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                  />
                </svg>
              )}
            </button>
            <button
              className="grid size-10 place-items-center rounded-xl text-fg-2 hover:bg-surface"
              onClick={onClose}
              aria-label="关闭产物预览"
            >
              ×
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {isFullscreen && toc.length > 0 && (
            <nav
              aria-label="文档目录"
              className="hidden w-[250px] shrink-0 overflow-y-auto border-r border-border-soft bg-surface px-3 py-4 sm:block"
            >
              <p className="mb-2 px-2 text-sm font-semibold uppercase tracking-wider text-muted">
                目录
              </p>
              <ul className="space-y-0.5">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        const target = document.getElementById(item.id);
                        const scrollEl = contentScrollRef.current;
                        if (!target || !scrollEl) return;
                        const top =
                          target.getBoundingClientRect().top -
                          scrollEl.getBoundingClientRect().top +
                          scrollEl.scrollTop -
                          16;
                        scrollEl.scrollTo({ top, behavior: 'smooth' });
                        setActiveTocId(item.id);
                      }}
                      className={[
                        'block rounded-md px-2 py-1.5 leading-snug transition-colors',
                        item.depth === 1 ? 'text-base font-medium' : '',
                        item.depth === 2 ? 'pl-4 text-base' : '',
                        item.depth === 3 ? 'pl-7 text-base' : '',
                        activeTocId === item.id
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-fg-2 hover:bg-surface-warm hover:text-fg',
                      ].join(' ')}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div
            ref={contentScrollRef}
            className={[
              'min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain',
              isFullscreen ? 'px-12 py-6' : 'p-5',
            ].join(' ')}
          >
            {loadState.status === 'loading' && (
              <p className="py-10 text-center text-sm text-muted" aria-live="polite">
                正在加载...
              </p>
            )}
            {loadState.status === 'empty' && (
              <p className="py-10 text-center text-sm text-muted" aria-live="polite">
                该产物文件尚未生成
              </p>
            )}
            {loadState.status === 'error' && (
              <p role="alert" className="py-10 text-center text-sm text-danger">
                {loadState.message}
              </p>
            )}
            {loadState.status === 'success' && (
              <article
                ref={articleRef}
                className="md-github"
                dangerouslySetInnerHTML={{ __html: loadState.html }}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Pill({ tone = 'neutral', children }) {
  const cls =
    {
      ok: 'bg-ok-soft text-success',
      warn: 'bg-warn-soft text-warn',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      neutral: 'bg-surface text-fg-2',
    }[tone] ?? 'bg-surface text-fg-2';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function ClassicWarning({ error }) {
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-warn/30 bg-warn-soft p-4 shadow-card"
    >
      <h3 className="font-semibold text-warn">Classic 数据部分读取失败</h3>
      <p className="mt-1 break-words text-sm text-fg-2">
        已展示可读取的变更；请检查其余 Classic 产物目录后刷新。{error.message}
      </p>
    </div>
  );
}

function ClassicErrorState({ error }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-6 shadow-card">
      <h3 className="font-semibold text-danger">Classic 数据读取失败</h3>
      <p className="mt-2 break-words text-sm text-fg-2">{error.message}</p>
      <p className="mt-3 text-sm text-muted">
        请检查 .comet/config.yaml 与 Classic 产物目录，然后刷新 Dashboard。
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg bg-bg p-12 text-center shadow-raised">
      <h3 className="text-lg font-semibold tracking-tight">当前没有 Classic change</h3>
      <p className="mt-2 text-sm text-muted">Classic 变更出现后会在这里展示。</p>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-dashboard rounded-lg bg-bg p-10 text-center text-sm text-muted shadow-raised">
      正在加载 dashboard...
    </div>
  );
}

function reconcilePluginInvocationResult(page, pluginId, capability, result) {
  if (
    pluginId !== 'comet.personal-memory' ||
    capability !== 'correct' ||
    page?.pluginId !== pluginId ||
    !isDashboardRecord(page.data) ||
    !isDashboardRecord(result) ||
    typeof result.id !== 'string'
  ) {
    return page;
  }

  const retrieval = reconcileDashboardMemoryRecords(page.data.retrieval, result);
  const management = reconcileDashboardMemoryRecords(page.data.management, result);
  if (retrieval === page.data.retrieval && management === page.data.management) return page;
  return {
    ...page,
    data: {
      ...page.data,
      retrieval,
      management,
    },
  };
}

function reconcileDashboardMemoryRecords(collection, correctedRecord) {
  if (!isDashboardRecord(collection)) return collection;
  const updates = {};
  let changed = false;
  for (const key of ['records', 'profileRecords', 'taskRecords']) {
    const records = collection[key];
    if (!Array.isArray(records)) continue;
    let matched = false;
    const nextRecords = records.map((record) => {
      if (!isDashboardRecord(record) || record.id !== correctedRecord.id) return record;
      matched = true;
      return { ...record, ...correctedRecord };
    });
    if (!matched) continue;
    updates[key] = nextRecords;
    changed = true;
  }
  return changed ? { ...collection, ...updates } : collection;
}

function isDashboardRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchDashboardProjects() {
  const res = await fetch('/api/dashboard/projects', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchDashboardPluginPages(projectId) {
  const res = await fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/plugins`, {
    cache: 'no-store',
  });
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function fetchDashboardPluginPage(projectId, pluginId) {
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function invokeDashboardPlugin(projectId, pluginId, capability, input) {
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}/invoke`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability, input }),
    },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  const response = await res.json();
  return response?.result;
}

async function lifecycleDashboardPlugin(projectId, pluginId, action) {
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}/lifecycle`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function fetchDashboardOverview(projectId, signal, query = '') {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/overview${suffix}`,
    { cache: 'no-store', signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchDashboardChangePage(projectId, status, options = {}) {
  const params = new URLSearchParams({ status, limit: '5' });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.query?.trim()) params.set('q', options.query.trim());
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/changes?${params.toString()}`,
    { cache: 'no-store', signal: options.signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchDashboardNativeChangePage(projectId, status, options = {}) {
  const params = new URLSearchParams({ status, limit: '5' });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.query?.trim()) params.set('q', options.query.trim());
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/native-changes?${params.toString()}`,
    { cache: 'no-store', signal: options.signal },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function fetchDashboardNativeChangeDetail(projectId, change, signal) {
  const params = new URLSearchParams({ status: change.status, changeName: change.name });
  if (change.locator) params.set('changeLocator', change.locator);
  if (change.archiveName) params.set('archiveName', change.archiveName);
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/native-change?${params.toString()}`,
    { cache: 'no-store', signal },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function fetchDashboardChangeDetail(projectId, changeId, signal) {
  const params = new URLSearchParams({ changeLocator: changeId });
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/change?${params.toString()}`,
    { cache: 'no-store', signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDemoSnapshot() {
  const module = await import('../demo.js');
  return withDemoArtifactPreviews(module.DEMO_SNAPSHOT);
}

function withDemoArtifactPreviews(snapshot) {
  const hydrateChange = (change) => {
    const grouped = change.artifacts?.grouped ?? [];
    const previews = grouped.map((artifact) => ({
      key: artifact.key,
      label: artifact.label,
      path: artifact.path,
      exists: artifact.exists,
      size: artifact.exists ? 1024 + Math.floor(Math.random() * 4096) : undefined,
      updatedAt: artifact.exists ? '2026-06-25T12:00:00.000Z' : undefined,
      content: artifact.exists
        ? `# ${artifact.label}\n\n${artifact.label}：${change.displayName}\n\n- 当前阶段：${phaseLabel(change.phase)}\n- 任务进度：${change.tasks.completed}/${change.tasks.total}\n- Verify：${VERIFY_LABEL[change.verify.result] ?? '未知'}\n`
        : undefined,
    }));
    return { ...change, artifactPreviews: previews };
  };

  return {
    ...snapshot,
    changes: {
      active: (snapshot.changes.active ?? []).map(hydrateChange),
      archived: (snapshot.changes.archived ?? []).map(hydrateChange),
    },
  };
}

function pickSelected(snapshot, previous) {
  const all = [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])];
  if (previous && all.some((change) => dashboardChangeKey(change) === previous)) return previous;
  const first = snapshot.changes.active?.[0] ?? snapshot.changes.archived?.[0];
  return first ? dashboardChangeKey(first) : null;
}

function findChange(snapshot, id) {
  if (!snapshot || !id) return null;
  return (
    [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])].find(
      (change) => dashboardChangeKey(change) === id,
    ) ?? null
  );
}

function filterChanges(snapshot, tab, query) {
  if (!snapshot) return [];
  const list =
    tab === 'archived'
      ? (snapshot.changes.archived ?? [])
      : tab === 'all'
        ? [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])]
        : (snapshot.changes.active ?? []);
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((change) =>
    [
      change.name,
      change.displayName,
      change.workflow,
      change.phase,
      change.workspace?.label,
      change.workspace?.branch,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

function relativeChangePath(change) {
  return change.relativePath || change.name;
}

function phaseLabel(phase) {
  return PHASES.find(([key]) => key === phase)?.[1] ?? phase ?? '未知';
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function projectKnowledgeRecordSources(record) {
  const references = [
    ...(record.conclusions ?? []).flatMap((conclusion) => conclusion.sources ?? []),
    ...(record.relations ?? []).flatMap((relation) => relation.sources ?? []),
  ];
  return [
    ...new Set(
      references.map((source) => {
        if (source.anchor) return `${source.source}#${source.anchor}`;
        if (source.lineStart) {
          return `${source.source}#L${source.lineStart}${source.lineEnd ? `-L${source.lineEnd}` : ''}`;
        }
        return source.source;
      }),
    ),
  ];
}

function formatFileSize(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isUserProfileRecord(record) {
  if (record.scope !== 'global') return false;
  if ((record.pathPatterns ?? []).length > 0) return false;
  if ((record.taskTypes ?? []).length > 0) return false;
  if ((record.operations ?? []).length > 0) return false;
  return ['user-fact', 'user-preference', 'collaboration-habit'].includes(record.memoryClass);
}

function memoryApplicationReason(record) {
  if (isUserProfileRecord(record)) return '全局 User Profile，任务开始时自动加载';
  if (record.scope === 'project') {
    const selectors = [
      ...((record.pathPatterns ?? []).length > 0 ? ['路径'] : []),
      ...((record.taskTypes ?? []).length > 0 ? ['任务类型'] : []),
      ...((record.operations ?? []).length > 0 ? ['操作'] : []),
    ];
    return selectors.length > 0
      ? `当前项目范围匹配（${selectors.join('、')}）`
      : '当前项目范围匹配';
  }
  return '任务匹配的个人记忆';
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 非安全上下文（例如本地预览）没有 Clipboard API 时，保留可用的复制能力。
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('当前浏览器不支持复制');
}

createRoot(document.getElementById('root')).render(<App />);
function AntSidebar({
  open,
  workflow,
  onWorkflow,
  pluginPages,
  pluginSelection,
  settingsOpen,
  onSettings,
  onPluginSelect,
  onClose,
}) {
  const navigation = (
    <>
      <Menu
        mode="inline"
        selectedKeys={settingsOpen ? [] : pluginSelection ? [pluginSelection] : [workflow]}
        items={[
          { key: 'classic', icon: <BranchesOutlined />, label: 'Classic 工作流' },
          { key: 'native', icon: <FileTextOutlined />, label: 'Native 工作流' },
        ]}
        onClick={({ key }) => {
          onPluginSelect(null);
          onWorkflow(key);
          onClose();
        }}
      />
      <div className="dashboard-sidebar-label dashboard-sidebar-label-spaced">插件中心</div>
      <Menu
        mode="inline"
        selectedKeys={settingsOpen ? [] : pluginSelection ? [pluginSelection] : []}
        items={pluginPages.map((page) => {
          const statusLabel = page.globallyDisabled
            ? '停用'
            : page.projectPaused
              ? '暂停'
              : page.status === 'disabled'
                ? '停用'
                : null;
          return {
            key: page.pluginId,
            icon:
              page.pluginId === 'comet.personal-memory' ? (
                <BulbOutlined />
              ) : page.pluginId === 'comet.project-knowledge' ? (
                <DatabaseOutlined />
              ) : (
                <SafetyCertificateOutlined />
              ),
            label: (
              <span className="dashboard-plugin-menu-item">
                <span>{page.label}</span>
                {statusLabel ? <Badge status="default" text={statusLabel} /> : null}
              </span>
            ),
          };
        })}
        onClick={({ key }) => {
          onPluginSelect(key);
          onClose();
        }}
      />
    </>
  );
  const settingsButton = (
    <button
      type="button"
      className={`dashboard-sidebar-settings${settingsOpen ? ' is-active' : ''}`}
      aria-pressed={settingsOpen}
      onClick={() => {
        onSettings();
        onClose();
      }}
    >
      <SettingOutlined aria-hidden="true" />
      <span>设置</span>
    </button>
  );
  return (
    <>
      <Layout.Sider
        className="dashboard-sidebar !hidden !bg-bg lg:!block"
        width={228}
        theme="light"
      >
        <div className="flex h-full flex-col">
          <div className="dashboard-sidebar-brand flex items-center gap-2">
            <img src="/favicon.png" alt="Comet" className="size-7 rounded-[7px]" />
            <div>
              <strong>Comet Dashboard</strong>
              <div className="text-xs text-meta">只读工作台</div>
            </div>
          </div>
          <div className="dashboard-sidebar-navigation">
            <div className="dashboard-sidebar-feature">
              <AppstoreOutlined aria-hidden="true" />
              <span>变更工作区</span>
            </div>
            <div className="dashboard-sidebar-label">工作流</div>
            {navigation}
          </div>
          <div className="dashboard-sidebar-footer">
            {settingsButton}
            <div className="dashboard-sidebar-status">
              <div className="flex items-center gap-2 font-medium text-fg">
                <BulbOutlined aria-hidden="true" />
                工作台状态
              </div>
              <div className="mt-2 text-xs text-meta">只读连接 · 自动同步</div>
            </div>
          </div>
        </div>
      </Layout.Sider>
      <Drawer title="Comet 工作台" placement="left" open={open} onClose={onClose} size={280}>
        <div className="dashboard-mobile-navigation">
          {navigation}
          <div className="dashboard-mobile-settings">{settingsButton}</div>
        </div>
      </Drawer>
    </>
  );
}

function PluginCenterPage({ page, loading, error, onRetry, onInvoke }) {
  if (loading && !page) return <LoadingState />;
  if (error && !page) {
    return (
      <div className="mx-auto max-w-dashboard">
        <SectionHead title="插件中心" hint="页面暂时不可用" />
        <Alert
          type="error"
          showIcon
          message="插件页面加载失败"
          description={error}
          action={<Button onClick={onRetry}>重试</Button>}
        />
      </div>
    );
  }
  if (!page) return <LoadingState />;
  if (page.pluginId === 'comet.project-knowledge') {
    return <ProjectKnowledgeCenter page={page} data={page.data} onInvoke={onInvoke} />;
  }
  if (page.status === 'disabled') {
    return (
      <div className="mx-auto max-w-dashboard">
        <SectionHead title={page.label} hint="插件中心" />
        <Alert
          type="info"
          showIcon
          message="插件已停用"
          description="页面数据和项目文件仍然保留，重新启用后即可继续使用。"
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>重新启用</Button>
          }
        />
      </div>
    );
  }
  if (page.pluginId === 'comet.personal-memory') {
    return <PersonalMemoryCenter data={page.data} onInvoke={onInvoke} />;
  }
  return (
    <div className="mx-auto max-w-dashboard">
      <SectionHead title={page.label} hint="插件中心" />
      <AntCard size="small">该插件暂未提供可视化中心页。</AntCard>
    </div>
  );
}

function DashboardSettingsPage({
  section,
  pages,
  page,
  loading,
  error,
  onSection,
  onRetry,
  onInvoke,
}) {
  const settingsPages = pages.filter((item) =>
    ['comet.personal-memory', 'comet.project-knowledge'].includes(item.pluginId),
  );
  return (
    <div className="dashboard-tool-page dashboard-settings-page mx-auto min-w-0 max-w-dashboard">
      <PluginCenterHeader
        icon={SettingOutlined}
        title="设置"
        description="管理 Dashboard 插件的项目行为、Provider 与本地同步"
        meta={[{ label: '范围', value: '当前项目', tone: 'neutral' }]}
      />
      <div className="dashboard-settings-shell">
        <aside className="dashboard-settings-navigation" aria-label="设置分类">
          <div className="dashboard-settings-navigation-label">插件设置</div>
          <Menu
            mode="inline"
            selectedKeys={section ? [section] : []}
            items={settingsPages.map((item) => ({
              key: item.pluginId,
              icon:
                item.pluginId === 'comet.personal-memory' ? <UserOutlined /> : <DatabaseOutlined />,
              label: item.label,
            }))}
            onClick={({ key }) => onSection(key)}
          />
        </aside>
        <section className="dashboard-settings-main" aria-live="polite">
          {loading && !page ? (
            <LoadingState />
          ) : error && !page ? (
            <Alert
              type="error"
              showIcon
              message="设置加载失败"
              description={error}
              action={<Button onClick={onRetry}>重试</Button>}
            />
          ) : !page ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可配置的插件" />
          ) : page.pluginId === 'comet.personal-memory' ? (
            <PersonalMemorySettings page={page} data={page.data} onInvoke={onInvoke} />
          ) : page.pluginId === 'comet.project-knowledge' ? (
            <ProjectKnowledgeSettings page={page} data={page.data} onInvoke={onInvoke} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该插件暂未提供设置页" />
          )}
        </section>
      </div>
    </div>
  );
}

function SettingsSectionHead({ icon: Icon, title, description, status }) {
  return (
    <div className="dashboard-settings-section-head">
      <span className="dashboard-tool-panel-icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <div className="dashboard-settings-section-title-row">
          <h3>{title}</h3>
          {status && <span className="dashboard-tool-counter">{status}</span>}
        </div>
        <p>{description}</p>
      </div>
    </div>
  );
}

function PersonalMemorySettings({ page, data, onInvoke }) {
  const [remoteUrl, setRemoteUrl] = useState('');
  const [providerMode, setProviderMode] = useState('local');
  const [profileCharLimit, setProfileCharLimit] = useState('2000');
  const [taskContextCharLimit, setTaskContextCharLimit] = useState('6000');
  const [providerEndpoint, setProviderEndpoint] = useState('');
  const [providerTokenEnv, setProviderTokenEnv] = useState('');
  const [providerProfile, setProviderProfile] = useState('default');
  const [providerTimeoutMs, setProviderTimeoutMs] = useState('5000');
  const [showPending, setShowPending] = useState(false);
  const status = data?.status ?? {};
  const retrieval = data?.retrieval ?? {};
  const management = data?.management ?? {};
  const policy = data?.policy ?? {};
  const records = management.records ?? retrieval.records ?? [];
  const pendingRecords = records.filter(
    (record) =>
      record.status === 'conflict' || (record.kind === 'inferred' && record.status !== 'active'),
  );
  const projectKey = data?.projectKey;
  const learningAllowed = policy.learning !== false;
  const retrievalAllowed = policy.retrieval !== false;
  const learningPaused = projectKey && (status.pausedLearningProjects ?? []).includes(projectKey);
  const retrievalPaused = projectKey && (status.pausedRetrievalProjects ?? []).includes(projectKey);
  const syncMessage = status.sync?.message ?? '本地记忆仓库已连接';
  const provider = status.provider?.provider ?? 'local';

  useEffect(() => {
    const config = data?.providerConfig;
    if (!config) return;
    setProviderMode(config.provider ?? 'local');
    setProfileCharLimit(String(config.profileCharLimit ?? 2000));
    setTaskContextCharLimit(String(config.taskContextCharLimit ?? 6000));
    setProviderEndpoint(config.remote?.endpoint ?? '');
    setProviderTokenEnv(config.remote?.tokenEnv ?? '');
    setProviderProfile(config.remote?.profile ?? 'default');
    setProviderTimeoutMs(String(config.remote?.timeoutMs ?? 5000));
  }, [data?.providerConfig]);

  const saveProviderConfig = () => {
    const profileLimit = Number(profileCharLimit);
    const taskLimit = Number(taskContextCharLimit);
    const timeoutMs = Number(providerTimeoutMs);
    if (
      !Number.isFinite(profileLimit) ||
      profileLimit <= 0 ||
      !Number.isFinite(taskLimit) ||
      taskLimit <= 0 ||
      (providerMode === 'remote' && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
    ) {
      return;
    }
    void onInvoke('configure-provider', {
      provider: providerMode,
      profileCharLimit: Math.round(profileLimit),
      taskContextCharLimit: Math.round(taskLimit),
      ...(providerMode === 'remote'
        ? {
            remote: {
              endpoint: providerEndpoint.trim(),
              ...(providerTokenEnv.trim() ? { tokenEnv: providerTokenEnv.trim() } : {}),
              ...(providerProfile.trim() ? { profile: providerProfile.trim() } : {}),
              timeoutMs: Math.round(timeoutMs),
            },
          }
        : {}),
    });
  };

  return (
    <div className="dashboard-settings-stack">
      <SettingsSectionHead
        icon={UserOutlined}
        title="个人记忆设置"
        description="控制当前项目的学习、注入、Provider 与同步"
        status={page.status === 'disabled' ? '已停用' : provider === 'remote' ? 'Remote' : 'Local'}
      />
      {page.status === 'disabled' && (
        <Alert
          type="info"
          showIcon
          message="个人记忆插件已停用"
          description="记忆文件和历史仍然保留，重新启用后即可继续使用。"
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>重新启用</Button>
          }
        />
      )}
      {page.status !== 'disabled' && (
        <>
          <section className="dashboard-settings-panel" aria-labelledby="memory-global-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-global-settings">全局能力</h4>
                <p>控制个人记忆是否学习新偏好并写入任务上下文</p>
              </div>
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>自动学习</strong>
                <span>{status.learningEnabled ? '会沉淀稳定偏好' : '已暂停自动沉淀'}</span>
              </div>
              <Switch
                size="small"
                checked={Boolean(status.learningEnabled)}
                aria-label="切换自动学习"
                onChange={(enabled) => onInvoke('set-learning', { enabled })}
              />
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>记忆注入</strong>
                <span>{status.retrievalEnabled ? '任务中可使用已保存内容' : '已暂停任务注入'}</span>
              </div>
              <Switch
                size="small"
                checked={Boolean(status.retrievalEnabled)}
                aria-label="切换记忆注入"
                onChange={(enabled) => onInvoke('set-retrieval', { enabled })}
              />
            </div>
          </section>
          <section className="dashboard-settings-panel" aria-labelledby="memory-project-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-project-settings">当前项目</h4>
                <p>单独暂停这个项目的学习或任务注入</p>
              </div>
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>项目学习</strong>
                <span>
                  {!learningAllowed
                    ? '项目配置已禁止自动学习'
                    : learningPaused
                      ? '当前项目暂停自动学习'
                      : '允许当前项目沉淀新偏好'}
                </span>
              </div>
              <Switch
                size="small"
                checked={Boolean(projectKey && learningAllowed && !learningPaused)}
                disabled={!projectKey || !learningAllowed}
                aria-label="切换当前项目学习"
                onChange={(enabled) =>
                  onInvoke('pause-project-learning', { projectKey, paused: !enabled })
                }
              />
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>项目注入</strong>
                <span>
                  {!retrievalAllowed
                    ? '项目配置已禁止自动注入'
                    : retrievalPaused
                      ? '当前项目不注入记忆'
                      : '任务中可以使用已保存记忆'}
                </span>
              </div>
              <Switch
                size="small"
                checked={Boolean(projectKey && retrievalAllowed && !retrievalPaused)}
                disabled={!projectKey || !retrievalAllowed}
                aria-label="切换当前项目记忆注入"
                onChange={(enabled) =>
                  onInvoke('pause-project-retrieval', { projectKey, paused: !enabled })
                }
              />
            </div>
          </section>
          <section className="dashboard-settings-panel" aria-labelledby="memory-provider-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-provider-settings">Provider 与上下文</h4>
                <p>选择存储来源，并限制写入任务的上下文大小</p>
              </div>
              {pendingRecords.length > 0 && (
                <Button size="small" onClick={() => setShowPending(true)}>
                  {pendingRecords.length} 条待确认
                </Button>
              )}
            </div>
            <div className="dashboard-memory-setting dashboard-memory-setting-stack">
              <div className="dashboard-memory-setting-copy">
                <strong>Provider</strong>
                <span>
                  {provider === 'remote' ? '使用外部 Remote Provider' : '使用本地个人记忆存储'}
                </span>
              </div>
              <Select
                value={providerMode}
                aria-label="个人记忆 Provider"
                options={[
                  { value: 'local', label: 'Local Provider' },
                  { value: 'remote', label: 'Remote Provider' },
                ]}
                onChange={setProviderMode}
              />
              <div className="dashboard-memory-remote-form">
                <Input
                  value={profileCharLimit}
                  onChange={(event) => setProfileCharLimit(event.target.value)}
                  placeholder="User Profile 字符上限"
                  aria-label="User Profile 字符上限"
                />
                <Input
                  value={taskContextCharLimit}
                  onChange={(event) => setTaskContextCharLimit(event.target.value)}
                  placeholder="任务上下文字符上限"
                  aria-label="任务上下文字符上限"
                />
              </div>
              {providerMode === 'remote' && (
                <>
                  <Input
                    value={providerEndpoint}
                    onChange={(event) => setProviderEndpoint(event.target.value)}
                    placeholder="Remote Provider endpoint"
                    aria-label="Remote Provider endpoint"
                  />
                  <div className="dashboard-memory-remote-form">
                    <Input
                      value={providerTokenEnv}
                      onChange={(event) => setProviderTokenEnv(event.target.value)}
                      placeholder="Token 环境变量（可选）"
                      aria-label="Remote Provider token 环境变量"
                    />
                    <Input
                      value={providerProfile}
                      onChange={(event) => setProviderProfile(event.target.value)}
                      placeholder="Profile"
                      aria-label="Remote Provider profile"
                    />
                  </div>
                  <Input
                    value={providerTimeoutMs}
                    onChange={(event) => setProviderTimeoutMs(event.target.value)}
                    placeholder="请求超时（毫秒）"
                    aria-label="Remote Provider 请求超时"
                  />
                </>
              )}
              <div className="dashboard-memory-sync-row">
                <span>Provider 切换不会迁移或删除已有数据；保存后重新加载页面即可生效</span>
                <div className="dashboard-memory-remote-form">
                  <Button onClick={() => onInvoke('test-provider', {})}>测试连接</Button>
                  <Button type="primary" onClick={saveProviderConfig}>
                    保存配置
                  </Button>
                </div>
              </div>
            </div>
          </section>
          {provider === 'local' && (
            <section className="dashboard-settings-panel" aria-labelledby="memory-sync-settings">
              <div className="dashboard-settings-panel-head">
                <div>
                  <h4 id="memory-sync-settings">本地同步</h4>
                  <p>把本地记忆仓库连接到你控制的 Git remote</p>
                </div>
              </div>
              <div className="dashboard-memory-setting dashboard-memory-setting-stack">
                <div className="dashboard-memory-setting-copy">
                  <strong>同步仓库</strong>
                  <span>{status.remote ?? '尚未配置 Git remote'}</span>
                </div>
                <div className="dashboard-memory-remote-form">
                  <Input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder="输入记忆仓库 remote"
                    aria-label="记忆仓库 Git remote"
                  />
                  <Button
                    disabled={!remoteUrl.trim()}
                    onClick={() => {
                      void onInvoke('configure-remote', { url: remoteUrl.trim() });
                      setRemoteUrl('');
                    }}
                  >
                    保存
                  </Button>
                </div>
                <div className="dashboard-memory-sync-row">
                  <span>{syncMessage}</span>
                  <Button icon={<SyncOutlined />} onClick={() => onInvoke('sync', {})}>
                    立即同步
                  </Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
      <section
        className="dashboard-settings-panel dashboard-settings-danger"
        aria-labelledby="memory-plugin-settings"
      >
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="memory-plugin-settings">插件管理</h4>
            <p>卸载后记忆文件和历史仍会保留</p>
          </div>
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: '卸载个人记忆插件？',
                content: '记忆文件和历史会保留，之后可以重新安装。',
                okText: '卸载',
                cancelText: '取消',
                onOk: () => onInvoke('lifecycle', { action: 'uninstall' }),
              })
            }
          >
            卸载插件
          </Button>
        </div>
      </section>
      <Modal
        open={showPending}
        title="待确认记忆"
        footer={null}
        onCancel={() => setShowPending(false)}
      >
        {pendingRecords.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待确认内容" />
        ) : (
          <div className="dashboard-memory-records">
            {pendingRecords.map((record) => (
              <div key={record.id} className="dashboard-memory-record">
                <div className="dashboard-memory-record-content">
                  <div className="dashboard-memory-record-kicker">
                    <Tag color="warning">{record.status ?? 'candidate'}</Tag>
                    <span>{record.category}</span>
                  </div>
                  <p className="dashboard-memory-record-text">{record.text}</p>
                </div>
                {record.kind === 'inferred' && record.status !== 'active' && (
                  <Button
                    size="small"
                    onClick={() =>
                      onInvoke('remember', {
                        scope: record.scope,
                        ...(record.projectKey === undefined
                          ? {}
                          : { projectKey: record.projectKey }),
                        memoryClass: record.memoryClass,
                        category: record.category,
                        text: record.text,
                      })
                    }
                  >
                    确认保存
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ProjectKnowledgeSettings({ page, data, onInvoke }) {
  const snapshot = data && typeof data === 'object' ? data : {};
  const [providerMode, setProviderMode] = useState(snapshot.provider ?? 'local');
  const [endpoint, setEndpoint] = useState(snapshot.remote?.endpoint ?? '');
  const [tokenEnv, setTokenEnv] = useState(snapshot.remote?.tokenEnv ?? '');
  const [scope, setScope] = useState(snapshot.remote?.scope ?? '');
  const [timeoutMs, setTimeoutMs] = useState(String(snapshot.remote?.timeoutMs ?? 5000));
  useEffect(() => {
    setProviderMode(snapshot.provider ?? 'local');
    setEndpoint(snapshot.remote?.endpoint ?? '');
    setTokenEnv(snapshot.remote?.tokenEnv ?? '');
    setScope(snapshot.remote?.scope ?? '');
    setTimeoutMs(String(snapshot.remote?.timeoutMs ?? 5000));
  }, [
    snapshot.provider,
    snapshot.remote?.endpoint,
    snapshot.remote?.tokenEnv,
    snapshot.remote?.scope,
    snapshot.remote?.timeoutMs,
  ]);
  const saveProvider = async () => {
    await onInvoke('configure-provider', {
      provider: providerMode,
      ...(providerMode === 'remote'
        ? {
            remote: {
              endpoint,
              tokenEnv,
              scope,
              timeoutMs: Number(timeoutMs),
            },
          }
        : {}),
    });
  };
  const provider =
    snapshot.provider === 'remote' ? 'Remote' : snapshot.provider === 'local' ? 'Local' : '—';
  const configured =
    typeof snapshot.configured === 'boolean'
      ? snapshot.configured
        ? '配置有效'
        : '需要检查'
      : '—';
  const remote = snapshot.remote;
  const local = snapshot.local;
  const disabled = page.status === 'disabled';

  return (
    <div className="dashboard-settings-stack">
      <SettingsSectionHead
        icon={DatabaseOutlined}
        title="项目知识设置"
        description="管理当前项目的检索 Provider 与插件生命周期"
        status={disabled ? '已暂停' : provider}
      />
      {disabled && (
        <Alert
          type="info"
          showIcon
          message={page.projectPaused ? '当前项目已暂停项目知识' : '项目知识插件已停用'}
          description="项目文件和插件配置仍然保留。"
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>重新启用</Button>
          }
        />
      )}
      {!disabled && (
        <section className="dashboard-settings-panel" aria-labelledby="knowledge-provider-settings">
          <div className="dashboard-settings-panel-head">
            <div>
              <h4 id="knowledge-provider-settings">Provider 配置</h4>
              <p>Remote 只保存 endpoint、scope、超时和 token 环境变量名</p>
            </div>
            <Tag>{provider}</Tag>
          </div>
          <div className="dashboard-knowledge-summary-body">
            <div className="dashboard-knowledge-provider-form">
              <Select
                size="small"
                value={providerMode}
                aria-label="项目知识 Provider"
                onChange={setProviderMode}
                options={[
                  { value: 'local', label: 'Local Provider' },
                  { value: 'remote', label: 'Remote Provider' },
                ]}
              />
              {providerMode === 'remote' && (
                <>
                  <Input
                    size="small"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="Remote endpoint"
                    aria-label="项目知识 Remote endpoint"
                  />
                  <Input
                    size="small"
                    value={tokenEnv}
                    onChange={(event) => setTokenEnv(event.target.value)}
                    placeholder="Token 环境变量名"
                    aria-label="项目知识 Token 环境变量名"
                  />
                  <Input
                    size="small"
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                    placeholder="Scope（可选）"
                    aria-label="项目知识 scope"
                  />
                  <Input
                    size="small"
                    value={timeoutMs}
                    onChange={(event) => setTimeoutMs(event.target.value)}
                    placeholder="超时毫秒"
                    aria-label="项目知识超时"
                  />
                </>
              )}
              <Button size="small" type="primary" onClick={() => void saveProvider()}>
                保存 Provider
              </Button>
            </div>
            <p className="dashboard-knowledge-retrieval">{snapshot.retrieval}</p>
            {provider === 'Remote' && remote ? (
              <dl className="dashboard-knowledge-fields">
                <div>
                  <dt>Endpoint</dt>
                  <dd>{remote.endpoint || '未提供'}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{remote.scope || '未配置'}</dd>
                </div>
                <div>
                  <dt>Timeout</dt>
                  <dd>{remote.timeoutMs} ms</dd>
                </div>
                <div>
                  <dt>Token 环境变量</dt>
                  <dd>
                    {remote.tokenEnv
                      ? `${remote.tokenEnv} · ${remote.tokenConfigured ? '已提供' : '未提供'}`
                      : '未配置（无需 token）'}
                  </dd>
                </div>
              </dl>
            ) : provider === 'Local' && local ? (
              <dl className="dashboard-knowledge-fields">
                <div>
                  <dt>Repository</dt>
                  <dd>{local.repositoryId}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{local.workspaceId}</dd>
                </div>
                <div>
                  <dt>来源 / Section</dt>
                  <dd>
                    {local.sourceCount} / {local.sectionCount}
                  </dd>
                </div>
                <div>
                  <dt>索引状态</dt>
                  <dd>{local.available ? '可用' : '尚未建立或不可用'}</dd>
                </div>
                <div>
                  <dt>最近查询</dt>
                  <dd>
                    {typeof local.lastQueryMs === 'number'
                      ? `${local.lastQueryMs} ms · ${local.lastCandidateCount ?? 0} 个候选`
                      : '尚无查询统计'}
                  </dd>
                </div>
                <div>
                  <dt>候选通道</dt>
                  <dd>{local.channels?.length ? local.channels.join(' + ') : '尚无'}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>
      )}
      <section className="dashboard-settings-panel" aria-labelledby="knowledge-project-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="knowledge-project-settings">当前项目</h4>
            <p>项目级暂停不会删除知识文件或影响其他项目</p>
          </div>
          {!disabled && (
            <Button onClick={() => onInvoke('lifecycle', { action: 'disable' })}>
              暂停当前项目
            </Button>
          )}
        </div>
        <div className="dashboard-settings-facts">
          <div>
            <span>插件状态</span>
            <strong>
              {page.globallyDisabled
                ? '全局停用'
                : page.projectPaused
                  ? '已启用'
                  : disabled
                    ? '已停用'
                    : '已启用'}
            </strong>
          </div>
          <div>
            <span>当前项目</span>
            <strong>{page.projectPaused ? '已暂停' : '已启用'}</strong>
          </div>
          <div>
            <span>配置状态</span>
            <strong>{configured}</strong>
          </div>
        </div>
      </section>
      <section
        className="dashboard-settings-panel dashboard-settings-danger"
        aria-labelledby="knowledge-plugin-settings"
      >
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="knowledge-plugin-settings">插件管理</h4>
            <p>卸载只停止插件，不会删除项目文档或配置</p>
          </div>
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: '卸载项目知识插件？',
                content: '卸载只停止当前插件，不会删除项目文档或配置。',
                okText: '卸载',
                cancelText: '取消',
                onOk: () => onInvoke('lifecycle', { action: 'uninstall' }),
              })
            }
          >
            卸载插件
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProjectKnowledgeCenter({ page, data, onInvoke }) {
  const snapshot = data && typeof data === 'object' ? data : {};
  const [queryText, setQueryText] = useState('');
  const [queryResults, setQueryResults] = useState([]);
  const [stateFilter, setStateFilter] = useState('active');
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const visibleRecords = records.filter(
    (record) => stateFilter === 'all' || record.state === stateFilter,
  );
  const previewQuery = async () => {
    if (!queryText.trim()) return;
    const result = await onInvoke('query', { task: queryText.trim() });
    setQueryResults(result?.kind === 'search' ? (result.results ?? []) : []);
  };
  const provider =
    snapshot.provider === 'remote' ? 'Remote' : snapshot.provider === 'local' ? 'Local' : '—';
  const configured =
    typeof snapshot.configured === 'boolean'
      ? snapshot.configured
        ? '配置有效'
        : '需要检查'
      : '—';
  const diagnostics =
    Array.isArray(snapshot.diagnostics) && snapshot.diagnostics.length > 0
      ? snapshot.diagnostics
      : (page.diagnostics ?? []);
  const disabled = page.status === 'disabled';
  const remote = snapshot.remote;
  const local = snapshot.local;

  return (
    <div className="dashboard-tool-page dashboard-tool-page-knowledge mx-auto min-w-0 max-w-dashboard">
      <PluginCenterHeader
        icon={DatabaseOutlined}
        title={page.label}
        description="管理当前项目的知识来源、检索状态与可复用记录"
        meta={[
          { label: 'Provider', value: provider, tone: provider === '—' ? 'neutral' : 'accent' },
          {
            label: '状态',
            value: disabled ? '已暂停' : configured,
            tone: disabled || configured === '需要检查' ? 'warning' : 'success',
          },
        ]}
      />
      {disabled && (
        <Alert
          className="mb-4"
          type="info"
          showIcon
          message={page.projectPaused ? '当前项目已暂停项目知识' : '项目知识插件已停用'}
          description={
            page.projectPaused
              ? '只影响当前项目，项目文件和插件配置仍然保留。'
              : '插件状态和项目文件仍然保留，重新启用后即可继续使用。'
          }
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>重新启用</Button>
          }
        />
      )}
      <section className="dashboard-knowledge-status" aria-label="项目知识状态">
        <div className="dashboard-knowledge-status-cell">
          <span className="dashboard-knowledge-status-label">Provider</span>
          <span className="dashboard-knowledge-status-value">
            <span className="dashboard-tool-state-dot is-accent" aria-hidden="true" />
            {provider}
          </span>
          <span className="dashboard-knowledge-status-meta">
            {provider === 'Local'
              ? local?.available
                ? 'FTS5 + ripgrep 混合召回'
                : 'ripgrep 回退可用'
              : provider === 'Remote'
                ? '固定 Retrieval API v1'
                : '未读取状态'}
          </span>
        </div>
        <div className="dashboard-knowledge-status-cell">
          <span className="dashboard-knowledge-status-label">插件状态</span>
          <span className="dashboard-knowledge-status-value">
            <span
              className={`dashboard-tool-state-dot ${disabled ? 'is-warning' : 'is-success'}`}
              aria-hidden="true"
            />
            {page.globallyDisabled
              ? '全局停用'
              : page.projectPaused
                ? '已启用'
                : disabled
                  ? '已停用'
                  : '已启用'}
          </span>
          <span className="dashboard-knowledge-status-meta">由 Plugin Runtime 管理</span>
        </div>
        <div className="dashboard-knowledge-status-cell">
          <span className="dashboard-knowledge-status-label">当前项目</span>
          <span className="dashboard-knowledge-status-value">
            <span
              className={`dashboard-tool-state-dot ${page.projectPaused ? 'is-warning' : 'is-success'}`}
              aria-hidden="true"
            />
            {page.projectPaused ? '已暂停' : '已启用'}
          </span>
          <span className="dashboard-knowledge-status-meta">仅影响这个项目的任务</span>
        </div>
        <div className="dashboard-knowledge-status-cell">
          <span className="dashboard-knowledge-status-label">配置状态</span>
          <span className="dashboard-knowledge-status-value">
            <span
              className={`dashboard-tool-state-dot ${configured === '需要检查' ? 'is-warning' : 'is-success'}`}
              aria-hidden="true"
            />
            {configured}
          </span>
          <span className="dashboard-knowledge-status-meta">状态和记录由 Provider 提供</span>
        </div>
      </section>
      <div className="dashboard-knowledge-layout">
        <section
          className="dashboard-knowledge-summary"
          aria-labelledby="dashboard-knowledge-summary-title"
        >
          <div className="dashboard-knowledge-panel-head">
            <div className="dashboard-tool-panel-title">
              <span className="dashboard-tool-panel-icon" aria-hidden="true">
                <DatabaseOutlined />
              </span>
              <div>
                <h3 id="dashboard-knowledge-summary-title">知识概览</h3>
                <p>当前项目可供 Agent 使用的来源有效记录</p>
              </div>
            </div>
            {provider !== '—' && <Tag variant="filled">{provider}</Tag>}
          </div>
          {data === null || data === undefined ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={page.projectPaused ? '当前项目暂停后不加载状态' : '插件停用后不加载状态'}
            />
          ) : (
            <div className="dashboard-knowledge-summary-body">
              <p className="dashboard-knowledge-retrieval">{snapshot.retrieval}</p>
              <div className="dashboard-knowledge-overview-metrics">
                <div>
                  <span>记录</span>
                  <strong>
                    {(snapshot.counts?.active ?? 0) +
                      (snapshot.counts?.needsReview ?? 0) +
                      (snapshot.counts?.retired ?? 0)}
                  </strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>
                    {provider === 'Local' ? (local?.sourceCount ?? 0) : (remote?.scope ?? '—')}
                  </strong>
                </div>
                <div>
                  <span>索引</span>
                  <strong>
                    {provider === 'Local' ? (local?.available ? '可用' : '待建立') : configured}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </section>
        <section
          className="dashboard-knowledge-diagnostics"
          aria-labelledby="dashboard-knowledge-diagnostics-title"
        >
          <div className="dashboard-knowledge-panel-head">
            <div className="dashboard-tool-panel-title">
              <span className="dashboard-tool-panel-icon is-warning" aria-hidden="true">
                <SafetyCertificateOutlined />
              </span>
              <div>
                <h3 id="dashboard-knowledge-diagnostics-title">运行诊断</h3>
                <p>最近三条需要关注的有界信息</p>
              </div>
            </div>
            {diagnostics.length > 0 && <Tag color="warning">{diagnostics.length} 条</Tag>}
          </div>
          {diagnostics.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有新的诊断" />
          ) : (
            <div className="dashboard-knowledge-diagnostics-list">
              {diagnostics.map((diagnostic, index) => {
                const code = typeof diagnostic === 'string' ? '运行时' : diagnostic.code;
                const message = typeof diagnostic === 'string' ? diagnostic : diagnostic.message;
                return (
                  <div className="dashboard-knowledge-diagnostic" key={`${code}-${index}`}>
                    <Tag variant="filled">{code}</Tag>
                    <span>{message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <section
        className="dashboard-knowledge-summary dashboard-knowledge-records mt-4"
        aria-labelledby="dashboard-knowledge-records-title"
      >
        <div className="dashboard-knowledge-panel-head">
          <div className="dashboard-tool-panel-title">
            <span className="dashboard-tool-panel-icon" aria-hidden="true">
              <FileTextOutlined />
            </span>
            <div>
              <h3 id="dashboard-knowledge-records-title">项目知识记录</h3>
              <p>
                active {snapshot.counts?.active ?? 0} · needs-review{' '}
                {snapshot.counts?.needsReview ?? 0} · retired {snapshot.counts?.retired ?? 0}
              </p>
            </div>
          </div>
          <Select
            size="small"
            value={stateFilter}
            aria-label="项目知识记录状态"
            onChange={setStateFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'needs-review', label: 'Needs review' },
              { value: 'retired', label: 'Retired' },
              { value: 'all', label: '全部' },
            ]}
          />
        </div>
        <div className="dashboard-knowledge-summary-body">
          <div className="dashboard-knowledge-record-toolbar">
            <Input
              size="small"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              onPressEnter={() => void previewQuery()}
              placeholder="查询项目知识"
              aria-label="查询项目知识"
            />
            <Button size="small" type="primary" onClick={() => void previewQuery()}>
              查询
            </Button>
            <Button size="small" onClick={() => onInvoke('refresh', {})}>
              重新核对
            </Button>
          </div>
          {queryResults.length > 0 && (
            <div className="dashboard-knowledge-diagnostics-list" aria-label="项目知识查询结果">
              {queryResults.slice(0, 8).map((result, index) => (
                <div className="dashboard-knowledge-diagnostic" key={`${result.source}-${index}`}>
                  <Tag variant="filled">{result.title ?? result.source}</Tag>
                  <span>{result.content}</span>
                </div>
              ))}
            </div>
          )}
          {visibleRecords.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" />
          ) : (
            <div className="dashboard-knowledge-diagnostics-list" aria-label="项目知识记录列表">
              {visibleRecords.slice(0, 100).map((record) => {
                const sources = projectKnowledgeRecordSources(record);
                return (
                  <div className="dashboard-knowledge-diagnostic" key={record.id}>
                    <Tag variant="filled">{record.state}</Tag>
                    <div className="min-w-0 flex-1">
                      <strong>{record.title}</strong>
                      <div>{record.summary}</div>
                      {sources.length > 0 && (
                        <div className="text-xs text-meta">来源：{sources.join(' · ')}</div>
                      )}
                      <div className="text-xs text-meta">
                        {record.id} · {record.type} · 更新于 {formatTimestamp(record.updatedAt)}
                      </div>
                    </div>
                    <div className="dashboard-knowledge-record-actions">
                      <Button
                        size="small"
                        onClick={() =>
                          Modal.confirm({
                            title: '纠正项目知识记录',
                            content: (
                              <Input.TextArea
                                id="project-knowledge-correction"
                                autoSize={{ minRows: 3, maxRows: 6 }}
                              />
                            ),
                            okText: '保存',
                            cancelText: '取消',
                            onOk: () => {
                              const element = document.getElementById(
                                'project-knowledge-correction',
                              );
                              return onInvoke('correct', {
                                id: record.id,
                                text: element?.value ?? record.summary,
                              });
                            },
                          })
                        }
                      >
                        纠正
                      </Button>
                      <Button size="small" onClick={() => onInvoke('forget', { id: record.id })}>
                        忘记
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PersonalMemoryCenter({ data, onInvoke }) {
  const [editingRecord, setEditingRecord] = useState(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfileText, setNewProfileText] = useState('');
  const [newProfileCategory, setNewProfileCategory] = useState('沟通偏好');
  const [showNewProjectMemory, setShowNewProjectMemory] = useState(false);
  const [newProjectMemoryText, setNewProjectMemoryText] = useState('');
  const [newProjectMemoryCategory, setNewProjectMemoryCategory] = useState('项目约定');
  const [expandedRecordIds, setExpandedRecordIds] = useState(() => new Set());
  const status = data?.status ?? {};
  const retrieval = data?.retrieval ?? {};
  const management = data?.management ?? {};
  const policy = data?.policy ?? {};
  const learningAllowed = policy.learning !== false;
  const retrievalAllowed = policy.retrieval !== false;
  const records = management.records ?? retrieval.records ?? [];
  const profileRecords = retrieval.profileRecords ?? records.filter(isUserProfileRecord);
  const projectRecords = records.filter(
    (record) => record.scope === 'project' && !isUserProfileRecord(record),
  );
  const displayRecords =
    projectRecords.length > 0
      ? projectRecords
      : records.filter((record) => !isUserProfileRecord(record));
  const conflicts = management.conflicts ?? [];
  const notifications = data?.notifications ?? [];
  const projectKey = data?.projectKey;
  const memoryFileCount = status.files?.length ?? 0;
  const provider = status.provider?.provider ?? 'local';
  const profileUsage = status.profile
    ? `${status.profile.usedChars} / ${status.profile.maxChars} 字符`
    : provider === 'remote'
      ? '由 Remote Provider 管理'
      : '0 / 2000 字符';
  return (
    <div className="dashboard-tool-page dashboard-tool-page-memory mx-auto min-w-0 max-w-dashboard">
      <PluginCenterHeader
        icon={UserOutlined}
        title="个人记忆"
        description="集中管理跨会话偏好、项目经验与任务上下文"
        meta={[
          {
            label: 'Provider',
            value: provider === 'remote' ? 'Remote' : 'Local',
            tone: 'accent',
          },
          {
            label: '范围',
            value: projectKey ? '当前项目' : '全局',
            tone: 'neutral',
          },
          {
            label: '记录',
            value: `${profileRecords.length + displayRecords.length}`,
            tone: 'success',
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={!projectKey}
              onClick={() => setShowNewProjectMemory(true)}
            >
              新增项目记忆
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setShowNewProfile(true)}
            >
              新增偏好
            </Button>
          </div>
        }
      />
      {notifications.length > 0 && (
        <div className="mb-3 space-y-2">
          {notifications.map((notice, index) => (
            <Alert key={`${notice}-${index}`} type="info" showIcon message={notice} />
          ))}
        </div>
      )}
      <section className="dashboard-memory-status" aria-label="个人记忆状态">
        <div className="dashboard-memory-status-cell">
          <span className="dashboard-memory-status-label">自动学习</span>
          <span className="dashboard-memory-status-value">
            <span
              className={`dashboard-tool-state-dot ${status.learningEnabled ? 'is-success' : 'is-muted'}`}
              aria-hidden="true"
            />
            {!learningAllowed
              ? '项目配置禁止当前项目学习'
              : status.learningEnabled
                ? '会沉淀稳定偏好'
                : '已暂停自动沉淀'}
          </span>
        </div>
        <div className="dashboard-memory-status-cell">
          <span className="dashboard-memory-status-label">记忆注入</span>
          <span className="dashboard-memory-status-value">
            <span
              className={`dashboard-tool-state-dot ${status.retrievalEnabled ? 'is-accent' : 'is-muted'}`}
              aria-hidden="true"
            />
            {!retrievalAllowed
              ? '项目配置禁止当前项目注入'
              : status.retrievalEnabled
                ? '任务中可使用已保存内容'
                : '已暂停任务注入'}
          </span>
        </div>
        <div className="dashboard-memory-status-cell">
          <span className="dashboard-memory-status-label">作用范围</span>
          <span className="dashboard-memory-status-value">
            <span className="dashboard-tool-state-dot is-accent" aria-hidden="true" />
            {projectKey ? '当前项目' : '全局记忆'}
          </span>
          <span className="dashboard-memory-status-meta">
            {projectKey ? '项目级偏好优先' : '跨项目共享'}
          </span>
        </div>
        <div className="dashboard-memory-status-cell">
          <span className="dashboard-memory-status-label">记忆文件</span>
          <span className="dashboard-memory-status-value">
            <span className="dashboard-tool-state-dot is-success" aria-hidden="true" />
            {memoryFileCount} 个
          </span>
          <span className="dashboard-memory-status-meta">
            {provider === 'remote'
              ? 'Remote Provider'
              : status.remote
                ? '已配置 Git remote'
                : '仅保存在本地'}
          </span>
        </div>
      </section>
      <section
        className="dashboard-memory-list mb-4"
        aria-labelledby="dashboard-memory-profile-title"
      >
        <div className="dashboard-memory-panel-head">
          <div className="dashboard-tool-panel-title">
            <span className="dashboard-tool-panel-icon" aria-hidden="true">
              <UserOutlined />
            </span>
            <div>
              <h3 id="dashboard-memory-profile-title">User Profile</h3>
              <p>
                {profileRecords.length > 0
                  ? `${profileRecords.length} 条用户事实、偏好与协作习惯`
                  : '还没有形成稳定的用户偏好'}
              </p>
            </div>
          </div>
          <div className="dashboard-memory-panel-head-actions">
            <span className="dashboard-tool-counter">{profileUsage}</span>
          </div>
        </div>
        {profileRecords.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有稳定的用户偏好" />
        ) : (
          <div className="dashboard-memory-records">
            {profileRecords.map((record) => (
              <div key={record.id} className="dashboard-memory-record">
                <div className="dashboard-memory-record-main">
                  <span className="dashboard-memory-record-mark" aria-hidden="true">
                    <UserOutlined />
                  </span>
                  <div className="dashboard-memory-record-content">
                    <div className="dashboard-memory-record-kicker">
                      <Tag variant="filled">{record.category}</Tag>
                      <span>{record.memoryClass ?? 'user-preference'}</span>
                    </div>
                    <p className="dashboard-memory-record-text">{record.text}</p>
                    <div className="dashboard-memory-record-application">
                      应用原因：{memoryApplicationReason(record)}
                    </div>
                    {record.reason && (
                      <div className="dashboard-memory-record-note">记忆说明：{record.reason}</div>
                    )}
                    <div className="dashboard-memory-record-meta">
                      <span>{record.evidenceCount ?? 0} 条证据</span>
                      <span>更新于 {formatTimestamp(record.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="dashboard-memory-record-actions">
                  <Tooltip title="纠正记忆">
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label="纠正记忆"
                      onClick={() => {
                        setEditingRecord(record);
                        setCorrectionText(record.text);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="删除记忆">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="删除记忆"
                      onClick={() => onInvoke('remove', { id: record.id })}
                    />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="dashboard-memory-content">
        <section className="dashboard-memory-list" aria-labelledby="dashboard-memory-list-title">
          <div className="dashboard-memory-panel-head">
            <div className="dashboard-tool-panel-title">
              <span className="dashboard-tool-panel-icon" aria-hidden="true">
                <DatabaseOutlined />
              </span>
              <div>
                <h3 id="dashboard-memory-list-title">当前项目记忆</h3>
                <p>
                  {displayRecords.length > 0
                    ? `${displayRecords.length} 条可用于当前任务的记忆`
                    : '还没有匹配的项目记忆'}
                </p>
              </div>
            </div>
            {conflicts.length > 0 && <Tag color="warning">{conflicts.length} 个冲突待确认</Tag>}
          </div>
          {displayRecords.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有匹配的记忆" />
          ) : (
            <div className="dashboard-memory-records">
              {displayRecords.map((record) => {
                const text = typeof record.text === 'string' ? record.text : '';
                const expandable = text.length > MEMORY_COLLAPSE_THRESHOLD;
                const expanded = expandedRecordIds.has(record.id);
                const visibleText =
                  expandable && !expanded ? `${text.slice(0, MEMORY_COLLAPSE_THRESHOLD)}…` : text;
                return (
                  <div key={record.id} className="dashboard-memory-record">
                    <div className="dashboard-memory-record-main">
                      <span className="dashboard-memory-record-mark" aria-hidden="true">
                        <DatabaseOutlined />
                      </span>
                      <div className="dashboard-memory-record-content">
                        <div className="dashboard-memory-record-kicker">
                          <Tag variant="filled">{record.category}</Tag>
                          <span>{record.scope === 'project' ? '项目记忆' : '全局记忆'}</span>
                        </div>
                        <p
                          className={`dashboard-memory-record-text${
                            expandable && !expanded ? ' is-collapsed' : ''
                          }`}
                        >
                          {visibleText}
                        </p>
                        <div className="dashboard-memory-record-application">
                          应用原因：{memoryApplicationReason(record)}
                        </div>
                        {record.reason && (
                          <div className="dashboard-memory-record-note">
                            记忆说明：{record.reason}
                          </div>
                        )}
                        {expandable && (
                          <Button
                            className="dashboard-memory-record-text-toggle"
                            size="small"
                            type="link"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedRecordIds((previous) => {
                                const next = new Set(previous);
                                if (next.has(record.id)) next.delete(record.id);
                                else next.add(record.id);
                                return next;
                              })
                            }
                          >
                            {expanded ? '收起完整记忆' : '展开完整记忆'}
                          </Button>
                        )}
                        <div className="dashboard-memory-record-meta">
                          <span>{record.evidenceCount ?? 0} 条证据</span>
                          <span>更新于 {formatTimestamp(record.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="dashboard-memory-record-actions">
                      <Tooltip title="纠正记忆">
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          aria-label="纠正记忆"
                          onClick={() => {
                            setEditingRecord(record);
                            setCorrectionText(record.text);
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="回滚记忆">
                        <Button
                          size="small"
                          type="text"
                          icon={<UndoOutlined />}
                          aria-label="回滚记忆"
                          onClick={() => onInvoke('rollback', { id: record.id })}
                        />
                      </Tooltip>
                      <Tooltip title="删除记忆">
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label="删除记忆"
                          onClick={() => onInvoke('remove', { id: record.id })}
                        />
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Modal
        open={showNewProfile}
        title="新增 User Profile 偏好"
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: newProfileText.trim().length === 0 }}
        onCancel={() => setShowNewProfile(false)}
        onOk={() => {
          if (newProfileText.trim().length === 0) return;
          void onInvoke('remember', {
            scope: 'global',
            memoryClass: 'user-preference',
            category: newProfileCategory.trim() || '沟通偏好',
            text: newProfileText.trim(),
          });
          setNewProfileText('');
          setShowNewProfile(false);
        }}
      >
        <Form layout="vertical" component="div">
          <Form.Item
            label="偏好内容"
            required
            htmlFor="dashboard-new-profile-content"
            extra="记录可在后续任务中复用的稳定偏好"
          >
            <Input.TextArea
              id="dashboard-new-profile-content"
              value={newProfileText}
              onChange={(event) => setNewProfileText(event.target.value)}
              placeholder="例如：以后都用中文回答"
              aria-label="偏好内容"
              autoFocus
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item className="mb-0" label="分类（可选）" htmlFor="dashboard-new-profile-category">
            <Input
              id="dashboard-new-profile-category"
              value={newProfileCategory}
              onChange={(event) => setNewProfileCategory(event.target.value)}
              placeholder="例如：沟通偏好"
              aria-label="分类（可选）"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={showNewProjectMemory}
        title="新增项目记忆"
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: newProjectMemoryText.trim().length === 0 }}
        onCancel={() => setShowNewProjectMemory(false)}
        onOk={() => {
          if (!projectKey || newProjectMemoryText.trim().length === 0) return;
          void onInvoke('remember', {
            scope: 'project',
            projectKey,
            memoryClass: 'project-convention',
            category: newProjectMemoryCategory.trim() || '项目约定',
            text: newProjectMemoryText.trim(),
          });
          setNewProjectMemoryText('');
          setNewProjectMemoryCategory('项目约定');
          setShowNewProjectMemory(false);
        }}
      >
        <Form layout="vertical" component="div">
          <Form.Item
            label="记忆内容"
            required
            htmlFor="dashboard-new-project-memory-content"
            extra="只记录以后在当前项目中仍然有用的个人经验或项目协作偏好"
          >
            <Input.TextArea
              id="dashboard-new-project-memory-content"
              value={newProjectMemoryText}
              onChange={(event) => setNewProjectMemoryText(event.target.value)}
              placeholder="例如：这个项目优先使用最小相关测试"
              aria-label="记忆内容"
              autoFocus
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item
            className="mb-0"
            label="分类（可选）"
            htmlFor="dashboard-new-project-memory-category"
          >
            <Input
              id="dashboard-new-project-memory-category"
              value={newProjectMemoryCategory}
              onChange={(event) => setNewProjectMemoryCategory(event.target.value)}
              placeholder="例如：项目约定"
              aria-label="分类（可选）"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={editingRecord !== null}
        title="纠正这条记忆"
        okText="保存"
        cancelText="取消"
        okButtonProps={{
          disabled: correctionText.trim().length === 0,
          loading: correctionSaving,
        }}
        onCancel={() => setEditingRecord(null)}
        onOk={async () => {
          if (!editingRecord || correctionText.trim().length === 0) return;
          setCorrectionSaving(true);
          try {
            const corrected = await onInvoke('correct', {
              id: editingRecord.id,
              correction: { text: correctionText.trim() },
            });
            if (corrected !== undefined) setEditingRecord(null);
          } finally {
            setCorrectionSaving(false);
          }
        }}
      >
        <Input.TextArea
          autoFocus
          value={correctionText}
          onChange={(event) => setCorrectionText(event.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="输入新的记忆内容"
        />
      </Modal>
    </div>
  );
}

function AntSummaryCards({ snapshot }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cards = [
    ['活跃变更', snapshot.summary.activeChanges, '当前 Classic workflow', '进行中', FlagOutlined],
    [
      '已归档变更',
      snapshot.summary.archivedChanges,
      '历史变更已归档',
      '已完成',
      CheckCircleOutlined,
    ],
    [
      'Verify 失败',
      snapshot.summary.verifyFailed,
      '验证结果',
      snapshot.summary.verifyFailed ? '阻塞' : '健康',
      SafetyCertificateOutlined,
    ],
    [
      '未完成任务',
      snapshot.summary.tasksIncomplete,
      '任务推进情况',
      snapshot.summary.tasksIncomplete ? '待办' : '清零',
      CheckOutlined,
    ],
    [
      'Git 未提交',
      snapshot.summary.dirtyFiles,
      '工作区状态',
      snapshot.summary.dirtyFiles ? '未提交' : '干净',
      BranchesOutlined,
    ],
  ];
  return (
    <section className="dashboard-summary-strip dashboard-overview-summary-strip">
      {cards.map(([title, value, note, status, Icon], index) => (
        <AntSummaryCard
          key={title}
          title={title}
          value={value}
          note={note}
          status={status}
          icon={Icon}
          tone={`dashboard-summary-tone-${index + 1}`}
          selected={selectedIndex === index}
          onClick={() => setSelectedIndex(index)}
        />
      ))}
    </section>
  );
}

function AntSummaryCard({ title, value, note, status, icon: Icon, tone, selected, onClick }) {
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
          <div className="text-[13px] font-medium text-muted">{title}</div>
          <div className="dashboard-summary-metric mt-1 text-[28px] font-semibold leading-none tabular-nums">
            {Math.round(animatedValue)}
          </div>
        </div>
        <span className="dashboard-summary-icon" aria-hidden="true">
          <Icon />
        </span>
      </div>
      <span className="dashboard-summary-status">{status}</span>
      <div className="mt-2 truncate text-[11px] text-meta">{note}</div>
    </button>
  );
}

function AntChangesExplorer({
  visible,
  total,
  selectedId,
  tab,
  onTab,
  onSelect,
  hasMore,
  pageLoading,
  onLoadMore,
}) {
  const items = [
    ['active', '活跃'],
    ['archived', '已归档'],
    ['all', '全部'],
  ].map(([key, label]) => ({ key, label }));
  return (
    <AntCard
      className="classic-changes-explorer min-w-0"
      title={
        <span>
          Changes Explorer <Badge count={total} showZero className="ml-2" />
        </span>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={onTab}
        items={items.map((item) => ({
          ...item,
          children: (
            <DashboardChangeList
              visible={visible}
              selectedId={selectedId}
              onSelect={onSelect}
              hasMore={hasMore}
              pageLoading={pageLoading}
              onLoadMore={onLoadMore}
            />
          ),
        }))}
      />
    </AntCard>
  );
}

function pickSelectedFromPage(page, previous) {
  const items = page?.items ?? [];
  if (previous && items.some((change) => dashboardChangeKey(change) === previous)) return previous;
  return items[0] ? dashboardChangeKey(items[0]) : null;
}

function materializeOverview(overview, initialPage) {
  return {
    ...overview,
    changes: {
      active: initialPage?.items ?? [],
      archived: [],
    },
  };
}

function updateSnapshotChangeRows(snapshot, status, items) {
  if (status === 'active') {
    return { ...snapshot, changes: { ...snapshot.changes, active: items } };
  }
  if (status === 'archived') {
    return { ...snapshot, changes: { ...snapshot.changes, archived: items } };
  }
  return {
    ...snapshot,
    changes: {
      active: items.filter((change) => change.status === 'active'),
      archived: items.filter((change) => change.status === 'archived'),
    },
  };
}

function DashboardChangeList({ visible, selectedId, onSelect, hasMore, pageLoading, onLoadMore }) {
  const listRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore || !onLoadMore) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !pageLoading) onLoadMore();
      },
      { root },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, pageLoading]);

  const handleScroll = useCallback(
    (event) => {
      if (!hasMore || pageLoading || !onLoadMore) return;
      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
      if (scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 24) onLoadMore();
    },
    [hasMore, onLoadMore, pageLoading],
  );

  return (
    <div ref={listRef} className="dashboard-change-list" onScroll={handleScroll}>
      {visible.length === 0 && !pageLoading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变更" />
      ) : (
        visible.map((change) => (
          <div
            key={dashboardChangeKey(change)}
            className={`dashboard-change-list-item ${dashboardChangeKey(change) === selectedId ? 'selected' : ''} px-2`}
          >
            <Button
              className={`dashboard-change-row ${dashboardChangeKey(change) === selectedId ? 'dashboard-change-row-selected' : ''}`}
              type="text"
              block
              onClick={() => onSelect(dashboardChangeKey(change))}
            >
              <div className="flex w-full items-center gap-2.5 text-left">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate">{change.displayName}</strong>
                  <span className="mt-0.5 block text-xs text-meta">
                    {phaseLabel(change.phase)} · {change.tasks.completed}/{change.tasks.total}
                  </span>
                  {change.workspace && !change.workspace.current ? (
                    <span className="dashboard-workspace-label mt-1 inline-flex max-w-full truncate">
                      {change.workspace.label}
                    </span>
                  ) : null}
                  <Progress
                    percent={
                      change.tasks.total
                        ? Math.round((change.tasks.completed / change.tasks.total) * 100)
                        : 0
                    }
                    className="mt-1"
                    size="small"
                    showInfo={false}
                  />
                </div>
                <Pill tone={VERIFY_TONE[change.verify.result] ?? 'neutral'}>
                  {VERIFY_LABEL[change.verify.result] ?? '未知'}
                </Pill>
              </div>
            </Button>
          </div>
        ))
      )}
      <div ref={sentinelRef} className="py-2 text-center text-xs text-meta" aria-live="polite">
        {pageLoading ? <Spin size="small" /> : hasMore ? '继续下滑加载更多' : null}
      </div>
    </div>
  );
}

function AntChangeDetail({ change, onPreview }) {
  const [copied, setCopied] = useState(false);
  const current = change.status === 'archived' ? 'archive' : change.phase;
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === current),
  );
  return (
    <AntCard
      className="change-detail min-w-0"
      title={
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{change.displayName}</span>
          <Tooltip title="复制 Change 名称">
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              aria-label={copied ? '已复制 Change 名称' : '复制 Change 名称'}
              onClick={() =>
                copyText(change.name)
                  .then(() => {
                    setCopied(true);
                    toast('Change 名称已复制');
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => toast('复制 Change 名称失败', 'error'))
              }
            />
          </Tooltip>
        </div>
      }
      extra={
        <Pill tone={change.status === 'archived' ? 'neutral' : VERIFY_TONE[change.verify.result]}>
          {change.status === 'archived' ? '已归档' : VERIFY_LABEL[change.verify.result]}
        </Pill>
      }
    >
      <div className="mb-4 text-xs text-meta">
        {change.workflow ?? '—'} · 更新于 {formatTimestamp(change.updatedAt)} ·{' '}
        {relativeChangePath(change)}
      </div>
      <Steps size="small" current={currentIndex} items={PHASES.map(([, title]) => ({ title }))} />
      <Alert
        className="dashboard-next-step-alert"
        type="info"
        showIcon
        title={change.next?.command ? `下一步：${change.next.command}` : '该变更没有待执行的下一步'}
        description={change.next?.description}
      />
      <div className="change-detail-panels grid min-w-0 gap-4">
        <AntCard size="small" title="关键产物">
          <ArtifactList change={change} onPreview={onPreview} />
        </AntCard>
        <TaskProgress change={change} />
      </div>
    </AntCard>
  );
}
