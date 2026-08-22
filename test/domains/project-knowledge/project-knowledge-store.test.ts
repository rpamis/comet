import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { ProjectKnowledgeLocalStore } from '../../../domains/project-knowledge/local-store.js';
import type { ProjectKnowledgeRecord } from '../../../domains/project-knowledge/records.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function record(overrides: Partial<ProjectKnowledgeRecord> = {}): ProjectKnowledgeRecord {
  return {
    id: 'record-build-test',
    projectId: 'project-comet',
    type: 'build-test',
    state: 'active',
    authority: 'automatic',
    title: 'Build and test contract',
    summary: 'Run build before test when touching runtime assets.',
    applicablePaths: ['domains/project-knowledge/'],
    operations: ['build', 'test'],
    conclusions: [
      {
        text: 'Build before test for runtime changes.',
        sources: [{ source: 'docs/process.md', anchor: 'build' }],
      },
    ],
    relations: [],
    verification: [{ command: 'pnpm test', expected: 'pass' }],
    sourceVersions: [{ source: 'docs/process.md', size: 100, modifiedAt: 1 }],
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('project knowledge local store', () => {
  test('persists records across store instances and blocks unchanged automatic resurrection after retire', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-');
    const sourceFile = path.join(root, 'docs', 'process.md');
    let first: ProjectKnowledgeLocalStore | undefined;
    let reopened: ProjectKnowledgeLocalStore | undefined;
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, '# Build\n\nRun build before test.\n');
    try {
      first = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record();
      await expect(first.apply({ kind: 'upsert', record: initial })).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({ id: initial.id, state: 'active' }),
      });
      first.close();
      first = undefined;

      reopened = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      expect(reopened.read(initial.id)).toMatchObject({ id: initial.id, authority: 'automatic' });
      await expect(
        reopened.apply({
          kind: 'correct',
          id: initial.id,
          projectId: initial.projectId,
          summary: 'Always build before test for runtime touching changes.',
          conclusions: [
            {
              text: 'User-confirmed build-before-test rule.',
              sources: [{ source: 'docs/process.md', anchor: 'build' }],
            },
          ],
          updatedAt: '2026-08-22T00:01:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          id: initial.id,
          authority: 'user',
          state: 'needs-review',
          summary: 'Always build before test for runtime touching changes.',
        }),
      });

      await expect(
        reopened.apply({
          kind: 'retire',
          id: initial.id,
          projectId: initial.projectId,
          updatedAt: '2026-08-22T00:02:00.000Z',
          reason: 'No longer current.',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({ id: initial.id, state: 'retired' }),
      });

      await expect(reopened.apply({ kind: 'upsert', record: initial })).resolves.toMatchObject({
        changed: false,
        record: expect.objectContaining({ id: initial.id, state: 'retired' }),
      });

      const refreshed = record({
        summary: 'The source changed and now requires build plus targeted tests.',
        sourceVersions: [{ source: 'docs/process.md', size: 101, modifiedAt: 2 }],
        updatedAt: '2026-08-22T00:03:00.000Z',
      });
      await expect(reopened.apply({ kind: 'upsert', record: refreshed })).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          id: refreshed.id,
          state: 'active',
          authority: 'automatic',
          summary: refreshed.summary,
        }),
      });
    } finally {
      reopened?.close();
      first?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('shares records across worktrees but isolates workspace section search', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-worktree-');
    const worktree = `${root}-worktree`;
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-worktree-');
    let primaryStore: ProjectKnowledgeLocalStore | undefined;
    let linkedStore: ProjectKnowledgeLocalStore | undefined;
    try {
      execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root });
      await fs.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'docs', 'knowledge.md'),
        '# Primary\n\nprimary only detail\n',
      );
      await fs.writeFile(path.join(root, 'README.md'), '# test\n');
      execFileSync('git', ['add', 'README.md', 'docs/knowledge.md'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'test'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'other', worktree], {
        cwd: root,
        stdio: 'ignore',
      });
      await fs.writeFile(
        path.join(worktree, 'docs', 'knowledge.md'),
        '# Linked\n\nlinked workspace detail\n',
      );

      primaryStore = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      linkedStore = new ProjectKnowledgeLocalStore({ projectRoot: worktree, storageRoot });
      const shared = record({
        id: 'record-shared',
        type: 'module-overview',
        title: 'Shared repository record',
        summary: 'Visible to both worktrees.',
      });

      await primaryStore.apply({ kind: 'upsert', record: shared });
      expect(linkedStore.read(shared.id)).toMatchObject({ id: shared.id, summary: shared.summary });

      const primaryCorpus = [
        {
          absolutePath: path.join(root, 'docs', 'knowledge.md'),
          source: 'docs/knowledge.md',
          kind: 'native-spec' as const,
        },
      ];
      const linkedCorpus = [
        {
          absolutePath: path.join(worktree, 'docs', 'knowledge.md'),
          source: 'docs/knowledge.md',
          kind: 'native-spec' as const,
        },
      ];
      await primaryStore.syncCorpus(primaryCorpus);
      await linkedStore.syncCorpus(linkedCorpus);

      const query = {
        task: 'detail',
        path: undefined,
        phase: undefined,
        operation: undefined,
        terms: ['detail'],
        strongTerms: ['detail'],
        phraseTerms: [],
        weakTerms: ['detail'],
        remoteQuery: 'detail',
      };
      expect(primaryStore.searchSections(query).map((result) => result.content)).toEqual(
        expect.arrayContaining([expect.stringContaining('primary only detail')]),
      );
      expect(
        primaryStore
          .searchSections(query)
          .map((result) => result.content)
          .join('\n'),
      ).not.toContain('linked workspace detail');
      expect(linkedStore.searchSections(query).map((result) => result.content)).toEqual(
        expect.arrayContaining([expect.stringContaining('linked workspace detail')]),
      );
      expect(
        linkedStore
          .searchSections(query)
          .map((result) => result.content)
          .join('\n'),
      ).not.toContain('primary only detail');
    } finally {
      primaryStore?.close();
      linkedStore?.close();
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], {
          cwd: root,
          stdio: 'ignore',
        });
      } catch {
        // Temporary-directory cleanup below is enough if Git cleanup fails.
      }
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
