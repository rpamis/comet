import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  projectKnowledgeQueryCommand,
  projectKnowledgeRebuildCommand,
  projectKnowledgeStatusCommand,
  projectKnowledgeUnitsGetCommand,
  projectKnowledgeUnitsListCommand,
  projectKnowledgeUnitsRetireCommand,
  projectKnowledgeUnitsShareCommand,
} from '../../app/commands/project-knowledge.js';

async function projectFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-command-'));
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
  const file = path.join(root, 'docs', 'comet', 'specs', 'retrieval.md');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '# 混合召回\n\n项目知识使用 SQLite FTS5 和 ripgrep。\n');
  return root;
}

afterEach(() => vi.restoreAllMocks());

describe('comet knowledge commands', () => {
  test('reports empty status, rebuilds, and performs a supplemental query', async () => {
    const root = await projectFixture();
    const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-command-cache-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        projectKnowledgeStatusCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({
        provider: 'local',
        index: { available: false, sources: 0, sections: 0 },
      });

      await expect(
        projectKnowledgeRebuildCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({
        provider: 'local',
        rebuilt: true,
        sources: 1,
        sections: 1,
      });

      await expect(
        projectKnowledgeQueryCommand(root, {
          json: true,
          cacheRoot,
          query: 'SQLite FTS5 项目知识混合召回',
          path: 'docs/comet/specs',
          operation: 'verify',
        }),
      ).resolves.toMatchObject({
        provider: 'local',
        results: expect.arrayContaining([
          expect.objectContaining({ source: 'docs/comet/specs/retrieval.md' }),
        ]),
      });

      await expect(
        projectKnowledgeStatusCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({
        index: {
          available: true,
          sources: 1,
          sections: 1,
          channels: expect.arrayContaining(['fts-terms']),
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('lists and reads units without writing, then requires explicit share and retire actions', async () => {
    const root = await projectFixture();
    const cacheRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'comet-knowledge-unit-command-cache-'),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const unit = {
        schema: 'comet.project-knowledge.unit.v1',
        id: 'generated-command-unit',
        kind: 'behavior-note',
        state: 'active',
        origin: 'generated',
        title: '命令单元',
        summary: '命令单元摘要。',
        applicable_paths: ['src/'],
        operations: ['verify'],
        conclusions: [
          { text: '先验证来源。', sources: [{ source: 'docs/comet/specs/retrieval.md' }] },
        ],
        relations: [],
      };
      const generatedRoot = path.join(cacheRoot, 'project-knowledge', 'units');
      await fs.mkdir(generatedRoot, { recursive: true });
      await fs.writeFile(
        path.join(generatedRoot, `${unit.id}.md`),
        `---\n${JSON.stringify(unit)}\n---\n`,
      );
      await expect(
        projectKnowledgeUnitsListCommand(root, { json: true, cacheRoot }),
      ).resolves.toMatchObject({ units: [expect.objectContaining({ id: unit.id })] });
      await expect(
        projectKnowledgeUnitsGetCommand(root, { json: true, cacheRoot, id: unit.id }),
      ).resolves.toMatchObject({ unit: expect.objectContaining({ id: unit.id }) });
      await expect(
        projectKnowledgeUnitsShareCommand(root, { json: true, cacheRoot, id: unit.id }),
      ).rejects.toThrow(/confirm/u);
      await expect(
        projectKnowledgeUnitsShareCommand(root, {
          json: true,
          cacheRoot,
          id: unit.id,
          confirm: true,
        }),
      ).resolves.toMatchObject({ unit: { origin: 'maintained' } });
      await expect(
        projectKnowledgeUnitsRetireCommand(root, {
          json: true,
          cacheRoot,
          id: unit.id,
          confirm: true,
        }),
      ).resolves.toMatchObject({ unit: { state: 'retired' } });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
