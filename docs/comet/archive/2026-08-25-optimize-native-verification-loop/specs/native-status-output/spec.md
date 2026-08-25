# native-status-output

## 目标

Native 的默认状态与推进结果只承载当前动作所需的摘要；完整验收、历史和执行详情保留在 Runtime 中，并通过有界详情页按需读取。

### Scenario: 默认 status 返回紧凑摘要

- **Given** 一个 change 包含大量验收、历史、Builder 交接和验证结果
- **When** 客户端请求命名 change 的默认 `native status`
- **Then** 响应只包含名称、phase、status、stateVersion、循环摘要、验收计数、未解决 ID、verificationResult、阻塞摘要、工作区摘要、本机操作摘要和 continuation
- **And** 不内联验收正文、完整 Builder 交接、完整验证结果或历史列表
- **And** Supervisor 默认状态不内联全部 Child 详情，只保留有界摘要与 ready Child 名称

### Scenario: details 使用固定大小分页

- **Given** 验收、历史、Builder 交接或验证详情超过一页
- **When** 客户端请求 `native status <change> --details`
- **Then** Runtime 返回稳定顺序的一页带类型详情项、当前状态版本、可选下一页 cursor 和完整下一页命令参数
- **And** 后续页面不会重复或遗漏同一状态版本的数据
- **And** cursor 与当前状态版本不匹配时返回清晰的过期提示

### Scenario: next 不复制完整 portable state

- **Given** Runtime 执行任意会改变 Native 状态的 `next` 动作
- **When** CLI 返回成功结果
- **Then** 结果包含与默认 status 相同的紧凑 state 摘要及最新 continuation
- **And** 不把 `comet-state.yaml` 中的完整 acceptance、history、Builder handoff 或 verification 复制到响应

### Scenario: Verifier 按范围读取验收详情

- **Given** Runtime 准备分派一个新的 Verifier
- **When** 生成 verifierDispatch
- **Then** 分派内容包含当前验收范围 ID、验收总数、brief/Spec 引用、详情页读取命令、Builder 审查摘要和 Runtime 检查摘要
- **And** 不内联完整验收正文
- **And** Verifier 可以通过详情页读取当前状态版本对应的全部范围内容

### Scenario: 帮助和 Skill 默认使用紧凑入口

- **Given** Agent 创建、恢复或推进 Native change
- **When** 中英文 Skill 或 CLI 帮助指导其读取状态
- **Then** 默认使用紧凑 status/next 结果
- **And** 只有 Shape、Review、Verify 或诊断确实需要正文时才读取 details 分页
