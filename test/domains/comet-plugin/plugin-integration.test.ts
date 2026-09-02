import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import {
  CometPluginBridge,
  createDefaultCometPluginBridge as createProductionCometPluginBridge,
} from '../../../domains/comet-plugin/integration.js';
import { MemoryPluginStateStore, PluginRuntime } from '../../../domains/comet-plugin/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  ContextDirector,
  MemoryAgentContextApplicationStore,
  MemoryAgentExperienceJournalStore,
  type AgentExperienceEvent,
} from '../../../domains/agent-learning/index.js';

interface WorkflowExperienceFixture {
  readonly name:
    'change.completed' | 'task.completed' | 'review.completed' | 'verification.completed';
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly category: string;
  readonly text: string;
  readonly candidateKey?: string;
  readonly userEvidence?: readonly string[];
  readonly operations?: readonly string[];
}

function createDefaultCometPluginBridge(
  options: Parameters<typeof createProductionCometPluginBridge>[0],
): ReturnType<typeof createProductionCometPluginBridge> {
  return createProductionCometPluginBridge({
    // Result-oriented integration tests await Reflection deterministically. Tests of
    // nonblocking host scheduling override this option with their own queue.
    scheduleLearning: (task) => task(),
    ...options,
  });
}

async function dispatchWorkflowExperience(
  bridge: CometPluginBridge,
  fixture: WorkflowExperienceFixture,
): Promise<void> {
  const type =
    fixture.name === 'review.completed'
      ? 'review.resolved'
      : fixture.name === 'verification.completed'
        ? 'verification.completed'
        : 'episode.completed';
  const event: AgentExperienceEvent = {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `event:${fixture.workflow}:${fixture.changeId}`,
    episodeId: `workflow:${fixture.workflow}:${fixture.changeId}`,
    occurredAt: '2026-08-24T00:00:00.000Z',
    type,
    actor: 'workflow',
    scope: 'project',
    projectId: bridge.currentProjectId,
    source: {
      kind: 'workflow',
      name: fixture.workflow,
      workflow: fixture.workflow,
      changeId: fixture.changeId,
      command: fixture.name,
    },
    context: {
      workflow: fixture.workflow,
      changeId: fixture.changeId,
      operation: fixture.operations?.[0],
    },
    signal: {
      kind: 'preference',
      explicit: false,
      longTerm: false,
      text: fixture.text,
      category: fixture.category,
      targetId: fixture.candidateKey,
      selectors: { operations: fixture.operations },
    },
    evidence: (fixture.userEvidence ?? []).map((summary, index) => ({
      id: `user-${index}`,
      kind: 'user',
      summary,
    })),
    outcome: {
      status: fixture.success ? 'used-successfully' : 'contributed-to-failure',
      summary: fixture.text,
    },
  };
  await bridge.dispatchExperience(event);
}

async function withBridge(
  callback: (bridge: CometPluginBridge, projectRoot: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-bridge-'));
  const memoryRoot = path.join(root, 'memory');
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  const bridge = await createDefaultCometPluginBridge({
    projectRoot,
    memoryRoot,
    projectId: 'demo-project',
    stateRoot: path.join(root, 'plugin-state'),
    cometVersion: '0.4.0-test',
  });
  try {
    await callback(bridge, projectRoot);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('Comet plugin integration bridge', () => {
  test('retries a durable outcome event when Journal capture failed after the ledger update', async () => {
    const durableJournal = new MemoryAgentExperienceJournalStore();
    let remainingFailures = 1;
    const journal = new AgentExperienceJournal({
      read: () => durableJournal.read(),
      write: async (state) => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('temporary journal write failure');
        }
        await durableJournal.write(state);
      },
    });
    const applications = new MemoryAgentContextApplicationStore();
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [],
      journal,
    });
    const director = new ContextDirector({ applications });
    const bridge = new CometPluginBridge(runtime, 'project-1', 'en', director, applications);
    await applications.append({
      applicationId: 'application-outbox',
      candidateId: 'candidate-outbox',
      candidateDigest: 'digest-outbox',
      owner: 'fixture',
      scope: 'project',
      projectId: 'project-1',
      memoryType: 'project-policy',
      episodeId: 'episode-outbox',
      task: 'Verify durable feedback',
      whyApplied: 'Current project matches',
      delivery: 'manifest',
      appliedAt: '2026-08-24T12:00:00.000Z',
      outcomeRevision: 0,
    });
    await applications.markAppliedEventDispatched('application-outbox', '2026-08-24T12:00:01.000Z');

    await bridge.recordContextOutcome('application-outbox', 'corrected');
    expect((await applications.list())[0]?.outcomeEvents?.[0]?.dispatchedAt).toBeUndefined();

    await bridge.recordContextOutcome('application-outbox', 'corrected');
    expect((await applications.list())[0]?.outcomeEvents?.[0]?.dispatchedAt).toEqual(
      expect.any(String),
    );
    await expect(journal.list()).resolves.toEqual([
      expect.objectContaining({
        type: 'context.outcome',
        eventId: expect.stringMatching(/^context-outcome:/u),
      }),
    ]);
  });

  test('replays context.applied before later outcome events', async () => {
    const durableJournal = new MemoryAgentExperienceJournalStore();
    let remainingFailures = 1;
    const journal = new AgentExperienceJournal({
      read: () => durableJournal.read(),
      write: async (state) => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('temporary journal write failure');
        }
        await durableJournal.write(state);
      },
    });
    const applications = new MemoryAgentContextApplicationStore();
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [],
      journal,
    });
    const director = new ContextDirector({ applications });
    const bridge = new CometPluginBridge(runtime, 'project-1', 'en', director, applications);
    await applications.append({
      applicationId: 'application-order',
      candidateId: 'candidate-order',
      candidateDigest: 'digest-order',
      owner: 'fixture',
      scope: 'project',
      projectId: 'project-1',
      memoryType: 'project-policy',
      episodeId: 'episode-order',
      task: 'Preserve event order',
      whyApplied: 'Current project matches',
      delivery: 'manifest',
      appliedAt: '2026-08-24T12:00:00.000Z',
      outcomeRevision: 0,
    });
    await director.recordOutcome('application-order', 'used-successfully');

    await bridge.flushContextApplicationOutbox();
    expect(await journal.list()).toEqual([]);
    await bridge.flushContextApplicationOutbox();
    expect((await journal.list()).map((entry) => entry.type)).toEqual([
      'context.applied',
      'context.outcome',
    ]);
  });

  test('does not let another project access or mutate project-scoped personal memory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-project-mutation-scope-'));
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    await Promise.all([
      fs.mkdir(projectA, { recursive: true }),
      fs.mkdir(projectB, { recursive: true }),
    ]);
    try {
      const bridgeA = await createDefaultCometPluginBridge({
        projectRoot: projectA,
        projectId: 'project-a',
        memoryRoot,
        stateRoot,
      });
      const record = await bridgeA.remember({
        scope: 'project',
        category: '协作偏好',
        text: '只在项目 A 中应用',
      });
      const bridgeB = await createDefaultCometPluginBridge({
        projectRoot: projectB,
        projectId: 'project-b',
        memoryRoot,
        stateRoot,
      });

      await expect(
        bridgeB.remember({
          scope: 'project',
          projectKey: 'project-a',
          category: '协作偏好',
          text: '尝试跨项目新增',
        }),
      ).rejects.toThrow(/current project/iu);
      await expect(bridgeB.retrieve({ projectKey: 'project-a' })).rejects.toThrow(
        /current project/iu,
      );
      await expect(bridgeB.manage({ projectKey: 'project-a' })).rejects.toThrow(
        /current project/iu,
      );
      await expect(bridgeB.pauseProjectLearning(true, 'project-a')).rejects.toThrow(
        /current project/iu,
      );
      await expect(bridgeB.pauseProjectRetrieval(true, 'project-a')).rejects.toThrow(
        /current project/iu,
      );
      await expect(
        bridgeB.pluginRuntime.invoke(
          'comet.personal-memory',
          'remember',
          {
            scope: 'project',
            projectKey: 'project-a',
            category: '协作偏好',
            text: '绕过 Bridge 尝试跨项目新增',
          },
          'user',
          { throwOnError: true },
        ),
      ).rejects.toThrow(/current project/iu);
      for (const [capability, input] of [
        ['retrieve', { projectKey: 'project-a' }],
        ['manage', { projectKey: 'project-a' }],
        ['pause-project-learning', { projectKey: 'project-a', paused: true }],
        ['pause-project-retrieval', { projectKey: 'project-a', paused: true }],
      ] as const) {
        await expect(
          bridgeB.pluginRuntime.invoke('comet.personal-memory', capability, input, 'user', {
            throwOnError: true,
          }),
        ).rejects.toThrow(/current project/iu);
      }
      await expect(bridgeB.correct(record!.id, { text: '尝试跨项目纠正' })).rejects.toThrow(
        /current project/iu,
      );
      await expect(bridgeB.forget(record!.id)).rejects.toThrow(/current project/iu);
      await expect(bridgeB.rollback(record!.id)).rejects.toThrow(/current project/iu);

      const selection = await bridgeA.collectContext({ task: '只在项目 A 中应用' });
      const application = selection
        .flatMap((contribution) => contribution.applications)
        .find((entry) => entry.candidateId === record!.id);
      expect(application).toBeDefined();
      await expect(
        bridgeB.recordContextOutcome(application!.applicationId, 'corrected'),
      ).rejects.toThrow(/Unknown context application/iu);
      await expect(bridgeA.manage({ projectKey: 'project-a' })).resolves.toMatchObject({
        records: [expect.objectContaining({ id: record!.id, text: '只在项目 A 中应用' })],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('blocks automatic learning when the project policy disables it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-memory-policy-learning-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'memory:',
        '  learning: false',
        '  retrieval: true',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'policy-learning-project',
        stateRoot: path.join(root, 'plugin-state'),
      });

      await dispatchWorkflowExperience(bridge, {
        name: 'verification.completed',
        workflow: 'native',
        changeId: 'policy-learning-1',
        success: true,
        category: '工作方式',
        text: '验证后再提交',
        candidateKey: 'verify-before-submit',
      });

      expect(
        (await bridge.retrieve({ projectKey: 'policy-learning-project' })).records,
      ).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('blocks automatic context injection when the project policy disables it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-memory-policy-retrieval-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'memory:',
        '  learning: true',
        '  retrieval: false',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'policy-retrieval-project',
        stateRoot: path.join(root, 'plugin-state'),
      });
      await bridge.remember({
        scope: 'project',
        projectKey: 'policy-retrieval-project',
        category: '沟通偏好',
        text: '使用中文回复',
      });

      expect(await bridge.collectContext({ task: '使用中文回复' })).toEqual([]);
      expect(
        (await bridge.retrieve({ projectKey: 'policy-retrieval-project' })).records,
      ).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('invokes the configured comet-memory Skill runner with a bounded packet', async () => {
    await withBridge(async (bridge) => {
      const calls: unknown[] = [];
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-skill-runner-'));
      try {
        const skillBridge = await createDefaultCometPluginBridge({
          projectRoot: root,
          memoryRoot: path.join(root, 'memory'),
          projectId: 'skill-project',
          stateRoot: path.join(root, 'plugin-state'),
          runMemoryReview: async (packet) => {
            calls.push(packet);
            return {
              schema: 'comet.memory.actions.v1',
              actions: [
                {
                  action: 'skip',
                  language: packet.language,
                  reason:
                    packet.language === 'en' ? 'No reusable preference.' : '没有长期可复用内容',
                },
              ],
            };
          },
        });
        await dispatchWorkflowExperience(skillBridge, {
          name: 'task.completed',
          workflow: 'native',
          changeId: 'skill-runner-1',
          success: true,
          category: '工作习惯',
          text: '完成命令检查点',
          userEvidence: ['请帮我修复登录页面样式'],
          candidateKey: 'login',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          schema: 'comet.memory.review.v1',
          language: 'zh-CN',
          workflow: 'native',
          changeId: 'skill-runner-1',
        });
        expect((await skillBridge.retrieve({ projectKey: 'skill-project' })).records).toHaveLength(
          0,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
    });
  });

  test('does not persist workflow observations when no user evidence was supplied', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-agent-memory-filter-'));
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot: root,
        memoryRoot: path.join(root, 'memory'),
        projectId: 'agent-memory-filter-project',
        stateRoot: path.join(root, 'plugin-state'),
        runMemoryReview: async (packet) => ({
          schema: 'comet.memory.actions.v1',
          actions: [
            {
              action: 'create',
              language: packet.language,
              scope: 'project',
              projectKey: packet.projectKey,
              category: '工作流操作',
              text: '完成命令检查点',
              candidateKey: 'agent-work-item',
            },
          ],
        }),
      });

      await dispatchWorkflowExperience(bridge, {
        name: 'task.completed',
        workflow: 'native',
        changeId: 'agent-memory-filter-1',
        success: true,
        category: '工作流操作',
        text: '完成命令检查点',
        candidateKey: 'agent-work-item',
      });

      expect((await bridge.manage({ projectKey: 'agent-memory-filter-project' })).records).toEqual(
        [],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('exposes only first activation and conflict notices to the workflow caller', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-notices-'));
    try {
      const notices: string[] = [];
      const bridge = await createDefaultCometPluginBridge({
        projectRoot: root,
        memoryRoot: path.join(root, 'memory'),
        projectId: 'notice-project',
        stateRoot: path.join(root, 'plugin-state'),
        onMemoryReviewNotice: (notice) => notices.push(notice),
      });
      const observation = {
        name: 'change.completed' as const,
        workflow: 'native',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      };
      await dispatchWorkflowExperience(bridge, { ...observation, changeId: 'notice-1' });
      await dispatchWorkflowExperience(bridge, { ...observation, changeId: 'notice-2' });
      expect(notices).toHaveLength(0);
      await bridge.retrieve({ task: '暂存改动' });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('应用');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('keeps unavailable implicit Skill review nonblocking and replays it later', async () => {
    await withBridge(async (bridge) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-skill-failure-'));
      try {
        let skillAvailable = false;
        const failingBridge = await createDefaultCometPluginBridge({
          projectRoot: root,
          memoryRoot: path.join(root, 'memory'),
          projectId: 'skill-failure-project',
          stateRoot: path.join(root, 'plugin-state'),
          runMemoryReview: async (packet) => {
            if (!skillAvailable) throw new Error('Skill host unavailable');
            return {
              schema: 'comet.memory.actions.v1',
              actions: [
                {
                  action: 'create',
                  scope: 'project',
                  language: packet.language,
                  category: '工作习惯',
                  text: '提交前只暂存本次改动文件',
                },
              ],
            };
          },
        });
        await expect(
          dispatchWorkflowExperience(failingBridge, {
            name: 'task.completed',
            workflow: 'native',
            changeId: 'skill-failure-1',
            success: true,
            category: '工作习惯',
            text: '完成命令检查点',
            userEvidence: ['提交前只暂存本次改动文件'],
            candidateKey: 'staging',
          }),
        ).resolves.toBeUndefined();
        expect(
          (await failingBridge.retrieve({ projectKey: 'skill-failure-project' })).records,
        ).toHaveLength(0);

        skillAvailable = true;
        await failingBridge.collectContext({ task: '准备提交当前改动' });
        expect(
          (await failingBridge.retrieve({ projectKey: 'skill-failure-project' })).records,
        ).toEqual([expect.objectContaining({ text: '提交前只暂存本次改动文件' })]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
    });
  });

  test('uses the deterministic review fallback for an explicit memory request', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-explicit-failure-'));
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot: root,
        memoryRoot: path.join(root, 'memory'),
        projectId: 'explicit-failure-project',
        stateRoot: path.join(root, 'plugin-state'),
        runMemoryReview: async () => {
          throw new Error('Skill host unavailable');
        },
      });

      await expect(
        bridge.remember({ scope: 'global', category: '沟通偏好', text: '使用中文回复' }),
      ).resolves.toMatchObject({
        scope: 'global',
        text: '使用中文回复',
        state: 'proven',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('does not persist an explicit one-time user signal', async () => {
    await withBridge(async (bridge) => {
      await bridge.dispatchExperience({
        schema: AGENT_EXPERIENCE_SCHEMA,
        eventId: 'one-time-signal',
        episodeId: 'one-time-episode',
        occurredAt: '2026-08-24T00:00:00.000Z',
        type: 'user.signal',
        actor: 'user',
        scope: 'user',
        source: { kind: 'user', name: 'conversation' },
        context: { task: '只在这一次列三条' },
        signal: {
          kind: 'preference',
          explicit: true,
          longTerm: false,
          text: '只在这一次列三条',
        },
        evidence: [{ id: 'one-time-evidence', kind: 'user', summary: '只在这一次列三条' }],
      });

      expect((await bridge.manage()).records).toEqual([]);
    });
  });

  test('forms a structured Personal Episode from reusable implicit user feedback', async () => {
    await withBridge(async (bridge) => {
      await bridge.dispatchExperience({
        schema: AGENT_EXPERIENCE_SCHEMA,
        eventId: 'implicit-reusable-feedback',
        episodeId: 'implicit-reusable-feedback-episode',
        occurredAt: '2026-08-24T00:00:00.000Z',
        type: 'episode.completed',
        actor: 'user',
        scope: 'user',
        source: { kind: 'user', name: 'conversation' },
        context: { task: '审查变更风险' },
        signal: {
          kind: 'acceptance',
          explicit: false,
          longTerm: false,
          text: '先给风险摘要，再展开具体问题。',
          category: '审查偏好',
        },
        evidence: [
          {
            id: 'implicit-reusable-feedback-evidence',
            kind: 'user',
            summary: '用户选择先查看风险摘要，再展开具体问题。',
            success: true,
          },
        ],
        outcome: { status: 'used-successfully', summary: '用户接受了分层审查结果。' },
      });

      expect((await bridge.manage({ scope: 'global' })).records).toEqual([
        expect.objectContaining({
          memoryType: 'personal-episode',
          status: 'trial',
          episode: {
            situation: expect.any(String),
            actionSummary: '用户选择先查看风险摘要，再展开具体问题。',
            outcome: '成功',
            lesson: '先给风险摘要，再展开具体问题。',
          },
        }),
      ]);
    });
  });

  test('bridges bounded user evidence and supports an optional nonblocking host adapter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-background-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    let backgroundTask: (() => Promise<void>) | undefined;
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'demo-project',
        stateRoot: path.join(root, 'plugin-state'),
        scheduleLearning: (task) => {
          backgroundTask = task;
        },
      });
      await dispatchWorkflowExperience(bridge, {
        name: 'change.completed',
        workflow: 'native',
        changeId: 'background-1',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      });

      expect(backgroundTask).toBeTypeOf('function');
      expect((await bridge.retrieve({ task: '暂存改动' })).records).toHaveLength(0);
      await backgroundTask?.();
      expect((await bridge.manage({ task: '暂存改动' })).records).toEqual([
        expect.objectContaining({ status: 'trial' }),
      ]);
      await dispatchWorkflowExperience(bridge, {
        name: 'change.completed',
        workflow: 'native',
        changeId: 'background-2',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      });
      await backgroundTask?.();
      expect((await bridge.retrieve({ task: '暂存改动' })).records).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('collects personal memory context through the public runtime', async () => {
    await withBridge(async (bridge) => {
      const remembered = await bridge.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
        pathPatterns: ['src/*.ts'],
      });
      const contributions = await bridge.collectContext({
        task: '使用中文回复',
        path: 'src/server.ts',
      });

      expect(contributions.map((entry) => entry.pluginId)).toEqual(['comet.context-director']);
      expect(contributions[0]?.text).toEqual(expect.stringContaining('使用中文回复'));
      expect(contributions[0]?.text).toContain(`comet.personal-memory::${remembered!.id}`);
      expect(contributions[0]?.text.match(/使用中文回复/gu)).toHaveLength(1);
      expect(contributions[0]?.applications.map((record) => record.candidateId)).toEqual([
        ...new Set(contributions[0]?.applications.map((record) => record.candidateId)),
      ]);
      const application = contributions[0]?.applications[0];
      expect(application).toMatchObject({ scope: 'user' });
      await bridge.recordContextOutcome(application!.applicationId, 'used-successfully');
      await bridge.recordContextOutcome(application!.applicationId, 'used-successfully');
      expect((await bridge.manage({ scope: 'global' })).records[0]).toMatchObject({
        applicationCount: 1,
        successCount: 1,
      });
      await bridge.recordContextOutcome(application!.applicationId, 'corrected');
      expect((await bridge.manage({ scope: 'global' })).records[0]).toMatchObject({
        applicationCount: 1,
        successCount: 0,
        failureCount: 1,
      });
      await expect(
        bridge.expandContext(`comet.personal-memory::${remembered!.id}`, {
          task: '查看完整记忆',
          path: 'src/server.ts',
        }),
      ).resolves.toMatchObject({
        id: `comet.personal-memory::${remembered!.id}`,
        content: '使用中文回复',
      });
    });
  });

  test('suppresses unchanged context after the bridge is recreated for the same session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-session-dedupe-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    const stateRoot = path.join(root, 'plugin-state');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const firstBridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'session-dedupe-project',
        stateRoot,
      });
      await firstBridge.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });

      const request = { task: '回复用户', sessionId: 'session-1' };
      const first = await firstBridge.collectContext(request);
      expect(first).toHaveLength(1);
      expect(first[0]?.applications).toHaveLength(1);

      const recreatedBridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'session-dedupe-project',
        stateRoot,
      });
      expect(await recreatedBridge.collectContext(request)).toEqual([]);
      expect(
        await recreatedBridge.collectContext({ ...request, sessionId: 'session-2' }),
      ).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('keeps lifecycle memory in the project scope with candidate and configured language', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lifecycle-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'demo-project',
        language: 'zh-CN',
        stateRoot: path.join(root, 'plugin-state'),
      });
      const observation = {
        name: 'change.completed' as const,
        workflow: 'hotfix',
        changeId: 'change-scope-language',
        success: true,
        category: '操作习惯',
        text: '提交前只暂存本次改动文件',
        userEvidence: ['用户要求提交前只暂存本次改动文件'],
        candidateKey: 'stage-scope',
      };
      await dispatchWorkflowExperience(bridge, observation);
      await dispatchWorkflowExperience(bridge, {
        ...observation,
        changeId: 'change-scope-language-2',
      });

      const state = JSON.parse(
        await fs.readFile(path.join(memoryRoot, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
      ) as {
        observations: Array<Record<string, unknown>>;
      };
      expect(state.observations).toEqual([
        expect.objectContaining({
          scope: 'project',
          projectKey: 'demo-project',
          candidateKey: 'stage-scope',
        }),
        expect.objectContaining({
          scope: 'project',
          projectKey: 'demo-project',
          candidateKey: 'stage-scope',
        }),
      ]);
      await expect(fs.stat(path.join(memoryRoot, 'profile.md'))).rejects.toThrow();
      expect((await bridge.retrieve({ scope: 'global', task: '提交' })).records).toHaveLength(0);
      expect((await bridge.retrieve({ scope: 'project', task: '提交' })).records).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('resolves lifecycle language from the active project configuration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-language-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'english-project',
        stateRoot: path.join(root, 'plugin-state'),
      });
      for (const changeId of ['language-1', 'language-2']) {
        await dispatchWorkflowExperience(bridge, {
          name: 'verification.completed',
          workflow: 'native',
          changeId,
          success: true,
          category: 'Workflow habit',
          text: 'Run tests before commit',
          userEvidence: ['I prefer running tests before commit'],
          candidateKey: 'verify-before-commit',
        });
      }
      const records = (await bridge.retrieve({ scope: 'project', task: 'tests commit' })).records;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        language: 'en',
        scope: 'project',
        projectKey: 'english-project',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('checkpoints personal memory after a workflow observation', async () => {
    await withBridge(async (bridge) => {
      const sync = vi.spyOn(bridge, 'syncMemory').mockResolvedValue({
        status: 'local-only',
        retryable: false,
        message: 'No memory Git remote is configured',
      });

      await dispatchWorkflowExperience(bridge, {
        name: 'change.completed',
        workflow: 'native',
        changeId: 'change-checkpoint',
        success: true,
        category: 'checkpoint',
        text: 'workflow completed',
      });

      expect(sync).toHaveBeenCalledOnce();
    });
  });

  test('routes lifecycle checkpoints through semantic review and keeps command summaries out', async () => {
    await withBridge(async (bridge) => {
      for (const changeId of ['checkpoint-noise-1', 'checkpoint-noise-2']) {
        await dispatchWorkflowExperience(bridge, {
          name: 'task.completed',
          workflow: 'native',
          changeId,
          success: true,
          category: '工作流检查点',
          text: '完成命令检查点',
          candidateKey: 'native:build',
          operations: ['build'],
        });
      }

      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
      expect((await bridge.manage({ projectKey: 'demo-project' })).records).toHaveLength(0);
    });
  });

  test('consumes verification and review lifecycle events as memory observations', async () => {
    await withBridge(async (bridge) => {
      for (const [name, changeId] of [
        ['verification.completed', 'verify-1'],
        ['review.completed', 'review-1'],
      ] as const) {
        await dispatchWorkflowExperience(bridge, {
          name,
          workflow: 'native',
          changeId,
          success: true,
          category: '工作方式',
          text: '验证后再提交',
          userEvidence: ['以后验证后再提交'],
          candidateKey: 'verify-before-submit',
        });
      }
      expect((await bridge.retrieve({ task: '验证 提交' })).records).toHaveLength(1);
    });
  });
});
