# Creation actions and recovery

Read this page only when claiming, returning, confirming, or recovering the current Creator action. Save the request as temporary JSON and run `comet creator dispatch <name> --project <project> --request <temporary-json> --json`; do not edit Runtime state.

## Analysis action

The host claims only `analyze`, investigates actual Skills, and returns the analysis result. compile / verify / preview / install are machine steps executed by the fixed `creator-local` executor through `comet creator next <name> --project <project> --json`; the host must not claim these machine Actions, assign them to `creator-host`, or supply fabricated success results. When `next` stops at a host action or user decision, handle the returned current Action or Wait.

First read `analyze` from the current `actions`, submit `operation: claim`, and preserve `runId`, `actionId`, `attempt`, and `inputHash`. Use `executorId: creator-host`, an actual `sessionId`, a unique stable `claimToken`, and genuinely available `capabilities: [skill-load, handoff]`. Analyze only after a successful claim.

Return `operation: record-outcome`. Preserve the same Action identity and claimToken in `outcome`, using a unique outcomeId, actual status, and output. Successful output includes:

- `summary`: explain the goal and selected workflow.
- `failurePaths`: at least one concrete failure and recovery path.
- `limitations`: state capability and evidence limits.
- `proposal`: a declarative plan accepted by public `@rpamis/comet/applications/compiler`, with `schema: comet.workflow.application.plan.v1`, manifest, composition, and modules. The compiler generates workflows rather than copying a complete hand-written createApplication.

The manifest fixes the standalone application identity, base workflow, Runtime version, and each real Skill's root, content hash, and adapter contract. Dependency references use absolute directories so the compiler can read actual bytes. Modules provide only fixed execution ports, validators, and declared pure transition handlers; credentials must not enter source. Public types and current commands define the supported plan structure and composition.

After successful analysis, run `next` to obtain the actually assembled plan. Inspect the user-visible steps, artifacts, Skill bindings, and capability limits against its effective graph; showing only the initial intent summary is insufficient.

## User decisions

Only a pending Wait in the current `waits` accepts a decision. After obtaining the user's explicit choice, submit `operation: resolve-wait`, preserving `runId`, `waitId`, and `proposalHash`, with a unique decisionId and choice (approved / revise / rejected). Do not select approved for the user.

Plan approval and installation approval are separate decisions, corresponding to confirm-plan and confirm-install. Stale hashes, installation-target drift, or dependency changes reject approval; after revise, analyze, assemble, and show the current plan again. Use preview's files and target for the concrete installation explanation.

## Interruption and uncertain results

A new process reads the same Run through status / next. For a running or unknown Action, first reconcile whether the original execution occurred. When marking a result uncertain, use mark-unknown and preserve the original Action and attempt; retry must carry the current recovery proposalHash and actual reconciliation. A timeout does not justify rerunning installation that has already occurred.

Compilation and installation can reconcile actual files against the fixed plan; partial writes, file drift, or unavailable capabilities remain blocked with the current work preserved. Repairs do not delete unrelated files or overwrite an existing installation. Creator's direct installation targets a new directory within the project; distribution entry points provide the rules and evidence for user-level installation, upgrades, uninstallation, and formal business samples.
