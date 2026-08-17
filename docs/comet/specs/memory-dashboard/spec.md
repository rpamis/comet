# Dashboard 插件中心页

## 领域边界

`domains/dashboard` 负责把插件 Runtime 的公开页面贡献和能力调用投递到 Dashboard；`domains/comet-memory` 继续负责个人记忆数据。Dashboard 不拥有记忆或插件生命周期状态。

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

## 前端交互

- 现有工作流导航保留；个人记忆插件入口作为独立的侧边栏分组，不改变当前 workflow/change 选择。
- 中心页使用现有 AntD `Layout`、`Menu`、`Card`、`Tabs`、`Table`、`Alert` 和 `Modal` 语言；正常匹配保持安静，只有操作结果或插件诊断显示提示。
- 页面请求拥有独立 loading/error 边界；切换页面或刷新不会把上一个插件的数据写入另一个页面。
- 停用页面显示“已停用”和“重新启用”；卸载后入口从侧边栏移除，但后端保留领域文件和 Runtime 数据。

## 验收

1. 个人记忆页面能从公开插件页面贡献发现，并可在同一侧边栏独立打开。
2. 个人记忆页面加载或调用失败不会影响既有 workflow 页面。
3. 个人记忆的核心读取、写入和生命周期动作复用公开领域/Runtime 接口。
4. Server API 对项目路径、插件标识、能力名和生命周期动作做校验，并返回用户可读错误。
5. 页面和 API 测试覆盖停用、卸载、状态读取、检索、纠正、删除、回滚、同步和刷新后状态一致性。
