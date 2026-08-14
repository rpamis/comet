# Outcome

为 Comet 提供公开、稳定、可插拔的插件运行机制，让个人记忆和项目规则以第一方插件接入，同时允许第三方插件使用同一套公开接口。

# Scope

- 管理插件的发现、安装、启用、停用、更新、卸载、兼容性检查、配置、诊断和能力调用。
- 两个第一方插件随首次包含它们的 Comet 版本安装并启用；已有用户升级后直接可用，后续更新尊重用户主动停用或卸载的选择。
- Comet Skill 是主要入口，CLI 和 Dashboard 复用同一领域能力，不维护第二套插件状态。
- 插件通过公开接口接收有来源的 workflow 事件、受控上下文请求和作用域信息；插件之间的数据、配置和日志隔离。
- 一个插件缺失、停用、不兼容或运行失败时，其他插件和基础 workflow 继续工作，并返回用户可理解的插件诊断。
- 插件可以贡献 Dashboard 页面入口，但不修改 Native、Classic、Hotfix 或 Tweak 的内部状态机。

# Non-goals

- 不根据项目内容静默下载、安装或执行第三方插件。
- 不为第一方插件提供绕过公开接口的特殊路径。
- 不在本 child 中实现个人记忆、项目规则或 Dashboard 页面本身的领域功能。
- 不在 Shape 阶段固定包格式、进程模型或线协议。

# Acceptance examples

- 用户可以安装、启用、停用和卸载第三方插件；同一机制也管理两个第一方插件。
- 两个第一方插件在已有用户升级到首次包含它们的版本后自动可用；用户卸载其中一个后，后续 Comet 更新不会自动装回。
- 用户只安装或启用其中一个插件时，另一个能力和 Comet 基础 workflow 不受影响。
- 插件停用立即停止后续处理但保留数据；卸载移除入口但不自动删除数据。
- 第一方和第三方插件使用同一公开接口，不能直接访问其他插件私有数据或 Comet workflow 内部状态。
- 不兼容或运行失败的插件被隔离并给出诊断，不伪装成项目构建、测试或 workflow 失败。
- 插件可以通过公开接口贡献 Dashboard 入口；页面或调用失败不影响其他插件页面和现有 workflow 页面。

# Constraints and invariants

- 本 child 的范围严格继承 Supervisor Change `self-evolving-memory-team-contracts` 的插件机制验收项，不扩大个人记忆、项目规则或 Dashboard 的实现范围。
- 插件生命周期状态只有一份领域来源；Skill、CLI 和 Dashboard 不得各自维护副本。
- 第一方与第三方插件遵循相同的公开接口和兼容性规则。

# Decisions

- 父级 Shape 已确认本 child 为第一波唯一可执行 child；个人记忆和项目规则依赖本 child 完成，Dashboard 依赖两个领域 child 完成。
- 该 child 使用独立 worktree，在 `comet/comet-plugin-runtime` 分支实现，目标分支为 `beta20`。

# Open questions

无。新增用户可见决定必须返回 Supervisor Change Shape。

# Verification expectations

- 验证第一方与第三方插件的安装、启用、停用、更新、卸载、兼容性拒绝和运行失败隔离。
- 验证已有用户升级自动获得第一方插件，且后续更新尊重停用或卸载选择。
- 验证两个插件与基础 workflow 的独立失败边界，以及 Skill、CLI、Dashboard 的状态一致性。
