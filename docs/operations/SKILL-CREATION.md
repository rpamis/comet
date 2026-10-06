# Create and deliver workflow applications with `/comet-any`

Describe a goal and `/comet-any` investigates real Skills, shows the workflow, artifacts, checks, failure paths, and capability limits. After the user approves the plan, Creator compiles a complete SDK application package, actually loads it for validation, and shows an installation preview. Creation and business execution have separate Runs; queries and recovery preserve the original Run ID.

Supported starting points are optional Native steps, execution guidance, and additional review; Classic full, hotfix, and tweak compositions; and standalone SDK workflows with their own business rules. Default Native behavior remains available. The report approval sample does not automatically inherit Native independent verification.

## Start and continue

Invoke `/comet-any` in the Agent surface and describe the goal, required Skills, and delivery location. The host handles the current Action through public CLI commands:

```bash
comet creator guide --project . --json
comet creator candidates --project . --json
comet creator start <name> --project . --goal "<goal>" --install-target .claude/skills/<application> --host claude-code --json
comet creator status <name> --project . --json
comet creator next <name> --project . --json
```

The host reads and loads real Skills for `analyze`, returning content-backed adapter contracts, fixed hashes, and implementation modules. The machine executor handles `compile`, `verify`, `preview`, and `install` through `next`. Plan and installation approval bind separate current Waits; neither approval grants business publication approval.

## Complete packages and local installation

A package contains `application.json`, the entry Skill, execution and validation modules, and fixed Skills, scripts, and resources. Missing or changed dependencies, mismatched output Schemas, and unregistered validators block progression. Completion strings cannot replace actual artifacts and checks.

Creator installs directly into the approved project-relative target. Use these commands for complete exports, managed installation in either scope, or upgrades:

```bash
comet application export <package>/application.json <empty-export-directory> --project . --json
comet application install <export>/application.json --project . --scope project --host claude-code --json
comet application install <export>/application.json --project . --scope user --host codex --json
```

Without `--confirmation-hash`, install returns a preview without writing the target: destination, scope, files, fixed dependencies, host entry, and conflicts. After explicit user approval, pass the current preview hash to the same command. Changed content, destinations, or existing installations require another preview. `--user-root <directory>` chooses an isolated user directory; the default user scope uses the current HOME. Omit `--host` to install the managed package without host Skills.

Managed versions live in `.comet/applications/<id>/versions/<content-hash>/` under the target. Upgrades require `--upgrade`; different content under the same version is rejected. New Runs use the current default version. Active Runs continue from their saved original `packageRoot`, without definition migration. Conflicting fixed Skills or host names preserve existing files.

```bash
comet application uninstall <id> --project . --scope user --json
# After user approval, add --confirmation-hash <current-hash> to the same command.
```

Uninstall cancels the default entry for new Runs and the host entry owned by this installation, while retaining every version and dependency. A user application may have active Runs in other projects, so uninstall does not use a single project's inventory to delete versions and does not provide an implicit purge. Its result explicitly lists retention.

## SDK samples and verification scope

`prepareWorkflowApplicationExample` from `@rpamis/comet/applications/compiler` generates complete local samples for `native`, `classic-full`, `classic-hotfix`, `classic-tweak`, or `standalone`. Pass an existing isolated `projectRoot`, an empty `packageRoot`, and `base`; it returns `application.json`. It does not start a Run, submit user decisions, or perform external operations.

The Native sample reviews each ordinary candidate, Supervisor parent, Child, and integration candidate's own `candidate.txt`. Classic adds actual artifact review after the original Build check. The real host loads independent package Skills for original domain work; start input includes the current project's absolute `projectRoot` so writes are checked against the actual workspace. The standalone report sample drafts, checks sources, waits for approval, and publishes locally; rejection, revision, and cold recovery retain the original Run.

Definition checks, focused tests, generated Runtime, actual npm consumers, real host Hooks and handoffs, and model Eval provide separate evidence. Successful compilation does not establish complete business or production acceptance. Missing, failed, timed-out, or unaudited model runs remain incomplete.

## Recovery and boundaries

After interruption, inspect the original Action and retain its attempt, input hash, and claim identity. Do not repeat completed work. Reconcile unknown external results through the adapter: submit the original result when executed; use SDK retry only after evidence confirms non-execution; block when reconciliation is unavailable. Credentials enter only through execution context, never through plans, packages, Runs, reports, or Agent configuration.

Only local export and installation are supported, without remote Git distribution or a central team service. The legacy generator, old Creator commands, and `workflow-protocol.json` format have been removed. Legacy formats require regeneration, preserve user files, and are not converted or migrated.

## Advanced backend reference

```bash
comet creator dispatch <name> --project . --request <current-action-request.json> --json
comet runtime dispatch --application-file <package>/application.json --project-root . --request <request.json> --json
comet runtime dispatch --application <id> --project-root . --request <same-run-request.json> --json
```

Use the current response for claim, record-outcome, or resolve-wait and the actual host session ID. Independent advanced `comet bundle`, `comet publish`, and `comet eval` capabilities remain available; they no longer implement the old SDK Creator generation chain.
