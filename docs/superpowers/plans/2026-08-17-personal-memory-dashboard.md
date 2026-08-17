# Personal Memory Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the personal memory Dashboard page so the memory list is the primary task surface and settings are compact, while preserving all existing capabilities and the current Dashboard visual language.

**Architecture:** Keep the existing `PersonalMemoryCenter` data contract and `onInvoke` capability calls. Restructure only the JSX into a compact status strip, a primary memory list, and a secondary settings panel; add page-scoped CSS for layout and rows, reusing existing Dashboard CSS variables and Ant Design components.

**Tech Stack:** React JSX, Ant Design 6, Tailwind utility classes already used by the Dashboard, page-scoped CSS in `styles.css`, Vitest tests, Vite production build.

## Global Constraints

- Do not change Plugin Runtime, memory service, data schema, or capability names.
- Do not add a UI dependency or redesign Dashboard global navigation.
- Preserve light/dark theme support through existing CSS variables.
- Keep the responsive breakpoint at 760px for the page-specific two-column layout.
- Changelog is English and uses the existing beta20 entry; do not bump the version.

---

### Task 1: Add a testable page-shape contract

**Files:**
- Modify: `test/domains/dashboard/web-source.test.ts`

**Interfaces:**
- Consumes: `domains/dashboard/web/src/main.jsx` as source text.
- Produces: assertions that prevent the old flat toolbar/card layout from returning and require the new semantic page regions.

- [ ] **Step 1: Write the failing test**

Add a focused test that reads `main.jsx` and asserts the personal memory page contains `dashboard-memory-status`, `dashboard-memory-layout`, `dashboard-memory-list`, and `dashboard-memory-settings`, and no longer contains the old `dashboard-plugin-toolbar` wrapper in `PersonalMemoryCenter`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
```

Expected: the new region assertions fail because the current page still uses `dashboard-plugin-toolbar` and `dashboard-plugin-grid`.

- [ ] **Step 3: Commit the red test**

```powershell
git add test/domains/dashboard/web-source.test.ts
git commit -m "test(dashboard): define personal memory page regions"
```

### Task 2: Restructure the personal memory page

**Files:**
- Modify: `domains/dashboard/web/src/main.jsx:2228-2390`

**Interfaces:**
- Consumes: existing `data.status`, `data.retrieval`, `data.notifications`, `data.projectKey`, and `onInvoke`.
- Produces: the same capability calls with a new visual hierarchy and unchanged record/modal behavior.

- [ ] **Step 1: Replace the flat toolbar with status cells**

Keep the existing state variables and derive `memoryFileCount`, `remoteLabel`, `learningPaused`, and `retrievalPaused`. Render four compact status cells under the section heading; use `Switch` for global learning/retrieval and `Tag`/text for project/file status. Keep the same calls:

```jsx
onInvoke('set-learning', { enabled: !status.learningEnabled });
onInvoke('set-retrieval', { enabled: !status.retrievalEnabled });
```

- [ ] **Step 2: Move memory records into the primary list region**

Render `data.management.records ?? records` in a `dashboard-memory-list` panel. Preserve the empty state and each record's `correct`, `rollback`, and `remove` actions. Use a category tag and a quiet metadata row instead of nested visual cards.

- [ ] **Step 3: Move low-frequency controls into settings**

Render project pause controls, remote input/save, sync, and uninstall under `dashboard-memory-settings`. Preserve the exact existing capability names and the uninstall confirmation text.

- [ ] **Step 4: Run the focused source test**

Run:

```powershell
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the JSX change**

```powershell
git add domains/dashboard/web/src/main.jsx test/domains/dashboard/web-source.test.ts
git commit -m "refactor(dashboard): redesign personal memory workspace"
```

### Task 3: Add page-scoped responsive styling

**Files:**
- Modify: `domains/dashboard/web/src/styles.css` near the existing plugin styles around lines 552-590

**Interfaces:**
- Consumes: the new `dashboard-memory-*` class names from Task 2 and existing theme variables.
- Produces: desktop two-column layout, compact status cells, list rows, settings grouping, and 760px single-column fallback.

- [ ] **Step 1: Add the layout rules**

Add rules for `.dashboard-memory-status`, `.dashboard-memory-status-cell`, `.dashboard-memory-layout`, `.dashboard-memory-list`, `.dashboard-memory-settings`, `.dashboard-memory-record`, and `.dashboard-memory-setting`. Use existing `var(--color-*)`, `var(--shadow-card)`, and border variables only.

- [ ] **Step 2: Add the narrow layout rule**

Inside the existing `@media (max-width: 760px)` block, set `.dashboard-memory-layout` to one column, make status cells wrap, and let record actions use `flex-wrap: wrap` without causing horizontal overflow.

- [ ] **Step 3: Run formatting and build checks**

Run:

```powershell
pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
```

Expected: formatting passes and the focused test passes.

- [ ] **Step 4: Commit the styling change**

```powershell
git add domains/dashboard/web/src/styles.css
git commit -m "style(dashboard): polish personal memory layout"
```

### Task 4: Verify the production Dashboard and release wording

**Files:**
- Modify: `CHANGELOG.md` under `## What's Changed [0.4.0-beta.20] - 2026-08-17`

**Interfaces:**
- Consumes: completed page implementation and existing beta20 release entry.
- Produces: a user-visible changelog line and verified production assets.

- [ ] **Step 1: Add the user-visible changelog entry**

Add one concise `Changed` bullet describing that the personal memory Dashboard now prioritizes readable memory records and keeps controls grouped in a compact settings area.

- [ ] **Step 2: Run the production checks**

Run:

```powershell
pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
pnpm exec vitest run test/domains/dashboard/web-source.test.ts test/domains/dashboard/web-state.test.ts
pnpm build
```

Expected: source tests pass and `Build completed successfully!` is printed.

- [ ] **Step 3: Review the diff and commit**

```powershell
git diff --check
git status --short
git add CHANGELOG.md domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
git commit -m "feat(dashboard): redesign personal memory page"
```

## Self-Review Checklist

- [ ] No data contract or capability name changed.
- [ ] No old flat personal-memory toolbar/grid remains in the page implementation.
- [ ] Light and dark theme values use existing variables.
- [ ] Desktop and 760px narrow layouts are both covered.
- [ ] Tests cover the new page regions and existing Dashboard state behavior.
