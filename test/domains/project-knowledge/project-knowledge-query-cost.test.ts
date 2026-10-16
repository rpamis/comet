import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

import { LocalProjectKnowledgeProvider } from '../../../domains/project-knowledge/local-provider.js';
import { ProjectKnowledgeLocalStore } from '../../../domains/project-knowledge/local-store.js';
import { createProjectKnowledgeQuery } from '../../../domains/project-knowledge/query.js';
import * as protectedFiles from '../../../domains/workflow-contract/protected-project-path.js';
import { ensureProjectKnowledgeReady } from '../../../domains/project-knowledge/readiness.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';

test('reads archives only for history or when current documents cannot answer the query', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-current-first-'));
  const corpus = Array.from({ length: 21 }, (_, index) => ({
    source: `${index}.md`,
    absolutePath: path.join(directory, `${index}.md`),
    kind: index === 0 ? ('native-spec' as const) : ('native-archive' as const),
  }));
  await Promise.all(
    corpus.map((document, index) =>
      fs.writeFile(
        document.absolutePath,
        `# Guide\n\nCurrentAnswerKey verification. ${index ? 'ArchiveOnlyNeedle old evidence.' : ''}\n`,
      ),
    ),
  );
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    corpus,
    cacheRoot: path.join(directory, 'cache'),
  });
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  try {
    const current = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CurrentAnswerKey' }),
    });
    expect(current.kind === 'search' && current.results.map((result) => result.source)).toEqual([
      '0.md',
    ]);
    expect(read.mock.calls.filter(([, source]) => source !== '0.md')).toHaveLength(0);
    await fs.unlink(path.join(directory, '0.md'));
    const replacement = {
      source: 'replacement.md',
      absolutePath: path.join(directory, 'replacement.md'),
      kind: 'native-spec' as const,
    };
    await fs.writeFile(replacement.absolutePath, '# Unrelated\n\nOther behavior.\n');
    corpus.splice(0, 1, replacement);
    const removed = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CurrentAnswerKey' }),
    });
    expect(removed.kind === 'search' && removed.results.length).toBeGreaterThan(0);
    expect(
      removed.kind === 'search' && removed.results.some((result) => result.source === '0.md'),
    ).toBe(false);
    read.mockClear();
    const history = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CurrentAnswerKey history' }),
    });
    expect(
      history.kind === 'search' && history.results.some((result) => result.source !== '0.md'),
    ).toBe(true);
    expect(read.mock.calls.some(([, source]) => source !== '0.md')).toBe(true);
    read.mockClear();
    const fallback = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'ArchiveOnlyNeedle' }),
    });
    expect(fallback.kind === 'search' && fallback.results.length).toBeGreaterThan(0);
    expect(read.mock.calls.some(([, source]) => source !== '0.md')).toBe(true);
  } finally {
    read.mockRestore();
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('reads each fallback search source once regardless of its match count', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-rg-reads-'));
  const file = path.join(directory, 'note.md');
  await fs.writeFile(file, `# Guide\n\n${'FallbackNeedle evidence.\n'.repeat(100)}`);
  const stdout = Array.from({ length: 100 }, (_, index) =>
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'note.md' },
        line_number: index + 3,
        lines: { text: 'FallbackNeedle evidence.\n' },
      },
    }),
  ).join('\n');
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    corpus: [{ source: 'note.md', absolutePath: file, kind: 'native-spec' }],
    cacheRoot: path.join(directory, 'cache'),
    indexEnabled: false,
    runRipgrep: async () => ({
      stdout,
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      matchLimitReached: false,
    }),
  });
  const read = vi.spyOn(protectedFiles, 'readProtectedProjectFile');
  try {
    const result = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'FallbackNeedle' }),
    });
    expect(result.kind === 'search' && result.results[0]?.content).toContain('FallbackNeedle');
    expect(read.mock.calls.filter(([, source]) => source === 'note.md').length).toBeLessThanOrEqual(
      2,
    );
  } finally {
    read.mockRestore();
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('does not treat stale ripgrep text as current source evidence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-rg-stale-'));
  const file = path.join(directory, 'note.md');
  await fs.writeFile(file, '# Guide\n\nUnrelated replacement content.\n');
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    corpus: [{ source: 'note.md', absolutePath: file, kind: 'native-spec' }],
    cacheRoot: path.join(directory, 'cache'),
    indexEnabled: false,
    runRipgrep: async () => ({
      stdout: JSON.stringify({
        type: 'match',
        data: { path: { text: 'note.md' }, line_number: 3, lines: { text: 'alpha beta\n' } },
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      matchLimitReached: false,
    }),
  });
  try {
    const result = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'alpha beta' }),
    });
    expect(result.kind === 'search' && result.results).toEqual([]);
  } finally {
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('bounds repeated ancestor checks without reusing source content across queries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-query-reads-'));
  const root = path.join(directory, 'project');
  await fs.mkdir(root);
  const corpus = Array.from({ length: 20 }, (_, index) => ({
    source: `note-${index}.md`,
    absolutePath: path.join(root, `note-${index}.md`),
    kind: 'native-spec' as const,
  }));
  await Promise.all(
    corpus.map((document) =>
      fs.writeFile(document.absolutePath, '# Guide\n\nCorpusNeedle OldVersion000\n'),
    ),
  );
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: root,
    corpus,
    cacheRoot: path.join(directory, 'cache'),
    runRipgrep: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
      truncated: false,
      matchLimitReached: false,
    }),
  });
  const inspect = vi.spyOn(fs, 'lstat');
  try {
    await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CorpusNeedle' }),
      limit: 2,
    });
    const rootChecks = inspect.mock.calls.filter(
      ([target]) => typeof target === 'string' && path.resolve(target) === root,
    ).length;
    expect(rootChecks).toBeLessThanOrEqual(12);
    await runWithHookReadCache(async () => {
      await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'OldVersion000' }),
      });
      const file = corpus[0].absolutePath;
      const before = await fs.stat(file);
      await fs.writeFile(file, '# Guide\n\nCorpusNeedle NewVersion000\n');
      await fs.utimes(file, before.atime, before.mtime);
      const result = await provider.query({
        kind: 'search',
        query: createProjectKnowledgeQuery({ task: 'NewVersion000' }),
      });
      expect(
        result.kind === 'search' &&
          result.results.some((entry) => entry.content.includes('NewVersion000')),
      ).toBe(true);
    });
  } finally {
    inspect.mockRestore();
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('reacquires source content after retrieval when a same-metadata edit happens during the query', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-query-freshness-'));
  const file = path.join(directory, 'note.md');
  await fs.writeFile(file, '# Guide\n\nCorpusNeedle OlderProof\n');
  const before = await fs.stat(file);
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    corpus: [{ source: 'note.md', absolutePath: file, kind: 'native-spec' }],
    cacheRoot: path.join(directory, 'cache'),
    runRipgrep: async () => {
      await fs.writeFile(file, '# Guide\n\nCorpusNeedle NewerProof\n');
      await fs.utimes(file, before.atime, before.mtime);
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
      };
    },
  });
  try {
    const result = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CorpusNeedle' }),
    });
    expect(result.kind === 'search' && result.results[0]?.content).toContain('NewerProof');
    expect(result.kind === 'search' && result.results[0]?.content).not.toContain('OlderProof');
  } finally {
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects an ancestor replaced by an in-project link after the index snapshot', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-query-link-'));
  const folder = path.join(directory, 'docs');
  const saved = path.join(directory, 'saved');
  await fs.mkdir(folder);
  const file = path.join(folder, 'note.md');
  await fs.writeFile(file, '# Guide\n\nCorpusNeedle protected evidence.\n');
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    corpus: [{ source: 'docs/note.md', absolutePath: file, kind: 'native-spec' }],
    cacheRoot: path.join(directory, 'cache'),
    runRipgrep: async () => {
      await fs.rename(folder, saved);
      await fs.symlink(saved, folder, process.platform === 'win32' ? 'junction' : 'dir');
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        timedOut: false,
        truncated: false,
        matchLimitReached: false,
      };
    },
  });
  try {
    const result = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'CorpusNeedle' }),
    });
    expect(result.kind === 'search' && result.results).toEqual([]);
    expect(result.kind === 'search' && result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'local-document' }),
    );
  } finally {
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('bounds source inspection to relevant records and still detects a same-metadata edit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-query-cost-'));
  const root = path.join(directory, 'project');
  await fs.mkdir(root);
  const store = new ProjectKnowledgeLocalStore({
    projectRoot: root,
    cacheRoot: path.join(directory, 'cache'),
  });
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: root,
    corpus: [],
    localStore: store,
  });
  const inspect = vi.spyOn(protectedFiles, 'hashProtectedProjectFile');
  try {
    for (let index = 0; index < 100; index += 1) {
      const source = `source-${index}.md`;
      await fs.writeFile(path.join(root, source), `# Source ${index}\n\nVersion one\n`);
      await provider.apply({
        kind: 'upsert',
        record: {
          id: `record-${index}`,
          projectId: 'query-project',
          type: 'fact',
          state: 'proven',
          authority: 'user',
          title: index === 0 ? 'TargetNeedle' : `Unrelated${index}`,
          summary: index === 0 ? 'TargetNeedle behavior' : `Unrelated${index} behavior`,
          applicablePaths: [],
          operations: [],
          conclusions: [{ text: 'Supported behavior', sources: [{ source }] }],
          relations: [],
          verification: [],
          sourceVersions: [],
          applicationCount: 0,
          successCount: 0,
          failureCount: 0,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });
    }
    inspect.mockClear();
    await ensureProjectKnowledgeReady({ projectRoot: root, provider, refreshSources: false });
    const request = {
      kind: 'search' as const,
      query: createProjectKnowledgeQuery({ task: 'TargetNeedle' }),
    };
    const first = await provider.query(request);
    expect(first.kind === 'search' && first.records.map((entry) => entry.id)).toEqual(['record-0']);
    expect(inspect.mock.calls.length).toBeLessThanOrEqual(2);
    const source = path.join(root, 'source-0.md');
    const before = await fs.stat(source);
    await fs.writeFile(source, '# Source 0\n\nVersion two\n');
    await fs.utimes(source, before.atime, before.mtime);
    const changed = await provider.query(request);
    expect(changed.kind === 'search' && changed.records).toEqual([]);
  } finally {
    inspect.mockRestore();
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
