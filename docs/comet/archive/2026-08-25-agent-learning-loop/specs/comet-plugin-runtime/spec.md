# Comet Plugin Runtime

## Purpose and lifecycle

Comet 提供公开 Plugin Runtime，使第一方和第三方插件以相同方式安装、启用、停用、卸载、接收事件、贡献 Context、暴露 Dashboard/CLI capability 和返回诊断。Personal Memory 与 Project Knowledge 不使用 Core 私有绕过路径。

插件按 user/project scope 隔离。停用后立即停止新事件、Context 和 capability 调用但保留数据；卸载不自动删除数据。一个插件缺失、失败或不兼容时，其他插件和 Native、Classic、Hotfix、Tweak 继续工作。

## Experience interface

Runtime 公开 `comet.agent-experience.v1` 事件 interface。事件具有稳定 event/episode ID、actor、scope、project identity、context、signal、evidence、outcome 和来源；插件只声明需要的事件类型。Runtime 校验 envelope、去重分发并隔离错误，不理解 Personal Memory 或 Project Knowledge 专有 schema。

旧 `CometLifecycleObservation`、任意字符串 event payload 和第一方专用 observation helper 被删除。该能力未上线，不提供 v1/v2 双写、旧事件别名或兼容 adapter。

## Context interface

插件通过公开 Context Candidate interface 提供稳定 ID、类型、状态、标题、摘要、可选正文、selectors、来源、验证方式、优先级和 match reasons。Runtime 不直接把插件任意文本拼入 Agent prompt；Context Director 负责合并、排序、预算、XML 转义、Manifest 和 application ledger。

插件提供按 ID expand capability。Candidate/expand 只能返回声明 schema 中的数据，不能返回任意 HTML、脚本或新的 system instruction envelope。第一方和第三方使用同一 schema 与预算。

## Capabilities, Dashboard and diagnostics

插件 capability 通过统一 invoke 接口调用，并声明读写性质、作用域和 Dashboard operation。Dashboard 主侧边栏 contribution、CLI、Skill 和 workflow 使用同一 capability 与状态，不建立页面专属副本。

Dashboard load 首先返回可缓存 snapshot，再异步刷新 Provider/Reflection 状态。一个插件页面加载或操作失败只显示该插件诊断，不影响其他中心页或工作流页。

插件数据、配置、Journal namespace 和日志相互隔离；插件不能读取另一个插件私有状态。共享 Experience 只能通过 Runtime 公开事件 interface 消费。

## Failure and compatibility

不兼容插件在执行前拒绝并说明版本范围。事件、Context 或后台任务失败使用统一诊断；显式写 capability 可以选择 throw-on-error，自动学习和 Context 失败默认不阻塞 workflow。

第三方插件安装/更新仍需用户明确发起；Runtime 不根据仓库内容静默下载或执行插件。插件不能修改 workflow 状态机、Guard 或用户授权。

## Verification scenarios

- 最小第三方插件可以安装、启用、接收 Experience、贡献 Candidate、expand、提供 Dashboard capability、停用和卸载。
- 两个插件消费同一 Experience 时独立成功或失败，不能读取彼此私有数据。
- 重复 eventId 只分发一次；无效 envelope 有来源诊断且不影响其他插件。
- 任意插件正文不能绕过 Context Candidate/Context Director 直接进入 Agent prompt。
- 停用/卸载后不接收事件或 Context，请求失败不影响 Native/Classic 和其他插件。
