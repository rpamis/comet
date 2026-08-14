# Dashboard 插件中心页

## 领域边界

`domains/dashboard` 负责把插件 Runtime 的公开页面贡献和能力调用投递到 Dashboard；`domains/comet-memory` 与 `domains/project-rules` 继续负责各自领域数据。Dashboard 不拥有记忆、规则、候选或插件生命周期状态。

## 页面发现

- Dashboard Server 接收一个插件 Host，Host 使用 `PluginRuntime.dashboardPages({ scope: 'project', projectId })` 返回已安装插件页面。
- 页面列表只公开 `pluginId`、用户可读标题、稳定路由和当前插件状态；停用插件仍返回页面并标记 `disabled`，卸载插件不返回页面。
- 一个插件页面加载失败、能力调用失败或数据解析失败时，Host 返回带插件标识的诊断；其他页面和 workflow 页面继续正常响应。

## HTTP 接口

在现有项目路由下增加：

- `GET /api/dashboard/projects/:projectId/plugins`：返回页面列表、插件状态和诊断摘要。
- `GET /api/dashboard/projects/:projectId/plugins/:pluginId`：返回对应中心页的用户可读快照。
- `POST /api/dashboard/projects/:projectId/plugins/:pluginId/invoke`：接收 `{ capability, input }`，调用公开插件能力，返回领域结果；未知能力、停用插件和失败均返回结构化错误。
- `POST /api/dashboard/projects/:projectId/plugins/:pluginId/lifecycle`：接收 `{ action: "enable" | "disable" | "uninstall" }`，只调用 Runtime 生命周期 API；卸载不删除插件数据。

项目 ID 必须先通过现有 Dashboard project directory 校验；接口不得接受任意路径。响应不包含 Runtime 内部状态文件、候选 ID、评分或证据时间戳。

## 首批页面快照

个人记忆页面快照包含：`learningEnabled`、`retrievalEnabled`、当前项目记忆记录摘要、全局画像摘要、同步状态和可用操作。页面使用 `status`、`retrieve`、`correct`、`remove`、`rollback`、`sync` 能力，所有写操作后重新读取状态。

项目规则页面快照包含：`initialized`、`lastScanAt`、规则来源摘要、验证入口摘要和待处理/稍后候选摘要。页面使用 `init`、`scan`、`status`、`adopt`、`ignore`、`snooze`、`restore` 能力；加入候选由领域服务决定目标文件，页面不创建 Dashboard 专属文件。

## 前端交互

- 现有工作流导航保留；插件入口作为独立的侧边栏分组，不改变当前 workflow/change 选择。
- 中心页使用现有 AntD `Layout`、`Menu`、`Card`、`Tabs`、`Table`、`Alert` 和 `Modal` 语言；正常匹配保持安静，只有操作结果或插件诊断显示提示。
- 页面请求拥有独立 loading/error 边界；切换页面或刷新不会把上一个插件的数据写入另一个页面。
- 停用页面显示“已停用”和“重新启用”；卸载后入口从侧边栏移除，但后端保留领域文件和 Runtime 数据。

## 验收

1. 两个首批页面都能从公开插件页面贡献发现，并可在同一侧边栏独立打开。
2. 任一插件页面加载或调用失败不会影响另一个插件和既有 workflow 页面。
3. 个人记忆和项目规则的核心读取、写入和生命周期动作复用公开领域/Runtime 接口。
4. Server API 对项目路径、插件标识、能力名和生命周期动作做校验，并返回用户可读错误。
5. 页面和 API 测试覆盖停用、卸载、初始化、扫描、候选处理、纠正、删除、回滚、同步和刷新后状态一致性。
