# Project Knowledge Engine 技术调查与落地设计

## 调查范围

本调查基于 `040rc1` 当前源码、用户提供的文章、既有 Project Knowledge Dashboard/Plugin、Personal Memory、Native/Classic 生命周期、SQLite 运行环境和项目规则移除测试。调查结论用于本 change 的正式规格与验收，不把历史草稿当作现状。

## 当前实现基线

| 能力                   | 当前发现                                                                          | 落地决定                                                                  |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Local Provider         | `local-provider.ts` 对 Comet 管理的 Markdown 运行有界 ripgrep，再读取命中文件片段 | SQLite section 读模型负责常态候选，ripgrep 负责强匹配、变化来源补充和回退 |
| 查询规划               | 原实现按发现顺序限制词数，长中文任务可能先消耗弱片段预算                          | strong、phrase、weak 分开规划，保留完整中文术语与强锚点                   |
| Remote Provider        | 固定 Retrieval API v1，Local/Remote 二选一，失败不切 Local                        | 保持请求、响应、限额、隐私和失败行为                                      |
| Plugin Bridge          | `comet.personal-memory` 与 `comet.project-knowledge` 已并行注册并独立返回         | 继续使用统一 Bridge，各插件保持所有权和预算分离                           |
| Personal Memory        | 已有 global/project 作用域、project key、暂停和管理能力                           | 不重做记忆模型；项目偏好继续由 Personal Memory 召回                       |
| Project Knowledge 规则 | `domains/project-rules`、命令和入口不存在，仓库测试阻止恢复                       | 不建设、不预留规则子系统                                                  |
| Dashboard              | 已有 Project Knowledge 状态页和生命周期恢复；Dashboard 使用独立 SQLite            | Project Knowledge 使用独立用户缓存索引，页面只读展示                      |
| SQLite                 | 当前 Node 22 可用 `node:sqlite` 和 FTS5，但不是所有环境保证                       | 运行时探测；不可用、损坏或锁等待时回退 ripgrep，不要求用户配置            |
| 管理面                 | 原实现没有 `comet knowledge` 管理命令                                             | 增加 status/query/rebuild/units 最小管理面                                |

## 目标结构

### Provider 与来源

Local 的语料只包含当前 Native/Classic Spec、Archive、归档明确引用的 Superpowers 文档、项目维护单元和有限确定性提取结果。完整源码、活跃 Runtime、聊天、日志、完整 Git 历史、凭据和环境变量不进入语料。

SQLite 是按 repository/workspace 隔离的用户缓存读模型，与 Dashboard 和 Personal Memory 分离。Markdown section 使用 SQLite FTS5 做候选，关系保留轻量投影；项目知识单元保存在受保护的项目维护目录或用户缓存的独立单元仓库，在召回阶段做有界融合。生成单元把来源大小与修改时间一并保存，进程重启后仍能阻止来源变化的结论进入上下文。这样可以让单元保持结构化字段和显式共享边界，不为了首期能力复制一套通用图数据库。

### 查询与召回

查询规划提取 strong、phrase、weak 三组词。FTS terms 通道覆盖标题、标题路径、来源、英文标识符和中文术语；trigram 通道补充三字以上中文与 Unicode 子串；ripgrep 用于强匹配、生命周期 changed paths 指定的来源补充和 SQLite 失效回退。局部 changed paths 只用于补充当前来源和限制确定性提取范围，不会用局部视图覆盖全局项目概览；完整概览在无提示刷新时重建。候选使用确定性融合，当前 Spec 高于维护单元和 Archive，维护单元高于自动单元，关系只对已经命中的单元做一跳扩展。

最终结果最多四段，每段最多 1600 字符，总计最多 5000 字符。所有项目来源在注入前必须通过相对路径、存在性、大小、anchor/行范围和当前元数据核对；没有可靠命中时返回空结果。

### 项目知识单元

项目维护单元写入 `docs/comet/knowledge/units/`；自动生成单元只写用户缓存，用户显式共享后才转成维护单元。确定性提取器生成 project-map、module-overview、build-test；语义评审可以产生 behavior-note、integration-path、change-impact。来源包、单元读取和结果都受单文件、总字节和时间预算限制。

自动生成的 project-map、module-overview、build-test 在来源核对通过后可作为低优先级 active；依赖语义评审的单元必须有完整且全部成功的结构化验证结果才能 active，不能把只有命令字符串当作成功。任何 unit 的来源变化、删除或不支持结论都会阻止召回。关系类型受控，只保留带来源的一跳关系，并同步一份 SQLite 关系投影供诊断和后续扩展使用。

### 学习事件

`verification.completed`、`change.completed` 和具备结构化证据的 `task.completed` 可生成 bounded changed hint。Native/Classic 成功或失败的 verification 结果、changed paths、artifact refs 和验证结果通过 Plugin Event 传递。完整聊天、命令输出、日志和 diff 不会进入 Project Knowledge。

### 失败隔离

数据库缺失、损坏、锁等待、FTS5 不可用、来源不可读、语义评审失败、Remote 失败、插件停用或无结果都不能阻塞 Native、Classic、hotfix 或 tweak。Local 在索引不可用时使用有界 ripgrep；Remote 不读取 Local 索引和本地正文，也不因 Local 失败自动切换。

## 测试与评测

固定 Retrieval Eval 至少覆盖标识符、中文任务、跨模块关系、Spec/Archive 冲突、no-gold、worktree 分叉、来源修改/删除和错误项目。指标包括 Recall@4、MRR、nDCG@4、来源多样性、错误来源注入、abstain、p50/p95、索引大小和读取字节。Agent A/B 使用同一任务快照和模型条件，记录首次定位、广域探索调用、无关模块、完整变更范围、Token、轮次和工具调用。

当前实现已完成 50 条检索基线：混合召回 recall@4 约 0.644，nDCG@4 约 0.871，禁用来源为 0，热路径 p95 约 76ms，精确子集未回退；评测现在同时保留 ripgrep、FTS-only 和 hybrid 三种通道，并记录索引读取字节。该结果证明方向可行，但不替代真实 Agent A/B 和全量发布验证；Agent A/B 报告在缺少同一快照、模型、提示版本、独立 worktree 和补充查询集时明确标记为证据不足，不伪造结论。

## 分阶段交付

1. **混合召回**：查询规划、SQLite section 索引、ripgrep 回退、差异更新、CLI 状态和 Retrieval Eval。
2. **知识单元**：结构化单元、确定性提取、来源核对、显式共享和受控关系。
3. **学习与管理**：有界语义评审、生命周期 changed hint、units CLI、只读 Dashboard、Agent A/B 和文档发布检查。

## 设计结论

项目知识服务 Agent 的关键是“有边界的工程语义 + 当前来源核对 + 任务前后闭环”，不是把所有代码搬进数据库。SQLite 解决跨文档候选和热路径；ripgrep 保留强匹配和降级能力；项目知识单元承载模块职责、行为、集成、影响和验证；Personal Memory 单独保存用户在项目中的个人偏好。首期不增加规则系统，不增加用户调参，不引入向量或通用图平台。
