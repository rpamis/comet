import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  PROJECT_MEMORY_EXPANSION_PREFIX,
  PROJECT_MEMORY_INDEX_FILE,
  isProjectMemoryType,
  readProjectMemory,
  readProjectMemoryEntries,
  readProjectMemoryIndex,
  removeProjectMemory,
  renderProjectMemoryIndexContext,
  resolveProjectMemoryDirectory,
  writeProjectMemory,
} from '../../../domains/project-knowledge/project-memory.js';
import { createProjectKnowledgeModule } from '../../../domains/project-knowledge/index.js';
import { MemoryPluginStorageStore } from '../../../domains/comet-plugin/plugin-runtime.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const fixedNow = (iso: string) => () => new Date(iso);

describe('project memory store', () => {
  test('creates a memory file and regenerates the MEMORY.md index', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const result = await writeProjectMemory(
        root,
        {
          title: 'Use vitest per-domain tests',
          text: '完整验证很慢。\n最小相关测试先跑，最终交付前再跑全量。',
          type: 'procedure',
          paths: ['test/domains/'],
          source: 'change demo-1',
        },
        { cacheRoot, now: fixedNow('2026-09-20T08:00:00.000Z') },
      );
      expect(result.action).toBe('created');
      expect(result.slug).toBe('use-vitest-per-domain-tests');
      const directory = resolveProjectMemoryDirectory(root, cacheRoot);
      expect(result.file).toBe(path.join(directory, 'use-vitest-per-domain-tests.md'));
      const raw = await fs.readFile(result.file, 'utf8');
      expect(raw).toContain('name: use-vitest-per-domain-tests');
      expect(raw).toContain('type: procedure');
      expect(raw).toContain('source: change demo-1');
      expect(raw).toContain('paths: ["test/domains/"]');
      const index = await fs.readFile(path.join(directory, PROJECT_MEMORY_INDEX_FILE), 'utf8');
      expect(index).toContain(
        '- [Use vitest per-domain tests](use-vitest-per-domain-tests.md) — 完整验证很慢。',
      );

      const entry = await readProjectMemory(root, result.slug, cacheRoot);
      expect(entry).toMatchObject({
        slug: result.slug,
        title: 'Use vitest per-domain tests',
        type: 'procedure',
        paths: ['test/domains/'],
        source: 'change demo-1',
      });
      expect(await readProjectMemoryIndex(root, cacheRoot)).toEqual([
        {
          slug: 'use-vitest-per-domain-tests',
          title: 'Use vitest per-domain tests',
          description: '完整验证很慢。',
        },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('updates the entry with the same title and keeps created', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const first = await writeProjectMemory(
        root,
        { title: 'Windows path check', text: '第一次结论。' },
        { cacheRoot, now: fixedNow('2026-09-20T08:00:00.000Z') },
      );
      const second = await writeProjectMemory(
        root,
        { title: 'Windows path check', text: '更新后的结论。' },
        { cacheRoot, now: fixedNow('2026-09-21T08:00:00.000Z') },
      );
      expect(second.action).toBe('updated');
      expect(second.slug).toBe(first.slug);
      expect(second.entry.created).toBe('2026-09-20T08:00:00.000Z');
      expect(second.entry.updated).toBe('2026-09-21T08:00:00.000Z');
      expect(second.total).toBe(1);
      const index = await readProjectMemoryIndex(root, cacheRoot);
      expect(index).toHaveLength(1);
      expect(index[0]?.description).toBe('更新后的结论。');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('suffices the derived slug when a different memory already owns it', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const first = await writeProjectMemory(
        root,
        { title: 'Deploy checklist', text: '先跑检查。' },
        { cacheRoot },
      );
      const second = await writeProjectMemory(
        root,
        { title: 'Deploy checklist!', text: '标题多了标点，派生出相同 slug。' },
        { cacheRoot },
      );
      expect(first.slug).toBe('deploy-checklist');
      expect(second.slug).toBe('deploy-checklist-2');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('falls back to a hash slug for titles without latin words', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const result = await writeProjectMemory(
        root,
        { title: '中文标题不含拉丁词', text: '结论正文。' },
        { cacheRoot },
      );
      expect(result.slug).toMatch(/^memo-[0-9a-f]{8}$/u);
      const again = await writeProjectMemory(
        root,
        { title: '中文标题不含拉丁词', text: '同一标题更新同一条。' },
        { cacheRoot },
      );
      expect(again.action).toBe('updated');
      expect(again.slug).toBe(result.slug);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('rejects invalid input before writing', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      await expect(
        writeProjectMemory(root, { title: '  ', text: '正文' }, { cacheRoot }),
      ).rejects.toThrow('标题不能为空');
      await expect(
        writeProjectMemory(root, { title: '标题', text: '' }, { cacheRoot }),
      ).rejects.toThrow('正文不能为空');
      await expect(
        writeProjectMemory(root, { title: '标题', text: 'x'.repeat(16 * 1024 + 1) }, { cacheRoot }),
      ).rejects.toThrow('不得超过');
      await expect(
        writeProjectMemory(
          root,
          { title: '标题', text: '正文', type: 'topology' as never },
          { cacheRoot },
        ),
      ).rejects.toThrow('类型');
      await expect(
        writeProjectMemory(root, { title: '标题', text: '正文', slug: 'Bad_Slug' }, { cacheRoot }),
      ).rejects.toThrow('slug');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('removes a memory and rewrites the index', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const keep = await writeProjectMemory(
        root,
        { title: 'Keep me', text: '保留。' },
        { cacheRoot },
      );
      const drop = await writeProjectMemory(
        root,
        { title: 'Drop me', text: '删除。', slug: 'drop-me' },
        { cacheRoot },
      );
      expect(await removeProjectMemory(root, 'drop-me', cacheRoot)).toBe(true);
      expect(await removeProjectMemory(root, 'drop-me', cacheRoot)).toBe(false);
      expect(await readProjectMemory(root, 'drop-me', cacheRoot)).toBeNull();
      const index = await readProjectMemoryIndex(root, cacheRoot);
      expect(index.map((entry) => entry.slug)).toEqual([keep.slug]);
      const directory = resolveProjectMemoryDirectory(root, cacheRoot);
      await expect(fs.access(path.join(directory, `${drop.slug}.md`))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('ignores unrelated or broken markdown when rebuilding the index', async () => {
    const root = await tempRoot('comet-project-memory-');
    const cacheRoot = await tempRoot('comet-project-memory-cache-');
    try {
      const created = await writeProjectMemory(
        root,
        { title: 'Real lesson', text: '真实经验。' },
        { cacheRoot },
      );
      const directory = resolveProjectMemoryDirectory(root, cacheRoot);
      await fs.writeFile(path.join(directory, 'notes.md'), '普通笔记，没有 frontmatter。');
      await fs.writeFile(
        path.join(directory, 'broken.md'),
        '---\nname: broken\ntitle: 缺字段\n---\n\n正文。',
      );
      const refreshed = await writeProjectMemory(
        root,
        { title: 'Second lesson', text: '第二条。' },
        { cacheRoot },
      );
      expect(refreshed.total).toBe(2);
      const index = await readProjectMemoryIndex(root, cacheRoot);
      expect(index.map((entry) => entry.slug).sort()).toEqual(
        [created.slug, refreshed.slug].sort(),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('takes over a stale writer lock and returns entries ordered by update time', async () => {
    const root = await tempRoot('comet-project-memory-lock-');
    const cacheRoot = await tempRoot('comet-project-memory-lock-cache-');
    try {
      const directory = resolveProjectMemoryDirectory(root, cacheRoot);
      await fs.mkdir(directory, { recursive: true });
      const lock = path.join(directory, '.lock');
      await fs.writeFile(lock, 'crashed writer');
      const stale = new Date(Date.now() - 20_000);
      await fs.utimes(lock, stale, stale);

      await writeProjectMemory(
        root,
        { title: 'Older lesson', text: '先记录的结论。' },
        { cacheRoot, now: fixedNow('2026-09-20T08:00:00.000Z') },
      );
      await writeProjectMemory(
        root,
        { title: 'Newer lesson', text: '后记录的结论。' },
        { cacheRoot, now: fixedNow('2026-09-21T08:00:00.000Z') },
      );

      await expect(fs.access(lock)).rejects.toThrow();
      await expect(readProjectMemory(root, 'Bad_Slug', cacheRoot)).resolves.toBeNull();
      await expect(readProjectMemory(root, 'missing', cacheRoot)).resolves.toBeNull();
      await expect(readProjectMemoryIndex(root, cacheRoot)).resolves.toHaveLength(2);
      await expect(readProjectMemoryEntries(root, cacheRoot)).resolves.toMatchObject([
        { slug: 'newer-lesson', title: 'Newer lesson' },
        { slug: 'older-lesson', title: 'Older lesson' },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('rejects a new memory when the project memory directory reaches its limit', async () => {
    const root = await tempRoot('comet-project-memory-limit-');
    const cacheRoot = await tempRoot('comet-project-memory-limit-cache-');
    try {
      const directory = resolveProjectMemoryDirectory(root, cacheRoot);
      await fs.mkdir(directory, { recursive: true });
      const document = (slug: string) =>
        `---\nname: ${slug}\ntitle: ${slug}\ndescription: seed\ntype: pattern\ncreated: 2026-09-20T08:00:00.000Z\nupdated: 2026-09-20T08:00:00.000Z\npaths: []\n---\n\nseed\n`;
      await Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          fs.writeFile(path.join(directory, `seed-${index}.md`), document(`seed-${index}`)),
        ),
      );

      await expect(
        writeProjectMemory(root, { title: 'One too many', text: '这条不能写入。' }, { cacheRoot }),
      ).rejects.toThrow('项目记忆已达上限');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('bounds the rendered context index', () => {
    expect(renderProjectMemoryIndexContext([], 'zh-CN')).toBeNull();
    const entries = Array.from({ length: 65 }, (_, index) => ({
      slug: `lesson-${index}`,
      title: `经验 ${index}`,
      description: `第 ${index} 条经验摘要`,
    }));
    const rendered = renderProjectMemoryIndexContext(entries, 'zh-CN');
    expect(rendered).toContain('## 项目记忆索引');
    expect(rendered).toContain('--expand-context "project-memory:<slug>"');
    expect(rendered).toContain('另有 5 条');
    expect(rendered!.length).toBeLessThan(4000);
    const english = renderProjectMemoryIndexContext(entries.slice(0, 2), 'en');
    expect(english).toContain('## Project memory index');
  });

  test('validates memory types', () => {
    expect(isProjectMemoryType('failure-resolution')).toBe(true);
    expect(isProjectMemoryType('topology')).toBe(false);
  });
});

describe('project knowledge plugin project memory context', () => {
  test('injects the memory index and expands single entries', async () => {
    const root = await tempRoot('comet-project-memory-plugin-');
    const cacheRoot = await tempRoot('comet-project-memory-plugin-cache-');
    try {
      const created = await writeProjectMemory(
        root,
        {
          title: 'Comet memory layer lesson',
          text: '项目记忆索引必须全文注入，单条按需展开。',
          type: 'pattern',
        },
        { cacheRoot },
      );
      const storageStore = new MemoryPluginStorageStore();
      const module = await createProjectKnowledgeModule(
        {
          storage: await storageStore.open(
            'comet.project-knowledge',
            'project',
            'project-memory-context',
          ),
          reportDiagnostic: () => undefined,
        } as never,
        { projectRoot: root, cacheRoot, knowledgeConfig: { provider: 'local' } },
      );
      const request = {
        task: 'query project memory',
        projectId: resolveStableProjectId(root),
      };
      const candidates = await module.provideContext?.(request);
      const index = candidates?.find((candidate) => candidate.id === 'project-memory-index');
      expect(index).toMatchObject({
        owner: 'comet.project-knowledge',
        memoryType: 'project-policy',
        state: 'proven',
        authority: 'user',
      });
      expect(index?.content).toContain(created.slug);
      expect(index?.content).toContain('Comet memory layer lesson');

      const expanded = await module.resolveContext?.(
        `${PROJECT_MEMORY_EXPANSION_PREFIX}${created.slug}`,
        request,
      );
      expect(expanded).toMatchObject({
        id: `${PROJECT_MEMORY_EXPANSION_PREFIX}${created.slug}`,
        title: 'Comet memory layer lesson',
      });
      expect(expanded?.content).toContain('项目记忆索引必须全文注入');
      expect(
        await module.resolveContext?.(`${PROJECT_MEMORY_EXPANSION_PREFIX}missing`, request),
      ).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test('exposes project memory through the dashboard snapshot and capabilities', async () => {
    const root = await tempRoot('comet-project-memory-dashboard-');
    const cacheRoot = await tempRoot('comet-project-memory-dashboard-cache-');
    try {
      await writeProjectMemory(
        root,
        {
          title: 'Cache root discipline',
          text: '命令测试必须传入独立 cacheRoot，避免污染真实用户缓存。',
          type: 'constraint',
        },
        { cacheRoot },
      );
      const storageStore = new MemoryPluginStorageStore();
      const module = await createProjectKnowledgeModule(
        {
          storage: await storageStore.open(
            'comet.project-knowledge',
            'project',
            'project-memory-dashboard',
          ),
          reportDiagnostic: () => undefined,
        } as never,
        { projectRoot: root, cacheRoot, knowledgeConfig: { provider: 'local' } },
      );
      const status = await module.invoke?.('status', {});
      expect(status).toMatchObject({
        projectMemory: {
          total: 1,
          applicationCount: 0,
          entries: [expect.objectContaining({ slug: 'cache-root-discipline', type: 'constraint' })],
        },
      });
      const detail = await module.invoke?.('memory-get', { slug: 'cache-root-discipline' });
      expect(detail).toMatchObject({
        kind: 'memory',
        slug: 'cache-root-discipline',
        body: '命令测试必须传入独立 cacheRoot，避免污染真实用户缓存。',
      });
      await expect(module.invoke?.('memory-get', { slug: 'missing' })).rejects.toThrow(
        '项目记忆不存在',
      );
      await expect(
        module.invoke?.('remember', { title: 'Second lesson', text: '第二条经验。' }),
      ).rejects.toThrow('Unknown project knowledge capability: remember');
      await expect(
        module.invoke?.('forget', { memory: 'cache-root-discipline' }),
      ).resolves.toMatchObject({
        changed: true,
        removed: true,
      });
      await expect(module.invoke?.('forget', { memory: 'cache-root-discipline' })).rejects.toThrow(
        '项目记忆不存在',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
