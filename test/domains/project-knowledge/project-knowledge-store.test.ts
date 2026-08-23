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
      const initialStat = await fs.stat(sourceFile);
      first = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        sourceVersions: [
          {
            source: 'docs/process.md',
            size: initialStat.size,
            modifiedAt: Math.trunc(initialStat.mtimeMs),
          },
        ],
      });
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
          state: 'active',
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

  test('marks stale records for review and restores them only after anchors validate', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-refresh-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-refresh-');
    const sourceFile = path.join(root, 'docs', 'process.md');
    let store: ProjectKnowledgeLocalStore | undefined;
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, '# Build\n\nRun build before test.\n');
    try {
      const initialStat = await fs.stat(sourceFile);
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        sourceVersions: [
          {
            source: 'docs/process.md',
            size: initialStat.size,
            modifiedAt: Math.trunc(initialStat.mtimeMs),
          },
        ],
      });
      await store.apply({ kind: 'upsert', record: initial });

      await fs.writeFile(sourceFile, '# Build\n\nRun focused build and tests.\n');
      await expect(
        store.apply({ kind: 'refresh', projectId: initial.projectId, id: initial.id }),
      ).resolves.toMatchObject({
        changed: true,
        records: [expect.objectContaining({ id: initial.id, state: 'needs-review' })],
      });
      await expect(
        store.apply({ kind: 'refresh', projectId: initial.projectId, id: initial.id }),
      ).resolves.toMatchObject({
        changed: true,
        records: [expect.objectContaining({ id: initial.id, state: 'active' })],
      });

      await fs.writeFile(sourceFile, '# Test\n\nThe build anchor was removed.\n');
      await store.apply({ kind: 'refresh', projectId: initial.projectId, id: initial.id });
      await expect(
        store.apply({ kind: 'refresh', projectId: initial.projectId, id: initial.id }),
      ).resolves.toMatchObject({
        changed: false,
        records: [expect.objectContaining({ id: initial.id, state: 'needs-review' })],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps a user-confirmed record active when it intentionally has no source evidence', async () => {
    const root = await temporaryRoot('comet-project-knowledge-user-record-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-user-record-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const manual = record({
        id: 'manual-project-convention',
        authority: 'user',
        conclusions: [],
        verification: [],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: manual });

      await expect(
        store.apply({
          kind: 'correct',
          id: manual.id,
          projectId: manual.projectId,
          summary: 'Use the user-confirmed project convention.',
          updatedAt: '2026-08-23T00:00:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          id: manual.id,
          authority: 'user',
          state: 'active',
        }),
      });

      await expect(
        store.apply({ kind: 'refresh', projectId: manual.projectId, id: manual.id }),
      ).resolves.toMatchObject({
        records: [expect.objectContaining({ id: manual.id, state: 'active' })],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('ranks path-associated matches first and expands only one relation hop with evidence', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-relations-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-relations-');
    let store: ProjectKnowledgeLocalStore | undefined;
    const sourceFiles = {
      direct: path.join(root, 'docs', 'process.md'),
      other: path.join(root, 'docs', 'other.md'),
      related: path.join(root, 'docs', 'related.md'),
    };
    try {
      await fs.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.writeFile(sourceFiles.direct, '# Build\n\nRuntime knowledge.\n');
      await fs.writeFile(sourceFiles.other, '# Other\n\nRuntime knowledge.\n');
      await fs.writeFile(sourceFiles.related, '# Related\n\nSupporting context.\n');
      const versions = async (source: keyof typeof sourceFiles) => {
        const stat = await fs.stat(sourceFiles[source]);
        return [
          {
            source: `docs/${source === 'direct' ? 'process' : source}.md`,
            size: stat.size,
            modifiedAt: Math.trunc(stat.mtimeMs),
          },
        ];
      };
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const related = record({
        id: 'record-related',
        type: 'module-overview',
        title: 'Related module',
        summary: 'Supporting context without the direct term.',
        applicablePaths: ['supporting/'],
        operations: ['understand'],
        conclusions: [
          {
            text: 'Supporting context.',
            sources: [{ source: 'docs/related.md', anchor: 'related' }],
          },
        ],
        sourceVersions: await versions('related'),
      });
      const direct = record({
        id: 'record-direct',
        type: 'behavior-note',
        title: 'Runtime knowledge',
        summary: 'Runtime knowledge for Project Knowledge work.',
        applicablePaths: ['domains/project-knowledge/'],
        conclusions: [
          {
            text: 'Runtime knowledge is verified.',
            sources: [{ source: 'docs/process.md', anchor: 'build' }],
          },
        ],
        relations: [
          {
            type: 'depends-on',
            targetId: related.id,
            sources: [{ source: 'docs/process.md', anchor: 'build' }],
          },
        ],
        sourceVersions: await versions('direct'),
      });
      const other = record({
        id: 'record-other',
        type: 'project-map',
        title: 'Runtime knowledge elsewhere',
        summary: 'Runtime knowledge outside the requested path.',
        applicablePaths: ['other/'],
        conclusions: [
          { text: 'Runtime knowledge.', sources: [{ source: 'docs/other.md', anchor: 'other' }] },
        ],
        sourceVersions: await versions('other'),
      });
      await store.apply({ kind: 'upsert', record: related });
      await store.apply({ kind: 'upsert', record: direct });
      await store.apply({ kind: 'upsert', record: other });

      const results = store.searchRecords({
        task: 'runtime knowledge',
        path: 'domains/project-knowledge/local-store.ts',
        phase: 'build',
        operation: 'verify',
        terms: ['runtime', 'knowledge'],
        strongTerms: ['runtime'],
        phraseTerms: ['runtime knowledge'],
        weakTerms: ['knowledge'],
        remoteQuery: 'runtime knowledge',
      });
      expect(results.map((result) => result.record?.id)).toEqual([direct.id, other.id, related.id]);
      expect(results.at(-1)).toMatchObject({
        source: 'docs/process.md#build',
        record: expect.objectContaining({ id: related.id }),
      });
    } finally {
      store?.close();
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
