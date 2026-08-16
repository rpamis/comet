# Supervisor 验证证据与状态

## 功能需求

### Scenario: 从父级或 Child 上下文显示同一父级摘要

- **Given** 用户从父级目录或任意已声明 Child worktree 创建、恢复或查询状态
- **When** Skill 调用 `comet native status`
- **Then** Runtime 定位同一 Supervisor 父级并返回父级摘要
- **And** 用户无需先操作 CLI 或 Dashboard 来恢复上下文

### Scenario: 默认摘要只显示决策所需信息

- **Given** Supervisor 有多个 Child 和 Agent 状态
- **When** 请求默认 `status`
- **Then** 摘要显示父级阶段和整体验证、目标 Specs 与实施 Child 数量、等待/工作中/已集成/阻塞统计
- **And** 显示 active 或 blocked Child 的名称、简短职责、实际位置和原因
- **And** 显示正在运行的 Agent 数量、已知风险和下一动作

### Scenario: 摘要区分目标、实施与横向工作

- **Given** 父级目标 Specs 数量与领域 Child、integration Child 或修复 Child 数量不同
- **When** status 汇总计划
- **Then** 分别说明目标 Specs 与实施 Child
- **And** 标识横向 integration 或修复 Child 的职责，不把它们伪装成新的用户能力

### Scenario: 默认状态合并展示但不丢失详细语义

- **Given** Child 分别处于 `pending`、`ready`、`active`、`verified`、`integrated` 或 `blocked`
- **When** 生成用户默认摘要
- **Then** `pending/ready` 可合并为“等待”，`active/verified` 可合并为“工作中”
- **And** details 仍返回每个 Child 的确定性生命周期状态
- **And** `integrated` 不显示为 `archived`

### Scenario: 默认输出隐藏 Runtime 内部细节

- **Given** Runtime 内部存在验收 ID、临时 JSON、文件名、`runId`、Agent 运行标识、candidate、iteration、attempt 或 Archive 子步骤
- **When** Skill 输出正常进度消息或默认 status
- **Then** 这些内部字段不出现在用户消息中
- **And** 只有诊断请求才通过 details 或 history 暴露必要信息

### Scenario: 默认 status 具有固定输出预算

- **Given** Supervisor 包含大量 Child、验收项和历史事件
- **When** 请求默认 status JSON
- **Then** 响应大小受固定预算约束且不会内联完整验收、历史、Child 验证记录或 Agent 调试字段
- **And** 超出摘要预算的数据通过按需接口读取

### Scenario: details 使用 cursor 分页

- **Given** 完整验收、Child 验证记录或集成记录超过单页限制
- **When** 客户端请求 `details`
- **Then** Runtime 返回稳定排序的一页数据和可选 `nextCursor`
- **And** 客户端使用 cursor 读取下一页时不重复或跳过同一状态版本的数据
- **And** Skill 用户只看到“还有更多详情”，无需手工处理 cursor

### Scenario: history 使用 cursor 分页

- **Given** 状态变化和恢复日志超过单页限制
- **When** 客户端请求 `history`
- **Then** Runtime 返回稳定排序的事件页和可选 `nextCursor`
- **And** Agent 运行标识只在明确的诊断详情中出现

### Scenario: 按父级名称直接定位 Child

- **Given** 用户按父级名称查询 Supervisor
- **When** Runtime 构建状态
- **Then** 使用父级计划和索引直接定位已声明 Child
- **And** 不先扫描所有 worktree 中每个无关 Change 的完整状态

### Scenario: Dashboard 只消费 Runtime status JSON

- **Given** Dashboard 展示 Supervisor 层级和进度
- **When** status schema 升级到 v2
- **Then** Dashboard 适配版本化的只读 JSON
- **And** 不复制 readiness、Agent、验证或集成状态推导
- **And** 不新增编辑父子计划的能力或重设计现有页面

### Scenario: integrated 记录绑定完整事实

- **Given** Child 已通过集成检查
- **When** Runtime保存 integrated 记录
- **Then** 记录绑定 Child 名称和摘要、verified commit、integration commit、Child 验证记录、实际检查结果引用、未完成检查和已知风险
- **And** 任一 commit 不匹配时该记录不能证明当前 integration HEAD

### Scenario: 父级报告区分四层证据

- **Given** 父级汇总最终验证结果
- **When** 生成 verification 报告
- **Then** 分别展示准确 commit 上的 `Child verification`、父级实际执行的 `Parent integration`、有明确来源和原因的 `Not rerun`、以及 `Incomplete`
- **And** 默认报告不复制全部 Child 逐项表格

### Scenario: 跨边界结果必须有父级实际验证

- **Given** 验收跨越多个 Child、宿主或 workflow
- **When** 父级判断完整目标是否通过
- **Then** 必须存在 integration worktree 上实际执行的父级验证记录
- **And** 单纯继承各 Child 通过记录不能使跨边界结果整体通过

### Scenario: 空检查不能泛化通过完整目标

- **Given** 父级候选包含多个验收项
- **When** Builder 或 Verifier 提交 `checks=[]` 并用同一条理由覆盖全部结果
- **Then** Runtime 拒绝把完整目标标记为 passed
- **And** 保留缺失的实际检查为 Incomplete 或 blocker

### Scenario: 不完整检查保持不完整

- **Given** 检查超时、环境阻塞、未运行或缺少证据
- **When** Runtime 汇总 Child 或父级结果
- **Then** 对应项保持 `Incomplete`
- **And** 不转换为 passed，也不计入新鲜的 Parent integration 检查

### Scenario: 无真实决定时持续自动推进

- **Given** 下一动作是派发 Builder/Verifier、Child Verify、串行集成、父级刷新、启动下一波或进入父级 Verify
- **When** 不存在范围决定、外部授权、合并冲突或用户文件保护 blocker
- **Then** Runtime 与 Skill 在一次协调过程中持续推进
- **And** 不要求用户重复回复“继续”

### Scenario: 验证保证级别使用用户可理解的文案

- **Given** verification state 包含 `host-attested`、`skill-coordinated`、`semantic-verification-unavailable` 或 `user-confirmed-degraded`
- **When** Runtime 生成 verification report、Dashboard 或 CLI 帮助中的用户展示
- **Then** 使用统一的中文用户文案说明验证是否独立、是否需要用户确认以及是否只有自动检查
- **And** `skill-coordinated` 明确说明需要用户确认验证结果
- **And** `semantic-verification-unavailable` 明确说明只完成了自动检查
- **And** “验收通过”“可归档”和“已归档”不互相替代
- **And** Portable State、status JSON 和旧状态读取继续保留原始机器枚举值

## 非目标

- 新增 `comet supervisor` 命令族或把内部 `inspect/advance/finish` 暴露为产品协议。
- Dashboard 编辑状态、复制 Runtime 状态机或视觉重设计。
