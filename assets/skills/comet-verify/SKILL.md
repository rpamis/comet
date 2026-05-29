---
name: comet-verify
description: "Comet Phase 4: Verify and Close. Invoke with /comet-verify. Verify implementation matches design, handle development branch."
---

# Comet Phase 4: Verify and Close

## Prerequisites

- Code committed (Phase 3 complete)
- tasks.md all tasks completed

## Steps

### 0. Entry State Verification

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then echo "ERROR: comet-env.sh not found." >&2; return 1; fi
. "$COMET_ENV"
bash "$COMET_STATE" check <change-name> verify
```

### 0a. Auto-Pilot Failure Count Check (auto-mode only)

```bash
CROSS_PHASE_FAILURES=$(grep -c '"decision":"retry_' openspec/changes/<name>/.comet/auto/decisions.jsonl 2>/dev/null || echo "0")
MAX_CONSECUTIVE=${auto_config.max_consecutive_failures:-5}
if [ "$CROSS_PHASE_FAILURES" -ge "$MAX_CONSECUTIVE" ]; then
  echo "[HARD STOP] cross-phase consecutive failures reached limit"
  exit 1
fi
```

### 1. Change Scale Assessment

```bash
bash "$COMET_STATE" scale <change-name>
```

### 1b. Verification Failure Decision (Blocking / Auto-Pilot Retry)

**Must pause and wait for user to decide fix or accept deviation.** Do not auto-run verify-fail transition or auto-invoke `/comet-build`.

List: failed items, CRITICAL status, recommended action.

Auto-Pilot: check `retry_on` for `verify_fail`:
```
retry_count=0; max_retry=${auto_config.max_retry:-2}
while verify_failed && [ $retry_count -lt $max_retry ]; do
  retry_count=$((retry_count + 1))
  sleep ${auto_config.retry_backoff[$((retry_count - 1))]:-1}
  bash "$COMET_STATE" transition <change-name> verify-fail
done
```

### 2a. Light Verification (small changes)

1. tasks.md all checked
2. Changed files match tasks.md
3. Compilation passes
4. Tests pass
5. No obvious security issues

### 2b. Full Verification (large changes)

Load `openspec-verify-change` skill. Check items:
1. tasks.md all tasks completed
2. Implementation matches `openspec/changes/<name>/design.md` high-level design decisions
3. Implementation matches Design Doc
4. Capability spec scenarios all pass
5. proposal.md goals met
6. delta spec and design doc have no contradictions
7. Design docs under `docs/superpowers/specs/` are locatable

**Spec Drift Handling** (user decision point):
- If check 6 finds contradictions, **must pause and wait for user to choose handling method**. Options:
  - A: Append "Implementation Divergence" section to design doc
  - B: Run verify-fail → `/comet-build` → update Design Doc via brainstorming
  - C: Accept deviation, continue (design doc marked `superseded-by-main-spec` at archive)

### 3. Close (Superpowers)

Load `superpowers:finishing-a-development-branch` skill. Branch options:
1. Merge locally to main
2. Push and create PR
3. Keep branch (handle later)
4. Discard work

**Must pause and wait for user to choose branch handling.** Only after user completes selection and corresponding operation, write `branch_status: handled`.

Auto-Pilot: when `auto_config.archive: true`, auto-select "keep branch" and continue. Output `[AUTO]`.

### 4. Record Verification Evidence

```bash
mkdir -p docs/superpowers/reports
bash "$COMET_STATE" set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
bash "$COMET_STATE" set <change-name> branch_status handled
```

## Exit Conditions

- Verification report passed, branch handled
- Guard: `bash "$COMET_GUARD" <change-name> verify --apply`

## Automatic Transition

> **REQUIRED NEXT SKILL:** Invoke `comet-archive` skill.
