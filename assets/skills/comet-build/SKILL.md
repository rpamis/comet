---
name: comet-build
description: "Comet Phase 3: Plan and Build. Invoke with /comet-build. Create plan and implement via subagent or direct execution."
---

# Comet Phase 3: Plan and Build

## Prerequisites

- Design Doc created (Phase 2 complete)
- Active change exists

## Steps

### 0. Entry State Verification

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then echo "ERROR: comet-env.sh not found." >&2; return 1; fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> build
```

### 1. Create Plan (with Phase Snapshot)

Create a task snapshot for spec drift quantification:

```bash
mkdir -p openspec/changes/<name>/.comet/auto
TOTAL_TASKS=$(grep -c '^\- \[ \]' openspec/changes/<name>/tasks.md || echo "0")
cat > openspec/changes/<name>/.comet/auto/phase-snapshot.yaml << EOF
phase: build
started_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
base_ref: $(git rev-parse HEAD)
initial_task_count: $TOTAL_TASKS
EOF
```

Load `superpowers:writing-plans` skill. Plan saved to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` with frontmatter:
```yaml
---
change: <openspec-change-name>
design-doc: docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
base-ref: <git rev-parse HEAD>
---
```

### 2. Update Plan State

```bash
bash "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

### 3. Choose Work Method

#### Manual Mode

Ask user once for isolation and execution mode:

**Isolation**: A) Branch B) Worktree
**Execution**: A) `subagent-driven-development` B) `executing-plans`

This is a user decision point. Must pause and wait for explicit choice — do not auto-select based on recommendation rules. Recommendations are advisory only.

#### Auto-Pilot Mode

When `auto_config` is provided, skip user prompt and use pre-configured values:

```bash
bash "$COMET_STATE" set <name> isolation ${auto_config.isolation:-branch}
bash "$COMET_STATE" set <name> build_mode ${auto_config.build_mode:-subagent-driven-development}
```

Tag output with `[AUTO]` and log to `decisions.jsonl`.

**Safety**: `build_mode: direct` is never auto-selected (even if configured); full workflow always requires `direct_override: true`.

### 4. Spec Incremental Updates

| Scale | Trigger | Action |
|-------|---------|--------|
| Small | Missing acceptance scenarios | Directly edit delta spec + design.md |
| Medium | Interface changes, new components | Pause for user confirmation, then load brainstorming |
| Large | New capability requirements | Pause for user confirmation to split into new change |

**50% threshold**: If new tasks exceed 50% of the initial task count (from `phase-snapshot.yaml`), treat as out-of-scope.

Auto-Pilot quantifies via `phase-snapshot.yaml` initial_task_count vs current task count, triggering `spec_drift_large` when exceeding `thresholds.spec_drift_task_ratio`.

### 5. Build Error Retry (Auto-Pilot)

```
failure_count=0
max_retry=${auto_config.max_retry:-2}
max_consecutive=${auto_config.max_consecutive_failures:-5}

while ! build_command; do
  failure_count=$((failure_count + 1))
  if [ $failure_count -gt $max_retry ]; then
    echo "[HARD STOP] per-phase retries exhausted"
    break
  fi
  if [ $cross_phase_failures -ge $max_consecutive ]; then
    echo "[HARD STOP] cross-phase consecutive failure limit reached"
    break
  fi
  backoff=${auto_config.retry_backoff[$((failure_count - 1))]:-1}
  sleep $backoff
  echo '{"ts":"...","decision":"retry_build_error","attempt":'$failure_count'}' >> openspec/changes/<name>/.comet/auto/decisions.jsonl
done
```

## Exit Conditions

- tasks.md all checked
- Code committed, build/test passed
- `isolation` and `build_mode` set
- Guard: `bash "$COMET_GUARD" <change-name> build --apply`

## Automatic Transition

> **REQUIRED NEXT SKILL:** Invoke `comet-verify` skill.
