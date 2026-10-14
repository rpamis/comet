import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  readProjectLearningStatus,
  writeProjectMemory,
  ProjectKnowledgeHostReview,
} from '../../../domains/project-knowledge/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  StorageAgentExperienceJournalStore,
} from '../../../domains/agent-learning/index.js';
import { JsonFilePluginStorageStore } from '../../../platform/fs/plugin-store.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-learning-'));
  const project = path.join(base, 'project');
  const homeDirectory = path.join(base, 'home');
  const cacheRoot = path.join(base, 'cache');
  await fs.mkdir(project);
  return { base, project, homeDirectory, cacheRoot };
}

test('verifies actual current-change memory receipts and rejects old or changed-source receipts', async () => {
  const { base, project, homeDirectory, cacheRoot } = await fixture();
  try {
    await fs.writeFile(path.join(project, 'retry.ts'), 'retry(1);');
    const saved = await writeProjectMemory(
      project,
      {
        title: 'Retry once',
        text: 'One retry is sufficient.',
        workflow: 'native',
        change: 'current',
        evidence: ['retry.ts'],
      },
      { cacheRoot },
    );
    const request = {
      workflow: 'native',
      change: 'current',
      check: 'submitted' as const,
      memorySlugs: [saved.slug],
      homeDirectory,
      cacheRoot,
    };
    expect((await readProjectLearningStatus(project, request)).submissionVerified).toBe(true);
    const old = await readProjectLearningStatus(project, { ...request, change: 'another' });
    expect(old.submissionVerified).toBe(false);
    expect(old.memories).toEqual([
      { slug: saved.slug, verified: false, reason: 'different-change' },
    ]);
    await fs.unlink(path.join(project, 'retry.ts'));
    const stale = await readProjectLearningStatus(project, request);
    expect(stale.submissionVerified).toBe(false);
    expect(stale.memories).toEqual([
      { slug: saved.slug, verified: false, reason: 'source-changed' },
    ]);
    expect(stale.nextActions.some((action) => action.includes('--evidence'))).toBe(true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('keeps no-observation separate from not-run and from lessons already saved in this change', async () => {
  const { base, project, homeDirectory, cacheRoot } = await fixture();
  try {
    const request = { workflow: 'native', change: 'current', homeDirectory, cacheRoot };
    expect(
      (await readProjectLearningStatus(project, { ...request, check: 'not-run' }))
        .submissionVerified,
    ).toBe(false);
    expect(
      (await readProjectLearningStatus(project, { ...request, check: 'no-observation' }))
        .submissionVerified,
    ).toBe(true);
    await writeProjectMemory(
      project,
      {
        title: 'Lesson',
        text: 'Use the verified procedure.',
        workflow: 'native',
        change: 'current',
      },
      { cacheRoot },
    );
    expect(
      (await readProjectLearningStatus(project, { ...request, check: 'no-observation' }))
        .submissionVerified,
    ).toBe(false);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('does not claim that accepting review actions has applied the waiting learning event', async () => {
  const { base, project, homeDirectory, cacheRoot } = await fixture();
  try {
    const queue = new ProjectKnowledgeHostReview(project, cacheRoot);
    const occurredAt = '2026-10-14T10:00:00Z';
    const packet = {
      eventName: 'change.archived',
      workflow: 'native',
      changeId: 'current',
      success: true,
      occurredAt,
      sources: [],
      changedHint: {
        eventName: 'change.archived',
        workflow: 'native',
        changeId: 'current',
        success: true,
        changedPaths: [],
        artifactRefs: [],
        verificationCommands: [],
        verificationResults: [],
      },
    };
    await expect(queue.review(packet)).rejects.toThrow('pending');
    await expect(queue.review({ ...packet, changeId: 'other' })).rejects.toThrow('pending');
    const current = (await queue.pending()).find(({ packet }) => packet.changeId === 'current')!;
    const projectId = resolveStableProjectId(project);
    const storage = new JsonFilePluginStorageStore(
      path.join(homeDirectory, '.comet/plugins/storage'),
    );
    const journal = new StorageAgentExperienceJournalStore(
      await storage.open('comet.agent-learning', 'project', projectId),
    );
    const event = {
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: 'event-current',
      episodeId: 'current',
      occurredAt,
      type: 'change.archived' as const,
      actor: 'workflow' as const,
      scope: 'project' as const,
      projectId,
      source: {
        kind: 'workflow' as const,
        name: 'native',
        workflow: 'native',
        changeId: 'current',
      },
      context: { workflow: 'native', changeId: 'current' },
      evidence: [],
    };
    await journal.write({
      version: 2,
      events: [event],
      reflections: {
        'event-current': {
          status: 'waiting',
          attempts: 1,
          updatedAt: occurredAt,
          waitFor: [queue.reviewDependency(current.id)],
        },
      },
    });
    const request = {
      workflow: 'native',
      change: 'current',
      check: 'no-observation' as const,
      homeDirectory,
      cacheRoot,
    };
    const pending = await readProjectLearningStatus(project, request);
    expect(pending.pendingHostReviewCount).toBe(1);
    await queue.submit(current.id, []);
    const accepted = await readProjectLearningStatus(project, request);
    expect(accepted.pendingHostReviewCount).toBe(0);
    expect(accepted.pendingReflectionCount).toBe(1);
    expect(accepted.submissionVerified).toBe(false);
    await journal.write({
      version: 2,
      events: [event],
      reflections: { 'event-current': { status: 'processed', attempts: 1, updatedAt: occurredAt } },
    });
    const applied = await readProjectLearningStatus(project, request);
    expect(applied.pendingReflectionCount).toBe(0);
    expect(applied.submissionVerified).toBe(true);
    expect(await queue.pending()).toHaveLength(1);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
