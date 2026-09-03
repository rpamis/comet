# native-completion-loop

## 目标

Native 的 Build 与 Verify 循环在修复阶段只重复必要工作，同时在最终归档前保留一次完整独立验收。Loop 继续使用既有 Shape、Build、Verify、Archive 四个 phase；独立 Verifier 暂时不可用时，用户可以保留当前候选和检查并重新派发，不需要恢复文件、进程或外部回调。

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

### Scenario: Verifier 不可用后可以重新派发

- **Given** 当前平台暂时无法启动独立 Verifier，且已解析的 Runtime 检查全部通过
- **When** Runtime 记录 `verifier-unavailable`
- **Then** continuation 同时提供重新尝试独立验收和接受降级结果
- **And** 不要求用户恢复文件、进程、服务地址或回调

### Scenario: 不可用状态重试保留候选和检查

- **Given** change 正在等待用户决定是否接受降级验证
- **When** 用户选择重新尝试独立验收
- **Then** Runtime 保留当前候选和已通过检查，清除不可用验证结论与降级阻塞
- **And** state version 和 retry epoch 增加，下一动作重新分派新的只读 Verifier
- **And** 旧 attempt 的迟到结果继续被拒绝

### Scenario: 不可用重试保持完整验收规则

- **Given** 首次全量 Verify 或局部修复 Verify 因 Verifier 不可用而等待用户
- **When** 用户重试且新 Verifier 返回通过
- **Then** 首次全量 Verify 直接形成当前候选的完整结果
- **And** 局部修复 Verify 通过后仍自动进入最终全量 Verify
- **And** 任一验收项未通过、阻塞或缺失时仍返回 Build，不能归档

### Scenario: Verifier 执行结果按真实失败类型记录

- **Given** 平台提供原生 subagent，且 Runtime 已返回 Verifier 任务包
- **When** subagent 启动失败、超时、丢失或结束后没有结果
- **Then** Agent 提交 `verifier-execution-error` 并按最新 continuation 重新派发或等待用户重试
- **And** 只有平台确实无法启动独立执行时才提交 `verifier-unavailable`
- **And** 整个流程不依赖常驻 Verifier 进程、服务地址或外部回调

### Scenario: Dashboard 与 Runner 显示真实阶段

- **Given** change 处于代码审查、修复范围 Verify、最终全量 Verify 或 Verifier 不可用后的恢复选择
- **When** Dashboard 或 Runner 读取紧凑状态
- **Then** 使用 Build/Verify 既有 phase 和明确 next action 表达当前工作
- **And** 不可用状态显示可重试与接受降级结果的合法选择
- **And** 修复范围通过不显示为最终验收通过或可归档
