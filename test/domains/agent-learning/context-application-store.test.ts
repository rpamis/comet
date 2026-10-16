import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { withOperationBudget } from '../../../platform/process/operation-budget.js';
import { openSqliteDatabase } from '../../../platform/fs/sqlite.js';
import {
  SqliteAgentContextApplicationStore,
  StorageAgentContextApplicationStore,
  ContextDirector,
} from '../../../domains/agent-learning/index.js';
import type {
  AgentContextApplicationRecord,
  AgentContextCandidate,
} from '../../../domains/agent-learning/index.js';

const candidate: AgentContextCandidate = {
  id: 'preference',
  owner: 'comet.personal-memory',
  scope: 'user',
  memoryType: 'core-profile',
  kind: 'preference',
  state: 'proven',
  authority: 'user',
  title: 'Verify',
  summary: 'Run focused checks.',
  content: 'Run focused checks.',
  selectors: {},
  sources: [],
  verification: [],
};
const record = (i: number): AgentContextApplicationRecord => ({
  applicationId: `app-${String(i).padStart(6, '0')}`,
  candidateId: candidate.id,
  candidateDigest: 'digest',
  owner: candidate.owner,
  scope: 'user',
  contextProjectId: 'project-a',
  memoryType: 'core-profile',
  episodeId: `episode-${i}`,
  task: 'Fix login',
  whyApplied: 'Explicit preference',
  delivery: 'full',
  appliedAt: new Date(1760000000000 + i * 1000).toISOString(),
});

test('resumes a canceled large legacy import from committed batches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-applications-migration-'));
  const file = path.join(root, 'applications.sqlite');
  const records = Array.from({ length: 10000 }, (_, index) => record(index));
  const controller = new AbortController();
  const legacy = {
    read: async () => {
      setTimeout(() => controller.abort(), 1);
      return { version: 5, records };
    },
    write: async () => {
      throw new Error('legacy writes are forbidden');
    },
  };
  try {
    const store = new SqliteAgentContextApplicationStore(file, legacy);
    await expect(
      withOperationBudget({ timeoutMs: 10000, signal: controller.signal }, () =>
        store.query({ limit: 6 }),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_BUDGET_EXCEEDED' });
    const database = openSqliteDatabase(file);
    try {
      const offset = Number(
        database.prepare("SELECT value FROM application_meta WHERE key='legacy-offset'").get()
          ?.value,
      );
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(10000);
      expect(
        database.prepare("SELECT 1 FROM application_meta WHERE key='legacy-imported'").get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
    const resumed = new SqliteAgentContextApplicationStore(file, legacy);
    const page = await resumed.query({ limit: 6 });
    expect(page.items).toHaveLength(6);
    expect(page.total).toBe(10000);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('imports legacy history once, pages stable history, and preserves feedback across concurrent writers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-applications-'));
  let legacyReads = 0;
  const legacy = {
    read: async () => {
      legacyReads++;
      return { version: 5, records: Array.from({ length: 301 }, (_, i) => record(i)) };
    },
    write: async () => {
      throw new Error('legacy state is read-only after migration');
    },
  };
  const file = path.join(root, 'applications.sqlite');
  const first = new SqliteAgentContextApplicationStore(file, legacy),
    second = new SqliteAgentContextApplicationStore(file, legacy);
  try {
    const page = await first.query({
      owner: candidate.owner,
      candidateId: candidate.id,
      projectId: 'project-a',
      limit: 20,
    });
    expect(page.items).toHaveLength(20);
    expect(page.total).toBe(301);
    expect(page.nextCursor).toBeTruthy();
    const older = await second.query({
      candidateId: candidate.id,
      limit: 20,
      cursor: page.nextCursor,
    });
    expect(older.items).toHaveLength(20);
    expect(
      older.items.every(
        (item) => !page.items.some((prior) => prior.applicationId === item.applicationId),
      ),
    ).toBe(true);
    await Promise.all([
      first.setOutcome('app-000001', 'ignored', 'project-a'),
      second.setOutcome('app-000002', 'corrected', 'project-a'),
    ]);
    expect(
      (await first.list())
        .filter((item) => item.outcome)
        .map((item) => item.outcome)
        .sort(),
    ).toEqual(['corrected', 'ignored']);
    expect(legacyReads).toBe(1);
    await expect(first.setOutcome('app-000002', 'ignored', 'project-b')).resolves.toBeNull();
    await expect(first.query({ cursor: 'invalid' })).rejects.toThrow('cursor');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('uses indexed feedback and exact delivery context without reading all application records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-applications-selection-'));
  const store = new SqliteAgentContextApplicationStore(path.join(root, 'applications.sqlite'));
  try {
    await store.appendMany(
      Array.from({ length: 1000 }, (_, i) => ({
        ...record(i),
        outcome: i % 2 ? 'ignored' : 'used-successfully',
      })),
    );
    const history = await store.selectionHistory([candidate], {
      task: 'Fix login',
      projectId: 'project-a',
    });
    expect(history.records).toHaveLength(1);
    expect(history.feedbackScores[`${candidate.owner}:${candidate.id}`]).toBe(9000);
    store.list = async () => {
      throw new Error('full history read');
    };
    const director = new ContextDirector({ applications: store });
    const request = {
      task: 'Fix login',
      projectId: 'project-a',
      sessionId: 'agent-a',
      phase: 'build',
    };
    expect((await director.select([candidate], request)).applications).toHaveLength(1);
    const reopened = new ContextDirector({
      applications: new SqliteAgentContextApplicationStore(path.join(root, 'applications.sqlite')),
    });
    expect((await reopened.select([candidate], request)).applications).toHaveLength(0);
    expect(
      (await reopened.select([candidate], { ...request, phase: 'verify' })).applications,
    ).toHaveLength(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
