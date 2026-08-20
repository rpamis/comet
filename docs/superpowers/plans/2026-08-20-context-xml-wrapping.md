# Context XML Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Native Build/Verify loop to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap personal memory and project knowledge task-context contributions in stable XML elements while preserving retrieval behavior and compatibility.

**Architecture:** Keep plugin retrieval/rendering unchanged and apply one transformation at the existing `collectCometPluginContext` boundary after the bridge has merged contributions. A fixed plugin-ID-to-tag map and XML-text escaping helper will wrap only the two first-party contributions; unknown plugins and blank contributions keep their existing shape.

**Tech Stack:** TypeScript, Vitest, pnpm, esbuild Entry runtime bundle, existing Native Runtime checks.

## Global Constraints

- Use exactly `<personal_memory>` and `<project_knowledge>` for the two known plugin IDs.
- Preserve contribution order, array cardinality, Markdown body, citations, retrieval limits, configuration, and non-blocking failures.
- Escape `&`, `<`, `>`, `"`, and `'` in known contribution bodies as `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&apos;`.
- Do not add wrappers for unknown plugin IDs or emit wrappers for blank known contributions.
- Keep the beta20 version and append one user-visible English Changelog entry to the existing beta20 section.
- Regenerate `assets/skills/comet/scripts/comet-entry-runtime.mjs` from source; never edit the generated bundle directly.

---

### Task 1: Add failing context-boundary regression tests

**Files:**

- Create: `test/domains/comet-entry/plugin-context.test.ts`
- Read-only dependency under test: `domains/comet-entry/plugin-context.ts`

**Interfaces:**

- Consumes: `collectCometPluginContext(projectRoot, request)` and the mocked `createDefaultCometPluginBridge()` result with `collectContext()` and `diagnostics()` methods.
- Produces: Regression coverage for A1–A4 that the implementation task must satisfy.

- [ ] **Step 1: Write the failing test**

Create a Vitest module mock with `vi.hoisted` bridge spies and add these cases:

```ts
const bridge = vi.hoisted(() => ({
  collectContext: vi.fn(),
  diagnostics: vi.fn(async () => []),
}));

vi.mock('../../../domains/comet-plugin/index.js', () => ({
  createDefaultCometPluginBridge: vi.fn(async () => bridge),
}));

test('wraps personal memory and project knowledge after bridge collection', async () => {
  bridge.collectContext.mockResolvedValue([
    {
      pluginId: 'comet.personal-memory',
      text: '## 偏好\n- 使用 & <中文> "引号" \'单引号\'',
    },
    {
      pluginId: 'comet.project-knowledge',
      text: '## 项目知识参考\n- Source: docs/guide.md\n  > 结论',
    },
  ]);

  await expect(collectCometPluginContext('D:/repo', { task: '测试上下文' })).resolves.toEqual([
    {
      pluginId: 'comet.personal-memory',
      text: '<personal_memory>\n## 偏好\n- 使用 &amp; &lt;中文&gt; &quot;引号&quot; &apos;单引号&apos;\n</personal_memory>',
    },
    {
      pluginId: 'comet.project-knowledge',
      text: '<project_knowledge>\n## 项目知识参考\n- Source: docs/guide.md\n  &gt; 结论\n</project_knowledge>',
    },
  ]);
});

test('keeps blank known contributions and unknown plugins compatible', async () => {
  bridge.collectContext.mockResolvedValue([
    { pluginId: 'comet.project-knowledge', text: '  \n' },
    { pluginId: 'comet.other', text: 'raw & <text>' },
    { pluginId: 'comet.personal-memory', text: 'memory' },
  ]);

  await expect(collectCometPluginContext('D:/repo', { task: '兼容性' })).resolves.toEqual([
    { pluginId: 'comet.project-knowledge', text: '  \n' },
    { pluginId: 'comet.other', text: 'raw & <text>' },
    {
      pluginId: 'comet.personal-memory',
      text: '<personal_memory>\nmemory\n</personal_memory>',
    },
  ]);
});
```

Reset `collectContext` and `diagnostics` in `beforeEach`, import `collectCometPluginContext` after the mock declaration, and keep the test under `test/domains/comet-entry/`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run test/domains/comet-entry/plugin-context.test.ts`

Expected: FAIL because the current implementation returns the bridge text without XML wrappers or escaping.

- [ ] **Step 3: Commit the red test**

```bash
git add test/domains/comet-entry/plugin-context.test.ts
git commit -m "test(entry): define XML context wrapper contract"
```

### Task 2: Implement the XML wrapping at the Entry boundary

**Files:**

- Modify: `domains/comet-entry/plugin-context.ts`
- Test: `test/domains/comet-entry/plugin-context.test.ts`

**Interfaces:**

- Consumes: Bridge contributions shaped as `{ pluginId: string, text: string }`.
- Produces: The same contribution array shape with fixed XML wrappers for the two known plugin IDs.

- [ ] **Step 1: Add fixed tag and escaping helpers**

Add a private map and helpers near the top of `plugin-context.ts`:

```ts
const CONTEXT_TAGS: Readonly<Record<string, string>> = {
  'comet.personal-memory': 'personal_memory',
  'comet.project-knowledge': 'project_knowledge',
};

function escapeXmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapPluginContext(pluginId: string, text: string): string {
  const tag = CONTEXT_TAGS[pluginId];
  if (tag === undefined || text.trim().length === 0) return text;
  return `<${tag}>\n${escapeXmlText(text)}\n</${tag}>`;
}
```

- [ ] **Step 2: Apply the helper without changing bridge behavior**

Replace the final mapping with a mapping that normalizes the plugin ID once and wraps only its text:

```ts
return contributions.map(({ pluginId, text }) => {
  const normalizedPluginId = String(pluginId);
  return {
    pluginId: normalizedPluginId,
    text: wrapPluginContext(normalizedPluginId, text),
  };
});
```

Do not move diagnostics, change bridge requests, trim non-empty text, or alter unknown-plugin text.

- [ ] **Step 3: Run the focused test to verify it passes**

Run: `npx vitest run test/domains/comet-entry/plugin-context.test.ts`

Expected: PASS for both wrapper, escaping, blank-contribution, unknown-plugin, order, and cardinality assertions.

- [ ] **Step 4: Commit the implementation**

```bash
git add domains/comet-entry/plugin-context.ts test/domains/comet-entry/plugin-context.test.ts
git commit -m "feat(entry): wrap memory contexts in XML"
```

### Task 3: Regenerate the Entry runtime and record the user-visible change

**Files:**

- Modify: `assets/skills/comet/scripts/comet-entry-runtime.mjs` (generated only)
- Modify: `CHANGELOG.md` in the existing `0.4.0-beta.20` entry under `### Changed`

**Interfaces:**

- Consumes: The updated `domains/comet-entry/plugin-context.ts` source.
- Produces: A synchronized published Entry runtime and a concise beta20 user-facing note.

- [ ] **Step 1: Regenerate the bundle**

Run: `pnpm build:entry-runtime`

Expected: The generated `comet-entry-runtime.mjs` changes only as a consequence of the source update.

- [ ] **Step 2: Add the Changelog entry**

Under the first beta20 `### Changed` section, add:

```markdown
- **Task context boundaries**: Personal memory and project knowledge references are now wrapped in distinct XML elements so Agents can distinguish user preferences from project evidence.
```

Do not bump the version or duplicate the existing retrieval/dashboard entries.

- [ ] **Step 3: Commit generated output and Changelog**

```bash
git add assets/skills/comet/scripts/comet-entry-runtime.mjs CHANGELOG.md
git commit -m "chore: publish XML context boundaries"
```

### Task 4: Run proportionate verification and submit the Native candidate

**Files:**

- Verify: `domains/comet-entry/plugin-context.ts`, `test/domains/comet-entry/plugin-context.test.ts`, generated Entry runtime, and `CHANGELOG.md`

**Interfaces:**

- Consumes: The committed implementation and generated bundle.
- Produces: Native Builder handoff with explicit checks mapped to A1–A26.

- [ ] **Step 1: Run affected behavioral tests**

Run: `npx vitest run test/domains/comet-entry/plugin-context.test.ts test/app/comet-task-command.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts test/domains/comet-plugin/plugin-integration.test.ts`

Expected: PASS; existing command tests continue to receive the mocked contribution shape and bridge integration remains unchanged.

- [ ] **Step 2: Run source, generated-asset, and build checks**

Run: `pnpm exec prettier --check domains/comet-entry/plugin-context.ts test/domains/comet-entry/plugin-context.test.ts CHANGELOG.md docs/comet/changes/context-xml-wrapping/brief.md docs/comet/changes/context-xml-wrapping/specs/context-injection/spec.md docs/superpowers/plans/2026-08-20-context-xml-wrapping.md`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm check:generated`

Expected: All commands exit 0; generated Entry runtime is current and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Run the final full test suite**

Run: `pnpm test`

Expected: Existing full Vitest suite passes with no new skips or failures.

- [ ] **Step 4: Submit the Native Builder handoff**

After the checks finish, write a temporary JSON file matching the Runtime continuation template with:

```json
{
  "kind": "builder-handoff",
  "summary": "Wrapped non-empty personal memory and project knowledge contributions in fixed XML tags at the shared Entry boundary; escaped XML text, preserved ordering and unknown plugins, and left retrieval/lifecycle behavior unchanged.",
  "addressed_acceptance_ids": [
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "A8",
    "A9",
    "A10",
    "A11",
    "A12",
    "A13",
    "A14",
    "A15",
    "A16",
    "A17",
    "A18",
    "A19",
    "A20",
    "A21",
    "A22",
    "A23",
    "A24",
    "A25",
    "A26"
  ],
  "checks": [
    {
      "name": "focused-context-and-command-vitest",
      "result": "passed",
      "note": "XML wrapper, escaping, empty/unknown contribution, Entry caller, and plugin bridge tests passed."
    },
    {
      "name": "prettier-lint-build-generated",
      "result": "passed",
      "note": "Affected formatting, lint, full build, and generated Entry runtime checks passed."
    },
    { "name": "full-vitest", "result": "passed", "note": "Full Vitest suite passed." },
    { "name": "git-diff-check", "result": "passed", "note": "No whitespace errors." }
  ],
  "known_limits": []
}
```

Run the Runtime continuation command returned by `comet native status context-xml-wrapping --details --json` with that file; do not edit `comet-state.yaml` manually.
