import { ProjectKnowledgeHostReview } from './host-review.js';
import { readProjectMemory, readProjectMemoryEntries } from './project-memory.js';
import os from 'node:os';
import path from 'node:path';
import { StorageAgentExperienceJournalStore } from '../agent-learning/index.js';
import { JsonFilePluginStorageStore } from '../../platform/fs/plugin-store.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export type ProjectLearningCheck = 'submitted' | 'no-observation' | 'not-run';

export interface ProjectLearningRequest {
  readonly workflow: string;
  readonly change: string;
  readonly check: ProjectLearningCheck;
  readonly memorySlugs?: readonly string[];
  readonly cacheRoot?: string;
  readonly homeDirectory?: string;
}

export interface ProjectLearningStatus {
  readonly check: ProjectLearningCheck;
  readonly submissionVerified: boolean;
  readonly memories: readonly {
    slug: string;
    verified: boolean;
    reason?: 'missing' | 'different-change' | 'source-changed';
  }[];
  readonly pendingHostReviewCount: number;
  readonly pendingReflectionCount: number;
  readonly pendingReviews: readonly { id: string; eventName: string }[];
  readonly nextActions: readonly string[];
  readonly unavailable?: boolean;
}

/** Report this change's learning evidence without advancing or replaying learning. */
export async function readProjectLearningStatus(
  projectRoot: string,
  request: ProjectLearningRequest,
): Promise<ProjectLearningStatus> {
  const slugs = [...new Set(request.memorySlugs ?? [])];
  if (slugs.length > 16) throw new Error('一次项目学习检查最多核对 16 条记忆');
  const memories: Array<ProjectLearningStatus['memories'][number]> = [];
  for (const slug of slugs) {
    const entry = await readProjectMemory(projectRoot, slug, request.cacheRoot);
    const reason =
      entry === null
        ? 'missing'
        : entry.workflow !== request.workflow || entry.change !== request.change
          ? 'different-change'
          : entry.sourceStatus === 'changed'
            ? 'source-changed'
            : undefined;
    memories.push({
      slug,
      verified: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
    });
  }
  const pendingReviews = (
    await new ProjectKnowledgeHostReview(projectRoot, request.cacheRoot).pending()
  )
    .filter(
      ({ packet }) => packet.workflow === request.workflow && packet.changeId === request.change,
    )
    .map(({ id, packet }) => ({ id, eventName: packet.eventName }));
  const storage = new JsonFilePluginStorageStore(
    path.join(request.homeDirectory ?? os.homedir(), '.comet/plugins/storage'),
    { timeoutMs: 750 },
  );
  const journal = await new StorageAgentExperienceJournalStore(
    await storage.open('comet.agent-learning', 'project', resolveStableProjectId(projectRoot)),
  ).read();
  const eventTypes = new Set([
    'verification.completed',
    'review.resolved',
    'failure.resolved',
    'change.archived',
    'repository.changed',
    'context.outcome',
  ]);
  const pendingReflectionCount = journal.events.filter((event) => {
    if (
      !eventTypes.has(event.type) ||
      (event.context.workflow ?? event.source.workflow) !== request.workflow ||
      (event.context.changeId ?? event.source.changeId) !== request.change
    )
      return false;
    const reflection = journal.reflections[event.eventId];
    return (
      reflection?.status !== 'processed' &&
      !reflection?.completedOwners?.includes('comet.project-knowledge')
    );
  }).length;
  const saved = (await readProjectMemoryEntries(projectRoot, request.cacheRoot)).filter(
    (entry) => entry.workflow === request.workflow && entry.change === request.change,
  );
  const submissionVerified =
    pendingReviews.length === 0 &&
    pendingReflectionCount === 0 &&
    (request.check === 'submitted'
      ? memories.length > 0 && memories.every((entry) => entry.verified)
      : request.check === 'no-observation'
        ? saved.length === 0
        : false);
  const nextActions: string[] = [];
  if (memories.some((entry) => entry.reason === 'source-changed'))
    nextActions.push(
      '来源已变化或不可读取：重新核验当前文件与结论，更新记忆时传 --evidence <来源文件> 重新绑定内容；不再适用的经验用 comet knowledge forget --memory <slug> 删除。',
    );
  if (pendingReviews.length > 0)
    nextActions.push(
      '运行 comet knowledge review <project-root> --workflow <workflow> --change <change-id> --json；由 Agent 读取证据、提交有依据的评审动作，无可复用经验时提交 []，并确认 submission.status 为 applied。用户无需编写 JSON。',
    );
  if (pendingReflectionCount > 0 && pendingReviews.length === 0)
    nextActions.push(
      '本次 change 仍有项目学习记录未应用；核对该 change 的评审提交回执和学习错误，不能把 accepted 当作 applied，也不要在启动检索或 Hook 中重放历史队列。',
    );
  if (!submissionVerified)
    nextActions.push(
      '核对本次项目经验：有可复用经验时用 comet knowledge remember 绑定 --workflow 和 --change，并用返回的 slug 提交 --project-learning-check submitted --memory <slug>；无可复用经验时提交 no-observation，未检查时保留 not-run。',
    );
  return {
    check: request.check,
    submissionVerified,
    memories,
    pendingHostReviewCount: pendingReviews.length,
    pendingReflectionCount,
    pendingReviews,
    nextActions,
  };
}
