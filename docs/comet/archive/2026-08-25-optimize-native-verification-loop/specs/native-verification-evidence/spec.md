# native-verification-evidence

## 目标

Native 将 Builder 候选、只读代码审查、Runtime 必要检查和最终独立验收分开。普通修复轮只重新判断受影响场景，归档前仍由新的 Verifier 完整判断当前候选。

### Scenario: Shape 只生成场景级验收

- **Given** brief 包含验收示例，目标 Spec 同时包含说明文字、列表、表格和显式 `Scenario:` 块
- **When** Runtime 确认 Shape
- **Then** 每个 brief 顶层验收示例形成一个验收项
- **And** 每个 `Scenario:` 标题与其完整正文形成一个验收项
- **And** Scenario 外的说明、列表和表格保留在 Spec 中但不单独生成验收项
- **And** Runtime 按稳定来源顺序分配 `A1..An`

### Scenario: Builder 候选必须先通过只读代码审查

- **Given** Builder 已完成本轮实现与最小相关检查
- **When** 提交 Builder handoff
- **Then** handoff 必须包含状态为 passed 的 review、简短审查摘要和 reviewer execution ref
- **And** reviewer execution ref 必须与 Builder execution ref 不同
- **And** 缺失、未通过或角色未分离的 review 被拒绝，change 留在 Build

### Scenario: 修复后重新审查

- **Given** Verifier 将候选返回 Build
- **When** Builder 修复任一失败或受影响场景
- **Then** 下一份 handoff 必须提供新的通过审查
- **And** 上一轮 handoff 中的 review 不能代替当前修复结果的审查

### Scenario: 首轮 Verifier 判断全部验收

- **Given** 当前目标周期的首个候选已通过代码审查和必要检查
- **When** Runtime 分派 Verifier
- **Then** verification scope 包含全部验收 ID
- **And** Verifier 只需为该 scope 中的每个 ID 返回一次 passed、failed 或 blocked
- **And** Runtime 拒绝 scope 内缺失、重复或未知 ID

### Scenario: 修复轮 Verifier 只判断影响范围

- **Given** 上一轮存在 failed 或 blocked 项，且其他项已经 passed
- **When** Builder 提交修复候选并列出 `addressed_acceptance_ids`
- **Then** verification scope 是上一轮未解决 ID 与 addressed ID 的并集
- **And** scope 外已通过结果继续保留
- **And** Verifier dispatch 只列出 scope ID，并通过详情页命令提供正文

### Scenario: 修复范围通过后执行最终全量验收

- **Given** 修复轮 scope 小于全部验收且该 scope 全部 passed
- **When** Runtime 接受 Verifier 结果
- **Then** change 留在 Verify 并准备一个新的全量 Verifier attempt
- **And** Runtime 复用同一候选已经成功的必要检查
- **And** 只有新的全量 Verifier 判断全部场景 passed 后才能形成最终 pass

### Scenario: 必要检查与结果边界保持不变

- **Given** Runtime 执行用户确认的检查或 Verifier 请求的补充检查
- **When** 检查失败、超时、中断或无法启动
- **Then** Agent 的摘要不能把它改成 passed
- **And** 同一候选中已经成功且输入未变化的检查可以复用
- **And** Archive 不重新运行检查或 Verifier

### Scenario: 中英文流程保持一致

- **Given** Native Runtime、Skill、参考和帮助文字完成更新
- **When** 比较中文和英文资产
- **Then** 两种语言都要求场景级验收、候选前代码审查、修复范围复验和最终全量 Verifier
- **And** 生成的 Native Runtime 与源码行为一致
