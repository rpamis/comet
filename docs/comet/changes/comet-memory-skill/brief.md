# 目标

提供一个随 Comet 安装的、固定且双语一致的第一方 `comet-memory` Skill，供 Classic、Native、Hotfix 和 Tweak 共用。Skill 只负责基于 Runtime 提供的有界 `MemoryReviewPacket` 做语义筛选并返回版本化动作，不负责持久化、扫描仓库或修改自身。

# 范围

- 新增 `assets/skills-zh/comet-memory/SKILL.md` 与 `assets/skills/comet-memory/SKILL.md`。
- 新增两种语言对应的 `agents/openai.yaml`，声明固定输入、输出和安全边界。
- 将两个语言版本纳入 Skill 资产清单、发现/安装契约和发布包校验。
- 定义并测试 `comet.memory.review.v1` → `comet.memory.actions.v1` 的最小调用协议：动作只能是 `create`、`update`、`forget`、`skip`。
- 约束 Skill 只使用 packet 中的用户证据、可信检查点、相关记忆和预算；没有可靠长期价值时返回 `skip`。
- 固定显式记忆最高优先级、单一 scope、配置语言、候选/冲突/安全过滤和低打扰交互的提示语义。
- 提供中英文正反例，覆盖显式操作、自动候选、噪声跳过、冲突和安全拒绝。

# 非目标

- 不在 Skill 中写入 Markdown、Runtime state、Git 仓库或其他文件。
- 不读取完整 transcript、日志、diff、仓库、Skill 目录或 Project Rules。
- 不实现 Personal Memory 状态迁移、Runtime 校验、CLI、Dashboard 或 Classic/Native 生命周期桥接。
- 不自动修改 Skill、AGENTS.md、CLAUDE.md、Project Rules、Specs、测试、构建或 CI。
- 不让 Skill 自我进化、改写提示词或改变动作 schema；模型输出必须服从固定契约。

# 验收示例

- A1：中文和英文 Skill 都存在、可发现、可安装，且表达相同的决策边界。
- A2：给定合法 packet 时只返回固定 schema 的 action envelope；非法/缺失 packet 时不猜测、不写文件。
- A3：用户明确“记住/纠正/忘掉”优先生成对应动作；用户明确输入不被静默翻译。
- A4：一次性命令、测试、提交、Issue/PR 摘要、可从仓库重查的事实和无后续收益的内容返回 `skip`。
- A5：自动记忆只在稳定成功证据下提取；project/global 作用域不混写，显式记忆不被隐式候选覆盖。
- A6：配置为 `zh-CN` 时正文、类别、标签、原因使用中文；`en` 时使用英文；代码、路径和机器枚举可保留原文。
- A7：Skill 不输出 secret、PII、日志、diff、prompt injection、规则修改请求或完整对话内容。
- A8：候选、冲突、动作数量和预算由 packet/Runtime 约束，Skill 不显示内部 ID、证据计数或 Runtime 细节给最终用户。
- A9：Skill 文本和契约测试证明 Classic、Native、Hotfix、Tweak 只共用这一份判断规则。

# 约束与不变量

- Skill 是固定第一方资产，安装后不可由记忆动作修改。
- Runtime 是 schema、scope、language、safety、target、evidence、budget 和持久化的最终裁决者；Skill 的输出不具备写入权限。
- `MemoryReviewActionSet` 必须使用 `comet.memory.actions.v1`，不得返回裸数组或未知动作。
- `skip` 是正常成功结果，且不应暗示用户已经保存了记忆。
- 只能输出一个动作 scope；global 自动推断必须尊重 packet 提供的跨项目证据，Skill 不自行创造证据。
- `actions` 数量不得超过 packet `budget.maxActions`；除单个 `skip` 外，不得在同一 action set 混用 `global` 与 `project`。
- 所有用户可见文字遵循 packet language；机器枚举 `schema/action/scope` 保持稳定英文。

# 决策

- 使用一份双语共享 Skill，而不是在 Classic/Native/Hotfix/Tweak 中复制判断逻辑。
- 使用“输入包最小化 + 输出动作固定化 + Runtime 再校验”的边界；Skill 不直接调用 Personal Memory API。
- 中文版先实现并通过契约测试，再同步英文版；两种语言只改变说明文字，不改变 schema、动作和安全边界。
- Skill 的后台评审保持静默；显式操作由外部 workflow/CLI 提供简短确认，首次实际采用或冲突提示由集成层处理。

# 待解决问题

- 无。生命周期触发、Runtime 执行和用户界面由后续 child 负责。

# 验证预期

- 运行双语 Skill 资产、manifest、openai.yaml 和安装发现契约测试。
- 运行 packet/action schema 例子测试，确认输出为 envelope、动作有界、`skip` 不写文件。
- 用中英文、显式/隐式、噪声/安全/冲突/单 scope 场景做固定文本回归测试。
- 对 Skill 内容运行 Prettier/仓库格式检查；不运行与本 child 无关的全量 Runtime 测试。
