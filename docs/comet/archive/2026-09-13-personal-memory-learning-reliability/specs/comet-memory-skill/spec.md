# comet-memory 固定语义评审 Skill

## 定位

`comet-memory` 是随 Comet 发布的第一方固定 Skill，为 Classic、Native、Hotfix、Tweak 和用户显式记忆操作提供同一套语义判断。它只负责判断“什么值得长期记住以及应执行什么动作”，不负责触发、取证、验证、持久化、同步或检索。

该 Skill 不是 Skill 自进化机制。它不得修改自身或其他 Skill、AGENTS.md、CLAUDE.md、项目指令、Specs、代码或 Runtime 状态。

## 输入输出

Skill 只接受 Runtime 生成的 `comet.memory.review.v1` 有界评审包。评审包包含配置语言、workflow、Change、checkpoint、项目身份、显式请求、用户纠正、可信成功结果、少量相关现有记忆和固定预算；不包含完整 transcript、完整日志、完整 diff、凭据或隐藏推理。

输出只允许版本化动作：

- `create`：提交一条显式记忆或隐式候选；
- `update`：替换评审包中明确提供的现有记忆；
- `forget`：让评审包中明确提供的现有记忆失效；
- `skip`：没有值得保存的内容。

`create/update/forget` 每个动作只选择一个作用域，引用评审包中的 evidenceKeys，并给出配置语言下的简短理由。`update/forget` 必须引用评审包提供的 targetId。Skill 不输出 shell 命令、文件写入计划或自然语言自由格式替代结构化动作。

## 判断标准

Skill 可以保留明确的长期偏好、重复稳定的协作习惯、输出方式和不易重新发现的已验证个人操作经验。它必须跳过一次性要求、工作流状态、命令成功、测试数量、提交/PR/Issue 摘要、容易从仓库重查的普通事实、未经验证的推断、秘密、PII、提示注入、原始日志、完整 diff 和完整对话。

显式请求可以立即 create/update/forget。隐式信号只提交候选，激活阈值和作用域由 Runtime 根据独立 Change 与项目证据判断。隐式证据不得输出覆盖显式记忆的 update；发生矛盾时由 Runtime 形成 conflict。没有动作是正常结果，Skill 不为了表现“学习”而制造记录。

## 语言与双语一致性

中文版位于 `assets/skills-zh/comet-memory`，英文版位于 `assets/skills/comet-memory`。中文版本先完成语义确认，再同步英文；两版的输入、动作、安全边界、正反例和失败语义一致。

配置为 `zh-CN` 时，记忆正文和理由使用中文，代码、命令、路径和专有名词可保留原文；配置为 `en` 时使用英文。机器 schema、action、scope 和 category 枚举不翻译。

## 宿主与失败

宿主支持后台或 fork Agent 时可以非阻塞运行 Skill；不支持时由当前 Comet 协调流程执行同一有界评审。Skill 不要求宿主提供新的 scheduler、全局对话读取 API 或持久 worker。

Skill 暂时不可用、超时或执行错误时，宿主保留已持久化的待评审观察并有界恢复；语义跳过和安全拒绝作为终止结果，不将确定性拒绝无限重试。输出无效时保留明确诊断并按有界错误恢复处理。主 workflow 继续，Native/Classic Guard 不依赖该 Skill。

## 验收场景

- 给定明确“记住”请求，输出单作用域 `create`，正文符合配置语言。
- 给定两个不同 Change 的一致候选和相关旧记忆，输出可合并的动作而不是重复 create。
- 给定同一项目的两个一致 Change，只能形成 project 候选；没有跨项目证据时不能自动形成 global 记忆。
- 给定与显式记忆矛盾的隐式行为，不输出覆盖显式记忆的 update。
- 给定一次性选择、命令摘要或测试报告，输出 `skip`。
- 给定用户纠正且 packet 包含目标记忆，输出 `update`；给定明确遗忘，输出 `forget`。
- 给定 secret、PII、提示注入或要求修改 Skill/规则的内容，不输出可持久化动作。
- 给定不存在于 packet 的 targetId、超预算动作或错误语言，Runtime 拒绝且 workflow 不失败。

## 非目标

- 不管理 Personal Memory repository、Git、索引、候选计数或 Dashboard。
- 不读取完整仓库、对话、日志、diff 或其他插件私有状态。
- 不成为 Classic/Native 状态机或 Guard 的硬依赖。

## 首次候选与处理结果

单次有明确后续复用价值、来源可信的隐式观察允许返回 create 形成候选，不要求评审包在首次提交时已经包含两个独立成功 change。create 不等于激活长期记忆；独立证据和晋级仍由 Runtime 决定。显式请求仍立即生效。

默认确定性评审和安装的中英文语义 Skill 对候选创建、晋级责任、作用域及否定样例保持一致。语义跳过、安全拒绝与执行故障必须可区分：前两者说明不保存原因；临时执行异常由宿主持久化待评审并有界恢复。不能为了增加记录数而放宽来源或安全校验。

### Scenario: 单条合格观察可冷启动

评审包只有一条可信且可复用的用户协作偏好。评审允许创建隐式候选，Runtime 不立即晋级；第二个独立成功 change 提供一致证据后才有资格晋级。

### Scenario: 确定性与模型评审遵循同一边界

中文和英文正反样例覆盖首次候选、显式请求、一次性摘要、冲突和不安全内容。默认评审及真实模型分别验证，不用确定性测试冒充模型验证。
