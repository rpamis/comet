# Automatic Phase Handoff Protocol

Canonical path: `comet-classic/reference/auto-transition.md`

All comet sub-skills share these handoff rules after a phase Guard advances state.

## Phase Advancement and Skill Invocation

When guard `--apply` passes, it updates `.comet.yaml` `phase` to the next phase. This **always happens**, regardless of `auto_transition`. `auto_transition` controls only **whether to invoke the next Skill automatically** after that update.

## Execution

When an SDK response includes `agent.continuation.mode`, handle it first: `execute` runs the returned command or loads the explicitly named Skill; `wait` waits for the original task without claiming again; `ask` presents the current proposal and awaits the user decision; `reconcile` checks the original result or addresses listed blockers; `done` ends the Run. `mode` takes precedence over the compatibility field `nextAction.kind`: a legacy `kind: reconcile` with new `mode: wait` still means wait for the original task. Only `invoke_skill` loads a Skill; never treat a tool’s `ref` as a Skill name. Complete the Skill’s actual work before filling and executing its `completion` request. `currentRef` points to current work in the same response; read that field without another command. `inputSummary` contains only current work context, not a replacement for the original Action input or Runtime evidence. Use the returned details command only when omitted content is essential. Reuse current action inputs, request templates, Run identity, revision, and working directory. Fill placeholders with real inputs; they do not grant approval. Use the new response after a write rather than querying again at a phase boundary. For responses without `mode`, follow the rules below.

After exit conditions pass and the phase Guard updates phase, prefer `agent.continuation` from the successful JSON result. For `automatic: true`, invoke its `skill`; for false, prompt the user to run that Skill manually and end this invocation. The next phase can use the returned state without repeating next, select, or check. Query only on session recovery, external-state or workspace changes, or older results missing this information:

```bash
comet state next <change-name>
```

The script determines the next step from `phase`, `workflow`, and `auto_transition`:

- `NEXT: auto` → invoke the Skill named by `SKILL` to enter the next phase.
- `NEXT: manual` → do not invoke it; use `HINT` to prompt the user to run `/<SKILL>` manually.
- `NEXT: done` → the workflow is complete; no further action is needed.
- `NEXT: delivery` → the change is archived; finish delivery from the delivery summary instead of advancing phases.

## Preset Routing

With `workflow: hotfix`, `phase: build` returns `comet-hotfix`; with `workflow: tweak`, it returns `comet-tweak`. Other phases (`verify`, `archive`) return standard Skill names (`comet-verify`, `comet-archive`) regardless of workflow type. A preset's continuous execution mode may override `auto_transition`; see its `<IMPORTANT>` block.
