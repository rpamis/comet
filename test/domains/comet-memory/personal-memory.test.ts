import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  FileMemoryRepository,
  GitMemorySync,
  PersonalMemoryService,
  createPersonalMemoryPluginDescriptor,
  type MemoryGitSync,
  type MemoryRuntimeState,
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

class FailNthStateWriteRepository extends FileMemoryRepository {
  private writesUntilFailure: number | null = null;

  public failStateWriteIn(writes: number): void {
    this.writesUntilFailure = writes;
  }

  public override async writeState(state: MemoryRuntimeState): Promise<void> {
    if (this.writesUntilFailure !== null) {
      this.writesUntilFailure -= 1;
      if (this.writesUntilFailure === 0) {
        this.writesUntilFailure = null;
        throw new Error('injected state write failure');
      }
    }
    await super.writeState(state);
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
  it('stores project memory under a readable project name while retaining the internal project key', async () => {
    await withTempRepository(async (root) => {
      const repository = new FileMemoryRepository(root, {
        projectKey: 'project-a',
        projectName: 'Comet',
      });
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });

      await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
      });

      await expect(readFile(path.join(root, 'projects', 'Comet.md'), 'utf8')).resolves.toContain(
        '使用 pnpm build',
      );
      await expect(
        readFile(path.join(root, 'projects', 'project-a.md'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({
        projectFiles: { 'project-a': 'projects/Comet.md' },
      });
    });
  });

  it('does not read a legacy project-key file after switching to readable project names', async () => {
    await withTempRepository(async (root) => {
      await mkdir(path.join(root, 'projects'), { recursive: true });
      await writeFile(
        path.join(root, 'projects', 'project-a.md'),
        '# 项目记忆\n\n## 构建\n\n- 使用 pnpm build\n',
      );
      const repository = new FileMemoryRepository(root, {
        projectKey: 'project-a',
        projectName: 'Comet',
      });
      const memories = new PersonalMemoryService({ repository });

      await expect(
        memories.retrieve({ scope: 'project', projectKey: 'project-a', task: '构建' }),
      ).resolves.toMatchObject({ records: [] });

      await expect(
        readFile(path.join(root, 'projects', 'project-a.md'), 'utf8'),
      ).resolves.toContain('使用 pnpm build');
      await expect(readFile(path.join(root, 'projects', 'Comet.md'), 'utf8')).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      );
    });
  });

  it('shares one project memory file across worktrees with the same project identity', async () => {
    await withTempRepository(async (root) => {
      const first = new PersonalMemoryService({
        repository: new FileMemoryRepository(root, {
          projectKey: 'comet-project',
          projectName: 'Comet',
        }),
      });
      const second = new PersonalMemoryService({
        repository: new FileMemoryRepository(root, {
          projectKey: 'comet-project',
          projectName: 'Comet',
        }),
      });

      await first.remember({
        scope: 'project',
        projectKey: 'comet-project',
        category: '协作偏好',
        text: '先确认中文语义，再同步英文',
      });

      await expect(
        second.retrieve({ scope: 'project', projectKey: 'comet-project', task: '中文语义' }),
      ).resolves.toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ text: '先确认中文语义，再同步英文' }),
        ]),
      });
    });
  });

  it('rejects unsafe direct remember and correction input before persistence', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await expect(
        memories.remember({
          scope: 'global',
          language: 'zh-CN',
          category: '偏好',
          text: 'password=secret-value',
        }),
      ).rejects.toThrow('unsafe');

      const record = await memories.remember({
        scope: 'global',
        language: 'zh-CN',
        category: '偏好',
        text: '使用中文回复',
      });
      await expect(memories.correct(record.id, { text: 'api_key=secret-value' })).rejects.toThrow(
        'unsafe',
      );
      expect((await memories.get(record.id))?.text).toBe('使用中文回复');
    });
  });

  it('applies only validated semantic review actions and skips noise without persistence', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root) as PersonalMemoryService & {
        reviewAndApply(packet: unknown, actions: unknown): Promise<unknown>;
      };
      const packet = {
        schema: 'comet.memory.review.v1',
        language: 'zh-CN',
        projectIdentity: 'repo-a',
        projectKey: 'project-a',
        workflow: 'native',
        changeId: 'change-noise',
        createdAt: '2026-08-14T00:00:00.000Z',
        checkpoint: 'task.completed',
        userEvidence: [],
        evidence: [
          {
            key: 'checkpoint:change-noise',
            scope: 'project',
            projectIdentity: 'repo-a',
            projectKey: 'project-a',
            candidateKey: 'native:build',
            changeId: 'change-noise',
            success: true,
            observedAt: '2026-08-14T00:00:00.000Z',
            text: '完成命令检查点',
          },
        ],
        memories: [],
        budget: { maxActions: 4, maxEvidence: 8, maxBytes: 4096 },
      };
      const result = await memories.reviewAndApply(packet, {
        schema: 'comet.memory.actions.v1',
        actions: [{ action: 'skip', language: 'zh-CN', reason: '没有长期可复用内容' }],
      });

      expect(result).toMatchObject({ action: 'skip', persisted: false });
      expect((await memories.manage({ projectKey: 'project-a' })).records).toHaveLength(0);
      expect((await memories.status()).files).toEqual([]);
    });
  });

  it('persists localized title and reason from a validated semantic create action', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root) as PersonalMemoryService & {
        reviewAndApply(packet: unknown, actions: unknown): Promise<unknown>;
      };
      const packet = {
        schema: 'comet.memory.review.v1',
        language: 'zh-CN',
        projectIdentity: 'repo-a',
        projectKey: 'project-a',
        workflow: 'native',
        changeId: 'change-useful',
        createdAt: '2026-08-14T00:00:00.000Z',
        checkpoint: 'verification.completed',
        userEvidence: ['提交前只暂存本次改动文件'],
        evidence: [
          {
            key: 'preference:staging:change-useful',
            scope: 'project',
            projectIdentity: 'repo-a',
            projectKey: 'project-a',
            candidateKey: 'staging',
            changeId: 'change-useful',
            success: true,
            observedAt: '2026-08-14T00:00:00.000Z',
            text: '提交前只暂存本次改动文件',
          },
        ],
        memories: [],
        budget: { maxActions: 4, maxEvidence: 8, maxBytes: 4096 },
      };
      const result = await memories.reviewAndApply(packet, {
        schema: 'comet.memory.actions.v1',
        actions: [
          {
            action: 'create',
            language: 'zh-CN',
            scope: 'project',
            projectKey: 'project-a',
            candidateKey: 'staging',
            category: '协作习惯',
            text: '提交前只暂存本次改动文件',
            title: '提交范围偏好',
            reason: '已在成功变更中重复验证，后续任务可复用',
            evidenceKeys: ['preference:staging:change-useful'],
          },
        ],
      });

      expect(result).toMatchObject({ action: 'create', persisted: true });
      const managed = await memories.manage({ projectKey: 'project-a' });
      expect(managed.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: '提交范围偏好',
            reason: '已在成功变更中重复验证，后续任务可复用',
          }),
        ]),
      );
    });
  });

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

  it('keeps permanently forgotten memories from being reactivated by later observations', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
      });

      await memories.remove(record.id, { permanent: true });

      const observation = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '构建',
        text: '使用 pnpm build',
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
      };
      await expect(
        memories.observe({
          ...observation,
          changeId: 'change-after-forget-1',
          observedAt: '2026-08-15T00:00:00.000Z',
        }),
      ).resolves.toMatchObject({ ignored: true, candidate: false, promoted: false });
      await expect(
        memories.observe({
          ...observation,
          changeId: 'change-after-forget-2',
          observedAt: '2026-08-16T00:00:00.000Z',
        }),
      ).resolves.toMatchObject({ ignored: true, candidate: false, promoted: false });

      expect(await memories.get(record.id)).toBeNull();
      expect((await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records).toEqual(
        [],
      );
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
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
      };

      await expect(
        memories.observe({ ...observation, changeId: 'change-1' }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      expect((await memories.manage({ projectKey: 'project-a' })).records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: observation.text,
            kind: 'inferred',
            memoryType: 'collaboration-policy',
            status: 'trial',
          }),
        ]),
      );
      await expect(
        memories.observe({ ...observation, changeId: 'change-1' }),
      ).resolves.toMatchObject({ deduplicated: true, promoted: false });
      await expect(
        memories.observe({ ...observation, changeId: 'failed', success: false }),
      ).resolves.toMatchObject({ candidate: false, promoted: false });
      await expect(
        memories.observe({ ...observation, changeId: 'change-2' }),
      ).resolves.toMatchObject({ candidate: true, promoted: true });

      const result = await memories.retrieve({ projectKey: 'project-a', task: 'work' });
      expect(result.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: observation.text, kind: 'inferred', state: 'proven' }),
        ]),
      );
      expect(await readFile(path.join(root, 'projects/project-a.md'), 'utf8')).toContain(
        observation.text,
      );
    });
  });

  it('supersedes inferred memory after it contributes to a failed outcome', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const observation = {
        scope: 'project' as const,
        category: '工作习惯',
        text: '所有改动都跳过最小相关测试',
        projectKey: 'project-a',
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
      };

      await memories.observe({ ...observation, changeId: 'change-1' });
      const promoted = await memories.observe({ ...observation, changeId: 'change-2' });
      expect(promoted.record).toMatchObject({ kind: 'inferred', state: 'proven' });

      await expect(
        memories.recordApplicationOutcome(promoted.record!.id, 'contributed-to-failure'),
      ).resolves.toMatchObject({
        state: 'superseded',
        applicationCount: 1,
        successCount: 0,
        failureCount: 1,
      });
      const file = path.join(root, 'projects/project-a.md');
      expect(await readFile(file, 'utf8')).not.toContain(observation.text);
      await writeFile(file, `${await readFile(file, 'utf8')}\n## 其他\n\n- 保留无关内容\n`);
      await expect(memories.manage({ projectKey: 'project-a' })).resolves.toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ id: promoted.record!.id, status: 'tombstoned' }),
        ]),
      });
      expect(
        (await memories.retrieve({ projectKey: 'project-a' })).records.map((record) => record.id),
      ).not.toContain(promoted.record!.id);
    });
  });

  it('restores inferred memory when a newer outcome revision replaces negative feedback', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const observation = {
        scope: 'project' as const,
        category: '工作习惯',
        text: '修改解析器后运行聚焦测试',
        projectKey: 'project-a',
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
        changeId: 'feedback-revision-change',
      };
      await memories.observe(observation);
      const trial = (await memories.manage({ projectKey: 'project-a' })).records.find(
        (record) => record.text === observation.text,
      );
      expect(trial).toMatchObject({ status: 'trial' });

      await expect(
        memories.recordApplicationOutcome(trial!.id, 'corrected', {
          applicationId: 'memory-application-revision',
          revision: 1,
          idempotencyKey: 'memory-feedback-revision-1',
        }),
      ).resolves.toMatchObject({ state: 'superseded', applicationCount: 1, failureCount: 1 });
      await expect(
        memories.recordApplicationOutcome(trial!.id, 'used-successfully', {
          applicationId: 'memory-application-revision',
          revision: 2,
          previousOutcome: 'corrected',
          idempotencyKey: 'memory-feedback-revision-2',
        }),
      ).resolves.toMatchObject({
        state: 'proven',
        applicationCount: 1,
        successCount: 1,
        failureCount: 0,
      });
      expect(await readFile(path.join(root, 'projects', 'project-a.md'), 'utf8')).toContain(
        observation.text,
      );
    });
  });

  it('reports explicit writes as successful after their authoritative state commit', async () => {
    await withTempRepository(async (root) => {
      const repository = new FailNthStateWriteRepository(root);
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });

      repository.failStateWriteIn(2);
      const record = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      expect(record).toMatchObject({ text: '使用中文回复', state: 'proven' });
      expect(await readFile(path.join(root, 'profile.md'), 'utf8')).toContain('使用中文回复');
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({
        records: [expect.objectContaining({ id: record.id, text: '使用中文回复' })],
        pendingFileProjections: { 'profile.md': expect.any(Object) },
      });

      await expect(memories.get(record.id)).resolves.toMatchObject({ id: record.id });
      repository.failStateWriteIn(2);
      await expect(
        memories.correct(record.id, { text: '始终使用中文回复' }),
      ).resolves.toMatchObject({
        id: record.id,
        text: '始终使用中文回复',
        state: 'proven',
      });
      expect(await readFile(path.join(root, 'profile.md'), 'utf8')).toContain('始终使用中文回复');
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({
        records: [expect.objectContaining({ id: record.id, text: '始终使用中文回复' })],
        pendingFileProjections: { 'profile.md': expect.any(Object) },
      });

      await expect(memories.get(record.id)).resolves.toMatchObject({
        id: record.id,
        text: '始终使用中文回复',
      });
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({ pendingFileProjections: {} });
    });
  });

  it('preserves user Markdown edits made after a projection cleanup failure', async () => {
    await withTempRepository(async (root) => {
      const repository = new FailNthStateWriteRepository(root);
      const memories = new PersonalMemoryService({ repository });
      repository.failStateWriteIn(2);
      const record = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      const file = path.join(root, 'profile.md');
      await writeFile(file, `${await readFile(file, 'utf8')}\n## 工作习惯\n\n- 保留用户手工编辑\n`);

      await expect(memories.get(record.id)).resolves.toMatchObject({ id: record.id });
      expect(await readFile(file, 'utf8')).toContain('保留用户手工编辑');
      await expect(memories.manage({ scope: 'global' })).resolves.toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ text: '使用中文回复' }),
          expect.objectContaining({ text: '保留用户手工编辑' }),
        ]),
      });
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({ pendingFileProjections: {} });
    });
  });

  it('leaves explicit memory unchanged when its authoritative state commit fails', async () => {
    await withTempRepository(async (root) => {
      const repository = new FailNthStateWriteRepository(root);
      const memories = new PersonalMemoryService({ repository });
      repository.failStateWriteIn(1);

      await expect(
        memories.remember({
          scope: 'global',
          category: '沟通偏好',
          text: '使用中文回复',
        }),
      ).rejects.toThrow('injected state write failure');
      await expect(readFile(path.join(root, 'profile.md'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(repository.readState()).resolves.toMatchObject({
        records: [],
        pendingFileProjections: {},
      });
    });
  });

  it('replays a pending Markdown projection when an update crashes after writing the file', async () => {
    await withTempRepository(async (root) => {
      const repository = new FailNthStateWriteRepository(root);
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });
      const original = await memories.remember({
        scope: 'global',
        category: '构建',
        text: '使用 npm run build',
      });
      const update = {
        operation: 'experience-delta',
        input: {
          idempotencyKey: 'crash-safe-memory-update',
          delta: {
            action: 'update',
            owner: 'personal-memory',
            targetId: original.id,
            memoryType: 'collaboration-policy',
            kind: 'build-policy',
            statement: '使用 pnpm build',
            applicability: {},
            evidence: [],
            recommendedState: 'proven',
          },
        },
      } as const;

      repository.failStateWriteIn(2);
      await expect(memories.apply(update)).resolves.toMatchObject({
        changed: true,
        record: { id: original.id, text: '使用 pnpm build' },
      });
      expect(await readFile(path.join(root, 'profile.md'), 'utf8')).toContain('使用 pnpm build');
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({
        records: [expect.objectContaining({ id: original.id, text: '使用 pnpm build' })],
        appliedMutationIds: ['crash-safe-memory-update'],
        pendingFileProjections: { 'profile.md': expect.objectContaining({ scope: 'global' }) },
      });

      await expect(memories.apply(update)).resolves.toEqual({ changed: false });
      await expect(memories.get(original.id)).resolves.toMatchObject({
        id: original.id,
        text: '使用 pnpm build',
        state: 'proven',
      });
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({ pendingFileProjections: {} });
    });
  });

  it('replays a pending Markdown projection when negative feedback crashes after file removal', async () => {
    await withTempRepository(async (root) => {
      const repository = new FailNthStateWriteRepository(root);
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });
      const observation = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '工作习惯',
        text: '修改解析器后运行聚焦测试',
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
      };
      await memories.observe({ ...observation, changeId: 'projection-evidence-1' });
      const promoted = await memories.observe({
        ...observation,
        changeId: 'projection-evidence-2',
      });
      const record = promoted.record!;
      const feedback = {
        operation: 'experience-delta',
        input: {
          idempotencyKey: 'crash-safe-negative-feedback',
          delta: {
            action: 'noop',
            owner: 'personal-memory',
            targetId: record.id,
            memoryType: 'collaboration-policy',
            kind: 'collaboration-habit',
            statement: record.text,
            applicability: { projectId: 'project-a' },
            evidence: [],
            feedback: {
              applicationId: 'crash-safe-application',
              status: 'corrected',
              revision: 1,
            },
            recommendedState: 'superseded',
          },
        },
      } as const;

      repository.failStateWriteIn(2);
      await expect(memories.apply(feedback)).resolves.toMatchObject({
        changed: true,
        record: { id: record.id, state: 'superseded' },
      });
      expect(await readFile(path.join(root, 'projects', 'project-a.md'), 'utf8')).not.toContain(
        record.text,
      );
      expect(
        JSON.parse(
          await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
        ),
      ).toMatchObject({
        records: [
          expect.objectContaining({
            id: record.id,
            state: 'superseded',
            applicationCount: 1,
            failureCount: 1,
          }),
        ],
        appliedMutationIds: ['crash-safe-negative-feedback'],
        pendingFileProjections: {
          'projects/project-a.md': expect.objectContaining({
            scope: 'project',
            projectKey: 'project-a',
          }),
        },
      });

      await expect(memories.apply(feedback)).resolves.toEqual({ changed: false });
      await expect(memories.get(record.id)).resolves.toMatchObject({
        id: record.id,
        state: 'superseded',
        applicationCount: 1,
        failureCount: 1,
      });
      const recoveredState = JSON.parse(
        await readFile(path.join(root, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
      ) as { records: Array<{ id: string }>; pendingFileProjections: Record<string, unknown> };
      expect(recoveredState.records.filter((entry) => entry.id === record.id)).toHaveLength(1);
      expect(recoveredState.pendingFileProjections).toEqual({});
    });
  });

  it('recovers the personal-memory lock left by a terminated process', async () => {
    await withTempRepository(async (root) => {
      const runtimeRoot = path.join(root, '.comet', 'runtime');
      const lock = path.join(runtimeRoot, '.memory.lock');
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        lock,
        JSON.stringify({ pid: 2_147_483_647, nonce: 'terminated', createdAt: 1 }),
        'utf8',
      );

      await expect(
        service(root).remember({
          scope: 'global',
          category: '沟通偏好',
          text: '使用中文回复',
        }),
      ).resolves.toMatchObject({ text: '使用中文回复' });
      await expect(readFile(lock, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('keeps explicit memory authoritative while recording failed outcomes', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '始终使用中文回复',
      });

      await expect(
        memories.recordApplicationOutcome(record.id, 'contributed-to-failure'),
      ).resolves.toMatchObject({
        kind: 'explicit',
        state: 'proven',
        applicationCount: 1,
        successCount: 0,
        failureCount: 1,
      });
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
        language: 'zh-CN' as const,
        success: true,
      };

      await expect(
        memories.observe({ ...base, workflow: 'hotfix', changeId: 'change-1' }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      await expect(
        memories.observe({ ...base, workflow: 'native', changeId: 'change-1' }),
      ).resolves.toMatchObject({ deduplicated: true, promoted: false });
      await expect(
        memories.observe({ ...base, workflow: 'tweak', changeId: 'change-2' }),
      ).resolves.toMatchObject({ candidate: true, promoted: true });
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
        language: 'zh-CN' as const,
        workflow: 'native',
        changeId: 'change-1',
      };

      await expect(memories.observe({ ...base, success: false })).resolves.toMatchObject({
        candidate: false,
        promoted: false,
      });
      await expect(memories.observe({ ...base, success: true })).resolves.toMatchObject({
        deduplicated: false,
        candidate: true,
        promoted: false,
      });
      await expect(
        memories.observe({ ...base, changeId: 'change-2', success: true }),
      ).resolves.toMatchObject({ candidate: true, promoted: true });
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
        `Memory is not available: ${record.id}`,
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
        language: 'zh-CN' as const,
        success: true,
      };
      await memories.observe({ ...base, text: '使用 pnpm build', changeId: 'one' });
      const result = await memories.observe({
        ...base,
        text: '使用 npm run build',
        changeId: 'two',
      });
      expect(result.promoted).toBe(false);
      expect(
        (await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records,
      ).toHaveLength(0);
    });
  });

  it('preserves an explicit preference when later inferred behavior conflicts', async () => {
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
        language: 'zh-CN',
        workflow: 'native',
        changeId: 'one',
        candidateKey: 'build-command',
        success: true,
      });
      const result = await memories.observe({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建',
        text: '使用 npm run build',
        language: 'zh-CN',
        workflow: 'native',
        changeId: 'two',
        candidateKey: 'build-command',
        success: true,
      });
      expect(result).toMatchObject({ candidate: true, promoted: false });
      expect((await memories.get(old.id))?.text).toBe('使用 pnpm build');
      expect((await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用 pnpm build' })]),
      );
      expect(
        (await memories.retrieve({ projectKey: 'project-a', task: 'build' })).records,
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用 npm run build' })]),
      );
    });
  });

  it('keeps candidate keys independent while deduplicating the same candidate retry', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        workflow: 'native',
        language: 'zh-CN' as const,
        success: true,
      };
      await expect(
        memories.observe({
          ...base,
          category: '沟通偏好',
          text: '使用中文回复',
          changeId: 'change-1',
          candidateKey: 'language',
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      await expect(
        memories.observe({
          ...base,
          category: '协作习惯',
          text: '只暂存本次改动文件',
          changeId: 'change-1',
          candidateKey: 'staging',
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      await expect(
        memories.observe({
          ...base,
          category: '沟通偏好',
          text: '使用中文回复',
          changeId: 'change-1',
          candidateKey: 'language',
        }),
      ).resolves.toMatchObject({ deduplicated: true });
      await expect(
        memories.observe({
          ...base,
          category: '沟通偏好',
          text: '使用中文回复',
          changeId: 'change-2',
          candidateKey: 'language',
        }),
      ).resolves.toMatchObject({ promoted: true });
      await expect(
        memories.observe({
          ...base,
          category: '协作习惯',
          text: '只暂存本次改动文件',
          changeId: 'change-2',
          candidateKey: 'staging',
        }),
      ).resolves.toMatchObject({ promoted: true });
    });
  });

  it('keeps distinct preference keys independent when they share a category', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        category: '协作偏好',
        workflow: 'native',
        language: 'zh-CN' as const,
        success: true,
      };

      for (const changeId of ['change-1', 'change-2']) {
        await memories.observe({
          ...base,
          text: '使用中文回复',
          changeId,
          candidateKey: 'response-language',
        });
        await memories.observe({
          ...base,
          text: '提交前只暂存本次改动文件',
          changeId,
          candidateKey: 'staging-scope',
        });
      }

      const managed = await memories.manage({ projectKey: 'project-a' });
      expect(managed.conflicts).toHaveLength(0);
      expect(managed.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: '使用中文回复', status: 'proven' }),
          expect.objectContaining({ text: '提交前只暂存本次改动文件', status: 'proven' }),
        ]),
      );
    });
  });

  it('does not let a legacy tombstone without a text hash block unrelated preferences', async () => {
    await withTempRepository(async (root) => {
      const repository = new FileMemoryRepository(root);
      const state = await repository.readState();
      await repository.writeState({
        ...state,
        tombstones: [
          {
            identity: 'legacy-memory-identity',
            scope: 'project',
            projectKey: 'project-a',
            recordId: 'missing-legacy-record',
            reason: 'user-remove',
            permanent: true,
            removedAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      });
      const memories = new PersonalMemoryService({
        repository,
        now: () => new Date('2026-08-14T00:00:00.000Z'),
      });

      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '协作偏好',
          text: '提交前只暂存本次改动文件',
          language: 'zh-CN',
          workflow: 'native',
          changeId: 'new-change',
          candidateKey: 'staging-scope',
          success: true,
        }),
      ).resolves.toMatchObject({ ignored: false, candidate: true });
    });
  });

  it('does not run content-based migration against the current memory schema', async () => {
    await withTempRepository(async (root) => {
      const repository = new FileMemoryRepository(root);
      const state = await repository.readState();
      const timestamp = '2026-08-13T00:00:00.000Z';
      const source = {
        kind: 'workflow' as const,
        label: 'task.completed',
        workflow: 'native',
        changeId: 'legacy-change',
        projectKey: 'project-a',
      };
      await repository.writeText(
        'projects/project-a.md',
        '# Project memory\n\n## Workflow operation\n\n- Native task completed with changed files and verification output\n',
      );
      await repository.writeState({
        ...state,
        records: [
          {
            id: 'legacy-workflow-record',
            scope: 'project',
            projectKey: 'project-a',
            category: 'Workflow operation',
            text: 'Native task completed with changed files and verification output',
            candidateKey: 'legacy-workflow',
            tags: [],
            pathPatterns: [],
            taskTypes: [],
            operations: ['task'],
            language: 'en',
            kind: 'inferred',
            memoryType: 'personal-episode',
            state: 'proven',
            applicationCount: 0,
            successCount: 0,
            failureCount: 0,
            source,
            sources: [source],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      });
      const memories = new PersonalMemoryService({ repository });

      expect((await memories.retrieve({ projectKey: 'project-a' })).records).toEqual([
        expect.objectContaining({ id: 'legacy-workflow-record', state: 'proven' }),
      ]);
      expect((await memories.manage({ projectKey: 'project-a' })).records).toEqual([
        expect.objectContaining({ id: 'legacy-workflow-record', status: 'proven' }),
      ]);
      expect((await repository.readState()).records[0]?.state).toBe('proven');
    });
  });

  it('retrieves a reusable inferred global memory as trial before cross-project promotion', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const base = {
        scope: 'global' as const,
        category: '沟通偏好',
        text: '使用中文回复',
        language: 'zh-CN' as const,
        workflow: 'native',
        success: true,
        candidateKey: 'language',
      };
      await expect(
        memories.observe({
          ...base,
          projectKey: 'project-a',
          projectIdentity: 'repo-a',
          changeId: 'change-1',
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      expect((await memories.retrieve({ scope: 'global' })).records).toEqual([
        expect.objectContaining({ state: 'trial', text: '使用中文回复' }),
      ]);
      await expect(
        memories.observe({
          ...base,
          projectKey: 'project-a',
          projectIdentity: 'repo-a',
          changeId: 'change-2',
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      await expect(
        memories.observe({
          ...base,
          projectKey: 'project-b',
          projectIdentity: 'repo-b',
          changeId: 'change-3',
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: true });
      const retrieved = await memories.retrieve({ scope: 'global' });
      expect(retrieved.records[0]?.scope).toBe('global');
      expect(retrieved.records[0]?.projectKey).toBeUndefined();
    });
  });

  it('persists structured Personal Episode fields without hidden reasoning', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);

      await memories.observe({
        scope: 'project',
        projectKey: 'project-a',
        memoryType: 'personal-episode',
        category: '失败恢复',
        text: '先刷新失效索引，再重新运行检索。',
        title: '索引恢复经验',
        reason: '失败已解决',
        language: 'zh-CN',
        workflow: 'native',
        changeId: 'repair-index',
        candidateKey: 'repair-index',
        success: true,
        evidence: [
          {
            id: 'failure-index',
            kind: 'failure',
            summary: '索引失效导致检索失败，刷新后复验成功。',
            success: true,
          },
        ],
      });

      const episode = (await memories.manage({ projectKey: 'project-a' })).records.find(
        (record) => record.memoryType === 'personal-episode',
      );
      expect(episode?.episode).toEqual({
        situation: '索引恢复经验',
        actionSummary: '索引失效导致检索失败，刷新后复验成功。',
        outcome: '成功',
        lesson: '先刷新失效索引，再重新运行检索。',
      });
    });
  });

  it('ranks proven Personal Memory ahead of newer trial records before applying the context budget', async () => {
    await withTempRepository(async (root) => {
      let current = new Date('2026-08-14T00:00:00.000Z');
      const memories = new PersonalMemoryService({
        repository: new FileMemoryRepository(root),
        now: () => current,
        taskMaxChars: 38,
      });
      const base = {
        scope: 'project' as const,
        projectKey: 'project-a',
        language: 'en' as const,
        workflow: 'native',
        success: true,
        taskTypes: ['build'],
      };

      await memories.observe({
        ...base,
        category: 'Build',
        text: 'Use proven build rule',
        changeId: 'proven-change',
        candidateKey: 'proven-build',
      });
      const proven = (await memories.manage({ projectKey: 'project-a' })).records.find(
        (record) => record.text === 'Use proven build rule',
      );
      await memories.recordApplicationOutcome(proven!.id, 'used-successfully');

      current = new Date('2026-08-15T00:00:00.000Z');
      await memories.observe({
        ...base,
        category: 'Build',
        text: 'Use newer trial rule',
        changeId: 'trial-change',
        candidateKey: 'trial-build',
      });

      const retrieval = await memories.retrieve({
        view: 'task',
        projectKey: 'project-a',
        task: 'build',
      });
      expect(retrieval.taskRecords?.map((record) => record.text)).toEqual([
        'Use proven build rule',
      ]);
    });
  });

  it('keeps Personal Episodes out of the directly injected Core Profile section', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '始终使用中文回复。',
      });
      await memories.observe({
        scope: 'global',
        memoryType: 'personal-episode',
        category: '审查经验',
        text: '先给风险摘要，再展开具体问题。',
        workflow: 'native',
        changeId: 'review-episode',
        candidateKey: 'review-episode',
        success: true,
        source: { kind: 'user' },
        evidence: [
          {
            id: 'review-episode-evidence',
            kind: 'user',
            summary: '用户接受了先摘要后展开的审查方式。',
            success: true,
          },
        ],
      });

      const retrieval = await memories.retrieve({ view: 'combined' });
      expect(retrieval.profileRecords?.map((record) => record.memoryType)).toEqual([
        'core-profile',
      ]);
      expect(retrieval.taskRecords?.map((record) => record.memoryType)).toContain(
        'personal-episode',
      );
    });
  });

  it('does not resurrect forgotten memory from old evidence but accepts later new evidence', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const remembered = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '协作习惯',
        text: '只暂存本次改动文件',
      });
      await memories.remove(remembered.id);

      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '协作习惯',
          text: '只暂存本次改动文件',
          workflow: 'native',
          language: 'zh-CN',
          changeId: 'old-change',
          candidateKey: 'staging',
          observedAt: '2026-08-13T00:00:00.000Z',
          success: true,
        }),
      ).resolves.toMatchObject({ ignored: true, promoted: false });
      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '协作习惯',
          text: '只暂存本次改动文件',
          workflow: 'native',
          language: 'zh-CN',
          changeId: 'new-change-1',
          candidateKey: 'staging',
          observedAt: '2026-08-15T00:00:00.000Z',
          success: true,
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: false });
      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '协作习惯',
          text: '只暂存本次改动文件',
          workflow: 'native',
          language: 'zh-CN',
          changeId: 'new-change-2',
          candidateKey: 'staging',
          observedAt: '2026-08-16T00:00:00.000Z',
          success: true,
        }),
      ).resolves.toMatchObject({ candidate: true, promoted: true });
    });
  });

  it('allows explicit correction to reopen a user-forgotten memory', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await memories.remove(record.id);

      const corrected = await memories.correct(record.id, { text: '始终使用中文回复' });
      expect(corrected).toMatchObject({ state: 'proven', kind: 'explicit' });
      expect((await memories.retrieve({ scope: 'global' })).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '始终使用中文回复' })]),
      );
    });
  });

  it('rebuilds the current read model from readable Markdown instead of migrating old state', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await memories.remove(record.id);
      const stateFile = path.join(root, '.comet/runtime/memory-state.json');
      const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
      state.version = 2;
      await writeFile(stateFile, JSON.stringify(state));
      await writeFile(
        path.join(root, 'profile.md'),
        '# 个人画像\n\n## 沟通偏好\n\n-   使用   中文回复  \n',
      );

      const result = await service(root).retrieve({ scope: 'global' });
      expect(result.records.map((record) => record.text)).toContain('使用   中文回复');
      expect(JSON.parse(await readFile(stateFile, 'utf8'))).toMatchObject({ version: 3 });
    });
  });

  it('does not restore forgotten Markdown content from an old sync', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const remembered = await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await memories.remove(remembered.id);
      await writeFile(
        path.join(root, 'profile.md'),
        '# 个人画像\n\n## 沟通偏好\n\n-   使用   中文回复  \n',
      );

      const result = await memories.retrieve({ scope: 'global' });
      expect(result.records).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ text: '使用中文回复' })]),
      );
    });
  });

  it('rejects automatic observations whose language conflicts with user configuration', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '沟通偏好',
          text: '使用中文回复',
          workflow: 'native',
          changeId: 'missing-language',
          success: true,
        }),
      ).resolves.toMatchObject({ ignored: true, promoted: false });
      await expect(
        memories.observe({
          scope: 'project',
          projectKey: 'project-a',
          category: '沟通偏好',
          text: 'use English responses',
          language: 'zh-CN',
          workflow: 'native',
          changeId: 'change-1',
          success: true,
        }),
      ).resolves.toMatchObject({ ignored: true, promoted: false });
    });
  });

  it('filters retrieval by category and tags independently from keyword search', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
        tags: ['语言'],
      });
      await memories.remember({
        scope: 'global',
        category: '工作习惯',
        text: '提交前只暂存本次改动文件',
        tags: ['协作'],
      });

      expect(
        (await memories.retrieve({ category: '沟通偏好', tags: ['语言'] })).records.map(
          (record) => record.text,
        ),
      ).toEqual(['使用中文回复']);
      expect((await memories.retrieve({ tags: ['缺失'] })).records).toEqual([]);
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

  it('keeps phase selectors and exposes manifest, expand, and experience-delta provider seams', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '验收协作',
        text: '验收阶段先运行聚焦测试。',
        phases: ['verify'],
        source: { kind: 'user' },
      });

      await expect(
        memories.retrieve({
          scope: 'project',
          projectKey: 'project-a',
          task: '运行测试',
          phase: 'build',
        }),
      ).resolves.toMatchObject({ records: [] });
      await expect(
        memories.retrieve({
          scope: 'project',
          projectKey: 'project-a',
          task: '运行测试',
          phase: 'verify',
        }),
      ).resolves.toMatchObject({
        records: [
          expect.objectContaining({
            id: record.id,
            phases: ['verify'],
            authority: 'explicit',
            evidence: [expect.objectContaining({ kind: 'user' })],
          }),
        ],
      });

      await expect(
        memories.query({
          view: 'manifest',
          query: { scope: 'project', projectKey: 'project-a', phase: 'verify' },
        }),
      ).resolves.toMatchObject({
        kind: 'manifest',
        items: [expect.objectContaining({ id: record.id, phases: ['verify'] })],
      });
      await expect(
        memories.query({
          view: 'expand',
          query: { id: record.id, projectKey: 'project-a' },
        }),
      ).resolves.toMatchObject({ kind: 'expand', record: { id: record.id } });
      await expect(
        memories.query({
          view: 'expand',
          query: { id: record.id, projectKey: 'project-b' },
        }),
      ).resolves.toEqual({ kind: 'expand', record: null });

      const forgetDelta = {
        operation: 'experience-delta',
        input: {
          idempotencyKey: 'forget-project-policy',
          delta: {
            action: 'forget',
            owner: 'personal-memory',
            targetId: record.id,
            memoryType: 'collaboration-policy',
            kind: 'project-convention',
            statement: record.text,
            applicability: { projectId: 'project-a', phases: ['verify'] },
            evidence: [],
            recommendedState: 'superseded',
          },
        },
      } as const;
      await expect(memories.apply(forgetDelta)).resolves.toMatchObject({ changed: true });
      await expect(memories.get(record.id)).resolves.toBeNull();
      await expect(memories.apply(forgetDelta)).resolves.toEqual({ changed: false });
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
      ).toMatchObject({ version: 3 });
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
        expect.arrayContaining([expect.objectContaining({ owner: descriptor.id })]),
      );
      await runtime.disable(descriptor.id);
      expect(await runtime.get(descriptor.id)).toMatchObject({ status: 'disabled' });
    });
  });

  it('keeps the personal memory Dashboard page local and focused', async () => {
    await withTempRepository(async (root) => {
      const git = {
        sync: vi.fn().mockResolvedValue({ status: 'local-only', retryable: false }),
        remote: vi.fn().mockResolvedValue(null),
      };
      const memoryService = service(root, git);
      await memoryService.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '偏好',
        text: '使用中文回复',
      });
      const manage = vi.spyOn(memoryService, 'manage');
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => memoryService,
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();

      const [page] = await runtime.dashboardPages({ scope: 'project', projectId: 'project-a' });
      const data = await page!.load!({
        projectId: 'project-a',
        invoke: (capability, input) =>
          runtime.invoke('comet.personal-memory', capability, input, {
            scope: 'project',
            projectId: 'project-a',
          }),
      });

      expect(data).toMatchObject({
        projectKey: 'project-a',
        retrieval: { records: [expect.objectContaining({ text: '使用中文回复' })] },
        management: { records: [expect.objectContaining({ text: '使用中文回复' })] },
      });
      expect(manage).toHaveBeenCalledTimes(1);
      expect(git.sync).not.toHaveBeenCalled();
    });
  });

  it('routes personal memory management actions through the plugin API', async () => {
    await withTempRepository(async (root) => {
      const memoryService = service(root);
      const reviewAndApply = vi.spyOn(memoryService, 'reviewAndApply');
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => memoryService,
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();

      const record = (await runtime.invoke('comet.personal-memory', 'remember', {
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      })) as { id: string };
      await runtime.invoke('comet.personal-memory', 'correct', {
        id: record.id,
        correction: { text: '始终使用中文回复' },
      });
      await runtime.invoke('comet.personal-memory', 'remove', { id: record.id });
      await runtime.invoke('comet.personal-memory', 'rollback', { id: record.id });
      expect(reviewAndApply).toHaveBeenCalledTimes(3);
      expect(
        reviewAndApply.mock.calls.map(
          ([packet]) =>
            (packet as { explicitRequest?: { action: string } }).explicitRequest?.action,
        ),
      ).toEqual(['remember', 'correct', 'forget']);
      await runtime.invoke('comet.personal-memory', 'set-learning', { enabled: false });
      await runtime.invoke('comet.personal-memory', 'set-retrieval', { enabled: false });

      await expect(
        runtime.invoke('comet.personal-memory', 'retrieve', { scope: 'global' }),
      ).resolves.toMatchObject({ disabled: true });
      await expect(runtime.invoke('comet.personal-memory', 'sync', {})).resolves.toMatchObject({
        status: 'local-only',
      });
      await expect(runtime.invoke('comet.personal-memory', 'status', {})).resolves.toMatchObject({
        learningEnabled: false,
        retrievalEnabled: false,
      });
    });
  });

  it('saves explicit memory without serializing unrelated records into the review packet', async () => {
    await withTempRepository(async (root) => {
      const memoryService = service(root);
      for (let index = 0; index < 16; index += 1) {
        await memoryService.remember({
          scope: 'global',
          memoryClass: 'user-preference',
          category: `偏好${index}`,
          text: `保持这条协作偏好内容足够具体，避免在项目操作中重复确认。${'请保持一致。'.repeat(16)}`,
          operations: ['build'],
        });
      }
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => memoryService,
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();

      const record = (await runtime.invoke(
        'comet.personal-memory',
        'remember',
        {
          scope: 'global',
          category: '沟通偏好',
          text: '保存新的全局偏好',
        },
        'user',
        { throwOnError: true },
      )) as { id: string };
      expect(record).toEqual(expect.objectContaining({ id: expect.any(String) }));
      await expect(
        runtime.invoke(
          'comet.personal-memory',
          'correct',
          { id: record.id, correction: { text: '更新后的全局偏好' } },
          'user',
          { throwOnError: true },
        ),
      ).resolves.toEqual(expect.objectContaining({ id: record.id, text: '更新后的全局偏好' }));
    });
  });

  it('treats repeated explicit forgets as an idempotent operation', async () => {
    await withTempRepository(async (root) => {
      const memoryService = service(root);
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => memoryService,
      });
      const runtime = new PluginRuntime({
        cometVersion: '1.0.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();

      const record = (await runtime.invoke(
        'comet.personal-memory',
        'remember',
        {
          scope: 'project',
          projectKey: 'project-a',
          category: '项目约定',
          text: '删除操作应当可以安全重复执行',
        },
        'user',
        { throwOnError: true },
      )) as { id: string };
      await runtime.invoke(
        'comet.personal-memory',
        'remove',
        { id: record.id },
        { scope: 'project', projectId: 'project-a' },
        { throwOnError: true },
      );

      await expect(
        runtime.invoke(
          'comet.personal-memory',
          'remove',
          { id: record.id },
          { scope: 'project', projectId: 'project-a' },
          { throwOnError: true },
        ),
      ).resolves.toBeUndefined();
      await expect(memoryService.get(record.id)).resolves.toMatchObject({ state: 'superseded' });
    });
  });

  it('routes plugin memory reads and writes through the Provider interface', async () => {
    await withTempRepository(async (root) => {
      const memoryService = service(root);
      const query = vi.spyOn(memoryService, 'query');
      const apply = vi.spyOn(memoryService, 'apply');
      const descriptor = createPersonalMemoryPluginDescriptor({
        createService: () => memoryService,
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
      await runtime.invoke('comet.personal-memory', 'retrieve', { view: 'combined' });

      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ operation: 'review' }));
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ view: 'combined' }));
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
      expect(contexts.map((candidate) => candidate.content)).toEqual(
        expect.arrayContaining(['使用中文回复', '使用 pnpm build']),
      );
    });
  });

  it('returns a stable User Profile separately from task-matched project memory', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      await memories.remember({
        scope: 'global',
        category: '用户事实',
        text: '我是后端开发，时区是 GMT+8',
      });
      await memories.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回答，先给结论',
      });
      await memories.remember({
        scope: 'project',
        projectKey: 'project-a',
        category: '构建约定',
        text: '当前项目使用 pnpm build',
        taskTypes: ['build'],
      });

      const result = await memories.retrieve({
        view: 'combined',
        projectKey: 'project-a',
        task: 'build',
      });

      expect(result.profileText).toContain('我是后端开发');
      expect(result.profileText).toContain('使用中文回答');
      expect(result.profileText).not.toContain('pnpm build');
      expect(result.taskText).toContain('当前项目使用 pnpm build');
      expect(result.text.indexOf(result.profileText)).toBeLessThan(
        result.text.indexOf(result.taskText),
      );
    });
  });

  it('keeps durable user facts ahead of newer conversational preferences in the Profile', async () => {
    await withTempRepository(async (root) => {
      let current = new Date('2026-08-14T00:00:00.000Z');
      const memories = new PersonalMemoryService({
        repository: new FileMemoryRepository(root),
        now: () => current,
      });
      await memories.remember({
        scope: 'global',
        memoryClass: 'user-fact',
        category: '用户事实',
        text: '我是后端开发',
      });
      current = new Date('2026-08-15T00:00:00.000Z');
      await memories.remember({
        scope: 'global',
        memoryClass: 'user-preference',
        category: '沟通偏好',
        text: '回答简洁一些',
      });

      const result = await memories.retrieve({ view: 'profile' });

      expect(result.profileText?.indexOf('我是后端开发')).toBeLessThan(
        result.profileText?.indexOf('回答简洁一些') ?? -1,
      );
    });
  });

  it('treats user-readable Markdown as authoritative without legacy content heuristics', async () => {
    await withTempRepository(async (root) => {
      await writeFile(
        path.join(root, 'profile.md'),
        '# 个人画像\n\n## workflow-operation\n\n- change completed: ran tests and committed\n',
      );
      const memories = new PersonalMemoryService({ repository: new FileMemoryRepository(root) });

      await expect(memories.retrieve({ view: 'combined' })).resolves.toMatchObject({
        profileRecords: [],
        taskRecords: [
          expect.objectContaining({
            memoryType: 'collaboration-policy',
            state: 'proven',
          }),
        ],
      });
      await expect(memories.manage({ scope: 'global' })).resolves.toMatchObject({
        records: [expect.objectContaining({ status: 'proven' })],
      });
    });
  });

  it('keeps an explicitly selected memory class when a record is corrected', async () => {
    await withTempRepository(async (root) => {
      const memories = service(root);
      const record = await memories.remember({
        scope: 'global',
        memoryClass: 'user-preference',
        category: '沟通偏好',
        text: '先给结论',
      });

      const corrected = await memories.correct(record.id, {
        memoryClass: 'user-fact',
        text: '我的时区是 GMT+8',
      });

      expect(corrected.memoryClass).toBe('user-fact');
      await expect(memories.get(record.id)).resolves.toMatchObject({ memoryClass: 'user-fact' });
    });
  });

  it('stores explicit memory independently from the injection budget', async () => {
    await withTempRepository(async (root) => {
      const memories = new PersonalMemoryService({
        repository: new FileMemoryRepository(root),
        profileMaxChars: 10,
      });

      await expect(
        memories.remember({
          scope: 'global',
          category: '用户事实',
          text: '这条用户事实无法放入当前容量',
        }),
      ).resolves.toMatchObject({ state: 'proven' });
      await expect(memories.manage({ scope: 'global' })).resolves.toMatchObject({
        records: [expect.objectContaining({ text: '这条用户事实无法放入当前容量' })],
      });
      await expect(memories.retrieve({ view: 'profile' })).resolves.toMatchObject({
        records: [],
        truncated: true,
      });
    });
  });
});
