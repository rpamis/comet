---
generated_from_state_version: 16
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 3
- Verifier attempt: 1
- Completed: 2026-08-14T11:22:49.487Z
- Summary: 27/27 acceptance items passed; no failed or blocked items.

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户打开 Dashboard，侧边栏同时看到“个人记忆”和“项目规则”；切换入口后中心页保持现有 Dashboard 的紧凑 AntD 视觉语言。 | 双首方插件页面均注册并显示在独立侧边栏分组，沿用紧凑 AntD 页面。 |
| A2 | passed | brief.md | 个人记忆插件不可用时，个人记忆页显示可读诊断，项目规则页和 workflow 页面仍能打开。 | 单页加载或调用失败隔离在对应页面并保留插件诊断。 |
| A3 | passed | brief.md | 用户在个人记忆页纠正一条画像、删除一条项目记忆、点击回滚或同步，刷新页面后结果来自同一记忆仓库；页面不保存副本。 | 个人记忆页面动作经公开 Runtime 能力回读同一记忆仓库。 |
| A4 | passed | brief.md | 用户在项目规则页对未初始化项目点击“初始化”，只得到盘点摘要；点击“重新扫描”更新来源和验证入口；对候选执行加入、忽略或稍后与 Skill/CLI 语义一致。 | 项目规则初始化、扫描和候选处理均经公开插件能力执行。 |
| A5 | passed | brief.md | 停用插件后页面保留停用状态和启用按钮；卸载后侧边栏入口消失，但记忆文件、规则文件和原生检查配置仍保留。 | 停用保留入口与数据，卸载移除入口且不删除领域数据。 |
| A6 | passed | brief.md | 插件页面加载异常、能力调用异常或返回无效数据时，其他页面继续可用并显示对应插件诊断。 | 服务端和前端错误均保留并显示 pluginId，其他页面继续可用。 |
| A7 | passed | specs/memory-rules-dashboard/spec.md | `domains/dashboard` 负责把插件 Runtime 的公开页面贡献和能力调用投递到 Dashboard；`domains/comet-memory` 与 `domains/project-rules` 继续负责各自领域数据。Dashboard 不拥有记忆、规则、候选或插件生命周期状态。 | Dashboard 只投递插件公开页面和能力，不拥有领域状态。 |
| A8 | passed | specs/memory-rules-dashboard/spec.md | Dashboard Server 接收一个插件 Host，Host 使用 `PluginRuntime.dashboardPages({ scope: 'project', projectId })` 返回已安装插件页面。 | Host 使用 PluginRuntime dashboardPages 按项目发现页面。 |
| A9 | passed | specs/memory-rules-dashboard/spec.md | 页面列表只公开 `pluginId`、用户可读标题、稳定路由和当前插件状态；停用插件仍返回页面并标记 `disabled`，卸载插件不返回页面。 | 页面列表只公开用户可读摘要，停用可见、卸载隐藏。 |
| A10 | passed | specs/memory-rules-dashboard/spec.md | 一个插件页面加载失败、能力调用失败或数据解析失败时，Host 返回带插件标识的诊断；其他页面和 workflow 页面继续正常响应。 | 页面和能力失败均返回带插件标识的诊断，健康页面继续响应。 |
| A11 | passed | specs/memory-rules-dashboard/spec.md | 在现有项目路由下增加： | 插件 HTTP 路由挂载在现有 Dashboard 项目路由下。 |
| A12 | passed | specs/memory-rules-dashboard/spec.md | `GET /api/dashboard/projects/:projectId/plugins`：返回页面列表、插件状态和诊断摘要。 | 页面列表 API 返回状态和诊断摘要。 |
| A13 | passed | specs/memory-rules-dashboard/spec.md | `GET /api/dashboard/projects/:projectId/plugins/:pluginId`：返回对应中心页的用户可读快照。 | 页面快照 API 返回首方中心页用户可读数据。 |
| A14 | passed | specs/memory-rules-dashboard/spec.md | `POST /api/dashboard/projects/:projectId/plugins/:pluginId/invoke`：接收 `{ capability, input }`，调用公开插件能力，返回领域结果；未知能力、停用插件和失败均返回结构化错误。 | invoke API 校验能力、停用状态和失败响应。 |
| A15 | passed | specs/memory-rules-dashboard/spec.md | `POST /api/dashboard/projects/:projectId/plugins/:pluginId/lifecycle`：接收 `{ action: "enable" \| "disable" \| "uninstall" }`，只调用 Runtime 生命周期 API；卸载不删除插件数据。 | lifecycle API 覆盖 enable、disable、uninstall 且只调用 Runtime。 |
| A16 | passed | specs/memory-rules-dashboard/spec.md | 项目 ID 必须先通过现有 Dashboard project directory 校验；接口不得接受任意路径。响应不包含 Runtime 内部状态文件、候选 ID、评分或证据时间戳。 | 项目目录和公开摘要边界经过服务端测试，未泄露 Runtime 内部字段。 |
| A17 | passed | specs/memory-rules-dashboard/spec.md | 个人记忆页面快照包含：`learningEnabled`、`retrievalEnabled`、当前项目记忆记录摘要、全局画像摘要、同步状态和可用操作。页面使用 `status`、`retrieve`、`correct`、`remove`、`rollback`、`sync` 能力，所有写操作后重新读取状态。 | 个人记忆快照含设置、检索摘要、同步状态和操作列表，写操作后重新读取。 |
| A18 | passed | specs/memory-rules-dashboard/spec.md | 项目规则页面快照包含：`initialized`、`lastScanAt`、规则来源摘要、验证入口摘要和待处理/稍后候选摘要。页面使用 `init`、`scan`、`status`、`adopt`、`ignore`、`snooze`、`restore` 能力；加入候选由领域服务决定目标文件，页面不创建 Dashboard 专属文件。 | 项目规则快照含盘点、来源、验证入口、候选和操作列表。 |
| A19 | passed | specs/memory-rules-dashboard/spec.md | 现有工作流导航保留；插件入口作为独立的侧边栏分组，不改变当前 workflow/change 选择。 | 插件入口独立于既有 workflow/change 导航。 |
| A20 | passed | specs/memory-rules-dashboard/spec.md | 中心页使用现有 AntD `Layout`、`Menu`、`Card`、`Tabs`、`Table`、`Alert` 和 `Modal` 语言；正常匹配保持安静，只有操作结果或插件诊断显示提示。 | 页面使用现有 AntD 组件语言，记忆纠正使用 Modal。 |
| A21 | passed | specs/memory-rules-dashboard/spec.md | 页面请求拥有独立 loading/error 边界；切换页面或刷新不会把上一个插件的数据写入另一个页面。 | 页面有独立 loading/error 边界，pluginProjectRef 与 pluginSelectionRef 防止旧响应回写。 |
| A22 | passed | specs/memory-rules-dashboard/spec.md | 停用页面显示“已停用”和“重新启用”；卸载后入口从侧边栏移除，但后端保留领域文件和 Runtime 数据。 | 停用页提供重新启用，卸载后侧边栏移除且后端数据保留。 |
| A23 | passed | specs/memory-rules-dashboard/spec.md | 两个首批页面都能从公开插件页面贡献发现，并可在同一侧边栏独立打开。 | 两个首方页面均由公开 Runtime 发现并可独立打开。 |
| A24 | passed | specs/memory-rules-dashboard/spec.md | 任一插件页面加载或调用失败不会影响另一个插件和既有 workflow 页面。 | 插件错误边界不会影响另一插件或既有 workflow 页面。 |
| A25 | passed | specs/memory-rules-dashboard/spec.md | 个人记忆和项目规则的核心读取、写入和生命周期动作复用公开领域/Runtime 接口。 | 个人记忆和项目规则动作均通过公开领域/Runtime 接口。 |
| A26 | passed | specs/memory-rules-dashboard/spec.md | Server API 对项目路径、插件标识、能力名和生命周期动作做校验，并返回用户可读错误。 | 项目、插件、能力和生命周期输入均有校验并返回可读错误。 |
| A27 | passed | specs/memory-rules-dashboard/spec.md | 页面和 API 测试覆盖停用、卸载、初始化、扫描、候选处理、纠正、删除、回滚、同步和刷新后状态一致性。 | 覆盖停用、卸载、初始化、扫描、候选处理、纠正、删除、回滚、同步和刷新一致性。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| dashboard-plugin-tests | run test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/web-state.test.ts test/domains/dashboard/web-source.test.ts test/domains/project-rules/plugin.test.ts test/domains/comet-memory/personal-memory.test.ts | . | passed | 0 | 3459 ms |
| typescript | --noEmit | . | passed | 0 | 6473 ms |
| architecture | run lint:architecture | . | passed | 0 | 923 ms |
| eslint | app/ domains/ platform/ | . | passed | 0 | 7262 ms |
| prettier | --check domains/dashboard/web/src/dashboard-web-state.js domains/dashboard/web/src/main.jsx test/domains/comet-memory/personal-memory.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/web-state.test.ts test/domains/project-rules/plugin.test.ts | . | passed | 0 | 1068 ms |
| dashboard-build | build --config domains/dashboard/web/vite.config.mjs | . | passed | 0 | 19452 ms |

## Blockers

_None._

## Risks and skipped work

- child worktree lacks local vitest; explicit root D:\Project\Comet\node_modules\.bin\vitest.cmd passed
- root ESLint has one pre-existing unused-argument warning in test/domains/dashboard/plugin-host.test.ts
- Vite build retains existing chunk-size warnings

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | recovery | — | 修复全局停用插件的重新启用语义，并在 Dashboard 插件错误响应中保留 pluginId 诊断 | 2026-08-14T11:06:05.265Z |
| 1 | 2 | 1 | recovery | — | 补齐全局停用与项目暂停叠加时的启用清理，并防止插件页面切换时旧请求覆盖新页面 | 2026-08-14T11:10:09.803Z |
| 1 | 3 | 1 | pass | — | 27/27 acceptance items passed; no failed or blocked items. | 2026-08-14T11:22:49.487Z |

## Conclusion

27/27 acceptance items passed; no failed or blocked items.
