# Project Knowledge Preview Cards Implementation Plan

> **For agentic workers:** Follow this plan task by task. Keep the existing unrelated dirty files untouched.

**Goal:** Replace inline Project Knowledge manifest expansion and raw source text with settings-style preview cards that support fullscreen and the existing Markdown/JSON/YAML rendering pipeline.

**Architecture:** Keep `ContextManifestPreview` as the compact overview, but make its Project Knowledge instance controlled by a page-local selected item and render a `ProjectKnowledgePreviewModal`. Add a shared preview-surface helper for async HTML rendering, TOC extraction, Mermaid activation, fullscreen state, and body scroll locking. The source detail modal consumes the existing `read-source` result and selects the renderer from the source extension.

**Tech Stack:** React, Ant Design Modal, existing Dashboard preview helpers (`renderMarkdown`, `renderJsonPreview`, `renderYamlTable`, `extractToc`, `runMermaid`), Playwright, Vitest, Prettier.

## Task 1: Add failing browser coverage

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`

1. Update the Project Knowledge manifest assertions so clicking `展开项目知识详情：Focused tests` opens a dialog named `项目知识详情：Focused tests`, with the full project knowledge fields inside it; assert there is no `.dashboard-context-manifest-item-detail` in the overview.
2. Assert the project knowledge dialog has `全屏展示` and toggles to `退出全屏`.
3. Extend the local source fixture with `docs/verification.json` and return valid JSON from `read-source` for it.
4. Assert `docs/rule.md` renders a heading named `Rule` and no longer exposes the raw `# Rule` as the document body; assert the source dialog can enter fullscreen.
5. Assert `docs/verification.json` displays structured JSON fields/table content, then close the dialog.
6. Run the focused Project Knowledge browser test and confirm the new assertions fail against the current inline/raw implementation.

## Task 2: Implement reusable project knowledge preview modal

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx`
- Modify: `domains/dashboard/web/src/styles.css`

1. Add a reusable `ProjectKnowledgePreviewModal` with settings-style `Modal` classes, title, close behavior, fullscreen toggle, scrollable body, and body scroll lock.
2. Render project knowledge details with clear labels, full text wrapping, metadata, and accessible dialog names.
3. Refactor `ContextManifestPreview` so the Project Knowledge call opens the modal instead of rendering an inline detail section; preserve the Personal Memory call’s existing inline behavior unless the component is given modal mode.
4. Keep selection callback behavior so selecting a known Project Knowledge record still updates the existing record inspector after the modal is closed or when the user chooses the associated record.
5. Add shared preview-content helpers or a shared surface component that consume the existing render functions, capture TOC, run Mermaid, and handle loading/error/empty states.

## Task 3: Implement rendered source-file preview

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx`
- Modify: `domains/dashboard/web/src/styles.css`

1. Replace the source `Drawer` with `ProjectKnowledgePreviewModal` using the selected source path and source metadata.
2. Preserve associated-record links and source read loading/error/truncated states.
3. Select Markdown, JSON, YAML, or fallback rendering from the source path; never render source content as raw HTML or a plain unbounded `<pre>`.
4. Add fullscreen document navigation when headings exist, matching Classic/Native artifact preview behavior.
5. Ensure closing the modal resets its fullscreen state and source read state, while search/list state remains unchanged.

## Task 4: Verify and hand off

1. Run the focused browser test for the Project Knowledge scenario.
2. Run `pnpm exec vitest run test/domains/dashboard/web-source.test.ts`.
3. Run Prettier check on the touched Dashboard source, styles, and browser test; run `git diff --check`.
4. Run `pnpm build:dashboard` because the Dashboard runtime/asset output is affected.
5. Run the full Dashboard Playwright suite if focused checks pass; report any unrelated pre-existing full-repo failures without modifying unrelated files.
