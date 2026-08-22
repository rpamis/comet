# Outcome

把现有 `comet.project-knowledge` 从对 Comet 文档即时运行 ripgrep 的召回插件，升级为面向 Agent 的项目理解能力：Local 默认使用 SQLite FTS5 与 ripgrep 混合召回，项目知识单元沉淀模块职责、行为语义、集成路径、影响范围和验证方式，任务开始前主动提供相关知识，任务过程中允许精确补充，并在来源变化后只更新受影响内容。最终目标是减少 Agent 每次从头探索项目，同时仍以当前代码、配置和测试作为最终依据。

# Scope

- 修正查询规划，让标识符、路径、命令、错误码和完整中文术语优先于弱片段进入候选预算。
- 为 Local Provider 增加按 worktree 隔离的 SQLite FTS5 读模型，按 Markdown section 建索引，并保留 ripgrep 作为强匹配、变化文件补充和故障回退。
- 使用来源路径、文件大小、修改时间、Git 变化路径和 Comet changed hint 定位变化文件；只读取变化文件并按 section/知识单元写入差异。
- 增加项目知识单元，首期类型为 `project-map`、`module-overview`、`behavior-note`、`integration-path`、`change-impact` 和 `build-test`，状态只保留 `draft | active | retired`。
- 支持项目维护单元、确定性生成单元、宿主语义评审、有限一跳关系和来源核对；项目维护单元写在固定目录 `docs/comet/knowledge/units/`，本地生成内容与索引只写用户缓存。
- 继续通过 `comet task` 并行召回 Personal Memory 与 Project Knowledge；global/project 个人记忆沿用现有实现，不复制到项目知识。只有用户明确要求共享时，个人项目经验才可在去除个人信息并核对来源后形成项目知识单元。
- 增加 `comet knowledge status/query/rebuild/units` 管理面和 Project Knowledge Dashboard 只读可观测页；共享、停用等项目写入只由显式用户动作触发。
- 保持 Remote Retrieval API v1 的请求、响应、失败和隐私行为兼容；Remote 不读取 Local 索引，也不自动获得本地正文。
- 建立 Retrieval Eval 和 Agent A/B，证明召回质量、来源正确性和减少广域探索，而不只测量查询速度。
- 将 `docs/research/2026-08-22-agent-project-knowledge-memory-retrieval-architecture.md` 与 `docs/research/2026-08-22-agent-project-knowledge-engine-technical-design.md` 作为完整需求输入纳入 change；在正式规格中维护“调研/现状结论 → 目标行为 → 验收项”覆盖矩阵，不能只摘取主结论。
- 更新 Project Knowledge 完整规格、相关中英文用户文档、生成资产和用户可见 Changelog；版本只在实现形成可发布行为时按仓库规则处理。

# Non-goals

- 不建设针对 Project Knowledge 的规则子系统，也不预留相关数据表、接口、状态或迁移。
- 不把 SQLite、模型输出、个人记忆或任务历史作为项目事实来源。
- 不把完整源码切块放入 FTS，不建设通用源码 RAG，不索引完整 Git 历史、聊天记录、日志或完整 diff。
- 第一阶段不引入 embedding、向量数据库、通用图数据库或文件 watcher。
- 不自动把个人项目偏好写入团队共享知识，不自动修改 `AGENTS.md`、Skill、Hook、linter、测试或 CI。
- 不改变 Native/Classic 状态机、Guard 或 Archive 语义，不让项目知识授权提交、推送、删除或发布。
- 不改变 Remote Provider v1 为厂商特定适配层，不加入模板、脚本、JSONPath 或请求转换代码。

# Acceptance examples

- A1：`comet.project-knowledge` 继续作为 project-scope 第一方插件，通过既有 `comet task` 和 `CometPluginBridge.collectContext()` 提供独立贡献；Personal Memory 与 Project Knowledge 保持不同 plugin ID、预算和所有权。
- A2：`knowledge.provider: local` 在运行环境支持 FTS5 时使用 SQLite FTS5 + ripgrep 混合召回，不要求用户新增配置；FTS5 不可用时仍能使用现有 ripgrep 路径完成任务。
- A3：Local 索引位于用户缓存并与 Dashboard 数据库分离；repository identity 用于项目归属，workspace identity 隔离不同 worktree，数据库可删除后恢复且不提交 Git。
- A4：首期语料包含当前 Native/Classic Spec、Archive、明确引用的 Superpowers 文档、项目维护单元和确定性提取结果；SQLite section 读模型负责文档候选，项目知识单元在独立的受保护仓库中按结构化字段融合召回；不把完整源码、活跃任务机器状态、聊天记录或完整 Git 历史加入 FTS。
- A5：Markdown 按 heading section 建索引；标题、标题路径、来源、正文和中文 `lexical_terms` 使用可区分权重，中文二字术语、三字以上子串、英文标识符和路径均有固定回归覆盖。
- A6：查询规划分别保留 strong、phrase 和 weak 预算，显式标识符、路径、命令、错误码和完整中文术语不会被弱片段提前耗尽。
- A7：候选由 FTS terms、FTS trigram、ripgrep exact、变化文件 ripgrep 和有限关系扩展产生，经确定性融合、路径/来源/类型加权、去重和来源多样性控制后返回。
- A8：任务入口只定位可能变化的来源，不读取未变化文件正文；变化文件在事务外解析，短事务只写入新增、修改和删除的 section，项目知识单元在独立仓库中按 ID 做差异写入，未变化内容不复制或重写。
- A9：变化文件更新完成前，其较早内容不进入结果；查询继续返回未受影响的 SQLite 结果，并以限定到变化文件的 ripgrep 补充当前内容，单文件变化不触发整库复制。
- A10：首次无索引时在文件数、总字节和解析时间预算内建立索引；只有首次建库、索引结构/分词方式/语料根/workspace identity 变化或数据库损坏时才全量恢复，锁、损坏或迁移失败均不阻塞 workflow。
- A11：进入 Agent 上下文前核对来源范围、存在性、workspace 和单元状态；无可靠命中时返回空结果，最终仍遵守最多 4 个结果、每段 1600 字符和总计 5000 字符的有界输出。
- A12：Remote Retrieval API v1 的配置、HTTPS/loopback、token 环境变量、固定 POST JSON、响应限额、服务端排序、失败不回退 Local 和隐私边界保持兼容。
- A13：`comet knowledge status/query/rebuild` 提供索引状态、精确补充查询和显式恢复；`provideContext()` 仍为只读，不因任务前召回写项目文件。
- A14：Dashboard 显示 provider、repository/workspace、source/section/unit/relation 数量、更新时间、回退与损坏诊断和查询统计，不保存完整用户 query，也不在首期直接编辑项目知识。
- A15：固定 Retrieval Eval 覆盖标识符、中文自然语言、跨模块关系、归档冲突、worktree 分叉、来源修改/删除、错误项目和 no-gold；exact 子集 Recall@4 不低于修正后的 rg，全集 nDCG@4 至少提高 10%，错误来源注入和跨 workspace 串线为 0，warm p95 不超过 200ms；Agent A/B 另行记录真实任务探索成本。
- A16：项目知识对象统一命名为“项目知识单元（Project Knowledge Unit）”，包含稳定 ID、kind、title、summary、origin、state、适用路径/操作、带来源的结论、关系和验证方式。
- A17：项目知识单元状态只允许 `draft | active | retired`，来源只区分 `maintained | generated`；项目维护单元位于 `docs/comet/knowledge/units/`，自动生成单元只保存在用户缓存，除非用户明确共享。
- A18：确定性提取器可从仓库布局、manifest、构建/测试配置和有限 import/export/注册关系生成 `project-map`、`module-overview` 和 `build-test`，不需要模型或 API Key。
- A19：宿主语义评审可从有界来源包提出 `behavior-note`、`integration-path` 和 `change-impact` 的 create/update/retire 动作；语义评审产生的自动单元只有任务成功完成验证、每个结论都有当前来源且通过 Runtime 校验时才能在本地成为 active。确定性提取的 project-map、module-overview、build-test 只包含来源可直接支持的事实，来源核对通过后可作为低优先级 active。适配器不可用时不影响确定性索引和召回。
- A20：只有 active 单元进入 Agent 上下文；项目维护单元高于自动生成单元，当前 Spec/代码高于 Archive 和单元，draft/retired 不参与正常召回；语义评审单元不得以命令列表代替成功验证证据。
- A21：关系只支持受控类型和一跳扩展，必须带来源；关系不能单独把弱候选推入结果，也不预先建设通用图平台。
- A22：来源不存在、越界、发生变化或无法支持结论时，该知识单元不进入结果并给出有界诊断；Agent 最终仍打开当前来源并运行与风险相匹配的验证。
- A23：Personal Memory 保持 global/project 两种作用域；项目偏好按当前 project key 自动召回，不复制进 Project Knowledge。显式共享时必须去除个人信息、核对当前来源并由用户确认写入共享单元。
- A24：`verification.completed`、`change.completed` 和有结构化证据的 `task.completed` 可提交 changed hint 与有界评审包；完整聊天、命令输出、测试日志和 diff 不进入项目知识。
- A25：`comet knowledge units` 支持查看 active/draft/retired；list/get 为只读，share/retire 只在用户显式调用时写共享文件或更新本地生成单元。
- A26：Dashboard 提供单元详情、来源、关系、状态和诊断的只读视图；项目暂停、全局禁用或插件恢复行为继续遵守现有插件生命周期。
- A27：所有来源必须是项目相对路径并通过普通文件、符号链接逃逸、单文件、总文件、总字节和解析时长限制；索引与单元不保存 token、Authorization、环境变量值、个人对话或完整日志。
- A28：插件缺失、停用、卸载、索引失败、语义适配器失败、单文件不可读或无结果均不阻塞 Native、Classic、hotfix 或 tweak，也不会绕过 explicitRemoval。
- A29：正式 Project Knowledge Spec、两份调研输入、CLI/Dashboard 文案及必要的中英文用户文档保持一致；不修改 Superpowers/OpenSpec 原始 Skill，不引入已排除术语或规则能力。
- A30：按每个阶段先运行最小相关测试；最终通过相关 domain/platform/app 测试、Prettier、lint、build、生成资产检查、全量测试、固定 Retrieval Eval 和 Agent A/B，并按相对已发布版本的最终用户行为更新 Changelog 与版本。
- A31：两份 research 的产品边界、召回设计、知识生产、Personal Memory 分层、增量更新、失败隔离、CLI/Dashboard、评测、实施阶段和非目标，以及本轮对当前 rg Provider、Remote v1、Plugin Bridge、Personal Memory、规则能力移除、Dashboard SQLite 和本机 FTS5 的调查结论，均在仓库研究输入和完整规格覆盖矩阵中有明确落点和验收 ID；不存在仅保留在研究文档、未进入实现与验收的结论。

# Constraints and invariants

- 正式产物使用 `zh-CN`；代码标识符、CLI、schema、Provider 和 plugin ID 保持稳定英文。
- 当前代码、配置、编译器和测试始终高于项目知识；项目知识只能缩小搜索范围，不能替代代码核对。
- Core Runtime 不绑定外部模型或 API Key；语义评审由宿主可选适配器提供，失败时保持确定性能力可用。
- Local 与 Remote 仍严格二选一；Remote 不读取 Local 索引，Local 失败不把本地正文发送到 Remote。
- 项目知识与 Personal Memory 不共用数据库、文件、状态或管理动作，即使它们通过同一 Plugin Runtime 并行提供上下文。
- app 只编排 domain/platform 能力；文件系统、SQLite、Git、进程和平台缓存路径差异放在 `platform/`。
- 运行时源码、生成资产、仓库布局配置和测试归属遵守当前仓库结构；跨模块和发布准备最终运行一次全量测试。
- 只提交本 change 的正式产物和实现，保留原工作区及其他 change 的未提交内容。

# Decisions

- 使用独立 worktree `D:\Project\Comet\.worktrees\agent-project-knowledge-engine`，change 分支为 `comet/agent-project-knowledge-engine`，目标分支为 `040rc1`。
- 统一使用“项目知识单元（Project Knowledge Unit）”，不沿用文章或早期草稿中的其他命名。
- 不建设针对 Project Knowledge 的规则子系统，也不为以后可能出现的规则能力预留接口或数据结构；现有仓库要求继续按当前文件和检查方式工作。
- 日常更新采用按来源发现变化、按 section/知识单元写入差异；未变化内容继续复用，变化文件更新期间由限定范围 ripgrep 补充。
- Personal Memory 继续保存 global/project 用户偏好与个人经验；Project Knowledge 保存可由项目来源支持的共享工程知识，两者并行召回但不互相复制。
- Local Provider 保留 `knowledge.provider: local` 配置语义，在内部升级为 SQLite FTS5 + ripgrep 混合召回；Remote Retrieval API v1 保持兼容。
- 首期不把完整源码加入 FTS；源码只由受限确定性提取器产生模块、注册、生成和验证关系。
- 项目维护单元只有在用户明确动作下写入固定共享目录；自动生成内容默认只在本地缓存中维护。
- 自动语义知识采用受控自动启用：任务必须成功完成验证，每个结论必须有当前来源并通过 Runtime 校验；满足条件后只在本地成为 active，优先级低于项目维护单元，写入共享目录仍需用户明确确认。
- 采用 Supervisor Change，依次交付并独立验收 `project-knowledge-hybrid-retrieval`、`project-knowledge-units` 和 `project-knowledge-learning-management`；后一个 child 只有在前一个完成并合入 Supervisor 分支后才开始。
- 当前实现基线已核对：Local 仍是最多 16 个查询词的即时 ripgrep，Remote 是固定 Retrieval API v1，Plugin Bridge 已并行返回 Personal Memory/Project Knowledge，Personal Memory 已有 global/project 作用域，Project Knowledge 规则插件及公开入口已由仓库测试明确移除，Dashboard 已使用独立 `node:sqlite`，本机 Node 22.20.0 / SQLite 3.50.4 可创建 FTS5 表。

# Open questions

- [blocking] CONFIRM: 确认本 change 以“减少 Agent 重复广域探索”为目标，完整覆盖两份 research 和本轮代码调查，交付 SQLite FTS5 + ripgrep 混合召回、按来源发现且按 section/知识单元写入差异、项目知识单元、受控自动语义沉淀、Personal Memory 项目作用域协同、CLI/Dashboard 管理面和 Retrieval/Agent A/B；不建设 Project Knowledge 规则子系统，不索引完整源码或引入 embedding/向量数据库，并按三个顺序 child 实施和独立验收。

# Verification expectations

- 先冻结并修正现有 ripgrep baseline，再实现 SQLite/section 索引和来源差异更新，避免性能提升掩盖召回退化。
- 每个 child 或单一 change 都先运行覆盖当前改动的最小测试；涉及 SQLite、平台路径、插件入口、Dashboard、生成资产和发布准备时扩大到对应集成检查。
- Retrieval Eval 使用固定语料和 query，在同一 Top-4/5000 字符预算下比较当前 rg、修正后的 rg、FTS 和 hybrid。
- Agent A/B 使用同一仓库快照、任务、模型条件和多次运行，记录首次定位正确模块前的搜索/读文件次数、无关模块数量、成功率、修改范围完整率、Token、轮次和耗时。
- Verifier 必须逐行核对完整规格中的覆盖矩阵；任何调研或现状结论没有对应实现行为与验收证据时，A31 不得通过。
- 最终由独立只读 Verifier 逐项判定 A1-A31；普通测试覆盖补充不写入 Changelog，只有相对已发布版本的最终用户可见行为进入发布说明。
