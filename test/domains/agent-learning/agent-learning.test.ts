import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  AgentLearningCoordinator,
  ContextDirector,
  MemoryAgentContextApplicationStore,
  MemoryAgentExperienceJournalStore,
  StorageAgentContextApplicationStore,
  StorageAgentExperienceJournalStore,
  chunkReflectionRequests,
  compileProjectPolicy,
  contextOutcomeTargetIds,
  reflectionEvents,
  validateAgentExperienceEvent,
  type AgentContextCandidate,
  type AgentExperienceEvent,
  type AgentLearningAdapter,
} from '../../../domains/agent-learning/index.js';
import { JsonFilePluginStorageStore } from '../../../platform/fs/plugin-store.js';

function event(overrides: Partial<AgentExperienceEvent> = {}): AgentExperienceEvent {
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: 'event-1',
    episodeId: 'episode-1',
    occurredAt: '2026-08-24T12:00:00.000Z',
    type: 'verification.completed',
    actor: 'workflow',
    scope: 'project',
    projectId: 'project-1',
    source: { kind: 'workflow', name: 'native', workflow: 'native', changeId: 'change-1' },
    context: { workflow: 'native', changeId: 'change-1', phase: 'verify' },
    evidence: [
      {
        id: 'evidence-1',
        kind: 'verification',
        summary: 'Focused tests passed',
        command: 'pnpm test',
        success: true,
        digest: 'digest-1',
      },
    ],
    ...overrides,
  };
}

function candidate(overrides: Partial<AgentContextCandidate> = {}): AgentContextCandidate {
  return {
    id: 'memory-1',
    owner: 'personal-memory',
    scope: 'user',
    memoryType: 'core-profile',
    kind: 'user-preference',
    state: 'proven',
    authority: 'explicit',
    title: '回复语言',
    summary: '使用中文回复',
    content: '始终使用中文回复用户。',
    selectors: {},
    sources: [{ type: 'user' }],
    verification: [],
    ...overrides,
  };
}

describe('Agent Experience Journal', () => {
  it('validates the public envelope and requires project identity', () => {
    expect(validateAgentExperienceEvent(event())).toMatchObject({
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: 'event-1',
    });
    expect(() => validateAgentExperienceEvent({ ...event(), projectId: undefined })).toThrow(
      /requires projectId/iu,
    );
  });

  it('writes an event once and merges repeated episode evidence by digest', async () => {
    const journal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    await expect(journal.capture(event())).resolves.toMatchObject({ deduplicated: false });
    await expect(journal.capture(event())).resolves.toMatchObject({ deduplicated: true });
    await journal.capture(
      event({
        eventId: 'event-2',
        evidence: [
          { ...event().evidence[0], id: 'evidence-copy' },
          {
            id: 'evidence-2',
            kind: 'review',
            summary: 'Review finding resolved',
            digest: 'digest-2',
          },
        ],
      }),
    );
    await expect(journal.episode('episode-1')).resolves.toMatchObject({
      events: [{ eventId: 'event-1' }, { eventId: 'event-2' }],
      evidence: [{ digest: 'digest-1' }, { digest: 'digest-2' }],
    });
  });

  it('preserves concurrent journal and application writes from independent runtimes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-learning-lock-'));
    try {
      const storage = new JsonFilePluginStorageStore(root);
      const journalStorageA = await storage.open('comet.agent-learning', 'project', 'project-1');
      const journalStorageB = await storage.open('comet.agent-learning', 'project', 'project-1');
      const journalA = new AgentExperienceJournal(
        new StorageAgentExperienceJournalStore(journalStorageA),
      );
      const journalB = new AgentExperienceJournal(
        new StorageAgentExperienceJournalStore(journalStorageB),
      );

      await Promise.all([
        journalA.capture(event({ eventId: 'event-a' })),
        journalB.capture(event({ eventId: 'event-b' })),
      ]);
      const captured = await journalA.list();
      expect(captured).toHaveLength(2);
      expect(captured.map((entry) => entry.eventId).sort()).toEqual(['event-a', 'event-b']);

      const applicationStorageA = await storage.open(
        'comet.context-applications',
        'project',
        'project-1',
      );
      const applicationStorageB = await storage.open(
        'comet.context-applications',
        'project',
        'project-1',
      );
      const applicationsA = new StorageAgentContextApplicationStore(applicationStorageA);
      const applicationsB = new StorageAgentContextApplicationStore(applicationStorageB);
      const record = {
        applicationId: 'application-a',
        candidateId: 'candidate-a',
        candidateDigest: 'digest-a',
        owner: 'personal-memory',
        scope: 'user' as const,
        memoryType: 'core-profile' as const,
        episodeId: 'episode-a',
        sessionId: 'session-a',
        task: 'task-a',
        whyApplied: '用户明确设置',
        delivery: 'full' as const,
        appliedAt: '2026-08-24T12:00:00.000Z',
      };
      await Promise.all([
        applicationsA.append(record),
        applicationsB.append({
          ...record,
          applicationId: 'application-b',
          candidateId: 'candidate-b',
          candidateDigest: 'digest-b',
        }),
      ]);
      const applicationRecords = await applicationsA.list();
      expect(applicationRecords).toHaveLength(2);
      expect(applicationRecords.map((entry) => entry.applicationId).sort()).toEqual([
        'application-a',
        'application-b',
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects incompatible or partially corrupt application history state', async () => {
    const incompatible = new StorageAgentContextApplicationStore({
      read: async () => ({ version: 3, records: [] }),
      write: async () => {},
    });
    await expect(incompatible.list()).rejects.toThrow('incompatible');

    const corrupt = new StorageAgentContextApplicationStore({
      read: async () => ({ version: 5, records: [{}] }),
      write: async () => {},
    });
    await expect(corrupt.list()).rejects.toThrow('invalid record');
  });
});

describe('Agent Learning Coordinator', () => {
  it('claims one pending event across independent runtimes before Reflection', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-learning-claim-'));
    try {
      const storage = new JsonFilePluginStorageStore(root);
      const journalA = new AgentExperienceJournal(
        new StorageAgentExperienceJournalStore(
          await storage.open('comet.agent-learning', 'project', 'project-1'),
        ),
      );
      const journalB = new AgentExperienceJournal(
        new StorageAgentExperienceJournalStore(
          await storage.open('comet.agent-learning', 'project', 'project-1'),
        ),
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const firstReflection = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const reflect = vi.fn(async () => {
        entered();
        await gate;
        return [];
      });
      const coordinatorA = new AgentLearningCoordinator({
        journal: journalA,
        learners: [
          {
            owner: 'project-knowledge',
            supports: () => true,
            reflect,
            consolidate: async () => {},
          },
        ],
        schedule: async (task) => task(),
      });
      const coordinatorB = new AgentLearningCoordinator({
        journal: journalB,
        learners: [
          {
            owner: 'project-knowledge',
            supports: () => true,
            reflect,
            consolidate: async () => {},
          },
        ],
        schedule: async (task) => task(),
      });

      const first = coordinatorA.capture(event());
      await firstReflection;
      const second = coordinatorB.capture(event());
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await Promise.all([first, second]);

      expect(reflect).toHaveBeenCalledTimes(1);
      await expect(journalA.pending()).resolves.toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns structured Learning Deltas for synchronous Reflection', async () => {
    const delta = {
      action: 'create' as const,
      owner: 'personal-memory',
      memoryType: 'core-profile' as const,
      kind: 'user-preference',
      statement: '始终使用中文回复。',
      applicability: {},
      evidence: [{ id: 'signal', kind: 'user' as const, summary: '用户明确要求' }],
      recommendedState: 'proven' as const,
    };
    const coordinator = new AgentLearningCoordinator({
      journal: new AgentExperienceJournal(new MemoryAgentExperienceJournalStore()),
      learners: [
        {
          owner: 'personal-memory',
          supports: () => true,
          reflect: async () => [delta],
          consolidate: async () => {},
        },
      ],
      schedule: async (task) => task(),
    });

    const result = await coordinator.capture(
      event({
        eventId: 'signal-delta',
        type: 'user.signal',
        actor: 'user',
        scope: 'user',
        projectId: undefined,
        signal: {
          kind: 'preference',
          explicit: true,
          longTerm: true,
          text: '始终使用中文回复。',
        },
      }),
    );

    expect(result.deltas).toEqual([delta]);
  });

  it('reflects explicit long-term signals synchronously and schedules ordinary episodes', async () => {
    const reflect = vi.fn(async () => []);
    const learner: AgentLearningAdapter = {
      owner: 'personal-memory',
      supports: () => true,
      reflect,
      consolidate: async () => {},
    };
    const scheduled: (() => Promise<void>)[] = [];
    const coordinator = new AgentLearningCoordinator({
      journal: new AgentExperienceJournal(new MemoryAgentExperienceJournalStore()),
      learners: [learner],
      schedule: (task) => scheduled.push(task),
    });

    await expect(
      coordinator.capture(
        event({
          eventId: 'signal-1',
          type: 'user.signal',
          actor: 'user',
          scope: 'user',
          projectId: undefined,
          signal: {
            kind: 'preference',
            explicit: true,
            longTerm: true,
            text: '以后都用中文回答',
          },
        }),
      ),
    ).resolves.toMatchObject({ reflectedSynchronously: true });
    expect(reflect).toHaveBeenCalledTimes(1);

    await expect(coordinator.capture(event({ eventId: 'event-2' }))).resolves.toMatchObject({
      reflectedSynchronously: false,
    });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(reflect).toHaveBeenCalledTimes(2);
  });

  it('chunks by episode evidence rather than rejecting large text by bytes', () => {
    const large = '证据'.repeat(20_000);
    const requests = chunkReflectionRequests(
      'episode-large',
      [
        event({
          evidence: Array.from({ length: 5 }, (_, index) => ({
            id: `evidence-${index}`,
            kind: 'source' as const,
            summary: large,
          })),
        }),
      ],
      8,
      2,
    );
    expect(requests.map((request) => request.evidenceCount)).toEqual([2, 2, 1]);
    expect(requests.flatMap(reflectionEvents).map((entry) => entry.evidence.length)).toEqual([
      2, 2, 1,
    ]);
  });

  it('keeps zero-evidence events exactly once when an episode also has chunked evidence', () => {
    const requests = chunkReflectionRequests(
      'episode-mixed',
      [
        event({ eventId: 'without-evidence', evidence: [] }),
        event({
          eventId: 'with-evidence',
          evidence: Array.from({ length: 3 }, (_, index) => ({
            id: `mixed-evidence-${index}`,
            kind: 'source' as const,
            summary: `Evidence ${index}`,
          })),
        }),
      ],
      8,
      2,
    );

    expect(requests.flatMap(reflectionEvents).map((entry) => entry.eventId)).toEqual([
      'without-evidence',
      'with-evidence',
      'with-evidence',
    ]);
    expect(
      requests.flatMap(reflectionEvents).filter((entry) => entry.eventId === 'without-evidence'),
    ).toHaveLength(1);
  });

  it('finishes every Reflection chunk before one batched Consolidation', async () => {
    const order: string[] = [];
    const coordinator = new AgentLearningCoordinator({
      journal: new AgentExperienceJournal(new MemoryAgentExperienceJournalStore()),
      maxEvidencePerReflection: 1,
      learners: [
        {
          owner: 'project-knowledge',
          supports: () => true,
          reflect: async (request) => {
            order.push(`reflect:${request.evidenceOffset}`);
            return [
              {
                action: 'create',
                owner: 'project-knowledge',
                memoryType: 'project-policy',
                kind: 'constraint',
                statement: `Constraint ${request.evidenceOffset}`,
                applicability: { projectId: 'project-1' },
                evidence: reflectionEvents(request).flatMap((entry) => entry.evidence),
                recommendedState: 'trial',
              },
            ];
          },
          consolidate: async (request) => {
            order.push(`consolidate:${request.deltas.length}`);
          },
        },
      ],
      schedule: async (task) => task(),
    });

    await coordinator.capture(
      event({
        eventId: 'batched-reflection',
        evidence: [
          { id: 'batch-a', kind: 'source', summary: 'A' },
          { id: 'batch-b', kind: 'source', summary: 'B' },
        ],
      }),
    );

    expect(order).toEqual(['reflect:0', 'reflect:1', 'consolidate:2']);
  });

  it('derives Delta idempotency from semantics instead of Reflection result order', async () => {
    const firstDelta = {
      action: 'create' as const,
      owner: 'project-knowledge',
      memoryType: 'project-policy' as const,
      kind: 'constraint',
      statement: 'Run lint.',
      applicability: { projectId: 'project-1', phases: ['verify', 'build'] },
      evidence: [{ id: 'lint', kind: 'verification' as const, summary: 'Lint passed' }],
      recommendedState: 'trial' as const,
    };
    const secondDelta = {
      ...firstDelta,
      statement: 'Run tests.',
      evidence: [{ id: 'test', kind: 'verification' as const, summary: 'Tests passed' }],
    };
    const collect = async (reflected: readonly (typeof firstDelta)[]) => {
      let captured = new Map<string, string>();
      const coordinator = new AgentLearningCoordinator({
        journal: new AgentExperienceJournal(new MemoryAgentExperienceJournalStore()),
        learners: [
          {
            owner: 'project-knowledge',
            supports: () => true,
            reflect: async () => reflected,
            consolidate: async ({ deltas }) => {
              captured = new Map(
                deltas.map((entry) => [entry.delta.statement, entry.idempotencyKey]),
              );
            },
          },
        ],
        schedule: async (task) => task(),
      });
      await coordinator.capture(event({ eventId: 'semantic-key' }));
      return captured;
    };

    expect(await collect([firstDelta, secondDelta])).toEqual(
      await collect([secondDelta, firstDelta]),
    );
    const tiedEvidence = {
      ...firstDelta,
      statement: 'Keep evidence ordering stable.',
      evidence: [
        { id: 'same', kind: 'verification' as const, summary: 'A' },
        { id: 'same', kind: 'verification' as const, summary: 'B' },
      ],
    };
    const forward = await collect([tiedEvidence]);
    const reversed = await collect([
      { ...tiedEvidence, evidence: [...tiedEvidence.evidence].reverse() },
    ]);
    expect(forward).toEqual(reversed);
  });

  it('keeps failed Reflection work pending and retries the same event id', async () => {
    const reflect = vi
      .fn<AgentLearningAdapter['reflect']>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue([]);
    const journal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const coordinator = new AgentLearningCoordinator({
      journal,
      learners: [
        {
          owner: 'project-knowledge',
          supports: () => true,
          reflect,
          consolidate: async () => {},
        },
      ],
      schedule: async (task) => task(),
    });

    await coordinator.capture(event());
    await expect(journal.pending()).resolves.toMatchObject([{ eventId: 'event-1' }]);

    await coordinator.capture(event());

    expect(reflect).toHaveBeenCalledTimes(2);
    await expect(journal.pending()).resolves.toEqual([]);
  });

  it('persists deterministic deltas while keeping deferred semantic reflection replayable', async () => {
    const delta = {
      action: 'create' as const,
      owner: 'project-knowledge',
      memoryType: 'project-model' as const,
      kind: 'fact',
      statement: 'The repository uses TypeScript.',
      applicability: { projectId: 'project-1' },
      evidence: [{ id: 'package', kind: 'source' as const, summary: 'package.json' }],
      recommendedState: 'proven' as const,
    };
    let semanticReviewAvailable = false;
    const consolidate = vi.fn<AgentLearningAdapter['consolidate']>(async () => {});
    const journal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const coordinator = new AgentLearningCoordinator({
      journal,
      learners: [
        {
          owner: 'project-knowledge',
          supports: () => true,
          reflect: async () => ({
            deltas: [delta],
            deferred: !semanticReviewAvailable,
          }),
          consolidate,
        },
      ],
      schedule: async (task) => task(),
    });

    await coordinator.capture(event({ eventId: 'semantic-deferred' }));

    await expect(journal.pending()).resolves.toMatchObject([{ eventId: 'semantic-deferred' }]);
    expect(consolidate).toHaveBeenCalledTimes(1);
    const firstKey = consolidate.mock.calls[0]?.[0].deltas[0]?.idempotencyKey;

    semanticReviewAvailable = true;
    await coordinator.replayPending();

    await expect(journal.pending()).resolves.toEqual([]);
    expect(consolidate).toHaveBeenCalledTimes(2);
    expect(consolidate.mock.calls[1]?.[0].deltas[0]?.idempotencyKey).toBe(firstKey);
  });

  it('reflects the merged episode and isolates a failing learner from healthy learners', async () => {
    const failing = vi.fn<AgentLearningAdapter['reflect']>(async () => {
      throw new Error('learner unavailable');
    });
    const healthy = vi.fn<AgentLearningAdapter['reflect']>(async () => []);
    const journal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const coordinator = new AgentLearningCoordinator({
      journal,
      learners: [
        { owner: 'failing', supports: () => true, reflect: failing, consolidate: async () => {} },
        { owner: 'healthy', supports: () => true, reflect: healthy, consolidate: async () => {} },
      ],
      schedule: async (task) => task(),
    });

    await coordinator.capture(event({ eventId: 'episode-event-1' }));
    await coordinator.capture(
      event({
        eventId: 'episode-event-2',
        evidence: [
          {
            id: 'episode-evidence-2',
            kind: 'review',
            summary: 'Second episode signal',
            digest: 'episode-digest-2',
          },
        ],
      }),
    );

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(healthy.mock.calls[1]?.[0].events.map((entry) => entry.eventId)).toEqual([
      'episode-event-2',
    ]);
    expect(failing).toHaveBeenCalledTimes(2);
    await expect(journal.pending()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'episode-event-1' }),
        expect.objectContaining({ eventId: 'episode-event-2' }),
      ]),
    );
  });

  it('does not repeat a completed Learner consolidation when another Learner retries', async () => {
    const failing = vi.fn<AgentLearningAdapter['reflect']>(async () => {
      throw new Error('temporary learner failure');
    });
    const consolidate = vi.fn<AgentLearningAdapter['consolidate']>(async () => {});
    const journal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const coordinator = new AgentLearningCoordinator({
      journal,
      learners: [
        { owner: 'failing', supports: () => true, reflect: failing, consolidate: async () => {} },
        {
          owner: 'healthy',
          supports: () => true,
          reflect: async () => [
            {
              action: 'create',
              owner: 'healthy',
              memoryType: 'project-policy',
              kind: 'constraint',
              statement: 'Run focused tests.',
              applicability: { projectId: 'project-1' },
              evidence: [],
              recommendedState: 'trial',
            },
          ],
          consolidate,
        },
      ],
      schedule: async (task) => task(),
    });

    await coordinator.capture(event({ eventId: 'retry-by-owner' }));
    await coordinator.capture(event({ eventId: 'retry-by-owner' }));

    expect(failing).toHaveBeenCalledTimes(2);
    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(consolidate.mock.calls[0]?.[0].deltas[0]?.idempotencyKey).toMatch(/^learning-delta:/u);
  });
});

describe('Context Director', () => {
  it('localizes generated application reasons for English workflows', async () => {
    const director = new ContextDirector();
    const selection = await director.select(
      [
        candidate({
          scope: 'project',
          selectors: { projectId: 'project-1', phases: ['verify'] },
          matchReasons: ['Enforced by the project verification command'],
        }),
      ],
      {
        task: 'Verify the release',
        projectId: 'project-1',
        phase: 'verify',
        language: 'en',
      },
    );

    expect(selection.applications[0]?.whyApplied).toBe(
      'Enforced by the project verification command; Explicitly set by the user; Current project matches; Current phase matches',
    );
  });

  it('renders one escaped progressive context and exposes a stable manifest expansion', async () => {
    const director = new ContextDirector({
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      defaultCharBudget: 700,
    });
    const projectModel = candidate({
      id: 'project-model-1',
      owner: 'project-knowledge',
      memoryType: 'project-model',
      kind: 'topology',
      authority: 'repository',
      title: '模块 <边界>',
      summary: 'domains 模块不直接访问文件系统',
      content: '很长'.repeat(100),
      selectors: { projectId: 'project-1', paths: ['domains/*'] },
      sources: [{ type: 'repository', source: 'AGENTS.md' }],
    });
    const selection = await director.select([candidate(), projectModel], {
      task: '修改 domains 模块',
      projectId: 'project-1',
      path: 'domains/agent-learning/types.ts',
      sessionId: 'session-1',
    });
    expect(selection.coreMemory).toHaveLength(1);
    expect(selection.manifest).toEqual([
      expect.objectContaining({
        id: 'project-model-1',
        expansionId: 'project-knowledge::project-model-1',
        sourceType: 'repository',
        whyApplied: expect.stringContaining('当前项目匹配'),
      }),
    ]);
    expect(selection.text).toContain('<agent_context>');
    expect(selection.text).toContain('模块 &lt;边界&gt;');
    expect(selection.text).toContain('id="project-knowledge::project-model-1"');
    expect(selection.text).not.toContain('<project_knowledge>');
    expect(selection.applications).toHaveLength(2);
    for (const application of selection.applications) {
      expect(selection.text).toContain(`application_id="${application.applicationId}"`);
    }
    expect(
      director.expand([candidate(), projectModel], 'project-model-1', {
        task: '修改 domains 模块',
        projectId: 'project-1',
        path: 'domains/agent-learning/types.ts',
      }),
    ).toMatchObject({
      id: 'project-knowledge::project-model-1',
      sources: [{ source: 'AGENTS.md' }],
    });
  });

  it('uses owner-qualified expansion IDs when plugins return the same candidate ID', async () => {
    const director = new ContextDirector({ defaultCharBudget: 2_000 });
    const personal = candidate({ id: 'shared-id', owner: 'plugin.personal' });
    const project = candidate({
      id: 'shared-id',
      owner: 'plugin.project',
      scope: 'project',
      memoryType: 'project-model',
      authority: 'repository',
      selectors: { projectId: 'project-1' },
      content: 'Project-specific details',
    });
    const selection = await director.select([personal, project], {
      task: 'inspect context',
      projectId: 'project-1',
    });

    expect(selection.text).toContain('plugin.personal::shared-id');
    expect(selection.text).toContain('plugin.project::shared-id');
    expect(
      director.expand([personal, project], 'shared-id', { task: 'inspect context' }),
    ).toBeNull();
    expect(
      director.expand([personal, project], 'plugin.project::shared-id', {
        task: 'inspect context',
        projectId: 'project-1',
      }),
    ).toMatchObject({ id: 'plugin.project::shared-id', content: 'Project-specific details' });
  });

  it('routes outcome feedback only to the owner named by the qualified unit reference', () => {
    const references = ['plugin.personal::shared-id', 'plugin.project::shared-id', 'legacy-id'];
    expect(contextOutcomeTargetIds(references, 'plugin.personal')).toEqual(['shared-id']);
    expect(contextOutcomeTargetIds(references, 'plugin.project')).toEqual(['shared-id']);
    expect(contextOutcomeTargetIds(references, 'plugin.other')).toEqual([]);
  });

  it('does not redeliver unchanged units and uses outcome feedback in later ranking', async () => {
    const director = new ContextDirector();
    const first = await director.select(
      [
        candidate({ id: 'policy-a', memoryType: 'project-policy', authority: 'repository' }),
        candidate({ id: 'policy-b', memoryType: 'project-policy', authority: 'repository' }),
      ],
      { task: 'verify', sessionId: 'session-1' },
    );
    expect(first.applications).toHaveLength(2);
    await director.recordOutcome(first.applications[0]!.applicationId, 'contributed-to-failure');
    await expect(
      director.select(
        [
          candidate({ id: 'policy-a', memoryType: 'project-policy', authority: 'repository' }),
          candidate({ id: 'policy-b', memoryType: 'project-policy', authority: 'repository' }),
        ],
        { task: 'verify', sessionId: 'session-1' },
      ),
    ).resolves.toMatchObject({ text: '' });
    const next = await director.select(
      [
        candidate({ id: 'policy-a', memoryType: 'project-policy', authority: 'repository' }),
        candidate({ id: 'policy-b', memoryType: 'project-policy', authority: 'repository' }),
      ],
      { task: 'verify', sessionId: 'session-2' },
    );
    expect(next.applications[0]?.candidateId).toBe('policy-b');
  });

  it('records application outcomes as monotonic revisions and ignores exact repeats', async () => {
    const director = new ContextDirector();
    const selection = await director.select([candidate()], { task: '回复用户' });
    const applicationId = selection.applications[0]!.applicationId;

    await expect(director.recordOutcome(applicationId, 'used-successfully')).resolves.toMatchObject(
      {
        changed: true,
        record: { outcome: 'used-successfully', outcomeRevision: 1 },
      },
    );
    await expect(director.recordOutcome(applicationId, 'used-successfully')).resolves.toMatchObject(
      {
        changed: false,
        record: { outcome: 'used-successfully', outcomeRevision: 1 },
      },
    );
    await expect(director.recordOutcome(applicationId, 'corrected')).resolves.toMatchObject({
      changed: true,
      previousOutcome: 'used-successfully',
      record: { outcome: 'corrected', outcomeRevision: 2 },
    });
  });

  it('explains successful reuse from the persisted application history', async () => {
    const applications = new MemoryAgentContextApplicationStore();
    const director = new ContextDirector({ applications });
    const first = await director.select([candidate()], {
      task: '回复用户',
      sessionId: 'history-first',
      language: 'zh-CN',
    });
    await director.recordOutcome(first.applications[0]!.applicationId, 'used-successfully');

    const reused = await director.select([candidate()], {
      task: '回复用户',
      sessionId: 'history-second',
      language: 'zh-CN',
    });

    expect(reused.applications[0]?.whyApplied).toContain('最近应用成功');
  });

  it('persists session delivery digests across Context Director instances', async () => {
    const applications = new MemoryAgentContextApplicationStore();
    const firstDirector = new ContextDirector({ applications });
    const first = await firstDirector.select([candidate()], {
      task: '回复用户',
      sessionId: 'persistent-session',
    });
    expect(first.applications).toHaveLength(1);

    const secondDirector = new ContextDirector({ applications });
    await expect(
      secondDirector.select([candidate()], {
        task: '回复用户',
        sessionId: 'persistent-session',
      }),
    ).resolves.toMatchObject({ text: '', applications: [] });

    const changed = await secondDirector.select(
      [candidate({ summary: '默认使用中文回复', content: '默认使用中文回复用户。' })],
      { task: '回复用户', sessionId: 'persistent-session' },
    );
    expect(changed.applications).toHaveLength(1);

    const verificationChanged = await secondDirector.select(
      [
        candidate({
          summary: '默认使用中文回复',
          content: '默认使用中文回复用户。',
          verification: [{ command: 'pnpm lint' }],
        }),
      ],
      { task: '回复用户', sessionId: 'persistent-session' },
    );
    expect(verificationChanged.applications).toHaveLength(1);
  });

  it('requires every declared selector dimension and anchors path globs', async () => {
    const director = new ContextDirector();
    const pathBound = candidate({
      id: 'path-bound',
      selectors: { paths: ['src/a.ts'] },
    });
    await expect(director.select([pathBound], { task: 'edit' })).resolves.toMatchObject({
      applications: [],
      text: '',
    });
    await expect(
      director.select([pathBound], {
        task: 'edit',
        path: 'src/a.ts.bak',
        sessionId: 'wrong-path',
      }),
    ).resolves.toMatchObject({ applications: [], text: '' });
    await expect(
      director.select([pathBound], {
        task: 'edit',
        path: 'src/a.ts',
        sessionId: 'exact-path',
      }),
    ).resolves.toMatchObject({
      applications: [expect.objectContaining({ candidateId: 'path-bound' })],
    });
  });

  it('does not expand a project-scoped candidate outside its project selectors', () => {
    const director = new ContextDirector();
    const projectBound = candidate({
      id: 'project-bound',
      scope: 'project',
      memoryType: 'project-policy',
      selectors: { projectId: 'project-a' },
    });

    expect(
      director.expand([projectBound], 'project-bound', {
        task: '修改另一个项目',
        projectId: 'project-b',
      }),
    ).toBeNull();
  });

  it('ranks proven project authority above personal memory and bounds rendered XML', async () => {
    const director = new ContextDirector({ defaultCharBudget: 650 });
    const explicitPersonal = candidate({
      id: 'personal-explicit',
      memoryType: 'collaboration-policy',
      priority: 10_000,
      content: '个人偏好'.repeat(80),
    });
    const projectModel = candidate({
      id: 'project-model',
      owner: 'project-knowledge',
      scope: 'project',
      memoryType: 'project-model',
      authority: 'repository',
      selectors: { projectId: 'project-1' },
      content: '项目事实',
    });
    const projectPolicy = candidate({
      id: 'project-policy',
      owner: 'project-knowledge',
      scope: 'project',
      memoryType: 'project-policy',
      state: 'enforced',
      authority: 'repository',
      selectors: { projectId: 'project-1' },
      content: '项目约束',
      verification: [{ command: 'pnpm test' }],
    });

    const selection = await director.select([explicitPersonal, projectModel, projectPolicy], {
      task: '修改项目',
      projectId: 'project-1',
      sessionId: 'bounded',
    });

    expect(selection.applications.map((entry) => entry.candidateId).slice(0, 2)).toEqual([
      'project-policy',
      'project-model',
    ]);
    expect(selection.text.length).toBeLessThanOrEqual(650);
    expect(selection.text).toContain('command="pnpm test"');
  });
});

describe('Policy Compiler', () => {
  it('uses existing verification commands and only proposes skills for stable procedures', () => {
    expect(
      compileProjectPolicy({
        kind: 'constraint',
        state: 'enforced',
        verification: [{ command: 'pnpm lint' }],
      }),
    ).toEqual({ kind: 'verification', commands: [{ command: 'pnpm lint' }] });
    expect(
      compileProjectPolicy({
        kind: 'procedure',
        state: 'proven',
        verification: [],
        steps: ['inspect', 'edit', 'verify'],
        applicationCount: 2,
        successCount: 2,
        failureCount: 0,
      }),
    ).toMatchObject({ kind: 'skill-candidate' });
    expect(
      compileProjectPolicy({
        kind: 'procedure',
        state: 'proven',
        verification: [],
        steps: ['inspect', 'edit', 'verify'],
        applicationCount: 1,
        successCount: 1,
        failureCount: 0,
      }),
    ).toEqual({ kind: 'context' });
    expect(compileProjectPolicy({ kind: 'decision', state: 'proven', verification: [] })).toEqual({
      kind: 'context',
    });
  });
});
