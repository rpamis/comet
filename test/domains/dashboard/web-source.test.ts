import { describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import postcss from 'postcss';

const websiteCheckoutAvailable = existsSync(
  path.resolve('website', 'snippets', 'dashboard-website-demo.jsx'),
);

async function readDashboardSource(): Promise<string> {
  return fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'main.jsx'), 'utf8');
}

async function readDashboardModalSource(): Promise<string> {
  return fs.readFile(
    path.resolve('domains', 'dashboard', 'web', 'src', 'dashboard-modal.jsx'),
    'utf8',
  );
}

async function readWebsiteDemoEntrySource(): Promise<string> {
  return fs.readFile(
    path.resolve('domains', 'dashboard', 'web', 'src', 'website-demo-entry.jsx'),
    'utf8',
  );
}

async function readWebsiteDemoSnippet(): Promise<string> {
  return fs.readFile(path.resolve('website', 'snippets', 'dashboard-website-demo.jsx'), 'utf8');
}

async function readWebsiteDemoStyles(): Promise<string> {
  return fs.readFile(
    path.resolve('website', 'assets', 'dashboard-website-demo', 'dashboard-website-demo.css'),
    'utf8',
  );
}

async function readWebsiteCustomStyles(): Promise<string> {
  return fs.readFile(path.resolve('website', 'custom.css'), 'utf8');
}

async function readDashboardStyles(): Promise<string> {
  return fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'styles.css'), 'utf8');
}

async function readWorkspaceLayoutSource(): Promise<string> {
  return fs.readFile(
    path.resolve('domains', 'dashboard', 'web', 'src', 'workspace-layout.jsx'),
    'utf8',
  );
}

describe('dashboard web source contracts', () => {
  it('keeps the change workspace grid responsive inside the left navigation rail', async () => {
    const [source, layout, styles] = await Promise.all([
      readDashboardSource(),
      readWorkspaceLayoutSource(),
      readDashboardStyles(),
    ]);

    expect(source).toContain("from './workspace-layout.jsx'");
    expect(source).toContain('classic-changes-explorer');
    expect(styles).toContain('.classic-changes-explorer');
    expect(layout).toContain(
      'xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]',
    );
    expect(layout).toContain('xl:col-start-2 2xl:col-start-auto');
    expect(layout).toContain('leftClassName');
    expect(source).not.toContain('xl:grid-cols-[320px_minmax(620px,940px)_320px]');
  });

  it('centers the header search within the main workspace without rail compensation', async () => {
    const styles = await readDashboardStyles();
    const desktopHeaderLayout = styles.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.comet-workbench-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(260px,\s*420px\)\s+minmax\(0,\s*1fr\);[\s\S]*?}\s*[\s\S]*?\.comet-header-search\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?position:\s*static;[\s\S]*?max-width:\s*420px;[\s\S]*?}\s*[\s\S]*?\.comet-header-actions\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?margin-left:\s*0;[\s\S]*?}\s*}/,
    );

    expect(desktopHeaderLayout).toBeTruthy();
    expect(styles).not.toContain('left: calc(50% - (var(--rail-w) / 2));');
    expect(styles).not.toContain('.dashboard-workbench.is-sidebar-collapsed .comet-header-search');
  });

  it('keeps the desktop project selector compact while preserving responsive mobile width', async () => {
    const styles = await readDashboardStyles();
    const desktopProjectSelector = styles.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.comet-header-context\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?width:\s*180px;[\s\S]*?max-width:\s*100%;[\s\S]*?flex:\s*0 0 auto;[\s\S]*?}[\s\S]*?\.comet-project-select\s*\{[\s\S]*?flex:\s*0 0 180px;[\s\S]*?width:\s*180px;[\s\S]*?max-width:\s*100%;[\s\S]*?}/,
    );

    expect(desktopProjectSelector).toBeTruthy();
    expect(styles).toContain('flex: 1 1 auto;');
    expect(styles).toContain('width: 100%;');
    expect(styles).not.toContain('width: min(292px, 100%);');
  });

  it('keeps personal memory focused on searchable records and application reasons', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);
    const page = source.match(
      /function PersonalMemoryCenter\([\s\S]*?\n}\n\nfunction AntSummaryCards/,
    );

    expect(page?.[0]).toContain('dashboard-memory-workspace');
    expect(page?.[0]).toContain('dashboard-memory-filter-rail');
    expect(page?.[0]).toContain('dashboard-memory-registry');
    expect(page?.[0]).toContain('dashboard-memory-inspector');
    expect(page?.[0]).toContain('适用条件');
    expect(page?.[0]).toContain("selectedRecord.category || selectedRecord.title || '个人记忆'");
    expect(page?.[0]).toContain('为什么应用：');
    expect(page?.[0]).toContain('items={data?.manifestPreview}');
    expect(page?.[0]).toContain('selectedRecord.applicationHistory');
    expect(page?.[0]).toContain("selectedRecord.memoryType === 'personal-episode'");
    expect(page?.[0]).toContain('任务经验摘要');
    expect(page?.[0]).toContain('selectedRecord.episode.actionSummary');
    expect(source).toContain('最近一次任务使用的记忆');
    expect(source).toContain('这里只展示真正提供给 Agent 的内容');
    expect(source).toContain('为什么使用');
    expect(page?.[0]).toContain('totalMemoryRecordCount');
    expect(page?.[0]).toContain("group.records.length > 0 && (memoryFilter === 'all'");
    expect(page?.[0]).toContain('dashboard-tool-page-memory');
    expect(page?.[0]).not.toContain('dashboard-memory-settings');
    expect(page?.[0]).not.toContain('个人记忆 Provider');
    expect(page?.[0]).not.toContain('dashboard-plugin-toolbar');
    expect(page?.[0]).not.toContain('dashboard-plugin-grid');
    expect(styles).toContain('.dashboard-memory-workspace');
    expect(styles).toMatch(/\.dashboard-memory-workspace\s*\{[\s\S]*?border: 0;/);
    expect(styles).toContain('.dashboard-memory-table-row.is-selected');
    expect(styles).toContain('.dashboard-memory-inspector');
    expect(styles).toContain('.dashboard-context-application-history');
    expect(styles).toMatch(
      /@media \(min-width: 1181px\)[\s\S]*?\.dashboard-tool-page-memory\s*\{[\s\S]*?height: 100%;[\s\S]*?flex-direction: column;/,
    );
    expect(styles).toMatch(
      /\.dashboard-tool-page-memory \.dashboard-memory-workspace\s*\{[\s\S]*?min-height: 0;[\s\S]*?flex: 1 1 auto;/,
    );
    expect(page?.[0]).toContain('dashboard-plugin-primary-action');
    expect(page?.[0]).toContain('dashboard-plugin-secondary-action');
    expect(page?.[0]).not.toContain('icon={UserOutlined}');
    expect(source).toContain('dashboard-content-shell-plugin-center');
    expect(styles).toContain('Plugin workspaces belong to the Dashboard canvas');
    expect(styles).toMatch(
      /\.dashboard-memory-table-row\.is-selected,[\s\S]*?background: color-mix\([\s\S]*?box-shadow: inset 2px 0 var\(--color-fg-2\);/,
    );
  });

  it('explains personal memory budgets in plain language', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('稳定偏好最多带入');
    expect(source).toContain('当前任务相关记忆最多带入');
    expect(source).toContain('不是记忆条数或存储容量');
    expect(source).toContain('addonAfter="字符"');
  });

  it('exposes the Project Knowledge registry and bounded management controls', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);
    const page = source.match(
      /function projectKnowledgeDiagnosticCopy\([\s\S]*?\n}\n\nfunction PersonalMemoryCenter/,
    );
    const settings = source.match(
      /function ProjectKnowledgeSettings\([\s\S]*?\n}\n\nfunction openProjectKnowledgeCorrection/,
    );

    expect(page?.[0]).toContain('dashboard-knowledge-registry');
    expect(page?.[0]).toContain('dashboard-knowledge-explorer');
    expect(page?.[0]).toContain('dashboard-knowledge-ledger');
    expect(page?.[0]).toContain('dashboard-knowledge-inspector');
    expect(page?.[0]).toContain('dashboard-knowledge-tabs');
    expect(page?.[0]).toContain('items={snapshot.manifestPreview}');
    expect(page?.[0]).toContain('dashboard-tool-page-knowledge');
    expect(page?.[0]).toContain('知识记录');
    expect(page?.[0]).toContain('数据来源');
    expect(page?.[0]).toContain('检索测试');
    expect(page?.[0]).toContain("onInvoke('query'");
    expect(page?.[0]).toContain("onInvoke('correct'");
    expect(page?.[0]).toContain("onInvoke('forget'");
    expect(page?.[0]).toContain("onInvoke('refresh'");
    expect(page?.[0]).toContain('新增项目知识');
    expect(page?.[0]).toContain('dashboard-create-modal-root');
    expect(page?.[0]).toContain('dashboard-project-knowledge-create-form');
    expect(page?.[0]).toContain("onInvoke('create'");
    expect(settings?.[0]).toContain('tokenEnv');
    expect(settings?.[0]).toContain('tokenConfigured');
    expect(settings?.[0]).toContain('configure-provider');
    expect(settings?.[0]).toContain('Provider 与检索');
    expect(settings?.[0]).toContain('本地索引');
    expect(settings?.[0]).toContain('aria-label="切换当前项目知识检索"');
    expect(settings?.[0]).toContain("action: enabled ? 'enable' : 'disable'");
    expect(settings?.[0]).toContain('保存配置');
    expect(settings?.[0]).toContain("onInvoke('lifecycle', { action: 'uninstall' })");
    expect(styles).toContain('.dashboard-knowledge-settings-fields');
    expect(styles).toContain('.dashboard-settings-value');
    expect(page?.[0]).toContain('来源需要检查');
    expect(page?.[0]).toContain('<Input');
    expect(page?.[0]).toContain('测试检索');
    expect(page?.[0]).toContain('检索已完成，没有找到与当前任务匹配的项目知识');
    expect(source).toContain('检索完成，未找到匹配的项目知识');
    expect(source).toContain('项目知识已标记为已替代，不再提供给 Agent');
    expect(source).toContain('来源或验证入口已变化，记录已替代并停止应用');
    expect(source).toContain('Skill 候选（仅建议）');
    expect(source).toContain('项目验证命令约束');
    expect(page?.[0]).toContain('标记已替代');
    expect(page?.[0]).toContain('仍会保留在历史记录中');
    expect(page?.[0]).toContain("const [stateFilter, setStateFilter] = useState('proven')");
    expect(page?.[0]).toContain('纠正并恢复');
    expect(page?.[0]).toContain('重新检查来源');
    expect(page?.[0]).toContain('建议补充证据，方便后续维护');
    expect(source).toContain("capability === 'lifecycle' ? '插件状态已更新' : '操作已完成'");
    expect(styles).toContain('.dashboard-knowledge-registry');
    expect(styles).toMatch(/\.dashboard-knowledge-registry\s*\{[\s\S]*?border: 0;/);
    expect(styles).toContain('.dashboard-knowledge-ledger-row');
    expect(styles).toContain('.dashboard-knowledge-inspector');
    expect(source).toContain('dashboard-content-inner-project-knowledge');
    expect(source).toContain('dashboard-content-inner-plugin-center');
    expect(styles).toContain('.dashboard-content-inner-project-knowledge');
    expect(styles).toContain('height: calc(100dvh - 232px)');
    expect(styles).toMatch(
      /@media \(min-width: 1181px\)[\s\S]*?\.dashboard-content-inner-project-knowledge\s*\{[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/,
    );
    expect(styles).toMatch(
      /\.dashboard-tool-page-knowledge\s*\{[\s\S]*?display: flex;[\s\S]*?height: 100%;[\s\S]*?flex-direction: column;/,
    );
    expect(styles).toMatch(
      /\.dashboard-knowledge-registry,[\s\S]*?\.dashboard-knowledge-query-view\s*\{[\s\S]*?min-height: 0;[\s\S]*?height: auto;[\s\S]*?flex: 1 1 auto;/,
    );
    expect(styles).toContain('clamp(300px, 24vw, 390px)');
    expect(styles).toContain('--dashboard-plugin-body-size: 14px');
    expect(styles).toContain('--dashboard-navigation-font-size: 14px');
    expect(styles).toMatch(/\.dashboard-workspace-region\s*\{\s*font-size: 13px;/);
    expect(styles).toMatch(/\.native-changes-explorer\s*\{[\s\S]*?font-size: 14px;/);
    expect(styles).toContain('.dashboard-tool-header');
    expect(styles).toContain('.dashboard-tool-panel-title');
    expect(styles).toContain('.dashboard-create-modal-content');
    expect(styles).toContain('.dashboard-context-manifest');
    expect(styles).toContain('.dashboard-context-manifest-item');
  });

  it('opens centralized plugin settings from the bottom of the sidebar', async () => {
    const [source, modal, styles] = await Promise.all([
      readDashboardSource(),
      readDashboardModalSource(),
      readDashboardStyles(),
    ]);

    expect(source).toContain('const [settingsOpen, setSettingsOpen] = useState(false)');
    expect(source).toContain('const [settingsPage, setSettingsPage] = useState(null)');
    expect(source).toContain('const [settingsConfig, setSettingsConfig] = useState(null)');
    expect(source).toContain('DASHBOARD_PLUGIN_NAV_PLACEHOLDERS');
    expect(source).toContain('loadCachedPluginPage');
    expect(source).toContain('loadCachedProjectConfig');
    expect(source).toContain('preloadDashboardSettings');
    expect(source).toContain('void preloadDashboardSettings(activeProjectId, availablePages)');
    expect(source).not.toContain('settingsReady={pluginPages.some((page) => !page.pending)}');
    expect(source).not.toContain('disabled={!settingsReady}');
    expect(source).toMatch(
      /pluginPages\.find\(\(page\) => !page\.pending\)\?\.pluginId\s*\?\?\s*'comet\.config'/u,
    );
    expect(source).toContain('pages.filter((item) => !item.pending)');
    expect(source).toContain('className={`dashboard-sidebar-settings${settingsOpen');
    expect(source).toContain('className="dashboard-sidebar-settings-label"');
    expect(source).toContain('function DashboardSettingsOverlay');
    expect(source).toContain("from './dashboard-modal.jsx'");
    expect(source).toContain('DashboardModal,');
    expect(source).toContain('DashboardPortalProvider,');
    expect(source).toContain('useDashboardModalState,');
    expect(source).toContain('<DashboardModal');
    expect(source).toContain("aria-label={fullscreen ? '退出全屏' : '全屏展示'}");
    expect(modal).toContain('mask={{ closable: true }}');
    expect(modal).toContain('dashboard-settings-modal-title-row');
    expect(modal).toContain('const fullscreenRef = useRef(false)');
    expect(modal).toContain('if (fullscreenRef.current)');
    expect(source).toContain('function DashboardSettingsPage');
    expect(source).toContain('function PersonalMemorySettings');
    expect(source).toContain('function ProjectKnowledgeSettings');
    expect(source).toContain('function CometConfigSettings');
    expect(source).toContain('aria-label="设置分类"');
    expect(source).toContain("label: '项目规则'");
    expect(source).toContain("label: 'Comet 配置'");
    expect(source).toContain('统一管理个人记忆、项目规则与工作流配置');
    expect(source).not.toContain('dashboard-settings-modal-icon');
    expect(source).toContain('个人记忆存储方式');
    expect(source).toContain('tokenConfigured');
    expect(source).toContain('Comet 默认工作流');
    expect(source).toContain('Hook 允许写入路径');
    expect(source).toContain('保存 Comet 配置');
    expect(source).toContain('/config`');
    expect(styles).toContain('.dashboard-sidebar-settings');
    expect(styles).toContain('.dashboard-sidebar-settings-label');
    expect(styles).toContain('.dashboard-settings-shell');
    expect(styles).toContain('.dashboard-settings-panel');
    expect(styles).toContain('.dashboard-config-control');
    expect(styles).toContain('.dashboard-settings-modal-root .ant-modal-mask');
    expect(styles).toContain('backdrop-filter: blur(8px)');
    expect(styles).toContain('.dashboard-settings-modal-footer');
    expect(styles).toContain('.dashboard-settings-modal.is-fullscreen');
    expect(styles).toContain('.dashboard-plugin-primary-action');
    expect(styles).toContain('.dashboard-plugin-secondary-action');
    expect(styles).toContain(
      '.dashboard-settings-modal .dashboard-settings-navigation .ant-menu-item-selected',
    );
    expect(styles).toContain('height: 100dvh');
  });

  it('uses line skeletons for Dashboard loading surfaces', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('DashboardLineSkeleton');
    expect(source).toContain('dashboard-change-list-skeleton');
    expect(source).toContain('classic-change-detail-skeleton');
    expect(source).toContain('classic-side-panel-skeleton');
    expect(source).toContain('dashboard-artifact-loading');
    expect(source).toContain('dashboard-project-knowledge-detail-loading');
    expect(source).not.toContain('<Spin');
    expect(source).not.toContain('正在加载...');
  });

  it('keeps the sidebar navigation compact and free of read-only helper rows', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).not.toContain('<span>变更工作区</span>');
    expect(source).not.toContain('只读连接 · 自动同步');
    expect(source).toContain('const [sidebarCollapsed, setSidebarCollapsed] = useState(false)');
    expect(source).toContain('collapsedWidth={64}');
    expect(source).toContain('inlineCollapsed={collapsed}');
    expect(source).not.toContain('aria-hidden={collapsed}\n        inert={collapsed}');
    expect(source).toContain("aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}");
    expect(source).toContain('className="dashboard-sidebar-group"');
    expect(source).toContain('inlineIndent={12}');
    expect(styles).toContain('.dashboard-sidebar-group + .dashboard-sidebar-group');
    expect(styles).toContain('.dashboard-workbench.is-sidebar-collapsed');
    expect(styles).toContain('--rail-w: 64px');
    expect(styles).toContain('.ant-menu-inline-collapsed');
    expect(styles).toMatch(
      /\.dashboard-sidebar \.ant-menu-item\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 38px;[\s\S]*?padding-inline: 11px !important;/,
    );
    expect(styles).toMatch(
      /\.dashboard-sidebar-settings\s*\{[\s\S]*?width: 100%;[\s\S]*?min-height: 38px;[\s\S]*?padding-inline: 11px;/,
    );
    expect(styles).toMatch(
      /\.dashboard-sidebar\s*\{[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0 !important;[\s\S]*?transition: none !important;/,
    );
    expect(styles).toMatch(
      /\.dashboard-sidebar-navigation\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/,
    );
    expect(styles).toMatch(/\.dashboard-sidebar-footer\s*\{[\s\S]*?flex: 0 0 auto;/);
    expect(styles).toMatch(
      /\.dashboard-workbench\.is-sidebar-collapsed \.dashboard-sidebar-content\s*\{[^}]*?width: 100%;[^}]*?transition: none;/,
    );
  });

  it('lets plugin navigation carry the page title while the canvas starts with state and actions', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).toContain('className="dashboard-plugin-context-bar"');
    expect(source).not.toContain('title="个人记忆"');
    expect(source).toContain('aria-label="项目规则状态与操作"');
    expect(source).not.toContain('<h2>{page.label}</h2>');
    expect(styles).toContain('.dashboard-plugin-context-bar');
    expect(styles).toContain('--dashboard-plugin-body-size: 13px');
  });

  it('keeps personal memory and project knowledge mutations read-only in the website embed', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);
    const pluginPage = source.match(
      /function PluginCenterPage\([\s\S]*?\n}\n\nfunction DashboardSettingsOverlay/,
    );
    const projectKnowledgeInspector = source.match(
      /function ProjectKnowledgeInspector\([\s\S]*?\n}\n\nfunction ProjectKnowledgeSources/,
    );
    const projectKnowledgeCenter = source.match(
      /function ProjectKnowledgeCenter\([\s\S]*?\n}\n\nfunction PersonalMemoryCenter/,
    );
    const personalMemoryCenter = source.match(
      /function PersonalMemoryCenter\([\s\S]*?\n}\n\nfunction AntSummaryCards/,
    );
    const settingsOverlay = source.match(
      /function DashboardSettingsOverlay\([\s\S]*?\n}\n\nfunction SettingsSectionHead/,
    );
    const configSettings = source.match(
      /function CometConfigSettings\([\s\S]*?\n}\n\nfunction PersonalMemorySettings/,
    );
    const personalMemorySettings = source.match(
      /function PersonalMemorySettings\([\s\S]*?\n}\n\nfunction ProjectKnowledgeSettings/,
    );
    const projectKnowledgeSettings = source.match(
      /function ProjectKnowledgeSettings\([\s\S]*?\n}\n\nfunction openProjectKnowledgeCorrection/,
    );

    expect(source).toContain('readOnly={embedded}');
    expect(source).toContain('themeToggleDisabled={embedded}');
    expect(source).toContain('disabled={themeToggleDisabled}');
    expect(source).toContain("embedded ? ' is-embedded' : ''");
    expect(pluginPage?.[0]).toContain('readOnly = false');
    expect(pluginPage?.[0]).toContain('readOnly={readOnly}');
    expect(projectKnowledgeInspector?.[0]).toContain('disabled={readOnly}');
    expect(projectKnowledgeCenter?.[0]).toContain('disabled={readOnly}');
    expect(personalMemoryCenter?.[0]).toContain('disabled={readOnly || !projectKey}');
    expect(personalMemoryCenter?.[0]).toContain('disabled={readOnly}');
    expect(settingsOverlay?.[0]).toContain('readOnly = false');
    expect(settingsOverlay?.[0]).toContain('<div className="dashboard-settings-content">');
    expect(settingsOverlay?.[0]).not.toContain('inert={readOnly}');
    expect(settingsOverlay?.[0]).not.toContain(
      "className={`dashboard-settings-main${readOnly ? ' is-read-only' : ''}`}\n          aria-live=\"polite\"\n          aria-disabled={readOnly || undefined}\n          inert={readOnly}",
    );
    expect(configSettings?.[0]).toContain('disabled={readOnly}');
    expect(personalMemorySettings?.[0]).toContain('disabled={readOnly}');
    expect(projectKnowledgeSettings?.[0]).toContain('disabled={readOnly}');
    expect(styles).toContain('.dashboard-workbench.is-embedded');
    expect(styles).toContain(
      '.dashboard-plugin-primary-action, .dashboard-plugin-secondary-action',
    );
  });

  it('uses product preview wording instead of Demo wording in website-facing feedback', async () => {
    const source = await readDashboardSource();

    for (const copy of [
      '未找到对应的 Demo 插件页面',
      '未找到对应的 Demo 设置页面',
      'Demo 模式仅展示示例数据',
      'Demo 配置已保存',
    ]) {
      expect(source).not.toContain(copy);
    }
    if (websiteCheckoutAvailable) {
      const snippet = await readWebsiteDemoSnippet();
      expect(snippet).not.toContain('Dashboard Demo 加载');
      expect(snippet).not.toContain('Comet Dashboard Demo');
    }
  });

  it.skipIf(!websiteCheckoutAvailable)(
    'scopes every website Dashboard selector away from Mintlify document pages',
    async () => {
      const styles = await readWebsiteDemoStyles();
      const unscopedSelectors: string[] = [];

      postcss.parse(styles).walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/u.test(rule.parent.name)) return;
        for (const selector of rule.selectors) {
          if (!/^:host(?=$|\W)/u.test(selector)) unscopedSelectors.push(selector);
        }
      });

      expect(unscopedSelectors).toEqual([]);
      expect(styles).toContain(':host .hidden');
      expect(styles).not.toMatch(/(?:^|\})\.hidden\{/u);
    },
  );

  it('switches static Demo plugin centers without a transient loading state', async () => {
    const [source, websiteEntry] = await Promise.all([
      readDashboardSource(),
      readWebsiteDemoEntrySource(),
    ]);
    const demoPluginEffect = source.match(
      /useEffect\(\(\) => \{\s*if \(!useDemo\) return undefined;[\s\S]*?\}, \[demoPluginPages, pluginSelection, useDemo\]\);/,
    );
    const pluginSelectHandler = source.match(
      /onPluginSelect=\{\(pluginId\) => \{[\s\S]*?\}\}\s*onCollapse=/,
    );

    expect(pluginSelectHandler?.[0]).toMatch(
      /useDemo\s*\? \(pluginPages\.find\(\(page\) => page\.pluginId === pluginId\) \?\? null\)/,
    );
    expect(demoPluginEffect?.[0]).not.toContain('setPluginLoading(');
    expect(websiteEntry).toContain("import { DEMO_PLUGIN_PAGES } from '../demo.js'");
    expect(websiteEntry).toContain('demoPluginPages={DEMO_PLUGIN_PAGES}');
  });

  it.skipIf(!websiteCheckoutAvailable)(
    'keeps the website Dashboard readable in a horizontally browsable mobile viewport',
    async () => {
      const [snippet, websiteStyles] = await Promise.all([
        readWebsiteDemoSnippet(),
        readWebsiteCustomStyles(),
      ]);

      expect(snippet).toContain('const MOBILE_MIN_SCALE = 0.44');
      expect(snippet).toContain('Math.max(fitScale, MOBILE_MIN_SCALE)');
      expect(snippet).toContain("' is-mobile-viewport'");
      expect(snippet).toContain('comet-dashboard-website-scroll-content');
      expect(snippet).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'");
      expect(snippet).toContain(
        "event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? 160 : -160",
      );
      expect(websiteStyles).toContain('.comet-dashboard-website-stage.is-mobile-viewport');
      expect(websiteStyles).toContain('overflow-x: auto');
      expect(websiteStyles).toContain('touch-action: pan-x pan-y');
      expect(websiteStyles).toContain('scrollbar-width: none');
    },
  );

  it.skipIf(!websiteCheckoutAvailable)(
    'positions the website verification badge symmetrically outside the top-right toolbar',
    async () => {
      const websiteStyles = await readWebsiteCustomStyles();

      expect(websiteStyles).toContain('.comet-home__float--pass {');
      expect(websiteStyles).toContain('top: clamp(6.025rem, calc(4.805rem + 1.83vw), 6.375rem);');
      expect(websiteStyles).toContain('right: -0.5rem;');
      expect(websiteStyles).toContain('left: -0.5rem;');
    },
  );

  it('uses the change-detail width to switch between stacked and two-column panels', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).toContain('className="change-detail min-w-0"');
    expect(source).toContain('className="change-detail-panels grid min-w-0 gap-4"');
    expect(source).not.toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]');
    expect(source).toMatch(
      /function TaskProgress\(\{ change \}\) \{[\s\S]*?<article className="min-w-0 rounded-xl border border-border-soft bg-bg px-5 py-4">/,
    );
    expect(styles).toContain('container-type: inline-size;');
    expect(styles).toContain('@container (min-width: 700px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 340px);');
  });

  it('preserves page scroll position while the artifact preview drawer is open', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('const scrollY = window.scrollY');
    expect(source).toContain("document.body.style.position = 'fixed'");
    expect(source).toContain('document.body.style.top = `-${scrollY}px`');
    expect(source).toContain('window.scrollTo(0, scrollY)');
  });

  it('restores pre-existing inline body styles when the artifact drawer closes', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('const previousBodyStyle = {');
    for (const property of ['position', 'top', 'left', 'right', 'width']) {
      expect(source).toContain(`${property}: document.body.style.${property}`);
      expect(source).toContain(`document.body.style.${property} = previousBodyStyle.${property}`);
    }
  });

  it('renders artifact previews through the shared markdown-preview pipeline', async () => {
    const source = await readDashboardSource();

    expect(source).toContain("from './markdown-preview.js'");
    expect(source).toContain('className="md-github"');
    expect(source).toContain('dangerouslySetInnerHTML={{ __html: loadState.html }}');
    expect(source).toContain('runMermaid(articleRef.current)');
    expect(source).toContain('extractToc(articleRef.current)');
    expect(source).toContain('renderYamlTable');
    expect(source).toContain('renderJsonPreview');
    expect(source).toContain("artifact.key === 'cometYaml'");
    expect(source).toContain("artifact.key === 'handoff'");
    expect(source).toContain('artifact.content ??');
    expect(source).not.toContain('Math.floor(Math.random() * 4096)');
  });

  it('keeps the artifact table of contents behind fullscreen preview only', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('useDashboardModalState(Boolean(artifact))');
    expect(source).toContain('dashboard-artifact-preview-expand');
    expect(source).toContain("aria-label={fullscreen ? '退出全屏' : '全屏展示'}");
    expect(source).toContain('{fullscreen && toc.length > 0 && (');
    expect(source).not.toContain('{toc.length > 0 && (');
  });

  it('keeps only preview table headers readable and scrollable instead of wrapping', async () => {
    const styles = await readDashboardStyles();

    expect(styles).toContain('.md-github {');
    expect(styles).toContain('overflow-x: auto;');
    expect(styles).toContain('width: 100%;');
    expect(styles).not.toContain('width: max-content;');
    expect(styles).toContain('.md-github th {');
    expect(styles).toContain('white-space: nowrap;');
  });

  it('uses the confirmed fullscreen directory dimensions and type scale', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('w-[250px]');
    expect(source).toContain('text-sm font-semibold uppercase');
    expect(source).toContain("item.depth === 1 ? 'text-base font-medium'");
    expect(source).toContain("item.depth === 2 ? 'pl-4 text-base'");
    expect(source).toContain("item.depth === 3 ? 'pl-7 text-base'");
  });

  it('closes only fullscreen preview with Escape', async () => {
    const source = await readDashboardSource();

    expect(source).toContain("if (event.key === 'Escape') requestClose(onClose);");
    expect(source).toContain("window.addEventListener('keydown', onKeyDown)");
    expect(source).toContain("window.removeEventListener('keydown', onKeyDown)");
  });

  it('vertically centers the preview path copy control with its text', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).toContain('className="mt-1 flex items-center gap-1.5"');
    expect(source).toContain(
      'className="artifact-preview-path min-w-0 flex-1 break-all font-mono text-xs text-meta"',
    );
    expect(styles).toContain('p.artifact-preview-path {');
    expect(styles).toContain('margin: 0;');
  });

  it('wraps artifact paths and exposes a copy control beside them', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('break-all font-mono text-xs text-meta');
    expect(source).toContain('aria-label="复制文件路径"');
    expect(source).toContain("toast('路径已复制')");
    expect(source).not.toContain('truncate font-mono text-xs text-meta');
  });

  it('does not suggest verify for archived changes in the task progress hint', async () => {
    const source = await readDashboardSource();

    expect(source).toContain("const archived = change.status === 'archived'");
    expect(source).toContain('已归档完成，流程已结束');
    expect(source).not.toContain('已归档完成，后续无需再进入 Verify');
    expect(source).not.toContain(
      "const nextPhase = change.phase === 'verify' ? '归档' : 'Verify';",
    );
  });

  it('shows Classic collection failures instead of an empty workspace', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('snapshot.classicError && !hasClassicChanges');
    expect(source).toContain('<ClassicErrorState error={snapshot.classicError} />');
    expect(source).toContain('Classic 数据读取失败');
    expect(source).toContain('{error.message}');
  });

  it('keeps available Classic data visible while warning about partial collection failures', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('snapshot.classicError && hasClassicChanges');
    expect(source).toContain('<ClassicWarning error={snapshot.classicError} />');
    expect(source).toContain('function ClassicWarning({ error })');
  });

  it('uses the Native-aligned informative treatment for an empty Classic workspace', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('当前没有 Classic change');
    expect(source).toContain('Classic 变更出现后会在这里展示。');
    expect(source).not.toContain('当前无 Comet 迭代。');
  });

  it('keeps Classic detail and inspector frames visible when the selected view is empty', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).toContain('const isEmptyView = !pageLoading && visible.length === 0');
    expect(source).toContain('const isLoadingView = pageLoading && visible.length === 0');
    expect(source).toContain('<ClassicWorkspaceEmptyDetail');
    expect(source).toContain('<ClassicWorkspaceEmptySidePanel />');
    expect(source).toContain('<ClassicWorkspaceLoadingDetail />');
    expect(source).toContain('<ClassicWorkspaceLoadingSidePanel />');
    expect(source).toContain('当前没有活跃的 Classic change');
    expect(styles).toContain('.classic-change-detail-empty');
    expect(styles).toContain('.dashboard-workspace-side-empty');
  });

  it('loads change rows in pages and fetches full details on selection', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('fetchDashboardOverview');
    expect(source).toContain('fetchDashboardChangePage');
    expect(source).toContain('fetchDashboardNativeChangePage');
    expect(source).toContain('/native-changes?');
    expect(source).toContain("const params = new URLSearchParams({ status, limit: '5' });");
    expect(source).toContain('fetchDashboardChangeDetail');
    expect(source).toContain('new URLSearchParams({ changeLocator: changeId })');
    expect(source).toContain('change.workspace && !change.workspace.current');
    expect(source).toContain('onScroll={handleScroll}');
    expect(source).toContain('正在加载 Classic 变更详情');
    expect(source).not.toContain('async function fetchSnapshot');

    expect(await readDashboardStyles()).toContain(
      'max-height: max(180px, calc(var(--dashboard-center-height, 26rem) - 8rem));',
    );
  });
});
