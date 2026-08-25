import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  projectKnowledgeCorrectCommand,
  projectKnowledgeFeedbackCommand,
  projectKnowledgeForgetCommand,
  projectKnowledgeGetCommand,
  projectKnowledgeListCommand,
  projectKnowledgeQueryCommand,
  projectKnowledgeRebuildCommand,
  projectKnowledgeStatusCommand,
} from '../../app/commands/project-knowledge.js';
import {
  LocalProjectKnowledgeProvider,
  type ProjectKnowledgeRecord,
} from '../../domains/project-knowledge/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

async function projectFixture(): Promise<{ root: string; cacheRoot: string; source: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-command-'));
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-command-cache-'));
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: native',
      'workflows: [native]',
      'native:',
      '  artifact_root: docs',
      'knowledge:',
      '  provider: local',
      '',
    ].join('\n'),
  );
  const source = path.join(root, 'docs', 'comet', 'specs', 'retrieval.md');
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, '# 混合召回\n\n项目知识使用 SQLite FTS5 和 ripgrep。\n');
  return { root, cacheRoot, source };
}

afterEach(() => vi.restoreAllMocks());

describe('comet knowledge commands', () => {
  test('reports status, refreshes, and queries through the Local Provider', async () => {
    const { root, cacheRoot } = await projectFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        projectKnowledgeStatusCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({
        provider: 'local',
        status: { healthy: true, writable: true },
      });

      await expect(
        projectKnowledgeRebuildCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({
        provider: 'local',
        result: { kind: 'refresh' },
      });

      await expect(
        projectKnowledgeQueryCommand(root, {
          json: true,
          cacheRoot,
          task: 'SQLite FTS5 项目知识混合召回',
          path: 'docs/comet/specs',
          operation: 'verify',
        }),
      ).resolves.toMatchObject({
        result: {
          kind: 'search',
          results: expect.arrayContaining([
            expect.objectContaining({ source: 'docs/comet/specs/retrieval.md' }),
          ]),
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('lists, gets, corrects, and forgets Records without project files', async () => {
    const { root, cacheRoot, source } = await projectFixture();
    const stat = await fs.stat(source);
    const record: ProjectKnowledgeRecord = {
      id: 'record-command',
      projectId: resolveStableProjectId(root),
      type: 'pattern',
      state: 'proven',
      authority: 'automatic',
      title: '命令记录',
      summary: '命令记录摘要。',
      applicablePaths: ['docs/'],
      operations: ['verify'],
      conclusions: [
        { text: '先验证来源。', sources: [{ source: 'docs/comet/specs/retrieval.md' }] },
      ],
      relations: [],
      verification: [],
      sourceVersions: [
        {
          source: 'docs/comet/specs/retrieval.md',
          size: stat.size,
          modifiedAt: Math.trunc(stat.mtimeMs),
        },
      ],
      applicationCount: 0,
      successCount: 0,
      failureCount: 0,
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    const seed = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot,
      corpus: [],
    });
    await seed.apply({ kind: 'upsert', record });
    seed.close();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        projectKnowledgeListCommand(root, { json: true, cacheRoot, state: 'all' }),
      ).resolves.toMatchObject({
        result: { records: [expect.objectContaining({ id: record.id })] },
      });
      await expect(
        projectKnowledgeGetCommand(root, { json: true, cacheRoot, id: record.id }),
      ).resolves.toMatchObject({ result: { record: { id: record.id } } });
      await expect(
        projectKnowledgeCorrectCommand(root, {
          json: true,
          cacheRoot,
          id: record.id,
          text: '用户纠正后的说明。',
        }),
      ).resolves.toMatchObject({ result: { record: { authority: 'user' } } });
      await expect(
        projectKnowledgeFeedbackCommand(root, {
          json: true,
          cacheRoot,
          id: record.id,
          outcome: 'used-successfully',
        }),
      ).resolves.toMatchObject({
        result: {
          record: {
            id: record.id,
            applicationCount: 1,
            successCount: 1,
          },
        },
      });
      await expect(
        projectKnowledgeForgetCommand(root, { json: true, cacheRoot, id: record.id }),
      ).resolves.toMatchObject({ result: { record: { state: 'superseded' } } });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
