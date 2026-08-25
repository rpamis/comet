# native-completion-loop

## 目标

Native 的 Build 与 Verify 循环在修复阶段只重复必要工作，同时在最终归档前保留一次完整独立验收。Loop 继续使用既有 Shape、Build、Verify、Archive 四个 phase。

### Scenario: 首个候选进入全量 Verify

- **Given** Shape 已确认且 Builder 完成首轮实现
- **When** 通过代码审查的 handoff 被 Runtime 接受
- **Then** iteration 为 1，verification scope 包含全部验收项
- **And** Runtime 执行必要检查后分派新的只读 Verifier

### Scenario: Verify 失败返回有界修复范围

- **Given** Verifier 对当前 scope 返回 failed 或 blocked 项
- **When** Runtime 返回 Build
- **Then** portable 状态保留上一轮未解决 ID、对应原因和其余已通过结果
- **And** iteration 增加，attempt 重置，下一动作说明修复这些项并标记其他受影响项
- **And** 只有有效 Verify fail 消耗失败轮次预算

### Scenario: Builder 声明本轮受影响项

- **Given** change 处于 repairing
- **When** Builder 提交新的 handoff
- **Then** `addressed_acceptance_ids` 可以包含本轮修复项及可能受修改影响的已通过项
- **And** Runtime 自动加入全部上一轮未解决项
- **And** 未列入并集的 passed 项不进入本轮修复 Verifier

### Scenario: 修复范围未通过继续收敛

- **Given** 新 Verifier 只判断当前修复 scope
- **When** scope 仍有 failed 或 blocked
- **Then** Runtime 更新这些结果并再次返回 Build
- **And** 进展判断只比较新的未解决集合
- **And** 连续无进展和总失败轮次继续使用现有停止上限

### Scenario: 修复范围通过后自动进入最终全量 Verify

- **Given** 当前候选的修复 scope 小于全部验收且已经全部 passed
- **When** Runtime 接受结果
- **Then** 不进入 Archive，也不要求用户重复确认
- **And** Runtime 将全部验收准备为 pending，增加 attempt，并分派新的独立 Verifier
- **And** 同一候选的已成功检查可以复用

### Scenario: 最终全量结果决定 Archive

- **Given** 最终 Verifier 的 scope 等于全部验收项
- **When** 全部验收和必要检查均 passed
- **Then** Runtime 形成最终 pass 并按 `native.archive_confirmation` 进入 Archive 或一次用户确认
- **And** 任一项失败、阻塞或缺失都不能归档
- **And** Archive 本身不增加 iteration 或重新验收

### Scenario: 恢复保持当前验证范围

- **Given** 本机进程在修复范围 Verify 或最终全量 Verify 中断
- **When** Runtime 从 portable 状态恢复
- **Then** 保留当前 iteration、候选和待验证范围
- **And** 重新分派新的 attempt，不把中断计为实现失败
- **And** 不恢复已经失效的 Builder 审查或旧候选结果

### Scenario: Dashboard 与 Runner 显示真实阶段

- **Given** change 处于代码审查、修复范围 Verify 或最终全量 Verify
- **When** Dashboard 或 Runner 读取紧凑状态
- **Then** 使用 Build/Verify 既有 phase 和明确 next action 表达当前工作
- **And** 修复范围通过不显示为最终验收通过或可归档
