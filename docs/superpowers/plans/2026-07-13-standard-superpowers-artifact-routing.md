# Standard Superpowers Artifact Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Comet Classic hooks to accept the first write of standard Superpowers artifacts without private filename suffixes while preserving strict multi-change routing.

**Architecture:** Model each standard `docs/superpowers/{specs,plans,reports}` directory as a typed artifact slot tied to one `.comet.yaml` field and one workflow phase. Keep recorded-path and explicit change-name matching first; only when those fail, resolve the selected or sole active change and allow the write if the corresponding slot is empty and the phase matches.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Vitest 4, generated Classic `.mjs` runtime, Markdown changelog.

## Global Constraints

- Do not modify any original Superpowers or OpenSpec Skill.
- Preserve the official plan path `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`; do not require a `-plan` suffix.
- The hook must remain read-only with respect to `.comet.yaml`; it may decide but must not reserve or record an artifact path.
- Recorded artifact paths and explicit change-name filename matches keep their current priority over current selection.
- The first-write fallback applies only to direct Markdown children of `specs/`, `plans/`, and `reports/`.
- A valid selection governs unmatched standard artifacts when multiple active changes exist; a stale selection or missing selection with multiple active changes must fail closed.
- A slot is writable only in its matching phase and only while its state field is null.
- Runtime source changes must be synchronized with `pnpm build:classic-runtime`.
- Use TDD: observe each focused regression fail before changing the corresponding production behavior.
- Preserve unrelated working-tree changes; stage only files named by each task.
- `package.json` is already `0.4.0-beta.5` while `origin/master` is `0.4.0-beta.4`; append to the existing beta.5 changelog entry and do not bump the version.

---

### Task 1: Standard Artifact Slot First-Write Routing

**Files:**

- Modify: `test/domains/comet-classic/classic-hook-guard.test.ts`
- Modify: `test/domains/comet-classic/comet-scripts.test.ts`
- Modify: `domains/comet-classic/classic-hook-guard.ts`
- Regenerate: `assets/skills/comet/scripts/comet-runtime.mjs`

**Interfaces:**

- Consumes: `repoSourceGoverningChange(projectRoot, relativePath)` for selection-aware or single-change resolution.
- Produces: `SuperpowersArtifactSlot`, `standardSuperpowersArtifactSlot(relativePath)`, `superpowersArtifactValue(governing, slot)`, and `allowsFirstSuperpowersArtifactWrite(governing, slot)`.
- Preserves: recorded-path matching and `matchesSuperpowersArtifactName()` as higher-priority routes.

- [ ] **Step 1: Extend the focused hook fixture with artifact state fields**

Update `seedChange()` in `test/domains/comet-classic/classic-hook-guard.test.ts` so tests can represent empty and occupied slots exactly:

```ts
async function seedChange(
  dir: string,
  name: string,
  phase: 'open' | 'design' | 'build' | 'verify' | 'archive',
  options: {
    archived?: boolean;
    workflow?: 'full' | 'hotfix';
    designDoc?: string | null;
    plan?: string | null;
    verificationReport?: string | null;
  } = {},
): Promise<string> {
  const changeDir = path.join(dir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  const workflow = options.workflow ?? 'full';
  const designDoc =
    options.designDoc === undefined
      ? phase === 'build' || phase === 'verify' || phase === 'archive'
        ? `docs/superpowers/specs/${name}-design.md`
        : null
      : options.designDoc;
  await fs.writeFile(
    path.join(changeDir, '.comet.yaml'),
    [
      `workflow: ${workflow}`,
      `phase: ${phase}`,
      `design_doc: ${designDoc ?? 'null'}`,
      `plan: ${options.plan ?? 'null'}`,
      `verification_report: ${options.verificationReport ?? 'null'}`,
      `build_mode: ${phase === 'open' || phase === 'design' ? 'null' : 'executing-plans'}`,
      `isolation: ${phase === 'open' || phase === 'design' ? 'null' : 'branch'}`,
      `verify_mode: ${phase === 'verify' || phase === 'archive' ? 'light' : 'null'}`,
      `verify_result: ${phase === 'archive' ? 'pass' : 'pending'}`,
      `verified_at: ${phase === 'archive' ? '2026-07-12' : 'null'}`,
      `archived: ${options.archived ?? false}`,
      '',
    ].join('\n'),
  );
  return changeDir;
}
```

- [ ] **Step 2: Add focused failing standard-artifact tests**

Add a `describe('standard Superpowers artifact first writes', ...)` block to `classic-hook-guard.test.ts`. Use filenames that do not contain the active change name, so the existing name heuristic cannot make the tests pass accidentally:

```ts
it.each([
  {
    label: 'design document',
    changeName: 'design-change',
    phase: 'design' as const,
    target: ['specs', '2026-07-13-durable-retries-design.md'],
  },
  {
    label: 'implementation plan',
    changeName: 'build-change',
    phase: 'build' as const,
    target: ['plans', '2026-07-13-durable-retries.md'],
  },
  {
    label: 'verification report',
    changeName: 'verify-change',
    phase: 'verify' as const,
    target: ['reports', '2026-07-13-durable-retries-verify.md'],
  },
])('allows a standard first $label write for a single active change', async (example) => {
  const dir = await makeProject();
  await seedChange(dir, example.changeName, example.phase);
  const target = path.join(dir, 'docs', 'superpowers', ...example.target);

  const result = run(dir, 'hook-guard', [], hookInput(target));

  expect(result.status).toBe(0);
  expect(result.stderr).toContain(`phase: ${example.phase}, superpowers`);
});

it('allows the selected build change to create a standard plan with multiple active changes', async () => {
  const dir = await makeProject();
  await seedChange(dir, 'build-change', 'build');
  await seedChange(dir, 'unrelated-design', 'design');
  expect(run(dir, 'state', ['select', 'build-change']).status).toBe(0);
  const target = path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-durable-retries.md');

  const result = run(dir, 'hook-guard', [], hookInput(target));

  expect(result.status).toBe(0);
  expect(result.stderr).toContain('phase: build, superpowers');
});

it('requires selection before a standard plan write with multiple active changes', async () => {
  const dir = await makeProject();
  await seedChange(dir, 'build-change', 'build');
  await seedChange(dir, 'unrelated-design', 'design');
  const target = path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-durable-retries.md');

  const result = run(dir, 'hook-guard', [], hookInput(target));

  expect(result.status).toBe(2);
  expect(result.stderr).toContain('multiple active changes require a current change');
  expect(result.stderr).toContain('comet state select <change-name>');
});
```

Add one equivalent generated-runtime regression to the hook-guard describe block in `comet-scripts.test.ts`:

```ts
it('allows the first standard Superpowers plan write without a private suffix', async () => {
  await createChange(
    tmpDir,
    'standard-plan-write',
    [
      'workflow: full',
      'phase: build',
      'design_doc: docs/superpowers/specs/standard-design.md',
      'plan: null',
      'verification_report: null',
      'archived: false',
      '',
    ].join('\n'),
  );
  const target = path.join(tmpDir, 'docs', 'superpowers', 'plans', '2026-07-13-durable-retries.md');

  const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

  expect(result.status).toBe(0);
  expect(result.stderr).toContain('phase: build, superpowers');
}, 20_000);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "standard Superpowers artifact first writes"
npx vitest run test/domains/comet-classic/comet-scripts.test.ts -t "first standard Superpowers plan write"
```

Expected: the standard single-change and selected plan writes fail with `unmatched Superpowers artifact`; the multi-change test does not yet report the selection-specific diagnostic.

- [ ] **Step 4: Add the artifact slot model**

In `domains/comet-classic/classic-hook-guard.ts`, add the slot types and helpers near the existing Superpowers artifact helpers:

```ts
type SuperpowersArtifactField = 'designDoc' | 'plan' | 'verificationReport';

interface SuperpowersArtifactSlot {
  prefix: string;
  field: SuperpowersArtifactField;
  wireField: 'design_doc' | 'plan' | 'verification_report';
  phase: 'design' | 'build' | 'verify';
}

const SUPERPOWERS_ARTIFACT_SLOTS: readonly SuperpowersArtifactSlot[] = [
  {
    prefix: 'docs/superpowers/specs/',
    field: 'designDoc',
    wireField: 'design_doc',
    phase: 'design',
  },
  {
    prefix: 'docs/superpowers/plans/',
    field: 'plan',
    wireField: 'plan',
    phase: 'build',
  },
  {
    prefix: 'docs/superpowers/reports/',
    field: 'verificationReport',
    wireField: 'verification_report',
    phase: 'verify',
  },
];

function standardSuperpowersArtifactSlot(relativePath: string): SuperpowersArtifactSlot | null {
  const slot = SUPERPOWERS_ARTIFACT_SLOTS.find((candidate) =>
    relativePath.startsWith(candidate.prefix),
  );
  if (!slot) return null;
  const fileName = relativePath.slice(slot.prefix.length);
  if (!fileName || fileName.includes('/') || !fileName.endsWith('.md')) return null;
  return slot;
}

function superpowersArtifactValue(
  governing: GoverningChange,
  slot: SuperpowersArtifactSlot,
): string | null {
  return governing.classic?.[slot.field] ?? null;
}

function allowsFirstSuperpowersArtifactWrite(
  governing: GoverningChange,
  slot: SuperpowersArtifactSlot,
): boolean {
  return (
    governing.classic !== null &&
    governing.phase === slot.phase &&
    !superpowersArtifactValue(governing, slot)
  );
}
```

Extend `GoverningChange` so unmatched diagnostics retain the classified slot:

```ts
interface GoverningChange {
  changeDir: string | null;
  phase: ClassicPhase;
  classic: ClassicState | null;
  archived: boolean;
  superpowersArtifact?: 'matched' | 'unmatched';
  superpowersSlot?: SuperpowersArtifactSlot;
}
```

- [ ] **Step 5: Resolve standard first writes through current selection**

Replace the `docs/superpowers/` branch in `governingChange()` with this exact order:

```ts
if (isSuperpowersArtifactPath(relativePath)) {
  const superpowers = await superpowersArtifactGoverningChange(relativePath, projectRoot);
  if (superpowers) return { ...superpowers, superpowersArtifact: 'matched' };

  const slot = standardSuperpowersArtifactSlot(relativePath);
  if (slot) {
    const candidate = await repoSourceGoverningChange(projectRoot, relativePath);
    if (!candidate || 'blockedResult' in candidate) return candidate;
    return {
      ...candidate,
      superpowersArtifact: allowsFirstSuperpowersArtifactWrite(candidate, slot)
        ? 'matched'
        : 'unmatched',
      superpowersSlot: slot,
    };
  }

  const fallback = (await activeChanges(projectRoot))[0] ?? null;
  return fallback ? { ...fallback, superpowersArtifact: 'unmatched' } : null;
}
```

Do not change `matchesRecordedSuperpowersArtifact()` or `matchesSuperpowersArtifactName()`; both must remain ahead of slot fallback.

- [ ] **Step 6: Regenerate the Classic runtime and verify GREEN**

Run:

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "standard Superpowers artifact first writes"
npx vitest run test/domains/comet-classic/comet-scripts.test.ts -t "first standard Superpowers plan write"
```

Expected: all new tests pass; generated `assets/skills/comet/scripts/comet-runtime.mjs` contains the slot table and selection-aware first-write branch.

- [ ] **Step 7: Commit the routing behavior**

```bash
git add domains/comet-classic/classic-hook-guard.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts assets/skills/comet/scripts/comet-runtime.mjs
git commit -m "fix(classic): allow standard Superpowers artifact writes"
```

---

### Task 2: Slot Safety and Actionable Diagnostics

**Files:**

- Modify: `test/domains/comet-classic/classic-hook-guard.test.ts`
- Modify: `test/domains/comet-classic/comet-scripts.test.ts`
- Modify: `domains/comet-classic/classic-hook-guard.ts`
- Regenerate: `assets/skills/comet/scripts/comet-runtime.mjs`

**Interfaces:**

- Consumes: `SuperpowersArtifactSlot`, `superpowersArtifactValue()`, and `GoverningChange.superpowersSlot` from Task 1.
- Produces: phase-mismatch and occupied-slot diagnostics that never recommend private filename suffixes.

- [ ] **Step 1: Add failing safety and recovery tests**

Add these focused cases to `classic-hook-guard.test.ts`:

```ts
it.each(['open', 'design', 'verify', 'archive'] as const)(
  'blocks a standard plan first write during %s',
  async (phase) => {
    const dir = await makeProject();
    await seedChange(dir, 'wrong-phase', phase);
    const target = path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-durable-retries.md');

    const result = run(dir, 'hook-guard', [], hookInput(target));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Expected phase: build');
    expect(result.stderr).not.toContain('include the change name');
  },
);

it('allows the recorded plan and blocks a second unrecorded plan', async () => {
  const dir = await makeProject();
  const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
  await seedChange(dir, 'occupied-plan', 'build', { plan: recorded });

  const recordedResult = run(
    dir,
    'hook-guard',
    [],
    hookInput(path.join(dir, ...recorded.split('/'))),
  );
  const secondResult = run(
    dir,
    'hook-guard',
    [],
    hookInput(path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-second-feature.md')),
  );

  expect(recordedResult.status).toBe(0);
  expect(secondResult.status).toBe(2);
  expect(secondResult.stderr).toContain('plan is already recorded');
  expect(secondResult.stderr).toContain(recorded);
});

it('fails closed for a stale selection before a standard plan first write', async () => {
  const dir = await makeProject();
  await initializeGitProject(dir);
  await seedChange(dir, 'build-change', 'build');
  await seedChange(dir, 'other-build', 'build');
  expect(run(dir, 'state', ['select', 'build-change']).status).toBe(0);
  git(dir, ['switch', '-c', 'other']);
  const target = path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-durable-retries.md');

  const result = run(dir, 'hook-guard', [], hookInput(target));

  expect(result.status).toBe(2);
  expect(result.stderr).toContain('current change selection is stale or invalid');
});

it.each([
  path.join('docs', 'superpowers', 'notes', '2026-07-13-note.md'),
  path.join('docs', 'superpowers', 'plans', 'nested', '2026-07-13-plan.md'),
  path.join('docs', 'superpowers', 'plans', '2026-07-13-plan.txt'),
])('keeps non-standard Superpowers paths blocked: %s', async (target) => {
  const dir = await makeProject();
  await seedChange(dir, 'build-change', 'build');

  const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, target)));

  expect(result.status).toBe(2);
  expect(result.stderr).toContain('unmatched Superpowers artifact');
});
```

Add this generated-runtime occupied-slot assertion in `comet-scripts.test.ts` so the distributed message and status are covered:

```ts
it('blocks a second write after the standard Superpowers plan slot is occupied', async () => {
  const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
  await createChange(
    tmpDir,
    'occupied-standard-plan',
    [
      'workflow: full',
      'phase: build',
      'design_doc: docs/superpowers/specs/occupied-standard-plan-design.md',
      `plan: ${recorded}`,
      'verification_report: null',
      'archived: false',
      '',
    ].join('\n'),
  );
  const target = path.join(tmpDir, 'docs', 'superpowers', 'plans', '2026-07-13-second-feature.md');

  const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

  expect(result.status).toBe(2);
  expect(result.stderr).toContain('plan is already recorded');
  expect(result.stderr).toContain(recorded);
}, 20_000);
```

- [ ] **Step 2: Run the new cases and verify RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts -t "standard plan|recorded plan|stale selection|non-standard Superpowers"
npx vitest run test/domains/comet-classic/comet-scripts.test.ts -t "occupied standard Superpowers plan slot"
```

Expected: status-based safety remains closed, but phase and occupied-slot message assertions fail because the current diagnostic is generic and still recommends filename matching.

- [ ] **Step 3: Make unmatched artifact diagnostics slot-aware**

Change `blockedUnmatchedSuperpowersArtifact()` to accept the full governing change and emit specific details:

```ts
function blockedUnmatchedSuperpowersArtifact(
  relativePath: string,
  governing: GoverningChange,
): ClassicCommandResult {
  const slot = governing.superpowersSlot;
  const recorded = slot ? superpowersArtifactValue(governing, slot) : null;
  const details = slo
    ? governing.phase !== slot.phase
      ? [
          `  BLOCKED: ${slot.wireField} cannot be first-written in phase ${governing.phase}`,
          `  Expected phase: ${slot.phase}`,
          '  NEXT: resume the matching Comet phase or use an already recorded artifact path',
        ]
      : recorded
        ? [
            `  BLOCKED: ${slot.wireField} is already recorded for this change`,
            `  Recorded path: ${recorded}`,
            '  NEXT: write the recorded artifact or explicitly correct the state path',
          ]
        : [
            '  BLOCKED: standard Superpowers artifact state is incomplete',
            '  NEXT: validate the active change state, then retry the matching phase',
          ]
    : [
        '  BLOCKED: unmatched Superpowers artifact',
        '  This docs/superpowers/ path does not match any active change artifact',
        '  NEXT: use a recorded artifact path or a standard phase artifact directory',
      ];

  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      `  Current phase: ${governing.phase}`,
      `  Target file: ${relativePath}`,
      '',
      ...details,
      '',
    ].join('\n'),
  );
}
```

Update the caller:

```ts
if (governing.superpowersArtifact === 'unmatched') {
  return blockedUnmatchedSuperpowersArtifact(relativePath, governing);
}
```

Use message capitalization consistently with the tests; if Prettier reformats the nested conditional, keep the behavior and exact strings unchanged.

- [ ] **Step 4: Regenerate runtime and verify the safety matrix**

Run:

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts
npx vitest run test/domains/comet-classic/comet-scripts.test.ts -t "Superpowers|hook-guard"
```

Expected: all focused hook tests pass, the old recorded/name-matched cases stay green, and no user-facing diagnostic recommends adding a private suffix.

- [ ] **Step 5: Commit safety and diagnostics**

```bash
git add domains/comet-classic/classic-hook-guard.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts assets/skills/comet/scripts/comet-runtime.mjs
git commit -m "fix(classic): harden Superpowers artifact slot routing"
```

---

### Task 3: Release Note and Repository Verification

**Files:**

- Modify: `CHANGELOG.md`
- Verify: `package.json`
- Verify: all files changed by Tasks 1-2

**Interfaces:**

- Consumes: completed runtime behavior and passing focused regressions.
- Produces: one user-visible beta.5 `Fixed` entry and repository-level verification evidence.

- [ ] **Step 1: Confirm the release baseline before editing the changelog**

Run:

```bash
node -p "require('./package.json').version"
git show origin/master:package.json | rg '"version"'
git describe --tags --abbrev=0
git log "$(git describe --tags --abbrev=0)..HEAD" --oneline
```

Expected: current version `0.4.0-beta.5`, `origin/master` version `0.4.0-beta.4`, and an existing beta.5 changelog section. Do not create beta.6.

- [ ] **Step 2: Add the user-visible fix to the existing beta.5 entry**

Under `## What's Changed [0.4.0-beta.5] - 2026-07-13` → `### Fixed`, append exactly one final-state bullet:

```markdown
- **Standard Superpowers artifacts**: Classic write hooks now accept first-time design, plan, and verification artifacts in their standard workflow directories without requiring Comet-specific filename suffixes, while selected-change, phase, and occupied-slot checks still prevent ambiguous or duplicate writes.
```

Do not add a `Tests` section and do not describe intermediate branch failures or implementation details.

- [ ] **Step 3: Run formatting and focused Classic verification**

Run:

```bash
pnpm exec prettier --check domains/comet-classic/classic-hook-guard.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts CHANGELOG.md
npx vitest run test/domains/comet-classic/classic-hook-guard.test.ts
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
```

Expected: Prettier reports all four files formatted; both test files pass with no skipped new regression.

- [ ] **Step 4: Run repository-required checks**

Run:

```bash
pnpm format:check
pnpm lin
pnpm build
pnpm tes
```

Expected: all commands exit 0. If `format:check` reports untouched CRLF legacy files, confirm none are part of this change and report the environment-specific exception instead of rewriting unrelated files.

- [ ] **Step 5: Verify generated runtime and change scope**

Run:

```bash
git diff --check
git diff --name-status origin/master...HEAD
git status --shor
rg -n "SUPERPOWERS_ARTIFACT_SLOTS|standardSuperpowersArtifactSlot" assets/skills/comet/scripts/comet-runtime.mjs
```

Expected: no whitespace errors; runtime contains the generated slot logic; unrelated pre-existing worktree changes remain unstaged and unmodified.

- [ ] **Step 6: Commit the release note**

```bash
git add CHANGELOG.md
git commit -m "docs: document standard Superpowers artifact routing"
```

- [ ] **Step 7: Final implementation review checkpoint**

Review the final diff against `docs/superpowers/specs/2026-07-13-standard-superpowers-artifact-routing-design.md` and confirm:

```tex
[ ] Standard Superpowers filenames work without -plan.
[ ] Recorded paths and explicit filename matches remain higher priority.
[ ] Multi-change selection, stale selection, wrong phase, and occupied slots fail closed.
[ ] Hook does not mutate .comet.yaml.
[ ] Generated runtime matches TypeScript source.
[ ] Changelog describes only the released user-visible behavior.
```
