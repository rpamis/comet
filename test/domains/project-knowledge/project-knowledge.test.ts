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
} from '../../../domains/project-knowledge/index.js';
import {
  parseWorkflowProjectConfigDocument,
  defaultWorkflowProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/integration.js';
import { runBoundedRipgrep } from '../../../platform/process/ripgrep.js';

async function tempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-knowledge-'));
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
      retrieval: expect.stringContaining('不会维护索引'),
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
    const module = await createProjectKnowledgeModule(
      { reportDiagnostic: () => undefined } as never,
      { projectRoot: 'C:/project', knowledgeConfig: { provider: 'local' } },
    );

    await expect(module.invoke?.('status', {})).resolves.toMatchObject({
      provider: 'local',
      configured: true,
      diagnostics: [],
    });
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

  test('keeps generic terms below the strong-match threshold', () => {
    expect(createProjectKnowledgeQuery({ task: 'project' }).strongTerms).toEqual([]);
    expect(
      createProjectKnowledgeQuery({ task: 'project knowledge retrieval' }).strongTerms,
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
      const results = await provider.retrieve(query);
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
          await provider.retrieve(createProjectKnowledgeQuery({ task: 'x' })),
        ),
      ).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('remote project knowledge provider', () => {
  test('sends the fixed v1 request and keeps server order without retry', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(JSON.parse(String(init.body))).toEqual({
        query: '任务\nTarget path: src/app.ts\nPhase: build',
        limit: 4,
        scope: 'demo',
      });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
      return new Response(
        JSON.stringify({
          results: [
            { source: 'docs/b.md', content: 'B' },
            { source: 'docs/a.md', content: 'A' },
          ],
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
    const results = await provider.retrieve(
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
    const results = await provider.retrieve(
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

      const results = await provider.retrieve(
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
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
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
        provider.retrieve(
          createProjectKnowledgeQuery({ task: 'project knowledge outside secret' }),
        ),
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
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
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
      const results = await provider.retrieve(
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

      const results = await provider.retrieve(
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
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      {
        code: 'local-tool-missing',
        message:
          'Local project knowledge search is unavailable; install ripgrep or keep the bundled binary available.',
      },
    ]);
  });

  test('does not retry or fall back to local results after a remote failure', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const fetch = vi.fn(async () => new Response('upstream failure', { status: 503 }));
    const provider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://example.test/retrieve', timeout_ms: 1000 },
      fetch,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(diagnostics).toEqual([
      { code: 'remote-status', message: 'Remote project knowledge returned HTTP 503.' },
    ]);
  });

  test('reports invalid remote JSON and preserves parseable task execution', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const provider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://example.test/retrieve', timeout_ms: 1000 },
      fetch: async () => new Response('{not-json'),
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      { code: 'remote-json', message: 'Remote project knowledge returned invalid JSON.' },
    ]);
  });

  test('reports remote timeout and response-size failures without leaking response data', async () => {
    const timeoutDiagnostics: { code: string; message: string }[] = [];
    const timeoutProvider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://example.test/retrieve', timeout_ms: 20 },
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
      reportDiagnostic: (diagnostic) => timeoutDiagnostics.push(diagnostic),
    });
    await expect(
      timeoutProvider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(timeoutDiagnostics).toEqual([
      { code: 'remote-failed', message: 'Remote project knowledge request timed out.' },
    ]);

    const oversizedDiagnostics: { code: string; message: string }[] = [];
    const oversizedProvider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://example.test/retrieve', timeout_ms: 1000 },
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [{ source: 'docs/large.md', content: 'x'.repeat(1024 * 1024) }],
          }),
        ),
      reportDiagnostic: (diagnostic) => oversizedDiagnostics.push(diagnostic),
    });
    await expect(
      oversizedProvider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(oversizedDiagnostics[0]?.code).toBe('remote-failed');
    expect(oversizedDiagnostics[0]?.message).not.toContain('x'.repeat(64));
  });

  test('skips remote retrieval when its token environment variable is absent', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const fetch = vi.fn();
    const provider = new RemoteProjectKnowledgeProvider({
      config: {
        endpoint: 'https://example.test/retrieve',
        token_env: 'MISSING_COMET_KNOWLEDGE_TOKEN',
        timeout_ms: 1000,
      },
      env: {},
      fetch,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(
      provider.retrieve(createProjectKnowledgeQuery({ task: 'project knowledge' })),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(diagnostics[0]?.code).toBe('remote-token');
  });

  test('rejects invalid remote results while preserving valid server order', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const provider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://example.test/retrieve', timeout_ms: 1000 },
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [
              { source: 'docs/ok.md', content: 'first' },
              { source: 'docs/bad.md', content: 'bad', score: 'not-a-number' },
              { source: 'docs/second.md', content: 'second' },
            ],
          }),
        ),
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const results = await provider.retrieve(
      createProjectKnowledgeQuery({ task: 'project knowledge' }),
    );
    expect(results.map((entry) => entry.source)).toEqual(['docs/ok.md', 'docs/second.md']);
    expect(diagnostics).toEqual([
      {
        code: 'remote-schema',
        message: 'Remote project knowledge response contained an invalid result.',
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
      const results = await provider.retrieve(
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
});
