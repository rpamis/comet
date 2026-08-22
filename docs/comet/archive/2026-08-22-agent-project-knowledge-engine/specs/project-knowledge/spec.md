# Agent 项目知识

## 产品定位

### Scenario: 产品定位与知识边界

`comet.project-knowledge` 是 project-scope 第一方插件，为 Agent 提供可追溯、可核对和有界的项目理解。它通过既有 `comet task` 与 `CometPluginBridge.collectContext()` 主动提供上下文，也允许任务过程中通过稳定能力进行精确补充查询。

项目知识的目标是让 Agent 优先定位正确模块、行为语义、集成路径、影响范围和验证方式，而不是让 Agent 停止阅读代码。当前工作区中的代码、配置、编译器和测试始终是最终依据；项目知识、关系和模型输出都不能覆盖用户请求、上层约束或 workflow 状态。

Project Knowledge 与 Personal Memory 是两个独立贡献：Personal Memory 保存当前用户的 global/project 偏好和个人经验，Project Knowledge 保存有当前项目来源支持的工程知识。两者可以并行召回，但不共用存储、状态、预算和管理动作，也不自动互相复制。

## 当前实现基线

### Scenario: 当前实现基线与改造起点

本 change 以 2026-08-22 对 `040rc1` 的代码调查为实现起点：

| 能力                   | 当前实现                                                                                                                                        | 本 change 的处理                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Local Provider         | `domains/project-knowledge/local-provider.ts` 对 Comet 管理的 Markdown 即时运行一次有界 ripgrep，从命中行再次读取文件并拼接片段                 | 保留 rg 强匹配和回退，新增 section FTS、来源差异更新和混合重排 |
| 查询规划               | `domains/project-knowledge/query.ts` 按发现顺序截取最多 16 个词，长中文请求可能先耗尽弱片段预算                                                 | 改为 strong/phrase/weak 独立预算，强锚点优先                   |
| Local 输出             | 最多 500 个 rg match、Top-4、每段 1600 字符、总计 5000 字符                                                                                     | 保留最终边界，改进候选生成、来源多样性和 abstain               |
| Remote Provider        | 固定 Retrieval API v1，Local/Remote 严格二选一，Remote 失败不回退 Local                                                                         | 保持请求、响应、隐私和失败行为兼容                             |
| Plugin 接入            | `comet.project-knowledge` 与 `comet.personal-memory` 并列注册，`CometPluginBridge.collectContext()` 合并 user/project scope 后按 plugin ID 输出 | 保持统一入口和独立贡献，新增 Project Knowledge 能力面          |
| Personal Memory        | 已有 global/project 作用域、项目身份、检索暂停和管理能力                                                                                        | 不重做领域模型；只增加显式共享到项目知识的受控路径             |
| Project Knowledge 规则 | `domains/project-rules`、命令和插件入口不存在，`test/repository/project-rules-removed.test.ts` 明确防止恢复                                     | 不建设，也不预留相关接口                                       |
| Dashboard              | 已有 Project Knowledge 页面与插件生命周期恢复；Dashboard 索引使用独立 `node:sqlite` 和 WAL                                                      | 复用平台经验，但 Project Knowledge 使用独立数据库和只读状态页  |
| SQLite 运行环境        | 当前 Node 22.20.0 链接 SQLite 3.50.4，本机实测可创建并查询 FTS5 表                                                                              | 运行时仍探测能力，不把本机结果当作所有平台保证                 |
| 管理命令               | 当前没有 `comet knowledge` 命令                                                                                                                 | 新增最小 status/query/rebuild/units 管理面                     |

已有调研的一次当前 checkout 实测中，明确锚点查询的 rg 进程约 102ms，而 Provider 总耗时约 3338ms，主要额外成本来自高命中后的截断、重复读文件和片段处理。该数据只作为建立可重复 baseline 的线索，发布判断必须以固定 Retrieval Eval 和 Agent A/B 为准。

## Provider 与配置

### Scenario: Provider 选择与兼容行为

`.comet/config.yaml` 继续使用现有 `knowledge.provider`：

```yaml
knowledge:
  provider: local
```

`local` 是默认值，在运行环境支持 FTS5 时使用 SQLite FTS5 与 ripgrep 的混合召回；用户不需要新增索引开关或调参配置。FTS5、数据库或迁移不可用时，Local 回退到现有有界 ripgrep 路径，当前任务继续执行。

`remote` 继续使用固定 Retrieval API v1。Remote 与 Local 严格二选一；Remote 不读取 Local 索引、项目文件正文或个人记忆，失败时不自动回退 Local。现有 endpoint、HTTPS/loopback、token 环境变量、scope、timeout、请求/响应结构、限额、服务端排序和错误处理保持兼容。

首版不向用户暴露数据库路径、分词方式、候选权重、Top-N 或日常更新时间等调参项。只有真实项目需要时才考虑固定共享目录以外的少量配置。

## 所有权与优先级

### Scenario: 知识来源所有权与上下文优先级

上下文保持以下分层：

1. 当前用户请求、系统约束和安全边界；
2. 当前工作区代码、配置、Guard、编译器和测试；
3. 当前工作区中由项目维护的 active 项目知识单元；
4. 当前工作区中自动生成的 active 项目知识单元；
5. 当前任务适用的 Personal Memory；
6. 历史 Archive、retired 单元和未确认候选。

项目知识不能授权提交、推送、删除、发布或绕过 workflow，也不新增针对 Project Knowledge 的规则子系统。现有仓库要求继续由当前 `AGENTS.md`、配置、Hook、编译器、linter 和测试生效；本能力不为未来规则功能预留数据表、接口、状态或迁移。

## 语料范围

### Scenario: 项目语料边界与安全范围

Local 首期处理以下来源：

- 当前 Native/Classic Spec；
- Native/Classic Archive；
- 归档 Classic Change 明确引用的 Superpowers Markdown；
- `docs/comet/knowledge/units/` 中项目维护的知识单元；
- 仓库布局、package/workspace manifest、构建配置、测试配置及受限源码关系提取器产生的确定性结果；
- 通过验证的 change 提交的有界 changed hint 和来源引用。

完整源码不作为 FTS 文档；源码关系提取只产生 import/export、入口、注册、生成和验证等受控事实。活跃任务的机器状态、`.comet/runtime`、完整 Git 历史、聊天记录、日志、完整 diff、凭据、环境变量值和通用仓库文件不进入索引。

所有来源必须是 project-relative 普通文件，位于允许根内且不能通过符号链接逃逸。单文件、总文件、总字节、解析时长、section 大小和结果大小均有固定上限。

## 本地索引

### Scenario: 本地索引身份、结构与更新

#### 身份与位置

SQLite 位于用户平台缓存目录的独立 `project-knowledge` 区域，不提交 Git，也不与 Dashboard 或 Personal Memory 共用数据库。

- repository identity 表示稳定项目归属，可供 Personal Memory 在同仓库 worktree 之间共享 project 偏好；
- workspace identity 表示当前 worktree/工作区，Project Knowledge 索引必须按它隔离，避免不同分支内容串线。

数据库是可删除后恢复的本地读模型，不是项目事实来源。

#### Section 索引

Markdown 以 heading section 为索引单位，而不是整文件或命中行。每个 section 至少保存来源、文档类型、标题、标题路径、anchor、正文、规范化 `lexical_terms`、适用路径/操作和更新时间。

FTS 使用两个候选通道：

- terms 通道索引标题、标题路径、来源、英文标识符和预生成中文词；
- trigram 通道补充三字以上中文与 Unicode 子串。

中文 `lexical_terms` 覆盖完整技术短语、有限二至四字片段、模块别名、路径段、命令和错误码，并去除重复和低信息内容。标题、来源和正文使用不同相关性权重；裸 FTS 分数不作为公开接口。

#### 数据模型

SQLite 至少包含：

- `pk_meta`：schema、分词方式、repository/workspace identity 和迁移元数据；
- `pk_sources`：来源 ID、相对路径、类型、大小、修改时间和索引时间；
- 项目知识单元、来源引用和受控关系：保存在独立的受保护单元仓库，以稳定 unit ID、source、anchor 和 state 做有界融合；不为了首期能力复制一套通用图数据库；
- 变化来源：由索引同步结果和有限的 lifecycle changed hint 传递给增量写入，不在 SQLite 中维护长期任务队列；
- `pk_fts_terms` 与 `pk_fts_trigram`：以 `pk_sections.rowid` 对齐的 FTS5 文档候选表。

需要过滤、排序、唯一性和关联的字段使用普通列与 B-tree 索引。JSON TEXT 只用于低频、可扩展的适用路径/操作元数据，不承担 repository、workspace、source、kind、state 等主查询条件。数据库不保存整库副本代次；日常写入直接应用 source/section 差异。

Source、section 和知识单元使用稳定 anchor：Markdown section 由标题路径和同名标题序号确定，知识单元使用自身 ID。插入无关标题不会导致后续全部 section 改写。

#### 增量更新

任务入口合并 Comet changed hint、Git 变化路径和来源文件的路径、大小、修改时间，只定位可能变化的来源，不读取未变化文件正文。

变化文件在事务外读取并解析，与数据库现有 `source + anchor` 内容直接比较。写入前再次确认文件元数据没有继续变化，然后在短事务中只插入、修改或删除有差异的 section 和 FTS 行；项目知识单元在独立仓库中按稳定 ID 做有界差异写入。未变化来源及变化文件中未变化的 section 保持原行。

删除来源时只删除该来源关联内容。变化文件更新完成前，它的较早内容不参与结果，但其余 SQLite 索引继续召回，并由限定到变化文件的 ripgrep 提供当前内容。普通单文件变化只产生一次文件读取、section 解析、差异比较和小批量写入。

首次无索引时在有界预算内建立索引；只有首次建库、索引结构、分词方式、语料根、workspace identity 变化或数据库损坏时才全量恢复。Local 使用 WAL、单写者、有限等待和短事务；网络文件系统不作为支持场景。锁、损坏、FTS5 缺失或迁移失败均回退 ripgrep，并给出不含敏感信息的诊断。

## 混合召回

### Scenario: 混合召回、排序与注入预算

查询输入包括任务、可选目标路径、phase 和 operation。查询规划分别保留 strong、phrase 和 weak 预算：

- strong：显式标识符、路径、命令、错误码、版本和文件名；
- phrase：完整中文技术短语和完整任务短语；
- weak：英文普通词和有限中文片段。

strong 与 phrase 先保留，weak 不能把它们挤出候选预算。各通道只使用适合自己的查询词，不把大量弱中文片段无差别组合。

候选通道包括 FTS terms、FTS trigram、ripgrep exact、变化文件 ripgrep 和有限一跳关系扩展。候选先按各通道排名做确定性融合，再按强锚点覆盖、目标路径、phase/operation、来源类型、单元来源、归档属性和来源多样性重排。

任何结果进入上下文前必须确认来源仍在允许范围、文件存在、workspace 匹配且知识单元为 active。无可靠命中时返回空上下文。最终最多四个不同来源或标题，每段最多 1600 字符，总计最多 5000 字符；项目知识和 Personal Memory 使用独立预算。

任务开始前自动执行一次有界 prefetch。当计划涉及新模块、出现测试失败或进入 Verify 时，Agent 可以通过 `comet knowledge query` 使用更具体的任务、路径或 operation 再检索一次。补充查询只读，不修改知识。

#### 候选与注入预算

首版内部初值为：

| 类别/通道              | 初始预算  |
| ---------------------- | --------- |
| strong 查询词          | 8         |
| phrase 查询词          | 8         |
| weak 查询词            | 12        |
| FTS terms/BM25 候选    | Top-40    |
| FTS trigram 候选       | Top-20    |
| ripgrep exact 候选     | Top-20    |
| 变化文件 ripgrep 候选  | Top-20    |
| 单个知识单元的一跳关系 | 最多 4 个 |

候选使用 Reciprocal Rank Fusion 合并，再进行确定性特征重排。这些值由固定评测调整，不作为首版用户配置。

最终 4 个结果中最多使用 2 个 active 项目知识单元和 2 个 supporting section/source；知识单元约占 Project Knowledge 字符预算的 60%，支持来源约占 40%。Personal Memory 只注入 1–3 个明确适用的 global/project 偏好或个人经验，并使用自己的预算。同一事实只保留项目维护单元或自动生成单元中的一个，避免与支持来源重复占用上下文。

## 项目知识单元

### Scenario: 项目知识单元的模型、状态与来源

项目知识对象统一称为“项目知识单元（Project Knowledge Unit）”，是可以独立召回、组合和更新的最小工程知识对象。

首期 kind：

- `project-map`：项目入口、分层、关键目录、生成物和主要验证命令；
- `module-overview`：模块职责、边界、输入输出和依赖方向；
- `behavior-note`：实现顺序、兼容语义、默认行为和例外；
- `integration-path`：定义、注册、初始化、消费和生成路径；
- `change-impact`：修改某类对象时需要核对的调用方、配置、测试、文档和生成物；
- `build-test`：构建、测试、lint、平台差异和常见失败。

状态只允许 `draft | active | retired`，来源只允许 `maintained | generated`。每个单元包含稳定 ID、kind、title、summary、origin、state、适用路径/操作、带来源的结论、有限关系和验证方式。

项目维护单元写在固定目录：

```text
docs/comet/knowledge/
├── README.md
└── units/
    └── *.md
```

该目录是人和 Agent 都可读、可版本化的项目资产。自动生成单元和 SQLite 索引只保存在用户缓存；只有用户明确执行共享动作时才写项目文件。

共享 Markdown 使用 YAML frontmatter 保存 schema、ID、kind、state、适用路径/操作、关系和来源；正文使用固定高密度结构：

1. 职责或结论；
2. Agent 何时使用；
3. 行为语义或影响链；
4. 修改时必须核对；
5. 来源；
6. 验证方式。

共享文件只保存项目相对 source/anchor，不保存本地绝对路径、用户对话、凭据或完整命令日志。文件内容通过与 SQLite 相同的 parser 和校验器进入召回，避免共享格式与本地格式产生不同语义。

确定性提取器可以直接生成 `project-map`、`module-overview` 和 `build-test`；这些单元只表达来源可直接支持的事实，来源核对通过后可作为低优先级 active。宿主语义评审接收有界来源包，只能提出 `behavior-note`、`integration-path` 和 `change-impact` 的 create/update/retire 动作，不能直接写数据库或项目文件。Runtime 负责 schema、路径、数量、字节、来源和状态校验。

自动语义单元只有在任务成功完成验证、每个结论都有当前来源并通过 Runtime 的 schema、路径、数量、字节和来源校验后，才能在本地从 draft 进入 active；不能仅凭验证命令列表或事件名称激活。自动单元始终低于项目维护单元，写入共享目录仍必须由用户明确确认。语义适配器不可用、超时或输出无效时，保持确定性索引、项目维护单元和混合召回可用。

## 关系

### Scenario: 项目知识关系

首期只支持受控一跳关系：`contains`、`depends-on`、`consumes`、`registers`、`propagates-to`、`generated-by`、`validated-by` 和 `supersedes`。

每条关系必须带来源。关系扩展只能补齐已经高置信命中的知识单元，不能单独把弱候选推入最终结果。SQLite 保存关系投影，不引入图数据库。

## 学习与共享

### Scenario: 学习、审核、激活与共享

Project Knowledge 可以订阅以下公共 Plugin Event：

- `verification.completed`：更新验证方式和已确认行为；
- `change.completed`：更新模块职责、集成点和影响范围；
- `task.completed`：只有存在结构化变化证据时才评审，普通聊天不触发。

事件只提供 workflow、change ID、operation、success、changed paths、artifact refs、verification commands/results 和用户纠正等有界字段，不保存完整聊天、diff、命令输出或测试日志。

Personal Memory 的 global/project 作用域和自动召回保持现有行为。个人项目经验不会自动成为共享项目知识。用户明确要求共享时，系统先去除个人信息和授权性表述，再核对当前项目来源，形成 draft 项目知识单元；只有用户确认后才写入共享目录。

## CLI 与 Dashboard

### Scenario: 管理命令与 Dashboard

CLI 提供：

```text
comet knowledge status [path] [--json]
comet knowledge query [path] --task <text> [--path <path>] [--operation <op>] [--json]
comet knowledge rebuild [path] [--json]
comet knowledge units [path] [--state active|draft|retired] [--json]
```

稳定能力包括 `status`、`query`、`rebuild`、`units.list/get`、`units.share` 和 `units.retire`。`status/query/rebuild/list/get` 不写项目；`share` 必须由显式用户动作写共享 Markdown；`retire` 对项目维护单元的修改同样需要显式用户动作。

Dashboard 是只读可观测页，显示 provider、repository/workspace、source/section/unit/relation 数量、active/draft/retired 数量、最近更新时间、回退与损坏诊断、查询耗时和候选通道统计，以及单元详情、来源和关系。它不保存完整 query，不在首期直接编辑或共享单元。

插件禁用、project pause、global disable、explicit uninstall 和恢复行为继续遵守现有 Plugin Runtime。停用或卸载时不运行 Provider、索引或语义评审；explicitRemoval 在更新后不被静默恢复。

## 实现边界

### Scenario: 实现接口与模块边界

`domains/project-knowledge/` 负责领域语义，保持 source policy、section parser、index store、unit repository、query planner 和 provider 的可测试责任边界；首期不强制新增跨层存储接口或通用图存储：

```ts
interface ProjectKnowledgeUnitRepository {
  list(): Promise<readonly ProjectKnowledgeUnit[]>;
  read(id: string): Promise<ProjectKnowledgeUnit | null>;
  writeMaintained(unit: ProjectKnowledgeUnit): Promise<void>;
}

interface ProjectKnowledgeReviewer {
  review(packet: KnowledgeReviewPacket): Promise<readonly KnowledgeReviewAction[]>;
}
```

主要代码归属：

- `domains/project-knowledge/`：source policy、section parser、查询规划、hybrid provider、融合重排、来源核对、知识单元、关系、语义评审输入、plugin、renderer、Dashboard projection 和 Remote v1 兼容；
- `platform/paths/`：repository/workspace identity 和平台缓存路径；
- `platform/storage/`：如后续出现跨领域存储需求再抽取；首期复用 Project Knowledge domain 内的最小 SQLite 适配，避免为本能力增加技术负担；
- `platform/git/`：如后续需要读取 Git changed path 再抽取；当前以文件元数据和 lifecycle hint 为主；
- `app/commands/` 与 `app/cli/`：`comet knowledge` 薄编排，不承载领域判断；
- `domains/comet-plugin/`：继续提供统一 Plugin Runtime 与事件，不为第一方 Project Knowledge 增加私有旁路；
- `domains/comet-memory/`：只增加显式共享所需的公共调用，不改变 Personal Memory 的存储和自动学习语义。

测试继续按被测对象归入 `test/domains/project-knowledge/`、`test/platform/`、`test/app/`、`test/domains/dashboard/` 和必要的 `test/repository/`。如果新增源码模块、CLI、runtime 入口或发布资产，必须同步仓库布局配置、架构检查、manifest 和对应生成资产检查。

## 安全与失败隔离

### Scenario: 安全、隐私与失败隔离

Project Knowledge 不保存 token、Authorization、环境变量值、个人对话、完整日志或无界任务内容。来源 Markdown 始终视为不可信资料，通过既有 `<project_knowledge>` 边界渲染，不能覆盖上层约束。

数据库缺失、损坏、锁超时、FTS5 不可用、来源不可读、语义适配器失败、Remote 失败、插件停用或无结果都不得阻塞 Native、Classic、hotfix 或 tweak。诊断只能包含必要的相对来源和有界错误信息。

失败处理固定如下：

| 情况                         | 行为                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| 数据库不存在                 | 在有界预算内建立索引；超出预算时本次使用 rg，并提示可显式运行 `comet knowledge rebuild` |
| 数据库损坏或结构不兼容       | 隔离不可用数据库，开始恢复；本次使用 rg                                                 |
| SQLite 写锁等待超时          | 返回未受影响的旧索引内容，并以 rg 补充变化文件，不阻塞任务                              |
| FTS5 不可用                  | 使用 rg，Dashboard 显示诊断                                                             |
| 来源在解析期间再次变化       | 不写入本轮解析结果，只对该文件执行限定范围 rg                                           |
| 来源删除、越界或无法支持结论 | 不返回相关 section/单元，保留有界诊断                                                   |
| 语义适配器不可用或输出无效   | 不生成自动语义单元，确定性索引和已维护单元继续工作                                      |
| Remote Provider 失败         | 保持 Remote v1 的空结果与诊断，不自动发送本地正文或切换 Local                           |
| 插件停用或卸载               | 不打开数据库、不运行 rg、不发送网络请求、不执行语义评审                                 |

## 评测与发布条件

### Scenario: Retrieval Eval、Agent A/B 与发布条件

Retrieval Eval 冻结当前 ripgrep Provider 作为 baseline，至少包含 50 个固定 query：15 个标识符/路径/命令/错误码，15 个中文自然语言项目任务，10 个跨模块注册/调用链/生成物问题，5 个当前 Spec 与 Archive 冲突问题，5 个 no-gold。另以独立集成 fixture 覆盖 worktree 分叉、来源修改/删除和错误项目场景；这类状态场景不要求混入固定语料文件。

每个 query 标注允许来源、gold section/unit、禁止的 Archive 来源、期望 abstain 和适用 path/operation。在同一 Top-4/5000 字符预算下比较当前 rg、修正后的 rg、FTS terms/BM25、FTS + rg hybrid、hybrid + Unit 和一跳关系。

Retrieval 指标至少包括 Recall@4、MRR、nDCG@4、来源正确率、错误来源注入率、abstain precision/recall、source diversity、每个有效字符预算的相关信息量、cold/warm p50/p95、索引大小和索引更新读取字节数。exact 子集 Recall@4 不低于修正后的 rg；全集 nDCG@4 至少提高 10%；错误来源注入和跨 workspace 串线为 0；当前 Comet 语料 warm p95 不超过 200ms，cold build p95 不超过 2s。

Agent A/B 使用同一任务前仓库快照、任务、模型/提示条件和多次运行，比较无项目知识、rg prefetch、hybrid prefetch、Unit prefetch 和补充查询。任务覆盖行为语义、集成关系和调用链传播。记录最终成功率与测试结果、首次定位 gold module 的轮次、第一次修改前的 rg/目录枚举/文件读取次数、无关模块数量、完整修改范围覆盖率、Token、轮次、工具调用、耗时以及错误知识导致的锚定或遗漏。Comet 核心不绑定模型，A/B harness 只负责校验宿主提供的同构 run 数据并汇总指标；没有宿主 run 时不得宣称模型收益。

最终成功率不得回退，第一次修改前的广域探索工具调用中位数至少下降 20%，change-impact 任务的完整修改范围覆盖率不得低于 baseline。若 hybrid 只提高速度但没有改善召回质量、完整修改范围或 Agent 探索，不把它设为 Local 默认读模型。

实现先运行当前改动的最小相关测试。跨 domain/platform、插件入口、Dashboard、Runtime、生成资产或发布准备时扩大验证；最终运行相关测试、Prettier、lint、build、生成资产检查、全量测试、固定 Retrieval Eval 和 Agent A/B。只有相对已发布版本的最终用户可见行为进入 Changelog，版本按当前 master 与已有未发布版本决定。

## 测试范围

### Scenario: 分层测试与回归验证

单元测试覆盖核心行为；并发、锁等待、FTS5 缺失和平台差异作为环境回归场景按可用条件运行，不要求每个平台都人为构造：

- strong/phrase/weak 查询预算，中文完整术语和二至四字片段，英文标识符、路径、命令与错误码；
- Markdown heading section、frontmatter、anchor、来源元数据和共享单元 parser；
- FTS5 能力探测、schema、迁移、terms/trigram 查询和 BM25 列权重；
- source/section 差异更新、删除、解析期间再次变化、并发 writer、短事务和 worktree 隔离；
- rg exact、变化文件补充、故障回退、超时、输出截断和非法 JSON；
- RRF、来源/路径/归档加权、relation cap、去重、来源多样性和 abstain；
- 项目知识单元 kind/state/origin、来源、共享格式、关系和 supersedes；
- Personal Memory 不自动进入共享单元，Project Knowledge 不产生授权动作或规则能力。

集成测试覆盖主要用户路径：

- 默认 Plugin Bridge 同时注册 Personal Memory 和 Project Knowledge，global/project 个人记忆与 Project Knowledge 各自召回、各自预算；
- Local hybrid、Remote v1、插件 disable/pause/uninstall/explicitRemoval 和失败隔离；
- Native/Classic/hotfix/tweak 统一 `comet task`，以及 prefetch 和任务内 supplemental query；
- `comet knowledge status/query/rebuild/units` CLI、JSON 输出、只读/写入边界和 Dashboard 页面；
- Plugin Event changed hint、受控语义评审、用户显式共享与来源变化后的单元更新；
- repository/workspace identity、分支/worktree 分叉、数据库损坏、FTS5 缺失、锁等待和迁移恢复；
- npm 打包后平台依赖、架构检查、相关 runtime bundle 和发布资产。

最终验证顺序为：每个 child 的最小相关测试与格式检查，child 完成前的 lint/build/必要集成检查，Supervisor 集成后的相关测试、生成资产检查、Retrieval Eval、宿主可用时的 Agent A/B、文档一致性和独立验收。全量测试若被仓库既有超时或不相关基线失败阻断，必须记录失败范围，不将其误报为 Project Knowledge 通过。

## 实施阶段

### Scenario: Supervisor 子变更与实施顺序

本 change 采用 Supervisor Change，并按真实依赖依次推进：

1. `project-knowledge-hybrid-retrieval`：冻结 baseline，修正查询规划，完成 SQLite/section 索引、来源差异更新、混合召回、status/query/rebuild、索引 Dashboard 和 Retrieval Eval；
2. `project-knowledge-units`：在混合召回基础上完成项目知识单元、共享格式、确定性提取、来源校验和一跳关系；
3. `project-knowledge-learning-management`：完成受控自动语义评审、Plugin Event、Personal Memory 显式共享、units 管理、Dashboard 单元视图、Agent A/B、文档和发布检查。

每个 child 在独立 worktree 实现和验证，并依次合入 Supervisor 分支。前一个 child 没有完成并合入时，后一个不开始。全部 child 完成后，由新的只读 Verifier 在 Supervisor 最终集成分支上验证 A1-A31。

本 change 不预先加入 embedding、RepoMap 或更广泛关系。只有固定评测证明中文同义表达、症状到根因或跨模块关系在 hybrid + Unit 下仍持续失败时，才另行 Shape；不能因为行业系统使用知识图谱就扩大本次范围。

## 调研与现状覆盖矩阵

### Scenario: 调研结论与当前代码调查覆盖

以下矩阵是 A31 的验收依据。两份输入文档为：

- `docs/research/2026-08-22-agent-project-knowledge-memory-retrieval-architecture.md`；
- `docs/research/2026-08-22-agent-project-knowledge-engine-technical-design.md`。

| 编号 | 调研或现状结论                                                                                                                               | 本规格落点                             | 验收                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------- |
| C1   | 目标不是更快搜索，而是减少 Agent 重复探索并提高完整修改范围                                                                                  | 产品定位、评测与发布条件               | A1、A15、A30        |
| C2   | 当前 rg 的主要问题包含 16 词截断、高命中后重复读取和缺少跨文档排序                                                                           | 当前实现基线、混合召回、候选与注入预算 | A5、A6、A7、A15     |
| C3   | SQLite 适合 section 候选与排序，但不能单独替代 query planner、rg 或代码核对                                                                  | Provider、本地索引、混合召回           | A2、A5、A6、A7、A11 |
| C4   | 中文需要完整术语、有限二至四字片段和 trigram 补充，不能直接使用默认 `unicode61`                                                              | Section 索引、数据模型                 | A5、A15             |
| C5   | SQLite 是按 workspace 隔离的本地读模型；过滤字段用普通列，JSON 只保存低频扩展信息                                                            | 身份与位置、数据模型                   | A3、A8、A27         |
| C6   | 日常更新必须按来源发现、按 section/单元写差异；未变化内容继续服务，变化文件由限定范围 rg 补充                                                | 增量更新、失败矩阵、单文件场景         | A8、A9、A10         |
| C7   | Personal Memory 的 global/project 偏好与项目知识必须按所有者和共享范围分开                                                                   | 产品定位、所有权与优先级、学习与共享   | A1、A23             |
| C8   | 项目作用域个人偏好应由现有 Personal Memory 按 project key 召回，不复制到 Project Knowledge                                                   | 当前实现基线、Personal Memory 场景     | A23                 |
| C9   | 项目知识需要面向 Agent 的高密度最小对象，而不只是给长文档加 FTS                                                                              | 项目知识单元、共享格式                 | A16、A17、A18、A20  |
| C10  | 自动语义沉淀需要来源、成功验证和 Runtime 校验；本地启用与团队共享分开                                                                        | 项目知识单元、学习与共享               | A19、A23、A24       |
| C11  | 关系用于补齐已命中单元的一跳影响链，不建设通用图平台                                                                                         | 关系、非目标                           | A21                 |
| C12  | 任务开始主动预取，任务过程中在计划变化、失败或 Verify 时允许精确补充                                                                         | 混合召回、CLI                          | A1、A13             |
| C13  | Local 和 Remote 继续二选一，Remote v1 不因 Local 索引变化而改变或接收本地正文                                                                | Provider、失败矩阵                     | A12、A27、A28       |
| C14  | CLI 提供最小管理面，Dashboard 提供只读状态、诊断、来源和单元详情                                                                             | CLI 与 Dashboard                       | A13、A14、A25、A26  |
| C15  | 失败必须降级而不是阻塞 workflow，来源和用户内容必须受路径、字节和隐私边界保护                                                                | 安全与失败隔离                         | A10、A22、A27、A28  |
| C16  | 必须同时做 Retrieval Eval 与 Agent A/B，包含 no-gold、来源冲突、worktree 和探索成本                                                          | 评测与发布条件                         | A15、A30            |
| C17  | 实施按 baseline/hybrid、Unit、学习与管理分阶段；更重的语义检索只由评测决定                                                                   | 实施阶段、非目标                       | A15、A30            |
| C18  | 当前代码没有针对 Project Knowledge 的规则子系统，仓库测试明确防止旧插件恢复                                                                  | 当前实现基线、所有权与优先级、非目标   | A29、A31            |
| C19  | 当前 Plugin Bridge 已并行返回 Personal Memory/Project Knowledge，项目记忆作用域已经存在                                                      | 当前实现基线、产品定位                 | A1、A23、A31        |
| C20  | Dashboard 已采用 `node:sqlite`，当前 Node/SQLite 可用 FTS5，但 Project Knowledge 必须使用独立数据库并运行时探测                              | 当前实现基线、身份与位置               | A2、A3、A14、A31    |
| C21  | 当前没有 `comet knowledge` 管理命令，现有 Project Knowledge Dashboard 只有状态与生命周期基础                                                 | 当前实现基线、CLI 与 Dashboard         | A13、A14、A25、A26  |
| C22  | 完整 research、正式规格、实现、测试、文档和发布说明必须保持同一最终语义                                                                      | 实现边界、实施阶段、本矩阵             | A29、A30、A31       |
| C23  | 技术方案中的查询、section、SQLite、并发、rg、融合、单元、Plugin、CLI、Dashboard、worktree 和打包验证需要进入分层测试，而不是只做最终全量测试 | 测试范围                               | A30、A31            |

## 场景

### Scenario: 端到端使用场景

#### 长中文任务

任务同时包含中文描述、`SQLite`、`ripgrep`、路径和错误码。查询规划先保留强标识符与完整中文短语，再分配弱片段；hybrid 返回当前 Spec 和相关项目知识单元，不因弱片段提前占满预算而丢失强锚点。

#### 单文件发生变化

一个 Spec 文件被修改。任务入口只读取该文件，比较并更新有差异的 section；其他 SQLite 内容继续召回。更新完成前，该文件由限定范围 ripgrep 提供当前内容，不重新扫描或复制全部语料。

#### 项目作用域个人偏好

用户只在 Comet 项目采用“先确认中文语义，再同步英文”。该偏好保存在 project Personal Memory 并在当前项目自动召回，不写入共享项目知识，也不对其他贡献者生效。

#### 共享个人项目经验

用户明确要求把一次已验证经验共享给团队。系统去除个人信息，打开当前来源核对结论，形成 draft 项目知识单元；用户确认后才写入 `docs/comet/knowledge/units/`。

#### 失败回退

SQLite 文件损坏或当前 Node 未提供 FTS5。Local 给出有界诊断并使用现有 ripgrep 路径，workflow 继续；不会把本地正文发送到 Remote。

## 非目标

- 针对 Project Knowledge 的规则子系统或相关预留接口；
- 完整源码 FTS、通用源码 RAG、完整 Git 历史、聊天记录、日志或 diff 索引；
- embedding、向量数据库、通用图数据库或首期文件 watcher；
- 自动把个人偏好共享给团队或自动修改项目要求、Skill、Hook、linter、测试和 CI；
- 把 Dashboard SQLite、Personal Memory 和 Project Knowledge 合成一个数据库或生命周期；
- 让项目知识代替 Agent 打开当前代码、运行测试或遵守 Native/Classic 状态。
