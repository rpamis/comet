# Dashboard、Worktree 与个人记忆性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 Comet 自动 worktree 生命周期，并让 Dashboard 与个人记忆首屏跳过无效来源和无用 IO。

**Architecture:** 在 Native archive finish 的成功 merge 路径复用现有 Git worktree 清理能力；在 Dashboard workspace discovery 层过滤来源，让 Classic/Native/SQLite 共享同一份有效来源；在项目目录和个人记忆 page load 边界消除失效项目的 Git 查询及未使用的同步/管理读取。

**Tech Stack:** TypeScript、Node.js、Vitest、SQLite cache、React Dashboard、Git worktree。

## Global Constraints

- 不删除用户分支；worktree 自动清理只针对 Comet 创建并已成功完成 finish 的变更 worktree。
- Dashboard 不修改用户项目注册表，只跳过失效来源并保留不可用项目展示。
- 个人记忆文件格式、语言语义、检索排序和显式同步能力保持不变。
- 修改 Native runtime 后运行 `pnpm build:native-runtime` 同步生成物。
- Dashboard 源码和测试修改后运行受影响测试、格式检查和 lint。

---

### Task 1: 为 merge finish 增加 worktree 自动清理

**Files:**
- Modify: `domains/comet-native/native-workspace-finish.ts`
- Test: `test/domains/comet-native/native-workspace-finish-branches.test.ts`

**Interfaces:**
- Consumes: `NativeWorkspaceFinishPlan` 的 `changeRoot`、`primaryRoot`、`targetRoot`、`isolation`。
- Produces: merge 成功后 `NativeWorkspaceFinishResult.cleanup` 反映清理结果；不删除 change branch。

- [ ] **Step 1: Write the failing test**

在 merge finish 测试中让 `isolation: 'worktree'`、`targetRoot` 为目标 worktree，并断言 merge 成功后调用：

```ts
expect(result).toMatchObject({
  merged: true,
  cleanup: { performed: true, reason: null },
});
expect(git.runGitCommand).toHaveBeenCalledWith(primaryRoot, [
  'worktree',
  'remove',
  changeRoot,
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/domains/comet-native/native-workspace-finish-branches.test.ts`

Expected: FAIL because the current merge path returns `cleanup.performed: false` with `post-merge-validation-required` and does not call `worktree remove`.

- [ ] **Step 3: Write minimal implementation**

抽取只在 `plan.isolation === 'worktree'` 且当前进程不在 `changeRoot` 内执行的清理逻辑；merge 成功后调用 `runGitCommand(plan.primaryRoot, ['worktree', 'remove', plan.changeRoot])`，成功后设置 cleanup performed。保留当前工作目录保护和清理失败原因，不使用 `--force`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/domains/comet-native/native-workspace-finish-branches.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add domains/comet-native/native-workspace-finish.ts test/domains/comet-native/native-workspace-finish-branches.test.ts
git commit -m "fix(native): clean merged change worktrees"
```

### Task 2: 过滤 Dashboard 无效 workspace 来源

**Files:**
- Modify: `domains/dashboard/workspace.ts`
- Test: `test/domains/dashboard/workspace.test.ts`

**Interfaces:**
- Consumes: `GitWorktreeEntry.root`, `detached` 和当前 worktree 上下文。
- Produces: `collectDashboardWorkspaceSources()` 仅返回存在的当前目录和有效 branch-backed worktree。

- [ ] **Step 1: Write the failing tests**

新增两个测试：一个创建 detached secondary worktree 并断言不出现在 sources；另一个将 worktree 目录删除后断言不出现在 sources。测试保留现有 branch-backed secondary worktree 断言。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/domains/dashboard/workspace.test.ts`

Expected: FAIL because当前实现会返回所有注册 worktree，包括 detached 和已不存在路径。

- [ ] **Step 3: Write minimal implementation**

在 `workspace.ts` 中加入安全的目录存在性判断，并在构造 roots 前过滤非当前 detached entry 和 `.comet/runtime` 内部路径；当前请求 root 保留。不得调用递归删除或修改 Git 注册表。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/domains/dashboard/workspace.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add domains/dashboard/workspace.ts test/domains/dashboard/workspace.test.ts
git commit -m "fix(dashboard): skip stale worktree sources"
```

### Task 3: 避免失效项目的 Git identity 查询

**Files:**
- Modify: `domains/dashboard/project-directory.ts`, `platform/paths/project-identity.ts`
- Test: `test/domains/dashboard/project-directory.test.ts`

**Interfaces:**
- Consumes: `availabilityOf()` 结果。
- Produces: 可用项目使用 Git 稳定 ID，失效项目使用 `stableProjectId(path)` fallback。

- [ ] **Step 1: Write the failing test**

在项目目录测试中断言 missing 项目仍然返回 `availability: 'missing'`，并且其 ID 等于 `stableProjectId(missingProject)`，而不是依赖 Git remote/common-dir 的结果。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/domains/dashboard/project-directory.test.ts`

Expected: FAIL because当前实现无论项目是否存在都会调用 `resolveStableProjectId()`。

- [ ] **Step 3: Write minimal implementation**

导出已有稳定 ID 生成器或增加明确的 path fallback；项目条目先完成 availability，再按可用性选择 Git identity 或 path identity。保留 missing 项目条目及排序行为。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/domains/dashboard/project-directory.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add domains/dashboard/project-directory.ts platform/paths/project-identity.ts test/domains/dashboard/project-directory.test.ts
git commit -m "perf(dashboard): avoid git lookup for missing projects"
```

### Task 4: 让 Native SQLite 缓存拒绝失效来源

**Files:**
- Modify: `domains/dashboard/native-collector.ts`
- Test: `test/domains/dashboard/native-collector.test.ts`

**Interfaces:**
- Consumes: Task 2 的 workspace source eligibility 规则和现有 `NativeDashboardIndex` source metadata。
- Produces: 缓存包含无效 workspace 时刷新事实来源；刷新后的 SQLite 不再保留该来源。

- [ ] **Step 1: Write the failing test**

构造一个带 stale/internal workspace source 的缓存或来源 fixture，调用 Native page/overview，断言返回结果不包含该 workspace 的 active candidate，并断言事实来源只保留有效 workspace。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/domains/dashboard/native-collector.test.ts`

Expected: FAIL because当前 cached index 直接返回并仅在后台刷新，首个请求仍可能使用 stale source。

- [ ] **Step 3: Write minimal implementation**

增加 cache eligibility 检查：当缓存候选来源是内部、detached secondary 或不存在路径时，不直接使用缓存，调用现有 refresh/reconcile；SQLite 仍是缓存，不改变事实来源和失败回退逻辑。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/domains/dashboard/native-collector.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add domains/dashboard/native-collector.ts test/domains/dashboard/native-collector.test.ts
git commit -m "fix(dashboard): invalidate stale native index sources"
```

### Task 5: 缩短个人记忆 Dashboard 首屏

**Files:**
- Modify: `domains/comet-memory/personal-memory.ts`, `domains/comet-memory/plugin.ts`, `domains/comet-memory/types.ts`
- Test: `test/domains/comet-memory/personal-memory.test.ts`

**Interfaces:**
- Consumes: 现有 `PersonalMemoryServiceLike` 的 status/retrieve/sync 能力。
- Produces: Dashboard page load 不触发远程同步，也不加载页面未使用的 management 数据；显式 sync capability 保持原行为。

- [ ] **Step 1: Write the failing test**

增加 Dashboard page load 测试，使用可观察的 service stub/assertion，断言 page load 调用 status/retrieve，但不调用 manage/sync；另增加 status 调用不触发 repository sync 的回归测试。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/domains/comet-memory/personal-memory.test.ts`

Expected: FAIL because当前 page load 会调用 manage，当前 status 会调用 repository.sync。

- [ ] **Step 3: Write minimal implementation**

从 `status()` 移除 `repository.sync()`，保留 remote 读取和 `sync` 字段的本地可用语义；从 dashboard page load 移除 `invoke('manage')`，只返回 status、retrieve 及页面已有字段。显式 `sync` capability 继续调用 `service.sync()`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/domains/comet-memory/personal-memory.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add domains/comet-memory/personal-memory.ts domains/comet-memory/plugin.ts domains/comet-memory/types.ts test/domains/comet-memory/personal-memory.test.ts
git commit -m "perf(memory): keep dashboard load local and focused"
```

### Task 6: 生成 runtime、运行集成验证并更新 changelog

**Files:**
- Modify: `CHANGELOG.md`（仅当当前版本相对上一个发布基线存在用户可见变化时）
- Generate: `assets/skills/comet/scripts/comet-native-runtime.mjs` 及相关 Native bundle

**Interfaces:**
- Consumes: Tasks 1-5 的源码和测试。
- Produces: 发布资产与源码一致，Dashboard/Native/Memory 相关契约通过。

- [ ] **Step 1: Run focused tests**

Run：

```bash
pnpm exec vitest run test/domains/comet-native/native-workspace-finish-branches.test.ts test/domains/dashboard/workspace.test.ts test/domains/dashboard/project-directory.test.ts test/domains/dashboard/native-collector.test.ts test/domains/comet-memory/personal-memory.test.ts
```

- [ ] **Step 2: Build affected runtime/assets**

Run：

```bash
pnpm build:native-runtime
```

- [ ] **Step 3: Run format, lint and affected asset contracts**

Run：

```bash
pnpm format:check
pnpm lint
pnpm exec vitest run test/repository/native-runtime-assets.test.ts test/domains/comet-classic/comet-scripts.test.ts
```

- [ ] **Step 4: Measure the local Dashboard paths**

确认以下行为：失效项目不再触发 Git identity 查询，Native 来源不包含 detached/internal worktree，个人记忆 page load 不调用 sync/manage。记录 projects、overview、native page 和 memory page 的耗时。

- [ ] **Step 5: Update changelog only for user-visible release delta**

根据 `package.json`、`origin/master` 和上一个 tag 的实际差异，必要时在当前版本条目追加用户可见的性能和 worktree cleanup 描述，不记录开发过程。

- [ ] **Step 6: Final verification**

运行 `git status --short`、相关全量测试或 CI 已覆盖的检查，并确认只包含本功能文件和生成物。
