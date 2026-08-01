# Stable CLI and Internal Script Compatibility

Canonical path: `comet/reference/scripts.md`

This file is the single source of truth for Comet's public CLI and internal script compatibility. Each Classic command ships as a self-contained bundle (`comet/scripts/comet-*.mjs`). Invoking the bundle directly is faster than the `comet` CLI shell, because the CLI pays commander registration and module-loading overhead on every call. Prefer the direct bundle invocation in everyday workflows; the `comet` CLI remains available as a fallback.

## Script Bootstrap

Comet scripts are distributed in `comet/scripts/`. Resolve the absolute scripts directory once when entering the workflow. When the host displays this Skill's Base directory, use its `scripts/` directory directly without searching. Otherwise, locate `comet-env.mjs` with the host's filesystem search and run it with Node; for example:

```bash
for root in "$PWD/../.claude/skills" "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.agents/skills" "$HOME/.config" "$HOME/.gemini" .; do
  [ -d "$root" ] || continue
  COMET_ENV="$(find "$root" -path '*/comet/scripts/comet-env.mjs' -type f -print -quit 2>/dev/null)"
  [ -n "$COMET_ENV" ] && break
done
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.mjs not found. Ensure the comet skill is installed." >&2
  return 1
fi
node "$COMET_ENV"
```

```powershell
$CometEnv = Get-ChildItem -Path "$PWD/../.claude/skills", "$HOME/.claude/skills", "$HOME/.codex/skills", "$HOME/.agents/skills", "$HOME/.config", "$HOME/.gemini", . -Filter comet-env.mjs -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]comet[\\/]scripts[\\/]comet-env\.mjs$' } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $CometEnv) { throw 'comet-env.mjs not found. Ensure the comet skill is installed.' }
node $CometEnv
```

The command prints the absolute scripts directory. Record that path in task context and resolve these placeholders from it: `<comet-state-script>`, `<comet-guard-script>`, `<comet-handoff-script>`, `<comet-archive-script>`, `<comet-intent-script>`, and `<comet-resume-probe-script>`. In every later tool call, replace each quoted placeholder with the corresponding literal absolute `.mjs` path. Never pass the angle-bracket placeholder literally and never depend on a shell-local variable surviving into a later tool call. Stop the workflow if any required bundle is missing.

## Public Workflow Contract

Everyday workflows invoke the resolved bundles directly. Arguments are identical to the CLI subcommands (drop only the `comet` keyword):

```bash
node "<comet-state-script>" select <change-name>
node "<comet-state-script>" current
node "<comet-state-script>" clear-selection
node "<comet-state-script>" check <change-name> <phase>
node "<comet-guard-script>" <change-name> <phase> --apply
node "<comet-handoff-script>" <change-name>
node "<comet-archive-script>" <change-name>
```

When multiple active changes coexist, run `node "<comet-state-script>" select <change-name>` after resolving the intended change. Ordinary source writes are governed only by that selection; without one, the hook blocks and asks for a choice. A single active change retains automatic routing. Select again after switching branch/worktree or when the recorded selection becomes stale.

Guard `--apply` advances state after checks pass. Use `node "<comet-state-script>" transition` when expressing a state event directly, and `node "<comet-state-script>" next` after phase advancement to determine whether to invoke the next Skill automatically.

| Placeholder | Purpose |
|----------|---------|
| `<comet-state-script>` | `.comet.yaml` state reads/writes, phase checks, and recovery context |
| `<comet-guard-script>` | Phase exit guard and `--apply` state advancement |
| `<comet-handoff-script>` | Design/Build handoff context pack generation |
| `<comet-archive-script>` | One-command archive and main spec sync |
| `<comet-intent-script>` | `/comet-classic` entry intent recognition and route scoring |
| `<comet-resume-probe-script>` | Read-only Ambient Resume probe that decides whether to resume an active Comet workflow |

## Auto state update

Guard supports `--apply` flag, automatically updating `.comet.yaml` state fields after checks pass:

```bash
node "<comet-guard-script>" <change-name> <phase> --apply
```

`--apply` delegates to the state-machine transition. Use these semantic events when state changes need to be expressed directly:

```bash
node "<comet-state-script>" transition <change-name> open-complete
node "<comet-state-script>" transition <change-name> design-complete
node "<comet-state-script>" transition <change-name> build-complete
node "<comet-state-script>" transition <change-name> verify-pass
node "<comet-state-script>" transition <change-name> verify-fail
node "<comet-state-script>" transition <change-name> archive-confirm
node "<comet-state-script>" transition <change-name> archive-reopen
node "<comet-state-script>" transition <change-name> archived
node "<comet-state-script>" transition <change-name> preset-escalate
```

Archive completion is handled by `node "<comet-archive-script>" <change-name>` after OpenSpec moves the change into its date-prefixed archive directory. Use `archive-confirm` or `archive-reopen` for the pre-archive decision, and do not manually run the `archived` transition outside that flow.

## Resolve next action

After guard-based phase advancement, use the `next` subcommand to determine whether to auto-invoke the next skill:

```bash
node "<comet-state-script>" next <change-name>
```

Output format: `NEXT: auto|manual|done` + `SKILL: <skill-name>` (omitted for `done`) + `HINT` (for `manual` only). With `auto_transition: false`, output is `manual`, which pauses only the next skill invocation and does not block phase updates.

## Archive script

Complete all archive steps in one command:

```bash
node "<comet-archive-script>" <change-name>
```
