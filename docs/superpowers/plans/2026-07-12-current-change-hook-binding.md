# Current Change Hook Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind ordinary Classic hook-guard source writes to the explicitly selected change so unrelated active changes cannot globally block a legal build.

**Architecture:** Store a versioned, ignored worktree-local selection in `.comet/current-change.json`, managed by `comet state select|current|clear-selection`. The hook preserves its existing OpenSpec and Superpowers path routing, but ordinary repository source writes resolve the validated selection first, fall back only when exactly one active change exists, and fail closed with an ambiguity diagnostic when multiple active changes have no valid selection.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Vitest 4, generated Classic `.mjs` runtime, Markdown Skill/rule assets.

## Global Constraints

- Work directly on the existing `beta4` branch; do not create another branch or worktree.
- Use TDD for every runtime behavior change: add one focused failing test, run it and observe the expected failure, then implement the minimum production change.
- Keep `.comet.yaml` unchanged; current selection is execution context, not change lifecycle state.
- Do not infer a change from branch naming or ordinary source paths.
- Multiple active changes without a valid selection must fail closed and tell the user to run `comet state select <change-name>`.
- A single active change without a selection must retain current behavior.
- OpenSpec paths, recorded/name-matched Superpowers artifacts, and existing allowlists retain their current routing.
- Skill edits must be written in `assets/skills-zh/` first and then synchronized to `assets/skills/`.
- Runtime source changes must be regenerated with `pnpm build:classic-runtime`.
- Keep the release version at `0.4.0-beta.4` as explicitly requested; do not modify package, lockfile, or manifest versions, and append the user-visible fix to the existing beta.4 Changelog entry.

---

## File Structure

- Create `domains/comet-classic/classic-current-change.ts`: own the selection schema, atomic persistence, branch snapshot, validation, and clear operation.
- Modify `domains/comet-classic/classic-state-command.ts`: expose `select`, `current`, and `clear-selection` without adding `.comet.yaml` fields.
- Modify `domains/comet-classic/classic-hook-guard.ts`: resolve ordinary repository source writes from the validated current selection and emit ambiguity/stale-selection diagnostics.
- Modify `domains/comet-classic/index.ts`: export the current-change module for focused tests and package consumers.
- Create `test/domains/comet-classic/classic-current-change.test.ts`: unit-test persistence, validation, branch mismatch, and idempotent cleanup.
- Modify `test/domains/comet-classic/classic-hook-guard.test.ts`: integration-test state commands and selected multi-change hook behavior against generated launchers.
- Modify `test/domains/comet-classic/comet-scripts.test.ts`: replace the old global-blocking contract with generated-runtime regression cases.
- Modify `assets/skills-zh/comet/SKILL.md` and `assets/skills/comet/SKILL.md`: select the resolved change before entering a phase Skill.
- Modify the Chinese and English phase Skills under `assets/skills-zh/comet-{open,design,build,verify,archive,hotfix,tweak}/SKILL.md` and `assets/skills/comet-{open,design,build,verify,archive,hotfix,tweak}/SKILL.md`: make selection the first state operation once a change name is known.
- Modify `assets/skills-zh/comet/reference/scripts.md`, `assets/skills/comet/reference/scripts.md`, `assets/skills/comet/rules/comet-phase-guard.md`, and `assets/skills/comet/rules/comet-phase-guard.en.md`: document the command and multi-change hard-guard behavior.
- Regenerate `assets/skills/comet/scripts/comet-runtime.mjs` and any build-owned Classic runtime artifacts.
- Modify `CHANGELOG.md`: append one English `Fixed` bullet linked to #196 under the existing `0.4.0-beta.4` entry.

---

### Task 1: Worktree-Local Current Change Store

**Files:**

- Create: `domains/comet-classic/classic-current-change.ts`
- Create: `test/domains/comet-classic/classic-current-change.test.ts`
- Modify: `domains/comet-classic/index.ts`

**Interfaces:**

- Produces: `selectCurrentChange(projectRoot: string, changeName: string): Promise<CurrentChangeSelection>`
- Produces: `resolveCurrentChange(projectRoot: string): Promise<CurrentChangeResolution>`
- Produces: `clearCurrentChange(projectRoot: string): Promise<void>`
- Produces: `currentChangeFile(projectRoot: string): string`
- `CurrentChangeResolution` is `{ status: 'selected'; selection: CurrentChangeSelection } | { status: 'missing' } | { status: 'stale'; reason: string }`.

- [ ] **Step 1: Write failing persistence and validation tests**

Create focused tests that initialize temporary Git repositories and active changes, then assert:

```ts
it('atomically selects an active change with the current branch', async () => {
  await seedActiveChange(root, 'change-a', false);
  const selected = await selectCurrentChange(root, 'change-a');

  expect(selected).toEqual({ version: 1, change: 'change-a', branch: 'main' });
  expect(JSON.parse(await fs.readFile(currentChangeFile(root), 'utf8'))).toEqual(selected);
});

it('rejects missing, archived, and invalid changes', async () => {
  await expect(selectCurrentChange(root, '../escape')).rejects.toThrow('Invalid change name');
  await expect(selectCurrentChange(root, 'missing')).rejects.toThrow('active change');
  await seedActiveChange(root, 'archived-change', true);
  await expect(selectCurrentChange(root, 'archived-change')).rejects.toThrow('archived');
});

it('marks a selection stale after the branch changes', async () => {
  await seedActiveChange(root, 'change-a', false);
  await selectCurrentChange(root, 'change-a');
  git(root, 'switch', '-c', 'other');
  expect(await resolveCurrentChange(root)).toMatchObject({ status: 'stale' });
});

it('clears the selection idempotently', async () => {
  await clearCurrentChange(root);
  await clearCurrentChange(root);
  expect(await fileExists(currentChangeFile(root))).toBe(false);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-current-change.test.ts
```

Expected: FAIL because `classic-current-change.ts` and its exported interfaces do not exist.

- [ ] **Step 3: Implement the minimal current-change module**

Implement a versioned schema and an atomic writer. The public shape must remain:

```ts
export interface CurrentChangeSelection {
  version: 1;
  change: string;
  branch: string | null;
}

export type CurrentChangeResolution =
  | { status: 'selected'; selection: CurrentChangeSelection }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };
```

Use `assertOpenSpecChangeName()` before path construction, require `openspec/changes/<name>/.comet.yaml`, read the Classic state without mutating it, reject `archived: true`, obtain the branch with `git rev-parse --abbrev-ref HEAD`, and treat `HEAD` as `null`. Write JSON plus a final newline to a UUID-suffixed temporary file, then rename it to `.comet/current-change.json`; remove only the temporary file on failure.

`resolveCurrentChange()` must distinguish:

- missing file → `{ status: 'missing' }`;
- malformed JSON/schema, unreadable file, missing/archived change, or branch mismatch → `{ status: 'stale', reason }`;
- fully valid selection → `{ status: 'selected', selection }`.

Permission and parse errors must not be treated as a missing selection.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-current-change.test.ts
```

Expected: all current-change tests PASS.

- [ ] **Step 5: Run formatting and type-aware lint for the task**

Run:

```bash
npx prettier --check domains/comet-classic/classic-current-change.ts test/domains/comet-classic/classic-current-change.test.ts domains/comet-classic/index.ts
npx eslint domains/comet-classic/classic-current-change.ts domains/comet-classic/index.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the current-change store**

```bash
git add domains/comet-classic/classic-current-change.ts domains/comet-classic/index.ts test/domains/comet-classic/classic-current-change.test.ts
git commit -m "feat(classic): persist current change selection"
```

---

### Task 2: State CLI Selection Commands

**Files:**

- Modify: `domains/comet-classic/classic-state-command.ts`
- Modify: `test/domains/comet-classic/classic-hook-guard.test.ts`

**Interfaces:**

- Consumes: Task 1 current-change store functions.
- Produces: `comet state select <change-name>`, `comet state current`, and `comet state clear-selection`.

- [ ] **Step 1: Add failing launcher-level command tests**

Extend `classic-hook-guard.test.ts` with:

```ts
it('selects, reads, and clears the current change through the state launcher', async () => {
  const dir = await makeGitProject();
  run(dir, 'state', ['init', 'demo', 'hotfix']);

  const selected = run(dir, 'state', ['select', 'demo']);
  expect(selected.status).toBe(0);
  expect(selected.stdout).toContain('[SELECTED] current change: demo');
  expect(run(dir, 'state', ['current']).stdout.trim()).toBe('demo');
  expect(run(dir, 'state', ['clear-selection']).status).toBe(0);
  expect(run(dir, 'state', ['current']).status).not.toBe(0);
});
```

Also assert selection rejects a missing change and `clear-selection` succeeds twice.

- [ ] **Step 2: Run the command test and verify RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "selects, reads, and clears"
```

Expected: FAIL with `Unknown subcommand: select` from the generated state launcher.

- [ ] **Step 3: Add the three state subcommands**

In `classic-state-command.ts`, parse exactly these forms:

```ts
} else if (subcommand === 'select') {
  required(rest, 1, 'Usage: comet-state.mjs select <change-name>');
  await select(output, rest[0]);
} else if (subcommand === 'current') {
  requiredExact(rest, 0, 'Usage: comet-state.mjs current');
  await current(output);
} else if (subcommand === 'clear-selection') {
  requiredExact(rest, 0, 'Usage: comet-state.mjs clear-selection');
  await clearSelection(output);
```

The handlers must delegate to Task 1 rather than parse JSON themselves. `current` returns the selected change on stdout; missing/stale selections return a nonzero command failure with the resolution reason. Reject unexpected positional arguments so typos do not silently mutate selection.

- [ ] **Step 4: Regenerate runtime and verify GREEN**

Run:

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "selects, reads, and clears"
```

Expected: runtime build exits 0 and command tests PASS.

- [ ] **Step 5: Commit state commands and generated runtime**

```bash
git add domains/comet-classic/classic-state-command.ts test/domains/comet-classic/classic-hook-guard.test.ts assets/skills/comet/scripts/comet-runtime.mjs
git commit -m "feat(classic): expose current change commands"
```

---

### Task 3: Bind Ordinary Source Writes to the Selection

**Files:**

- Modify: `domains/comet-classic/classic-hook-guard.ts`
- Modify: `test/domains/comet-classic/classic-hook-guard.test.ts`
- Modify: `test/domains/comet-classic/comet-scripts.test.ts`

**Interfaces:**

- Consumes: `resolveCurrentChange(projectRoot)` from Task 1.
- Produces: selected, single-change fallback, ambiguity, and stale-selection routing for ordinary source paths.

- [ ] **Step 1: Add one failing ambiguity regression**

Create a legal build change and an unrelated open change without calling `select`, then assert:

```ts
expect(result.status).toBe(2);
expect(result.stderr).toContain('multiple active changes require a current change');
expect(result.stderr).toContain('comet state select <change-name>');
expect(result.stderr).toContain('build-ready');
expect(result.stderr).toContain('open-change');
expect(result.stderr).not.toContain('Current phase: open');
```

- [ ] **Step 2: Run the ambiguity test and verify RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "multiple active changes require"
```

Expected: FAIL because the existing hook selects the open change and prints `Current phase: open`.

- [ ] **Step 3: Implement selection-aware ordinary source resolution**

Replace `repoSourceGoverningChange()` with a result that can represent either a governing change or a blocking diagnostic:

```ts
type RepoSourceResolution =
  | { status: 'governing'; governing: GoverningChange }
  | { status: 'none' }
  | { status: 'blocked'; message: string };
```

Resolution order:

1. no active changes → `none`;
2. valid explicit selection → matching active governing change only;
3. stale/corrupt selection → `blocked` with its reason (do not silently select another change);
4. no selection and one active change → that change;
5. no selection and multiple active changes → `blocked` with sorted names and selection command.

Do not change path-owned OpenSpec resolution or matched Superpowers artifact resolution. For unmatched Superpowers fallback, preserve the existing unmatched-artifact block instead of allowing it through the selected change.

- [ ] **Step 4: Verify ambiguity GREEN**

Run the test from Step 2 again. Expected: PASS.

- [ ] **Step 5: Add selected-phase matrix regressions one at a time**

Add and individually observe RED before any additional production adjustment:

- legal build selected + unrelated design → source write allowed;
- legal build selected + unrelated pending archive → source write allowed;
- open selected + unrelated legal build → source write blocked as open;
- single active design without selection → still blocked as design;
- archived changes ignored when deciding ambiguity;
- malformed selection JSON → fail closed with selection-file diagnostic;
- branch switch after selection → fail closed as stale;
- full build without `design_doc` selected → illegal-jump block retained;
- direct OpenSpec artifact routing and matched Superpowers artifact routing remain unchanged.

- [ ] **Step 6: Replace the obsolete generated-runtime expectation**

In `comet-scripts.test.ts`, replace `blocks repo source writes when any active change is still in design` with:

- an unselected multi-change ambiguity case; and
- a selected legal build case that permits the same source write.

Run each focused test before regenerating runtime and observe that the old generated runtime fails the new selected-build expectation.

- [ ] **Step 7: Regenerate runtime and run the complete hook suites**

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/classic-current-change.test.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts-hook-guard.test.ts
npx vitest run test/domains/comet-classic/comet-scripts.test.ts -t "hook-guard"
```

Expected: all focused suites PASS.

- [ ] **Step 8: Commit selection-aware guard behavior**

```bash
git add domains/comet-classic/classic-hook-guard.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts assets/skills/comet/scripts/comet-runtime.mjs
git commit -m "fix(classic): scope source guard to current change"
```

---

### Task 4: Wire Selection into Chinese and English Skills

**Files:**

- Modify: `assets/skills-zh/comet/SKILL.md`
- Modify: `assets/skills-zh/comet-open/SKILL.md`
- Modify: `assets/skills-zh/comet-design/SKILL.md`
- Modify: `assets/skills-zh/comet-build/SKILL.md`
- Modify: `assets/skills-zh/comet-verify/SKILL.md`
- Modify: `assets/skills-zh/comet-archive/SKILL.md`
- Modify: `assets/skills-zh/comet-hotfix/SKILL.md`
- Modify: `assets/skills-zh/comet-tweak/SKILL.md`
- Modify: matching English files under `assets/skills/`
- Modify: `assets/skills-zh/comet/reference/scripts.md`
- Modify: `assets/skills/comet/reference/scripts.md`
- Modify: `assets/skills/comet/rules/comet-phase-guard.md`
- Modify: `assets/skills/comet/rules/comet-phase-guard.en.md`
- Test: `test/domains/skill/internal-skills.test.ts`
- Test: `test/domains/comet-classic/comet-classic-package.test.ts`

**Interfaces:**

- Consumes: `comet state select <change-name>` from Task 2.
- Produces: a documented invariant that every resolved or directly invoked Classic phase selects its change before phase work begins.

- [ ] **Step 1: Add failing Skill contract assertions**

Add targeted assertions that the Chinese and English router and phase Skills contain the same selection command and that the phase rule documents ambiguity behavior. Assert semantic phrases rather than whole-file snapshots:

```ts
expect(zhSkill).toContain('comet state select <change-name>');
expect(enSkill).toContain('comet state select <change-name>');
expect(zhRule).toContain('多个 active change');
expect(enRule).toContain('multiple active changes');
```

- [ ] **Step 2: Run contract tests and verify RED**

```bash
npx vitest run test/domains/skill/internal-skills.test.ts test/domains/comet-classic/comet-classic-package.test.ts
```

Expected: FAIL because the selection protocol is not yet documented.

- [ ] **Step 3: Update Chinese Skill surfaces first**

Add these normative rules in natural Chinese:

- `/comet` runs `comet state select <name>` only after a change is resolved.
- Multiple active changes without an explicit name remain a user decision point.
- Each directly invoked phase Skill selects its provided/resolved change before the first phase state check.
- Archive clears selection after successful archive.
- The hard hook rejects ordinary source writes when multiple active changes have no valid selection.

Do not translate English “gate” as “门”; use “守卫”“检查” or “阻塞点” according to context.

- [ ] **Step 4: Synchronize the English Skill surfaces**

Mirror the Chinese semantics and command order exactly, retaining English terms such as Phase Guard where already established.

- [ ] **Step 5: Run contract tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit bilingual workflow integration**

```bash
git add assets/skills-zh assets/skills test/domains/skill/internal-skills.test.ts test/domains/comet-classic/comet-classic-package.test.ts
git commit -m "docs(classic): bind phase skills to current change"
```

---

### Task 5: Release Note and Complete Verification

**Files:**

- Modify: `CHANGELOG.md`
- Verify: all files changed since `ad404c9c`

**Interfaces:**

- Produces: the user-facing release description and final evidence that source, generated assets, tests, and docs agree.

- [ ] **Step 1: Reconfirm the release baseline before editing Changelog**

```bash
node -p "require('./package.json').version"
git show origin/master:package.json
git log 0.4.0-beta.3..HEAD --oneline
```

Expected: current package and `origin/master` both report `0.4.0-beta.4`; keep that version unchanged per the explicit release-line decision.

- [ ] **Step 2: Add one user-visible English Fixed entry**

Under the existing `0.4.0-beta.4` → `### Fixed`, add:

```markdown
- **Parallel active change guards**: Classic source-write hooks now bind branch and worktree execution to the explicitly selected change, allow legal build work despite unrelated open/design/archive changes, and fail with an actionable selection prompt when multiple active changes are ambiguous ([#196](https://github.com/rpamis/comet/issues/196)).
```

Do not list design iterations, test refactors, generated runtime details, or internal selection-file mechanics in Changelog.

- [ ] **Step 3: Run focused Classic verification**

```bash
npx vitest run test/domains/comet-classic/classic-current-change.test.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts-hook-guard.test.ts
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Verify generated runtime is current**

```bash
pnpm build:classic-runtime
git diff --exit-code -- assets/skills/comet/scripts/comet-runtime.mjs
```

Expected: the build succeeds and the second command reports no post-build drift.

- [ ] **Step 5: Run repository quality gates**

```bash
npx prettier --check app/ domains/ platform/
npx eslint app/ domains/ platform/
node scripts/lint/architecture.mjs
node build.js
npx vitest run
git diff --check
```

Expected: every command exits 0. If a command fails, use systematic debugging and distinguish changed-file regressions from unrelated pre-existing failures before continuing.

- [ ] **Step 6: Review the final release diff**

```bash
git status --short
git diff ad404c9c..HEAD --stat
git diff ad404c9c..HEAD -- CHANGELOG.md domains/comet-classic assets/skills-zh/comet assets/skills/comet test/domains/comet-classic
```

Expected: only the approved current-change binding implementation, generated assets, tests, bilingual workflow docs, and the single Changelog bullet are present.

- [ ] **Step 7: Commit release metadata**

```bash
git add CHANGELOG.md
git commit -m "docs: note current change guard fix"
```

- [ ] **Step 8: Run post-commit smoke evidence**

```bash
npx vitest run test/domains/comet-classic/classic-current-change.test.ts test/domains/comet-classic/classic-hook-guard.test.ts
git status --short
```

Expected: focused tests PASS and the working tree is clean.
