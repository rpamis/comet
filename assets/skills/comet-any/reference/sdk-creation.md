# Creation actions and recovery

Read this page only when claiming, returning, confirming, or recovering the current Creator action. Save the request as temporary JSON and run `comet creator dispatch <name> --project <project> --request <temporary-json> --json`; do not edit Runtime state.

## Analysis action

The host claims only `analyze`, investigates actual Skills, and returns the analysis result. compile / verify / eval-preview / evaluate / preview / install are machine steps executed by the fixed `creator-local` executor through `comet creator next <name> --project <project> --json`; the host must not claim these machine Actions, assign them to `creator-host`, or supply fabricated success results. When `next` stops at a host action or user decision, handle the returned current Action or Wait.

First read `analyze` from the current `actions`, submit `operation: claim`, and preserve `runId`, `actionId`, `attempt`, and `inputHash`. Use `executorId: creator-host`, an actual `sessionId`, a unique stable `claimToken`, and genuinely available `capabilities: [skill-load, handoff]`. Analyze only after a successful claim.

Return `operation: record-outcome`. Preserve the same Action identity and claimToken in `outcome`, using a unique outcomeId, actual status, and output. Successful output includes:

- `summary`: explain the goal and selected workflow.
- `failurePaths`: at least one concrete failure and recovery path.
- `limitations`: state capability and evidence limits.
- `proposal`: a declarative plan accepted by public `@rpamis/comet/applications/compiler`, with `schema: comet.workflow.application.plan.v1`, manifest, composition, and modules. The compiler generates workflows rather than copying a complete hand-written createApplication.
- `evaluation` (optional): agent, model, judgeAgent, judgeModel, maxTurns, and timeoutSeconds. Defaults use the creation host, 8 interaction turns, and a 1200-second total timeout, with 2–4 cases. These limits bound execution, turns, and time, rather than imposing a dollar cap. Credentials and undeclared fields are rejected.

The manifest fixes the standalone application identity, base workflow, Runtime version, and each real Skill's root, content hash, and adapter contract. Dependency references use absolute directories so the compiler can read actual bytes. The SDK generates the default Rule and Guard from the confirmed workflow declaration; manifest.rule references the Rule shipped in the complete package. Modules provide only business execution ports, validators, and declared pure transition handlers. Additional Guards may only narrow the default protection; they cannot permit writes to SDK control resources or alter the current Run. Credentials must not enter source. Public types and current commands define the supported plan structure and composition.

After successful analysis, run `next` to obtain the actually assembled plan. Inspect the user-visible steps, artifacts, Skill bindings, and capability limits against its effective graph; showing only the initial intent summary is insufficient.

## User decisions

Only a pending Wait in the current `waits` accepts a decision. After obtaining the user's explicit choice, submit `operation: resolve-wait`, preserving `runId`, `waitId`, and `proposalHash`, with a unique decisionId and a choice supported by that Wait. Do not approve or skip for the user.

Plan approval and installation approval are separate decisions, corresponding to confirm-plan and confirm-install. Stale hashes, installation-target drift, or dependency changes reject approval; after revise, analyze, assemble, and show the current plan again. Preview's files and target describe the complete-package export; distribution describes formal SDK distribution, including the fixed version, dependencies, host entry, and actual Rule/Hook configuration plan. The same current installation Wait approves both parts; drift in either rejects installation. Report missing Hook support explicitly. Only actual execution evidence establishes Hook acceptance.

Only the current Creator definition (version: 3) is provided. Preserve unapproved older creation Runs and their artifacts, then create the current creation afresh without migrating old records or reusing old approval. Compilation and validation lead to confirm-eval (evaluate / skip / revise). The local executor calls independent Eval with a complete application snapshot and fixed experiment identity. Passing evaluation proceeds to installation preview; failed or incomplete evaluation reaches review-eval (retry / revise / skip). Failures cannot be filtered into passes; skip retains failure or unevaluated status. Retry reuses cached cases, and revisions prefer the original fixed cases. Reports bind the current application content, dependencies, settings, and case set without establishing acceptance on other platforms.

In v3, install-target is a project-local complete-package export directory, separate from SDK-managed directories and platform Skill entries. After approval, Creator exports the confirmed bytes and formally distributes the current host's project entry, Rule/Hook, and Runtime dependencies through the SDK. Do not add a private application installer. Verify actual Skill loading, Rule configuration, Hook execution, SDK Run behavior, and business assertions separately; configuration files cannot replace actual host events.

An explicit read-only installation-preview failure in v3 leads to review-install (retry / revise / rejected), preserving reason and noFilesWritten. Retry reads current configuration and generates a new preview, which still needs approval at a new confirm-install. Revise returns to analyze; rejected stops while preserving the current work. Reconcile actual installation writes and uncertain results as described below; preview retry cannot blindly repeat installation.

## Interruption and uncertain results

A new process reads the same Run through status / next. For a running or unknown Action, first reconcile whether the original execution occurred. When marking a result uncertain, use mark-unknown and preserve the original Action and attempt; retry must carry the current recovery proposalHash and actual reconciliation. A timeout does not justify rerunning installation that has already occurred.

Compilation and installation can reconcile actual files against the fixed plan; partial writes, file drift, or unavailable capabilities remain blocked with the current work preserved. v3 installation must reconcile both the exported package and formal platform installation; an export directory alone does not establish completion. Repairs do not delete unrelated files or overwrite an existing installation. Creator v3 targets project-level installation; distribution entry points provide the corresponding rules and evidence for user-level installation, upgrades, uninstallation, and formal business samples.
