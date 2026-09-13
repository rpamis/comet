# 能力：Personal Memory 用户体验与管理

## Requirements

### Requirement: 确定性检索与用户可读投影

Personal Memory 必须提供有界、可解释、稳定排序的检索和管理投影。投影可以显示范围、项目、类别、标签、来源类型、证据数量、最后确认时间和冲突状态，但不能泄露 Runtime 文件、candidate ID、evidenceKeys、完整来源或隐藏过程。

#### Scenario: 有可靠命中

- **WHEN** 用户以任务、路径、操作、类别、标签、关键词和作用域查询
- **THEN** 只返回 active、无未解决冲突、未被暂停且匹配的记录
- **AND** 结果遵守 maxEntries/maxBytes，排序稳定，记录内容来自权威状态

#### Scenario: 无可靠命中

- **WHEN** 查询没有可靠匹配
- **THEN** 返回空结果并 abstain
- **AND** 不注入泛化、冲突、inactive、tombstoned 或暂停记录

### Requirement: 显式管理的一致体验

CLI 和 Dashboard 必须通过公开 Personal Memory 能力执行 remember、correct、forget、rollback、pause 和 sync。操作必须立即影响检索、Markdown 和管理投影，并以当前配置语言提供短确认或错误。

#### Scenario: 纠正与遗忘

- **WHEN** 用户显式纠正或遗忘一条记忆
- **THEN** 当前检索立即使用新内容或不再返回旧内容
- **AND** 旧证据和旧 Git 同步不能使已遗忘内容复活
- **AND** 用户可以查看历史并回滚，永久删除需要明确的管理操作

#### Scenario: 后台操作

- **WHEN** 后台评审、候选形成、重复计数或同步在运行
- **THEN** 默认不向普通消息输出过程
- **AND** 只有首次实际改变处理方式或发生冲突时才显示简短说明

### Requirement: 双语用户可见内容

自动生成的管理标题、类别、标签和原因必须使用配置语言；直接 CLI 输入的记忆正文必须保持用户原文。机器字段、schema、action 和 scope 保持稳定英文。

#### Scenario: 语言选择

- **WHEN** 配置语言为 `zh-CN` 或 `en`
- **THEN** 自动生成的用户可见内容分别使用中文或英文
- **AND** 直接输入正文不被静默翻译

### Requirement: CLI 与 Dashboard 同源

CLI 和 Dashboard 必须从同一个公开插件能力读取状态和执行管理动作，不能各自读取 Runtime state 或维护投影副本。JSON 输出必须稳定、可供脚本使用；普通文本不得直接 dump 内部状态。

#### Scenario: 同源管理

- **WHEN** 用户通过 CLI 修改记忆
- **THEN** Dashboard 后续读取到相同的权威状态、冲突、历史和同步状态
- **AND** 反向通过 Dashboard 修改也能被 CLI 读取

### Requirement: Markdown 与 Git 同步一致性

用户可读的 `profile.md` 和 `projects/<project-key>.md` 必须保持简洁、可编辑，并与 Runtime 状态确定性 reconciliation。Git remote 缺失、同步冲突或失败不得阻塞本地检索和管理。

#### Scenario: 手工编辑与同步失败

- **WHEN** 用户编辑、删除 Markdown，或专用 memory Git 同步失败
- **THEN** 下次管理/检索按确定性规则更新状态并保留必要历史/tombstone
- **AND** 本地记忆继续可用，返回清晰的非阻塞同步状态

## Non-Goals

- 不修改固定 `comet-memory` Skill，不实现 Skill 自进化。
- 不实现 workflow 生命周期触发、Entry/Plugin Bridge 接线或宿主调度。
- 不引入 embedding、向量数据库、知识图谱、托管账户或项目仓库记忆副本。

## 学习诊断和远程能力

CLI 与 Dashboard 使用同一公开 Provider 能力读取最近学习检查时间、所属 workflow/change、当前结果和简短原因。界面用可理解文字区分未检查、无合格观察、跳过、待重试、已形成候选、已晋级、暂停及不可用；开关开启不代表发生过学习。普通界面不展示原始 evidenceKeys、完整观察包或内部队列状态。

远程 Provider 必须读取远端权威状态。旧服务不支持诊断、认证失败、超时或返回无效数据时显示对应不可用原因，保留其他仍可用能力；不能伪造 learningEnabled 或学习成功，不能静默读取本地记忆代替远端。新增接口优先复用既有能力并保持旧服务兼容。

诊断只保存必要有界信息，不新增逐工具轨迹。任务正常消息仍沿用安静后台处理原则，用户主动查询和错误诊断能够获得真实状态。

### Scenario: 同一任务的诊断一致

通过 CLI 提交观察后打开 Dashboard，同一任务显示相同的时间、归属、当前结果和简短原因；跳过或待重试不会显示成晋级。

### Scenario: 远程不可用不伪造结果

远端支持诊断时读取真实值；不支持、超时或认证失败时显示不可用及原因，既不声称已开启/已学习，也不回退本地个人记忆。
