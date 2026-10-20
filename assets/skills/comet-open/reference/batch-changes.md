# PRD splitting and batch recovery

For a large PRD, roadmap, complete product proposal, or a clarification summary containing multiple independent features, modules, user journeys, or milestones, assess whether multiple changes are needed before creating OpenSpec artifacts.

Use the clarified information to present a proposed split. Each item must include:

- Suggested change name.
- Goal and scope.
- Explicit non-goals.
- Dependencies or recommended execution order.
- Core acceptance scenarios.

Recommend splitting when any of these apply:

- The PRD contains multiple features that can be designed, built, verified, and archived independently.
- It spans multiple modules or user journeys, with a portion that can ship independently.
- It has distinct delivery milestones.
- Several delta specs serve independent goals that can be accepted and shipped separately. Document or task counts alone do not determine a split.
- Failure or delay in one part should not prevent the others from proceeding.

If you recommend splitting, pause under `comet-classic/reference/decision-point.md` and wait for the user's choice. Include all these options:

- “Create multiple OpenSpec changes”: create each proposed item as an independent change.
- “Keep one change”: continue with one change and record the reason in proposal/design/tasks.
- “Revise the split”: ask for the desired adjustments, revise the list, and obtain confirmation again.

Create every accepted item through `/comet-open`, not directly through `/opsx:new`. It creates OpenSpec artifacts and an independent SDK Run for each change.

Do not create proposal.md, design.md, or tasks.md before the user chooses how to split the PRD. If they choose multiple changes, this `/comet-open` invocation handles split confirmation and scheduling only, then invokes `/comet-open` for each item in the approved order.

Immediately save the confirmed batch to `.comet/batches/<batch-id>.json`. Use a stable kebab-case `batch-id`. Record at least `version`, the original goal summary, creation time, ordered change names, and each item's goal, scope, non-goals, acceptance scenarios, and `pending|open-complete|selected` status. Atomically update the file after each item is created or completed. This list tracks batch order and progress; it does not replace each change's SDK Run.

When invoking `/comet-open` for a batch item, label it “confirmed split item” and pass its goal, scope, non-goals, and acceptance scenarios. Skip the PRD split assessment for a confirmed item unless that item still clearly contains multiple independent features.

Do not automatically move an individual batch item from Open to `/comet-design`. When the batch is complete, pause and ask which change to start. Advance only the selected change to `/comet-design`; leave the others unarchived for later recovery through `/comet-classic`.

**Check every completed batch item; do not skip this:** After all items finish Open, run the following for every `<name>` on the confirmed list:

```bash
comet state check <name> design --json
```

This entry validates the full required closure, actual OpenSpec outputs, and Comet state. Do not repeat a separate status scan. `isComplete` is diagnostic; optional artifacts do not block progress. Query status only after a failed check to locate missing dependencies or diagnose reported path/capability errors.

If any split item fails these checks, do not announce batch completion or ask which change to start. Stop further advancement and resume `/comet-open` at that change's first `ready` or `blocked` artifact. If OpenSpec checks pass but Comet state checks fail, inspect Runtime ownership, Run, and phase first; recover compat changes through their original state machine, then rerun batch checks.

Only after every item passes entry checks may you ask which change to start. Mark the user's chosen item `selected` in the batch list and advance that change alone to `/comet-design`. Leave the others unarchived for later recovery through `/comet-classic`.

On recovery, read `.comet/batches/<batch-id>.json`, then run the checks above for its created, unarchived changes. Do not recreate items that already pass. Resume failed items from the first `ready` artifact returned by OpenSpec. Create the remaining items from the saved list. If the list is missing or damaged, stop and ask the user to rebuild or confirm it; do not infer the original batch from directory names.
