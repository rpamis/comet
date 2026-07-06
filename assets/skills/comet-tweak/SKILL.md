---
name: comet-tweak
description: "Use when the user wants a lightweight or medium change that fits a single OpenSpec change and does not need full design; also use when resuming tweak workflow."
---

# Comet Preset Path: Tweak

Tweak is a preset workflow of Comet's five-phase capabilities, not an independent parallel process. It chains OpenSpec's core flow, reusing open, build, verify, archive capabilities, only skipping Superpowers brainstorming and full plan.

Applicable for OpenSpec-chained lightweight changes, such as configuration adjustments, documentation or prompt optimization, and spec-driven (including delta spec) medium changes that do not need the full `/comet` deep design workflow. Delta spec is a first-class normal artifact in tweak; needing delta spec alone does not constitute an upgrade reason.

**Applicable conditions** (all must be met):
1. Can fit a **single OpenSpec change**
2. Does not need a Superpowers Design Doc and full plan to clarify the approach
3. Does not involve cross-module or cross-layer architecture coordination
4. Task scope is estimable (file count and task count are hints only, not hard upgrade conditions; see Upgrade Assessment below)

**Not applicable**: If the change process hits a qualitative-change signal (see "Upgrade Assessment" section), the user decides whether to upgrade to the full `/comet` workflow.

---

## Process (preset workflow, 4 phases)

### 0. Output Language Constraint

Streamlined OpenSpec artifacts must use the configured Comet artifact language. Read `language` from `.comet/config.yaml` before `.comet.yaml` exists, then use `"$COMET_BASH" "$COMET_STATE" get <name> language` after initialization.

Execution chain: open → OpenSpec apply → verify → archive. Tweak provides default decisions for each phase: streamlined open, direct build through OpenSpec apply, scale- and delta-spec-driven verification weight, and final archive confirmation after verification passes.

Before starting, locate Comet scripts via `comet/reference/scripts.md`. When resuming from any entry point, first use `comet/reference/context-recovery.md` to confirm phase/workflow.

### 1. Quick Open (preset open)

Reuse Comet open capability to create change, but use tweak defaults: do not execute `openspec-explore` long exploration, directly enter streamlined change creation.

**Immediately execute:** Use the Skill tool to load the `openspec-new-change` skill. Skipping this step is prohibited.

After the skill loads, follow its guidance to create streamlined artifacts:
  - `proposal.md` — change motivation + goals + scope
  - `design.md` — brief implementation description (no solution comparison needed)
  - `tasks.md` — task list (keep to a reasonable size; count itself does not trigger upgrade, see "Upgrade Assessment")
  - `delta spec` (optional) — if the change affects existing spec acceptance scenarios, create it as a normal artifact (only `## MODIFIED Requirements` or `## ADDED Requirements`). Delta spec is the core artifact of OpenSpec brownfield changes; needing delta spec alone does not constitute an upgrade reason

Initialize Comet state file:

```bash
node "$COMET_STATE" init <name> tweak
```

Verify initialized state:

```bash
node "$COMET_STATE" check <name> open
```

Run phase guard to transition open → build:

```bash
node "$COMET_GUARD" <change-name> open --apply
```

### 2. OpenSpec Apply Build (tweak-only preset build)

Use tweak defaults: `build_mode: direct`. Skip Superpowers `brainstorming` and `writing-plans`, and let OpenSpec's apply action execute the current change's tasks.

<IMPORTANT>
This apply path belongs only to tweak. Full `/comet` or `workflow: full` must not use tweak's `openspec-apply-change` build path; full must still generate a Design Doc through `/comet-design`, then let `/comet-build` use Superpowers `writing-plans`, execution-method selection, and the corresponding execution skill to build.
</IMPORTANT>

Before continuing or starting changes, handle uncommitted changes through `comet/reference/dirty-worktree.md`. If attribution shows a qualitative-change signal or file-count tripwire is hit, handle it through this file's "Upgrade Assessment".

**Immediately execute:** Use the Skill tool to load the `openspec-apply-change` skill. Skipping this step is prohibited.

After the skill loads, use the current `<change-name>` as input and follow `openspec-apply-change` to execute the OpenSpec apply flow:

1. Run or follow `openspec status --change "<name>" --json` to confirm the schema and task artifact
2. Run or follow `openspec instructions apply --change "<name>" --json` to read OpenSpec's apply instructions, `contextFiles`, task progress, and dynamic instruction
3. Read every context file listed by the apply instructions; do not implement from stale conversation context or a handwritten tasks loop alone
4. Complete unchecked tasks one by one according to the apply instructions, keeping changes minimal and focused
5. After each completed task:
   - Run the project formatter (e.g., `mvn spotless:apply`, `npm run format`)
   - Run related tests to confirm pass
   - Mark the corresponding task complete according to `openspec-apply-change`
   - Commit code, commit message format: `tweak: <brief change description>`
6. After all tasks complete, explicitly run relevant project tests and build commands

During tweak execution, whenever running programs, tests, builds, or manual verification results in crashes, abnormal behavior, test failures, or build failures, you must use the Skill tool to load the Superpowers `systematic-debugging` skill. Do not propose or implement source code fixes before completing root cause investigation.

For specific investigation, minimal failing test, fix verification, and keeping the current change verification loop, follow `comet/reference/debug-gate.md`.

**Upgrade assessment check**: Continuously judge throughout build, and do a consolidated re-check before running the build→verify guard. Assessment uses a three-layer division of labor (see "Upgrade Assessment" section): qualitative-change signals rely on agent semantic recognition, file count is only a hint delegated to the user, and the scale script only governs verification weight. When a qualitative-change signal or file-count tripwire is hit, **do not upgrade on your own or decide to continue on your own** — must pause per `comet/reference/decision-point.md` and delegate the decision to the user: continue the tweak lightweight flow, or upgrade to the full `/comet`.

7. Run phase guard to transition build → verify:

```bash
node "$COMET_GUARD" <change-name> build --apply
```

State automatically updates to `phase: verify`, `verify_result: pending`, then enter verification.

### 3. Verification (preset verify)

Reuse `/comet-verify`; let comet-verify's scale assessment decide lightweight or full verification.

**Immediately execute:** Use the Skill tool to load the `comet-verify` skill. Skipping this step is prohibited.

**Delta-spec verification routing**: tweak accepts delta spec as a normal artifact. If this change created a delta spec, explicitly set full verification mode before entering comet-verify, to run OpenSpec-native verification (`openspec-verify-change`) covering delta-spec consistency:

```bash
node "$COMET_STATE" set <change-name> verify_mode full
```

A tweak without delta spec usually meets lightweight verification conditions (≤ 3 tasks, changed files below the scale threshold); comet-verify's scale assessment selects the lightweight verification path (6 quick checks). If the user wants to add review, run `node "$COMET_STATE" set <name> review_mode standard` or `thorough` before verification.

After verification passes, record `.comet.yaml` `verify_result` as `pass` according to `/comet-verify` rules, must not skip this status before archiving. After verification passes, still enter `/comet-archive`'s final archive confirmation; do not automatically run the archive script.

### 4. Archive (preset archive)

Reuse `/comet-archive`. Must satisfy `verify_result: pass` in `.comet.yaml` before archiving, and wait for `/comet-archive`'s final archive confirmation.

**Immediately execute:** Use the Skill tool to load the `comet-archive` skill to archive. Skipping this step is prohibited.

---

## Continuous Execution Mode

<IMPORTANT>
Tweak workflow is **one-time continuous execution**. After invoking `/comet-tweak`, agent must automatically advance through tweak steps, without pausing to wait for user input mid-way.

Exception: when `.comet.yaml` has `auto_transition: false`, after each phase guard advances `phase`, do not auto-invoke the next skill. In this case, use `node "$COMET_STATE" next <name>` output and pause for manual continuation as instructed.

The following situations must pause and wait for user confirmation:

1. Encountering an upgrade-assessment signal (see "Upgrade Assessment" section). **Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly choose**: continue the tweak lightweight flow, or upgrade to the full `/comet` workflow
2. verify phase (comet-verify) verification-failure and branch-handling decisions
3. Final archive confirmation (before comet-archive runs the archive script)

Execution order: quick open → build (with upgrade assessment) → verification → archive → complete

After each phase completes, immediately enter next phase. Within each phase, must still call corresponding Comet/OpenSpec/Superpowers skill according to above requirements; if the called skill has its own user decision points, follow that skill's rules.
</IMPORTANT>

---

## Upgrade Assessment

Tweak upgrade assessment only decides whether to move from the lightweight preset to full; delta spec alone is not an upgrade reason, file count never upgrades automatically, and `comet-state scale` only decides verification weight.

If `/comet` passes an intent frame from the entry, tweak must recheck `risk_signal` and escalation signals only before build: new capability, public API, schema change, cross-module coordination, or deep architecture work. When any signal matches, enter the existing escalation decision point. Delta spec remains a normal tweak artifact and must not trigger escalation by itself; do not reimplement entry intent recognition.

Continuously check these qualitative-change signals: cross-module coordination, needing a new capability, database schema changes, introducing a new public API, or touching a deep architecture problem; plus the tweak-specific signal: needing to split into multiple OpenSpec changes. If any signal appears, the agent **must not self-upgrade or self-decide to continue**.

The file-count tripwire is only a prompt: when changed files exceed the hint threshold (for example > 6 files), ask the user whether to continue tweak or upgrade full. More files do not necessarily mean qualitative change. Tweaks often come with delta spec or config changes, so their reach is naturally wider than a bug fix, hence the higher threshold than hotfix.

When a qualitative-change signal or file-count tripwire is hit, **must pause under the `comet/reference/decision-point.md` protocol and wait for the user's explicit choice**. Do not directly enter `/comet-design`; do not automatically add a Design Doc.

After the user chooses upgrade (option B), use the legal state-machine upgrade channel, a single command that converts the preset workflow to full and rolls back to design:

```bash
node "$COMET_STATE" transition <name> preset-escalate
```

This command atomically sets `workflow`/`classic_profile` to `full`, rolls `phase` back to `design`, and clears `design_doc` (satisfying comet-design entry requirements). Then add the Design Doc on the current change: **immediately use the Skill tool to load the `comet-design` skill**, then proceed through the normal full workflow.

When the user chooses continue (option A), continue the tweak workflow and record the user's reason for continuing.

---

## Exit Conditions

- Change completed, tests pass
- Change archived
- If spec changed, synced to main spec
- **Phase guard**: Before build → verify run `node "$COMET_GUARD" <change-name> build --apply`; before verify → archive follow `/comet-verify` and run `node "$COMET_GUARD" <change-name> verify --apply`

## Automatic Handoff to Next Phase

Follow `comet/reference/auto-transition.md`. Key command:

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → invoke the skill pointed to by `SKILL` to continue tweak workflow (`phase: build` returns `comet-tweak`, `verify` returns `comet-verify`, `archive` returns `comet-archive`)
- `NEXT: manual` → do not invoke the next skill; prompt user to manually run `/<SKILL>` per `HINT`
- `NEXT: done` → workflow is complete, no further action needed
