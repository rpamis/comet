import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FileMemoryRepository,
  GitMemorySync,
  PersonalMemoryService,
  createPersonalMemoryPluginDescriptor,
  type MemoryGitSync,
} from '../../../domains/comet-memory/index.js';
import { MemoryPluginStateStore, PluginRuntime } from '../../../domains/comet-plugin/index.js';

class EditOnReadRepository extends FileMemoryRepository {
  private reads = 0;

  public constructor(
    root: string,
    private readonly editAtRead: number,
    private readonly edit: () => Promise<void>,
  ) {
    super(root);
  }

  public override async readText(relativePath: string): Promise<string | null> {
    const content = await super.readText(relativePath);
    this.reads += 1;
    if (this.reads === this.editAtRead) await this.edit();
    return content;
  }
}

async function withTempRepository<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function service(root: string, git?: MemoryGitSync): PersonalMemoryService {
  return new PersonalMemoryService({
    repository: new FileMemoryRepository(root, { git }),
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  });
}

describe('PersonalMemoryService', () => {
  it('writes explicit global and project memories only when they first exist', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      expect(await memories.status()).toMatchObject({ files: [] });

      const global = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      const project = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
        tags: ['build'],
      });

      expect(global.source.kind).toBe('user');
      expect(await readFile(path.join(root, 'profile.md'), 'utf8')).toContain('使用中文回复');
      expect(await readFile(path.join(root, 'projects/project-a.md'), 'utf8')).toContain(
        '使用 pnpm build',
      );
      expect(await memories.retrieve({ projectKey: 'project-a', task: 'build' })).toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ text: '使用中文回复' }),
          expect.objectContaining({ text: '使用 pnpm build' }),
        ]),
      });
      expect((await memories.status()).files).toEqual(['profile.md', 'projects/project-a.md']);
      expect(project.scope).toBe('project');
    });
  });

  it('recognizes user-authored Markdown while preserving unrelated text and ordering', async () => {
    await withTempRepository(async (root) => {
      await writeFile(
        path.join(root, 'profile.md'),
        '# 个人画像\n\n说明：这是用户维护的文件。\n\n## 沟通偏好\n\n- 使用中文回复\n- 保留我的注释\n',
      );
      const memories = service(root);

      const records = await memories.retrieve({ scope: 'global' });
      expect(records.records.map((entry) => entry.text)).toEqual(['使用中文回复', '保留我的注释']);
      await memories.remember({ scope: 'global', category: '工作习惯', text: '只暂存本次改动' });

      const content = await readFile(path.join(root, 'profile.md'), 'utf8');
      expect(content).toContain('说明：这是用户维护的文件。');
      expect(content.indexOf('使用中文回复')).toBeLessThan(content.indexOf('保留我的注释'));
      expect(content).toContain('## 工作习惯');
    });
  });

  it('supports correction, deletion and rollback without reusing removed observations', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
      });

      const corrected = await memories.correct(record.id, { text: '使用 npm run build' });
      expect(corrected.text).toBe('使用 npm run build');
      expect((await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用 npm run build' })]),
      );

      await memories.remove(record.id);
      expect(
        (await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records,
      ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: record.id })]));
      expect((await memories.rollback(record.id)).text).toBe('使用 npm run build');
      expect((await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用 npm run build' })]),
      );

      await memories.remove(record.id, { permanent: true });
      expect(await memories.get(record.id)).toBeNull();
    });
  });

  it('requires two independent successful changes before inferred memory becomes active', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const observation = {
        scope: 'project' as const,
        category: '工作习惯',
        text: '只暂存本次改动文件',
        projectKey: 'project-a',
        workflow: 'native',
        success: true,
      };

      await expect(
        memories.observe({ ...observation, changeId: 'change-1' }),
      ).resolves.toMatchObject({ candidate: true, activated: false });
      await expect(
        memories.observe({ ...observation, changeId: 'change-1' }),
      ).resolves.toMatchObject({ deduplicated: true, activated: false });
      await expect(
        memories.observe({ ...observation, changeId: 'failed', success: false }),
      ).resolves.toMatchObject({ candidate: false, activated: false });
      await expect(
        memories.observe({ ...observation, changeId: 'change-2' }),
      ).resolves.toMatchObject({ candidate: true, activated: true });

      const result = await memories.retrieve({ projectKey: 'project-a', task: 'work' });
      expect(result.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: observation.text, kind: 'inferred', active: true }),
        ]),
      );
      expect(await readFile(path.join(root, 'projects/project-a.md'), 'utf8')).toContain(
        observation.text,
      );
    });
  });

  it('deduplicates one change when its workflow is upgraded in place', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '工作习惯',
        text: '只暂存本次改动文件',
        success: true,
      };

      await expect(
        memories.observe({ ...base, workflow: 'hotfix', changeId: 'change-1' }),
      ).resolves.toMatchObject({ candidate: true, activated: false });
      await expect(
        memories.observe({ ...base, workflow: 'native', changeId: 'change-1' }),
      ).resolves.toMatchObject({ deduplicated: true, activated: false });
      await expect(
        memories.observe({ ...base, workflow: 'tweak', changeId: 'change-2' }),
      ).resolves.toMatchObject({ candidate: true, activated: true });
    });
  });

  it('upgrades a failed observation when the same change later succeeds', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '工作习惯',
        text: '只暂存本次改动文件',
        workflow: 'native',
        changeId: 'change-1',
      };

      await expect(memories.observe({ ...base, success: false })).resolves.toMatchObject({
        candidate: false,
        activated: false,
      });
      await expect(memories.observe({ ...base, success: true })).resolves.toMatchObject({
        deduplicated: false,
        candidate: true,
        activated: false,
      });
      await expect(
        memories.observe({ ...base, changeId: 'change-2', success: true }),
      ).resolves.toMatchObject({ candidate: true, activated: true });
    });
  });

  it('reconciles a manually edited project file before id-based management', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
      });
      const file = path.join(root, 'projects/project-a.md');
      await writeFile(file, '# 项目记忆\n\n## 构建\n\n- 使用 npm run build\n');

      await expect(memories.correct(record.id, { text: '使用 gradle build' })).rejects.toThrow(
        `Memory is not active: ${record.id}`,
      );
      expect(await readFile(file, 'utf8')).toContain('使用 npm run build');
    });
  });

  it('preserves a manual edit detected between read and atomic write', async () => {
    await withTempRepository(async (root) => {
      const file = path.join(root, 'profile.md');
      const repository = new EditOnReadRepository(root, 2, async () => {
        await writeFile(file, '# 个人画像\n\n## 沟通偏好\n\n- 用户手工内容\n');
      });
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });

      await expect(
        memories.remember({ scope: 'global', category: '沟通偏好', text: '后台内容' }),
      ).rejects.toThrow('Memory file changed during update: profile.md');
      expect(await readFile(file, 'utf8')).toContain('用户手工内容');
    });
  });

  it('does not activate conflicting inferred behavior', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '构建',
        workflow: 'classic',
        success: true,
      };
      await memories.observe({ ...base, text: '使用 pnpm build', changeId: 'one' });
      const result = await memories.observe({
        ...base,
        text: '使用 npm run build',
        changeId: 'two',
      });
      expect(result.activated).toBe(false);
      expect(
        (await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records,
      ).toHaveLength(0);
    });
  });

  it('lets a later stable behavior replace an older explicit preference', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const old = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
      });
      await memories.observe({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 npm run build',
        workflow: 'native',
        changeId: 'one',
        success: true,
      });
      const result = await memories.observe({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 npm run build',
        workflow: 'native',
        changeId: 'two',
        success: true,
      });
      expect(result.activated).toBe(true);
      expect((await memories.get(old.id))?.text).toBe('使用 npm run build');
      expect(
        (await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records,
      ).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: '使用 pnpm build' })]));
    });
  });

  it('retrieves bounded global and project context and supports independent pauses', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await memories.remember({ scope: 'global', category: '沟通偏好', text: '使用中文回复' });
      await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
        taskTypes: ['build'],
        pathPatterns: ['packages/**'],
      });
      await memories.remember({
        scope: 'project',
        projectKey: 'project-b',
        category: '构建',
        text: '使用 gradle build',
        taskTypes: ['build'],
      });

      const result = await memories.retrieve({
        projectKey: 'project-a',
        task: 'build',
        path: 'packages/core/index.ts',
        maxEntries: 1,
      });
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.text).toBe('使用 pnpm build');
      expect(result.records).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用 gradle build' })]),
      );

      await memories.setLearningEnabled(false);
      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-b',
          category: '习惯',
          text: '只改相关文件',
          workflow: 'native',
          changeId: 'one',
          success: true,
        }),
      ).resolves.toMatchObject({ ignored: true });
      await memories.remember({ scope: 'global', category: '习惯', text: '显式记忆仍可写入' });
      await memories.setRetrievalEnabled(false);
      expect((await memories.retrieve({ projectKey: 'project-a' })).records).toEqual([]);
      await memories.setRetrievalEnabled(true);
      await memories.pauseProjectLearning('project-a', true);
      expect((await memories.retrieve({ projectKey: 'project-a' })).records).not.toEqual([]);
      await memories.pauseProjectRetrieval('project-a', true);
      expect((await memories.retrieve({ projectKey: 'project-a' })).records).toEqual([]);
      expect((await memories.retrieve({ projectKey: 'project-b' })).records).not.toEqual([]);
    });
  });

  it('filters keyword retrieval instead of returning unrelated records', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await memories.remember({ scope: 'global', category: '构建', text: '使用 pnpm build' });
      await memories.remember({ scope: 'global', category: '沟通偏好', text: '使用中文回复' });

      const result = await memories.retrieve({ query: 'build' });
      expect(result.records.map((record) => record.text)).toEqual(['使用 pnpm build']);
    });
  });

  it('serializes concurrent writes, deduplicates equivalent text, and keeps both distinct entries', async () => {
    await withTempRepository(async (root) => {
      const repository = new FileMemoryRepository(root);
      const first = new PersonalMemoryService({ repository });
      const second = new PersonalMemoryService({ repository });
      await Promise.all([
        first.remember({ scope: 'global', category: '习惯', text: '只暂存本次改动' }),
        second.remember({ scope: 'global', category: '习惯', text: '只暂存本次改动' }),
        first.remember({ scope: 'global', category: '习惯', text: '提交前运行测试' }),
      ]);

      const content = await readFile(path.join(root, 'profile.md'), 'utf8');
      expect(content.match(/只暂存本次改动/g)).toHaveLength(1);
      expect(content).toContain('提交前运行测试');
      expect(
        JSON.parse(await readFile(path.join(root, '.comet/runtime/memory-state.json'), 'utf8')),
      ).toMatchObject({ version: 1 });
    });
  });

  it('keeps local memory usable when Git synchronization fails', async () => {
    await withTempRepository(async (root) => {
      const git: MemoryGitSync = {
        sync: async () => ({ status: 'failed', message: 'remote unavailable', retryable: true }),
      };
      const memories = service(root, git);
      await memories.remember({ scope: 'global', category: '沟通偏好', text: '使用中文回复' });
      await expect(memories.sync()).resolves.toMatchObject({ status: 'failed', retryable: true });
      expect((await memories.retrieve({ scope: 'global' })).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用中文回复' })]),
      );
    });
  });

  it('initializes and synchronizes only the dedicated memory repository', async () => {
    await withTempRepository(async (root) => {
      await writeFile(
        path.join(root, 'profile.md'),
        '# 个人画像\n\n## 沟通偏好\n\n- 使用中文回复\n',
      );
      const calls: string[][] = [];
      const sync = new GitMemorySync(root, {
        run: async (args) => {
          calls.push([...args]);
          if (args[0] === 'rev-parse') throw new Error('not a git repository');
          if (args[0] === 'status') return { stdout: ' M profile.md\n', stderr: '' };
          return { stdout: 'origin-url', stderr: '' };
        },
      });
      await expect(sync.sync()).resolves.toMatchObject({ status: 'synced' });
      expect(calls.map((entry) => entry[0])).toEqual([
        'rev-parse',
        'init',
        'remote',
        'add',
        'status',
        'commit',
        'pull',
        'push',
      ]);
      expect(calls.every((entry) => !entry.includes('D:\\Project\\Comet'))).toBe(true);
    });
  });

  it('exposes the first-party plugin through the same public runtime interface', async () => {
    await withTempRepository(async (root) => {
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => service(root),
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();
      await runtime.invoke('comet.personal-memory', 'remember', {
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await expect(runtime.collectContext({ task: '聊天' }, 'user')).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ pluginId: descriptor.id })]),
      );
      await runtime.disable(descriptor.id);
      expect(await runtime.get(descriptor.id)).toMatchObject({ status: 'disabled' });
    });
  });

  it('includes global profile when project plugin context is requested', async () => {
    await withTempRepository(async (root) => {
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => service(root),
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();
      await runtime.invoke('comet.personal-memory', 'remember', {
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await runtime.invoke(
        'comet.personal-memory',
        'remember',
        {
          scope: 'project',
          projectKey: 'project-a',
          category: '构建',
          text: '使用 pnpm build',
        },
        { scope: 'project', projectId: 'project-a' },
      );

      const contexts = await runtime.collectContext(
        { task: 'build', projectId: 'project-a' },
        { scope: 'project', projectId: 'project-a' },
      );
      expect(contexts[0]?.text).toContain('使用中文回复');
      expect(contexts[0]?.text).toContain('使用 pnpm build');
    });
  });
});
