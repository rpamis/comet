import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  FileMemoryRepository,
  PersonalMemoryService,
} from '../../../domains/comet-memory/index.js';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/integration.js';
import { writeProjectMemory } from '../../../domains/project-knowledge/project-memory.js';
import { JsonFilePluginStorageStore } from '../../../platform/fs/plugin-store.js';
import {
  ContextDirector,
  MemoryAgentContextApplicationStore,
  type AgentContextCandidate,
} from '../../../domains/agent-learning/index.js';

async function withProject(
  run: (fixture: {
    root: string;
    cacheRoot: string;
    memories: PersonalMemoryService;
    bridge: Awaited<ReturnType<typeof createDefaultCometPluginBridge>>;
  }) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-context-retrieval-'));
  const root = path.join(directory, 'project');
  const homeDirectory = path.join(directory, 'home');
  const cacheRoot = path.join(directory, 'cache');
  const memoryRoot = path.join(homeDirectory, '.comet', 'memory');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, '.comet'));
  await fs.writeFile(
    path.join(root, '.comet', 'config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: native\nworkflows: [native]\nnative:\n  artifact_root: docs\nknowledge:\n  provider: local\n  local:\n    include: ["docs/**/*.md"]\n',
  );
  const memories = new PersonalMemoryService({ repository: new FileMemoryRepository(memoryRoot) });
  const bridge = await createDefaultCometPluginBridge({
    projectRoot: root,
    projectId: 'context-retrieval-project',
    homeDirectory,
    memoryRoot,
    knowledgeCacheRoot: cacheRoot,
    scheduleLearning: (task) => task(),
  });
  try {
    await run({ root, cacheRoot, memories, bridge });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe('task context retrieval', () => {
  test('delivers context promptly while the optional usage file is locked', async () => {
    await withProject(async ({ root, memories, bridge }) => {
      await memories.remember({
        scope: 'global',
        category: 'workflow',
        text: 'Run the focused check.',
      });
      const request = { task: 'Fix the login page', contextMode: 'snapshot' as const };
      await bridge.collectContext(request);
      const usageStorage = await new JsonFilePluginStorageStore(
        path.join(path.dirname(root), 'home', '.comet', 'plugins', 'storage'),
      ).open('comet.agent-context', 'project', 'context-retrieval-project');
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = usageStorage.withLock(async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      await ready;
      const pending = bridge.collectContext(request);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result;
      try {
        result = await Promise.race([
          pending,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 3000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        release();
        await held;
        await pending;
      }
      expect(result?.map((entry) => entry.text).join('\n')).toContain('Run the focused check.');
    });
  });
  test('binds a global memory delivery and its feedback to the requesting project', async () => {
    const applications = new MemoryAgentContextApplicationStore();
    const director = new ContextDirector({ applications });
    const candidate: AgentContextCandidate = {
      id: 'global',
      owner: 'comet.personal-memory',
      scope: 'user',
      memoryType: 'core-profile',
      kind: 'preference',
      state: 'proven',
      authority: 'user',
      title: '中文回复',
      summary: '使用中文',
      content: '使用中文',
      selectors: {},
      sources: [],
      verification: [],
    };
    const request = { task: '继续修复', sessionId: 'same-session', phase: 'build' };
    const first = await director.select([candidate], { ...request, projectId: 'project-a' });
    const second = await director.select([candidate], { ...request, projectId: 'project-b' });
    expect(first.applications[0].contextProjectId).toBe('project-a');
    expect(first.applications[0].scope).toBe('user');
    expect(first.applications[0].projectId).toBeUndefined();
    expect(second.applications).toHaveLength(1);
    expect(second.applications[0].applicationId).not.toBe(first.applications[0].applicationId);
    expect(
      await director.recordOutcome(first.applications[0].applicationId, 'ignored', 'project-b'),
    ).toBeNull();
  });
  test('exposes persisted request metrics without counting Dashboard loads or previews', async () => {
    await withProject(async ({ bridge, memories }) => {
      const projectId = 'context-retrieval-project';
      const scope = { scope: 'project' as const, projectId };
      const pages = await bridge.pluginRuntime.dashboardPages('user');
      const page = pages.find((entry) => entry.pluginId === 'comet.personal-memory')!;
      const load = async () =>
        (await page.load!({
          projectId,
          invoke: (capability, input) =>
            bridge.pluginRuntime.invoke('comet.personal-memory', capability, input, scope),
        })) as {
          contextUsage: import('../../../domains/agent-learning/index.js').ContextUsageSnapshot;
        };
      await bridge.collectContext({ task: '修复登录', phase: 'build' });
      await memories.remember({
        scope: 'global',
        category: 'workflow',
        text: '修复前先复现。',
        taskTypes: ['修复'],
      });
      const contributions = await bridge.collectContext({ task: '修复登录', phase: 'build' });
      const application = contributions
        .flatMap((entry) => entry.applications)
        .find((entry) => entry.owner === 'comet.personal-memory')!;
      await bridge.recordContextOutcome(application.applicationId, 'used-successfully', {
        decision: '已先复现',
        verification: { command: 'focused-check', success: true },
      });
      const before = (await load()).contextUsage;
      expect(before).toMatchObject({
        requests: 2,
        hits: 1,
        fullDeliveries: 1,
        successes: 1,
        feedbackRate: 1,
      });
      await load();
      await bridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'search',
        { task: 'Preview only' },
        scope,
      );
      expect((await load()).contextUsage.requests).toBe(2);
      const knowledge = (await bridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'status',
        {},
        scope,
      )) as {
        contextUsage: import('../../../domains/agent-learning/index.js').ContextUsageSnapshot;
      };
      expect(knowledge.contextUsage.requests).toBe(2);
    });
  });

  test('records project memory expansion as full delivery without inflating request counts', async () => {
    await withProject(async ({ root, cacheRoot, bridge }) => {
      await writeProjectMemory(
        root,
        {
          title: 'Alpha console migration',
          text: 'Alpha console migration uses a verified local plan. '.repeat(100),
        },
        { cacheRoot },
      );
      const request = {
        task: 'Alpha console migration',
        sessionId: 'alpha',
        contextMode: 'snapshot' as const,
        charBudget: 1800,
      };
      const contributions = await bridge.collectContext(request);
      const manifest = contributions
        .flatMap((entry) => entry.manifest)
        .find((entry) => entry.id.startsWith('project-memory:'))!;
      expect(manifest).toBeDefined();
      await bridge.expandContext(manifest.expansionId, request);
      await bridge.expandContext(manifest.expansionId, request);
      const scope = { scope: 'project' as const, projectId: 'context-retrieval-project' };
      const snapshot = (await bridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'status',
        {},
        scope,
      )) as {
        contextUsage: import('../../../domains/agent-learning/index.js').ContextUsageSnapshot;
      };
      expect(snapshot.contextUsage).toMatchObject({ requests: 1, fullDeliveries: 1, successes: 0 });
    });
  });
  test('preserves retrieval relevance instead of sorting document candidates alphabetically', async () => {
    await withProject(async ({ root, bridge }) => {
      await fs.mkdir(path.join(root, 'docs'));
      await fs.writeFile(
        path.join(root, 'docs', 'authentication.md'),
        '# ZZZ Authentication session migration\n\nAuthentication session migration verification checks the active login sessions.\n',
      );
      await fs.writeFile(
        path.join(root, 'docs', 'general.md'),
        '# AAA Verification process\n\nVerification may also include authentication and session checks.\n',
      );
      const context = await bridge.collectContext({
        task: 'Authentication session migration verification',
        contextMode: 'snapshot',
      });
      const documents = context
        .flatMap((entry) => entry.manifest)
        .filter((entry) => entry.id.startsWith('document-'));
      expect(documents[0]?.title).toContain('ZZZ Authentication');
    });
  });
  test.each([
    ['修复', '修复登录页面的问题'],
    ['build', 'build the login page'],
    ['build*page', 'build the login page'],
  ])('uses task selector %s for a complete request', async (taskType, task) => {
    await withProject(async ({ memories, bridge }) => {
      await memories.remember({
        scope: 'global',
        category: 'Task preference',
        text: 'Confirm the reproduction before changing behavior.',
        taskTypes: [taskType],
      });
      const context = await bridge.collectContext({
        task,
        phase: 'build',
        contextMode: 'snapshot',
      });
      expect(context.map((entry) => entry.text).join('\n')).toContain(
        'Confirm the reproduction before changing behavior.',
      );
    });
  });

  test('filters unknown or mismatched paths before applying the personal context budget', async () => {
    await withProject(async ({ memories, bridge }) => {
      await memories.remember({
        scope: 'global',
        category: 'Acceptance preference',
        text: 'Use the requested verification Skill. '.repeat(25),
        phases: ['verify'],
      });
      for (let index = 0; index < 40; index += 1) {
        await memories.remember({
          scope: 'global',
          category: `Other path ${index}`,
          text: `A lesson for another module ${index}. `.repeat(6),
          pathPatterns: ['other/module/**'],
          phases: ['verify'],
        });
      }
      for (const currentPath of [undefined, 'app/login.ts']) {
        const context = await bridge.collectContext({
          task: 'Verify the login page',
          phase: 'verify',
          ...(currentPath === undefined ? {} : { path: currentPath }),
          contextMode: 'snapshot',
        });
        const text = context.map((entry) => entry.text).join('\n');
        expect(text).toContain('Use the requested verification Skill.');
        expect(text).not.toContain('A lesson for another module');
      }
    });
  });

  test('expands a project memory index delivered as a manifest under a tight budget', async () => {
    await withProject(async ({ root, cacheRoot, bridge }) => {
      for (let index = 0; index < 16; index += 1) {
        await writeProjectMemory(
          root,
          {
            title: `Durable lesson ${index}`,
            description: 'A detailed reusable lesson. '.repeat(5),
            text: 'Verified steps.',
          },
          { cacheRoot },
        );
      }
      const request = {
        task: 'Understand project lessons',
        charBudget: 2000,
        contextMode: 'snapshot' as const,
      };
      const context = await bridge.collectContext(request);
      const item = context
        .flatMap((entry) => entry.manifest)
        .find((entry) => entry.id === 'project-memory-index');
      expect(item).toBeDefined();
      const expanded = await bridge.expandContext(item!.expansionId, request);
      expect(expanded?.content).toContain('Durable lesson 0');
      expect(expanded?.content).toContain('Durable lesson 15');
    });
  });

  test('discovers an older project lesson by task even when newer lessons fill the index', async () => {
    await withProject(async ({ root, cacheRoot, bridge }) => {
      await writeProjectMemory(
        root,
        {
          slug: 'login-deployment',
          title: 'Login deployment',
          description: 'Validate the session migration before deploying login.',
          text: 'Validated session migration steps.',
        },
        { cacheRoot, now: () => new Date('2025-01-01') },
      );
      for (let index = 0; index < 35; index += 1) {
        await writeProjectMemory(
          root,
          {
            title: `Unrelated lesson ${index}`,
            description: 'A recent lesson about a different module. '.repeat(4),
            text: 'Unrelated steps.',
          },
          { cacheRoot, now: () => new Date('2026-01-01') },
        );
      }
      const request = { task: 'Login deployment', contextMode: 'snapshot' as const };
      const context = await bridge.collectContext(request);
      expect(context.map((entry) => entry.text).join('\n')).toContain('login-deployment');
      const query = await bridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'query',
        { task: request.task },
        { scope: 'project', projectId: 'context-retrieval-project' },
      );
      expect(JSON.stringify(query)).toContain('login-deployment');
    });
  });

  test('searches the lesson body while excluding stale source-bound lessons', async () => {
    await withProject(async ({ root, cacheRoot, bridge }) => {
      await fs.writeFile(path.join(root, 'evidence.md'), 'Current behavior.');
      await writeProjectMemory(
        root,
        {
          title: 'A durable lesson',
          description: 'A concise description.',
          text: 'SessionMigrationToken must be validated before applying this lesson.',
          evidence: ['evidence.md'],
        },
        { cacheRoot },
      );
      const request = { task: 'SessionMigrationToken', contextMode: 'snapshot' as const };
      expect(
        (await bridge.collectContext(request))
          .flatMap((entry) => entry.applications)
          .some((entry) => entry.candidateId.startsWith('project-memory:')),
      ).toBe(true);
      await fs.writeFile(path.join(root, 'evidence.md'), 'Changed behavior.');
      expect(
        (await bridge.collectContext(request))
          .flatMap((entry) => entry.applications)
          .some((entry) => entry.candidateId.startsWith('project-memory:')),
      ).toBe(false);
    });
  });
});
