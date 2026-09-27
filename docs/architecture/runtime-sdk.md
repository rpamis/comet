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

`skill`, `tool`, `approval`, `childWorkflow`, and `evidence` are convenience builders; steps can also be declared by their `type`. A workflow contains steps, input bindings, and transitions—not a model client or platform runtime. It supports branches, bounded activations, parallel joins, child workflows, synchronous JSON Schema validation, and versioned business validators.

To update business state after accepted events, define a `stateSchema` and a versioned `transitionHandler`, then register the corresponding `transitionHandlers` with `createRuntime`. If JSON Schema cannot express domain state constraints, the Workflow can also declare a versioned `stateValidator`; register a synchronous, side-effect-free `RuntimeStateValidator`. It runs at start, on recovery reads, and before every transition is committed. Put an invariant initial state in the Workflow's `initialState`; when multiple changes share one Workflow definition, pass `initialState` to `runtime.start` instead. Providing both is rejected, as is starting a workflow with `stateSchema` but no initial state. The handler receives an accepted Action Outcome, user decision, or evidence receipt and returns the new `state` and `next` steps. The SDK validates the state and declared transition edges, then commits them with the event result in one Run revision. Missing pinned handler or validator versions, or invalid state, prevent advancement. The Run saves an initial-state hash so an idempotent start cannot silently replace it.

A string in `next` activates a declared step once; `{ stepId, input }` can activate the same step multiple times with different JSON inputs. Each activation creates a distinct Action. Its `input.activation` is persisted and included in the Action input hash. Duplicate activations and undeclared transitions are rejected. An explicit empty array adds no steps for that event, for example while previously dispatched parallel Actions remain outstanding. Activation input is also persisted and must not contain credentials. Native Supervisor uses this mechanism for the normal two-Child dependency path, including independent parent verification, delivery to the target branch, Archive, and temporary worktree cleanup. Parallel Child integration and integration checks advance serially in Run order; public `native next` returns all `pendingActions`. A failed integration check can become a host repair Action bound to the original check and commit, followed by a new check of the repaired commit. Cleanup rejects dirty worktrees or unmerged branches; if the host stops during cleanup, it can reconcile and complete the original Action in a new process. Drift before delivery or after partial cleanup is rejected; other failures, unknown results, and concurrent drift within a Git operation have not been fully accepted, so this does not establish complete Supervisor acceptance.

Native's application exposes interrupted recovery as `comet native archive <change> --recover`. It handles only the unique `unknown` Supervisor delivery, Archive, or cleanup Action, and requires the host to confirm that the original execution has stopped. Delivery recovery commits the original Action's result only when the target branch still points exactly to the verified integration commit. It rejects an undelivered or drifted target without repeating the fast-forward. Cleanup recovery checks the worktrees and branches before safely completing remaining work. Ordinary `archive` does not automatically redispatch an action whose result is unknown.

For artifacts not produced directly by an Action Outcome, use an `await_evidence` step with an evidence kind and versioned validator. Register it in `evidenceValidators`, then call `recordEvidence({ runId, evidenceId, kind, ref, contentHash, submissionId, expectedRevision })`. The validator receives an isolated copy of the current Run, so it can check ownership before checking reference scope and the current content hash. The SDK records the receipt and advances only if validation succeeds and the revision is unchanged. External files can change again after validation; later dependent actions must recheck them against the recorded hash. If the workflow declares an `on: invalidated` transition for the Wait, the host can call `invalidateEvidence` after a receipt is rejected. The SDK revalidates the original receipt, and only if it is now invalid records the reason, closes that Wait, and follows the declared transition without replaying earlier successful Actions. The corresponding CLI operation is `invalidate-evidence`. Without an invalidation transition, or while the receipt is still valid, the Run remains waiting. The JSON CLI cannot register custom handlers and validators for arbitrary workflows; its built-in Native and Classic applications register their own.

For user-requested changes during a workflow, declare an externally activated execution step with `commands: { revise: 'revise.step' }`, then call `dispatchCommand({ runId, expectedRevision, commandId, name: 'revise', input })`. To constrain the current stage, input, or external artifacts, use `{ revise: { stepId: 'revise.step', validator: { id, version } } }` and register the matching `commandValidators` with `createRuntime`. The validator runs before old work is canceled. A rejection leaves the Run unchanged, and recovery requires the same version. In one CAS commit, the SDK cancels unclaimed Actions and unresolved Waits, saves the command receipt, and creates a new Action. The same `commandId` and input can be replayed idempotently. A claimed Action or one with an unknown result cannot be interrupted this way; the host must reconcile it first. The command itself does not rewrite business state or external files. A versioned transition handler updates the Run only after the executor completes the side effect and records an accepted Outcome. The JSON CLI's `dispatch-command` operation requires explicit `expectedRevision`, `commandId`, `name`, and `input`.

New built-in Native and Classic changes use their respective SDK Workflow Applications by default; existing changes remain owned by the Runtime that created them. Native `spec remove`, `spec disassociate`, `next --revise-requirements`, and `archive` submit commands or advance existing Actions according to SDK ownership; `doctor <change>` diagnoses the same Run. `native check` and `spec sync` remain legacy-only entry points: checks for SDK changes run through Run Actions, while changes to references or acceptance requirements return to Shape for revision and confirmation. On the SDK path, `archive --dry-run` read-only displays pending Run Actions; it is not the legacy Runtime's preflight hash check.

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
- `RuntimeStateValidator`: check domain state at initialization, on recovery reads, and before transition commits; use synchronous, side-effect-free checks.
- `WorkflowTransitionHandler`: compute business state and subsequent steps from an accepted event; keep it pure and do not execute tools or write the Run directly.
- `RuntimeEvidenceValidator`: verify external evidence references and content hashes; concurrent retries may invoke it more than once, so do not rely on one-time side effects.
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

The built-in Native and Classic Workflow Applications can be registered with `--application native|classic-full|classic-hotfix|classic-tweak`. Their Runs use fixed project paths, `.comet/runtime/sdk-runs/native` and `.comet/runtime/sdk-runs/classic`. Both workflows may use the same change name, but callers cannot select another `--root-dir` or combine `--application` with `--workflow`. Pass the matching `--application` whenever advancing that Run. In addition to the generic operations above, `execute` claims and runs an application-registered Executor, `record-evidence` submits declared evidence waits, and `invalidate-evidence` resumes evidence that has been verified invalid and has a declared recovery transition. The host still supplies real initial state, artifacts, and external Agent results. Native `new` and Classic `state init` now create SDK Runs by default; existing legacy changes continue under their original Runtime.

## How Comet uses the SDK

Native Verifier and Classic `comet check` also use the SDK Action lifecycle. Both use Actions to bind execution inputs, claim identity, and returned results. After an interruption, the saved attempt provides the evidence needed to decide whether to reconcile or rerun. Classic persists a claimed Action in its existing trajectory before starting a check command, then records the result on that same Action. Reusing a check across scopes creates a separate Action for the target scope. Older Classic trajectories without Actions remain readable.

For SDK-owned Classic full/hotfix/tweak changes, `comet guard <change> build` performs a read-only preflight. `--apply -- <program> [args...]` then completes the Build Action and runs a real check. If exactly one project build command can be inferred, `--apply` may omit the program arguments. Checks and receipts enter the same SDK Run, which advances to Verify only on success. Previous failed checks, Actions with unknown results, and stale inputs are not inferred away.

For those Classic changes, `comet guard <change> verify --report <ref>` performs a read-only report check. `--apply -- <program> [args...]` submits report evidence, runs a real verification check, and records its receipt; only success advances to Archive. Invalid report content or language, changes to an accepted report, failed checks, and unknown results block Archive. If only the receipt submission was interrupted after a successful check, `--apply` without a program can recover it without rerunning the check.

In Archive, SDK-owned Classic changes can use `comet state propose-archive` to record a delivery proposal and `decide-archive` to submit a user decision bound to its proposal hash. After approval, `comet guard <change> archive --apply` or `comet archive <change>` revalidates the branch and Verify evidence, then archives OpenSpec files once. The Agent remains responsible for the authorized Git commit, push, or PR; `comet state complete-delivery` verifies the actual commit and corresponding remote result before completing the Run. Archive commands do not create commits or expand user authorization on their own.

Native ordinary changes and Classic full/hotfix/tweak each have a distinct SDK Workflow Application accessible through `comet runtime dispatch --application`. They retain separate stages and acceptance rules while the SDK handles general scheduling and commits. New changes use the SDK path by default, while existing legacy changes continue under their original Runtime. Uncovered legacy command entry points and real platform execution still require their own acceptance evidence; SDK unit tests do not establish it.

## Scope

Runtime is a reusable deterministic orchestration core, not another Agent platform. It provides the Run/Action/Outcome/Wait protocol, workflow scheduling, persistence and recovery, approval, and acceptance extension points. The host continues to provide the Agent loop, system prompts, Skills, Hooks, Rules, MCP, sandbox, tool authorization, and model context. Restrictions expressed in platform prompts, Hooks, or tool policy must still be implemented and verified by that platform.
