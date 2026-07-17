# Comet Native 演进记录

> 状态：持续维护
>
> 用途：保留 Native 从产品判断、设计、实现、加固到评估的真实迭代过程，为后续 website 文章提供可追溯素材。
>
> 边界：本文不是 Changelog，也不是新的 Runtime 事实源。最终产品契约仍以 Native 设计文档、代码、测试和正式 eval 结果为准。

主设计见 [Comet Native Workflow Design](2026-07-14-comet-native-workflow-design.md)。

## 1. 为什么保留这份记录

Native 的价值不仅在最终四阶段状态机，也在它如何从 Classic 的经验中逐步删去不再必要的过程约束。若只保留最终代码，后续很难解释以下问题：

- 为什么强模型仍需要 spec，但不再需要同样重的执行规范？
- 为什么澄清应该像 grilling 一样追踪决策树，却不能依赖外部 grilling Skill？
- 为什么一个 Skill 比多个阶段 Skill 更适合 Native？
- 为什么状态、证据、恢复和 Archive 仍然值得保留？
- 哪些看似完整的功能会把 Native 再次做成 Classic？
- Eval 的指标和样本为什么经历了调整，哪些结论是确定的，哪些只是方向性证据？

因此本文同时记录当时的假设、观察到的问题、被否决方向、实现证据、评估限制和最终决定。Website 可以从中提炼用户叙事，但不能把中间假设写成已发布事实。

## 2. 记录规则

1. 区分“当时假设”“实现事实”“评估结果”和“最终决定”，不要事后把探索过程改写成线性成功故事。
2. 保留被否决方向及原因，尤其是会增加概念、外部依赖或虚假自动化的方案。
3. 以 commit、设计文档、测试或 eval artifact 作为可追溯证据；聊天摘要不能单独证明能力已经交付。
4. 不记录隐藏思维链、用户私密信息、API key、token、`.env` 内容或本地环境敏感数据。
5. 只有原假设被证伪、用户可见结果或产品边界改变、eval 方法或结论改变、原先保留的 capability 被删除时才追加正文。普通 bugfix、review follow-up 和回归测试留在 Git 历史。
6. 分支内开发过程不直接进入面向发布用户的 Changelog；Changelog 只描述相对上个发布版本的最终用户可见差异。
7. Website 成稿应删除内部路径、临时命名和无关 commit 噪声，保留问题、取舍、证据与最终用户价值。

## 3. 起点：Spec 仍然有价值，执行应该变轻

最初的问题不是“删除 spec”，而是重新分配责任：

- Classic 的详细阶段、模式选择、TDD、review 和外部 Skill 编排，被设计用来降低能力较弱模型在复杂任务中的失控风险。
- 我们的起始假设是：强模型已经更能自主调查代码、选择实现方法、调试和验证；继续规定大量 HOW 可能增加 token、阶段切换和上下文噪声。当前对齐实验只提供方向性支持，不构成受控因果证明。
- 即使实现推理更强，模型仍可能面对模糊需求、上下文压缩、验证漂移、并发覆盖和未完成事务，因此设计上不能把 WHAT、状态、证据与恢复一起删除。

由此形成 Native 的初始公式：

```text
详细的结果契约 + 轻量的执行协议 + 确定性的状态/证据/恢复
```

Classic 与 Native 随后被明确为两套长期并存的产品，而不是复杂度等级或可互相升级的模式：Native 服务强模型，Classic 服务需要更细过程引导的模型与团队。

## 4. 2026-07-14：从设计边界到独立 Runtime

### 4.1 先切断概念混合

设计首先明确：

- Native 使用 Comet 自有 `<artifact-root>/comet/`，项目根只保存 `comet.config.yaml`。
- 用户可把 artifact root 指向 `docs` 等项目内目录。
- Native 不依赖 OpenSpec、Superpowers、grill-me、grilling 或其他外部 Skill。
- Native 与 Classic 不迁移、不升级、不共享 change，也不动态混合。
- Proposed spec 使用完整目标版本，而不是 delta patch。
- 生命周期保持 `shape → build → verify → archive`。

**判断变化：**最初需要回答的不只是“Prompt 能否更短”，而是“短 Prompt 遇到跨文件状态、并发 spec 和中断恢复时靠什么保持真实”。路径、Archive 和恢复设计说明这些机械一致性不能交给模型自报，因此 Native 采用独立 Runtime；仍未证明的是这个 Prompt 在自然模糊需求中的澄清质量。

相关设计提交：

- `bacb9bcd`：定义 Native workflow。
- `3173b93f`：明确 Native 与 Classic 分离。
- `2f4b3574`：形成 Phase 1 实施计划。

### 4.2 先交付机械事实，再写模型行为

Phase 1 的实现顺序体现了一个重要取舍：Runtime 不替模型思考，但先保证模型依赖的磁盘事实可信。

| 能力               | 代表提交               | 当时解决的问题                                                    |
| ------------------ | ---------------------- | ----------------------------------------------------------------- |
| Engine 存储布局    | `d106a303`             | Native 使用可见 `runtime/`，同时保持 Classic `.comet/` 默认不变。 |
| 安全 artifact root | `2de3a897`             | 支持项目内自定义根目录，阻止绝对路径、逃逸和冲突配置。            |
| Change 与产物存储  | `552af4de`             | 建立 Comet 自有 specs/changes/archive。                           |
| 四阶段守卫         | `050c8f16`             | 用状态和产物证据阻止跳阶段，而不规定实现方法。                    |
| 可恢复 Archive     | `ceb1ac22`             | 使用 base hash、staged tree 和事务日志更新 canonical specs。      |
| 可恢复 root move   | `b1832a51`             | 自定义根目录迁移中断后仍能继续或回滚。                            |
| 状态与诊断         | `9eabeea2`             | 用 status/doctor 从磁盘恢复，而不是依赖聊天记忆。                 |
| CLI 与打包 Runtime | `0a3d1c88`、`74f19695` | 提供 Comet 自有命令和随 Skill 分发的运行时。                      |
| 中文优先 Skill     | `4cedd0b4`             | 先确认中文行为，再同步英文。                                      |

### 4.3 第一轮实现暴露的边界问题

初版完成后没有直接把“能运行”视为“设计正确”，而是继续处理：

- 恢复错误上下文不能在包装后丢失：`db093306`。
- transaction path 必须防止软链接、junction 和恢复路径逃逸：`278e8694`。
- 中英文 Skill 必须语义一致且仍然自包含：`c3cf0003`。
- Eval 不能只看 happy path，且必须证明没有 OpenSpec、`.comet` 或外部 Skill 产物：`29bd6f11`、`34966c64`。

这轮迭代形成了后续一直保留的原则：安全和恢复问题属于 Runtime；模型行为问题属于 Skill 与 eval；两者不能互相伪装。

## 5. 2026-07-15：Phase 1.5 从“有状态”加固到“一致状态”

Phase 1.5 没有增加新阶段，而是修正初版跨文件状态可能不一致的问题。核心变化包括：

**判断变化：**初版已经对单文件写入、Archive 和 root move 做了原子写或事务保护，但普通 transition 同时更新 Run、change、trajectory 和 checkpoint。中断注入审查说明“每个文件安全”不等于“跨文件状态一致”，因此增加 write-ahead transition journal 和统一锁顺序。

- `approval` 与 `spec_changes` 只能由 Runtime 写入，brief 中的 `[blocking]` 是持久阻塞事实。
- create/replace/remove 和 canonical base hash 由 Runtime 推断并冻结。
- 普通 phase transition 增加 write-ahead journal，可从 prepared、Run 已写、change 已写等中断点 exactly-once 续做。
- root mutation lock、change lock、transaction 和 transition 使用统一锁顺序。
- `status/doctor` 交叉检查 change state、Run state、trajectory 与 checkpoint。
- canonical 冲突通过显式 rebase 回到 Build，并清除旧 verification，不做自动语义合并。

代表提交：

- `41e511d8`：加固 workflow state boundaries。
- `1a070c04`：增加独立 Native/Classic 入口路由。
- `ed917b36`：修正交互式基线推进边界。

这一阶段也第一次把 clarification、repository fact 和 interrupted transition 拆成不同 eval 场景，并建立了确定性 validator。现有仓库证据证明这些任务定义和静态检查可执行，但没有可追溯的专项真实模型实验 artifact，因此不能把任务存在写成模型行为已经得到证明；更没有证明模型会主动发现未被提示的隐藏决定。

## 6. 2026-07-16：评估对齐与指标修正

### 6.1 为什么重新对齐样本

早期 Native 与 0.4.0 Classic 的样本数、执行窗口和耗时口径不一致，不能直接把原始 duration 当作性能结论。随后把 Native 对齐到 Classic 曾运行的 16 个业务任务，每任务 3 次，共比较 96 次运行。本次 Website 报告离线读取原始顶层 result 并累加一个样本的全部模型调用耗时；当前 eval harness 的 `extract_events()` 仍会逐次覆盖 `duration_seconds`、只留下最后一个 result，后续必须单独修正。

**判断变化：**早期比较默认最后一个 `result.duration_ms` 代表整次样本，复核事件后发现多轮调用的前序耗时被漏掉；样本数也不一致。因此本次报告离线改为累加全部顶层 result，并把 Native 补齐到相同的 16 × 3。这个修正尚未进入通用 harness；即使按离线口径重算，运行窗口仍不同，所以延迟结论只能是方向性证据。

代表提交：

- `0f13d027`：对齐 Native treatment、validator 与 `pass@3` 样本矩阵；不包含 duration 聚合修复。
- `c64fc1c1`：排除 harness transport 对后续 judge evidence 的污染；旧定性 Judge 文本被弃用，没有用新代码反向改写历史结论。
- `1f0e6873`：形成 Native 与 0.4.0 Classic 的评估文章。

### 6.2 当前结果与限制

当前对齐结果为：

| 指标          | Native | 0.4.0 Classic |
| ------------- | -----: | ------------: |
| strict pass@1 |  46/48 |         43/48 |
| pass@3        |  16/16 |         16/16 |
| pass³         |  14/16 |         12/16 |
| 业务验证通过  |  48/48 |         47/48 |

评估快照截至 2026-07-16：

| 项目          | Native                          | 0.4.0 Classic                                              |
| ------------- | ------------------------------- | ---------------------------------------------------------- |
| 主模型        | Mimo 2.5 Pro                    | Mimo 2.5 Pro                                               |
| Experiment ID | `experiment_20260716_104344`    | `combined_comet_workflow_full_k3_20260705_v3_rerun_failed` |
| 运行窗口      | 2026-07-16 当前本地并发运行     | 2026-07-04 至 05 历史运行                                  |
| Analysis set  | 48/48 included，high confidence | 48/48 included，全部 flagged、medium confidence            |

持久化报告快照见 [对齐实验 HTML report](../../../website/assets/eval-reports/comet-native-vs-040-20260716/report.html)，对应 website 文件提交为 `f4d22c77`；解释材料见 [Native 与 0.4.0 Classic 评估文章](../../../website/zh/eval/comet-native-vs-040-experiment.mdx)。Experiment ID 标识原始运行；父仓库的 `0f13d027` 记录 Native 样本/validator 对齐，`c64fc1c1` 记录后续 Judge 输入修正。本次 duration 累加属于报告离线分析，尚无通用 harness 修复 commit。原始本地日志没有纳入 Git，因此本文只把持久化 report、实验标识和已提交分析边界作为可追溯证据，不宣称保存了完整可复算原始数据。

这些数据支持“Native 的轻执行没有明显牺牲这组任务的业务覆盖”，但不证明 Classic 已经没有必要，也不能证明 Native 比裸强模型更有价值。`pass@3 = 100%` 会掩盖单次失败，因此必须与 strict pass@1、pass³ 和失败归因一起阅读。

后续引用必须同时保留这些限制：

- 只有 Mimo 2.5 Pro 一个主模型，不能外推为所有强模型。
- Native 是当前并发运行，Classic 是历史运行，机器负载和服务窗口没有完全受控。
- Classic 48 个样本全部因日志可观测性规则被标为 flagged，虽未排除但只有 medium confidence。
- 部分任务仍使用 Classic 阶段术语，由 Native treatment 显式映射到 Native 生命周期。
- clarification、repository-fact、workflow 和 interrupted-transition 四个 Native 专项任务不在这次 16 任务 `pass@3` 比较中。
- 旧 Native Judge 定性文本受 transport 污染，没有用于当前结论。
- 16 个 canonical 任务运行在隔离 eval fixture 中，不能外推为大型真实仓库、长程开发或真实多 agent 协作表现。

评估审查还发现：Native 的 `native_state`、`native_trajectory` 和 `native_isolation` 等检查尚未被 workflow/business completion 分层逻辑识别，会污染 rubric 的 business/workflow 分解。这个缺陷不改变 `checks_failed == []` 的 strict pass，也不改变原 task validator 的 48/48 与 47/48 业务结果，但应在下一轮正式比较前修正。

## 7. 2026-07-16：从“流程足够轻”转向“强模型增量价值”

> 本节记录已确认的后续演进设计。Wave A 与 Wave B Runtime 切片现已在功能分支实现 schema/CAS/snapshot、in-phase checkpoint、结构化 finding、机器可读 same-skill continuation 与紧凑恢复投影；中文 Shape 行为稿仍待确认，验证新鲜度、acceptance trace、无进展控制、冲突雷达和 Dashboard 仍在后续波次，也尚未完成对应专项真实模型评估。

### 7.1 对 grilling 效果的重新判断

Native 已吸收 grilling 的单问题、推荐答案、事实与决策分离和依赖顺序，但当前 clarification eval 直接告诉模型存在 abbreviation 歧义，也明确要求询问。该任务被设计为检查提示后的协议遵守，不能检查自然请求中的主动发现；在没有专项真实模型 artifact 前，连前一种行为也不能写成已经得到证明。

因此冷启动可执行性被确认为下一阶段的 Shape 设计目标：另一个没有原对话的强模型，只读 brief、完整目标 spec 和仓库事实，就能实现并验收，不必猜测用户可见行为。当前 Skill 尚未交付这一检查。明确任务仍应允许 implicit approval，不能引入固定问卷或通用确认题。

### 7.2 为什么继续保留一个 Skill

阶段内能力增加后，曾需要重新确认是否应该把 Shape、Build、Verify 和 Archive 拆成多个 Skill。反审结论仍是保留一个：

- 多 Skill 会重新引入阶段路由、Skill 选择和上下文交接，而四阶段顺序已经由 Runtime 确定性表达。
- 强模型需要的是根据当前 phase 继续工作的同一行为入口，不是每个阶段重新加载一套方法规范。
- 当前真正缺口是 Runtime 发出的 continuation 太弱，以及宿主是否会消费它；增加入口不会修复这个问题。
- 格式、恢复和命令细节继续使用 Comet Native 自有 reference 渐进披露，不把主 Skill 变成长 Prompt。

### 7.3 从 58 个检查点收敛为 14 + 1 个路线能力

Runtime、UX 和 eval 三路审查最初展开了 58 个行为、实现和评估检查点。反向审查后确认：若把它们逐个产品化，Native 会再次变重。最终采用：

- 10 个用户可感知结果；
- 14 个产品与 Runtime 路线 capability，加一个横切的 eval 计划；
- Skill、Inspection、Progress/Evidence、Recovery/Finalize 四类稳定职责；
- 六个纵向演进波次，每个波次同时完成 Skill、Runtime、测试、eval 和文档。

审查还补出了最初清单遗漏的基础：schema 迁移、敏感信息排除与输出预算、VCS 无关快照、统一 revision/CAS、历史保留，以及安全的可选命令 receipt。Runtime 可实现性复审又进一步收紧了 checkpoint、verification scope、preflight hash、跨 worktree 保证和 receipt 执行边界。完整依赖和波次只以主设计文档第 19 节为准；附录 A 保留原始 58 项和收敛去向。

### 7.4 当前明确的非目标

- 把 Shape、Build、Verify、Archive 拆成多个公开 Skill。
- 新增 Plan、TDD、Debug、Review 等必经阶段。
- 接入外部 grilling、Superpowers 或 OpenSpec Skill。
- Native/Classic 自动升级、迁移、基于任务复杂度的动态路由或混合 change。
- 用户手写 acceptance ID、manifest、checkpoint、handoff 或依赖 DAG。
- claim、owner、lease、heartbeat、archive queue 和项目管理系统。
- Runtime 内置 LLM 做需求判断或自动语义合并。
- daemon、watcher 或后台 self-repair。
- Dashboard 写入状态或形成第二个事实源。

这些不是当前实现 backlog，而是为了维持 Native 产品边界而主动删除的方向。未来若重新打开其中任何一项，必须先重新审查 Native/Classic 边界，不能以普通功能迭代悄悄引入。

## 8. 截至当前的事实状态

快照时间为 2026-07-17，代码位于 `codex/feat-comet-native-workflow`，Runtime 基线为 `17d772c5`；release status：unreleased。这里的“已实现”只表示功能分支中存在，不表示 npm 或稳定 Website 已发布。

| 状态                    | 内容                                                                                                                                                                                                                                         | 证据边界                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能分支已实现          | 自定义 artifact root、`comet/` change/spec/archive、四阶段状态、守卫、transition/archive/root-move 恢复、schema migration、snapshot/CAS、结构化 finding/continuation、in-phase checkpoint、紧凑 status/doctor、双语单 Skill 和独立入口路由。 | 当前 feature branch 代码、单元测试、生成 runtime 和 2026-07-14 至 17 的 commits；尚未发布。                                                                |
| 已有静态与 harness 覆盖 | clarification、repository fact、完整 workflow、interrupted transition 四个专项任务及确定性 validator。                                                                                                                                       | 证明任务与检查器存在且可执行；没有专项真实模型实验 artifact 时，不证明模型行为稳定。                                                                       |
| 有方向性真实模型证据    | 16 个共同业务任务 × 3 次的 Native/Classic 对齐结果。                                                                                                                                                                                         | 只覆盖 Mimo 2.5 Pro，且运行窗口不一致；不包含四个 Native 专项任务，也没有裸强模型 Control。                                                                |
| 已确认但尚未实现        | 主设计第 19 节的中文隐藏决策主动发现稿确认与英文同步、verification evidence freshness、acceptance trace、无进展控制、archive preflight、workspace/冲突雷达和 Dashboard。                                                                     | continuation、checkpoint 与 compact resume 已有 Runtime 实现，但模型行为仍需 Skill 同步和专项 eval；其余能力只有对应切片与证据完成后才能写成当前产品能力。 |
| 当前明确非目标          | 多阶段 Skill、外部 Skill 依赖、Native/Classic 转换、固定方法流程、项目管理系统、Runtime LLM、后台 daemon 和可写 Dashboard。                                                                                                                  | 产品边界；重新打开必须先进行设计审查。                                                                                                                     |

## 9. 仍未回答的问题

- 相同模型、任务和窗口下，Native 相对裸强模型是否提高 strict success、降低返工或改善恢复？
- 自然请求没有显式提示歧义时，隐藏高影响决定的召回率和不必要提问率是多少？
- Runtime 发出 continuation 后，不同宿主实际续跑同一 Skill 的可靠性如何？
- Stale verification、长程修复与无进展停止是否真正提高成功率，而不只是增加产物？
- 同一 Native root 的 CAS 与跨 worktree advisory 是否足以保护真实多 agent 并行？
- 当前效率优势能否在同模型、同服务窗口和相同并发条件下复现？
- 冷启动 brief/spec 是否真的让第二个模型减少重新调查且不增加需求猜测？

这些问题是后续波次的证伪对象。Website 在它们得到回答前，应把它们写成开放问题或设计目标，而不是产品结论。

## 10. 后续每个纵向切片的记录模板

后续实施每个 capability 或波次时，在本文末尾追加一节并填写：

```text
## YYYY-MM-DD：<切片名称>

### 当时假设
- 期望改善的强模型失败模式：
- 为什么现有 Native 不足：
- 为什么 Runtime/Skill 的这个 seam 最小：

### 设计与边界
- 用户可见结果：
- Skill 行为变化：
- Runtime 机械事实变化：
- 明确不做：

### 证伪方法
- Current Native 对照：
- 增强版 treatment：
- 任务与重复次数：
- 硬通过标准：
- 最可能的假阳性：

### 实施过程
- 关键 commit：
- 首次失败或设计偏差：
- 修正：
- 是否改变原设计：

### 结果与决定
- 业务结果：
- 模式契约结果：
- 效率与成本：
- 限制：
- 保留、修改或删除该能力：

### Website 可用叙事
- 用户问题：
- 关键取舍：
- 可公开证据：
- 不应公开的内部过程或不确定结论：
```

模板的目的不是制造开发文档负担，而是防止长跑过程中只保留成功结果、丢失关键取舍。只有原假设、用户结果、产品边界、eval 结论或 capability 取舍发生变化时才追加；普通内部修补继续留在 Git 历史。

## 2026-07-17：波次 A——基础安全与指标可信

### 当时假设

- 期望改善的强模型失败模式：强模型可以自主决定实现方法，但长任务仍可能被进程中断、旧状态、并发写入和不完整文件拖入错误恢复；如果 Runtime 不能区分“可继续”“必须迁移”和“已损坏”，模型能力越强，错误推进也可能越快。
- 为什么现有 Native 不足：首版只有单一 `comet.native.v1` 状态和 transition journal，没有统一 revision、内容基线或 schema 迁移协议；eval 又把 Native 模式检查混入业务完成率，并只保留一个样本最后一次模型调用的 duration，导致安全结论与效率结论都可能失真。
- 为什么 Runtime/Skill 的这个 seam 最小：schema、snapshot、CAS 和恢复都属于机械事实；模型不需要理解或手写这些字段，Skill 也不需要增加阶段、计划、TDD 或调试清单。

### 设计与边界

- 用户可见结果：旧 Native change 可以显式检查和迁移；中断写入不会被误报为当前状态；同一状态 revision 的竞争写入不能静默覆盖；创建 change 时保存不含文件内容的项目基线。
- Skill 行为变化：本波不增加新的 Skill 阶段；中文 Skill 的隐藏决策与 continuation 增强留在波次 B 单独确认。
- Runtime 机械事实变化：change 和 transition 升级到 v2，记录最低 Runtime protocol 与 revision；`doctor --repair` 使用 migration journal 收口旧状态；快照只保存项目相对路径、hash、大小和类型，并采用文件数、单文件、总读取、遗漏与序列化字节预算；所有现有 change mutation 统一使用 CAS。
- 明确不做：不保存源码内容、绝对路径、环境变量或密钥；不跟随 symlink/junction；不把 Git 设为必需依赖；不让旧 Runtime 猜测更高 schema；不把迁移塞进 `status`、`show` 或普通写命令。

### 证伪方法

- Current Native 对照：以 `633a590c` 的 v1 change、transition 和原始 eval 聚合语义为基线。
- 增强版 treatment：v2 schema、VCS 无关 snapshot、统一 revision/CAS、journal 化 migration，以及修正后的 Native 指标分层和 duration 累加。
- 任务与重复次数：本波先执行确定性迁移/中断/快照/CAS 回归；Native 对齐实验的任务已准备为同任务、同模型、同窗口的配对方法，但本轮没有启动新的真实模型或 Docker 重复运行。
- 硬通过标准：旧 v1 与旧 pending transition 可以 exactly-once 收敛；迁移任一写入点中断后普通 mutation fail closed；敏感路径不进入 manifest；相同 expected revision 只能成功一次；原始 result duration 在样本内累加。
- 最可能的假阳性：只验证 happy path 会遗漏“change 已写成 v2、migration journal 尚未清除”的中间窗口；只构造完整 JSONL 会遗漏 append 被终止后的坏尾；只在普通 Git 仓库测试会遗漏 worktree 的 `.git` 普通文件。

### 实施过程

- 关键 commit：`ebfeb0c3` 修正 Native eval 指标与 duration；`7a6a5bb1` 提供后续 workspace advisory 使用的只读 Git adapter；`e46701d3` 完成 Wave A Runtime 的 schema migration、revision/CAS、baseline snapshot 与恢复协议。
- 首次失败或设计偏差：最初的新 parser 直接要求 transition 内嵌 v2 state，使已有 v1 pending transition 无法继续、又因 pending transition 无法迁移，形成恢复死锁；只检查 change schema 还会把“change.yaml 已写 v2、migration journal 未收口”误认为当前状态。
- 修正：transition schema 独立升级，migration journal 同时冻结 change 与 transition 的目标内容；任何 migration marker 都使 status/show 投影为 `migrationRequired`，并让普通 mutation 在首次写入前停止；doctor 按确定顺序补齐 baseline、transition 与 state。
- 首次失败或设计偏差：快照最初只排除 `.git` 目录，没有覆盖 worktree 的 `.git` 普通文件；权限错误、超预算遗漏、扫描期间文件消失或增长会分别导致创建失败、遗漏事实丢失或无界读取；创建失败还会留下同名不可重试的孤儿目录。
- 修正：统一排除 `.git` 文件和目录；不可读项与并发变化变成带原因的 omission；溢出尾部保留确定性 hash/ref/count；读取与最终 manifest 都有字节上限；本次创建失败只清理本次目录并允许同名重试。
- 首次失败或设计偏差：trajectory 使用 append 写入，进程被终止时可能留下唯一的无换行坏尾，导致 transition journal 永久无法继续。
- 修正：Native 层只把唯一坏尾标记为可修复，普通 transition/CAS 停止，`doctor --repair` 在锁内原子截断；任何中间行损坏仍 fail closed，不能借恢复吞掉历史。
- 是否改变原设计：没有改变“轻 Skill、机械 Runtime”的边界；实现过程反而确认 schema migration、快照预算和中断恢复必须先于 checkpoint/evidence，否则后续长跑能力会建立在不可恢复状态上。

### 结果与决定

- 业务结果：主线程验证 Native 全量 24 个测试文件、150 项通过；v1/v2 migration、旧 transition、CAS、snapshot 预算、创建回滚和 trajectory 尾部恢复均有回归覆盖。
- 模式契约结果：Native validator 现在归入 workflow completion，Control 不再被 Native 模式检查污染；一个样本的多次顶层 result duration 会累加。聚焦 eval 单元测试与脚手架测试通过，但尚无新的真实模型对照结论。
- 效率与成本：本波只修正计量口径，不用修正后的数字宣称 Native 比 Classic 或 Control 更快。
- 限制：真实模型三臂、同窗口重复运行尚未执行；snapshot 表示可观测机械范围，不证明语义归属；跨 worktree 仍没有分布式锁。
- 保留、修改或删除该能力：保留 v2 schema、VCS 无关 snapshot、统一 revision/CAS 和显式 migration；删除“旧状态可在普通写命令中被隐式升级”的方向。

### Website 可用叙事

- 用户问题：强模型不需要更重的方法清单，但仍需要一个不会把旧证据、中断文件或并发写入当成成功事实的 Harness。
- 关键取舍：把恢复、hash、revision 和敏感信息边界放进 Runtime，把实现策略继续交给模型；`status` 只报告，只有 `doctor --repair` 才改变恢复状态。
- 可公开证据：150 项 Native 回归、exactly-once migration/transition、单 revision 竞争写、受预算且排除敏感文件的 snapshot，以及修正后的 eval 聚合语义。
- 不应公开的内部过程或不确定结论：不列本地路径、临时测试名或 review 往返；在真实三臂实验前不宣称成功率、token 或耗时优于其他模式。

## 2026-07-17：波次 B Runtime 切片——判断结果可续跑，进度可恢复

### 当时假设

- 期望改善的强模型失败模式：模型能够自主实现，但宿主在一次调用结束、上下文被压缩或会话更换后，不一定知道“继续同一个 Skill”“等待用户决定”还是“先修复 Runtime”；长任务的阶段内进度也只能留在对话里。
- 为什么现有 Native 不足：`next: auto` 只是人类可读提示，不能表达 continuation disposition、所需输入或真正的用户决定；原 transition checkpoint 只证明阶段边界完成，不能保存同阶段摘要、下一动作和产物内容身份；默认 status 也没有受预算的恢复视图。
- 为什么 Runtime/Skill 的这个 seam 最小：模型继续决定怎么调查、实现和验证；Runtime 只把 findings、continuation、checkpoint、artifact hash 与恢复结果变成确定性事实，不增加 Plan、TDD、Debug、Review 阶段，也不增加 `resume` 命令。

### 设计与边界

- 用户可见结果：`status` 默认给出紧凑的当前 phase、revision、finding 摘要、最近 checkpoint 和下一动作；`--details` 才展开有界详情。`checkpoint` 在不改变 phase 的情况下保存摘要、下一动作和显式项目产物的 hash/size，下一次调用可从磁盘恢复。
- Skill 行为变化：中文稿加入隐藏决策扫描、事实/实现选择/用户选择分离、依赖顺序单问题和冷启动可执行标准；该稿仍待用户确认，未同步英文，因此本节不把模型澄清行为写成已交付双语能力。
- Runtime 机械事实变化：finding 统一为 code、severity、required action、retry/repair command 与 `requiresUserDecision`；continuation 明确 `continue`、`await-user`、`blocked` 或 `done`。Checkpoint 使用独立 WAL、统一 revision/CAS、内容寻址 manifest 和 exactly-once 恢复。
- 明确不做：`next:auto` 不表示 daemon 或后台 self-run；Runtime 不调用模型、不自动回答产品问题；checkpoint 不替用户或模型创建项目管理日志；没有新增 resume/context/handoff 命令，也没有把同阶段进度塞回 phase transition。

### 证伪方法

- Current Native 对照：以 Wave A 后仍只有 phase transition 与基础 status 的 Runtime 为基线。
- 增强版 treatment：结构化 finding/continuation、独立 checkpoint、紧凑恢复投影和冷会话专项任务。
- 任务与重复次数：确定性测试覆盖 WAL 各写入点、跨命令 mutation、revision 冲突、敏感路径、凭据脱敏、128 个产物的输出预算和生成 Runtime；Wave B 的 decision/resume eval fixture 与 validator 已通过脚手架测试，但按当前安排没有启动新的 Docker/真实模型运行。
- 硬通过标准：同一 checkpoint 重试不重复递增 revision；任何后续 mutation 必须先收口 pending WAL；默认 status 不随产物路径数量无界增长；无法证明安全修复的坏 journal 不得返回虚假的自动 repair 命令；checkpoint 新写路径不得通过内部 symlink/junction 改写其他 Native 区域。
- 最可能的假阳性：只再次调用 checkpoint 会漏掉 checkpoint 中断后立即执行 `next`、spec mutation 或 archive；只测少量产物会漏掉默认 status 的路径放大；只测最终目标 symlink 会漏掉父目录 junction 和 rename 前替换。

### 实施过程

- 关键 commit：`17d772c5` 交付 Wave B Runtime、生成的自包含 Runtime 与专项回归。
- 首次失败或设计偏差：最初 pending checkpoint 只在下一次 checkpoint 或 doctor 中恢复；`next`、spec mutation 和 archive 可以先推进 revision，使旧 WAL 永久冲突。
- 修正：所有 change-local mutation 在持有统一 mutation/transition lock 后，按 transition WAL → progress checkpoint WAL 的顺序收口，再读取准备修改的 revision；低层 CAS 默认检测 pending checkpoint 并 fail closed，只有该 WAL 自身重放可显式放行。
- 首次失败或设计偏差：默认 status 曾逐项返回 `artifact-changed:<path>`，128 个产物会放大为大量路径；损坏 checkpoint journal 又曾得到 `doctor --repair` 建议，但 doctor 无法安全修它，形成自动修复循环。
- 修正：默认投影只保存有界 code/count，完整原因只在 details 中最多返回 50 项；不可自动修复的 journal 明确要求人工检查和隔离，retry/repair command 都为 null。
- 首次失败或设计偏差：manifest 的最终路径在 Native root 内并不等于写入安全；内部 junction 可以把 checkpoint 文件重定向到 canonical spec 区域。常见凭据格式虽然被脱敏，带转义引号的 JSON credential 仍可能泄漏后缀。
- 修正：manifest、progress 与 journal 三类 checkpoint-owned 写入逐级拒绝 symlink/junction，捕获父目录和临时文件身份并在 rename 前复核；统一补齐 Bearer、Basic、URI、已知 token、private key、JSON 与 escaped JSON credential 脱敏。
- 是否改变原设计：没有增加流程或公开阶段；实现反而把“自动推进”收紧为可消费的 same-skill continuation，把“自动修复”限制为 Runtime 能证明安全的操作。

### 结果与决定

- 业务结果：Native 全量 32 个测试文件、252 项通过；生成 Runtime 资产、仓库边界与布局 8 项通过；TypeScript、Native ESLint、Prettier 和 diff check 通过。
- 模式契约结果：独立复审对 pending WAL、128 产物 status、坏 journal、junction/parent replacement 与凭据投影做真实复现后给出 GO。Runtime 契约已交付；中文 Skill 尚未确认，真实模型 clarification/continuation 效果尚未形成新结论。
- 效率与成本：默认 status 与 resume payload 现在有确定性上限，但没有真实模型数据证明 token、时间或文件读取量改善。
- 限制：checkpoint 只覆盖模型显式声明的产物，不证明 verification scope 完整；continuation 能否被不同宿主自动消费仍需真实运行；跨会话任务存在不等于模型行为已通过。
- 保留、修改或删除该能力：保留一个 Skill、独立 checkpoint、结构化 continuation 与紧凑 status；删除“`next:auto` 等同后台自动运行”“坏状态总能给自动 repair 命令”和“所有详情默认展开”的方向。

### Website 可用叙事

- 用户问题：强模型不需要被重新教一套实现方法，但它需要在中断后准确知道做到哪里、还缺什么，以及当前是否真的需要用户。
- 关键取舍：自动推进不是后台 agent，而是一份明确的同 Skill continuation；checkpoint 是 Runtime 生成的恢复事实，不是用户维护的项目管理表。
- 可公开证据：252 项 Native 回归、跨命令 exactly-once WAL、默认 status 的硬预算、内容寻址 checkpoint 与内部 junction 防护。
- 不应公开的内部过程或不确定结论：Website 不展开临时模块名和 review 往返；在中文/英文 Skill 同步与真实模型专项 eval 前，不宣称澄清质量已达到 grilling，也不宣称所有宿主都会后台续跑。

## 附录 A：原始 58 个检查点及收敛去向

这份原始清单保留探索覆盖面。它不代表 58 个待发布功能；“收敛去向”才是当前设计决定。

### A.1 Shape 与需求判断

|   # | 原始检查点       | 收敛去向                                                                  |
| --: | ---------------- | ------------------------------------------------------------------------- |
|   1 | 隐藏决策发现     | `shape-decision-frontier`。                                               |
|   2 | 决策前沿判定     | `shape-decision-frontier`。                                               |
|   3 | 依赖顺序澄清     | Skill 内的同一决策协议。                                                  |
|   4 | 无需提问识别     | Skill 与决策前沿 eval 的反向约束。                                        |
|   5 | 冷启动可执行标准 | Shape 完成定义与 `native-eval-matrix`。                                   |
|   6 | 轻量决策来源     | 继续写在 brief，不新增 decision log。                                     |
|   7 | 验收项稳定标识   | `acceptance-evidence-trace` 自动派生，不让用户维护。                      |
|   8 | 影响面提示       | 只保留可由 spec、路径和 manifest 确定性推导的提示；语义判断仍由模型完成。 |

### A.2 自动推进与上下文恢复

|   # | 原始检查点              | 收敛去向                            |
| --: | ----------------------- | ----------------------------------- |
|   9 | 明确的同 Skill 续跑契约 | `same-skill-continuation`。         |
|  10 | 单次恢复上下文包        | `compact-resume-view`。             |
|  11 | 阶段内 checkpoint       | `in-phase-checkpoint`。             |
|  12 | 增量上下文              | `compact-resume-view`。             |
|  13 | 紧凑模型视图            | `compact-resume-view`。             |
|  14 | 完整结构化错误          | `structured-diagnostics-recovery`。 |
|  15 | 确定性恢复建议          | `structured-diagnostics-recovery`。 |
|  16 | 无后台自动化            | 产品边界，不是 capability。         |

### A.3 可信验证与自主修复

|   # | 原始检查点         | 收敛去向                                                           |
| --: | ------------------ | ------------------------------------------------------------------ |
|  17 | 验证新鲜度封印     | `verification-evidence-envelope`。                                 |
|  18 | 产物 manifest      | `content-snapshot-manifest` 与 evidence envelope 共用。            |
|  19 | 结构化证据采集     | 降级为显式、可选、安全受限的命令 receipt；不监控所有 shell。       |
|  20 | 验收—证据覆盖视图  | `acceptance-evidence-trace`。                                      |
|  21 | 跳过检查的诚实表达 | 合并进 evidence trace 和现有 verification report。                 |
|  22 | 验证建议           | Skill 根据风险自主决定；Runtime 只提供确定性事实，不形成独立功能。 |
|  23 | 连续修复闭环       | 复用现有 Verify fail → Build，加深 continuation 和停止条件。       |
|  24 | 无进展检测         | `repair-stagnation-control`。                                      |
|  25 | 失败历史保留       | `repair-stagnation-control` 与保留策略。                           |
|  26 | Archive 预演       | `spec-archive-preview`。                                           |

### A.4 日常速度

|   # | 原始检查点          | 收敛去向                                                                        |
| --: | ------------------- | ------------------------------------------------------------------------------- |
|  27 | 自动选择唯一 change | 复用现有 selection/resume probe，并在 `compact-resume-view` 中消除重复调查。    |
|  28 | 合并初始化动作      | 不成为独立 capability；保持当前 `init/new` 边界，只有实测往返成本成立时再简化。 |
|  29 | Spec diff           | `spec-archive-preview` 的同一差异引擎。                                         |
|  30 | Rebase 预览         | `spec-archive-preview` 的同一差异引擎。                                         |
|  31 | 按变化读取          | `compact-resume-view`。                                                         |
|  32 | 可执行修复提示      | `structured-diagnostics-recovery`。                                             |
|  33 | 统一恢复入口        | 合并进 status/doctor，不新增 `resume` 命令。                                    |

### A.5 团队并行与多 change

|   # | 原始检查点                 | 收敛去向                                                              |
| --: | -------------------------- | --------------------------------------------------------------------- |
|  34 | Worktree/会话级 selection  | `workspace-identity-advisory`；不自动创建或切换 worktree。            |
|  35 | 工作区身份与基线           | `workspace-identity-advisory`。                                       |
|  36 | 无关修改归属保护           | snapshot + workspace advisory，只告警和防止错误认领，不推断用户意图。 |
|  37 | Active change revision/CAS | `runtime-revision-cas`，扩展到所有 Runtime mutation。                 |
|  38 | 非阻塞活动标记             | 删除；heartbeat/TTL 容易演变为 daemon 或在线协作系统。                |
|  39 | 跨 change 冲突雷达         | `multi-change-conflict-radar`。                                       |
|  40 | 安全归档顺序建议           | conflict radar 的只读推导，不增加 queue。                             |
|  41 | 可移交快照                 | 复用 checkpoint + compact resume view，不新增 handoff 协议。          |
|  42 | 轻量 prerequisite          | 暂不增加字段；先从 capability、artifact 和 base hash 推导。           |
|  43 | 可选交付引用               | 作为 snapshot 的可选引用，不成为阶段、依赖或独立 capability。         |

### A.6 产品展示

|   # | 原始检查点         | 收敛去向                                           |
| --: | ------------------ | -------------------------------------------------- |
|  44 | Native Dashboard   | 波次 F 的只读 adapter。                            |
|  45 | Change 对比视图    | 复用 `spec-archive-preview` 和 status projection。 |
|  46 | 恢复与异常视图     | 复用 `structured-diagnostics-recovery`。           |
|  47 | 多 change 冲突视图 | 复用 `multi-change-conflict-radar`。               |

### A.7 Eval 与指标

|   # | 原始检查点                                  | 收敛去向                                |
| --: | ------------------------------------------- | --------------------------------------- |
|  48 | 修正 workflow/business 指标分层             | `native-eval-matrix` 的第一项基础工作。 |
|  49 | 决策前沿配对任务                            | `native-eval-matrix`。                  |
|  50 | 冷启动交接任务                              | `native-eval-matrix`。                  |
|  51 | 自主修复任务                                | `native-eval-matrix`。                  |
|  52 | 无提示恢复任务                              | `native-eval-matrix`。                  |
|  53 | 长程范围控制任务                            | `native-eval-matrix`。                  |
|  54 | 并行协作任务                                | `native-eval-matrix`。                  |
|  55 | Control / Native / Classic 三臂比较         | `native-eval-matrix` 的正式实验设计。   |
|  56 | 多强模型验证                                | 发布级实验要求，不是 Runtime 功能。     |
|  57 | 每次 strict success 的正确指标              | `native-eval-matrix` 的指标契约。       |
|  58 | 避免 pass@3、原始耗时、检查数等误导性单指标 | `native-eval-matrix` 的报告约束。       |
