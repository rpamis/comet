# Project Knowledge Source and Memory Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dashboard Project Knowledge sources searchable and readable in full, and make the latest-memory overview reliably open the existing detailed inspector.

**Architecture:** Add a read-only `read-source` capability to the Project Knowledge plugin using the existing race-safe project-file boundary. Extend the existing Dashboard source view with client-side filtering and an Ant Design Drawer for raw source text. Keep memory detail in the existing inspector, wiring every manifest item to an explicit selection and regression test.

**Tech Stack:** TypeScript plugin runtime, React/Ant Design Dashboard, Vitest domain tests, Playwright Dashboard browser tests, existing `readProtectedProjectFile` path guard.

## Global Constraints

- Preserve the current dirty changes in `CHANGELOG.md`, `domains/comet-memory/plugin.ts`, Dashboard web files, related tests, and `.tmp-supervisor-delivery-lE3btD/`; stage only files belonging to this feature when committing.
- Use the existing `readProtectedProjectFile` boundary; never read a user-supplied absolute path or project-external path directly.
- Keep source content as plain text in the UI; never render source content as HTML or executable Markdown.
- Keep the latest-memory preview limited to the latest task's actual Agent context; do not turn it into a list of all stored memories.
- Write the user-visible `CHANGELOG.md` entry in English only after the implementation is complete and compare the branch against the current master/tag before deciding the version entry.
- Follow repository validation scope: focused tests first; run build only because the plugin/runtime and Dashboard assets are changed; run the full suite before final delivery because the change crosses plugin and Dashboard boundaries.

---

### Task 1: Add a safe Project Knowledge source-read capability

**Files:**

- Modify: `domains/project-knowledge/plugin.ts` near `createProjectKnowledgeModule` capability dispatch
- Test: `test/domains/project-knowledge/project-knowledge.test.ts` in the Project Knowledge plugin/dashboard capability coverage

**Interfaces:**

- Consumes: `context.invoke` Dashboard capability dispatch, `options.projectRoot`, and `readProtectedProjectFile` from `domains/workflow-contract/protected-project-path.ts`.
- Produces: `read-source` capability accepting `{ source: string }` and returning `{ kind: 'source', source, content, size, modifiedAt, truncated }` for a readable text file, or a stable plugin error for an unsafe/unreadable source.

- [ ] **Step 1: Write the failing domain tests for successful reads and unsafe paths**

  Add tests that create a temporary project with `docs/rule.md` containing `# Rule\n\nRun focused tests first.\n`, then invoke:

  ```ts
  await bridge.pluginRuntime.invoke(
    'comet.project-knowledge',
    'read-source',
    { source: 'docs/rule.md' },
    { scope: 'project', projectId: bridge.currentProjectId },
  );
  ```

  Assert the result has `kind: 'source'`, `source: 'docs/rule.md'`, the complete file text, a positive `size`, an ISO `modifiedAt`, and `truncated: false`. Add separate assertions that `{ source: '../outside.md' }`, an absolute path, and a directory reject without reading outside the project root.

- [ ] **Step 2: Run the focused tests and verify the failure is the missing capability**

  Run:

  ```bash
  pnpm exec vitest run test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected result: the new test fails with the Project Knowledge plugin's unknown-capability error for `read-source`; existing Project Knowledge tests remain green.

- [ ] **Step 3: Implement the minimal `read-source` capability**

  In `domains/project-knowledge/plugin.ts`:
  1. Import `readProtectedProjectFile` from `../workflow-contract/protected-project-path.js`.
  2. Define a Dashboard source read byte limit of `2 * 1024 * 1024` near the other plugin constants.
  3. In the capability dispatch after `status`/`list` handling, require a non-empty `value.source` string.
  4. Call `readProtectedProjectFile(options.projectRoot, value.source.trim(), limit, { label: ... })`.
  5. Reject buffers containing a NUL byte as non-text source content.
  6. Return the normalized relative source, UTF-8 text, `Number(result.stat.size)`, `new Date(result.stat.mtimeMs).toISOString()`, and `truncated: false`.
  7. Map the existing race-safe `too-large` failure to a stable user-facing plugin error that the Dashboard can show as “来源文件过大，无法在 Dashboard 内完整查看”; let path and missing-file failures retain their safe label without exposing an absolute path.

- [ ] **Step 4: Run the focused tests and verify the capability passes**

  Run:

  ```bash
  pnpm exec vitest run test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected result: the new source-read, path-safety, and text-content tests pass with no regression in the existing Project Knowledge contract tests.

- [ ] **Step 5: Commit the isolated capability change**

  ```bash
  git add domains/project-knowledge/plugin.ts test/domains/project-knowledge/project-knowledge.test.ts
  git commit -m "feat(project-knowledge): add safe source reading"
  ```

### Task 2: Add searchable source rows and a source-content Drawer

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx` in `ProjectKnowledgeSources`, `ProjectKnowledgeCenter`, and shared source-label helpers
- Modify: `domains/dashboard/web/src/styles.css` beside the existing Project Knowledge source styles and responsive rules
- Test: `test/domains/dashboard/dashboard-browser.spec.ts` in `shows Project Knowledge status and project pause transitions`
- Test: `test/domains/dashboard/web-source.test.ts` only if the new source interaction needs a static source-contract assertion beyond the browser test

**Interfaces:**

- Consumes: `sourceEntries`, `onInvoke`, the `read-source` result from Task 1, and existing project knowledge record/source metadata.
- Produces: a source search input labelled `搜索项目知识来源`, a complete filtered source list labelled `项目知识数据来源列表`, and a Drawer labelled `项目知识来源详情` with source metadata and raw text/error states.

- [ ] **Step 1: Extend the browser fixture and write failing UI assertions**

  In the existing Project Knowledge browser route, add at least one second source and make the `read-source` invoke branch return:

  ```ts
  {
    kind: 'source',
    source: 'docs/rule.md',
    content: '# Rule\n\nRun focused tests first.\n',
    size: 37,
    modifiedAt: '2026-08-23T12:00:00.000Z',
    truncated: false,
  }
  ```

  After opening the “数据来源” tab, assert that the search input is visible, the source count reflects both sources, filtering with `rule.md` hides the second source, and clicking the remaining source opens a Drawer containing the complete heading/body text and source path. Also add an assertion for the read failure response showing its message inside the Drawer.

- [ ] **Step 2: Run the focused browser test and verify it fails for missing source interaction**

  Run:

  ```bash
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "Project Knowledge status"
  ```

  Expected result: the new assertions fail because the current source view has no search input, no clickable source row, and no source Drawer.

- [ ] **Step 3: Implement source aggregation, search, and selection state**

  In `ProjectKnowledgeCenter`:
  1. Add `sourceSearchText`, `selectedSource`, `sourceDrawerOpen`, and `sourceReadPending` state.
  2. Keep the existing union of record-declared sources and `snapshot.local.sources`; add record titles to each source entry for filtering and keep all entries without a fixed `slice`.
  3. Derive `visibleSourceEntries` by matching normalized search text against `source`, `kind`, status, and associated record titles.
  4. Pass the filtered entries, search value, selection callback, and `onInvoke` into `ProjectKnowledgeSources`.
  5. When a source is selected, open the Drawer, set loading state, call `onInvoke('read-source', { source })`, and store the returned payload. Close/reset the Drawer without changing the source search.

- [ ] **Step 4: Implement the source view and raw-text Drawer**

  In `ProjectKnowledgeSources`:
  1. Add an Ant Design `Input` with `SearchOutlined`, `allowClear`, placeholder `搜索来源路径、类型或关联知识…`, and accessible label `搜索项目知识来源`.
  2. Show `共 N 个来源` and, when filtering, `匹配 M 个`.
  3. Render each source row as a keyboard-accessible button-like element with path, associated record count, status, and update time.
  4. Add an Ant Design `Drawer` titled with the selected source path and `aria-label="项目知识来源详情"`.
  5. Render metadata and raw content in a scrollable `<pre>`; do not pass content through the Markdown renderer.
  6. Render loading, read error, missing content, and `truncated` states with explicit Chinese messages.
  7. Keep the existing source table’s compact Dashboard styling and add only the search, selected-row, Drawer, and narrow-screen rules required for this view.

- [ ] **Step 5: Run the focused browser test and verify the UI passes**

  ```bash
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "Project Knowledge status"
  ```

  Expected result: source count, filtering, keyboard/click selection, raw source content, and error-state assertions pass.

- [ ] **Step 6: Run the Dashboard source-contract tests and format the touched files**

  ```bash
  pnpm exec vitest run test/domains/dashboard/web-source.test.ts
  pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts
  ```

  Expected result: all focused Dashboard source tests and formatting checks pass.

- [ ] **Step 7: Commit the isolated source browser change**

  ```bash
  git add domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts test/domains/dashboard/web-source.test.ts
  git commit -m "feat(dashboard): browse project knowledge sources"
  ```

### Task 3: Make the latest-memory overview open full details

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx` in `ContextManifestPreview` and `PersonalMemoryCenter`
- Modify: `domains/dashboard/web/src/styles.css` beside `.dashboard-context-manifest-items` and memory inspector styles
- Test: `test/domains/dashboard/dashboard-browser.spec.ts` in `adds global or project memory, explains application, and permanently deletes`
- Test: `test/domains/comet-memory/memory-experience.test.ts` only if the manifest projection needs a backend regression for a missing/deleted record

**Interfaces:**

- Consumes: the current `manifestPreview`, `management.records`, and existing `selectedMemoryId`/memory inspector state.
- Produces: an accessible preview item whose selection updates the detailed memory inspector and remains correct after page state reconciliation.

- [ ] **Step 1: Add the failing regression for an overview-to-detail interaction**

  Add a browser assertion that clicks the first preview item through its accessible name `查看记忆详情：沟通偏好`, then verifies the selected inspector contains the complete memory text, `为什么应用：用户明确设置`, the latest task, and application history. Add a keyboard activation assertion for a second preview item or use the existing preview item after resetting selection to confirm Enter activation.

- [ ] **Step 2: Run the focused browser test and verify the regression fails before the interaction exists**

  ```bash
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "adds global or project memory"
  ```

  Expected result: the new assertion fails because the preview entries are currently non-interactive in the baseline behavior.

- [ ] **Step 3: Implement the minimal overview selection wiring**

  In `ContextManifestPreview`, render each item as an accessible interactive element with an explicit `查看记忆详情：${item.title}` name and Enter/Space handling. In `PersonalMemoryCenter`, map the selected item ID to the existing `managedRecords` entry and update `selectedMemoryId`; preserve the existing detailed inspector as the single source of truth for full content, application history, scope, and evidence.

  If a manifest item cannot be found in `managedRecords`, leave the preview readable but render the existing empty/unavailable detail state instead of inventing record fields. Keep the current delete/correction reconciliation behavior unchanged.

- [ ] **Step 4: Run the focused memory and browser regressions**

  ```bash
  pnpm exec vitest run test/domains/comet-memory/memory-experience.test.ts
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "adds global or project memory"
  ```

  Expected result: the backend projection test and the overview-to-detail browser interaction pass.

- [ ] **Step 5: Commit the isolated memory-detail change**

  ```bash
  git add domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/dashboard-browser.spec.ts test/domains/comet-memory/memory-experience.test.ts
  git commit -m "fix(dashboard): open latest memory details"
  ```

### Task 4: Release-facing documentation and final verification

**Files:**

- Modify: `CHANGELOG.md` under the existing version entry that is exactly one increment above `origin/master`, or create the required top entry after comparing the current package version and latest tag
- Test: all files touched by Tasks 1–3 through their focused suites, then the repository full suite

**Interfaces:**

- Consumes: completed source-read capability, source Drawer, memory detail navigation, and their passing regressions.
- Produces: user-visible English changelog wording and verified working-tree handoff with unrelated changes preserved.

- [ ] **Step 1: Determine the changelog comparison baseline before editing it**

  Run:

  ```bash
  node -p "require('./package.json').version"
  git show origin/master:package.json | Select-String '"version"'
  $previousTag = git describe --tags --abbrev=0
  git log "$previousTag..HEAD" --oneline
  ```

  Use the existing higher-than-master changelog entry if one already exists; do not create a development-history entry for intermediate fixes.

- [ ] **Step 2: Add one concise English user-visible changelog entry**

  Add under `### Changed` or `### Added` as appropriate:

  ```markdown
  - **Project Knowledge sources**: Added searchable source browsing with in-dashboard full-text previews, and made the latest memory summary open its detailed application view.
  ```

  Keep the entry focused on behavior users notice after upgrading; do not list tests, internal capability names, or design iterations.

- [ ] **Step 3: Run focused verification after all implementation changes**

  ```bash
  pnpm exec vitest run test/domains/project-knowledge/project-knowledge.test.ts test/domains/comet-memory/memory-experience.test.ts test/domains/dashboard/web-source.test.ts
  pnpm exec playwright test test/domains/dashboard/dashboard-browser.spec.ts --grep "Project Knowledge status|adds global or project memory"
  pnpm exec prettier --check domains/project-knowledge/plugin.ts domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/project-knowledge/project-knowledge.test.ts test/domains/comet-memory/memory-experience.test.ts test/domains/dashboard/dashboard-browser.spec.ts CHANGELOG.md
  pnpm lint
  pnpm build
  ```

- [ ] **Step 4: Run the full test suite once and classify any failure**

  ```bash
  pnpm test
  ```

  If it fails, identify whether the failure is caused by this change before rerunning; do not repeat an unchanged failing command.

- [ ] **Step 5: Verify the final diff and preserve unrelated work**

  ```bash
  git diff --check
  git status --short
  git diff --stat origin/040rc1 -- domains/project-knowledge/plugin.ts domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/project-knowledge/project-knowledge.test.ts test/domains/comet-memory/memory-experience.test.ts test/domains/dashboard/dashboard-browser.spec.ts CHANGELOG.md
  ```

  Confirm `.tmp-supervisor-delivery-lE3btD/` and the pre-existing dirty files remain present and are not accidentally staged. Report exact focused/full verification results and any checks not run.
