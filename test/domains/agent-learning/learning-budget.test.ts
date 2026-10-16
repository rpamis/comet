import { expect, test } from 'vitest';
import {
  AgentExperienceJournal,
  MemoryAgentExperienceJournalStore,
  AgentLearningCoordinator,
} from '../../../domains/agent-learning/index.js';
import {
  operationSignal,
  withOperationBudget,
} from '../../../platform/process/operation-budget.js';

test('releases an interrupted reflection without consuming retries or losing observations', async () => {
  const storage = new MemoryAgentExperienceJournalStore();
  const journal = new AgentExperienceJournal(storage);
  await journal.captureMany([
    {
      schema: 'comet.agent-experience.v1',
      eventId: 'one',
      episodeId: 'episode',
      occurredAt: new Date().toISOString(),
      type: 'episode.completed',
      actor: 'workflow',
      scope: 'user',
      source: { kind: 'system', name: 'test' },
      context: {},
      evidence: [],
    },
  ]);
  let reflected = 0;
  const coordinator = new AgentLearningCoordinator({
    journal,
    schedule: (task) => task(),
    learners: [
      {
        owner: 'test',
        supports: () => true,
        reflect: async () => {
          reflected++;
          await new Promise<void>((resolve) =>
            operationSignal()!.addEventListener('abort', () => resolve(), { once: true }),
          );
          return [];
        },
        consolidate: async () => {
          throw new Error('must not consolidate canceled work');
        },
      },
    ],
  });
  await withOperationBudget({ timeoutMs: 40 }, () => coordinator.replayPending());
  expect(reflected).toBe(1);
  expect((await storage.read()).reflections.one).toMatchObject({ status: 'pending', attempts: 0 });
  expect((await storage.read()).reflections.one).not.toHaveProperty('claimId');
  const resumed = new AgentLearningCoordinator({
    journal,
    schedule: (task) => task(),
    learners: [],
  });
  await resumed.replayPending();
  expect((await storage.read()).reflections.one.status).toBe('processed');
});

test('stops waiting for an already running episode when the maintenance budget expires', async () => {
  const storage = new MemoryAgentExperienceJournalStore();
  const journal = new AgentExperienceJournal(storage);
  const event = {
    schema: 'comet.agent-experience.v1' as const,
    eventId: 'background',
    episodeId: 'shared-episode',
    occurredAt: new Date().toISOString(),
    type: 'episode.completed' as const,
    actor: 'workflow' as const,
    scope: 'user' as const,
    source: { kind: 'system' as const, name: 'test' },
    context: {},
    evidence: [],
  };
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let background: Promise<void> | undefined;
  const coordinator = new AgentLearningCoordinator({
    journal,
    schedule: (task) => {
      background = task();
    },
    learners: [
      {
        owner: 'test',
        supports: () => true,
        reflect: async () => {
          entered();
          await gate;
          return [];
        },
        consolidate: async () => {},
      },
    ],
  });
  await coordinator.capture(event);
  await ready;
  await journal.capture({ ...event, eventId: 'queued' });
  const fallback = setTimeout(release, 800);
  try {
    expect(await coordinator.status()).toMatchObject({ processing: 1, pending: 1 });
    const started = performance.now();
    await withOperationBudget({ timeoutMs: 40 }, () =>
      coordinator.replayPending(50, { waitForCompletion: true }),
    );
    expect(performance.now() - started).toBeLessThan(300);
    const snapshot = await storage.read();
    expect(snapshot.reflections.queued).toMatchObject({ status: 'pending', attempts: 0 });
    expect(snapshot.reflections.background.status).toBe('processing');
  } finally {
    clearTimeout(fallback);
    release();
    await background;
  }
});
