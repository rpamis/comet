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

Skill 缺失、超时、输出无效或被 Runtime 安全拒绝时，结果等价于安全 `skip`，主 workflow 继续。Native/Classic Guard 不依赖该 Skill。

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
