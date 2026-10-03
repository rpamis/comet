#!/usr/bin/env node

import {
  MemoryPluginStateStore,
  MemoryPluginStorageStore,
  PluginRuntime,
  definePlugin,
  definePluginCapability,
  createPluginClient,
} from '@rpamis/comet/plugins';

function parseNote(value) {
  if (typeof value?.note !== 'string') throw new Error('Expected a note');
  return { note: value.note };
}

const notesPlugin = definePlugin({
  id: 'example.notes',
  kind: 'third-party',
  version: '1.0.0',
  scopes: ['project'],
  compatible: () => true,
  create: ({ storage, projectId }) => ({
    capabilities: {
      write: definePluginCapability({
        parseInput: parseNote,
        async invoke(input) {
          await storage.write(input);
          return { saved: true };
        },
      }),
      read: definePluginCapability({
        parseInput: () => null,
        async invoke() {
          return parseNote(await storage.read());
        },
      }),
    },
    async provideContext() {
      const value = await storage.read();
      if (!value) return null;
      return {
        id: 'notes',
        owner: 'example.notes',
        scope: 'project',
        memoryType: 'project-policy',
        kind: 'note',
        state: 'proven',
        authority: 'user',
        title: 'Project note',
        summary: value.note,
        selectors: { projectId },
        sources: [{ type: 'user' }],
        verification: [],
      };
    },
  }),
});

const runtime = new PluginRuntime({
  cometVersion: '0.4.5',
  store: new MemoryPluginStateStore(),
  storage: new MemoryPluginStorageStore(),
  descriptors: [notesPlugin],
});
const scope = { scope: 'project', projectId: 'example-project' };
const request = { task: 'implement the next scoped change', projectId: scope.projectId };

// The host installs trusted third-party code only after user authorization.
await runtime.install(notesPlugin.id, 'user');
const client = createPluginClient(runtime, notesPlugin, scope);
await client.invoke('write', { note: 'Keep changes scoped.' });
const value = await client.invoke('read', null);
const context = await runtime.collectContext(request, scope);
await runtime.disable(notesPlugin.id);
const disabledContext = await runtime.collectContext(request, scope);
console.log(JSON.stringify({ value, context, disabledContext }, null, 2));
