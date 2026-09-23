# Comet Runtime SDK

The Comet Runtime SDK gives host Agent platforms a resumable workflow engine for Skills. The host remains responsible for model requests, Skill/MCP/tool calls, Hooks, Rules, sandboxing, and user interaction. The SDK pins workflow definitions, creates claimable Actions, records Outcomes and decisions, and restores a Run after a process restart.

It does not replace the platform's native Agent loop or duplicate its model integration. Connect the capabilities the platform already provides through an explicit executor.

## Install and import

```bash
npm install @rpamis/comet
```

Runtime is a dedicated ESM export with bundled TypeScript declarations:

```ts
import {
  approval,
  tool,
  createFileRuntimeStore,
  createRuntime,
  skill,
} from '@rpamis/comet/runtime';
```

Existing package deep paths remain available. New SDK consumers should use `@rpamis/comet/runtime`, not source paths under `domains/engine`.

## Runnable example

[runtime-sdk-example.mjs](../../scripts/lib/runtime-sdk-example.mjs) demonstrates collect → persistent approval → report writing with a local host adapter. It needs no Git repository, Native change, Comet initialization, model provider, or network access:

```bash
pnpm build
node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/runtime-example
node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/runtime-example --approve
```

The first process collects the report and saves a pending Wait. The second process reopens the same Run. The report is written only after the explicit `--approve` decision. The output is `./.tmp/runtime-example/published/report.md`.

## Define a workflow

```ts
const reportWorkflow = {
  id: 'report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: skill({ ref: 'research.collect' }),
    approve: approval({ proposalFrom: 'collect' }),
    publish: tool({ ref: 'reports.write' }),
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};
```

`skill`, `tool`, `approval`, and `childWorkflow` are convenience builders; steps can also be declared by their `type`. A workflow contains steps, input bindings, and transitions—not a model client or platform runtime. It supports branches, bounded activations, parallel joins, child workflows, synchronous JSON Schema validation, and versioned business validators.

Each Run pins hashes for its root workflow and transitive child workflows. To resume, register the same workflow ids, versions, and contents. If a definition changes under the same version, Runtime rejects further mutations with `WORKFLOW_CHANGED` instead of interpreting old state with new logic.

## Execute Actions in the host

```ts
const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: '.comet/runtime' }),
  workflows: [reportWorkflow],
});

let run = await runtime.start({
  runId: 'report-2026-09',
  workflow: { id: 'report', version: '1' },
  input: { topic: 'runtime design' },
});

const action = run.actions.find((item) => item.status === 'pending')!;
run = await runtime.claim({
  runId: run.runId,
  actionId: action.id,
  attempt: action.attempt,
  inputHash: action.inputHash,
  executorId: 'my-agent-platform',
});

// Call the platform's existing Skill/tool capability here.
const claimedAction = run.actions.find((item) => item.id === action.id)!;
const result = await invokePlatformSkill(claimedAction, run);
run = await runtime.recordOutcome({
  runId: run.runId,
  outcome: {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: run.actions.find((item) => item.id === action.id)!.claim!.token,
    outcomeId: result.requestId,
    status: 'succeeded',
    output: result.output,
  },
});
```

The Action id, attempt, input hash, and claim token bind the returned Outcome to the current execution. Replaying the same Outcome is safe; stale attempts, conflicting reuse of an outcome id, unclaimed results, and incomplete results are rejected.

Alternatively, register a `RuntimeExecutor` and call `runtime.execute`. Each executor explicitly declares its id, capabilities, supported Actions, and execution function. `supports` runs before the claim is committed and should be a pure check. `execute` runs only after the claim is committed; if it throws or returns a result that cannot be committed, Runtime records an indeterminate Action and does not dispatch it again automatically. Runtime dispatches only through host-provided adapters; it does not discover or call platform tools itself.

## Waits, approval, and recovery

An `ask_user` step persists a Wait with a `proposalHash`. After showing the proposal to the user, submit their choice:

```ts
run = await runtime.resolveWait({
  runId: run.runId,
  waitId: wait.id,
  proposalHash: wait.proposalHash,
  decisionId: 'user-decision-001',
  choice: 'approved',
});
```

Use `reviseWait` to submit an edited proposal; a decision using the old hash is rejected. `inspect` revalidates the Run structure, Action ownership, receipt hashes, step sequences, and proposal hashes. When workflow definitions are registered, it also verifies the content of every pinned definition. A read-only `inspect` without definitions can show the state, but does not establish that the Run is ready to continue.

If JSON Schema or a business validator rejects an Outcome, Runtime persists the original result, its identity, and the rejection reason in the same Run snapshot before returning `OUTPUT_INVALID` or `OUTCOME_REJECTED`. The Action stays claimed and is not dispatched again automatically. Replaying the same content with the same ID returns the original rejection; changing content under that ID returns `OUTCOME_CONFLICT`. After reconciling and correcting the result, the host must use a new `outcomeId` with the original attempt and claim token. An attempt with a recorded result cannot be retried as "not executed", even if it is subsequently marked unknown.

If an Outcome is bound to an Action but a validator throws or workflow advancement fails, Runtime likewise persists the original Outcome before returning `OUTCOME_PROCESSING_ERROR`. The failed advancement does not leave partial outputs or new steps. The host should check the error and external side effects before submitting a corrected result under a new `outcomeId`. If an executor returns a value that cannot be serialized, Runtime cannot persist that value and marks the Action unknown for host reconciliation.

`createFileRuntimeStore` stores immutable, ordered revision snapshots and uses exclusive atomic publication and compare-and-swap to prevent concurrent writers from overwriting one another. `createMemoryRuntimeStore` is useful for tests or short single-process runs. If a filesystem does not support the required atomic hard-link publication, FileStore fails explicitly; it is not a distributed lock for shared network filesystems.

Runs persist their input, Action inputs, Outcome outputs, and proposal content. Do not put access tokens, API keys, or other credentials in these fields. Inject secrets at the execution boundary through the host's secret-management mechanism; `RuntimeInvocationContext` is not written to the Run snapshot.

An external side effect and local state cannot be committed as one atomic transaction. `execute` commits the claim before calling the host. If the executor disconnects, throws, or the process stops, the Action remains indeterminate and Runtime does not dispatch it again automatically. The host must inspect the external system and use `retry` only with explicit evidence that the effect did not happen. Idempotency keys and reconciliation are contracts between the host and target system; local CAS does not provide exactly-once side effects.

To resume, recreate Runtime with the same FileStore and workflow definitions, then call `inspect` or `next`. Continue without changing the pinned definition. If the definition is unavailable or changed, Runtime refuses execution; keep the old definition available or explicitly migrate the Run.

## Extension points

- `RuntimeStore`: replace persistence by implementing `read` and revision-based `compareAndSwap`.
- `RuntimeExecutor`: route Actions to the platform's existing Skills, MCP, CLI, or API capabilities.
- `RuntimeValidator`: apply versioned business acceptance before an Outcome advances the workflow; an Agent reporting success is not the same as acceptance. A validator can be called again after a CAS conflict, so keep it side-effect-free or repeatable.
- Workflow definitions: compose steps, transitions, joins, schemas, and child workflows without forking the scheduler.

The Store, Executor, and Validator are explicit dependencies. The SDK does not expose an observer or hook that can arbitrarily mutate a Run. A host can log command calls for observability, but cannot bypass CAS or outcome validation to change authoritative state.

## JSON CLI

For a platform Agent that can run commands but cannot import JavaScript:

```bash
comet runtime dispatch --request ./start.json --workflow ./report.workflow.json --root-dir ./.comet/runtime --json
```

Example `start.json`:

```json
{
  "operation": "start",
  "requestId": "host-request-001",
  "runId": "report-2026-09",
  "workflow": { "id": "report", "version": "1" },
  "input": { "topic": "runtime design" }
}
```

Each command processes one structured request and returns JSON containing `protocolVersion`, `requestId`, and either the Run or a machine-readable error. `inspect` can read a Run from a new process without a workflow file; provide the pinned definitions to verify their content or change state. If an external execution disconnects after claim, use `mark-unknown` to preserve the indeterminate fact. `retry` creates a new attempt only when given `reconciliation: { "resolution": "not-executed", "evidence": ... }`. Relative request, workflow, and root paths use the CLI invocation directory; `--project-root` is passed as explicit host context to executor-related interfaces.

## Scope

Runtime is a reusable deterministic orchestration core, not another Agent platform. It provides the Run/Action/Outcome/Wait protocol, workflow scheduling, persistence and recovery, approval, and acceptance extension points. The host continues to provide the Agent loop, system prompts, Skills, Hooks, Rules, MCP, sandbox, tool authorization, and model context. Restrictions expressed in platform prompts, Hooks, or tool policy must still be implemented and verified by that platform.
