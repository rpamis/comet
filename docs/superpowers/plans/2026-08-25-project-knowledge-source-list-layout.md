# Project Knowledge Source List Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Project Knowledge source table columns and let users browse every indexed source through an internal scroll area.

**Architecture:** Keep `sourceEntries` as the complete source collection and change only the Dashboard source-list presentation. A shared CSS custom property will define the columns for both header and rows; the row container will own vertical scrolling while the source header remains outside it.

**Tech Stack:** React, existing Dashboard CSS, Playwright browser tests, Prettier, Vite Dashboard build.

## Global Constraints

- Do not add pagination or slice the source collection; every source in `sourceEntries` must render.
- Header and rows must consume the same `--knowledge-source-columns` definition.
- Keep the existing Project Knowledge visual language and responsive breakpoints.
- Preserve all unrelated dirty Skill, Runtime, memory, and previous Project Knowledge changes.
- Follow TDD: add a failing browser regression before changing source-list production code.

---

### Task 1: Add the failing source-list regression

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts` in the Project Knowledge source scenario

**Interfaces:**

- Consumes: the existing Project Knowledge fixture and source list accessibility label.
- Produces: assertions for full source rendering, scrollability, last-row access, and header/row column alignment.

- [ ] **Step 1: Expand the fixture to 124 sources**

Generate additional deterministic local source entries in the existing source fixture so the `sourceCount` and rendered source buttons represent 124 unique paths. Keep `docs/rule.md` as the first source used by the existing search and Drawer assertions.

- [ ] **Step 2: Write assertions that expose the current layout bug**

After opening the Data Sources tab, assert `共 124 个来源`, assert the source-list container has 124 buttons, measure the first header cell and first row cell with `boundingBox()` and require their `x` positions to match, then scroll the source-list container to its end and require `docs/generated/source-124.md` to be visible.

- [ ] **Step 3: Run the focused test to verify it fails**

Run:

```bash
pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts test/domains/dashboard/dashboard-browser.spec.ts -g "shows Project Knowledge status and project pause transitions"
```

Expected: FAIL because the current row button shrinks to content width and the source list is clipped without its own scroll container.

### Task 2: Implement aligned full-list scrolling

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx` in `ProjectKnowledgeSources`
- Modify: `domains/dashboard/web/src/styles.css` in the source list and responsive rules

**Interfaces:**

- Consumes: complete `sourceEntries` and the existing `visibleSourceEntries` search projection.
- Produces: a source header plus `.dashboard-knowledge-source-rows` scroll region whose row buttons use the same grid columns and occupy full width.

- [ ] **Step 1: Keep the full source projection intact**

Do not introduce `slice`, pagination state, or a display limit. Continue passing `visibleSourceEntries` to the source component and `sourceEntries.length` to the total counter.

- [ ] **Step 2: Give header and rows one shared column contract**

Set `--knowledge-source-columns` once on the source section and use `grid-template-columns: var(--knowledge-source-columns)` for both `.dashboard-knowledge-source-head` and `.dashboard-knowledge-source-row`. Set `width: 100%` on source row buttons so their grid track spans the full content area.

- [ ] **Step 3: Add the independent scroll body**

Make `.dashboard-knowledge-source-rows` a vertical scroll container with a height based on the available Dashboard workspace and a minimum usable height. Keep the header outside the scroll body; preserve the existing mobile column hiding rules and apply the same custom property at each responsive breakpoint.

- [ ] **Step 4: Run the focused browser regression**

Rebuild the Dashboard asset and run the Task 1 command. Expect all source count, alignment, scroll, and existing source search/Drawer assertions to pass.

### Task 3: Validate Dashboard scope

**Files:**

- Check: `domains/dashboard/web/src/main.jsx`
- Check: `domains/dashboard/web/src/styles.css`
- Check: `test/domains/dashboard/dashboard-browser.spec.ts`

**Interfaces:**

- Consumes: the aligned, scrollable source list.
- Produces: passing Dashboard source contracts, build output, formatting, and diff-safety evidence.

- [ ] **Step 1: Run focused Project Knowledge browser coverage**

```bash
pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts test/domains/dashboard/dashboard-browser.spec.ts -g "Project Knowledge|source"
```

- [ ] **Step 2: Run the Dashboard source contract tests**

```bash
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
```

- [ ] **Step 3: Build and check formatting**

```bash
pnpm build:dashboard
pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts
git diff --check
```
