import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, test, vi } from 'vitest';

import {
  createProjectKnowledgeQuery,
  LocalProjectKnowledgeProvider,
  parseProjectKnowledgeSections,
  ProjectKnowledgeIndexStore,
  PROJECT_KNOWLEDGE_QUERY_BUDGETS,
} from '../../../domains/project-knowledge/index.js';

async function temporaryRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-knowledge-index-'));
}

describe('project knowledge query planning', () => {
  test('keeps mixed-language identifiers and complete Chinese words in task queries', () => {
    const worktree = createProjectKnowledgeQuery({
      task: '排查两个 worktree 的项目知识索引与源码状态互相覆盖',
    });
    expect(worktree.terms).toEqual(
      expect.arrayContaining(['worktree', '项目', '知识', '索引', '源码', '状态']),
    );
    const feedback = createProjectKnowledgeQuery({
      task: '给上下文反馈新增 sourceNote，保证重启重放和重复计数正确',
    });
    expect(feedback.terms).toEqual(
      expect.arrayContaining(['sourceNote', '反馈', '重启', '重放', '重复', '计数']),
    );
    expect(worktree.weakTerms.length).toBeLessThanOrEqual(PROJECT_KNOWLEDGE_QUERY_BUDGETS.weak);
    expect(feedback.weakTerms.length).toBeLessThanOrEqual(PROJECT_KNOWLEDGE_QUERY_BUDGETS.weak);
    const bilingual = createProjectKnowledgeQuery({
      task: 'update command output response behavior context storage service module entry 索引知识查询',
    });
    expect(bilingual.weakTerms).toEqual(expect.arrayContaining(['update', '索引', '知识', '查询']));
  });

  test('reserves strong, phrase, and weak budgets independently', () => {
    const query = createProjectKnowledgeQuery({
      task: [
        '请定位 CometHookGuard PKG_123 ERR42 domains/project-knowledge/index-store.ts',
        '分析项目知识混合召回增量更新工作区隔离的完整中文技术术语',
        'with ordinary project knowledge retrieval context behavior implementation details',
      ].join(' '),
    });

    expect(query.strongTerms).toContain('CometHookGuard');
    expect(query.strongTerms).toContain('domains/project-knowledge/index-store.ts');
    expect(query.phraseTerms).toContain('分析项目知识混合召回增量更新工作区隔离的完整中文技术术语');
    expect(query.strongTerms.length).toBeLessThanOrEqual(PROJECT_KNOWLEDGE_QUERY_BUDGETS.strong);
    expect(query.phraseTerms.length).toBeLessThanOrEqual(PROJECT_KNOWLEDGE_QUERY_BUDGETS.phrase);
    expect(query.weakTerms.length).toBeLessThanOrEqual(PROJECT_KNOWLEDGE_QUERY_BUDGETS.weak);
    expect(query.terms.slice(0, query.strongTerms.length)).toEqual(query.strongTerms);
  });
});

describe('project knowledge section index', () => {
  test('parses heading paths and keeps an unchanged section row during a source delta', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/retrieval.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Retrieval\n\nStable section.\n\n## Update\n\nOld details.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      const parsed = parseProjectKnowledgeSections(
        source,
        '# Retrieval\n\nStable section.\n\n## Update\n\nOld details.\n',
      );
      expect(parsed.map((section) => section.headingPath)).toEqual([
        'Retrieval',
        'Retrieval > Update',
      ]);

      const first = await store.syncCorpus([document]);
      expect(first.status).toMatchObject({
        sourceCount: 1,
        sectionCount: 2,
        available: true,
        sources: [{ source, kind: 'native-spec' }],
      });
      store.close();
      const before = new DatabaseSync(store.databasePath, { readOnly: true });
      const stable = before
        .prepare("SELECT id, updated_at FROM pk_sections WHERE anchor = 'retrieval'")
        .get() as { id: number; updated_at: string };
      before.close();

      await new Promise((resolve) => setTimeout(resolve, 20));
      await fs.writeFile(file, '# Retrieval\n\nStable section.\n\n## Update\n\nNew details.\n');
      const second = await store.syncCorpus([document]);
      expect(second.changedSources).toEqual([]);
      store.close();
      const after = new DatabaseSync(store.databasePath, { readOnly: true });
      const stableAfter = after
        .prepare("SELECT id, updated_at FROM pk_sections WHERE anchor = 'retrieval'")
        .get() as { id: number; updated_at: string };
      const updated = after
        .prepare("SELECT body FROM pk_sections WHERE anchor = 'retrieval/update'")
        .get() as { body: string };
      after.close();
      expect(stableAfter).toEqual(stable);
      expect(updated.body).toContain('New details');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('stores a content digest and refreshes metadata without treating an mtime-only change as new content', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/digest.md';
    const file = path.join(root, ...source.split('/'));
    const content = '# Digest\n\nContent stays the same.\n';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await store.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]);
      const firstDigest = new DatabaseSync(store.databasePath, { readOnly: true });
      const firstRow = firstDigest
        .prepare('SELECT digest FROM pk_sources WHERE source = ?')
        .get(source) as { digest: string };
      firstDigest.close();

      await fs.utimes(file, new Date(), new Date(Date.now() + 2000));
      const refreshed = await store.syncCorpus([
        { absolutePath: file, source, kind: 'native-spec' },
      ]);
      const secondDigest = new DatabaseSync(store.databasePath, { readOnly: true });
      const secondRow = secondDigest
        .prepare('SELECT digest FROM pk_sources WHERE source = ?')
        .get(source) as { digest: string };
      secondDigest.close();

      expect(firstRow.digest).toBe(createHash('sha256').update(content).digest('hex'));
      expect(secondRow.digest).toBe(firstRow.digest);
      expect(refreshed.changedSources).toEqual([]);
      expect(refreshed.refreshedSources).toEqual([
        { absolutePath: file, source, kind: 'native-spec' },
      ]);

      const stableStat = await fs.stat(file);
      const changedContent = content.replace('stays', 'holds');
      expect(Buffer.byteLength(changedContent)).toBe(Buffer.byteLength(content));
      await fs.writeFile(file, changedContent);
      await fs.utimes(file, stableStat.atime, stableStat.mtime);
      const changed = await store.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]);
      const changedDigest = new DatabaseSync(store.databasePath, { readOnly: true });
      const changedRow = changedDigest
        .prepare('SELECT digest FROM pk_sources WHERE source = ?')
        .get(source) as { digest: string };
      changedDigest.close();

      expect(changedRow.digest).not.toBe(secondRow.digest);
      expect(changed.changedSources).toEqual([]);
      expect(changed.refreshedSources).toEqual([
        { absolutePath: file, source, kind: 'native-spec' },
      ]);
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('retrieves Chinese sections through terms and trigram channels', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/knowledge.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# 项目知识混合召回\n\n按来源差异更新，并隔离不同工作区。\n');
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await store.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]);
      const results = store.search(createProjectKnowledgeQuery({ task: '工作区项目知识混合召回' }));
      expect(results[0]).toMatchObject({ source, title: '项目知识混合召回' });
      expect(store.status().channels).toEqual(['fts-terms', 'fts-trigram']);
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('repairs orphan FTS rowids before indexing a new source', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const firstSource = 'docs/comet/specs/first.md';
    const secondSource = 'docs/comet/specs/second.md';
    const firstFile = path.join(root, ...firstSource.split('/'));
    const secondFile = path.join(root, ...secondSource.split('/'));
    await fs.mkdir(path.dirname(firstFile), { recursive: true });
    await fs.writeFile(firstFile, '# First\n\nStable indexed source.\n');
    await fs.writeFile(secondFile, '# Second\n\nNew source after projection damage.\n');
    const documents = [
      { absolutePath: firstFile, source: firstSource, kind: 'native-spec' as const },
      { absolutePath: secondFile, source: secondSource, kind: 'native-spec' as const },
    ];
    const initial = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    let repaired: ProjectKnowledgeIndexStore | undefined;
    try {
      await initial.syncCorpus([documents[0]]);
      initial.close();

      const damaged = new DatabaseSync(initial.databasePath);
      damaged
        .prepare(
          'INSERT INTO pk_fts_terms(rowid, workspace_id, source, title, heading_path, body, lexical_terms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(2, initial.workspaceId, 'orphan.md', 'Orphan', 'Orphan', 'orphan', 'orphan');
      damaged
        .prepare(
          'INSERT INTO pk_fts_trigram(rowid, workspace_id, source, title, heading_path, body) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(2, initial.workspaceId, 'orphan.md', 'Orphan', 'Orphan', 'orphan');
      damaged.close();

      repaired = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
      const result = await repaired.syncCorpus(documents);

      expect(result.status).toMatchObject({ sourceCount: 2, sectionCount: 2 });
      repaired.close();
      const verified = new DatabaseSync(initial.databasePath, { readOnly: true });
      const orphanTerms = verified
        .prepare(
          'SELECT COUNT(*) AS count FROM pk_fts_terms WHERE rowid NOT IN (SELECT id FROM pk_sections)',
        )
        .get() as { count: number };
      const orphanTrigrams = verified
        .prepare(
          'SELECT COUNT(*) AS count FROM pk_fts_trigram WHERE rowid NOT IN (SELECT id FROM pk_sections)',
        )
        .get() as { count: number };
      verified.close();
      expect(orphanTerms.count).toBe(0);
      expect(orphanTrigrams.count).toBe(0);
    } finally {
      repaired?.close();
      initial.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('restores missing FTS rows when reopening an unchanged index', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/missing-fts.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Missing FTS\n\nRecoverable indexed content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const first = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    let reopened: ProjectKnowledgeIndexStore | undefined;
    try {
      await first.syncCorpus([document]);
      first.close();
      const damaged = new DatabaseSync(first.databasePath);
      damaged.prepare('DELETE FROM pk_fts_terms WHERE rowid = 1').run();
      damaged.prepare('DELETE FROM pk_fts_trigram WHERE rowid = 1').run();
      damaged.close();

      reopened = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
      await reopened.syncCorpus([document]);
      const query = createProjectKnowledgeQuery({ task: 'Recoverable indexed content' });

      expect(reopened.search(query)[0]).toMatchObject({ source, title: 'Missing FTS' });
    } finally {
      reopened?.close();
      first.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('replaces a colliding orphan FTS row without deleting the indexed source', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/collision.md';
    const file = path.join(root, ...source.split('/'));
    const diagnostics: string[] = [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Collision\n\nStable section.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({
      projectRoot: root,
      cacheRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    try {
      await store.syncCorpus([document]);
      const damaged = new DatabaseSync(store.databasePath);
      damaged
        .prepare(
          'INSERT INTO pk_fts_terms(rowid, workspace_id, source, title, heading_path, body, lexical_terms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(2, store.workspaceId, 'orphan.md', 'Orphan', 'Orphan', 'orphan', 'orphan');
      damaged
        .prepare(
          'INSERT INTO pk_fts_trigram(rowid, workspace_id, source, title, heading_path, body) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(2, store.workspaceId, 'orphan.md', 'Orphan', 'Orphan', 'orphan');
      damaged.close();
      await fs.writeFile(file, '# Collision\n\nStable section.\n\n## Added\n\nNew section.\n');

      const result = await store.syncCorpus([document]);

      expect(result.status).toMatchObject({ sourceCount: 1, sectionCount: 2 });
      expect(diagnostics).not.toContain('index-source');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps the previous projection when an index write fails', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/write-failure.md';
    const file = path.join(root, ...source.split('/'));
    const diagnostics: string[] = [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Write failure\n\nPrevious indexed content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({
      projectRoot: root,
      cacheRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    try {
      await store.syncCorpus([document]);
      const damaged = new DatabaseSync(store.databasePath);
      damaged.exec(
        'DROP TABLE pk_fts_terms; CREATE TABLE pk_fts_terms (rowid INTEGER PRIMARY KEY);',
      );
      damaged.close();
      await fs.writeFile(file, '# Write failure\n\nUpdated content cannot be projected.\n');

      const result = await store.syncCorpus([document]);

      expect(result.status).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(diagnostics).toContain('index-write');
      expect(diagnostics).not.toContain('index-source');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps the previous projection when the incremental budget expires during a read', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/budget.md';
    const file = path.join(root, ...source.split('/'));
    const diagnostics: string[] = [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Budget\n\nPrevious indexed content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({
      projectRoot: root,
      cacheRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    let now: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await store.syncCorpus([document]);
      await fs.writeFile(file, '# Budget\n\nUpdated content.\n');
      const ticks = [0, 0, 3_000];
      now = vi.spyOn(Date, 'now').mockImplementation(() => ticks.shift() ?? 3_000);

      const result = await store.syncCorpus([document]);

      expect(result.status).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(diagnostics).toContain('index-budget');
      expect(diagnostics).not.toContain('index-source');
    } finally {
      now?.mockRestore();
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps the previous projection when a discovered source becomes unreadable', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/read-failure.md';
    const file = path.join(root, ...source.split('/'));
    const diagnostics: string[] = [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Read failure\n\nPrevious indexed content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({
      projectRoot: root,
      cacheRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    try {
      await store.syncCorpus([document]);
      await fs.rm(file);
      await fs.mkdir(file);

      const result = await store.syncCorpus([document]);

      expect(result.status).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(diagnostics).toContain('index-source');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps the previous projection when a discovered source disappears before indexing', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/disappeared.md';
    const file = path.join(root, ...source.split('/'));
    const diagnostics: string[] = [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Disappeared\n\nPrevious indexed content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({
      projectRoot: root,
      cacheRoot,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    try {
      await store.syncCorpus([document]);
      await fs.rm(file);

      const result = await store.syncCorpus([document]);

      expect(result.status).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(diagnostics).toContain('index-source');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('does not delete indexed sources when corpus discovery is incomplete', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const sources = ['docs/comet/specs/first.md', 'docs/comet/specs/second.md'];
    const documents = sources.map((source) => ({
      absolutePath: path.join(root, ...source.split('/')),
      source,
      kind: 'native-spec' as const,
    }));
    await fs.mkdir(path.dirname(documents[0].absolutePath), { recursive: true });
    await Promise.all(
      documents.map((document, index) =>
        fs.writeFile(document.absolutePath, `# Source ${index + 1}\n\nIndexed content.\n`),
      ),
    );
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await store.syncCorpus(documents);

      const result = await store.syncCorpus([documents[0]], { complete: false });

      expect(result.status).toMatchObject({ sourceCount: 2, sectionCount: 2 });
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('provider refresh preserves sources omitted by incomplete discovery', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const sources = ['docs/comet/specs/first.md', 'docs/comet/specs/second.md'];
    const documents = sources.map((source) => ({
      absolutePath: path.join(root, ...source.split('/')),
      source,
      kind: 'native-spec' as const,
    }));
    await fs.mkdir(path.dirname(documents[0].absolutePath), { recursive: true });
    await Promise.all(
      documents.map((document, index) =>
        fs.writeFile(document.absolutePath, `# Source ${index + 1}\n\nIndexed content.\n`),
      ),
    );
    const complete = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot,
      corpus: documents,
    });
    let incomplete: LocalProjectKnowledgeProvider | undefined;
    try {
      await complete.refreshIndex();
      complete.close();
      incomplete = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        cacheRoot,
        corpus: [documents[0]],
        corpusComplete: false,
      });

      await incomplete.apply({ kind: 'refresh', projectId: 'incomplete-corpus' });

      await expect(incomplete.indexStatus()).resolves.toMatchObject({ sourceCount: 2 });
    } finally {
      incomplete?.close();
      complete.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps the current index visible while a rebuild starts', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const sources = ['docs/comet/specs/first.md', 'docs/comet/specs/second.md'];
    const documents = sources.map((source) => ({
      absolutePath: path.join(root, ...source.split('/')),
      source,
      kind: 'native-spec' as const,
    }));
    await fs.mkdir(path.dirname(documents[0].absolutePath), { recursive: true });
    await Promise.all(
      documents.map((document, index) =>
        fs.writeFile(document.absolutePath, `# Source ${index + 1}\n\nIndexed content.\n`),
      ),
    );
    const replacement = {
      absolutePath: path.join(root, 'docs/comet/specs/replacement.md'),
      source: 'docs/comet/specs/replacement.md',
      kind: 'native-spec' as const,
    };
    await fs.writeFile(replacement.absolutePath, '# Replacement\n\nNew indexed content.\n');
    const writer = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    const reader = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await writer.syncCorpus(documents);
      await reader.open();

      const rebuilding = writer.rebuild([replacement]);
      await Promise.resolve();
      const visibleSourceCount = reader.status().sourceCount;
      const rebuilt = await rebuilding;

      expect(visibleSourceCount).toBe(2);
      expect(rebuilt.sourceCount).toBe(1);
    } finally {
      reader.close();
      writer.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('rebuild processes the complete corpus without the incremental time budget', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const sources = [
      'docs/comet/specs/first.md',
      'docs/comet/specs/second.md',
      'docs/comet/specs/third.md',
    ];
    const documents = sources.map((source) => ({
      absolutePath: path.join(root, ...source.split('/')),
      source,
      kind: 'native-spec' as const,
    }));
    await fs.mkdir(path.dirname(documents[0].absolutePath), { recursive: true });
    await Promise.all(
      documents.map((document, index) =>
        fs.writeFile(document.absolutePath, `# Source ${index + 1}\n\nIndexed content.\n`),
      ),
    );
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    let clock = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    try {
      const result = await store.rebuild(documents);

      expect(result).toMatchObject({ sourceCount: 3, sectionCount: 3 });
    } finally {
      now.mockRestore();
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('rebuild replaces stale FTS content even when the source digest is unchanged', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/rebuild.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Rebuild\n\nAuthoritative source content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const store = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await store.syncCorpus([document]);
      const damaged = new DatabaseSync(store.databasePath);
      damaged.prepare("UPDATE pk_fts_terms SET body = 'stale projection' WHERE rowid = 1").run();
      damaged.prepare("UPDATE pk_fts_trigram SET body = 'stale projection' WHERE rowid = 1").run();
      damaged.close();

      await store.rebuild([document]);
      store.close();

      const verified = new DatabaseSync(store.databasePath, { readOnly: true });
      const term = verified.prepare('SELECT body FROM pk_fts_terms WHERE rowid = 1').get() as {
        body: string;
      };
      const trigram = verified.prepare('SELECT body FROM pk_fts_trigram WHERE rowid = 1').get() as {
        body: string;
      };
      verified.close();
      expect(term.body).toContain('Authoritative source content.');
      expect(trigram.body).toContain('Authoritative source content.');
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('automatic refresh preserves unchanged index rows', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/automatic-refresh.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Automatic refresh\n\nStable content.\n');
    const document = { absolutePath: file, source, kind: 'native-spec' as const };
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot,
      corpus: [document],
    });
    const location = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await provider.refreshIndex();
      const before = new DatabaseSync(location.databasePath, { readOnly: true });
      const initial = before
        .prepare('SELECT indexed_at FROM pk_sources WHERE source = ?')
        .get(source) as { indexed_at: string };
      before.close();
      await new Promise((resolve) => setTimeout(resolve, 20));

      await provider.apply({ kind: 'refresh', projectId: 'automatic-refresh-project' });

      const after = new DatabaseSync(location.databasePath, { readOnly: true });
      const refreshed = after
        .prepare('SELECT indexed_at FROM pk_sources WHERE source = ?')
        .get(source) as { indexed_at: string };
      after.close();
      expect(refreshed.indexed_at).toBe(initial.indexed_at);
    } finally {
      provider.close();
      location.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('keeps source and section counts scoped to the current workspace inside a shared repository database', async () => {
    const root = await temporaryRoot();
    const worktree = `${root}-worktree`;
    const cacheRoot = await temporaryRoot();
    try {
      execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root });
      await fs.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.writeFile(path.join(root, 'docs', 'knowledge.md'), '# Primary\n\nalpha source\n');
      await fs.writeFile(path.join(root, 'README.md'), '# test\n');
      execFileSync('git', ['add', 'README.md', 'docs/knowledge.md'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'test'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'index-other', worktree], {
        cwd: root,
        stdio: 'ignore',
      });
      await fs.writeFile(path.join(worktree, 'docs', 'knowledge.md'), '# Linked\n\nbeta source\n');

      const primaryDocument = {
        absolutePath: path.join(root, 'docs', 'knowledge.md'),
        source: 'docs/knowledge.md',
        kind: 'native-spec' as const,
      };
      const linkedDocument = {
        absolutePath: path.join(worktree, 'docs', 'knowledge.md'),
        source: 'docs/knowledge.md',
        kind: 'native-spec' as const,
      };
      const primaryStore = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
      const linkedStore = new ProjectKnowledgeIndexStore({ projectRoot: worktree, cacheRoot });

      await primaryStore.syncCorpus([primaryDocument]);
      await linkedStore.syncCorpus([linkedDocument]);

      expect(primaryStore.status()).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(linkedStore.status()).toMatchObject({ sourceCount: 1, sectionCount: 1 });
      expect(primaryStore.databasePath).toBe(linkedStore.databasePath);

      primaryStore.close();
      linkedStore.close();
    } finally {
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
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('falls back to bounded ripgrep when the index cannot open', async () => {
    const root = await temporaryRoot();
    const cacheFile = path.join(root, 'not-a-directory');
    const source = 'docs/comet/specs/fallback.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Fallback\n\nProject knowledge exact fallback.\n');
    await fs.writeFile(cacheFile, 'occupied');
    const diagnostics: string[] = [];
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot: cacheFile,
      corpus: [{ absolutePath: file, source, kind: 'native-spec' }],
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      runRipgrep: vi.fn(async () => ({
        stdout: JSON.stringify({
          type: 'match',
          data: {
            path: { text: source },
            line_number: 3,
            lines: { text: 'Project knowledge exact fallback.\n' },
          },
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
      })),
    });
    try {
      const response = await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'Project knowledge exact fallback' }),
      });
      const results = response.kind === 'search' ? response.results : [];
      expect(results[0]).toMatchObject({ source, title: 'Fallback' });
      expect(diagnostics).toContain('index-unavailable');
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('rebuilds a corrupt derived FTS projection without moving the shared database', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/recovery.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Recovery\n\nProject knowledge recovery.\n');
    const first = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    try {
      await first.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]);
      first.close();
      const broken = new DatabaseSync(first.databasePath);
      broken.exec('DROP TABLE pk_fts_terms; CREATE TABLE pk_fts_terms (broken TEXT);');
      broken.close();
      const diagnostics: string[] = [];
      const corrupt = new ProjectKnowledgeIndexStore({
        projectRoot: root,
        cacheRoot,
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      });
      await expect(
        corrupt.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]),
      ).rejects.toThrow();
      expect(diagnostics).toContain('index-recovered');
      expect(await fs.access(first.databasePath)).toBeUndefined();
      await expect(
        corrupt.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]),
      ).resolves.toMatchObject({ status: { available: true, sourceCount: 1 } });
      corrupt.close();
    } finally {
      first.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('serves current corpus content through rg in the same request as corruption recovery', async () => {
    const root = await temporaryRoot();
    const cacheRoot = await temporaryRoot();
    const source = 'docs/comet/specs/recovery-fallback.md';
    const file = path.join(root, ...source.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Recovery\n\nCurrent fallback evidence.\n');
    const first = new ProjectKnowledgeIndexStore({ projectRoot: root, cacheRoot });
    await first.syncCorpus([{ absolutePath: file, source, kind: 'native-spec' }]);
    first.close();
    const broken = new DatabaseSync(first.databasePath);
    broken.exec('DROP TABLE pk_fts_terms; CREATE TABLE pk_fts_terms (broken TEXT);');
    broken.close();
    const runRipgrep = vi.fn(async () => ({
      stdout: JSON.stringify({
        type: 'match',
        data: {
          path: { text: source },
          line_number: 3,
          lines: { text: 'Current fallback evidence.\n' },
        },
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      matchLimitReached: false,
    }));
    const provider = new LocalProjectKnowledgeProvider({
      projectRoot: root,
      cacheRoot,
      corpus: [{ absolutePath: file, source, kind: 'native-spec' }],
      runRipgrep,
    });
    try {
      const response = await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'Current fallback evidence' }),
      });
      const results = response.kind === 'search' ? response.results : [];
      expect(results[0]).toMatchObject({ source, title: 'Recovery' });
      expect(runRipgrep).toHaveBeenCalled();
    } finally {
      provider.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
