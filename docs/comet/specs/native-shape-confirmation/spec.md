# native-shape-confirmation

## 目标

Native 的 Shape 阶段由 Runtime 强制保留一次最终用户确认。Agent 先完成可供确认的 Shape，再由 Runtime 持久化等待状态；只有用户明确确认后，change 才能进入 Build。

### Scenario: active Shape 只准备确认边界

- **Given** change 处于 `phase: shape`、`status: active`，且 Shape 内容已经完整
- **When** Agent 通过 `native next` 提交 Shape 摘要
- **Then** Runtime 校验 Shape 内容并持久化 `status: await-user`、`loop.stage: await-user`
- **And** `loop.next_action` 变为 `confirm-shape`
- **And** 本次动作不进入 Build，也不等同于用户确认

### Scenario: 未解决的 Shape 问题阻止准备确认

- **Given** brief 的待解决问题中仍有 `[blocking]`
- **When** Agent 尝试完成 Shape 或准备最终确认
- **Then** Runtime 返回 brief validation failure
- **And** portable state 保持 active Shape，不进入最终确认等待状态

### Scenario: confirm-shape 始终要求用户决定

- **Given** continuation 的 action 是 `confirm-shape`
- **When** Runtime 返回下一步
- **Then** `disposition` 必须是 `await-user`
- **And** `requiresUserDecision` 和 `userCommunication.required` 必须为 `true`
- **And** 顶层 `commandArgs` 必须为空，避免 Agent直接自动执行确认

### Scenario: 未进入等待状态时拒绝 confirmed

- **Given** change 仍处于 active Shape
- **When** 调用方直接提交 `--confirmed`
- **Then** Runtime 拒绝该操作并保持 Shape 状态不变
- **And** 返回的信息说明必须先完成 Shape 并进入用户确认边界

### Scenario: 用户确认等待中的 Shape

- **Given** change 处于 Shape 的 `await-user` 状态，下一动作是 `confirm-shape`
- **When** 用户明确确认后，Agent提交带 `--confirmed`、当前 state version 和 expected action 的命令
- **Then** Runtime重新校验 Shape 内容并进入 Build
- **And** continuation 返回 Build 阶段的下一动作

### Scenario: 确认命令受并发状态保护

- **Given** Shape 正在等待用户确认
- **When** 命令携带旧 state version 或不匹配的 expected action
- **Then** Runtime拒绝该命令
- **And** portable state 不发生变化

### Scenario: Supervisor 先选择协调方式再确认 Shape

- **Given** Supervisor change 的 Shape 已完整，但缺少 agent 协调方式
- **When** 用户选择合法协调方式
- **Then** Runtime保存选择并进入 Shape 的最终确认等待状态
- **And** Runtime仍要求用户单独确认完整 Shape 后才能进入 Build

### Scenario: 恢复后保留 Shape 确认边界

- **Given** change 已持久化为等待确认 Shape
- **When** Agent 在新的对话或进程中恢复该 change
- **Then** continuation 仍返回 `confirm-shape` 和等待用户决定的信号
- **And** 不因恢复而自动进入 Build或清除确认边界

### Scenario: 模糊需求只询问会改变结果的决定

- **Given** 用户描述包含无法从现有事实确定、且会改变用户可见结果的歧义
- **When** Agent 执行 Shape 澄清
- **Then** 未解决决定写入 brief 的 `[blocking]` 并等待用户回答
- **And** 可调查事实由 Agent 调查，普通实现选择由 Agent 决定

### Scenario: 清晰需求直接整理 Shape

- **Given** 用户要求、正式规格和仓库事实足以确定用户可见结果
- **When** Agent 执行 Shape 澄清
- **Then** 不新增没有实际分歧的问题
- **And** Agent 完成正式产物后进入一次最终 Shape 确认

### Scenario: 需求来源文档完整覆盖

- **Given** 用户明确把文件、附件、链接或本地路径作为需求来源
- **When** Agent 整理 Shape
- **Then** brief 记录来源单元及其读取、覆盖和替代状态
- **And** 未读取、部分读取、未映射、冲突或未确认的可执行来源内容保持 `[blocking]`

### Scenario: 参考材料不自动变成需求

- **Given** 用户提供的材料只用于排错、取证、审查或实现参考
- **When** Agent 整理 Shape
- **Then** 不把材料中的说明或面向 Agent 的指令自动加入需求范围
- **And** 材料用途无法确定时，先把用途作为用户决定澄清
