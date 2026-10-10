# Comet Plugin SDK

The Plugin SDK registers plugins, manages their enabled state, provides context, consumes experience events, and invokes plugin capabilities. The Workflow Runtime SDK handles approvals, Actions, checkpoints, and recovery. The host application combines these interfaces and remains responsible for the Agent loop, model requests, and tool calls.

Personal memory and project knowledge are already plugins. The public plugin interface does not require rewriting them or changing Native's `comet-state.yaml`, Classic's `.comet.yaml`, or existing plugin data directories.

Start with [SDK getting started](./sdk-getting-started.md). For named capabilities, prefer `definePlugin`, `definePluginCapability`, and `createPluginClient`. The raw descriptor interface below remains available for advanced host adapters.

## Install and import

See the [SDK release contract](./sdk-release-contract.md) for public entrypoint compatibility and consumer verification scope.

```bash
npm install @rpamis/comet
```

Both plugin entrypoints are ESM and include TypeScript declarations:

| Entrypoint                    | Purpose                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@rpamis/comet/plugins`       | Generic plugin Runtime, definitions, storage, and event contracts; does not assemble built-in personal memory or project knowledge |
| `@rpamis/comet/plugins/comet` | Default Comet integration; retains both built-in plugins and accepts additional host-provided plugins                              |
| `@rpamis/comet/runtime`       | Workflows that need persistent approvals and recovery; does not automatically collect or inject plugin context                     |

Existing deep imports remain available. New applications should use these public entrypoints. They follow the Comet package version; do not depend on the source file layout behind them.

## Runnable example

[plugin-sdk-example.mjs](../../scripts/lib/plugin-sdk-example.mjs) demonstrates third-party plugin registration, explicit installation, project storage, capability calls, context provision, and behavior after disabling a plugin:

```bash
pnpm build
node scripts/lib/plugin-sdk-example.mjs
```

The example uses only in-memory storage. It does not access real user configuration or call a model or network service. State disappears when the process exits; it does not demonstrate cross-process recovery. Package validation installs the npm tarball in an isolated project, runs the same example, and compiles a TypeScript consumer.

## Define a plugin

The `create` function in `definePlugin` returns a `capabilities` map and optional context, event, Dashboard, and disposal functions. Define each capability with `definePluginCapability({ parseInput, invoke })`. Runtime parses unknown input before calling the typed business function. `createPluginClient(runtime, descriptor, scope?)` infers capability names, inputs, and return types and always uses `throwOnError: true`. It does not install or enable plugins automatically or change the default error behavior of low-level `PluginRuntime.invoke`.

Register the same descriptor with the Runtime used by the client. Inference relies on trusted implementation types; it cannot detect a different implementation registered by the host or validate plugin output. Raw descriptors and clients can coexist. Plugin lifecycle, scopes, data locations, and learning log protocols remain unchanged.

The return type of a capability's `parseInput` is also the client's input contract. The parser should accept that shape. Perform shape-changing operations such as extracting a field from an object inside `invoke`; do not declare a capability that only parses objects as accepting strings.

```ts
import {
  MemoryPluginStateStore,
  PluginRuntime,
  type PluginDescriptor,
} from '@rpamis/comet/plugins';

const notesPlugin: PluginDescriptor = {
  id: 'example.notes',
  kind: 'third-party',
  version: '1.0.0',
  scopes: ['project'],
  compatible: (cometVersion) => cometVersion.startsWith('0.4.'),
  create: ({ storage }) => ({
    async invoke(capability, input) {
      if (capability === 'write') {
        await storage.write(input);
        return { saved: true };
      }
      if (capability === 'read') return storage.read();
      throw new Error(`Unsupported notes capability: ${capability}`);
    },
  }),
};

const plugins = new PluginRuntime({
  cometVersion: '0.4.6',
  store: new MemoryPluginStateStore(),
  descriptors: [notesPlugin],
});

// Obtain the user's installation authorization before submitting this operation.
await plugins.install('example.notes', 'user');
await plugins.invoke(
  'example.notes',
  'write',
  { note: 'Keep changes scoped.' },
  { scope: 'project', projectId: 'project-a' },
  { throwOnError: true },
);
```

`descriptors` registers available implementations; registration is not installation. `create` runs when an enabled plugin is first used in a given scope and receives a configuration snapshot, storage, and a diagnostic callback. The plugin's `version` differs from the host's `cometVersion`; `compatible` determines whether that implementation can work with the current Comet version.

All `PluginModule` capabilities are optional:

| Capability                          | What the host receives                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `provideContext` / `resolveContext` | Structured context candidates / expanded content for a selected candidate                  |
| `events` / `onEvent`                | Subscriptions by experience event type; events are submitted through `dispatch`            |
| `reflect` / `consolidate`           | Learning results, which the plugin must persist idempotently                               |
| `invoke`                            | Plugin-defined capability calls with `unknown` input and output; the plugin validates them |
| `dashboard`                         | Page contributions; the host Dashboard decides how to render them                          |
| `dispose`                           | Resource cleanup for an instance when disabled, uninstalled, updated, or reconfigured      |

## Integrate with the default Comet application

```ts
import { createDefaultCometPluginBridge } from '@rpamis/comet/plugins/comet';

const bridge = await createDefaultCometPluginBridge({
  projectRoot: '/absolute/project',
  projectId: 'stable-project-id',
  descriptors: [notesPlugin],
  config: { 'example.notes': { language: 'zh-CN' } },
});

const plugins = bridge.pluginRuntime;
const installed = await plugins.get('example.notes');
if (installed?.status === 'uninstalled') {
  // Run only on an explicit user request; do not automatically restore uninstalled plugins.
  await plugins.install('example.notes', 'user');
}

const context = await bridge.collectContext({
  task: 'Implement the next requirement',
  phase: 'build',
  charBudget: 6000,
});
// Add context.text to the host Agent's context; the SDK does not call the model.
```

This snippet uses `notesPlugin` from the previous section. That plugin implements only `invoke`, so it contributes no additional context. The runnable example's plugin implements `provideContext`.

The default integration retains `comet.personal-memory` and `comet.project-knowledge`. Additional descriptors participate in context, events, and capability calls through the same `PluginRuntime`. Duplicate IDs prevent creation; they cannot replace built-in plugins. The Runtime binds returned context candidates to the plugin's registered ID. The default integration then uses Context Director for matching, budget selection, and application records. Verified project policies can enter the context body directly and may not appear in the candidate manifest.

`config` contains runtime configuration keyed by plugin ID. `configure` updates the current Runtime's configuration and disposes of old instances; it does not automatically write provider settings. Configuration and `invoke` inputs are cloned through JSON, so use JSON-serializable values. Supply functions, connections, and runners through descriptors or host options. The host must supply configuration again on each creation; do not put secrets in state files. Built-in memory and knowledge provider settings continue to use their existing configuration paths.

Descriptors are not automatically persisted to disk or dynamically imported either. A new process must register the same plugin implementation again; copying enabled-state records alone does not restore plugin code. This is an SDK application integration, not npm plugin discovery, download, or installation commands for the existing CLI.

## Lifecycle and data compatibility

- The generic Runtime does not automatically install plugins. The default Comet integration initializes first-party plugins through `reconcileFirstParty`. Third-party plugins are not installed automatically, and `install` / `update` reject the `system` source for them.
- Disabling or uninstalling a plugin retains its data. First-party version upgrades also respect explicit disable and uninstall choices.
- Use `disable(id)` to disable globally and `disable(id, { scope: 'project', projectId })` to pause a project scope. Use `enable` with the same target to restore it; enabling a project scope does not bypass global disabling.
- Default Comet state remains at `~/.comet/plugins/state.json`, and plugin storage remains at `~/.comet/plugins/storage/`. Personal memory and project knowledge retain their existing locations. Options such as `homeDirectory` and `stateRoot` let hosts isolate data; they are not new required user settings.
- The host supplies `projectId`, which must be stable and satisfy event identifier constraints. Use distinct IDs for distinct projects to avoid sharing project storage or events. Additional plugins use the same scope selection mechanism as built-in plugins.

## Storage, experience events, and scheduling

The generic Runtime defaults to in-memory plugin storage and an in-memory experience journal; neither survives process exit. Hosts can inject `PluginStateStore`, `PluginStorageStore`, and `AgentExperienceJournal`. `JsonPluginStateStore` accepts a `PluginStateFile` implementation that provides reads, writes, and locking. Shared-file adapters must provide cross-process locks; plain reads and writes cannot safely overwrite concurrent state.

The public entrypoint also provides `AgentExperienceJournal`, `MemoryAgentExperienceJournalStore`, `StorageAgentExperienceJournalStore`, and their storage types. The latter can reuse a plugin storage adapter. Cross-process learning requires a persistent journal, not just persistent plugin enabled-state records.

```ts
import { AGENT_EXPERIENCE_SCHEMA } from '@rpamis/comet/plugins';

await plugins.dispatch({
  schema: AGENT_EXPERIENCE_SCHEMA,
  eventId: 'task-a:completed',
  episodeId: 'task-a',
  occurredAt: new Date().toISOString(),
  type: 'episode.completed',
  actor: 'agent',
  scope: 'project',
  projectId: 'stable-project-id',
  source: { kind: 'system', name: 'example-host' },
  context: { task: 'Implement the next requirement' },
  evidence: [],
});
```

Event IDs support deduplication. Events from the same unit of work share an `episodeId`; subscription callbacks may receive multiple events from a consolidated episode. Plugins must make their external side effects idempotent and must not assume exactly-once execution across crashes.

Learning runs in the background by default. A return from `dispatch` does not mean background learning has completed. Short-lived hosts, tests, or applications that need to await processing can supply `scheduleLearning: (task) => task()`. After a restart, explicitly call `replayLearning()` to process unfinished journal entries. Waiting increases call duration; hosts should choose according to their response budget.

Ordinary `collectContext` replays unfinished learning first by default and has no universal timeout guarantee. Low-latency hosts can set `replayPendingLearningOnContext: false` and schedule replay separately. In the default Comet integration, `bestEffortContext: true` skips learning replay, context application persistence, and plugin state initialization. The host controls the total call budget. Do not use read-only context mode for explicit installation or persistence operations.

## Errors and execution permissions

- Load failures, incompatibility, and context errors are recorded in `diagnostics()`; other healthy plugins can continue working. This isolates failures but is not a security sandbox.
- Explicit `invoke` calls throw when the plugin or callable capability is missing. Plugin execution errors are recorded as diagnostics and return `null` by default. Set `{ throwOnError: true }` for critical operations; do not treat `null` as success.
- `collectContext` returns structured candidates and does not automatically inject them into a model. The host also handles Dashboard rendering and user interaction.
- Plugins run in the host process and may access the filesystem, network, and environment variables. Register only trusted implementations. `source: 'user'` is an authorization assertion submitted by the host, not a human identity verified by the SDK. This interface does not provide plugin downloads, supply-chain reviews, or process isolation.

## When to use the Workflow Runtime

Context queries can invoke plugins directly. Plugin operations that need user approval, execution records, or interruption recovery should be scheduled as Workflow Actions. The host executor then calls `plugins.invoke(..., { throwOnError: true })` and submits the actual execution result.

Plugin state, learning journals, and Workflow checkpoints record different facts and do not share a transaction. Submit execution results and experience events after the real operation completes. When external completion is uncertain, use the Runtime's uncertain outcomes and reconciliation recovery mechanism; submitting a plugin event does not prove that an Action succeeded.

Native and Classic retain their respective phase, approval, and state-file contracts. The public plugin interface does not turn memory queries, knowledge retrieval, or every Dashboard page into a Workflow.
