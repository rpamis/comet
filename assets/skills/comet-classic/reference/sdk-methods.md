# Classic SDK execution methods

Read only the current phase when `runtimeFormat: sdk`. The main Skill and latest continuation supply commands, Actions, Waits, and templates; this reference defines the work and completion conditions.

Use current configuration.language for artifacts and external Skill inputs. At phase entry, when receiving work as a new Agent, or after context recovery, first follow the [task context protocol](scripts.md#task-context-and-artifact-language) using the current continuation or claimed Action's `contextRequest`. Pass the phase, task scope, actual workspace and valid configuration when dispatching child tasks. Preserve saved facts and valid evidence.

## Phase entry and recovery

Reuse the latest continuation, configuration, phase, revision, and paths for the same change, workspace, and Run. Query `comet state next <change-name> --json` only on cold recovery, after external changes, when the response is stale, or when required fields are missing. Do not fetch the same snapshot again at phase entry; Runtime still validates versions and evidence on writes.

New SDK changes use `comet-state.yaml`; historical `.comet.yaml` files stay in place. If both exist, including a dangling symlink, stop and preserve the files without renaming or overwriting either. Use the current response for paths, Runtime ownership, and layout.

When the response includes `agent.continuation.mode`, follow [automatic handoff](auto-transition.md); mode takes precedence over the old `nextAction.kind`. Distinguish manual handoff, waiting for the original executor, and outcome reconciliation. Submit `completion` only after completing the actual work. Use each phase's kind-based routing only for older responses without mode. Reconcile the original Action when its outcome is unknown; do not dispatch external work again.

For denied Verify edits or a pending review proposal, read [edit review](../../comet/reference/edit-review.md). Load only the references needed for the current phase and an actual exception.

## Entry and artifacts

For a new full, hotfix, or tweak change, first check required capabilities under [host capability check](../../comet/reference/host-check.md), choose isolation under workspace.md, and enter the returned projectRoot. All three flows use this order:

1. Check the current directory, Runtime ownership, and existing OpenSpec change. If an SDK Run exists, resume its current Action and fill missing artifacts; do not repeat OpenSpec `new change` or `state init`.
2. For a genuinely new change, create the OpenSpec base directory first; load the creation Skill below only in this case. If that directory exists after interrupted initialization, inspect its actual artifacts with OpenSpec `status --change <name> --json`, confirm ownership, and finish initialization while preserving files.
3. After base creation succeeds, immediately run `comet state init <name> <full|hotfix|tweak> --isolation <selected-isolation>`, then `comet state select <name>`. Do not initialize Runtime before OpenSpec `new change`, which rejects an existing directory. Preserve the OpenSpec directory on failure and resume only unfinished steps.
4. Once the SDK Run exists, fill the currently required artifacts through `status` and `instructions`, then preview Open and obtain approval through the phase entry. Stop to establish ownership if unclear; do not overwrite files or create a second Run.

When creating the base directory for a genuinely new change:

**Immediately execute:** Use the Skill tool to load the openspec-new-change skill. Skipping this step is prohibited.

<!-- external-openspec-skill-override -->

After the skill loads, run commands through `comet classic openspec -- <args...>` using bound `<classic-*>` paths. After base creation, return to initialization above before filling artifacts. Hotfix proposals describe the defect, root cause, and repair goal; tweak proposals describe motivation, goal, and scope. Both keep a concise design.md and tasks.md. Create delta specs when acceptance changes; a delta spec alone does not escalate tweak.

## Design

Read the current proposal, tasks, delta specs, and relevant existing design. Expand source text when summaries omit acceptance requirements. OpenSpec remains the behavior authority; technical design references it rather than creating another specification. Reuse confirmed requirements.

**Immediately execute:** Use the Skill tool to load the Superpowers brainstorming skill. Skipping this step is prohibited.

After the skill loads, use its exploration and design methods with the bound change, workspace, facts, constraints, and source references. For decisions that cannot be inferred and affect the result, use decision-point.md to present a question, recommendation with reasons, options, and effects. Proceed when information is sufficient, without a minimum question count. Compare alternatives only for real tradeoffs; explain failure paths and verification for risky interfaces, migrations, security, and concurrency.

Keep brainstorm-summary.md current, marking candidates separately from confirmed facts. Explain specific Spec Patches and obtain agreement before editing delta specs; clarify substantial scope changes again. When reconfirmation is needed, explain changes and effects under [reconfirmation after requirement changes](decision-point.md#reconfirmation-after-requirement-changes). Confirm the final design once through the main Skill's Design Wait, retaining the current Design proposal hash. External Skills must not add document approval, start planning or implementation, or change workspaces.

After approval, update the single Design Doc: reuse its recorded reference, otherwise prefer the change's design.md. If project convention requires a separate document, the OpenSpec design contains only a summary and link. Frontmatter contains only `comet_change: <change-name>`, `role: technical-design`, and `canonical_spec: openspec`. Cover the solution, tradeoffs, risks, and testing, matching the approved proposal before submission. Resume from saved summaries, sources, and the current Wait; complete only missing work.

## Build

Before implementing with the chosen strategy, check its planning, implementation, TDD, and review capabilities under [host capability check](../../comet/reference/host-check.md). Reuse known available capabilities; do not defer discovering a missing required method until implementation.

Reuse the workspace bound during Open. When configuration needs to be presented, completed, or changed, read [presenting execution configuration](decision-point.md#presenting-execution-configuration) and show the current change's values, meanings, and approval status. Field choices and requirements are:

| Setting     | Choices and requirements                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| build_mode  | autonomous plans and implements freely; executing-plans follows a fixed plan; subagent-driven-development uses implementers coordinated by the main session; direct has the current session implement the plan directly |
| tdd_mode    | tdd records real RED/GREEN; direct does not require RED/GREEN but still runs relevant checks and defect regressions                                                                                                     |
| review_mode | off skips automatic review; standard reviews risky tasks and final integration; thorough reviews tasks or segments and final integration                                                                                |

Full autonomous requires standard or thorough. Full direct requires explicit selection and `direct_override: true`, retaining design, planning, and verification. Set `subagent_dispatch: confirmed` only for subagent-driven-development, otherwise null.

Reuse an existing pending Wait's proposal; when the proposal changes, reconfirm through the existing mechanism instead of reusing stale approval. After the user explicitly chooses the complete configuration, use the main Skill's `propose-build --confirmed` to save the proposal and approval. Retain the Wait when a decision is missing.

Tasks and completion belong in tasks.md. Preserve IDs. The plan references design and task authority through `<!-- comet-task-authority: <classic-task-authority-ref> -->` and each `<!-- comet-task-ref:<task-id> -->`, without duplicate checkboxes. Describe scope, dependencies, constraints, and acceptance; explain risky choices, failure handling, and rollback. Preserve frontmatter change, design-doc, and the original pre-implementation base-ref on recovery. Reuse a valid plan.

Autonomous writes the plan directly. When another strategy needs planning:

**Immediately execute:** Use the Skill tool to load the writing-plans skill. Skipping this step is prohibited.

After the skill loads, use only its writing and inspection methods, then return to the current Run. For executing-plans implementation:

**Immediately execute:** Use the Skill tool to load the executing-plans skill. Skipping this step is prohibited.

After the skill loads, implement the fixed plan under current configuration. For subagent-driven-development:

**Immediately execute:** Use the Skill tool to load the subagent-driven-development skill. Skipping this step is prohibited.

After the skill loads, the main session coordinates implementers. Read subagent-dispatch.md before delegation and accept work packages by task ID. External Skills do not create workspaces, change configuration, or finish delivery. Preserve dispatch failures rather than silently changing strategy.

For non-autonomous tdd, the implementer loads this once before implementation:

**Immediately execute:** Use the Skill tool to load the test-driven-development skill. Skipping this step is prohibited.

After the skill loads, follow the confirmed tasks. For tdd, demonstrate failure caused by the missing behavior, implement, and record GREEN. Reuse valid evidence without reenacting implementation or reverting code to fabricate RED. Run checks according to risk. Build reviews tasks or segments; Verify owns the single final integration review. Resolve CRITICAL/IMPORTANT findings. If required independent review is unavailable, report the block rather than substituting implementer self-review. Check off tasks after actual completion, then submit implementation and checks through the Run.

Evaluate changed goals, public behavior, acceptance, and risk. Repair omissions within confirmed scope directly; for material scope expansion or redesign, ask the user under [reconfirmation after requirement changes](decision-point.md#reconfirmation-after-requirement-changes). Task and file counts alone do not restart the full workflow. Reproduce failures and establish their cause before repair and verification; consult debug-gate.md when external debugging methods are needed, retaining the current Run.

## Verify

Inspect completed tasks, actual diff scope, compilation and relevant tests, security, goals, every acceptance scenario, and agreement with current specifications and technical design. Risk determines depth; file count alone does not require the full repository suite. Tweak delta specs are normal artifacts whose consistency must be verified.

Standard or thorough review requires an independent reviewer for the final diff and the single final integration review. Reuse a valid review covering current inputs; supplement affected parts after changes. Record off-mode omissions; full autonomous still requires independence. Autonomous does not depend on external verification or review Skills. When other strategies begin actual verification:

**Immediately execute:** Use the Skill tool to load the verification-before-completion skill. Skipping this step is prohibited.

After the skill loads, use its verification methods with current candidates and valid evidence. For non-autonomous standard or thorough final integration review:

**Immediately execute:** Use the Skill tool to load the requesting-code-review skill. Skipping this step is prohibited.

After the skill loads, review the current final diff, reuse valid independent results, and do not append a second final review. For full specification verification:

**Immediately execute:** Use the Skill tool to load the openspec-verify-change skill. Skipping this step is prohibited.

<!-- external-openspec-skill-override -->

After the skill loads, use `comet classic openspec -- <args...>` and bound `<classic-*>` paths. Check tasks, proposal, capability scenarios, high-level and technical design, and consistency between delta specs and design.

Write actual results, evidence, independent review, unexecuted checks, and accepted deviations into the report. Return clearly repairable failures to Build automatically within the first three failures. CRITICAL/IMPORTANT findings cannot be waived. Ask about WARNING/SUGGESTION findings involving behavior, scope, or risk tradeoffs; repair safe local issues directly. At verify_failures >= 3, ask whether to continue repairs or stop the workflow for an external decision. Failure, timeout, blocked, and unexecuted results never count as passed.

## Check reuse

For deterministic local checks, add `--local` before `--` in the main Skill's Guard command. Runtime returns reused only when argv, cwd, inputs, environment, timeout, original execution receipt, and log match. Build and Verify can reuse the identical full command. Omit the flag for external or nonrepeatable checks. Recover the original execution and receipt; investigate unknown results before repeating side effects. Runtime reruns changed inputs; remembered conversation claims cannot replace evidence.

## Preset scope

For hotfix/tweak, Build, Verify, and Archive check the approved requirements. Completing task checkboxes and adding task IDs with `state tasks --assign-ids` do not change scope. If the proposal, design, specs, or task text changes, restore the approved content or use the main Skill's `propose-escalation` in Build to propose the current scope, then obtain a new decision to continue the preset or upgrade to full under [reconfirmation after requirement changes](decision-point.md#reconfirmation-after-requirement-changes). Approval to continue binds the actual proposed content; after proposing, restore the proposed content or choose upgrade and confirm a new full Design before proceeding.

Hotfix first reproduces the cause and preserves failure evidence. When automatable, run the failing regression before repair and confirm GREEN afterward, then verify the cause is removed. Hotfix retains direct/direct/off defaults; task count does not determine escalation.

Tweak uses direct and OpenSpec apply methods:

**Immediately execute:** Use the Skill tool to load the openspec-apply-change skill. Skipping this step is prohibited.

<!-- external-openspec-skill-override -->

After the skill loads, obtain or reuse valid `comet classic openspec -- status --change <name> --json` and `comet classic openspec -- instructions apply --change <name> --json` results. Read all contextFiles and apply instructions, implement and check off the same tasks.md, retaining formatting, relevant tests, and regressions. Use bound `<classic-*>` paths. Full does not use this preset apply route.

Ask whether to continue the preset or upgrade to full for new functionality, public APIs, schemas, cross-module coordination, or deep architectural changes. More than 4 hotfix or 6 tweak delivery files triggers scope review, not automatic escalation. A file-count-only overage with unchanged scope, acceptance, and risk can reuse this change's rulings.md: status active, matching workflow, decision continue-on-file-count-only, confirmed scope, allowed-file-categories implementation/tests/user-docs/config/generated, authorization-basis user-explicit, and reason. Ask first without valid authorization; with it, report count, categories, scope mapping, and record location before continuing. Invalidate on changed scope, risk, acceptance, workflow, or file categories and ask again. SDK uses the main Skill's escalation Wait, preserving the same Run and workspace into full Design rather than executing Compat state-clearing commands.

## Archive and Git delivery

Use current verification evidence, bound branch, remote, and PR base. Explain archive effects and this change's files. Reuse existing authorization for the same target and complete missing delivery; ask when authorization is missing or the target changes. Local archives and commits; push additionally pushes; pr pushes and creates the PR; reverify returns to Verify; later preserves work. Distinguish the delivery branch from PR base.

Guard apply performs preflight and checks at side-effect boundaries. Submit directly through the main Skill in normal operation; preview for diagnosis. Use actual returned archive paths, explicitly stage this change's implementation, archive, main specs, and design/plan annotations, review the staged diff, and create one archive commit. Preserve unrelated changes; leave the sealed archive unchanged afterward. Reuse existing commits. Investigate unknown push/PR results read-only before repeating. Complete actual Git delivery, then submit the real SHA and PR URL through complete-delivery. Report completion only after Runtime verifies delivery and ends the Run.
