import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('a JavaScript consumer can invoke a plugin through the public SDK entry', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { PluginRuntime, MemoryPluginStateStore, AGENT_EXPERIENCE_SCHEMA } from '@rpamis/comet/plugins';
        import { createDefaultCometPluginBridge } from '@rpamis/comet/plugins/comet';
        const runtime = new PluginRuntime({
          cometVersion: '0.4.5', store: new MemoryPluginStateStore(),
          descriptors: [{
            id: 'example', kind: 'third-party', version: '1', scopes: ['user'],
            compatible: () => true,
            create: () => ({ invoke: () => ({ answer: 42 }) }),
          }],
        });
        await runtime.install('example');
        const output = await runtime.invoke('example', 'answer', null);
        console.log(JSON.stringify({ output, schema: AGENT_EXPERIENCE_SCHEMA, factory: typeof createDefaultCometPluginBridge }));
      `,
    ],
    {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    output: { answer: 42 },
    schema: 'comet.agent-experience.v1',
    factory: 'function',
  });
});

test('the runnable plugin example contributes context without enabling disabled plugins', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const result = spawnSync(process.execPath, ['scripts/lib/plugin-sdk-example.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    value: { note: 'Keep changes scoped.' },
    context: [{ owner: 'example.notes', summary: 'Keep changes scoped.' }],
    disabledContext: [],
  });
});

test('a public SDK host can inject a learning journal and await event delivery', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        const sdk = await import('@rpamis/comet/plugins');
        if (typeof sdk.AgentExperienceJournal !== 'function' || typeof sdk.MemoryAgentExperienceJournalStore !== 'function') {
          console.log(JSON.stringify({ journal: 'unavailable' }));
        } else {
          const events = [];
          const runtime = new sdk.PluginRuntime({
            cometVersion: '0.4.5', store: new sdk.MemoryPluginStateStore(),
            journal: new sdk.AgentExperienceJournal(new sdk.MemoryAgentExperienceJournalStore()),
            scheduleLearning: task => task(),
            descriptors: [{ id: 'events', kind: 'third-party', version: '1', scopes: ['user'],
              compatible: () => true, create: () => ({ onEvent: event => { events.push(event.eventId); } }),
            }],
          });
          await runtime.install('events');
          const event = {
            schema: sdk.AGENT_EXPERIENCE_SCHEMA, eventId: 'one', episodeId: 'one',
            occurredAt: '2026-10-02T00:00:00.000Z', type: 'episode.completed', actor: 'agent', scope: 'user',
            source: { kind: 'system', name: 'example' }, context: {}, evidence: [],
          };
          await runtime.dispatch(event);
          await runtime.dispatch(event);
          console.log(JSON.stringify({ events }));
        }
      `,
    ],
    {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ events: ['one'] });
});
