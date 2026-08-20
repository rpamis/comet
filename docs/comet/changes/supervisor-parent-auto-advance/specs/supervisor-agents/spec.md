# Supervisor Agent 协调

## 功能需求

### Scenario: Runtime 只返回精简 Agent 任务包

- **Given** 父级有一个可执行的 Builder 或 Verifier 工作项
- **When** continuation 向宿主请求执行
- **Then** 任务包只包含 `role`、`child`、`projectRoot`、`baseCommit` 和 `runId`
- **And** 任务明确绑定当前父级事实与一个 Child worktree
- **And** 临时传输文件由 Runtime 在 `.comet/runtime` 内创建、消费和清理

### Scenario: Builder 只推进指定 Child

- **Given** Agent 收到角色为 `builder` 的任务包
- **When** Agent 执行任务
- **Then** 它只在指定 Child worktree 中推进 Build
- **And** 到达 Verifier 边界或遇到 blocker 后返回
- **And** 不自行推进父级集成或最终交付

### Scenario: Verifier 是新的只读 Agent

- **Given** Child 产生待验证候选
- **When** 父级派发角色为 `verifier` 的任务包
- **Then** 使用与 Builder 分离的新 Agent，只读验收指定候选
- **And** 不修改实现、不接受 Builder 自证，也不负责创建嵌套 Agent
- **And** 独立性沿用 Native 现有可信宿主或 skill-coordinated 降级规则

### Scenario: 支持 Agent 的宿主并行派发无依赖任务

- **Given** 至少两个无依赖 Child 同时 ready，且当前会话提供原生 Agent 工具
- **When** 父级协调者派发 Builder 或 Verifier
- **Then** 每个任务使用独立 Child worktree，并可按宿主并发上限并行
- **And** 无法获得并发上限时最多同时派发两个
- **And** 并行不扩展到 integration branch 写入

### Scenario: 不支持 Agent 时自动顺序降级

- **Given** 当前会话没有可用原生 Agent 工具
- **When** 父级仍有 ready 工作项
- **Then** 同一协调流程按稳定顺序逐项执行 Builder 和 Verifier
- **And** 依赖、独立验证、串行集成和最终交付结果与并行模式一致
- **And** 不要求用户手工选择另一套流程

### Scenario: 平台注册表不硬编码多 Agent 能力

- **Given** 同一宿主可能通过会话配置启用或关闭 Agent
- **When** Runtime 决定是否并行派发
- **Then** 能力来自当前会话实际可用工具
- **And** 不在 33 平台 canonical registry 中维护易漂移的 `supportsMultiAgent` 静态字段

### Scenario: 同一 Child 只有一个有效任务

- **Given** 某 Child 已有有效 Builder 或 Verifier 任务
- **When** continuation 再次计算可执行工作
- **Then** 不为同一 Child 创建第二个有效任务
- **And** 其他无依赖 Child 仍可被派发

### Scenario: runId 拒绝重复或迟到结果

- **Given** Runtime 已记录当前 Child、角色、父级状态、base commit 和 `runId`
- **When** 收到重复完成、旧 `runId`、错误角色或不匹配基线的返回
- **Then** 该返回不能推进 verified、integrated 或父级状态
- **And** `runId` 只用于执行去重，不作为权限凭证或 Agent 身份证明

### Scenario: Agent 完成消息只唤醒协调者

- **Given** 宿主通知某 Agent 已完成
- **When** 父级继续推进
- **Then** Runtime 重新读取 Portable State、Child 验证记录、verified commit 和 Git 关系
- **And** 只有这些事实一致时才推进状态
- **And** Agent 的文字摘要不直接成为 Runtime 事实

### Scenario: 全部 Child 完成后自动切回父级

- **Given** Runtime 已根据可信状态和 Git 事实确认全部 Child 完成
- **When** Child 完成命令返回父级自动推进结果和 continuation
- **Then** Native Skill 不要求用户再次说“推进”或重复确认范围
- **And** 自动切换到父级上下文并继续派发最终 Verifier
- **And** 明确通知用户“全部 Child 已完成，Supervisor 父级正在进行最终验证”

### Scenario: 宿主中断时保留可恢复的父级下一步

- **Given** Runtime 已把父级持久化为 Verify，但宿主无法立即启动最终 Verifier
- **When** 当前协调任务结束或稍后恢复
- **Then** continuation 明确指向父级最终 Verifier 动作
- **And** 不把父级回退为 Build，也不以最后一个 Child 完成消息冒充整个 Supervisor 完成

### Scenario: 恢复时优先重连旧任务

- **Given** 协调会话重启且某 Child 仍有有效任务
- **When** 宿主提供可恢复的 Agent 运行标识
- **Then** 父级优先重新连接旧任务
- **And** 不因为会话重启重复派发已 verified 或 integrated 的 Child

### Scenario: 重新派发前确认旧任务已停止

- **Given** 旧 Agent 无法重连
- **When** 父级考虑为同一 Child 创建替代任务
- **Then** 只有宿主确认旧任务已结束或取消后，Runtime 才失效旧 `runId` 并重新派发
- **And** 无法确认时只阻塞该 Child，不让两个 Agent 并发写同一 worktree

### Scenario: 单个 Agent 阻塞不冻结无依赖任务

- **Given** 一个 Agent 失败、等待外部授权或无法安全恢复
- **When** 其他无依赖 Child 仍有可执行工作
- **Then** Runtime 只阻塞受影响 Child并继续提供其他任务
- **And** 最终 integration branch 写入仍保持串行

### Scenario: Agent 不需要共享协调基础设施

- **Given** 父级同时协调多个 Child
- **When** Builder 和 Verifier 执行
- **Then** Agent 不共享 mailbox、宿主任务列表或直接通信
- **And** Child Agent 不需要创建嵌套 Agent
- **And** Runtime 不管理模型选择、消息路由或通用 Worker 生命周期

### Scenario: 自动接回不绕过最终交付授权

- **Given** Native Skill 已自动切回父级并完成最终 Verify
- **When** 父级进入 Archive 或 workspace finish 边界
- **Then** Skill 继续遵循现有项目配置、Runtime continuation 和用户授权
- **And** 不因为 Child 自动接回而擅自 merge、push 或创建 PR

## 非目标

- worker claim、lease、heartbeat、抢占、自动任务领取或通用 bounded-concurrency scheduler。
- Agent Team、共享 mailbox、模型自动选择、exactly-once Agent execution 或 provider attestation。
- 用 Skill 文本代替 Runtime 的父级完成判定或持久化状态转换。
