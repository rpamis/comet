import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  parseWorkflowProjectConfigDocument,
  defaultWorkflowProjectConfig,
  mergeWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';
import {
  writeChangeWalkthrough,
  renderChangeWalkthrough,
} from '../../../domains/workflow-contract/change-walkthrough.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const content = {
  summary: '搜索支持标签',
  scope: 'HEAD 与本次工作区差异',
  changes: [
    {
      title: '标签筛选',
      before: '只能搜索关键词',
      after: '关键词与标签一起筛选',
      reason: '缩小结果范围',
      files: [{ path: 'src/search.ts', kind: 'modified', code: '<script>alert(1)</script>' }],
    },
  ],
  verification: [
    { label: '定向测试', status: 'passed', detail: '12 passed' },
    { label: '真实模型 Eval', status: 'not-run', detail: '未经授权' },
  ],
};
const graph = {
  nodes: [
    { id: 'input', label: '输入关键词' },
    { id: 'search', label: '组合筛选', file: 'src/search.ts', kind: 'modified' },
  ],
  edges: [{ from: 'input', to: 'search', label: '筛选' }],
};
async function project(enabled?: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-walkthrough-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.comet'));
  await fs.writeFile(
    path.join(root, '.comet/config.yaml'),
    `schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\n${enabled === undefined ? '' : `change_walkthrough: ${enabled}\n`}classic:\n  artifact_layout: docs\n`,
  );
  return root;
}
describe('change walkthrough', () => {
  it('defaults on and validates explicit booleans including partial configs', () => {
    expect(defaultWorkflowProjectConfig().change_walkthrough).toBe(true);
    expect(parseWorkflowProjectConfigDocument('').change_walkthrough).toBe(true);
    for (const value of ['null', '1', '"true"', '[]'])
      expect(() => parseWorkflowProjectConfigDocument(`change_walkthrough: ${value}`)).toThrow(
        'change_walkthrough',
      );
    for (const enabled of [true, false]) {
      const config = { ...defaultWorkflowProjectConfig(), change_walkthrough: enabled };
      const merged = mergeWorkflowProjectConfigDocument({ custom: 42 }, config);
      expect(
        parseWorkflowProjectConfigDocument(renderStructuredProjectConfig(merged, 'zh-CN')).config
          ?.change_walkthrough,
      ).toBe(enabled);
      expect(merged.custom).toBe(42);
    }
  });
  it('skips reading content or rendering when explicitly disabled', async () => {
    const root = await project(false);
    expect(await writeChangeWalkthrough(root, 'classic', 'demo', 'missing.json')).toEqual({
      enabled: false,
    });
    expect(await fs.readdir(root)).toEqual(['.comet']);
  });
  it.each(['native', 'classic'] as const)(
    'renders for %s when the project omits the setting',
    async (workflow) => {
      const root = await project();
      if (workflow === 'native')
        await fs.writeFile(
          path.join(root, '.comet/config.yaml'),
          'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: notes\n  language: en\n',
        );
      const directory = path.join(
        root,
        workflow === 'native' ? 'notes/comet/changes/demo' : 'docs/openspec/changes/demo',
      );
      await fs.mkdir(directory, { recursive: true });
      const input = path.join(root, 'content.json');
      await fs.writeFile(input, JSON.stringify(content));
      const result = await writeChangeWalkthrough(root, workflow, 'demo', input);
      expect(result).toEqual({ enabled: true, path: path.join(directory, 'walkthrough.html') });
      expect(await fs.readFile(result.path!, 'utf8')).toContain('搜索支持标签');
    },
  );
  it.each(['native', 'classic'] as const)(
    'renders and replaces one self-contained page for %s',
    async (workflow) => {
      const root = await project(true);
      if (workflow === 'native')
        await fs.writeFile(
          path.join(root, '.comet/config.yaml'),
          renderStructuredProjectConfig(
            { ...defaultWorkflowProjectConfig('notes', 'zh-CN'), change_walkthrough: true },
            'zh-CN',
          ),
        );
      const directory = path.join(
        root,
        workflow === 'native' ? 'notes/comet/changes/demo' : 'docs/openspec/changes/demo',
      );
      await fs.mkdir(directory, { recursive: true });
      const input = path.join(root, 'input.json');
      await fs.writeFile(
        input,
        JSON.stringify({ ...content, diagrams: [{ type: 'flow', title: '搜索路径', ...graph }] }),
      );
      const first = await writeChangeWalkthrough(root, workflow, 'demo', input);
      expect(first.path).toBe(path.join(directory, 'walkthrough.html'));
      let html = await fs.readFile(first.path!, 'utf8');
      expect(html).toContain('<details>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
      expect(html).not.toMatch(/(?:src|href)="https?:/);
      await fs.writeFile(
        input,
        JSON.stringify({
          verification: [{ label: '独立验收', status: 'failed', detail: '尚有缺项' }],
        }),
      );
      await writeChangeWalkthrough(root, workflow, 'demo', input, true);
      html = await fs.readFile(first.path!, 'utf8');
      expect(html).toContain('尚有缺项');
      expect(html).toContain('标签筛选');
      expect(html).toContain('搜索路径');
      expect(html).toContain('<svg');
      expect(html).not.toContain('12 passed');
      const configFile = path.join(root, '.comet/config.yaml');
      await fs.writeFile(
        configFile,
        (await fs.readFile(configFile, 'utf8')).replace(
          /^change_walkthrough: true$/mu,
          'change_walkthrough: false',
        ),
      );
      expect(await writeChangeWalkthrough(root, workflow, 'demo', 'missing.json')).toEqual({
        enabled: false,
      });
      expect(await fs.readFile(first.path!, 'utf8')).toBe(html);
      const archived = path.join(root, 'saved');
      await fs.rename(directory, archived);
      expect(await fs.readFile(path.join(archived, 'walkthrough.html'), 'utf8')).toBe(html);
    },
  );
  it('rejects invalid content without overwriting an existing page', async () => {
    const root = await project(true);
    const directory = path.join(root, 'docs/openspec/changes/demo');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'walkthrough.html'), 'original');
    const input = path.join(root, 'input.json');
    await fs.writeFile(input, '{}');
    await expect(writeChangeWalkthrough(root, 'classic', 'demo', input)).rejects.toThrow();
    expect(await fs.readFile(path.join(directory, 'walkthrough.html'), 'utf8')).toBe('original');
    await fs.writeFile(
      input,
      JSON.stringify({
        ...content,
        diagrams: [
          {
            type: 'flow',
            title: 'Invalid reference',
            ...graph,
            nodes: [graph.nodes[0], { ...graph.nodes[1], file: 'missing.ts' }],
          },
        ],
      }),
    );
    await expect(writeChangeWalkthrough(root, 'classic', 'demo', input)).rejects.toThrow(
      'changes.files',
    );
    expect(await fs.readFile(path.join(directory, 'walkthrough.html'), 'utf8')).toBe('original');
    await expect(writeChangeWalkthrough(root, 'classic', '../escape', input)).rejects.toThrow();
  });

  it('updates an existing page without requiring diagrams', async () => {
    const root = await project(true);
    const directory = path.join(root, 'docs/openspec/changes/demo');
    await fs.mkdir(directory, { recursive: true });
    const page = path.join(directory, 'walkthrough.html');
    await fs.writeFile(page, renderChangeWalkthrough(content));
    const input = path.join(root, 'verification.json');
    await fs.writeFile(
      input,
      JSON.stringify({ verification: [{ label: 'Review', status: 'passed', detail: 'Verified' }] }),
    );
    await writeChangeWalkthrough(root, 'classic', 'demo', input, true);
    const html = await fs.readFile(page, 'utf8');
    expect(html).toContain('Verified');
    expect(html).toContain('标签筛选');
    expect(html).not.toContain('<svg');
  });
  it('escapes every displayed field and labels unverified results explicitly', () => {
    const html = renderChangeWalkthrough(content, 'zh-CN');
    expect(html).toContain('未执行');
    expect(html).toContain('原来');
    expect(html).toContain('现在');
    expect(html).toContain('src/search.ts');
    expect(() =>
      renderChangeWalkthrough(
        { ...content, verification: [{ label: 'test', status: 'invented', detail: '' }] },
        'en',
      ),
    ).toThrow();
  });

  it('keeps additional feature groups collapsed on large changes', () => {
    const html = renderChangeWalkthrough(
      {
        ...content,
        changes: [...content.changes, ...content.changes, ...content.changes, ...content.changes],
      },
      'en',
    );
    expect(html).toContain('<details class="more"><summary>More changes (1)</summary>');
  });

  it('renders offline flow diagrams with links to the actual code details', () => {
    const html = renderChangeWalkthrough(
      { ...content, diagrams: [{ type: 'flow', title: '搜索路径', ...graph }] },
      'zh-CN',
    );
    const document = new JSDOM(html).window.document;
    const link = document.querySelector('svg a[href]')!;
    expect(link).not.toBeNull();
    const target = document.getElementById(link.getAttribute('href')!.slice(1))!;
    expect(target.textContent).toContain('src/search.ts');
    expect(target.closest('details')).not.toBeNull();
    expect(document.querySelector('svg path[marker-end]')).not.toBeNull();
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('svg title')?.textContent).toContain('搜索路径');
  });

  it('shows before and after diagrams with explicit change labels', () => {
    const html = renderChangeWalkthrough(
      {
        ...content,
        diagrams: [
          {
            type: 'comparison',
            title: '搜索方式变化',
            before: graph,
            after: { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], kind: 'added' }] },
          },
        ],
      },
      'zh-CN',
    );
    const document = new JSDOM(html).window.document;
    expect(document.querySelectorAll('.diagram-comparison > section')).toHaveLength(2);
    expect(document.querySelector('.diagram-comparison')?.textContent).toContain('原来');
    expect(document.querySelector('.diagram-comparison')?.textContent).toContain('现在');
    expect(document.querySelector('.diagram-comparison')?.textContent).toContain('新增');
  });

  it('escapes diagram titles, node labels and edge labels as text', () => {
    const unsafe = '<img src=x onerror=alert(1)>';
    const html = renderChangeWalkthrough(
      {
        ...content,
        diagrams: [
          {
            type: 'flow',
            title: unsafe,
            nodes: [
              { id: 'a', label: unsafe },
              { id: 'b', label: '结束' },
            ],
            edges: [{ from: 'a', to: 'b', label: unsafe }],
          },
        ],
      },
      'en',
    );
    const document = new JSDOM(html).window.document;
    expect(document.querySelectorAll('img, script, [onerror]')).toHaveLength(0);
    expect(document.querySelector('svg')?.textContent).toContain(unsafe);
  });

  it.each([
    { ...graph, nodes: [graph.nodes[0], graph.nodes[0]] },
    { ...graph, edges: [{ from: 'missing', to: 'search' }] },
    { ...graph, edges: [{ from: 'search', to: 'input' }] },
    { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], file: 'unrelated.ts' }] },
  ])('rejects ambiguous diagrams instead of inventing relationships %#', (invalid) => {
    expect(() =>
      renderChangeWalkthrough({
        ...content,
        diagrams: [{ type: 'flow', title: 'invalid', ...invalid }],
      }),
    ).toThrow();
  });
});
