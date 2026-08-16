# Supervisor Display Copy Implementation Plan

> **For agentic workers:** This plan is executed inline in the current Comet Native change. It does not invoke Superpowers subagent workflows.

**Goal:** Replace technical Supervisor verification labels with plain Chinese/English descriptions while preserving every machine enum and status schema.

**Architecture:** Keep raw assurance values in Portable State and status JSON. Update the Native verification report's localized copy and verdict wording, the Dashboard presentation map, and CLI/reference guidance independently at their existing presentation boundaries. Add focused regression assertions and rebuild affected Native/Entry assets.

**Tech Stack:** TypeScript, React/JSX, Vitest, Playwright, Markdown, Native runtime bundle scripts.

## Global Constraints

- Do not rename or split `host-attested`, `skill-coordinated`, `semantic-verification-unavailable`, or `user-confirmed-degraded`.
- Do not change Runtime state transitions, verification logic, status JSON schema, or Dashboard layout.
- Human copy must distinguish verification passed, confirmation required, archive-ready, and archived.
- Keep Chinese and English Native reference text semantically aligned.

---

### Task 1: Lock the report copy with failing tests

**Files:**

- Modify: `test/domains/comet-native/native-cli-v4-surface.test.ts`
- Test: `test/domains/comet-native/native-cli-v4-surface.test.ts`

**Interfaces:**

- Consumes: existing `runnerStep`, `finalResponse`, and report assertions.
- Produces: failing assertions for the four human-readable assurance labels and the three archive/verifier result distinctions.

- [ ] **Step 1: Replace raw report assertions with plain-language expectations**

  Assert that the pending Skill-coordinated report says `已完成检查，但需要你确认验证结果` (or its English equivalent for an English state), the unavailable report says `无法完成完整验证，只完成了自动检查`, the confirmed degraded report says `你已确认接受不完整验证结果`, and the final archive-ready report says `验收通过，可归档`.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run:

  ```bash
  pnpm exec vitest run test/domains/comet-native/native-cli-v4-surface.test.ts
  ```

  Expected: FAIL only because the current report still emits `Assurance: **skill-coordinated**`, `Assurance: **semantic-verification-unavailable**`, and generic `Passed` wording.

### Task 2: Implement localized report copy and result distinctions

**Files:**

- Modify: `domains/comet-native/native-verification-report-v2.ts`
- Test: `test/domains/comet-native/native-cli-v4-surface.test.ts`

**Interfaces:**

- Consumes: `NativePortableState`, current `verification.assurance`, `phase`, `loop.next_action`, and `archived` fields.
- Produces: localized human-readable assurance labels and verdict labels; raw state values remain unchanged.

- [ ] **Step 1: Add the four localized user-facing assurance labels**

  Map the raw values to:

  ```text
  host-attested                         -> 已完成独立验证 / Host independently verified
  skill-coordinated                    -> 已完成检查，但需要你确认验证结果 / Checks completed, but your confirmation is required
  semantic-verification-unavailable   -> 无法完成完整验证，只完成了自动检查 / Full verification was unavailable; only automatic checks completed
  user-confirmed-degraded              -> 你已确认接受不完整验证结果 / You accepted the incomplete verification result
  ```

  Change the report heading from technical `保证级别`/`Assurance` to `验证情况`/`Verification status`.

- [ ] **Step 2: Distinguish report result states**

  Render `验收通过，需要你确认` while the state is awaiting Skill-coordinated confirmation, `验收通过，可归档` when verification passed and Archive is the next action, and `已归档` after `state.archived` is true. Preserve the existing unavailable and failed branches.

- [ ] **Step 3: Run the focused test and verify it passes**

  Run the same Vitest command from Task 1. Expected: PASS for the updated report assertions.

### Task 3: Synchronize Dashboard presentation copy

**Files:**

- Modify: `domains/dashboard/web/src/native-workflow-panel.jsx`
- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`

**Interfaces:**

- Consumes: unchanged Dashboard `verification.assurance` values from the adapter.
- Produces: plain-language assurance pill labels and updated demo assertions; no changes to adapter payloads.

- [ ] **Step 1: Update `ASSURANCE_PRESENTATION` labels**

  Use the same Chinese labels as the report. Keep existing tones and add the longer explanation as the existing Ant Design `Tooltip` title so the pill remains readable without changing layout.

- [ ] **Step 2: Update the archived demo assertion**

  Change the existing `用户确认降级通过` expectation to `你已确认接受不完整验证结果`, and add a visible assertion for the corresponding assurance explanation where the demo exposes it.

- [ ] **Step 3: Run Dashboard focused tests**

  Run:

  ```bash
  pnpm exec vitest run test/domains/dashboard/native-adapter.test.ts
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --project=chromium
  ```

  Expected: PASS with raw adapter assurance values unchanged.

### Task 4: Update CLI/reference wording and generated assets

**Files:**

- Modify: `domains/comet-native/native-cli-help.ts`
- Modify: `assets/skills-zh/comet-native/reference/commands.md`
- Modify: `assets/skills/comet-native/reference/commands.md`
- Modify: `CHANGELOG.md` (append a user-visible Changed bullet under `0.4.0-beta.20`)
- Generate: Native/Entry runtime assets through repository scripts.

**Interfaces:**

- Consumes: unchanged CLI protocol names and continuation fields.
- Produces: help/reference copy that explains raw protocol names in plain language and generated bundles matching source.

- [ ] **Step 1: Add plain-language explanations without renaming protocol tokens**

  Keep raw names needed for JSON and command templates, but explain that Skill-coordinated verification requires user confirmation and verifier-unavailable means automatic checks only. Keep Chinese and English references semantically aligned.

- [ ] **Step 2: Update the beta20 user-facing changelog**

  Add one concise `Changed` bullet describing clearer verification/Archive status wording; do not mention internal refactors or test mechanics.

- [ ] **Step 3: Rebuild and check generated assets**

  Run:

  ```bash
  pnpm run build:native-runtime
  pnpm run build:entry-runtime
  pnpm run check:generated
  ```

  Expected: generated runtime assets are synchronized and `check:generated` exits 0.

### Task 5: Final verification and handoff

**Files:**

- Test: Native report, Dashboard adapter/browser, Entry/Skill contract suites, and TypeScript compilation.

- [ ] **Step 1: Run the minimum related verification**

  ```bash
  pnpm exec vitest run test/domains/comet-native/native-cli-v4-surface.test.ts test/domains/dashboard/native-adapter.test.ts
  pnpm exec vitest run test/domains/comet-entry test/domains/skill
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 2: Check formatting and architecture**

  ```bash
  pnpm format:check
  pnpm lint:architecture
  git diff --check
  ```

- [ ] **Step 3: Submit the Builder handoff through Native Runtime**

  After the source, docs, tests, and generated assets are green, use the current continuation's `builder-handoff` template with a summary that states raw enums were preserved and the four display labels plus Archive wording were synchronized.

- [ ] **Step 4: Commit the implementation**

  ```bash
  git add domains/comet-native/native-verification-report-v2.ts domains/comet-native/native-cli-help.ts domains/dashboard/web/src/native-workflow-panel.jsx test/domains/comet-native/native-cli-v4-surface.test.ts test/domains/dashboard/dashboard-browser.spec.ts assets/skills-zh/comet-native/reference/commands.md assets/skills/comet-native/reference/commands.md CHANGELOG.md assets/skills/comet-native/scripts assets/skills/comet/scripts domains/comet-native domains/comet-entry
  git commit -m "fix(native): clarify Supervisor verification status"
  ```
