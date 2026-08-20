# Project Knowledge Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the first-party `comet.project-knowledge` plugin in Dashboard beside Personal Memory with a safe Local/Remote status view, bounded diagnostics, and the existing project-scoped lifecycle controls.

**Architecture:** The Project Knowledge plugin owns a Dashboard contribution and returns a serializable status snapshot from a new `status` capability; it never creates a provider or performs a network request while the page is rendered. `DashboardPluginHost` remains the sole lifecycle authority and adds explicit global-disabled/project-paused flags to the existing page summary so the renderer can explain the state without creating another state machine. The React page reuses the existing compact Dashboard/Ant Design visual language and exposes configuration read-only.

**Tech Stack:** TypeScript, Comet Plugin Runtime, DashboardPluginHost, React 19, Ant Design 6, Vitest, Playwright, Native change artifacts.

## Global Constraints

- Work on `beta20` through a new Native change named `project-knowledge-dashboard`; do not edit or reopen the archived `project-knowledge-retrieval` change.
- Keep the current Project Knowledge retrieval path, provider limits, and non-blocking diagnostics unchanged.
- Page data may include only `provider`, `configured`, sanitized `remote`, `retrieval`, and at most three bounded `diagnostics` entries; never include token values, Authorization headers, absolute paths, or full remote responses.
- The page is read-only for knowledge configuration; no search, index, embedding, watcher, retrieval-history, or configuration-editor UI is added.
- Reuse `DashboardPluginHost` lifecycle actions. A `disable` action is the existing project pause, and `enable` resumes it; `uninstall` remains the existing removal action.
- User-visible changelog text is English and is added under the existing `0.4.0-beta.20` entry only after the implementation is complete.
- Focused tests run after each subsystem; final delivery runs formatting, lint, build, generated-asset checks, focused Dashboard/Project Knowledge tests, and the full Vitest suite.

---

### Task 1: Open the Native change and record the approved scope

**Files:**

- Create through Runtime: `docs/comet/changes/project-knowledge-dashboard/brief.md`, `docs/comet/changes/project-knowledge-dashboard/specs/dashboard.md`, and the Native state files produced by the command.
- Read only: `docs/superpowers/specs/2026-08-20-project-knowledge-dashboard-design.md`, `docs/comet/archive/2026-08-19-project-knowledge-retrieval/`.

**Interfaces:**

- Consumes: the approved Dashboard design and the current `beta20` working tree.
- Produces: an active Native change selected in the current workspace, with a formal spec whose acceptance items match the approved design.

- [ ] **Step 1: Confirm the workspace and archived boundary.**

  Run:

  ```powershell
  git status --short --branch
  git log -1 --oneline
  Test-Path docs/comet/archive/2026-08-19-project-knowledge-retrieval
  ```

  Expected: branch `beta20`, the existing design commit at `HEAD`, and `True` for the archived retrieval change.

- [ ] **Step 2: Create the current-workspace Native change.**

  Run:

  ```powershell
  pnpm exec comet native new project-knowledge-dashboard --language zh-CN --isolation current --json
  ```

  Expected: the Runtime reports `project-knowledge-dashboard` as the selected active change and does not create or modify the archived retrieval change.

- [ ] **Step 3: Fill the formal scope and acceptance criteria.**

  The formal spec must state these six acceptance items exactly:

  ```text
  1. Dashboard lists Project Knowledge beside Personal Memory.
  2. Local and Remote summaries show provider configuration without exposing secrets.
  3. Plugin status distinguishes enabled, globally disabled, and current-project paused.
  4. The page shows at most three bounded recent diagnostics and an empty state when none exist.
  5. Enable, project pause/resume, and uninstall call the existing Dashboard lifecycle API.
  6. No search, index, history, or configuration-editing UI is introduced.
  ```

- [ ] **Step 4: Run the Native read-only check.**

  Run:

  ```powershell
  pnpm exec comet native check project-knowledge-dashboard --json
  ```

  Expected: the check accepts the formal spec and reports no missing required artifact.

- [ ] **Step 5: Commit the change artifacts.**

  ```powershell
  git add docs/comet/changes/project-knowledge-dashboard
  git commit -m "chore(native): open project knowledge dashboard change"
  ```

### Task 2: Add the sanitized Project Knowledge status contract and plugin capability

**Files:**

- Modify: `domains/project-knowledge/types.ts`
- Create: `domains/project-knowledge/dashboard.ts`
- Modify: `domains/project-knowledge/plugin.ts`
- Test: `test/domains/project-knowledge/project-knowledge.test.ts`

**Interfaces:**

- Consumes: `WorkflowKnowledgeProjectConfig`, the existing plugin options, and `PluginModule`.
- Produces: `ProjectKnowledgeDashboardSnapshot`, `createProjectKnowledgeDashboardSnapshot(options)`, and a `status` plugin capability used by the Dashboard contribution.

- [ ] **Step 1: Write failing snapshot tests.**

  Add tests with this shape to `test/domains/project-knowledge/project-knowledge.test.ts`:

  ```ts
  it('returns a safe Local dashboard snapshot without provider work', () => {
    expect(
      createProjectKnowledgeDashboardSnapshot({
        config: { provider: 'local' },
        language: 'zh-CN',
      }),
    ).toEqual({
      provider: 'local',
      configured: true,
      retrieval: expect.stringContaining('不会维护索引'),
    });
  });

  it('sanitizes Remote endpoint credentials and never returns token values', () => {
    const snapshot = createProjectKnowledgeDashboardSnapshot({
      config: {
        provider: 'remote',
        remote: {
          endpoint: 'https://user:password@example.test/retrieve?token=secret',
          token_env: 'COMET_KNOWLEDGE_TOKEN',
          scope: 'team-a',
          timeout_ms: 1200,
        },
      },
      env: { COMET_KNOWLEDGE_TOKEN: 'bearer-secret' },
      language: 'en',
    });

    expect(snapshot).toMatchObject({
      provider: 'remote',
      configured: true,
      remote: {
        endpoint: 'https://example.test/retrieve',
        tokenEnv: 'COMET_KNOWLEDGE_TOKEN',
        tokenConfigured: true,
        scope: 'team-a',
        timeoutMs: 1200,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('password');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('bearer-secret');
  });

  it('loads the dashboard snapshot through status without constructing a provider', async () => {
    const module = await createProjectKnowledgeModule(
      { reportDiagnostic: () => undefined } as never,
      { projectRoot: 'C:/project', knowledgeConfig: { provider: 'local' } },
    );
    expect(await module.invoke?.('status', {})).toMatchObject({
      provider: 'local',
      configured: true,
    });
  });
  ```

  Import `createProjectKnowledgeDashboardSnapshot` and `createProjectKnowledgeModule` from `../../../domains/project-knowledge/index.js`; add the new dashboard builder export to `domains/project-knowledge/index.ts` when implementing it.

- [ ] **Step 2: Run the focused test to verify it fails.**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: FAIL because the snapshot builder and `status` capability do not exist yet.

- [ ] **Step 3: Implement the bounded snapshot builder.**

  Define these exact interfaces in `domains/project-knowledge/types.ts`:

  ```ts
  export interface ProjectKnowledgeDashboardRemoteSummary {
    readonly endpoint: string;
    readonly tokenEnv?: string;
    readonly tokenConfigured: boolean;
    readonly scope?: string;
    readonly timeoutMs: number;
  }

  export interface ProjectKnowledgeDashboardDiagnostic {
    readonly code: string;
    readonly message: string;
  }

  export interface ProjectKnowledgeDashboardSnapshot {
    readonly provider: WorkflowKnowledgeProvider;
    readonly configured: boolean;
    readonly remote?: ProjectKnowledgeDashboardRemoteSummary;
    readonly retrieval: string;
    readonly diagnostics: readonly ProjectKnowledgeDashboardDiagnostic[];
  }
  ```

  In `domains/project-knowledge/dashboard.ts`, implement `createProjectKnowledgeDashboardSnapshot({ config, language, env })` as follows: Local is configured with no remote block; Remote is configured only when `remote.endpoint` is a non-empty valid URL and `timeout_ms` is an integer from 100 through 30000; endpoint serialization clears username, password, query, and hash; `tokenConfigured` checks only `env[token_env]` truthiness; and the Chinese/English retrieval copy explicitly says Local does not maintain an index and Remote display does not prove a successful request. Return `diagnostics: []` from the pure builder.

- [ ] **Step 4: Add the plugin-local diagnostic ring and `status` capability.**

  In `createProjectKnowledgeModule`, keep a `ProjectKnowledgeDashboardDiagnostic[]` ring capped at three entries. The diagnostic reporter must append a message truncated to 240 characters, replace `Bearer <value>` with `Bearer [redacted]`, and forward the existing `context.reportDiagnostic({ phase: 'context', code: 'execution-failed', message })`. Return the snapshot builder result with a copy of the ring from `invoke('status', {})`. Add the Dashboard contribution:

  ```ts
  dashboard: {
    id: 'project-knowledge',
    label: options.language === 'en' ? 'Project Knowledge' : '项目知识',
    route: '/plugins/project-knowledge',
    load: async ({ invoke }) => invoke('status'),
  },
  ```

  The status path must not call `discoverProjectKnowledgeCorpus`, `LocalProjectKnowledgeProvider`, `RemoteProjectKnowledgeProvider`, `fetch`, or any retrieval function.

- [ ] **Step 5: Run the focused test to verify it passes.**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: PASS, including the existing retrieval tests.

- [ ] **Step 6: Commit the plugin contract.**

  ```powershell
  git add domains/project-knowledge/types.ts domains/project-knowledge/dashboard.ts domains/project-knowledge/plugin.ts test/domains/project-knowledge/project-knowledge.test.ts
  git commit -m "feat(project-knowledge): expose dashboard status"
  ```

### Task 3: Make global disable and project pause explicit in the Dashboard page summary

**Files:**

- Modify: `domains/dashboard/plugin-host.ts`
- Test: `test/domains/dashboard/plugin-host.test.ts`

**Interfaces:**

- Consumes: `PluginView.status` and `PluginView.disabledProjects` from `PluginRuntime.list('project')`.
- Produces: `DashboardPluginPageSummary.globallyDisabled` and `DashboardPluginPageSummary.projectPaused`, while preserving the existing `status` field and lifecycle methods.

- [ ] **Step 1: Add failing lifecycle-state assertions.**

  Extend the project-pause test and global-disable test with these assertions:

  ```ts
  await runtime.disable('test.plugin', { scope: 'project', projectId: 'project-1' });
  await expect(host.list()).resolves.toEqual([
    expect.objectContaining({
      status: 'disabled',
      globallyDisabled: false,
      projectPaused: true,
    }),
  ]);

  await runtime.disable('test.plugin');
  await expect(host.list()).resolves.toEqual([
    expect.objectContaining({
      status: 'disabled',
      globallyDisabled: true,
      projectPaused: true,
    }),
  ]);
  ```

- [ ] **Step 2: Run the focused host test to verify it fails.**

  ```powershell
  npx vitest run test/domains/dashboard/plugin-host.test.ts
  ```

  Expected: FAIL because the summary does not expose the two flags.

- [ ] **Step 3: Implement the summary flags without changing lifecycle semantics.**

  In `DashboardPluginHost.list()`, calculate `globallyDisabled = view.status === 'disabled'` and `projectPaused = view.disabledProjects.includes(this.projectId)`, set `status` to disabled when either is true, and include both booleans in the returned summary. Leave `lifecycle()` unchanged so `disable` remains a project pause and `enable` still clears both overlapping states.

- [ ] **Step 4: Run the focused host and server tests.**

  ```powershell
  npx vitest run test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts
  ```

  Expected: PASS; the server response contains the new flags and existing lifecycle tests remain green.

- [ ] **Step 5: Commit the host contract.**

  ```powershell
  git add domains/dashboard/plugin-host.ts test/domains/dashboard/plugin-host.test.ts
  git commit -m "feat(dashboard): expose plugin pause state"
  ```

### Task 4: Verify default host discovery and safe Project Knowledge page loading

**Files:**

- Modify: `test/domains/dashboard/default-plugin-host.test.ts`
- Modify: `test/domains/dashboard/plugin-server.test.ts` only if the existing fixture needs an assertion for the new summary fields.

**Interfaces:**

- Consumes: the default bridge’s first-party Project Knowledge descriptor and the `status` Dashboard contribution.
- Produces: integration coverage proving the real default host discovers and loads Project Knowledge without a retrieval request.

- [ ] **Step 1: Add the default-host failing assertions.**

  Extend the existing default host test with:

  ```ts
  expect(await host.list()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        pluginId: 'comet.project-knowledge',
        label: '项目知识',
        route: '/plugins/project-knowledge',
        status: 'enabled',
        projectPaused: false,
      }),
    ]),
  );
  await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
    data: {
      provider: 'local',
      configured: true,
      retrieval: expect.stringContaining('不会维护索引'),
      diagnostics: [],
    },
  });
  ```

- [ ] **Step 2: Run the focused integration test to verify it fails.**

  ```powershell
  npx vitest run test/domains/dashboard/default-plugin-host.test.ts
  ```

  Expected: FAIL until the plugin contribution is integrated into the default host.

- [ ] **Step 3: Run the integration test after the plugin implementation.**

  ```powershell
  npx vitest run test/domains/dashboard/default-plugin-host.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: PASS, with no HTTP server or provider invocation required by page loading.

- [ ] **Step 4: Commit the integration coverage.**

  ```powershell
  git add test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts
  git commit -m "test(dashboard): cover project knowledge page discovery"
  ```

### Task 5: Render the Project Knowledge Dashboard page

**Files:**

- Modify: `domains/dashboard/web/src/main.jsx`
- Modify: `domains/dashboard/web/src/styles.css`
- Test: `test/domains/dashboard/web-source.test.ts`

**Interfaces:**

- Consumes: `page.data` (`ProjectKnowledgeDashboardSnapshot`), `page.diagnostics`, `page.status`, `page.globallyDisabled`, `page.projectPaused`, and the existing `onInvoke('lifecycle', { action })` callback.
- Produces: `ProjectKnowledgeCenter({ page, data, onInvoke })`, displayed from `PluginCenterPage` for `comet.project-knowledge`.

- [ ] **Step 1: Add source-contract tests before editing the renderer.**

  Add a test that extracts `ProjectKnowledgeCenter` and asserts the source contains:

  ```ts
  expect(page?.[0]).toContain('dashboard-knowledge-status');
  expect(page?.[0]).toContain('dashboard-knowledge-summary');
  expect(page?.[0]).toContain('dashboard-knowledge-diagnostics');
  expect(page?.[0]).toContain('tokenEnv');
  expect(page?.[0]).toContain('tokenConfigured');
  expect(page?.[0]).toContain("onInvoke('lifecycle', { action: 'disable' })");
  expect(page?.[0]).toContain("onInvoke('lifecycle', { action: 'uninstall' })");
  expect(page?.[0]).toContain('没有新的诊断');
  expect(page?.[0]).not.toContain('Input');
  expect(page?.[0]).not.toContain('搜索');
  ```

  Add a style assertion for `.dashboard-knowledge-status` and `.dashboard-knowledge-summary` in `styles.css`.

- [ ] **Step 2: Run the web source test to verify it fails.**

  ```powershell
  npx vitest run test/domains/dashboard/web-source.test.ts
  ```

  Expected: FAIL because no Project Knowledge renderer or styles exist.

- [ ] **Step 3: Add the page branch and status renderer.**

  In `PluginCenterPage`, route `comet.project-knowledge` to `ProjectKnowledgeCenter` before the generic disabled fallback, passing `page`, `page.data`, and `onInvoke`. The component must render:
  - a `SectionHead` labelled `项目知识`;
  - a four-cell status row for provider (`Local`/`Remote`), plugin state, current-project pause state, and configuration validity;
  - a compact summary panel that shows Local’s bounded source explanation or Remote’s sanitized endpoint, scope, timeout, token environment-variable name, and token-present boolean without rendering any token value;
  - a diagnostics panel using `data.diagnostics` or `page.diagnostics`, capped by the host/plugin at three entries, with `Empty` description `没有新的诊断`;
  - enabled-page controls for `暂停当前项目` and `卸载插件`, both wired to the existing lifecycle callback and uninstall confirmation;
  - a disabled-page alert that distinguishes `globallyDisabled` from `projectPaused` and wires `重新启用` to the existing `enable` lifecycle action.

  The copy must say that Remote configuration is not evidence of a successful request and that Local does not maintain an index. Do not add an input, search control, refresh request, provider call, or configuration mutation.

- [ ] **Step 4: Add compact responsive styles.**

  In `styles.css`, add `.dashboard-knowledge-status`, `.dashboard-knowledge-status-cell`, `.dashboard-knowledge-layout`, `.dashboard-knowledge-summary`, `.dashboard-knowledge-diagnostics`, and `.dashboard-knowledge-actions` using the existing memory panel border, spacing, color, and responsive breakpoints. At widths below 760px, collapse the two-column layout; below 420px, collapse status cells to one column.

- [ ] **Step 5: Run source and formatting checks.**

  ```powershell
  npx vitest run test/domains/dashboard/web-source.test.ts
  pnpm exec prettier --check domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
  ```

  Expected: PASS for both commands.

- [ ] **Step 6: Commit the renderer.**

  ```powershell
  git add domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/web-source.test.ts
  git commit -m "feat(dashboard): add project knowledge center"
  ```

### Task 6: Add browser coverage for discovery, safe summary, and project pause/resume

**Files:**

- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`

**Interfaces:**

- Consumes: the existing Dashboard HTTP routes and the new page summary/data fields.
- Produces: a Playwright regression proving the page is discoverable, safe Remote data is rendered, and lifecycle transitions are visible.

- [ ] **Step 1: Add a fixture-backed browser test.**

  Before `page.goto('/')`, intercept these routes for project `fixture-project`: `/overview`, `/plugins`, `/plugins/comet.project-knowledge`, and `/plugins/comet.project-knowledge/lifecycle`. Return one enabled Project Knowledge page with:

  ```json
  {
    "pluginId": "comet.project-knowledge",
    "label": "项目知识",
    "route": "/plugins/project-knowledge",
    "status": "enabled",
    "globallyDisabled": false,
    "projectPaused": false,
    "diagnostics": [],
    "data": {
      "provider": "remote",
      "configured": true,
      "remote": {
        "endpoint": "https://example.test/retrieve",
        "tokenEnv": "COMET_KNOWLEDGE_TOKEN",
        "tokenConfigured": true,
        "scope": "team-a",
        "timeoutMs": 1200
      },
      "retrieval": "Remote 配置仅表示已配置，不代表最近一次请求成功。",
      "diagnostics": []
    }
  }
  ```

  On `disable`, return the same page with `status: "disabled"`, `projectPaused: true`, and `data: null`; on `enable`, return the enabled fixture again.

- [ ] **Step 2: Assert the page and lifecycle transition.**

  The test must click the `项目知识` menu item, assert the headings `项目知识`, `配置摘要`, and `最近诊断`, assert `COMET_KNOWLEDGE_TOKEN` is visible but `bearer-secret` is not, click `暂停当前项目`, assert `当前项目已暂停` and `重新启用`, then click `重新启用` and assert `当前项目已启用`.

- [ ] **Step 3: Run the focused browser test.**

  ```powershell
  pnpm test:dashboard-e2e -- --grep "Project Knowledge"
  ```

  Expected: PASS with no browser console errors.

- [ ] **Step 4: Commit the browser coverage.**

  ```powershell
  git add test/domains/dashboard/dashboard-browser.spec.ts
  git commit -m "test(dashboard): cover project knowledge lifecycle"
  ```

### Task 7: Synchronize changelog, run Native verification, and perform final repository checks

**Files:**

- Modify: `CHANGELOG.md`
- Modify through Runtime: `docs/comet/changes/project-knowledge-dashboard/comet-state.yaml`, `verification.md`, and the final Native artifacts.

**Interfaces:**

- Consumes: all implementation commits and their focused test evidence.
- Produces: a user-visible beta20 changelog entry and a verified, archived-ready Native change.

- [ ] **Step 1: Add the beta20 user-visible changelog entry.**

  Under the existing `0.4.0-beta.20` `### Added` section, add exactly one entry:

  ```markdown
  - **Project Knowledge Dashboard**: Dashboard now shows the Local or Remote project-knowledge provider, safe Remote settings, bounded recent diagnostics, and existing enable, project-pause, resume, and uninstall actions beside Personal Memory.
  ```

  Do not add implementation-only test, Native artifact, or review history entries.

- [ ] **Step 2: Run focused checks for every changed subsystem.**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge.test.ts test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/web-source.test.ts
  pnpm exec prettier --check domains/project-knowledge/types.ts domains/project-knowledge/dashboard.ts domains/project-knowledge/plugin.ts domains/dashboard/plugin-host.ts domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/project-knowledge/project-knowledge.test.ts test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/web-source.test.ts test/domains/dashboard/dashboard-browser.spec.ts CHANGELOG.md
  ```

- [ ] **Step 3: Run the repository checks required by the changed runtime and web assets.**

  ```powershell
  pnpm lint
  pnpm build
  pnpm check:generated
  pnpm test
  pnpm test:dashboard-e2e
  ```

  Expected: all commands exit 0. If a check fails, fix the concrete failure and rerun that check before proceeding; do not hide or bypass a failure.

- [ ] **Step 4: Run the Native verification check and inspect the diff.**

  ```powershell
  pnpm exec comet native check project-knowledge-dashboard --json
  git diff --check beta20...HEAD
  git status --short
  ```

  Expected: Native check passes, `git diff --check` is silent, and only the planned source, test, changelog, plan, and Native change files are present.

- [ ] **Step 5: Commit the changelog and verification evidence.**

  ```powershell
  git add CHANGELOG.md docs/comet/changes/project-knowledge-dashboard docs/superpowers/plans/2026-08-20-project-knowledge-dashboard.md
  git commit -m "docs: record project knowledge dashboard"
  ```

- [ ] **Step 6: Finish the Native change only after the user-authorized delivery step.**

  Run the Runtime archive preview and stop before any branch push unless the user separately requests delivery:

  ```powershell
  pnpm exec comet native archive project-knowledge-dashboard --json
  ```

  Expected: the preview lists the completed change and preserves the archived `project-knowledge-retrieval` artifacts.

## Self-review checklist

- The plugin page is discovered through `PluginRuntime.dashboardPages()` rather than a host hard-coded page.
- The status path is side-effect-free and cannot instantiate a Local/Remote provider or issue a request.
- Remote endpoint credentials/query secrets and token values are absent from page JSON; only the environment-variable name and presence boolean are shown.
- Host lifecycle state distinguishes global disable from current-project pause without changing `enable`, `disable`, or `uninstall` semantics.
- Disabled/paused pages cannot invoke retrieval because the existing host rejects invokes while `status` is disabled.
- The Dashboard contains no search, index, history, or configuration editor controls.
- Existing retrieval tests and the archived retrieval change remain untouched.
