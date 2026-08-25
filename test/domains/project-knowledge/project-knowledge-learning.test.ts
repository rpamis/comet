import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  extractDeterministicProjectRecords,
  LocalProjectKnowledgeProvider,
  ProjectKnowledgeLearningService,
  createProjectKnowledgeReviewPacket,
  createProjectKnowledgeQuery,
  type ProjectKnowledgeRecord,
} from '../../../domains/project-knowledge/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  type AgentExperienceEvent,
} from '../../../domains/agent-learning/index.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function event(
  type: AgentExperienceEvent['type'],
  payload: Record<string, unknown> = {},
): AgentExperienceEvent {
  const changedPaths = Array.isArray(payload.changedPaths)
    ? payload.changedPaths.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const verificationValues = Array.isArray(payload.verificationResults)
    ? payload.verificationResults
    : [];
  const verificationCommands = Array.isArray(payload.verificationCommands)
    ? payload.verificationCommands.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const evidence = [
    ...verificationValues.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const value = entry as { command?: unknown; success?: unknown };
      if (typeof value.command !== 'string' || typeof value.success !== 'boolean') return [];
      return [
        {
          id: `verification-${index}`,
          kind: 'verification' as const,
          summary: value.command,
          command: value.command,
          success: value.success,
        },
      ];
    }),
    ...verificationCommands
      .filter(
        (command) =>
          !verificationValues.some(
            (entry) =>
              entry !== null &&
              typeof entry === 'object' &&
              !Array.isArray(entry) &&
              (entry as { command?: unknown }).command === command,
          ),
      )
      .map((command, index) => ({
        id: `verification-command-${index}`,
        kind: 'verification' as const,
        summary: command,
        command,
      })),
  ];
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId:
      typeof payload.eventId === 'string' ? payload.eventId : `event:${type}:change-learning`,
    episodeId: 'episode:change-learning',
    occurredAt: '2026-08-24T00:00:00.000Z',
    type,
    actor: 'workflow',
    scope: 'project',
    projectId: 'learning-project',
    source: {
      kind: 'workflow',
      name: 'native',
      workflow: 'native',
      changeId: 'change-learning',
    },
    context: {
      workflow: 'native',
      changeId: 'change-learning',
      paths: changedPaths,
      ...(typeof payload.operation === 'string' ? { operation: payload.operation } : {}),
    },
    evidence,
    outcome: {
      status: payload.success === false ? 'contributed-to-failure' : 'used-successfully',
    },
  };
}

async function createProvider(
  root: string,
  storageRoot: string,
): Promise<LocalProjectKnowledgeProvider> {
  return new LocalProjectKnowledgeProvider({
    projectRoot: root,
    cacheRoot: storageRoot,
    corpus: [],
  });
}

function verifiedPayload(): Record<string, unknown> {
  return {
    changedPaths: ['src/main.ts'],
    verificationCommands: ['pnpm test'],
    verificationResults: [{ command: 'pnpm test', success: true }],
  };
}

describe('project knowledge learning', () => {
  test('bootstraps the first-use Project Model from code, config, and custom knowledge sources', async () => {
    const root = await temporaryRoot('comet-project-knowledge-bootstrap-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-bootstrap-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.mkdir(path.join(root, 'docs', 'custom'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'src', 'main.ts'),
        "import { helper } from './helper.js';\nexport const main = helper;\n",
      );
      await fs.writeFile(path.join(root, 'src', 'helper.ts'), 'export const helper = true;\n');
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } }),
      );
      await fs.writeFile(
        path.join(root, 'docs', 'custom', 'architecture.md'),
        '# Architecture\n\nCustom project knowledge.\n',
      );

      const result = await new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
      }).bootstrapProjectModel(['docs/custom/architecture.md']);
      const listed = await provider.query({ kind: 'list', state: 'all', limit: 100 });
      const records = listed.kind === 'list' ? listed.records : [];

      expect(result.skipped).toBe(false);
      expect(records.map((record) => record.type)).toEqual(
        expect.arrayContaining(['topology', 'fact', 'dependency']),
      );
      expect(records.find((record) => record.id === 'generated-knowledge-corpus')).toMatchObject({
        conclusions: [
          expect.objectContaining({
            sources: [expect.objectContaining({ source: 'docs/custom/architecture.md' })],
          }),
        ],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('creates a review packet only for structured lifecycle evidence', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-packet-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const packet = await createProjectKnowledgeReviewPacket(
        event('verification.completed', {
          operation: 'implement',
          ...verifiedPayload(),
          chat: '不要读取这段聊天',
          diff: '不要读取这段 diff',
        }),
        { projectRoot: root },
      );
      expect(packet).toMatchObject({
        eventName: 'verification.completed',
        changedHint: { changedPaths: ['src/main.ts'] },
        sources: [{ source: 'src/main.ts', text: 'export const main = true;\n' }],
      });
      expect(JSON.stringify(packet)).not.toContain('聊天');
      expect(JSON.stringify(packet)).not.toContain('diff');
      await expect(
        createProjectKnowledgeReviewPacket(event('episode.completed'), { projectRoot: root }),
      ).resolves.toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('writes proven records without a semantic reviewer and makes them queryable', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-service-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-learning-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
      });
      const result = await service.processEvent(event('verification.completed', verifiedPayload()));
      expect(result.skipped).toBe(false);
      expect(result.proven).toContain('generated-project-map');
      const listed = await provider.query({ kind: 'list', state: 'proven' });
      expect(listed.kind).toBe('list');
      expect(listed.records.map((record) => record.id)).toContain('generated-project-map');
      await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'module' }),
      });
      await expect(
        provider.query({ kind: 'get', id: 'generated-module-overview' }),
      ).resolves.toMatchObject({
        record: expect.objectContaining({
          state: 'proven',
          conclusions: [
            expect.objectContaining({
              sources: [expect.not.objectContaining({ anchor: 'module' })],
            }),
          ],
        }),
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('returns deterministic deltas while deferring unavailable semantic review', async () => {
    const root = await temporaryRoot('comet-project-knowledge-deferred-review-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-deferred-review-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: async () => {
            throw new Error('semantic reviewer unavailable');
          },
        },
      });

      await expect(
        service.reflectEvent(event('verification.completed', verifiedPayload())),
      ).resolves.toMatchObject({
        skipped: false,
        deferred: true,
        deltas: expect.arrayContaining([
          expect.objectContaining({ owner: 'comet.project-knowledge' }),
        ]),
        diagnostics: [expect.objectContaining({ code: 'reviewer-unavailable' })],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not write failed or unstructured verification events', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-failure-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-learning-failure-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const service = new ProjectKnowledgeLearningService({ projectRoot: root, provider });
      await expect(
        service.processEvent(
          event('verification.completed', {
            ...verifiedPayload(),
            success: false,
          }),
        ),
      ).resolves.toMatchObject({ skipped: true, proven: [] });
      await expect(
        service.processEvent(
          event('verification.completed', {
            changedPaths: ['src/main.ts'],
            verificationResults: [{ command: 'pnpm test', success: false }],
          }),
        ),
      ).resolves.toMatchObject({ skipped: true, proven: [] });
      await expect(provider.query({ kind: 'list', state: 'all' })).resolves.toMatchObject({
        records: [],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('applies semantic reviewer create, update, and supersede actions', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-review-actions-');
    const storageRoot = await temporaryRoot(
      'comet-project-knowledge-learning-review-actions-storage-',
    );
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      const source = path.join(root, 'src', 'main.ts');
      await fs.writeFile(source, 'export const main = true;\n');
      const stat = await fs.stat(source);
      let action: 'create' | 'update' | 'supersede' = 'create';
      const semanticRecord: ProjectKnowledgeRecord = {
        id: 'semantic-main-module',
        projectId: 'learning-project',
        type: 'dependency',
        state: 'trial',
        authority: 'automatic',
        title: 'Main module',
        summary: 'Created by semantic review.',
        applicablePaths: ['src/'],
        operations: ['implement'],
        conclusions: [
          { text: 'The main module exports main.', sources: [{ source: 'src/main.ts' }] },
        ],
        relations: [],
        verification: [],
        sourceVersions: [
          { source: 'src/main.ts', size: stat.size, modifiedAt: Math.trunc(stat.mtimeMs) },
        ],
        applicationCount: 0,
        successCount: 0,
        failureCount: 0,
        updatedAt: '2026-08-23T00:00:00.000Z',
      };
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: () =>
            action === 'supersede'
              ? [{ action: 'supersede', recordId: semanticRecord.id }]
              : [
                  {
                    action,
                    record: {
                      ...semanticRecord,
                      summary:
                        action === 'update'
                          ? 'Updated by semantic review.'
                          : semanticRecord.summary,
                    },
                  },
                ],
        },
      });

      await expect(
        service.processEvent(event('verification.completed', verifiedPayload())),
      ).resolves.toMatchObject({ persisted: expect.arrayContaining([semanticRecord.id]) });
      action = 'update';
      await service.processEvent(
        event('verification.completed', { ...verifiedPayload(), eventId: 'semantic-update' }),
      );
      await expect(provider.query({ kind: 'get', id: semanticRecord.id })).resolves.toMatchObject({
        record: expect.objectContaining({
          summary: 'Updated by semantic review.',
          state: 'trial',
        }),
      });
      action = 'supersede';
      await expect(
        service.processEvent(
          event('verification.completed', { ...verifiedPayload(), eventId: 'semantic-supersede' }),
        ),
      ).resolves.toMatchObject({ superseded: [semanticRecord.id] });
      await expect(provider.query({ kind: 'get', id: semanticRecord.id })).resolves.toMatchObject({
        record: expect.objectContaining({ state: 'superseded' }),
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('forms project policies from review, failure, verification, and archive experience', async () => {
    const root = await temporaryRoot('comet-project-knowledge-policy-events-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-policy-events-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      const source = path.join(root, 'src', 'main.ts');
      await fs.writeFile(source, 'export const main = true;\n');
      const stat = await fs.stat(source);
      const policyTypes = {
        'review.resolved': 'decision',
        'failure.resolved': 'failure-resolution',
        'verification.completed': 'constraint',
        'change.archived': 'procedure',
      } as const;
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: (packet) => {
            const type = policyTypes[packet.eventName as keyof typeof policyTypes];
            if (type === undefined) return [];
            const records: ProjectKnowledgeRecord[] = [
              {
                id: `policy-${type}`,
                projectId: 'learning-project',
                type,
                state: 'trial',
                authority: 'automatic',
                title: `${type} policy`,
                summary: `Learned ${type} policy.`,
                applicablePaths: ['src/'],
                operations: [packet.operation ?? 'implement'],
                conclusions: [
                  {
                    text: `Apply the ${type} policy.`,
                    sources: [{ source: 'src/main.ts' }],
                  },
                ],
                relations: [],
                verification:
                  type === 'constraint' ? [{ command: 'pnpm test', expected: 'pass' }] : [],
                sourceVersions: [
                  {
                    source: 'src/main.ts',
                    size: stat.size,
                    modifiedAt: Math.trunc(stat.mtimeMs),
                  },
                ],
                applicationCount: 0,
                successCount: 0,
                failureCount: 0,
                updatedAt: '2026-08-24T00:00:00.000Z',
              },
            ];
            if (packet.eventName === 'review.resolved') {
              records.push({
                ...records[0]!,
                id: 'policy-pattern',
                type: 'pattern',
                title: 'pattern policy',
                summary: 'Learned pattern policy.',
              });
            }
            return records.map((record) => ({ action: 'create' as const, record }));
          },
        },
      });

      for (const type of Object.keys(policyTypes) as (keyof typeof policyTypes)[]) {
        const result = await service.processEvent(event(type, verifiedPayload()));
        expect(result.persisted).toContain(`policy-${policyTypes[type]}`);
      }

      const listed = await provider.query({ kind: 'list', state: 'all' });
      expect(listed.kind).toBe('list');
      expect(listed.records.map((record) => record.type)).toEqual(
        expect.arrayContaining([
          'decision',
          'pattern',
          'failure-resolution',
          'constraint',
          'procedure',
        ]),
      );
      expect(listed.records.find((record) => record.id === 'policy-constraint')).toMatchObject({
        state: 'trial',
        verification: [{ command: 'pnpm test', expected: 'pass' }],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('creates baseline project policies without a semantic reviewer and enforces proven checks', async () => {
    const root = await temporaryRoot('comet-project-knowledge-baseline-policy-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-baseline-policy-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } }),
      );
      const service = new ProjectKnowledgeLearningService({ projectRoot: root, provider });

      for (const type of [
        'review.resolved',
        'failure.resolved',
        'verification.completed',
        'change.archived',
      ] as const) {
        await service.processEvent(event(type, verifiedPayload()));
      }

      const listed = await provider.query({ kind: 'list', state: 'all' });
      expect(listed.kind).toBe('list');
      expect(listed.records.map((record) => record.type)).toEqual(
        expect.arrayContaining(['decision', 'failure-resolution', 'constraint', 'procedure']),
      );
      expect(listed.records.find((record) => record.type === 'constraint')).toMatchObject({
        state: 'enforced',
        verification: [{ command: 'pnpm test', expected: 'pass' }],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('rejects semantic reviewer records whose source anchors are invalid', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-review-anchor-');
    const storageRoot = await temporaryRoot(
      'comet-project-knowledge-learning-review-anchor-storage-',
    );
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      const source = path.join(root, 'src', 'main.ts');
      await fs.writeFile(source, 'export const main = true;\n');
      const stat = await fs.stat(source);
      const invalidId = 'semantic-invalid-anchor';
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: () => [
            {
              action: 'create',
              record: {
                id: invalidId,
                projectId: 'learning-project',
                type: 'dependency',
                state: 'trial',
                authority: 'automatic',
                title: 'Invalid anchor',
                summary: 'This semantic record references an anchor that does not exist.',
                applicablePaths: ['src/'],
                operations: ['implement'],
                conclusions: [
                  {
                    text: 'The source anchor must exist.',
                    sources: [{ source: 'src/main.ts', anchor: 'missing' }],
                  },
                ],
                relations: [],
                verification: [],
                sourceVersions: [
                  {
                    source: 'src/main.ts',
                    size: stat.size,
                    modifiedAt: Math.trunc(stat.mtimeMs),
                  },
                ],
                applicationCount: 0,
                successCount: 0,
                failureCount: 0,
                updatedAt: '2026-08-23T00:00:00.000Z',
              },
            },
          ],
        },
      });

      await expect(
        service.processEvent(event('verification.completed', verifiedPayload())),
      ).resolves.toMatchObject({
        persisted: expect.not.arrayContaining([invalidId]),
        diagnostics: [expect.objectContaining({ code: 'source-changed', source: 'src/main.ts' })],
      });
      await expect(provider.query({ kind: 'get', id: invalidId })).resolves.toMatchObject({
        record: null,
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not write when a packet source changes during optional enrichment', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-toctou-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-learning-toctou-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: async () => {
            await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = false;\n');
            return [];
          },
        },
      });
      const result = await service.processEvent(event('verification.completed', verifiedPayload()));
      expect(result.skipped).toBe(true);
      expect(result.diagnostics.map((entry) => entry.code)).toContain('source-changed');
      await expect(provider.query({ kind: 'list', state: 'all' })).resolves.toMatchObject({
        records: [],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not overwrite user-authored content with automatic learning', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-user-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-learning-user-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const candidate = (await extractDeterministicProjectRecords({ projectRoot: root })).find(
        (record) => record.id === 'generated-project-map',
      )!;
      const userRecord: ProjectKnowledgeRecord = {
        ...candidate,
        authority: 'user',
        summary: '用户明确维护的项目说明。',
        conclusions: [{ text: '必须先阅读用户规则。', sources: candidate.conclusions[0]!.sources }],
      };
      await provider.apply({ kind: 'upsert', record: userRecord });
      const service = new ProjectKnowledgeLearningService({ projectRoot: root, provider });
      await service.processEvent(event('verification.completed', verifiedPayload()));
      await expect(provider.query({ kind: 'get', id: candidate.id })).resolves.toMatchObject({
        record: expect.objectContaining({
          authority: 'user',
          summary: '用户明确维护的项目说明。',
        }),
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not resurrect a forgotten record with the same source fingerprint', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-retired-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-learning-retired-storage-');
    const provider = await createProvider(root, storageRoot);
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const candidate = (await extractDeterministicProjectRecords({ projectRoot: root })).find(
        (record) => record.id === 'generated-project-map',
      )!;
      await provider.apply({ kind: 'upsert', record: candidate });
      await provider.apply({
        kind: 'supersede',
        id: candidate.id,
        projectId: candidate.projectId,
        updatedAt: new Date().toISOString(),
      });
      const service = new ProjectKnowledgeLearningService({ projectRoot: root, provider });
      await service.processEvent(event('verification.completed', verifiedPayload()));
      await expect(provider.query({ kind: 'get', id: candidate.id })).resolves.toMatchObject({
        record: expect.objectContaining({ state: 'superseded' }),
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
