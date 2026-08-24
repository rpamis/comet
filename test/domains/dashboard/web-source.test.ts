import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

async function readDashboardSource(): Promise<string> {
  return fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'main.jsx'), 'utf8');
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

  it('keeps personal memory focused on searchable records and application reasons', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);
    const page = source.match(
      /function PersonalMemoryCenter\([\s\S]*?\n}\n\nfunction AntSummaryCards/,
    );

    expect(page?.[0]).toContain('dashboard-memory-workspace');
    expect(page?.[0]).toContain('dashboard-memory-filter-rail');
    expect(page?.[0]).toContain('dashboard-memory-registry');
    expect(page?.[0]).toContain('dashboard-memory-inspector');
    expect(page?.[0]).toContain('这条记忆为什么被应用');
    expect(page?.[0]).toContain('为什么应用：');
    expect(page?.[0]).toContain('totalMemoryRecordCount');
    expect(page?.[0]).toContain("group.records.length > 0 && (memoryFilter === 'all'");
    expect(page?.[0]).toContain('dashboard-tool-page-memory');
    expect(page?.[0]).not.toContain('dashboard-memory-settings');
    expect(page?.[0]).not.toContain('个人记忆 Provider');
    expect(page?.[0]).not.toContain('dashboard-plugin-toolbar');
    expect(page?.[0]).not.toContain('dashboard-plugin-grid');
    expect(styles).toContain('.dashboard-memory-workspace');
    expect(styles).toContain('.dashboard-memory-table-row.is-selected');
    expect(styles).toContain('.dashboard-memory-inspector');
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
    expect(source).toContain('项目知识已归档，不再提供给 Agent');
    expect(page?.[0]).toContain('归档记录');
    expect(page?.[0]).toContain('但仍可在归档状态中查看');
    expect(page?.[0]).toContain("const [stateFilter, setStateFilter] = useState('active')");
    expect(page?.[0]).toContain('纠正并恢复');
    expect(page?.[0]).toContain('重新检查来源');
    expect(page?.[0]).toContain('建议补充证据，方便后续维护');
    expect(source).toContain("capability === 'lifecycle' ? '插件状态已更新' : '操作已完成'");
    expect(styles).toContain('.dashboard-knowledge-registry');
    expect(styles).toContain('.dashboard-knowledge-ledger-row');
    expect(styles).toContain('.dashboard-knowledge-inspector');
    expect(source).toContain('dashboard-content-inner-project-knowledge');
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
  });

  it('opens centralized plugin settings from the bottom of the sidebar', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).toContain('const [settingsOpen, setSettingsOpen] = useState(false)');
    expect(source).toContain('const [settingsPage, setSettingsPage] = useState(null)');
    expect(source).toContain('const [settingsConfig, setSettingsConfig] = useState(null)');
    expect(source).toContain('className={`dashboard-sidebar-settings${settingsOpen');
    expect(source).toContain('function DashboardSettingsOverlay');
    expect(source).toContain('const [fullscreen, setFullscreen] = useState(false)');
    expect(source).toContain("aria-label={fullscreen ? '退出全屏设置' : '全屏显示设置'}");
    expect(source).toContain('mask={{ closable: true }}');
    expect(source).toContain('function DashboardSettingsPage');
    expect(source).toContain('function PersonalMemorySettings');
    expect(source).toContain('function ProjectKnowledgeSettings');
    expect(source).toContain('function CometConfigSettings');
    expect(source).toContain('aria-label="设置分类"');
    expect(source).toContain("label: '项目规则'");
    expect(source).toContain("label: 'Comet 配置'");
    expect(source).toContain('统一管理个人记忆、项目规则与工作流配置');
    expect(source).toContain('个人记忆 Provider');
    expect(source).toContain('tokenConfigured');
    expect(source).toContain('Comet 默认工作流');
    expect(source).toContain('Hook 允许写入路径');
    expect(source).toContain('保存 Comet 配置');
    expect(source).toContain('/config`');
    expect(styles).toContain('.dashboard-sidebar-settings');
    expect(styles).toContain('.dashboard-settings-shell');
    expect(styles).toContain('.dashboard-settings-panel');
    expect(styles).toContain('.dashboard-config-control');
    expect(styles).toContain('.dashboard-settings-modal-root .ant-modal-mask');
    expect(styles).toContain('backdrop-filter: blur(8px)');
    expect(styles).toContain('.dashboard-settings-modal-footer');
    expect(styles).toContain('.dashboard-settings-modal.is-fullscreen');
    expect(styles).toContain('height: 100dvh');
  });

  it('keeps the sidebar navigation compact and free of read-only helper rows', async () => {
    const [source, styles] = await Promise.all([readDashboardSource(), readDashboardStyles()]);

    expect(source).not.toContain('<span>变更工作区</span>');
    expect(source).not.toContain('只读连接 · 自动同步');
    expect(source).toContain('const [sidebarCollapsed, setSidebarCollapsed] = useState(false)');
    expect(source).toContain('collapsedWidth={0}');
    expect(source).toContain('aria-label="收起侧边栏"');
    expect(source).toContain('aria-label="展开侧边栏"');
    expect(source).toContain('className="dashboard-sidebar-group"');
    expect(source).toContain('inlineIndent={12}');
    expect(styles).toContain('.dashboard-sidebar-group + .dashboard-sidebar-group');
    expect(styles).toContain('.dashboard-workbench.is-sidebar-collapsed');
    expect(styles).toMatch(
      /\.dashboard-sidebar \.ant-menu-item\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 38px;[\s\S]*?padding-inline: 11px !important;/,
    );
    expect(styles).toMatch(
      /\.dashboard-sidebar-settings\s*\{[\s\S]*?width: 100%;[\s\S]*?min-height: 38px;[\s\S]*?padding-inline: 11px;/,
    );
  });

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
  });

  it('keeps the artifact table of contents behind fullscreen preview only', async () => {
    const source = await readDashboardSource();

    expect(source).toContain('const [isFullscreen, setIsFullscreen] = useState(false)');
    expect(source).toContain("aria-label={isFullscreen ? '退出全屏' : '全屏展示'}");
    expect(source).toContain('{isFullscreen && toc.length > 0 && (');
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

    expect(source).toContain("if (event.key === 'Escape') onClose();");
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
    expect(source).toContain('正在加载变更详情');
    expect(source).not.toContain('async function fetchSnapshot');

    expect(await readDashboardStyles()).toContain(
      'max-height: max(180px, calc(var(--dashboard-center-height, 26rem) - 8rem));',
    );
  });
});
