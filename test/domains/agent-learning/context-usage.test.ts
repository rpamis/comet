import { describe, expect, test } from 'vitest';
import { ContextUsageTracker } from '../../../domains/agent-learning/index.js';

function fixture() {
  let value: unknown = null;
  const storage = {
    read: async () => structuredClone(value),
    write: async (next: unknown) => {
      value = structuredClone(next);
    },
  };
  let time = new Date('2026-10-16T08:00:00Z');
  return {
    tracker: new ContextUsageTracker(storage, () => time),
    storage,
    advance: (days: number) => {
      time = new Date(time.getTime() + days * 86400000);
    },
  };
}

const owner = 'comet.personal-memory';
const request = {
  task: '修复登录页面',
  projectId: 'project-a',
  phase: 'build',
  sessionId: 'session-a',
};

describe('task context usage', () => {
  test('retains zero-result requests, merges scopes, and excludes another project', async () => {
    const { tracker } = fixture();
    await tracker.record({
      request,
      episodeId: 'zero',
      samples: [
        { owner, elapsedMs: 20, status: 'ok' },
        { owner, elapsedMs: 30, status: 'ok' },
      ],
      candidates: [],
      applications: [],
    });
    await tracker.record({
      request,
      episodeId: 'hit',
      samples: [{ owner, elapsedMs: 45, status: 'ok' }],
      candidates: [{ owner, id: 'm1' }],
      applications: [],
    });
    await tracker.record({
      request: { ...request, projectId: 'project-b' },
      episodeId: 'other',
      samples: [{ owner, elapsedMs: 10, status: 'ok' }],
      candidates: [],
      applications: [],
    });
    const snapshot = await tracker.snapshot(owner, 'project-a', []);
    expect(snapshot.requests).toBe(2);
    expect(snapshot.hits).toBe(1);
    expect(snapshot.p95Ms).toBe(45);
    expect(snapshot.recentTasks).toHaveLength(2);
    expect(snapshot.recentTasks.find((row) => row.episodeId === 'zero')?.candidateCount).toBe(0);
    expect(snapshot.feedbackRate).toBeNull();
  });

  test('counts manifest expansion once and keeps adoption distinct from delivery', async () => {
    const { tracker } = fixture();
    const application = {
      applicationId: 'a1',
      candidateId: 'm1',
      owner,
      projectId: 'project-a',
      delivery: 'manifest',
      appliedAt: '2026-10-16T08:00:00Z',
      candidateTitle: '先复现',
      whyApplied: '适用于修复',
      outcome: undefined,
    } as const;
    await tracker.record({
      request,
      episodeId: 'hit',
      samples: [{ owner, elapsedMs: 25, status: 'ok' }],
      candidates: [{ owner, id: 'm1' }],
      applications: [application],
    });
    const before = await tracker.snapshot(owner, 'project-a', [application]);
    expect(before.fullDeliveries).toBe(0);
    expect(before.feedbackRate).toBe(0);
    expect(before.successRate).toBeNull();
    await tracker.recordExpansion(request, owner, 'm1', '先复现');
    await tracker.recordExpansion(request, owner, 'm1', '先复现');
    const after = await tracker.snapshot(owner, 'project-a', [
      { ...application, outcome: 'used-successfully' },
    ]);
    expect(after.requests).toBe(1);
    expect(after.fullDeliveries).toBe(1);
    expect(after.feedbackRate).toBe(1);
    expect(after.successes).toBe(1);
    expect(after.recentTasks[0].items[0]).toMatchObject({
      delivery: 'full',
      outcome: 'used-successfully',
    });
  });

  test('does not count ignored feedback as a failed adoption, and expires old requests', async () => {
    const { tracker, advance } = fixture();
    const application = {
      applicationId: 'a1',
      candidateId: 'm1',
      owner,
      projectId: 'project-a',
      delivery: 'full',
      candidateTitle: '偏好',
      appliedAt: '2026-10-16T08:00:00Z',
      outcome: 'ignored',
    } as const;
    await tracker.record({
      request,
      episodeId: 'one',
      samples: [{ owner, elapsedMs: 12, status: 'partial' }],
      candidates: [{ owner, id: 'm1' }],
      applications: [application],
    });
    const snapshot = await tracker.snapshot(owner, 'project-a', [application]);
    expect(snapshot.successRate).toBeNull();
    expect(snapshot.ignored).toBe(1);
    expect(snapshot.limitedRequests).toBe(1);
    advance(8);
    const expired = await tracker.snapshot(owner, 'project-a', [application]);
    expect(expired.requests).toBe(0);
    expect(expired.hitRate).toBeNull();
    expect(expired.recentTasks).toEqual([]);
  });

  test('bounds history, marks truncation, and deduplicates a persisted request retry', async () => {
    const { tracker, storage } = fixture();
    for (let index = 0; index < 505; index++)
      await tracker.record({
        request,
        episodeId: `r${index}`,
        samples: [{ owner, elapsedMs: 1, status: 'ok' }],
        candidates: [],
        applications: [],
      });
    await tracker.record({
      request,
      episodeId: 'r504',
      samples: [{ owner, elapsedMs: 1, status: 'ok' }],
      candidates: [],
      applications: [],
    });
    const reopened = new ContextUsageTracker(storage, () => new Date('2026-10-16T08:00:00Z'));
    const snapshot = await reopened.snapshot(owner, 'project-a', []);
    expect(snapshot.requests).toBe(500);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.recentTasks.length).toBeLessThanOrEqual(10);
  });

  test('dates expansion at actual delivery rather than the old collection request', async () => {
    const { tracker, advance } = fixture();
    await tracker.record({
      request,
      episodeId: 'old',
      samples: [{ owner, elapsedMs: 1, status: 'ok' }],
      candidates: [],
      applications: [],
    });
    advance(8);
    await tracker.recordExpansion(request, owner, 'm1', 'Late expansion');
    const snapshot = await tracker.snapshot(owner, 'project-a', []);
    expect(snapshot.requests).toBe(0);
    expect(snapshot.fullDeliveries).toBe(1);
    expect(snapshot.recentTasks).toHaveLength(1);
    expect(snapshot.recentTasks[0].counted).toBe(false);
  });

  test('marks omitted items and never borrows another project feedback', async () => {
    const { tracker } = fixture();
    const applications = Array.from({ length: 25 }, (_, index) => ({
      applicationId: `a${index}`,
      candidateId: `m${index}`,
      owner,
      scope: 'user' as const,
      delivery: 'manifest' as const,
      appliedAt: '2026-10-16T08:00:00Z',
    }));
    await tracker.record({
      request,
      episodeId: 'many',
      samples: [{ owner, elapsedMs: 1, status: 'ok' }],
      candidates: [],
      applications,
    });
    const snapshot = await tracker.snapshot(owner, 'project-a', [
      {
        ...applications[0],
        scope: 'project',
        projectId: 'project-b',
        outcome: 'used-successfully',
      },
    ]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.feedbackCount).toBe(0);
    expect(snapshot.recommendations).toBe(24);
  });

  test('stores application references instead of duplicating titles and matching explanations', async () => {
    const { tracker, storage } = fixture();
    const application = {
      applicationId: 'a1',
      candidateId: 'm1',
      owner,
      scope: 'user' as const,
      delivery: 'full' as const,
      appliedAt: '2026-10-16T08:00:00Z',
      candidateTitle: 'An immutable application title',
      whyApplied: 'The current stage matches this established preference.',
    };
    await tracker.record({
      request,
      episodeId: 'reference',
      samples: [{ owner, elapsedMs: 1, status: 'ok' }],
      candidates: [],
      applications: [application],
    });
    expect(JSON.stringify(await storage.read())).not.toContain(application.whyApplied);
    expect(JSON.stringify(await storage.read())).not.toContain(application.candidateTitle);
    const snapshot = await tracker.snapshot(owner, 'project-a', [application]);
    expect(snapshot.recentTasks[0].items[0]).toMatchObject({
      title: application.candidateTitle,
      whyApplied: application.whyApplied,
    });
  });
});
