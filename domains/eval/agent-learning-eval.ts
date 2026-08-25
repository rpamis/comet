import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_EXPERIENCE_SCHEMA,
  ContextDirector,
  MemoryAgentContextApplicationStore,
  type AgentContextCandidate,
  type AgentExperienceEvent,
} from '../agent-learning/index.js';
import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  PersonalMemoryService,
} from '../comet-memory/index.js';
import { MemoryPluginStateStore, PluginRuntime } from '../comet-plugin/index.js';
import {
  createUserProjectKnowledgeRecord,
  LocalProjectKnowledgeProvider,
  ProjectKnowledgeLearningService,
  type ProjectKnowledgeRecord,
} from '../project-knowledge/index.js';

export const AGENT_LEARNING_EVAL_SCHEMA = 'comet.agent-learning.eval.v1' as const;

export type AgentLearningFormationCaseId =
  | 'explicit-preference'
  | 'one-time-instruction'
  | 'implicit-correction'
  | 'failure-resolution'
  | 'review-decision'
  | 'archive-reflection'
  | 'project-constraint';

export interface AgentLearningFormationEvalCase {
  readonly id: AgentLearningFormationCaseId;
  readonly owner: 'personal-memory' | 'project-knowledge';
  readonly expectedType: string;
  readonly expectedState: 'trial' | 'proven' | 'enforced' | 'ignored';
  readonly actualType?: string;
  readonly actualState?: string;
  readonly passed: boolean;
}

export interface AgentLearningRetrievalEvalMetrics {
  readonly targetRecall: number;
  readonly falseApplicationRate: number;
  readonly contextSavingsRatio: number;
  readonly feedbackRankingChanged: boolean;
  readonly targetIds: readonly string[];
  readonly appliedIds: readonly string[];
  readonly naiveContextBytes: number;
  readonly injectedContextBytes: number;
}

export interface AgentLearningEvalReport {
  readonly schema: typeof AGENT_LEARNING_EVAL_SCHEMA;
  readonly formation: {
    readonly cases: readonly AgentLearningFormationEvalCase[];
    readonly passRate: number;
  };
  readonly retrieval: AgentLearningRetrievalEvalMetrics;
  readonly passed: boolean;
}

export async function runAgentLearningEval(): Promise<AgentLearningEvalReport> {
  const formationCases = await runFormationEval();
  const retrieval = await runRetrievalEval();
  const formationPassRate = ratio(
    formationCases.filter((entry) => entry.passed).length,
    formationCases.length,
  );
  const passed =
    formationPassRate === 1 &&
    retrieval.targetRecall === 1 &&
    retrieval.falseApplicationRate === 0 &&
    retrieval.contextSavingsRatio > 0.5 &&
    retrieval.feedbackRankingChanged;
  return {
    schema: AGENT_LEARNING_EVAL_SCHEMA,
    formation: { cases: formationCases, passRate: formationPassRate },
    retrieval,
    passed,
  };
}

async function runFormationEval(): Promise<AgentLearningFormationEvalCase[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-agent-learning-eval-'));
  const memoryRoot = path.join(root, 'memory');
  const projectRoot = path.join(root, 'project');
  const knowledgeRoot = path.join(root, 'knowledge');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  const sourcePath = path.join(projectRoot, 'src', 'main.ts');
  await fs.writeFile(sourcePath, 'export const main = true;\n', 'utf8');
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } }),
    'utf8',
  );
  const sourceStat = await fs.stat(sourcePath);
  const memory = new PersonalMemoryService({
    language: 'zh-CN',
    repository: new FileMemoryRepository(memoryRoot, {
      projectKey: 'eval-project',
      projectName: 'Agent Learning Eval',
    }),
  });
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot,
    cacheRoot: knowledgeRoot,
    corpus: [],
  });
  try {
    const explicit = await memory.remember({
      scope: 'global',
      category: '沟通偏好',
      text: '以后默认使用中文回复',
      memoryClass: 'user-preference',
      source: { kind: 'user' },
    });
    const memoryRuntime = new PluginRuntime({
      cometVersion: '0.4.0-eval',
      store: new MemoryPluginStateStore(),
      descriptors: [
        createPersonalMemoryPluginDescriptor({
          language: 'zh-CN',
          createService: () => memory,
        }),
      ],
    });
    await memoryRuntime.reconcileFirstParty();
    await memoryRuntime.dispatch({
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: 'eval:one-time-instruction',
      episodeId: 'eval:one-time-instruction',
      occurredAt: '2026-08-24T00:00:00.000Z',
      type: 'user.signal',
      actor: 'user',
      scope: 'user',
      source: { kind: 'user', name: 'eval' },
      context: { task: '只在这一次列三条' },
      signal: {
        kind: 'preference',
        explicit: true,
        longTerm: false,
        text: '只在这一次列三条',
      },
      evidence: [{ id: 'eval:one-time-evidence', kind: 'user', summary: '只在这一次列三条' }],
    });
    const oneTime = (await memory.manage({ projectKey: 'eval-project' })).records.find(
      (record) => record.text === '只在这一次列三条',
    );
    await memory.observe({
      scope: 'project',
      projectKey: 'eval-project',
      projectIdentity: 'eval-project',
      category: '协作习惯',
      text: '收到纠正后先复述理解再修改',
      memoryClass: 'collaboration-habit',
      taskTypes: ['review'],
      workflow: 'native',
      changeId: 'implicit-correction-1',
      candidateKey: 'repeat-correction',
      success: true,
      source: { kind: 'user' },
    });
    const implicit = (await memory.manage({ projectKey: 'eval-project' })).records.find(
      (record) => record.text === '收到纠正后先复述理解再修改',
    );

    const learning = new ProjectKnowledgeLearningService({
      projectRoot,
      provider,
      reviewer: {
        review: (packet) => {
          const type =
            packet.eventName === 'review.resolved'
              ? 'decision'
              : packet.eventName === 'failure.resolved'
                ? 'failure-resolution'
                : null;
          if (type === null) return [];
          const record: ProjectKnowledgeRecord = {
            id: `eval-${type}`,
            projectId: 'eval-project',
            type,
            state: 'trial',
            authority: 'automatic',
            title: type === 'decision' ? 'Review 决策' : '失败解决方案',
            summary:
              type === 'decision'
                ? '领域模块不得直接访问文件系统'
                : 'SQLite 关闭后重新创建 Provider 再检索',
            applicablePaths: ['src/'],
            operations: ['implement'],
            conclusions: [
              {
                text:
                  type === 'decision'
                    ? '领域模块不得直接访问文件系统'
                    : '重新创建 Provider 后再执行检索',
                sources: [{ source: 'src/main.ts' }],
              },
            ],
            relations: [],
            verification: [],
            sourceVersions: [
              {
                source: 'src/main.ts',
                size: sourceStat.size,
                modifiedAt: Math.trunc(sourceStat.mtimeMs),
              },
            ],
            applicationCount: 0,
            successCount: 0,
            failureCount: 0,
            updatedAt: '2026-08-24T00:00:00.000Z',
          };
          return [{ action: 'create' as const, record }];
        },
      },
    });
    await learning.processEvent(projectEvent('review.resolved', 'review-decision'));
    await learning.processEvent(projectEvent('failure.resolved', 'failure-resolution'));
    await learning.processEvent(projectEvent('change.archived', 'archive-reflection'));
    await provider.apply({
      kind: 'upsert',
      record: createUserProjectKnowledgeRecord(
        {
          type: 'constraint',
          title: '提交前验证',
          summary: '提交前必须运行 pnpm test',
          operations: ['commit'],
          verification: [{ command: 'pnpm test', expected: 'pass' }],
        },
        'eval-project',
        '2026-08-24T00:00:00.000Z',
        'eval-project-constraint',
      ),
    });
    await provider.apply({
      kind: 'verify',
      projectId: 'eval-project',
      commands: ['pnpm test'],
      updatedAt: '2026-08-24T00:00:01.000Z',
    });
    const listed = await provider.query({ kind: 'list', state: 'all', limit: 100 });
    const knowledge = listed.kind === 'list' ? listed.records : [];
    return [
      formationCase(
        'explicit-preference',
        'personal-memory',
        'core-profile',
        'proven',
        explicit.memoryType,
        explicit.state,
      ),
      formationCase(
        'implicit-correction',
        'personal-memory',
        'collaboration-policy',
        'trial',
        implicit?.memoryType,
        implicit?.status,
      ),
      formationCase(
        'one-time-instruction',
        'personal-memory',
        'not-persisted',
        'ignored',
        oneTime === undefined ? 'not-persisted' : oneTime.memoryType,
        oneTime === undefined ? 'ignored' : oneTime.status,
      ),
      projectFormationCase('failure-resolution', 'failure-resolution', 'trial', knowledge),
      projectFormationCase('review-decision', 'decision', 'trial', knowledge),
      projectFormationCase('archive-reflection', 'procedure', 'proven', knowledge),
      projectFormationCase('project-constraint', 'constraint', 'enforced', knowledge),
    ];
  } finally {
    provider.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runRetrievalEval(): Promise<AgentLearningRetrievalEvalMetrics> {
  const applications = new MemoryAgentContextApplicationStore();
  const director = new ContextDirector({ applications, defaultCharBudget: 700 });
  const targets = [
    contextCandidate({
      id: 'target-policy',
      memoryType: 'project-policy',
      kind: 'constraint',
      state: 'proven',
      title: '目标约束',
      summary: '提交前运行最小相关测试',
      content: '提交前运行最小相关测试。',
      selectors: { projectId: 'eval-project', operations: ['commit'], tasks: ['提交'] },
    }),
    contextCandidate({
      id: 'target-model',
      memoryType: 'project-model',
      kind: 'topology',
      state: 'proven',
      title: '项目拓扑',
      summary: '领域代码位于 domains 目录',
      content: '领域代码位于 domains 目录。'.repeat(120),
      selectors: { projectId: 'eval-project', paths: ['domains/*'] },
    }),
  ];
  const decoys = [
    contextCandidate({
      id: 'wrong-project',
      title: '其他项目规则',
      selectors: { projectId: 'other-project' },
    }),
    contextCandidate({
      id: 'wrong-operation',
      title: '发布规则',
      selectors: { projectId: 'eval-project', operations: ['publish'] },
    }),
  ];
  const request = {
    task: '提交 domains 修改',
    projectId: 'eval-project',
    path: 'domains/eval/agent-learning-eval.ts',
    operation: 'commit',
    sessionId: 'eval-session-1',
  };
  const selected = await director.select([...targets, ...decoys], request);
  const appliedIds = selected.applications.map((entry) => entry.candidateId);
  const targetIds = targets.map((entry) => entry.id);
  const targetRecall = ratio(
    targetIds.filter((id) => appliedIds.includes(id)).length,
    targetIds.length,
  );
  const falseApplicationRate = ratio(
    appliedIds.filter((id) => decoys.some((entry) => entry.id === id)).length,
    decoys.length,
  );
  const naiveContextBytes = Buffer.byteLength(
    targets.map((entry) => entry.content ?? entry.summary).join('\n'),
    'utf8',
  );
  const injectedContextBytes = Buffer.byteLength(selected.text, 'utf8');

  const rankingDirector = new ContextDirector({
    applications: new MemoryAgentContextApplicationStore(),
  });
  const ranked = [
    contextCandidate({ id: 'policy-a', title: 'A 策略', selectors: { tasks: ['验证'] } }),
    contextCandidate({ id: 'policy-b', title: 'B 策略', selectors: { tasks: ['验证'] } }),
  ];
  const beforeFeedback = await rankingDirector.select(ranked, {
    task: '执行验证',
    sessionId: 'ranking-before',
  });
  await rankingDirector.recordOutcome(
    beforeFeedback.applications[0]!.applicationId,
    'contributed-to-failure',
  );
  const afterFeedback = await rankingDirector.select(ranked, {
    task: '执行验证',
    sessionId: 'ranking-after',
  });
  return {
    targetRecall,
    falseApplicationRate,
    contextSavingsRatio:
      naiveContextBytes === 0 ? 0 : Math.max(0, 1 - injectedContextBytes / naiveContextBytes),
    feedbackRankingChanged:
      beforeFeedback.applications[0]?.candidateId === 'policy-a' &&
      afterFeedback.applications[0]?.candidateId === 'policy-b',
    targetIds,
    appliedIds,
    naiveContextBytes,
    injectedContextBytes,
  };
}

function projectEvent(
  type: 'review.resolved' | 'failure.resolved' | 'change.archived',
  id: string,
): AgentExperienceEvent {
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `eval:${id}`,
    episodeId: `eval:${id}`,
    occurredAt: '2026-08-24T00:00:00.000Z',
    type,
    actor: 'workflow',
    scope: 'project',
    projectId: 'eval-project',
    source: { kind: 'workflow', name: 'native', workflow: 'native', changeId: id },
    context: {
      workflow: 'native',
      changeId: id,
      operation: 'implement',
      paths: ['src/main.ts'],
    },
    evidence: [
      {
        id: `evidence:${id}`,
        kind:
          type === 'review.resolved'
            ? 'review'
            : type === 'failure.resolved'
              ? 'failure'
              : 'source',
        summary:
          type === 'review.resolved'
            ? 'Review finding resolved'
            : type === 'failure.resolved'
              ? 'Failure resolved'
              : 'Archived change completed and verified',
        source: 'src/main.ts',
        success: true,
      },
    ],
    outcome: { status: 'used-successfully' },
  };
}

function contextCandidate(overrides: Partial<AgentContextCandidate> = {}): AgentContextCandidate {
  return {
    id: 'candidate',
    owner: 'project-knowledge',
    scope: 'project',
    memoryType: 'project-policy',
    kind: 'decision',
    state: 'proven',
    authority: 'repository',
    title: '项目策略',
    summary: '遵循当前项目策略',
    content: '遵循当前项目策略。',
    selectors: { projectId: 'eval-project' },
    sources: [{ type: 'repository', source: 'AGENTS.md' }],
    verification: [],
    ...overrides,
  };
}

function projectFormationCase(
  id: AgentLearningFormationCaseId,
  expectedType: string,
  expectedState: 'trial' | 'proven' | 'enforced',
  records: readonly ProjectKnowledgeRecord[],
): AgentLearningFormationEvalCase {
  const record = records.find((entry) => entry.type === expectedType);
  return formationCase(
    id,
    'project-knowledge',
    expectedType,
    expectedState,
    record?.type,
    record?.state,
  );
}

function formationCase(
  id: AgentLearningFormationCaseId,
  owner: AgentLearningFormationEvalCase['owner'],
  expectedType: string,
  expectedState: AgentLearningFormationEvalCase['expectedState'],
  actualType?: string,
  actualState?: string,
): AgentLearningFormationEvalCase {
  return {
    id,
    owner,
    expectedType,
    expectedState,
    ...(actualType === undefined ? {} : { actualType }),
    ...(actualState === undefined ? {} : { actualState }),
    passed: actualType === expectedType && actualState === expectedState,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
