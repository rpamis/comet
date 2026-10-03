import {
  createMemoryRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
  tool,
  type RuntimeValue,
  type RuntimeProgress,
} from '@rpamis/comet/runtime';
import {
  createPluginClient,
  definePlugin,
  definePluginCapability,
  PluginRuntime,
  MemoryPluginStateStore,
} from '@rpamis/comet/plugins';

function parseNote(value: unknown): { note: string } {
  if (!value || typeof value !== 'object' || !('note' in value) || typeof value.note !== 'string')
    throw new Error('Expected a note');
  return { note: value.note };
}

interface Report {
  note: string;
}

function report(note: string): Report {
  return { note };
}

const executor = createRuntimeExecutor({
  id: 'host',
  handlers: {
    write: defineRuntimeHandler({
      type: 'call_tool',
      parseInput: ({ input }) => parseNote(input),
      execute(input) {
        const note: string = input.note;
        // @ts-expect-error Parsed handler input is not an arbitrary object.
        input.missing;
        return { status: 'succeeded', output: report(note) };
      },
    }),
  },
});

const workflow = {
  id: 'notes',
  version: '1',
  entry: 'write',
  steps: { write: tool({ ref: 'write' }) },
};
const runtime = createRuntime({
  store: createMemoryRuntimeStore(),
  workflows: [workflow],
  executors: [executor],
});
await runtime.start({ runId: 'typed', workflow, input: { note: 'typed' } });
const progress: RuntimeProgress = await runtime.runUntilBlocked({
  runId: 'typed',
  executorId: 'host',
});
const result: RuntimeValue = progress.run.outputs.write.value;
void result;
if (
  progress.reason !== 'completed' ||
  typeof result !== 'object' ||
  result === null ||
  Array.isArray(result) ||
  result.note !== 'typed'
)
  throw new Error('Typed Runtime consumer did not finish');

const plugin = definePlugin({
  id: 'notes',
  kind: 'third-party',
  version: '1',
  scopes: ['user'],
  compatible: () => true,
  create: () => ({
    capabilities: {
      write: definePluginCapability({
        parseInput: parseNote,
        invoke: (input) => ({ saved: input.note }),
      }),
      length: definePluginCapability({
        parseInput: (value) => {
          if (typeof value !== 'string') throw new Error('Expected text');
          return value;
        },
        invoke: async (input) => input.length,
      }),
    },
  }),
});
const plugins = new PluginRuntime({
  cometVersion: '0.4.5',
  store: new MemoryPluginStateStore(),
  descriptors: [plugin],
});
const client = createPluginClient(plugins, plugin);
await plugins.install(plugin.id, 'user');
const written: { saved: string } = await client.invoke('write', { note: 'typed' });
const length: number = await client.invoke('length', 'typed');
void written;
void length;
if (written.saved !== 'typed' || length !== 5)
  throw new Error('Typed plugin consumer lost its result');
if (false) {
  // @ts-expect-error Unknown capability names must not type-check.
  await client.invoke('missing', null);
  // @ts-expect-error Capability inputs must match the decoder's result.
  await client.invoke('write', { note: 42 });
  // @ts-expect-error Outputs must retain their inferred types.
  const wrong: number = await client.invoke('write', { note: 'typed' });
  void wrong;
}

const lifecycle: string[] = [];
class ClassNotes {
  #writes = 0;
  readonly capabilities = {
    write: definePluginCapability({
      parseInput: () => null,
      invoke: () => ++this.#writes,
    }),
  };

  provideContext() {
    lifecycle.push(`context:${this.#writes}`);
    return null;
  }

  dispose() {
    lifecycle.push(`dispose:${this.#writes}`);
  }
}
const classPlugin = definePlugin({
  id: 'class-notes',
  kind: 'third-party',
  version: '1',
  scopes: ['user'],
  compatible: () => true,
  create: () => Object.freeze(new ClassNotes()),
});
const classRuntime = new PluginRuntime({
  cometVersion: '0.4.5',
  store: new MemoryPluginStateStore(),
  descriptors: [classPlugin],
});
await classRuntime.install(classPlugin.id, 'user');
const classClient = createPluginClient(classRuntime, classPlugin);
if ((await classClient.invoke('write', null)) !== 1)
  throw new Error('Class plugin capability lost its receiver');
await classRuntime.collectContext({ task: 'notes' }, 'user');
await classRuntime.disable(classPlugin.id);
if (JSON.stringify(lifecycle) !== JSON.stringify(['context:1', 'dispose:1']))
  throw new Error('Class plugin lifecycle lost its receiver');
