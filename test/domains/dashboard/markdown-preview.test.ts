import { describe, expect, it } from 'vitest';
import {
  extractToc,
  renderJsonPreview,
  renderMarkdown,
  renderYamlTable,
} from '../../../domains/dashboard/web/src/markdown-preview.js';

function containerFromHtml(html) {
  const headings = [...html.matchAll(/<(h[123])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (match) => ({
      tagName: match[1].toUpperCase(),
      id: match[2],
      textContent: match[3].replace(/<[^>]+>/g, ''),
    }),
  );
  return {
    querySelectorAll(selector) {
      const allowed = new Set(
        selector
          .split(',')
          .map((part) => part.trim().toUpperCase())
          .filter(Boolean),
      );
      return headings.filter((heading) => allowed.has(heading.tagName));
    },
  };
}

describe('dashboard markdown-preview', () => {
  it('emits mermaid containers and chinese-safe heading ids', async () => {
    const html = await renderMarkdown(
      ['# 中文标题', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', '## Section Two'].join(
        '\n',
      ),
    );

    expect(html).toContain('id="中文标题"');
    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('id="section-two"');
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
        "build_command: env TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' npx jest a.test.tsx --runInBand",
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
});
