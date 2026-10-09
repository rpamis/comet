# Creation actions and recovery

Read this page only when claiming, returning, confirming, or recovering the current Creator action. Save the request as temporary JSON and run `comet creator dispatch <name> --project <project> --request <temporary-json> --json`; do not edit Runtime state.

## Analysis action

The host claims only `analyze`, investigates real Skills, and returns the authored result. compile / verify / eval-preview / evaluate / preview / install are executed by the fixed `creator-local` executor through `next`; do not claim or return results for these machine Actions. When `next` stops, handle the returned Action or Wait.

First read `analyze` from the current `actions`, submit `operation: claim`, and preserve `runId`, `actionId`, `attempt`, and `inputHash`. Use `executorId: creator-host`, an actual `sessionId`, a unique stable `claimToken`, and genuinely available `capabilities: [skill-load, handoff]`. Analyze only after a successful claim.

Return `operation: record-outcome`. Preserve the same Action identity and claimToken in `outcome`, using a unique outcomeId, actual status, and output. Successful output includes:

- `summary`: explain the goal and selected workflow.
- `failurePaths`: at least one concrete failure and recovery path.
- `limitations`: state capability and evidence limits.
- `proposal`: a declarative plan accepted by public `@rpamis/comet/applications/compiler`, with `schema: comet.workflow.application.plan.v1`, manifest, composition, and modules. The compiler generates workflows rather than copying a complete hand-written createApplication.
- `proposal.documents`: the Agent-authored complete entry `SKILL.md` and `rules/workflow-guard.md` business rules, with any `references/*.md` actually referenced by the documents. Missing or empty required documents are rejected during analysis, preparation, or confirmation; templates do not substitute for completed authoring.
- `evaluation` (optional): agent, model, judgeAgent, judgeModel, maxTurns, and timeoutSeconds, also available through `--eval-config <JSON-file>`. Confirm the actual settings in the evaluation preview. Credentials come only from the execution environment.

The manifest specifies application identity, base workflow, Runtime version, and Skill dependencies. Supply absolute dependency directories, actual content hashes, and adapter contracts; the compiler reads the fixed bytes. The SDK preserves `documents` and appends execution protocol and common protection rules to the same files. manifest.rule references the Rule. modules supply business execution ports, validators, and declared pure transition handlers; they do not take over the SDK state machine. Additional Guards may only narrow protection and cannot permit writes to SDK control resources. Business Rules do not grant Runtime permissions or replace user approval.

Example `documents` alongside manifest / composition / modules in proposal:

```json
{
  "documents": {
    "SKILL.md": "---\nname: report-review\ndescription: Generate a source-backed report for review and publication.\n---\n\n# Report review\n\nStart when the user needs to review a report before publication. Read the goal and sources, then invoke the fixed report Skill to draft it. Show the current draft and wait for user approval before publishing that draft. Preserve rejected drafts and review revisions again. Before completion, validate the report, source citations, and published artifacts. See references/source-review.md for detailed source checks.\n",
    "rules/workflow-guard.md": "# Report business rules\n\nUse only the supplied sources and make conclusions traceable. Preserve rejected drafts and review records. Review content changes again; published content must match the approved draft.\n",
    "references/source-review.md": "# Source checks\n\nCheck each source before drafting. Record evidence for every conclusion; clarify missing evidence first.\n"
  }
}
```

The example id is report-review. The actual frontmatter name must match manifest.id, and description and body must be nonempty. The original `plan.documents` participate in the current plan hash; use revise and reconfirm after changing them.

After successful analysis, run `next` to obtain the actual assembled result. Inspect steps, artifacts, Skill bindings, and capability limits against the effective graph, then show the plan.

## User decisions

Only a pending Wait in the current `waits` accepts a decision. After obtaining the user's explicit choice, submit `operation: resolve-wait`, preserving `runId`, `waitId`, and `proposalHash`, with a unique decisionId and a choice supported by that Wait. Do not approve or skip for the user.

Approve the plan and installation separately through confirm-plan and confirm-install. Use revise after stale hashes or content drift; analyze and show the plan again. Installation preview's files / target describe the export; distribution describes the fixed version, dependencies, host entry, and Rule/Hook configuration. The current installation Wait approves both parts, and either changing requires confirmation again. Explain missing Hook support or required activation in the preview.

After compilation and validation, confirm-eval accepts evaluate / skip / revise. evaluate fixes the complete application snapshot and experiment identity. A pass leads to installation preview; failure or incomplete execution leads to review-eval (retry / revise / skip). Retry reuses the original cases, and revisions prefer them. skip retains the actual failed or unevaluated status.

install-target is a project-local export directory, separate from SDK-managed directories and platform Skill entries. After approval, Creator exports the fixed bytes and uses formal SDK installation for the project entry, Rule/Hook, and Runtime dependencies; no private application installer is needed. Use the SDK distribution entry for user-scope installation, upgrades, and uninstall.

Read-only preview failure reaches review-install with reason and noFilesWritten. retry generates a new preview and waits for a new confirm-install; revise returns to analyze; rejected stops and preserves the current work. Reconcile existing writes or uncertain results as described below.

## Interruption and uncertain results

A new process calls status / next to read the same Run. Reconcile a running or unknown Action against whether its original execution occurred. Use mark-unknown when needed, preserving the original Action and attempt. retry requires the current recovery proposalHash and actual reconciliation; a timeout does not justify repeating an installation that already occurred.

Check the actual compiled package, export, and formal platform installation. An export directory alone is insufficient evidence of completion. Partial writes, file drift, or results that cannot be confirmed block progress. Preserve unrelated files and existing installations during recovery.
