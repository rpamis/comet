# Native and Both CodeGraph Init Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interactive `comet init` offer CodeGraph for Native and Both selections while preserving Classic dependency selection and existing CodeGraph flags.

**Architecture:** Keep one dependency-selection function in `app/commands/init.ts`, but pass the complete `InitWorkflowSelection` so the function can include Classic dependencies only when Classic is selected and always include CodeGraph. Exercise the real Inquirer prompt configuration through the existing init E2E test harness rather than duplicating the dependency-selection logic in tests.

**Tech Stack:** TypeScript, Vitest, `@inquirer/prompts`, existing `initCommand` E2E mocks, Prettier, Git.

## Global Constraints

- Native shows only CodeGraph in the npm dependency selector.
- Classic keeps OpenSpec, Superpowers, and CodeGraph.
- Both shows OpenSpec, Superpowers, and CodeGraph.
- Preserve existing installed-state defaults, `--yes` behavior, and `--codegraph init|skip` handling.
- Do not change CodeGraph installation, indexing, diagnostics, workflow names, project configuration, or CLI flags.
- Keep the existing unrelated untracked `.tmp-supervisor-delivery-lE3btD/` directory out of every commit.

---

### Task 1: Add a failing interactive-choice regression test

**Files:**
- Modify: `test/app/init-e2e.test.ts` near the existing interactive global initialization tests

**Interfaces:**
- Consumes: the existing `initCommand`, mocked `select`, mocked `checkbox`, mocked `platformSelectPrompt`, `captureTextOutput`, and `mockExternalSuccess` helpers.
- Produces: a regression test that reads the actual dependency checkbox choices for Native and Both.

- [ ] **Step 1: Write the failing test**

Add this parameterized test after the existing `offers Native, Classic, and Both during interactive global initialization` test:

```ts
  it.each([
    { workflow: 'native' as const, expected: ['codegraph'] },
    { workflow: 'both' as const, expected: ['openspec', 'superpowers', 'codegraph'] },
  ])(
    'offers the CodeGraph dependency for $workflow initialization',
    async ({ workflow, expected }) => {
      mockExternalSuccess();
      await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
      const fakeHome = path.join(tmpDir, 'fake-home');
      await fs.mkdir(fakeHome, { recursive: true });

      const { checkbox, select } = await import('@inquirer/prompts');
      const { platformSelectPrompt } =
        await import('../../app/commands/platform-select-prompt.js');
      vi.mocked(select).mockResolvedValueOnce(workflow);
      if (workflow === 'both') vi.mocked(select).mockResolvedValueOnce('copy');
      vi.mocked(platformSelectPrompt).mockResolvedValue(['codex']);
      vi.mocked(checkbox).mockResolvedValue([]);

      const { initCommand } = await import('../../app/commands/init.js');
      await captureTextOutput(() =>
        initCommand(tmpDir, {
          scope: 'global',
          language: 'en',
        }),
      );

      const prompt = vi.mocked(checkbox).mock.calls[0]?.[0] as {
        choices: Array<{ value: string }>;
      };
      expect(prompt.choices.map((choice) => choice.value)).toEqual(expected);
    },
    INIT_E2E_TIMEOUT_MS,
  );
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing Native choice**

Run:

```bash
pnpm exec vitest run test/app/init-e2e.test.ts -t "offers the CodeGraph dependency"
```

Expected result before the production change: the Native case fails because `selectNpmDeps` returns before calling the npm dependency checkbox, so `prompt.choices` cannot contain `codegraph`. The Both case may already pass through the existing Classic path; the failing Native case is the required red signal.

### Task 2: Make dependency selection workflow-aware

**Files:**
- Modify: `app/commands/init.ts:319-384` (`selectNpmDeps`)
- Modify: `app/commands/init.ts:718-724` (the `selectNpmDeps` call)

**Interfaces:**
- Consumes: `InitWorkflowSelection`, `includesWorkflow`, existing dependency detection, and `NpmDepState`.
- Produces: `selectNpmDeps(projectPath, spPlatformIds, options, lang, workflowSelection): Promise<Set<NpmDepId>>`.

- [ ] **Step 1: Replace the reduced workflow parameter with `InitWorkflowSelection`**

Change the function signature and derive the Classic gate:

```ts
async function selectNpmDeps(
  projectPath: string,
  spPlatformIds: string[],
  options: InitOptions,
  lang: string,
  workflowSelection: InitWorkflowSelection,
): Promise<Set<NpmDepId>> {
  const includesClassic = includesWorkflow(workflowSelection, 'classic');
  const openSpecInstalled = includesClassic && isCommandAvailable('openspec');
  const openSpecRequired = includesClassic && !isOpenSpecCliCompatible();
  const codegraphInstalled =
    hasCodegraphProjectIndex(projectPath) || resolveCodegraphCommand() !== null;
  const superpowersInstalled = spPlatformIds.length === 0 ? true : undefined;

  const states: NpmDepState[] = [
    ...(includesClassic
      ? [
          { id: 'openspec' as const, installed: openSpecInstalled, required: openSpecRequired },
          { id: 'superpowers' as const, installed: Boolean(superpowersInstalled) },
        ]
      : []),
    { id: 'codegraph', installed: codegraphInstalled },
  ];
```

Retain the existing labels, non-interactive selection, checkbox validation, and return logic below this state construction. This makes Native show only CodeGraph, Both include all three dependencies, and Classic preserve its current choices.

- [ ] **Step 2: Pass the complete selection at the call site**

Replace the reduced conditional argument:

```ts
  const selectedNpmDeps = await selectNpmDeps(
    projectPath,
    spPlatformIds,
    options,
    lang,
    workflowSelection,
  );
```

- [ ] **Step 3: Run the focused regression test**

Run:

```bash
pnpm exec vitest run test/app/init-e2e.test.ts -t "offers the CodeGraph dependency"
```

Expected result: both cases pass; Native exposes exactly `codegraph`, and Both exposes `openspec`, `superpowers`, and `codegraph`.

### Task 3: Update release wording and verify the complete init surface

**Files:**
- Modify: `CHANGELOG.md` under the existing `0.4.0-rc.1` `### Changed` section
- Verify: `app/commands/init.ts`, `test/app/init-e2e.test.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the behavior delivered by Tasks 1 and 2.
- Produces: user-visible release wording and a clean, pushed `040rc1` commit.

- [ ] **Step 1: Add the user-visible changelog entry**

Add one English entry under the current rc1 `### Changed` heading:

```markdown
- **Native CodeGraph setup**: `comet init` now offers CodeGraph when Native or Both is selected, while keeping OpenSpec and Superpowers limited to Classic-enabled setups.
```

- [ ] **Step 2: Run the focused init suite and formatting checks**

Run:

```bash
pnpm exec vitest run test/app/init-e2e.test.ts
pnpm exec prettier --check app/commands/init.ts test/app/init-e2e.test.ts CHANGELOG.md
git diff --check
```

Expected result: the init E2E file passes, all affected files pass Prettier, and `git diff --check` produces no output.

- [ ] **Step 3: Commit only the feature files**

Run:

```bash
git add -- app/commands/init.ts test/app/init-e2e.test.ts CHANGELOG.md
git diff --cached --stat
git commit -m "feat(init): offer CodeGraph for Native workflow"
```

Do not stage `.tmp-supervisor-delivery-lE3btD/` or the already committed spec/plan files.

- [ ] **Step 4: Push and verify the remote branch**

Run:

```bash
git push origin 040rc1
git status --short --branch
git log -2 --oneline --decorate
```

Expected result: push succeeds, the branch is synchronized with `origin/040rc1`, and the only remaining untracked path is the pre-existing `.tmp-supervisor-delivery-lE3btD/` directory.
