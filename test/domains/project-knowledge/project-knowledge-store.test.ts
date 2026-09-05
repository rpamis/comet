import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { ProjectKnowledgeLocalStore } from '../../../domains/project-knowledge/local-store.js';
import { createProjectKnowledgeQuery } from '../../../domains/project-knowledge/query.js';
import type { ProjectKnowledgeRecord } from '../../../domains/project-knowledge/records.js';
import { openProjectKnowledgeDatabase } from '../../../domains/project-knowledge/sqlite.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function record(overrides: Partial<ProjectKnowledgeRecord> = {}): ProjectKnowledgeRecord {
  return {
    id: 'record-build-test',
    projectId: 'project-comet',
    type: 'procedure',
    state: 'proven',
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
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function insertLegacyRecords(
  databasePath: string,
  records: readonly ProjectKnowledgeRecord[],
): void {
  const database = openProjectKnowledgeDatabase(databasePath);
  try {
    const statement = database.prepare(
      'INSERT OR REPLACE INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const candidate of records) {
      statement.run(
        candidate.id,
        candidate.projectId,
        candidate.type,
        candidate.state,
        candidate.authority,
        JSON.stringify(candidate),
        JSON.stringify(candidate.sourceVersions),
        candidate.updatedAt,
      );
    }
  } finally {
    database.close();
  }
}

describe('project knowledge local store', () => {
  test('ranks task-relevant trial knowledge above broad proven records during discovery', async () => {
    const root = await temporaryRoot('comet-knowledge-task-ranking-');
    const storageRoot = await temporaryRoot('comet-knowledge-task-ranking-cache-');
    const store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
    try {
      const common = { applicablePaths: [], operations: [], conclusions: [], sourceVersions: [] };
      await store.apply({
        kind: 'upsert',
        record: record({
          ...common,
          id: 'broad-proven',
          title: 'Router background',
          summary: 'Router modules',
          state: 'proven',
        }),
      });
      await store.apply({
        kind: 'upsert',
        record: record({
          ...common,
          id: 'specific-trial',
          title: 'Router dispatch invariants',
          summary: 'Only the selected workflow receives events',
          state: 'trial',
        }),
      });
      expect(
        store.searchRecords(createProjectKnowledgeQuery({ task: 'Router dispatch invariants' }))[0]
          ?.record?.id,
      ).toBe('specific-trial');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('discovers scoped knowledge from task text while respecting explicit selectors', async () => {
    const root = await temporaryRoot('comet-knowledge-discovery-');
    const storageRoot = await temporaryRoot('comet-knowledge-discovery-storage-');
    const store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
    try {
      await store.apply({
        kind: 'upsert',
        record: record({
          authority: 'user',
          verification: [],
          conclusions: [],
          sourceVersions: [],
        }),
      });
      const query = { task: 'Build and test contract', projectId: 'project-comet' };
      expect(
        store.searchRecords(createProjectKnowledgeQuery(query)).map((entry) => entry.record?.id),
      ).toContain('record-build-test');
      expect(
        store.searchRecords(createProjectKnowledgeQuery({ ...query, path: 'unrelated/file.ts' })),
      ).toHaveLength(0);
      expect(
        store.searchRecords(createProjectKnowledgeQuery({ ...query, operation: 'publish' })),
      ).toHaveLength(0);
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps source-current trial knowledge unproven until successful use', async () => {
    const root = await temporaryRoot('comet-knowledge-trial-');
    const storageRoot = await temporaryRoot('comet-knowledge-trial-storage-');
    const store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
    try {
      await fs.mkdir(path.join(root, 'docs'));
      const text = '# build\n\nBuild before test for runtime changes.\n';
      await fs.writeFile(path.join(root, 'docs/process.md'), text);
      const stat = await fs.stat(path.join(root, 'docs/process.md'));
      const trial = record({
        state: 'trial',
        verification: [],
        sourceVersions: [
          {
            source: 'docs/process.md',
            size: stat.size,
            modifiedAt: Math.floor(stat.mtimeMs),
            digest: createHash('sha256').update(text).digest('hex'),
          },
        ],
      });
      await store.apply({ kind: 'upsert', record: trial });
      expect(
        await store.apply({ kind: 'refresh', projectId: trial.projectId, id: trial.id }),
      ).toMatchObject({ records: [expect.objectContaining({ state: 'trial', successCount: 0 })] });
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('counts records within the current project independently of list limits', async () => {
    const root = await temporaryRoot('comet-project-knowledge-counts-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-counts-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      await store.apply({ kind: 'upsert', record: record({ id: 'trial', state: 'trial' }) });
      await store.apply({ kind: 'upsert', record: record({ id: 'proven', state: 'proven' }) });
      await store.apply({
        kind: 'upsert',
        record: record({ id: 'history', state: 'superseded' }),
      });
      await store.apply({
        kind: 'upsert',
        record: record({ id: 'foreign', projectId: 'another-project', state: 'enforced' }),
      });

      expect(store.projectCounts('project-comet')).toEqual({
        active: 2,
        trial: 1,
        proven: 1,
        enforced: 0,
        superseded: 1,
        total: 3,
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('upgrades machine metadata without clearing existing records', async () => {
    const root = await temporaryRoot('comet-project-knowledge-schema-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-schema-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      await store.apply({ kind: 'upsert', record: record() });
      const databasePath = store.databasePath;
      store.close();
      store = undefined;

      const database = openProjectKnowledgeDatabase(databasePath);
      database.prepare("DELETE FROM pk_meta WHERE key = 'schema_version'").run();
      database.close();

      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      expect(store.list()).toEqual([expect.objectContaining({ id: 'record-build-test' })]);
      expect(store.status()).toMatchObject({ recordCount: 1 });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('persists records and blocks unchanged automatic resurrection after supersede', async () => {
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
        record: expect.objectContaining({ id: initial.id, state: 'proven' }),
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
          state: 'proven',
          summary: 'Always build before test for runtime touching changes.',
        }),
      });

      await expect(
        reopened.apply({
          kind: 'supersede',
          id: initial.id,
          projectId: initial.projectId,
          updatedAt: '2026-08-22T00:02:00.000Z',
          reason: 'No longer current.',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({ id: initial.id, state: 'superseded' }),
      });

      await expect(reopened.apply({ kind: 'upsert', record: initial })).resolves.toMatchObject({
        changed: false,
        record: expect.objectContaining({ id: initial.id, state: 'superseded' }),
      });

      const refreshed = record({
        summary: 'The source changed and now requires build plus targeted tests.',
        sourceVersions: [{ source: 'docs/process.md', size: 101, modifiedAt: 2 }],
        updatedAt: '2026-08-22T00:03:00.000Z',
      });
      const preserved = await reopened.apply({ kind: 'upsert', record: refreshed });
      expect(preserved).toMatchObject({
        changed: false,
        record: expect.objectContaining({
          id: initial.id,
          state: 'superseded',
          authority: 'user',
        }),
      });
    } finally {
      reopened?.close();
      first?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('imports missing and newer legacy records without overwriting newer canonical data', async () => {
    const root = await temporaryRoot('comet-project-knowledge-import-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-import-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      await store.apply({
        kind: 'upsert',
        record: record({
          id: 'record-conflict',
          summary: 'Canonical value',
          updatedAt: '2026-08-22T00:02:00.000Z',
        }),
      });

      expect(
        store.importNewerRecords([
          record({
            id: 'record-conflict',
            summary: 'Older legacy value',
            updatedAt: '2026-08-22T00:01:00.000Z',
          }),
          record({ id: 'record-legacy-only', summary: 'Legacy-only value' }),
        ]),
      ).toBe(1);
      expect(store.read('record-conflict')).toMatchObject({ summary: 'Canonical value' });
      expect(store.read('record-legacy-only')).toMatchObject({ summary: 'Legacy-only value' });

      expect(
        store.importNewerRecords([
          record({
            id: 'record-conflict',
            summary: 'Newer legacy value',
            updatedAt: '2026-08-22T00:03:00.000Z',
          }),
        ]),
      ).toBe(1);
      expect(store.read('record-conflict')).toMatchObject({ summary: 'Newer legacy value' });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not overwrite a newer canonical record written during legacy import', async () => {
    const root = await temporaryRoot('comet-project-knowledge-import-race-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-import-race-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const canonical = record({
        id: 'record-import-race',
        summary: 'Initial canonical value',
        updatedAt: '2026-08-22T00:01:00.000Z',
      });
      await store.apply({ kind: 'upsert', record: canonical });

      let wroteConcurrentRecord = false;
      const incoming = {
        ...record({
          id: canonical.id,
          summary: 'Legacy value',
          updatedAt: '2026-08-22T00:02:00.000Z',
        }),
      };
      Object.defineProperty(incoming, 'updatedAt', {
        enumerable: true,
        get: () => {
          if (!wroteConcurrentRecord) {
            wroteConcurrentRecord = true;
            void store?.apply({
              kind: 'upsert',
              record: record({
                id: canonical.id,
                summary: 'Concurrent canonical value',
                updatedAt: '2026-08-22T00:03:00.000Z',
              }),
            });
          }
          return '2026-08-22T00:02:00.000Z';
        },
      });

      expect(store.importNewerRecords([incoming])).toBe(0);
      expect(store.read(canonical.id)).toMatchObject({
        summary: 'Concurrent canonical value',
        updatedAt: '2026-08-22T00:03:00.000Z',
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('supersedes stale records and creates a new version after relearning', async () => {
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
        records: [expect.objectContaining({ id: initial.id, state: 'superseded' })],
      });
      const changedStat = await fs.stat(sourceFile);
      const relearned = record({
        summary: 'Run focused build and tests.',
        conclusions: [
          {
            text: 'Run focused build and tests.',
            sources: [{ source: 'docs/process.md', anchor: 'build' }],
          },
        ],
        sourceVersions: [
          {
            source: 'docs/process.md',
            size: changedStat.size,
            modifiedAt: Math.trunc(changedStat.mtimeMs),
          },
        ],
      });
      const versioned = await store.apply({ kind: 'upsert', record: relearned });
      expect(versioned).toMatchObject({
        changed: true,
        record: expect.objectContaining({
          id: initial.id,
          state: 'proven',
          relations: [
            expect.objectContaining({
              type: 'supersedes',
              targetId: expect.stringMatching(/-v-/u),
            }),
          ],
        }),
      });
      expect(versioned.record?.id).toBe(initial.id);
      const history = store
        .list({ state: 'superseded' })
        .filter((candidate) => candidate.id.startsWith(`${initial.id}-v-`));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ summary: initial.summary, state: 'superseded' });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('updates source versions without creating history when record semantics are unchanged', async () => {
    const root = await temporaryRoot('comet-project-knowledge-semantic-source-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-semantic-source-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        id: 'generated-project-map',
        type: 'topology',
        authority: 'repository',
      });
      await store.apply({ kind: 'upsert', record: initial });
      const refreshed = record({
        ...initial,
        sourceVersions: [{ source: 'docs/process.md', size: 200, modifiedAt: 99 }],
        updatedAt: '2026-08-22T00:10:00.000Z',
      });

      await expect(store.apply({ kind: 'upsert', record: refreshed })).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          id: 'generated-project-map',
          sourceVersions: refreshed.sourceVersions,
        }),
      });
      expect(
        store.list().filter((candidate) => candidate.id.startsWith('generated-project-map')),
      ).toEqual([expect.objectContaining({ id: 'generated-project-map', state: 'proven' })]);
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not version generated modules when only discovered list order changes', async () => {
    const root = await temporaryRoot('comet-project-knowledge-semantic-order-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-semantic-order-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        id: 'generated-module-domains-example',
        type: 'dependency',
        authority: 'repository',
        summary: '外部调用方：domains/zeta、app/alpha。',
        conclusions: [
          {
            text: '外部调用方：domains/zeta、app/alpha。',
            sources: [{ source: 'domains/zeta/index.ts' }, { source: 'app/alpha/index.ts' }],
          },
        ],
      });
      await store.apply({ kind: 'upsert', record: initial });
      const reordered = record({
        ...initial,
        summary: '外部调用方：app/alpha、domains/zeta。',
        conclusions: [
          {
            text: '外部调用方：app/alpha、domains/zeta。',
            sources: [{ source: 'app/alpha/main.ts' }, { source: 'domains/zeta/caller.ts' }],
          },
        ],
        updatedAt: '2026-08-22T00:10:00.000Z',
      });

      await expect(store.apply({ kind: 'upsert', record: reordered })).resolves.toMatchObject({
        changed: false,
        record: expect.objectContaining({ id: initial.id }),
      });
      expect(
        store.list().filter((candidate) => candidate.id.startsWith(`${initial.id}-v-`)),
      ).toEqual([]);
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('transactionally compacts duplicate generated history while preserving user and feedback records', async () => {
    const root = await temporaryRoot('comet-project-knowledge-maintenance-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-maintenance-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const databasePath = store.databasePath;
      store.close();
      store = undefined;
      const projectMap = record({
        id: 'generated-project-map',
        type: 'topology',
        authority: 'repository',
        state: 'superseded',
        updatedAt: '2026-08-22T00:00:00.000Z',
      });
      insertLegacyRecords(databasePath, [
        record({ id: 'generated-knowledge-corpus-v-aaaaaaaaaaaa' }),
        record({ id: 'generated-module-overview-v-bbbbbbbbbbbb' }),
        record({
          id: 'generated-module-domains-example',
          type: 'dependency',
          authority: 'repository',
        }),
        record({
          id: 'generated-knowledge-corpus-user',
          authority: 'user',
          state: 'superseded',
        }),
        record({
          id: 'generated-module-domains-custom',
          type: 'dependency',
          authority: 'user',
        }),
        record({
          id: 'generated-module-overview-feedback',
          applicationCount: 1,
          lastAppliedAt: '2026-08-22T00:04:00.000Z',
          state: 'superseded',
        }),
        projectMap,
        { ...projectMap, id: 'generated-project-map-v-111111111111', state: 'proven' },
        {
          ...projectMap,
          id: 'generated-project-map-v-222222222222',
          updatedAt: '2026-08-22T00:02:00.000Z',
        },
      ]);
      const legacyMetadata = openProjectKnowledgeDatabase(databasePath);
      legacyMetadata
        .prepare("DELETE FROM pk_meta WHERE key = 'generated-record-maintenance-v2'")
        .run();
      legacyMetadata.close();

      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const once = store.list();
      expect(once.map((candidate) => candidate.id)).not.toEqual(
        expect.arrayContaining([
          'generated-knowledge-corpus-v-aaaaaaaaaaaa',
          'generated-module-overview-v-bbbbbbbbbbbb',
          'generated-module-domains-example',
        ]),
      );
      expect(once).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'generated-project-map', state: 'proven' }),
          expect.objectContaining({ id: 'generated-knowledge-corpus-user', authority: 'user' }),
          expect.objectContaining({ id: 'generated-module-domains-custom', authority: 'user' }),
          expect.objectContaining({
            id: 'generated-module-overview-feedback',
            applicationCount: 1,
          }),
        ]),
      );
      expect(
        once.filter((candidate) => candidate.id.startsWith('generated-project-map')),
      ).toHaveLength(1);
      store.close();
      const observer = openProjectKnowledgeDatabase(databasePath);
      observer.exec(
        "CREATE TRIGGER reject_redundant_delete BEFORE DELETE ON pk_records BEGIN SELECT RAISE(ABORT, 'redundant rewrite'); END;",
      );
      observer.close();
      const diagnostics: Array<{ code: string; message: string }> = [];
      store = new ProjectKnowledgeLocalStore({
        projectRoot: root,
        storageRoot,
        reportDiagnostic: (entry) => diagnostics.push(entry),
      });
      expect(store.list()).toEqual(once);
      expect(diagnostics).toEqual([]);
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('rolls back generated history maintenance when legacy payloads are invalid', async () => {
    const root = await temporaryRoot('comet-project-knowledge-maintenance-rollback-');
    const storageRoot = await temporaryRoot(
      'comet-project-knowledge-maintenance-rollback-storage-',
    );
    const diagnostics: Array<{ code: string; message: string }> = [];
    let store: ProjectKnowledgeLocalStore | undefined;
    let databasePath: string;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      databasePath = store.databasePath;
      store.close();
      store = undefined;
      const database = openProjectKnowledgeDatabase(databasePath);
      database
        .prepare(
          'INSERT INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'generated-project-map',
          'project-comet',
          'topology',
          'proven',
          'repository',
          '{invalid',
          '[]',
          '2026-08-22T00:00:00.000Z',
        );
      database.close();

      store = new ProjectKnowledgeLocalStore({
        projectRoot: root,
        storageRoot,
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });
      expect(diagnostics).toContainEqual({
        code: 'record-maintenance-failed',
        message: '项目知识历史整理失败，已回滚并保留原有记录。',
      });
      store.close();
      store = undefined;
      const check = openProjectKnowledgeDatabase(databasePath, { readOnly: true });
      expect(
        check.prepare('SELECT COUNT(*) AS count FROM pk_records').get() as { count: number },
      ).toMatchObject({ count: 1 });
      check.close();
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('does not keep legacy records active before their source digest is trusted', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-legacy-digest-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-legacy-digest-');
    const sourceFile = path.join(root, 'docs', 'process.md');
    let store: ProjectKnowledgeLocalStore | undefined;
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, '# Build\n\nRun build before test.\n');
    try {
      const initialStat = await fs.stat(sourceFile);
      const sourceDigest = createHash('sha256')
        .update(await fs.readFile(sourceFile))
        .digest('hex');
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

      const refreshed = await store.apply({
        kind: 'refresh',
        projectId: initial.projectId,
        id: initial.id,
      });
      expect(refreshed).toMatchObject({
        changed: true,
        records: [
          expect.objectContaining({
            id: initial.id,
            state: 'superseded',
            sourceVersions: [
              expect.objectContaining({
                source: 'docs/process.md',
                digest: sourceDigest,
              }),
            ],
          }),
        ],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('preserves every refreshed source version when migrating a legacy record', async () => {
    const root = await temporaryRoot('comet-project-knowledge-store-legacy-sources-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-storage-legacy-sources-');
    const sources = ['docs/process.md', 'docs/testing.md'];
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      await Promise.all(
        sources.map(async (source) => {
          const absolutePath = path.join(root, ...source.split('/'));
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(
            absolutePath,
            `# ${path.basename(source, '.md')}\n\nKeep it current.\n`,
          );
        }),
      );
      const stats = await Promise.all(
        sources.map(async (source) => ({
          source,
          stat: await fs.stat(path.join(root, ...source.split('/'))),
        })),
      );
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        sourceVersions: stats.map(({ source, stat }) => ({
          source,
          size: stat.size,
          modifiedAt: Math.trunc(stat.mtimeMs),
        })),
      });
      await store.apply({ kind: 'upsert', record: initial });

      const refreshed = await store.apply({
        kind: 'refresh',
        projectId: initial.projectId,
        id: initial.id,
      });
      expect(refreshed).toMatchObject({
        changed: true,
        records: [
          expect.objectContaining({
            id: initial.id,
            state: 'superseded',
            sourceVersions: expect.arrayContaining(
              sources.map((source) =>
                expect.objectContaining({
                  source,
                  digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
                }),
              ),
            ),
          }),
        ],
      });
      expect(
        (refreshed.records?.[0]?.sourceVersions ?? []).map((version) => version.source),
      ).toEqual(expect.arrayContaining(sources));
      expect(refreshed.records?.[0]?.sourceVersions).toHaveLength(sources.length);
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps records backed by source files larger than one MiB current', async () => {
    const root = await temporaryRoot('comet-project-knowledge-large-source-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-large-source-storage-');
    const sourceFile = path.join(root, 'docs', 'process.md');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, `# Build\n\n${'Keep this source current.\n'.repeat(50_000)}`);
      const sourceBytes = await fs.readFile(sourceFile);
      const sourceStat = await fs.stat(sourceFile);
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({
        verification: [],
        sourceVersions: [
          {
            source: 'docs/process.md',
            size: sourceStat.size,
            modifiedAt: Math.trunc(sourceStat.mtimeMs),
            digest: createHash('sha256').update(sourceBytes).digest('hex'),
          },
        ],
      });
      await store.apply({ kind: 'upsert', record: initial });

      await expect(
        store.apply({ kind: 'refresh', projectId: initial.projectId, id: initial.id }),
      ).resolves.toMatchObject({
        changed: false,
        records: [expect.objectContaining({ id: initial.id, state: 'proven' })],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps version lineage within the relation bound when relearning a dense record', async () => {
    const root = await temporaryRoot('comet-project-knowledge-version-relations-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-version-relations-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const initial = record({ state: 'superseded' });
      await store.apply({ kind: 'upsert', record: initial });
      const incoming = record({
        summary: 'Relearned dense knowledge.',
        sourceVersions: [{ source: 'docs/process.md', size: 101, modifiedAt: 2 }],
        relations: Array.from({ length: 16 }, (_, index) => ({
          type: 'depends-on' as const,
          targetId: `related-${index}`,
          sources: [{ source: 'docs/process.md' }],
        })),
      });

      const versioned = await store.apply({ kind: 'upsert', record: incoming });
      expect(versioned).toMatchObject({
        changed: true,
        record: expect.objectContaining({
          relations: expect.arrayContaining([
            expect.objectContaining({
              type: 'supersedes',
              targetId: expect.stringMatching(/-v-/u),
            }),
          ]),
        }),
      });
      expect(versioned.record?.relations).toHaveLength(16);
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps a user-confirmed record proven when it intentionally has no source evidence', async () => {
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
          state: 'proven',
        }),
      });

      await expect(
        store.apply({ kind: 'refresh', projectId: manual.projectId, id: manual.id }),
      ).resolves.toMatchObject({
        records: [expect.objectContaining({ id: manual.id, state: 'proven' })],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('supersedes an enforced constraint when its package script disappears', async () => {
    const root = await temporaryRoot('comet-project-knowledge-command-refresh-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-command-refresh-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } }),
      );
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const constraint = record({
        id: 'manual-test-constraint',
        type: 'constraint',
        state: 'enforced',
        authority: 'user',
        conclusions: [],
        verification: [{ command: 'pnpm run test', expected: 'pass' }],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: constraint });
      await expect(
        store.apply({ kind: 'refresh', projectId: constraint.projectId, id: constraint.id }),
      ).resolves.toMatchObject({
        changed: false,
        records: [expect.objectContaining({ state: 'enforced' })],
      });

      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
      await expect(
        store.apply({ kind: 'refresh', projectId: constraint.projectId, id: constraint.id }),
      ).resolves.toMatchObject({
        changed: true,
        records: [expect.objectContaining({ state: 'superseded' })],
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps non-package verification commands unless their executable is confirmed missing', async () => {
    const root = await temporaryRoot('comet-project-knowledge-command-markers-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-command-markers-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      const sourcePath = path.join(root, 'docs', 'build.md');
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, '# Build\n\nRun Maven tests.\n');
      await fs.writeFile(path.join(root, 'pom.xml'), '<project />\n');
      const sourceStat = await fs.stat(sourcePath);
      const sourceDigest = createHash('sha256')
        .update(await fs.readFile(sourcePath))
        .digest('hex');
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const constraint = record({
        id: 'maven-constraint',
        type: 'constraint',
        state: 'enforced',
        conclusions: [
          {
            text: 'Run Maven tests.',
            sources: [{ source: 'docs/build.md' }],
          },
        ],
        verification: [{ command: 'mvn test', expected: 'pass' }],
        sourceVersions: [
          {
            source: 'docs/build.md',
            size: sourceStat.size,
            modifiedAt: Math.trunc(sourceStat.mtimeMs),
            digest: sourceDigest,
          },
        ],
      });
      await store.apply({ kind: 'upsert', record: constraint });
      await fs.rm(path.join(root, 'pom.xml'));

      await expect(
        store.apply({ kind: 'refresh', projectId: constraint.projectId, id: constraint.id }),
      ).resolves.toMatchObject({
        changed: false,
        records: [expect.objectContaining({ id: constraint.id, state: 'enforced' })],
      });

      const proven = record({
        id: 'pytest-constraint',
        type: 'constraint',
        state: 'proven',
        conclusions: [],
        verification: [{ command: 'pytest -q', expected: 'pass' }],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: proven });
      await expect(
        store.apply({
          kind: 'verify',
          projectId: proven.projectId,
          commands: ['pytest -q'],
          updatedAt: '2026-08-23T00:06:00.000Z',
        }),
      ).resolves.toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ id: proven.id, state: 'enforced' }),
        ]),
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('downgrades a corrected constraint when its verification command is removed', async () => {
    const root = await temporaryRoot('comet-project-knowledge-corrected-command-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-corrected-command-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } }),
      );
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const constraint = record({
        id: 'manual-corrected-constraint',
        type: 'constraint',
        state: 'enforced',
        authority: 'user',
        conclusions: [],
        verification: [{ command: 'pnpm run test', expected: 'pass' }],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: constraint });

      await expect(
        store.apply({
          kind: 'correct',
          id: constraint.id,
          projectId: constraint.projectId,
          verification: [],
          updatedAt: '2026-08-23T00:02:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({ state: 'proven', verification: [] }),
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('enforces a proven constraint only after its declared current command succeeds', async () => {
    const root = await temporaryRoot('comet-project-knowledge-verified-constraint-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-verified-constraint-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }),
      );
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const constraint = record({
        id: 'proven-test-constraint',
        type: 'constraint',
        state: 'proven',
        conclusions: [],
        verification: [{ command: 'pnpm test', expected: 'pass' }],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: constraint });

      await expect(
        store.apply({
          kind: 'verify',
          projectId: constraint.projectId,
          commands: ['unknown command'],
          updatedAt: '2026-08-23T00:03:00.000Z',
        }),
      ).resolves.toMatchObject({ changed: false });
      await expect(
        store.apply({
          kind: 'verify',
          projectId: constraint.projectId,
          commands: ['pnpm test'],
          updatedAt: '2026-08-23T00:04:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        records: expect.arrayContaining([
          expect.objectContaining({ id: constraint.id, state: 'enforced' }),
        ]),
      });

      const lintConstraint = record({
        id: 'proven-lint-constraint',
        type: 'constraint',
        state: 'proven',
        conclusions: [],
        verification: [{ command: 'pnpm lint', expected: 'pass' }],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: lintConstraint });
      await expect(
        store.apply({
          kind: 'verify',
          projectId: lintConstraint.projectId,
          commands: ['pnpm lint'],
          updatedAt: '2026-08-23T00:05:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        records: expect.arrayContaining([
          expect.objectContaining({ id: lintConstraint.id, state: 'enforced' }),
        ]),
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('supersedes automatic knowledge after it contributes to a failed outcome', async () => {
    const root = await temporaryRoot('comet-project-knowledge-feedback-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-feedback-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const automatic = record({ state: 'trial' });
      await store.apply({ kind: 'upsert', record: automatic });

      await expect(
        store.apply({
          kind: 'feedback',
          id: automatic.id,
          projectId: automatic.projectId,
          outcome: 'contributed-to-failure',
          updatedAt: '2026-08-23T00:01:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          state: 'superseded',
          applicationCount: 1,
          successCount: 0,
          failureCount: 1,
        }),
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('keeps user knowledge authoritative while recording failed outcomes', async () => {
    const root = await temporaryRoot('comet-project-knowledge-user-feedback-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-user-feedback-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const manual = record({ id: 'manual-rule', authority: 'user' });
      await store.apply({ kind: 'upsert', record: manual });

      await expect(
        store.apply({
          kind: 'feedback',
          id: manual.id,
          projectId: manual.projectId,
          outcome: 'contributed-to-failure',
          updatedAt: '2026-08-23T00:01:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          authority: 'user',
          state: 'proven',
          applicationCount: 1,
          successCount: 0,
          failureCount: 1,
        }),
      });
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('applies one outcome revision atomically and replaces its previous counters', async () => {
    const root = await temporaryRoot('comet-project-knowledge-feedback-revision-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-feedback-revision-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const automatic = record({ id: 'revision-rule', state: 'trial' });
      await store.apply({ kind: 'upsert', record: automatic });

      const first = {
        kind: 'feedback' as const,
        id: automatic.id,
        projectId: automatic.projectId,
        outcome: 'used-successfully' as const,
        applicationId: 'application-revision',
        revision: 1,
        idempotencyKey: 'feedback-revision-1',
        updatedAt: '2026-08-23T00:01:00.000Z',
      };
      await expect(store.apply(first)).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({ applicationCount: 1, successCount: 1, failureCount: 0 }),
      });
      await expect(store.apply(first)).resolves.toMatchObject({ changed: false });
      await expect(
        store.apply({
          ...first,
          outcome: 'corrected',
          previousOutcome: 'used-successfully',
          revision: 2,
          idempotencyKey: 'feedback-revision-2',
          updatedAt: '2026-08-23T00:02:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          state: 'superseded',
          applicationCount: 1,
          successCount: 0,
          failureCount: 1,
        }),
      });
      await expect(
        store.apply({
          ...first,
          outcome: 'used-successfully',
          previousOutcome: 'corrected',
          revision: 3,
          idempotencyKey: 'feedback-revision-3',
          updatedAt: '2026-08-23T00:03:00.000Z',
        }),
      ).resolves.toMatchObject({
        changed: true,
        record: expect.objectContaining({
          state: 'proven',
          applicationCount: 1,
          successCount: 1,
          failureCount: 0,
        }),
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
        type: 'dependency',
        title: 'Related module',
        summary: 'Supporting context without the direct term.',
        applicablePaths: [],
        operations: ['verify'],
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
        type: 'pattern',
        title: 'Runtime knowledge',
        summary: 'Runtime knowledge for Project Knowledge work.',
        applicablePaths: ['domains/project-knowledge/'],
        operations: ['verify'],
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
        type: 'topology',
        title: 'Runtime knowledge elsewhere',
        summary: 'Runtime knowledge outside the requested path.',
        applicablePaths: [],
        operations: ['verify'],
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

  test('applies path, operation, and phase selectors before ranking or top-N', async () => {
    const root = await temporaryRoot('comet-project-knowledge-selectors-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-selectors-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const selected = record({
        id: 'record-strict-selector',
        title: 'Selector target',
        summary: 'Selector target for build verification.',
        applicablePaths: ['src/**/*.ts'],
        operations: ['build'],
        phases: ['verify'],
        conclusions: [],
        sourceVersions: [],
      });
      const unscoped = record({
        id: 'record-unscoped-selector',
        title: 'Selector target fallback',
        summary: 'Selector target without applicability constraints.',
        applicablePaths: [],
        operations: [],
        phases: [],
        conclusions: [],
        sourceVersions: [],
      });
      await store.apply({ kind: 'upsert', record: selected });
      await store.apply({ kind: 'upsert', record: unscoped });
      const query = {
        task: 'selector target',
        terms: ['selector', 'target'],
        strongTerms: ['selector'],
        phraseTerms: ['selector target'],
        weakTerms: [],
        remoteQuery: 'selector target',
      };

      expect(
        store
          .searchRecords({
            ...query,
            path: 'src/features/dashboard.ts',
            operation: 'build',
            phase: 'verify',
          })
          .map((entry) => entry.record?.id),
      ).toContain(selected.id);
      for (const mismatch of [
        { path: 'test/dashboard.test.ts', operation: 'build', phase: 'verify' },
        { path: 'src/features/dashboard.ts', operation: 'publish', phase: 'verify' },
        { path: 'src/features/dashboard.ts', operation: 'build', phase: 'archive' },
      ]) {
        expect(
          store.searchRecords({ ...query, ...mismatch }).map((entry) => entry.record?.id),
        ).not.toContain(selected.id);
      }
    } finally {
      store?.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  test('ranks lifecycle authority and application feedback before lexical and path bonuses', async () => {
    const root = await temporaryRoot('comet-project-knowledge-ranking-');
    const storageRoot = await temporaryRoot('comet-project-knowledge-ranking-storage-');
    let store: ProjectKnowledgeLocalStore | undefined;
    try {
      store = new ProjectKnowledgeLocalStore({ projectRoot: root, storageRoot });
      const trial = record({
        id: 'record-trial-path-match',
        state: 'trial',
        authority: 'automatic',
        title: 'Build build build rule',
        summary: 'Build rule for the exact requested path.',
        applicablePaths: ['src/**'],
        operations: ['build'],
        conclusions: [],
        sourceVersions: [],
        updatedAt: '2026-08-24T00:00:00.000Z',
      });
      const enforced = record({
        id: 'record-enforced-contract',
        state: 'enforced',
        authority: 'repository',
        title: 'Build contract',
        summary: 'Build contract validated repeatedly.',
        applicablePaths: [],
        operations: [],
        conclusions: [],
        sourceVersions: [],
        applicationCount: 4,
        successCount: 4,
        verification: [{ command: 'pnpm build', expected: 'pass' }],
        updatedAt: '2026-08-20T00:00:00.000Z',
      });
      await store.apply({ kind: 'upsert', record: trial });
      await store.apply({ kind: 'upsert', record: enforced });

      const results = store.searchRecords({
        task: 'build',
        path: 'src/app.ts',
        operation: 'build',
        terms: ['build'],
        strongTerms: ['build'],
        phraseTerms: [],
        weakTerms: [],
        remoteQuery: 'build',
      });

      expect(results[0]?.record?.id).toBe(enforced.id);
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
        type: 'dependency',
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
