---
name: comet-auto
description: "Comet Auto-Pilot — automatically resumes incomplete changes and drives the 5-phase pipeline with pre-configured policies. Triggered automatically by SessionStart Hook."
---

# Comet Auto-Pilot

Automatically detects active Comet changes and drives the 5-phase pipeline (open → design → build → verify → archive) per `comet-auto.yaml` policies, pausing only on blocking conditions.

## Trigger

Triggered automatically by SessionStart Hook, or manually via `/comet-auto`.

## Entry Flow

### Step 0: Environment Init

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

### Step 1: Cycle Prevention Marker

Before starting the auto flow, write the cycle prevention marker:

```bash
mkdir -p openspec/changes/.comet-auto-active
echo "<current-change-name>" > openspec/changes/.comet-auto-active/.active
```

The SessionStart Hook skips context injection when this marker exists, preventing duplicate injection triggered by phase transitions.

### Step 2: Load Config

Merge config by priority: change-level (`.comet.yaml` `auto:` field) > project-level (`comet-auto.yaml`) > global defaults.

```yaml
# Default config
auto:
  enabled: true
  confirm_design: auto_with_diff
  isolation: branch
  build_mode: subagent-driven-development
  archive: true
  max_retry: 2
  max_consecutive_failures: 5
  pause_on:
    - verify_fail
    - build_error
    - spec_drift_large
    - conflict_detected
    - phase_jump
    - external_commit
    - preset_upgrade
```

### Step 3: Discover Active Changes

Run `openspec list --json` to get all active changes.

| Active changes | Behavior |
|---------------|----------|
| 0 | Clean up `.active` marker, exit |
| 1 | Auto-resume that change |
| Multiple | Sort by priority and process sequentially |

### Step 4: Priority Sorting

Priority (high → low):

1. `verify_result: fail`
2. `phase: verify`
3. `phase: build`
4. `phase: design`
5. `phase: open`

### Step 5: Phase Detection & Routing

| phase | Route to | Auto-mode behavior |
|-------|----------|-------------------|
| `open` or no `.comet.yaml` | `/comet-open` | Create change + init state |
| `design` | `/comet-design` | Follow `confirm_design` policy |
| `build` | `/comet-build` | Skip decision points per config |
| `verify` | `/comet-verify` | Auto-execute verification |
| `archive` | `/comet-archive` | Auto-archive |

Pass `auto_config` parameter to sub-skills.

### Step 6: After Change Completes

1. Change archived → delete its `.comet/auto/` directory
2. If more active changes → return to Step 3 for next
3. All changes done → delete `openspec/changes/.comet-auto-active` marker
4. Exit

## Blocking Protocol

When a `pause_on` condition is hit:

1. Check retry policy: `max_retry` (per-phase) and `max_consecutive_failures` (cross-phase)
2. Retryable → exponential backoff wait + retry, log to `decisions.jsonl`
3. Retries exhausted → pause, output block reason and status summary
4. After user response → continue or skip

### Audit Logging

Every auto decision is written to `openspec/changes/<name>/.comet/auto/decisions.jsonl`:

```jsonl
{"ts":"ISO8601","change":"name","phase":"build","decision":"retry_build_error","attempt":1,"reason":"tsc compilation failed"}
```

## Multi-Change Conflict Detection

Before entering build phase, check if multiple changes modify the same file:

```bash
for change in $(openspec list --json | python3 -c "import json,sys;[print(c['name']) for c in json.load(sys.stdin)]"); do
  git diff --name-only "$change"...main 2>/dev/null
done | sort | uniq -d
```

If conflicts → `conflict_detected` → pause, list conflicting changes and files.

## Dry-Run Mode

Manual `/comet-auto --dry-run`: preview without modifying files or state.

## Cleanup

`/comet-auto clean`: clean all stale `.active` markers and `.comet/auto/` runtime directories.

## Manual Mode Compatibility

Users can type `/comet` anytime to take control. Auto-pilot degrades to reminder-only when:
- `comet-auto.yaml` has `enabled: false`
- User manually invoked any comet sub-command in current session
- `preset_upgrade` condition detected
