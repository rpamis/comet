import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import {
  discoverProjectKnowledgeCorpus,
  LocalProjectKnowledgeProvider,
  RemoteProjectKnowledgeProvider,
  createProjectKnowledgeDashboardSnapshot,
  createProjectKnowledgeModule,
  createProjectKnowledgeQuery,
  renderProjectKnowledgeContext,
  type ProjectKnowledgeProvider,
  type ProjectKnowledgeQuery,
} from '../../../domains/project-knowledge/index.js';
import {
  parseWorkflowProjectConfigDocument,
  defaultWorkflowProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/integration.js';
import { MemoryPluginStorageStore } from '../../../domains/comet-plugin/plugin-runtime.js';
import { runBoundedRipgrep } from '../../../platform/process/ripgrep.js';

async function tempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-knowledge-'));
}

async function search(
  provider: ProjectKnowledgeProvider,
  query: ProjectKnowledgeQuery,
): Promise<
  readonly import('../../../domains/project-knowledge/types.js').ProjectKnowledgeResult[]
> {
  const response = await provider.query({ kind: 'search', query });
  return response.kind === 'search' ? response.results : [];
}

describe('project knowledge dashboard status', () => {
  test('returns a safe Local dashboard snapshot without provider work', () => {
    expect(
      createProjectKnowledgeDashboardSnapshot({
        config: { provider: 'local' },
        language: 'zh-CN',
      }),
    ).toEqual({
      provider: 'local',
      configured: true,
      retrieval: expect.stringContaining('section 索引'),
      diagnostics: [],
    });
  });

  test('sanitizes Remote endpoint credentials and never returns token values', () => {
    const snapshot = createProjectKnowledgeDashboardSnapshot({
      config: {
        provider: 'remote',
        remote: {
          endpoint: 'https://user:password@example.test/retrieve?token=secret',
          token_env: 'COMET_KNOWLEDGE_TOKEN',
          scope: 'team-a',
          timeout_ms: 1200,
        },
      },
      env: { COMET_KNOWLEDGE_TOKEN: 'bearer-secret' },
      language: 'en',
    });

    expect(snapshot).toMatchObject({
      provider: 'remote',
      configured: true,
      remote: {
        endpoint: 'https://example.test/retrieve',
        tokenEnv: 'COMET_KNOWLEDGE_TOKEN',
        tokenConfigured: true,
        scope: 'team-a',
        timeoutMs: 1200,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('password');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('bearer-secret');
  });

  test('loads the dashboard snapshot through status without constructing a provider', async () => {
    const storageStore = new MemoryPluginStorageStore();
    const module = await createProjectKnowledgeModule(
      {
        storage: await storageStore.open('comet.project-knowledge', 'project', 'status-project'),
        reportDiagnostic: () => undefined,
      } as never,
      { projectRoot: 'C:/project', knowledgeConfig: { provider: 'local' } },
    );

    await expect(module.invoke?.('status', {})).resolves.toMatchObject({
      provider: 'local',
      configured: true,
      diagnostics: [],
    });
  });

  test('keeps concurrent dashboard status refreshes and test queries on independent stores', async () => {
    const root = await tempProject();
    const storageRoot = await tempProject();
    const source = path.join(root, 'docs', 'retrieval.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, '# Retrieval\n\nProject knowledge retrieval stays available.\n');
    const storageStore = new MemoryPluginStorageStore();
    const module = await createProjectKnowledgeModule(
      {
        storage: await storageStore.open(
          'comet.project-knowledge',
          'project',
          'concurrent-dashboard-query',
        ),
        reportDiagnostic: () => undefined,
      } as never,
      { projectRoot: root, cacheRoot: storageRoot, knowledgeConfig: { provider: 'local' } },
    );

    try {
      const results = await Promise.allSettled([
        module.invoke?.('status', {}),
        module.invoke?.('query', { task: 'project knowledge retrieval' }),
      ]);
      expect(results).toEqual([
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({ provider: 'local', configured: true }),
        }),
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({ kind: 'search' }),
        }),
      ]);
    } finally {
      await module.dispose?.();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await fs.rm(storageRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  test('creates and lists a manually added user project knowledge record', async () => {
    const root = await tempProject();
    const storageRoot = await tempProject();
    const storageStore = new MemoryPluginStorageStore();
    const module = await createProjectKnowledgeModule(
      {
        storage: await storageStore.open(
          'comet.project-knowledge',
          'project',
          'manual-create-project',
        ),
        reportDiagnostic: () => undefined,
      } as never,
      { projectRoot: root, cacheRoot: storageRoot, knowledgeConfig: { provider: 'local' } },
    );

    try {
      await expect(
        module.invoke?.('create', { type: 'behavior-note', summary: '缺少标题' }),
      ).rejects.toThrow(/title/u);
      await expect(
        module.invoke?.('create', {
          type: 'behavior-note',
          title: '构建约定',
          summary: '修改后先运行定向测试。',
          applicablePaths: ['domains/'],
          operations: ['verify'],
          sources: [{ source: 'docs/rules.md', anchor: 'focused-tests' }],
          verification: [{ command: 'pnpm test --filter project-knowledge' }],
        }),
      ).resolves.toMatchObject({ kind: 'upsert', changed: true });

      const listed = await module.invoke?.('list', { state: 'active' });
      expect(listed).toMatchObject({
        kind: 'list',
        records: [
          expect.objectContaining({
            authority: 'user',
            title: '构建约定',
            summary: '修改后先运行定向测试。',
          }),
        ],
      });
    } finally {
      await module.dispose?.();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});

describe('local record provider contract', () => {
  test('exposes current Local index counts for dashboard status', async () => {
    const root = await tempProject();
    const storageRoot = await tempProject();
    const source = path.join(root, 'docs', 'rule.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, '# Rule\n\nPrefer focused tests.\n');
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot: storageRoot,
      corpus: [{ absolutePath: source, source: 'docs/rule.md', kind: 'native-spec' }],
    });
    try {
      await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'focused tests' }),
      });
      await expect(provider.indexStatus()).resolves.toMatchObject({
        available: true,
        sourceCount: 1,
        sectionCount: 1,
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('supports status, search/list management, and retirement without injecting retired records', async () => {
    const root = await tempProject();
    const storageRoot = await tempProject();
    const source = path.join(root, 'docs', 'rule.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, '# Rule\n\nPrefer focused tests.\n');
    const stat = await fs.stat(source);
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot: storageRoot,
      corpus: [],
    });
    try {
      await expect(
        provider.apply({
          kind: 'upsert',
          record: {
            id: 'record-focused-tests',
            projectId: 'project-local-provider',
            type: 'behavior-note',
            state: 'active',
            authority: 'automatic',
            title: 'Focused tests',
            summary: 'Prefer focused tests for small changes.',
            applicablePaths: ['domains/'],
            operations: ['verify'],
            conclusions: [
              {
                text: 'Run focused tests first.',
                sources: [{ source: 'docs/rule.md', anchor: 'rule' }],
              },
            ],
            relations: [],
            verification: [],
            sourceVersions: [
              { source: 'docs/rule.md', size: stat.size, modifiedAt: Math.trunc(stat.mtimeMs) },
            ],
            updatedAt: '2026-08-22T12:00:00.000Z',
          },
        }),
      ).resolves.toMatchObject({ changed: true });
      await expect(provider.status()).resolves.toMatchObject({
        provider: 'local',
        recordCount: 1,
        healthy: true,
      });
      const search = await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'focused tests' }),
      });
      expect(search.kind).toBe('search');
      expect(search.records.map((record) => record.id)).toContain('record-focused-tests');
      expect(search.results.some((result) => result.source === 'docs/rule.md#rule')).toBe(true);
      await provider.apply({
        kind: 'retire',
        id: 'record-focused-tests',
        projectId: 'project-local-provider',
        updatedAt: '2026-08-22T12:01:00.000Z',
      });
      const listed = await provider.query({ kind: 'list', state: 'retired' });
      expect(listed.kind).toBe('list');
      expect(listed.records.map((record) => record.id)).toEqual(['record-focused-tests']);
      const afterRetire = await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'focused tests' }),
      });
      expect(afterRetire.records).toEqual([]);
    } finally {
      (provider as unknown as { close?: () => void }).close?.();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});

describe('project knowledge configuration', () => {
  test('defaults to local and validates remote endpoint bounds', () => {
    const config = parseWorkflowProjectConfigDocument(
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
    ).config;
    expect(config?.knowledge).toEqual({ provider: 'local' });
    expect(defaultWorkflowProjectConfig().knowledge).toEqual({ provider: 'local' });
    expect(() =>
      parseWorkflowProjectConfigDocument(
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native]',
          'knowledge:',
          '  provider: remote',
          '  remote:',
          '    endpoint: http://example.test/retrieve',
          'native:',
          '  artifact_root: docs',
          '  language: zh-CN',
          '',
        ].join('\n'),
      ),
    ).toThrow(/HTTPS/u);
  });

  test('ignores stale Remote settings when the provider is Local', () => {
    const config = parseWorkflowProjectConfigDocument(
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'knowledge:',
        '  provider: local',
        '  remote:',
        '    endpoint: http://example.test/retrieve',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
    ).config;

    expect(config?.knowledge).toEqual({ provider: 'local' });
  });

  test('keeps recent diagnostics across project knowledge module instances', async () => {
    const storageStore = new MemoryPluginStorageStore();
    const createContext = async () =>
      ({
        storage: await storageStore.open(
          'comet.project-knowledge',
          'project',
          'diagnostics-project',
        ),
        reportDiagnostic: () => undefined,
      }) as never;
    const options = {
      projectRoot: process.cwd(),
      knowledgeConfig: {
        provider: 'remote' as const,
        remote: {
          endpoint: 'https://example.test/retrieve',
          token_env: 'COMET_RAG_REVIEW_MISSING',
          timeout_ms: 5000,
        },
      },
    };

    const firstModule = await createProjectKnowledgeModule(await createContext(), options);
    await firstModule.provideContext?.({ task: 'retrieve project knowledge' });

    const secondModule = await createProjectKnowledgeModule(await createContext(), options);
    await expect(secondModule.invoke?.('status', {})).resolves.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'remote-token',
          message: expect.stringContaining('COMET_RAG_REVIEW_MISSING'),
        }),
      ],
    });
  });

  test('keeps generic terms below the strong-match threshold', () => {
    expect(createProjectKnowledgeQuery({ task: 'project' }).strongTerms).toEqual([]);
    expect(
      createProjectKnowledgeQuery({ task: 'project knowledge retrieval' }).phraseTerms,
    ).toContain('project knowledge retrieval');
    expect(createProjectKnowledgeQuery({ task: 'CometHookGuard' }).strongTerms).toContain(
      'CometHookGuard',
    );
  });

  test('removes Windows, UNC, and punctuation-wrapped POSIX absolute paths from remote queries', () => {
    const query = createProjectKnowledgeQuery({
      task: 'Inspect C:\\secret\\file.ts, \\\\server\\share\\private.md and (/home/user/token.md)',
    });

    expect(query.remoteQuery).not.toMatch(/C:\\secret|server\\share|\/home\/user/u);
    expect(query.remoteQuery).toContain('Inspect');
  });
});

describe('project knowledge corpus and local provider', () => {
  test('discovers declared Native, Classic, and referenced Superpowers documents only', async () => {
    const root = await tempProject();
    try {
      await fs.mkdir(path.join(root, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native, classic]',
          'native:',
          '  artifact_root: docs',
          'classic:',
          '  artifact_layout: docs',
          '',
        ].join('\n'),
      );
      const files = [
        'docs/comet/specs/native.md',
        'docs/comet/archive/2026-08-01-old.md',
        'docs/openspec/specs/classic.md',
        'docs/openspec/changes/archive/2026-08-02-change/.comet.yaml',
        'docs/superpowers/specs/design.md',
        'docs/superpowers/plans/plan.md',
        'docs/superpowers/specs/unbound.md',
        'docs/openspec/changes/active.md',
        'src/not-knowledge.md',
      ];
      for (const file of files)
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(
        path.join(root, 'docs/openspec/changes/archive/2026-08-02-change/.comet.yaml'),
        [
          'design_doc: docs/superpowers/specs/design.md',
          'plan: docs/superpowers/plans/plan.md',
        ].join('\n'),
      );
      await fs.writeFile(
        path.join(root, 'docs/comet/specs/native.md'),
        '# Native\n\nProject knowledge retrieval.',
      );
      await fs.writeFile(
        path.join(root, 'docs/comet/archive/2026-08-01-old.md'),
        '# Old\n\nProject knowledge retrieval.',
      );
      await fs.writeFile(
        path.join(root, 'docs/openspec/specs/classic.md'),
        '# Classic\n\nProject knowledge retrieval.',
      );
      await fs.writeFile(
        path.join(root, 'docs/superpowers/specs/design.md'),
        '# Design\n\nProject knowledge retrieval.',
      );
      await fs.writeFile(
        path.join(root, 'docs/superpowers/plans/plan.md'),
        '# Plan\n\nProject knowledge retrieval.',
      );
      const corpus = await discoverProjectKnowledgeCorpus({ projectRoot: root });
      expect(corpus.map((entry) => entry.source)).toEqual([
        'docs/comet/archive/2026-08-01-old.md',
        'docs/comet/specs/native.md',
        'docs/openspec/specs/classic.md',
        'docs/superpowers/plans/plan.md',
        'docs/superpowers/specs/design.md',
      ]);
      expect(corpus.some((entry) => entry.source.includes('unbound'))).toBe(false);
      expect(corpus.some((entry) => entry.source.includes('active'))).toBe(false);
      expect(corpus.some((entry) => entry.source.startsWith('src/'))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('does not discover documents for workflows omitted from the enabled workflow list', async () => {
    const root = await tempProject();
    try {
      await fs.mkdir(path.join(root, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native]',
          'native:',
          '  artifact_root: docs',
          'classic:',
          '  artifact_layout: docs',
          '',
        ].join('\n'),
      );
      const native = path.join(root, 'docs/comet/specs/native.md');
      const classic = path.join(root, 'docs/openspec/specs/classic.md');
      await fs.mkdir(path.dirname(native), { recursive: true });
      await fs.mkdir(path.dirname(classic), { recursive: true });
      await fs.writeFile(native, '# Native\n\nEnabled workflow knowledge.');
      await fs.writeFile(classic, '# Classic\n\nDisabled workflow knowledge.');

      const corpus = await discoverProjectKnowledgeCorpus({ projectRoot: root });

      expect(corpus.map((entry) => entry.source)).toEqual(['docs/comet/specs/native.md']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('uses one bounded rg call, abstains on weak matches, and renders bounded references', async () => {
    const root = await tempProject();
    try {
      const file = path.join(root, 'docs', 'comet', 'specs', 'knowledge.md');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        '# Retrieval\n\nProject knowledge retrieval plugin uses fixed strings.',
      );
      const query = createProjectKnowledgeQuery({ task: 'project knowledge retrieval' });
      const calls: readonly string[][] = [];
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: [
          { absolutePath: file, source: 'docs/comet/specs/knowledge.md', kind: 'native-spec' },
        ],
        runRipgrep: async (args) => {
          (calls as string[][]).push([...args]);
          return {
            stdout: JSON.stringify({
              type: 'match',
              data: {
                path: { text: 'docs/comet/specs/knowledge.md' },
                line_number: 3,
                lines: { text: 'Project knowledge retrieval plugin uses fixed strings.\n' },
              },
            }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
            truncated: false,
            matchLimitReached: false,
          };
        },
      });
      const results = await search(provider, query);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('--fixed-strings');
      expect(calls[0]).toContain('--iglob');
      expect(results[0]).toMatchObject({
        source: 'docs/comet/specs/knowledge.md',
        title: 'Retrieval',
      });
      expect(renderProjectKnowledgeContext(results)).toContain('项目知识参考');
      expect(
        renderProjectKnowledgeContext(
          await search(provider, createProjectKnowledgeQuery({ task: 'x' })),
        ),
      ).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('remote project knowledge provider', () => {
  test('sends the provider envelope and keeps server order without retry', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        schema: 'comet.project-knowledge.provider.v1',
        operation: 'query',
        projectId: 'project',
        scope: 'demo',
        input: {
          kind: 'search',
          task: '任务',
          path: 'src/app.ts',
          phase: 'build',
          limit: 8,
        },
      });
      expect(body.input.terms).toEqual(expect.arrayContaining(['任务', 'src/app.ts', 'build']));
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
      return new Response(
        JSON.stringify({
          kind: 'search',
          results: [
            { source: 'docs/b.md', content: 'B' },
            { source: 'docs/a.md', content: 'A' },
          ],
          records: [],
          hits: [],
          truncated: false,
        }),
      );
    });
    const provider = new RemoteProjectKnowledgeProvider({
      config: {
        endpoint: 'https://example.test/retrieve',
        token_env: 'COMET_TOKEN',
        scope: 'demo',
        timeout_ms: 5000,
      },
      env: { COMET_TOKEN: 'secret' },
      fetch,
    });
    const results = await search(
      provider,
      createProjectKnowledgeQuery({ task: '任务', path: 'src/app.ts', phase: 'build' }),
    );
    expect(results.map((result) => result.source)).toEqual(['docs/b.md', 'docs/a.md']);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

test('registers project knowledge beside personal memory in the shared bridge', async () => {
  const root = await tempProject();
  try {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: zh-CN',
        '',
      ].join('\n'),
    );
    const file = path.join(root, 'docs', 'comet', 'specs', 'bridge.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Bridge\n\nProject knowledge bridge behavior.');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: 'project-knowledge-bridge',
      stateRoot: path.join(root, 'plugin-state'),
      memoryRoot: path.join(root, 'memory'),
    });
    const contributions = await bridge.collectContext({ task: 'project knowledge bridge' });
    expect(contributions.map((entry) => entry.pluginId)).toContain('comet.project-knowledge');
    expect(
      contributions.find((entry) => entry.pluginId === 'comet.project-knowledge')?.text,
    ).toContain('项目知识参考');
    expect((await bridge.pluginRuntime.list()).map((entry) => entry.id)).toContain(
      'comet.project-knowledge',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persists lifecycle hints without waiting for semantic project review', async () => {
  const root = await tempProject();
  const scheduled: Array<() => Promise<void>> = [];
  try {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
    );
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: 'project-knowledge-review-boundary',
      stateRoot: path.join(root, 'plugin-state'),
      memoryRoot: path.join(root, 'memory'),
      runProjectKnowledgeReview: { review: async () => [] },
      runProjectKnowledgeReviewInBackground: (task) => {
        scheduled.push(task);
      },
    });
    await bridge.observe({
      name: 'verification.completed',
      workflow: 'native',
      changeId: 'review-boundary',
      success: true,
      category: 'verification',
      text: 'verified',
      changedPaths: ['docs/comet/specs/project-knowledge.md'],
      verificationCommands: ['pnpm test'],
      verificationResults: [{ command: 'pnpm test', success: true }],
    });
    expect(scheduled).toHaveLength(1);
    const status = await bridge.pluginRuntime.invoke(
      'comet.project-knowledge',
      'status',
      {},
      { scope: 'project', projectId: 'project-knowledge-review-boundary' },
    );
    expect(status).toMatchObject({ local: { available: true } });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persists deterministic project knowledge after a lifecycle hint', async () => {
  const root = await tempProject();
  try {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
    );
    await fs.mkdir(path.join(root, 'docs', 'comet', 'specs'), { recursive: true });
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'docs', 'comet', 'specs', 'project.md'),
      '# Project\n\nProject knowledge source.\n',
    );
    await fs.writeFile(
      path.join(root, 'src', 'main.ts'),
      'export const projectKnowledge = true;\n',
    );
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: 'project-knowledge-targeted-refresh',
      stateRoot: path.join(root, 'plugin-state'),
      memoryRoot: path.join(root, 'memory'),
    });
    await bridge.observe({
      name: 'verification.completed',
      workflow: 'native',
      changeId: 'targeted-refresh',
      success: true,
      category: 'verification',
      text: 'verified',
      changedPaths: ['src/main.ts'],
      verificationCommands: ['pnpm test'],
      verificationResults: [{ command: 'pnpm test', success: true }],
    });
    await bridge.collectContext({ task: 'project structure' });
    const recordsResult = (await bridge.pluginRuntime.invoke(
      'comet.project-knowledge',
      'list',
      { state: 'all' },
      { scope: 'project', projectId: 'project-knowledge-targeted-refresh' },
    )) as { records?: readonly { id?: string }[] };
    const records = recordsResult.records ?? [];
    expect(records.some((record) => record.id === 'generated-project-map')).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('project knowledge failure and bounded retrieval contracts', () => {
  test('caps ripgrep match events at the configured limit', async () => {
    const line = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'docs/knowledge.md' },
        line_number: 1,
        lines: { text: 'match\n' },
      },
    });
    const result = await runBoundedRipgrep({
      cwd: process.cwd(),
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write(${JSON.stringify(`${line}\n`).replace(/\\n$/u, '')}.repeat(600))`,
      ],
      timeoutMs: 2000,
      maxOutputBytes: 1024 * 1024,
      maxMatches: 500,
    });
    expect(result.matchLimitReached).toBe(true);
    expect(result.stdout.match(/"type":"match"/gu)).toHaveLength(500);
  });

  test('returns empty local results and one diagnostic for corrupt JSON', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: process.cwd(),
      corpus: [
        {
          absolutePath: path.resolve('docs/comet/changes/project-knowledge-retrieval/brief.md'),
          source: 'docs/comet/changes/project-knowledge-retrieval/brief.md',
          kind: 'native-spec',
        },
      ],
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      runRipgrep: async () => ({
        stdout: '{invalid-json}\n{invalid-json}\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
      }),
    });
    const results = await search(
      provider,
      createProjectKnowledgeQuery({ task: 'project knowledge' }),
    );
    expect(results).toEqual([]);
    expect(diagnostics.filter((entry) => entry.code === 'local-invalid-json')).toHaveLength(1);
  });

  test('keeps complete candidates when bounded output ends with partial JSON', async () => {
    const root = await tempProject();
    try {
      const file = path.join(root, 'docs', 'knowledge.md');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '# Retrieval\n\nProject knowledge bounded output.');
      const diagnostics: { code: string; message: string }[] = [];
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: [{ absolutePath: file, source: 'docs/knowledge.md', kind: 'native-spec' }],
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        runRipgrep: async () => ({
          stdout: `${JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'docs/knowledge.md' },
              line_number: 3,
              lines: { text: 'Project knowledge bounded output.\n' },
            },
          })}\n{"type":"match"`,
          stderr: '',
          exitCode: null,
          timedOut: false,
          truncated: true,
          matchLimitReached: false,
        }),
      });

      const results = await search(
        provider,
        createProjectKnowledgeQuery({ task: 'project knowledge bounded output' }),
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.source).toBe('docs/knowledge.md');
      expect(diagnostics.map((entry) => entry.code)).toEqual(['local-output-limit']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('reports a nonzero ripgrep exit instead of treating it as no results', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: process.cwd(),
      corpus: [
        {
          absolutePath: path.resolve('docs/comet/changes/project-knowledge-retrieval/brief.md'),
          source: 'docs/comet/changes/project-knowledge-retrieval/brief.md',
          kind: 'native-spec',
        },
      ],
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      runRipgrep: async () => ({
        stdout: '',
        stderr: 'permission denied',
        exitCode: 2,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
      }),
    });

    await expect(
      search(provider, createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      {
        code: 'local-tool',
        message: 'Project knowledge local search failed with exit code 2.',
      },
    ]);
  });

  test('rejects a corpus file whose ancestor is replaced by a project-external link', async () => {
    const root = await tempProject();
    const outside = await tempProject();
    try {
      const directory = path.join(root, 'docs', 'comet', 'specs');
      const file = path.join(directory, 'knowledge.md');
      const outsideFile = path.join(outside, 'knowledge.md');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(file, '# Inside\n\nProject knowledge inside.');
      await fs.writeFile(outsideFile, '# Outside\n\nProject knowledge outside secret.');
      const diagnostics: { code: string; message: string }[] = [];
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: [
          {
            absolutePath: file,
            source: 'docs/comet/specs/knowledge.md',
            kind: 'native-spec',
          },
        ],
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        runRipgrep: async () => {
          await fs.rm(directory, { recursive: true, force: true });
          await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
          return {
            stdout: JSON.stringify({
              type: 'match',
              data: {
                path: { text: 'docs/comet/specs/knowledge.md' },
                line_number: 3,
                lines: { text: 'Project knowledge outside secret.\n' },
              },
            }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
            truncated: false,
            matchLimitReached: false,
          };
        },
      });

      await expect(
        search(provider, createProjectKnowledgeQuery({ task: 'project knowledge outside secret' })),
      ).resolves.toEqual([]);
      expect(diagnostics.map((entry) => entry.code)).toContain('local-document');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test('reports a bounded local timeout without blocking the provider', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const document = {
      absolutePath: path.resolve('docs/comet/changes/project-knowledge-retrieval/brief.md'),
      source: 'docs/comet/changes/project-knowledge-retrieval/brief.md',
      kind: 'native-spec' as const,
    };
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: process.cwd(),
      corpus: [document],
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      runRipgrep: async () => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: true,
        truncated: false,
        matchLimitReached: false,
        error: new Error('timeout'),
      }),
    });
    await expect(
      search(provider, createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      { code: 'local-timeout', message: 'Project knowledge local search timed out.' },
    ]);
  });

  test('bounds ripgrep output and terminates a slow process', async () => {
    const output = await runBoundedRipgrep({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify('x'.repeat(2048))})`],
      timeoutMs: 2000,
      maxOutputBytes: 1024,
      maxMatches: 500,
    });
    expect(output.truncated).toBe(true);
    expect(output.stdout).toBe('');

    const timeout = await runBoundedRipgrep({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.stdout.write("done"), 500)'],
      timeoutMs: 50,
      maxOutputBytes: 1024,
      maxMatches: 500,
    });
    expect(timeout.timedOut).toBe(true);
  });

  test('falls back to system rg when the bundled command is unavailable', async () => {
    const root = await tempProject();
    try {
      const file = path.join(root, 'docs', 'knowledge.md');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '# Retrieval\n\nProject knowledge fallback.');
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        rgCommand: path.join(root, 'missing-rg.exe'),
        corpus: [{ absolutePath: file, source: 'docs/knowledge.md', kind: 'native-spec' }],
      });
      const results = await search(
        provider,
        createProjectKnowledgeQuery({ task: 'project knowledge fallback' }),
      );
      expect(results[0]).toMatchObject({ source: 'docs/knowledge.md', title: 'Retrieval' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('searches Markdown extensions case-insensitively', async () => {
    const root = await tempProject();
    try {
      const file = path.join(root, 'docs', 'KNOWLEDGE.MD');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '# Retrieval\n\nProject knowledge uppercase extension.');
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: [{ absolutePath: file, source: 'docs/KNOWLEDGE.MD', kind: 'native-spec' }],
      });

      const results = await search(
        provider,
        createProjectKnowledgeQuery({ task: 'project knowledge uppercase extension' }),
      );

      expect(results[0]).toMatchObject({ source: 'docs/KNOWLEDGE.MD', title: 'Retrieval' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('reports a missing local search tool once', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: process.cwd(),
      corpus: [
        {
          absolutePath: path.resolve('docs/comet/changes/project-knowledge-retrieval/brief.md'),
          source: 'docs/comet/changes/project-knowledge-retrieval/brief.md',
          kind: 'native-spec',
        },
      ],
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      runRipgrep: async () => ({
        stdout: '',
        stderr: 'not found',
        exitCode: null,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
        error: new Error('missing'),
      }),
    });
    await expect(
      search(provider, createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      {
        code: 'local-tool-missing',
        message:
          'Local project knowledge search is unavailable; install ripgrep or keep the bundled binary available.',
      },
    ]);
  });

  test('keeps the deterministic top four references under the total content bound', async () => {
    const results = Array.from({ length: 6 }, (_, index) => ({
      source: `docs/${index}.md`,
      title: `Section ${index}`,
      content: `${index}: ${'x'.repeat(1400)}`,
    }));
    const { boundProjectKnowledgeResults } =
      await import('../../../domains/project-knowledge/renderer.js');
    const bounded = boundProjectKnowledgeResults(results);
    expect(bounded).toHaveLength(3);
    expect(bounded.map((entry) => entry.source)).toEqual(['docs/0.md', 'docs/1.md', 'docs/2.md']);
    expect(bounded.reduce((total, entry) => total + entry.content.length, 0)).toBeLessThanOrEqual(
      5000,
    );
    const rendered = renderProjectKnowledgeContext(results);
    expect(rendered).not.toBeNull();
    expect(rendered!.length).toBeLessThanOrEqual(5000);
  });

  test('escapes untrusted Markdown in source and title metadata', () => {
    const rendered = renderProjectKnowledgeContext([
      {
        source: '![track](https://attacker.test/pixel)',
        title: '[click](https://attacker.test)',
        content: 'Safe evidence.',
      },
    ]);

    expect(rendered).not.toContain('![track]');
    expect(rendered).not.toContain('[click](https://attacker.test)');
    expect(rendered).toContain('!\\[track\\]\\(https://attacker\\.test/pixel\\)');
  });

  test('keeps Native, Classic, and Superpowers order in a fixed retrieval baseline', async () => {
    const root = await tempProject();
    try {
      const sources = [
        ['docs/comet/specs/current.md', 'native-spec'],
        ['docs/openspec/specs/classic.md', 'classic-spec'],
        ['docs/comet/archive/2026-08-01-old.md', 'native-archive'],
        ['docs/superpowers/specs/design.md', 'superpowers'],
      ] as const;
      for (const [source] of sources) {
        const file = path.join(root, ...source.split('/'));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, '# Retrieval\n\nProject knowledge retrieval baseline.');
      }
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: sources.map(([source, kind]) => ({
          absolutePath: path.join(root, ...source.split('/')),
          source,
          kind,
          ...(kind === 'native-archive' ? { archivedAt: '2026-08-01' } : {}),
        })),
        runRipgrep: async () => ({
          stdout: sources
            .map(([source]) =>
              JSON.stringify({
                type: 'match',
                data: {
                  path: { text: source },
                  line_number: 1,
                  lines: { text: 'Project knowledge retrieval baseline.\n' },
                },
              }),
            )
            .join('\n'),
          stderr: '',
          exitCode: 0,
          timedOut: false,
          truncated: false,
          matchLimitReached: false,
        }),
      });
      const results = await search(
        provider,
        createProjectKnowledgeQuery({ task: 'project knowledge retrieval baseline' }),
      );
      expect(results.map((entry) => entry.source)).toEqual([
        'docs/comet/specs/current.md',
        'docs/openspec/specs/classic.md',
        'docs/comet/archive/2026-08-01-old.md',
        'docs/superpowers/specs/design.md',
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('disables, pauses, and explicitly uninstalls project knowledge without context', async () => {
    const root = await tempProject();
    try {
      await fs.mkdir(path.join(root, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native]',
          'native:',
          '  artifact_root: docs',
          '',
        ].join('\n'),
      );
      const file = path.join(root, 'docs', 'comet', 'specs', 'lifecycle.md');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '# Lifecycle\n\nProject knowledge lifecycle.');
      const bridge = await createDefaultCometPluginBridge({
        projectRoot: root,
        projectId: 'lifecycle-project',
        stateRoot: path.join(root, 'plugin-state'),
        memoryRoot: path.join(root, 'memory'),
      });
      const target = { scope: 'project' as const, projectId: 'lifecycle-project' };
      await bridge.pluginRuntime.disable('comet.project-knowledge', target);
      expect(
        (await bridge.collectContext({ task: 'project knowledge lifecycle' })).some(
          (entry) => entry.pluginId === 'comet.project-knowledge',
        ),
      ).toBe(false);
      await bridge.pluginRuntime.enable('comet.project-knowledge', target);
      expect(
        (await bridge.collectContext({ task: 'project knowledge lifecycle' })).some(
          (entry) => entry.pluginId === 'comet.project-knowledge',
        ),
      ).toBe(true);
      await bridge.pluginRuntime.uninstall('comet.project-knowledge');
      expect(
        (await bridge.collectContext({ task: 'project knowledge lifecycle' })).some(
          (entry) => entry.pluginId === 'comet.project-knowledge',
        ),
      ).toBe(false);
      await expect(bridge.pluginRuntime.update('comet.project-knowledge')).rejects.toMatchObject({
        code: 'missing',
      });
      await expect(bridge.pluginRuntime.get('comet.project-knowledge')).resolves.toMatchObject({
        status: 'uninstalled',
        explicitRemoval: true,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('updates both workflow guard language variants to the shared task context', async () => {
    const chinese = await fs.readFile(
      path.resolve('assets/skills/comet/rules/comet-workflow-guard.md'),
      'utf8',
    );
    const english = await fs.readFile(
      path.resolve('assets/skills/comet/rules/comet-workflow-guard.en.md'),
      'utf8',
    );
    expect(chinese).toContain('comet task');
    expect(chinese).toContain('个人记忆和项目知识');
    expect(chinese).not.toContain('comet memory context');
    expect(english).toContain('comet task');
    expect(english).toContain('personal memory and project knowledge');
    expect(english).not.toContain('comet memory context');
  });

  test('injects task context once after workspace binding with the current phase', async () => {
    const [chineseEntry, englishEntry] = await Promise.all([
      fs.readFile(path.resolve('assets/skills-zh/comet/SKILL.md'), 'utf8'),
      fs.readFile(path.resolve('assets/skills/comet/SKILL.md'), 'utf8'),
    ]);
    expect(chineseEntry).not.toContain('--task "<用户原始请求>"');
    expect(englishEntry).not.toContain('--task "<original user request>"');

    for (const skill of ['comet-native', 'comet-classic', 'comet-hotfix', 'comet-tweak']) {
      const [chinese, english] = await Promise.all([
        fs.readFile(path.resolve('assets/skills-zh', skill, 'SKILL.md'), 'utf8'),
        fs.readFile(path.resolve('assets/skills', skill, 'SKILL.md'), 'utf8'),
      ]);
      expect(chinese, `${skill} Chinese phase context`).toContain('--phase "<phase>"');
      expect(english, `${skill} English phase context`).toContain('--phase "<phase>"');
      expect(chinese, `${skill} Chinese phase context`).not.toContain('--phase build');
      expect(english, `${skill} English phase context`).not.toContain('--phase build');
    }
  });
});
