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
| Classic | Open, Design, Archive | Build, Verify |

- Native Verify only runs checks and records evidence. When it exposes an implementation problem, record the failed result and use the Native Runtime to return to Build before modifying the implementation. Ordinary dot-prefixed project files do not become cross-phase allowlisted paths merely because of their names.
- Ordinary write permission in Native Build does not override unresolved `[blocking]` user decisions in the brief. When a new decision appears, follow the Native Skill to pause implementation and reconfirm.
- For Native ownership, resume `/comet-native` and continue from Native state, evidence, and automatic-progression rules.
- For Classic ownership, resume `/comet-classic` and continue from Classic state, decision points, and phase rules.
- Never convert a Native change into a Classic change or vice versa. Switching workflows means selecting a separate change.

## Hook constraint

Each platform must install exactly one Comet Hook Router. One write event may invoke at most one workflow Guard; do not run separate Native and Classic Hooks.

The Hook evaluates multi-file and patch targets atomically. It fails closed when the current phase blocks ordinary project writes, multiple ownership candidates exist, the selection or state cannot be read safely, or a write target cannot be determined. Never bypass the Hook; follow its denial message to resume the owning workflow, and select a current change only when ownership is ambiguous.
