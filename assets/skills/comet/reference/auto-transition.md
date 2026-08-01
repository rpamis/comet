# Automatic Handoff to Next Phase Protocol

Canonical path: `comet/reference/auto-transition.md`

This protocol is shared by all comet sub-skills. It defines the automatic handoff rules after phase guard advancement.

## Terminology Distinction

"Phase advancement" is performed by guard `--apply`, which updates the `phase` field in `.comet.yaml` — this **always happens** and is independent of `auto_transition`. This protocol's "automatic handoff" only determines **whether to automatically invoke the next skill**, controlled by `auto_transition`.

## Execution

After exit conditions are met and the phase guard has advanced phase, run:

```bash
node "$COMET_STATE" next <change-name>
```

The script outputs a deterministic next step based on `phase`, `workflow`, and `auto_transition`:

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to enter the next phase
- `NEXT: manual` → do not invoke the next skill; prompt user to manually run `/<SKILL>` per `HINT`
- `NEXT: done` → workflow is complete, no further action needed

## Preset Routing

When `workflow: hotfix`, `phase: build` returns `comet-hotfix`; when `workflow: tweak`, it returns `comet-tweak`. All other phases (`verify`, `archive`) return standard skill names (`comet-verify`, `comet-archive`) regardless of workflow type. The "continuous execution mode" within preset skills may override `auto_transition` behavior — see the corresponding preset's `<IMPORTANT>` block.
