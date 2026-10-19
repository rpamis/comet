import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { JsonFilePluginStorageStore } from '../../../platform/fs/plugin-store.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';
import type { AgentExperienceEvent } from '../../../domains/agent-learning/index.js';

const captured = vi.hoisted(() => ({ events: [] as AgentExperienceEvent[], projectId: '' }));
vi.mock('../../../domains/comet-plugin/comet.js', async (original) => ({
  ...(await original<object>()),
  createDefaultCometPluginBridge: async () => ({
    currentProjectId: captured.projectId,
    currentLanguage: 'en',
    pluginRuntime: {
      enqueueEvents: async (events: AgentExperienceEvent[]) => {
        captured.events.push(...events);
      },
    },
    dispatchExperience: async () => {},
  }),
}));
import {
  areCometWorkflowResultsProcessed,
  recordCometWorkflowResult,
} from '../../../domains/comet-entry/plugin-context.js';
let root: string;
let storage: JsonFilePluginStorageStore;
let checkpoint: Parameters<typeof recordCometWorkflowResult>[0];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-receipt-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  captured.projectId = resolveStableProjectId(root);
  captured.events = [];
  storage = new JsonFilePluginStorageStore(path.join(root, '.comet', 'plugins', 'storage'));
  checkpoint = {
    projectRoot: root,
    workflow: 'native',
    changeId: 'one',
    command: 'next',
    success: true,
    artifactRefs: ['plan.md'],
  };
  await recordCometWorkflowResult({ ...checkpoint, captureOnly: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function save(status = 'processed', events = captured.events, scope = 'project') {
  await (
    await storage.open(
      'comet.agent-learning',
      scope,
      scope === 'project' ? captured.projectId : undefined,
    )
  ).write({
    version: 2,
    events,
    reflections: Object.fromEntries(
      events.map((event) => [event.eventId, { status, attempts: 1, updatedAt: event.occurredAt }]),
    ),
  });
}
const read = (results?: (typeof checkpoint)[]) =>
  areCometWorkflowResultsProcessed(results ?? [checkpoint], new AbortController().signal);
test.skipIf(process.platform === 'win32')(
  'reuses durable processed receipts across reads without writing or loading Providers',
  async () => {
    await save();
    const file = path.join(
      root,
      '.comet',
      'plugins',
      'storage',
      `comet.agent-learning-project-${captured.projectId}.json`,
    );
    const before = await fs.stat(file);
    expect(await read()).toBe(true);
    expect(await read()).toBe(true);
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
    expect(captured.events).toHaveLength(1);
  },
);
test.each(['pending', 'processing', 'waiting', 'failed'])('retries %s learning', async (status) => {
  await save(status);
  expect(await read()).toBe(false);
});
test('rejects changed evidence, scope, project identity, and missing events', async () => {
  expect(await read()).toBe(false);
  await save();
  expect(await read([{ ...checkpoint, artifactRefs: ['changed.md'] }])).toBe(false);
  await save('processed', [{ ...captured.events[0]!, projectId: 'other' }]);
  expect(await read()).toBe(false);
  await save('processed', [{ ...captured.events[0]!, scope: 'user' }]);
  expect(await read()).toBe(false);
});
test('requires all batch events, and preserves pending personal reflection', async () => {
  await save();
  expect(await read([checkpoint, { ...checkpoint, eventType: 'review.resolved' }])).toBe(false);
  await save('pending', [{ ...captured.events[0]!, scope: 'user', projectId: undefined }], 'user');
  expect(await read()).toBe(false);
});
test('fails closed for malformed and oversized journals', async () => {
  const source = await storage.open('comet.agent-learning', 'project', captured.projectId);
  await source.write({ broken: true });
  expect(await read()).toBe(false);
  await source.write({ padding: 'x'.repeat(256 * 1024) });
  expect(await read()).toBe(false);
});

test('leaves large checkpoint batches and evidence to the bounded worker', async () => {
  await save();
  expect(await read([checkpoint, checkpoint, checkpoint, checkpoint])).toBe(false);
  expect(
    await read([
      { ...checkpoint, changedPaths: Array.from({ length: 129 }, (_, i) => `file-${i}`) },
    ]),
  ).toBe(false);
  expect(await read([{ ...checkpoint, changedPaths: ['x'.repeat(64 * 1024)] }])).toBe(false);
});
