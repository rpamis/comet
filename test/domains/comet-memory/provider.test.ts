import { afterEach, describe, expect, test, vi } from 'vitest';

import { RemotePersonalMemoryService } from '../../../domains/comet-memory/remote-provider.js';

describe('personal memory provider', () => {
  const originalToken = process.env.COMET_MEMORY_TEST_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.COMET_MEMORY_TEST_TOKEN;
    else process.env.COMET_MEMORY_TEST_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  test('sends query through the versioned Remote Provider protocol without exposing the token', async () => {
    process.env.COMET_MEMORY_TEST_TOKEN = 'test-token';
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        schema: string;
        operation: string;
        profile: string;
        payload: { view: string; query: { task?: string } };
      };
      expect(body.schema).toBe('comet.personal-memory.provider.v1');
      expect(body.operation).toBe('query');
      expect(body.profile).toBe('default');
      expect(body.payload.view).toBe('task');
      expect(body.payload.query.task).toBe('build');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer test-token' });
      return new Response(
        JSON.stringify({
          result: {
            records: [
              {
                id: 'remote-1',
                scope: 'project',
                projectKey: 'remote-project',
                category: '构建约定',
                text: '使用 pnpm build',
                tags: [],
                pathPatterns: [],
                taskTypes: ['build'],
                operations: [],
                phases: [],
                kind: 'explicit',
                authority: 'explicit',
                evidence: [
                  {
                    id: 'remote-evidence-1',
                    kind: 'user',
                    summary: 'User confirmed the build command.',
                  },
                ],
                memoryType: 'collaboration-policy',
                state: 'proven',
                applicationCount: 0,
                successCount: 0,
                failureCount: 0,
                source: { kind: 'user' },
                sources: [{ kind: 'user' }],
                createdAt: '2026-08-22T00:00:00.000Z',
                updatedAt: '2026-08-22T00:00:00.000Z',
              },
            ],
            text: 'server supplied text must not be injected directly',
            truncated: false,
            disabled: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      tokenEnv: 'COMET_MEMORY_TEST_TOKEN',
      projectKey: 'remote-project',
      fetchImpl,
    });

    const result = await service.retrieve({
      view: 'task',
      projectKey: 'remote-project',
      task: 'build',
    });

    expect(result.records[0]?.text).toBe('使用 pnpm build');
    expect(result.text).toContain('使用 pnpm build');
    expect(result.text).not.toContain('server supplied text');
    expect(await service.status()).toMatchObject({
      provider: { provider: 'remote', configured: true, tokenConfigured: true },
    });
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain('test-token');
  });

  test('rejects a Remote Provider record that is missing normalized fields', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ result: { records: [{ id: 'remote-1', scope: 'global' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      fetchImpl,
    });

    await expect(service.retrieve({ view: 'combined' })).rejects.toThrow(
      'Remote Provider returned an invalid memory record',
    );
  });

  test('requires structured fields on Remote Provider Personal Episodes', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              records: [
                {
                  id: 'remote-episode',
                  scope: 'global',
                  category: 'failure-recovery',
                  text: 'Refresh the stale index before retrying retrieval.',
                  tags: [],
                  pathPatterns: [],
                  taskTypes: [],
                  operations: [],
                  phases: [],
                  kind: 'inferred',
                  authority: 'inferred',
                  evidence: [
                    {
                      id: 'remote-episode-evidence',
                      kind: 'failure',
                      summary: 'Retrieval recovered after refreshing the index.',
                      success: true,
                    },
                  ],
                  memoryType: 'personal-episode',
                  state: 'trial',
                  applicationCount: 0,
                  successCount: 0,
                  failureCount: 0,
                  source: { kind: 'workflow' },
                  sources: [{ kind: 'workflow' }],
                  createdAt: '2026-08-24T00:00:00.000Z',
                  updatedAt: '2026-08-24T00:00:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      fetchImpl,
    });

    await expect(service.retrieve({ view: 'combined' })).rejects.toThrow(
      'Remote Provider returned an invalid memory record',
    );
  });

  test('keeps manifest, expand, and Learning Delta operations on the Remote Provider seam', async () => {
    const record = {
      id: 'remote-policy',
      scope: 'project',
      projectKey: 'remote-project',
      category: '验证协作',
      text: '验证阶段先运行聚焦测试',
      tags: [],
      pathPatterns: ['domains/'],
      taskTypes: ['test'],
      operations: ['verify'],
      phases: ['verify'],
      kind: 'explicit',
      authority: 'explicit',
      evidence: [{ id: 'evidence-1', kind: 'user', summary: 'User confirmed this policy.' }],
      memoryType: 'collaboration-policy',
      state: 'proven',
      applicationCount: 0,
      successCount: 0,
      failureCount: 0,
      source: { kind: 'user' },
      sources: [{ kind: 'user' }],
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const operations: string[] = [];
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      projectKey: 'remote-project',
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          operation: string;
          payload: { view?: string; operation?: string };
        };
        operations.push(body.payload.view ?? body.payload.operation ?? body.operation);
        if (body.payload.view === 'manifest') {
          return new Response(
            JSON.stringify({
              result: {
                kind: 'manifest',
                items: [
                  {
                    id: record.id,
                    memoryType: record.memoryType,
                    state: record.state,
                    authority: record.authority,
                    title: record.category,
                    summary: record.text,
                    scope: record.scope,
                    projectKey: record.projectKey,
                    pathPatterns: record.pathPatterns,
                    taskTypes: record.taskTypes,
                    operations: record.operations,
                    phases: record.phases,
                    evidence: record.evidence,
                  },
                ],
                truncated: false,
              },
            }),
          );
        }
        if (body.operation === 'get') {
          return new Response(JSON.stringify({ result: { record } }));
        }
        return new Response(JSON.stringify({ result: { changed: true, record: null } }));
      },
    });

    await expect(
      service.query({
        view: 'manifest',
        query: { projectKey: 'remote-project', phase: 'verify' },
      }),
    ).resolves.toMatchObject({
      kind: 'manifest',
      items: [expect.objectContaining({ id: 'remote-policy', phases: ['verify'] })],
    });
    await expect(
      service.query({ view: 'expand', query: { id: 'remote-policy' } }),
    ).resolves.toMatchObject({ kind: 'expand', record: { id: 'remote-policy' } });
    await expect(
      service.apply({
        operation: 'experience-delta',
        input: {
          idempotencyKey: 'remote-policy-supersede',
          delta: {
            action: 'supersede',
            owner: 'personal-memory',
            targetId: 'remote-policy',
            memoryType: 'collaboration-policy',
            kind: 'project-convention',
            statement: 'The policy was replaced.',
            applicability: { projectId: 'remote-project', phases: ['verify'] },
            evidence: [],
            recommendedState: 'superseded',
          },
        },
      }),
    ).resolves.toMatchObject({ changed: true, record: null });
    expect(operations).toEqual(['manifest', 'get', 'experience-delta']);
  });

  test('rejects a Remote Provider management record that is not normalized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { records: [{}], conflicts: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      fetchImpl,
    });

    await expect(service.manage()).rejects.toThrow(
      'Remote Provider returned an invalid management view',
    );
  });

  test('rejects invalid mutation records instead of returning an unsafe cast', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { record: { id: 'remote-1', scope: 'global' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      fetchImpl,
    });

    await expect(
      service.remember({ scope: 'global', category: '沟通偏好', text: '使用中文回复' }),
    ).rejects.toThrow('Remote Provider returned an invalid memory record');
    await expect(service.get('remote-1')).rejects.toThrow(
      'Remote Provider returned an invalid memory record',
    );
  });

  test('rejects invalid observation and review responses', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { action: 'unknown', persisted: 'yes' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const service = new RemotePersonalMemoryService({
      endpoint: 'https://memory.example.test/provider',
      fetchImpl,
    });

    await expect(
      service.observe({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
        workflow: 'native',
        changeId: 'change-1',
        success: true,
      }),
    ).rejects.toThrow('Remote Provider returned an invalid observation result');
    await expect(
      service.reviewAndApply(
        {
          schema: 'comet.memory.review.v1',
          language: 'zh-CN',
          workflow: 'native',
          changeId: 'change-1',
          createdAt: '2026-08-22T00:00:00.000Z',
          checkpoint: 'verification.completed',
          userEvidence: [],
          evidence: [],
          memories: [],
          budget: { maxActions: 1, maxEvidence: 1, maxBytes: 1000 },
        },
        { schema: 'comet.memory.actions.v1', actions: [] },
      ),
    ).rejects.toThrow('Remote Provider returned an invalid review result');
  });
});
