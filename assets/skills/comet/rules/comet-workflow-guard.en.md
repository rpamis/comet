# Comet Current-Change Phase Rule

This Rule is the persistent soft safeguard shared by Native and Classic. A project may enable both workflows, but one request must be owned by exactly one workflow/change; never apply both phase models at the same time.

## Resolve the current request first

At the start of every turn, when resuming work, or after possible context compression:

1. Read `.comet/config.yaml`: `workflows` lists enabled capabilities, while `default_workflow` only selects the default `/comet` entry.
2. Read `.comet/current-change.json`: its `workflow + change` identifies the current request owner.
3. When the selection is missing, or its target change is missing or archived, enumerate active Comet changes across the project again: zero means there is no current Comet request, exactly one permits read-only inference, and multiple candidates require an explicit user selection.
4. Stop when the selection file is unreadable, its format or schema is invalid, its workflow is disabled, its branch is invalid, or change state cannot be read safely. Never fall back to `default_workflow` to guess ownership.

A legacy Classic project without the current project schema uses only the Classic legacy fallback; that fallback never enables Native.

## Apply only the selected phase model

| Workflow | Ordinary implementation writes blocked | Ordinary implementation writes allowed |
| --- | --- | --- |
| Native | Shape, Verify, Archive | Build |
| Classic | Open, Design, Verify, Archive | Build |

- Native Verify remains read-only: Runtime executes required checks and a new Verifier execution independently covers every acceptance item. When it exposes an implementation problem, record the failed result and use the Native Runtime to return to Build before modifying the implementation. Ordinary dot-prefixed project files do not become cross-phase allowlisted paths merely because of their names.
- Classic Verify writes only the verification report and state. It does not modify tasks or ordinary project implementation; run `verify-fail` to return to Build before updating task state or repairing implementation.
- Ordinary write permission in Native Build does not override unresolved `[blocking]` user decisions in the brief. When a new decision appears, follow the Native Skill to pause implementation and reconfirm.
- When Native state contains `children`, ordinary Build write permission belongs only to child worktrees listed in Runtime `readyChildren`; do not run a Supervisor Change Builder or implement child work in the parent worktree.
- A Classic full workflow allows ordinary implementation writes in Build only after state records a Design Doc and its implementation plan exists and is ready. Hotfix and tweak continue to follow their preset phase protocols.
- For Native ownership, resume `/comet-native` and continue from the portable state's Loop, blockers, and next action. A missing local execution does not mean the change is damaged.
- For Classic ownership, resume `/comet-classic` and continue from Classic state, decision points, and phase rules.
- Never convert a Native change into a Classic change or vice versa. Switching workflows means selecting a separate change.

## Hook constraint

Each platform must install exactly one Comet Hook Router. One write event may invoke at most one workflow Guard; do not run separate Native and Classic Hooks.

The Hook evaluates multi-file and patch targets atomically. Unattributable events and targets that are entirely outside the project remain neutral. Once a write is attributed to this project, it fails closed when the current phase blocks ordinary project writes, multiple ownership candidates exist, or the selection, state, or target scope cannot be read safely. Never bypass the Hook; follow its denial message to resume the owning workflow, and select a current change only when ownership is ambiguous.

The phase table governs only ordinary implementation writes. Before phase evaluation, the Classic Hook always allows `.comet` configuration, the `.superpowers` workspace, root Markdown files, and `hook.allow_paths`. These are explicit control or configuration allowlists: they do not widen phase permissions or permit task updates during Verify.

## Personal memory and project knowledge context

Only perform the following when `.comet/config.yaml` exists and the user is using Comet. An ordinary repository without an enabled Comet project remains neutral: do not create files and do not change tool-call results.

- At task start or after the target path is known, run `comet task <project-root> --task "<task>" --phase "<phase>" --session "<stable task id>" --json` for personal memory and project knowledge context. Use only returned `text`; summaries in the Context Manifest (`manifest` / `<context_manifest>`) are not complete rules. Use the same task selectors with `--expand-context "<id>"` when full content, sources, or verification is needed. Re-select with the same `--session` after path, operation, or phase changes; unchanged content is not redelivered.
- Add every `<verification command="...">` from `<active_policies>` to the current Verify checks and record the real result. A command that did not pass must not make its policy enforced.
- Use `comet memory remember` when the user explicitly asks to retain a long-term preference or project convention, so explicit content applies immediately. Use `comet memory observe` only for an implicit but reusable stable collaboration habit. Never save task summaries, implementation progress, command output, or test results as personal memory.
- After actually using an item and learning its result, take `applications[].applicationId` from JSON or `application_id` from Hook context and run `comet task <project-root> --task "<task>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`; never report success for an unused item. Follow workflow diagnostics to fix compiler, test, or linter failures.
- If the task-context command is unavailable, the project is not initialized, or no snippet matches, remain neutral; a plugin failure must not be presented as a project-check failure.
