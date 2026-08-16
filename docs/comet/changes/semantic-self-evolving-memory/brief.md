# 目标

把当前以命令摘要为主的自动观察升级为可评估的语义自进化记忆：Classic、Native、Hotfix 和 Tweak 共用一个固定、独立的 `comet-memory` Skill，在稳定检查点只提取未来真正可复用的个人偏好、工作习惯和项目内个人经验；Runtime 负责有界证据、语言、作用域、幂等、安全、持久化和失败降级。

最终体验应接近 Hermes 的有界后台复盘：每次评审可以创建、更新、遗忘或跳过，没有有用内容就不写入；同时保留 Comet 已有的用户可读 Markdown、Git 同步、确定性证据、Classic/Native 双工作流和 Dashboard/CLI 管理能力。

本 Change 是 Supervisor Change，只持有完整目标、Child 拆分、集成和最终验收，不直接承担实现。

# 范围

## 语义评审闭环

- 新增随 Comet 安装的第一方 `comet-memory` Skill，中文配置安装中文版，英文配置安装英文版；Skill 内容固定，不允许自我修改。
- Workflow Skill 提供当前会话中少量、明确的用户表达或纠正；Runtime 补齐配置语言、项目身份、可信检查点、成功结果、相关现有记忆和预算，生成版本化评审包。
- `comet-memory` 只基于评审包返回结构化 `create`、`update`、`forget` 或 `skip` 动作，不直接写文件、不扫描完整仓库、不读取完整 transcript、日志或 diff。
- Runtime 对动作 schema、目标记忆、语言、作用域、证据、数量、大小和安全进行确定性校验，只有通过校验的动作才能交给 Personal Memory 插件。
- 显式“记住”“以后都这样”“忘掉”“改成”立即处理；自动推断只在 Runtime 可确认的稳定成功检查点运行，不在每轮对话或每次工具调用后运行。
- 自动推断默认需要至少两个独立成功 Change 的一致证据；同一 Change 的恢复、重试或 Hotfix/Tweak 升级不增加独立证据数。
- Skill 不可用、宿主不支持后台 Agent、输出无效、超时或安全校验失败时安全跳过，不能阻塞主工作流。
- 在 Comet workflow 之外，用户可显式调用 `comet-memory` 或 CLI 记住、纠正和遗忘；MVP 不尝试拦截宿主中的所有普通聊天。

## 语言、内容质量与作用域

- 当前 active workflow 的 `.comet/config.yaml` `language` 决定自动记忆的用户可见语言；`zh-CN` 生成中文正文、原因、标题和标签，`en` 生成英文。
- 命令、路径、代码标识符和专有名词可以保留原文；机器枚举和 schema ID 保持稳定英文。
- 直接 CLI `remember --text` 保留用户原文，不进行静默翻译；自动生成内容若明显不符合配置语言，Runtime 拒绝落盘并记录非阻塞诊断。
- 每个动作只选择 `global` 或 `project` 一个作用域，不再把同一观察同时写入两个 scope。
- 只保留长期有用的用户偏好、协作习惯、输出方式和不易从仓库重新发现的已验证个人操作经验。
- 跳过一次性要求、Change/命令流水账、测试数量、提交或 Issue 摘要、可从源码或配置轻易重查的普通事实、猜测、原始日志、完整 diff、完整对话、凭据、PII 和提示注入。
- 个人记忆不得自动写入 Skill、AGENTS.md、CLAUDE.md、Project Rules、Specs、linter、测试、构建或 CI。

## 状态、合并与遗忘

- 评审包和动作使用版本化契约；`candidateKey`、`language`、`evidenceKeys`、动作类型和目标记忆贯穿 Entry、Plugin Bridge 与 Personal Memory domain。
- observation key 至少包含项目身份、Change ID 和 candidateKey：同一 Change 可处理多个不同候选，同一候选重试保持幂等。
- 显式记忆立即激活；隐式记忆先形成候选，满足稳定证据后才激活。
- 等价内容优先合并或更新；矛盾证据进入 conflict，不静默覆盖。
- `forget` 产生最小 tombstone 和历史，旧同步或旧证据不能立即复活已经遗忘的内容；用户仍可回滚或明确永久删除。
- 现有 Memory Runtime 状态和用户可读 Markdown 必须向前迁移，升级不丢记忆，不要求用户手工重建。
- 状态、来源和历史保持有界；不使用模型 confidence 小数代替可解释证据。

## 检索、CLI 与 Dashboard

- MVP 继续使用结构化字段、作用域、项目、路径、任务、操作、标签和关键词检索，不引入向量数据库或知识图谱。
- Review 只接收少量相关现有记忆；任务上下文只注入有界画像和相关详情。
- inactive、tombstoned、冲突未解决和被暂停的记录不得进入正常检索。
- CLI、用户可读 Markdown、Dashboard、Skill 上下文和 Git 同步使用同一 Personal Memory 权威状态。
- CLI 与 Dashboard 用配置语言展示范围、类别、来源、证据数、最后确认时间和冲突状态，并支持查看、纠正、遗忘、回滚、暂停和同步。
- Dashboard 复用公开插件能力和现有紧凑 Ant Design 视觉语言，不复制领域推导或创建 Dashboard 专属记忆。

## Eval 与发布门槛

- 增加专用自进化记忆 Eval，对比 `no memory`、当前 `command-summary observe` 和新的 `semantic comet-memory review`。
- 数据覆盖中英文、Classic/Native、显式与隐式创建、跳过、合并、更新、遗忘、作用域、冲突、时间更新、安全、多会话检索、无命中 abstain 和后续任务行为。
- 指标至少覆盖提取 precision/recall、有害或噪声保存率、动作准确率、作用域准确率、语言合规、去重、旧记忆复活、检索质量、后续任务成功率、上下文预算、延迟和失败降级率。
- 发布前语义评审必须相对当前 observe 提高有效记忆 precision 和后续任务表现，且不得提高有害保存、错误作用域、错误语言或旧记忆复活；具体数值门槛在得到基线后固化。

## Supervisor Change 拆分

- `semantic-memory-domain`：评审/动作契约、状态迁移、证据、身份、作用域、语言与安全校验。
- `comet-memory-skill`：先中文后英文的固定共享 Skill、安装资产、正反例和契约测试。
- `memory-workflow-integration`：Entry/Plugin Bridge/CLI、Classic/Native/Hotfix/Tweak 稳定检查点和非阻塞宿主桥接。
- `memory-experience`：用户可读 Markdown、检索、CLI、Dashboard、冲突/遗忘管理和 Git 同步一致性。
- `semantic-memory-eval`：三 treatment 数据集、评分、行为评估、基线和发布门槛。
- `semantic-memory-release`：正式文档、双语一致性、生成资产、Changelog、版本判断和全量验证。
- 第一波实现 `semantic-memory-domain`；第二波可并行实现 `comet-memory-skill` 与 `memory-experience`；第三波实现 `memory-workflow-integration`；第四波完成 Eval；最后完成发布收口。

# 非目标

- 不实现 Skill 自进化、自动改写 Skill 或自动更新 Agent 指令。
- 不把 Personal Memory 与 Project Rules 合并，也不自动把个人偏好提升为团队规则。
- 不保存完整对话、工具调用、原始日志、完整 diff、隐藏推理或无边界 trajectory。
- 不建设通用向量数据库、知识图谱、外部 Memory SaaS、Comet 账户或托管同步服务。
- 不为所有宿主建设新的 Agent scheduler；宿主原生后台能力只是可选加速。
- 不改变 Classic 与 Native 各自的状态机、Guard 或 Archive 语义。
- 不在 Eval 证明必要前扩大上下文预算或引入 embedding。

# 验收示例

- A1：中文版和英文版 `comet-memory` 作为同一个第一方固定 Skill 随 Comet 安装，Classic、Native、Hotfix 和 Tweak 不复制独立判断规则。
- A2：Skill 只读取版本化有界评审包并输出 `create/update/forget/skip`；它不能写文件、扫描完整仓库或修改任何 Skill、Agent 指令、Project Rules、Specs 或代码。
- A3：Workflow Skill 提供少量会话证据，Runtime 补齐可信生命周期事实、语言、项目身份、相关记忆和预算；动作落盘前由 Runtime 校验。
- A4：显式记住、纠正或遗忘可以立即处理；自动推断只在稳定成功检查点运行，没有有用内容时 `skip` 且状态与 Markdown 不增长。
- A5：`zh-CN` 的自动记忆正文和用户可见标签为中文，`en` 为英文；明显错误语言的自动动作被拒绝，直接 CLI 文本保留原文。
- A6：每个动作只写入一个 scope；同一观察不再同时生成 global 与 project 两条记录。
- A7：一次隐式行为只形成候选；同一项目至少两个独立成功 Change 的一致证据只能激活 project 记忆，至少两个不同项目的一致证据才能自动激活 global 记忆；失败、取消、恢复和重试不虚增计数。
- A8：同一 Change 的两个不同 candidateKey 可分别处理，同一 candidateKey 重试只处理一次。
- A9：等价记忆优先合并或更新，矛盾证据进入 conflict，不由最后写入者静默覆盖；隐式行为不能自动替换用户明确保存的记忆。
- A10：用户明确 forget 后内容立即停止检索，旧同步和旧证据不能复活；用户仍可回滚或永久删除。
- A11：secret、PII、提示注入、原始日志、完整 diff、完整 transcript 和任务流水账不会进入持久记忆。
- A12：旧 Memory state 与 `profile.md`、`projects/<project-key>.md` 可无损迁移，并继续读取、检索、修改和同步。
- A13：检索保持有界且可解释，inactive、tombstoned、未解决冲突和暂停记录不注入；MVP 不依赖 embedding。
- A14：CLI、Dashboard、Markdown、Skill 与 Git sync 使用同一权威状态，并以配置语言展示和管理记忆。
- A15：后台 Agent 可用时可非阻塞执行；不可用、超时、无效输出或插件失败时安全跳过，主工作流继续完成。
- A16：在没有 active Comet workflow 时，用户可显式调用 Skill/CLI 记住、纠正或遗忘，但普通宿主聊天不会被全局拦截。
- A17：自动记忆只保留未来可复用且不易重查的信息；命令成功、测试数量、Change/PR/Issue 摘要和可从仓库轻易发现的普通事实被跳过。
- A18：Eval 使用同一任务集比较 no-memory、current-observe 与 semantic-review，并覆盖中英文和 Classic/Native。
- A19：Eval 分别测量提取、动作、作用域、语言、安全、时间更新、检索、上下文成本和后续任务行为，不只测文件是否写入。
- A20：semantic-review 相对 current-observe 提升有效记忆 precision 和后续任务成功率，且不提高有害保存、错误作用域、错误语言和旧记忆复活率。
- A21：Eval 不达标时先调整证据、Skill 与合并规则，不用 embedding 或更大上下文掩盖问题。
- A22：相关最小测试、Skill 契约测试、Runtime bundle 构建、lint、build、全量 test 和最终 Eval 均完成；中英文 Skill 同步后才写用户可见 Changelog。
- A23：显式记忆、纠正和遗忘给出简短确认；后台复盘和候选形成默认静默；只有记忆首次实际改变处理方式或发生冲突时才简短提示，不显示 Runtime、候选 ID 或证据计数。

# 约束与不变量

- 本 Change 的正式产物语言为中文；命令、路径、schema ID、动作枚举和验收 ID 保持英文。
- Native 与 Classic 的主流程、状态机和 Guard 继续独立；`comet-memory` 是可失败的第一方辅助能力，不是任何工作流完成的硬依赖。
- 第一方 Personal Memory 插件继续使用公开插件接口，不新增只有第一方可调用的私有加载路径。
- 当前用户请求和仓库现状始终高于历史记忆；记忆不能扩大提交、推送、删除、发布或外部消息授权。
- 用户可读记忆留在专用私有 Git 仓库；当前项目只保存 Change 正式产物和被用户授权的代码改动。
- Native/Classic/Entry Runtime 源码修改后必须重新生成对应 bundle；不直接在生成物中实现业务逻辑。
- Skill 修改先完成中文并确认，再同步英文；不得修改 Superpowers 或 OpenSpec 原始 Skill。
- 所有 Child 在独立 worktree 中实现和验证，依赖已完成并合入父级分支后才创建后继 Child。
- 当前父级绑定 `beta20`；父级确认前不创建 Child，不进入 Build。

# 决策

- 采用独立、固定、共享的 `comet-memory` Skill，只做语义评审，不做 Skill 自进化。
- 采用“宿主提供最小会话证据 + Runtime 丰富可信事实并强校验”的桥接方式，不要求 Runtime 获取完整宿主对话，也不让 Skill 自行扫描 Runtime 或仓库。
- 使用版本化 `MemoryReviewPacket` 和 `MemoryReviewAction`，动作集合固定为 `create/update/forget/skip`。
- 显式记忆立即处理；隐式记忆至少需要两个独立成功 Change；无内容时 `skip` 是正常结果。
- 自动生成内容服从 active workflow 的配置语言，机器枚举保持英文；直接 CLI 文本保持原文。
- 每个动作只选择一个作用域，移除当前生命周期事件对 global/project 的无差别双投递。
- 保留现有用户可读 Markdown、专用 Git 仓库、候选证据、冲突、回滚、暂停、结构化检索和 Dashboard/CLI；通过向前迁移升级，不推倒重做。
- MVP 不引入 embedding、知识图谱或外部服务；先用三 treatment Eval 证明语义质量和行为收益。
- 自动推断只覆盖 Comet 稳定检查点；workflow 外只支持用户显式调用，不拦截宿主所有聊天。
- 采用六个 Child 的 Supervisor 拆分和四个执行波次，跨领域集成由 `memory-workflow-integration` 明确负责，避免最终 Verify 才发现宿主接线缺失。
- 显式记忆保持最高优先级；隐式稳定行为与显式记忆冲突时只进入 conflict，不能自动替换。只有用户明确纠正、手动编辑或删除才能改变显式记忆。
- 隐式全局偏好必须具有跨项目证据：同一项目内两个独立成功 Change 只能激活 project 记忆；只有用户明确指定全局，或至少两个不同项目出现一致行为，才能激活 global 记忆。
- 采用低打扰交互：显式操作确认一次，后台评审保持安静，首次实际采用或冲突时只展示一句用户可理解的说明，不暴露内部流程。

# 待解决问题

- [blocking] CONFIRM：是否确认以固定共享 `comet-memory` Skill、Runtime 有界证据与强校验、配置语言可读输出、显式记忆最高优先级、隐式 global 跨项目证据、单作用域动作、可迁移 Personal Memory 状态、有界结构化检索、CLI/Dashboard 同源管理、三 treatment Eval 发布门槛，以及六个 Child 四波次拆分作为完整 Shape，并进入 Build？

# 验证预期

- 先用 characterization tests 固定当前 command-summary observe、candidateKey 丢失、同 Change 多候选和双 scope 行为，再实现目标契约。
- 分层验证 domain action/state、插件公开接入、CLI、Dashboard、双语 Skill、Classic/Native/Hotfix/Tweak 生命周期和生成 Runtime 资产。
- 使用恶意 prompt、secret/PII、无效 schema、超预算、错误语言和不存在 targetId 验证 Runtime 拒绝路径，且主工作流不受影响。
- 使用旧 Memory state、手动编辑、删除、Git 冲突和并发写入验证迁移、tombstone、回滚与同步。
- 使用长序列任务验证候选、合并和来源保持有界，检索上下文不随 Change 数量线性增长。
- 专用 Eval 保存三 treatment 的同任务对比、指标、失败归因和复现信息；发布门槛在基线测量后固化。
- 每个 Child 运行与风险匹配的最小测试；父级最终执行 format、lint、build、全量 test、Runtime 资产新鲜度检查和自进化记忆 Eval。
