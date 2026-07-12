# Stable CLI and Internal Script Compatibility

Canonical path: `comet/reference/scripts.md`

This file is the single source of truth for Comet's public CLI and internal script compatibility. Public workflows must prefer the stable command surface: `comet state`, `comet guard`, `comet handoff`, and `comet archive`.

## Public Workflow Contract

Normal installations and everyday workflows use the `comet` CLI directly. They do not need to locate launchers and must not expose the internal `classic` name to users:

```bash
comet state select <change-name>
comet state current
comet state clear-selection
comet state check <change-name> <phase>
comet guard <change-name> <phase> --apply
comet handoff <change-name>
comet archive <change-name>
```

When multiple active changes coexist, run `comet state select <change-name>` after resolving the intended change. Ordinary source writes are governed only by that selection; without one, the hook blocks and asks for a choice. A single active change retains automatic routing. Select again after switching branch/worktree or when the recorded selection becomes stale.

Guard `--apply` advances state after checks pass. Use `comet state transition` when expressing a state event directly, and `comet state next` after phase advancement to determine whether to invoke the next Skill automatically.

## Compatibility, Recovery, and Internal Command Bootstrap

The script discovery below is only for legacy compatibility, recovery when the CLI is unavailable, and internal `/comet` entry commands. Normal public workflows must not prefer it. Comet scripts are distributed in `comet/scripts/`; recovery code must locate them once and cache environment variables instead of hardcoding paths:

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

Agents run this bootstrap only when entering one of the compatibility, recovery, or internal-command paths above. `COMET_INTENT` and `COMET_RESUME_PROBE` remain necessary for internal entry routing and must not be removed globally.

| Variable | Purpose |
|----------|---------|
| `COMET_STATE` | `.comet.yaml` state reads/writes, phase checks, and recovery context |
| `COMET_GUARD` | Phase exit guard and `--apply` state advancement |
| `COMET_HANDOFF` | Design/Build handoff context pack generation |
| `COMET_ARCHIVE` | One-command archive and main spec sync |
| `COMET_INTENT` | `/comet` entry intent recognition and route scoring |
| `COMET_RESUME_PROBE` | Read-only Ambient Resume probe that decides whether to resume an active Comet workflow |

## Auto state update

Guard supports `--apply` flag, automatically updating `.comet.yaml` state fields after checks pass:

```bash
comet guard <change-name> <phase> --apply
```

`--apply` delegates to the state-machine transition. Use these semantic events when state changes need to be expressed directly:

```bash
comet state transition <change-name> open-complete
comet state transition <change-name> design-complete
comet state transition <change-name> build-complete
comet state transition <change-name> verify-pass
comet state transition <change-name> verify-fail
comet state transition <change-name> archive-confirm
comet state transition <change-name> archive-reopen
comet state transition <change-name> archived
comet state transition <change-name> preset-escalate
```

Archive completion is handled by `comet archive <change-name>` after OpenSpec moves the change into its date-prefixed archive directory. Use `archive-confirm` or `archive-reopen` for the pre-archive decision, and do not manually run the `archived` transition outside that flow.

## Resolve next action

After guard-based phase advancement, use the `next` subcommand to determine whether to auto-invoke the next skill:

```bash
comet state next <change-name>
```

Output format: `NEXT: auto|manual|done` + `SKILL: <skill-name>` (omitted for `done`) + `HINT` (for `manual` only). With `auto_transition: false`, output is `manual`, which pauses only the next skill invocation and does not block phase updates.

## Archive script

Complete all archive steps in one command:

```bash
comet archive <change-name>
```
