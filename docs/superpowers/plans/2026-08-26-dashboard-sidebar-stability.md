# Dashboard Sidebar Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop sidebar collapse use one smooth layout transition and keep the settings action reachable in either rail state.

**Architecture:** The workbench grid retains ownership of the 228px/64px rail width animation. The Ant Design Sider and its content fill that grid cell without animating their own dimensions. The sidebar navigation becomes the only shrinkable/scrollable flex child, while the footer is non-shrinkable.

**Tech Stack:** React, Ant Design, CSS, Playwright, Vitest.

## Global Constraints

- Preserve the existing desktop widths: 228px expanded and 64px collapsed.
- Do not change the mobile Drawer, workflow/plugin navigation behavior, or settings-modal behavior.
- Respect `prefers-reduced-motion` by retaining its existing transition override.
- Preserve unrelated uncommitted Dashboard work.

---

### Task 1: Lock the desktop sidebar interaction contract

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`
- Modify: `test/domains/dashboard/web-source.test.ts`

**Interfaces:**

- Consumes: desktop `Layout.Sider` with class `.dashboard-sidebar`, collapse button names `收起侧边栏` and `展开侧边栏`, and settings action class `.dashboard-sidebar-settings`.
- Produces: a browser regression that verifies the collapsed rail retains a reachable settings action, plus a source contract that prevents reintroducing independent Sider size transitions.

- [x] **Step 1: Write the failing browser regression**

```ts
test('keeps the desktop sidebar transition unified and settings reachable when collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/?demo');

  const workbench = page.locator('.dashboard-workbench');
  const sidebar = page.locator('.dashboard-sidebar');
  const sidebarContent = sidebar.locator('.dashboard-sidebar-content');
  const footer = sidebar.locator('.dashboard-sidebar-footer');
  const settings = sidebar.locator('.dashboard-sidebar-settings');

  await expect(workbench).toHaveCSS('transition-duration', '0.22s');
  await expect(sidebar).toHaveCSS('transition-property', 'none');
  await expect(footer).toHaveCSS('flex-shrink', '0');
  await expect(settings).toBeInViewport();

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.waitForTimeout(60);

  const [sidebarWidth, sidebarContentWidth] = await Promise.all([
    sidebar.evaluate((element) => element.getBoundingClientRect().width),
    sidebarContent.evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(Math.abs(sidebarWidth - sidebarContentWidth)).toBeLessThanOrEqual(1);

  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await expect(settings).toHaveCSS('width', '40px');
  await expect(settings).toBeInViewport();
});
```

- [x] **Step 2: Run the browser regression and verify it fails because the Sider animates its own size**

Run: `pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep "keeps the desktop sidebar transition unified and settings reachable when collapsed"`

Expected: FAIL because `.dashboard-sidebar` has a `220ms` width/flex-basis transition instead of `transition-property: none`.

- [x] **Step 3: Add a source contract for the single transition owner**

```ts
expect(styles).toMatch(
  /\.dashboard-sidebar\s*\{[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0 !important;[\s\S]*?transition: none !important;/,
);
expect(styles).toMatch(
  /\.dashboard-sidebar-navigation\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/,
);
expect(styles).toMatch(/\.dashboard-sidebar-footer\s*\{[\s\S]*?flex: 0 0 auto;/);
```

- [x] **Step 4: Run the source contract and verify it fails**

Run: `pnpm vitest run test/domains/dashboard/web-source.test.ts`

Expected: FAIL because the current CSS gives `.dashboard-sidebar` independent dimension transitions and does not declare the explicit navigation/footer flex contract.

### Task 2: Make the workbench grid the single rail animation owner

**Files:**

- Modify: `domains/dashboard/web/src/styles.css`
- Test: `test/domains/dashboard/dashboard-browser.spec.ts`
- Test: `test/domains/dashboard/web-source.test.ts`

**Interfaces:**

- Consumes: root `--rail-w`, the existing `.dashboard-workbench.is-sidebar-collapsed` state class, and Ant Design's inline Sider dimensions.
- Produces: one synchronized 220ms grid transition, a flex-safe footer, and an icon-only collapsed settings button.

- [x] **Step 1: Replace the Sider-owned dimension transition with grid-cell filling**

```css
@media (min-width: 1024px) {
  .dashboard-sidebar {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    flex: 0 0 auto !important;
    transition: none !important;
  }

  .dashboard-sidebar-content {
    width: 100%;
    transition: none;
  }

  .dashboard-workbench.is-sidebar-collapsed .dashboard-sidebar-content {
    width: 100%;
    transition: none;
  }

  .dashboard-sidebar-navigation {
    flex: 1 1 auto;
    overflow-y: auto;
  }

  .dashboard-sidebar-footer {
    flex: 0 0 auto;
  }
}
```

- [x] **Step 2: Keep the header control on the same moving rail**

```css
@media (min-width: 1024px) {
  .dashboard-sidebar-brand {
    position: relative;
  }

  .dashboard-sidebar-collapse {
    position: absolute;
    inset-inline-end: 14px;
    margin: 0;
  }

  .dashboard-workbench.is-sidebar-collapsed .dashboard-sidebar-brand {
    justify-content: flex-start;
    padding-inline: 14px;
  }

  .dashboard-workbench.is-sidebar-collapsed .dashboard-sidebar-brand > img,
  .dashboard-workbench.is-sidebar-collapsed .dashboard-sidebar-brand-copy {
    display: block;
    opacity: 0;
    pointer-events: none;
  }
}
```

- [x] **Step 3: Run the focused tests and verify they pass**

Run: `pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep "keeps the desktop sidebar transition unified and settings reachable when collapsed"`

Expected: PASS.

Run: `pnpm vitest run test/domains/dashboard/web-source.test.ts`

Expected: PASS.

### Task 3: Validate the scoped deliverable and release metadata

**Files:**

- Modify if required by release comparison: `CHANGELOG.md`, `package.json`
- Verify: `domains/dashboard/web/src/styles.css`, `test/domains/dashboard/dashboard-browser.spec.ts`, `test/domains/dashboard/web-source.test.ts`

**Interfaces:**

- Consumes: the passing focused tests and the repository's existing release version.
- Produces: formatter-clean Dashboard sources and an accurate decision on whether the user-visible fix belongs in the active version's changelog.

- [x] **Step 1: Format-check the changed source and test files**

Run: `pnpm exec prettier --check domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts test/domains/dashboard/web-source.test.ts`

Expected: PASS.

- [x] **Step 2: Review the version baseline and active changelog entry**

Run: `git show origin/master:package.json`, `git show origin/master:CHANGELOG.md`, `git log --oneline <latest-release-tag>..HEAD`, and `git diff -- CHANGELOG.md package.json`.

Expected: determine whether this fix changes a released/master behavior and must be added to the already-active next version, without creating a development-history entry.

- [x] **Step 3: Inspect the scoped diff**

Run: `git diff --check -- domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts test/domains/dashboard/web-source.test.ts CHANGELOG.md package.json`

Expected: PASS with no whitespace errors.
