# 能力：暂停个人记忆学习的可恢复语义

## 目标

Personal Memory 的自动学习必须把“是否允许学习”作为评审、去重、观察入库和候选形成的共同前置条件。项目暂停学习或全局学习关闭时，系统可以记录最小诊断信息，但不得运行自动记忆评审、保存观察正文或消耗恢复后的自动学习去重身份。

## 自动学习状态

自动观察适用于 project 或 global scope。对 project scope，项目暂停状态优先于普通 learning 配置；对所有 scope，全局 `learningEnabled: false` 都会跳过自动学习。项目 `.comet/config.yaml` 中关闭 `memory.learning` 的入口行为与领域层关闭状态一致。

### Scenario: 项目暂停阻止自动评审和正文入库

- **Given** 项目学习已暂停，且提交了一条带正文、workflow、change 和 candidate key 的自动 observation
- **When** Comet 处理这条 observation
- **Then** 返回 `ignored`，不调用自动记忆评审
- **And** 不新增或更新含正文的 `observations`、Record、evidence 或 Markdown 投影
- **And** 只允许保存不含正文的跳过原因、时间和学习检查结果

### Scenario: 全局关闭与项目暂停一致

- **Given** 全局 Personal Memory learning 已关闭，或项目配置明确关闭 `memory.learning`
- **When** 入口提交自动 observation
- **Then** 入口和领域存储都返回 `ignored`
- **And** ignored observation 不增加有效观察计数，不创建候选，也不占用去重身份

## 恢复和去重

自动学习恢复后，同一个 workflow、change、candidate key 和正文可以按首次有效 observation 处理。去重身份表示已经被接受的学习证据，而不是一次曾经被尝试、跳过或暂停的输入。

### Scenario: 恢复后重试暂停期间的观察

- **Given** 一条 observation 在项目暂停期间被忽略，且没有形成 Record 或 evidence
- **When** 项目恢复学习后以相同身份和正文重试
- **Then** 该 observation 按首次有效学习处理，并可创建 trial candidate
- **And** 返回结果不是 `deduplicated`

### Scenario: 兼容旧版孤立 observation

- **Given** 状态文件来自 0.4.1，包含一条成功 observation，但该 key 没有被 `state.evidence` 引用
- **When** 项目恢复学习后重试该 observation
- **Then** 旧 observation 不阻止候选创建
- **And** 已经被有效 evidence 引用的成功 observation 仍按原规则去重

### Scenario: 有效证据仍然去重

- **Given** 相同 observation 已创建候选或形成有效 evidence
- **When** 再次提交相同身份和正文
- **Then** 返回 `deduplicated`
- **And** 不新增 Record、evidence 或投影

## 显式操作边界

暂停自动学习只影响后台 observation 和自动评审，不改变用户明确发起的记忆管理操作。

### Scenario: 显式操作不被自动学习暂停拦截

- **Given** 当前项目暂停自动学习
- **When** 用户显式执行 remember、correct、forget 或 rollback
- **Then** 操作继续遵循 Personal Memory 现有显式操作契约
- **And** 失败时返回真实错误并保持原状态

## 并发和失败

评审前检查用于避免无效工作；存储层在文件锁内再次检查当前状态。暂停操作与自动 observation 并发时，暂停完成后提交的自动 observation 不得写入。不得在外部评审运行期间长期持有存储锁。

### Scenario: 并发暂停不会产生自动学习写入

- **Given** 自动评审开始前后项目被暂停
- **When** 自动 observation 尝试提交结果
- **Then** 存储层按最新暂停状态拒绝自动写入
- **And** 不产生半写入、重复证据或错误的有效观察计数

### Scenario: 诊断失败不破坏记忆状态

- **Given** 记录学习检查或写入诊断信息失败
- **When** 自动 observation 被跳过
- **Then** 既有 Record、evidence、tombstone 和投影保持一致
- **And** 当前 workflow 继续遵循原有后台失败降级语义

## 非目标

- 不改变检索暂停、Remote Provider 协议、显式记忆内容或 Native/Classic 工作流状态机。
- 不批量删除合法历史 observation 或完整记忆状态；旧孤立 observation 通过去重资格修复兼容。
