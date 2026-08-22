# Project Knowledge External Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将尚未发布的 Project Knowledge Unit 文件模型替换为项目外、可自动维护的 Project Knowledge Record，并让 Local 与 Remote Provider 通过同一套 `status/query/apply` 接口支持查询、自动学习、纠正、忘记、刷新和 Dashboard 管理。

**Architecture:** `comet.project-knowledge` 仍是独立的 project-scope 第一方插件；领域层只依赖小型 Provider 接口。Local Provider 使用用户数据目录中按稳定仓库 ID 隔离的 SQLite 作为权威状态，并按 workspace ID 隔离当前源码/文档索引；Remote Provider 使用 `comet.project-knowledge.provider.v1` 的 `status/query/apply` 协议且不回退 Local。CLI、Dashboard、自动学习和上下文注入都调用 Provider，不直接读写 SQLite 或 Remote HTTP。Personal Memory 保持独立，不再向 Project Knowledge 共享个人项目偏好。

**Tech Stack:** TypeScript、Node.js `node:sqlite`/FTS5、Comet Plugin Runtime、Commander、React 19、Ant Design 6、Vitest、Playwright、Comet Native。

## Global Constraints

- 在 `040rc1` 上新开并完成 Native change `project-knowledge-external-provider`；不修改任何已归档 change。
- 功能未上线：直接删除 `ProjectKnowledgeUnit`、`docs/comet/knowledge/units/`、`maintained/generated`、`share-memory` 和 `knowledge units/share`，不增加迁移、兼容读取、别名或导出路径。
- Local 是当前用户的默认 Provider；Remote 是可选团队 Provider。两者严格二选一，不双写、不自动同步，Remote 失败不回退 Local。
- 同一仓库的主工作区和 worktree 共享 Project Knowledge Record；源码与 Markdown section 索引仍按 workspace 隔离，避免不同分支正文串线。
- 成功验证且来源当前有效的自动记录直接 `active`；来源变化后变为 `needs-review` 并停止注入；用户纠正后的正文不得被自动学习覆盖。
- Dashboard 是可选管理入口，不是自动学习或激活的前置条件；CLI、Dashboard 和工作流必须看到同一份 Provider 状态。
- Personal Memory 的 User Profile、任务匹配记忆、项目个人记忆、Provider 配置和 `<personal_memory>` 注入不得改变；只移除“把个人记忆共享成项目知识”的未发布旁路。
- 保留 `<project_knowledge>`、Top-4、每条 1,600 字符、总计 5,000 字符以及来源引用边界。
- 不引入后台服务、双写队列、能力协商、Provider marketplace、embedding、向量数据库或通用图数据库。
- 每个任务先运行最小相关测试；最终运行格式、lint、build、全量 Vitest、Dashboard 浏览器测试和 Project Knowledge eval。Archive 前至少完成一次独立代码审查。
- `CHANGELOG.md` 只重写现有 `0.4.0-rc.1` 下相对 `0.4.0-beta.19` 的最终用户可见行为，不记录开发中间修复、内部重命名或普通测试。

---

### Task 1: 开启 Native change 并固化已确认范围

**Files:**

- Create through Runtime: `docs/comet/changes/project-knowledge-external-provider/brief.md`
- Create through Runtime: `docs/comet/changes/project-knowledge-external-provider/specs/project-knowledge/spec.md`
- Create through Runtime: `docs/comet/changes/project-knowledge-external-provider/tasks.md`
- Read only: `docs/superpowers/specs/2026-08-22-project-knowledge-external-provider-design.md`
- Read only: `docs/comet/archive/2026-08-22-agent-project-knowledge-engine/`

**Interfaces:**

- Consumes: 已确认设计、当前 `040rc1` 提交和 Native Runtime。
- Produces: 当前工作区中激活的 Native change；A1–A13 验收项与设计文档逐项对应。

- [ ] **Step 1: 核对执行基线。**

  ```powershell
  git status --short --branch
  git log -1 --oneline
  pnpm exec comet native status --json
  ```

  Expected: 当前分支为 `040rc1`，工作区只包含计划允许的变更，不存在需要恢复的同名 active change。

- [ ] **Step 2: 在当前分支开启中文 Native change。**

  ```powershell
  pnpm exec comet native new project-knowledge-external-provider --language zh-CN --isolation current --target-branch 040rc1 --json
  ```

  Expected: Runtime 选择 `project-knowledge-external-provider`，不创建额外 worktree，也不修改已归档 change。

- [ ] **Step 3: 将设计验收写入 change spec。**

  Spec 使用 A1–A13：项目外权威存储、Local/Remote 二选一、同仓库 worktree 共享、自动 active、来源失效、用户纠正优先、Provider 一致接口、CLI/Dashboard 同状态、Remote 不回退、独立上下文、Personal Memory 不变、旧 Unit 路径完全删除、Provider 可由 Dashboard 配置。

- [ ] **Step 4: 让 Runtime 检查 Shape。**

  ```powershell
  pnpm exec comet native check project-knowledge-external-provider --json
  ```

  Expected: 没有缺失的必需 artifact，continuation 指向 Build。

- [ ] **Step 5: 提交 Native Shape。**

  ```powershell
  git add docs/comet/changes/project-knowledge-external-provider
  git commit -m "chore(native): open external project knowledge change"
  ```

### Task 2: 定义 Record 模型与统一 Provider 接口

**Files:**

- Create: `domains/project-knowledge/records.ts`
- Modify: `domains/project-knowledge/types.ts`
- Modify: `domains/project-knowledge/index.ts`
- Create: `test/domains/project-knowledge/project-knowledge-records.test.ts`

**Interfaces:**

- Consumes: 现有 `ProjectKnowledgeQuery`、来源引用、关系类型和诊断模型。
- Produces: `ProjectKnowledgeRecord`、`ProjectKnowledgeQueryRequest/Result`、`ProjectKnowledgeMutation/ApplyResult`、`ProjectKnowledgeStatus` 和新的 `ProjectKnowledgeProvider`。

- [ ] **Step 1: 先写 Record 解析和权威优先级失败测试。**

  覆盖：合法 `active/needs-review/retired`、合法 `automatic/user`、有界来源、拒绝空结论、用户记录不能由 automatic upsert 覆盖正文。

  ```ts
  expect(parseProjectKnowledgeRecord(record)).toEqual(record);
  expect(() => parseProjectKnowledgeRecord({ ...record, state: 'draft' })).toThrow();
  expect(mergeProjectKnowledgeRecord(userRecord, automaticRecord)).toMatchObject({
    authority: 'user',
    summary: userRecord.summary,
    conclusions: userRecord.conclusions,
  });
  ```

- [ ] **Step 2: 运行测试并确认红灯。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-records.test.ts
  ```

  Expected: FAIL，因为 Record 模块和新 Provider 类型尚不存在。

- [ ] **Step 3: 实现最小 Record 结构。**

  ```ts
  export interface ProjectKnowledgeRecord {
    readonly id: string;
    readonly projectId: string;
    readonly type: ProjectKnowledgeRecordType;
    readonly state: 'active' | 'needs-review' | 'retired';
    readonly authority: 'automatic' | 'user';
    readonly title: string;
    readonly summary: string;
    readonly applicablePaths: readonly string[];
    readonly operations: readonly string[];
    readonly conclusions: readonly ProjectKnowledgeConclusion[];
    readonly relations: readonly ProjectKnowledgeRelation[];
    readonly verification: readonly ProjectKnowledgeVerification[];
    readonly sourceVersions: readonly ProjectKnowledgeSourceVersion[];
    readonly updatedAt: string;
  }
  ```

  保留现有六种业务类型和八种一跳关系，但用户可见名称统一为“记录”；删除 `schema/origin/draft` 语义。

- [ ] **Step 4: 将 Provider 改成三个方法。**

  ```ts
  export interface ProjectKnowledgeProvider {
    status(): Promise<ProjectKnowledgeStatus>;
    query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult>;
    apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult>;
  }
  ```

  `ProjectKnowledgeQueryRequest` 是 `search | list | get` 判别联合；`ProjectKnowledgeMutation` 是 `upsert | correct | retire | refresh` 判别联合。`correct` 接受 `id + text`，将正文权威设为 `user`；`refresh` 可带 `id`，无 `id` 时刷新当前项目。

- [ ] **Step 5: 实现解析、合并和一跳关系函数并导出。**

  解析器只做当前产品需要的字符串、数量、来源和枚举边界；不引入版本协商或旧 Unit schema 解析。

- [ ] **Step 6: 运行测试和格式检查。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-records.test.ts
  pnpm exec prettier --check domains/project-knowledge/records.ts domains/project-knowledge/types.ts domains/project-knowledge/index.ts test/domains/project-knowledge/project-knowledge-records.test.ts
  ```

  Expected: PASS。

- [ ] **Step 7: 提交领域契约。**

  ```powershell
  git add domains/project-knowledge/records.ts domains/project-knowledge/types.ts domains/project-knowledge/index.ts test/domains/project-knowledge/project-knowledge-records.test.ts
  git commit -m "refactor(project-knowledge): define record provider contract"
  ```

### Task 3: 把 Local SQLite 升级为仓库级权威存储

**Files:**

- Create: `platform/paths/project-knowledge-storage.ts`
- Delete: `platform/paths/project-knowledge-cache.ts`
- Create: `domains/project-knowledge/local-store.ts`
- Delete after consumers migrate: `domains/project-knowledge/index-store.ts`
- Modify: `test/platform/project-knowledge-cache.test.ts` (rename to `test/platform/project-knowledge-storage.test.ts`)
- Modify: `test/domains/project-knowledge/project-knowledge-index.test.ts`
- Create: `test/domains/project-knowledge/project-knowledge-store.test.ts`

**Interfaces:**

- Consumes: `resolveStableProjectId(root)`、workspace identity、`ProjectKnowledgeRecord` 和现有 section parser/FTS 查询。
- Produces: `resolveProjectKnowledgeStorageLocation()` 与深模块 `ProjectKnowledgeLocalStore`，统一封装 record 权威状态和 workspace section 投影。

- [ ] **Step 1: 写身份与持久化失败测试。**

  ```ts
  expect(linked.repositoryId).toBe(primary.repositoryId);
  expect(linked.databasePath).toBe(primary.databasePath);
  expect(linked.workspaceId).not.toBe(primary.workspaceId);
  ```

  Store 测试覆盖：新进程可读回、active/needs-review/retired 过滤、用户纠正、retire tombstone、相同来源版本不能自动复活、来源版本变化后允许新 automatic 记录。

- [ ] **Step 2: 运行测试并确认红灯。**

  ```powershell
  npx vitest run test/platform/project-knowledge-storage.test.ts test/domains/project-knowledge/project-knowledge-store.test.ts test/domains/project-knowledge/project-knowledge-index.test.ts
  ```

  Expected: FAIL，因为当前数据库路径按 workspace 分文件，且只保存读模型。

- [ ] **Step 3: 改为仓库级数据库路径。**

  ```text
  <user-data>/Comet/project-knowledge/<repositoryId>/knowledge.sqlite
  ```

  `repositoryId` 决定权威记录空间，`workspaceId` 作为 section/source 表的分区键；不把数据库或 sidecar 文件写进项目目录。

- [ ] **Step 4: 建立最小 SQLite schema。**

  ```sql
  CREATE TABLE pk_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    authority TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    applicable_paths_json TEXT NOT NULL,
    operations_json TEXT NOT NULL,
    conclusions_json TEXT NOT NULL,
    relations_json TEXT NOT NULL,
    verification_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pk_record_sources (
    record_id TEXT NOT NULL REFERENCES pk_records(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    anchor TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (record_id, source, anchor)
  );
  ```

  为 record 可检索文本建立一个 FTS5 表；现有 `pk_sources/pk_sections/pk_fts_*` 增加 `workspace_id` 并在同步、删除和查询时强制过滤当前 workspace。功能未上线，结构不兼容时直接重建，不写迁移器。

- [ ] **Step 5: 实现 Store 的窄接口。**

  ```ts
  status(): ProjectKnowledgeStatus;
  list(options): readonly ProjectKnowledgeRecord[];
  read(id): ProjectKnowledgeRecord | null;
  searchRecords(query): readonly ProjectKnowledgeResult[];
  apply(mutation): Promise<ProjectKnowledgeApplyResult>;
  syncCorpus(corpus): Promise<ProjectKnowledgeIndexSyncResult>;
  searchSections(query): readonly ProjectKnowledgeResult[];
  rebuildWorkspace(corpus): Promise<ProjectKnowledgeStatus>;
  ```

  每个写操作使用短事务；`correct` 保留来源并替换 summary/主结论、设置 `authority=user`，同时重新核对并捕获当前来源，来源仍无效时保持 `needs-review`；`retire` 保留 source fingerprint 作为防止旧来源自动复活的 tombstone。

- [ ] **Step 6: 迁移现有 section/FTS 行为并删除旧 Store。**

  保留现有有界读取、增量 source delta、FTS terms/trigram、WAL、busy timeout 和损坏隔离；损坏恢复只重建可派生的 workspace section/FTS 表，不删除可读的 `pk_records`。

- [ ] **Step 7: 运行 focused tests。**

  ```powershell
  npx vitest run test/platform/project-knowledge-storage.test.ts test/domains/project-knowledge/project-knowledge-store.test.ts test/domains/project-knowledge/project-knowledge-index.test.ts
  ```

  Expected: PASS，包括同仓库 worktree 共享 records、workspace section 不串线和重启持久化。

- [ ] **Step 8: 提交 Local 存储。**

  ```powershell
  git add platform/paths/project-knowledge-storage.ts platform/paths/project-knowledge-cache.ts domains/project-knowledge/local-store.ts domains/project-knowledge/index-store.ts test/platform/project-knowledge-storage.test.ts test/platform/project-knowledge-cache.test.ts test/domains/project-knowledge/project-knowledge-store.test.ts test/domains/project-knowledge/project-knowledge-index.test.ts
  git commit -m "feat(project-knowledge): store records outside projects"
  ```

### Task 4: 让 Local Provider 完整实现 status/query/apply

**Files:**

- Modify: `domains/project-knowledge/local-provider.ts`
- Modify: `domains/project-knowledge/renderer.ts`
- Modify: `test/domains/project-knowledge/project-knowledge.test.ts`
- Modify: `test/domains/project-knowledge/project-knowledge-retrieval-eval.test.ts`

**Interfaces:**

- Consumes: `ProjectKnowledgeLocalStore`、当前 corpus、query planner、ripgrep fallback 和新 Provider contract。
- Produces: Local `status/query/apply`，只注入来源当前有效的 active records，并继续融合当前文档 section。

- [ ] **Step 1: 写 Provider 行为失败测试。**

  覆盖：`status` 计数；`query(search)` 融合 records + sections；`query(list/get)` 返回管理记录；`apply(correct/retire/refresh)`；`needs-review/retired` 不返回；来源变化后当前请求立即停止注入并持久化 `needs-review`。

- [ ] **Step 2: 运行 focused test 并确认红灯。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: FAIL，因为 Local 仍只有 `retrieve()` 并依赖 Unit repository。

- [ ] **Step 3: 用一个 Provider 贯穿三类 query。**
  - `search`: 同步当前 workspace corpus，搜索 active records、FTS section 和必要的有界 rg，RRF 融合后一跳扩展。
  - `list`: 按 `active | needs-review | retired | all` 返回有界记录列表。
  - `get`: 按 ID 返回单条记录，不改变状态。

  `ProjectKnowledgeQueryResult` 同时返回 `results`、`records` 和有界 `diagnostics`，调用方不再访问 Store。

- [ ] **Step 4: 在返回前核对来源。**

  自动记录来源缺失、fingerprint 变化或 anchor 消失时调用 Store 标记 `needs-review`，本次不注入。用户记录同样停止注入，但只更新状态，不覆盖其正文。

- [ ] **Step 5: 实现 apply。**

  `upsert` 只接受当前项目、当前来源且验证通过的记录；`correct/retire` 作用于现有记录；`refresh` 重新运行确定性提取和来源核对，并在无 ID 时重建当前 workspace section 投影。

- [ ] **Step 6: 保持 renderer 边界。**

  将 `result.unit` 改成 `result.record`，继续输出 `unit:<id>` 以外的新稳定来源形式 `record:<id>`；保留 Top-4/1600/5000、不同来源去重和 `<project_knowledge>` 文案。

- [ ] **Step 7: 运行 focused tests 和 Retrieval Eval。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge.test.ts test/domains/project-knowledge/project-knowledge-index.test.ts test/domains/project-knowledge/project-knowledge-retrieval-eval.test.ts
  pnpm build
  node scripts/benchmark/project-knowledge-retrieval-eval.mjs --enforce --summary
  ```

  Expected: PASS；固定数据集不降低现有 Recall@4、nDCG@4、错误来源注入和 abstain 指标。

- [ ] **Step 8: 提交 Local Provider。**

  ```powershell
  git add domains/project-knowledge/local-provider.ts domains/project-knowledge/renderer.ts test/domains/project-knowledge/project-knowledge.test.ts test/domains/project-knowledge/project-knowledge-retrieval-eval.test.ts
  git commit -m "feat(project-knowledge): add local provider management"
  ```

### Task 5: 把自动提取和学习改成验证后直接 active

**Files:**

- Modify: `domains/project-knowledge/deterministic-extractors.ts`
- Modify: `domains/project-knowledge/learning.ts`
- Modify: `domains/project-knowledge/plugin.ts`
- Modify: `test/domains/project-knowledge/project-knowledge-learning.test.ts`
- Modify: `test/domains/project-knowledge/project-knowledge.test.ts`

**Interfaces:**

- Consumes: Plugin lifecycle events、确定性提取器、可选语义 reviewer 和 Provider `apply(upsert|retire)`。
- Produces: 不依赖 Dashboard 的自动学习；成功验证且来源有效的 automatic record 直接 active。

- [ ] **Step 1: 写学习失败测试。**

  覆盖：无 semantic reviewer 也会运行确定性学习；每个 verification result 都成功才写入；写入后下一次 query 可见；来源评审期间变化则不写；automatic 更新不覆盖 user record；相同已 forget 内容不会靠旧 fingerprint 复活。

- [ ] **Step 2: 运行学习测试并确认红灯。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-learning.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: FAIL，因为当前学习写 draft Unit，且只有配置 reviewer 时才触发。

- [ ] **Step 3: 让提取器输出 Record 候选。**

  将 `extractDeterministicProjectUnits()` 重命名为 `extractDeterministicProjectRecords()`；project-map、module-overview、build-test 直接形成 `authority=automatic` 候选，稳定 ID 和来源 fingerprint 继续确定性生成。

- [ ] **Step 4: 收敛 learning service。**

  `ProjectKnowledgeLearningService` 接收 `provider` 而不是 repository。它在成功结构化检查点中合并确定性候选和可选 reviewer 动作，复核 packet source 后逐条调用 `provider.apply()`；不保存 transcript、完整 diff、命令输出或日志。

- [ ] **Step 5: 修正插件事件路径。**

  `verification.completed/change.completed/task.completed` 总是执行有界学习；semantic reviewer 仍是可选输入。失败只记录诊断，不改变原记录，也不阻断 workflow。完成后清除 provider/query 缓存，使下一次上下文看到新记录。

- [ ] **Step 6: 删除个人记忆共享转换。**

  从 `learning.ts` 删除 `ProjectKnowledgeSharedPreference` 和 `sanitizeProjectPreferenceForSharing()`；Project Knowledge 不再接收 Personal Memory 数据。

- [ ] **Step 7: 运行学习、插件与 Agent A/B 汇总测试。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-learning.test.ts test/domains/project-knowledge/project-knowledge.test.ts test/domains/project-knowledge/project-knowledge-agent-ab.test.ts
  ```

  Expected: PASS；Dashboard 从未加载的测试中也能学习并在后续 query 召回。

- [ ] **Step 8: 提交自动学习。**

  ```powershell
  git add domains/project-knowledge/deterministic-extractors.ts domains/project-knowledge/learning.ts domains/project-knowledge/plugin.ts test/domains/project-knowledge/project-knowledge-learning.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  git commit -m "feat(project-knowledge): activate verified learning automatically"
  ```

### Task 6: 实现 Remote Project Knowledge Provider v1

**Files:**

- Modify: `domains/project-knowledge/remote-provider.ts`
- Create: `test/domains/project-knowledge/project-knowledge-provider-contract.test.ts`
- Modify: `test/domains/project-knowledge/project-knowledge.test.ts`

**Interfaces:**

- Consumes: `WorkflowKnowledgeRemoteConfig`、稳定 project ID、新 Provider contract 和注入的 `fetch`。
- Produces: `comet.project-knowledge.provider.v1` 的 `status/query/apply` 客户端，以及 Local/Remote 共用行为测试。

- [ ] **Step 1: 写 Remote 协议失败测试。**

  断言三个 operation 都发送：

  ```json
  {
    "schema": "comet.project-knowledge.provider.v1",
    "operation": "status | query | apply",
    "scope": "team-a",
    "projectId": "stable-project-id",
    "input": {}
  }
  ```

  覆盖 token 环境变量、timeout、响应大小、Record 解析、Remote 失败空结果/诊断、不实例化 Local Provider。

- [ ] **Step 2: 运行测试并确认红灯。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-provider-contract.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  ```

  Expected: FAIL，因为 Remote 仍使用 Retrieval API v1 且只有 retrieve。

- [ ] **Step 3: 实现统一 operation envelope。**

  `status/query/apply` POST 到同一 endpoint。query 只发送有界 task/path/phase/operation/limit 或管理查询字段；apply 只发送记录结论、来源引用、适用范围和验证结果，不发送完整源码、对话、diff 或日志。

- [ ] **Step 4: 添加 Local/Remote 一致性用例。**

  以 Provider factory 分别运行：status 返回 project/provider；upsert 后 search/list/get 可见；correct 设置 user authority；retire 后 search 不可见；refresh 返回稳定结果。Remote 用内存协议 fake，不复制实现逻辑。

- [ ] **Step 5: 运行协议和格式检查。**

  ```powershell
  npx vitest run test/domains/project-knowledge/project-knowledge-provider-contract.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  pnpm exec prettier --check domains/project-knowledge/remote-provider.ts test/domains/project-knowledge/project-knowledge-provider-contract.test.ts
  ```

  Expected: PASS。

- [ ] **Step 6: 提交 Remote Provider。**

  ```powershell
  git add domains/project-knowledge/remote-provider.ts test/domains/project-knowledge/project-knowledge-provider-contract.test.ts test/domains/project-knowledge/project-knowledge.test.ts
  git commit -m "feat(project-knowledge): add remote provider protocol"
  ```

### Task 7: 将插件桥接和 CLI 迁移到 Provider 管理面

**Files:**

- Modify: `domains/project-knowledge/plugin.ts`
- Modify: `domains/comet-plugin/integration.ts`
- Modify: `app/commands/project-knowledge.ts`
- Modify: `app/cli/index.ts`
- Modify: `test/domains/comet-plugin/plugin-integration.test.ts`
- Modify: `test/app/project-knowledge-command.test.ts`
- Modify: `test/domains/comet-entry/plugin-context.test.ts`

**Interfaces:**

- Consumes: Provider `status/query/apply` 和 Plugin Runtime invoke/context/event 边界。
- Produces: 插件能力 `status/list/get/query/correct/forget/refresh` 与最终 `comet knowledge` 命令；删除 `units/share-memory/shareProjectPreference`。

- [ ] **Step 1: 写 CLI 和桥接失败测试。**

  测试以下命令和 JSON 输出：

  ```text
  comet knowledge list [path] [--state active|needs-review|retired|all]
  comet knowledge get [path] --id <id>
  comet knowledge correct [path] --id <id> --text <text>
  comet knowledge forget [path] --id <id>
  comet knowledge query [path] --task <task>
  comet knowledge rebuild [path]
  comet knowledge status [path]
  ```

  同时断言 help 中不存在 `knowledge units`、`share`，Bridge 不再导出 `shareProjectPreference()`。

- [ ] **Step 2: 运行 focused tests 并确认红灯。**

  ```powershell
  npx vitest run test/app/project-knowledge-command.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-entry/plugin-context.test.ts
  ```

  Expected: FAIL，因为 CLI 和插件仍绕过 Provider 访问 Unit repository。

- [ ] **Step 3: 建立单一 Provider factory。**

  在 `domains/project-knowledge/plugin.ts` 内按当前配置建立 Local 或 Remote；CLI 使用导出的同一 factory。不得在命令中直接创建 Store 或执行 fetch。

- [ ] **Step 4: 替换插件 capability。**

  `status/list/get/query/correct/forget/refresh` 只做输入校验和 Provider 调用；Dashboard snapshot 由 `status + list` 组合。`provideContext` 使用 `provider.query({ operation: 'search', query })`，失败返回 null 并保留有界诊断。

- [ ] **Step 5: 替换 CLI wiring。**

  `rebuild` 映射到 `apply({ operation: 'refresh' })`；`forget` 映射到 `retire`；写操作由显式命令触发，不再要求 `--confirm`，也不产生项目文件。

- [ ] **Step 6: 删除 Personal Memory 共享旁路。**

  删除 Bridge 的 `shareProjectPreference()` 和相关转换/测试；确认 Personal Memory 的 global/project 查询、纠正、忘记、Provider 和 Dashboard 测试保持不变。

- [ ] **Step 7: 运行 focused tests。**

  ```powershell
  npx vitest run test/app/project-knowledge-command.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-entry/plugin-context.test.ts test/domains/comet-memory
  ```

  Expected: PASS；`<personal_memory>` 与 `<project_knowledge>` 仍是独立贡献。

- [ ] **Step 8: 提交插件和 CLI。**

  ```powershell
  git add domains/project-knowledge/plugin.ts domains/comet-plugin/integration.ts app/commands/project-knowledge.ts app/cli/index.ts test/domains/comet-plugin/plugin-integration.test.ts test/app/project-knowledge-command.test.ts test/domains/comet-entry/plugin-context.test.ts
  git commit -m "feat(project-knowledge): expose provider management commands"
  ```

### Task 8: 让 Dashboard 配置 Provider 并管理记录

**Files:**

- Modify: `domains/project-knowledge/types.ts`
- Modify: `domains/project-knowledge/dashboard.ts`
- Modify: `domains/project-knowledge/plugin.ts`
- Modify: `domains/comet-plugin/integration.ts`
- Modify: `domains/dashboard/default-plugin-host.ts`
- Modify: `domains/dashboard/web/src/main.jsx`
- Modify: `domains/dashboard/web/src/styles.css`
- Modify: `test/domains/dashboard/default-plugin-host.test.ts`
- Modify: `test/domains/dashboard/web-source.test.ts`
- Modify: `test/domains/dashboard/dashboard-browser.spec.ts`
- Modify: `test/domains/workflow-contract/workflow-contract.test.ts`

**Interfaces:**

- Consumes: `ProjectKnowledgeDashboardSnapshot`、插件 invoke、`writeWorkflowProjectConfig()` 和 Ant Design 表单/列表组件。
- Produces: 可选 Dashboard 管理页：Provider 配置、状态、记录列表、查询预览、纠正、忘记、重新核对和诊断。

- [ ] **Step 1: 写 Dashboard contract 和浏览器失败测试。**

  覆盖 Local/Remote 切换；Remote endpoint/token env/scope/timeout 保存到 `.comet/config.yaml`；页面不显示 token 值；active/needs-review/retired 过滤；query preview；correct/forget/refresh capability；没有打开 Dashboard 时学习测试仍通过。

- [ ] **Step 2: 运行 focused tests 并确认红灯。**

  ```powershell
  npx vitest run test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/web-source.test.ts test/domains/workflow-contract/workflow-contract.test.ts
  pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep "Project Knowledge"
  ```

  Expected: FAIL，因为当前页面只读且仍展示 Unit 统计。

- [ ] **Step 3: 增加显式配置回调。**

  `ProjectKnowledgePluginOptions` 增加 `updateKnowledgeConfig(config)`；默认 Bridge 使用 `readWorkflowProjectConfig()` + `writeWorkflowProjectConfig()` 原子更新当前项目的 `knowledge` 块并保留其他配置。插件成功写入后更新内存配置并丢弃旧 Provider；测试注入 fake callback，领域层不直接写文件。

- [ ] **Step 4: 扩展 Dashboard snapshot。**

  Snapshot 返回：sanitized provider 配置、Provider status、三种状态计数、有界 records、最近 query/update diagnostics。删除 `unitCount/draftUnitCount/relationCount/units/changedHints` 等旧展示字段。

- [ ] **Step 5: 实现 AntD 管理界面。**

  复用现有 Dashboard 紧凑样式，使用 `Select/Input/InputNumber/Button/List/Tag/Modal`：
  - Provider 设置：Local/Remote；Remote 显示 endpoint、token 环境变量名、scope、timeout，不接收或显示 token 值。
  - 记录：按 active/needs-review/retired 切换，展示标题、摘要、适用路径、来源和更新时间。
  - 操作：查询预览、纠正、忘记、重新核对。
  - 状态：Provider 可用性、最近诊断以及现有 pause/resume/uninstall。

- [ ] **Step 6: 确保所有按钮调用插件 capability。**

  UI 不直接访问 SQLite、文件系统或 Remote endpoint；每次写操作成功后重新加载当前插件页。关闭 Dashboard 不影响 Provider event/query。

- [ ] **Step 7: 运行 Dashboard 测试和构建。**

  ```powershell
  npx vitest run test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/web-source.test.ts test/domains/workflow-contract/workflow-contract.test.ts
  pnpm run build:dashboard
  pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep "Project Knowledge"
  ```

  Expected: PASS；浏览器中 Provider 配置、列表、查询、纠正、忘记和刷新均可正常使用。

- [ ] **Step 8: 提交 Dashboard。**

  ```powershell
  git add domains/project-knowledge/types.ts domains/project-knowledge/dashboard.ts domains/project-knowledge/plugin.ts domains/comet-plugin/integration.ts domains/dashboard/default-plugin-host.ts domains/dashboard/web/src/main.jsx domains/dashboard/web/src/styles.css test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/web-source.test.ts test/domains/dashboard/dashboard-browser.spec.ts test/domains/workflow-contract/workflow-contract.test.ts
  git commit -m "feat(dashboard): manage project knowledge providers"
  ```

### Task 9: 删除 Unit 文件产品路径并同步文档与 Changelog

**Files:**

- Delete: `domains/project-knowledge/units.ts`
- Delete: `test/domains/project-knowledge/project-knowledge-units.test.ts`
- Modify: `domains/project-knowledge/index.ts`
- Modify: `scripts/benchmark/project-knowledge-retrieval-eval.mjs`
- Modify: `docs/operations/PROJECT-KNOWLEDGE-ZH.md`
- Modify: `docs/operations/PROJECT-KNOWLEDGE.md`
- Modify through Native spec projection: `docs/comet/specs/project-knowledge/spec.md`
- Modify: `CHANGELOG.md`
- Modify if exports/layout changed: `config/repository-layout.json`

**Interfaces:**

- Consumes: 已完成的 Provider 行为、CLI help 和 Dashboard UI。
- Produces: 不含旧 Unit 产品路径的中英文用户文档、正式 Project Knowledge spec 和 `0.4.0-rc.1` 发布说明。

- [ ] **Step 1: 先扫描所有活跃旧术语。**

  ```powershell
  rg -n "ProjectKnowledgeUnit|project-knowledge\.unit|knowledge/units|share-memory|knowledge units|maintained|generated" app domains platform test scripts docs/operations docs/comet/specs CHANGELOG.md
  ```

  Expected: 只列出本任务将删除或重写的活跃引用；历史 archive、research 和已确认设计不作为产品兼容入口。

- [ ] **Step 2: 删除 Unit 文件实现和测试。**

  删除 Markdown parser/renderer/repository、`allowLegacyCacheRead`、share/retire 文件写入以及旧导出。不要保留空壳 alias 或兼容 helper。

- [ ] **Step 3: 先更新中文操作文档。**

  中文文档说明：Local 个人默认、Remote 团队可选、记录自动形成、来源失效、用户纠正优先、CLI、Dashboard Provider 配置、项目中不会生成 Project Knowledge 文件，以及 Personal Memory 的独立边界。

- [ ] **Step 4: 同步英文操作文档。**

  英文语义逐项对应中文，不新增中文未确认能力。

- [ ] **Step 5: 更新 Native change spec 并投影正式 spec。**

  正式 spec 删除 Unit/共享 Markdown/draft/maintained/generated/Remote Retrieval API v1，替换为 Record、项目外 SQLite、Provider v1、自动 active、用户优先和可写 Dashboard。

- [ ] **Step 6: 从发布视角重写 rc1 Changelog。**

  ```powershell
  git log 0.4.0-beta.19..HEAD --oneline
  git diff 0.4.0-beta.19..HEAD -- CHANGELOG.md package.json
  ```

  在现有 `0.4.0-rc.1` 中把 Project Knowledge 候选压缩成最终用户可见行为：项目外 Local/Remote Provider、验证后自动形成、CLI/Dashboard 管理、来源失效停止注入。删除 Unit、share、内部可靠性修复和开发过程描述；版本仍为 `0.4.0-rc.1`。

- [ ] **Step 7: 运行文档、契约和无残留检查。**

  ```powershell
  pnpm exec prettier --check docs/operations/PROJECT-KNOWLEDGE-ZH.md docs/operations/PROJECT-KNOWLEDGE.md docs/comet/specs/project-knowledge/spec.md CHANGELOG.md
  npx vitest run test/repository test/app/project-knowledge-command.test.ts test/domains/project-knowledge
  rg -n "ProjectKnowledgeUnit|project-knowledge\.unit|knowledge/units|share-memory|knowledge units" app domains platform test scripts docs/operations docs/comet/specs CHANGELOG.md
  ```

  Expected: Prettier/tests PASS；最后一次 rg 无输出。

- [ ] **Step 8: 提交清理与发布文案。**

  ```powershell
  git add domains/project-knowledge test/domains/project-knowledge scripts/benchmark/project-knowledge-retrieval-eval.mjs docs/operations/PROJECT-KNOWLEDGE-ZH.md docs/operations/PROJECT-KNOWLEDGE.md docs/comet/specs/project-knowledge/spec.md CHANGELOG.md config/repository-layout.json
  git commit -m "docs: finalize external project knowledge behavior"
  ```

### Task 10: 全量验证、独立审查与 Native Archive

**Files:**

- Modify as required by verified findings: only files already in Tasks 2–9
- Update through Runtime: `docs/comet/changes/project-knowledge-external-provider/verification.md`
- Update through Runtime: Native runtime state under `.comet/runtime/`

**Interfaces:**

- Consumes: 完整实现、A1–A13、固定 eval、Dashboard browser coverage 和代码审查结果。
- Produces: 可复现验证证据、无未解决 P0/P1/P2 的 review、archive-ready Native change。

- [ ] **Step 1: 运行格式、lint 和 build。**

  ```powershell
  pnpm format:check
  pnpm lint
  pnpm build
  ```

  Expected: 全部 PASS；生成资产与源码一致。

- [ ] **Step 2: 运行全量测试和产品级浏览器验证。**

  ```powershell
  pnpm test
  pnpm run test:dashboard-e2e
  node scripts/benchmark/project-knowledge-retrieval-eval.mjs --enforce --summary
  ```

  Expected: 全部 PASS；如全量测试存在与本 change 无关的基线失败，记录原始命令、失败文件和证据，不重复盲跑。

- [ ] **Step 3: 手工验证项目外存储边界。**

  在临时仓库和 linked worktree 中执行 `status/query/correct/forget/rebuild`，确认共享 repository record、隔离 workspace section，并运行：

  ```powershell
  git status --short
  Get-ChildItem -Recurse docs/comet/knowledge -ErrorAction SilentlyContinue
  ```

  Expected: 命令不会创建 `docs/comet/knowledge/units/` 或其他 Project Knowledge 数据文件，只有预期源码/文档改动。

- [ ] **Step 4: 使用 code-review Skill 做独立审查。**

  固定比较基线为 Task 1 的 Shape commit，检查 Standards 与 Correctness，重点审查：Provider 是否被绕过、用户纠正是否可能被覆盖、Remote 是否回退 Local、来源失效是否仍注入、Dashboard 是否泄露 token、Personal Memory 是否被误改。

- [ ] **Step 5: 对每条有效 finding 回到 Build。**

  先增加可复现测试，再做最小修复、运行相关测试并提交：

  ```powershell
  git commit -m "fix(project-knowledge): address provider review findings"
  ```

  如果没有 finding，不创建空提交；review 结论仍写入 Native verification evidence。

- [ ] **Step 6: 运行最终差异与残留检查。**

  ```powershell
  git status --short --branch
  git diff --check
  git log --oneline --decorate 0.4.0-beta.19..HEAD
  rg -n "ProjectKnowledgeUnit|project-knowledge\.unit|knowledge/units|share-memory|knowledge units" app domains platform test scripts docs/operations docs/comet/specs CHANGELOG.md
  pnpm exec comet native check project-knowledge-external-provider --json
  ```

  Expected: 工作区干净、diff 无空白错误、旧产品路径无输出、Native 进入 archive-ready。

- [ ] **Step 7: 预演并执行 Archive。**

  ```powershell
  pnpm exec comet native archive project-knowledge-external-provider --dry-run --json
  pnpm exec comet native archive project-knowledge-external-provider --confirmed --json
  ```

  Expected: dry-run 显示验收和 verification 齐全；Archive 完成并将最终 spec 投影到 `docs/comet/specs/project-knowledge/spec.md`。

- [ ] **Step 8: 提交 Archive 产物。**

  ```powershell
  git add docs/comet
  git commit -m "chore(native): archive external project knowledge change"
  git status --short --branch
  ```

  Expected: commit 成功，最终工作区干净。推送只在用户明确要求后执行。
