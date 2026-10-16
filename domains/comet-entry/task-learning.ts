import { createHash } from 'node:crypto';
import { createDefaultCometPluginBridge } from '../comet-plugin/comet.js';
import type {
  MemoryObservation,
  MemoryLearningCheckKind,
  MemoryLearningStatus,
} from '../comet-memory/index.js';
import {
  ProjectKnowledgeHostReview,
  createProjectKnowledgeReviewPacket,
  readProjectLearningStatus,
  writeProjectMemory,
  type WriteProjectMemoryInput,
} from '../project-knowledge/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import type {
  AgentContextOutcomeEvidence,
  AgentContextOutcomeStatus,
} from '../agent-learning/index.js';

export interface TaskLearningInput {
  readonly schema: 'comet.task-learning.v1';
  readonly personal: {
    readonly check: MemoryLearningCheckKind;
    readonly observations?: readonly Omit<
      MemoryObservation,
      | 'workflow'
      | 'changeId'
      | 'success'
      | 'projectKey'
      | 'projectIdentity'
      | 'explicitRequest'
      | 'source'
    >[];
  };
  readonly project: {
    readonly check: MemoryLearningCheckKind;
    readonly memories?: readonly WriteProjectMemoryInput[];
    readonly memorySlugs?: readonly string[];
    readonly reviews?: readonly { readonly id: string; readonly actions: unknown }[];
  };
  readonly outcomes?: readonly {
    readonly applicationId: string;
    readonly outcome: AgentContextOutcomeStatus;
    readonly evidence?: AgentContextOutcomeEvidence;
  }[];
}

export interface TaskLearningSubmission {
  readonly status: 'applied' | 'partial' | 'accepted';
  readonly personalCheck: MemoryLearningCheckKind;
  readonly projectCheck: MemoryLearningCheckKind;
  readonly memorySlugs: readonly string[];
  readonly personalVerified: boolean;
  readonly projectLearning: Awaited<ReturnType<typeof readProjectLearningStatus>>;
  readonly errors: readonly {
    readonly section: string;
    readonly index: number;
    readonly message: string;
  }[];
  readonly personalObservations: readonly {
    readonly index: number;
    readonly result: string;
    readonly reason?: string;
  }[];
  readonly nextActions: readonly string[];
}

export function parseTaskLearningInput(value: unknown): TaskLearningInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('任务学习文件必须是 JSON 对象');
  const input = value as TaskLearningInput;
  const keys = (object: object, allowed: readonly string[], label: string): void => {
    for (const key of Object.keys(object))
      if (!allowed.includes(key)) throw new Error(`${label} 不支持字段 ${key}`);
  };
  keys(input, ['schema', 'personal', 'project', 'outcomes'], '任务学习文件');
  if (input.schema !== 'comet.task-learning.v1')
    throw new Error('任务学习文件 schema 必须为 comet.task-learning.v1');
  for (const section of ['personal', 'project'] as const) {
    if (
      !input[section] ||
      !['submitted', 'no-observation', 'not-run'].includes(input[section].check)
    ) {
      throw new Error(`${section}.check 必须显式填写 submitted、no-observation 或 not-run`);
    }
  }
  keys(input.personal, ['check', 'observations'], 'personal');
  keys(input.project, ['check', 'memories', 'memorySlugs', 'reviews'], 'project');
  const arrays = [
    input.personal.observations,
    input.project.memories,
    input.project.memorySlugs,
    input.project.reviews,
    input.outcomes,
  ];
  for (const entries of arrays) {
    if (entries !== undefined && (!Array.isArray(entries) || entries.length > 16))
      throw new Error('任务学习文件每类最多提交 16 项');
  }
  if (input.personal.check !== 'submitted' && input.personal.observations?.length)
    throw new Error('个人观察需要 personal.check 为 submitted');
  if (
    input.project.check !== 'submitted' &&
    (input.project.memories?.length || input.project.memorySlugs?.length)
  )
    throw new Error('项目经验需要 project.check 为 submitted');
  if (input.project.memorySlugs?.some((slug) => typeof slug !== 'string' || !slug.trim()))
    throw new Error('memorySlugs 必须为非空字符串');
  for (const observation of input.personal.observations ?? []) {
    if (
      !observation ||
      !['project', 'global'].includes(observation.scope) ||
      typeof observation.text !== 'string' ||
      !observation.text.trim()
    )
      throw new Error('个人观察必须包含 scope 和 text');
    if (typeof observation.category !== 'string' || !observation.category.trim())
      throw new Error('个人观察必须包含 category');
    keys(
      observation,
      [
        'scope',
        'memoryType',
        'memoryClass',
        'category',
        'text',
        'title',
        'reason',
        'tags',
        'pathPatterns',
        'taskTypes',
        'operations',
        'phases',
        'evidence',
        'episode',
        'language',
        'candidateKey',
        'observedAt',
        'userEvidence',
      ],
      '个人观察',
    );
  }
  for (const memory of input.project.memories ?? []) {
    if (
      !memory ||
      typeof memory.title !== 'string' ||
      !memory.title.trim() ||
      typeof memory.text !== 'string' ||
      !memory.text.trim()
    )
      throw new Error('项目经验必须包含 title 和 text');
    keys(
      memory,
      ['title', 'text', 'type', 'description', 'slug', 'paths', 'source', 'evidence'],
      '项目经验',
    );
  }
  for (const review of input.project.reviews ?? []) {
    if (!review || typeof review.id !== 'string' || !Array.isArray(review.actions))
      throw new Error('项目评审必须包含 id 和 actions 数组');
    if (input.project.check !== 'submitted' && review.actions.length > 0)
      throw new Error('产生项目知识的评审需要 project.check 为 submitted');
  }
  for (const outcome of input.outcomes ?? []) {
    if (
      !outcome ||
      typeof outcome.applicationId !== 'string' ||
      ![
        'used-successfully',
        'ignored',
        'overridden',
        'corrected',
        'contributed-to-failure',
      ].includes(outcome.outcome)
    )
      throw new Error('使用反馈必须包含 applicationId 和有效 outcome');
    if (
      outcome.outcome === 'used-successfully' &&
      (!outcome.evidence?.decision?.trim() || outcome.evidence.verification?.success !== true)
    )
      throw new Error('成功使用反馈必须附带实际采用决定和通过的验证证据');
  }
  return input;
}

/** Submit task learning through existing owners; retries reuse their identities and receipts. */
export async function submitTaskLearning(options: {
  readonly projectRoot: string;
  readonly workflow: string;
  readonly change: string;
  readonly input: unknown;
  readonly homeDirectory?: string;
  readonly cacheRoot?: string;
}): Promise<TaskLearningSubmission> {
  const input = parseTaskLearningInput(options.input);
  if (!options.workflow.trim() || !options.change.trim())
    throw new Error('任务学习需要 workflow 和 change');
  const projectId = resolveStableProjectId(options.projectRoot);
  const bridge = await createDefaultCometPluginBridge({
    projectRoot: options.projectRoot,
    projectId,
    homeDirectory: options.homeDirectory,
    knowledgeCacheRoot: options.cacheRoot,
    scheduleLearning: (task) => task(),
  });
  const errors: { section: string; index: number; message: string }[] = [];
  const attempt = async (
    section: string,
    index: number,
    run: () => Promise<void>,
  ): Promise<void> => {
    try {
      await run();
    } catch (error) {
      errors.push({
        section,
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  let deferred = false;
  const personalObservations: { index: number; result: string; reason?: string }[] = [];
  const memorySlugs = [...new Set(input.project.memorySlugs ?? [])];
  for (const [index, outcome] of (input.outcomes ?? []).entries()) {
    await attempt('outcomes', index, () =>
      bridge.recordContextOutcome(outcome.applicationId, outcome.outcome, outcome.evidence),
    );
  }
  for (const [index, observation] of (input.personal.observations ?? []).entries()) {
    await attempt('personal.observations', index, async () => {
      const result = await bridge.observeMemory({
        ...observation,
        workflow: options.workflow,
        changeId: options.change,
        success: true,
        projectIdentity: projectId,
        ...(observation.scope === 'project' ? { projectKey: projectId } : {}),
      });
      deferred ||= result.deferred === true;
      const observationResult =
        result.observation ?? result.results?.find((entry) => entry.observation)?.observation;
      personalObservations.push({
        index,
        result: result.deferred ? 'deferred' : (observationResult?.result ?? result.action),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
    });
  }
  for (const [index, memory] of (input.project.memories ?? []).entries()) {
    await attempt('project.memories', index, async () => {
      const result = await writeProjectMemory(
        options.projectRoot,
        {
          ...memory,
          workflow: options.workflow,
          change: options.change,
        },
        { cacheRoot: options.cacheRoot },
      );
      if (!memorySlugs.includes(result.slug)) memorySlugs.push(result.slug);
    });
  }
  if (input.project.reviews?.length) {
    await attempt('project.reviews', 0, async () => {
      const review = new ProjectKnowledgeHostReview(options.projectRoot, options.cacheRoot);
      await review.submitMany(input.project.reviews!, {
        workflow: options.workflow,
        changeId: options.change,
      });
      for (const { id } of input.project.reviews!) {
        await bridge.pluginRuntime.resumeReview(review.reviewDependency(id), async (event) => {
          const packet = await createProjectKnowledgeReviewPacket(event, {
            projectRoot: options.projectRoot,
          });
          return (
            packet !== null &&
            createHash('sha256').update(JSON.stringify(packet)).digest('hex') === id
          );
        });
      }
    });
  }
  let personal: MemoryLearningStatus | undefined;
  await attempt('personal.check', 0, async () => {
    personal = await bridge.recordMemoryLearningCheck(input.personal.check, {
      projectKey: projectId,
      workflow: options.workflow,
      changeId: options.change,
    });
  });
  let projectLearning: Awaited<ReturnType<typeof readProjectLearningStatus>> = {
    check: input.project.check,
    submissionVerified: false,
    memories: [],
    pendingHostReviewCount: 0,
    pendingReflectionCount: 0,
    pendingReviews: [],
    unavailable: true,
    nextActions: ['项目学习状态不可用；保留本次回执，恢复后重交同一学习文件核对。'],
  };
  await attempt('project.check', 0, async () => {
    projectLearning = await readProjectLearningStatus(options.projectRoot, {
      workflow: options.workflow,
      change: options.change,
      check: input.project.check,
      memorySlugs,
      cacheRoot: options.cacheRoot,
      homeDirectory: options.homeDirectory,
    });
  });
  const nextActions = [...projectLearning.nextActions];
  if (personal?.submissionVerified !== true)
    nextActions.push(
      '个人学习检查尚未核验：读取 personalObservations 的结果和原因；有有效观察使用 submitted，确认没有合格观察时移除观察并声明 no-observation，未检查时保留 not-run。不要创建占位记忆。',
    );
  for (const error of errors)
    nextActions.push(
      `修正 ${error.section}[${error.index}] 后重交同一学习文件；已成功的回执会复用。`,
    );
  return {
    status:
      errors.length > 0
        ? 'partial'
        : deferred || !personal?.submissionVerified || !projectLearning.submissionVerified
          ? 'accepted'
          : 'applied',
    personalCheck: input.personal.check,
    projectCheck: input.project.check,
    memorySlugs,
    personalVerified: personal?.submissionVerified === true,
    projectLearning,
    errors,
    personalObservations,
    nextActions,
  };
}
