---
generated_from_state_version: 49
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 6
- 迭代: 3
- 验证器尝试次数: 1
- 完成时间: 2026-08-17T04:15:31.752Z
- 摘要: 独立 Verifier 已完成当前 HEAD 的父 Change、全部子 Change、实现、生成物、Runtime 检查和 Eval 复核；第 3 轮隔离环境全量测试在一次原生重试后通过，A1-A98 全部通过，可以进入用户确认后的 Archive。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：中文版和英文版 `comet-memory` 作为同一个第一方固定 Skill 随 Comet 安装，Classic、Native、Hotfix 和 Tweak 不复制独立判断规则。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A2 | passed | brief.md | A2：Skill 只读取版本化有界评审包并输出 `create/update/forget/skip`；它不能写文件、扫描完整仓库或修改任何 Skill、Agent 指令、Project Rules、Specs 或代码。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A3 | passed | brief.md | A3：Workflow Skill 提供少量会话证据，Runtime 补齐可信生命周期事实、语言、项目身份、相关记忆和预算；动作落盘前由 Runtime 校验。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A4 | passed | brief.md | A4：显式记住、纠正或遗忘可以立即处理；自动推断只在稳定成功检查点运行，没有有用内容时 `skip` 且状态与 Markdown 不增长。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A5 | passed | brief.md | A5：`zh-CN` 的自动记忆正文和用户可见标签为中文，`en` 为英文；明显错误语言的自动动作被拒绝，直接 CLI 文本保留原文。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A6 | passed | brief.md | A6：每个动作只写入一个 scope；同一观察不再同时生成 global 与 project 两条记录。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A7 | passed | brief.md | A7：一次隐式行为只形成候选；同一项目至少两个独立成功 Change 的一致证据只能激活 project 记忆，至少两个不同项目的一致证据才能自动激活 global 记忆；失败、取消、恢复和重试不虚增计数。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A8 | passed | brief.md | A8：同一 Change 的两个不同 candidateKey 可分别处理，同一 candidateKey 重试只处理一次。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A9 | passed | brief.md | A9：等价记忆优先合并或更新，矛盾证据进入 conflict，不由最后写入者静默覆盖；隐式行为不能自动替换用户明确保存的记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A10 | passed | brief.md | A10：用户明确 forget 后内容立即停止检索，旧同步和旧证据不能复活；用户仍可回滚或永久删除。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A11 | passed | brief.md | A11：secret、PII、提示注入、原始日志、完整 diff、完整 transcript 和任务流水账不会进入持久记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A12 | passed | brief.md | A12：旧 Memory state 与 `profile.md`、`projects/<project-key>.md` 可无损迁移，并继续读取、检索、修改和同步。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A13 | passed | brief.md | A13：检索保持有界且可解释，inactive、tombstoned、未解决冲突和暂停记录不注入；MVP 不依赖 embedding。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A14 | passed | brief.md | A14：CLI、Dashboard、Markdown、Skill 与 Git sync 使用同一权威状态，并以配置语言展示和管理记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A15 | passed | brief.md | A15：后台 Agent 可用时可非阻塞执行；不可用、超时、无效输出或插件失败时安全跳过，主工作流继续完成。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A16 | passed | brief.md | A16：在没有 active Comet workflow 时，用户可显式调用 Skill/CLI 记住、纠正或遗忘，但普通宿主聊天不会被全局拦截。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A17 | passed | brief.md | A17：自动记忆只保留未来可复用且不易重查的信息；命令成功、测试数量、Change/PR/Issue 摘要和可从仓库轻易发现的普通事实被跳过。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A18 | passed | brief.md | A18：Eval 使用同一任务集比较 no-memory、current-observe 与 semantic-review，并覆盖中英文和 Classic/Native。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A19 | passed | brief.md | A19：Eval 分别测量提取、动作、作用域、语言、安全、时间更新、检索、上下文成本和后续任务行为，不只测文件是否写入。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A20 | passed | brief.md | A20：semantic-review 相对 current-observe 提升有效记忆 precision 和后续任务成功率，且不提高有害保存、错误作用域、错误语言和旧记忆复活率。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A21 | passed | brief.md | A21：Eval 不达标时先调整证据、Skill 与合并规则，不用 embedding 或更大上下文掩盖问题。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A22 | passed | brief.md | A22：相关最小测试、Skill 契约测试、Runtime bundle 构建、lint、build、全量 test 和最终 Eval 均完成；中英文 Skill 同步后才写用户可见 Changelog。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A23 | passed | brief.md | A23：显式记忆、纠正和遗忘给出简短确认；后台复盘和候选形成默认静默；只有记忆首次实际改变处理方式或发生冲突时才简短提示，不显示 Runtime、候选 ID 或证据计数。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A24 | passed | specs/comet-memory-skill/spec.md | `comet-memory` 是随 Comet 发布的第一方固定 Skill，为 Classic、Native、Hotfix、Tweak 和用户显式记忆操作提供同一套语义判断。它只负责判断“什么值得长期记住以及应执行什么动作”，不负责触发、取证、验证、持久化、同步或检索。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A25 | passed | specs/comet-memory-skill/spec.md | 该 Skill 不是 Skill 自进化机制。它不得修改自身或其他 Skill、AGENTS.md、CLAUDE.md、Project Rules、Specs、代码或 Runtime 状态。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A26 | passed | specs/comet-memory-skill/spec.md | Skill 只接受 Runtime 生成的 `comet.memory.review.v1` 有界评审包。评审包包含配置语言、workflow、Change、checkpoint、项目身份、显式请求、用户纠正、可信成功结果、少量相关现有记忆和固定预算；不包含完整 transcript、完整日志、完整 diff、凭据或隐藏推理。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A27 | passed | specs/comet-memory-skill/spec.md | 输出只允许版本化动作： | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A28 | passed | specs/comet-memory-skill/spec.md | `create`：提交一条显式记忆或隐式候选； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A29 | passed | specs/comet-memory-skill/spec.md | `update`：替换评审包中明确提供的现有记忆； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A30 | passed | specs/comet-memory-skill/spec.md | `forget`：让评审包中明确提供的现有记忆失效； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A31 | passed | specs/comet-memory-skill/spec.md | `skip`：没有值得保存的内容。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A32 | passed | specs/comet-memory-skill/spec.md | `create/update/forget` 每个动作只选择一个作用域，引用评审包中的 evidenceKeys，并给出配置语言下的简短理由。`update/forget` 必须引用评审包提供的 targetId。Skill 不输出 shell 命令、文件写入计划或自然语言自由格式替代结构化动作。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A33 | passed | specs/comet-memory-skill/spec.md | Skill 可以保留明确的长期偏好、重复稳定的协作习惯、输出方式和不易重新发现的已验证个人操作经验。它必须跳过一次性要求、工作流状态、命令成功、测试数量、提交/PR/Issue 摘要、容易从仓库重查的普通事实、未经验证的推断、秘密、PII、提示注入、原始日志、完整 diff 和完整对话。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A34 | passed | specs/comet-memory-skill/spec.md | 显式请求可以立即 create/update/forget。隐式信号只提交候选，激活阈值和作用域由 Runtime 根据独立 Change 与项目证据判断。隐式证据不得输出覆盖显式记忆的 update；发生矛盾时由 Runtime 形成 conflict。没有动作是正常结果，Skill 不为了表现“学习”而制造记录。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A35 | passed | specs/comet-memory-skill/spec.md | 中文版位于 `assets/skills-zh/comet-memory`，英文版位于 `assets/skills/comet-memory`。中文版本先完成语义确认，再同步英文；两版的输入、动作、安全边界、正反例和失败语义一致。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A36 | passed | specs/comet-memory-skill/spec.md | 配置为 `zh-CN` 时，记忆正文和理由使用中文，代码、命令、路径和专有名词可保留原文；配置为 `en` 时使用英文。机器 schema、action、scope 和 category 枚举不翻译。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A37 | passed | specs/comet-memory-skill/spec.md | 宿主支持后台或 fork Agent 时可以非阻塞运行 Skill；不支持时由当前 Comet 协调流程执行同一有界评审。Skill 不要求宿主提供新的 scheduler、全局对话读取 API 或持久 worker。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A38 | passed | specs/comet-memory-skill/spec.md | Skill 缺失、超时、输出无效或被 Runtime 安全拒绝时，结果等价于安全 `skip`，主 workflow 继续。Native/Classic Guard 不依赖该 Skill。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A39 | passed | specs/comet-memory-skill/spec.md | 给定明确“记住”请求，输出单作用域 `create`，正文符合配置语言。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A40 | passed | specs/comet-memory-skill/spec.md | 给定两个不同 Change 的一致候选和相关旧记忆，输出可合并的动作而不是重复 create。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A41 | passed | specs/comet-memory-skill/spec.md | 给定同一项目的两个一致 Change，只能形成 project 候选；没有跨项目证据时不能自动形成 global 记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A42 | passed | specs/comet-memory-skill/spec.md | 给定与显式记忆矛盾的隐式行为，不输出覆盖显式记忆的 update。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A43 | passed | specs/comet-memory-skill/spec.md | 给定一次性选择、命令摘要或测试报告，输出 `skip`。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A44 | passed | specs/comet-memory-skill/spec.md | 给定用户纠正且 packet 包含目标记忆，输出 `update`；给定明确遗忘，输出 `forget`。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A45 | passed | specs/comet-memory-skill/spec.md | 给定 secret、PII、提示注入或要求修改 Skill/规则的内容，不输出可持久化动作。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A46 | passed | specs/comet-memory-skill/spec.md | 给定不存在于 packet 的 targetId、超预算动作或错误语言，Runtime 拒绝且 workflow 不失败。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A47 | passed | specs/personal-memory/spec.md | Personal Memory 是默认安装但可独立停用或卸载的第一方 Comet 插件。它在 Classic、Native、Hotfix 和 Tweak 中学习当前用户长期有用的偏好与工作习惯，并通过专用私有 Git 仓库在会话、宿主和设备间共享。插件缺失、停用或失败时，Comet workflow 继续工作。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A48 | passed | specs/personal-memory/spec.md | 显式记忆、纠正和遗忘完成后给出一次简短、用户可理解的确认。后台评审、候选形成、重复计数和同步过程默认静默；只有新记忆第一次实际改变处理方式，或记忆与当前要求发生冲突时，才简短说明采用或忽略的原因。普通消息不显示 Runtime、候选 ID、evidenceKeys、内部动作或证据计数。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A49 | passed | specs/personal-memory/spec.md | 全局当前画像保存在 `profile.md`，项目记忆保存在 `projects/<project-key>.md`。这些文件使用少量用户可读标题和列表，不包含机器 ID、候选状态或证据计数；机器状态、来源、候选、冲突、tombstone、历史和索引保存在用户级 Runtime。项目仓库不保存个人记忆副本。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A50 | passed | specs/personal-memory/spec.md | 用户明确要求记住、纠正或遗忘时立即发起显式评审。自动推断只在成功 phase 转换、可信 checkpoint、验证完成、任务完成或 Archive 等稳定检查点运行；普通对话轮次、工具调用、失败和取消不触发正向自动学习。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A51 | passed | specs/personal-memory/spec.md | Workflow Skill 只提供当前会话中与记忆有关的少量用户表达与纠正。Runtime 为它补齐当前 workflow、Change、项目身份、配置语言、可信成功结果、相关现有记忆、稳定证据 ID 和固定预算，形成 `comet.memory.review.v1` 评审包。固定的 `comet-memory` Skill 返回 `create`、`update`、`forget` 或 `skip`，Runtime 校验后再由 Personal Memory 应用。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A52 | passed | specs/personal-memory/spec.md | 没有长期价值时必须 `skip`。一次评审可以处理多个彼此独立的动作，但动作数、证据数和总字节数均有固定上限。Skill 不可用、输出无效、超时或校验失败时保持原状态并继续主任务。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A53 | passed | specs/personal-memory/spec.md | 显式记忆立即生效并保持最高优先级。隐式记忆第一次只形成候选，至少两个独立成功 Change 的一致、无冲突证据后才能激活。同一 Change 的恢复、重试、跨会话或 Hotfix/Tweak 升级只更新同一证据，不增加独立计数。隐式稳定行为与显式记忆冲突时只进入 conflict，不能自动替换显式内容；只有用户明确纠正、手动编辑或删除才能改变显式记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A54 | passed | specs/personal-memory/spec.md | 自动记忆只保存未来任务仍有用的用户偏好、协作习惯、输出方式和不易从仓库重新发现的已验证个人操作经验。一次性要求、命令和 Change 流水账、测试数量、提交/PR/Issue 摘要、容易从源码或配置重查的普通事实、猜测、原始日志、完整 diff 和完整 transcript 必须跳过。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A55 | passed | specs/personal-memory/spec.md | 自动内容使用当前 active workflow 的配置语言。`zh-CN` 的正文、理由、Markdown 标题、类别和来源标签为中文；`en` 使用英文。代码、命令、路径和专有名词可以保留原文，机器枚举保持英文。明显不符合配置语言的自动动作不落盘。用户通过 CLI 或直接编辑 Markdown 提供的文本保留原文。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A56 | passed | specs/personal-memory/spec.md | 每个动作只选择 `global` 或 `project` 一个作用域。用户明确指定的作用域优先；未明确时，同一项目内两个独立成功 Change 的一致证据只能激活 project 记忆，至少两个不同项目出现一致行为后才能自动激活 global 记忆，不对同一动作双写。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A57 | passed | specs/personal-memory/spec.md | 项目身份基于稳定 Git 项目标识；同一仓库的 worktree、目录移动和同一远端重新克隆共享项目记忆，fork 和不同仓库默认隔离。作用域判定不得依赖本地绝对路径、宿主会话 ID 或进程 ID。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A58 | passed | specs/personal-memory/spec.md | 评审观察至少用项目身份、Change ID 和 candidateKey 幂等。同一 Change 可以提交多个不同 candidateKey，同一 candidateKey 的重复提交只应用一次。语义身份还包含规范化作用域、项目、类别和 selectors，用于跨 Change 合并等价候选。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A59 | passed | specs/personal-memory/spec.md | 等价内容优先合并或更新，不产生近义重复。矛盾证据进入 conflict，冲突内容停止正常检索，不由最后写入者静默覆盖。隐式候选不得以 `update` 覆盖显式记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A60 | passed | specs/personal-memory/spec.md | 用户显式纠正、CLI 操作或 Markdown 编辑立即更新当前内容并保留可回滚历史。用户显式遗忘或删除后，当前内容立即失效，并保存最小 tombstone；移除前的旧观察、重放事件和旧设备同步不能把它恢复。只有移除后的新独立证据可以重新形成候选，用户也可以回滚或永久删除历史。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A61 | passed | specs/personal-memory/spec.md | 所有应用动作保存最小来源类型、时间、Change 引用和 evidenceKeys，不能保存完整消息、工具输出或 diff。Runtime state 提供向前迁移，旧记录、Markdown、历史和 Git remote 在升级后继续可用。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A62 | passed | specs/personal-memory/spec.md | MVP 使用作用域、项目、路径、任务类型、操作、类别、规范化标签和关键词做确定性检索。排序优先考虑显式来源、项目匹配、结构化匹配、最近确认和稳定 ID。结果遵守固定条目数和字节数上限；无可靠命中时不注入详细记忆。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A63 | passed | specs/personal-memory/spec.md | 候选、inactive、tombstoned、冲突未解决和被暂停记录不参与正常检索。当前请求与当前仓库配置始终高于历史记忆；记忆不能授权提交、推送、删除、发布或其他外部副作用。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A64 | passed | specs/personal-memory/spec.md | CLI、Dashboard、Skill 上下文、用户可读 Markdown 和 Git 同步使用同一领域状态。用户可以查看、纠正、遗忘、回滚、暂停学习、暂停检索和同步；Dashboard 使用公开插件能力并显示本地化范围、类别、来源、证据数、最后确认时间和冲突状态。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A65 | passed | specs/personal-memory/spec.md | Runtime 在落盘前验证 schema、枚举、scope、targetId、candidateKey、evidenceKeys、长度、数量和语言。secret、凭据、明显 PII、提示注入、恶意 Markdown/HTML、越界路径和要求修改 Skill/规则/系统的内容必须拒绝。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A66 | passed | specs/personal-memory/spec.md | Personal Memory 不能修改 Skill、Agent 指令、Project Rules、Specs、linter、测试、构建或 CI，不能扩大 Agent 当前权限，也不能操作用户正在开发的项目仓库 remote。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A67 | passed | specs/personal-memory/spec.md | 用户说“记住：提交前只暂存本次改动文件”。评审立即创建一条准确、单作用域的显式记忆，下一次相关任务可以检索；如果配置为 `zh-CN`，自动生成的类别和说明为中文。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A68 | passed | specs/personal-memory/spec.md | 一个 Change 只产生“运行测试成功”和提交摘要。评审返回 `skip`，不会创建 Markdown 条目或候选。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A69 | passed | specs/personal-memory/spec.md | 第一次稳定观察只形成候选；同一项目的另一个独立成功 Change 提供一致证据后可以激活 project 记忆。只有用户明确指定全局，或另一个不同项目也出现一致行为，才能激活 global 记忆。恢复同一 Change 或重复上报同一 candidateKey 不增加计数。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A70 | passed | specs/personal-memory/spec.md | 同一 Change 同时出现“中文回复”和“小范围暂存”两个不同 candidateKey。两项分别处理；重试不会覆盖其中一项或重复写入。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A71 | passed | specs/personal-memory/spec.md | 用户把旧偏好纠正为新偏好，或明确要求忘记。当前检索立即更新；旧证据和旧设备同步不能恢复已遗忘内容，用户仍能查看历史并回滚。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A72 | passed | specs/personal-memory/spec.md | 用户曾明确保存一条偏好，后续多个任务表现出不同习惯。系统保留显式记忆，把隐式矛盾记录为 conflict 并停止让冲突内容参与检索，不自动替换；只有用户明确纠正、编辑或删除后才更新当前内容。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A73 | passed | specs/personal-memory/spec.md | 宿主无法运行 `comet-memory`、Skill 输出无效 JSON 或 Git remote 不可用。Runtime 保持原记忆可用并返回非阻塞诊断，当前 workflow 正常完成。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A74 | passed | specs/self-evolving-memory-eval/spec.md | Comet 必须用可复现评估证明语义记忆比当前命令摘要观察更准确、更少噪声，并确实改善后续任务。状态机测试和“成功写入文件”不能替代记忆质量评估。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A75 | passed | specs/self-evolving-memory-eval/spec.md | 同一任务集至少运行： | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A76 | passed | specs/self-evolving-memory-eval/spec.md | `no-memory`：不形成或检索记忆； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A77 | passed | specs/self-evolving-memory-eval/spec.md | `command-summary-observe`：保持当前基线行为； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A78 | passed | specs/self-evolving-memory-eval/spec.md | `semantic-comet-memory-review`：使用新 Skill、Runtime 动作和检索闭环。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A79 | passed | specs/self-evolving-memory-eval/spec.md | 每个 treatment 使用冻结任务、相同基础模型/Agent 配置和可追溯版本；报告记录 Skill、Runtime、数据集和评分规则 hash。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A80 | passed | specs/self-evolving-memory-eval/spec.md | 数据集同时覆盖 `zh-CN`/`en` 与 Classic/Native，并包含：显式创建、重复隐式创建、一次性内容跳过、近义合并、纠正更新、明确遗忘、global/project 作用域、矛盾证据、时间更新、secret/PII/prompt injection、多会话检索、无相关记忆时 abstain、同 Change 多候选、重复事件幂等和记忆对后续任务行为的影响。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A81 | passed | specs/self-evolving-memory-eval/spec.md | 任务既包含确定性期望，也包含需要语义判断的样例。语义样例由独立 Judge 根据冻结 rubric 评分；安全、schema、scope、语言、幂等、文件变化和下游测试优先使用确定性验证。 | 当前 frozen rubric judge 已记录 rubric hash；其确定性实现的语义泛化风险已作为最终验证风险保留。 |
| A82 | passed | specs/self-evolving-memory-eval/spec.md | extraction precision / recall； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A83 | passed | specs/self-evolving-memory-eval/spec.md | harmful or noisy save rate； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A84 | passed | specs/self-evolving-memory-eval/spec.md | skip accuracy； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A85 | passed | specs/self-evolving-memory-eval/spec.md | create/update/forget operation accuracy； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A86 | passed | specs/self-evolving-memory-eval/spec.md | scope accuracy； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A87 | passed | specs/self-evolving-memory-eval/spec.md | language compliance； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A88 | passed | specs/self-evolving-memory-eval/spec.md | deduplication/consolidation accuracy； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A89 | passed | specs/self-evolving-memory-eval/spec.md | stale-memory resurrection rate； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A90 | passed | specs/self-evolving-memory-eval/spec.md | retrieval precision / recall； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A91 | passed | specs/self-evolving-memory-eval/spec.md | downstream task success delta； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A92 | passed | specs/self-evolving-memory-eval/spec.md | injected context bytes/tokens； | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A93 | passed | specs/self-evolving-memory-eval/spec.md | latency、超时和失败降级率。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A94 | passed | specs/self-evolving-memory-eval/spec.md | 报告必须分开展示“形成质量”“检索质量”和“后续行为”，不能用单个综合分数掩盖安全或作用域退化。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A95 | passed | specs/self-evolving-memory-eval/spec.md | `semantic-comet-memory-review` 必须相对 `command-summary-observe` 提高有效记忆 precision 和后续任务成功率，并且不得提高 harmful/noisy save、错误 scope、错误语言或 stale resurrection。上下文预算和延迟必须有界。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A96 | passed | specs/self-evolving-memory-eval/spec.md | 具体数值阈值在首次基线测量后固化到 Eval 配置和说明中，不能事后按新实现结果修改。未达到门槛时先调整证据包、Skill 判断和合并规则；没有检索证据前不引入 embedding、向量数据库或更大上下文。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A97 | passed | specs/self-evolving-memory-eval/spec.md | Eval 保存每个任务的输入摘要、期望动作、实际动作、持久状态差异、检索结果、后续任务结果、评分证据和失败分类，但不保存真实凭据、用户私有对话或无界日志。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |
| A98 | passed | specs/self-evolving-memory-eval/spec.md | 失败至少归类为 evidence、extraction、action、validation、persistence、retrieval、language、scope、safety、host-integration 或 downstream-behavior，便于确定应修 Skill、Runtime 还是检索。 | 独立 Verifier 已依据当前 HEAD、实现、测试、Runtime 检查与 Eval 证据确认该验收项通过。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| parent format check | format:check | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 16308 ms |
| parent lint and architecture | lint | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 9215 ms |
| parent generated runtime assets | check:generated | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 2045 ms |
| parent full build | build | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 34367 ms |
| parent semantic memory eval | scripts/benchmark/semantic-memory-eval.mjs | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 670 ms |
| parent full test with isolated user configuration and one retry | -NoProfile -ExecutionPolicy Bypass -File D:\Project\Comet\.comet\runtime\parent-full-test-clean-v13.ps1 | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 777531 ms |
| parent diff check | diff --check | .comet/runtime/parent-verify-worktree-v8 | passed | 0 | 216 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- Eval Judge 为进程内确定性 frozen rubric，不能等同于外部模型或人工语义复核；该风险不阻塞本 Change。
- 全量 Vitest 在隔离 HOME/USERPROFILE 下运行，并允许测试框架对偶发 Windows 并发清理失败进行一次原生重试，避免宿主配置污染和已知环境抖动。
- 最终 benchmark 必须在当前 HEAD build 后运行，避免使用陈旧 dist。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | recovery | — | 父级 Verify 发现 3 个 Dashboard 文件格式不合规，且 Windows 对 eval 下两个历史 pytest 临时目录拒绝 scandir；返回 Build 做最小修复后重新验证。 | 2026-08-16T20:20:02.977Z |
| 1 | 2 | 1 | recovery | — | 第二轮 Verify 发现 domains/dashboard/web/index.html 也受 Windows 换行影响；全量测试仅因干净 worktree 缺少 Python yaml 环境失败，已定位为验证环境依赖。返回 Build 补 HTML 换行契约并让干净 worktree 复用现有 eval Python 环境后重验。 | 2026-08-16T20:44:48.201Z |
| 1 | 3 | 1 | fail | A3, A4, A5, A17, A18, A19, A20, A22, A23, A24, A34, A37, A48, A50, A51, A52, A54, A55, A65, A67, A74, A75, A76, A78, A79, A81, A82, A83, A84, A85, A89, A90, A91, A93, A94, A95, A96, A97, A98 | 独立 Verifier 判定 fail：生产 Runtime 尚未把 bounded comet-memory Skill review、action validator 与持久化闭环接入自动路径；Eval 也缺少独立 no-memory treatment、完整质量指标、阈值冻结和独立 Judge。 | 2026-08-16T21:20:53.552Z |
| 1 | 4 | 0 | recovery | — | Native child declarations changed | 2026-08-16T21:52:22.121Z |
| 2 | 1 | 1 | fail | A11, A24, A34, A37, A44, A51, A65, A67, A94, A96 | Independent verification found eight failed acceptance items and two items requiring stronger evidence. Return the parent Change to Build for a focused repair before Archive. | 2026-08-16T22:27:36.521Z |
| 2 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-16T22:27:56.549Z |
| 3 | 1 | 1 | recovery | — | 修复 Verify 计划中的本机权限残留导致的打包测试假失败，使用干净 worktree 重新执行完整检查 | 2026-08-16T23:57:26.702Z |
| 3 | 2 | 1 | fail | A19, A20, A24, A51, A91, A93, A95 | 独立 verifier 发现 7 个必须修复的真实缺口：CLI 与 workflow 没有完全共享 explicit review 闭环，workflow 未传入用户证据，Eval 的 downstream 与 latency 仍是合成或不完整测量。先创建最小 repair Child，再进入最终 Verify。 | 2026-08-17T00:12:22.820Z |
| 3 | 3 | 0 | recovery | — | Native child declarations changed | 2026-08-17T00:17:41.104Z |
| 4 | 1 | 1 | fail | A4, A5, A17, A18, A20, A22, A23, A24, A33, A34, A36, A43, A48, A51, A54, A55, A74, A75, A76, A77, A81, A95 | 当前实现完成了有界记忆状态、显式操作、永久遗忘、跨 workflow 证据和真实 semantic retrieve，但尚未达到目标的语义筛选、固定 Skill 执行和可信对照 Eval 基线。父 Change 返回 Build 修复，不进入 Archive。 | 2026-08-17T01:41:03.342Z |
| 4 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-17T01:42:41.389Z |
| 5 | 1 | 0 | recovery | — | 最终 Eval 发现 downstream 成功率口径把需要用户补充偏好的基线误判为成功；需要补充基线完成判定并重跑冻结阈值 | 2026-08-17T02:43:13.460Z |
| 5 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-17T02:53:05.663Z |
| 6 | 1 | 1 | execution-error | — | Native Verifier response was invalid: Native verification cannot pass before every required check succeeds | 2026-08-17T03:33:54.045Z |
| 6 | 1 | 1 | recovery | — | 验证环境问题已隔离，重新建立干净的父级 Builder candidate | 2026-08-17T03:35:13.194Z |
| 6 | 2 | 0 | recovery | — | 定向复测通过，回退并重新建立隔离的父级验证候选 | 2026-08-17T03:56:53.737Z |
| 6 | 3 | 1 | pass | — | 独立 Verifier 已完成当前 HEAD 的父 Change、全部子 Change、实现、生成物、Runtime 检查和 Eval 复核；第 3 轮隔离环境全量测试在一次原生重试后通过，A1-A98 全部通过，可以进入用户确认后的 Archive。 | 2026-08-17T04:15:31.752Z |



## 结论

独立 Verifier 已完成当前 HEAD 的父 Change、全部子 Change、实现、生成物、Runtime 检查和 Eval 复核；第 3 轮隔离环境全量测试在一次原生重试后通过，A1-A98 全部通过，可以进入用户确认后的 Archive。
