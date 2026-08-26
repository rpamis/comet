# Project Knowledge Manifest Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Project Knowledge page's recent-use overview readable, correctly named, and independently expandable in place.

**Architecture:** Keep the existing shared `ContextManifestPreview` component, adding page-specific labels and an internal single-expanded-item state. Project Knowledge will render the existing manifest fields with project-knowledge terminology; Personal Memory will retain its current memory terminology. No backend or manifest schema changes are needed.

**Tech Stack:** React, Ant Design, existing Dashboard CSS, Playwright browser tests, Prettier.

## Global Constraints

- Project Knowledge labels must use “项目知识”, “项目事实”, or “项目规范”; do not call this section “个人记忆”.
- Do not change the `manifestPreview` response contract or mix this work with unrelated dirty Skill/runtime changes.
- Use existing Dashboard visual tokens and Ant Design components; no new dependency.
- Follow TDD: add a failing browser assertion before changing the component.

---

### Task 1: Add the failing Project Knowledge expansion regression

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts` in the Project Knowledge page scenario

**Interfaces:**

- Consumes: the existing Project Knowledge `manifestPreview` fixture and Dashboard route.
- Produces: a regression assertion requiring Project Knowledge-specific labels and inline single-item expansion.

- [ ] **Step 1: Write the failing test**

Extend the Project Knowledge browser scenario to select the Project Knowledge overview, assert `最近一次任务使用的项目知识`, click one overview item, and require an expanded region containing `项目知识内容`, the complete fixture text, and `为什么使用`. Click a second overview item and require the first expanded region to be hidden while the second is visible.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts test/domains/dashboard/dashboard-browser.spec.ts -g "Project Knowledge"
```

Expected: FAIL because the current shared overview is labeled as recent memory and only selects the lower inspector.

### Task 2: Implement page-aware, single-item inline expansion

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx` in `ContextManifestPreview`, `ProjectKnowledgeCenter`, and `PersonalMemoryCenter` call sites
- Modify: `domains/dashboard/web/src/styles.css` in the context manifest styles

**Interfaces:**

- Consumes: `manifestPreview` entries with `memoryType`, `summary`, `whyApplied`, `delivery`, `outcome`, `appliedAt`, and `lastApplication`.
- Produces: `ContextManifestPreview({ items, emptyLabel, onSelectItem, title, description, terminology })` with one expanded item at a time and accessible toggle controls.

- [ ] **Step 1: Add the minimal page-specific labels and expansion state**

Add a `title`, `description`, and terminology/configuration input to the shared component. Keep Personal Memory on “最近一次任务使用的记忆”; pass Project Knowledge labels from `ProjectKnowledgeCenter`. Track `expandedItemId`, toggle it from a real button, and preserve Enter/Space behavior.

- [ ] **Step 2: Render readable expanded content**

Keep the collapsed card compact, but render the full `summary` only inside the expanded panel. Label fields with the selected page vocabulary: `项目知识内容`, `为什么使用`, `提供给 Agent 的内容`, `应用结果`, and `最近应用`. Set `aria-expanded` and a stable accessible name on each toggle.

- [ ] **Step 3: Add the compact expanded-card styles**

Use the current Dashboard tokens. The expanded panel spans the available overview width, wraps long text, preserves line breaks, and remains readable on mobile. Avoid changing the surrounding page layout or introducing a new card visual language.

- [ ] **Step 4: Run the focused browser regression**

Run the command from Task 1 and expect the Project Knowledge expansion assertions to pass.

### Task 3: Validate unaffected memory semantics and formatting

**Files:**

- Test: `test/domains/dashboard/dashboard-browser.spec.ts`
- Test: `test/domains/dashboard/web-source.test.ts`
- Check: `domains/dashboard/web/src/main.jsx`, `domains/dashboard/web/src/styles.css`, `test/domains/dashboard/dashboard-browser.spec.ts`

**Interfaces:**

- Consumes: the updated shared component with separate Personal Memory and Project Knowledge labels.
- Produces: evidence that the Personal Memory overview keeps its existing wording and that the Dashboard source contract remains valid.

- [ ] **Step 1: Run focused browser coverage**

```bash
pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts test/domains/dashboard/dashboard-browser.spec.ts -g "Personal Memory|Project Knowledge"
```

- [ ] **Step 2: Run Dashboard source-contract tests**

```bash
pnpm exec vitest run test/domains/dashboard/web-source.test.ts
```

- [ ] **Step 3: Check formatting and diff safety**

```bash
pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts
git diff --check
```
