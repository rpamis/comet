import { createHash } from 'node:crypto';
import { hashProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';
import { JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import { resolveProjectWorktreeRoot } from '../../platform/paths/project-worktree-root.js';
import { validateProjectKnowledgeRecordShape } from './records.js';
import type { AgentLearningWait } from '../agent-learning/index.js';
import type {
  ProjectKnowledgeReviewPacket,
  ProjectKnowledgeReviewAction,
  ProjectKnowledgeSemanticReviewer,
} from './learning.js';

interface ReviewRequest {
  id: string;
  packet: ProjectKnowledgeReviewPacket;
  actions?: readonly ProjectKnowledgeReviewAction[];
}

export class ProjectKnowledgeReviewPending extends Error {
  public constructor(readonly waitFor: AgentLearningWait) {
    super('Host Agent review pending: comet knowledge review --json');
  }
}

/** A durable handoff to the Agent already running the workflow. No model credentials. */
export class ProjectKnowledgeHostReview implements ProjectKnowledgeSemanticReviewer {
  private readonly store: JsonFileTextStore;
  private readonly projectId: string;
  private readonly workspaceId: string;
  public constructor(projectPath: string, cacheRoot?: string) {
    this.projectRoot = resolveProjectWorktreeRoot(projectPath);
    const location = resolveProjectKnowledgeStorageLocation(this.projectRoot, cacheRoot);
    this.projectId = location.repositoryId;
    this.workspaceId = location.workspaceId;
    this.store = new JsonFileTextStore(
      path.join(path.dirname(location.databasePath), location.workspaceId, 'host-review.json'),
    );
  }
  private readonly projectRoot: string;
  private async read(): Promise<ReviewRequest[]> {
    return JSON.parse((await this.store.read()) ?? '[]') as ReviewRequest[];
  }
  public async pending(): Promise<readonly ReviewRequest[]> {
    return (await this.read()).filter((entry) => entry.actions === undefined);
  }
  public async review(
    packet: ProjectKnowledgeReviewPacket,
  ): Promise<readonly ProjectKnowledgeReviewAction[]> {
    const id = createHash('sha256').update(JSON.stringify(packet)).digest('hex');
    const actions = await this.store.withLock(async () => {
      const entries = (await this.read()).filter(
        (entry) =>
          entry.id === id ||
          entry.packet.eventName !== packet.eventName ||
          entry.packet.workflow !== packet.workflow ||
          entry.packet.changeId !== packet.changeId ||
          entry.packet.occurredAt !== packet.occurredAt,
      );
      const existing = entries.find((entry) => entry.id === id);
      if (existing) return existing.actions;
      if (entries.filter((entry) => entry.actions === undefined).length >= 64)
        throw new Error('Host review queue is full');
      const retained = entries.filter(
        (entry) => entry.actions === undefined || entries.indexOf(entry) >= entries.length - 64,
      );
      await this.store.write(JSON.stringify([...retained, { id, packet }]));
      return undefined;
    });
    if (actions === undefined)
      throw new ProjectKnowledgeReviewPending({
        kind: 'host-review',
        id,
        workspaceId: this.workspaceId,
      });
    return actions;
  }

  public reviewDependency(id: string): AgentLearningWait {
    return { kind: 'host-review', id, workspaceId: this.workspaceId };
  }
  public async submit(id: string, value: unknown): Promise<void> {
    await this.submitMany([{ id, actions: value }]);
  }

  public async submitMany(submissions: readonly { id: string; actions: unknown }[]): Promise<void> {
    if (
      submissions.length === 0 ||
      submissions.length > 64 ||
      new Set(submissions.map((entry) => entry.id)).size !== submissions.length
    )
      throw new Error('Expected 1 to 64 unique review requests');
    const prepared = submissions.map(({ id, actions }) => ({
      id,
      actions: this.parseActions(actions),
    }));
    await this.store.withLock(async () => {
      const entries = await this.read();
      for (const submission of prepared) {
        const entry = entries.find((candidate) => candidate.id === submission.id);
        if (!entry) throw new Error(`Unknown review request: ${submission.id}`);
        if (submission.actions.length > 0) {
          for (const source of entry.packet.sources) {
            const current = await hashProtectedProjectFile(this.projectRoot, source.source, {
              label: source.source,
            });
            if (current.digest !== source.digest)
              throw new Error(
                'Review sources changed; refresh the pending review before submitting',
              );
          }
        }
        if (
          entry.actions !== undefined &&
          JSON.stringify(entry.actions) !== JSON.stringify(submission.actions)
        )
          throw new Error('Review already submitted');
      }
      for (const submission of prepared) {
        entries.find((candidate) => candidate.id === submission.id)!.actions = submission.actions;
      }
      await this.store.write(JSON.stringify(entries));
    });
  }

  private parseActions(value: unknown): readonly ProjectKnowledgeReviewAction[] {
    if (!Array.isArray(value) || value.length > 16)
      throw new Error('Expected at most 16 review actions');
    return value.map((entry): ProjectKnowledgeReviewAction => {
      if (entry?.action === 'supersede' && typeof entry.recordId === 'string')
        return { action: 'supersede', recordId: entry.recordId };
      if (entry?.action !== 'create' && entry?.action !== 'update')
        throw new Error('Invalid review action');
      return {
        action: entry.action,
        record: validateProjectKnowledgeRecordShape({
          ...entry.record,
          projectId: this.projectId,
          state: 'trial',
          authority: 'automatic',
          applicationCount: 0,
          successCount: 0,
          failureCount: 0,
        }),
      };
    });
  }
}
