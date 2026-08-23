import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  extractDeterministicProjectRecords,
  LocalProjectKnowledgeProvider,
  ProjectKnowledgeLearningService,
  createProjectKnowledgeReviewPacket,
  type ProjectKnowledgeRecord,
} from '../../../domains/project-knowledge/index.js';
import type { PluginEvent } from '../../../domains/comet-plugin/index.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function event(name: PluginEvent['name'], payload: Record<string, unknown> = {}): PluginEvent {
  return {
    name,
    scope: 'project',
    projectId: 'learning-project',
    source: {
      kind: 'workflow',
      name: 'native',
      change: 'change-learning',
      projectId: 'learning-project',
    },
    payload: {
      workflow: 'native',
      changeId: 'change-learning',
      success: true,
      ...payload,
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
  test('creates a bounded review packet only for structured lifecycle evidence', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-packet-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const packet = await createProjectKnowledgeReviewPacket(
        event('change.completed', {
          operation: 'implement',
          ...verifiedPayload(),
          chat: '不要读取这段聊天',
          diff: '不要读取这段 diff',
        }),
        { projectRoot: root },
      );
      expect(packet).toMatchObject({
        eventName: 'change.completed',
        changedHint: { changedPaths: ['src/main.ts'] },
        sources: [{ source: 'src/main.ts', text: 'export const main = true;\n' }],
      });
      expect(JSON.stringify(packet)).not.toContain('聊天');
      expect(JSON.stringify(packet)).not.toContain('diff');
      await expect(
        createProjectKnowledgeReviewPacket(event('task.completed'), { projectRoot: root }),
      ).resolves.toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('writes active records without a semantic reviewer and makes them queryable', async () => {
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
      expect(result.activated).toContain('generated-project-map');
      const listed = await provider.query({ kind: 'list', state: 'active' });
      expect(listed.kind).toBe('list');
      expect(listed.records.map((record) => record.id)).toContain('generated-project-map');
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
          event('change.completed', {
            ...verifiedPayload(),
            success: false,
          }),
        ),
      ).resolves.toMatchObject({ skipped: true, activated: [] });
      await expect(
        service.processEvent(
          event('verification.completed', {
            changedPaths: ['src/main.ts'],
            verificationResults: [{ command: 'pnpm test', success: false }],
          }),
        ),
      ).resolves.toMatchObject({ skipped: true, activated: [] });
      await expect(provider.query({ kind: 'list', state: 'all' })).resolves.toMatchObject({
        records: [],
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('applies bounded semantic reviewer create, update, and retire actions', async () => {
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
      let action: 'create' | 'update' | 'retire' = 'create';
      const semanticRecord: ProjectKnowledgeRecord = {
        id: 'semantic-main-module',
        projectId: 'learning-project',
        type: 'module-overview',
        state: 'active',
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
        updatedAt: '2026-08-23T00:00:00.000Z',
      };
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        provider,
        reviewer: {
          review: () =>
            action === 'retire'
              ? [{ action: 'retire', recordId: semanticRecord.id }]
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
      ).resolves.toMatchObject({ activated: expect.arrayContaining([semanticRecord.id]) });
      action = 'update';
      await service.processEvent(event('verification.completed', verifiedPayload()));
      await expect(provider.query({ kind: 'get', id: semanticRecord.id })).resolves.toMatchObject({
        record: expect.objectContaining({
          summary: 'Updated by semantic review.',
          state: 'active',
        }),
      });
      action = 'retire';
      await expect(
        service.processEvent(event('verification.completed', verifiedPayload())),
      ).resolves.toMatchObject({ retired: [semanticRecord.id] });
      await expect(provider.query({ kind: 'get', id: semanticRecord.id })).resolves.toMatchObject({
        record: expect.objectContaining({ state: 'retired' }),
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
        kind: 'retire',
        id: candidate.id,
        projectId: candidate.projectId,
        updatedAt: new Date().toISOString(),
      });
      const service = new ProjectKnowledgeLearningService({ projectRoot: root, provider });
      await service.processEvent(event('verification.completed', verifiedPayload()));
      await expect(provider.query({ kind: 'get', id: candidate.id })).resolves.toMatchObject({
        record: expect.objectContaining({ state: 'retired' }),
      });
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
