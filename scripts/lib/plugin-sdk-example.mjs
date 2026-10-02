#!/usr/bin/env node

import {
  MemoryPluginStateStore,
  MemoryPluginStorageStore,
  PluginRuntime,
} from '@rpamis/comet/plugins';

const notesPlugin = {
  id: 'example.notes',
  kind: 'third-party',
  version: '1.0.0',
  scopes: ['project'],
  compatible: () => true,
  create: ({ storage, projectId }) => ({
    async invoke(capability, input) {
      if (capability === 'write') {
        await storage.write(input);
        return { saved: true };
      }
      if (capability === 'read') return storage.read();
      throw new Error(`Unsupported notes capability: ${capability}`);
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
};

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
await runtime.invoke(notesPlugin.id, 'write', { note: 'Keep changes scoped.' }, scope, {
  throwOnError: true,
});
const value = await runtime.invoke(notesPlugin.id, 'read', null, scope, { throwOnError: true });
const context = await runtime.collectContext(request, scope);
await runtime.disable(notesPlugin.id);
const disabledContext = await runtime.collectContext(request, scope);
console.log(JSON.stringify({ value, context, disabledContext }, null, 2));
