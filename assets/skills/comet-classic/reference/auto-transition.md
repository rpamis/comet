# Automatic Phase Handoff Protocol

Canonical path: `comet-classic/reference/auto-transition.md`

All comet sub-skills share these handoff rules after a phase Guard advances state.

## Phase Advancement and Skill Invocation

When guard `--apply` passes, it updates `.comet.yaml` `phase` to the next phase. This **always happens**, regardless of `auto_transition`. `auto_transition` controls only **whether to invoke the next Skill automatically** after that update.

## Execution

After exit conditions pass and the phase Guard updates phase, prefer `agent.continuation` from the successful JSON result. For `automatic: true`, invoke its `skill`; for false, prompt the user to run that Skill manually and end this invocation. The next phase can use the returned state without repeating next, select, or check. Query only on session recovery, external-state or workspace changes, or older results missing this information:

```bash
comet state next <change-name>
```

The script determines the next step from `phase`, `workflow`, and `auto_transition`:

- `NEXT: auto` → invoke the Skill named by `SKILL` to enter the next phase.
- `NEXT: manual` → do not invoke it; use `HINT` to prompt the user to run `/<SKILL>` manually.
- `NEXT: done` → the workflow is complete; no further action is needed.

## Preset Routing

With `workflow: hotfix`, `phase: build` returns `comet-hotfix`; with `workflow: tweak`, it returns `comet-tweak`. Other phases (`verify`, `archive`) return standard Skill names (`comet-verify`, `comet-archive`) regardless of workflow type. A preset's continuous execution mode may override `auto_transition`; see its `<IMPORTANT>` block.
