# Dashboard Header Search Centering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the Dashboard header search input within the main workspace to the right of the sidebar while preserving the existing left project selector, right actions, and mobile layout.

**Architecture:** Keep the existing Header markup and move the desktop layout responsibility into CSS. At desktop widths, the Header will use three symmetric grid tracks: flexible project context, bounded centered search, and flexible right actions. The search input will remain in normal grid flow, so it will no longer depend on `--rail-w` or a sidebar-collapsed special case.

**Tech Stack:** React JSX markup already in place, CSS media queries, Vitest source-contract tests, Prettier.

## Global Constraints

- The search input is centered relative to the main workspace to the right of the sidebar, not relative to the full application frame.
- Sidebar expand/collapse changes only the available main-workspace width; no search-position compensation based on `--rail-w` is allowed.
- Project selection remains on the left, refresh/theme actions remain right-aligned, and the mobile stacked Header layout remains unchanged.
- Do not modify Dashboard page data, sidebar behavior, modal behavior, or other center-page content.

---

### Task 1: Add the failing header-centering source contract

**Files:**
- Modify: `test/domains/dashboard/web-source.test.ts` after the existing responsive workspace contract.

**Interfaces:**
- Consumes: `readDashboardStyles()` from the existing test helper.
- Produces: A regression test that fails against the current `--rail-w` absolute-positioned desktop search rule.

- [ ] **Step 1: Write the failing test**

Add this test to `describe('dashboard web source contracts', ...)`:

```ts
  it('centers the header search within the main workspace without rail compensation', async () => {
    const styles = await readDashboardStyles();

    expect(styles).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(260px, 420px) minmax(0, 1fr);',
    );
    expect(styles).toContain('.comet-header-search {\n    grid-column: 2;');
    expect(styles).toContain('.comet-header-actions {\n    grid-column: 3;');
    expect(styles).not.toContain('left: calc(50% - (var(--rail-w) / 2));');
    expect(styles).not.toContain(
      '.dashboard-workbench.is-sidebar-collapsed .comet-header-search',
    );
  });
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
pnpm exec vitest run test/domains/dashboard/web-source.test.ts --reporter=dot
```

Expected: the new test fails because the current stylesheet still contains the `--rail-w` search offset and the collapsed-sidebar search override. Existing dashboard source-contract tests should continue to pass.

### Task 2: Replace the desktop offset with a symmetric main-workspace grid

**Files:**
- Modify: `domains/dashboard/web/src/styles.css` in the later desktop Header override around the current `@media (min-width: 1200px)` block.

**Interfaces:**
- Consumes: Existing Header DOM order: hidden desktop menu button, project context, search input, and right actions.
- Produces: A desktop Header whose search is the center grid track of the main workspace.

- [ ] **Step 1: Write the minimal CSS implementation**

Replace the current desktop search-position override with:

```css
@media (min-width: 1024px) {
  .comet-workbench-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 420px) minmax(0, 1fr);
  }

  .comet-header-context {
    grid-column: 1;
    width: min(292px, 100%);
    flex: 0 1 auto;
  }

  .comet-header-search {
    position: static;
    grid-column: 2;
    grid-row: 1;
    width: 100%;
    max-width: 420px;
    justify-self: center;
    transform: none;
  }

  .comet-header-actions {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
    margin-left: 0;
  }
}
```

Remove the old `left: calc(50% - (var(--rail-w) / 2))` declaration and the `.dashboard-workbench.is-sidebar-collapsed .comet-header-search` rule. Keep the existing `@media (max-width: 640px)` rules untouched so mobile search remains full-width on its own row.

- [ ] **Step 2: Run the focused source-contract test and verify it passes**

Run:

```bash
pnpm exec vitest run test/domains/dashboard/web-source.test.ts --reporter=dot
```

Expected: all tests in the file pass, including the new main-workspace-centering contract.

### Task 3: Run proportionate Dashboard verification

**Files:**
- No additional files.

**Interfaces:**
- Consumes: The passing source contract and the updated stylesheet.
- Produces: Verified Dashboard build and formatting results.

- [ ] **Step 1: Run the Dashboard domain tests**

Run:

```bash
pnpm exec vitest run test/domains/dashboard --reporter=dot
```

Expected: all Dashboard tests pass.

- [ ] **Step 2: Build the Dashboard bundle**

Run:

```bash
pnpm run build:dashboard
```

Expected: Vite completes successfully without changing runtime assets.

- [ ] **Step 3: Check formatting and the diff**

Run:

```bash
pnpm exec prettier --check domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
git diff --check
git status --short
```

Expected: formatting and whitespace checks pass, and only the two implementation files are modified in addition to the already committed design and plan documents.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
git commit -m "fix(dashboard): center header search in main workspace"
```

Expected: a focused implementation commit containing only the CSS layout change and its source-contract test.
