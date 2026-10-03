# SDK getting started

Comet SDK records Skill workflow execution, approvals, and recovery after interruptions. Your Agent platform remains responsible for models, Skills, MCP, tools, and user interaction. Start by implementing a host executor; you do not need to rewrite the platform's Agent loop.

## Run an approval and resume it

The SDK uses Node.js ESM. See the [release contract](./sdk-release-contract.md) for supported environments. Install the package to use its public entrypoints:

```bash
npm install @rpamis/comet
```

Before the SDK candidate is published, install an npm tarball built from the repository. Do not assume an older npm release contains these entrypoints.

This is a complete minimal host. Save it as `report.mjs`:

```js
import {
  approval,
  tool,
  skill,
  createFileRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
} from '@rpamis/comet/runtime';

const workflow = {
  id: 'report',
  version: '1',
  entry: 'draft',
  steps: {
    draft: skill({ ref: 'draft' }),
    approve: approval({ proposalFrom: 'draft' }),
    publish: tool({ ref: 'publish' }),
  },
  transitions: [
    { from: 'draft', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};

const host = createRuntimeExecutor({
  id: 'host',
  handlers: {
    draft: defineRuntimeHandler({
      type: 'invoke_skill',
      parseInput: ({ input }) => {
        if (typeof input !== 'string') throw new Error('Expected a topic');
        return input;
      },
      // Call the platform's existing Skill here and return its actual result.
      execute: (topic) => ({ status: 'succeeded', output: `Report about ${topic}` }),
    }),
    publish: defineRuntimeHandler({
      type: 'call_tool',
      parseInput: ({ outputs }) => {
        if (typeof outputs.draft !== 'string') throw new Error('Expected a report');
        return outputs.draft;
      },
      execute: (report) => {
        console.log(report);
        return { status: 'succeeded', output: { published: true } };
      },
    }),
  },
});

const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: './report-state' }),
  workflows: [workflow],
  executors: [host],
});
await runtime.start({
  runId: 'report-1',
  workflow: { id: 'report', version: '1' },
  input: 'SDK integration',
});
const progress = await runtime.runUntilBlocked({ runId: 'report-1', executorId: 'host' });
console.log(progress.reason);
```

Running `node report.mjs` stops at `approval-required`. Running it again waits for the same approval without repeating draft. To continue, explicitly submit a decision only after obtaining the user's approval of the current proposal:

```js
const wait = progress.run.waits.find((item) => item.status === 'pending');
if (wait) {
  // Show wait.proposal and obtain the user's decision; do not auto-approve.
  await runtime.resolveWait({
    runId: progress.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'user-decision-1',
    choice: 'approved',
  });
  const resumed = await runtime.runUntilBlocked({ runId: progress.run.runId, executorId: 'host' });
  console.log(resumed.reason); // completed
}
```

The file Store preserves the same Run. Register the same workflow and executor in a new process to resume it. When a workflow definition changes, use a new version and retain the old definitions needed by active Runs.

## Connect the executor to your platform

- Each `handlers` key matches a step's `ref`; routing also checks `type`, so one execution function does not need to branch on every name.
- `parseInput` receives `{ input, outputs, activation? }`: the step input, upstream outputs for this activation, and optional activation input. Return a validated business object; TypeScript infers the parameter type for `execute`.
- `execute` returns the actual success or failure result. Return `{ status: 'failed', output }` for a known tool failure. Exceptions, disconnections, and results that cannot be committed are conservatively recorded as unknown, not as unexecuted work.
- Inject access tokens through the host execution context. Do not put them in Workflow definitions, Run inputs, outputs, or proposals.

The helpers infer types within handlers, not end-to-end types for the entire workflow. Persisted cross-step results remain JSON and need input parsing, `outputSchema`, or versioned validators.

## Register a plugin capability

Register plugin capabilities by name without writing an `invoke` dispatch branch. This is a complete TypeScript example:

```ts
import {
  PluginRuntime,
  MemoryPluginStateStore,
  createPluginClient,
  definePlugin,
  definePluginCapability,
} from '@rpamis/comet/plugins';

const plugin = definePlugin({
  id: 'example.notes',
  kind: 'third-party',
  version: '1',
  scopes: ['user'],
  compatible: () => true,
  create: () => ({
    capabilities: {
      length: definePluginCapability({
        parseInput(value: unknown) {
          if (typeof value !== 'string') throw new Error('Expected text');
          return value;
        },
        invoke: (text) => text.length,
      }),
    },
  }),
});
const plugins = new PluginRuntime({
  cometVersion: '0.4.5',
  store: new MemoryPluginStateStore(),
  descriptors: [plugin],
});
// Obtain installation authorization first; registering a descriptor does not install it.
await plugins.install(plugin.id, 'user');
const client = createPluginClient(plugins, plugin);
const length: number = await client.invoke('length', 'hello');
```

The client infers capability names, inputs, and return types, propagates call errors, respects installation, disabling, and scope, and does not create a second plugin instance. Register the same descriptor again in a new process. This example uses in-memory state and does not demonstrate persistent plugins. Implementations are trusted and host-registered; type inference does not replace output validation or sandboxing.

## Continue as needed

| Goal                                                                    | Entry                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File persistence and cross-process resume after approval                | [Report example](../../scripts/lib/runtime-sdk-example.mjs): after building the repository, run `node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/report`, then repeat the command with `--approve`                       |
| External operation completed but result delivery was interrupted        | [Reconciliation example](../../scripts/lib/runtime-sdk-recovery-example.mjs): run once to stop at an unknown result; confirm that the original executor has stopped, then repeat the command with `--reconcile --confirmed-stopped` |
| Plugin storage, context, and disabling                                  | [Plugin example](../../scripts/lib/plugin-sdk-example.mjs) and [plugin reference](./plugin-sdk.md)                                                                                                                                  |
| DAGs, parallel execution, child workflows, custom state, and validators | [Runtime reference](./runtime-sdk.md)                                                                                                                                                                                               |
| Complete Native/Classic applications                                    | [Integration boundaries (Chinese)](./runtime-sdk-native-classic-integration.zh.md): retain each application's phases, state files, and acceptance rules                                                                             |
| Error codes, upgrades, and API compatibility                            | [Release contract](./sdk-release-contract.md)                                                                                                                                                                                       |

Run the reconciliation example with:

```bash
node scripts/lib/runtime-sdk-recovery-example.mjs --root-dir ./.tmp/recovery
node scripts/lib/runtime-sdk-recovery-example.mjs --root-dir ./.tmp/recovery --reconcile --confirmed-stopped
```

Its default directory is `.comet/runtime-sdk-recovery-example`. It uses a local file to simulate a queryable receipt from an external system. Real applications must query the target system and check the original execution identity. `--confirmed-stopped` is an explicit declaration by the example host, not SDK proof that execution has stopped. If an operation already ran, submit its original result; do not use evidence of non-execution to dispatch it again.
