# 面向 Agent 的项目知识、项目记忆与本地召回架构调研

日期：2026-08-22

## 研究问题

本次调研围绕一个明确目标：让 Agent 不必在每个任务里从零探索仓库，而是先获得可复用、可追溯、与当前工作区一致的项目理解，再把探索收敛为针对性的代码验证。

具体回答三个问题：

1. Comet Local Project Knowledge 是否应从 ripgrep 即时检索改成 SQLite/FTS5 索引召回？
2. “用户在某个项目上的偏好”应属于个人记忆、项目记忆还是项目知识？
3. 项目知识、长期记忆和当前任务状态应怎样分层，才能真正为 Agent 服务？

本文使用以下标记区分证据强度：

- **事实**：由当前仓库、官方文档、官方源码或论文直接支持。
- **推断**：从事实推导出的架构判断，不是来源直接声明。
- **建议**：面向 Comet 的产品或实现选择，需要通过 Comet 自己的评测确认。
- **限制**：当前无法核验或证据不足之处。

## 结论摘要

### 1. 应引入 SQLite FTS5，但不是简单替换 ripgrep

**建议**：把 Local Provider 演进为“SQLite FTS5 主召回 + ripgrep 精确命中与故障回退 + 确定性重排”，而不是删除 ripgrep，也不是把 SQLite 当成项目事实源。

当前 ripgrep 路径适合无状态、零维护、精确字符串搜索，但它逐次扫描语料，返回的是匹配行流，Comet 必须在命中上限前自行拼片段和排序。SQLite FTS5 能提供持久倒排索引、BM25、列权重、短语/前缀/NEAR 查询和按相关性直接取 Top-K，更适合 Agent 上下文召回。它解决的是“候选生成与排名”，不是语义理解；没有高质量项目知识，即使数据库更快，Agent 仍会重复探索源码。

推荐关系是：

```text
项目 Markdown / Git / 代码 / 配置（事实源）
                    |
          Agent 向项目知识单元（可审计资产）
                    |
   SQLite FTS5 可删除投影 + ripgrep 精确/回退
                    |
       任务前预取 + 执行中补充 + 来源复核
                    |
              Agent 有界上下文
```

### 2. 保留“个人记忆里的项目作用域记忆”

**建议**：用户在特定项目上的个人偏好，继续属于 Personal Memory，只是作用域为 `project`；当前项目任务同时召回“适用的全局个人记忆 + 当前项目的个人记忆”。不要把它写入共享 Project Knowledge。

判断关键不是“内容里有没有项目名”，而是**谁拥有、对谁生效、由什么证据证明**：

- “我在 Comet 项目里希望先写中文再同步英文”是当前用户的项目偏好，属于项目作用域个人记忆。
- “Comet 的 Skill 中英文目录必须同步”是现有仓库要求，继续由当前仓库说明和检查处理，不进入本方案的数据模型。
- “项目使用 pnpm 10”是可从仓库验证的项目事实，属于项目知识。
- “当前 Change 正在 Verify”是短期 Runtime 状态，不属于长期记忆或项目知识。

Comet 当前 Personal Memory 已采用这个方向：全局画像保存在 `profile.md`，项目记忆保存在 `projects/<project-key>.md`；同一 Git 仓库的 worktree 共享项目记忆，而项目仓库不保存个人记忆副本。这个语义应保留。

### 3. 真正需要建设的是“知识生产 + 召回 + 更新”闭环

**推断**：用户指定文章最值得借鉴的并不是某种数据库，而是把一次性项目理解编译为 Agent 可直接消费的知识单元，并在任务开始前召回、任务执行中补充、代码变化后增量更新。

**建议**：Comet 的 Project Knowledge 不应长期停留在“搜索已有 Spec/Archive Markdown”。它还需要 Agent 向的高密度项目知识单元，优先覆盖：

- 项目入口、模块职责与依赖关系；
- 构建、测试、生成物和发布命令；
- 跨模块同步点、参数传播链和注册/激活入口；
- 兼容性约束、历史决策和已验证的故障经验；
- 每项知识的来源和适用范围。

目标不是让 Agent 不再读代码，而是让它先得到正确的探索方向，把“大范围重新理解项目”变成“围绕已知约束做局部核验”。

## 用户指定文章：可核验内容与边界

### 初次访问限制与后续补充

**初次调研限制**：最初无法直接打开用户给出的微信页面，因此下列事实先依据 Qoder 官方英文文章 [A Self-Iterating Knowledge Engine for AI-Native Software Engineering](https://qoder.com/en/blog/qoder-knowledge-engine) 和官方产品文档核验。用户随后提供了微信文章全文，三类产物、四段生命周期、任务前预取、任务内补充、代码验证和实验数据均与下列结论一致；结合全文形成的落地设计见 [Agent 项目知识引擎详细技术方案](./2026-08-22-agent-project-knowledge-engine-technical-design.md)。

### 可以确认的核心观点

**事实**：Qoder 把输入来源分为代码仓库中的模块结构、依赖和工程约定，以及历史交互中的用户偏好、技术决策和项目经验；产出分成 Repo Wiki、面向 Agent 的结构化知识单元和 Memory。Repo Wiki 面向人阅读，结构化知识单元面向 Agent 的任务理解和执行，Memory 保存历史交互形成的长期偏好与项目经验。

**事实**：Qoder 的结构化知识单元生命周期包含扫描与生成、关系构建、治理与共享、Agent 消费。文章明确强调它不替代代码搜索：任务前提供模块、调用链和约束方向，任务中仍用代码查询验证和补充。

**事实**：Qoder 官方文章报告，在 40 个 SWE-bench Pro 复杂案例、每个条件独立运行三次的内部比较中，Knowledge Engine 条件的平均任务分从 30.2 提高到 38.4，约提升 27.1%；平均 token 从 3110K 降到 2920K，约下降 6.1%，执行轮数和工具调用也下降。

**限制**：这是供应商自报实验。文章没有提供足以独立复现实验的全部运行轨迹、提示、模型配置和统计分析；它比较的是知识供给方式，不是 SQLite 与 ripgrep。因此，这组数字支持“项目知识值得评测”，不能证明“SQLite 一定提高 Comet 27.1%”或“知识图谱是必要条件”。

**推断**：这篇文章对 Comet 的直接启示有三个：

1. 项目知识必须是 Agent 向的高密度结构，而不只是把长文档搜索结果塞入上下文；
2. 任务前预取决定初始探索方向，执行中补充用于修正遗漏，两者都需要；
3. 召回资料必须附带版本和来源，且不能替代代码、测试和 Runtime 状态验证。

## Comet 当前边界

### Project Knowledge

**事实**：当前 `comet.project-knowledge` 是独立的 project-scope 插件，通过统一 `comet task` 注入上下文；默认 Local Provider 使用 `@vscode/ripgrep`，Remote Provider 使用固定 Retrieval API。语料限于 Comet 管理的 Native/Classic Spec、Archive 和归档 Classic Change 明确引用的 Superpowers Markdown，不扫描源码或整个仓库。

**事实**：当前 Local Provider 每次最多启动一个 `rg --json` 进程，最多接收 500 个 match 事件和 1 MiB 输出；查询最多生成 16 个字符串词，中文生成二至四字片段；再按强命中、查询词覆盖、目标路径、资料权威性、命中数、归档时间和路径确定性排序。

**事实**：`domains/project-knowledge/local-provider.ts` 对每个 rg match 定位标题和相邻段落，并在候选排序前读取源文档。候选质量受 rg 输出顺序、500 个 match 上限和手工排序共同影响；rg 本身不计算跨文档相关性分数。

**事实**：在 2026-08-22 当前 checkout 中，实际 discover 到 181 个 Markdown、1,296,100 bytes，其中 36 个 `native-spec`、145 个 `native-archive`。这个规模不大，不能预设 SQLite 的主要收益来自文件扫描延迟；更需要验证 Top-4 召回质量、稳定性和后续 Agent 探索成本。

**当前 checkout 实测**：把用户这条长中文任务交给现有 `query.ts` 时，16 个 term 名额先被中文连续短语和二至四字滑窗耗尽，最终 terms 中没有 `ripgrep` 或 `SQLite`。Local Provider 的 Top-1 误召回旧的 plugin-runtime verification，当前 project-knowledge Spec 没有进入 Top-8。这说明当前首要召回缺陷不只是“没有索引”，还包括 term 预算被泛化中文片段抢占、强锚点提取过晚，以及候选排序缺少跨语料相关性。

**当前 checkout 单次性能实测**：同一请求的 Provider 总耗时约 3338ms，其中 rg 子进程约 102ms，且 `matchLimitReached=true`，达到 500 match 上限；其余约 3236ms 消耗在 match 解析、逐 match 重读/路径校验文档和片段处理。这个单次样本不能代表所有仓库，但它直接表明当前请求的主要慢点不是 ripgrep 扫描本身，而是高命中查询触发的有界截断与重复后处理。Section 级持久索引能够减少这部分重复工作，但仍必须先修正 query 锚点和重排。

### Personal Memory

**事实**：当前 `docs/comet/specs/personal-memory/spec.md` 已明确区分 `global` 与 `project` 作用域；项目记忆使用稳定 Git 项目标识，同一仓库的 worktree、目录移动和同一远端重新克隆共享，fork 默认隔离。

**事实**：自动记忆只保存未来任务仍有价值的用户偏好、协作习惯和不易从仓库重新发现的个人操作经验；容易从源码或配置重查的普通事实不写入个人记忆。项目知识则明确不进入个人记忆仓库，也不参与个人记忆的学习、纠正、同步和遗忘。

**判断**：这两个现有边界是正确的。后续应该改善的是联合召回与晋升协议，而不是把两套数据合并成一个含义模糊的“项目记忆库”。

## ripgrep 与 SQLite/FTS5 的能力比较

| 维度     | ripgrep 即时检索           | SQLite FTS5 索引召回                                     | 对 Comet 的含义                                      |
| -------- | -------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| 事实源   | 直接读取当前文件           | 查询派生索引                                             | 文件仍是事实源，SQLite 只能是可重建投影              |
| 查询成本 | 每次递归遍历并搜索目标文件 | 先付索引成本，查询走倒排索引                             | 重复任务越多，索引复用价值越高                       |
| 匹配     | 精确字符串、正则、行级结果 | token、短语、前缀、NEAR、布尔、trigram                   | FTS 更适合候选检索；rg 更适合强标识符核验            |
| 排名     | 无跨文档相关性排名         | 内置 BM25、列权重、snippet                               | FTS 可先得到有序 Top-K，减少遍历顺序偏差             |
| 中文     | 固定字符串天然支持子串     | 默认 `unicode61` 不适合无空格中文子串；trigram 至少 3 字 | 必须显式设计中文索引词，不能直接用默认 tokenizer     |
| 片段粒度 | 命中行后再读文件拼段落     | 可直接把 Markdown section 作为文档行                     | 应按标题/段落索引，而不是按整文件索引                |
| 更新方式 | 每次直接读取当前文件       | 变化定位后按 section 增量更新                            | 未变化内容继续复用，变化文件用限定范围 rg 补充       |
| 运维     | 无持久状态                 | schema、锁、损坏、清理、隐私                             | SQLite 文件放用户缓存，不提交、不跨网络文件系统      |
| 故障     | 工具缺失/超时              | DB 缺失、锁、损坏、FTS 不可用                            | 两者互为回退可降低单点失败                           |
| 语义理解 | 没有                       | FTS5 仍然没有                                            | 自然语言同义表达仍需知识单元、查询扩展或后续向量实验 |

### ripgrep 适合什么

**事实**：[ripgrep 官方指南](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md) 将其定义为逐行搜索文件的递归搜索工具；它会读取目标文件、报告匹配行，并提供 ignore、glob、文件类型和正则能力。它不是持久索引或相关性排序器。

**判断**：ripgrep 仍适合以下路径：

- 精确代码标识符、错误码、命令、文件路径和完整短语；
- SQLite 缺失、损坏、锁等待或索引过期时的实时回退；
- 对 FTS Top-K 的来源复核；
- 小语料或首次查询，不值得阻塞等待索引时。

### FTS5 实际增加什么

**事实**：[SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html) 提供短语、前缀、NEAR、列过滤、布尔查询、`bm25()`、`highlight()` 和 `snippet()`。BM25 可对不同列设置权重，因此标题、标题路径、源路径和正文可以有不同重要性。

**事实**：FTS5 默认 `unicode61` 把连续的字母和数字视为一个 token；trigram tokenizer 按连续三个 Unicode 字符建立子串索引，但少于三个字符的全文查询不能命中。

**当前环境验证**：本机 Node 22.20 的 `node:sqlite` 链接 SQLite 3.50.4，并启用了 FTS5 和 JSON；仓库的 Dashboard 已经使用 `node:sqlite`。对文本“项目知识服务 Agent”的最小实验中，默认 `unicode61` 无法用“项目知识”或“项目”命中；trigram 可以用“项目知识”和“项目知”命中，但不能用两个字符的“项目”命中。这与官方 tokenizer 规则一致。

**建议**：第一版不要直接把原始中文正文交给默认 tokenizer。可复用当前查询器的中文二至四字片段逻辑，在索引阶段为每个 section 生成一个规范化 `lexical_terms` 字段，并把英文标识符、路径片段、数字和中文片段用空格分隔后交给 FTS5。trigram 可作为第二候选通道，专门补充三字以上子串；二字精确词继续由 `lexical_terms` 或 rg 支持。

**当前 checkout 原型实测**：把 181 个 Markdown 按标题切成 1604 个 chunks，以 `unicode61 + 应用预生成中文 2–4gram lexical_terms` 写入内存 FTS5，建索引约 845ms。使用 `ripgrep`、`SQLite`、`项目知识`、`个人记忆`、`项目偏好` 等明确锚点查询约 0.9ms，Top-1/Top-2 是当前和归档的 project-knowledge Spec；但把 40 个泛化 ngram 全部用 OR 查询时，Top-1 仍漂移到 context-injection。这个原型只证明当前 Runtime 可以低成本建立 section 索引，并证明 BM25 能改善有锚点的候选排序；它同时反证了“换成 SQLite 就自动召回正确”——锚点提取、query term 配额和二阶段重排仍是决定性因素。

### SQLite 不会自动解决什么

**事实**：SQLite FTS5 是词法全文检索，不理解“权限检查顺序”和“兼容字段映射”是否语义相关，也不自动知道跨模块注册点。

**事实**：最新的 [Agent Retrieval Bench](https://arxiv.org/abs/2607.24882) 在 25 个仓库、427 个样本上比较词法、BM25、RepoMap、开源 embedding 和选择性 abstention。没有任何检索家族在所有任务上占优；RepoMap 在 8K token 预算下的上下文产出最好，embedding 在部分 Recall/MRR 指标上更好，词法与 BM25 也各有适用场景。论文还报告，真实 Agent 轨迹在 27%–35% 样本中没有选中任何 gold 文件。

**事实**：[RepoCoder](https://aclanthology.org/2023.emnlp-main.151/) 的论文表明，迭代式“检索—生成—再检索”持续优于一次性的普通 RAG，但其任务是仓库级代码补全，不等同于项目知识召回。

**推断**：Comet 不应把 SQLite、BM25、向量或图中的任何一个当作终局。更稳妥的产品合同是“多路候选、确定性融合、有界注入、允许 abstain、执行中可再次检索”。

## 项目知识与项目记忆的分层

### 推荐语义模型

| 层                 | 所有者              | 典型内容                               | 作用域          | 更新方式                            |
| ------------------ | ------------------- | -------------------------------------- | --------------- | ----------------------------------- |
| 当前任务状态       | 当前 Change/Runtime | 阶段、待办、失败、临时路径             | 单任务/单工作区 | 任务结束后归档或删除                |
| 全局个人记忆       | 用户                | 回复语言、输出风格、跨项目协作偏好     | 用户跨项目      | 用户可纠正、遗忘；不对团队生效      |
| 项目作用域个人记忆 | 用户                | 只在该项目采用的个人偏好、个人经验     | 用户 × 项目     | Personal Memory 按 project key 召回 |
| 项目知识           | 项目/团队           | 架构、模块职责、命令、技术决策、同步点 | 项目/工作区     | 按变化 section 更新；可维护和共享   |

这几类信息即使都使用本地存储，也不能共用语义所有权。渲染时必须把“个人偏好”和“项目资料”分开呈现。本方案不建设额外规则子系统，也不为未来能力预留相关数据结构或接口。

### 判断矩阵

| 内容                                    | 应放哪里                                             | 原因                                                 |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| “所有项目默认用简洁中文回答”            | 全局个人记忆                                         | 只代表当前用户，跨项目适用                           |
| “在 Comet 中先确认中文语义，再同步英文” | 项目作用域个人记忆                                   | 初始是用户在此项目的协作偏好，不应自动约束其他贡献者 |
| “`assets/skills-zh` 是中文 Skill 根”    | 项目知识                                             | 可由仓库与架构配置验证的描述性事实                   |
| “修改 Runtime 后必须重新构建生成物”     | 现有仓库说明和构建检查                               | 不为它新增 Project Knowledge 数据类型                |
| “这次任务正在定位 FTS5 tokenizer”       | 当前任务状态                                         | 一次性进展，不值得长期召回                           |
| “上次某错误由缓存状态没有更新引起”      | 先是项目作用域个人经验；经 source 复核可形成知识单元 | 需要区分个人经验与团队共享事实                       |
| “本机 Redis 地址是 127.0.0.1:6380”      | 项目本地配置或秘密管理，不是普通记忆                 | 机器私有且可能敏感、易变化                           |

### 行业系统怎样分层

| 系统             | 记忆                                                           | 项目知识/检索                                                       | 对 Comet 的启示                                          |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Qoder            | user-level 与 project-level 长期记忆                           | Structured Knowledge Modules、面向 Agent 的知识单元、Repo Wiki      | 历史偏好与 Agent 向知识资产分开                          |
| Claude Code      | Auto Memory 由 Claude 写入，按 Git 仓库共享 worktree，机器本地 | 仍通过文件工具按需读取 topic memory 和代码                          | 人写的稳定指导与 Agent 自动积累的经验分开                |
| GitHub Copilot   | repository facts 与 user preferences 分开                      | repository facts 带代码引用，使用前对当前分支复核                   | “共享项目事实”和“个人偏好”应按所有者分层，并在召回时验证 |
| Cursor           | Memories 从对话自动生成，按 Git 仓库作用域保存                 | Codebase indexing 提供自动相关上下文                                | 项目私有记忆不等于共享项目知识                           |
| Sourcegraph Cody | 不是其 Local Indexing 的重点                                   | symf 在后台建立持久 workspace keyword index，检测文件变化并增量重建 | 持久本地索引是成熟路径，但需要明确失败、清理和重建行为   |

来源见：[Qoder Knowledge Engine](https://qoder.com/en/blog/qoder-knowledge-engine)、[Qoder Knowledge Base](https://docs.qoder.com/cli/knowledge-base)、[Claude Code Memory](https://code.claude.com/docs/en/memory)、[GitHub Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)、[GitHub Copilot project customization](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-copilot-overview)、[Cursor Memories](https://docs.cursor.com/en/context/memories)、[Sourcegraph Cody Local Indexing](https://sourcegraph.com/docs/cody/core-concepts/local-indexing)。

**判断**：行业命名并不统一。有的产品把项目事实也称为 Memory，有的称 Knowledge；更可靠的共同模式是按作者、共享范围和是否需要 source 复核来分层，而不是按文件名分层。

## 对 Comet 的推荐目标架构

### 1. 统一召回编排，保留两个独立贡献

`comet task` 继续作为唯一入口，但上下文编排器应保持两个可辨识贡献：

```text
Project Knowledge   -> 可追溯、可能过时、需要核验的项目理解
Personal Memory     -> 当前用户适用的全局/项目偏好与经验
```

**建议**：Project Knowledge 和 Personal Memory 并行召回，再在总 token/字符预算下去重和分配配额。不要把个人偏好先复制进 Project Knowledge 再检索。仓库已有说明和检查继续按当前方式生效，不进入这两个召回器。

### 2. SQLite FTS5 Local Provider v2

#### 存储位置与身份

**建议**：SQLite 文件放在用户缓存目录，沿用 Dashboard `node:sqlite` 的平台路径策略，但使用独立的 `project-knowledge` 目录和 schema。数据库不提交、不 Git 同步，也不作为项目文档或 Memory 的权威存储。

项目作用域需要区分两种身份：

- `repository_id`：稳定 Git 项目标识，用于把同仓库资料归组；
- `workspace_id`：当前 worktree/分支/工作区标识，用于防止一个 worktree 的事实召回到另一个已经分叉的 worktree。

Personal Memory 可以按 `repository_id` 跨 worktree 共享用户偏好；Project Knowledge 的事实投影必须按 `workspace_id` 隔离。这两个生命周期不能因为都叫“project”而合并。

#### Section 级索引

**建议**：索引单位从“rg 命中行”改为 Markdown section，每个 section 保存：

- `source`、`document_kind`、标题层级、section ordinal；
- `title`、`heading_path`、规范化 `lexical_terms`、正文；
- `repository_id`、`workspace_id`、来源类型、归档时间；
- 文件 size/mtime、schema/tokenizer version；
- 可选的证据引用和扩展 metadata。

标题、标题路径、源路径和正文使用不同 BM25 权重；当前 Spec、已归档资料和 Superpowers 产物继续保留现有权威顺序。最终重排继续加入完整短语/标识符、目标路径、资料类型、归档时间和来源多样性，不把裸 BM25 分数当作产品 API。

#### Schema 与 JSON

**事实**：[SQLite JSON 官方文档](https://www.sqlite.org/json1.html) 说明 JSON 函数默认内建；SQLite 将 JSON 存为普通 TEXT，JSONB 是 SQLite 私有格式，当前大多数查找仍是 O(N)，不是 PostgreSQL JSONB 式的 O(1) 对象查找。

**建议**：需要过滤、排序和唯一性的字段使用普通列与 B-tree 索引；JSON TEXT 只保存低频、可扩展的 source metadata。不要把 `project_id`、`workspace_id`、`source`、`kind` 全塞进 JSON 后再用 `json_extract()` 做主查询。

#### 增量更新

第一版不需要 watcher，采用按来源发现变化、按 section 写入差异的流程：

1. 首次召回没有索引时，在有界预算内建立索引；
2. 每次任务入口合并 changed hint、Git 变化路径和文件路径/大小/修改时间，不读取未变化文件正文；
3. Comet 自己写入 Spec、Archive 或引用文件时，向索引提交 changed hint，直接定位需要处理的来源；
4. 只读取发生变化的文件，在事务外解析全部 section，并与数据库现有 section 内容直接比较；
5. 短事务只插入、修改或删除有差异的 section、知识单元和 FTS 行，未变化来源及未变化 section 保持原行；
6. 更新尚未完成时，继续查询未受影响的 SQLite 索引，同时用限定到变化文件的 ripgrep 补充当前内容；
7. 只有首次建库、schema/tokenizer、语料根、Comet 版本、工作区身份变化或 DB 损坏时才全量重建；
8. 更新失败或 FTS5 不可用时回退到现有 ripgrep 路径，任务不阻塞。

普通单文件改动只产生一次文件读取、section 解析、差异比较和小批量写入，不需要重新扫描全部语料，也不需要复制整个数据库。

**事实**：[SQLite WAL 官方文档](https://www.sqlite.org/wal.html) 说明 WAL 允许 reader 与 writer 并发，但同一时间仍只有一个 writer；WAL 要求所有进程位于同一主机，不适用于网络文件系统。

**建议**：使用 WAL、单写者、短事务和 bounded busy timeout；扫描和 Markdown 解析放在事务外。数据库位于本机用户缓存正好符合 WAL 的部署边界。

#### 召回路径

推荐的本地召回不是单查询：

```text
任务文本 / 路径 / phase
        |
        +-- FTS lexical_terms / BM25 Top-N
        +-- FTS trigram 三字以上子串 Top-N
        +-- rg 强标识符 / 精确路径 / 完整短语 Top-N
        |
       去重 + 来源类型 + 路径 + 多样性重排
        |
            Top-4 / 5000 字符 + 来源
```

Query planner 必须先保留强锚点配额，再生成泛化片段：显式英文技术词、代码标识符、路径、错误码和完整中文术语优先；中文滑窗只能占用剩余名额。FTS 查询也不应把几十个弱 ngram 无差别 OR 在一起，应先以强锚点取候选，再用弱词覆盖率、路径和资料权威性做二阶段重排。这个顺序同时修复当前 16-term 截断问题，也避免把 BM25 变成新的“泛词命中最多者优先”。

无可靠命中继续 abstain。任务开始前主动运行一次有界召回；当 Agent 的计划涉及新模块、出现测试失败或进入 Verify 时，允许用新的具体 query 再检索一次。这样既避免完全依赖 Agent 自觉调用工具，也避免一次性预取遗漏后无法修正。

### 3. Agent 向项目知识单元

仅给现有长文档加 FTS 索引，不能完整实现“不要每次探索项目”。Comet 不沿用原文命名，建议新增 Project Knowledge Unit，首期只覆盖高价值类型：

1. `project-map`：主要入口、模块职责、关键目录、生成物关系；
2. `module-overview`：模块输入输出、边界和依赖方向；
3. `build-and-test`：可执行命令、适用范围、前置条件和常见失败；
4. `change-impact`：修改某类对象时必须同步的文件、注册点、迁移和测试；
5. `behavior-note`：仍然适用的实现顺序、兼容语义和历史原因。

每个知识单元必须包含来源路径和适用 scope。状态只保留 `draft | active | retired`；来源改变时只更新受影响单元。Agent 自动提炼只能产生 draft；用户确认共享后写入项目维护单元。

**建议**：用户项目偏好不能直接生成共享知识单元。可采用显式共享路径：

```text
project-scoped personal memory
  -> 用户提出共享
  -> 去除个人信息并复核当前 source
  -> draft project knowledge unit
  -> 用户确认后写入 shared unit
```

### 4. 召回预算与冲突

建议初始上下文按类别设置预算，而不是让一个检索器占满 5000 字符：

- Project Knowledge：默认 2–4 个不同来源/类型的 section；
- Personal Memory：只加载 1–3 条明确适用的全局或项目偏好；
- Current Runtime：只加载当前任务继续工作所需状态。

冲突优先级应是：当前用户请求和系统约束 > 当前代码、配置和测试 > 当前项目知识 > Personal Memory > 归档知识。Personal Memory 不得授权提交、推送、删除或发布；Project Knowledge 也不能覆盖 workflow 状态。

## 评测方案

### 为什么必须先做对照集

**事实**：Agent Retrieval Bench 显示不同任务信号的最佳检索方法不同，且自然 no-gold 的 abstention 不能靠简单统一阈值解决。Qoder 的实验也把任务得分、token、轮次、工具调用和耗时一起衡量，而不是只看检索延迟。

**建议**：SQLite 方案进入实现前，先冻结当前 rg Provider 为 baseline，在同一语料、query、Top-4/5000 字符预算下比较：

1. 当前 `rg + 手工排序`；
2. FTS5 `lexical_terms + BM25`；
3. FTS5 + rg hybrid；
4. 仅在前三者仍有明显语义缺口时，再实验 embedding 或 RepoMap/关系召回。

### 检索级数据集

至少覆盖：

- 精确标识符、错误码、命令和路径；
- 中文自然语言、中文二字词、中文夹英文标识符；
- 当前 Spec 与冲突归档资料的权威排序；
- 架构/模块职责、构建测试、跨模块同步和 change impact；
- query 只描述症状、gold 是根因模块的间接关系；
- 没有相关项目资料、错误项目或已删除资料的 abstain；
- worktree 分叉、branch 切换、文档修改/删除后的来源正确性。

指标建议：Recall@4、MRR、nDCG@4、来源正确率、错误来源注入率、abstain precision/recall、每个有效字符预算的相关信息量、cold/warm latency、索引更新读取字节数。

### Agent 级 A/B

只看召回指标不足以证明“减少探索”。对固定任务运行有/无项目知识、rg/FTS/hybrid 对照，记录：

- 形成正确计划前的 `rg`/读文件/目录探索次数；
- 首次触达 gold 模块的轮次；
- 输入 token、总轮次和工具调用；
- 完整变更范围覆盖率，尤其是测试、配置、注册点和生成物；
- 最终可执行验证结果；
- 错误知识导致的锚定、遗漏或多改。

验收目标应表述为“在不提高错误来源或误召回的前提下，减少广域探索并提高完整变更范围覆盖率”，而不是“SQLite 查询更快”。

## 分阶段建议

### P0：先建立基线和知识边界

- 固化 30–50 个中英文真实任务 query 与 gold section/source；
- 增加 `no-gold`、归档冲突和 worktree 来源变化场景；
- 记录当前 rg 的召回质量、延迟和 Agent 探索成本；
- 正式确认本文的记忆/知识归属矩阵。

### P1：SQLite FTS5 混合召回 MVP

- 使用现有 `node:sqlite`，运行时探测 FTS5 能力；
- 先修正强锚点优先与 term 配额，再实现 section 级索引、中文 `lexical_terms`、BM25 列权重；
- 来源识别、section 差异更新、workspace 隔离、结果源复核；
- rg 保留为强匹配通道和故障回退；
- 只在 A/B 优于 baseline 后把 FTS 设为默认。

### P2：知识单元与任务内补充

- 先生成 project-map、module-overview、build-and-test、change-impact；
- 每条知识带 source 和适用路径；
- 任务前预取，计划变化/失败/Verify 时支持补充召回；
- 提供用户纠正、重建和清理入口。

### P3：由评测决定是否需要语义/关系召回

只有中文同义表达、症状到根因、跨模块关系等用例在 hybrid 下仍系统性失败时，再评估本地 embedding、RepoMap 或轻量关系边。不要因为 Qoder 使用知识图谱就预先复制完整图系统。

## 非目标

- 不把 SQLite 变成项目事实源、个人记忆权威仓库或 workflow 状态库；
- 不自动把个人项目偏好共享给团队；
- 不建设额外规则子系统，也不为未来能力预埋相关接口；
- 第一阶段不索引全部源码、不引入 embedding 模型或向量数据库；
- 第一阶段不要求文件 watcher；Comet 命令 changed hint + task-time incremental update 足够验证价值；
- 不把所有历史任务、完整对话、日志、diff 或失败轨迹长期保存；
- 不承诺消灭代码探索；项目知识只能缩小搜索空间，最终结论仍要由当前代码、测试和 Runtime 状态验证；
- 不因为存储后端相同就把 Dashboard SQLite、Project Knowledge 和 Personal Memory 合成一个 schema 或生命周期。

## 最终判断

Comet 可以参考 Qoder 的“把项目理解编译成 Agent 可复用上下文”方向，也值得把 Local Project Knowledge 从纯 ripgrep 演进到 SQLite FTS5。但正确的产品定义不是“用 SQLite 代替 grep”，而是：

> **让可审计的项目知识成为事实源之上的 Agent 向资产；用可重建的混合索引在正确项目、工作区和时机召回；把个人偏好继续留在用户拥有的项目作用域记忆中。**

短期最值得做的是 `section-level FTS5 + rg fallback + source check + A/B eval`。中期真正决定 Agent 是否少走弯路的，是项目知识单元的质量、来源和更新方式，而不是 SQLite 文件本身。

## 主要一手来源

- SQLite：[FTS5 Extension](https://www.sqlite.org/fts5.html)、[Write-Ahead Logging](https://www.sqlite.org/wal.html)、[JSON Functions and Operators](https://www.sqlite.org/json1.html)、[SQLite as an Application File Format](https://www.sqlite.org/appfileformat.html)
- ripgrep：[User Guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)、[README](https://github.com/BurntSushi/ripgrep/blob/master/README.md)
- Qoder：[Knowledge Engine](https://qoder.com/en/blog/qoder-knowledge-engine)、[CLI Knowledge Base](https://docs.qoder.com/cli/knowledge-base)、[Self-Evolving Memory](https://qoder.com/blog/qoder-memory-evolution)
- Claude Code：[How Claude remembers your project](https://code.claude.com/docs/en/memory)
- GitHub Copilot：[Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)、[Customize Copilot for your project](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-copilot-overview)
- Cursor：[Memories](https://docs.cursor.com/en/context/memories)
- Sourcegraph Cody：[Local Indexing](https://sourcegraph.com/docs/cody/core-concepts/local-indexing)
- 论文：[Agent Retrieval Bench](https://arxiv.org/abs/2607.24882)、[RepoCoder](https://aclanthology.org/2023.emnlp-main.151/)
