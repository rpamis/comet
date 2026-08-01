# Stable CLI and Internal Script Compatibility

Canonical path: `comet/reference/scripts.md`

This file is the single source of truth for Comet's public CLI and internal script compatibility. Each Classic command ships as a self-contained bundle (`comet/scripts/comet-*.mjs`). Invoking the bundle directly (`node "$COMET_STATE" ...`) is faster than the `comet` CLI shell, because the CLI pays commander registration and module-loading overhead on every call. Prefer the direct bundle invocation in everyday workflows; the `comet` CLI remains available as a fallback.

## Script Bootstrap

Comet scripts are distributed in `comet/scripts/`. Locate the scripts directory once per session, cache it in environment variables, then invoke each command's self-contained bundle directly:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.mjs' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.mjs not found. Ensure the comet skill is installed." >&2
  return 1
fi
COMET_SCRIPTS_DIR="$(node "$COMET_ENV")"
COMET_STATE="$COMET_SCRIPTS_DIR/comet-state.mjs"
COMET_GUARD="$COMET_SCRIPTS_DIR/comet-guard.mjs"
COMET_HANDOFF="$COMET_SCRIPTS_DIR/comet-handoff.mjs"
COMET_ARCHIVE="$COMET_SCRIPTS_DIR/comet-archive.mjs"
COMET_INTENT="$COMET_SCRIPTS_DIR/comet-intent.mjs"
COMET_RESUME_PROBE="$COMET_SCRIPTS_DIR/comet-resume-probe.mjs"

# Stop workflow when script location fails
if [ -z "$COMET_SCRIPTS_DIR" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi
```

Run this bootstrap once when entering a Comet Classic workflow, then use the cached variables for every subsequent command. `COMET_INTENT` and `COMET_RESUME_PROBE` are also required for internal entry routing and Ambient Resume.

## Public Workflow Contract

With the bootstrap active, everyday workflows invoke the bundles directly. Arguments are identical to the CLI subcommands (drop only the `comet` keyword):

```bash
node "$COMET_STATE" select <change-name>
node "$COMET_STATE" current
node "$COMET_STATE" clear-selection
node "$COMET_STATE" check <change-name> <phase>
node "$COMET_GUARD" <change-name> <phase> --apply
node "$COMET_HANDOFF" <change-name>
node "$COMET_ARCHIVE" <change-name>
```

When multiple active changes coexist, run `node "$COMET_STATE" select <change-name>` after resolving the intended change. Ordinary source writes are governed only by that selection; without one, the hook blocks and asks for a choice. A single active change retains automatic routing. Select again after switching branch/worktree or when the recorded selection becomes stale.

Guard `--apply` advances state after checks pass. Use `node "$COMET_STATE" transition` when expressing a state event directly, and `node "$COMET_STATE" next` after phase advancement to determine whether to invoke the next Skill automatically.

| Variable | Purpose |
|----------|---------|
| `COMET_STATE` | `.comet.yaml` state reads/writes, phase checks, and recovery context |
| `COMET_GUARD` | Phase exit guard and `--apply` state advancement |
| `COMET_HANDOFF` | Design/Build handoff context pack generation |
| `COMET_ARCHIVE` | One-command archive and main spec sync |
| `COMET_INTENT` | `/comet-classic` entry intent recognition and route scoring |
| `COMET_RESUME_PROBE` | Read-only Ambient Resume probe that decides whether to resume an active Comet workflow |

## Auto state update

Guard supports `--apply` flag, automatically updating `.comet.yaml` state fields after checks pass:

```bash
node "$COMET_GUARD" <change-name> <phase> --apply
```

`--apply` delegates to the state-machine transition. Use these semantic events when state changes need to be expressed directly:

```bash
node "$COMET_STATE" transition <change-name> open-complete
node "$COMET_STATE" transition <change-name> design-complete
node "$COMET_STATE" transition <change-name> build-complete
node "$COMET_STATE" transition <change-name> verify-pass
node "$COMET_STATE" transition <change-name> verify-fail
node "$COMET_STATE" transition <change-name> archive-confirm
node "$COMET_STATE" transition <change-name> archive-reopen
node "$COMET_STATE" transition <change-name> archived
node "$COMET_STATE" transition <change-name> preset-escalate
```

Archive completion is handled by `node "$COMET_ARCHIVE" <change-name>` after OpenSpec moves the change into its date-prefixed archive directory. Use `archive-confirm` or `archive-reopen` for the pre-archive decision, and do not manually run the `archived` transition outside that flow.

## Resolve next action

After guard-based phase advancement, use the `next` subcommand to determine whether to auto-invoke the next skill:

```bash
node "$COMET_STATE" next <change-name>
```

Output format: `NEXT: auto|manual|done` + `SKILL: <skill-name>` (omitted for `done`) + `HINT` (for `manual` only). With `auto_transition: false`, output is `manual`, which pauses only the next skill invocation and does not block phase updates.

## Archive script

Complete all archive steps in one command:

```bash
node "$COMET_ARCHIVE" <change-name>
```
