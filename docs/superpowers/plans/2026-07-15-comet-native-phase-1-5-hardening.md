# Comet Native Phase 1.5 Hardening Implementation Plan

> 状态：实施与验证完成。步骤使用 checkbox 跟踪。

**Goal:** Close Native confirmation, spec metadata/rebase, transition recovery, lock/path safety, state consistency, and eval gaps without adding workflow phases or external dependencies.

**Architecture:** Keep `runNativeCli` as the user-facing seam. Use one spec reconciliation module for runtime-owned metadata and conflict rebase, one transition journal for recoverable Engine-backed projections, and one mutation-lock protocol for root/change serialization. Preserve Classic isolation and keep all new behavior inside `domains/comet-native/`.

**Tech Stack:** TypeScript, Node.js filesystem APIs, YAML, Vitest, existing Comet Engine storage, Markdown Skill assets, local eval TOML/YAML/Python scaffold.

## Global Constraints

- Native and Classic remain separate workflows with no conversion or shared change directory.
- Native uses `<artifact-root>/comet/` and no hidden Native state root.
- Native depends on no OpenSpec, Superpowers, grilling, or other external Skill.
- No TDD, planning, review, or isolation mode becomes a Native state field or gate.
- Skill changes are written in Chinese first and require user confirmation before English synchronization.
- Development-only corrections to the unshipped Native branch do not add changelog process entries.

---

### Task 1: Runtime-owned confirmation and spec metadata

**Files:**

- Create: `domains/comet-native/native-specs.ts`
- Modify: `domains/comet-native/native-types.ts`
- Modify: `domains/comet-native/native-change.ts`
- Modify: `domains/comet-native/native-cli.ts`
- Modify: `domains/comet-native/native-transitions.ts`
- Test: `test/domains/comet-native/native-specs.test.ts`
- Test: `test/domains/comet-native/native-cli.test.ts`
- Test: `test/domains/comet-native/native-transitions.test.ts`

**Interfaces:**

- Produces: `reconcileNativeSpecChanges(paths, state): Promise<NativeSpecChange[]>`
- Produces: `markNativeSpecRemoval(paths, name, capability): Promise<NativeChangeState>`
- Extends: `NativeAdvanceEvidence` with `confirmed?: boolean`

- [x] **Step 1: Write failing confirmation CLI tests**

Add assertions that Shape or Build `next --confirmed` records `approval: confirmed`, ordinary progression records `implicit`, and Verify rejects `--confirmed` with a guard finding.

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run test/domains/comet-native/native-cli.test.ts test/domains/comet-native/native-transitions.test.ts`

Expected: failures because `--confirmed` is unknown and evidence has no confirmation field.

- [x] **Step 3: Implement the confirmation input**

Parse `--confirmed` only on `next`, include it in the evidence hash, remove `confirmation_required` from `NativeChangeState`, and set approval during successful Shape or Build transitions.

- [x] **Step 4: Run the focused tests and confirm GREEN**

Run the command from Step 2 and require all tests to pass.

- [x] **Step 5: Write failing spec reconciliation tests**

Cover create inference, replace inference with frozen SHA-256, preservation of the original hash after canonical drift, explicit remove, proposed/remove conflict, conflict rebase back to Build, and no state write after a failed guard.

- [x] **Step 6: Run the spec tests and confirm RED**

Run: `npx vitest run test/domains/comet-native/native-specs.test.ts`

Expected: failure because `native-specs.ts` and its public functions do not exist.

- [x] **Step 7: Implement spec reconciliation and `spec remove`**

Scan only `specs/<capability>/spec.md`, reject symlink/junction/path escapes, infer create/replace, preserve previously frozen base hashes, write remove metadata only through the Native command, and rebase conflicts through a journaled Build transition.

- [x] **Step 8: Run all Task 1 tests and confirm GREEN**

Run: `npx vitest run test/domains/comet-native/native-specs.test.ts test/domains/comet-native/native-cli.test.ts test/domains/comet-native/native-transitions.test.ts test/domains/comet-native/native-artifacts.test.ts`

Expected: all selected tests pass.

### Task 2: Recoverable ordinary transitions

**Files:**

- Create: `domains/comet-native/native-transition-journal.ts`
- Modify: `domains/comet-native/native-types.ts`
- Modify: `domains/comet-native/native-transitions.ts`
- Modify: `domains/comet-native/native-archive.ts`
- Modify: `domains/comet-native/native-diagnostics.ts`
- Modify: `domains/comet-native/native-doctor.ts`
- Test: `test/domains/comet-native/native-transition-recovery.test.ts`
- Test: `test/domains/comet-native/native-doctor.test.ts`

**Interfaces:**

- Produces: `prepareNativeTransition(...)`
- Produces: `continueNativeTransition(paths, name): Promise<NativeChangeState | null>`
- Produces: `inspectPendingNativeTransition(paths, name): Promise<NativeTransitionJournal | null>`
- Extends: `advanceNativeChange` test hooks with prepared, Run-written, and change-written interruption points.

- [x] **Step 1: Write failing interruption tests**

Inject failure after journal preparation, after Run write, and after change write. For every case, call `continueNativeTransition`, then assert matching change/Run phase, exactly one transition event, a current checkpoint, and no remaining journal.

- [x] **Step 2: Run recovery tests and confirm RED**

Run: `npx vitest run test/domains/comet-native/native-transition-recovery.test.ts`

Expected: failure because no transition journal or recovery API exists.

- [x] **Step 3: Implement the journal and route transition persistence through it**

Write `runtime/transition.json` before `run_started` or any next-state file, make every continuation step idempotent, deduplicate trajectory by transition id, and remove the journal only after checkpoint persistence.

- [x] **Step 4: Run recovery tests and confirm GREEN**

Run the command from Step 2 and require all interruption cases to pass.

- [x] **Step 5: Write failing status/doctor/archive recovery tests**

Assert read-only status and doctor report a pending transition, `doctor --repair --strategy continue` completes it, and archive completes a pending transition before building its archive transaction.

- [x] **Step 6: Run the focused tests and confirm RED**

Run: `npx vitest run test/domains/comet-native/native-doctor.test.ts test/domains/comet-native/native-archive-recovery.test.ts`

Expected: pending transitions are not yet reported or recovered.

- [x] **Step 7: Integrate diagnostics, doctor, and archive**

Add one error finding for pending transition journals, one safe continue repair path, a pre-archive continuation call, and consistency checks across change state, Run state, trajectory, and checkpoint.

- [x] **Step 8: Run all Task 2 tests and confirm GREEN**

Run: `npx vitest run test/domains/comet-native/native-transition-recovery.test.ts test/domains/comet-native/native-doctor.test.ts test/domains/comet-native/native-archive-recovery.test.ts test/domains/comet-native/native-transitions.test.ts`

Expected: all selected tests pass.

### Task 3: Chinese Skill and Native decision/recovery eval

**Files:**

- Modify: `assets/skills-zh/comet-native/SKILL.md`
- Modify: `assets/skills-zh/comet-native/reference/artifacts.md`
- Modify: `assets/skills-zh/comet-native/reference/commands.md`
- Modify: `assets/skills-zh/comet-native/reference/recovery.md`
- Modify: `eval/local/tasks/index.yaml`
- Create: `eval/local/tasks/comet-native-clarification/task.toml`
- Create: `eval/local/tasks/comet-native-clarification/instruction.md`
- Create: `eval/local/tasks/comet-native-clarification/validation/test_native_clarification.py`
- Create: `eval/local/tasks/comet-native-repository-fact/`
- Create: `eval/local/tasks/comet-native-interrupted-transition/`
- Test: `test/domains/comet-native/native-skill.test.ts`
- Test: `eval/local/tests/scaffold/test_tasks.py`

**Interfaces:**

- Documents: `next --confirmed`, runtime-owned `spec_changes`, and transition continuation.
- Adds: clarification, repository-fact, and interrupted-transition tasks with deterministic validators.

- [x] **Step 1: Write failing Chinese Skill assertions**

Require `--confirmed`, the proposed-spec directory convention, runtime-managed hash wording, and transition recovery wording; reject instructions to hand-edit approval or base hash.

- [x] **Step 2: Run Skill tests and confirm RED**

Run: `npx vitest run test/domains/comet-native/native-skill.test.ts`

- [x] **Step 3: Update only the Chinese Skill package**

Keep the main prompt short. Put command syntax and recovery mechanics in references, and preserve the one-highest-value-question protocol.

- [x] **Step 4: Add and statically validate the clarification eval task**

Define a multi-turn clarification task, a task where the answer must come from repository inspection rather than a user question, and a prepared-journal fixture that must recover without duplicate trajectory events.

- [x] **Step 5: Run Chinese and eval scaffold verification**

Run: `npx vitest run test/domains/comet-native/native-skill.test.ts`

Run: `uv run pytest local/tests/scaffold/test_tasks.py local/tests/scaffold/test_treatments.py -q` from `eval/` when the local Python environment is available.

- [x] **Step 6: Stop for Chinese user review**

Show the Chinese Skill diff and do not modify `assets/skills/comet-native/` until the user approves it.

### Task 4: English synchronization, generated assets, and release verification

**Files:**

- Modify: `assets/skills/comet-native/SKILL.md`
- Modify: `assets/skills/comet-native/reference/artifacts.md`
- Modify: `assets/skills/comet-native/reference/commands.md`
- Modify: `assets/skills/comet-native/reference/recovery.md`
- Modify: `assets/skills/comet-native/scripts/comet-native-runtime.mjs`
- Modify: relevant generated manifests only when the build changes them

**Interfaces:**

- Synchronizes the approved Chinese behavior into English without changing semantics.

- [x] **Step 1: Translate the approved Chinese Skill behavior**

Keep EN/ZH command examples, field ownership, stop conditions, and recovery instructions semantically equivalent.

- [x] **Step 2: Build the bundled Native runtime**

Run: `pnpm build:native-runtime`

- [x] **Step 3: Run focused Native verification**

Run: `npx vitest run test/domains/comet-native test/app/native-command.test.ts test/repository/native-boundaries.test.ts test/repository/native-runtime-assets.test.ts`

- [x] **Step 4: Run repository verification**

Run: `pnpm format:check`

Run: `pnpm lint`

Run: `pnpm build`

Run: `npx vitest run`

- [x] **Step 5: Review release metadata**

Compare `package.json`, `origin/master`, and the existing top changelog entry. Do not add development-process bullets; only adjust the existing unreleased Native capability description if final user-visible behavior is missing.

- [x] **Step 6: Prepare the completed Phase 1.5 commit**

Stage only the Phase 1.5 files and commit with a compliant message such as `fix(native): harden workflow state boundaries`.
