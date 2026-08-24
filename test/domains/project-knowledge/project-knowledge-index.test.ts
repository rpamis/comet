import { execFileSync } from 'node:child_process';
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
