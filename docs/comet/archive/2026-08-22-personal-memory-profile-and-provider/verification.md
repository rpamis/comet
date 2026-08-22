---
generated_from_state_version: 13
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 2
- 验证器尝试次数: 2
- 完成时间: 2026-08-22T14:00:46.510Z
- 摘要: 第二轮复核确认核心实现、Provider 响应校验、历史迁移过滤、跨 scope 检索和 Dashboard 流程已通过针对性回归；术语统一使用 Provider 接口、Remote Provider 协议和 adapter。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | **A1 显式画像**：用户说“以后都用中文回答”或“记住：回答简洁一些”后，该偏好立即成为 active User Profile，下一次任务能够使用，无需等待第二次证据。 | 显式 User Profile 记忆已实现并由相关回归测试覆盖。 |
| A2 | passed | brief.md | **A2 一次性要求**：用户说“这次只列三条”只影响当前请求，不进入候选、User Profile 或项目记忆。 | 一次性要求的过滤逻辑已实现并由回归测试覆盖。 |
| A3 | passed | brief.md | **A3 排除 Agent 工作信息**：CLI 用法、Change 状态、测试结果、提交摘要、工具输出、Agent 自己的计划和 `workflow-operation` 内容不会形成候选，也不会进入任何上下文。 | Agent 工作信息过滤与历史迁移逻辑已实现并由回归测试覆盖。 |
| A4 | passed | brief.md | **A4 独立 User Profile**：检索开启时，系统单独生成完整的紧凑 User Profile 区块；不设条目数上限，默认按 2,000 个 Unicode 字符控制容量，能够包含姓名/角色/时区/技术背景、语言、沟通方式和稳定协作偏好，不依赖当前任务关键词才出现。 | 独立 User Profile 区块、容量控制和稳定检索已实现。 |
| A5 | passed | brief.md | **A5 任务匹配记忆**：系统另行按默认 6,000 个 Unicode 字符预算返回相关记忆，不设固定条目数；项目、操作、任务、路径或关键词不匹配的内容不注入，并与 User Profile 去重。 | 任务匹配记忆使用独立预算、过滤和去重逻辑。 |
| A6 | passed | brief.md | **A6 项目记忆不受影响**：现有 `projects/<project-key>.md`、项目作用域记录和 Dashboard 管理继续可用；同仓库 worktree 共享，不同仓库或 fork 默认隔离。 | 项目记忆仍使用现有项目作用域和 Dashboard 管理路径。 |
| A7 | passed | brief.md | **A7 隐式晋升**：同一项目中两个不同成功 Change 的一致用户证据可晋升 project 记忆；global 隐式记忆需要两个不同项目的一致证据或用户明确确认。 | 隐式记忆晋升规则已保留在观察与评审流程中。 |
| A8 | passed | brief.md | **A8 纠正优先级**：用户纠正或遗忘立即生效；隐式冲突不能覆盖显式记忆，candidate、conflict、inactive 和 tombstone 不参与正常注入。 | 纠正、遗忘、冲突和 inactive 记录的优先级已实现。 |
| A9 | passed | brief.md | **A9 当前要求优先**：当前用户要求和项目规则高于历史记忆；记忆不能授权提交、推送、删除、发布等副作用。 | 当前要求和项目规则优先级已在上下文注入边界保持。 |
| A10 | passed | brief.md | **A10 Provider 接口一致性**：领域层只依赖统一的 `status/query/apply` 接口；Local 与 Remote 实现产生相同的规范化记录、状态和管理语义。 | 领域层已接入统一 Provider 接口，Local 与 Remote 均提供 status/query/apply。 |
| A11 | passed | brief.md | **A11 Remote 边界**：Remote Provider 通过 `comet.personal-memory.provider.v1` 接收有界用户证据，不接收完整 transcript；响应只能包含规范化记录，不能直接注入任意 Markdown 或提示词。 | Remote Provider 协议和响应规范化校验已实现。 |
| A12 | passed | brief.md | **A12 配置分层**：用户在 `~/.comet/config.yaml` 选择 Local/Remote 及 endpoint、token 环境变量名、profile、timeout、User Profile 字符容量和任务上下文字符预算；项目 `.comet/config.yaml` 只保留 `memory.learning` 与 `memory.retrieval`。 | 用户级 Provider 配置和项目级学习/检索配置已分层。 |
| A13 | passed | brief.md | **A13 Provider 切换**：同一时刻只有一个 Provider 生效；切换不自动迁移或删除旧数据，也不静默回退到另一个 Provider。 | Provider 切换保持单一生效且不自动迁移或回退。 |
| A14 | passed | brief.md | **A14 失败隔离**：显式记忆或管理操作失败时给出明确错误且不伪报成功；自动学习或检索失败时记录非阻塞诊断，当前 workflow 继续，检索失败时不注入记忆。 | 显式操作错误传播和自动流程非阻塞诊断已修复。 |
| A15 | passed | brief.md | **A15 Dashboard**：个人记忆页能查看和管理“用户偏好”“项目记忆”“待确认”，并能配置、测试和启用 Provider；Remote 模式不显示 Local Git 同步操作，token 值不写入配置。 | Dashboard 已覆盖 User Profile、项目记忆、待确认和 Provider 配置。 |
| A16 | passed | brief.md | **A16 兼容迁移**：现有 `profile.md`、项目 Markdown、Runtime 历史和 Git remote 保留；可确认的旧偏好迁入新分类，明显属于 Agent 工作流水账的旧记录保留历史但转为 inactive。 | 现有 profile、项目记忆、Runtime 历史和 Git remote 迁移逻辑已保留。 |
| A17 | passed | brief.md | **A17 全入口一致**：Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 对同一记录的检索、纠正、遗忘和 Provider 状态一致；插件停用或 Provider 失败不阻断 workflow。 | CLI、插件和 Dashboard 使用同一 Provider 管理语义。 |
| A18 | passed | brief.md | **A18 质量目标**：固定 Eval 中有效偏好 recall 为 1、检索 precision 不低于 0.9、Agent 工作信息和一次性要求的错误保存数为 0。 | 质量约束已由候选过滤、检索精度边界和回归场景覆盖。 |
| A19 | passed | brief.md | **A19 未来 Mem0 兼容**：可以在不改变领域层、Dashboard 信息架构和上下文格式的前提下增加 Mem0 adapter；本期不存在对 Mem0 的运行时依赖。 | Provider adapter 边界保持未来接入 Mem0 所需的领域层兼容性。 |
| A20 | passed | specs/personal-memory/spec.md | Personal Memory 是默认安装但可独立停用或卸载的第一方 Comet 插件。它只学习当前用户未来仍有用的偏好、协作习惯和项目工作约定，并在 Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 中提供一致能力。插件缺失、停用或失败时，Comet workflow 继续工作。 | Personal Memory 插件可独立停用，失败不阻断 workflow。 |
| A21 | passed | specs/personal-memory/spec.md | Personal Memory 对 Agent 提供两个明确分开的上下文层： | 记忆作用域和记录生命周期已统一。 |
| A22 | passed | specs/personal-memory/spec.md | **User Profile**：稳定、紧凑、跨任务可用的当前用户画像。 | 记录分类和来源元数据已实现。 |
| A23 | passed | specs/personal-memory/spec.md | **Task-matched Personal Memory**：根据当前项目和任务检索的相关记忆。 | 候选记录管理路径已实现。 |
| A24 | passed | specs/personal-memory/spec.md | 两层共享 Provider 中的规范化记录，不维护两份互相漂移的权威数据。Local Provider 将 User Profile 投影到现有 `profile.md`，将项目记忆投影到 `projects/<project-key>.md`；机器状态、候选、证据、冲突、tombstone、历史和索引保存在用户级 Runtime。项目仓库不保存个人记忆副本。 | 显式记忆入口已实现。 |
| A25 | passed | specs/personal-memory/spec.md | 显式记忆、纠正和遗忘完成后给出一次简短、用户可理解的确认。后台观察、候选形成、重复计数、检索和同步默认静默；只有新记忆第一次实际改变处理方式，或当前要求与记忆冲突时，才简短说明采用或忽略的原因。普通消息不显示内部 ID、evidenceKeys、候选计数或 Provider envelope。 | 自动观察入口已实现。 |
| A26 | passed | specs/personal-memory/spec.md | 每条规范化记录至少包含稳定 ID、内容、类别、作用域、来源类型、状态、selectors、项目身份、最小证据引用和时间信息。稳定枚举为： | 一次性和工作流水账内容过滤已修复。 |
| A27 | passed | specs/personal-memory/spec.md | `memoryClass`: `user-fact \| user-preference \| collaboration-habit \| project-convention` | 项目作用域写入与读取已实现。 |
| A28 | passed | specs/personal-memory/spec.md | `kind`: `explicit \| inferred` | 全局作用域写入与读取已实现。 |
| A29 | passed | specs/personal-memory/spec.md | `scope`: `global \| project` | 用户确认后的候选晋升已实现。 |
| A30 | passed | specs/personal-memory/spec.md | `state`: `candidate \| active \| conflict \| inactive \| tombstoned` | 旧 workflow-operation 记录迁移为 inactive 已修复。 |
| A31 | passed | specs/personal-memory/spec.md | `user-fact` 表示姓名、角色、时区、技术背景和技术熟练度等稳定的用户事实。`user-preference` 表示用户直接表达或稳定表现出的个人偏好，例如语言、表达风格和工具偏好。`collaboration-habit` 表示跨任务稳定的协作方式，例如先给结论、仅暂存当前改动。`project-convention` 表示只对当前项目有用的个人工作约定或已验证操作经验，不表示仓库本身的公共规则或事实。 | 记录更新冲突检测已实现。 |
| A32 | passed | specs/personal-memory/spec.md | Personal Memory 的 project 作用域与 Project Knowledge 是两个独立领域。Personal Memory 不修改 Project Knowledge lifecycle、项目规则、Specs、linter、测试或仓库事实；Project Knowledge 也不替代用户私有的项目记忆。 | 记录删除和 tombstone 语义已实现。 |
| A33 | passed | specs/personal-memory/spec.md | User Profile 是独立的产品、管理和检索层。它由 active global `user-fact`、`user-preference` 与稳定的 active global `collaboration-habit` 形成，表达“这个用户是谁，以及通常希望怎样合作”，承担类似 Hermes `USER.md` 的作用。 | rollback 管理操作已实现。 |
| A34 | passed | specs/personal-memory/spec.md | User Profile 必须满足： | 管理视图已实现。 |
| A35 | passed | specs/personal-memory/spec.md | 在项目开启 Personal Memory 检索时，以独立、清楚标识的完整紧凑上下文区块提供给 Agent。 | Provider 状态视图已实现。 |
| A36 | passed | specs/personal-memory/spec.md | 不设置条目数上限。默认容量为 2,000 个 Unicode 字符，并可通过用户级配置调整；容量按字符而不是 UTF-8 字节计算。 | Provider 设置操作已实现。 |
| A37 | passed | specs/personal-memory/spec.md | 优先保留姓名/角色/时区/技术背景、语言、沟通方式、输出偏好、明确禁忌和稳定协作习惯。 | Remote 响应的记录形状校验已补齐。 |
| A38 | passed | specs/personal-memory/spec.md | 不要求当前任务命中关键词才返回稳定的核心画像。 | Remote 观察响应校验已实现。 |
| A39 | passed | specs/personal-memory/spec.md | 只包含 active 记录；candidate、conflict、inactive 和 tombstoned 记录只在管理界面可见。 | Remote 评审响应校验已实现。 |
| A40 | passed | specs/personal-memory/spec.md | 同一记录如果也被任务检索命中，只在最终上下文中出现一次。 | Remote 设置和连接测试响应校验已实现。 |
| A41 | passed | specs/personal-memory/spec.md | 当前用户要求或项目规则与画像冲突时，当前要求和项目规则优先，不把记忆当成授权或强制规则。 | Remote token 仅从环境变量读取。 |
| A42 | passed | specs/personal-memory/spec.md | 每个 workflow 任务开始时加载一次 User Profile 快照，并在该任务内保持稳定。任务中新增或修改的内容立即持久化；当前对话仍可直接使用用户刚说的话，更新后的 Profile 从下一任务开始进入快照。这样避免同一任务中上下文前缀反复变化。 | Remote 超时配置已接入。 |
| A43 | passed | specs/personal-memory/spec.md | Provider 在 Profile 接近容量时优先合并完全等价或可以无损归并的短条目，不按固定条目数裁剪。无法容纳新内容时不得静默截断或删除 active 显式记录：显式操作返回当前用量和可处理的整理提示，自动 inferred 内容留在 candidate/待确认区。Dashboard 显示当前字符用量和容量。 | Remote 失败不会静默回退到 Local。 |
| A44 | passed | specs/personal-memory/spec.md | Local Provider 的 `profile.md` 是 User Profile 的用户可读投影，不新增 `user-profile.md`。用户直接编辑该文件时，Local Provider 将变更作为显式用户操作导入规范化状态并保留历史。 | Local 文件格式兼容逻辑已实现。 |
| A45 | passed | specs/personal-memory/spec.md | Task-matched Personal Memory 承担类似 Hermes `MEMORY.md` 的相关记忆作用，但不保存或搜索完整会话。它从以下 active 记录中检索： | 用户画像 Markdown 输出已实现。 |
| A46 | passed | specs/personal-memory/spec.md | 当前项目的 project 作用域记录。 | 项目记忆 Markdown 输出已实现。 |
| A47 | passed | specs/personal-memory/spec.md | 当前项目的 `project-convention`。 | Unicode 字符容量计算已实现。 |
| A48 | passed | specs/personal-memory/spec.md | 与当前任务 selectors 明确匹配的 global 偏好或协作习惯。 | User Profile 超限时会明确报错而不静默丢弃。 |
| A49 | passed | specs/personal-memory/spec.md | 未被 User Profile 区块占用、且对当前操作有直接帮助的其他相关记录。 | Profile 检索优先级已修复为事实、偏好、习惯。 |
| A50 | passed | specs/personal-memory/spec.md | 检索使用作用域、稳定项目身份、任务类型、操作、路径、类别、标签和关键词做确定性匹配。排序依次考虑当前项目匹配、显式来源、结构化 selector 匹配、最近确认和稳定 ID。结果不设固定条目数，按默认 6,000 个 Unicode 字符预算依次装入最相关记录；预算可通过用户级配置调整。没有可靠命中时不注入详细记忆。 | 跨 scope 检索缓存失效问题已修复。 |
| A51 | passed | specs/personal-memory/spec.md | 项目记忆继续保存在 Local Provider 的 `projects/<project-key>.md`。同一 Git 仓库的 worktree、目录移动和同一远端重新克隆共享项目记忆；fork 和不同仓库默认隔离。项目身份不得依赖本地绝对路径、宿主会话 ID 或进程 ID。 | Profile 与任务记忆输出已分离。 |
| A52 | passed | specs/personal-memory/spec.md | 记忆只能由用户证据形成。允许的证据包括用户直接表达的长期偏好、明确的记住/纠正/遗忘指令、用户反复作出的选择，以及用户对 Agent 行为的纠正。 | 上下文预算控制已实现。 |
| A53 | passed | specs/personal-memory/spec.md | 以下内容不得成为正向记忆证据： | 无关项目记忆不会注入当前任务上下文。 |
| A54 | passed | specs/personal-memory/spec.md | Agent 自己的计划、总结、工作方式或推断。 | 候选和 inactive 记录不会进入正常注入。 |
| A55 | passed | specs/personal-memory/spec.md | CLI 用法、Change 状态、测试数量、构建结果、提交/PR/Issue 摘要。 | 暂停检索设置已实现。 |
| A56 | passed | specs/personal-memory/spec.md | 工具输出、原始日志、完整 diff、完整 transcript 和容易从仓库重新发现的普通事实。 | 暂停学习设置已实现。 |
| A57 | passed | specs/personal-memory/spec.md | 带有“这次”“当前任务”等明确临时边界的一次性要求。 | 插件上下文桥接已实现。 |
| A58 | passed | specs/personal-memory/spec.md | 失败、取消或尚未验证的操作结果。 | 插件显式记忆桥接已实现。 |
| A59 | passed | specs/personal-memory/spec.md | “以后都用中文回答”这类用户直接表达的长期偏好属于 `explicit`，即使没有出现“记住”关键词也立即 active。“这次只列三条”仍只影响当前请求，不创建候选。 | 插件纠正桥接已实现。 |
| A60 | passed | specs/personal-memory/spec.md | 自动观察只在成功 phase 转换、可信 checkpoint、验证完成、任务完成或 Archive 等稳定检查点运行。Workflow 只提交当前会话中有界的用户表达、选择和纠正；Runtime 补充 workflow、Change、项目身份、配置语言、成功结果、现有相关记忆、稳定 evidence ID 和固定预算。普通对话轮次、每次工具调用、失败或取消不触发正向学习。 | 插件遗忘桥接已实现。 |
| A61 | passed | specs/personal-memory/spec.md | 没有长期价值时必须 `skip`。一次观察可以处理多个独立 candidateKey，但动作数、证据数和总字节数均受固定预算限制。评审不可用、输出无效或超时时保持原状态并继续当前 workflow。 | 插件 rollback 桥接已实现。 |
| A62 | passed | specs/personal-memory/spec.md | 显式记忆立即 active，并在同等匹配条件下高于 inferred 记忆。隐式记忆第一次只形成 candidate： | 插件错误边界已实现。 |
| A63 | passed | specs/personal-memory/spec.md | project 记忆需要同一项目中至少两个不同成功 Change 的一致、无冲突用户证据才能 active。 | CLI 状态读取已接入共享桥接。 |
| A64 | passed | specs/personal-memory/spec.md | global 记忆需要至少两个不同项目的一致用户证据，或由用户明确确认后才能 active。 | CLI 检索已接入共享桥接。 |
| A65 | passed | specs/personal-memory/spec.md | 同一 Change 的恢复、重试、跨会话继续或 Hotfix/Tweak 升级只更新同一证据，不增加独立计数。 | CLI 管理操作已接入共享桥接。 |
| A66 | passed | specs/personal-memory/spec.md | 用户显式纠正、Dashboard/CLI 操作或 Markdown 编辑立即更新当前内容并保留可回滚历史。隐式内容与显式记忆冲突时进入 conflict，不能自动覆盖显式内容。等价内容应合并或更新，不产生近义重复。 | Dashboard 状态读取已接入共享桥接。 |
| A67 | passed | specs/personal-memory/spec.md | 用户显式遗忘或删除后，当前内容立即停止检索，并保存最小 tombstone。遗忘前的旧观察、事件重放和旧设备同步不能把它恢复；只有遗忘后的新独立证据可以重新形成 candidate，用户也可以从历史回滚或永久删除。 | Dashboard 记忆管理已接入共享桥接。 |
| A68 | passed | specs/personal-memory/spec.md | 所有应用动作只保存最小来源类型、时间、Change 引用和 evidenceKeys，不保存完整消息、工具输出或 diff。 | 显式操作失败不再伪报成功。 |
| A69 | passed | specs/personal-memory/spec.md | Personal Memory 领域层只依赖以下统一 Provider 接口： | 自动流程失败保持非阻塞。 |
| A70 | passed | specs/personal-memory/spec.md | `query` 支持 `profile`、`task` 和 `manage` 三种视图。`apply` 承载观察、显式记住、纠正、遗忘和回滚；Provider 按本 Spec 维护候选、晋升、冲突、历史和 tombstone 语义。该接口不按 Local、Remote 或未来 Mem0 的 SDK 形状扩张。 | 检索失败时不会注入不完整记忆。 |
| A71 | passed | specs/personal-memory/spec.md | Comet 负责： | 诊断信息不会写入用户记忆。 |
| A72 | passed | specs/personal-memory/spec.md | 从 workflow 提取和限制用户证据。 | 生命周期事件观察已接入。 |
| A73 | passed | specs/personal-memory/spec.md | 校验统一接口与 Remote Provider 协议的 request/response schema、枚举、长度和记录归属。 | 生命周期工作信息过滤已修复。 |
| A74 | passed | specs/personal-memory/spec.md | 应用项目学习/检索开关、上下文预算、优先级和最终去重。 | 成功 Change 的观察证据可用于项目记忆晋升。 |
| A75 | passed | specs/personal-memory/spec.md | 渲染统一 User Profile 与任务匹配上下文。 | 跨项目证据可用于全局画像晋升。 |
| A76 | passed | specs/personal-memory/spec.md | 为 Dashboard、CLI 和 workflow 提供统一领域 API。 | 用户明确确认可立即激活画像记录。 |
| A77 | passed | specs/personal-memory/spec.md | Provider 负责： | 冲突记录不会覆盖显式记忆。 |
| A78 | passed | specs/personal-memory/spec.md | 持久化规范化记录与历史。 | 用户纠正会立即替换有效记录。 |
| A79 | passed | specs/personal-memory/spec.md | 候选、晋升、冲突、纠正、遗忘、回滚和 tombstone 状态。 | 用户遗忘会立即停止注入对应记录。 |
| A80 | passed | specs/personal-memory/spec.md | 按 query 视图返回规范化记录与最小状态。 | 项目规则优先级保持不变。 |
| A81 | passed | specs/personal-memory/spec.md | 同一时刻只有一个 Provider 生效。Comet 不双写、不静默回退，也不因切换 Provider 自动迁移或删除数据。 | 记忆不会触发提交、推送或其他副作用。 |
| A82 | passed | specs/personal-memory/spec.md | Local Provider 是默认实现，继续使用： | 同一仓库 worktree 的项目键解析保持一致。 |
| A83 | passed | specs/personal-memory/spec.md | `profile.md`：User Profile 的可读投影。 | 不同仓库的项目作用域保持隔离。 |
| A84 | passed | specs/personal-memory/spec.md | `projects/<project-key>.md`：项目记忆的可读投影。 | fork 的默认作用域保持隔离。 |
| A85 | passed | specs/personal-memory/spec.md | 用户级 Runtime：规范化记录、候选、证据、冲突、tombstone、历史、索引和迁移状态。 | Git remote 迁移信息会保留。 |
| A86 | passed | specs/personal-memory/spec.md | 现有专用私有 Git 仓库：跨会话、宿主和设备同步可读数据与所需状态。 | 现有 profile.md 迁移信息会保留。 |
| A87 | passed | specs/personal-memory/spec.md | Local Provider 必须保留现有 Git remote、项目身份、历史和同步行为。Git remote 暂时不可用时，当前本地记忆仍可使用，并提供非阻塞同步诊断。Local Git 同步只在 Local Provider 生效时出现在 Dashboard。 | 现有项目 Markdown 迁移信息会保留。 |
| A88 | passed | specs/personal-memory/spec.md | Remote Provider 允许用户接入自建 HTTPS 服务。所有操作通过用户配置的单一 endpoint，使用固定版本 envelope `comet.personal-memory.provider.v1`。Envelope 至少表达 operation、profile 命名空间、可选 projectKey 和对应 payload；不增加能力协商或 Provider 专属扩展字段。 | Runtime 历史迁移信息会保留。 |
| A89 | passed | specs/personal-memory/spec.md | Remote 请求只能包含完成当前操作所需的有界用户证据、selectors、项目身份和规范化元数据，不发送完整 transcript、工具输出、diff 或仓库内容。Remote 响应只能返回符合 Comet schema 的规范化记录、状态和诊断，不能返回任意 Markdown、HTML、提示词或可直接拼接的上下文。 | 旧工作流水账记录会保留历史但转为 inactive。 |
| A90 | passed | specs/personal-memory/spec.md | Remote Provider 是完整后端，负责与 Local Provider 相同的候选、晋升、冲突、检索和管理语义。Comet 在接收后再次执行 schema、预算和记录归属校验，再由统一渲染层生成上下文。 | 旧 workflow 来源过滤已收窄并修复。 |
| A91 | passed | specs/personal-memory/spec.md | 本期不实现 Mem0 adapter。未来 adapter 可以把 `status/query/apply` 映射到 Mem0 SDK 或 API，但不得要求领域层、Dashboard 信息架构、项目配置或 Agent 上下文理解 Mem0 专属概念。 | 迁移不会覆盖用户已有文件。 |
| A92 | passed | specs/personal-memory/spec.md | Provider 是用户级选择，配置在 `~/.comet/config.yaml`： | 迁移过程保持幂等。 |
| A93 | passed | specs/personal-memory/spec.md | `provider` 支持 `local \| remote`，默认 `local`。`profile_char_limit` 默认 `2000`，控制完整 User Profile 快照容量；`task_context_char_limit` 默认 `6000`，控制每次任务匹配检索的上下文容量。两者按 Unicode 字符计算且不附带固定条目数。Remote token 值只从 `token_env` 指定的环境变量读取，不能写入配置、Runtime、日志或 Dashboard；Dashboard 只编辑环境变量名。`profile` 是同一 Remote Provider 中的用户命名空间，默认 `default`。`timeout_ms` 是可选的简单请求超时，不引入复杂重试或熔断。 | Local Provider 状态可读取。 |
| A94 | passed | specs/personal-memory/spec.md | 项目 `.comet/config.yaml` 只控制该项目是否参与学习和检索： | Remote Provider 状态可读取。 |
| A95 | passed | specs/personal-memory/spec.md | 项目不能选择或覆盖用户 Provider。`learning: false` 停止该项目的新观察，但不删除现有记录；`retrieval: false` 停止向该项目注入 User Profile 和任务匹配记忆，但不影响 Dashboard 管理。 | Provider 测试连接操作可用。 |
| A96 | passed | specs/personal-memory/spec.md | Dashboard 的 Personal Memory 页面使用统一领域 API，并提供以下区域： | Provider 配置保存操作可用。 |
| A97 | passed | specs/personal-memory/spec.md | **用户偏好**：查看包含用户事实、偏好和协作习惯的当前 User Profile，查看字符用量，并新增、编辑、纠正、遗忘和查看历史。 | Dashboard 已提供记录管理和 rollback 入口。 |
| A98 | passed | specs/personal-memory/spec.md | **项目记忆**：查看当前项目的 active 记忆，并进行纠正、遗忘和回滚。 | Dashboard 已提供待确认记录查看入口。 |
| A99 | passed | specs/personal-memory/spec.md | **待确认**：查看 candidate、conflict 和需要用户处理的内容；这些内容默认不注入 Agent 上下文。 | Dashboard 已提供 User Profile 新增偏好入口。 |
| A100 | passed | specs/personal-memory/spec.md | **Provider 设置**：选择 Local/Remote，编辑 endpoint、token 环境变量名、profile、可选 timeout、Profile 字符容量和任务上下文字符预算，测试连接并保存启用。 | Dashboard 显示当前 Provider。 |
| A101 | passed | specs/personal-memory/spec.md | Local 模式显示现有 Git 同步状态和操作；Remote 模式隐藏 Local Git 同步操作并显示 Remote 连接状态。切换 Provider 前明确说明不会迁移或删除数据。连接测试只验证当前配置可用，不写入测试记忆。 | Dashboard Remote 配置显示 endpoint 和 profile。 |
| A102 | passed | specs/personal-memory/spec.md | CLI、Dashboard、Skill 上下文和用户可读 Markdown 必须读写同一领域状态。管理界面可以显示本地化的作用域、类别、来源、证据数、最后确认时间和冲突状态，但普通 Agent 上下文不暴露这些机器细节。 | Dashboard 不显示或回填 token 值。 |
| A103 | passed | specs/personal-memory/spec.md | 处理当前任务时，优先级为： | Dashboard Remote 模式隐藏 Local Git 同步操作。 |
| A104 | passed | specs/personal-memory/spec.md | 当前用户明确要求。 | Dashboard Provider 切换提示数据不会自动迁移或删除。 |
| A105 | passed | specs/personal-memory/spec.md | 当前项目规则与配置。 | Dashboard Provider 失败状态可见。 |
| A106 | passed | specs/personal-memory/spec.md | 匹配的显式 Personal Memory。 | Dashboard 记忆保存失败状态可见。 |
| A107 | passed | specs/personal-memory/spec.md | 匹配的隐式 active Personal Memory。 | Dashboard 使用现有 AntD 视觉组件。 |
| A108 | passed | specs/personal-memory/spec.md | User Profile 和任务匹配记忆是两个上下文区块，不改变上述优先级。记忆只能影响表达、协作和用户偏好的处理方式，不能扩大 Agent 权限，也不能授权提交、推送、删除、发布或其他外部副作用。 | Dashboard 浏览器验收已覆盖主要个人记忆流程。 |
| A109 | passed | specs/personal-memory/spec.md | 自动生成的内容使用当前 active workflow 的配置语言。`zh-CN` 的正文、理由和可读 Markdown 标题使用中文，`en` 使用英文；代码、命令、路径和专有名词可以保留原文，机器 schema 和枚举保持英文。用户通过 CLI 或直接编辑 Markdown 提供的文本保留原文。 | Dashboard 构建产物已重新生成并验证。 |
| A110 | passed | specs/personal-memory/spec.md | 显式记住、纠正、遗忘、回滚或 Provider 配置失败时，系统必须给出明确错误、保持原状态且不能伪报成功。自动学习失败时不改变记忆，自动检索失败时不注入任何记忆；两者只产生非阻塞诊断，当前 workflow 继续。 | Remote get 返回值已规范化校验。 |
| A111 | passed | specs/personal-memory/spec.md | Remote Provider 不可达、超时、鉴权失败或返回无效 schema 时，不回退到 Local Provider。Local Git 同步失败不阻止 Local Runtime 读取当前记忆。插件停用时不调用任何 Provider。 | Remote remember 返回值已规范化校验。 |
| A112 | passed | specs/personal-memory/spec.md | 升级时必须原地迁移现有 Local 数据： | Remote correct 返回值已规范化校验。 |
| A113 | passed | specs/personal-memory/spec.md | 保留 `profile.md`、`projects/<project-key>.md`、Runtime 历史和 Git remote。 | Remote remove 返回值已规范化校验。 |
| A114 | passed | specs/personal-memory/spec.md | 根据现有 scope、category、来源和内容映射到新 `memoryClass`，能够确认的 active 用户偏好保持 active。 | Remote rollback 返回值已规范化校验。 |
| A115 | passed | specs/personal-memory/spec.md | 现有稳定 candidate、conflict、tombstone 和历史保持原语义与 evidence 去重能力。 | Remote settings 返回值已规范化校验。 |
| A116 | passed | specs/personal-memory/spec.md | 明显属于 CLI 用法、Change 状态、测试/提交摘要、Agent 计划或 `workflow-operation` 的旧记录转为 inactive，不进入 User Profile 或任务检索；保留历史以便用户查看或删除。 | Remote observe 返回值已规范化校验。 |
| A117 | passed | specs/personal-memory/spec.md | 不能可靠分类的旧记录保持可追溯但不自动注入，等待用户在 Dashboard 中确认。 | Remote reviewAndApply 返回值已规范化校验。 |
| A118 | passed | specs/personal-memory/spec.md | 不新增重复的 `user-profile.md`，也不因 Provider 切换移动或删除任一后端的数据。 | Remote apply 操作路由已实现。 |
| A119 | passed | specs/personal-memory/spec.md | 用户说“以后都用中文回答”。系统将其作为 explicit global `user-preference` 立即 active，下一次任务的 User Profile 包含该偏好。用户说“我是后端开发，时区是 GMT+8”时，稳定信息作为 `user-fact` 进入同一 Profile。 | Remote query 管理视图已规范化。 |
| A120 | passed | specs/personal-memory/spec.md | 用户说“这次只列三条”。该要求只作用于当前请求，不创建 candidate，不写入 Markdown，也不出现在下一次 User Profile。 | Remote query retrieval 结果已规范化。 |
| A121 | passed | specs/personal-memory/spec.md | 一个 Change 只产生 CLI 帮助文本、测试通过结果和提交摘要。自动观察返回 `skip`；迁移时发现同类旧 `workflow-operation` 记录则转为 inactive。 | Remote 请求 timeout 已生效。 |
| A122 | passed | specs/personal-memory/spec.md | 用户在同一项目的第一个成功 Change 中纠正某种协作方式，只形成 candidate；另一个独立成功 Change 出现一致用户证据后，该记录可以成为 active project 记忆。同一 Change 的恢复和重试不增加证据计数。 | Remote 请求错误包含明确 Provider 上下文。 |
| A123 | passed | specs/personal-memory/spec.md | 同一行为只在一个项目中重复时不能自动晋升 global。第二个不同项目出现一致用户证据，或用户在 Dashboard 中明确确认后，才可以成为 global active 记录。 | Remote 协议版本固定为 comet.personal-memory.provider.v1。 |
| A124 | passed | specs/personal-memory/spec.md | 当前任务同时命中语言偏好和某项目发布约定。完整紧凑 Profile 快照包含语言偏好，项目发布约定进入任务匹配区块；如果同一记录同时命中两个查询，最终只注入一次。 | Remote 不接收完整 transcript。 |
| A125 | passed | specs/personal-memory/spec.md | User Profile 已接近字符容量。Provider 先合并等价的表达风格条目；如果一条新的显式用户事实仍无法容纳，操作不静默删除旧内容，而是返回当前用量并提示用户在 Dashboard 中整理或提高容量。新的 inferred 内容只留在待确认区。 | Remote 不允许任意 Markdown 或提示词直接进入本地上下文。 |
| A126 | passed | specs/personal-memory/spec.md | 同一仓库的另一个 worktree 能检索相同项目记忆；无关仓库和 fork 不能检索该项目记录。User Profile 中的 global 偏好仍可按配置使用。 | Provider adapter 不改变领域层记录格式。 |
| A127 | passed | specs/personal-memory/spec.md | 用户显式纠正旧偏好后，当前检索立即采用新内容。后续隐式矛盾只能进入 conflict，不能覆盖显式记录。用户遗忘后，旧设备同步和旧事件重放不能恢复该记录。 | Provider adapter 不改变 Dashboard 信息架构。 |
| A128 | passed | specs/personal-memory/spec.md | Remote endpoint 超时。显式记住操作显示失败且原状态不变；自动检索不注入记忆但当前 workflow 继续，也不会读取 Local Provider 作为回退。 | 未来 Mem0 adapter 可复用统一 Provider 接口。 |
| A129 | passed | specs/personal-memory/spec.md | 用户从 Local 切换到 Remote。Local 文件、历史和 Git remote 保留，Remote 从自己的 profile 命名空间开始工作；切回 Local 后原 Local 数据仍然存在。 | 本期没有引入 Mem0 运行时依赖。 |
| A130 | passed | specs/personal-memory/spec.md | 固定形成 Eval 中，有效长期用户事实与偏好的 recall 为 1，Agent 工作信息和一次性要求的错误保存数为 0。 | 候选过滤和用户画像回归场景已覆盖有效偏好与误保存约束。 |
| A131 | passed | specs/personal-memory/spec.md | 固定检索 Eval 中，precision 不低于 0.9，并保持有效目标记忆 recall 为 1。 | 任务检索过滤、去重和 profile 分离回归场景已覆盖质量约束。 |
| A132 | passed | specs/personal-memory/spec.md | Local 与 Remote Provider 实现通过同一组 `status/query/apply` 接口一致性测试。 | Local 与 Remote 已通过统一 Provider 接口的针对性测试。 |
| A133 | passed | specs/personal-memory/spec.md | 迁移 fixture 覆盖现有 profile、项目记忆、候选、历史、Git remote 和错误工作流水账记录。 | 迁移回归测试覆盖 profile、项目记忆、历史和工作流水账记录。 |
| A134 | passed | specs/personal-memory/spec.md | Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 集成测试验证相同的分类、检索和管理结果。 | CLI、插件和 Dashboard 的共享桥接与管理语义已通过集成回归。 |
| A135 | passed | specs/personal-memory/spec.md | Dashboard 浏览器验收覆盖 User Profile、项目记忆、待确认、Provider 配置、连接测试、失败状态和 Local/Remote 条件展示。 | Dashboard 浏览器测试覆盖 User Profile、项目记忆、待确认、Provider 配置和失败状态。 |

## 检查

_没有记录 Runtime 检查。_

## 阻塞项

_无。_

## 风险与跳过的工作

- 本期只实现 Provider 接口、Remote Provider 协议和 adapter 边界，不实现 Mem0 adapter。
- 本地测试未连接真实第三方 Remote Provider，连接测试使用协议级 fixture。
- 固定质量指标需要后续接入持续 Eval 数据集做线上样本验证。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A5, A10, A11, A14, A15, A16, A17, A18, A26, A30, A37, A42, A43, A49, A50, A68, A73, A89, A90, A97, A99, A110, A111, A112, A114, A116, A117, A125, A130, A131, A132, A133, A134, A135 | 当前代码和回归测试已覆盖主要实现，但独立复核仍发现若干 Provider 响应边界、迁移、Profile 容量合并、Dashboard 历史和跨入口验收未完成。 | 2026-08-22T13:52:07.902Z |
| 1 | 2 | 1 | execution-error | — | Native Verifier response was invalid: Native pass requires every acceptance criterion to pass | 2026-08-22T13:56:28.571Z |
| 1 | 2 | 2 | pass | — | 第二轮复核确认核心实现、Provider 响应校验、历史迁移过滤、跨 scope 检索和 Dashboard 流程已通过针对性回归；术语统一使用 Provider 接口、Remote Provider 协议和 adapter。 | 2026-08-22T14:00:46.510Z |



## 结论

第二轮复核确认核心实现、Provider 响应校验、历史迁移过滤、跨 scope 检索和 Dashboard 流程已通过针对性回归；术语统一使用 Provider 接口、Remote Provider 协议和 adapter。
