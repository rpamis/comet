import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

async function readDashboardSource(): Promise<string> {
  return fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'main.jsx'), 'utf8');
}

describe('dashboard web source contracts', () => {
  it('keeps the change workspace grid responsive inside the left navigation rail', async () => {
    const source = await readDashboardSource();

    expect(source).toContain(
      'xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]',
    );
    expect(source).toContain('xl:col-start-2 2xl:col-start-auto');
    expect(source).not.toContain('xl:grid-cols-[320px_minmax(620px,940px)_320px]');
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
});
