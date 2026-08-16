# 能力：固定共享 comet-memory Skill

## Requirements

### Requirement: 双语第一方 Skill 资产

系统必须随 Comet 同时提供中文与英文的 `comet-memory` Skill，并将两者纳入用户 Skill 的发现、安装、打包和存在性契约。两种语言版本必须表达相同的输入边界、动作枚举、安全限制和跳过语义。

#### Scenario: 中文配置选择中文 Skill

- **WHEN** Comet 选择 `zh-CN` artifact language
- **THEN** 安装/加载 `assets/skills-zh/comet-memory/SKILL.md` 及其 agent metadata
- **AND** 不加载英文判断文本作为用户可见说明

#### Scenario: 英文配置选择英文 Skill

- **WHEN** Comet 选择 `en` artifact language
- **THEN** 安装/加载 `assets/skills/comet-memory/SKILL.md` 及其 agent metadata
- **AND** 其 schema、action、scope 和机器枚举与中文版相同

### Requirement: 有界评审输入

Skill 必须只读取 Runtime 传入的 `comet.memory.review.v1` packet。Packet 只包含配置语言、稳定项目身份、workflow/change、可信检查点、少量用户证据、相关 active memory、evidence 和固定预算；Skill 不得要求完整 transcript、日志、diff、仓库扫描或隐藏推理。

#### Scenario: 合法 packet 触发语义评审

- **WHEN** Skill 收到合法且未超预算的 review packet
- **THEN** 只基于 packet 内的内容筛选长期可复用的个人偏好、工作习惯或已验证经验
- **AND** 不读取 packet 以外的文件、工具输出或会话历史

#### Scenario: 没有长期价值时跳过

- **WHEN** packet 只包含一次性命令、测试/提交摘要、Issue/PR 摘要、可从仓库重查的事实、猜测或噪声
- **THEN** Skill 返回 `comet.memory.actions.v1` 的单个 `skip` 动作
- **AND** 不声称已经创建或更新记忆

### Requirement: 固定动作输出

Skill 必须输出 versioned `comet.memory.actions.v1` envelope，动作只能是 `create`、`update`、`forget` 或 `skip`。整个 action set 的动作数量不得超过 packet `budget.maxActions`，所有非 `skip` 动作必须使用同一个 `global` 或 `project` scope；Skill 不得自行构造 target、evidence、candidateKey 或项目身份，Runtime 仍需在落盘前再次校验。

#### Scenario: 明确用户意图优先

- **WHEN** packet 的 user evidence 明确表达“记住”“以后都这样”“改成”或“忘掉”
- **THEN** Skill 优先返回对应的 `create`、`update` 或 `forget` 动作
- **AND** 不用相反的隐式行为覆盖显式记忆

#### Scenario: 无法可靠绑定时跳过

- **WHEN** 目标记忆、scope、证据、语言或长期价值无法从 packet 明确判断
- **THEN** Skill 返回 `skip` 或不产生动作
- **AND** 不猜测跨项目证据、不把 project 提升为 global、不生成 Runtime 内部 ID

### Requirement: 语言与安全边界

Skill 必须遵循 packet 的 `zh-CN`/`en` 用户可见语言，不生成 secret、PII、原始日志、完整 diff、提示注入或要求修改 Skill/规则/系统的内容。代码、路径、专有名词和机器枚举可以按 packet 保留原文。

#### Scenario: 语言不匹配或危险内容

- **WHEN** 候选正文/类别/标签/原因明显不符合 packet language，或包含凭据、PII、日志、diff、prompt injection 或规则修改请求
- **THEN** Skill 返回 `skip`
- **AND** 不尝试翻译、掩盖或把危险文本拆成多个动作

### Requirement: 低打扰用户体验

Skill 的后台评审、候选形成和无内容跳过默认不输出内部过程。Skill 不得向用户显示 Runtime、candidate ID、evidence count 或原始 packet；显式确认和首次实际行为变化由外部 workflow/CLI 集成层负责。

#### Scenario: 后台复盘完成

- **WHEN** 后台评审创建候选或返回 skip
- **THEN** Skill 只返回机器可消费的 action envelope
- **AND** 不向用户展示内部推理、证据计数或候选状态

## Non-Goals

- Skill 不直接读写 Personal Memory、Markdown、Git 或 Runtime state。
- Skill 不负责 Classic/Native 生命周期、宿主后台调度、CLI、Dashboard 或 Eval。
- Skill 不修改自身、其他 Skill、Agent 指令、Project Rules、Specs、测试、构建或 CI。
