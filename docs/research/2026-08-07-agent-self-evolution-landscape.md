# Agent 自进化 Skill 与记忆实践研究

日期：2026-08-07

## 研究问题

Comet 是否应该提供自进化能力，让项目规范、Skill 和 Agent 记忆能够从真实运行中发现、验证和演化？如果应该，哪些已有项目值得借鉴，哪些机制不能直接照搬？

## 结论摘要

行业中的“自进化”不是一个单一能力，而是至少四个层次：

1. **记忆演化**：跨会话保存事实、偏好、经验和程序性知识。
2. **Skill 演化**：从失败轨迹中生成、修改、合并和复用 Skill。
3. **Agent Harness 演化**：修改 Agent 自身的提示、工具编排、代码或状态机。
4. **策略/规范演化**：把重复的失败、修复和团队反馈提升为带作用域和验证器的项目规则。

已有开源项目分别覆盖前 3 层，但第 4 层仍然缺少面向软件仓库、团队 ownership、代码验证和跨 Agent 交接的完整实现。Comet 最值得做的不是通用向量记忆，也不是让 Agent 随意改写 Skill，而是做：

> **Project Experience → Verified Contract：把项目运行经验提升为可验证、可回滚、可交接的团队协作契约。**

## 一、已有系统做了什么

### 1. 记忆系统：保存和组织经验，但通常不保证规则正确

**Claude Code Auto Memory** 将项目记忆和 `CLAUDE.md` 分开：`CLAUDE.md` 由人维护，用于标准、架构和工作流；Auto Memory 由 Claude 自动写入，用于构建命令、调试经验、偏好和发现的模式。它按仓库共享 worktree，但属于机器本地，并且作为上下文加载，不是强制配置。官方还明确建议过时或冲突的指令需要定期人工整理。[官方文档](https://code.claude.com/docs/en/memory)

**LangMem** 将长期记忆分为 semantic、episodic、procedural 三类。它支持 profile 更新、经验 episode 抽取，以及后台 memory manager 对记忆进行提取、合并和更新。[概念指南](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)

**Letta / MemGPT** 使用持久化 memory blocks。Block 可以由 Agent 自己编辑，也可以设置为只读；共享 block 可以让多个 Agent 看到同一份状态，但直接并发修改采用最后写入胜出，系统本身不等同于规范治理。[Memory Blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)

**Mem0** 将跨会话、跨工具、跨运行的长期记忆做成通用基础设施，并提供 Coding Agent 插件和自托管版本，但其核心仍是通用记忆存储、搜索和更新，不是代码仓库的验证契约。[官方文档](https://docs.mem0.ai/introduction)

**A-MEM** 更进一步，用 Zettelkasten 式结构动态生成带属性的记忆，并根据新记忆更新旧记忆之间的链接和上下文表示。[论文](https://arxiv.org/abs/2502.12110)

**判断**：记忆系统擅长回答“过去发生过什么”和“哪些经验可能相关”，但不能直接回答“这条经验是否应该成为团队强制规则”。Comet 不应把普通 memory 直接当作项目规范。

### 2. 经验反思：可以改善下一次尝试，但容易停留在文本层

**Reflexion** 不更新模型参数，而是把任务反馈转成语言反思，放入 episodic memory，供后续试验使用。[论文](https://arxiv.org/abs/2303.11366)

它证明了“失败 → 语言经验 → 下一次改进”这条路径有效，但它的记忆对象是反思文本，缺少项目级作用域、规则 owner、版本、验证器和回滚机制。

### 3. Skill 演化：失败轨迹可以产生可复用程序能力

**Voyager** 是最清晰的 Skill Library 先例：Agent 执行生成的程序，吸收环境反馈和执行错误，经过自验证确认任务完成后才把程序提交到 Skill Library，并通过检索复用。[论文](https://arxiv.org/abs/2305.16291)

**Memento-Skills** 将流程概括为 `Read → Execute → Reflect → Write`：失败后定位弱 Skill，修复并写回 Skill Library。[项目主页](https://skills.memento.run/)

**SkillClaw** 更接近团队协作场景：Client Proxy 截获 Agent 请求和 session artifacts；可选的 Evolve Server 读取共享存储，执行 Summarize → Aggregate → Execute 流程，去重、改进和验证 Skill，多个 Agent、设备或用户可以共同贡献经验。[开源仓库](https://github.com/AMAP-ML/SkillClaw)

**EvoSkill** 从失败分析中生成或修改 Skill，并用 held-out validation 的 Pareto frontier 保留真正提升程序表现的版本。[论文](https://arxiv.org/abs/2603.02766)

**CoEvoSkills / EvoSkills** 进一步指出：复杂 Skill 是多文件的 workflow 包，不能只靠一次生成。它让 Skill Generator 和 Surrogate Verifier 共同演化，用代理测试、结构化失败诊断和隐藏 oracle 的 pass/fail 反馈迭代 Skill；论文的消融结果显示，去掉 verifier 后性能明显下降。[论文](https://arxiv.org/abs/2604.01687)

**OpenSkill** 使用外部文档、代码仓库和验证锚点构造 Skill，再在沙箱中生成虚拟任务和测试，最后才做目标评测；重点是防止目标答案泄漏到 Skill 构造过程。[项目主页](https://openlair.github.io/openskill/)

**Qwen Skill Self-Play** 将 Skill 演化和任务生成一起做：Skill 路由任务生成、自动验证任务契约、寻找 solver 的学习前沿，再根据失败、成功和 utility 信号触发 Skill refinement、pruning 和 induction。[开源仓库](https://github.com/Qwen-Applications/skill-self-play)

**判断**：最可靠的 Skill 演化不是“让 Agent 修改 Markdown”，而是：

```text
失败轨迹 → 候选 Skill → 可执行验证 → 版本选择 → 再部署
```

### 4. Agent 自改：可以改进 Harness，但成本和安全边界更高

**SICA** 让 Coding Agent 修改自己的代码库，然后在 benchmark 上评估新版本，再进入下一轮。项目明确要求在 Docker 容器中运行；论文把 Agent 自身代码修改和基准评估作为闭环。[开源仓库](https://github.com/MaximeRobeyns/self_improving_coding_agent)、[论文](https://arxiv.org/abs/2504.15228)

**DSPy MIPROv2** 则代表离线优化路线：基于训练/验证集生成指令和 few-shot 候选，再通过 Bayesian Optimization 和完整评测选择更优组合。[官方实现文档](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/optimizers/MIPROv2.md)

**判断**：Harness 自改和 Prompt 优化都需要明确的评测集、指标、隔离环境和版本选择。它们不能替代项目规范治理，也不适合直接放到每次普通编码任务的热路径。

## 二、最重要的反面证据

**SkillLearnBench** 对 one-shot、self-feedback、teacher-feedback 和 Skill Creator 做了持续学习比较。结论是：持续学习在清晰、可复用的 workflow 上更有效，但跨任务稳定收益并不一致；多轮外部反馈能带来真实改进，而单靠 self-feedback 会产生 recursive drift。[论文](https://arxiv.org/abs/2604.20087)、[评测仓库](https://github.com/cxcscmu/SkillLearnBench)

**SWE-Skills-Bench** 在真实软件工程仓库上评测 49 个 Skill，报告显示大多数 Skill 没有带来 pass-rate 提升，部分 Skill 因版本不匹配或与项目上下文冲突而降低表现。[论文](https://arxiv.org/abs/2603.15401)

因此，“自进化”不能用“Agent 觉得自己变好了”作为晋升条件。必须有外部验证、项目上下文匹配和回归比较。

## 三、Comet 应该借鉴和拒绝什么

### 应该借鉴

- 借鉴 LangMem 的 semantic / episodic / procedural 分层，但把 procedural memory 改造成项目级 Contract。
- 借鉴 Reflexion 的失败经验抽取，但只把它作为候选证据，不直接成为规则。
- 借鉴 Voyager 的“验证通过后才写入 Skill Library”。
- 借鉴 SkillClaw 的 session interception、去重、聚合和团队共享经验。
- 借鉴 EvoSkill / CoEvoSkills / OpenSkill 的 held-out、surrogate、sandbox 和版本选择。
- 借鉴 SICA 的 benchmark archive、隔离执行和版本化改进。
- 借鉴 SkillLearnBench 的 paired evaluation：有/无某条规则或 Skill 的效果必须可比较。

### 不应该照搬

- 不把自然语言记忆直接当成强制规范。
- 不让 Agent 直接覆盖项目共享 `AGENTS.md`、Rule 或 Hook。
- 不以一次失败或一次成功触发规则晋升。
- 不在没有验证器的情况下自动生成阻塞性规则。
- 不把个人偏好、项目事实、团队规范和安全策略混在同一个 Memory 文件里。
- 不让共享 Skill 的自动演化绕过 provenance、权限、审查和回滚；Agent Skill 的研究已经指出，记忆/配置污染和多 Agent 传播是重要攻击面。[安全分析](https://arxiv.org/abs/2604.02837)

## 四、对 Comet 的具体结论

Comet 不应做通用 Mem0/Letta 替代品，也不应做只会生成 Skill 的 EvoSkill 克隆。最合适的独立位置是：

> **Project Experience Runtime：面向代码仓库的经验采集、规范候选生成、可执行验证、规则晋升和团队交接 Runtime。**

它和通用自进化系统的差异在于：Comet 拥有更强的外部真值来源——代码、编译器、测试、lint、CI、Git diff、Review、Native/Classic 状态和 Archive。普通 Agent 只能把失败写成“经验”；Comet 可以把失败关联到具体文件、命令、阶段、change、验证结果和责任范围。

建议的核心对象不是 `memory` 或 `SKILL.md`，而是一个 **Experience Record**：

```text
task / change
→ touched scope
→ observed action
→ failure or correction
→ repair attempt
→ validator result
→ human / CI / review feedback
→ candidate experience
```

候选经验只有经过以下路径，才能晋升为项目 Contract 或 Skill：

```text
observed
→ candidate
→ shadow replay
→ accepted / rejected
→ enforced
→ monitored
→ deprecated or rolled back
```

其中 `shadow replay` 是 Comet 最值得做的关键创新：在不阻塞当前开发的情况下，用历史 change、失败轨迹、固定测试和当前项目状态重放候选规则，判断它是否真的减少错误，是否误伤其他目录，是否与已有规范冲突。

## 最终判断

行业已经证明了三件事：

1. 经验可以在不改模型参数的情况下沉淀为 Memory 或 Skill。
2. Skill 可以通过失败轨迹和可执行验证自动演化。
3. 仅凭 Agent 自反馈会漂移；仅生成一份漂亮的规则文件也不能证明有效。

因此 Comet 的创新方向不应叫“自进化 Memory”，而应叫：

> **以项目运行证据为真值的自进化协作规范系统。**

它的核心护城河是“项目级外部验证 + Contract 晋升/回滚 + 跨 Agent handoff”，而不是记忆数据库、向量检索或 Markdown Skill 生成本身。
