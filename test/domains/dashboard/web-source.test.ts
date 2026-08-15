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
