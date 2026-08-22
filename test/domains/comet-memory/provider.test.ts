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
                kind: 'explicit',
                active: true,
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
