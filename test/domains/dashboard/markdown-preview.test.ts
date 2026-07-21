import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  extractToc,
  renderJsonPreview,
  renderMarkdown,
  renderYamlTable,
  runMermaid,
} from '../../../domains/dashboard/web/src/markdown-preview.js';

function containerFromHtml(html) {
  return new JSDOM(`<body>${html}</body>`).window.document;
}

describe('dashboard markdown-preview', () => {
  it('emits mermaid containers and chinese-safe heading ids', async () => {
    const html = await renderMarkdown(
      [
        '# 中文标题',
        '',
        '```mermaid',
        'flowchart TD',
        '  A --> B',
        '```',
        '',
        '## Section Two',
      ].join('\n'),
    );

    expect(html).toContain('id="中文标题"');
    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('id="section-two"');
  }, 60_000);

  it('assigns unique ids for duplicate headings and falls back for symbol-only titles', async () => {
    const html = await renderMarkdown(
      ['# Same', '', '## Same', '', '### Same', '', '# !!!', '', '# !!!'].join('\n'),
    );

    expect(html).toContain('<h1 id="same">');
    expect(html).toContain('<h2 id="same-1">');
    expect(html).toContain('<h3 id="same-2">');
    expect(html).toContain('<h1 id="heading">');
    expect(html).toContain('<h1 id="heading-1">');

    const toc = extractToc(containerFromHtml(html));
    expect(toc.map((item) => item.id)).toEqual([
      'same',
      'same-1',
      'same-2',
      'heading',
      'heading-1',
    ]);
  });

  it('does not leak heading slug state across separate renderMarkdown calls', async () => {
    const first = await renderMarkdown('# Dup\n\n# Dup');
    const second = await renderMarkdown('# Dup');

    expect(first).toContain('id="dup"');
    expect(first).toContain('id="dup-1"');
    expect(second).toContain('<h1 id="dup">');
    expect(second).not.toContain('id="dup-1"');
  });

  it('renders inline markdown inside headings instead of raw markers', async () => {
    const html = await renderMarkdown('# **Bold** title with `code`');

    expect(html).toContain('<h1 id="bold-title-with-code">');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('**Bold**');

    const toc = extractToc(containerFromHtml(html));
    expect(toc).toEqual([{ id: 'bold-title-with-code', text: 'Bold title with code', depth: 1 }]);
  });

  it('extracts h1–h3 toc entries from rendered markup', async () => {
    const html = await renderMarkdown('# One\n\n## Two\n\n#### Skip\n\n### Three');
    const toc = extractToc(containerFromHtml(html));

    expect(toc).toEqual([
      { id: 'one', text: 'One', depth: 1 },
      { id: 'two', text: 'Two', depth: 2 },
      { id: 'three', text: 'Three', depth: 3 },
    ]);
  });

  it('renders flat .comet.yaml maps as a key-value table', async () => {
    const html = await renderYamlTable(
      [
        'workflow: full',
        'phase: archive',
        'verify_result: pass',
        'build_command: env TS_NODE_COMPILER_OPTIONS=\'{"module":"commonjs"}\' npx jest a.test.tsx --runInBand',
      ].join('\n'),
    );

    expect(html).toContain('class="yaml-kv-table"');
    expect(html).toContain('<th scope="col">字段</th>');
    expect(html).toContain('<th scope="row">workflow</th>');
    expect(html).toContain('<td>full</td>');
    expect(html).toContain('<th scope="row">build_command</th>');
    expect(html).toContain('npx jest a.test.tsx');
  });

  it('renders handoff JSON with scalar kv table and files data table', async () => {
    const html = await renderJsonPreview(
      JSON.stringify({
        change: 'finance-tradein-vertical-layout',
        phase: 'design',
        mode: 'compact',
        canonical_spec: 'openspec',
        generated_by: 'comet-handoff.sh',
        context_hash: '87ca3c03593607b6be733982d28b33811a37fb8a7cff1e267bbfbafecbca9e0a',
        files: [
          {
            path: 'openspec/changes/finance-tradein-vertical-layout/proposal.md',
            sha256: 'b4e52c654c55dbe17d69f6e7f9ef1f0e3318d8d154458af99ce6836300e6c62a',
          },
          {
            path: 'openspec/changes/finance-tradein-vertical-layout/design.md',
            sha256: 'be07954f5f88f6e2ecaddfbfc792068c15b54a0163dd6a60033086b07c793dae',
          },
        ],
      }),
    );

    expect(html).toContain('class="yaml-kv-table"');
    expect(html).toContain('<th scope="row">change</th>');
    expect(html).toContain('<td>finance-tradein-vertical-layout</td>');
    expect(html).toContain('<h3 id="files">files</h3>');
    expect(html).toContain('class="json-array-table"');
    expect(html).toContain('<th scope="col">path</th>');
    expect(html).toContain('<th scope="col">sha256</th>');
    expect(html).toContain('openspec/changes/finance-tradein-vertical-layout/proposal.md');
    expect(html).not.toContain('"files":');
  });

  it('escapes quotes in structured keys used as HTML attributes', async () => {
    const maliciousKey = 'x" onmouseover="alert(1)';
    const html = await renderJsonPreview(
      JSON.stringify({
        [maliciousKey]: [{ path: 'a', sha256: 'b' }],
      }),
    );

    // A single quoted id attribute — quotes are entities, so nothing breaks out into extra attrs.
    expect(html).toContain('<h3 id="x&quot; onmouseover=&quot;alert(1)">');
    expect(html).not.toMatch(/<h3 id="[^"]*"\s+\w+\s*=/i);
  });

  it('strips XSS payloads from raw HTML in Markdown', async () => {
    const html = await renderMarkdown(
      ['# Safe', '', '<img src=x onerror=alert(1)>', '', '<script>alert(2)</script>'].join('\n'),
    );

    expect(html).not.toMatch(/onerror\s*=/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('alert(2)');
    expect(html).toContain('id="safe"');
  });

  it('blocks dangerous URL protocols in Markdown links and images', async () => {
    const html = await renderMarkdown(
      [
        '[click](javascript:alert(1))',
        '',
        '![x](javascript:alert(2))',
        '',
        '[ok](https://example.com/docs)',
      ].join('\n'),
    );

    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('https://example.com/docs');
  });

  it('keeps mermaid source escaped and uses strict mermaid security', async () => {
    const html = await renderMarkdown(
      ['```mermaid', 'flowchart TD', '  A["<img src=x onerror=alert(1)>"] --> B', '```'].join('\n'),
    );

    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<img[^>]+onerror/i);

    const mermaidModule = await import('mermaid');
    const initialize = vi.spyOn(mermaidModule.default, 'initialize').mockImplementation(() => {});
    const run = vi.spyOn(mermaidModule.default, 'run').mockResolvedValue(undefined as never);
    const container = {
      querySelectorAll: () => [{ className: 'mermaid' }],
    };

    await runMermaid(container as unknown as ParentNode);

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        startOnLoad: false,
      }),
    );
    expect(run).toHaveBeenCalled();
    initialize.mockRestore();
    run.mockRestore();
  });
});
