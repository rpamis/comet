# Agent 项目知识引擎详细技术方案

> 状态：Proposed
> 日期：2026-08-22
> 范围：Comet `project-knowledge`、Personal Memory、Plugin Runtime、Dashboard 与评测
> 输入：用户提供的《AI-Native 软件工程领域自迭代知识引擎》全文、现有调研结论、当前仓库实现与本地实测

背景证据与能力比较见 [Agent 项目知识、个人记忆与本地召回架构调研](./2026-08-22-agent-project-knowledge-memory-retrieval-architecture.md)。本文在其基础上固定产品边界、接口、数据模型和实施顺序。

## 1. 结论

Comet 应把现有 Project Knowledge 从“对历史 Spec/Archive Markdown 做即时 ripgrep”演进成一套 **面向 Agent 的项目理解基础设施**：

1. **SQLite FTS5 作为本地主召回读模型**，解决 section 级候选生成、相关性排序和重复后处理成本；
2. **ripgrep 保留为强标识符精确检索、脏文件补充和故障回退**，不做一刀切替换；
3. **新增带来源和生命周期的项目知识单元（Project Knowledge Unit）**，沉淀模块职责、行为约束、系统集成点、调用链传播和验证方式；
4. **任务开始自动预取，任务过程中允许补充查询，最终仍以当前代码和测试核实**；
5. **项目作用域用户偏好继续存入 Personal Memory**，由当前项目自动召回，不复制进 Project Knowledge；
6. **不新增规则子系统或预埋相关接口**；现有仓库指令、配置、Hook、编译器和测试按现状独立生效；
7. **知识生产必须进入“发现—生成—复核—启用—停用—纠正”闭环**，SQLite、关系索引或模型本身都不是事实源。

这项工作的目标不是让 Agent “不用看代码”，而是让它第一次搜索就落在正确模块、约束和影响链上，把广域探索变成定向验证。

## 2. 为什么不能只把 ripgrep 换成 SQLite

### 2.1 当前问题有三层

| 层次     | 当前问题                                                          | 单靠 SQLite 能否解决         |
| -------- | ----------------------------------------------------------------- | ---------------------------- |
| 候选生成 | 每次扫描 Markdown；高命中查询触发 500 match 截断和重复读文件      | 能明显改善                   |
| 查询理解 | 长中文任务先耗尽 16 个 term，`ripgrep`、`SQLite` 等强锚点反而丢失 | 不能，必须重做 query planner |
| 工程语义 | 文档未集中表达权限顺序、注册点、兼容规则、跨层参数传播            | 不能，必须新增项目知识单元   |

当前 checkout 的实测已经说明：同一长中文请求中，`rg` 本身约 102ms，但 Provider 总耗时约 3338ms，主要成本发生在高命中后的截断、逐 match 重读和片段处理；FTS5 原型能够把有明确锚点的查询降到毫秒级并召回当前 Spec，但弱 ngram 大量 OR 时仍会漂移。因此正确顺序是：

1. 先修复锚点提取和查询配额；
2. 再用 FTS5 建立 section 级有序候选；
3. 用 ripgrep 和工作区事实补充、复核；
4. 用项目知识单元提供代码搜索本身没有的工程语义。

### 2.2 文章中真正值得吸收的部分

用户提供的文章把知识引擎分成三类产品输出：

- Wiki：面向人类阅读和导航；
- 面向 Agent 的结构化知识单元：服务任务理解和执行；
- Memory：沉淀用户偏好、项目经验和历史交互。

Comet 不沿用原文命名。本文统一称为 **项目知识单元（Project Knowledge Unit）**：它是 Project Knowledge 中可独立召回、组合和更新的最小工程知识对象。

文章还明确了四段生命周期：扫描与生成、关系构建、治理与共享、Agent 消费；消费形态是任务前预取、任务内补充和代码验证。其三个典型收益场景也非常适合 Comet：

- **行为约束**：文件找对了，但权限顺序、兼容映射或豁免语义写错；
- **集成关系**：主体实现完成了，但遗漏注册、初始化或消费入口；
- **调用链传播**：局部类型兼容，但参数没有跨客户端、缓存和索引链完整传播。

供应商报告的 40 个 SWE-bench Pro 案例中，知识引擎得分从 30.2 提升到 38.4，Token 从 3110K 降至 2920K。这个结果只能作为“值得做 Agent A/B 评测”的产品信号，不能作为 Comet 的收益承诺，也不能证明必须复制完整知识图谱。

## 3. 产品语义与所有权边界

### 3.1 四类上下文必须分开

| 类型         | 所有者                  | 典型内容                             | 生命周期   | 是否可共享 | 是否可强制执行          |
| ------------ | ----------------------- | ------------------------------------ | ---------- | ---------- | ----------------------- |
| 当前任务状态 | 当前 workflow/workspace | phase、change、失败、临时路径        | 单任务     | 否         | 可由 Runtime Guard 执行 |
| 全局个人记忆 | 当前用户                | 跨项目沟通与协作偏好                 | 跨项目     | 默认否     | 否                      |
| 项目个人记忆 | 当前用户 × 项目         | 仅在该项目采用的个人偏好和经验       | 跨会话     | 默认否     | 否                      |
| 项目知识     | 项目/团队               | 模块职责、行为约束、集成点、验证路径 | 随仓库演进 | 可         | 否，只提供有证据的参考  |

物理上可以都使用 SQLite，但不能共用语义所有权、更新协议或冲突处理。

### 3.2 项目偏好放在哪里

确定采用以下规则：

- “我在所有项目都希望先给证据再改代码”属于全局 Personal Memory；
- “我在 Comet 项目里先确认中文语义，再同步英文”属于项目作用域 Personal Memory；
- “Comet Native Runtime 入口在 `domains/comet-native/`”属于 Project Knowledge；
- “app 不得承载领域规则”是现有仓库约束，继续由当前 `AGENTS.md` 和架构检查生效；Project Knowledge 不为它新增规则模型；
- “上次缓存状态没有更新导致这个错误”先是个人项目经验，只有完成当前代码来源复核、去除个人信息并明确共享后，才能形成项目知识单元。

因此无需在 Personal Memory 里再发明一种“项目知识”，也无需把项目偏好写进 Project Knowledge。当前任务并行召回适用的全局记忆、当前项目记忆和项目知识即可。

这里提到的“额外规则子系统”，是指把仓库中必须遵守的要求结构化，按路径和操作加载，并连接 Hook、lint 或测试执行。它解决的是“阻止不符合要求的改动”，不是“帮助 Agent 快速理解项目”。Comet 当前没有这套能力，本方案也不依赖它，因此不新增相关数据表、接口、状态或迁移；现有仓库要求继续由原有文件和检查机制生效。

### 3.3 冲突优先级

冲突时按以下顺序处理：

1. 当前用户请求、系统约束和安全边界；
2. 当前工作区代码、配置、Guard、编译器和测试给出的事实；
3. 有当前工作区来源且由项目维护的 Project Knowledge Unit；
4. 有当前工作区来源的自动生成 Project Knowledge Unit；
5. 适用的 Personal Memory；
6. 历史 Archive、已停用单元和未经确认的候选知识。

Project Knowledge 和 Personal Memory 都不得授权提交、推送、删除、发布或绕过 workflow 状态。

## 4. 目标架构

```text
                        ┌────────────────────────────┐
用户任务 + path/phase ─▶│ Comet Context Orchestrator │
                        └─────────────┬──────────────┘
                                      │ 并行、有独立预算
                            ┌─────────┴─────────┐
                            ▼                   ▼
                   Personal Memory      Project Knowledge
                    global + project     project scope plugin
                                                          │
                                      ┌───────────────────┼──────────────────┐
                                      ▼                   ▼                  ▼
                                Query Planner        Source Check       Relation Expand
                                      │                   │                  │
                                      ├──── FTS5 lexical/trigram ────────────┤
                                      └──── ripgrep exact/changed/fallback ──┘
                                                          │
                                                   Deterministic Rerank
                                                          │
                                             有界 Unit + supporting source
                                                          │
                                                   Agent 定向代码验证
```

知识生产走另一条管线：

```text
当前代码/配置/Spec/Archive/验证结果
        │
        ▼
安全扫描器 + 确定性 Extractor
        │
        ├── section / manifest / module / relation facts ──▶ SQLite index
        │
        └── bounded evidence packet
                         │
                         ▼
              Host-owned semantic review
                         │
                         ▼
              create / update / retire unit actions
                         │
                         ▼
                 schema + source validation
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
    local generated unit    maintained shared unit
     用户缓存中的投影         docs/comet/knowledge/units/*.md
```

核心 Runtime 不绑定外部模型或 API Key。语义生成通过宿主可选适配器运行；适配器不可用时，确定性索引、项目维护的知识单元和混合召回仍可工作。

## 5. 知识来源

### 5.1 首期来源

| 来源                                         | 用途                     | 是否直接作为 Agent 上下文 |
| -------------------------------------------- | ------------------------ | ------------------------- |
| 当前 Native/Classic Spec                     | 当前目标、语义和验收     | 是                        |
| Archive/历史设计                             | 决策背景和演进           | 仅相关且降权              |
| 项目维护的知识单元                           | 高密度项目理解           | 是                        |
| 自动生成的知识单元                           | 当前代码归纳出的项目事实 | 是，低于项目维护单元      |
| package manifest、构建和测试配置             | 命令、入口和依赖事实     | 主要用于生成单元          |
| 源码 import/export/registration 等确定性事实 | 模块和集成关系           | 以单元摘要提供            |
| Personal Memory                              | 用户偏好和个人经验       | 由 Memory 单独注入        |

第一阶段不把整个源码切块放入 FTS。Project Knowledge 的职责是项目理解和工程语义，不是再实现一个通用源码 RAG；具体实现细节继续使用 Agent 已有的代码搜索和阅读工具。

### 5.2 后续来源

- 通过验证的 change 结果和变更路径；
- 用户对知识单元的显式纠正；
- Git 当前变更路径和有限的版本演进关系；
- 语言/生态适配器提取的调用、注册、生成和测试关系。

首期不扫描完整聊天记录，也不索引完整 Git 历史。历史交互只先进入 Personal Memory；Git 只用于区分 worktree 和识别当前改变的文件。

## 6. 项目知识单元设计

### 6.1 单元类型

MVP 只定义六类高价值单元：

| kind               | 回答的问题                   | 典型内容                           |
| ------------------ | ---------------------------- | ---------------------------------- |
| `project-map`      | 项目从哪里进入、如何分层     | 顶层模块、入口、生成物和主验证命令 |
| `module-overview`  | 这个模块负责什么、不负责什么 | 边界、输入输出、依赖方向           |
| `behavior-note`    | 实现语义有哪些隐含要求       | 顺序、兼容、默认值、豁免条件       |
| `integration-path` | 功能如何从定义进入运行时     | 注册、初始化、消费、生成链         |
| `change-impact`    | 改这里还要同步检查哪里       | 调用方、配置、测试、文档、生成物   |
| `build-test`       | 如何构建和验证               | 最小测试、构建命令、平台差异       |

故障经验先放入 `behavior-note` 或 `change-impact`，不额外增加类型。

### 6.2 简单状态

知识单元只保留三个状态：

- `draft`：自动生成但还不应注入 Agent；
- `active`：可被召回；
- `retired`：已被新单元替代或由用户停用。

来源文件发生变化时，只更新受影响的自动生成单元；项目维护单元在召回前检查来源路径是否仍存在。这里不增加更多状态。

### 6.3 TypeScript 领域模型

```ts
type ProjectKnowledgeUnitKind =
  | 'project-map'
  | 'module-overview'
  | 'behavior-note'
  | 'integration-path'
  | 'change-impact'
  | 'build-test';

type ProjectKnowledgeUnitState = 'draft' | 'active' | 'retired';
type ProjectKnowledgeUnitOrigin = 'maintained' | 'generated';

interface ProjectKnowledgeSourceRef {
  source: string;
  anchor?: string;
  lineStart?: number;
  lineEnd?: number;
}

type ProjectKnowledgeRelationType =
  | 'contains'
  | 'depends-on'
  | 'consumes'
  | 'registers'
  | 'propagates-to'
  | 'generated-by'
  | 'validated-by'
  | 'supersedes';

interface ProjectKnowledgeUnit {
  schema: 'comet.project-knowledge-unit.v1';
  id: string;
  kind: ProjectKnowledgeUnitKind;
  title: string;
  summary: string;
  origin: ProjectKnowledgeUnitOrigin;
  state: ProjectKnowledgeUnitState;
  paths: readonly string[];
  operations: readonly string[];
  statements: readonly {
    text: string;
    sources: readonly ProjectKnowledgeSourceRef[];
  }[];
  relations: readonly {
    type: ProjectKnowledgeRelationType;
    targetId: string;
    sources: readonly ProjectKnowledgeSourceRef[];
  }[];
  verification: readonly string[];
}
```

单元 ID 使用稳定 slug；自动生成单元由类型和主要来源路径形成可重复的 key。

### 6.4 共享单元文件

采用固定默认目录：

```text
docs/comet/knowledge/
├── README.md
└── units/
    ├── project-map.md
    └── plugin-context-integration.md
```

这是人和 Agent 都可读、可版本化的项目资产，不属于 `.comet/runtime` 机器状态。自动生成单元和 SQLite 投影不写入仓库；只有用户明确要求共享时才写 Markdown。

共享文件使用 YAML frontmatter 表达 schema、适用路径、关系和来源，正文固定为以下高密度章节：

1. 职责/结论；
2. Agent 何时使用；
3. 行为约束或影响链；
4. 修改时必须核对；
5. 证据；
6. 验证方式。

共享文件只保存 source/anchor，不保存本地绝对路径、用户对话、Access Token 或完整命令日志。

## 7. SQLite FTS5 本地读模型

### 7.1 存储位置与隔离

沿用 Dashboard 的平台缓存目录策略，但使用独立数据库：

```text
Windows: %LOCALAPPDATA%/Comet/project-knowledge/<repository-id>/<workspace-id>.sqlite
macOS:   ~/Library/Caches/Comet/project-knowledge/<repository-id>/<workspace-id>.sqlite
Linux:   $XDG_CACHE_HOME/comet/project-knowledge/<repository-id>/<workspace-id>.sqlite
```

- `repository-id` 继续使用稳定 Git origin/common-dir 身份，供项目归属识别；
- `workspace-id` 使用 canonical worktree root 与 Git worktree 身份计算；
- Personal Memory 可按 repository-id 跨 worktree 共享偏好；
- Project Knowledge 必须按 workspace 隔离，避免分支和脏工作区事实串线；
- 数据库可删除、可重建，不提交 Git，不与 Dashboard 数据库共表。

索引按 worktree 隔离。任务开始时比较来源文件的路径、大小、修改时间和 Git 变更列表；发现变化后只读取相应文件，并按 section/知识单元更新有差异的行。未变化来源不重复读取，也不参与写入。

### 7.2 表结构

```sql
pk_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)

pk_sources(
  id TEXT PRIMARY KEY,
  source_uri TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
)

pk_units(
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,       -- section | fact | knowledge-unit
  knowledge_kind TEXT,
  origin TEXT NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  anchor TEXT NOT NULL,
  body TEXT NOT NULL,
  lexical_terms TEXT NOT NULL,
  path_patterns_json TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, unit_type, anchor)
)

pk_unit_sources(
  unit_id TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  anchor TEXT,
  line_start INTEGER,
  line_end INTEGER,
  PRIMARY KEY(unit_id, source_uri, anchor)
)

pk_relations(
  from_unit_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  to_unit_id TEXT NOT NULL,
  PRIMARY KEY(from_unit_id, relation_type, to_unit_id)
)

pk_changed_sources(
  source_uri TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  marked_at TEXT NOT NULL
)
```

另建两个 contentless FTS5 表并以 `pk_units.rowid` 对齐：

- `pk_fts_terms`：`unicode61`，索引 title、heading、source、英文正文及预生成 `lexical_terms`；
- `pk_fts_trigram`：`trigram`，补充三字以上中文和任意 Unicode 子串。

常用过滤字段保留普通列和 B-tree 索引。JSON 只用于低频、可扩展的 path/operation 元数据。

### 7.3 中文索引

FTS5 默认 `unicode61` 不会自动切分中文，因此索引阶段生成规范化 `lexical_terms`：

- 英文标识符、路径段、命令、错误码；
- 完整中文技术短语；
- 有限的二至四字片段；
- 项目别名、模块名和知识单元 relation target；
- 停用词、重复项和低信息片段过滤后用空格连接。

trigram 只作为补充通道，不能替代二字术语和强标识符通道。

### 7.4 来源识别、section 增量更新与并发

1. 任务入口合并 Comet 提交的 changed hint、Git 变化路径和来源文件的路径/大小/修改时间，只定位可能变化的来源，不读取未变化文件正文；
2. 只在事务外读取和解析变化文件，按 `source_uri + unit_type + anchor` 与数据库已有内容比较；section 的 anchor 由标题路径和同名标题序号组成，知识单元使用自身 ID；
3. 写入前再次读取该文件的路径/大小/修改时间；确认与解析时一致后，计算新增、修改、删除的 section/知识单元，并在一个 `BEGIN IMMEDIATE` 短事务内同步 `pk_units`、FTS 行、来源引用和关系；
4. 未变化来源及变化文件中未变化的 section 保持原行，不做复制或重写；
5. 删除来源时，只删除该来源关联的行；如果文件在解析期间再次变化，本轮不写入该文件，改由限定到该文件的 rg 提供当前内容；
6. `pk_changed_sources` 中的来源在完成更新前不返回其较早内容，但其余 SQLite 索引继续正常召回；
7. 多进程同时更新时依赖 SQLite 单 writer、有限等待和短事务，不在事务内扫描或解析文件。

数据库启用 WAL、有限 `busy_timeout` 和短事务。网络文件系统不作为支持场景。

### 7.5 冷启动、日常更新与恢复

- 无索引时，在有界预算内建立 managed-doc/units 索引；超出预算时本次使用 rg，并提示可显式运行 `comet knowledge rebuild`；
- 正常任务只做轻量变化定位，并读取、解析、写入确实变化的文件；一个文件变化不会触发整库复制或全量写入；
- workflow 的 Verify/Archive/build 命令通过 Plugin Event 提交 changed hint，减少任务入口的发现成本；
- 更新尚未完成时，查询由“未受影响的 SQLite 结果 + 限定到变化文件的 rg 结果”组成，项目知识整体仍可用；
- 只有首次建库、schema/tokenizer/source policy/workspace 身份变化或 DB 损坏时才全量重建；
- 首期不引入 watcher。

因此，普通单文件改动的额外成本是一次文件读取、section 解析、差异比较和小批量索引写入，而不是重新扫描全部语料或复制整个数据库。

如果 DB 损坏、FTS5 不可用、锁超时或 migration 失败，则关闭该 DB、记录诊断并回退 rg；Project Knowledge 失败不能阻塞 workflow。

## 8. 混合召回

### 8.1 查询模型

扩展请求：

```ts
interface ProjectKnowledgeRequest {
  task: string;
  path?: string;
  phase?: string;
  operation?: string;
  mode: 'prefetch' | 'supplemental';
}
```

`workspaceId` 和 project identity 由 Runtime 内部解析，不能相信调用者提供。

### 8.2 Query Planner

Term 不再按发现顺序共享一个 16 项数组，而是分类保留预算：

1. **strong exact**：代码标识符、路径、文件名、命令、错误码、英文技术词；
2. **domain phrase**：完整中文技术短语、知识单元 title、模块别名；
3. **weak expansion**：中文二至四字片段、路径段和少量同义别名。

首版内部预算建议为 8 个 strong、8 个 phrase、12 个 weak。strong 永远先保留，weak 不能挤掉 `SQLite`、`ripgrep`、`FTS5` 这类锚点。每种候选通道只使用适合自己的 term，不把全部弱 ngram 无差别 OR。

### 8.3 候选通道

| 通道               | 作用                                | Top-N      |
| ------------------ | ----------------------------------- | ---------- |
| FTS terms/BM25     | 标题、路径、英文和预分词中文主召回  | 40         |
| FTS trigram        | 三字以上中文/Unicode 子串补充       | 20         |
| ripgrep exact      | strong term、文件名、错误码精确命中 | 20         |
| changed-source rg  | 单个变化文件更新期间的当前内容补充  | 20         |
| relation expansion | 从高置信单元扩展一跳关系            | 每个最多 4 |

这些是实现初值，须由固定检索集调优，不暴露成第一版用户配置。

### 8.4 Source Check

任何结果进入排序前必须满足：

- source 仍位于项目允许范围内且未通过 symlink 逃逸；
- source 存在；
- source 未出现在本轮 changed 列表，或已完成增量更新；
- 知识单元的来源路径仍存在；
- state 为 active；
- workspace 与当前任务匹配。

draft 和 retired 单元不进入 Agent 上下文。Archive 可以进入上下文，但必须标注历史属性并显著降权。

### 8.5 融合与重排

第一阶段使用确定性 RRF + feature rerank，不引入模型 reranker：

1. 以各候选通道 rank 做 Reciprocal Rank Fusion；
2. strong anchor 覆盖数量优先；
3. path、operation、phase、task type 的适用性加权；
4. 项目维护单元/current-spec 高于自动生成单元/current-source，高于 archive；
5. 当前 source 高于历史 source；
6. 关系扩展只能帮助已命中单元补齐影响链，不能单独把弱关系推到 Top；
7. 最终做 source/title 去重和来源多样性控制。

如果没有 strong anchor、没有双通道一致性且得分低于经评测确定的阈值，应 abstain，返回空上下文，而不是用泛词填满 5000 字符。

### 8.6 注入预算

保留当前 4 条/5000 字符的总上限，调整内部组成：

- 最多 2 个 active Project Knowledge Unit；
- 最多 2 条 supporting section/source evidence；
- 知识单元优先使用约 60% 预算，supporting source 使用约 40%；
- Personal Memory 仍有独立预算，不计入这 5000 字符；
- 同一事实只保留项目维护单元或自动生成单元中的一个，避免与原文重复注入。

Renderer 必须输出结构化来源和验证提示，并继续通过 `<project_knowledge>` 边界注入。Retrieved text 中的指令性内容仍被视为不可信资料，不能覆盖上层约束。

## 9. Agent 消费协议

### 9.1 任务开始自动预取

继续使用现有 `CometPluginBridge.collectContext()`，并行收集：

- Personal Memory 的 global/project 适用项；
- Project Knowledge 的 prefetch 结果；
- 平台当前已经提供的 Skill/workflow context。

Project Knowledge Unit 要回答四个问题：

1. 应先看哪个模块/入口；
2. 哪个隐含行为不能改变；
3. 哪些注册点、调用方、测试或生成物可能受影响；
4. 修改后用什么最小验证确认。

Agent 得到的是可验证假设，不是最终答案。

### 9.2 任务内补充查询

新增稳定的 Plugin capability，并提供薄 CLI 适配供 Agent/Skill 调用：

```text
comet knowledge query [path] --task <text> [--path <relative>] [--operation <op>] [--json]
```

补充查询用于已形成局部问题后的精确追问，例如：

- “这个 provider 还在哪里注册？”
- “参数 `sessionKey` 需要传播到哪些层？”
- “修改 Native Runtime 后有哪些生成物和测试？”

Skill 只在需要补充时调用，不要求每轮固定查询。命令返回结构化结果和 evidence，不直接修改知识。

### 9.3 代码验证

Agent 使用知识单元后仍必须：

- 打开知识单元引用的当前 source；
- 对关键标识符和注册点做精确搜索；
- 根据当前代码修正知识单元中不完整的路径；
- 运行与修改风险匹配的测试；
- 如果来源不能支持单元结论，忽略该单元并继续以当前代码为准。

## 10. 知识生成与自迭代

### 10.1 初始生成

分两层生成，避免把全部职责交给模型：

#### A. 确定性发现

- 项目顶层目录、manifest、workspace/package 边界；
- 构建、测试、lint 和生成命令；
- TS/JS 首期适配器提取 import/export、entrypoint、registration 和 generated-by 候选关系；
- Comet `repository-layout.json`、Runtime entrypoint 和资产 manifest 等现有配置；
- 当前 Spec/Archive/项目维护单元的 section、heading 和 source anchor。

这些事实可直接进入 section/fact index，也可自动生成低风险 `project-map`、`build-test` 单元。

#### B. 宿主语义评审

Runtime 只提供 bounded evidence packet，宿主调用 `comet-project-knowledge-review` Skill/适配器，返回：

```ts
type KnowledgeReviewAction =
  | { action: 'create'; unit: ProjectKnowledgeUnitDraft }
  | { action: 'update'; id: string; patch: ProjectKnowledgeUnitPatch }
  | { action: 'retire'; id: string; reason: string };
```

Runtime 负责 schema、路径、数量、字节、evidence 和状态校验；语义适配器不能直接写 DB 或项目文件。

### 10.2 workflow 完成后的知识评审

Project Knowledge 订阅现有公共 Plugin Event：

- `verification.completed`：优先更新验证方式、行为约束和 troubleshooting；
- `change.completed`：更新模块职责、集成点、影响链和 supersedes 关系；
- `task.completed`：只在有结构化变更证据时评审，普通聊天不触发。

现有 lifecycle payload 需要扩展为 bounded evidence：

```ts
interface ProjectKnowledgeObservation {
  workflow: string;
  changeId: string;
  operation: string;
  success: boolean;
  changedPaths: readonly string[];
  artifactRefs: readonly string[];
  verificationCommands: readonly string[];
  verificationPassed: boolean;
  userCorrection?: string;
}
```

不把完整 diff、命令输出、测试日志或聊天记录写入知识库。语义评审需要额外证据时，由宿主在允许范围内读取 bounded source，再把 source/anchor 返回给 Runtime。

### 10.3 生效策略

- 确定性单元：内容可直接由配置、manifest 或静态 extractor 得出时，可成为 `active + generated`；
- 语义单元：来自通过验证的 workflow、每个结论都有 source 时，可成为 `active + generated`；
- 只有对话内容、没有 source 或与当前代码冲突时保持 draft，不注入 Agent；
- 用户纠正时更新或 retire 原单元；
- 项目内直接维护的单元使用 `maintained`，排序高于自动生成单元。

### 10.4 Personal Memory 与共享边界

Personal Memory 不自动写入 Project Knowledge。需要共享时走显式流程：

```text
个人项目经验
  └─ 用户请求共享
      └─ 去除个人信息和授权性表述
          └─ 当前仓库 source 复核
              └─ 生成 draft Project Knowledge Unit
                  └─ 用户确认后写入共享 units 目录
```

Project Knowledge 不新增规则模型，也不自动修改 `AGENTS.md`、Hook、Skill、linter 或 CI。

## 11. 关系模型：用 SQLite 图投影，不先上图数据库

文章中的知识图谱思想值得采用，但 Comet MVP 只需要有界关系边：

- 关系来源必须有 evidence；
- relation type 使用固定 enum；
- 查询只从 Top unit 扩一跳；
- 每条最多扩展 4 个关系；
- `supersedes` 用于版本演进；
- 关系来源不存在时停止扩展，不影响主体单元。

以下条件出现后再评估更完整的图能力：

1. 一跳关系在真实任务中持续遗漏关键影响链；
2. 需要跨语言调用图或 package graph；
3. 固定 relation enum 无法表达主要失败案例；
4. Agent A/B 证明关系扩展本身带来稳定收益。

第一版不引入独立图数据库，不让图查询叠加在原代码搜索上增加工具负担。

## 12. Domain、Platform 与 Plugin 接口

### 12.1 Domain 接口

```ts
interface ProjectKnowledgeSourceScanner {
  scan(input: KnowledgeScanInput): Promise<readonly KnowledgeSourceSnapshot[]>;
}

interface ProjectKnowledgeExtractor {
  supports(source: KnowledgeSourceSnapshot): boolean;
  extract(source: KnowledgeSourceSnapshot): Promise<KnowledgeExtraction>;
}

interface ProjectKnowledgeIndexStore {
  status(): Promise<KnowledgeIndexStatus>;
  applySourceDelta(input: KnowledgeSourceDelta): Promise<void>;
  removeSource(source: string): Promise<void>;
  query(input: KnowledgeIndexQuery): Promise<readonly KnowledgeCandidate[]>;
  markChanged(sources: readonly string[], reason: string): Promise<void>;
  close(): Promise<void>;
}

interface ProjectKnowledgeUnitRepository {
  list(): Promise<readonly ProjectKnowledgeUnit[]>;
  read(id: string): Promise<ProjectKnowledgeUnit | null>;
  writeMaintained(unit: ProjectKnowledgeUnit): Promise<void>;
}

interface ProjectKnowledgeReviewer {
  review(packet: KnowledgeReviewPacket): Promise<readonly KnowledgeReviewAction[]>;
}
```

Domain 只依赖这些接口，不直接散落 DB 路径、OS cache、进程和 Git 平台逻辑。

### 12.2 Platform 适配

新增：

- `platform/paths/project-knowledge-cache.ts`：repository/workspace identity 和 DB 路径；
- `platform/storage/project-knowledge-sqlite.ts`：`node:sqlite`、FTS5、WAL 和 migration；
- `platform/git/workspace-state.ts`：worktree 和改变的 source；
- 复用现有受保护项目文件读取和 bounded ripgrep；
- TS/JS extractor 可放 `domains/project-knowledge/extractors/`，底层文件/Git 访问通过 platform 注入。

Dashboard SQLite 和 Project Knowledge SQLite 不共享 schema 或连接。

### 12.3 Plugin capabilities

`comet.project-knowledge` 继续作为 project-scope first-party plugin，通过公共 Plugin Runtime 注册，不增加 first-party 私有旁路。

能力面：

| capability            | 用途                             | 是否写项目           |
| --------------------- | -------------------------------- | -------------------- |
| `status`              | provider、source/unit 统计和诊断 | 否                   |
| `query`               | 任务内补充召回                   | 否                   |
| `rebuild`             | 恢复或显式重建可删除索引         | 否，只写用户缓存     |
| `units.list/get`      | 查看 active/draft/retired        | 否                   |
| `units.share`         | 用户确认后写共享 Markdown        | 是，必须显式用户动作 |
| `units.retire`        | 停用知识单元                     | 维护单元时会写项目   |
| `units.export/import` | 团队共享或迁移                   | 是，放到后续阶段     |

`provideContext()` 只做 prefetch，不执行任何项目写入。

### 12.4 配置兼容

现有配置不需要迁移：

```yaml
knowledge:
  provider: local
```

`local` 在通过 A/B gate 后内部从 rg v1 切换成 hybrid v2。Remote Provider 的 Retrieval API v1 保持原请求/响应兼容；新增的 unit metadata 都是本地结果的可选字段。

第一版不暴露 tokenizer、权重、Top-N、数据库路径和重建时机等调参项。只有出现真实项目需要时，才考虑增加：

```yaml
knowledge:
  provider: local
  local:
    shared_root: docs/comet/knowledge
```

在此之前使用固定默认目录，减少配置和迁移面。

## 13. CLI 与 Dashboard

### 13.1 CLI

MVP 提供最少管理面：

```text
comet knowledge status [path] [--json]
comet knowledge query [path] --task <text> [--path <path>] [--operation <op>] [--json]
comet knowledge rebuild [path] [--json]
comet knowledge units [path] [--state active|draft|retired] [--json]
```

`share/retire/import/export` 在治理阶段加入，避免第一阶段把召回验证和内容编辑混在一起。

### 13.2 Dashboard

现有 Project Knowledge 页面从“配置摘要”升级为只读可观测页：

- provider 与 fallback 状态；
- repository/workspace identity；
- 最近构建时间和 source 数量；
- section/unit/relation 数量；
- active/draft/retired 统计；
- 最近 rebuild、fallback 和 corruption 诊断；
- 最近查询的耗时、候选通道和 abstain 原因，只保存统计，不保存完整用户 query；
- 单元详情和来源。

单元共享和停用先走显式 CLI/文件 review；等流程稳定后再决定是否开放 Dashboard 写操作。

## 14. 安全、隐私与可靠性

### 14.1 路径和内容安全

- 所有 source 必须是 project-relative；拒绝绝对路径和 `..`；
- 拒绝 symlink 逃逸，继续使用 protected path 读取；
- 限制单文件、总文件、总字节、解析时长、section 大小和结果大小；
- rg 参数数组直接执行，不经过 shell；
- 知识单元和索引不保存 token、Authorization header、环境变量值或完整日志；
- 用户对话和 Personal Memory 不进入共享单元，除非显式请求且完成脱敏、source 复核；
- retrieved Markdown 一律视为不可信数据，并保持现有上下文边界和警告。

### 14.2 失败策略

| 故障                     | 行为                                         |
| ------------------------ | -------------------------------------------- |
| DB 不存在                | 有界冷建；超时则 rg fallback                 |
| DB 损坏/schema 不兼容    | 隔离旧 DB，重建；本次 rg fallback            |
| SQLite lock              | 短暂等待；失败则读取未受影响索引并以 rg 补充 |
| FTS5 不可用              | rg fallback，Dashboard 诊断                  |
| source 已改变            | 只屏蔽该来源的较早内容，并以限定范围 rg 补充 |
| semantic reviewer 不可用 | 不生成自动单元，不影响检索和 workflow        |
| unit 与当前代码冲突      | 忽略该单元，以当前代码为准                   |
| remote provider 失败     | 保持当前空结果和诊断语义，不自动泄露本地正文 |

Project Knowledge 始终是可降级能力，不能成为 Comet workflow 的单点故障。

## 15. 评测设计

### 15.1 Retrieval Eval

先冻结现有 rg Provider 为 baseline，建立至少 50 条固定 query：

- 15 条标识符、路径、命令和错误码；
- 15 条中文自然语言项目任务；
- 10 条跨模块注册/调用链/生成物问题；
- 5 条 current spec 与 archive 冲突问题；
- 5 条 no-gold，应 abstain 的问题。

每条 query 标注：允许 source、gold unit/section、禁止的错误 archive source、期望 abstain、适用 path/operation。

比较：

1. 当前 rg；
2. 修复 term budget 的 rg；
3. FTS5 terms/BM25；
4. FTS5 + rg hybrid；
5. hybrid + Project Knowledge Unit；
6. hybrid + Unit + one-hop relation。

指标：Recall@4、MRR、nDCG@4、错误来源注入率、abstain precision/recall、source diversity、cold/warm p50/p95、索引大小和重建时间。

### 15.2 Agent A/B Eval

Retrieval 指标不能证明 Agent 少探索。需要在同一任务前仓库快照、同一模型/提示、每条件多次运行：

- baseline：无项目知识；
- rg prefetch；
- hybrid prefetch；
- hybrid + Unit prefetch；
- hybrid + Unit prefetch + supplemental query。

任务必须覆盖文章指出的三类失败：行为约束、集成关系、调用链传播。记录：

- 最终任务成功率和测试结果；
- 第一次定位 gold module 的轮次；
- 第一次修改前的 `rg`、目录枚举和文件读取次数；
- 探索过的无关模块数量；
- 修改范围完整率；
- Token、轮次、工具调用和耗时；
- 知识单元被验证、纠正或忽略的比例；
- 不同重复运行的结果波动。

评测单元必须由 pre-task snapshot 构建，禁止从 gold patch、任务后 diff 或答案日志泄漏。

### 15.3 建议验收门槛

P0 基线完成后冻结最终阈值；初始 gate 建议为：

- 标识符/路径 exact 子集 Recall@4 不低于修复后的 rg baseline；
- 全集 nDCG@4 相对修复后的 rg 至少提升 10%；
- 错误来源注入和跨 workspace 泄漏在确定性测试中为 0；
- 当前 Comet corpus 的 warm retrieval p95 不超过 200ms；
- 当前 Comet corpus 的 cold rebuild p95 不超过 2s；
- Agent A/B 最终成功率不回退，第一次修改前的广域探索工具调用中位数下降至少 20%；
- change-impact 任务的完整修改范围覆盖率不低于 baseline，并对注册/生成物/测试遗漏有可测改善；
- Remote API v1 兼容性测试全部保持通过。

若 hybrid 只变快但召回质量、完整变更范围或 Agent 探索没有改善，不切为默认。

## 16. 分阶段实施

### P0：基线与正式 Spec

目标：先把“成功”定义清楚，不动默认行为。

工作项：

1. 更新 `docs/comet/specs/project-knowledge/spec.md`，移除“SQLite/索引永不支持”的旧 non-goal，写入 hybrid/unit/source-check 边界；
2. 建立 50 条 Retrieval Eval 和现有 rg baseline 报告；
3. 修复 query planner 的强锚点配额，并单独测量收益；
4. 将当前长中文任务加入回归；
5. 固定现有 Remote API v1 行为和 renderer 安全边界。

退出条件：baseline 可重复、gold 标注完成、query planner 问题有测试、正式 Spec 获得确认。

### P1：SQLite FTS5 Hybrid MVP

目标：在不增加语义单元的前提下，替换本地候选读模型并证明召回收益。

工作项：

1. workspace identity、cache path、schema 和 migration；
2. Markdown section parser、source metadata 和 lexical terms；
3. source/section 差异更新和 result-time source check；
4. FTS terms/trigram、rg exact/changed/fallback；
5. deterministic fusion/rerank/abstain；
6. `status/query/rebuild` capability 与 CLI；
7. Dashboard 索引状态；
8. 性能、损坏、并发、worktree 和 fallback 测试。

退出条件：通过 Retrieval gate 后，`knowledge.provider: local` 默认使用 hybrid；否则保留 rg v1 默认并继续 shadow 对比。

### P2：Project Knowledge Unit MVP

目标：解决“数据库里仍只有长文档，Agent 还是要自己推断工程语义”的问题。

工作项：

1. unit schema、parser、validator、repository 和简单状态；
2. fixed shared root `docs/comet/knowledge/units`；
3. project-map、module-overview、build-test 确定性 extractor；
4. behavior-note、integration-path、change-impact 语义 review packet；
5. host-owned review Skill adapter，不在核心内配置模型/API Key；
6. source/anchor validation 和 draft/retired 行为；
7. prefetch renderer 的 Unit + supporting source 组成；
8. 文章三类失败场景的 Agent A/B。

退出条件：Unit 条件在不增加错误来源注入的前提下，显著减少探索并提高或保持任务成功率。

### P3：增量学习、任务内补充与治理

目标：形成可持续的“完成任务后沉淀，下个任务前复用”闭环。

工作项：

1. 扩展 verification/change lifecycle evidence payload；
2. create/update/retire review actions；
3. changed hints、增量单元更新和 supersedes；
4. supplemental query 的 CLI/Skill 使用协议；
5. units list/get/share/retire；
6. Dashboard unit/source 视图；
7. Personal Memory 显式共享路径，禁止自动写入；
8. one-hop relation expansion。

退出条件：成功任务能够产生有来源的可复用知识；来源改变后只更新受影响单元；用户能查看、共享、纠正和停用。

### P4：按证据扩展

只有 P1-P3 的评测显示存在明确缺口时再做：

- 多语言源码 extractor；
- import/export 之外的调用图；
- 本地 embedding 或向量候选通道；
- 知识单元 import/export 和团队同步；
- 更完整的版本演进视图；
- 可写 Dashboard 治理；
- Remote API v2 的 structured unit/source metadata。

不因文章使用“知识图谱”就预先建设通用图平台。

## 17. 代码改动地图

### P0/P1 预计修改

```text
domains/project-knowledge/
├── types.ts                         # request/result/status/index 类型
├── query.ts                         # 分类 term budget
├── corpus.ts                        # source policy
├── markdown-section.ts              # 新增：section + anchor + lexical terms
├── hybrid-provider.ts               # 新增：FTS/rg/source check 编排
├── reranker.ts                      # 新增：融合、重排、abstain
├── source-check.ts                  # 新增：source 校验
├── plugin.ts                        # capability、rebuild、context
├── renderer.ts                      # structured metadata 与预算
├── dashboard.ts                     # index/unit/source 状态
└── remote-provider.ts               # 保持 v1，补兼容测试

platform/
├── paths/project-knowledge-cache.ts
├── storage/project-knowledge-sqlite.ts
└── git/workspace-state.ts

app/
├── cli/index.ts
└── commands/project-knowledge.ts

test/
├── domains/project-knowledge/
│   ├── query.test.ts
│   ├── markdown-section.test.ts
│   ├── hybrid-provider.test.ts
│   ├── reranker.test.ts
│   ├── source-check.test.ts
│   ├── plugin.test.ts
│   └── remote-api.test.ts
├── platform/
│   ├── project-knowledge-cache.test.ts
│   └── project-knowledge-sqlite.test.ts
├── app/project-knowledge-command.test.ts
└── fixtures/project-knowledge/
```

### P2/P3 预计新增

```text
domains/project-knowledge/
├── units/
│   ├── schema.ts
│   ├── parser.ts
│   ├── validator.ts
│   ├── repository.ts
│   └── lifecycle.ts
├── extractors/
│   ├── project-map.ts
│   ├── manifest.ts
│   └── typescript-relations.ts
├── review-protocol.ts
└── skill-runtime.ts

assets/skills-zh/comet-project-knowledge-review/
assets/skills/comet-project-knowledge-review/

docs/comet/knowledge/
├── README.md
└── units/
```

如果新增源码模块、测试目录、runtime 入口或 Skill 资产，必须同步 `config/repository-layout.json`、架构 linter、manifest 和对应资产检查。Skill 内容先完成中文语义确认，再同步英文。

## 18. 测试范围

### 单元测试

- 中文 phrase/2-4gram、英文标识符、路径和 error code 分配；
- Markdown heading section、frontmatter、anchor 和 source metadata；
- FTS5 schema、migration、terms/trigram 查询和 BM25；
- source/section 差异更新、并发 writer 和短事务可见性；
- source 删除/修改、symlink、changed、branch/worktree 隔离；
- rg exact、fallback、timeout、truncation 和 invalid JSON；
- RRF、origin、archive penalty、relation cap、dedupe 和 abstain；
- unit parser、source、简单状态和 supersedes；
- Personal Memory 不自动进入共享 unit，Project Knowledge 不产生授权动作。

### 集成测试

- 默认 Plugin Bridge 同时注册 Personal Memory 和 Project Knowledge；
- global/project Personal Memory 与 Project Knowledge 各自召回、各自预算；
- task prefetch 与 supplemental query 一致但模式可区分；
- Verify/Archive event 只标记或生成 bounded knowledge observation；
- DB 损坏或 reviewer 缺失不阻塞 Comet；
- Remote Provider v1 行为无回归；
- Dashboard 只展示脱敏状态和证据；
- maintained unit 项目写入只能由显式 capability 触发。

### 最终验证

- P1 属于 Runtime/索引/跨模块高风险修改，最终交付前运行全量测试、lint 和 build；
- P2/P3 涉及 Skill/Plugin/Runtime 时同步生成资产并跑 repository layout/asset checks；
- 性能 benchmark 与 Agent Eval 单独保存报告，不把普通测试结果写成 Changelog；
- 只有实现形成用户可见行为后才更新 `CHANGELOG.md` 和版本，设计文档本身不升级版本。

## 19. 非目标

- 不让 Agent 完全停止代码搜索；
- 不把 SQLite、Unit 或图当作项目事实源；
- 不把 Personal Memory、Project Knowledge、Dashboard 和 workflow state 合成一个数据库；
- 不自动把用户偏好共享给团队；
- 不建设额外规则子系统，也不为未来能力预埋相关接口；
- 不在 MVP 索引全部源码正文；
- 不在 MVP 引入 embedding、向量数据库、通用图数据库或 watcher；
- 不把完整聊天、Git 历史、diff、测试日志和命令输出长期保存；
- 不因本地 hybrid 存在而改变 Remote Provider 的隐私边界；
- 不把供应商的 27.1% 实验结果当作 Comet 的交付目标。

## 20. 最终决策摘要

| 问题                             | 决策                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| ripgrep 还是 SQLite              | SQLite FTS5 主召回，rg 精确/changed/fallback                         |
| SQLite 是否是事实源              | 否，是按 workspace 隔离的可重建读模型                                |
| 是否索引全部源码                 | MVP 不做；只索引文档、知识单元和确定性工程事实                       |
| 项目偏好存哪里                   | Personal Memory `project` scope                                      |
| 项目任务召回什么记忆             | 适用 global + 当前 project 记忆                                      |
| 项目偏好是否进 Project Knowledge | 默认不进；显式共享、脱敏和 source 复核后才能形成知识单元             |
| Project Knowledge 存什么         | 可被当前仓库证据验证、可复用的项目事实与影响链                       |
| 是否建设额外规则系统             | 不建设，也不预留相关接口                                             |
| 是否需要 Project Knowledge Unit  | 需要；否则只是更快地搜索长文档                                       |
| 是否需要完整知识图谱             | MVP 不需要；固定 relation + SQLite 一跳扩展                          |
| 何时给 Agent                     | 任务开始预取 + 任务内按需补充                                        |
| 是否替代代码验证                 | 不替代，知识单元只提供定向假设和检查清单                             |
| 如何自迭代                       | workflow source → review action → source validation → active/retired |
| 是否绑定模型/API Key             | 核心不绑定；使用可选 host-owned semantic adapter                     |
| 先做什么                         | P0 query/eval → P1 FTS hybrid → P2 units → P3 lifecycle/governance   |

这套方案的关键不是“存更多”，而是让每条被 Agent 看到的项目知识都能回答：**它来自哪里、适用于哪个工作区、现在是否仍然有效、改变代码时要核对什么。**
