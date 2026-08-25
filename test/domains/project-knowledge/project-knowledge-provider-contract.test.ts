import { describe, expect, test, vi } from 'vitest';

import {
  RemoteProjectKnowledgeProvider,
  createProjectKnowledgeQuery,
  type ProjectKnowledgeRecord,
} from '../../../domains/project-knowledge/index.js';

function record(): ProjectKnowledgeRecord {
  return {
    id: 'record-remote',
    projectId: 'comet-remote',
    type: 'pattern',
    state: 'proven',
    authority: 'automatic',
    title: 'Remote rule',
    summary: 'Use focused verification.',
    applicablePaths: ['domains/'],
    operations: ['verify'],
    conclusions: [
      {
        text: 'Run the focused test first.',
        sources: [{ source: 'docs/rule.md', evidence: 'secret source excerpt' }],
      },
    ],
    relations: [],
    verification: [],
    sourceVersions: [{ source: 'docs/rule.md', size: 10, modifiedAt: 1 }],
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

function provider(
  body: unknown,
  options: { readonly env?: NodeJS.ProcessEnv; readonly tokenEnv?: string } = {},
) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const instance = new RemoteProjectKnowledgeProvider({
    config: {
      endpoint: 'https://knowledge.example.test/provider',
      ...(options.tokenEnv ? { token_env: options.tokenEnv } : {}),
      scope: 'team-a',
      timeout_ms: 500,
    },
    projectId: 'comet-remote',
    env: options.env,
    fetch: async (url, init) => {
      requests.push({ url, init });
      const request = JSON.parse(String(init?.body)) as {
        operation: 'status' | 'query' | 'apply';
        projectId: string;
      };
      return new Response(
        JSON.stringify({
          schema: 'comet.project-knowledge.provider.v1',
          operation: request.operation,
          projectId: request.projectId,
          result: body,
        }),
        { status: 200 },
      );
    },
  });
  return { instance, requests };
}

describe('remote project knowledge provider contract', () => {
  test('uses one bounded v1 envelope for status, query, and apply', async () => {
    const { instance, requests } = provider({
      provider: 'remote',
      healthy: true,
      writable: true,
      recordCount: 1,
      diagnostics: [],
    });
    await instance.status();
    const queryProvider = provider({
      kind: 'search',
      hits: [{ record: record() }],
      records: [record()],
      results: [
        {
          source: 'record:record-remote',
          title: 'Remote rule',
          content: 'Use focused verification.',
          record: record(),
        },
      ],
      truncated: false,
      diagnostics: [],
    });
    await queryProvider.instance.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'focused verification' }),
    });
    const applyProvider = provider({
      kind: 'upsert',
      changed: true,
      record: record(),
      diagnostics: [],
    });
    await applyProvider.instance.apply({ kind: 'upsert', record: record() });

    const envelopes = [requests, queryProvider.requests, applyProvider.requests].map(
      (entries) => JSON.parse(String(entries[0]!.init?.body)) as Record<string, unknown>,
    );
    expect(envelopes.map((entry) => entry.operation)).toEqual(['status', 'query', 'apply']);
    expect(envelopes.every((entry) => entry.schema === 'comet.project-knowledge.provider.v1')).toBe(
      true,
    );
    expect(envelopes.every((entry) => entry.scope === 'team-a')).toBe(true);
    expect(envelopes.every((entry) => entry.projectId === 'comet-remote')).toBe(true);
    expect(JSON.stringify(envelopes[2])).not.toContain('secret source excerpt');
  });

  test('parses Record query results and preserves bounded diagnostics', async () => {
    const { instance } = provider({
      kind: 'list',
      records: [record()],
      truncated: false,
      diagnostics: [{ code: 'server-note', message: 'bounded' }],
    });
    const result = await instance.query({ kind: 'list', state: 'all' });
    expect(result).toMatchObject({
      kind: 'list',
      records: [expect.objectContaining({ id: 'record-remote' })],
      diagnostics: [{ code: 'server-note', message: 'bounded' }],
    });
  });

  test('rejects records returned for a different project', async () => {
    const foreign = { ...record(), projectId: 'another-project' };
    const queryProvider = provider({
      kind: 'list',
      records: [foreign],
      truncated: false,
      diagnostics: [],
    });
    await expect(queryProvider.instance.query({ kind: 'list', state: 'all' })).resolves.toEqual(
      expect.objectContaining({ kind: 'list', records: [] }),
    );

    const applyProvider = provider({
      kind: 'upsert',
      changed: true,
      record: foreign,
      diagnostics: [],
    });
    await expect(
      applyProvider.instance.apply({ kind: 'upsert', record: record() }),
    ).resolves.toMatchObject({
      kind: 'upsert',
      changed: false,
      diagnostics: [expect.objectContaining({ code: 'remote-schema' })],
    });
  });

  test('rejects a foreign response envelope before accepting manifest or search content', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const instance = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://knowledge.example.test/provider', timeout_ms: 500 },
      projectId: 'comet-remote',
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string };
        return new Response(
          JSON.stringify({
            schema: 'comet.project-knowledge.provider.v1',
            operation: request.operation,
            projectId: 'another-project',
            result: {
              kind: 'manifest',
              items: [
                {
                  id: 'foreign',
                  memoryType: 'project-policy',
                  type: 'pattern',
                  state: 'proven',
                  authority: 'automatic',
                  title: 'Foreign rule',
                  summary: 'Must not cross the project boundary.',
                },
              ],
            },
          }),
        );
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      instance.query({ kind: 'manifest', projectId: 'comet-remote' }),
    ).resolves.toMatchObject({ kind: 'manifest', items: [] });
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'remote-schema' })]),
    );
  });

  test('keeps manifest, expand, and Learning Delta operations on the Remote Provider seam', async () => {
    const manifestProvider = provider({
      kind: 'manifest',
      items: [
        {
          id: 'record-remote',
          memoryType: 'project-policy',
          type: 'pattern',
          state: 'proven',
          authority: 'automatic',
          title: 'Remote rule',
          summary: 'Use focused verification.',
          applicablePaths: ['domains/'],
          operations: ['verify'],
          phases: ['build'],
          sourceTypes: ['docs/rule.md'],
          verification: [],
        },
      ],
      truncated: false,
      diagnostics: [],
    });
    await expect(
      manifestProvider.instance.query({ kind: 'manifest', projectId: 'comet-remote' }),
    ).resolves.toMatchObject({
      kind: 'manifest',
      items: [expect.objectContaining({ id: 'record-remote', phases: ['build'] })],
    });

    const expandProvider = provider({ kind: 'expand', record: record(), diagnostics: [] });
    await expect(
      expandProvider.instance.query({
        kind: 'expand',
        id: 'record-remote',
        projectId: 'comet-remote',
      }),
    ).resolves.toMatchObject({ kind: 'expand', record: { id: 'record-remote' } });

    const deltaProvider = provider({
      kind: 'experience-delta',
      changed: true,
      record: { ...record(), state: 'superseded' },
      diagnostics: [],
    });
    await expect(
      deltaProvider.instance.apply({
        kind: 'experience-delta',
        idempotencyKey: 'remote-record-supersede',
        delta: {
          action: 'supersede',
          owner: 'project-knowledge',
          targetId: 'record-remote',
          memoryType: 'project-policy',
          kind: 'pattern',
          statement: 'The policy was replaced.',
          applicability: { projectId: 'comet-remote' },
          evidence: [],
          recommendedState: 'superseded',
        },
        updatedAt: '2026-08-24T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ kind: 'experience-delta', changed: true });

    const inputs = [manifestProvider, expandProvider, deltaProvider].map(({ requests }) =>
      JSON.parse(String(requests[0]!.init?.body)),
    );
    expect(inputs.map((entry) => entry.input.kind)).toEqual([
      'manifest',
      'expand',
      'experience-delta',
    ]);
  });

  test('does not send a token value and reports missing token without fetching', async () => {
    const fetch = vi.fn();
    const instance = new RemoteProjectKnowledgeProvider({
      config: {
        endpoint: 'https://knowledge.example.test/provider',
        token_env: 'MISSING_TOKEN',
        timeout_ms: 500,
      },
      projectId: 'comet-remote',
      env: {},
      fetch,
    });
    await expect(instance.status()).resolves.toMatchObject({ healthy: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('returns diagnostics instead of throwing on timeout, HTTP failure, and invalid payload', async () => {
    const diagnostics: { code: string; message: string }[] = [];
    const timeoutProvider = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://knowledge.example.test/provider', timeout_ms: 10 },
      projectId: 'comet-remote',
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(timeoutProvider.status()).resolves.toMatchObject({ healthy: false });
    expect(diagnostics.map((entry) => entry.code)).toContain('remote-failed');

    const invalid = new RemoteProjectKnowledgeProvider({
      config: { endpoint: 'https://knowledge.example.test/provider', timeout_ms: 500 },
      projectId: 'comet-remote',
      fetch: async () => new Response(JSON.stringify({ nope: true })),
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(invalid.status()).resolves.toMatchObject({ healthy: false });
    expect(diagnostics.map((entry) => entry.code)).toContain('remote-schema');
  });
});
