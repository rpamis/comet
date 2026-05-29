---
name: comet-design
description: "Comet Phase 2: Deep Design. Invoke with /comet-design. Produce Design Doc and delta spec through brainstorming."
---

# Comet Phase 2: Deep Design (Design)

## Prerequisites

- Active change exists (proposal.md, design.md, tasks.md)
- No Design Doc (no corresponding file under `docs/superpowers/specs/`)

## Steps

### 0. Entry State Verification (Entry Check)

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found." >&2
  return 1
fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> design
```

### 1a. Generate OpenSpec → Superpowers Handoff

```bash
bash "$COMET_HANDOFF" <change-name> design --write
```

The script generates `design-context.json` and `design-context.md` in `.comet/handoff/`.

### 1b. Execute Brainstorming

Load `superpowers:brainstorming` skill with ARGUMENTS containing:
```
Change: <change-name>
OpenSpec Context Pack: openspec/changes/<name>/.comet/handoff/design-context.md
Machine handoff: openspec/changes/<name>/.comet/handoff/design-context.json
```

### 1c. Design Proposal Confirmation (Blocking / Auto-Pilot)

After brainstorming produces a design proposal, behavior depends on `auto_config.confirm_design`:

---

#### Manual Mode (`always_confirm` or no auto_config)

**Must pause and wait for explicit user confirmation.** Do not create the final Design Doc before confirmation.

Present only the essential summary:
- Chosen technical approach
- Key trade-offs and risks
- Testing strategy
- If Spec Patch exists, list delta spec changes to write back

---

#### Auto-Pilot: `auto_with_diff` (Recommended Default)

Auto-approve design confirmation, but write an audit trail:

1. Generate design diff summary and write:
```bash
mkdir -p openspec/changes/<name>/.comet/auto
cat > openspec/changes/<name>/.comet/auto/design-diff.md << EOF
# Design Auto-Confirm Audit
- **Timestamp**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- **Change**: <change-name>
- **Mode**: auto_with_diff
- **Status**: [AUTO-CONFIRMED]
EOF
```

2. Log to audit:
```bash
echo '{"ts":"...","change":"<name>","phase":"design","decision":"auto_confirm_design","mode":"auto_with_diff"}' >> openspec/changes/<name>/.comet/auto/decisions.jsonl
```

3. Output brief summary tagged `[AUTO-CONFIRMED]`, proceed directly to Step 2.

`comet doctor` will check for unreviewed auto-confirm records older than `design_review_days`.

---

#### Auto-Pilot: `always_skip` (hotfix/tweak only)

Fully skip design confirmation, no audit file. Output `[AUTO-SKIPPED]`, proceed to Step 2. Only recommended for hotfix/tweak workflows.

---

### 2. Update Comet State

```bash
bash "$COMET_STATE" set <name> design_doc docs/superpowers/specs/YYYY-MM-DD-topic-design.md
bash "$COMET_HANDOFF" <change-name> design --write   # if delta spec changed
bash "$COMET_GUARD" <change-name> design --apply
```

## Exit Conditions

- Design Doc created with proper frontmatter
- `handoff_context` and `handoff_hash` in `.comet.yaml`
- If auto_with_diff: `design-diff.md` audit file generated
- Guard passes: `bash "$COMET_GUARD" <change-name> design --apply`

## Automatic Transition

> **REQUIRED NEXT SKILL:** Invoke `comet-build` skill.
