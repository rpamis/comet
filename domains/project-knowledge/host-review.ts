import { createHash } from 'node:crypto';
import { hashProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';
import { JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import { validateProjectKnowledgeRecordShape } from './records.js';
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

/** A durable handoff to the Agent already running the workflow. No model credentials. */
export class ProjectKnowledgeHostReview implements ProjectKnowledgeSemanticReviewer {
  private readonly store: JsonFileTextStore;
  private readonly projectId: string;
  public constructor(
    private readonly projectRoot: string,
    cacheRoot?: string,
  ) {
    const location = resolveProjectKnowledgeStorageLocation(projectRoot, cacheRoot);
    this.projectId = location.repositoryId;
    this.store = new JsonFileTextStore(
      path.join(path.dirname(location.databasePath), location.workspaceId, 'host-review.json'),
    );
  }
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
      throw new Error('Host Agent review pending: comet knowledge review --json');
    return actions;
  }
  public async submit(id: string, value: unknown): Promise<void> {
    if (!Array.isArray(value) || value.length > 16)
      throw new Error('Expected at most 16 review actions');
    const actions = value.map((entry): ProjectKnowledgeReviewAction => {
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
    await this.store.withLock(async () => {
      const entries = await this.read();
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error('Unknown review request');
      if (actions.length > 0) {
        for (const source of entry.packet.sources) {
          const current = await hashProtectedProjectFile(this.projectRoot, source.source, {
            label: source.source,
          });
          if (current.digest !== source.digest)
            throw new Error('Review sources changed; refresh the pending review before submitting');
        }
      }
      if (entry.actions !== undefined && JSON.stringify(entry.actions) !== JSON.stringify(actions))
        throw new Error('Review already submitted');
      entry.actions = actions;
      await this.store.write(JSON.stringify(entries));
    });
  }
}
