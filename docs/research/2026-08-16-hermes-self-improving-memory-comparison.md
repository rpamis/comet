# Comet 自进化记忆业界基线与推荐方案

日期：2026-08-16

## 研究问题

Comet 若希望获得真正有用的自进化记忆，应采用哪些已经形成行业共识的方法？独立 `comet-memory` Skill 与 Runtime 应如何分工，才能同时服务 Classic 和 Native？

本文只讨论 Memory 的形成、更新、遗忘、检索和治理，不讨论 Skill 自进化，也不允许记忆自动修改 Skill、项目规则或 `AGENTS.md`。

## 结论

独立 `comet-memory` Skill 的方向是合理的，但只有 Skill 不足以保证效果。当前业界更成熟的共同模式是：

```text
原始交互或任务证据
  → 后台提取值得长期保存的原子事实
  → 与相关既有记忆比较并合并
  → 创建 / 更新 / 遗忘 / 跳过
  → 按用户与项目作用域保存
  → 有界、相关、可追溯地检索
  → 用真实任务持续评测
```

Comet 应采用“共享 Skill 负责语义判断，Runtime 负责生命周期和治理”的组合：

```text
Classic / Native 稳定检查点
  → Runtime 组装有边界的复盘包
  → comet-memory Skill 输出结构化记忆动作
  → Runtime 校验语言、作用域、证据、安全和去重
  → Personal Memory 插件持久化、同步和检索
```

可以确定这条架构路线符合 Hermes、AWS AgentCore、LangMem、Claude Code、Letta 和 Mem0 的共同方向；不能预先保证某个模型和某版提示词一定好用。是否达到产品质量，必须由 Comet 自己的中英文代码工作流 Eval 证明。

## 一、2026 年业界基线

### 1. Hermes：隔离后台复盘与有界记忆

Hermes 将少量持久记忆注入后续会话，保存用户偏好、环境事实、纠正和约定，跳过容易重新发现的事实、原始数据、临时路径和会话噪声。Memory 有严格容量上限，支持增加、替换和删除，并提供重复过滤、安全扫描、通知和可选写入审批。

它的关键不是一个被动 Memory Skill，而是任务后运行的隔离后台 review Agent。后台 Agent 复盘对话快照，在没有值得保存的内容时可以明确不写入。

来源：[Hermes Persistent Memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)、[Hermes Background Review](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py)

### 2. AWS AgentCore：提取与合并分成两步

AWS 的用户偏好记忆策略公开了完整生产提示：

- 提取阶段区分用户明确表达的偏好与重复行为形成的强推断。
- 偏好主要从用户消息提取，Assistant 消息只作为支持上下文。
- 输出保持用户使用的语言。
- 合并阶段同时读取新记忆和相关既有记忆，再执行 Add、Update 或 Skip。
- 一次性状态、重复内容、过度推断、PII 和有害内容应跳过。

这套“Extraction → Consolidation”协议是最接近 Comet 需求的公开生产基线。

来源：[User preference memory strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/user-preference-memory-strategy.html)、[默认提取与合并提示](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-user-prompt.html)

### 3. LangMem：Profile、Collection 与后台形成

LangMem 将长期记忆分为 semantic、episodic 和 procedural。对 Comet 自进化记忆最相关的是 semantic memory：

- Profile 表示用户当前状态，适合有 schema、需要快速读取和人工编辑的偏好。
- Collection 保存可按任务检索的独立记录，适合项目事实和详细历史。
- 新对话与当前记忆一同交给 LLM，由模型扩展或合并状态。
- 显式重要信息可在热路径立即保存；模式分析和总结适合在后台形成。
- namespace、直接访问、元数据过滤和语义搜索可以组合使用。

LangMem 同时警告：过度提取会降低检索精度，提取不足会降低召回，因此最佳记忆系统通常需要按应用定制。

来源：[LangMem Core Concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)

### 4. Claude Code：可读文件、仓库作用域与渐进加载

Claude Code 将用户编写的 `CLAUDE.md` 与 Agent 自动写入的 Auto Memory 分开。Auto Memory 按 Git 仓库共享给所有 worktree，使用 `MEMORY.md` 作为有大小限制的入口索引，详细主题文件按需读取。用户可以直接查看、修改和删除所有记忆。

这证明代码 Agent 的长期记忆不必默认依赖数据库或全量会话回放；可读 Markdown、仓库身份、固定常驻上限和按需详情是成熟产品也在采用的边界。

来源：[Claude Code Auto Memory](https://code.claude.com/docs/en/memory)

### 5. Letta：有界 Blocks、Git 版本化与长期整理

Letta 使用有大小上限的 memory blocks 作为常驻上下文，并支持只读保护。Letta Code 进一步将上下文投影为 Git 版本化的 Context Repository：后台 reflection 定期把重要信息写入记忆仓库，defragmentation 负责拆分大文件、合并重复和整理层级，Git 负责版本、并发和回滚。

这与 Comet 的用户可读 Markdown、专用记忆仓库、跨设备 Git 同步和自动整理方向吻合。

来源：[Letta Memory Blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)、[Letta Context Repositories](https://www.letta.com/blog/context-repositories/)

### 6. Mem0：选择性记忆、混合检索与时间信息

Mem0 使用 LLM 提取和合并显著事实，再通过外部存储检索。其论文在 LoCoMo 上报告了相对全上下文方案更低的延迟和 token 成本；后续方案进一步采用分层提取、语义/关键词/实体多信号检索和时间信息。

它说明数据规模变大后，选择性检索和时间更新很重要，但不意味着 Comet MVP 应立即引入向量数据库或知识图谱。Mem0 的 benchmark 数字主要来自其自身论文和平台，应作为方向证据，不应直接当成 Comet 的效果承诺。

来源：[Mem0 论文](https://arxiv.org/abs/2504.19413)、[Mem0 Research](https://mem0.ai/research)

### 7. LongMemEval 与 LoCoMo：不能只测“有没有搜到”

LongMemEval 将长期记忆能力拆成信息提取、多会话推理、时间推理、知识更新和拒答五类，并把系统拆成 indexing、retrieval 和 reading 三阶段。LoCoMo 也显示，长上下文和普通 RAG 在时间、因果、错误归属和不可回答问题上仍明显失败。

因此，Comet 不能用领域单元测试或“成功写出 Markdown”证明记忆好用；必须测错误保存、错误更新、作用域污染、时间失效和记忆是否真正改善下一次任务。

来源：[LongMemEval](https://arxiv.org/abs/2410.10813)、[LoCoMo](https://arxiv.org/abs/2402.17753)

## 二、最适合 Comet 的最佳实践

### P0：首版必须具备

#### 1. 分离“提取”和“合并”

第一步只从本轮证据提取可能有价值的原子记忆；第二步必须读取相关既有记忆，再决定 `create`、`update`、`forget` 或 `skip`。只做提取会不断制造同义记录，也无法正确应用用户纠正。

#### 2. 稳定检查点后台复盘

普通执行只保留轻量来源引用，不在每轮消息后调用模型。成功 phase、显式 checkpoint、验证完成、任务完成和 Archive 触发非阻塞复盘。这个触发点比通用聊天 Agent 的“每轮结束”更适合代码 workflow。

用户明确说“记住”或“以后都这样”是唯一应保留的热路径，立即写入，不等待后台复盘。

#### 3. 用户消息决定偏好，工具结果只作证据

- 用户明确表达可以决定偏好内容。
- Git、测试、构建和 Review 结果可以证明项目事实或操作结果。
- Agent 自己的总结不能单独证明用户偏好。
- 失败尝试、猜测和未经验证的结论不能进入长期记忆。

#### 4. 显式与推断分轨

显式偏好和纠正立即生效。推断偏好只接受重复且一致的强信号。Comet 当前要求两个独立成功 change，是适合代码 Agent 的保守默认值；但“两次”属于需要 Eval 校准的产品启发式，不是行业已经证明的固定最优阈值。

#### 5. 使用结构化动作

`comet-memory` Skill 应输出固定 schema：

```yaml
operation: create | update | forget | skip
scope: global | project
category: preference | fact | habit | operation
content: 用户可读内容
target_id: 被更新或遗忘的记忆 ID，可为空
confidence: explicit | inferred
evidence_refs: 来源引用
```

Runtime 只接受合法动作。机器枚举保持稳定，Markdown 标题和正文根据 Comet 配置语言渲染。

#### 6. 一条动作只选择一个作用域

用户级偏好进入 global，项目事实和项目内操作习惯进入 project。同一内容不能为了“都能搜到”同时复制到两个作用域。作用域是记忆身份的一部分，不是写入后的展示选项。

#### 7. 小型常驻画像与按需详情分开

全局画像只保留少量高价值当前信息；项目详情按任务、路径和操作检索。应优先保证精度、可读性和固定上下文成本，不追求把更多历史塞入 prompt。

#### 8. 当前事实始终高于历史记忆

当前用户要求、仓库配置和可验证代码状态发生冲突时，应忽略或更新旧记忆。删除需要 tombstone 或等价的证据隔离，防止旧 observation 在下一轮重新激活用户已经删除的内容。

#### 9. 保留来源、时间和取代关系

每条记忆至少需要 `created_at`、`last_confirmed_at`、来源 change 和 `supersedes` / 历史关系。项目事实在可以重新核对时先以当前仓库为准，不根据旧记忆盲目操作。

#### 10. 安全与用户控制属于主流程

写入前过滤秘密、凭据、提示注入、越权授权和不必要的个人敏感信息。继续保留暂停学习、暂停检索、查看、纠正、删除、回滚和 Git 历史。记忆不能成为提交、推送、删除、发布或外部消息的长期授权。

### P1：数据增长后再引入

- 周期性 consolidation / defragmentation：合并同义记录、压缩来源、整理已取代内容。
- 时间有效性：为容易变化的项目事实增加当前、历史和已取代状态。
- 混合检索：结构化过滤与关键词仍是第一层；只有 Eval 证明存在明显语义漏召回时，再加入 embedding。
- 较便宜的后台模型：只有证明记忆提取质量与主模型相当后才启用。

### 当前不应引入

- 每轮对话都运行复盘。
- 保存完整会话、原始日志、完整 diff 或工具轨迹。
- 默认引入向量数据库、知识图谱或复杂时间图。
- 把每次成功任务摘要直接当成记忆。
- 从 Agent 自己的措辞反推用户偏好。
- 让个人记忆自动成为 Skill、项目规则或外部操作授权。
- 给所有偏好设置统一 TTL；稳定偏好应由纠正、删除或更强的新证据取代。

## 三、Comet 当前实现距离基线还有多远

### 已经具备的良好基础

- global / project 作用域。
- explicit / inferred 区分。
- 两个独立成功 change 后激活推断记忆。
- 来源、历史、冲突、纠正、删除和回滚。
- 有界检索、结构化过滤、用户可读 Markdown 和 Git 同步。
- 学习与检索可独立关闭，插件失败不阻塞 workflow。

### 当前影响实际效果的阻塞缺口

1. **没有真正的语义复盘**：当前 Runtime 接收的已经是 `category + text`，普通工作流默认把命令摘要作为 `workflow-operation` 观察，无法判断内容是否值得长期保存。
2. **`candidateKey` 没有进入记忆领域对象**：集成层传入该字段，但 `MemoryObservation`、持久身份和 observation key 没有使用它。
3. **同一 change 只能可靠贡献一条 observation**：当前 observation key 只有“项目 + change ID”，一个 change 内多个不同记忆候选会互相去重。
4. **同一 lifecycle 同时发送到 user 与 project scope**：记忆插件无法先做语义作用域选择，容易产生重复或污染。
5. **语言没有进入记忆形成协议**：配置中 Native / Classic 已是 `zh-CN`，但 Memory 输入没有 language 字段，自由 category 仍可能形成英文标题。
6. **只有状态机测试，没有记忆质量 Eval**：现有测试能证明存储行为按设计运行，不能证明保存内容有用，也不能证明记忆改善后续任务。

对应代码：`domains/comet-entry/plugin-context.ts`、`domains/comet-plugin/integration.ts`、`domains/comet-memory/plugin.ts`、`domains/comet-memory/types.ts`、`domains/comet-memory/personal-memory.ts`。

## 四、推荐架构

### 1. 共享 `comet-memory` Skill

Skill 只负责模型侧语义判断：

- 从复盘包中提取稳定、跨任务仍有价值的记忆。
- 与 Runtime 提供的相关既有记忆比较。
- 输出 `create / update / forget / skip`。
- 按配置语言生成用户可读内容。
- 遇到流程性知识、一次性任务、日志、diff、失败尝试和可重新发现事实时跳过。
- 不创建、修改或建议修改任何 Skill 和项目规则。

### 2. Memory Runtime

Runtime 负责：

- 在 Classic / Native 的稳定检查点统一触发复盘。
- 生成有长度上限的复盘包：配置语言、用户明确表达、用户纠正、验证后的结果、来源引用和相关既有记忆。
- 宿主支持后台 Agent / fork 时异步执行；不支持时由主 Agent 在检查点按同一 Skill 内联执行。
- 校验 schema、语言、scope、证据、秘密、提示注入和权限。
- 落实 `candidateKey`，允许同一 change 产生多个不同候选，同时保证每个候选在同一 change 只计一次证据。
- 精确写入一个作用域，执行去重、更新、遗忘、历史、同步和回滚。
- 失败时保持原记忆可用，不阻塞当前 workflow。

### 3. Personal Memory 插件

插件继续拥有领域数据、用户可读 Markdown、Runtime 状态、Git 同步、检索和 Dashboard 管理。共享 Skill 不直接编辑机器状态文件，也不绕过公开插件接口。

## 五、用 Eval 证明“真的有用”

建立 Comet 专用中英文样本，至少覆盖：

- 显式记住、显式纠正和明确遗忘。
- 单次行为不应晋升，两个独立 change 的一致信号可以晋升。
- 一次性要求、日志、diff、失败尝试和可重新发现事实必须跳过。
- global / project 作用域选择。
- 中文配置下标题与正文为中文。
- 旧记忆与当前要求、仓库现状冲突时正确忽略或更新。
- 相关记忆被检索并真正改善下一次 Agent 行为。
- 无关记忆不会造成错误操作或扩大授权。
- 不知道或没有证据时能正确跳过，而不是编造记忆。

评测应拆开测量：

| 阶段   | 核心指标                                               |
| ------ | ------------------------------------------------------ |
| 提取   | 应保存内容的召回、错误保存率、skip 准确率、语言正确率  |
| 合并   | create/update/forget/skip 动作准确率、冲突处理、重复率 |
| 作用域 | global/project 选择准确率、跨项目污染率                |
| 检索   | 相关记忆命中、无关内容注入、上下文大小与延迟           |
| 行为   | 使用记忆后任务是否更正确、是否出现负迁移或越权         |

首轮评测应比较三组：

```text
无记忆
vs. 当前命令摘要 observe
vs. comet-memory 语义复盘
```

只有语义复盘在错误记忆率、上下文成本和后续任务行为上稳定优于当前基线，才可以称为“好用”。

## 六、落地顺序

### 第一阶段：先让记忆写对

1. 新增共享 `comet-memory` Skill 和结构化动作协议。
2. 修正语言、scope、`candidateKey` 和同 change 多候选身份。
3. Runtime 生成有界复盘包并接入稳定检查点。
4. 建立中英文提取与合并 Eval。

### 第二阶段：再让记忆找得准

1. 验证小型 profile 与关键词/结构化检索的真实命中率。
2. 增加长期 consolidation 和时间更新场景。
3. 只有 Eval 显示必要时才加入 embedding 和混合排序。

## 最终判断

方案不是“装上一个 Skill 就确定好用”，而是一个高可信但仍需验证的产品方向。

最适合 Comet 的行业最佳实践是：

> 稳定检查点后台复盘、提取与合并分离、显式与推断分轨、单一作用域、有界检索、可读可回滚存储，以及面向错误记忆和实际任务收益的专用 Eval。

Comet 当前存储和治理基础大部分已经具备，但语义形成层与质量评测缺失。先补这两层，比引入向量库、知识图谱或更复杂的自进化概念更能直接解决“记录内容用户看不懂、没有用”的问题。
