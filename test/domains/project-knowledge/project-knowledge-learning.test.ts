import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ProjectKnowledgeLearningService,
  ProjectKnowledgeUnitRepository,
  createProjectKnowledgeReviewPacket,
  type ProjectKnowledgeReviewAction,
  type ProjectKnowledgeSemanticReviewer,
  type ProjectKnowledgeUnit,
} from '../../../domains/project-knowledge/index.js';
import type { PluginEvent } from '../../../domains/comet-plugin/index.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function generatedUnit(state: ProjectKnowledgeUnit['state'] = 'draft'): ProjectKnowledgeUnit {
  return {
    schema: 'comet.project-knowledge.unit.v1',
    id: 'generated-behavior',
    kind: 'behavior-note',
    state,
    origin: 'generated',
    title: '验证后的行为',
    summary: '完成验证后可以复用的行为语义。',
    applicablePaths: ['src/'],
    operations: ['implement', 'verify'],
    conclusions: [
      {
        text: '入口完成验证后必须同步检查调用方。',
        sources: [{ source: 'src/main.ts', anchor: 'main' }],
      },
    ],
    relations: [],
    verification: [{ command: 'pnpm test', expected: '成功' }],
  };
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

describe('project knowledge learning', () => {
  test('creates a bounded review packet only for structured lifecycle evidence', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-packet-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const packet = await createProjectKnowledgeReviewPacket(
        event('change.completed', {
          operation: 'implement',
          changedPaths: ['src/main.ts'],
          verificationCommands: ['pnpm test'],
          verificationResults: [{ command: 'pnpm test', success: true }],
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

  test('activates generated units only after successful verification and current-source checks', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-service-');
    const cache = await temporaryRoot('comet-project-knowledge-learning-cache-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const repository = new ProjectKnowledgeUnitRepository({
        projectRoot: root,
        cacheRoot: cache,
      });
      const reviewer: ProjectKnowledgeSemanticReviewer = {
        review: async (): Promise<readonly ProjectKnowledgeReviewAction[]> => [
          { action: 'create', unit: generatedUnit() },
        ],
      };
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        repository,
        reviewer,
      });
      const result = await service.processEvent(
        event('verification.completed', {
          changedPaths: ['src/main.ts'],
          verificationCommands: ['pnpm test'],
          verificationResults: [{ command: 'pnpm test', success: true }],
        }),
      );
      expect(result.activated).toEqual(['generated-behavior']);
      await expect(repository.read('generated-behavior')).resolves.toMatchObject({
        state: 'active',
        origin: 'generated',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  test('keeps adapter failure and unverified events non-blocking', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-failure-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const repository = new ProjectKnowledgeUnitRepository({ projectRoot: root });
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        repository,
        reviewer: {
          review: async () => {
            throw new Error('adapter unavailable');
          },
        },
      });
      await expect(
        service.processEvent(
          event('change.completed', { changedPaths: ['src/main.ts'], success: false }),
        ),
      ).resolves.toMatchObject({ skipped: true, activated: [] });
      await expect(repository.list({ origin: 'generated' })).resolves.toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('does not activate a unit when any verification result fails or is unstructured', async () => {
    const root = await temporaryRoot('comet-project-knowledge-learning-mixed-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      const repository = new ProjectKnowledgeUnitRepository({ projectRoot: root });
      const service = new ProjectKnowledgeLearningService({
        projectRoot: root,
        repository,
        reviewer: { review: async () => [{ action: 'create', unit: generatedUnit() }] },
      });
      const result = await service.processEvent(
        event('verification.completed', {
          changedPaths: ['src/main.ts'],
          verificationResults: [
            { command: 'pnpm test', success: true },
            { command: 'pnpm lint', success: false },
          ],
        }),
      );
      expect(result.activated).toEqual([]);
      await expect(repository.read('generated-behavior')).resolves.toMatchObject({
        state: 'draft',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
