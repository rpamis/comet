import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/integration.js';
import { LocalProjectKnowledgeProvider } from '../../../domains/project-knowledge/local-provider.js';
import { ProjectKnowledgeLearningService } from '../../../domains/project-knowledge/learning.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  type AgentExperienceEvent,
} from '../../../domains/agent-learning/index.js';
import { expect, test } from 'vitest';
import { ProjectKnowledgeHostReview } from '../../../domains/project-knowledge/host-review.js';
import type { ProjectKnowledgeReviewPacket } from '../../../domains/project-knowledge/learning.js';

test('durably hands bounded evidence to the host and accepts an idempotent no-lesson review', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-host-review-'));
  try {
    const packet: ProjectKnowledgeReviewPacket = {
      eventName: 'change.archived',
      workflow: 'native',
      changeId: 'demo',
      success: true,
      occurredAt: '2026-09-05T00:00:00Z',
      sources: [],
      changedHint: {
        eventName: 'change.archived',
        workflow: 'native',
        changeId: 'demo',
        success: true,
        changedPaths: [],
        artifactRefs: [],
        verificationCommands: [],
        verificationResults: [],
      },
    };
    const queue = new ProjectKnowledgeHostReview(root, root);
    await expect(queue.review(packet)).rejects.toThrow('Host Agent review pending');
    const reopened = new ProjectKnowledgeHostReview(root, root);
    const pending = await reopened.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].packet).toEqual(packet);
    await expect(
      reopened.submit(pending[0].id, [{ action: 'execute', command: 'arbitrary' }]),
    ).rejects.toThrow('Invalid review action');
    await reopened.submit(pending[0].id, []);
    await reopened.submit(pending[0].id, []);
    await expect(queue.review(packet)).resolves.toEqual([]);
    await expect(queue.pending()).resolves.toEqual([]);
    await expect(
      new ProjectKnowledgeHostReview(path.join(root, 'other-workspace'), root).pending(),
    ).resolves.toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('applies a host-reviewed lesson as trial and promotes it only after successful use', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-host-review-learning-'));
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: root,
    cacheRoot: root,
    corpus: [],
  });
  try {
    const text = '# Retry policy\n\nRetry only transient transport failures.\n';
    await fs.writeFile(path.join(root, 'README.md'), text);
    const projectId = resolveStableProjectId(root);
    const event: AgentExperienceEvent = {
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: 'host-review-event',
      episodeId: 'host-review-episode',
      occurredAt: '2026-09-05T00:00:00Z',
      type: 'change.archived',
      actor: 'workflow',
      scope: 'project',
      projectId,
      source: { kind: 'workflow', name: 'native', workflow: 'native', changeId: 'retry' },
      context: { workflow: 'native', changeId: 'retry', paths: ['README.md'] },
      evidence: [{ id: 'readme', kind: 'source', summary: 'Retry policy', source: 'README.md' }],
      outcome: { status: 'used-successfully', summary: 'Retry handling verified' },
    };
    const queue = new ProjectKnowledgeHostReview(root, root);
    const learning = new ProjectKnowledgeLearningService({
      projectRoot: root,
      provider,
      reviewer: queue,
    });
    expect(await learning.reflectEvent(event)).toMatchObject({ deferred: true });
    const [request] = await queue.pending();
    expect(request.packet.sources[0].text).toBe(text);
    const stat = await fs.stat(path.join(root, 'README.md'));
    await queue.submit(request.id, [
      {
        action: 'create',
        record: {
          id: 'retry-policy',
          projectId,
          type: 'pattern',
          state: 'proven',
          authority: 'automatic',
          title: 'Retry transient failures',
          summary: 'Retry only transient transport failures.',
          applicablePaths: [],
          operations: [],
          conclusions: [
            {
              text: 'Retry only transient transport failures.',
              sources: [{ source: 'README.md' }],
            },
          ],
          relations: [],
          verification: [],
          sourceVersions: [
            {
              source: 'README.md',
              size: stat.size,
              modifiedAt: Math.floor(stat.mtimeMs),
              digest: createHash('sha256').update(text).digest('hex'),
            },
          ],
          applicationCount: 0,
          successCount: 0,
          failureCount: 0,
          updatedAt: event.occurredAt,
        },
      },
    ]);
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId,
      homeDirectory: path.join(root, 'home'),
      stateRoot: path.join(root, 'plugins'),
      knowledgeCacheRoot: root,
      scheduleLearning: async (task) => task(),
    });
    await bridge.dispatchExperience(event);
    await bridge.collectContext({ task: 'Retry transient transport failures' });
    expect(await provider.query({ kind: 'get', id: 'retry-policy' })).toMatchObject({
      record: { state: 'trial', successCount: 0 },
    });
    await provider.apply({ kind: 'refresh', projectId, id: 'retry-policy' });
    expect(await provider.query({ kind: 'get', id: 'retry-policy' })).toMatchObject({
      record: { state: 'trial' },
    });
    await provider.apply({
      kind: 'feedback',
      projectId,
      id: 'retry-policy',
      outcome: 'used-successfully',
      updatedAt: '2026-09-05T01:00:00Z',
    });
    expect(await provider.query({ kind: 'get', id: 'retry-policy' })).toMatchObject({
      record: { state: 'proven', successCount: 1 },
    });
  } finally {
    provider.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
