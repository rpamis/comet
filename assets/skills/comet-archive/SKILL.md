---
name: comet-archive
description: "Comet Phase 5: Archive. Invoke with /comet-archive. Sync delta spec to main spec, archive the change."
---

# Comet Phase 5: Archive

## Prerequisites

- Verification passed (Phase 4 complete)
- Branch handled
- `openspec/changes/<name>/.comet.yaml` has `verify_result: pass`

## Steps

### 0. Entry State Verification

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then echo "ERROR: comet-env.sh not found." >&2; return 1; fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> archive
```

### 1. Execute Archive

**Manual mode**: requires user confirmation before running archive script.

**Auto-Pilot mode**: when `auto_config.archive: true`, execute automatically. Tag `[AUTO]`, skip confirmation.

```bash
bash "$COMET_ARCHIVE" "<change-name>"
```

Script automatically:
1. Validates entry state
2. Syncs delta specs to main specs
3. Annotates design doc and plan frontmatter
4. Moves change to archive directory
5. Updates `archived: true` via `comet-state transition`

Auto-Pilot logs audit:
```bash
echo '{"ts":"...","change":"<name>","phase":"archive","decision":"auto_archive"}' >> openspec/changes/archive/YYYY-MM-DD-<name>/.comet/auto/decisions.jsonl 2>/dev/null || true
```

### 2. Auto-Pilot Cleanup

After successful archive in auto-mode:
```bash
rm -rf openspec/changes/archive/YYYY-MM-DD-<name>/.comet/auto/
ACTIVE_COUNT=$(openspec list --json 2>/dev/null | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$ACTIVE_COUNT" -eq 0 ]; then
  rm -f openspec/changes/.comet-auto-active
fi
```

### 3. Lifecycle Closure

```
brainstorming → delta spec → implementation → verification → main spec overwrite → design doc annotation → archive
```

## Exit Conditions

- Archive script succeeds (exit 0)
- Archive directory exists
- `.comet.yaml` `archived: true`
- Auto-Pilot: runtime files cleaned

## Done

Comet workflow complete. Start new work with `/comet` or `/comet-open`.
