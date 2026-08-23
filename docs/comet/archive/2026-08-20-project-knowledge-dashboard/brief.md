# 目标

在 Dashboard 中把第一方 `comet.project-knowledge` 插件与个人记忆并列展示，提供 Local/Remote 状态、脱敏配置摘要、有界诊断和现有插件生命周期操作。

# 范围

- 为 `domains/project-knowledge/` 的现有插件模块增加 Dashboard contribution 和只读 `status` 能力。
- 让 Dashboard 插件页摘要区分全局停用与当前项目暂停，同时保持既有 Plugin Runtime 生命周期语义。
- 使用现有紧凑 Dashboard 和 Ant Design 组件展示 Provider、配置有效性、Remote 安全摘要、检索说明和最近诊断。
- 增加插件模块、Dashboard host、默认 host、HTTP API、Web source/state 和 Playwright 覆盖，并更新 beta20 用户可见 Changelog。

# 非目标

- 不修改已归档的 `project-knowledge-retrieval` Change。
- 不增加项目知识搜索页、索引/embedding/监听器/历史页或配置编辑器。
- 不构造 Provider、不发起网络请求、不扫描语料来渲染状态页。
- 不引入新的插件生命周期模型或新的检索命令/Skill。

# 验收示例

- A1：Dashboard 列出 `comet.project-knowledge`，标签为“项目知识”，路由为 `/plugins/project-knowledge`，并与个人记忆处于同一插件中心。
- A2：Local 快照标记 `configured: true` 并明确“不维护索引”；Remote 快照显示 endpoint、scope、timeout 和 token 环境变量名/是否存在，但不出现 token、Authorization、凭据、查询参数或 hash。
- A3：插件页摘要区分 `enabled`、全局停用和当前项目暂停；暂停/恢复/卸载只调用现有 Dashboard lifecycle API。
- A4：状态页加载不构造 Local/Remote Provider、不调用网络、不启动子进程；最近诊断最多三条，每条有界且去除 Bearer 值，无诊断时显示空状态。
- A5：页面展示 Provider、插件状态、项目暂停状态、配置有效性、Remote 安全摘要和检索语义，不显示搜索、索引、历史或配置编辑控件。
- A6：现有项目知识检索、插件禁用/暂停/卸载、个人记忆页面和已归档 `project-knowledge-retrieval` 产物保持行为不变。

# 约束与不变量

- 正式产物使用 `zh-CN`；代码、路径、schema、Provider 和 plugin ID 保持英文稳定。
- Dashboard 页面只读配置；Remote endpoint 展示不代表最近请求成功；Local 展示不暗示存在索引。
- 状态页与生命周期操作必须复用 `PluginRuntime.dashboardPages()`、`DashboardPluginHost.get()` 和 `DashboardPluginHost.lifecycle()`。
- page data 只能包含 provider、configured、sanitized remote、retrieval 和最多三条 diagnostics。
- 不读取或写入 token 值、Authorization header、完整远端响应、绝对路径或用户文档正文。

# 决策

- 采用插件自有 Dashboard contribution，不在 host 中硬编码 Project Knowledge 页面。
- 用插件模块内的 `status` capability 返回 provider-specific snapshot；host 继续负责生命周期和运行时诊断摘要。
- 用 `globallyDisabled` 与 `projectPaused` 两个只读摘要字段解释现有 Runtime 状态，不改变启用/停用实现。
- 代码修改遵循仓库现有 TypeScript、React、Ant Design、Vitest 和 Playwright 结构。

# 待解决问题

无。用户已确认使用批准的 MVP 方向，并继续执行实现与验证。

# 验证预期

- 先运行项目知识和 Dashboard host/web 的最小 Vitest 套件，再运行 Dashboard Playwright。
- 最终运行 Prettier、lint、build、生成资产检查、全量 Vitest、Dashboard E2E 和 Native `check`。
- 远端配置测试使用固定本地数据，不访问真实服务；必须用断言确认 token 和 Authorization 不在快照中。
