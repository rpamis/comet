# Outcome

让 `comet uninstall` 能以交互方式卸载 Native、Classic 或两者，并在用户选择卸载 Classic 时，让用户决定是否同时移除同一平台与 scope 下的 OpenSpec 和 Superpowers Skill，以减少不再使用的 Classic 相关 Skill 噪音。

# Scope

- 保留现有的平台和安装范围选择，并在选中目标后识别已安装的 Native 与 Classic 工作流。
- 非 JSON、非 `--force` 模式下提供工作流多选；默认保留现有“卸载全部已选工作流”的行为。
- 只卸载其中一个工作流时，保留另一个工作流所需的共享 `/comet` 入口、`comet-any`、Rule 和 Hook Router。
- 项目 scope 下按所选工作流安全清理其受 Comet 管理的工作目录，并将 `.comet/config.yaml` 收缩为剩余工作流；默认工作流被移除时切换到剩余项。
- 用户选择 Classic 后，额外询问是否同时移除 OpenSpec 和 Superpowers Skill；这两个选项默认不选，并且只删除所选平台与 scope 下对应的 Skill，不卸载 OpenSpec CLI。
- 保留全量卸载、`--force`、`--json`、`--all-projects` 和失败恢复的既有语义；非交互模式维持全量 Comet 卸载，不隐式删除外部 Skill。

# Non-goals

- 不修改 OpenSpec 或 Superpowers 上游 Skill 内容。
- 不卸载 OpenSpec CLI、npm 包或未由本命令明确选择的其他工具。
- 不在本次引入新的独立 CLI 子命令或改变 Native/Classic Runtime 状态机。

# Acceptance examples

- 同时安装 Native 和 Classic 的项目中，用户只选择 Classic 后，`comet-native` 与共享入口仍存在，`.comet/config.yaml` 仅保留 Native，Classic 专属 Skill 与空的受管 Classic 工作目录被清理。
- 同时安装 Native 和 Classic 的项目中，用户只选择 Native 后，Classic Skill、OpenSpec/Superpowers 项目工作目录与 Classic 配置仍可使用。
- 用户选择 Classic 且勾选 OpenSpec、Superpowers 后，仅所选平台和 scope 的对应外部 Skill 被清理；未勾选时它们保持不变。
- 用户选择两套工作流或使用既有非交互全量卸载时，保留当前完整 Comet 清理行为；OpenSpec/Superpowers 仍不会因默认行为被删除。
- 任何受管目录包含非 Comet 文件、路径身份异常或清理失败时，命令拒绝危险删除并报告不完整状态。

# Constraints and invariants

- 工作流选择和外部 Skill 选择只在交互模式出现；`--force` 与 `--json` 不得要求提示，也不得把外部 Skill 作为默认删除对象。
- 外部 Skill 清理必须限制在用户已确认的平台和 scope；全局 scope 的提示需说明可能影响其他项目。
- 共享组件仅在最后一个 Comet 工作流被移除时清理。
- 项目配置和受管工作目录的更新必须保持现有身份校验与拒绝删除非受管内容的安全边界。

# Decisions

- 已决定：Classic 卸载使用独立的第二级选择，OpenSpec 与 Superpowers 均为默认不选的可选项。
- 已决定：外部选择只针对 Skill，不卸载 OpenSpec CLI。
- 已决定：不新增 CLI 子命令，扩展现有 `comet uninstall` 的交互流程。
- 已确认：按本 brief 和完整规格进入实现。

# Open questions

无。

# Verification expectations

- 为 Native-only、Classic-only、双工作流部分卸载、Classic 外部 Skill 勾选/不勾选、全量卸载和安全拒删补充或更新定向测试。
- 运行受影响的 Vitest 测试、格式检查、架构 lint；由于涉及安装/卸载与配置写入，最终运行全量测试。
