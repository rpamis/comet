import { describe, expect, it } from 'vitest';
import * as sdk from '../../../domains/comet-plugin/sdk.js';

function note(value: unknown): { note: string } {
  if (!value || typeof value !== 'object' || !('note' in value) || typeof value.note !== 'string')
    throw new Error('Expected a note');
  return { note: value.note };
}

function notesPlugin() {
  return sdk.definePlugin({
    id: 'notes',
    kind: 'third-party',
    version: '1',
    scopes: ['project'],
    compatible: () => true,
    create: ({ storage }) => ({
      capabilities: {
        write: sdk.definePluginCapability({
          parseInput: note,
          async invoke(input) {
            await storage.write(input);
            return { saved: true };
          },
        }),
        read: sdk.definePluginCapability({
          parseInput: () => null,
          async invoke() {
            return note(await storage.read());
          },
        }),
        broken: sdk.definePluginCapability({
          parseInput: () => null,
          invoke() {
            throw new Error('write failed');
          },
        }),
      },
    }),
  });
}

describe('typed plugin capability registration', () => {
  it('uses the registered descriptor and scoped storage without auto-installing', async () => {
    const plugin = notesPlugin();
    const runtime = new sdk.PluginRuntime({
      cometVersion: '0.4.5',
      store: new sdk.MemoryPluginStateStore(),
      descriptors: [plugin],
    });
    const first = sdk.createPluginClient(runtime, plugin, { scope: 'project', projectId: 'a' });
    await expect(first.invoke('write', { note: 'not authorized' })).rejects.toThrow();
    expect((await runtime.get('notes'))?.status).toBe('uninstalled');
    await runtime.install('notes', 'user');
    expect(await first.invoke('write', { note: 'Keep changes scoped.' })).toEqual({ saved: true });
    expect(await first.invoke('read', null)).toEqual({ note: 'Keep changes scoped.' });
    const second = sdk.createPluginClient(runtime, plugin, { scope: 'project', projectId: 'b' });
    await expect(second.invoke('read', null)).rejects.toThrow('Expected a note');
  });

  it('validates untyped caller input before storage writes', async () => {
    const runtime = new sdk.PluginRuntime({
      cometVersion: '0.4.5',
      store: new sdk.MemoryPluginStateStore(),
      descriptors: [notesPlugin()],
    });
    await runtime.install('notes', 'user');
    await expect(
      runtime.invoke(
        'notes',
        'write',
        { note: 42 },
        { scope: 'project', projectId: 'a' },
        { throwOnError: true },
      ),
    ).rejects.toThrow('Expected a note');
    await expect(
      runtime.invoke(
        'notes',
        'read',
        null,
        { scope: 'project', projectId: 'a' },
        { throwOnError: true },
      ),
    ).rejects.toThrow('Expected a note');
  });

  it('propagates capability errors and respects disable instead of returning null as success', async () => {
    const plugin = notesPlugin();
    const runtime = new sdk.PluginRuntime({
      cometVersion: '0.4.5',
      store: new sdk.MemoryPluginStateStore(),
      descriptors: [plugin],
    });
    await runtime.install('notes', 'user');
    const client = sdk.createPluginClient(runtime, plugin, { scope: 'project', projectId: 'a' });
    await expect(client.invoke('broken', null)).rejects.toThrow('write failed');
    await runtime.disable('notes');
    await expect(client.invoke('write', { note: 'disabled' })).rejects.toThrow();
  });

  it('rejects undeclared capabilities, including inherited names', async () => {
    const runtime = new sdk.PluginRuntime({
      cometVersion: '0.4.5',
      store: new sdk.MemoryPluginStateStore(),
      descriptors: [notesPlugin()],
    });
    await runtime.install('notes', 'user');
    for (const capability of ['missing', 'toString', '__proto__']) {
      await expect(
        runtime.invoke(
          'notes',
          capability,
          null,
          { scope: 'project', projectId: 'a' },
          { throwOnError: true },
        ),
      ).rejects.toThrow(/Unsupported/);
    }
  });

  it('preserves prototype lifecycle methods and their original receiver', async () => {
    const events: string[] = [];
    class NotesModule {
      #writes = 0;
      readonly capabilities = {
        write: sdk.definePluginCapability({
          parseInput: () => null,
          invoke: () => ++this.#writes,
        }),
      };

      provideContext() {
        events.push(`context:${this.#writes}`);
        return null;
      }

      dispose() {
        events.push(`dispose:${this.#writes}`);
      }
    }
    const plugin = sdk.definePlugin({
      id: 'class-notes',
      kind: 'third-party',
      version: '1',
      scopes: ['user'],
      compatible: () => true,
      create: () => Object.freeze(new NotesModule()),
    });
    const runtime = new sdk.PluginRuntime({
      cometVersion: '0.4.5',
      store: new sdk.MemoryPluginStateStore(),
      descriptors: [plugin],
    });
    await runtime.install(plugin.id, 'user');
    const client = sdk.createPluginClient(runtime, plugin);
    expect(await client.invoke('write', null)).toBe(1);
    await runtime.collectContext({ task: 'notes' }, 'user');
    await runtime.disable(plugin.id);
    expect(events).toEqual(['context:1', 'dispose:1']);
  });
});
