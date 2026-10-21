import {
  useWorkflowSummary,
  matchesSummary,
  SummaryFilterBar,
  SummaryDetails,
} from './workflow-summary.jsx';
import {
  navigateDashboard,
  readDashboardNavigation,
  useDashboardNavigation,
} from './dashboard-navigation.js';
import {
  t,
  systemText,
  knowledgeText,
  localized,
  getDashboardLocale,
  readDashboardLanguage,
  setDashboardLanguage,
} from './dashboard-i18n.js';
import { DashboardLanguageSwitch, useDashboardLanguage } from './dashboard-language.jsx';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Popover,
  Select,
  Skeleton,
  Switch,
  Tag,
  theme as antdTheme,
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
  Tabs,
} from 'antd';
import {
  BranchesOutlined,
  DeploymentUnitOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FlagOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
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
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  extractToc,
  renderJsonPreview,
  renderMarkdown,
  renderYamlTable,
  runMermaid,
} from './markdown-preview.js';
import { NativeWorkflowPanel } from './native-workflow-panel.jsx';
import { AnyWorkflowPanel } from './any-workflow-panel.jsx';
import { EvalPanel } from './eval-panel.jsx';
import { EvalSettings } from './eval-settings.jsx';
import {
  DashboardAppearanceContext,
  DashboardAppearanceSettings,
  useDashboardFontScale,
} from './dashboard-appearance.jsx';
import { DashboardVersion, DashboardUpdateModal, useDashboardUpdate } from './dashboard-update.jsx';
import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
import {
  classicChangeStatusPresentation,
  isClassicPhaseRunning,
} from './classic-status-presentation.js';
import {
  DashboardModal,
  DashboardPortalProvider,
  useDashboardModalState,
} from './dashboard-modal.jsx';
import { useAnimatedNumber } from './use-animated-number.js';
import { ContextUsagePanel } from './context-usage-panel.jsx';
import { RuntimePerformancePanel } from './runtime-performance-panel.jsx';
import { ChangeTracePanel } from './change-trace-panel.jsx';
import { ObservabilityTimeFilter, observabilityRangeLabel } from './observability-time-filter.jsx';
import { filterContextUsage, resolveObservabilityRange } from './observability-time-range.js';
import { DashboardWorkspaceRegion, WorkflowEmptyIllustration } from './workspace-layout.jsx';
import { useDashboardMotion } from './dashboard-motion.jsx';
import { useDashboardViewState, useDashboardScrollRestoration } from './dashboard-view-state.js';
import {
  dashboardChangeKey,
  dashboardResponseError,
  isStaleNativeDashboardCursorError,
  nativeDashboardChangeKey,
  refreshNativeDashboardPage,
  shouldAutoLoadDashboardDetail,
  shouldShowDashboardDetailLoading,
} from './dashboard-web-state.js';
import {
  createDashboardRequestCoordinator,
  mergePartialPluginPage,
  resolveDashboardProjectWorkflow,
} from './dashboard-data.js';
import './styles.css';
import { localizedDemo } from './demo-locale.js';

const AUTO_REFRESH_MS = 30_000;
const MEMORY_COLLAPSE_THRESHOLD = 240;
const DASHBOARD_FONT_FAMILY = 'var(--font-ui)';
const DASHBOARD_MONO_FONT_FAMILY = 'var(--font-mono)';
const DASHBOARD_FONT_TOKENS = {
  fontSize: 14,
  fontSizeSM: 13,
  fontSizeHeading1: 28,
  fontSizeHeading2: 24,
  fontSizeHeading3: 20,
  fontSizeHeading4: 16,
  fontSizeHeading5: 14,
  fontWeightStrong: 600,
};
const DASHBOARD_PLUGIN_NAV_PLACEHOLDERS = localized(
  Object.freeze([
    {
      pluginId: 'comet.personal-memory',
      label: '个人记忆',
      route: '/plugins/personal-memory',
      status: 'loading',
      pending: true,
      globallyDisabled: false,
      projectPaused: false,
      diagnostics: [],
    },
    {
      pluginId: 'comet.project-knowledge',
      label: '项目知识',
      route: '/plugins/project-knowledge',
      status: 'loading',
      pending: true,
      globallyDisabled: false,
      projectPaused: false,
      diagnostics: [],
    },
  ]),
);
const DASHBOARD_DEMO_PLUGIN_NAV = localized(
  Object.freeze(
    DASHBOARD_PLUGIN_NAV_PLACEHOLDERS.map((page) => ({
      ...page,
      status: 'enabled',
      pending: false,
    })),
  ),
);

const DASHBOARD_CACHE_VERSION = 1;

function readDashboardCache(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
    return parsed?.version === DASHBOARD_CACHE_VERSION ? parsed.value : null;
  } catch {
    return null;
  }
}

function writeDashboardCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ version: DASHBOARD_CACHE_VERSION, value }));
  } catch {
    // Cache persistence is an optimization; private browsing may reject it.
  }
}

function pluginPageStorageKey(projectId, pluginId) {
  return `comet-dashboard-plugin:${projectId}:${pluginId}`;
}

function projectConfigStorageKey(projectId) {
  return `comet-dashboard-config:${projectId}`;
}

function useTheme({ embedded = false, themeRoot = null } = {}) {
  const [theme, setTheme] = useState(() => {
    if (embedded) return 'light';
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
    const root = embedded ? themeRoot : document.documentElement;
    if (!root) return undefined;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    if (!embedded) localStorage.setItem('comet-theme', theme);

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, theme, themeRoot]);

  const updateTheme = useCallback(
    (value) => {
      if (!embedded && (value === 'dark' || value === 'light')) setTheme(value);
    },
    [embedded],
  );

  return { theme, updateTheme };
}

const PHASES = localized([
  ['open', '启动'],
  ['design', '设计'],
  ['build', '构建'],
  ['verify', '验证'],
  ['archive', '归档'],
]);

const ARTIFACTS = localized([
  ['proposal', 'proposal.md', '提案'],
  ['design', 'design.md', '设计文档'],
  ['tasks', 'tasks.md', '任务清单'],
  ['plan', 'plan.md', '实施计划'],
  ['verifyReport', 'verify-result.md', '验证报告'],
  ['cometYaml', '.comet.yaml', '变更配置'],
]);

const SOURCE_LABELS = localized({
  openspec: 'OpenSpec 产物',
  superpowers: 'Superpowers 产物',
  comet: 'Comet 中间产物',
});

const VERIFY_LABEL = localized({
  pass: '通过',
  fail: '验证失败',
  pending: '待验证',
  unknown: '未知',
});

const VERIFY_TONE = {
  pass: 'ok',
  fail: 'danger',
  pending: 'warn',
  unknown: 'neutral',
};

const PROJECT_KNOWLEDGE_TYPE_OPTIONS = localized([
  {
    value: 'topology',
    label: '项目结构',
    description: '项目由哪些目录、模块和入口组成',
    example: '例如：入口目录、模块边界和运行入口。',
  },
  {
    value: 'fact',
    label: '项目事实',
    description: '已确认的项目属性、技术信息和运行条件',
    example: '例如：支持的平台、配置位置和运行前提。',
  },
  {
    value: 'dependency',
    label: '模块依赖',
    description: '模块之间的调用、注册和生成关系',
    example: '例如：模块调用方向、注册入口和生成物来源。',
  },
  {
    value: 'decision',
    label: '技术决策',
    description: '项目选择某种技术方案的结论和原因',
    example: '例如：选择本地索引而不是远程检索的原因。',
  },
  {
    value: 'pattern',
    label: '工程惯例',
    description: '项目中反复采用的代码组织和实现方式',
    example: '例如：模块分层、命名方式和复用边界。',
  },
  {
    value: 'procedure',
    label: '操作流程',
    description: '完成某类项目任务时应遵循的步骤',
    example: '例如：构建、验证和发布的执行顺序。',
  },
  {
    value: 'constraint',
    label: '强制约束',
    description: '修改项目时必须满足并可验证的要求',
    example: '例如：提交前必须运行的检查。',
  },
  {
    value: 'failure-resolution',
    label: '故障处理',
    description: '已知问题的症状、原因和验证过的处理方法',
    example: '例如：构建失败的原因和恢复步骤。',
  },
]);

const PROJECT_KNOWLEDGE_CATEGORY_GROUPS = localized([
  {
    key: 'model',
    label: '项目概况',
    description: '项目概况回答“项目是什么”',
    example: '包括项目结构、已确认事实和模块依赖。',
    types: ['topology', 'fact', 'dependency'],
  },
  {
    key: 'policy',
    label: '项目规范',
    description: '项目规范回答“在项目中应该怎么做”',
    example: '包括技术决策、工程惯例、流程、约束和故障处理。',
    types: ['decision', 'pattern', 'procedure', 'constraint', 'failure-resolution'],
  },
]);

const PERSONAL_MEMORY_FILTERS = localized([
  {
    key: 'all',
    label: '全部记忆',
    description: '全部当前有效的个人记忆；历史记录单独查看',
    example: '包括个人偏好与事实、协作约定和任务经验。',
  },
  {
    key: 'profile',
    label: '个人偏好与事实',
    description: '个人偏好与事实保存长期稳定的信息',
    example: '例如：语言、角色和表达方式。',
  },
  {
    key: 'policy',
    label: '协作约定',
    description: '希望 Agent 持续采用的沟通和工作方式',
    example: '例如：先确认范围或只运行相关测试。',
  },
  {
    key: 'episode',
    label: '任务经验',
    description: '任务经验只在相似场景中参考',
    example: '例如：一次故障处理中验证有效的经验。',
  },
  {
    key: 'history',
    label: '历史记录',
    description: '已替代、冲突或已忘记的记忆，默认不再提供给 Agent',
    example: '可用于回顾和判断旧记忆为何不再生效。',
  },
]);

const PROJECT_KNOWLEDGE_STATE_LABELS = localized({
  trial: '试用中',
  proven: '已验证',
  enforced: '强制执行',
  superseded: '已替代',
});

const PROJECT_MODEL_TYPES = new Set(['topology', 'fact', 'dependency']);

function projectKnowledgeTypeLabel(type) {
  return PROJECT_KNOWLEDGE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? t('其他');
}

function projectKnowledgeTypeMeta(type) {
  return (
    PROJECT_KNOWLEDGE_TYPE_OPTIONS.find((option) => option.value === type) ?? {
      value: type,
      label: t('其他'),
      description: t('尚未归入内置类型的项目知识'),
      example: t('请在记录详情中核对来源和适用范围。'),
    }
  );
}

function personalMemoryFilterMeta(key) {
  return PERSONAL_MEMORY_FILTERS.find((item) => item.key === key) ?? PERSONAL_MEMORY_FILTERS[0];
}

function projectKnowledgeStateLabel(state) {
  return PROJECT_KNOWLEDGE_STATE_LABELS[state] ?? t('待确认');
}

function projectKnowledgeStateMatches(record, filter) {
  if (filter === 'all') return true;
  if (filter === 'active') return record.state !== 'superseded';
  return record.state === filter;
}

function projectPolicyActivationLabel(activation) {
  if (activation?.kind === 'verification') return t('项目验证命令约束');
  if (activation?.kind === 'skill-candidate') return t('Skill 候选（仅建议）');
  if (activation?.kind === 'context') return t('上下文指导');
  return null;
}

function projectKnowledgeVerificationLines(record) {
  return (record?.verification ?? [])
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : (entry?.command ?? entry?.description ?? entry?.status ?? ''),
    )
    .filter(Boolean);
}

function projectKnowledgeDiagnosticCopy(diagnostic) {
  const code = typeof diagnostic === 'string' ? '' : diagnostic?.code;
  const message = typeof diagnostic === 'string' ? diagnostic : diagnostic?.message;
  if (code === 'index-source') {
    const source = message?.match(/source:\s*(.+)$/u)?.[1];
    return {
      label: t('来源需要检查'),
      message: source ? t('无法读取来源：{0}', [source]) : t('发现无法读取或正在变化的知识来源。'),
    };
  }
  return {
    label: code ? t('运行诊断') : t('需要关注'),
    message: systemText(message) ?? t('项目知识状态需要检查。'),
  };
}

function splitProjectKnowledgeLines(value) {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function App({
  forceDemo = false,
  demoPluginPages = null,
  embedded = false,
  themeRoot = null,
  portalContainer = null,
}) {
  const language = useDashboardLanguage();
  const { theme, updateTheme } = useTheme({ embedded, themeRoot });
  const appearance = useDashboardFontScale({ embedded, themeRoot });
  const scaledFontTokens = useMemo(() => {
    if (appearance.fontScale === 100) return {};
    const original = antdTheme.getDesignToken({
      token: DASHBOARD_FONT_TOKENS,
    });
    return Object.fromEntries(
      Object.entries(original)
        .filter(
          ([key, value]) => /^(?:fontSize|controlHeight)/u.test(key) && typeof value === 'number',
        )
        .map(([key, value]) => [key, (value * appearance.fontScale) / 100]),
    );
  }, [appearance.fontScale]);

  useEffect(() => {
    if (embedded) return undefined;
    document.documentElement.lang = getDashboardLocale();
    const syncLanguage = (event) => {
      if (event.key === 'comet-dashboard-language' || event.key === null) {
        setDashboardLanguage(readDashboardLanguage(), { persist: false });
      }
    };
    window.addEventListener('storage', syncLanguage);
    return () => window.removeEventListener('storage', syncLanguage);
  }, [embedded, language]);

  return (
    <ConfigProvider
      locale={language === 'en' ? enUS : zhCN}
      getPopupContainer={portalContainer ? () => portalContainer : undefined}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: theme === 'dark' ? '#7fa8ff' : '#255ed8',
          colorBgContainer: theme === 'dark' ? '#151923' : '#ffffff',
          colorBgElevated: theme === 'dark' ? '#1a202b' : '#ffffff',
          colorBgLayout: theme === 'dark' ? '#0e1420' : '#eef1f5',
          colorText: theme === 'dark' ? '#edf2fb' : '#101827',
          colorTextSecondary: theme === 'dark' ? '#aab5c8' : '#5f6979',
          colorTextPlaceholder: theme === 'dark' ? '#8791a2' : '#5f6b7c',
          colorTextDisabled: theme === 'dark' ? '#8791a2' : '#929baa',
          colorBorder: theme === 'dark' ? '#293345' : '#e3e8ef',
          colorSplit: theme === 'dark' ? '#293345' : '#edf0f4',
          colorFillAlter: theme === 'dark' ? '#182131' : '#f6f8fb',
          colorInfoBg: theme === 'dark' ? '#1a202b' : '#e6f4ff',
          colorInfoBorder: theme === 'dark' ? '#34597f' : '#91caff',
          borderRadius: 12,
          fontFamily: DASHBOARD_FONT_FAMILY,
          fontFamilyCode: DASHBOARD_MONO_FONT_FAMILY,
          ...DASHBOARD_FONT_TOKENS,
          ...scaledFontTokens,
        },
      }}
    >
      <DashboardAppearanceContext.Provider value={{ ...appearance, theme, updateTheme }}>
        <DashboardPortalProvider container={portalContainer}>
          <AntApp>
            <DashboardApp
              forceDemo={forceDemo}
              demoPluginPages={demoPluginPages}
              embedded={embedded}
              portalContainer={portalContainer}
            />
          </AntApp>
        </DashboardPortalProvider>
      </DashboardAppearanceContext.Provider>
    </ConfigProvider>
  );
}

function DashboardApp({
  forceDemo = false,
  demoPluginPages = null,
  embedded = false,
  portalContainer = null,
}) {
  const dashboardLanguage = useDashboardLanguage();
  const navigation = useDashboardNavigation({ embedded });
  const useDemo = forceDemo || new URLSearchParams(window.location.search).has('demo');
  const cometUpdate = useDashboardUpdate(!embedded && !useDemo);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [workflow, setWorkflow] = useState(() => (useDemo ? 'classic' : null));
  const [workflowSource, setWorkflowSource] = useState(null);
  const [pluginSelection, setPluginSelection] = useState(() =>
    !embedded && navigation.view === 'plugin' ? navigation.pluginId : null,
  );
  const [evalOpen, setEvalOpen] = useState(() => !embedded && navigation.view === 'eval');
  const [contextUsageOpen, setContextUsageOpen] = useState(
    () => !embedded && navigation.view === 'context-usage',
  );
  const contextUsageOpenRef = useRef(contextUsageOpen);
  contextUsageOpenRef.current = contextUsageOpen;
  const [evalRefreshToken, setEvalRefreshToken] = useState(0);
  const [applicationSelection, setApplicationSelection] = useState(null);
  const [applicationRefreshToken, setApplicationRefreshToken] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('comet.personal-memory');
  const [settingsPage, setSettingsPage] = useState(null);
  const [settingsConfig, setSettingsConfig] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [pluginPages, setPluginPages] = useState(() =>
    useDemo ? (demoPluginPages ?? DASHBOARD_DEMO_PLUGIN_NAV) : DASHBOARD_PLUGIN_NAV_PLACEHOLDERS,
  );
  const [pluginPage, setPluginPage] = useState(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginError, setPluginError] = useState(null);
  const [pluginRefreshToken, setPluginRefreshToken] = useState(0);
  const pluginSelectionRef = useRef(null);
  const settingsSectionRef = useRef(settingsSection);
  const settingsOpenRef = useRef(settingsOpen);
  const pluginProjectRef = useRef(null);
  const pluginPageCacheRef = useRef(new Map());
  const projectConfigCacheRef = useRef(new Map());
  const pluginPageCoordinatorRef = useRef(null);
  const projectConfigCoordinatorRef = useRef(null);
  if (pluginPageCoordinatorRef.current === null) {
    pluginPageCoordinatorRef.current = createDashboardRequestCoordinator();
  }
  if (projectConfigCoordinatorRef.current === null) {
    projectConfigCoordinatorRef.current = createDashboardRequestCoordinator();
  }
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
  const [summaryFilter, setSummaryFilter] = useState(null);
  const [summaryDialog, setSummaryDialog] = useState(null);
  const [summaryTarget, setSummaryTarget] = useState(null);
  const summaryData = useWorkflowSummary({
    projectId: activeProjectId,
    workflow,
    snapshot,
    demo: useDemo,
    enabled:
      !evalOpen &&
      !contextUsageOpen &&
      !pluginSelection &&
      ['classic', 'native'].includes(workflow),
  });
  useEffect(() => {
    setSummaryFilter(null);
    setSummaryDialog(null);
    setSummaryTarget(null);
  }, [activeProjectId, workflow]);

  const handleSummaryAction = (key) => {
    if (key === 'git') {
      setSummaryDialog(key);
      return;
    }
    clearSearch();
    if (['active', 'archived'].includes(key)) {
      setSummaryFilter(null);
      setTab(tab === key && !summaryFilter ? 'all' : key);
    } else {
      setTab('active');
      setSummaryFilter((current) => (current === key ? null : key));
      if (['tasks', 'pending'].includes(key)) setSummaryDialog(key);
    }
  };
  const loadSummaryDetail = useCallback(
    (change, signal) => {
      if (useDemo) return Promise.resolve(change);
      return workflow === 'native'
        ? fetchDashboardNativeChangeDetail(activeProjectId, change, signal)
        : fetchDashboardChangeDetail(activeProjectId, dashboardChangeKey(change), signal);
    },
    [activeProjectId, workflow, useDemo],
  );
  const workspaceScope = `${useDemo ? 'demo' : 'project'}:${activeProjectId ?? ''}:${contextUsageOpen ? 'context-usage' : evalOpen ? 'eval' : (pluginSelection ?? workflow ?? 'default')}`;
  const [query, setQuery] = useDashboardViewState(workspaceScope, 'query', '');
  const [searchResetToken, setSearchResetToken] = useState(0);
  const clearSearch = () => {
    setQuery('');
    setSearchResetToken((value) => value + 1);
  };
  const filteredSummaryRows = useMemo(
    () =>
      summaryData.rows.filter(
        (change) =>
          matchesSummary(change, summaryFilter) &&
          (!query?.trim() ||
            (change.displayName ?? change.name).toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [summaryData.rows, summaryFilter, query],
  );
  const workspaceScrollRef = useDashboardScrollRestoration(workspaceScope);
  const [loading, setLoading] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const requestedSearchRef = useRef(null);
  const { message: messageApi } = AntApp.useApp();
  const toast = useCallback((content, type = 'success') => messageApi[type](content), [messageApi]);

  const queryRef = useRef(query);
  const tabRef = useRef(tab);
  const workflowRef = useRef(workflow);
  const activePluginPageId = pluginSelection;
  queryRef.current = query;
  tabRef.current = tab;
  workflowRef.current = workflow;
  nativeSelectedDetailRef.current = nativeSelectedDetail;
  pluginSelectionRef.current = pluginSelection;
  settingsSectionRef.current = settingsSection;
  settingsOpenRef.current = settingsOpen;
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
      const refreshQuery = queryRef.current;
      const refreshTab = tabRef.current;
      try {
        const next = useDemo
          ? await loadDemoSnapshot()
          : await fetchDashboardOverview(activeProjectId, controller.signal, refreshQuery);
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
          if (queryRef.current !== refreshQuery || tabRef.current !== refreshTab) return;
          // overview 已成功，补齐已展开的 Classic 页不能阻断其他面板。
          setSnapshot(materializeOverview(next, initialPage));
          const loadedCount = queryChanged
            ? 5
            : Math.max(5, pagesRef.current[currentTab]?.items.length ?? 0);
          const refreshingClassic = workflowRef.current === 'classic';
          const freshPage =
            !refreshingClassic ||
            (currentTab === 'active' &&
              (!initialPage.nextCursor || loadedCount <= initialPage.items.length))
              ? initialPage
              : await fetchDashboardChangePage(activeProjectId, currentTab, {
                  query: refreshQuery,
                  signal: controller.signal,
                  summaryLimit: loadedCount,
                });
          if (
            snapshotRequestRef.current !== controller ||
            controller.signal.aborted ||
            queryRef.current !== refreshQuery ||
            tabRef.current !== refreshTab
          )
            return;
          pageRequestRef.current?.abort();
          pageRequestRef.current = null;
          setPageLoading(null);
          const nextPages = {
            active: initialPage,
            archived: null,
            all: null,
            ...(refreshingClassic ? { [currentTab]: freshPage } : {}),
          };
          const currentPage = freshPage;
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
          if (
            snapshotRequestRef.current !== controller ||
            controller.signal.aborted ||
            queryRef.current !== refreshQuery ||
            tabRef.current !== refreshTab
          )
            return;
          if (refreshingClassic) {
            const nextId = pickSelectedFromPage(
              queryChanged && currentTab !== 'active' ? nextPages[currentTab] : currentPage,
              selectedIdRef.current,
            );
            const previousSelectedId = selectedIdRef.current;
            setSelectedId(nextId);
            selectedIdRef.current = nextId;
            detailRequestRef.current?.abort();
            detailRequestRef.current = null;
            setDetailError(null);
            if (nextId !== previousSelectedId || !nextId) setSelectedDetail(null);
            setDetailLoading(Boolean(nextId));
            if (nextId) {
              const detailController = new AbortController();
              detailRequestRef.current = detailController;
              const abortDetail = () => detailController.abort();
              controller.signal.addEventListener('abort', abortDetail, { once: true });
              try {
                const freshDetail = await fetchDashboardChangeDetail(
                  activeProjectId,
                  nextId,
                  detailController.signal,
                );
                if (
                  detailRequestRef.current === detailController &&
                  !detailController.signal.aborted &&
                  selectedIdRef.current === nextId
                )
                  setSelectedDetail(freshDetail);
              } catch (error) {
                if (
                  detailRequestRef.current === detailController &&
                  !detailController.signal.aborted
                )
                  setDetailError({ id: nextId, message: error.message });
              } finally {
                controller.signal.removeEventListener('abort', abortDetail);
                if (detailRequestRef.current === detailController) {
                  detailRequestRef.current = null;
                  setDetailLoading(false);
                }
              }
            }
          }
          lastLoadedQueryRef.current = currentQuery;
        }
        if (manual) toast(t('状态已刷新'));
      } catch (error) {
        if (controller.signal.aborted) return;
        toast(t('刷新失败：{0}', [error.message]), 'error');
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
      if (
        !useDemo &&
        (pluginSelectionRef.current || contextUsageOpenRef.current || settingsOpenRef.current)
      ) {
        setPluginRefreshToken((value) => value + 1);
      }
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
        const requestedEvalProject = readDashboardNavigation().projectId;
        const next =
          available.find((project) => project.id === requestedEvalProject)?.id ??
          available.find((project) => project.id === directory.currentProjectId)?.id ??
          available[0]?.id ??
          null;
        setActiveProjectId((previous) => previous ?? next);
        const initialProject = available.find((project) => project.id === next) ?? null;
        const initialWorkflow = resolveDashboardProjectWorkflow(initialProject);
        setWorkflow(readDashboardNavigation().workflow ?? initialWorkflow.workflow);
        setWorkflowSource(initialWorkflow.source);
        setProjectsReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectsReady(true);
        toast(t('项目列表加载失败：{0}', [error.message]), 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [useDemo]);

  const loadCachedPluginPage = useCallback(async (projectId, pluginId, force = false, owner) => {
    const cacheKey = `${projectId}:${pluginId}`;
    let cached = pluginPageCacheRef.current.get(cacheKey);
    if (!cached) {
      cached = readDashboardCache(pluginPageStorageKey(projectId, pluginId));
      if (cached) pluginPageCacheRef.current.set(cacheKey, cached);
    }
    if (!force && cached) return cached;
    return pluginPageCoordinatorRef.current.load(
      cacheKey,
      async (signal) =>
        mergePartialPluginPage(cached, await fetchDashboardPluginPage(projectId, pluginId, signal)),
      {
        force,
        owner,
        readPersisted: () => readDashboardCache(pluginPageStorageKey(projectId, pluginId)),
        writePersisted: (page) => {
          pluginPageCacheRef.current.set(cacheKey, page);
          writeDashboardCache(pluginPageStorageKey(projectId, pluginId), page);
        },
      },
    );
  }, []);

  const readCachedPluginPage = useCallback((projectId, pluginId) => {
    const cacheKey = `${projectId}:${pluginId}`;
    const memory = pluginPageCacheRef.current.get(cacheKey);
    if (memory) return memory;
    const persisted = readDashboardCache(pluginPageStorageKey(projectId, pluginId));
    if (persisted) pluginPageCacheRef.current.set(cacheKey, persisted);
    return persisted;
  }, []);

  const readCachedProjectConfig = useCallback((projectId) => {
    const memory = projectConfigCacheRef.current.get(projectId);
    if (memory) return memory;
    const persisted = readDashboardCache(projectConfigStorageKey(projectId));
    if (persisted) projectConfigCacheRef.current.set(projectId, persisted);
    return persisted;
  }, []);

  const loadCachedProjectConfig = useCallback(async (projectId, force = false, owner) => {
    let cached = projectConfigCacheRef.current.get(projectId);
    if (!cached) {
      cached = readDashboardCache(projectConfigStorageKey(projectId));
      if (cached) projectConfigCacheRef.current.set(projectId, cached);
    }
    if (!force && cached) return cached;
    return projectConfigCoordinatorRef.current.load(
      projectId,
      (signal) => fetchDashboardProjectConfig(projectId, signal),
      {
        force,
        owner,
        readPersisted: () => readDashboardCache(projectConfigStorageKey(projectId)),
        writePersisted: (config) => {
          projectConfigCacheRef.current.set(projectId, config);
          writeDashboardCache(projectConfigStorageKey(projectId), config);
        },
      },
    );
  }, []);

  const preloadDashboardSettings = useCallback(
    (projectId, pages) => {
      const requests = pages
        .filter((page) => !page.pending)
        .map((page) => loadCachedPluginPage(projectId, page.pluginId));
      requests.push(loadCachedProjectConfig(projectId));
      return Promise.allSettled(requests);
    },
    [loadCachedPluginPage, loadCachedProjectConfig],
  );

  const reloadPluginPages = useCallback(async () => {
    if (useDemo || !activeProjectId) return;
    const requestedProjectId = activeProjectId;
    try {
      const nextPages = await fetchDashboardPluginPages(requestedProjectId);
      if (pluginProjectRef.current !== requestedProjectId) return;
      const availablePages = nextPages.pages ?? [];
      setPluginPages(availablePages);
      void preloadDashboardSettings(requestedProjectId, availablePages);
      return availablePages;
    } catch (error) {
      toast(t('插件页面加载失败：{0}', [error.message]), 'error');
      return undefined;
    }
  }, [activeProjectId, preloadDashboardSettings, toast, useDemo]);

  useEffect(() => {
    if (useDemo || !activeProjectId) return;
    void loadCachedProjectConfig(activeProjectId).catch(() => undefined);
  }, [activeProjectId, loadCachedProjectConfig, useDemo]);

  useEffect(() => {
    if (useDemo || !activeProjectId) return undefined;
    let cancelled = false;
    setPluginSelection(null);
    setSettingsOpen(false);
    setSettingsPage(null);
    setSettingsError(null);
    setPluginPages(DASHBOARD_PLUGIN_NAV_PLACEHOLDERS);
    setPluginPage(null);
    setPluginError(null);
    void fetchDashboardPluginPages(activeProjectId)
      .then(async (response) => {
        if (cancelled) return;
        const availablePages = response.pages ?? [];
        setPluginPages(availablePages);
        void preloadDashboardSettings(activeProjectId, availablePages);
      })
      .catch((error) => {
        if (!cancelled) toast(t('插件页面加载失败：{0}', [error.message]), 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, preloadDashboardSettings, toast, useDemo]);

  useEffect(() => {
    if (useDemo || !activeProjectId || !pluginSelection) return undefined;
    let cancelled = false;
    const owner = `plugin-page:${activeProjectId}:${pluginSelection}`;
    const cachedPage = readCachedPluginPage(activeProjectId, pluginSelection);
    if (cachedPage) setPluginPage(cachedPage);
    setPluginLoading(true);
    setPluginError(null);
    void loadCachedPluginPage(activeProjectId, pluginSelection, Boolean(cachedPage), owner)
      .then((page) => {
        if (!cancelled) setPluginPage(page);
      })
      .catch((error) => {
        if (!cancelled) {
          if (!cachedPage) setPluginPage(null);
          setPluginError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setPluginLoading(false);
      });
    return () => {
      cancelled = true;
      pluginPageCoordinatorRef.current.release(`${activeProjectId}:${pluginSelection}`, owner);
    };
  }, [
    activeProjectId,
    loadCachedPluginPage,
    pluginRefreshToken,
    pluginSelection,
    readCachedPluginPage,
    useDemo,
  ]);

  useEffect(() => {
    if (!useDemo) return undefined;
    if (demoPluginPages) {
      setPluginPages(demoPluginPages);
      setPluginError(null);
      if (!pluginSelection) {
        setPluginPage(null);
        return undefined;
      }
      const nextPage = demoPluginPages.find((page) => page.pluginId === pluginSelection) ?? null;
      setPluginPage(nextPage);
      if (!nextPage) setPluginError(t('未找到对应的插件页面'));
      return undefined;
    }
    let cancelled = false;
    setPluginError(null);
    void loadDemoPluginPages()
      .then((pages) => {
        if (cancelled) return;
        setPluginPages(pages);
        if (!pluginSelection) {
          setPluginPage(null);
          return;
        }
        const nextPage = pages.find((page) => page.pluginId === pluginSelection) ?? null;
        setPluginPage(nextPage);
        if (!nextPage) setPluginError(t('未找到对应的插件页面'));
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginPage(null);
          setPluginError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [demoPluginPages, pluginSelection, useDemo]);

  useEffect(() => {
    if (
      !useDemo ||
      !settingsOpen ||
      !settingsSection ||
      settingsSection === 'comet.eval' ||
      settingsSection === 'comet.appearance'
    )
      return undefined;
    let cancelled = false;
    setSettingsLoading(true);
    setSettingsError(null);
    const request =
      settingsSection === 'comet.config'
        ? loadDemoProjectConfig()
        : loadDemoPluginPages().then(
            (pages) => pages.find((page) => page.pluginId === settingsSection) ?? null,
          );
    void request
      .then((result) => {
        if (cancelled) return;
        if (settingsSection === 'comet.config') {
          setSettingsConfig(result);
        } else {
          setSettingsPage(result);
          if (!result) setSettingsError(t('未找到对应的设置页面'));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (settingsSection === 'comet.config') setSettingsConfig(null);
          else setSettingsPage(null);
          setSettingsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginRefreshToken, settingsOpen, settingsSection, useDemo]);

  useEffect(() => {
    if (
      useDemo ||
      !activeProjectId ||
      !settingsOpen ||
      !settingsSection ||
      settingsSection === 'comet.eval' ||
      settingsSection === 'comet.appearance'
    )
      return undefined;
    let cancelled = false;
    const owner = `settings:${activeProjectId}:${settingsSection}`;
    const cached =
      settingsSection === 'comet.config'
        ? readCachedProjectConfig(activeProjectId)
        : readCachedPluginPage(activeProjectId, settingsSection);
    if (settingsSection === 'comet.config') {
      if (cached) setSettingsConfig(cached);
    } else if (cached) {
      setSettingsPage(cached);
    }
    setSettingsLoading(true);
    setSettingsError(null);
    const request =
      settingsSection === 'comet.config'
        ? loadCachedProjectConfig(activeProjectId, Boolean(cached), owner)
        : loadCachedPluginPage(activeProjectId, settingsSection, Boolean(cached), owner);
    void request
      .then((result) => {
        if (cancelled) return;
        if (settingsSection === 'comet.config') setSettingsConfig(result);
        else setSettingsPage(result);
      })
      .catch((error) => {
        if (!cancelled) {
          if (settingsSection === 'comet.config') {
            if (!cached) setSettingsConfig(null);
          } else if (!cached) {
            setSettingsPage(null);
          }
          setSettingsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
      if (settingsSection === 'comet.config') {
        projectConfigCoordinatorRef.current.release(activeProjectId, owner);
      } else {
        pluginPageCoordinatorRef.current.release(`${activeProjectId}:${settingsSection}`, owner);
      }
    };
  }, [
    activeProjectId,
    loadCachedPluginPage,
    loadCachedProjectConfig,
    pluginRefreshToken,
    readCachedPluginPage,
    readCachedProjectConfig,
    settingsOpen,
    settingsSection,
    useDemo,
  ]);

  const invokePlugin = useCallback(
    async (pluginId, capability, input, surface = 'page') => {
      if (!activeProjectId) return;
      const requestedProjectId = activeProjectId;
      const requestedPluginId = pluginId;
      const result = await invokeDashboardPlugin(requestedProjectId, pluginId, capability, input);
      const surfaceIsCurrent = () =>
        pluginProjectRef.current === requestedProjectId &&
        (surface === 'settings'
          ? settingsOpenRef.current && settingsSectionRef.current === requestedPluginId
          : pluginSelectionRef.current === requestedPluginId);
      const setSurfacePage = surface === 'settings' ? setSettingsPage : setPluginPage;
      if (surfaceIsCurrent()) {
        setSurfacePage((current) =>
          reconcilePluginInvocationResult(current, requestedPluginId, capability, result, input),
        );
      }
      if (
        (requestedPluginId === 'comet.project-knowledge' && capability === 'read-source') ||
        capability === 'memory-get' ||
        (requestedPluginId === 'comet.personal-memory' && capability === 'manage') ||
        capability === 'application-history'
      ) {
        return result;
      }
      const [nextPage] = await Promise.all([
        loadCachedPluginPage(requestedProjectId, pluginId, true),
        reloadPluginPages(),
      ]);
      if (!surfaceIsCurrent()) return result;
      const reconciledPage = reconcilePluginInvocationResult(
        nextPage,
        requestedPluginId,
        capability,
        result,
        input,
      );
      pluginPageCacheRef.current.set(`${requestedProjectId}:${requestedPluginId}`, reconciledPage);
      writeDashboardCache(
        pluginPageStorageKey(requestedProjectId, requestedPluginId),
        reconciledPage,
      );
      setSurfacePage(reconciledPage);
      return result;
    },
    [activeProjectId, loadCachedPluginPage, reloadPluginPages],
  );

  const invokeActivePlugin = useCallback(
    async (pluginId, capability, input, surface = 'page') => {
      try {
        if (useDemo) {
          if (pluginId === 'comet.personal-memory' && capability === 'manage') {
            const terms = String(input?.query ?? '')
              .trim()
              .toLocaleLowerCase()
              .split(/\s+/u)
              .filter(Boolean);
            const records = (pluginPage?.data?.management?.records ?? []).filter((record) => {
              const text = [record.text, record.category, record.memoryClass, record.reason]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase();
              if (!terms.every((term) => text.includes(term))) return false;
              if (!input?.managementFilter || input.managementFilter === 'all') return true;
              if (input.managementFilter === 'history') return !isActiveMemoryRecord(record);
              return (
                isActiveMemoryRecord(record) &&
                record.memoryType ===
                  {
                    profile: 'core-profile',
                    policy: 'collaboration-policy',
                    episode: 'personal-episode',
                  }[input.managementFilter]
              );
            });
            return { records, conflicts: [], total: records.length, offset: 0, truncated: false };
          }
          if (pluginId === 'comet.project-knowledge' && capability === 'read-source') {
            const source = isDashboardRecord(input) ? input.source : null;
            const preview = Array.isArray(pluginPage?.data?.sourcePreviews)
              ? pluginPage.data.sourcePreviews.find((entry) => entry?.source === source)
              : null;
            if (preview) {
              return {
                kind: 'source',
                source: preview.source,
                content: preview.content,
                format: preview.format,
                size: preview.size ?? String(preview.content ?? '').length,
                modifiedAt: preview.modifiedAt,
                truncated: false,
              };
            }
          }
          if (pluginId === 'comet.project-knowledge' && capability === 'memory-get') {
            const memoryEntries = Array.isArray(pluginPage?.data?.projectMemory?.entries)
              ? pluginPage.data.projectMemory.entries
              : [];
            const memory = memoryEntries.find((entry) => entry?.slug === input?.slug);
            if (memory) {
              return { kind: 'memory', ...memory };
            }
          }
          if (pluginId === 'comet.project-knowledge' && capability === 'query') {
            const result = {
              kind: 'search',
              results: Array.isArray(pluginPage?.data?.demoQueryResults)
                ? pluginPage.data.demoQueryResults
                : [],
            };
            setPluginPage((current) =>
              reconcilePluginInvocationResult(current, pluginId, capability, result, input),
            );
            return result;
          }
          toast(t('当前为只读预览，不会写入本地项目'), 'info');
          return undefined;
        }
        let result;
        if (capability === 'lifecycle') {
          await lifecycleDashboardPlugin(activeProjectId, pluginId, input.action);
          if (input.action === 'uninstall') {
            const nextPages = (await reloadPluginPages()) ?? [];
            if (surface === 'settings') {
              setSettingsPage(null);
              setSettingsError(null);
              if (pluginSelectionRef.current === pluginId) {
                setPluginPage(null);
                setPluginError(null);
                setPluginSelection(null);
              }
              const nextSection = nextPages.find((page) => page.pluginId !== pluginId)?.pluginId;
              if (nextSection) setSettingsSection(nextSection);
              else setSettingsOpen(false);
            } else {
              setPluginPage(null);
              setPluginError(null);
              setPluginSelection(null);
            }
          } else {
            setPluginRefreshToken((value) => value + 1);
            await reloadPluginPages();
          }
        } else {
          result = await invokePlugin(pluginId, capability, input, surface);
        }
        if (pluginId === 'comet.project-knowledge' && capability === 'query') {
          const count = Array.isArray(result?.results) ? result.results.length : 0;
          toast(
            count > 0
              ? t('检索完成，找到 {0} 条项目知识', [count])
              : t('检索完成，未找到匹配的项目知识'),
          );
        } else if (pluginId === 'comet.project-knowledge' && capability === 'create') {
          toast(t('项目知识已新增'));
        } else if (
          pluginId === 'comet.project-knowledge' &&
          capability === 'forget' &&
          input?.memory
        ) {
          toast(t('项目记忆已删除'));
        } else if (pluginId === 'comet.project-knowledge' && capability === 'correct') {
          toast(input?.restore ? t('项目知识已更新并恢复使用') : t('项目知识已更新'));
        } else if (pluginId === 'comet.project-knowledge' && capability === 'forget') {
          toast(t('项目知识已标记为已替代，不再提供给 Agent'));
        } else if (pluginId === 'comet.project-knowledge' && capability === 'refresh') {
          const refreshedRecord = Array.isArray(result?.records)
            ? result.records.find((record) => record?.id === input?.id)
            : null;
          toast(
            refreshedRecord?.state === 'proven' || refreshedRecord?.state === 'enforced'
              ? t('来源检查完成，记录已验证')
              : refreshedRecord?.state === 'trial'
                ? t('来源仍需核对，记录继续保持试用状态')
                : refreshedRecord?.state === 'superseded'
                  ? t('来源或验证入口已变化，记录已替代并停止应用')
                  : t('项目知识已刷新'),
          );
        } else if (
          !['read-source', 'memory-get', 'application-history', 'manage'].includes(capability)
        ) {
          toast(capability === 'lifecycle' ? t('插件状态已更新') : t('操作已完成'));
        }
        return result;
      } catch (error) {
        toast(t('插件操作失败：{0}', [error.message]), 'error');
        return undefined;
      }
    },
    [activeProjectId, invokePlugin, pluginPage, reloadPluginPages, toast, useDemo],
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
        toast(t('变更列表加载失败：{0}', [error.message]), 'error');
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
    if (useDemo || workflow !== 'classic' || !snapshot || !activeProjectId || pages[tab]) return;
    void loadPage(tab);
  }, [activeProjectId, loadPage, pages, snapshot, tab, useDemo, workflow]);

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
        lastLoadedQueryRef.current = query;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (append && isStaleNativeDashboardCursorError(error)) {
          const resetPages = { ...nativePagesRef.current, [nextTab]: null };
          nativePagesRef.current = resetPages;
          setNativePages(resetPages);
          toast(t('Native 变更列表已更新，正在重新加载第一页。'), 'info');
          return;
        }
        toast(t('Native 变更列表加载失败：{0}', [error.message]), 'error');
      } finally {
        if (nativePageRequestRef.current === controller) {
          nativePageRequestRef.current = null;
          setNativePageLoading(null);
        }
      }
    },
    [activeProjectId, query, snapshot, toast, useDemo, workflow],
  );

  useEffect(() => {
    if (useDemo || !snapshot || !activeProjectId) return;
    const requestKey = JSON.stringify([activeProjectId, workflow, query]);
    if (requestedSearchRef.current === requestKey) return;
    requestedSearchRef.current = requestKey;
    if (
      query === lastLoadedQueryRef.current &&
      !pageRequestRef.current &&
      !nativePageRequestRef.current
    ) {
      return;
    }
    // 输入框已经防抖。保留当前列表和详情，收到新结果后再更新选择。
    snapshotRequestRef.current?.abort();
    pageRequestRef.current?.abort();
    nativePageRequestRef.current?.abort();
    const nextPages = { active: null, archived: null, all: null };
    const nextNativePages = { active: null, archived: null, all: null };
    if (workflow === 'native' && nativePagesRef.current[tab])
      nextNativePages[tab] = { ...nativePagesRef.current[tab], nextCursor: null };
    else if (pagesRef.current[tab]) nextPages[tab] = { ...pagesRef.current[tab], nextCursor: null };
    pagesRef.current = nextPages;
    nativePagesRef.current = nextNativePages;
    setPages(nextPages);
    setNativePages(nextNativePages);
    if (workflow === 'native') void loadNativePage(tab);
    else if (workflow === 'classic') void loadPage(tab);
  }, [activeProjectId, loadNativePage, loadPage, query, snapshot, tab, useDemo, workflow]);

  const selectNativeChange = useCallback(
    async (change) => {
      if (!change) return;
      setNativeDetailError(null);
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
        toast(t('Native 变更详情加载失败：{0}', [error.message]), 'error');
      } finally {
        if (nativeDetailRequestRef.current === controller) {
          nativeDetailRequestRef.current = null;
          setNativeDetailLoading(false);
        }
      }
    },
    [activeProjectId, toast, useDemo],
  );

  const copyNativeChangeName = useCallback(
    (name) =>
      copyText(name)
        .then(() => toast(t('Change 名称已复制')))
        .catch(() => toast(t('复制 Change 名称失败'), 'error')),
    [toast],
  );

  const selected = selectedDetail;
  const visible = useMemo(
    () =>
      summaryFilter
        ? filteredSummaryRows
        : useDemo
          ? filterChanges(snapshot, tab, query)
          : (pages[tab]?.items ?? []),
    [pages, query, snapshot, tab, useDemo, dashboardLanguage, summaryFilter, filteredSummaryRows],
  );
  const activePage = pages[tab];
  const visibleTotal =
    summaryFilter || useDemo ? visible.length : (activePage?.total ?? visible.length);
  const nativePage = nativePages[tab];
  const nativeOverviewTotal =
    tab === 'active'
      ? (snapshot?.native?.activeChangeCount ?? 0)
      : tab === 'archived'
        ? (snapshot?.native?.archivedChangeCount ?? 0)
        : (snapshot?.native?.totalChangeCount ?? 0);
  const nativeViewKnownEmpty = !useDemo && Boolean(snapshot?.native) && nativeOverviewTotal === 0;
  const nativeVisibleTotal = useDemo
    ? (snapshot?.native?.changes?.length ?? 0)
    : (nativePage?.total ?? nativeOverviewTotal);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeWorkflowSource = useDemo
    ? null
    : (activeProject?.workflowSource ?? workflowSource ?? 'fallback');

  useEffect(() => {
    if (
      useDemo ||
      workflow !== 'native' ||
      !snapshot?.native ||
      nativePages[tab] ||
      nativeViewKnownEmpty
    )
      return;
    void loadNativePage(tab);
  }, [loadNativePage, nativePages, nativeViewKnownEmpty, snapshot, tab, useDemo, workflow]);

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
        toast(t('变更详情加载失败：{0}', [error.message]), 'error');
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
    if (useDemo || workflow !== 'classic' || !snapshot || !activeProjectId) return;
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
    workflow,
  ]);

  const selectTab = useCallback((nextTab) => {
    setSummaryFilter(null);
    setTab(nextTab);
  }, []);

  const resetSelectedProject = useCallback((nextProjectId) => {
    requestedSearchRef.current = null;
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
    setSettingsOpen(false);
    setPluginSelection(null);
    setPluginPages(DASHBOARD_PLUGIN_NAV_PLACEHOLDERS);
    setPluginPage(null);
    setPluginError(null);
    setSettingsConfig(null);
    setRailOpen(false);
  }, []);

  useEffect(() => {
    if (embedded) return;
    if (
      navigation.projectId &&
      navigation.projectId !== activeProjectId &&
      projects.some(
        (project) => project.id === navigation.projectId && project.availability === 'available',
      )
    ) {
      resetSelectedProject(navigation.projectId);
    }
    setEvalOpen(navigation.view === 'eval');
    setContextUsageOpen(navigation.view === 'context-usage');
    setPluginSelection(navigation.view === 'plugin' ? navigation.pluginId : null);
    if (navigation.workflow) setWorkflow(navigation.workflow);
    setSettingsOpen(false);
  }, [embedded, navigation, projects, activeProjectId, resetSelectedProject]);

  return (
    <main
      className={`dashboard-workbench min-h-screen bg-surface text-fg antialiased lg:grid lg:grid-cols-[var(--rail-w)_1fr]${
        sidebarCollapsed ? ' is-sidebar-collapsed' : ''
      }${embedded ? ' is-embedded' : ''}`}
    >
      <AntSidebar
        embedded={embedded}
        update={useDemo ? null : cometUpdate}
        onUpdateSelect={() => {
          setSettingsOpen(false);
          setUpdateOpen(true);
        }}
        open={railOpen}
        collapsed={sidebarCollapsed}
        workflow={workflow}
        evalSelected={evalOpen}
        contextUsageSelected={contextUsageOpen}
        onContextUsageSelect={() => {
          setContextUsageOpen(true);
          setEvalOpen(false);
          setPluginSelection(null);
          setSettingsOpen(false);
          if (!embedded) navigateDashboard({ view: 'context-usage', projectId: activeProjectId });
        }}
        onEvalSelect={() => {
          setContextUsageOpen(false);
          setEvalOpen(true);
          setSettingsOpen(false);
          setPluginSelection(null);
          if (!embedded)
            navigateDashboard({ view: 'eval', projectId: activeProjectId }, { restore: true });
        }}
        onWorkflow={(nextWorkflow) => {
          setApplicationSelection(null);
          setContextUsageOpen(false);
          setEvalOpen(false);
          if (!embedded)
            navigateDashboard(
              {
                view: 'workflow',
                workflow: nextWorkflow,
                projectId: activeProjectId,
              },
              { restore: true },
            );
          setSettingsOpen(false);
          if (nextWorkflow !== workflow) setTab('active');
          setWorkflow(nextWorkflow);
        }}
        workflowSource={activeWorkflowSource}
        pluginPages={pluginPages}
        pluginSelection={pluginSelection}
        settingsOpen={settingsOpen}
        onSettings={() => {
          const preferredSection = evalOpen
            ? 'comet.eval'
            : (pluginSelection ??
              pluginPages.find((page) => page.pluginId === 'comet.personal-memory' && !page.pending)
                ?.pluginId ??
              pluginPages.find((page) => !page.pending)?.pluginId ??
              'comet.config');
          const cachedPage = useDemo
            ? (pluginPages.find((page) => page.pluginId === preferredSection) ?? null)
            : activeProjectId && preferredSection && preferredSection !== 'comet.config'
              ? readCachedPluginPage(activeProjectId, preferredSection)
              : null;
          setSettingsSection(preferredSection);
          setSettingsOpen(true);
          setSettingsPage(cachedPage);
          setSettingsConfig(
            useDemo
              ? settingsConfig
              : activeProjectId
                ? (readCachedProjectConfig(activeProjectId) ?? null)
                : null,
          );
          setSettingsError(null);
        }}
        onPluginSelect={(pluginId) => {
          setContextUsageOpen(false);
          setEvalOpen(false);
          if (!embedded && pluginId)
            navigateDashboard(
              { view: 'plugin', pluginId, projectId: activeProjectId },
              { restore: true },
            );
          setSettingsOpen(false);
          setPluginSelection(pluginId);
          setPluginPage(
            useDemo
              ? (pluginPages.find((page) => page.pluginId === pluginId) ?? null)
              : activeProjectId && pluginId
                ? readCachedPluginPage(activeProjectId, pluginId)
                : null,
          );
          setPluginError(null);
        }}
        onCollapse={() => setSidebarCollapsed(true)}
        onExpand={() => setSidebarCollapsed(false)}
        onClose={() => setRailOpen(false)}
      />
      {railOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          aria-label={t('关闭导航')}
          onClick={() => setRailOpen(false)}
        />
      )}
      <section
        className={`min-w-0${pluginSelection ? ' dashboard-main-section-plugin-center' : ''}`}
      >
        <Topbar
          project={snapshot?.project}
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectForget={async (entry) => {
            const res = await fetch(
              `/api/dashboard/projects/${encodeURIComponent(entry.id)}/forget`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              },
            );
            if (!res.ok) throw await dashboardResponseError(res);
            const directory = await res.json();
            setProjects(directory.projects ?? []);
            toast(t('已从索引移除缺失项目'));
          }}
          onProjectSelect={(nextProjectId) => {
            setApplicationSelection(null);
            if (!embedded) {
              const routeProject = projects.find((project) => project.id === nextProjectId);
              navigateDashboard(
                contextUsageOpen
                  ? { view: 'context-usage', projectId: nextProjectId }
                  : evalOpen
                    ? { view: 'eval', projectId: nextProjectId }
                    : pluginSelection
                      ? { view: 'plugin', pluginId: pluginSelection, projectId: nextProjectId }
                      : {
                          view: 'workflow',
                          projectId: nextProjectId,
                          workflow: ['any', 'application'].includes(workflow)
                            ? workflow
                            : resolveDashboardProjectWorkflow(routeProject).workflow,
                        },
                { restore: true },
              );
            }
            resetSelectedProject(nextProjectId);
            const nextProject = projects.find((project) => project.id === nextProjectId) ?? null;
            const nextWorkflow = resolveDashboardProjectWorkflow(nextProject);
            setWorkflow(
              ['any', 'application'].includes(workflow) ? workflow : nextWorkflow.workflow,
            );
            setWorkflowSource(nextWorkflow.source);
          }}
          loading={loading || Boolean(pluginSelection && pluginLoading)}
          query={query}
          onQuery={setQuery}
          searchKey={`${workspaceScope}:${searchResetToken}`}
          showSearch={
            !contextUsageOpen &&
            !pluginSelection &&
            (evalOpen || !['any', 'application'].includes(workflow))
          }
          searchPlaceholder={
            evalOpen
              ? t('搜索评估目标或运行记录…')
              : ['any', 'application'].includes(workflow)
                ? t('搜索目标或应用…')
                : undefined
          }
          onMenu={() => setRailOpen(true)}
          onRefresh={async () => {
            if (contextUsageOpen) {
              setPluginRefreshToken((value) => value + 1);
              return;
            }
            if (['any', 'application'].includes(workflow) && !evalOpen && !pluginSelection) {
              setApplicationRefreshToken((value) => value + 1);
              return;
            }
            if (evalOpen) {
              setEvalRefreshToken((value) => value + 1);
              return;
            }
            await refresh(true);
            await reloadPluginPages();
            if (activePluginPageId || settingsOpen) setPluginRefreshToken((value) => value + 1);
          }}
        />
        <div
          ref={workspaceScrollRef}
          data-dashboard-scroll="workspace"
          className={`dashboard-content-shell${
            pluginSelection ? ' dashboard-content-shell-plugin-center' : ''
          }`}
        >
          <div
            className={`dashboard-content-inner${
              !contextUsageOpen &&
              !pluginSelection &&
              (evalOpen || ['any', 'application'].includes(workflow))
                ? ' dashboard-content-inner-workspace'
                : ''
            }${pluginSelection ? ' dashboard-content-inner-plugin-center' : ''}${
              pluginSelection === 'comet.project-knowledge'
                ? ' dashboard-content-inner-project-knowledge'
                : ''
            }`}
          >
            {contextUsageOpen && (activeProjectId || useDemo) ? (
              <ContextUsageCenter
                key={activeProjectId ?? 'demo'}
                projectId={activeProjectId}
                demo={useDemo}
                demoPages={pluginPages}
                refreshToken={pluginRefreshToken}
                loadPage={loadCachedPluginPage}
                readCachedPage={readCachedPluginPage}
                coordinator={pluginPageCoordinatorRef.current}
              />
            ) : evalOpen && (activeProjectId || useDemo) ? (
              <EvalPanel
                key={activeProjectId ?? 'demo'}
                projectId={activeProjectId ?? 'demo'}
                projectPath={projects.find((project) => project.id === activeProjectId)?.path}
                query={query}
                readOnly={embedded || useDemo}
                demo={useDemo}
                refreshToken={evalRefreshToken}
                onSettings={() => {
                  setSettingsSection('comet.eval');
                  setSettingsError(null);
                  setSettingsLoading(false);
                  setSettingsOpen(true);
                }}
              />
            ) : !useDemo && projectsReady && !activeProjectId ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可用项目')} />
            ) : !snapshot ? (
              <LoadingState />
            ) : pluginSelection ? (
              <PluginCenterPage
                key={`${activeProjectId}:${pluginSelection}`}
                viewScope={workspaceScope}
                page={pluginPage}
                loading={pluginLoading}
                error={pluginError}
                readOnly={embedded}
                onRetry={() => {
                  setPluginError(null);
                  setPluginRefreshToken((value) => value + 1);
                }}
                onInvoke={(capability, input) =>
                  invokeActivePlugin(pluginSelection, capability, input)
                }
              />
            ) : ['any', 'application'].includes(workflow) ? (
              <AnyWorkflowPanel
                key={`${activeProjectId ?? 'demo'}:${workflow}`}
                workspace={workflow}
                initialLocator={
                  applicationSelection?.projectId === activeProjectId &&
                  applicationSelection?.workflow === workflow
                    ? applicationSelection.locator
                    : null
                }
                onNavigateWorkspace={(target, locator) => {
                  setApplicationSelection({
                    projectId: activeProjectId,
                    workflow: target,
                    locator,
                  });
                  setWorkflow(target);
                  if (!embedded)
                    navigateDashboard(
                      {
                        view: 'workflow',
                        workflow: target,
                        projectId: activeProjectId,
                        runLocator: locator,
                      },
                      { restore: !locator },
                    );
                }}
                projectId={activeProjectId}
                projectPath={activeProject?.path ?? snapshot.project.path}
                query={query}
                onQuery={setQuery}
                refreshToken={applicationRefreshToken}
                onPreview={setArtifact}
                demo={useDemo}
                onRelatedChange={async (related) => {
                  setWorkflow(related.workflow);
                  if (!embedded)
                    navigateDashboard({
                      view: 'workflow',
                      workflow: related.workflow,
                      projectId: activeProjectId,
                    });
                  if (related.workflow === 'native')
                    await selectNativeChange({
                      locator: related.locator,
                      name: related.name,
                      status: related.status,
                    });
                  else await selectChange(related.locator);
                }}
              />
            ) : workflow === 'native' ? (
              <NativeWorkflowPanel
                native={snapshot.native}
                summaryTarget={summaryTarget}
                summaryData={summaryData}
                summaryFilter={summaryFilter}
                onSummaryAction={handleSummaryAction}
                git={snapshot.git}
                query={query}
                tab={tab}
                onTab={selectTab}
                pagedChanges={
                  summaryFilter ? filteredSummaryRows : useDemo ? null : (nativePage?.items ?? [])
                }
                total={summaryFilter ? filteredSummaryRows.length : nativeVisibleTotal}
                hasMore={!summaryFilter && Boolean(nativePage?.nextCursor)}
                pageLoading={
                  summaryFilter
                    ? summaryData.loading
                    : !nativeViewKnownEmpty &&
                      (nativePageLoading === tab || (!useDemo && !nativePage))
                }
                onLoadMore={() => loadNativePage(tab, true)}
                selectedDetail={nativeSelectedDetail}
                detailLoading={nativeDetailLoading}
                detailError={nativeDetailError}
                onSelect={selectNativeChange}
                onRetryDetail={() =>
                  nativeDetailError?.change && selectNativeChange(nativeDetailError.change)
                }
                onPreview={setArtifact}
                onCopyChangeName={copyNativeChangeName}
              />
            ) : workflow === 'classic' ? (
              <Dashboard
                summaryTarget={summaryTarget}
                summaryData={summaryData}
                summaryFilter={summaryFilter}
                onSummaryAction={handleSummaryAction}
                snapshot={snapshot}
                visible={visible}
                visibleTotal={visibleTotal}
                selected={selected}
                selectedId={selectedId}
                tab={tab}
                onTab={selectTab}
                onSelect={selectChange}
                hasMore={!summaryFilter && Boolean(activePage?.nextCursor)}
                pageLoading={summaryFilter ? summaryData.loading : pageLoading === tab}
                onLoadMore={() => loadPage(tab, true)}
                detailLoading={detailLoading}
                detailError={detailError}
                onRetryDetail={() => selectedId && selectChange(selectedId)}
                onPreview={setArtifact}
              />
            ) : (
              <LoadingState />
            )}
          </div>
        </div>
        {!embedded && !useDemo && (
          <DashboardUpdateModal
            open={updateOpen}
            update={cometUpdate}
            onClose={() => setUpdateOpen(false)}
          />
        )}
        <SummaryDetails
          kind={summaryDialog}
          rows={summaryData.rows.filter((change) => matchesSummary(change, summaryDialog))}
          summary={summaryData}
          git={snapshot?.git}
          loadDetail={loadSummaryDetail}
          onClose={() => setSummaryDialog(null)}
          onLocate={(change) => {
            setSummaryFilter(summaryDialog);
            setTab('active');
            clearSearch();
            setSummaryTarget(change);
            setSummaryDialog(null);
            if (workflow !== 'native') selectChange(dashboardChangeKey(change));
          }}
        />
        <DashboardSettingsOverlay
          open={settingsOpen}
          readOnly={embedded}
          evalReadOnly={embedded || useDemo}
          onEvalSaved={() => setEvalRefreshToken((value) => value + 1)}
          section={settingsSection}
          pages={pluginPages}
          page={settingsPage}
          config={settingsConfig}
          loading={settingsLoading}
          error={settingsError}
          onClose={() => setSettingsOpen(false)}
          onSection={(pluginId) => {
            if (pluginId === 'comet.eval' || pluginId === 'comet.appearance')
              setSettingsLoading(false);
            setSettingsSection(pluginId);
            setSettingsPage(
              useDemo && pluginId !== 'comet.config'
                ? (pluginPages.find((page) => page.pluginId === pluginId) ?? null)
                : activeProjectId && pluginId !== 'comet.config'
                  ? readCachedPluginPage(activeProjectId, pluginId)
                  : null,
            );
            setSettingsConfig(
              useDemo && pluginId === 'comet.config'
                ? settingsConfig
                : activeProjectId && pluginId === 'comet.config'
                  ? readCachedProjectConfig(activeProjectId)
                  : null,
            );
            setSettingsError(null);
          }}
          onRetry={() => {
            setSettingsError(null);
            setPluginRefreshToken((value) => value + 1);
          }}
          onSaveConfig={async (config) => {
            if (embedded) return;
            if (useDemo) {
              if (!settingsConfig) return;
              setSettingsConfig({
                ...settingsConfig,
                ...config,
                revision: `demo-${Date.now()}`,
              });
              toast(t('预览配置已保存，仅在当前页面生效'));
              return;
            }
            if (!activeProjectId || !settingsConfig) return;
            const previousKnowledge = settingsConfig.knowledge ?? {
              provider: 'local',
              localInclude: [],
              maxFileMb: 1,
              maxTotalMb: 32,
            };
            const nextKnowledge = config.knowledge ?? previousKnowledge;
            const localKnowledgeConfigChanged =
              nextKnowledge.provider === 'local' &&
              (previousKnowledge.provider !== 'local' ||
                JSON.stringify(nextKnowledge.localInclude ?? []) !==
                  JSON.stringify(previousKnowledge.localInclude ?? []) ||
                nextKnowledge.maxFileMb !== previousKnowledge.maxFileMb ||
                nextKnowledge.maxTotalMb !== previousKnowledge.maxTotalMb);
            try {
              const next = await saveDashboardProjectConfig(activeProjectId, {
                expectedRevision: settingsConfig.revision,
                config,
              });
              projectConfigCacheRef.current.set(activeProjectId, next);
              projectConfigCoordinatorRef.current.set(activeProjectId, next);
              const nextWorkflow = resolveDashboardProjectWorkflow({
                defaultWorkflow: next.defaultWorkflow,
                workflowSource: 'configured',
              });
              setWorkflow(nextWorkflow.workflow);
              setWorkflowSource(nextWorkflow.source);
              setProjects((current) =>
                current.map((project) =>
                  project.id === activeProjectId
                    ? {
                        ...project,
                        defaultWorkflow: next.defaultWorkflow,
                        workflowSource: 'configured',
                      }
                    : project,
                ),
              );
              writeDashboardCache(projectConfigStorageKey(activeProjectId), next);
              setSettingsConfig(next);
              if (localKnowledgeConfigChanged) {
                await invokeActivePlugin('comet.project-knowledge', 'refresh', {}, 'settings');
                if (pluginSelectionRef.current === 'comet.project-knowledge') {
                  setPluginRefreshToken((value) => value + 1);
                }
              }
              toast(t('Comet 配置已保存'));
              await refresh(false);
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), 'error');
              throw error;
            }
          }}
          onInvoke={
            embedded
              ? async () => undefined
              : (capability, input) =>
                  invokeActivePlugin(settingsSection, capability, input, 'settings')
          }
        />
      </section>
      {portalContainer ? (
        createPortal(
          <ArtifactDrawer
            artifact={artifact}
            embedded={embedded}
            onClose={() => setArtifact(null)}
          />,
          portalContainer,
        )
      ) : (
        <ArtifactDrawer artifact={artifact} embedded={embedded} onClose={() => setArtifact(null)} />
      )}
    </main>
  );
}

function DashboardSearchInput({ query, onQuery, placeholder }) {
  const [draft, setDraft] = useState(query);
  const [composing, setComposing] = useState(false);
  const submittedQuery = useRef(query);
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;
  useEffect(() => {
    if (query !== submittedQuery.current) {
      submittedQuery.current = query;
      setDraft(query);
    }
  }, [query]);
  useEffect(() => {
    if (composing || draft === query) return undefined;
    const timer = window.setTimeout(() => {
      submittedQuery.current = draft;
      onQueryRef.current(draft);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [draft, query, composing]);
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={(event) => {
        setComposing(false);
        setDraft(event.currentTarget.value);
      }}
      prefix={<SearchOutlined className="text-meta" />}
      placeholder={placeholder}
      allowClear
    />
  );
}

function Topbar({
  project,
  loading,
  query,
  onQuery,
  searchKey,
  searchPlaceholder = t('搜索变更、产物或文件…'),
  showSearch = true,
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectForget,
  onMenu,
  onRefresh,
}) {
  useDashboardLanguage();
  const { modal } = AntApp.useApp();
  return (
    <header className="comet-workbench-header sticky top-0 z-30 border-b border-border-soft bg-surface/90 backdrop-blur-xl">
      <Button
        className="comet-header-menu lg:hidden"
        type="text"
        icon={<MenuOutlined />}
        onClick={onMenu}
        aria-label={t('打开导航')}
      />
      <div className="comet-header-context">
        <Select
          className="comet-project-select"
          value={activeProjectId ?? undefined}
          placeholder={
            project?.name ? (
              <span className="comet-project-selected-label" title={project.name}>
                {project.name}
              </span>
            ) : (
              t('选择项目')
            )
          }
          showSearch
          optionFilterProp="searchText"
          optionLabelProp="selectedLabel"
          classNames={{ popup: { root: 'comet-project-select-dropdown' } }}
          onChange={onProjectSelect}
          options={projects.map((entry) => ({
            value: entry.id,
            disabled: entry.availability !== 'available',
            searchText: `${entry.name} ${entry.path}`,
            selectedLabel: (
              <span className="comet-project-selected-label" title={entry.name}>
                {entry.name}
              </span>
            ),
            label: (
              <span className="comet-project-option">
                <strong className="comet-project-option-name" title={entry.name}>
                  {entry.name}
                </strong>
                <small className="comet-project-option-path" title={entry.path}>
                  {entry.availability === 'missing'
                    ? t('目录已不存在 · ')
                    : entry.availability === 'unreadable'
                      ? t('无法读取 · ')
                      : ''}
                  {entry.path}
                </small>
              </span>
            ),
          }))}
        />
        {projects.some((entry) => entry.availability === 'missing' && !entry.isCurrent) && (
          <Popover
            trigger="click"
            title={t('缺失项目')}
            content={
              <div
                style={{
                  maxWidth: 'min(420px, calc(100vw - 48px))',
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {projects
                  .filter((entry) => entry.availability === 'missing' && !entry.isCurrent)
                  .map((entry) => (
                    <div key={entry.id} style={{ marginBottom: 12 }}>
                      <div style={{ overflowWrap: 'anywhere' }}>{entry.path}</div>
                      <Button
                        size="small"
                        onClick={() =>
                          modal.confirm({
                            title: t('从索引移除缺失项目？'),
                            content: entry.path,
                            okText: t('移除'),
                            cancelText: t('取消'),
                            onOk: async () => {
                              try {
                                await onProjectForget(entry);
                              } catch (error) {
                                modal.error({ title: t('移除失败'), content: error.message });
                                throw error;
                              }
                            },
                          })
                        }
                      >
                        {t('从索引移除')}
                      </Button>
                    </div>
                  ))}
              </div>
            }
          >
            <Button type="text" icon={<DeleteOutlined />} aria-label={t('管理缺失项目')} />
          </Popover>
        )}
      </div>
      {showSearch && (
        <div className="comet-header-search">
          <DashboardSearchInput
            key={searchKey}
            query={query}
            onQuery={onQuery}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      <div className="comet-header-actions">
        <Tooltip title={t('立即刷新')}>
          <Button
            className="comet-refresh-button"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
            aria-label={t('立即刷新')}
          />
        </Tooltip>
        <DashboardLanguageSwitch />
      </div>
    </header>
  );
}

function Dashboard({
  summaryTarget,
  summaryData,
  summaryFilter,
  onSummaryAction,
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
  useDashboardLanguage();
  const locatedSummaryTarget = useRef(null);
  useEffect(() => {
    if (
      locatedSummaryTarget.current === summaryTarget ||
      !summaryTarget ||
      !selected ||
      dashboardChangeKey(summaryTarget) !== dashboardChangeKey(selected)
    )
      return;
    locatedSummaryTarget.current = summaryTarget;
    const frame = requestAnimationFrame(() =>
      document.querySelector('.classic-change-detail')?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [summaryTarget, selected]);
  const hasClassicChanges = snapshot.summary.activeChanges + snapshot.summary.archivedChanges > 0;
  const classicWarning = snapshot.classicError && hasClassicChanges;
  const detailPending = shouldShowDashboardDetailLoading({
    detailLoading,
    selectedId,
    selectedDetailId: selected?.id ?? null,
    failedDetailId: detailError?.id ?? null,
  });
  const isEmptyView = !pageLoading && visible.length === 0;
  const isLoadingView = pageLoading && visible.length === 0;
  return (
    <div className="mx-auto min-w-0 max-w-dashboard">
      <SectionHead
        title={t('项目概览')}
        hint={t('生成于 {0}', [formatTimestamp(snapshot.project.generatedAt)])}
      />
      <WorkflowSuggestion
        command={selected?.next?.command}
        description={t(selected?.next?.description)}
      />
      <AntSummaryCards
        snapshot={snapshot}
        summaryData={summaryData}
        selectedKey={summaryFilter ?? tab}
        onAction={onSummaryAction}
      />
      <SummaryFilterBar filter={summaryFilter} summary={summaryData} onClear={() => onTab('all')} />
      <SectionHead title={t('变更工作区')} hint={t('查看文件产物与项目进度')} />
      {snapshot.classicError && !hasClassicChanges ? (
        <ClassicErrorState error={snapshot.classicError} />
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
              isEmptyView && summaryFilter ? (
                <section className="dashboard-workspace-empty-panel">
                  <Empty
                    description={t(summaryData.error ? '统计读取失败' : '没有符合当前筛选的变更')}
                  />
                </section>
              ) : isEmptyView ? (
                <ClassicWorkspaceEmptyDetail snapshot={snapshot} tab={tab} onTab={onTab} />
              ) : isLoadingView ? (
                <ClassicWorkspaceLoadingDetail />
              ) : selected ? (
                <AntChangeDetail change={selected} onPreview={onPreview} />
              ) : detailPending ? (
                <ClassicWorkspaceLoadingDetail />
              ) : detailError ? (
                <div className="change-detail min-w-0 rounded-lg bg-bg p-10 text-center text-sm text-danger shadow-raised">
                  <p role="alert">
                    {t('变更详情加载失败：')}
                    {t(detailError.message)}
                  </p>
                  <Button className="mt-4" onClick={onRetryDetail}>
                    {t('重试')}
                  </Button>
                </div>
              ) : null
            }
            right={
              isEmptyView ? (
                <ClassicWorkspaceEmptySidePanel />
              ) : isLoadingView ? (
                <ClassicWorkspaceLoadingSidePanel />
              ) : selected ? (
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
  useDashboardLanguage();
  return (
    <section className="dashboard-priority-banner" role="status" aria-label={t('工作流建议')}>
      <div className="dashboard-priority-title">
        <BulbOutlined aria-hidden="true" />
        <span>{t('下一步建议')}</span>
      </div>
      <p>
        {command ? (
          <>
            {t('优先执行 ')}
            <code>{command}</code>
            {description ? `，${description}` : t('，完成当前工作流阶段。')}
          </>
        ) : (
          t('当前变更没有待执行动作，可以继续检查产物与验证结果。')
        )}
      </p>
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

function CompactHelpButton({ ariaLabel, title, description, example, items = [] }) {
  useDashboardLanguage();
  const content = (
    <div className="dashboard-compact-help-content">
      {description && <p>{description}</p>}
      {example && <p className="dashboard-compact-help-example">{example}</p>}
      {items.length > 0 && (
        <dl>
          {items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.description}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
  return (
    <Tooltip title={description} placement="bottom">
      <Popover title={title} content={content} trigger="click" placement="bottomLeft">
        <Button
          className="dashboard-compact-help-button"
          type="text"
          size="small"
          icon={<InfoCircleOutlined />}
          aria-label={ariaLabel}
        />
      </Popover>
    </Tooltip>
  );
}

function PluginCenterHeader({ meta = [], actions = null, help = null }) {
  useDashboardLanguage();
  return (
    <header className="dashboard-plugin-context-bar" aria-label={t('个人记忆状态与操作')}>
      <div className="dashboard-plugin-context-meta">
        {meta.map((item) => (
          <span
            key={`${item.label}-${item.value}`}
            className={`dashboard-plugin-context-item is-${item.tone ?? 'neutral'}`}
            aria-label={`${item.label}：${item.value}`}
          >
            {item.displayValue ?? item.value}
          </span>
        ))}
        {help}
      </div>
      {actions && <div className="dashboard-tool-actions">{actions}</div>}
    </header>
  );
}

function PhaseStepper({ phase, archived, next }) {
  useDashboardLanguage();
  const current = archived ? 'archive' : phase;
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === current),
  );
  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-lg font-semibold">{t('生命周期阶段')}</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? t('归档 {0}', [phase]) : t('下一步 {0}', [next?.command ?? '—'])}
        </span>
      </div>
      <WorkflowPhaseTrack
        phases={PHASES}
        currentIndex={currentIndex}
        archived={archived}
        currentPhaseRunning={isClassicPhaseRunning({
          status: archived ? 'archived' : 'active',
          phase,
        })}
        ariaLabel={t('Classic 生命周期阶段')}
      />
    </article>
  );
}

function ArtifactList({ change, onPreview }) {
  useDashboardLanguage();
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
        <h4 className="text-lg font-semibold tracking-tight">{t('关键产物')}</h4>
        <span className="font-mono text-[13px] text-meta">
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
  useDashboardLanguage();
  if (artifacts.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[13px] font-medium uppercase tracking-wider text-muted">{title}</span>
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
  useDashboardLanguage();
  const exists = artifact.exists;
  const notApplicable = artifact.notApplicable;
  const statusLabel = exists ? t(artifact.label) : notApplicable ? t('无需生成') : t('未生成');

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
      <span className="whitespace-nowrap pl-4 text-right text-[13px] text-muted">
        {statusLabel}
      </span>
    </button>
  );
}

function TaskProgress({ change }) {
  useDashboardLanguage();
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
    ? t('已归档完成，流程已结束')
    : isComplete
      ? t('所有任务已完成，可以进入 {0}', [change.phase === 'verify' ? t('归档') : 'Verify'])
      : t('剩余 {0} 项未完成，完成后进入 {1}', [
          animatedRemainingValue,
          change.phase === 'verify' ? t('归档') : 'Verify',
        ]);

  return (
    <article className="min-w-0 rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-lg font-semibold tracking-tight">{t('任务进度')}</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${isComplete ? 'bg-ok-soft text-success' : 'bg-accent-soft text-accent'}`}
        >
          {isComplete ? t('全部完成') : t('{0} 项待办', [animatedRemainingValue])}
        </span>
      </div>

      {/* Donut */}
      <div className="flex justify-center">
        <div className="relative h-[110px] w-[110px]">
          <svg
            className="block size-full -rotate-90"
            viewBox="0 0 120 120"
            role="img"
            aria-label={t('任务完成度 {0}%', [percent])}
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
            <span className="mt-0.5 text-[13px] text-muted">{t('完成度')}</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center justify-center gap-6 text-center">
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedCompleted)}
          </div>
          <div className="mt-1 text-[13px] text-muted">{t('已完成')}</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {animatedRemainingValue}
          </div>
          <div className="mt-1 text-[13px] text-muted">{t('剩余')}</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedDoneSections)}/{totalSections}
          </div>
          <div className="mt-1 text-[13px] text-muted">{t('分组')}</div>
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
                  <span className="truncate text-[13px] text-fg-2">{section.title}</span>
                  <span className="shrink-0 pl-2 font-mono text-[13px] text-muted">
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
      <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${hintTone}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
        <span>{hintText}</span>
      </div>
    </article>
  );
}

function SidePanel({ change, git, onPreview }) {
  useDashboardLanguage();
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
  useDashboardLanguage();
  return (
    <Card title={t('下一步建议')} tag={phaseLabel(change.phase)}>
      <div className="rounded-xl bg-fg px-4 py-3 font-mono text-[13px] text-bg">
        <span className="text-success">$ </span>
        {change.next?.command ?? '—'}
      </div>
      <p className="text-sm text-fg-2">{change.next?.reason ?? t('暂无建议')}</p>
      <p className="text-[13px] leading-relaxed text-muted">{t(change.next?.description ?? '')}</p>
    </Card>
  );
}

function ArchiveSummary({ change }) {
  useDashboardLanguage();
  return (
    <Card title={t('归档摘要')} tag={t('已归档')}>
      <div className="break-words rounded-xl bg-accent-soft px-4 py-3 font-mono text-[13px] text-accent">
        {change.archive?.archiveName ?? change.name}
      </div>
      <p className="break-words text-sm text-fg-2">
        {t('原名：')}
        {change.archive?.originalName ?? change.name}
        {t(' · 归档于：')}
        {change.archive?.archivedAt ?? '—'}
      </p>
      <p className="break-words text-[13px] leading-relaxed text-muted">
        {t('归档路径：')}
        {change.archive?.archivePath ?? change.path}
        {t(' · 任务：')}
        {change.tasks.completed} / {change.tasks.total}
      </p>
    </Card>
  );
}

function RiskCard({ change }) {
  useDashboardLanguage();
  const risks = change.risks ?? [];
  return (
    <Card title={t('风险提示')} tag={t('{0} 项', [risks.length])}>
      {risks.length === 0 ? (
        <div className="rounded-xl bg-surface-warm p-3 text-sm text-muted">
          {t('当前未发现阻塞风险。')}
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
  useDashboardLanguage();
  return (
    <Card
      title={t('Git 快照')}
      tag={git.dirtyFiles === null ? t('Git 状态未知') : t('{0} 个未提交', [git.dirtyFiles])}
    >
      <KeyValue k={t('分支')} v={git.branch ?? '—'} />
      <KeyValue k="HEAD" v={git.head ?? '—'} />
      <div className="pt-2 text-[13px] font-semibold uppercase text-meta">{t('最近提交')}</div>
      <ul className="space-y-1">
        {git.recentCommits.map((commit) => (
          <li key={commit} className="truncate text-sm text-fg-2">
            {commit}
          </li>
        ))}
      </ul>
      <div className="pt-2 text-[13px] font-semibold uppercase text-meta">{t('未提交文件')}</div>
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
  useDashboardLanguage();
  return (
    <article className="rounded-lg bg-bg p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-lg font-semibold">{title}</h4>
        {tag && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs text-fg-2">{tag}</span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </article>
  );
}

function KeyValue({ k, v }) {
  useDashboardLanguage();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 truncate font-mono text-[13px]">{v}</span>
    </div>
  );
}

function ArtifactDrawer({ artifact, embedded = false, onClose }) {
  const dashboardLanguage = useDashboardLanguage();
  const { message: messageApi } = AntApp.useApp();
  const [loadState, setLoadState] = useState({ status: 'idle' });
  const { fullscreen: requestedFullscreen, requestClose } = useDashboardModalState(
    Boolean(artifact),
  );
  const fullscreen = !embedded && requestedFullscreen;
  const [toc, setToc] = useState([]);
  const [activeTocId, setActiveTocId] = useState('');
  const articleRef = useRef(null);
  const contentScrollRef = useRef(null);

  useEffect(() => {
    if (!artifact || embedded) return undefined;
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
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.right = previousBodyStyle.right;
      document.body.style.width = previousBodyStyle.width;
      window.scrollTo(0, scrollY);
    };
  }, [artifact, embedded]);

  useEffect(() => {
    if (!artifact) {
      setLoadState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setLoadState({ status: 'loading' });

    const preview = artifact.preview;
    const previewPath = preview?.path ?? '';
    const isNativeStatePreview = artifact.key === 'comet-state.yaml';
    const isYamlPreview = artifact.key === 'cometYaml' || /\.ya?ml$/i.test(previewPath);
    const isJsonPreview =
      artifact.key === 'handoff' || artifact.key === 'checkpoint' || /\.json$/i.test(previewPath);
    const useStructuredPreview = isYamlPreview || isJsonPreview;

    const content = preview?.exists
      ? useStructuredPreview
        ? preview.content?.trimEnd() || ''
        : `${preview.content?.trimEnd() || t('这个产物是空文件。')}${preview.truncated ? t('\n\n> 内容过长，已截取前 256KB。') : ''}`
      : preview
        ? t('尚未生成 {0}。', [artifact.name])
        : t(
            '这个产物文件存在，但当前 dashboard 服务返回的数据里没有全文内容。请重启 dashboard 服务后再刷新页面。',
          );

    (async () => {
      try {
        let html;
        if (preview?.exists && useStructuredPreview) {
          if (!content.trim()) {
            html = isJsonPreview
              ? await renderJsonPreview('')
              : await renderYamlTable('', {
                  schema: isNativeStatePreview ? 'native-state' : undefined,
                });
          } else {
            html = isJsonPreview
              ? await renderJsonPreview(content)
              : await renderYamlTable(content, {
                  schema: isNativeStatePreview ? 'native-state' : undefined,
                });
            if (preview.truncated) {
              html += t('<p><em>内容过长，已截取前 256KB。</em></p>');
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
          message: err instanceof Error ? err.message : t('产物预览渲染失败，请重试'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifact, dashboardLanguage]);

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
    if (!fullscreen) return;
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
  }, [toc, fullscreen]);

  useEffect(() => {
    if (!artifact) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') requestClose(onClose);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [artifact, fullscreen, onClose, requestClose]);

  if (!artifact) return null;
  const preview = artifact.preview;
  return (
    <div
      className={
        fullscreen
          ? 'dashboard-artifact-preview-overlay is-fullscreen fixed inset-0 z-[90] flex'
          : `dashboard-artifact-preview-overlay ${embedded ? 'absolute' : 'fixed'} inset-0 z-[90] grid grid-cols-[minmax(0,1fr)_minmax(360px,760px)] max-sm:grid-cols-1`
      }
    >
      {!fullscreen && (
        <button
          aria-label={t('产物预览背景')}
          className="dashboard-artifact-preview-backdrop bg-transparent max-sm:hidden"
          onClick={() => requestClose(onClose)}
        />
      )}
      <section
        className={[
          'dashboard-artifact-preview-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg',
          fullscreen
            ? 'is-fullscreen h-full w-full'
            : 'border-l border-border shadow-[-20px_0_44px_rgba(0,0,0,0.12)]',
        ].join(' ')}
      >
        <header className="flex items-start gap-3 border-b border-border-soft p-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-bold">{t(artifact.name)}</h2>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {preview?.path && (
                <button
                  type="button"
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg-2"
                  aria-label={t('复制文件路径')}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(preview.path);
                      messageApi.success(t('路径已复制'));
                    } catch {
                      messageApi.error(t('复制失败'));
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
                {preview?.path ?? t('当前服务未返回全文内容')}
              </p>
            </div>
            {(preview?.size != null || preview?.updatedAt) && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[13px] text-muted">
                {preview?.size != null && <span>{formatFileSize(preview.size)}</span>}
                {preview?.updatedAt && (
                  <span>
                    {t('更新于 ')}
                    {formatTimestamp(preview.updatedAt)}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="dashboard-artifact-preview-close grid size-8 shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-surface"
            onClick={onClose}
            aria-label={t('关闭产物预览')}
            title={t('关闭产物预览')}
          >
            <CloseOutlined aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {fullscreen && toc.length > 0 && (
            <nav
              aria-label={t('文档目录')}
              className="hidden w-[250px] shrink-0 overflow-y-auto border-r border-border-soft bg-surface px-3 py-4 sm:block"
            >
              <p className="mb-2 px-2 text-sm font-semibold uppercase tracking-wider text-muted">
                {t('目录')}
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
              fullscreen ? 'px-12 py-6' : 'p-5',
            ].join(' ')}
          >
            {loadState.status === 'loading' && (
              <DashboardLineSkeleton
                className="dashboard-artifact-loading"
                label={t('正在加载产物文件')}
                rows={8}
                titleWidth="34%"
              />
            )}
            {loadState.status === 'empty' && (
              <p className="py-10 text-center text-sm text-muted" aria-live="polite">
                {t('该产物文件尚未生成')}
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

function ProjectKnowledgePreviewModal({
  open,
  title,
  subtitle,
  description,
  ariaLabel,
  onClose,
  children,
}) {
  useDashboardLanguage();
  return (
    <DashboardModal
      rootClassName="dashboard-settings-modal-root dashboard-knowledge-preview-modal-root"
      className="dashboard-settings-modal dashboard-knowledge-preview-modal"
      width={900}
      open={open}
      ariaLabel={ariaLabel}
      title={title}
      subtitle={subtitle}
      description={description}
      onClose={onClose}
      footer={null}
    >
      {({ fullscreen }) => children({ fullscreen })}
    </DashboardModal>
  );
}

function ContextManifestDetailsModal({
  item,
  items = [],
  open,
  onClose,
  onSelectItem,
  labels = {},
}) {
  useDashboardLanguage();
  const [contentPreview, setContentPreview] = useState({ status: 'idle' });
  const navigationItems = items.length > 0 ? items : item ? [item] : [];
  const detailLabel = labels.detailLabel ?? t('记忆详情');
  const contentLabel = labels.contentLabel ?? t('记忆内容');
  const typeLabel = labels.typeLabel ?? t('记忆类型');
  const deliveryLabel = labels.deliveryLabel ?? t('提供给 Agent 的内容');
  const outcomeLabel = labels.outcomeLabel ?? t('应用结果');
  const navigationLabel = labels.navigationLabel ?? t('本次使用的记忆');

  useEffect(() => {
    if (!item) {
      setContentPreview({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setContentPreview({ status: 'loading' });
    void renderMarkdown(item.summary || '')
      .then((html) => {
        if (cancelled) return;
        setContentPreview(html.trim() ? { status: 'success', html } : { status: 'empty' });
      })
      .catch((error) => {
        if (cancelled) return;
        setContentPreview({
          status: 'error',
          message:
            error instanceof Error ? error.message : t('{0}渲染失败，请重试', [contentLabel]),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  return (
    <ProjectKnowledgePreviewModal
      open={open}
      title={item.title}
      ariaLabel={`${detailLabel}：${item.title}`}
      onClose={onClose}
    >
      {() => (
        <div className="dashboard-knowledge-preview-content">
          {navigationItems.length > 1 && (
            <nav className="dashboard-project-knowledge-detail-nav" aria-label={navigationLabel}>
              <div className="dashboard-project-knowledge-detail-nav-head">
                <strong>{navigationLabel}</strong>
                <span>
                  {navigationItems.length}
                  {t(' 条')}
                </span>
              </div>
              <div className="dashboard-project-knowledge-detail-nav-items">
                {navigationItems.map((candidate) => {
                  const active = candidate.id === item.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      className={active ? 'is-active' : undefined}
                      aria-current={active ? 'true' : undefined}
                      aria-label={t('查看{0}：{1}', [detailLabel, candidate.title])}
                      onClick={() => onSelectItem?.(candidate)}
                    >
                      <strong>{candidate.title}</strong>
                      <span>{contextMemorySourceLabel(candidate.memoryType)}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
          <div className="dashboard-knowledge-preview-scroll">
            <div className="dashboard-project-knowledge-detail">
              <section>
                <h3>{contentLabel}</h3>
                {contentPreview.status === 'loading' && (
                  <DashboardLineSkeleton
                    className="dashboard-project-knowledge-detail-loading"
                    label={t('正在渲染{0}', [contentLabel])}
                    rows={6}
                  />
                )}
                {contentPreview.status === 'empty' && (
                  <p className="dashboard-project-knowledge-detail-state">{t('暂无可展示内容')}</p>
                )}
                {contentPreview.status === 'error' && (
                  <p role="alert" className="dashboard-project-knowledge-detail-state is-error">
                    {contentPreview.message}
                  </p>
                )}
                {contentPreview.status === 'success' && (
                  <article
                    className="md-github dashboard-project-knowledge-detail-content"
                    dangerouslySetInnerHTML={{ __html: contentPreview.html }}
                  />
                )}
              </section>
              <dl>
                <div>
                  <dt>{typeLabel}</dt>
                  <dd>{contextMemorySourceLabel(item.memoryType)}</dd>
                </div>
                <div>
                  <dt>{t('为什么使用')}</dt>
                  <dd>{systemText(item.whyApplied) || t('未记录应用原因')}</dd>
                </div>
                <div>
                  <dt>{deliveryLabel}</dt>
                  <dd>{contextDeliveryLabel(item.lastApplication ?? item)}</dd>
                </div>
                <div>
                  <dt>{outcomeLabel}</dt>
                  <dd>{contextOutcomeLabel(item.outcome ?? item.lastApplication?.outcome)}</dd>
                </div>
                <div>
                  <dt>{t('最近应用')}</dt>
                  <dd>{formatTimestamp(item.lastApplication?.appliedAt ?? item.appliedAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </ProjectKnowledgePreviewModal>
  );
}

function projectKnowledgeSourcePreviewKind(source, format) {
  if (format === 'markdown') return 'markdown';
  if (/\.json$/i.test(source ?? '')) return 'json';
  if (/\.ya?ml$/i.test(source ?? '')) return 'yaml';
  if (/\.mdx?$/i.test(source ?? '')) return 'markdown';
  return 'text';
}

function projectKnowledgeCorpusKindLabel(kind) {
  return (
    {
      'native-spec': 'Native Spec',
      'classic-spec': 'Classic Spec',
      'native-archive': t('Native 归档'),
      'classic-archive': t('Classic 归档'),
      superpowers: t('归档引用'),
      custom: t('自定义 Markdown'),
    }[kind] ?? 'Markdown'
  );
}

async function renderProjectKnowledgeSource(content, kind) {
  const raw = String(content ?? '');
  if (!raw.trim()) return '';
  if (kind === 'json') return renderJsonPreview(raw);
  if (kind === 'yaml') return renderYamlTable(raw);
  if (kind === 'text') {
    return renderMarkdown(['```text', raw.replace(/\n$/, ''), '```'].join('\n'));
  }
  return renderMarkdown(raw);
}

function ProjectKnowledgeSourcePreviewModal({
  selectedSource,
  sourceContent,
  sourceReadPending,
  sourceReadError,
  onClose,
  onSelectRecord,
}) {
  useDashboardLanguage();
  const [loadState, setLoadState] = useState({ status: 'idle' });
  const [toc, setToc] = useState([]);
  const [activeTocId, setActiveTocId] = useState('');
  const articleRef = useRef(null);
  const contentScrollRef = useRef(null);
  const sourcePath = selectedSource?.source ?? '';
  const previewKind = projectKnowledgeSourcePreviewKind(sourcePath, sourceContent?.format);

  useEffect(() => {
    if (!selectedSource || sourceReadPending || sourceReadError || !sourceContent) {
      setLoadState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const raw = String(sourceContent.content ?? '');
    if (!raw.trim()) {
      setLoadState({ status: 'empty' });
      return;
    }
    setLoadState({ status: 'loading' });
    void renderProjectKnowledgeSource(raw, previewKind)
      .then((html) => {
        if (cancelled) return;
        if (!html.trim()) {
          setLoadState({ status: 'empty' });
          return;
        }
        setLoadState({
          status: 'success',
          html: sourceContent.truncated
            ? t('{0}<p><em>内容过长，已截取前 256KB。</em></p>', [html])
            : html,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : t('来源文件预览渲染失败，请重试'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [previewKind, selectedSource, sourceContent, sourceReadError, sourceReadPending]);

  useEffect(() => {
    if (loadState.status === 'success' && articleRef.current) {
      runMermaid(articleRef.current);
      const items = extractToc(articleRef.current);
      setToc(items);
      setActiveTocId(items[0]?.id ?? '');
    } else {
      setToc([]);
      setActiveTocId('');
    }
  }, [loadState]);

  useEffect(() => {
    const scrollEl = contentScrollRef.current;
    const article = articleRef.current;
    if (!scrollEl || !article || toc.length === 0) return undefined;
    const onScroll = () => {
      const headings = toc.map(({ id }) => document.getElementById(id)).filter(Boolean);
      let current = headings[0]?.id ?? '';
      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        if (rect.top - containerRect.top <= 80) current = heading.id;
      }
      setActiveTocId(current);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [toc]);

  if (!selectedSource) return null;
  const updatedAt = sourceContent?.modifiedAt ?? selectedSource.latestUpdatedAt;
  const relatedKnowledgeGroups = Array.from(
    selectedSource.records.reduce((groups, record) => {
      const key = projectKnowledgeRecordLogicalId(record);
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
      return groups;
    }, new Map()),
  ).map(([logicalId, records]) => ({
    logicalId,
    records: records.toSorted(
      (left, right) =>
        Number(right.state !== 'superseded') - Number(left.state !== 'superseded') ||
        new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime(),
    ),
  }));

  return (
    <ProjectKnowledgePreviewModal
      open
      title={t('检索语料详情')}
      description={t('查看实际参与项目知识召回的 Markdown 内容和关联知识')}
      ariaLabel={t('检索语料详情')}
      onClose={onClose}
    >
      {({ fullscreen }) => (
        <div className="dashboard-knowledge-preview-content">
          {fullscreen && toc.length > 0 && (
            <nav aria-label={t('文档目录')} className="dashboard-knowledge-preview-toc">
              <p>{t('目录')}</p>
              <ul>
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
                      className={activeTocId === item.id ? 'is-active' : ''}
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
            className={`dashboard-knowledge-preview-scroll${fullscreen ? ' is-fullscreen' : ''}`}
          >
            <div className="dashboard-knowledge-source-detail">
              <header>
                <code>{selectedSource.source}</code>
                <span>{selectedSource.kind ?? t('项目知识来源')}</span>
              </header>
              <dl>
                <div>
                  <dt>{t('关联记录')}</dt>
                  <dd>
                    {relatedKnowledgeGroups.length > 0
                      ? t('{0} 条知识 · {1} 个版本', [
                          relatedKnowledgeGroups.length,
                          selectedSource.records.length,
                        ])
                      : t('暂无已学习记录')}
                  </dd>
                </div>
                <div>
                  <dt>{t('最近更新')}</dt>
                  <dd>{updatedAt ? formatTimestamp(updatedAt) : '—'}</dd>
                </div>
              </dl>
              {relatedKnowledgeGroups.length > 0 && (
                <section>
                  <h4>{t('关联项目知识')}</h4>
                  <div className="dashboard-knowledge-source-related">
                    {relatedKnowledgeGroups.map((group) => {
                      const current =
                        group.records.find((record) => record.state !== 'superseded') ??
                        group.records[0];
                      return (
                        <article key={group.logicalId}>
                          <button type="button" onClick={() => onSelectRecord(current)}>
                            <strong>{current.title}</strong>
                            <span>
                              {projectKnowledgeTypeLabel(current.type)} ·{' '}
                              {projectKnowledgeStateLabel(current.state)} ·{' '}
                              {projectKnowledgeRecordVersionLabel(current, group.records)}
                            </span>
                          </button>
                          <div className="dashboard-knowledge-source-related-versions">
                            {group.records.map((record) => {
                              const references = projectKnowledgeRecordSourceReferences(
                                record,
                                selectedSource.source,
                              );
                              return (
                                <div key={record.id}>
                                  <div>
                                    <strong>
                                      {projectKnowledgeRecordVersionLabel(record, group.records)}
                                    </strong>
                                    <span>
                                      {projectKnowledgeStateLabel(record.state)} ·{' '}
                                      {formatTimestamp(record.updatedAt)}
                                    </span>
                                  </div>
                                  <p>{knowledgeText(record, record.summary)}</p>
                                  {record.conclusions?.map((conclusion, index) => (
                                    <p key={`${record.id}-conclusion-${index}`}>
                                      {t('结论：')}
                                      {knowledgeText(record, conclusion.text)}
                                    </p>
                                  ))}
                                  {record.relations?.length > 0 && (
                                    <p>
                                      {t('关系：')}
                                      {record.relations
                                        .map(
                                          (relation) => `${relation.type} → ${relation.targetId}`,
                                        )
                                        .join('、')}
                                    </p>
                                  )}
                                  {references.length > 0 && (
                                    <ul>
                                      {references.map((reference, index) => (
                                        <li key={`${record.id}-reference-${index}`}>
                                          <code>
                                            {reference.source}
                                            {reference.anchor ? `#${reference.anchor}` : ''}
                                            {reference.lineStart
                                              ? `#L${reference.lineStart}${reference.lineEnd ? `-L${reference.lineEnd}` : ''}`
                                              : ''}
                                          </code>
                                          <span>{reference.role}</span>
                                          {reference.evidence && <em>{reference.evidence}</em>}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {record.sourceVersions?.length > 0 && (
                                    <small>
                                      {t('版本依据：')}
                                      {record.sourceVersions
                                        .filter(
                                          (version) => version.source === selectedSource.source,
                                        )
                                        .map((version) =>
                                          t('{0} · {1} · 内容摘要 {2}', [
                                            formatFileSize(version.size) ?? t('未知大小'),
                                            formatTimestamp(
                                              new Date(version.modifiedAt).toISOString(),
                                            ),
                                            version.digest?.slice(0, 12) ?? t('旧记录未保存'),
                                          ]),
                                        )
                                        .join('、') || t('未记录')}
                                    </small>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {relatedKnowledgeGroups.length === 0 && (
                <p className="dashboard-knowledge-inspector-muted">
                  {t('这个文件目前只是可检索来源，还没有形成可用的项目知识记录。')}
                </p>
              )}
              <section>
                <h4>{t('文件原文')}</h4>
                {sourceReadPending ? (
                  <DashboardLineSkeleton
                    className="dashboard-knowledge-source-loading"
                    label={t('正在读取来源文件')}
                    rows={6}
                  />
                ) : sourceReadError ? (
                  <Alert type="warning" showIcon message={t(sourceReadError)} />
                ) : loadState.status === 'loading' ? (
                  <DashboardLineSkeleton
                    className="dashboard-knowledge-source-loading"
                    label={t('正在渲染来源文件')}
                    rows={6}
                  />
                ) : loadState.status === 'error' ? (
                  <p role="alert" className="text-danger">
                    {loadState.message}
                  </p>
                ) : loadState.status === 'empty' ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('来源文件为空')} />
                ) : loadState.status === 'success' ? (
                  <article
                    ref={articleRef}
                    className="md-github dashboard-knowledge-source-rendered-content"
                    dangerouslySetInnerHTML={{ __html: loadState.html }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('尚未读取来源文件')} />
                )}
                {sourceContent && (
                  <div className="dashboard-knowledge-source-detail-meta">
                    <span>{formatFileSize(sourceContent.size)}</span>
                    <span>{formatTimestamp(sourceContent.modifiedAt)}</span>
                    {sourceContent.truncated && <span>{t('内容已截断')}</span>}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </ProjectKnowledgePreviewModal>
  );
}

function Pill({ tone = 'neutral', children }) {
  useDashboardLanguage();
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
  useDashboardLanguage();
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-warn/30 bg-warn-soft p-4 shadow-card"
    >
      <h3 className="font-semibold text-warn">{t('Classic 数据部分读取失败')}</h3>
      <p className="mt-1 break-words text-sm text-fg-2">
        {t('已展示可读取的变更；请检查其余 Classic 产物目录后刷新。')}
        {error.message}
      </p>
    </div>
  );
}

function ClassicErrorState({ error }) {
  useDashboardLanguage();
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-6 shadow-card">
      <h3 className="font-semibold text-danger">{t('Classic 数据读取失败')}</h3>
      <p className="mt-2 break-words text-sm text-fg-2">{error.message}</p>
      <p className="mt-3 text-sm text-muted">
        {t('请检查 .comet/config.yaml 与 Classic 产物目录，然后刷新 Dashboard。')}
      </p>
    </div>
  );
}

function ClassicWorkspaceEmptyDetail({ snapshot, tab, onTab }) {
  useDashboardLanguage();
  const hasClassicChanges = snapshot.summary.activeChanges + snapshot.summary.archivedChanges > 0;
  const hasArchivedChanges = snapshot.summary.archivedChanges > 0;
  const hasActiveChanges = snapshot.summary.activeChanges > 0;
  const showArchiveShortcut = tab === 'active' && hasArchivedChanges;
  const showActiveShortcut = tab === 'archived' && hasActiveChanges;
  const title = !hasClassicChanges
    ? t('当前没有 Classic change')
    : showArchiveShortcut
      ? t('当前没有活跃的 Classic change')
      : showActiveShortcut
        ? t('还没有已归档的 Classic change')
        : t('当前范围没有可展示的 Classic change');
  const description = !hasClassicChanges
    ? t('Classic 变更出现后会在这里展示。')
    : showArchiveShortcut
      ? t('当前工作区没有进行中的变更，你可以继续查看已归档的历史记录。')
      : showActiveShortcut
        ? t('当前还没有归档记录，你可以返回查看正在进行的变更。')
        : t('调整顶部搜索条件，或切换变更范围后再试。');
  return (
    <AntCard
      className="change-detail classic-change-detail-empty min-w-0"
      title={<h3 className="m-0 text-lg font-semibold">{title}</h3>}
    >
      <div className="dashboard-workspace-empty-detail text-center">
        <WorkflowEmptyIllustration />
        <p>{description}</p>
        {showArchiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab('archived')}>
            {t('查看已归档变更')}
          </Button>
        ) : showActiveShortcut ? (
          <Button className="mt-5" type="primary" onClick={() => onTab('active')}>
            {t('查看活跃变更')}
          </Button>
        ) : null}
      </div>
    </AntCard>
  );
}

function ClassicWorkspaceEmptySidePanel() {
  useDashboardLanguage();
  return (
    <aside className="dashboard-workspace-side-empty" aria-label={t('Classic 变更状态')}>
      <div>
        <WorkflowEmptyIllustration compact />
        <h3>{t('暂无变更数据')}</h3>
        <p>{t('选择或创建 Classic change 后，这里会显示执行状态、验证结果和 Git 摘要。')}</p>
      </div>
    </aside>
  );
}

function ClassicWorkspaceLoadingDetail() {
  useDashboardLanguage();
  return (
    <section
      className="change-detail classic-change-detail-skeleton min-w-0 rounded-lg border border-border bg-bg shadow-raised"
      aria-label={t('正在加载 Classic 变更详情')}
      aria-busy="true"
    >
      <div className="border-b border-border-soft px-5 py-5">
        <DashboardLineSkeleton label={t('正在加载 Classic 变更标题')} rows={2} titleWidth="38%" />
      </div>
      <div className="space-y-6 p-5">
        <DashboardLineSkeleton label={t('正在加载 Classic 变更内容')} rows={7} titleWidth="24%" />
      </div>
    </section>
  );
}

function ClassicWorkspaceLoadingSidePanel() {
  useDashboardLanguage();
  return (
    <aside
      className="classic-side-panel-skeleton space-y-5"
      aria-label={t('正在加载 Classic 变更状态')}
      aria-busy="true"
    >
      {[3, 2, 3].map((rows, index) => (
        <section key={index} className="rounded-lg bg-bg p-5 shadow-raised">
          <DashboardLineSkeleton
            label={t('正在加载 Classic 侧栏第 {0} 组', [index + 1])}
            rows={rows}
            titleWidth="42%"
          />
        </section>
      ))}
    </aside>
  );
}

function DashboardLineSkeleton({ className = '', label, rows = 4, titleWidth = null }) {
  useDashboardLanguage();
  const widths = ['52%', '78%', '66%', '92%', '72%', '58%', '84%', '64%'].slice(0, rows);
  return (
    <div
      className={`dashboard-line-skeleton ${className}`.trim()}
      aria-label={label}
      aria-busy="true"
    >
      <Skeleton
        active
        title={titleWidth ? { width: titleWidth } : false}
        paragraph={{ rows, width: widths }}
      />
    </div>
  );
}

function LoadingState() {
  useDashboardLanguage();
  return (
    <div className="dashboard-loading-state mx-auto max-w-dashboard rounded-lg bg-bg p-8 shadow-raised">
      <DashboardLineSkeleton label={t('正在加载 Dashboard')} rows={6} titleWidth="28%" />
    </div>
  );
}

function projectKnowledgeCountsFromRecords(records) {
  return {
    active: records.filter((record) => record?.state !== 'superseded').length,
    trial: records.filter((record) => record?.state === 'trial').length,
    proven: records.filter((record) => record?.state === 'proven').length,
    enforced: records.filter((record) => record?.state === 'enforced').length,
    superseded: records.filter((record) => record?.state === 'superseded').length,
    total: records.length,
    displayed: records.length,
  };
}

function reconcileProjectKnowledgeCounts(previous, beforeRecords, nextRecords, changedRecords) {
  if (
    !isDashboardRecord(previous) ||
    !['active', 'trial', 'proven', 'enforced', 'superseded', 'total'].every(
      (key) => typeof previous[key] === 'number',
    )
  ) {
    return projectKnowledgeCountsFromRecords(nextRecords);
  }
  const next = { ...previous, displayed: nextRecords.length };
  const beforeById = new Map(beforeRecords.map((record) => [record?.id, record]));
  for (const changed of changedRecords) {
    const before = beforeById.get(changed?.id);
    if (before?.state === changed?.state) continue;
    if (before === undefined) next.total += 1;
    if (before?.state) {
      next[before.state] = Math.max(0, next[before.state] - 1);
      if (before.state !== 'superseded') next.active = Math.max(0, next.active - 1);
    }
    if (changed?.state) {
      next[changed.state] += 1;
      if (changed.state !== 'superseded') next.active += 1;
    }
  }
  return next;
}

function reconcilePluginInvocationResult(page, pluginId, capability, result, input) {
  if (
    pluginId === 'comet.personal-memory' &&
    capability === 'remove' &&
    page?.pluginId === pluginId &&
    isDashboardRecord(page.data) &&
    isDashboardRecord(input) &&
    typeof input.id === 'string' &&
    Array.isArray(page.data.manifestPreview)
  ) {
    return {
      ...page,
      data: {
        ...page.data,
        manifestPreview: page.data.manifestPreview.filter((item) => item?.id !== input.id),
      },
    };
  }
  if (pluginId === 'comet.project-knowledge' && page?.pluginId === pluginId) {
    if (
      capability === 'query' &&
      isDashboardRecord(page.data) &&
      isDashboardRecord(result) &&
      result.kind === 'search'
    ) {
      return {
        ...page,
        data: {
          ...page.data,
          queryPreview: {
            ...result,
            task: isDashboardRecord(input) && typeof input.task === 'string' ? input.task : '',
          },
        },
      };
    }
    if (
      (capability === 'create' || capability === 'correct' || capability === 'forget') &&
      isDashboardRecord(page.data) &&
      isDashboardRecord(result) &&
      isDashboardRecord(result.record) &&
      typeof result.record.id === 'string'
    ) {
      const records = Array.isArray(page.data.records) ? page.data.records : [];
      const recordIndex = records.findIndex((record) => record?.id === result.record.id);
      const nextRecords =
        recordIndex === -1
          ? [result.record, ...records]
          : records.map((record, index) => (index === recordIndex ? result.record : record));
      return {
        ...page,
        data: {
          ...page.data,
          records: nextRecords,
          counts: reconcileProjectKnowledgeCounts(page.data.counts, records, nextRecords, [
            result.record,
          ]),
        },
      };
    }
    if (
      capability === 'refresh' &&
      isDashboardRecord(page.data) &&
      isDashboardRecord(result) &&
      Array.isArray(result.records)
    ) {
      const refreshedRecords = result.records.filter(
        (record) => isDashboardRecord(record) && typeof record.id === 'string',
      );
      const refreshedById = new Map(refreshedRecords.map((record) => [record.id, record]));
      const records = Array.isArray(page.data.records) ? page.data.records : [];
      const knownIds = new Set(records.map((record) => record?.id));
      const nextRecords = [
        ...records.map((record) => refreshedById.get(record?.id) ?? record),
        ...refreshedRecords.filter((record) => !knownIds.has(record.id)),
      ];
      return {
        ...page,
        data: {
          ...page.data,
          records: nextRecords,
          counts: reconcileProjectKnowledgeCounts(
            page.data.counts,
            records,
            nextRecords,
            refreshedRecords,
          ),
        },
      };
    }
  }
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

async function fetchDashboardPluginPage(projectId, pluginId, signal) {
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}`,
    { cache: 'no-store', signal },
  );
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function fetchDashboardProjectConfig(projectId, signal) {
  const res = await fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/config`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw await dashboardResponseError(res);
  return res.json();
}

async function saveDashboardProjectConfig(projectId, input) {
  const res = await fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
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
  const params = new URLSearchParams({ status, limit: String(options.summaryLimit ?? 5) });
  const endpoint = options.summaryLimit ? 'change-summary' : 'changes';
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.query?.trim()) params.set('q', options.query.trim());
  const res = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/${endpoint}?${params.toString()}`,
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
  return localizedDemo(withDemoArtifactPreviews(module.DEMO_SNAPSHOT));
}

async function loadDemoPluginPages() {
  const module = await import('../demo.js');
  return localizedDemo(module.DEMO_PLUGIN_PAGES);
}

async function loadDemoProjectConfig() {
  const module = await import('../demo.js');
  return localizedDemo(structuredClone(module.DEMO_PROJECT_CONFIG));
}

function withDemoArtifactPreviews(snapshot) {
  const hydrateChange = (change) => {
    const grouped = change.artifacts?.grouped ?? [];
    const previews = grouped.map((artifact) => {
      const content = artifact.exists
        ? (artifact.content ??
          t('# {0}\n\n{1}：{2}\n\n- 当前阶段：{3}\n- 任务进度：{4}/{5}\n- Verify：{6}\n', [
            artifact.label,
            artifact.label,
            change.displayName,
            phaseLabel(change.phase),
            change.tasks.completed,
            change.tasks.total,
            VERIFY_LABEL[change.verify.result] ?? t('未知'),
          ]))
        : undefined;
      return {
        key: artifact.key,
        label: artifact.label,
        path: artifact.path,
        exists: artifact.exists,
        size: artifact.exists ? (artifact.size ?? content?.length) : undefined,
        updatedAt: artifact.exists ? (artifact.updatedAt ?? '2026-08-29T12:30:00.000Z') : undefined,
        content,
      };
    });
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
  return PHASES.find(([key]) => key === phase)?.[1] ?? phase ?? t('未知');
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

function projectKnowledgeRecordSourceReferences(record, sourcePath) {
  return [
    ...(record.conclusions ?? []).flatMap((conclusion) =>
      (conclusion.sources ?? []).map((source) => ({ ...source, role: t('结论') })),
    ),
    ...(record.relations ?? []).flatMap((relation) =>
      (relation.sources ?? []).map((source) => ({
        ...source,
        role: t('关系：{0} → {1}', [relation.type, relation.targetId]),
      })),
    ),
  ].filter((source) => projectKnowledgeSourcePath(source.source) === sourcePath);
}

function projectKnowledgeRecordLogicalId(record) {
  const versionMarker = record.id.lastIndexOf('-v-');
  return versionMarker > 0 ? record.id.slice(0, versionMarker) : record.id;
}

function projectKnowledgeRecordVersionLabel(record, records) {
  const active = record.state !== 'superseded';
  const versions = records.filter(
    (candidate) =>
      projectKnowledgeRecordLogicalId(candidate) === projectKnowledgeRecordLogicalId(record),
  );
  return active ? t('当前版本') : t('历史版本 {0}', [versions.indexOf(record) + 1]);
}

function projectKnowledgeSourcePath(source) {
  const anchorStart = source.indexOf('#');
  return anchorStart === -1 ? source : source.slice(0, anchorStart);
}

function formatFileSize(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isUserProfileRecord(record) {
  return record.memoryType === 'core-profile';
}

function isActiveMemoryRecord(record) {
  const state = record.status ?? record.state;
  return state === 'trial' || state === 'proven';
}

function personalMemoryStateLabel(record) {
  const state = record.status ?? record.state;
  if (state === 'trial') return t('试用中');
  if (state === 'proven') return t('已验证');
  if (state === 'conflict') return t('存在冲突');
  if (state === 'tombstoned') return t('已忘记');
  return t('已替代');
}

function personalMemoryTypeLabel(record) {
  if (record.memoryType === 'core-profile') return t('个人偏好与事实');
  if (record.memoryType === 'collaboration-policy') return t('协作约定');
  return t('任务经验');
}

function personalMemoryOriginLabel(record) {
  return record.authority === 'explicit' ||
    record.kind === 'explicit' ||
    record.memoryType === 'core-profile'
    ? t('用户确认')
    : t('经验推断');
}

function projectKnowledgeOriginLabel(record) {
  if (record.authority === 'user') return t('用户确认');
  if (record.authority === 'repository') return t('仓库生成');
  return t('自动整理');
}

function memoryApplicationReason(record) {
  return systemText(record.lastApplication?.whyApplied) ?? t('尚未应用');
}

function contextMemorySourceLabel(memoryType) {
  if (memoryType === 'core-profile') return t('个人偏好与事实');
  if (memoryType === 'collaboration-policy') return t('协作约定');
  if (memoryType === 'personal-episode') return t('任务经验');
  if (memoryType === 'project-model') return t('项目概况');
  if (memoryType === 'project-policy') return t('项目规范');
  return t('相关记忆');
}

function formatContextManifestPreview(value) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|\n?```$/g, ''))
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\|/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextDeliveryLabel(application) {
  if (!application) return t('尚未应用');
  return application.delivery === 'full' ? t('完整内容') : t('摘要提示');
}

function contextOutcomeLabel(outcome) {
  if (!outcome) return t('尚未反馈结果');
  if (outcome === 'used-successfully') return t('应用成功');
  if (outcome === 'ignored') return t('未使用');
  if (outcome === 'overridden') return t('已被覆盖');
  if (outcome === 'corrected') return t('已纠正');
  return t('导致失败');
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
  if (!copied) throw new Error(t('当前浏览器不支持复制'));
}

const dashboardRoot = document.getElementById('root');
const embeddedDashboardBuild = globalThis.__COMET_DASHBOARD_EMBED__ === true;
if (dashboardRoot && !embeddedDashboardBuild) createRoot(dashboardRoot).render(<App />);
function AntSidebar({
  embedded = false,
  update,
  onUpdateSelect,
  open,
  collapsed,
  workflow,
  evalSelected = false,
  contextUsageSelected = false,
  onContextUsageSelect,
  onEvalSelect,
  workflowSource,
  onWorkflow,
  pluginPages,
  pluginSelection,
  settingsOpen,
  onSettings,
  onPluginSelect,
  onCollapse,
  onExpand,
  onClose,
}) {
  useDashboardLanguage();
  const navigation = (
    <>
      <div className="dashboard-sidebar-group">
        <div
          className="dashboard-sidebar-label"
          aria-label={workflowSource ? t('项目默认工作流来源：{0}', [workflowSource]) : undefined}
        >
          <span>{t('工作流')}</span>
          {workflowSource ? (
            <Tag color={workflowSource === 'configured' ? 'success' : 'warning'}>
              {workflowSource === 'configured' ? t('已配置') : t('默认')}
            </Tag>
          ) : null}
        </div>
        <Menu
          className="dashboard-sidebar-menu dashboard-workflow-menu"
          mode="inline"
          inlineCollapsed={collapsed}
          inlineIndent={12}
          selectedKeys={
            evalSelected || contextUsageSelected || pluginSelection || !workflow ? [] : [workflow]
          }
          items={[
            { key: 'classic', icon: <BranchesOutlined />, label: t('Classic 工作流') },
            { key: 'native', icon: <FileTextOutlined />, label: t('Native 工作流') },
            { key: 'application', icon: <DeploymentUnitOutlined />, label: t('自定义工作流') },
          ]}
          onClick={({ key }) => {
            onPluginSelect(null);
            onWorkflow(key);
            onClose();
          }}
        />
      </div>
      <div className="dashboard-sidebar-group">
        <div className="dashboard-sidebar-label">{t('创作与分发')}</div>
        <Menu
          className="dashboard-sidebar-menu"
          mode="inline"
          inlineCollapsed={collapsed}
          inlineIndent={12}
          selectedKeys={
            !evalSelected && !contextUsageSelected && !pluginSelection && workflow === 'any'
              ? ['any']
              : []
          }
          items={[{ key: 'any', icon: <AppstoreOutlined />, label: 'Comet Any' }]}
          onClick={() => {
            onPluginSelect(null);
            onWorkflow('any');
            onClose();
          }}
        />
      </div>
      <div className="dashboard-sidebar-group">
        <div className="dashboard-sidebar-label">{t('评估')}</div>
        <Menu
          className="dashboard-sidebar-menu"
          mode="inline"
          inlineCollapsed={collapsed}
          inlineIndent={12}
          selectedKeys={evalSelected ? ['eval'] : []}
          items={[{ key: 'eval', icon: <FlagOutlined />, label: t('评估 Eval') }]}
          onClick={() => {
            onEvalSelect?.();
            onClose();
          }}
        />
      </div>
      <div className="dashboard-sidebar-group">
        <div className="dashboard-sidebar-label">{t('插件中心')}</div>
        <Menu
          className="dashboard-sidebar-menu dashboard-plugin-menu"
          mode="inline"
          inlineCollapsed={collapsed}
          inlineIndent={12}
          selectedKeys={
            contextUsageSelected ? ['context-usage'] : pluginSelection ? [pluginSelection] : []
          }
          items={[
            ...pluginPages.map((page) => {
              const statusLabel = page.globallyDisabled
                ? t('停用')
                : page.projectPaused
                  ? t('暂停')
                  : page.status === 'disabled'
                    ? t('停用')
                    : null;
              return {
                key: page.pluginId,
                disabled: Boolean(page.pending),
                icon:
                  page.pluginId === 'comet.personal-memory' ? (
                    <BulbOutlined />
                  ) : page.pluginId === 'comet.project-knowledge' ? (
                    <DatabaseOutlined />
                  ) : (
                    <SafetyCertificateOutlined />
                  ),
                label: (
                  <span
                    className={`dashboard-plugin-menu-item${page.pending ? ' is-loading' : ''}`}
                  >
                    <span>{t(page.label)}</span>
                    {statusLabel ? <Badge status="default" text={statusLabel} /> : null}
                  </span>
                ),
              };
            }),
            { key: 'context-usage', icon: <BarChartOutlined />, label: t('可观测') },
          ]}
          onClick={({ key }) => {
            if (key === 'context-usage') onContextUsageSelect();
            else onPluginSelect(key);
            onClose();
          }}
        />
      </div>
    </>
  );
  const settingsButton = (
    <button
      type="button"
      className={`dashboard-sidebar-settings${settingsOpen ? ' is-active' : ''}`}
      aria-pressed={settingsOpen}
      aria-label={t('设置')}
      title={t('设置')}
      onClick={() => {
        onSettings();
        onClose();
      }}
    >
      <SettingOutlined aria-hidden="true" />
      <span className="dashboard-sidebar-settings-label">{t('设置')}</span>
    </button>
  );
  return (
    <>
      <Layout.Sider
        className="dashboard-sidebar !hidden !bg-bg lg:!block"
        width={228}
        collapsed={collapsed}
        collapsedWidth={64}
        collapsible
        trigger={null}
        theme="light"
      >
        <div className="dashboard-sidebar-content flex h-full flex-col">
          <div className="dashboard-sidebar-brand flex items-center gap-2">
            <img
              src={embedded ? '/assets/dashboard-website-demo/favicon.png' : '/favicon.png'}
              alt="Comet"
              className="size-7 rounded-[7px]"
            />
            <div className="dashboard-sidebar-brand-copy" aria-hidden={collapsed}>
              <strong>Comet Dashboard</strong>
              <div className="text-xs text-meta">{t('Agent 工作台')}</div>
            </div>
            <Tooltip title={collapsed ? t('展开侧边栏') : t('收起侧边栏')} placement="right">
              <Button
                className="dashboard-sidebar-collapse"
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={collapsed ? onExpand : onCollapse}
                aria-label={collapsed ? t('展开侧边栏') : t('收起侧边栏')}
                aria-expanded={!collapsed}
              />
            </Tooltip>
          </div>
          <div className="dashboard-sidebar-navigation">{navigation}</div>
          <div className="dashboard-sidebar-footer">
            <div
              className="dashboard-sidebar-label dashboard-sidebar-footer-label dashboard-system-heading"
              aria-hidden={collapsed}
            >
              <span>{t('系统')}</span>
              {!embedded && update && <DashboardVersion update={update} onClick={onUpdateSelect} />}
            </div>
            {settingsButton}
          </div>
        </div>
      </Layout.Sider>
      <Drawer title={t('Comet 工作台')} placement="left" open={open} onClose={onClose} size={280}>
        <div className="dashboard-mobile-navigation">
          {navigation}
          <div className="dashboard-mobile-settings">
            <div className="dashboard-sidebar-label dashboard-system-heading">
              <span>{t('系统')}</span>
              {!embedded && update && (
                <DashboardVersion
                  update={update}
                  onClick={() => {
                    onUpdateSelect();
                    onClose();
                  }}
                />
              )}
            </div>
            {settingsButton}
          </div>
        </div>
      </Drawer>
    </>
  );
}

function PluginWorkspaceSkeleton() {
  useDashboardLanguage();
  return (
    <div className="dashboard-plugin-skeleton" aria-busy="true">
      <div className="dashboard-plugin-skeleton-toolbar">
        <Skeleton.Input active size="small" />
      </div>
      <div className="dashboard-plugin-skeleton-summary">
        <Skeleton.Input active size="small" />
      </div>
      <div className="dashboard-plugin-skeleton-panes">
        {[3, 7, 5].map((rows, index) => (
          <div key={index}>
            <DashboardLineSkeleton label={t('正在加载 Dashboard')} rows={rows} titleWidth="40%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextUsageCenter({
  projectId,
  demo,
  demoPages,
  refreshToken,
  loadPage,
  readCachedPage,
  coordinator,
}) {
  useDashboardLanguage();
  const [timeSelection, setTimeSelection] = useDashboardViewState(
    `${demo ? 'demo' : projectId}:context-usage`,
    'timeRange',
    { preset: '7d' },
  );
  const timeRange = useMemo(
    () => resolveObservabilityRange(timeSelection),
    [timeSelection, refreshToken],
  );
  const rangeLabel = observabilityRangeLabel(timeSelection);
  const [selectedSource, setSelectedSource] = useDashboardViewState(
    `${demo ? 'demo' : projectId}:context-usage`,
    'source',
    'runtime-performance',
  );
  const [sections, setSections] = useState({});
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (demo) {
      setSections(Object.fromEntries(demoPages.map((page) => [page.pluginId, { page }])));
      return undefined;
    }
    let cancelled = false;
    const owner = `context-usage:${projectId}`;
    const pluginIds = DASHBOARD_PLUGIN_NAV_PLACEHOLDERS.map((page) => page.pluginId);
    setSections(
      Object.fromEntries(
        pluginIds.map((pluginId) => [
          pluginId,
          { page: readCachedPage(projectId, pluginId), loading: true },
        ]),
      ),
    );
    void Promise.allSettled(
      pluginIds.map(async (pluginId) => {
        try {
          const page = await loadPage(projectId, pluginId, true, owner);
          if (!cancelled) setSections((previous) => ({ ...previous, [pluginId]: { page } }));
        } catch (error) {
          if (!cancelled)
            setSections((previous) => ({
              ...previous,
              [pluginId]: { page: previous[pluginId]?.page, error: error.message },
            }));
        }
      }),
    );
    return () => {
      cancelled = true;
      for (const pluginId of pluginIds) coordinator.release(`${projectId}:${pluginId}`, owner);
    };
  }, [projectId, demo, demoPages, refreshToken, retryToken, loadPage, readCachedPage, coordinator]);
  const usageSnapshot = sections[selectedSource]?.page?.data?.contextUsage;
  return (
    <div className="dashboard-context-usage-page min-w-0" aria-label={t('可观测')}>
      <header className="dashboard-context-usage-page-heading">
        <div>
          <h2>{t('可观测')}</h2>
        </div>
        <ObservabilityTimeFilter value={timeSelection} onChange={setTimeSelection} />
      </header>
      <Tabs
        className="usage-source-tabs"
        activeKey={selectedSource}
        onChange={setSelectedSource}
        tabBarExtraContent={
          <div className="dashboard-context-usage-heading">
            {usageSnapshot?.demo && <Tag>{t('演示数据')}</Tag>}
            {usageSnapshot?.available && usageSnapshot.truncated && (
              <Tag color="warning">{t('记录已截断')}</Tag>
            )}
          </div>
        }
        items={[
          { key: 'runtime-performance', label: t('运行性能') },
          { key: 'change-trace', label: t('Change 链路') },
          ...DASHBOARD_PLUGIN_NAV_PLACEHOLDERS.map(({ pluginId, label }) => ({
            key: pluginId,
            label: t(label),
          })),
        ]}
        aria-label={t('统计来源')}
      />
      <div className="dashboard-context-usage-grid">
        {selectedSource === 'change-trace' && (
          <ChangeTracePanel
            key={projectId ?? 'demo'}
            projectId={projectId}
            demo={demo}
            refreshToken={refreshToken}
            timeRange={timeRange}
          />
        )}
        {selectedSource === 'runtime-performance' && (
          <RuntimePerformancePanel
            key={projectId ?? 'demo'}
            projectId={projectId}
            demo={demo}
            refreshToken={refreshToken}
            timeRange={timeRange}
            rangeLabel={rangeLabel}
            timeSelection={timeSelection}
          />
        )}
        {DASHBOARD_PLUGIN_NAV_PLACEHOLDERS.map(({ pluginId, label }) => {
          if (pluginId !== selectedSource) return null;
          const section = sections[pluginId];
          const page = section?.page;
          return (
            <div className="dashboard-context-usage-column" key={pluginId}>
              {section?.error && (
                <Alert
                  className="mb-3"
                  type="warning"
                  showIcon
                  message={`${t(label)} · ${t(page ? '最新数据同步失败，当前显示缓存' : '插件页面加载失败')}`}
                  description={t(section.error)}
                  action={
                    <Button onClick={() => setRetryToken((value) => value + 1)}>{t('重试')}</Button>
                  }
                />
              )}
              {page?.data?.sectionErrors?.some((error) => error.section === 'contextUsage') && (
                <Alert
                  className="mb-3"
                  type="warning"
                  showIcon
                  message={`${t(label)} · ${t('部分内容暂不可用，可继续使用已加载的内容。')}`}
                />
              )}
              {!section || (section.loading && !page) ? (
                <Skeleton active paragraph={{ rows: 3 }} />
              ) : (
                <ContextUsagePanel
                  snapshot={filterContextUsage(
                    page?.data?.contextUsage,
                    timeSelection.preset === '7d' ? undefined : timeRange,
                  )}
                  rangeLabel={rangeLabel}
                  title={t(
                    pluginId === 'comet.personal-memory'
                      ? '个人记忆检索与使用'
                      : '项目知识检索与使用',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PluginCenterPage({
  page,
  loading,
  error,
  readOnly = false,
  onRetry,
  onInvoke,
  viewScope,
}) {
  useDashboardLanguage();
  if (loading && !page) return <PluginWorkspaceSkeleton />;
  if (error && !page) {
    return (
      <div className="mx-auto max-w-dashboard">
        <SectionHead title={t('插件中心')} hint={t('页面暂时不可用')} />
        <Alert
          type="error"
          showIcon
          message={t('插件页面加载失败')}
          description={t(error)}
          action={<Button onClick={onRetry}>{t('重试')}</Button>}
        />
      </div>
    );
  }
  if (!page) return <PluginWorkspaceSkeleton />;
  const syncError = error ? (
    <Alert
      className="mb-3"
      type="warning"
      showIcon
      message={t('最新数据同步失败，当前显示缓存')}
      description={t(error)}
      action={<Button onClick={onRetry}>{t('重试')}</Button>}
    />
  ) : null;
  if (page.pluginId === 'comet.project-knowledge') {
    return (
      <>
        {syncError}
        <ProjectKnowledgeCenter
          viewScope={viewScope}
          page={page}
          data={page.data}
          readOnly={readOnly}
          onInvoke={onInvoke}
        />
      </>
    );
  }
  if (page.status === 'disabled') {
    return (
      <div className="mx-auto max-w-dashboard">
        <SectionHead title={t(page.label)} hint={t('插件中心')} />
        <Alert
          type="info"
          showIcon
          message={t('插件已停用')}
          description={t('页面数据和项目文件仍然保留，重新启用后即可继续使用。')}
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>
              {t('重新启用')}
            </Button>
          }
        />
      </div>
    );
  }
  if (page.pluginId === 'comet.personal-memory') {
    return (
      <>
        {syncError}
        <PersonalMemoryCenter
          viewScope={viewScope}
          data={page.data}
          readOnly={readOnly}
          onInvoke={onInvoke}
        />
      </>
    );
  }
  return (
    <>
      {syncError}
      <div className="mx-auto max-w-dashboard">
        <SectionHead title={t(page.label)} hint={t('插件中心')} />
        <AntCard size="small">{t('该插件暂未提供可视化中心页。')}</AntCard>
      </div>
    </>
  );
}

function DashboardSettingsOverlay({
  open,
  readOnly = false,
  evalReadOnly = false,
  onEvalSaved,
  section,
  pages,
  page,
  config,
  loading,
  error,
  onClose,
  onSection,
  onRetry,
  onSaveConfig,
  onInvoke,
}) {
  useDashboardLanguage();
  return (
    <DashboardModal
      rootClassName="dashboard-settings-modal-root"
      className="dashboard-settings-modal"
      width={920}
      open={open}
      title={t('Comet 设置')}
      subtitle={
        section === 'comet.appearance'
          ? t(readOnly ? '当前预览' : '此浏览器')
          : readOnly
            ? t('只读预览')
            : section === 'comet.eval'
              ? t('本机用户')
              : t('当前项目')
      }
      description={t('管理记忆、知识、工作流与 Eval 配置')}
      onClose={onClose}
      footer={
        <div className="dashboard-settings-modal-footer">
          <span>{t('点击背景可关闭或还原设置')}</span>
          <div>
            <Button type="primary" onClick={onClose} aria-label={t('完成')}>
              {t('完成')}
            </Button>
          </div>
        </div>
      }
    >
      <DashboardSettingsPage
        active={open}
        evalReadOnly={evalReadOnly}
        onEvalSaved={onEvalSaved}
        section={section}
        pages={pages}
        page={page}
        config={config}
        loading={loading}
        error={error}
        onSection={onSection}
        onRetry={onRetry}
        onSaveConfig={onSaveConfig}
        onInvoke={onInvoke}
        readOnly={readOnly}
      />
    </DashboardModal>
  );
}

function DashboardSettingsPage({
  active,
  evalReadOnly,
  onEvalSaved,
  section,
  pages,
  page,
  config,
  loading,
  error,
  onSection,
  onRetry,
  onSaveConfig,
  onInvoke,
  readOnly = false,
}) {
  useDashboardLanguage();
  const installedPlugins = new Set(
    pages.filter((item) => !item.pending).map((item) => item.pluginId),
  );
  const settingsPages = [
    { key: 'comet.appearance', icon: <SunOutlined />, label: t('外观') },
    {
      key: 'comet.personal-memory',
      icon: <UserOutlined />,
      label: t('个人记忆'),
      disabled: !installedPlugins.has('comet.personal-memory'),
    },
    {
      key: 'comet.project-knowledge',
      icon: <DatabaseOutlined />,
      label: t('项目知识'),
      disabled: !installedPlugins.has('comet.project-knowledge'),
    },
    { key: 'comet.config', icon: <SettingOutlined />, label: t('Comet 配置') },
    { key: 'comet.eval', icon: <CheckCircleOutlined />, label: 'Eval' },
  ];
  const currentData = section === 'comet.config' ? config : page;
  return (
    <div className="dashboard-tool-page dashboard-settings-page min-w-0">
      <div className="dashboard-settings-shell">
        <aside className="dashboard-settings-navigation" aria-label={t('设置分类')}>
          <div className="dashboard-settings-navigation-label">{t('设置中心')}</div>
          <Menu
            mode="inline"
            selectedKeys={section ? [section] : []}
            items={settingsPages}
            onClick={({ key }) => onSection(key)}
          />
        </aside>
        <section
          className={`dashboard-settings-main${readOnly && section !== 'comet.appearance' ? ' is-read-only' : ''}`}
          aria-live="polite"
          aria-disabled={(readOnly && section !== 'comet.appearance') || undefined}
        >
          <div className="dashboard-settings-content">
            {section === 'comet.appearance' ? (
              <DashboardAppearanceSettings />
            ) : section === 'comet.eval' ? (
              active ? (
                <EvalSettings readOnly={evalReadOnly} onSaved={onEvalSaved} />
              ) : null
            ) : (
              <>
                {error && currentData ? (
                  <Alert
                    className="mb-3"
                    type="warning"
                    showIcon
                    message={t('最新数据同步失败，当前显示缓存')}
                    description={t(error)}
                    action={<Button onClick={onRetry}>{t('重试')}</Button>}
                  />
                ) : null}
                {loading && !currentData ? (
                  <LoadingState />
                ) : error && !currentData ? (
                  <Alert
                    type="error"
                    showIcon
                    message={t('设置加载失败')}
                    description={t(error)}
                    action={<Button onClick={onRetry}>{t('重试')}</Button>}
                  />
                ) : section === 'comet.config' && config ? (
                  <CometConfigSettings data={config} readOnly={readOnly} onSave={onSaveConfig} />
                ) : !page ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前设置不可用')} />
                ) : page.pluginId === 'comet.personal-memory' ? (
                  <PersonalMemorySettings
                    page={page}
                    data={page.data}
                    readOnly={readOnly}
                    onInvoke={onInvoke}
                  />
                ) : page.pluginId === 'comet.project-knowledge' ? (
                  <ProjectKnowledgeSettings
                    page={page}
                    data={page.data}
                    readOnly={readOnly}
                    onInvoke={onInvoke}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('该插件暂未提供设置页')}
                  />
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsSectionHead({ icon: Icon, title, description, status }) {
  useDashboardLanguage();
  return (
    <div className="dashboard-settings-section-head" aria-label={title}>
      <span className="dashboard-tool-panel-icon" aria-hidden="true">
        <Icon />
      </span>
      <p>{description}</p>
      {status && <span className="dashboard-tool-counter">{status}</span>}
    </div>
  );
}

function toCometConfigDraft(data) {
  return {
    defaultWorkflow: data.defaultWorkflow,
    workflows: [...data.workflows],
    ambientResume: data.ambientResume,
    hookAllowPaths: data.hookAllowPaths.join('\n'),
    knowledge: {
      provider: data.knowledge?.provider ?? 'local',
      localInclude: [...(data.knowledge?.localInclude ?? [])],
      maxFileMb: data.knowledge?.maxFileMb ?? 1,
      maxTotalMb: data.knowledge?.maxTotalMb ?? 32,
    },
    native: {
      ...data.native,
      maxVerifyFailures: String(data.native.maxVerifyFailures),
    },
    classic: { ...data.classic },
  };
}

function CometConfigSettings({ data, readOnly = false, onSave }) {
  useDashboardLanguage();
  const [draft, setDraft] = useState(() => toCometConfigDraft(data));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    setDraft(toCometConfigDraft(data));
    setSaveError(null);
  }, [data.revision]);

  const setNative = (key, value) => {
    setDraft((current) => ({
      ...current,
      native: { ...current.native, [key]: value },
    }));
  };
  const setClassic = (key, value) => {
    setDraft((current) => ({
      ...current,
      classic: { ...current.classic, [key]: value },
    }));
  };
  const setKnowledge = (key, value) => {
    setDraft((current) => ({
      ...current,
      knowledge: { ...current.knowledge, [key]: value },
    }));
  };
  const save = async () => {
    if (draft.workflows.length === 0) {
      setSaveError(t('至少需要启用一个工作流。'));
      return;
    }
    const maxVerifyFailures = Number(draft.native.maxVerifyFailures);
    if (!Number.isSafeInteger(maxVerifyFailures) || maxVerifyFailures <= 0) {
      setSaveError(t('Verify 失败上限必须是正整数。'));
      return;
    }
    const maxFileMb = Number(draft.knowledge.maxFileMb);
    const maxTotalMb = Number(draft.knowledge.maxTotalMb);
    if (!Number.isSafeInteger(maxFileMb) || maxFileMb <= 0) {
      setSaveError(t('单文件上限必须是正整数。'));
      return;
    }
    if (!Number.isSafeInteger(maxTotalMb) || maxTotalMb <= 0) {
      setSaveError(t('语料总预算必须是正整数。'));
      return;
    }
    if (maxFileMb > maxTotalMb) {
      setSaveError(t('单文件上限不能大于语料总预算。'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        defaultWorkflow: draft.defaultWorkflow,
        workflows: draft.workflows,
        ambientResume: draft.ambientResume,
        hookAllowPaths: draft.hookAllowPaths
          .split(/\r?\n/u)
          .map((item) => item.trim())
          .filter(Boolean),
        knowledge: {
          provider: draft.knowledge.provider,
          localInclude: draft.knowledge.localInclude.filter((item) => item.trim()),
          maxFileMb,
          maxTotalMb,
        },
        native: { ...draft.native, maxVerifyFailures },
        classic: draft.classic,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const workflowOptions = [
    { value: 'native', label: 'Native' },
    { value: 'classic', label: 'Classic' },
  ];
  return (
    <div className="dashboard-settings-stack">
      <SettingsSectionHead
        icon={SettingOutlined}
        title={t('Comet 配置')}
        description={t('编辑当前项目的工作流、恢复策略与产物设置')}
        status={data.schema}
      />
      {saveError && (
        <Alert type="error" showIcon message={t('配置保存失败')} description={saveError} />
      )}
      <section className="dashboard-settings-panel" aria-labelledby="comet-workflow-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="comet-workflow-settings">{t('工作流与恢复')}</h4>
            <p>{t('控制 `/comet` 的默认入口、可用工作流和自动恢复行为')}</p>
          </div>
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('默认工作流')}</strong>
            <span>{t('运行 `/comet` 且没有明确指定模式时使用')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.defaultWorkflow}
            aria-label={t('Comet 默认工作流')}
            options={workflowOptions.filter((item) => draft.workflows.includes(item.value))}
            onChange={(defaultWorkflow) => setDraft((current) => ({ ...current, defaultWorkflow }))}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('启用的工作流')}</strong>
            <span>{t('可以同时保留 Native 与 Classic')}</span>
          </div>
          <Select
            mode="multiple"
            className="dashboard-config-control dashboard-config-control-wide"
            value={draft.workflows}
            aria-label={t('Comet 启用的工作流')}
            options={workflowOptions}
            onChange={(workflows) =>
              setDraft((current) => ({
                ...current,
                workflows,
                defaultWorkflow: workflows.includes(current.defaultWorkflow)
                  ? current.defaultWorkflow
                  : (workflows[0] ?? current.defaultWorkflow),
              }))
            }
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('环境感知恢复')}</strong>
            <span>{t('在任务开始前运行只读探针，发现可恢复的 Native 或 Classic change')}</span>
          </div>
          <Switch
            size="small"
            checked={draft.ambientResume}
            aria-label={t('切换环境感知恢复')}
            onChange={(ambientResume) => setDraft((current) => ({ ...current, ambientResume }))}
          />
        </div>
        <div className="dashboard-memory-setting dashboard-memory-setting-stack">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('Hook 允许写入路径')}</strong>
            <span>{t('每行一个项目相对目录；留空时继续遵循工作流阶段保护')}</span>
          </div>
          <Input.TextArea
            rows={3}
            value={draft.hookAllowPaths}
            aria-label={t('Hook 允许写入路径')}
            placeholder={t('例如：\ndocs/generated\nreports')}
            onChange={(event) =>
              setDraft((current) => ({ ...current, hookAllowPaths: event.target.value }))
            }
          />
        </div>
      </section>

      <section className="dashboard-settings-panel" aria-labelledby="comet-knowledge-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="comet-knowledge-settings">{t('项目知识文档')}</h4>
            <p>{t('在内置 Spec 与 Archive 之外，追加当前项目要参与 Local 检索的 Markdown 文档')}</p>
          </div>
          <Tag color={draft.knowledge.provider === 'local' ? 'success' : 'default'}>
            {draft.knowledge.provider === 'local' ? t('Local 生效') : t('Remote 使用中')}
          </Tag>
        </div>
        <div className="dashboard-memory-setting dashboard-memory-setting-stack">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('额外知识文档路径')}</strong>
            <span>
              {t('每项填写一个项目相对 glob，例如 docs/architecture/**/*.md；只读取 Markdown 文件')}
            </span>
          </div>
          <div className="dashboard-knowledge-config-patterns">
            {draft.knowledge.localInclude.map((pattern, index) => (
              <div className="dashboard-knowledge-config-pattern-row" key={`${index}-${pattern}`}>
                <Input
                  value={pattern}
                  disabled={draft.knowledge.provider !== 'local'}
                  aria-label={t('额外知识文档路径 {0}', [index + 1])}
                  placeholder={t('例如：docs/architecture/**/*.md')}
                  onChange={(event) => {
                    const next = [...draft.knowledge.localInclude];
                    next[index] = event.target.value;
                    setKnowledge('localInclude', next);
                  }}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={draft.knowledge.provider !== 'local'}
                  aria-label={t('删除额外知识文档路径 {0}', [index + 1])}
                  onClick={() =>
                    setKnowledge(
                      'localInclude',
                      draft.knowledge.localInclude.filter((_, item) => item !== index),
                    )
                  }
                />
              </div>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              disabled={draft.knowledge.provider !== 'local'}
              onClick={() => setKnowledge('localInclude', [...draft.knowledge.localInclude, ''])}
            >
              {t('添加文档路径')}
            </Button>
          </div>
          <span className="dashboard-settings-help-text">
            {draft.knowledge.provider === 'local'
              ? t('保存后会刷新本地语料；没有匹配文件的合法路径会保留并显示为暂无来源。')
              : t('当前使用 Remote Provider；这些本地路径会保留，但不会被读取或上传。')}
          </span>
        </div>
      </section>

      <section className="dashboard-settings-panel" aria-labelledby="comet-native-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="comet-native-settings">{t('Native 工作流')}</h4>
            <p>{t('控制 Native 产物位置、语言、澄清与归档策略')}</p>
          </div>
          <Tag color={draft.workflows.includes('native') ? 'success' : 'default'}>
            {draft.workflows.includes('native') ? t('已启用') : t('未启用')}
          </Tag>
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('产物根目录')}</strong>
            <span>{t('修改后会改变 Native specs 与 changes 的发现位置')}</span>
          </div>
          <Input
            className="dashboard-config-control dashboard-config-control-wide"
            value={draft.native.artifactRoot}
            aria-label={t('Native 产物根目录')}
            onChange={(event) => setNative('artifactRoot', event.target.value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('产物语言')}</strong>
            <span>{t('Native 生成的需求、规格与验证文档语言')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.native.language}
            aria-label={t('Native 产物语言')}
            options={[
              { value: 'zh-CN', label: t('简体中文') },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value) => setNative('language', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('澄清方式')}</strong>
            <span>{t('批量收集问题，或每轮只处理一个问题')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.native.clarificationMode}
            aria-label={t('Native 澄清方式')}
            options={[
              { value: 'batch', label: t('批量询问') },
              { value: 'sequential', label: t('逐个询问') },
            ]}
            onChange={(value) => setNative('clarificationMode', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('归档确认')}</strong>
            <span>{t('验证通过后自动归档，或等待用户明确确认')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.native.archiveConfirmation}
            aria-label={t('Native 归档确认')}
            options={[
              { value: 'automatic', label: t('自动归档') },
              { value: 'required', label: t('需要确认') },
            ]}
            onChange={(value) => setNative('archiveConfirmation', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('Verify 失败上限')}</strong>
            <span>{t('同一验收目标达到上限后停止完成循环')}</span>
          </div>
          <Input
            className="dashboard-config-control"
            inputMode="numeric"
            value={draft.native.maxVerifyFailures}
            aria-label={t('Native Verify 失败上限')}
            onChange={(event) => setNative('maxVerifyFailures', event.target.value)}
          />
        </div>
      </section>

      <section className="dashboard-settings-panel" aria-labelledby="comet-classic-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="comet-classic-settings">{t('Classic 工作流')}</h4>
            <p>{t('控制 Classic 产物布局、语言、压缩与审查深度')}</p>
          </div>
          <Tag color={draft.workflows.includes('classic') ? 'success' : 'default'}>
            {draft.workflows.includes('classic') ? t('已启用') : t('未启用')}
          </Tag>
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('产物布局')}</strong>
            <span>{t('选择根目录兼容布局或 docs 标准布局')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.classic.artifactLayout}
            aria-label={t('Classic 产物布局')}
            options={[
              { value: 'docs', label: 'docs' },
              { value: 'legacy', label: 'legacy' },
            ]}
            onChange={(value) => setClassic('artifactLayout', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('产物语言')}</strong>
            <span>{t('Classic change 文档使用的语言')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.classic.language}
            aria-label={t('Classic 产物语言')}
            options={[
              { value: 'zh-CN', label: t('简体中文') },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value) => setClassic('language', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('上下文压缩')}</strong>
            <span>{t('为新建 Classic change 启用 beta 压缩能力')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.classic.contextCompression}
            aria-label={t('Classic 上下文压缩')}
            options={[
              { value: 'off', label: t('关闭') },
              { value: 'beta', label: 'Beta' },
            ]}
            onChange={(value) => setClassic('contextCompression', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('审查深度')}</strong>
            <span>{t('控制新建 Classic change 的默认审查强度')}</span>
          </div>
          <Select
            className="dashboard-config-control"
            value={draft.classic.reviewMode}
            aria-label={t('Classic 审查深度')}
            options={[
              { value: 'off', label: t('关闭') },
              { value: 'standard', label: t('标准') },
              { value: 'thorough', label: t('深入') },
            ]}
            onChange={(value) => setClassic('reviewMode', value)}
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('自动进入下一阶段')}</strong>
            <span>{t('当前阶段通过后自动进入 Classic 的下一阶段')}</span>
          </div>
          <Switch
            size="small"
            checked={draft.classic.autoTransition}
            aria-label={t('切换 Classic 自动进入下一阶段')}
            onChange={(value) => setClassic('autoTransition', value)}
          />
        </div>
      </section>

      <section className="dashboard-settings-panel" aria-labelledby="comet-config-file">
        <div className="dashboard-settings-panel-head dashboard-config-save-row">
          <div>
            <h4 id="comet-config-file">{t('配置文件')}</h4>
            <p>
              {t('保存到 ')}
              <code>{data.path}</code>
              {t('；未知扩展字段会原样保留')}
            </p>
          </div>
          <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>
            {t('保存 Comet 配置')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProviderApiExample({ kind }) {
  useDashboardLanguage();
  const [open, setOpen] = useState(false);
  const memory = kind === 'memory';
  const schema = memory
    ? 'comet.personal-memory.provider.v1'
    : 'comet.project-knowledge.provider.v1';
  const requestFor = (operation, input) =>
    memory
      ? { schema, operation, profile: 'default', projectKey: 'example-project', payload: input }
      : { schema, operation, scope: 'team/project', projectId: 'example-project', input };
  const responseFor = (operation, result) =>
    memory ? { result } : { schema, operation, projectId: 'example-project', result };
  const examples = [
    {
      key: 'status',
      label: t('连接状态'),
      request: requestFor('status', memory ? { projectKey: 'example-project' } : {}),
      response: responseFor(
        'status',
        memory
          ? { learningEnabled: false, retrievalEnabled: true, pausedProjects: [] }
          : { provider: 'remote', healthy: true, writable: false, diagnostics: [] },
      ),
    },
    {
      key: 'query',
      label: t('读取示例'),
      request: requestFor(
        'query',
        memory
          ? { view: 'combined', query: { projectKey: 'example-project' } }
          : { kind: 'list', limit: 100 },
      ),
      response: responseFor(
        'query',
        memory
          ? { records: [], truncated: false, disabled: false }
          : { kind: 'list', records: [], truncated: false, diagnostics: [] },
      ),
    },
  ];
  return (
    <>
      <Button type="link" size="small" onClick={() => setOpen(true)}>
        {t('接口示例')}
      </Button>
      <DashboardModal
        open={open}
        onClose={() => setOpen(false)}
        showFullscreen={false}
        title={t(memory ? '个人记忆接口示例' : '项目知识接口示例')}
        width={760}
        footer={
          <Button aria-label={t('关闭')} onClick={() => setOpen(false)}>
            {t('关闭')}
          </Button>
        }
      >
        <div className="dashboard-provider-api-guide">
          <p>
            {t(
              '将这些示例交给服务开发者。已有第三方服务需要实现适配接口；仅替换地址并不代表兼容。',
            )}
          </p>
          <p>
            {t(
              '向填写的完整地址发送 POST 请求，不自动追加路径。请求与响应使用 JSON；鉴权按需使用 Bearer Token。',
            )}
          </p>
          <pre>{'Content-Type: application/json\nAuthorization: Bearer <token>'}</pre>
          <p>
            {t(
              '未配置 Token 环境变量时不发送 Authorization。示例中的标识是占位值，实际请求由 Comet 填入；不要把真实密钥写进示例。',
            )}
          </p>
          <Tabs
            items={examples.map((example) => ({
              key: example.key,
              label: example.label,
              children: (
                <>
                  <h4>{t('请求 JSON')}</h4>
                  <pre data-api-example="request">{JSON.stringify(example.request, null, 2)}</pre>
                  <h4>{t('成功响应（HTTP 200）')}</h4>
                  <pre data-api-example="response">{JSON.stringify(example.response, null, 2)}</pre>
                </>
              ),
            }))}
          />
          <p>
            {t(
              memory
                ? '个人记忆：profile 区分记忆空间，projectKey 标识项目，参数放在 payload 中。响应可用 result 包裹对象；读取单条使用 get，写入、修改与遗忘使用 apply。'
                : '项目知识：scope 区分服务范围，projectId 标识项目，参数放在 input 中。响应必须包含相同的 schema、operation 和 projectId，并把结果放在 result 中。读取使用 query，变更使用 apply。',
            )}
          </p>
          <Alert
            type="info"
            showIcon
            message={t('这些是最小连通与空结果示例，不是完整服务实现。')}
            description={t(
              '真实记录必须满足对应协议的数据字段与项目隔离要求；自动学习、写入和修改还需实现相应操作。仅返回示例不能提供记忆或知识能力。',
            )}
          />
          <p>
            {t(
              '接入顺序：实现适配接口 → 设置鉴权环境变量 → 填写并保存配置 → 检查连接状态和读取结果。HTTP 错误、无效 JSON 或不匹配的响应会被视为失败。',
            )}
          </p>
        </div>
      </DashboardModal>
    </>
  );
}

function PersonalMemorySettings({ page, data, readOnly = false, onInvoke }) {
  useDashboardLanguage();
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
      record.status === 'conflict' || (record.kind === 'inferred' && record.status === 'trial'),
  );
  const projectKey = data?.projectKey;
  const learningAllowed = policy.learning !== false;
  const retrievalAllowed = policy.retrieval !== false;
  const learningPaused = projectKey && (status.pausedLearningProjects ?? []).includes(projectKey);
  const retrievalPaused = projectKey && (status.pausedRetrievalProjects ?? []).includes(projectKey);
  const syncMessage = status.sync?.message ?? t('本地记忆仓库已连接');
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
        title={t('个人记忆设置')}
        description={t('控制当前项目的学习、注入、Provider 与同步')}
        status={
          page.status === 'disabled' ? t('已停用') : provider === 'remote' ? 'Remote' : 'Local'
        }
      />
      {page.status === 'disabled' && (
        <Alert
          type="info"
          showIcon
          message={t('个人记忆插件已停用')}
          description={t('记忆文件和历史仍然保留，重新启用后即可继续使用。')}
          action={
            <Button disabled={readOnly} onClick={() => onInvoke('lifecycle', { action: 'enable' })}>
              {t('重新启用')}
            </Button>
          }
        />
      )}
      {page.status !== 'disabled' && (
        <>
          <section className="dashboard-settings-panel" aria-labelledby="memory-global-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-global-settings">{t('全局能力')}</h4>
                <p>{t('控制个人记忆是否学习新偏好并写入任务上下文')}</p>
              </div>
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('自动学习')}</strong>
                <span>
                  {personalMemoryCapabilityLabel(
                    status,
                    'learningEnabled',
                    t('会沉淀稳定偏好'),
                    t('已暂停自动沉淀'),
                  )}
                </span>
              </div>
              <Switch
                size="small"
                checked={status.learningEnabled === true}
                disabled={
                  readOnly ||
                  status.availability === 'unavailable' ||
                  status.learningEnabled === undefined
                }
                aria-label={t('切换自动学习')}
                onChange={(enabled) => onInvoke('set-learning', { enabled })}
              />
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('记忆注入')}</strong>
                <span>
                  {personalMemoryCapabilityLabel(
                    status,
                    'retrievalEnabled',
                    t('任务中可使用已保存内容'),
                    t('已暂停任务注入'),
                  )}
                </span>
              </div>
              <Switch
                size="small"
                checked={status.retrievalEnabled === true}
                disabled={
                  readOnly ||
                  status.availability === 'unavailable' ||
                  status.retrievalEnabled === undefined
                }
                aria-label={t('切换记忆注入')}
                onChange={(enabled) => onInvoke('set-retrieval', { enabled })}
              />
            </div>
          </section>
          <section className="dashboard-settings-panel" aria-labelledby="memory-project-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-project-settings">{t('当前项目')}</h4>
                <p>{t('单独暂停这个项目的学习或任务注入')}</p>
              </div>
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('项目学习')}</strong>
                <span>
                  {!learningAllowed
                    ? t('项目配置已禁止自动学习')
                    : learningPaused
                      ? t('当前项目暂停自动学习')
                      : t('允许当前项目沉淀新偏好')}
                </span>
              </div>
              <Switch
                size="small"
                checked={Boolean(projectKey && learningAllowed && !learningPaused)}
                disabled={readOnly || !projectKey || !learningAllowed}
                aria-label={t('切换当前项目学习')}
                onChange={(enabled) =>
                  onInvoke('pause-project-learning', { projectKey, paused: !enabled })
                }
              />
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('项目注入')}</strong>
                <span>
                  {!retrievalAllowed
                    ? t('项目配置已禁止自动注入')
                    : retrievalPaused
                      ? t('当前项目不注入记忆')
                      : t('任务中可以使用已保存记忆')}
                </span>
              </div>
              <Switch
                size="small"
                checked={Boolean(projectKey && retrievalAllowed && !retrievalPaused)}
                disabled={readOnly || !projectKey || !retrievalAllowed}
                aria-label={t('切换当前项目记忆注入')}
                onChange={(enabled) =>
                  onInvoke('pause-project-retrieval', { projectKey, paused: !enabled })
                }
              />
            </div>
          </section>
          <section className="dashboard-settings-panel" aria-labelledby="memory-provider-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="memory-provider-settings">{t('记忆注入')}</h4>
                <p>{t('控制哪些个人记忆会提供给 Agent，以及一次最多提供多少文字')}</p>
              </div>
              {pendingRecords.length > 0 && (
                <Button size="small" onClick={() => setShowPending(true)}>
                  {pendingRecords.length}
                  {t(' 条待确认')}
                </Button>
              )}
            </div>
            <div className="dashboard-memory-setting dashboard-memory-setting-stack">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('记忆服务')}</strong>
                <span>
                  {providerMode === 'remote'
                    ? t('通过接口调用外部记忆服务')
                    : t('由 Comet 在当前设备管理个人记忆，无需配置接口')}
                </span>
              </div>
              <Select
                value={providerMode}
                aria-label={t('个人记忆服务')}
                options={[
                  { value: 'local', label: t('内置服务') },
                  { value: 'remote', label: t('外部服务') },
                ]}
                onChange={setProviderMode}
              />
              <div className="dashboard-memory-remote-form">
                <div className="dashboard-memory-budget-field">
                  <label htmlFor="dashboard-memory-profile-budget">{t('稳定偏好最多带入')}</label>
                  <Input
                    id="dashboard-memory-profile-budget"
                    value={profileCharLimit}
                    addonAfter={t('字符')}
                    onChange={(event) => setProfileCharLimit(event.target.value)}
                    aria-label={t('稳定偏好最多带入字符数')}
                  />
                  <span>{t('例如：你偏好的语言、协作习惯和长期要求。')}</span>
                </div>
                <div className="dashboard-memory-budget-field">
                  <label htmlFor="dashboard-memory-task-budget">
                    {t('当前任务相关记忆最多带入')}
                  </label>
                  <Input
                    id="dashboard-memory-task-budget"
                    value={taskContextCharLimit}
                    addonAfter={t('字符')}
                    onChange={(event) => setTaskContextCharLimit(event.target.value)}
                    aria-label={t('当前任务相关记忆最多带入字符数')}
                  />
                  <span>{t('例如：与当前项目、路径和操作有关的记忆。')}</span>
                </div>
              </div>
              <p className="dashboard-memory-budget-note">
                {t('这是注入上限，不是记忆条数或存储容量。')}
              </p>
              {providerMode === 'remote' && (
                <>
                  <div className="dashboard-memory-budget-field">
                    <div className="dashboard-settings-field-heading">
                      <label htmlFor="memory-service-endpoint">{t('记忆服务接口地址')}</label>
                      <ProviderApiExample kind="memory" />
                    </div>
                    <Input
                      id="memory-service-endpoint"
                      aria-describedby="memory-service-endpoint-help"
                      value={providerEndpoint}
                      onChange={(event) => setProviderEndpoint(event.target.value)}
                      placeholder="https://memory.example.com/comet"
                      aria-label={t('记忆服务接口地址')}
                    />
                    <span id="memory-service-endpoint-help">
                      {t(
                        '填写服务提供方给出的完整接口地址，需兼容 Comet 个人记忆协议；不能直接填写模型 API 地址。',
                      )}
                    </span>
                  </div>
                  <div className="dashboard-memory-remote-form">
                    <div className="dashboard-memory-budget-field">
                      <label htmlFor="memory-service-token">{t('Token 环境变量名（可选）')}</label>
                      <Input
                        id="memory-service-token"
                        aria-describedby="memory-service-token-help"
                        value={providerTokenEnv}
                        onChange={(event) => setProviderTokenEnv(event.target.value)}
                        placeholder="COMET_MEMORY_TOKEN"
                        aria-label={t('Token 环境变量名（可选）')}
                      />
                      <span id="memory-service-token-help">
                        {t(
                          '填写变量名，例如 COMET_MEMORY_TOKEN，不要填写 Token 本身。在启动 Comet 的环境中设置对应值；无需鉴权时留空。',
                        )}
                      </span>
                    </div>
                    <div className="dashboard-memory-budget-field">
                      <label htmlFor="memory-service-profile">{t('记忆空间（Profile）')}</label>
                      <Input
                        id="memory-service-profile"
                        aria-describedby="memory-service-profile-help"
                        value={providerProfile}
                        onChange={(event) => setProviderProfile(event.target.value)}
                        placeholder="default"
                        aria-label={t('记忆空间（Profile）')}
                      />
                      <span id="memory-service-profile-help">
                        {t('按服务提供方要求填写，用于区分记忆空间；不确定时保留 default。')}
                      </span>
                    </div>
                  </div>
                  <div className="dashboard-memory-budget-field">
                    <label htmlFor="memory-service-timeout">{t('请求超时（毫秒）')}</label>
                    <Input
                      id="memory-service-timeout"
                      aria-describedby="memory-service-timeout-help"
                      value={providerTimeoutMs}
                      onChange={(event) => setProviderTimeoutMs(event.target.value)}
                      placeholder="5000"
                      aria-label={t('请求超时（毫秒）')}
                    />
                    <span id="memory-service-timeout-help">
                      {t('通常保留 5000，即最多等待 5 秒。')}
                    </span>
                  </div>
                </>
              )}
              <div className="dashboard-memory-sync-row">
                <span>
                  {t(
                    '服务切换不会迁移或删除已有数据。请先保存配置，再测试连接；测试使用已保存的配置。',
                  )}
                </span>
                <div className="dashboard-memory-remote-form">
                  <Button disabled={readOnly} onClick={() => onInvoke('test-provider', {})}>
                    {t('测试连接')}
                  </Button>
                  <Button type="primary" disabled={readOnly} onClick={saveProviderConfig}>
                    {t('保存配置')}
                  </Button>
                </div>
              </div>
            </div>
          </section>
          {provider === 'local' && (
            <section className="dashboard-settings-panel" aria-labelledby="memory-sync-settings">
              <div className="dashboard-settings-panel-head">
                <div>
                  <h4 id="memory-sync-settings">{t('本地同步')}</h4>
                  <p>{t('把本地记忆仓库连接到你控制的 Git remote')}</p>
                </div>
              </div>
              <div className="dashboard-memory-setting dashboard-memory-setting-stack">
                <div className="dashboard-memory-setting-copy">
                  <strong>{t('同步仓库')}</strong>
                  <span>{status.remote ?? t('尚未配置 Git remote')}</span>
                </div>
                <div className="dashboard-memory-remote-form">
                  <Input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder={t('输入记忆仓库 remote')}
                    aria-label={t('记忆仓库 Git remote')}
                  />
                  <Button
                    disabled={readOnly || !remoteUrl.trim()}
                    onClick={() => {
                      void onInvoke('configure-remote', { url: remoteUrl.trim() });
                      setRemoteUrl('');
                    }}
                  >
                    {t('保存')}
                  </Button>
                </div>
                <div className="dashboard-memory-sync-row">
                  <span>{syncMessage}</span>
                  <Button
                    icon={<SyncOutlined />}
                    disabled={readOnly}
                    onClick={() => onInvoke('sync', {})}
                  >
                    {t('立即同步')}
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
            <h4 id="memory-plugin-settings">{t('插件管理')}</h4>
            <p>{t('卸载后记忆文件和历史仍会保留')}</p>
          </div>
          <Button
            danger
            disabled={readOnly}
            onClick={() =>
              Modal.confirm({
                title: t('卸载个人记忆插件？'),
                content: t('记忆文件和历史会保留，之后可以重新安装。'),
                okText: t('卸载'),
                cancelText: t('取消'),
                onOk: () => onInvoke('lifecycle', { action: 'uninstall' }),
              })
            }
          >
            {t('卸载插件')}
          </Button>
        </div>
      </section>
      <DashboardModal
        open={showPending}
        title={t('待确认记忆')}
        footer={null}
        onClose={() => setShowPending(false)}
      >
        {pendingRecords.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有待确认内容')} />
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
                {record.kind === 'inferred' && record.status === 'trial' && (
                  <Button
                    size="small"
                    disabled={readOnly}
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
                    {t('确认保存')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DashboardModal>
    </div>
  );
}

function ProjectKnowledgeSettings({ page, data, readOnly = false, onInvoke }) {
  useDashboardLanguage();
  const snapshot = data && typeof data === 'object' ? data : {};
  const [providerMode, setProviderMode] = useState(snapshot.provider ?? 'local');
  const [endpoint, setEndpoint] = useState(snapshot.remote?.endpoint ?? '');
  const [tokenEnv, setTokenEnv] = useState(snapshot.remote?.tokenEnv ?? '');
  const [scope, setScope] = useState(snapshot.remote?.scope ?? '');
  const [timeoutMs, setTimeoutMs] = useState(String(snapshot.remote?.timeoutMs ?? 5000));
  const [maxFileMb, setMaxFileMb] = useState(snapshot.localLimits?.maxFileMb ?? 1);
  const [maxTotalMb, setMaxTotalMb] = useState(snapshot.localLimits?.maxTotalMb ?? 32);
  const [saveError, setSaveError] = useState(null);
  useEffect(() => {
    setProviderMode(snapshot.provider ?? 'local');
    setEndpoint(snapshot.remote?.endpoint ?? '');
    setTokenEnv(snapshot.remote?.tokenEnv ?? '');
    setScope(snapshot.remote?.scope ?? '');
    setTimeoutMs(String(snapshot.remote?.timeoutMs ?? 5000));
    setMaxFileMb(snapshot.localLimits?.maxFileMb ?? 1);
    setMaxTotalMb(snapshot.localLimits?.maxTotalMb ?? 32);
    setSaveError(null);
  }, [
    snapshot.provider,
    snapshot.remote?.endpoint,
    snapshot.remote?.tokenEnv,
    snapshot.remote?.scope,
    snapshot.remote?.timeoutMs,
    snapshot.localLimits?.maxFileMb,
    snapshot.localLimits?.maxTotalMb,
  ]);
  const saveProvider = async () => {
    if (providerMode === 'local') {
      if (!Number.isSafeInteger(maxFileMb) || maxFileMb <= 0) {
        setSaveError(t('单文件上限必须是正整数。'));
        return;
      }
      if (!Number.isSafeInteger(maxTotalMb) || maxTotalMb <= 0) {
        setSaveError(t('语料总预算必须是正整数。'));
        return;
      }
      if (maxFileMb > maxTotalMb) {
        setSaveError(t('单文件上限不能大于语料总预算。'));
        return;
      }
    }
    setSaveError(null);
    await onInvoke('configure-provider', {
      provider: providerMode,
      ...(providerMode === 'local' ? { maxFileMb, maxTotalMb } : {}),
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
        ? t('配置有效')
        : t('需要检查')
      : '—';
  const remote = snapshot.remote;
  const local = snapshot.local;
  const disabled = page.status === 'disabled';

  return (
    <div className="dashboard-settings-stack">
      <SettingsSectionHead
        icon={DatabaseOutlined}
        title={t('项目知识设置')}
        description={t('管理当前项目的知识检索、Provider 与插件生命周期')}
        status={disabled ? t('已暂停') : provider}
      />
      {disabled && (
        <Alert
          type="info"
          showIcon
          message={page.projectPaused ? t('当前项目已暂停项目知识') : t('项目知识插件已停用')}
          description={t('项目文件和插件配置仍然保留。')}
          action={
            <Button disabled={readOnly} onClick={() => onInvoke('lifecycle', { action: 'enable' })}>
              {t('重新启用')}
            </Button>
          }
        />
      )}
      {!disabled && (
        <>
          <section
            className="dashboard-settings-panel"
            aria-labelledby="knowledge-provider-settings"
          >
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="knowledge-provider-settings">{t('知识服务与检索')}</h4>
                <p>{t('选择项目知识来源，并控制 Agent 使用的检索服务')}</p>
              </div>
            </div>
            <div className="dashboard-memory-setting dashboard-memory-setting-stack">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('知识服务')}</strong>
                <span>
                  {providerMode === 'remote'
                    ? t('通过接口调用外部知识服务')
                    : t('使用当前设备上的本地项目知识索引')}
                </span>
              </div>
              <Select
                value={providerMode}
                aria-label={t('项目知识服务')}
                onChange={setProviderMode}
                options={[
                  { value: 'local', label: t('内置服务') },
                  { value: 'remote', label: t('外部服务') },
                ]}
              />
              {providerMode === 'remote' && (
                <div className="dashboard-knowledge-settings-fields">
                  <div className="dashboard-memory-budget-field">
                    <div className="dashboard-settings-field-heading">
                      <label htmlFor="knowledge-service-endpoint">{t('知识服务接口地址')}</label>
                      <ProviderApiExample kind="knowledge" />
                    </div>
                    <Input
                      id="knowledge-service-endpoint"
                      aria-describedby="knowledge-service-endpoint-help"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder="https://knowledge.example.com/comet"
                      aria-label={t('知识服务接口地址')}
                    />
                    <span id="knowledge-service-endpoint-help">
                      {t(
                        '填写服务提供方给出的完整 HTTPS 接口地址，需兼容 Comet 项目知识协议；不能直接填写模型 API 地址。',
                      )}
                    </span>
                  </div>
                  <div className="dashboard-memory-remote-form">
                    <div className="dashboard-memory-budget-field">
                      <label htmlFor="knowledge-service-token">
                        {t('Token 环境变量名（可选）')}
                      </label>
                      <Input
                        id="knowledge-service-token"
                        aria-describedby="knowledge-service-token-help"
                        value={tokenEnv}
                        onChange={(event) => setTokenEnv(event.target.value)}
                        placeholder="COMET_KNOWLEDGE_TOKEN"
                        aria-label={t('Token 环境变量名（可选）')}
                      />
                      <span id="knowledge-service-token-help">
                        {t(
                          '填写变量名，例如 COMET_KNOWLEDGE_TOKEN，不要填写 Token 本身。在启动 Comet 的环境中设置对应值；无需鉴权时留空。',
                        )}
                      </span>
                    </div>
                    <div className="dashboard-memory-budget-field">
                      <label htmlFor="knowledge-service-scope">
                        {t('知识范围（Scope，可选）')}
                      </label>
                      <Input
                        id="knowledge-service-scope"
                        aria-describedby="knowledge-service-scope-help"
                        value={scope}
                        onChange={(event) => setScope(event.target.value)}
                        placeholder="team/project"
                        aria-label={t('知识范围（Scope，可选）')}
                      />
                      <span id="knowledge-service-scope-help">
                        {t('按服务提供方要求填写团队或项目范围；不需要区分时留空。')}
                      </span>
                    </div>
                  </div>
                  <div className="dashboard-memory-budget-field">
                    <label htmlFor="knowledge-service-timeout">{t('请求超时（毫秒）')}</label>
                    <Input
                      id="knowledge-service-timeout"
                      aria-describedby="knowledge-service-timeout-help"
                      value={timeoutMs}
                      onChange={(event) => setTimeoutMs(event.target.value)}
                      placeholder="5000"
                      aria-label={t('请求超时（毫秒）')}
                    />
                    <span id="knowledge-service-timeout-help">
                      {t('通常保留 5000，即最多等待 5 秒；允许范围为 100–30000。')}
                    </span>
                  </div>
                </div>
              )}
              <div className="dashboard-memory-sync-row">
                <span>
                  {providerMode === snapshot.provider && snapshot.retrieval
                    ? snapshot.retrieval
                    : t('服务切换不会删除现有项目知识；保存后重新加载配置即可生效')}
                </span>
                <Button type="primary" disabled={readOnly} onClick={() => void saveProvider()}>
                  {t('保存配置')}
                </Button>
              </div>
            </div>
          </section>
          {saveError && (
            <Alert
              type="error"
              showIcon
              message={t('项目知识配置保存失败')}
              description={saveError}
            />
          )}
          <section className="dashboard-settings-panel" aria-labelledby="knowledge-budget-settings">
            <div className="dashboard-settings-panel-head">
              <div>
                <h4 id="knowledge-budget-settings">{t('Local 语料预算')}</h4>
                <p>{t('控制参与本地项目知识检索的单文件大小和全部文档总量，单位为 MB')}</p>
              </div>
              <Tag color={providerMode === 'local' ? 'success' : 'default'}>
                {providerMode === 'local' ? t('Local 生效') : t('Remote 使用中')}
              </Tag>
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('单文件上限')}</strong>
                <span>{t('超过此大小的 Markdown 文件不会进入 Local 检索')}</span>
              </div>
              <InputNumber
                className="dashboard-config-control"
                min={1}
                precision={0}
                value={maxFileMb}
                disabled={readOnly || providerMode !== 'local'}
                aria-label={t('项目知识单文件上限（MB）')}
                addonAfter="MB"
                onChange={setMaxFileMb}
              />
            </div>
            <div className="dashboard-memory-setting">
              <div className="dashboard-memory-setting-copy">
                <strong>{t('语料总预算')}</strong>
                <span>{t('所有进入 Local 检索的 Markdown 文件合计不能超过此大小')}</span>
              </div>
              <InputNumber
                className="dashboard-config-control"
                min={1}
                precision={0}
                value={maxTotalMb}
                disabled={readOnly || providerMode !== 'local'}
                aria-label={t('项目知识语料总预算（MB）')}
                addonAfter="MB"
                onChange={setMaxTotalMb}
              />
            </div>
            <span className="dashboard-settings-help-text">
              {providerMode === 'local'
                ? t('保存配置后会按新预算刷新本地语料；单文件上限不能大于语料总预算。')
                : t('当前使用 Remote Provider；这些 Local 预算会保留，切回 Local 后继续生效。')}
            </span>
          </section>
          {providerMode === 'local' && local && (
            <section
              className="dashboard-settings-panel"
              aria-labelledby="knowledge-index-settings"
            >
              <div className="dashboard-settings-panel-head">
                <div>
                  <h4 id="knowledge-index-settings">{t('本地索引')}</h4>
                  <p>{t('查看当前项目隔离的知识索引和最近检索状态')}</p>
                </div>
              </div>
              <div className="dashboard-memory-setting">
                <div className="dashboard-memory-setting-copy">
                  <strong>{t('索引状态')}</strong>
                  <span>
                    {local.sourceCount}
                    {t(' 个来源 · ')}
                    {local.sectionCount}
                    {t(' 个知识片段')}
                  </span>
                </div>
                <Tag color={local.available ? 'success' : 'warning'}>
                  {local.available ? t('可用') : t('需要建立')}
                </Tag>
              </div>
              <div className="dashboard-memory-setting">
                <div className="dashboard-memory-setting-copy">
                  <strong>{t('项目身份')}</strong>
                  <span>{local.repositoryId}</span>
                </div>
                <span className="dashboard-settings-value">{local.workspaceId}</span>
              </div>
              <div className="dashboard-memory-setting">
                <div className="dashboard-memory-setting-copy">
                  <strong>{t('最近查询')}</strong>
                  <span>
                    {typeof local.lastQueryMs === 'number'
                      ? t('{0} ms · {1} 个候选', [local.lastQueryMs, local.lastCandidateCount ?? 0])
                      : t('尚无查询统计')}
                  </span>
                </div>
                <span className="dashboard-settings-value">
                  {local.channels?.length ? local.channels.join(' + ') : t('尚无候选通道')}
                </span>
              </div>
            </section>
          )}
          {providerMode === 'remote' && remote && (
            <section
              className="dashboard-settings-panel"
              aria-labelledby="knowledge-remote-settings"
            >
              <div className="dashboard-settings-panel-head">
                <div>
                  <h4 id="knowledge-remote-settings">{t('Remote 连接')}</h4>
                  <p>{t('只保存连接信息和 token 环境变量名，不保存 token 内容')}</p>
                </div>
              </div>
              <div className="dashboard-memory-setting">
                <div className="dashboard-memory-setting-copy">
                  <strong>Endpoint</strong>
                  <span>{remote.endpoint || t('未提供')}</span>
                </div>
                <Tag>{remote.scope || t('默认 Scope')}</Tag>
              </div>
              <div className="dashboard-memory-setting">
                <div className="dashboard-memory-setting-copy">
                  <strong>{t('鉴权与超时')}</strong>
                  <span>
                    {remote.tokenEnv
                      ? `${remote.tokenEnv} · ${remote.tokenConfigured ? t('已提供') : t('未提供')}`
                      : t('无需 token')}
                  </span>
                </div>
                <span className="dashboard-settings-value">{remote.timeoutMs} ms</span>
              </div>
            </section>
          )}
        </>
      )}
      <section className="dashboard-settings-panel" aria-labelledby="knowledge-project-settings">
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="knowledge-project-settings">{t('当前项目')}</h4>
            <p>{t('单独控制这个项目是否为 Agent 提供项目知识')}</p>
          </div>
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('项目知识检索')}</strong>
            <span>
              {page.globallyDisabled
                ? t('插件已全局停用')
                : page.projectPaused || disabled
                  ? t('当前项目已暂停向 Agent 提供知识')
                  : t('Agent 可以检索当前项目的知识记录')}
            </span>
          </div>
          <Switch
            size="small"
            checked={!disabled}
            disabled={readOnly}
            aria-label={t('切换当前项目知识检索')}
            onChange={(enabled) =>
              onInvoke('lifecycle', { action: enabled ? 'enable' : 'disable' })
            }
          />
        </div>
        <div className="dashboard-memory-setting">
          <div className="dashboard-memory-setting-copy">
            <strong>{t('配置状态')}</strong>
            <span>{t('Provider 和索引配置是否满足当前检索要求')}</span>
          </div>
          <Tag color={configured === t('配置有效') ? 'success' : 'warning'}>{configured}</Tag>
        </div>
      </section>
      <section
        className="dashboard-settings-panel dashboard-settings-danger"
        aria-labelledby="knowledge-plugin-settings"
      >
        <div className="dashboard-settings-panel-head">
          <div>
            <h4 id="knowledge-plugin-settings">{t('插件管理')}</h4>
            <p>{t('卸载只停止插件，不会删除项目文档或配置')}</p>
          </div>
          <Button
            danger
            disabled={readOnly}
            onClick={() =>
              Modal.confirm({
                title: t('卸载项目知识插件？'),
                content: t('卸载只停止当前插件，不会删除项目文档或配置。'),
                okText: t('卸载'),
                cancelText: t('取消'),
                onOk: () => onInvoke('lifecycle', { action: 'uninstall' }),
              })
            }
          >
            {t('卸载插件')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function openProjectKnowledgeCorrection(record, onInvoke) {
  const restoring = record.state === 'superseded';
  Modal.confirm({
    centered: true,
    width: 'min(800px, calc(100vw - 32px))',
    icon: null,
    title: restoring ? t('纠正并恢复项目知识') : t('纠正项目知识记录'),
    content: (
      <Input.TextArea
        id="project-knowledge-correction"
        defaultValue={record.summary}
        placeholder={t('说明需要如何修正这条项目知识')}
        rows={14}
        style={{ height: 'min(360px, 50dvh)', maxHeight: '50dvh', resize: 'vertical' }}
      />
    ),
    okText: restoring ? t('保存并恢复') : t('保存纠正'),
    cancelText: t('取消'),
    onOk: () => {
      const element = document.getElementById('project-knowledge-correction');
      return onInvoke('correct', {
        id: record.id,
        text: element?.value ?? record.summary,
        ...(restoring ? { restore: true } : {}),
      });
    },
  });
}

function ProjectKnowledgeRegistry({
  records,
  workspaceTab,
  visibleRecords,
  selectedRecord,
  selectedRecordId,
  workspaceLabel,
  workspaceHelp,
  onSelectRecord,
  recordSearchText,
  onRecordSearchTextChange,
  categoryFilter,
  onCategoryFilterChange,
  stateFilter,
  onStateFilterChange,
  sortOrder,
  onSortOrderChange,
  diagnostics,
  indexedSourcePaths,
  provider,
  readOnly = false,
  onInvoke,
}) {
  useDashboardLanguage();
  const firstDiagnostic = diagnostics[0];
  const diagnosticCopy = firstDiagnostic
    ? projectKnowledgeDiagnosticCopy(firstDiagnostic)
    : { label: '', message: '' };
  const countedRecords =
    stateFilter === 'all'
      ? records
      : records.filter((record) => projectKnowledgeStateMatches(record, stateFilter));
  const categoryMotion = useDashboardMotion(`${workspaceTab}:${categoryFilter}`, 'fade');

  return (
    <div className="dashboard-knowledge-registry">
      <aside className="dashboard-knowledge-explorer" aria-label={t('知识分类')}>
        <div className="dashboard-knowledge-explorer-search">
          <Input
            value={recordSearchText}
            prefix={<SearchOutlined />}
            placeholder={t('搜索分类或知识标题')}
            aria-label={t('搜索项目知识记录')}
            onChange={(event) => onRecordSearchTextChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`dashboard-knowledge-category ${categoryFilter === 'all' ? 'is-active' : ''}`}
          onClick={() => onCategoryFilterChange('all')}
        >
          <span>{t('全部知识')}</span>
          <span>{countedRecords.length}</span>
        </button>
        <div className="dashboard-knowledge-category-groups">
          {PROJECT_KNOWLEDGE_CATEGORY_GROUPS.filter(
            (group) => workspaceTab === 'history' || group.key === workspaceTab,
          ).map((group) => (
            <section key={group.key} aria-labelledby={`knowledge-category-${group.key}`}>
              <h3 id={`knowledge-category-${group.key}`}>
                <span>{group.label}</span>
                <small>{t('内置')}</small>
              </h3>
              {group.types.map((type) => {
                const count = countedRecords.filter((record) => record.type === type).length;
                const typeMeta = projectKnowledgeTypeMeta(type);
                return (
                  <Tooltip key={type} title={typeMeta.description} placement="right">
                    <button
                      type="button"
                      className={`dashboard-knowledge-category ${categoryFilter === type ? 'is-active' : ''}`}
                      onClick={() => onCategoryFilterChange(type)}
                    >
                      <span>{typeMeta.label}</span>
                      <span>{count}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </section>
          ))}
        </div>
        <div className="dashboard-knowledge-explorer-foot">
          <span>{t('知识提供方式')}</span>
          <strong>{provider}</strong>
        </div>
      </aside>

      <section className="dashboard-knowledge-ledger" aria-labelledby="knowledge-ledger-title">
        <header className="dashboard-knowledge-ledger-toolbar">
          <div>
            <span className="dashboard-contextual-title">
              <strong id="knowledge-ledger-title">{workspaceLabel}</strong>
              <CompactHelpButton
                ariaLabel={t('了解{0}', [workspaceLabel])}
                title={workspaceLabel}
                description={workspaceHelp.description}
                example={workspaceHelp.example}
              />
            </span>
            <span className="dashboard-knowledge-ledger-toolbar-meta">
              {visibleRecords.length}
              {t(' 条')}
            </span>
            <Tooltip title={t('刷新项目知识')}>
              <Button
                type="text"
                icon={<ReloadOutlined />}
                aria-label={t('刷新项目知识')}
                onClick={() => onInvoke('refresh', {})}
              />
            </Tooltip>
          </div>
          <div>
            <Select
              value={sortOrder}
              aria-label={t('项目知识排序')}
              onChange={onSortOrderChange}
              options={[
                { value: 'newest', label: t('更新时间：最新') },
                { value: 'oldest', label: t('更新时间：最早') },
              ]}
            />
            <Select
              value={stateFilter}
              aria-label={t('项目知识记录状态')}
              onChange={onStateFilterChange}
              options={[
                { value: 'active', label: t('当前有效') },
                { value: 'trial', label: t('试用中') },
                { value: 'proven', label: t('已验证') },
                { value: 'enforced', label: t('强制执行') },
                { value: 'superseded', label: t('已替代') },
                { value: 'all', label: t('全部记录') },
              ]}
            />
          </div>
        </header>
        {diagnosticCopy.message && (
          <div className="dashboard-knowledge-inline-warning" role="status">
            <SafetyCertificateOutlined aria-hidden="true" />
            <span>
              <strong>{diagnosticCopy.label}</strong>
              {diagnosticCopy.message}
            </span>
          </div>
        )}
        <div className="dashboard-knowledge-ledger-head" aria-hidden="true">
          <span>{t('知识标题与摘要')}</span>
          <span>{t('来源路径')}</span>
          <span>{t('验证状态')}</span>
          <span>{t('更新时间')}</span>
        </div>
        {visibleRecords.length === 0 ? (
          <Empty
            className="dashboard-knowledge-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              recordSearchText.trim() ? t('没有符合当前条件的项目知识') : workspaceHelp.description
            }
          />
        ) : (
          <div
            ref={categoryMotion}
            data-dashboard-motion="panel"
            className="dashboard-knowledge-ledger-rows"
            data-dashboard-scroll="knowledge-ledger"
            aria-label={t('项目知识记录列表')}
          >
            {visibleRecords.slice(0, 100).map((record) => {
              const sources = projectKnowledgeRecordSources(record);
              const verification = projectKnowledgeVerificationLines(record);
              const needsEvidence =
                record.authority === 'user' && (sources.length === 0 || verification.length === 0);
              return (
                <button
                  type="button"
                  key={record.id}
                  className={`dashboard-knowledge-ledger-row ${selectedRecordId === record.id ? 'is-selected' : ''}`}
                  aria-pressed={selectedRecordId === record.id}
                  onClick={() => onSelectRecord(record.id)}
                >
                  <span className="dashboard-knowledge-record-copy">
                    <span className="dashboard-record-title-line">
                      <strong>{knowledgeText(record, record.title)}</strong>
                      <span className="dashboard-record-origin">
                        {projectKnowledgeOriginLabel(record)}
                      </span>
                    </span>
                    <span>{knowledgeText(record, record.summary)}</span>
                    {needsEvidence && (
                      <span className="dashboard-knowledge-row-warning">
                        {t('缺少来源或验证记录')}
                      </span>
                    )}
                  </span>
                  <span className="dashboard-knowledge-record-source">
                    {sources[0] ?? t('无来源')}
                  </span>
                  <span className={`dashboard-knowledge-record-state is-${record.state}`}>
                    <span aria-hidden="true" />
                    {projectKnowledgeStateLabel(record.state)}
                  </span>
                  <time dateTime={record.updatedAt}>{formatTimestamp(record.updatedAt)}</time>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <ProjectKnowledgeInspector
        record={selectedRecord}
        indexedSourcePaths={indexedSourcePaths}
        readOnly={readOnly}
        onInvoke={onInvoke}
      />
    </div>
  );
}

function ContextApplicationHistory({
  applications = [],
  recordId,
  total = applications.length,
  cursor,
  onLoadPage,
}) {
  useDashboardLanguage();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const loader = useRef(onLoadPage);
  loader.current = onLoadPage;
  useEffect(() => {
    generation.current++;
    setPage(null);
    setLoading(false);
    setError(false);
  }, [recordId, applications, cursor]);
  if (applications.length === 0) return null;
  const visible = page?.items ?? applications.slice(0, 6);
  const next = page ? page.nextCursor : cursor;
  const localOffset = page?.offset ?? 0;
  const localMore = !cursor && !page?.remote && localOffset + (page ? 20 : 6) < applications.length;
  const history = page?.history ?? [];
  const load = async (previous = false) => {
    const token = ++generation.current;
    setError(false);
    setLoading(true);
    try {
      if (previous && history.length <= 1) {
        setPage(null);
        return;
      }
      if (!cursor && !page?.remote) {
        const offset = previous ? Math.max(0, localOffset - 20) : localOffset + (page ? 20 : 6);
        setPage({
          items: applications.slice(offset, offset + 20),
          offset,
          history: previous ? history.slice(0, -1) : [...history, offset],
        });
        return;
      }
      const requestedCursor = previous ? history.at(-2) : next;
      const result = await loader.current?.(requestedCursor);
      if (token !== generation.current) return;
      if (!result || !Array.isArray(result.items)) throw new Error('History unavailable');
      setPage({
        items: result.items.slice(0, 20),
        nextCursor: result.nextCursor,
        remote: true,
        history: previous ? history.slice(0, -1) : [...history, requestedCursor],
      });
    } catch {
      if (token === generation.current) setError(true);
    } finally {
      if (token === generation.current) setLoading(false);
    }
  };
  return (
    <section>
      <div className="dashboard-context-application-history-head">
        <h4>{t('应用历史')}</h4>
        <span>{t('共 {0} 条', [total])}</span>
      </div>
      {error && <p role="alert">{t('历史加载失败，请重试。')}</p>}
      {(page || next || localMore) && (
        <div className="dashboard-context-application-history-head">
          <Button
            aria-label={t('较新记录')}
            size="small"
            type="text"
            disabled={!page || loading}
            onClick={() => load(true)}
          >
            {t('较新记录')}
          </Button>
          <Button
            aria-label={t('较早记录')}
            size="small"
            type="text"
            loading={loading}
            disabled={(!next && !localMore) || loading}
            onClick={() => load()}
          >
            {t('较早记录')}
          </Button>
        </div>
      )}
      <div className="dashboard-context-application-history">
        {visible.map((application) => (
          <article key={application.applicationId}>
            <div className="dashboard-context-application-history-title">
              <strong>{application.task || t('未命名任务')}</strong>
            </div>
            <p className="dashboard-context-application-history-reason">
              {systemText(application.whyApplied)}
            </p>
            <footer className="dashboard-context-application-history-meta">
              <time dateTime={application.appliedAt}>{formatTimestamp(application.appliedAt)}</time>
              <span className={`is-${application.outcome ?? 'unknown'}`}>
                {contextOutcomeLabel(application.outcome)}
              </span>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProjectKnowledgeInspector({
  record,
  indexedSourcePaths = new Set(),
  readOnly = false,
  onInvoke,
}) {
  useDashboardLanguage();
  const detailMotion = useDashboardMotion(record?.id ?? '', 'fade');
  if (!record) {
    return (
      <aside className="dashboard-knowledge-inspector is-empty" aria-label={t('记录详情')}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('选择一条记录查看详情')} />
      </aside>
    );
  }

  const sources = projectKnowledgeRecordSources(record);
  const references = [
    ...(record.conclusions ?? []).flatMap((conclusion) =>
      (conclusion.sources ?? []).map((source) => ({ ...source, role: t('结论') })),
    ),
    ...(record.relations ?? []).flatMap((relation) =>
      (relation.sources ?? []).map((source) => ({
        ...source,
        role: t('关系：{0} → {1}', [relation.type, relation.targetId]),
      })),
    ),
  ];
  const verification = projectKnowledgeVerificationLines(record);
  const sourceVersions = Array.isArray(record.sourceVersions) ? record.sourceVersions : [];
  const applicablePaths = record.applicablePaths ?? [];
  const operations = record.operations ?? [];
  const needsEvidence =
    record.authority === 'user' && (sources.length === 0 || verification.length === 0);

  return (
    <aside
      ref={detailMotion}
      data-dashboard-motion="detail"
      className="dashboard-knowledge-inspector"
      data-dashboard-scroll="knowledge-inspector"
      aria-label={t('记录详情')}
    >
      <header>
        <div>
          <h3>{knowledgeText(record, record.title)}</h3>
          <span className={`dashboard-knowledge-record-state is-${record.state}`}>
            <span aria-hidden="true" />
            {projectKnowledgeStateLabel(record.state)}
          </span>
        </div>
        <p>{knowledgeText(record, record.summary)}</p>
      </header>
      {needsEvidence && (
        <div className="dashboard-knowledge-inspector-warning" role="status">
          <SafetyCertificateOutlined aria-hidden="true" />
          <span>
            {t('这条知识由用户手动确认，当前缺少来源或验证记录；建议补充证据，方便后续维护。')}
          </span>
        </div>
      )}
      {record.state === 'trial' && (
        <div className="dashboard-knowledge-inspector-warning" role="status">
          <ReloadOutlined aria-hidden="true" />
          <span>{t('这条知识正在试用，Agent 会按相关性谨慎召回；成功应用后会提升为已验证。')}</span>
        </div>
      )}
      <section>
        <h4>{t('最近一次提供与反馈')}</h4>
        <dl>
          <div>
            <dt>{t('为什么匹配')}</dt>
            <dd>{systemText(record.lastApplication?.whyApplied) ?? t('尚未应用')}</dd>
          </div>
          <div>
            <dt>{t('加载方式')}</dt>
            <dd>{contextDeliveryLabel(record.lastApplication)}</dd>
          </div>
          {record.lastApplication && (
            <>
              <div>
                <dt>{t('提供时间')}</dt>
                <dd>{formatTimestamp(record.lastApplication.appliedAt)}</dd>
              </div>
              <div>
                <dt>{t('应用结果')}</dt>
                <dd>{contextOutcomeLabel(record.lastApplication.outcome)}</dd>
              </div>
              <div>
                <dt>{t('采用依据')}</dt>
                <dd>
                  {record.lastApplication.outcomeEvents?.at(-1)?.evidence?.decision ??
                    t('尚未记录具体采用决定')}
                </dd>
              </div>
              {record.lastApplication.outcomeEvents?.at(-1)?.evidence?.verification && (
                <div>
                  <dt>{t('宿主验证结果')}</dt>
                  <dd>
                    {record.lastApplication.outcomeEvents.at(-1).evidence.verification.command}
                    {' · '}
                    {record.lastApplication.outcomeEvents.at(-1).evidence.verification.success
                      ? t('通过')
                      : t('失败')}
                  </dd>
                </div>
              )}
            </>
          )}
          {projectPolicyActivationLabel(record.activation) && (
            <div>
              <dt>{t('策略激活')}</dt>
              <dd>{projectPolicyActivationLabel(record.activation)}</dd>
            </div>
          )}
        </dl>
      </section>
      <section>
        <h4>{t('应用条件')}</h4>
        <dl>
          <div>
            <dt>{t('知识类型')}</dt>
            <dd>{projectKnowledgeTypeLabel(record.type)}</dd>
          </div>
          <div>
            <dt>{t('适用路径')}</dt>
            <dd>{applicablePaths.length > 0 ? applicablePaths.join('、') : t('当前项目')}</dd>
          </div>
          <div>
            <dt>{t('适用操作')}</dt>
            <dd>{operations.length > 0 ? operations.join('、') : t('全部任务')}</dd>
          </div>
          <div>
            <dt>{t('适用阶段')}</dt>
            <dd>{(record.phases ?? []).length > 0 ? record.phases.join('、') : t('全部阶段')}</dd>
          </div>
        </dl>
      </section>
      <ContextApplicationHistory
        applications={record.applicationHistory ?? []}
        recordId={record.id}
        total={record.contextApplicationCount}
        cursor={record.applicationHistoryCursor}
        onLoadPage={(cursor) =>
          onInvoke?.('application-history', { candidateId: record.id, cursor })
        }
      />
      <section>
        <h4>{t('结论证据')}</h4>
        {sources.length === 0 ? (
          <p className="dashboard-knowledge-inspector-muted">{t('尚未关联来源文件')}</p>
        ) : (
          <ul className="dashboard-knowledge-source-list">
            {references.map((reference, index) => (
              <li key={`${reference.source}-${index}`}>
                <FileTextOutlined aria-hidden="true" />
                <span>
                  <code>
                    {reference.source}
                    {reference.anchor ? `#${reference.anchor}` : ''}
                    {reference.lineStart
                      ? `#L${reference.lineStart}${reference.lineEnd ? `-L${reference.lineEnd}` : ''}`
                      : ''}
                  </code>
                  <small>
                    {reference.role} ·{' '}
                    {indexedSourcePaths.has(projectKnowledgeSourcePath(reference.source))
                      ? t('同时参与文档检索')
                      : t('仅支持此结论，不参与全文检索')}
                  </small>
                  {reference.evidence && <em>{reference.evidence}</em>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>{t('来源版本')}</h4>
        {sourceVersions.length === 0 ? (
          <p className="dashboard-knowledge-inspector-muted">{t('尚未记录来源版本')}</p>
        ) : (
          <ul className="dashboard-knowledge-verification-list">
            {sourceVersions.map((version) => (
              <li key={version.source}>
                <FileTextOutlined aria-hidden="true" />
                <code>{version.source}</code>
                <span>
                  {formatFileSize(version.size) ?? t('未知大小')} ·{' '}
                  {formatTimestamp(new Date(version.modifiedAt).toISOString())}
                  {t(' · 内容摘要')} {version.digest?.slice(0, 12) ?? t('旧记录未保存')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>{t('验证记录')}</h4>
        {verification.length === 0 ? (
          <p className="dashboard-knowledge-inspector-muted">{t('尚未提供验证命令')}</p>
        ) : (
          <ul className="dashboard-knowledge-verification-list">
            {verification.map((entry) => (
              <li key={entry}>
                <CheckCircleOutlined aria-hidden="true" />
                <code>{entry}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>{t('活动记录')}</h4>
        <dl>
          <div>
            <dt>{t('记录来源')}</dt>
            <dd>{projectKnowledgeOriginLabel(record)}</dd>
          </div>
          <div>
            <dt>{t('最近更新')}</dt>
            <dd>{formatTimestamp(record.updatedAt)}</dd>
          </div>
          <div>
            <dt>{t('应用效果')}</dt>
            <dd>
              {t('已应用 ')}
              {record.applicationCount ?? 0}
              {t(' 次 · 成功 ')}
              {record.successCount ?? 0}
              {t(' 次 · 需修正')} {record.failureCount ?? 0}
              {t(' 次')}
            </dd>
          </div>
          <div>
            <dt>{t('记录标识')}</dt>
            <dd className="dashboard-knowledge-record-id">{record.id}</dd>
          </div>
        </dl>
      </section>
      <footer>
        <div className="dashboard-knowledge-inspector-actions">
          <Button
            icon={<EditOutlined />}
            disabled={readOnly}
            onClick={() => openProjectKnowledgeCorrection(record, onInvoke)}
          >
            {record.state === 'superseded' ? t('纠正并恢复') : t('纠正记录')}
          </Button>
          {record.state === 'trial' && (
            <Button
              icon={<ReloadOutlined />}
              disabled={readOnly}
              onClick={() => onInvoke('refresh', { id: record.id })}
            >
              {t('重新检查来源')}
            </Button>
          )}
          {record.state !== 'superseded' && (
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={readOnly}
              onClick={() =>
                Modal.confirm({
                  title: t('将这条项目知识标记为已替代？'),
                  content: t('标记后不再向 Agent 提供，但仍会保留在历史记录中。'),
                  okText: t('标记已替代'),
                  cancelText: t('取消'),
                  okButtonProps: { danger: true },
                  onOk: () => onInvoke('forget', { id: record.id }),
                })
              }
            >
              {t('标记已替代')}
            </Button>
          )}
        </div>
      </footer>
    </aside>
  );
}

function ProjectKnowledgeSources({
  sourceEntries,
  totalSourceCount,
  provider,
  searchText,
  onSearchTextChange,
  selectedSource,
  sourceContent,
  sourceReadPending,
  sourceReadError,
  onSelectSource,
  onCloseSource,
  onSelectRecord,
}) {
  useDashboardLanguage();
  const tabMotion = useDashboardMotion('sources', 'fade');
  return (
    <section
      ref={tabMotion}
      data-dashboard-motion="tab"
      className="dashboard-knowledge-single-view dashboard-knowledge-source-view"
      aria-label={t('检索语料')}
    >
      <div className="dashboard-knowledge-source-toolbar">
        <Input
          value={searchText}
          prefix={<SearchOutlined />}
          allowClear
          placeholder={t('搜索语料路径、类型或关联知识…')}
          aria-label={t('搜索项目知识检索语料')}
          onChange={(event) => onSearchTextChange(event.target.value)}
        />
        <div className="dashboard-knowledge-source-toolbar-meta">
          <span>{provider}</span>
          <span>
            {t('共 ')}
            {totalSourceCount}
            {t(' 个语料文件')}
            {searchText.trim() ? t(' · 匹配 {0} 个', [sourceEntries.length]) : ''}
          </span>
        </div>
      </div>
      {sourceEntries.length === 0 ? (
        <Empty
          className="dashboard-knowledge-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('尚未发现可召回的 Markdown 语料')}
        />
      ) : (
        <div
          className="dashboard-knowledge-source-rows"
          aria-label={t('项目知识检索语料列表')}
          role="region"
          tabIndex={0}
        >
          <div className="dashboard-knowledge-source-head" aria-hidden="true">
            <span>{t('语料路径')}</span>
            <span>{t('来源类型')}</span>
            <span>{t('当前知识')}</span>
            <span>{t('索引状态')}</span>
            <span>{t('索引时间')}</span>
          </div>
          {sourceEntries.map((entry) => {
            return (
              <button
                key={entry.source}
                type="button"
                className="dashboard-knowledge-source-row"
                aria-label={t('查看来源：{0}', [entry.source])}
                onClick={() => void onSelectSource(entry)}
              >
                <span>
                  <FileTextOutlined aria-hidden="true" />
                  <code>{entry.source}</code>
                </span>
                <span>{projectKnowledgeCorpusKindLabel(entry.kind)}</span>
                <strong>
                  {entry.records.length}
                  {t(' 条')}
                </strong>
                <span className="dashboard-knowledge-record-state is-proven">
                  <span aria-hidden="true" />
                  {t('已索引')}
                </span>
                <time dateTime={entry.latestUpdatedAt}>
                  {formatTimestamp(entry.latestUpdatedAt)}
                </time>
              </button>
            );
          })}
        </div>
      )}
      <ProjectKnowledgeSourcePreviewModal
        selectedSource={selectedSource}
        sourceContent={sourceContent}
        sourceReadPending={sourceReadPending}
        sourceReadError={sourceReadError}
        onClose={onCloseSource}
        onSelectRecord={onSelectRecord}
      />
    </section>
  );
}

function ProjectKnowledgeQuery({
  queryText,
  onQueryTextChange,
  queryResults,
  queryCompleted,
  queryPending,
  onPreviewQuery,
  retrieval,
  queryTruncated,
  queryLatency,
  queryCandidateCount,
}) {
  useDashboardLanguage();
  const tabMotion = useDashboardMotion('query', 'fade');
  const [selectedResult, setSelectedResult] = useState(null);
  const [resultPreview, setResultPreview] = useState({ status: 'idle' });
  useEffect(() => {
    if (!selectedResult) return undefined;
    let cancelled = false;
    setResultPreview({ status: 'loading' });
    void renderMarkdown(selectedResult.content ?? '')
      .then((html) => {
        if (!cancelled) setResultPreview({ status: 'success', html });
      })
      .catch(() => {
        if (!cancelled) setResultPreview({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResult]);
  return (
    <section
      ref={tabMotion}
      data-dashboard-motion="tab"
      className="dashboard-knowledge-query-view"
      aria-label={t('检索测试')}
    >
      <div className="dashboard-knowledge-query-form">
        <Input.TextArea
          value={queryText}
          aria-label={t('查询项目知识')}
          placeholder={t('例如：修改项目知识模块后应该运行哪些测试？')}
          disabled={queryPending}
          autoSize={{ minRows: 4, maxRows: 8 }}
          onChange={(event) => onQueryTextChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void onPreviewQuery();
            }
          }}
        />
        <div className="dashboard-knowledge-query-action">
          <span className="dashboard-knowledge-query-hint">
            {t('输入任务描述，预览匹配的项目知识')}
          </span>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            disabled={queryText.trim().length === 0 || queryPending}
            loading={queryPending}
            onClick={() => void onPreviewQuery()}
          >
            {t('测试检索')}
          </Button>
        </div>
      </div>
      {retrieval && <p className="dashboard-knowledge-query-note">{retrieval}</p>}
      {queryCompleted && (
        <p className="dashboard-knowledge-query-note">
          {typeof queryLatency === 'number'
            ? t('本次查询 {0} ms', [queryLatency])
            : t('本次查询已完成')}
          {typeof queryCandidateCount === 'number' ? t(' · {0} 个候选', [queryCandidateCount]) : ''}
          {queryTruncated ? t(' · 结果已截断') : ''}
        </p>
      )}
      <div className="dashboard-knowledge-query-results" aria-label={t('项目知识查询结果')}>
        {queryResults.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              queryPending
                ? t('正在检索当前项目知识…')
                : queryCompleted
                  ? t('检索已完成，没有找到与当前任务匹配的项目知识')
                  : t('运行检索后在这里查看结果')
            }
          />
        ) : (
          queryResults.slice(0, 8).map((result, index) => (
            <article key={`${result.source}-${index}`}>
              <header>
                <strong>{result.title ?? t('项目知识结果')}</strong>
                <code>{result.source}</code>
                <Button
                  type="link"
                  aria-label={t('查看检索结果：{0}', [result.title ?? t('项目知识结果')])}
                  onClick={() => setSelectedResult(result)}
                >
                  {t('查看详情')}
                </Button>
              </header>
              <p>{result.content}</p>
            </article>
          ))
        )}
      </div>
      <ProjectKnowledgePreviewModal
        open={selectedResult !== null}
        title={t('检索结果详情')}
        subtitle={selectedResult?.title}
        description={t('查看本次检索返回的内容片段')}
        ariaLabel={t('检索结果详情')}
        onClose={() => setSelectedResult(null)}
      >
        {() => (
          <div className="dashboard-knowledge-preview-content">
            <div className="dashboard-knowledge-preview-scroll">
              <code>{selectedResult?.source}</code>
              {resultPreview.status === 'success' ? (
                <article
                  className="md-github"
                  dangerouslySetInnerHTML={{ __html: resultPreview.html }}
                />
              ) : resultPreview.status === 'error' ? (
                <p>{t('内容预览失败，请关闭后重试。')}</p>
              ) : (
                <Skeleton active />
              )}
            </div>
          </div>
        )}
      </ProjectKnowledgePreviewModal>
    </section>
  );
}

function ContextManifestPreview({
  items,
  emptyLabel,
  onSelectItem,
  detailMode = 'inline',
  title = t('最近一次任务使用的记忆'),
  description = t('这里只展示真正提供给 Agent 的内容，不是全部已保存记忆'),
  presentation = 'list',
  labels = {},
}) {
  useDashboardLanguage();
  const manifest = Array.isArray(items) ? items : [];
  const isSummary = presentation === 'summary';
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [selectedDetailItem, setSelectedDetailItem] = useState(null);
  const latestApplication = manifest[0]?.lastApplication ?? manifest[0];
  const latestAt = latestApplication?.appliedAt;
  const latestTask = latestApplication?.task;
  const detailLabel = labels.detailLabel ?? t('记忆详情');
  const contentLabel = labels.contentLabel ?? t('记忆内容');
  const typeLabel = labels.typeLabel ?? t('记忆类型');
  const deliveryLabel = labels.deliveryLabel ?? t('提供内容');
  const outcomeLabel = labels.outcomeLabel ?? t('结果');
  const summaryCountLabel = labels.summaryCountLabel ?? t('条记忆');
  const toggleLabel = labels.toggleLabel ?? (() => t('查看{0}', [detailLabel]));
  const toggleItem = (item) => {
    if (detailMode === 'modal') {
      setSelectedDetailItem(item);
      onSelectItem?.(item);
      return;
    }
    setExpandedItemId((currentId) => (currentId === item.id ? null : item.id));
    onSelectItem?.(item);
  };
  const openSummaryDetails = () => {
    const firstItem = manifest[0];
    if (!firstItem || detailMode !== 'modal') return;
    setSelectedDetailItem(firstItem);
    onSelectItem?.(firstItem);
  };
  return (
    <section
      className={`dashboard-context-manifest${isSummary ? ' is-summary' : ''}`}
      aria-label={title}
    >
      {isSummary ? (
        manifest.length === 0 ? (
          <p>{emptyLabel}</p>
        ) : (
          <div className="dashboard-context-manifest-summary">
            <div className="dashboard-context-manifest-summary-copy">
              <strong>{t('最近使用')}</strong>
              <span>{latestTask ? t('任务：{0}', [latestTask]) : description}</span>
            </div>
            <div className="dashboard-context-manifest-summary-meta">
              <span>
                {manifest.length} {summaryCountLabel}
              </span>
              {latestAt && <time dateTime={latestAt}>{formatTimestamp(latestAt)}</time>}
              {detailMode === 'modal' && (
                <button
                  type="button"
                  className="dashboard-context-manifest-summary-action"
                  onClick={openSummaryDetails}
                >
                  {t('查看使用明细')}
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <>
          <header>
            <div>
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
            <span>
              {latestTask ? t('任务：{0} · ', [latestTask]) : ''}
              {manifest.length}
              {t(' 条')}
              {latestAt ? ` · ${formatTimestamp(latestAt)}` : ''}
            </span>
          </header>
          {manifest.length === 0 ? (
            <p>{emptyLabel}</p>
          ) : (
            <div className="dashboard-context-manifest-items">
              {manifest.slice(0, 8).map((item) => {
                const expanded = expandedItemId === item.id;
                const detailId = `context-manifest-detail-${item.id}`;
                return (
                  <article
                    key={item.id}
                    className={detailMode === 'inline' && expanded ? 'is-expanded' : ''}
                  >
                    <button
                      type="button"
                      className="dashboard-context-manifest-item-toggle"
                      aria-expanded={detailMode === 'inline' ? expanded : undefined}
                      aria-controls={detailMode === 'inline' ? detailId : undefined}
                      aria-label={`${toggleLabel(expanded)}：${item.title}`}
                      onClick={() => toggleItem(item)}
                    >
                      <span>
                        <strong>{item.title}</strong>
                        <span>{contextMemorySourceLabel(item.memoryType)}</span>
                      </span>
                      <span>
                        {detailMode === 'modal'
                          ? t('查看详情')
                          : expanded
                            ? t('收起详情')
                            : t('展开详情')}
                      </span>
                    </button>
                    <p className="dashboard-context-manifest-item-preview">
                      {formatContextManifestPreview(item.summary)}
                    </p>
                    <dl>
                      <div>
                        <dt>{t('为什么使用')}</dt>
                        <dd>{systemText(item.whyApplied) || t('未记录应用原因')}</dd>
                      </div>
                      <div>
                        <dt>{deliveryLabel}</dt>
                        <dd>{contextDeliveryLabel(item.lastApplication ?? item)}</dd>
                      </div>
                      <div>
                        <dt>{outcomeLabel}</dt>
                        <dd>
                          {contextOutcomeLabel(item.outcome ?? item.lastApplication?.outcome)}
                        </dd>
                      </div>
                    </dl>
                    {detailMode === 'inline' && expanded && (
                      <section
                        id={detailId}
                        className="dashboard-context-manifest-item-detail"
                        aria-label={`${detailLabel}：${item.title}`}
                      >
                        <div>
                          <span>{typeLabel}</span>
                          <p>{contextMemorySourceLabel(item.memoryType)}</p>
                        </div>
                        <div>
                          <span>{contentLabel}</span>
                          <p>{item.summary || t('暂无可展示内容')}</p>
                        </div>
                        <dl>
                          <div>
                            <dt>{t('为什么使用')}</dt>
                            <dd>{systemText(item.whyApplied) || t('未记录应用原因')}</dd>
                          </div>
                          <div>
                            <dt>{deliveryLabel}</dt>
                            <dd>{contextDeliveryLabel(item.lastApplication ?? item)}</dd>
                          </div>
                          <div>
                            <dt>{outcomeLabel}</dt>
                            <dd>
                              {contextOutcomeLabel(item.outcome ?? item.lastApplication?.outcome)}
                            </dd>
                          </div>
                          <div>
                            <dt>{t('最近应用')}</dt>
                            <dd>
                              {formatTimestamp(item.lastApplication?.appliedAt ?? item.appliedAt)}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {detailMode === 'modal' && (
        <ContextManifestDetailsModal
          item={selectedDetailItem}
          items={isSummary ? manifest : undefined}
          open={selectedDetailItem !== null}
          labels={labels}
          onClose={() => setSelectedDetailItem(null)}
          onSelectItem={(item) => {
            setSelectedDetailItem(item);
            onSelectItem?.(item);
          }}
        />
      )}
    </section>
  );
}

const PROJECT_MEMORY_TYPE_META = localized({
  fact: { label: '项目事实', tone: 'blue' },
  decision: { label: '技术决策', tone: 'purple' },
  pattern: { label: '工程惯例', tone: 'green' },
  procedure: { label: '流程步骤', tone: 'cyan' },
  constraint: { label: '项目约束', tone: 'orange' },
  'failure-resolution': { label: '故障处理', tone: 'red' },
});

function projectMemoryTypeLabel(type) {
  return PROJECT_MEMORY_TYPE_META[type]?.label ?? type ?? t('项目记忆');
}

function ProjectMemoryPanel({ summary, readOnly = false, onInvoke, viewScope }) {
  const dashboardLanguage = useDashboardLanguage();
  const tabMotion = useDashboardMotion('project-memory', 'fade');
  const memoryScope = `${viewScope}:project-memory:${summary?.directory ?? ''}`;
  const [searchText, setSearchText] = useDashboardViewState(memoryScope, 'searchText', '');
  const [selectedSlug, setSelectedSlug] = useDashboardViewState(memoryScope, 'selectedSlug', null);
  const [detail, setDetail] = useState(null);
  const [detailPending, setDetailPending] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const invokeRef = useRef(onInvoke);
  useEffect(() => {
    invokeRef.current = onInvoke;
  }, [onInvoke]);
  const entries = useMemo(
    () => (Array.isArray(summary?.entries) ? summary.entries : []),
    [summary?.entries, dashboardLanguage],
  );
  const visibleEntries = useMemo(() => {
    const search = searchText.trim().toLocaleLowerCase(getDashboardLocale());
    if (!search) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.description, entry.slug, projectMemoryTypeLabel(entry.type)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(getDashboardLocale())
        .includes(search),
    );
  }, [entries, searchText, dashboardLanguage]);
  const selectedEntry =
    visibleEntries.find((entry) => entry.slug === selectedSlug) ?? visibleEntries[0] ?? null;
  const selectedKey = selectedEntry?.slug ?? null;
  const directory = summary?.directory ?? '';
  const detailMotion = useDashboardMotion(`${directory}:${selectedKey ?? ''}`, 'fade');
  const currentDetail =
    detail?.directory === directory && detail?.value?.slug === selectedKey ? detail.value : null;
  useEffect(() => {
    if (selectedKey !== selectedSlug) setSelectedSlug(selectedKey);
  }, [selectedKey, selectedSlug]);
  useEffect(() => {
    let cancelled = false;
    setDetailError(null);
    if (!selectedKey) {
      setDetail(null);
      setDetailPending(false);
      return undefined;
    }
    setDetailPending(true);
    invokeRef
      .current('memory-get', { slug: selectedKey })
      .then((result) => {
        if (cancelled) return;
        if (result?.kind !== 'memory') setDetailError(t('项目记忆内容读取失败'));
        else setDetail({ directory, value: result });
      })
      .catch((error) => {
        if (!cancelled)
          setDetailError(error instanceof Error ? error.message : t('项目记忆内容读取失败'));
      })
      .finally(() => {
        if (!cancelled) setDetailPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directory, selectedKey, selectedEntry?.updated]);
  const emptyDescription = searchText.trim()
    ? t('没有匹配的项目记忆')
    : t(
        '还没有项目记忆。任务结束时 Agent 会把验证过、可复用的经验通过 comet knowledge remember 写入这里。',
      );
  return (
    <div className="dashboard-project-memory">
      <section className="dashboard-memory-registry" aria-label={t('项目记忆列表')}>
        <div className="dashboard-memory-registry-toolbar">
          <div>
            <span className="dashboard-contextual-title">
              <strong>{t('项目记忆')}</strong>
              <CompactHelpButton
                ariaLabel={t('了解项目记忆')}
                title={t('项目记忆')}
                description={t('项目记忆是 Agent 在任务结束时直接写入的可复用经验')}
                example={t('与项目知识不同：写入不经过评审队列，索引每次任务都会注入给 Agent。')}
              />
            </span>
            <span>
              {visibleEntries.length}
              {t(' 条')}
              {typeof summary?.applicationCount === 'number' && summary.applicationCount > 0
                ? t(' · 已随任务注入 {0} 次', [summary.applicationCount])
                : ''}
              {summary?.lastApplication
                ? t(' · 最近注入 {0}', [formatTimestamp(summary.lastApplication.appliedAt)])
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="dashboard-project-memory-search"
              value={searchText}
              prefix={<SearchOutlined />}
              allowClear
              placeholder={t('搜索标题、摘要或记忆标识')}
              aria-label={t('搜索项目记忆')}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </div>
        <div className="dashboard-memory-table-head" aria-hidden="true">
          <span>{t('记忆标题与摘要')}</span>
          <span>{t('类型')}</span>
          <span>{t('更新时间')}</span>
          <span />
        </div>
        <div
          ref={tabMotion}
          data-dashboard-motion="tab"
          className="dashboard-memory-table-body"
          data-dashboard-scroll="project-memory-list"
        >
          {visibleEntries.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
          ) : (
            visibleEntries.map((entry) => {
              const isSelected = selectedEntry?.slug === entry.slug;
              return (
                <div
                  key={entry.slug}
                  className={`dashboard-memory-table-row dashboard-project-memory-row${
                    isSelected ? ' is-selected' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedSlug(entry.slug)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedSlug(entry.slug);
                    }
                  }}
                >
                  <div className="dashboard-memory-table-copy">
                    <div className="dashboard-memory-table-title-row">
                      <strong>{entry.title}</strong>
                      <span className="dashboard-record-origin">{entry.slug}</span>
                    </div>
                    <p>{entry.description}</p>
                  </div>
                  <div className="dashboard-project-memory-type">
                    <Tag color={PROJECT_MEMORY_TYPE_META[entry.type]?.tone}>
                      {projectMemoryTypeLabel(entry.type)}
                    </Tag>
                  </div>
                  <div className="dashboard-memory-table-time">
                    {formatTimestamp(entry.updated)}
                  </div>
                  <div className="dashboard-memory-record-actions">
                    <Tooltip title={t('删除项目记忆')}>
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('删除项目记忆 {0}', [entry.title])}
                        disabled={readOnly}
                        onClick={(event) => {
                          event.stopPropagation();
                          onInvoke('forget', { memory: entry.slug });
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {directory && (
          <div className="dashboard-project-memory-foot" title={directory}>
            {t('存储位置：')}
            {directory}
          </div>
        )}
      </section>
      <aside
        ref={detailMotion}
        data-dashboard-motion="detail"
        className="dashboard-memory-inspector"
        data-dashboard-scroll="project-memory-inspector"
        aria-label={t('项目记忆详情')}
      >
        {selectedEntry ? (
          <>
            <div className="dashboard-memory-inspector-head">
              <span>{projectMemoryTypeLabel(selectedEntry.type)}</span>
              <strong>{selectedEntry.title}</strong>
              <p>{selectedEntry.description}</p>
            </div>
            <section>
              {detailPending && !currentDetail ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : detailError && !currentDetail ? (
                <Alert
                  type="warning"
                  showIcon
                  message={t('记忆内容暂不可用')}
                  description={detailError}
                />
              ) : (
                <>
                  <h4>{t('记忆内容')}</h4>
                  {detailError && (
                    <Alert
                      type="warning"
                      showIcon
                      message={t('记忆内容更新失败')}
                      description={detailError}
                    />
                  )}
                  <pre
                    className="dashboard-project-memory-body"
                    data-dashboard-scroll="project-memory-body"
                  >
                    {currentDetail?.body ?? ''}
                  </pre>
                </>
              )}
            </section>
            <section>
              <h4>{t('记忆信息')}</h4>
              <div className="dashboard-memory-inspector-list">
                <div>
                  <span>{t('记忆标识')}</span>
                  <strong>{selectedEntry.slug}</strong>
                </div>
                <div>
                  <span>{t('创建时间')}</span>
                  <strong>{formatTimestamp(selectedEntry.created)}</strong>
                </div>
                <div>
                  <span>{t('更新时间')}</span>
                  <strong>{formatTimestamp(selectedEntry.updated)}</strong>
                </div>
                {(selectedEntry.paths ?? []).length > 0 && (
                  <div>
                    <span>{t('相关路径')}</span>
                    <strong>{selectedEntry.paths.join('、')}</strong>
                  </div>
                )}
                {selectedEntry.source && (
                  <div>
                    <span>{t('来源')}</span>
                    <strong>{selectedEntry.source}</strong>
                  </div>
                )}
              </div>
            </section>
            <section>
              <h4>{t('使用方式')}</h4>
              <div className="dashboard-memory-inspector-list">
                <div>
                  <span>{t('Agent 展开')}</span>
                  <strong>--expand-context &quot;project-memory:{selectedEntry.slug}&quot;</strong>
                </div>
              </div>
            </section>
            <div className="dashboard-project-memory-inspector-actions">
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={readOnly}
                onClick={() => onInvoke('forget', { memory: selectedEntry.slug })}
              >
                {t('删除这条项目记忆')}
              </Button>
            </div>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('选择一条项目记忆查看完整内容')}
          />
        )}
      </aside>
    </div>
  );
}

function ProjectKnowledgeCenter({ page, data, readOnly = false, onInvoke, viewScope }) {
  const dashboardLanguage = useDashboardLanguage();
  const snapshot = data && typeof data === 'object' ? data : {};
  const [workspaceTab, setWorkspaceTab] = useDashboardViewState(viewScope, 'workspaceTab', 'model');
  const previousWorkspaceTab = useRef(workspaceTab);
  const [recordSearchText, setRecordSearchText] = useDashboardViewState(
    viewScope,
    'recordSearchText',
    '',
  );
  const [sourceSearchText, setSourceSearchText] = useDashboardViewState(
    viewScope,
    'sourceSearchText',
    '',
  );
  const [selectedSource, setSelectedSource] = useState(null);
  const [sourceContent, setSourceContent] = useState(null);
  const [sourceReadPending, setSourceReadPending] = useState(false);
  const [sourceReadError, setSourceReadError] = useState(null);
  const sourceContentCacheRef = useRef(new Map());
  const [queryText, setQueryText] = useState('');
  const [queryPending, setQueryPending] = useState(false);
  const [stateFilter, setStateFilter] = useDashboardViewState(viewScope, 'stateFilter', 'active');
  const [categoryFilter, setCategoryFilter] = useDashboardViewState(
    viewScope,
    'categoryFilter',
    'all',
  );
  const [sortOrder, setSortOrder] = useDashboardViewState(viewScope, 'sortOrder', 'newest');
  const [selectedRecordId, setSelectedRecordId] = useDashboardViewState(
    viewScope,
    'selectedRecordId',
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    type: 'constraint',
    title: '',
    summary: '',
    applicablePaths: '',
    operations: '',
    phases: '',
    sources: '',
    verification: '',
  });
  const records = useMemo(
    () => (Array.isArray(snapshot.records) ? snapshot.records : []),
    [snapshot.records, dashboardLanguage],
  );
  const workspaceRecords = useMemo(
    () =>
      workspaceTab === 'model'
        ? records.filter((record) => PROJECT_MODEL_TYPES.has(record.type))
        : workspaceTab === 'policy'
          ? records.filter((record) => !PROJECT_MODEL_TYPES.has(record.type))
          : workspaceTab === 'history'
            ? records.filter((record) => record.state === 'superseded')
            : records,
    [records, workspaceTab, dashboardLanguage],
  );
  const visibleRecords = useMemo(() => {
    const search = recordSearchText.trim().toLocaleLowerCase(getDashboardLocale());
    const filtered = workspaceRecords.filter((record) => {
      if (!projectKnowledgeStateMatches(record, stateFilter)) return false;
      if (categoryFilter !== 'all' && record.type !== categoryFilter) return false;
      if (!search) return true;
      const searchable = [
        record.title,
        record.summary,
        knowledgeText(record, record.title),
        knowledgeText(record, record.summary),
        record.id,
        projectKnowledgeTypeLabel(record.type),
        ...projectKnowledgeRecordSources(record),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(getDashboardLocale());
      return searchable.includes(search);
    });
    return filtered.toSorted((left, right) => {
      const delta =
        new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
      return sortOrder === 'oldest' ? -delta : delta;
    });
  }, [
    categoryFilter,
    recordSearchText,
    sortOrder,
    stateFilter,
    workspaceRecords,
    dashboardLanguage,
  ]);
  const selectedRecord =
    visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null;
  const indexedSourcePaths = useMemo(
    () =>
      new Set(
        (Array.isArray(snapshot.local?.sources) ? snapshot.local.sources : []).map((source) =>
          projectKnowledgeSourcePath(source.source),
        ),
      ),
    [snapshot.local?.sources, dashboardLanguage],
  );
  const sourceEntries = useMemo(() => {
    const sourceMap = new Map();
    for (const source of Array.isArray(snapshot.local?.sources) ? snapshot.local.sources : []) {
      const sourcePath = projectKnowledgeSourcePath(source.source);
      sourceMap.set(sourcePath, {
        source: sourcePath,
        records: [],
        latestUpdatedAt: source.updatedAt,
        indexed: true,
        kind: source.kind,
      });
    }
    for (const record of records.filter((record) => record.state !== 'superseded')) {
      for (const sourceReference of projectKnowledgeRecordSources(record)) {
        const sourcePath = projectKnowledgeSourcePath(sourceReference);
        const current = sourceMap.get(sourcePath);
        if (!current) continue;
        if (!current.records.some((entry) => entry.id === record.id)) current.records.push(record);
      }
    }
    return Array.from(sourceMap.values()).toSorted((left, right) =>
      left.source.localeCompare(right.source, getDashboardLocale()),
    );
  }, [records, snapshot.local?.sources, dashboardLanguage]);
  const visibleSourceEntries = useMemo(() => {
    const search = sourceSearchText.trim().toLocaleLowerCase(getDashboardLocale());
    if (!search) return sourceEntries;
    return sourceEntries.filter((entry) => {
      const searchable = [
        entry.source,
        entry.kind,
        ...entry.records.flatMap((record) => [record.title, record.summary]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(getDashboardLocale());
      return searchable.includes(search);
    });
  }, [sourceEntries, sourceSearchText, dashboardLanguage]);
  useEffect(() => {
    if (selectedRecord?.id && selectedRecord.id !== selectedRecordId) {
      setSelectedRecordId(selectedRecord.id);
    }
  }, [selectedRecord, selectedRecordId]);
  useEffect(() => {
    if (previousWorkspaceTab.current === workspaceTab) return;
    previousWorkspaceTab.current = workspaceTab;
    setCategoryFilter('all');
    setSelectedRecordId((currentId) =>
      currentId && workspaceRecords.some((record) => record.id === currentId) ? currentId : null,
    );
  }, [workspaceRecords, workspaceTab]);
  const queryPreview = isDashboardRecord(snapshot.queryPreview) ? snapshot.queryPreview : null;
  const queryCompleted =
    !queryPending && queryPreview?.kind === 'search' && queryPreview.task === queryText.trim();
  const queryResults =
    queryCompleted && Array.isArray(queryPreview.results) ? queryPreview.results : [];
  const previewQuery = async () => {
    if (!queryText.trim() || queryPending) return;
    setQueryPending(true);
    try {
      await onInvoke('query', { task: queryText.trim() });
    } finally {
      setQueryPending(false);
    }
  };
  const updateQueryText = (value) => {
    setQueryText(value);
  };
  const closeSource = () => {
    setSelectedSource(null);
    setSourceContent(null);
    setSourceReadError(null);
    setSourceReadPending(false);
  };
  const selectSource = async (entry) => {
    const cachedContent = sourceContentCacheRef.current.get(entry.source);
    setSelectedSource(entry);
    setSourceReadError(null);
    if (cachedContent) {
      setSourceContent(cachedContent);
      setSourceReadPending(false);
      return;
    }
    setSourceContent(null);
    setSourceReadPending(true);
    try {
      const result = await onInvoke('read-source', { source: entry.source });
      if (result?.kind !== 'source') {
        setSourceReadError(t('来源文件无法读取'));
      } else {
        sourceContentCacheRef.current.set(entry.source, result);
        setSourceContent(result);
      }
    } catch (error) {
      setSourceReadError(error instanceof Error ? error.message : t('来源文件无法读取'));
    } finally {
      setSourceReadPending(false);
    }
  };
  const selectSourceRecord = (record) => {
    closeSource();
    setWorkspaceTab(PROJECT_MODEL_TYPES.has(record.type) ? 'model' : 'policy');
    setStateFilter(record.state === 'superseded' ? 'superseded' : 'active');
    setSelectedRecordId(record.id);
  };
  const provider =
    snapshot.provider === 'remote'
      ? t('远程提供器')
      : snapshot.provider === 'local'
        ? t('本地提供器')
        : t('未读取');
  const configured =
    typeof snapshot.configured === 'boolean'
      ? snapshot.configured
        ? t('配置有效')
        : t('需要检查')
      : '—';
  const diagnostics =
    Array.isArray(snapshot.diagnostics) && snapshot.diagnostics.length > 0
      ? snapshot.diagnostics
      : (page.diagnostics ?? []);
  const disabled = page.status === 'disabled';
  const serviceHealthy =
    !disabled &&
    configured !== t('需要检查') &&
    snapshot.status?.healthy !== false &&
    snapshot.local?.available !== false &&
    diagnostics.length === 0;
  const knowledgeCounts = snapshot.counts ?? {
    active: records.filter((record) => record.state !== 'superseded').length,
    trial: records.filter((record) => record.state === 'trial').length,
    proven: records.filter((record) => record.state === 'proven').length,
    enforced: records.filter((record) => record.state === 'enforced').length,
    superseded: records.filter((record) => record.state === 'superseded').length,
  };
  const activeKnowledgeGroup =
    PROJECT_KNOWLEDGE_CATEGORY_GROUPS.find((group) => group.key === workspaceTab) ??
    PROJECT_KNOWLEDGE_CATEGORY_GROUPS[0];
  const activeKnowledgeHelp =
    workspaceTab === 'history'
      ? {
          description: t('已经替代、失效或被纠正的项目知识，只用于回顾。'),
          example: t('查看旧版本为何停止提供，以及它被哪条知识替代。'),
        }
      : categoryFilter === 'all'
        ? activeKnowledgeGroup
        : projectKnowledgeTypeMeta(categoryFilter);
  const activeKnowledgeLabel =
    workspaceTab === 'history'
      ? t('历史版本')
      : categoryFilter === 'all'
        ? activeKnowledgeGroup.label
        : projectKnowledgeTypeLabel(categoryFilter);

  return (
    <div className="dashboard-tool-page dashboard-tool-page-knowledge min-w-0">
      <header className="dashboard-knowledge-workspace-head" aria-label={t('项目规则状态与操作')}>
        <div className="dashboard-contextual-title">
          <span
            className={`dashboard-knowledge-service-state ${serviceHealthy ? 'is-healthy' : 'is-warning'}`}
          >
            <span className="dashboard-tool-state-dot" aria-hidden="true" />
            {disabled ? t('服务已暂停') : serviceHealthy ? t('服务正常') : t('需要处理')}
          </span>
          <CompactHelpButton
            ariaLabel={t('了解项目知识分类')}
            title={t('项目知识分类')}
            description={t('项目知识帮助 Agent 理解项目并遵守已有约定')}
            items={PROJECT_KNOWLEDGE_CATEGORY_GROUPS}
          />
          <span className="dashboard-knowledge-workspace-meta">
            {t('当前有效 ')}
            {knowledgeCounts.active}
            {t(' 条 · 历史 ')}
            {knowledgeCounts.superseded}
            {t(' 条')}
            {snapshot.truncated ? t(' · 列表已截断') : ''}
            {snapshot.pendingHostReviewCount > 0
              ? t(' · {0} 条经验待 Agent 评审', [snapshot.pendingHostReviewCount])
              : ''}
          </span>
        </div>
        <Button
          className="dashboard-knowledge-create-button dashboard-plugin-primary-action"
          type="primary"
          icon={<PlusOutlined />}
          disabled={readOnly}
          onClick={() => setCreateOpen(true)}
        >
          {t('新增项目知识')}
        </Button>
      </header>
      {disabled && (
        <Alert
          className="dashboard-knowledge-paused-alert"
          type="info"
          showIcon
          message={page.projectPaused ? t('当前项目已暂停项目知识') : t('项目知识插件已停用')}
          description={
            page.projectPaused
              ? t('只影响当前项目，项目文件和插件配置仍然保留。')
              : t('插件状态和项目文件仍然保留，重新启用后即可继续使用。')
          }
          action={
            <Button onClick={() => onInvoke('lifecycle', { action: 'enable' })}>
              {t('重新启用')}
            </Button>
          }
        />
      )}
      {snapshot.partial && (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message={t('部分内容暂不可用，可继续使用已加载的内容。')}
          description={
            snapshot.cachedSections?.length
              ? t('显示上次读取的记录，恢复后刷新即可更新。')
              : t('请稍后刷新，或检查服务配置。')
          }
        />
      )}
      <ContextManifestPreview
        items={snapshot.manifestPreview}
        emptyLabel={t('最近还没有向 Agent 提供项目知识')}
        detailMode="modal"
        presentation="summary"
        title={t('最近一次任务使用的项目知识')}
        description={t('这里只展示本次任务实际提供给 Agent 的项目知识，不是全部已保存项目知识')}
        labels={{
          detailLabel: t('项目知识详情'),
          contentLabel: t('项目知识内容'),
          typeLabel: t('项目知识类型'),
          deliveryLabel: t('提供给 Agent 的内容'),
          outcomeLabel: t('应用结果'),
          summaryCountLabel: t('条项目知识'),
          navigationLabel: t('本次使用的项目知识'),
          toggleLabel: () => t('查看项目知识详情'),
        }}
        onSelectItem={(item) => {
          if (item.id === 'project-memory-index') {
            setWorkspaceTab('memory');
            return;
          }
          if (records.some((record) => record.id === item.id)) setSelectedRecordId(item.id);
        }}
      />
      <nav className="dashboard-knowledge-tabs" role="tablist" aria-label={t('项目知识视图')}>
        {[
          ['model', t('项目概况')],
          ['policy', t('项目规范')],
          ['memory', t('项目记忆')],
          ['history', t('历史版本')],
          ['sources', t('检索语料')],
          ['query', t('检索测试')],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={workspaceTab === key}
            tabIndex={workspaceTab === key ? 0 : -1}
            onKeyDown={(event) => {
              const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')];
              const index = tabs.indexOf(event.currentTarget);
              const target =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (target < 0) return;
              event.preventDefault();
              tabs[target].focus();
              tabs[target].click();
            }}
            className={workspaceTab === key ? 'is-active' : ''}
            onClick={() => {
              setWorkspaceTab(key);
              setStateFilter(key === 'history' ? 'superseded' : 'active');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {workspaceTab === 'model' || workspaceTab === 'policy' || workspaceTab === 'history' ? (
        <ProjectKnowledgeRegistry
          workspaceTab={workspaceTab}
          records={workspaceRecords}
          visibleRecords={visibleRecords}
          selectedRecord={selectedRecord}
          selectedRecordId={selectedRecordId}
          workspaceLabel={activeKnowledgeLabel}
          workspaceHelp={activeKnowledgeHelp}
          onSelectRecord={setSelectedRecordId}
          recordSearchText={recordSearchText}
          onRecordSearchTextChange={setRecordSearchText}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          diagnostics={diagnostics}
          indexedSourcePaths={indexedSourcePaths}
          provider={provider}
          readOnly={readOnly}
          onInvoke={onInvoke}
        />
      ) : workspaceTab === 'sources' ? (
        <ProjectKnowledgeSources
          sourceEntries={visibleSourceEntries}
          totalSourceCount={sourceEntries.length}
          provider={provider}
          searchText={sourceSearchText}
          onSearchTextChange={setSourceSearchText}
          selectedSource={selectedSource}
          sourceContent={sourceContent}
          sourceReadPending={sourceReadPending}
          sourceReadError={sourceReadError}
          onSelectSource={selectSource}
          onCloseSource={closeSource}
          onSelectRecord={selectSourceRecord}
        />
      ) : workspaceTab === 'memory' ? (
        <ProjectMemoryPanel
          viewScope={viewScope}
          summary={snapshot.projectMemory}
          readOnly={readOnly}
          onInvoke={onInvoke}
        />
      ) : (
        <ProjectKnowledgeQuery
          queryText={queryText}
          onQueryTextChange={updateQueryText}
          queryResults={queryResults}
          queryCompleted={queryCompleted}
          queryPending={queryPending}
          onPreviewQuery={previewQuery}
          retrieval={snapshot.retrieval}
          queryTruncated={queryPreview?.truncated === true}
          queryLatency={snapshot.local?.lastQueryMs}
          queryCandidateCount={snapshot.local?.lastCandidateCount}
        />
      )}
      <DashboardModal
        rootClassName="dashboard-create-modal-root dashboard-project-knowledge-modal-root"
        classNames={{
          mask: 'dashboard-create-modal-mask',
          container: 'dashboard-create-modal-content',
        }}
        open={createOpen}
        title={t('新增项目知识')}
        okText={t('保存')}
        cancelText={t('取消')}
        width={720}
        okButtonProps={{
          disabled:
            createDraft.title.trim().length === 0 || createDraft.summary.trim().length === 0,
          loading: createSaving,
        }}
        onClose={() => {
          if (!createSaving) setCreateOpen(false);
        }}
        onOk={async () => {
          if (createDraft.title.trim().length === 0 || createDraft.summary.trim().length === 0)
            return;
          setCreateSaving(true);
          try {
            const result = await onInvoke('create', {
              type: createDraft.type,
              title: createDraft.title.trim(),
              summary: createDraft.summary.trim(),
              applicablePaths: splitProjectKnowledgeLines(createDraft.applicablePaths),
              operations: splitProjectKnowledgeLines(createDraft.operations),
              phases: splitProjectKnowledgeLines(createDraft.phases),
              sources: splitProjectKnowledgeLines(createDraft.sources),
              verification: splitProjectKnowledgeLines(createDraft.verification),
            });
            if (result !== undefined) {
              setCreateOpen(false);
              setCreateDraft({
                type: 'constraint',
                title: '',
                summary: '',
                applicablePaths: '',
                operations: '',
                phases: '',
                sources: '',
                verification: '',
              });
            }
          } finally {
            setCreateSaving(false);
          }
        }}
      >
        <Form className="dashboard-project-knowledge-create-form" layout="vertical" component="div">
          <Form.Item label={t('知识类型')} required>
            <Select
              value={createDraft.type}
              options={PROJECT_KNOWLEDGE_TYPE_OPTIONS}
              onChange={(type) => setCreateDraft((draft) => ({ ...draft, type }))}
              aria-label={t('知识类型')}
            />
          </Form.Item>
          <Form.Item label={t('标题')} required htmlFor="dashboard-new-project-knowledge-title">
            <Input
              id="dashboard-new-project-knowledge-title"
              value={createDraft.title}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, title: event.target.value }))
              }
              placeholder={t('例如：构建与测试约定')}
              aria-label={t('项目知识标题')}
              autoFocus
            />
          </Form.Item>
          <Form.Item
            className="dashboard-create-form-span"
            label={t('摘要')}
            required
            htmlFor="dashboard-new-project-knowledge-summary"
            extra={t('这段内容会作为项目知识提供给当前项目的 Agent。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-summary"
              value={createDraft.summary}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, summary: event.target.value }))
              }
              placeholder={t('例如：修改 domains/ 后先运行对应的定向测试。')}
              aria-label={t('项目知识摘要')}
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item
            label={t('适用路径（可选）')}
            htmlFor="dashboard-new-project-knowledge-paths"
            extra={t('每行一个项目相对路径。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-paths"
              value={createDraft.applicablePaths}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, applicablePaths: event.target.value }))
              }
              placeholder={t('例如：\ndomains/project-knowledge/')}
              aria-label={t('项目知识适用路径')}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
          <Form.Item
            label={t('适用操作（可选）')}
            htmlFor="dashboard-new-project-knowledge-operations"
            extra={t('每行一个操作，例如 build、verify。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-operations"
              value={createDraft.operations}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, operations: event.target.value }))
              }
              placeholder={t('例如：\nverify')}
              aria-label={t('项目知识适用操作')}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
          <Form.Item
            label={t('适用阶段（可选）')}
            htmlFor="dashboard-new-project-knowledge-phases"
            extra={t('每行一个阶段，例如 build、verify。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-phases"
              value={createDraft.phases}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, phases: event.target.value }))
              }
              placeholder={t('例如：\nverify')}
              aria-label={t('项目知识适用阶段')}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
          <Form.Item
            label={t('来源（可选）')}
            htmlFor="dashboard-new-project-knowledge-sources"
            extra={t('每行一个项目相对文件路径；没有来源的记录会标记为未验证。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-sources"
              value={createDraft.sources}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, sources: event.target.value }))
              }
              placeholder={t('例如：\ndocs/project-rules.md')}
              aria-label={t('项目知识来源')}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
          <Form.Item
            className="mb-0"
            label={t('验证命令（可选）')}
            htmlFor="dashboard-new-project-knowledge-verification"
            extra={t('每行一个命令，用来说明如何验证这条知识。')}
          >
            <Input.TextArea
              id="dashboard-new-project-knowledge-verification"
              value={createDraft.verification}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, verification: event.target.value }))
              }
              placeholder={t('例如：\npnpm test --filter project-knowledge')}
              aria-label={t('项目知识验证命令')}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
        </Form>
      </DashboardModal>
    </div>
  );
}

function PersonalMemoryCenter({ data, readOnly = false, onInvoke, viewScope }) {
  useDashboardLanguage();
  const [editingRecord, setEditingRecord] = useState(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfileSaving, setNewProfileSaving] = useState(false);
  const [newProfileText, setNewProfileText] = useState('');
  const [newProfileCategory, setNewProfileCategory] = useState(t('沟通偏好'));
  const [showNewProjectMemory, setShowNewProjectMemory] = useState(false);
  const [newProjectMemorySaving, setNewProjectMemorySaving] = useState(false);
  const [newProjectMemoryText, setNewProjectMemoryText] = useState('');
  const [newProjectMemoryCategory, setNewProjectMemoryCategory] = useState(t('项目约定'));
  const [expandedRecordIds, setExpandedRecordIds] = useDashboardViewState(
    viewScope,
    'expandedRecordIds',
    () => new Set(),
  );
  const [memoryQuery, setMemoryQuery] = useDashboardViewState(viewScope, 'memoryQuery', '');
  const [memoryFilter, setMemoryFilter] = useDashboardViewState(viewScope, 'memoryFilter', 'all');
  const [selectedMemoryId, setSelectedMemoryId] = useDashboardViewState(
    viewScope,
    'selectedMemoryId',
    null,
  );
  const [memoryOffset, setMemoryOffset] = useState(0);
  const [memoryPageOffsets, setMemoryPageOffsets] = useState([]);
  const [memoryMaxBytes, setMemoryMaxBytes] = useState(undefined);
  const [memoryPage, setMemoryPage] = useState(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryLoadError, setMemoryLoadError] = useState(false);
  const invokeRef = useRef(onInvoke);
  invokeRef.current = onInvoke;
  const requestKey = JSON.stringify([
    data?.projectKey,
    memoryQuery.trim(),
    memoryFilter,
    memoryOffset,
    memoryMaxBytes,
  ]);
  const resetMemoryPage = () => {
    setMemoryOffset(0);
    setMemoryPageOffsets([]);
    setMemoryMaxBytes(undefined);
    setMemoryPage(null);
  };
  const invokeMemoryMutation = async (capability, input) => {
    const result = await onInvoke(capability, input);
    resetMemoryPage();
    return result;
  };
  useEffect(() => {
    let current = true;
    if (
      readOnly ||
      (!memoryQuery.trim() &&
        memoryFilter === 'all' &&
        memoryOffset === 0 &&
        memoryMaxBytes === undefined)
    ) {
      setMemoryLoading(false);
      setMemoryLoadError(false);
      setMemoryPage(null);
      return;
    }
    setMemoryLoading(true);
    setMemoryLoadError(false);
    const timer = setTimeout(async () => {
      const result = await invokeRef.current('manage', {
        query: memoryQuery.trim() || undefined,
        managementFilter: memoryFilter,
        offset: memoryOffset,
        ...(memoryMaxBytes === undefined ? {} : { maxBytes: memoryMaxBytes }),
      });
      if (!current) return;
      setMemoryLoading(false);
      if (!result || !Array.isArray(result.records)) {
        setMemoryLoadError(true);
        return;
      }
      if (
        (memoryOffset > 0 && result.total === 0) ||
        (memoryOffset > 0 && result.offset >= result.total)
      ) {
        resetMemoryPage();
        return;
      }
      setMemoryPage({ requestKey, result });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [requestKey, data?.management, readOnly]);
  const status = data?.status ?? {};
  const retrieval = data?.retrieval ?? {};
  const defaultMemoryPage =
    readOnly ||
    (!memoryQuery.trim() &&
      memoryFilter === 'all' &&
      memoryOffset === 0 &&
      memoryMaxBytes === undefined);
  const management = defaultMemoryPage
    ? (data?.management ?? {})
    : memoryPage?.requestKey === requestKey
      ? memoryPage.result
      : {};
  const managedRecords = management.records ?? (defaultMemoryPage ? retrieval.records : []) ?? [];
  const liveRecords = managedRecords.filter(isActiveMemoryRecord);
  const coreRecords = liveRecords.filter((record) => record.memoryType === 'core-profile');
  const policyRecords = liveRecords.filter(
    (record) => record.memoryType === 'collaboration-policy',
  );
  const episodeRecords = liveRecords.filter((record) => record.memoryType === 'personal-episode');
  const historyRecords = managedRecords.filter((record) => !isActiveMemoryRecord(record));
  const memoryCounts = status.counts ?? {
    active: liveRecords.length,
    trial: liveRecords.filter((record) => (record.status ?? record.state) === 'trial').length,
    proven: liveRecords.filter((record) => (record.status ?? record.state) === 'proven').length,
    history: historyRecords.length,
    tombstones: managedRecords.filter((record) => record.status === 'tombstoned').length,
  };
  const totalMemoryRecordCount = memoryCounts.active;
  const notifications = data?.notifications ?? [];
  const projectKey = data?.projectKey;
  const memoryFileCount = status.files?.length ?? 0;
  const provider = status.provider?.provider ?? 'local';
  const learningDiagnostic = personalMemoryLearningDiagnostic(status.learning, status);
  const learningDetails = personalMemoryLearningDetails(status.learning, status);
  const learningCheckedAt = status.learning?.lastCheckedAt
    ? formatTimestamp(status.learning.lastCheckedAt)
    : '';
  const profileUsage = status.profile
    ? t('个人偏好与事实 {0} 字符 · 单次注入预算 {1}', [
        status.profile.usedChars,
        status.profile.maxChars,
      ])
    : provider === 'remote'
      ? t('由 Remote Provider 管理')
      : t('0 / 2000 字符');
  const normalizedMemoryQuery = memoryQuery.trim().toLocaleLowerCase();
  const matchesMemoryQuery = (record) =>
    !readOnly ||
    normalizedMemoryQuery.length === 0 ||
    [record.text, record.category, record.memoryClass, record.reason]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(normalizedMemoryQuery));
  const memoryGroups = [
    {
      key: 'profile',
      title: personalMemoryFilterMeta('profile').label,
      records: coreRecords.filter(matchesMemoryQuery),
    },
    {
      key: 'policy',
      title: personalMemoryFilterMeta('policy').label,
      records: policyRecords.filter(matchesMemoryQuery),
    },
    {
      key: 'episode',
      title: personalMemoryFilterMeta('episode').label,
      records: episodeRecords.filter(matchesMemoryQuery),
    },
    {
      key: 'history',
      title: t('历史记录'),
      records: historyRecords.filter(matchesMemoryQuery),
    },
  ].filter(
    (group) => group.records.length > 0 && (memoryFilter === 'all' || memoryFilter === group.key),
  );
  const visibleMemoryRecords = memoryGroups.flatMap((group) => group.records);
  const activeMemoryFilter = personalMemoryFilterMeta(memoryFilter);
  const selectedRecord =
    visibleMemoryRecords.find((record) => record.id === selectedMemoryId) ??
    visibleMemoryRecords[0] ??
    null;
  const filterMotion = useDashboardMotion(memoryFilter, 'fade');
  const detailMotion = useDashboardMotion(selectedRecord?.id ?? '', 'fade');
  const visibleMemoryKey = visibleMemoryRecords.map((record) => record.id).join('|');
  const memoryEmptyDescription = memoryQuery.trim()
    ? t('没有匹配的个人记忆')
    : memoryFilter === 'history'
      ? t('还没有被替代、遗忘或冲突的历史记忆')
      : totalMemoryRecordCount === 0
        ? memoryCounts.history > 0
          ? t('当前没有有效个人记忆；已有 {0} 条历史记录', [memoryCounts.history])
          : memoryFileCount > 0
            ? t('当前没有有效个人记忆；已有记忆文件中暂无可复用的内容')
            : t('当前还没有形成可复用的个人记忆')
        : activeMemoryFilter.description;

  useEffect(() => {
    if (selectedRecord?.id !== selectedMemoryId) setSelectedMemoryId(selectedRecord?.id ?? null);
  }, [selectedMemoryId, selectedRecord?.id, visibleMemoryKey]);

  const selectMemoryRecord = (record) => setSelectedMemoryId(record.id);
  const toggleMemoryRecord = (recordId) => {
    setExpandedRecordIds((previous) => {
      const next = new Set(previous);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const renderMemoryRecord = (record, groupKey) => {
    const text = typeof record.text === 'string' ? record.text : '';
    const expandable = text.length > MEMORY_COLLAPSE_THRESHOLD;
    const expanded = expandedRecordIds.has(record.id);
    const visibleText =
      expandable && !expanded ? `${text.slice(0, MEMORY_COLLAPSE_THRESHOLD)}…` : text;
    const isSelected = selectedRecord?.id === record.id;
    const active = isActiveMemoryRecord(record);
    const statusLabel = personalMemoryStateLabel(record);
    return (
      <div
        key={record.id}
        className={`dashboard-memory-table-row${isSelected ? ' is-selected' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => selectMemoryRecord(record)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectMemoryRecord(record);
          }
        }}
      >
        <div className="dashboard-memory-table-copy">
          <div className="dashboard-memory-table-title-row">
            <strong>{record.category || personalMemoryTypeLabel(record)}</strong>
            <span>{personalMemoryTypeLabel(record)}</span>
            <span className="dashboard-record-origin">{personalMemoryOriginLabel(record)}</span>
          </div>
          <p className={expandable && !expanded ? 'is-collapsed' : ''}>{visibleText}</p>
          <button
            type="button"
            className="dashboard-memory-why"
            onClick={(event) => {
              event.stopPropagation();
              selectMemoryRecord(record);
            }}
          >
            {t('为什么应用：')}
            {memoryApplicationReason(record)}
          </button>
          {expandable && (
            <Button
              className="dashboard-memory-record-text-toggle"
              size="small"
              type="link"
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                toggleMemoryRecord(record.id);
              }}
            >
              {expanded ? t('收起完整记忆') : t('展开完整记忆')}
            </Button>
          )}
        </div>
        <div className="dashboard-memory-table-scope">
          {record.scope === 'project' ? t('当前项目') : t('全局')}
        </div>
        <div
          className={`dashboard-memory-table-status is-${record.status ?? record.state ?? 'superseded'}`}
        >
          <span aria-hidden="true" />
          {statusLabel}
        </div>
        <div className="dashboard-memory-table-time">{formatTimestamp(record.updatedAt)}</div>
        <div className="dashboard-memory-record-actions">
          <Tooltip title={t('纠正记忆')}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              aria-label={t('纠正记忆')}
              disabled={readOnly}
              onClick={(event) => {
                event.stopPropagation();
                setEditingRecord(record);
                setCorrectionText(record.text);
              }}
            />
          </Tooltip>
          {groupKey !== 'profile' && active && (
            <Tooltip title={t('回滚记忆')}>
              <Button
                size="small"
                type="text"
                icon={<UndoOutlined />}
                aria-label={t('回滚记忆')}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  invokeMemoryMutation('rollback', { id: record.id });
                }}
              />
            </Tooltip>
          )}
          {active && (
            <Tooltip title={t('删除记忆')}>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={t('删除记忆')}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  invokeMemoryMutation('remove', { id: record.id, permanent: true });
                }}
              />
            </Tooltip>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="dashboard-tool-page dashboard-tool-page-memory min-w-0">
      <PluginCenterHeader
        meta={[
          {
            label: 'Provider',
            value: provider === 'remote' ? t('远程提供器') : t('本地提供器'),
            tone: 'accent',
          },
          {
            label: t('范围'),
            value: projectKey ? t('当前项目') : t('全局'),
            tone: 'neutral',
          },
          {
            label: t('记录'),
            value: t('{0} 条记忆', [totalMemoryRecordCount]),
            tone: 'success',
          },
          {
            label: t('历史'),
            value: t('{0} 条', [memoryCounts.history]),
            displayValue: t('历史：{0} 条', [memoryCounts.history]),
            tone: 'neutral',
          },
        ]}
        help={
          <CompactHelpButton
            ariaLabel={t('了解个人记忆分类')}
            title={t('个人记忆分类')}
            description={t('个人记忆按用途和形成方式自动归类')}
            items={PERSONAL_MEMORY_FILTERS.filter((item) => item.key !== 'all')}
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              className="dashboard-plugin-secondary-action"
              icon={<PlusOutlined />}
              disabled={readOnly || !projectKey}
              onClick={() => setShowNewProjectMemory(true)}
            >
              {t('新增项目记忆')}
            </Button>
            <Button
              className="dashboard-plugin-primary-action"
              type="primary"
              icon={<PlusOutlined />}
              disabled={readOnly}
              onClick={() => setShowNewProfile(true)}
            >
              {t('新增偏好')}
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
      {data?.partial && (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message={t('部分内容暂不可用，可继续使用已加载的内容。')}
          description={
            data.cachedSections?.length
              ? t('显示上次读取的记录，恢复后刷新即可更新。')
              : t('请稍后刷新，或检查服务配置。')
          }
        />
      )}
      <ContextManifestPreview
        items={data?.manifestPreview}
        emptyLabel={t('最近还没有向 Agent 提供个人记忆')}
        detailMode="modal"
        presentation="summary"
        labels={{
          detailLabel: t('个人记忆详情'),
          contentLabel: t('记忆内容'),
          typeLabel: t('记忆类型'),
          deliveryLabel: t('提供给 Agent 的内容'),
          outcomeLabel: t('应用结果'),
          summaryCountLabel: t('条记忆'),
          navigationLabel: t('本次使用的个人记忆'),
        }}
        onSelectItem={(item) => {
          if (managedRecords.some((record) => record.id === item.id)) {
            setSelectedMemoryId(item.id);
          }
        }}
      />
      <div className="dashboard-memory-workspace">
        <aside className="dashboard-memory-filter-rail" aria-label={t('记忆筛选')}>
          <div className="dashboard-memory-filter-search">
            <Input
              value={memoryQuery}
              prefix={<SearchOutlined />}
              allowClear
              placeholder={t('搜索记忆…')}
              aria-label={t('搜索个人记忆')}
              onChange={(event) => {
                setMemoryQuery(event.target.value);
                resetMemoryPage();
              }}
            />
          </div>
          <nav>
            {PERSONAL_MEMORY_FILTERS.map((item) => {
              const count =
                management.counts?.[item.key] ??
                (item.key === 'all'
                  ? totalMemoryRecordCount
                  : item.key === 'profile'
                    ? coreRecords.length
                    : item.key === 'policy'
                      ? policyRecords.length
                      : item.key === 'episode'
                        ? episodeRecords.length
                        : historyRecords.length);
              return (
                <Tooltip key={item.key} title={item.description} placement="right">
                  <button
                    type="button"
                    className={memoryFilter === item.key ? 'is-active' : ''}
                    aria-pressed={memoryFilter === item.key}
                    onClick={() => {
                      setMemoryFilter(item.key);
                      resetMemoryPage();
                    }}
                  >
                    <span>{item.label}</span>
                    <strong>{count}</strong>
                  </button>
                </Tooltip>
              );
            })}
          </nav>
          <div className="dashboard-memory-filter-summary">
            <Tooltip title={learningDetails || undefined} placement="right">
              <div
                className="dashboard-memory-learning-diagnostic"
                role="status"
                tabIndex={learningDetails ? 0 : undefined}
              >
                <span>{t('最近学习检查')}</span>
                <strong>{learningDiagnostic}</strong>
                {learningCheckedAt && <small>{learningCheckedAt}</small>}
                {learningDetails && (
                  <span className="dashboard-memory-learning-diagnostic-details">
                    {learningDetails}
                  </span>
                )}
              </div>
            </Tooltip>
            <div>
              <span
                className={`dashboard-tool-state-dot ${
                  status.learningEnabled === true && status.availability !== 'unavailable'
                    ? 'is-success'
                    : 'is-muted'
                }`}
              />
              {t('自动学习')}
              {personalMemoryCapabilityLabel(status, 'learningEnabled', t('已开启'), t('已暂停'))}
            </div>
            <div>
              <span
                className={`dashboard-tool-state-dot ${
                  status.retrievalEnabled === true && status.availability !== 'unavailable'
                    ? 'is-accent'
                    : 'is-muted'
                }`}
              />
              {t('任务注入')}
              {personalMemoryCapabilityLabel(status, 'retrievalEnabled', t('已开启'), t('已暂停'))}
            </div>
            <span>{profileUsage}</span>
            <span>
              {memoryFileCount}
              {t(' 个记忆文件 · ')}
              {memoryCounts.tombstones}
              {t(' 个遗忘保护')}
            </span>
          </div>
        </aside>
        <section className="dashboard-memory-registry" aria-label={t('个人记忆列表')}>
          <div className="dashboard-memory-registry-toolbar">
            <div>
              <span className="dashboard-contextual-title">
                <strong>{activeMemoryFilter.label}</strong>
                <CompactHelpButton
                  ariaLabel={t('了解{0}', [activeMemoryFilter.label])}
                  title={activeMemoryFilter.label}
                  description={activeMemoryFilter.description}
                  example={activeMemoryFilter.example}
                />
              </span>
              <span>
                {visibleMemoryRecords.length}
                {t(' 条')}
              </span>
            </div>
            <Select
              value="updated"
              aria-label={t('记忆排序方式')}
              options={[{ value: 'updated', label: t('最近更新') }]}
            />
          </div>
          <div className="dashboard-memory-table-head" aria-hidden="true">
            <span>{t('记忆内容')}</span>
            <span>{t('作用范围')}</span>
            <span>{t('状态')}</span>
            <span>{t('更新时间')}</span>
            <span />
          </div>
          <div
            ref={filterMotion}
            data-dashboard-motion="tab"
            className="dashboard-memory-table-body"
            data-dashboard-scroll="personal-memory-list"
          >
            {memoryLoading && <p role="status">{t('正在搜索个人记忆…')}</p>}
            {memoryLoadError && (
              <Alert type="error" showIcon message={t('个人记忆加载失败，请重试搜索或刷新页面')} />
            )}
            {(management.conflicts ?? []).map((conflict, index) => (
              <Alert
                key={`${conflict.updatedAt}:${index}`}
                type="warning"
                showIcon
                message={t('记忆证据存在冲突')}
                description={conflict.texts.join(' / ')}
              />
            ))}
            {!memoryLoading && visibleMemoryRecords.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={memoryEmptyDescription} />
            ) : (
              memoryGroups.map((group) => (
                <section key={group.key} className="dashboard-memory-group">
                  <div className="dashboard-memory-group-title">
                    <strong>{group.title}</strong>
                    <span>{group.records.length}</span>
                  </div>
                  {group.records.map((record) => renderMemoryRecord(record, group.key))}
                </section>
              ))
            )}
          </div>
          <div className="dashboard-memory-pagination" aria-label={t('个人记忆分页')}>
            <span role="status">
              {Number.isInteger(management.total)
                ? t('当前显示 {0}–{1} 条，共 {2} 条', [
                    (management.records?.length ?? 0) + (management.conflicts?.length ?? 0) === 0
                      ? 0
                      : (management.offset ?? 0) + 1,
                    (management.offset ?? 0) +
                      (management.records?.length ?? 0) +
                      (management.conflicts?.length ?? 0),
                    management.total,
                  ])
                : t('已加载 {0} 条', [managedRecords.length])}
            </span>
            {management.truncated && (
              <span>{t('本页受条数或字节预算限制，后续记录可继续查看')}</span>
            )}
            <div>
              <Button
                size="small"
                disabled={readOnly || memoryLoading || memoryPageOffsets.length === 0}
                onClick={() => {
                  setMemoryOffset(memoryPageOffsets.at(-1) ?? 0);
                  setMemoryPageOffsets((offsets) => offsets.slice(0, -1));
                  setMemoryMaxBytes(undefined);
                }}
              >
                {t('上一页')}
              </Button>
              <Button
                size="small"
                disabled={
                  readOnly ||
                  memoryLoading ||
                  !Number.isInteger(management.nextOffset) ||
                  management.nextOffset <= memoryOffset
                }
                onClick={() => {
                  setMemoryPageOffsets((offsets) => [...offsets, memoryOffset]);
                  setMemoryOffset(management.nextOffset);
                  setMemoryMaxBytes(undefined);
                }}
              >
                {t('下一页')}
              </Button>
              {management.requiredBytes > 0 && (
                <Button
                  size="small"
                  disabled={memoryLoading}
                  onClick={() => setMemoryMaxBytes(management.requiredBytes)}
                >
                  {t('读取大记录（{0} KB）', [Math.ceil(management.requiredBytes / 1024)])}
                </Button>
              )}
            </div>
          </div>
        </section>
        <aside
          ref={detailMotion}
          data-dashboard-motion="detail"
          className="dashboard-memory-inspector"
          data-dashboard-scroll="personal-memory-inspector"
          aria-label={t('记忆应用详情')}
        >
          {selectedRecord ? (
            <>
              <div className="dashboard-memory-inspector-head">
                <span>{personalMemoryTypeLabel(selectedRecord)}</span>
                <strong>{selectedRecord.category || selectedRecord.title || t('个人记忆')}</strong>
                <p>{selectedRecord.text}</p>
              </div>
              <section>
                <h4>{t('适用条件')}</h4>
                <div className="dashboard-memory-inspector-list">
                  <div>
                    <span>{t('匹配规则')}</span>
                    <strong>{memoryApplicationReason(selectedRecord)}</strong>
                  </div>
                  {(selectedRecord.taskTypes ?? []).length > 0 && (
                    <div>
                      <span>{t('任务类型')}</span>
                      <strong>{selectedRecord.taskTypes.join('、')}</strong>
                    </div>
                  )}
                  {(selectedRecord.pathPatterns ?? []).length > 0 && (
                    <div>
                      <span>{t('路径范围')}</span>
                      <strong>{selectedRecord.pathPatterns.join('、')}</strong>
                    </div>
                  )}
                  {(selectedRecord.operations ?? []).length > 0 && (
                    <div>
                      <span>{t('适用操作')}</span>
                      <strong>{selectedRecord.operations.join('、')}</strong>
                    </div>
                  )}
                  {(selectedRecord.phases ?? []).length > 0 && (
                    <div>
                      <span>{t('适用阶段')}</span>
                      <strong>{selectedRecord.phases.join('、')}</strong>
                    </div>
                  )}
                </div>
              </section>
              <section>
                <h4>{t('最近一次应用')}</h4>
                <div className="dashboard-memory-inspector-list">
                  <div>
                    <span>{t('记忆标识')}</span>
                    <strong>{selectedRecord.id}</strong>
                  </div>
                  <div>
                    <span>{t('加载方式')}</span>
                    <strong>{contextDeliveryLabel(selectedRecord.lastApplication)}</strong>
                  </div>
                  {selectedRecord.lastApplication && (
                    <>
                      <div>
                        <span>{t('最近应用')}</span>
                        <strong>{formatTimestamp(selectedRecord.lastApplication.appliedAt)}</strong>
                      </div>
                      <div>
                        <span>{t('应用结果')}</span>
                        <strong>
                          {contextOutcomeLabel(selectedRecord.lastApplication.outcome)}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
              </section>
              {selectedRecord.memoryType === 'personal-episode' && selectedRecord.episode && (
                <section>
                  <h4>{t('任务经验摘要')}</h4>
                  <div className="dashboard-memory-inspector-list">
                    <div>
                      <span>{t('发生情境')}</span>
                      <strong>{selectedRecord.episode.situation}</strong>
                    </div>
                    <div>
                      <span>{t('采取动作')}</span>
                      <strong>{selectedRecord.episode.actionSummary}</strong>
                    </div>
                    <div>
                      <span>{t('实际结果')}</span>
                      <strong>{selectedRecord.episode.outcome}</strong>
                    </div>
                    <div>
                      <span>{t('可复用经验')}</span>
                      <strong>{selectedRecord.episode.lesson}</strong>
                    </div>
                  </div>
                </section>
              )}
              <ContextApplicationHistory
                applications={selectedRecord.applicationHistory ?? []}
                recordId={selectedRecord.id}
                total={selectedRecord.contextApplicationCount}
                cursor={selectedRecord.applicationHistoryCursor}
                onLoadPage={(cursor) =>
                  onInvoke?.('application-history', { candidateId: selectedRecord.id, cursor })
                }
              />
              <section>
                <h4>{t('作用范围')}</h4>
                <div className="dashboard-memory-inspector-list">
                  <div>
                    <span>{t('范围类型')}</span>
                    <strong>
                      {selectedRecord.scope === 'project' ? t('当前项目') : t('所有项目与对话')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('状态')}</span>
                    <strong>{personalMemoryStateLabel(selectedRecord)}</strong>
                  </div>
                  <div>
                    <span>{t('形成方式')}</span>
                    <strong>
                      {selectedRecord.authority === 'explicit'
                        ? t('用户明确确认')
                        : t('任务经验推断')}
                    </strong>
                  </div>
                </div>
              </section>
              <section>
                <h4>{t('证据来源')}</h4>
                <div className="dashboard-memory-inspector-list">
                  <div>
                    <span>{t('证据数量')}</span>
                    <strong>
                      {selectedRecord.evidenceCount ?? 0}
                      {t(' 条')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('最近更新')}</span>
                    <strong>{formatTimestamp(selectedRecord.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>{t('应用效果')}</span>
                    <strong>
                      {selectedRecord.applicationCount ?? 0}
                      {t(' 次 · 成功')} {selectedRecord.successCount ?? 0}
                      {t(' 次 · 需修正')} {selectedRecord.failureCount ?? 0}
                      {t(' 次')}
                    </strong>
                  </div>
                </div>
                {selectedRecord.reason && <p>{systemText(selectedRecord.reason)}</p>}
              </section>
            </>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('选择一条记忆查看应用原因')}
            />
          )}
        </aside>
      </div>
      <DashboardModal
        rootClassName="dashboard-create-modal-root"
        classNames={{
          mask: 'dashboard-create-modal-mask',
          container: 'dashboard-create-modal-content',
        }}
        width={560}
        open={showNewProfile}
        title={t('新增偏好')}
        okText={t('保存')}
        cancelText={t('取消')}
        okButtonProps={{ disabled: newProfileText.trim().length === 0 }}
        confirmLoading={newProfileSaving}
        onClose={() => {
          if (!newProfileSaving) setShowNewProfile(false);
        }}
        onOk={async () => {
          if (newProfileText.trim().length === 0) return;
          if (newProfileSaving) return;
          setNewProfileSaving(true);
          try {
            const result = await invokeMemoryMutation('remember', {
              scope: 'global',
              memoryClass: 'user-preference',
              category: newProfileCategory.trim() || t('沟通偏好'),
              text: newProfileText.trim(),
            });
            if (result === undefined) return;
            setNewProfileText('');
            setShowNewProfile(false);
          } finally {
            setNewProfileSaving(false);
          }
        }}
      >
        <Form layout="vertical" component="div">
          <Form.Item
            label={t('偏好内容')}
            required
            htmlFor="dashboard-new-profile-content"
            extra={t('记录可在后续任务中复用的稳定偏好')}
          >
            <Input.TextArea
              id="dashboard-new-profile-content"
              value={newProfileText}
              onChange={(event) => setNewProfileText(event.target.value)}
              placeholder={t('例如：以后都用中文回答')}
              aria-label={t('偏好内容')}
              autoFocus
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item
            className="mb-0"
            label={t('主题（可选）')}
            htmlFor="dashboard-new-profile-category"
            extra={t('用于描述记忆关注的内容，不会创建新的系统分组。')}
          >
            <Input
              id="dashboard-new-profile-category"
              value={newProfileCategory}
              onChange={(event) => setNewProfileCategory(event.target.value)}
              placeholder={t('例如：沟通偏好')}
              aria-label={t('主题（可选）')}
            />
          </Form.Item>
        </Form>
      </DashboardModal>
      <DashboardModal
        rootClassName="dashboard-create-modal-root"
        classNames={{
          mask: 'dashboard-create-modal-mask',
          container: 'dashboard-create-modal-content',
        }}
        width={560}
        open={showNewProjectMemory}
        title={t('新增项目记忆')}
        okText={t('保存')}
        cancelText={t('取消')}
        okButtonProps={{ disabled: newProjectMemoryText.trim().length === 0 }}
        confirmLoading={newProjectMemorySaving}
        onClose={() => {
          if (!newProjectMemorySaving) setShowNewProjectMemory(false);
        }}
        onOk={async () => {
          if (!projectKey || newProjectMemoryText.trim().length === 0) return;
          if (newProjectMemorySaving) return;
          setNewProjectMemorySaving(true);
          try {
            const result = await invokeMemoryMutation('remember', {
              scope: 'project',
              projectKey,
              memoryClass: 'project-convention',
              category: newProjectMemoryCategory.trim() || t('项目约定'),
              text: newProjectMemoryText.trim(),
            });
            if (result === undefined) return;
            setNewProjectMemoryText('');
            setNewProjectMemoryCategory(t('项目约定'));
            setShowNewProjectMemory(false);
          } finally {
            setNewProjectMemorySaving(false);
          }
        }}
      >
        <Form layout="vertical" component="div">
          <Form.Item
            label={t('记忆内容')}
            required
            htmlFor="dashboard-new-project-memory-content"
            extra={t('只记录以后在当前项目中仍然有用的个人经验或项目协作偏好')}
          >
            <Input.TextArea
              id="dashboard-new-project-memory-content"
              value={newProjectMemoryText}
              onChange={(event) => setNewProjectMemoryText(event.target.value)}
              placeholder={t('例如：这个项目优先使用最小相关测试')}
              aria-label={t('记忆内容')}
              autoFocus
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item
            className="mb-0"
            label={t('主题（可选）')}
            htmlFor="dashboard-new-project-memory-category"
            extra={t('用于描述记忆关注的内容，不会创建新的系统分组。')}
          >
            <Input
              id="dashboard-new-project-memory-category"
              value={newProjectMemoryCategory}
              onChange={(event) => setNewProjectMemoryCategory(event.target.value)}
              placeholder={t('例如：项目约定')}
              aria-label={t('主题（可选）')}
            />
          </Form.Item>
        </Form>
      </DashboardModal>
      <DashboardModal
        open={editingRecord !== null}
        title={t('纠正这条记忆')}
        okText={t('保存')}
        cancelText={t('取消')}
        okButtonProps={{
          disabled: correctionText.trim().length === 0,
          loading: correctionSaving,
        }}
        onClose={() => setEditingRecord(null)}
        onOk={async () => {
          if (!editingRecord || correctionText.trim().length === 0) return;
          setCorrectionSaving(true);
          try {
            const corrected = await invokeMemoryMutation('correct', {
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
          placeholder={t('输入新的记忆内容')}
        />
      </DashboardModal>
    </div>
  );
}

function personalMemoryCapabilityLabel(status = {}, field, enabledLabel, disabledLabel) {
  if (status.availability === 'unavailable') {
    return t('状态不可用{0}', [status.availabilityReason ? `：${status.availabilityReason}` : '']);
  }
  if (status[field] === undefined) return t('状态未知（Provider 未确认）');
  return status[field] ? enabledLabel : disabledLabel;
}

function personalMemoryLearningDiagnostic(learning = {}, status = {}) {
  if (status.learningAvailability === 'unavailable') {
    return t('不可用{0}', [
      status.learningAvailabilityReason ? `：${status.learningAvailabilityReason}` : '',
    ]);
  }
  if (status.availability === 'unavailable') {
    return t('不可用{0}', [status.availabilityReason ? `：${status.availabilityReason}` : '']);
  }
  if (learning.lastCheck === 'not-run' || learning.lastCheck === undefined) return t('尚未检查');
  if (learning.lastCheck === 'no-observation') return t('本次没有合格观察');
  if (learning.submissionVerified === false) return t('当前 change 没有对应观察');
  switch (learning.lastResult) {
    case 'candidate-created':
      return t('已形成候选，等待独立证据');
    case 'candidate-promoted':
      return t('已晋级为可复用记忆');
    case 'deduplicated':
      return t('已去重，未重复计数');
    case 'deferred':
      return t('评审待重试');
    case 'ignored':
      return t('当前项目已跳过学习');
    case 'skipped':
      return t('本次观察已跳过');
    default:
      return t('已提交，等待结果');
  }
}

function personalMemoryLearningDetails(learning = {}, status = {}) {
  if (status.learningAvailability === 'unavailable' || learning === undefined) return '';
  const details = [];
  if (learning.lastCheckedAt) details.push(t('时间：{0}', [learning.lastCheckedAt]));
  const ownership = [
    learning.lastProjectKey ? t('项目 {0}', [learning.lastProjectKey]) : '',
    learning.lastWorkflow ? `workflow ${learning.lastWorkflow}` : '',
    learning.lastChangeId ? `change ${learning.lastChangeId}` : '',
  ].filter(Boolean);
  if (ownership.length > 0) details.push(t('归属：{0}', [ownership.join(' · ')]));
  if (learning.lastReason?.trim()) details.push(t('原因：{0}', [learning.lastReason.trim()]));
  return details.join(' · ');
}

function AntSummaryCards({ snapshot, summaryData, selectedKey, onAction }) {
  useDashboardLanguage();

  const cards = [
    [
      t('活跃变更'),
      snapshot.summary.activeChanges,
      t('当前 Classic workflow'),
      t('进行中'),
      FlagOutlined,
    ],
    [
      t('已归档变更'),
      snapshot.summary.archivedChanges,
      t('历史变更已归档'),
      t('已完成'),
      CheckCircleOutlined,
    ],
    [
      t('Verify 失败'),
      !summaryData.ready || summaryData.error
        ? null
        : summaryData.rows.filter((change) => matchesSummary(change, 'failed')).length,
      t('验证结果'),
      snapshot.summary.verifyFailed ? t('阻塞') : t('健康'),
      SafetyCertificateOutlined,
    ],
    [
      t('未完成任务'),
      !summaryData.ready || summaryData.error
        ? null
        : summaryData.rows.reduce(
            (sum, change) => sum + Math.max(0, change.tasks.total - change.tasks.completed),
            0,
          ),
      t('任务推进情况'),
      snapshot.summary.tasksIncomplete ? t('待办') : t('清零'),
      CheckOutlined,
    ],
    [
      t('Git 未提交'),
      snapshot.summary.dirtyFiles,
      t('工作区状态'),
      snapshot.summary.dirtyFiles === null
        ? t('Git 状态未知')
        : snapshot.summary.dirtyFiles
          ? t('未提交')
          : t('干净'),
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
          selected={selectedKey === ['active', 'archived', 'failed', 'tasks', 'git'][index]}
          onClick={() => onAction(['active', 'archived', 'failed', 'tasks', 'git'][index])}
        />
      ))}
    </section>
  );
}

function AntSummaryCard({ title, value, note, status, icon: Icon, tone, selected, onClick }) {
  useDashboardLanguage();
  // 进入页面或数值变化时，从 0 滚动到目标值；数值不变则保持，避免每次自动刷新都重滚。
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
          <div className="text-[13px] font-medium text-muted">{title}</div>
          <div className="dashboard-summary-metric mt-1 text-[28px] font-semibold leading-none tabular-nums">
            {value == null ? '—' : Math.round(animatedValue)}
          </div>
        </div>
        <span className="dashboard-summary-icon" aria-hidden="true">
          <Icon />
        </span>
      </div>
      <span className="dashboard-summary-status">{status}</span>
      <div className="mt-2 truncate text-[13px] text-meta">{note}</div>
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
  useDashboardLanguage();
  const items = [
    ['active', t('活跃')],
    ['archived', t('已归档')],
    ['all', t('全部')],
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
  useDashboardLanguage();
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
      {visible.length === 0 ? (
        pageLoading ? (
          <DashboardLineSkeleton
            className="dashboard-change-list-skeleton"
            label={t('正在加载 Classic 变更列表')}
            rows={6}
            titleWidth="48%"
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无变更')} />
        )
      ) : (
        visible.map((change) => {
          const statusPresentation = classicChangeStatusPresentation(change);
          return (
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
                    <span className="mt-0.5 block truncate whitespace-nowrap text-xs text-meta">
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
                  <Pill tone={statusPresentation.tone}>{statusPresentation.label}</Pill>
                </div>
              </Button>
            </div>
          );
        })
      )}
      <div ref={sentinelRef} className="py-2 text-center text-xs text-meta" aria-live="polite">
        {pageLoading && visible.length > 0 ? (
          <DashboardLineSkeleton
            className="dashboard-change-list-more-skeleton"
            label={t('正在加载更多 Classic 变更')}
            rows={1}
          />
        ) : hasMore ? (
          t('继续下滑加载更多')
        ) : null}
      </div>
    </div>
  );
}

function AntChangeDetail({ change, onPreview }) {
  useDashboardLanguage();
  const { message: messageApi } = AntApp.useApp();
  const [copied, setCopied] = useState(false);
  const statusPresentation = classicChangeStatusPresentation(change);
  const current = change.status === 'archived' ? 'archive' : change.phase;
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === current),
  );
  return (
    <AntCard
      className="change-detail classic-change-detail min-w-0"
      title={
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{change.displayName}</span>
          <Tooltip title={t('复制 Change 名称')}>
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              aria-label={copied ? t('已复制 Change 名称') : t('复制 Change 名称')}
              onClick={() =>
                copyText(change.name)
                  .then(() => {
                    setCopied(true);
                    messageApi.success(t('Change 名称已复制'));
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => messageApi.error(t('复制 Change 名称失败')))
              }
            />
          </Tooltip>
        </div>
      }
      extra={<Pill tone={statusPresentation.tone}>{statusPresentation.label}</Pill>}
    >
      <div className="mb-4 text-xs text-meta">
        {change.workflow ?? '—'}
        {t(' · 更新于 ')}
        {formatTimestamp(change.updatedAt)} · {relativeChangePath(change)}
      </div>
      <WorkflowPhaseTrack
        phases={PHASES}
        currentIndex={currentIndex}
        archived={change.status === 'archived'}
        currentPhaseRunning={isClassicPhaseRunning(change)}
        ariaLabel={t('Classic 生命周期阶段')}
      />
      <Alert
        className="dashboard-next-step-alert"
        type="info"
        showIcon
        title={
          change.next?.command
            ? t('下一步：{0}', [change.next.command])
            : t('该变更没有待执行的下一步')
        }
        description={t(change.next?.description)}
      />
      <div className="change-detail-panels grid min-w-0 gap-4">
        <AntCard size="small" title={t('关键产物')}>
          <ArtifactList change={change} onPreview={onPreview} />
        </AntCard>
        <TaskProgress change={change} />
      </div>
    </AntCard>
  );
}
