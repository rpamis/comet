import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  projectKnowledgeQueryCommand,
  projectKnowledgeRebuildCommand,
  projectKnowledgeStatusCommand,
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
        results: [expect.objectContaining({ source: 'docs/comet/specs/retrieval.md' })],
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
});
