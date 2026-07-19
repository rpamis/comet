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

早期 Native 与 0.4.0 Classic 的样本数、执行窗口和耗时口径不一致，不能直接把原始 duration 当作性能结论。随后把 Native 对齐到 Classic 曾运行的 16 个业务任务，每任务 3 次；当前比较器按 `task_id + repetition` 得到严格 48 对。对齐时的 fallback case manifest 只能证明两侧比较的是同一 task tree，不能证明运行窗口、服务状态、模型采样或宿主负载受控。

**判断变化：**早期比较默认最后一个 `result.duration_ms` 代表整次样本，复核事件后发现多轮调用的前序耗时被漏掉；样本数也不一致。因此离线分析和当前功能分支比较器都改为累加样本内全部顶层 result，并把 Native 补齐到相同的 16 × 3。即使按这个口径重算，运行窗口仍不同，所以延迟结论只能是方向性证据。

代表提交：

- `0f13d027`：对齐 Native treatment、validator 与 `pass@3` 样本矩阵；不包含 duration 聚合修复。
- `c64fc1c1`：排除 harness transport 对后续 judge evidence 的污染；旧定性 Judge 文本被弃用，没有用新代码反向改写历史结论。
- `1f0e6873`：形成 Native 与 0.4.0 Classic 的评估文章。

### 6.2 当前结果与限制

当前对齐结果为：

| 指标                        | Native | 0.4.0 Classic |
| --------------------------- | -----: | ------------: |
| strict pass（样本）         |  46/48 |         43/48 |
| pass@1                      |   0.96 |          0.90 |
| pass@2                      |   1.00 |          0.98 |
| pass@3                      |   1.00 |          1.00 |
| pass³（3 次都 strict pass） |   0.88 |          0.75 |
| 累加模型 duration           | 8,831s |       16,562s |
| 可累加 duration 的样本      |  48/48 |         47/48 |

评估快照截至 2026-07-16：

| 项目          | Native                          | 0.4.0 Classic                                              |
| ------------- | ------------------------------- | ---------------------------------------------------------- |
| 主模型        | Mimo 2.5 Pro                    | Mimo 2.5 Pro                                               |
| Experiment ID | `experiment_20260716_104344`    | `combined_comet_workflow_full_k3_20260705_v3_rerun_failed` |
| 运行窗口      | 2026-07-16 当前本地并发运行     | 2026-07-04 至 05 历史运行                                  |
| Analysis set  | 48/48 included，high confidence | 48/48 included，全部 flagged、medium confidence            |

持久化报告快照见 [对齐实验 HTML report](../../../website/assets/eval-reports/comet-native-vs-040-20260716/report.html)，对应 website 文件提交为 `f4d22c77`；解释材料见 [Native 与 0.4.0 Classic 评估文章](../../../website/zh/eval/comet-native-vs-040-experiment.mdx)。Experiment ID 标识原始运行；父仓库的 `0f13d027` 记录 Native 样本/validator 对齐，`c64fc1c1` 记录后续 Judge 输入修正。当前 CLI 对指定 experiment 的复算得到上表数字；0.4.0 的 duration 缺少 `comet-graph-execution-review#r2`，因此 16,562 秒只覆盖 47 个样本，不能拿总量直接计算严格加速比。原始本地日志没有纳入 Git，本文只把持久化 report、实验标识和比较器输出边界作为可追溯证据，不宣称保存了完整可复算原始数据。

这些数据支持“Native 的轻执行没有明显牺牲这组任务的 strict 覆盖”，但不证明 Classic 已经没有必要，也不能证明 Native 比裸强模型更有价值。`pass@3 = 1.00` 会掩盖单次失败，因此必须与 pass@1、pass³ 和失败归因一起阅读。8,831 秒与 16,562 秒来自不同运行窗口，且后者缺一个样本，只能作为值得在同窗口复验的方向性信号。

后续引用必须同时保留这些限制：

- 只有 Mimo 2.5 Pro 一个主模型，不能外推为所有强模型。
- Native 是当前并发运行，Classic 是历史运行，机器负载和服务窗口没有完全受控。
- Classic 48 个样本全部因日志可观测性规则被标为 flagged，虽未排除但只有 medium confidence。
- 部分任务仍使用 Classic 阶段术语，由 Native treatment 显式映射到 Native 生命周期。
- clarification、repository-fact、workflow 和 interrupted-transition 四个 Native 专项任务不在这次 16 任务 `pass@3` 比较中。
- 旧 Native Judge 定性文本受 transport 污染，没有用于当前结论。
- 16 个 canonical 任务运行在隔离 eval fixture 中，不能外推为大型真实仓库、长程开发或真实多 agent 协作表现。

评估审查当时还发现：Native 的 `native_state`、`native_trajectory` 和 `native_isolation` 等检查没有被 workflow/business completion 分层逻辑识别，会污染 rubric 的业务/模式分解。Wave A 随后修复了分类与 duration 聚合；这个历史缺陷不改变 `checks_failed == []` 的 strict 结果，但解释旧报告时仍须保留口径边界。

## 7. 2026-07-16：从“流程足够轻”转向“强模型增量价值”

> 本节记录已确认的演进设计。Wave A–F 的 Runtime、中文单 Skill 与只读 Dashboard 切片现已进入功能分支，包含 schema v3、Protected Run/File I/O、snapshot/CAS、checkpoint/continuation、验收与验证证据、repair episode、process-free workspace/conflict radar、可恢复 quarantine 和 Archive preflight。生成 Runtime、Native/入口域回归、lint 与真实 CLI 构建已经通过；功能仍未发布，英文 Skill、Website 双语、发布 Changelog 与最终全仓验证尚待统一收口。专项 eval 目前只有 fixture/validator，没有启动 Docker 或新的真实模型运行。

### 7.1 对 grilling 效果的重新判断

Native 已吸收 grilling 的单问题、推荐答案、事实与决策分离和依赖顺序，但当前 clarification eval 直接告诉模型存在 abbreviation 歧义，也明确要求询问。该任务被设计为检查提示后的协议遵守，不能检查自然请求中的主动发现；在没有专项真实模型 artifact 前，连前一种行为也不能写成已经得到证明。

因此冷启动可执行性被确认为下一阶段的 Shape 设计目标：另一个没有原对话的强模型，只读 brief、完整目标 spec 和仓库事实，就能实现并验收，不必猜测用户可见行为。当时 Skill 尚未交付这一检查；当前中文单 Skill 已加入该完成标准并进入待确认稿，尚未形成真实模型效果结论。明确任务仍应允许 implicit approval，不能引入固定问卷或通用确认题。

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

审查还补出了最初清单遗漏的基础：schema 迁移、敏感信息排除与输出预算、VCS 无关快照、统一 revision/CAS、历史保留，以及当时仍被认为可行的“安全可选命令 receipt”。后续安全复审整体否决了外部命令方案，最终只保留 process-free 内置 `check` receipt；跨 worktree 也被降为不可观测边界。完整依赖和最终边界只以主设计文档第 19 节为准；附录 A 保留原始 58 项和收敛去向。

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

快照时间为 2026-07-17，代码位于 `codex/feat-comet-native-workflow`；release status：unreleased。这里的“已实现”只表示功能分支工作树中存在，不表示 npm 或稳定 Website 已发布；Runtime 仍在本分支继续收口，不能用早期 commit 当作最终生成资产基线。

| 状态                    | 内容                                                                                                                                                                                                                                                                                                                                                                       | 证据边界                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能分支已实现          | 自定义 artifact root 与默认语言、`comet/` change/spec/archive、四阶段状态、schema v3 migration、Protected Run/File I/O、snapshot/CAS、structured finding/continuation、checkpoint、acceptance 分页与证据、Build/Verify inspect-then-persist、repair episode、内置 check receipt、process-free workspace/conflict radar、可恢复 quarantine、两步 Archive 与只读 Dashboard。 | 当前 feature branch、生成 Runtime、真实 CLI build、双语 Skill、Native/入口域测试及 lint/架构检查；尚未发布。                                               |
| 已有静态与 harness 覆盖 | Wave A–F 的 fixture、validator、adversarial artifact 和确定性 Runtime 测试；包括 clarification、repository fact、完整 workflow、interrupted transition、证据 stale、repair、并行冲突和 Dashboard projection。                                                                                                                                                              | 证明任务、检查器和机械契约可执行；没有专项真实模型实验 artifact 时，不证明模型行为或效率稳定。                                                             |
| 有方向性真实模型证据    | 指定两个历史 experiment 严格配对 48 组：Native 46/48，0.4.0 为 43/48；pass@1/2/3/pass³ 分别为 Native 0.96/1/1/0.88、0.4.0 0.90/0.98/1/0.75。累加 duration 为 8,831 秒（48）与 16,562 秒（47）。                                                                                                                                                                            | 只覆盖 Mimo 2.5 Pro 且运行窗口不一致；0.4.0 缺 `comet-graph-execution-review#r2` duration；fallback manifest 只证明 task tree parity，不证明受控性能对比。 |
| 尚待收口                | 目标强模型上的 Wave B 与多模型矩阵、npm pack、全量 CI 级验证，以及 Control/Native/Classic 同模型同窗口真实实验。                                                                                                                                                                                                                                                           | 已有 Docker 真实模型运行只覆盖当前 Mimo 配置；不能代替目标强模型或发布级多模型结论。                                                                       |
| 当前明确非目标          | 多阶段 Skill、外部 Skill 依赖、Native/Classic 转换、固定方法流程、项目管理系统、Runtime LLM、后台 daemon、Git/worktree 监控、通用命令执行器和可写 Dashboard。                                                                                                                                                                                                              | 产品边界；重新打开必须先进行设计审查。                                                                                                                     |

## 9. 仍未回答的问题

- 相同模型、任务和窗口下，Native 相对裸强模型是否提高 strict success、降低返工或改善恢复？
- 自然请求没有显式提示歧义时，隐藏高影响决定的召回率和不必要提问率是多少？
- Runtime 发出 continuation 后，不同宿主实际续跑同一 Skill 的可靠性如何？
- Stale verification、长程修复与无进展停止是否真正提高成功率，而不只是增加产物？
- 同一 Native root 的 CAS、conflict radar 与 process-free root identity 是否足以保护真实多 agent 并行？
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
- 模式契约结果：独立复审对 pending WAL、128 产物 status、坏 journal、junction/parent replacement 与凭据投影做真实复现后给出 GO。Runtime 契约已在功能分支落地；中文 Skill 尚未确认，真实模型 clarification/continuation 效果尚未形成新结论。
- 效率与成本：默认 status 与 resume payload 现在有确定性上限，但没有真实模型数据证明 token、时间或文件读取量改善。
- 限制：checkpoint 只覆盖模型显式声明的产物，不证明 verification scope 完整；continuation 能否被不同宿主自动消费仍需真实运行；跨会话任务存在不等于模型行为已通过。
- 保留、修改或删除该能力：保留一个 Skill、独立 checkpoint、结构化 continuation 与紧凑 status；删除“`next:auto` 等同后台自动运行”“坏状态总能给自动 repair 命令”和“所有详情默认展开”的方向。

### Website 可用叙事

- 用户问题：强模型不需要被重新教一套实现方法，但它需要在中断后准确知道做到哪里、还缺什么，以及当前是否真的需要用户。
- 关键取舍：自动推进不是后台 agent，而是一份明确的同 Skill continuation；checkpoint 是 Runtime 生成的恢复事实，不是用户维护的项目管理表。
- 可公开证据：252 项 Native 回归、跨命令 exactly-once WAL、默认 status 的硬预算、内容寻址 checkpoint 与内部 junction 防护。
- 不应公开的内部过程或不确定结论：Website 不展开临时模块名和 review 往返；在中文/英文 Skill 同步与真实模型专项 eval 前，不宣称澄清质量已达到 grilling，也不宣称所有宿主都会后台续跑。

## 2026-07-17：波次 C 开发中——从“有验证报告”到“报告仍然有效”

> 状态：开发中。本节保留已经被测试或复审证伪的设计边界；最终 CLI、测试数量与交付结论将在波次收口后补全，不应提前作为已发布能力引用。

### 当时假设

- 期望改善的强模型失败模式：模型可以写出看似完整的 `verification.md`，但报告没有绑定当时的需求契约、实现范围与验收场景；验证后继续修改代码，旧的 pass 仍可能被当成当前事实。
- 为什么现有 Native 不足：当前 `verification_result: pass` 和报告路径只证明某个文件存在，不能证明 scope 完整、证据未过期、每项 Acceptance 都有对应证据，也不能保证 Archive 执行时仍然是用户刚预览的 canonical 变化。
- 为什么这仍是轻流程：用户与模型继续使用 Shape、Build、Verify、Archive 四阶段；contract、snapshot、scope、trace、preflight hash 与事务恢复由 Runtime 派生和校验，不要求用户维护 coverage matrix 或理解内部 manifest。

### 已证伪的初版边界

- **恢复日志只有结构校验仍不够。** 第一版 v3 transition parser 能拒绝缺字段，却仍可能接受 `waiting` Run、伪造的 pending action、跳号 iteration 或改变了 storage identity 的 `nextRun`。这说明内容寻址字段不能建立在可伪造的恢复语义上。
- **独立 scope 文档不能自己证明完整。** 若调用方能够删掉 snapshot omission、把 `complete` 改为 `true`，再重算 scope hash，纯结构 parser 仍会接受。scope 必须与内容寻址的 baseline/current snapshot projection 一起重建，存储入口也不能接受任意 standalone scope。
- **“最终路径安全”不等于“敏感内容从未逃逸”。** 原子写若先向临时文件写内容、再检查父目录是否被 junction 替换，即使最终 rename 被拒绝，敏感字节也已经短暂写到 Native root 外。安全顺序必须是打开临时文件后先固定 identity、验证真实父链和物理包含关系，再写入内容，并在 rename 前再次复核。
- **排除默认 `comet/` 不能覆盖自定义 root。** 用户可把 Native root 放在 `docs/comet/` 等位置；证据引用必须绑定实际 `nativeRootRef`，同时排除 `.npmrc`、`.pypirc`、`.netrc`、Git credential、SSH/GnuPG 与其他凭据文件，不能只写死 `runtime/` 或默认目录名。

### 当前修正方向

- v1、v2、v3 transition journal 共享同一语义校验：首跳与非首跳分别验证 Run/change 对齐、固定 Runtime metadata、storage refs、iteration、retry、status 与 pending；不可信 journal 保留在原地并 fail closed，不能写入 Run/change 或被当成已恢复删除。
- implementation scope 改为 authority bundle：baseline/current snapshot projection 分别内容寻址，scope 只能由 contract、声明产物、no-code reason、可选 Git advisory 与两份 projection 确定性重建；读取时重新验证引用、hash 与派生字段。
- evidence 文件使用有界读取与内容寻址存储，拒绝绝对路径、逃逸、symlink/junction、父目录替换、文件替换和敏感 ref；错误投影不得回显文件内容、绝对路径或凭据。
- Archive preflight 绑定 change schema/revision/phase、pending journal、spec operation/base/proposed hash、evidence hash 与 freshness。后续公开流程将要求 dry-run 返回 preflight hash，真实 Archive 在锁内重算并通过 `--expect-preflight` 比较，而不是信任调用前的检查结果。

### 实施过程补记

- **状态引用第一次接线时把“新 scope”误写成“ref 必须变化”。** 内容寻址意味着同一契约与同一实现快照重新采集后必然得到相同 ref；若 Verify fail 后没有有效修改，直接由 journal 以 ref 相同拒绝，会让后续的重复失败告警与停止策略永远没有机会工作。修正后，Build→Verify 要求本次重新派生并读取校验非空 scope；scope 改变时禁止沿用旧 allowance，scope 相同时允许复用仍与该 hash 精确绑定的 allowance。是否“没有进展”改由波次 D 的失败签名判断。
- **旧失败报告不能作为下一次 Verify 的当前输入。** 第一版沿用已存在的 `verification_report`，使 Build→Verify 后的 pending 状态仍携带上次 fail 报告。修正后 Build→Verify 清空 report 与 verification evidence，只保留上一次失败直到离开 Build；新的 Verify outcome 必须重新解析固定 Acceptance block 并生成新 envelope。
- **旧 schema 中已准备好的证据型 transition 不能伪装成当前 transition。** v1/v2 的 Build→Verify、Verify fail→Build 和 Verify pass→Archive 都缺少当前 schema 所需的 scope/evidence refs。迁移不再补空字段后继续，而是由 migration journal 以 source content hash 收口旧 transition，必要时同步 Run、trajectory 与 checkpoint 退回 Build，清空旧 result/report/refs 后重新采集证据。
- **真实接线让宽松测试夹具立即失败。** 旧生命周期测试只写人类可读的 `verification.md`，没有 Runtime 派生的 Acceptance ID，因此在新主链上全部被拒绝。没有为测试加入生产绕过；测试改为从实际 brief/proposed spec 收集 contract，再生成同一固定机器块。这轮失败证明 evidence parser 已位于真实 `next` 路径，而不是只存在于孤立模块测试。
- **partial scope 是用户决定，不只是普通校验错误。** 未归属变化首次只返回 scope hash、精确未解决项和 `await-user` continuation；只有相同 scope hash、明确理由与 `--confirmed` 同时出现时才写入 allowance。确认后 Verify 与 Archive 只消费该内容寻址 allowance，不再次询问或从 Markdown 推断授权。
- **Archive 从单步调用改成两步协议后，旧测试不能只补一个占位 hash。** 预演返回的 hash 同时绑定 revision、canonical spec、证据、目标目录和 pending WAL；实际归档必须显式携带同一个 hash，并在锁内重算。旧用例因此改为“先恢复 pending transition，再预演，再确认”，而不是在生产实现里为测试保留隐式归档入口。
- **预检曾检查了一个并不存在的 journal 文件名。** transition 的真实文件是 `runtime/transition.json`，Archive inspection 初版却检查 `transition-journal.json`，导致中断 transition 没有进入 `pending-journal`。修正为复用状态机导出的唯一路径函数，并让测试也从同一函数构造 fixture，避免路径再次漂移。
- **dry-run 的 blocked 不是命令执行失败。** `archive --dry-run` 即使发现冲突也以成功 envelope 返回完整、可检查的 blocked preview；只有随后携带 hash 的实际归档才返回 conflict。这样模型和 Dashboard 能读取所有 findings，而不是从异常字符串猜原因。
- **事务日志不能靠绝对路径证明属于当前项目。** Archive transaction v2 只保存 Native 相对 ref、每步前后内容 hash 和完整 change tree hash；第一步前再次重算 preflight，恢复与回滚都会复验已完成操作。v1 日志只作为旧事务恢复兼容保留，新的归档不再把本机路径写入持久状态。
- **并行 change 冲突必须在 canonical 写入前暴露。** 同一 Native root 内可见 change 会按 capability、operation、base hash 和声明产物形成确定冲突或可能重叠；两个竞争 change 都会得到 blocked preflight，不再允许“先归档者静默获胜”。workspace identity 只作为提示，不能改变冲突分类。

截至当时补记，scope/evidence 的独立构造与存储、真实 Build→Verify→Archive/Build 接线、stale evidence 自动退回 Build、partial 确认、v1/v2 transition supersede、Archive transaction v2 和冲突阻塞已经进入同一主链；Native 全域 48 个测试文件、428 项通过。当时还存在一套未接入公开 seam 的外部命令 receipt 实现，随后已在安全复审中删除并由内置 `check` 替代；生成资产、专项 eval 和双语 Skill 当时也尚未最终收口，因此本节只保留为开发中快照。

### Website 可用叙事草稿

- 用户问题：验证报告最危险的失败不是“没写”，而是代码或需求已经变了，报告看起来却仍然是绿色。
- 关键取舍：Comet 不规定强模型怎样测试；它只记录“当时验证了哪份需求、哪一组实现文件、哪些验收场景”，并在这些事实变化时把旧结论标为 stale。
- 可公开的设计故事：本轮复审从四个看似独立的漏洞得到同一结论——hash 只在输入来源可信、写入顺序安全、读取时可重建时才有意义。Native 因此选择内容寻址 projection + 派生 scope + 锁内 preflight，而不是再增加人工表单。
- 暂不可公开为已交付事实：确定性 Runtime 主链已经通过回归，但生成资产、可选 receipt 接缝、双语 Skill 和专项真实模型效果尚未一起收口；正式 Website 只能在这些交付面完成后改写为当前能力。

## 2026-07-17：波次 D 开发切片——允许自主修复，也能跨会话停下来

### 当时假设与边界（累计上限方案后来被修正）

- 强模型遇到一次 Verify fail 应继续修复，而不是进入一套重型 Debug/TDD 流程；但相同 failure、相同 contract 和相同 implementation snapshot 反复出现时，继续自动循环不再代表自主性。
- Runtime 只把失败类别、失败检查 ID、contract hash 和 implementation snapshot 规范化成签名。它不读取思维链、不决定测试策略，也不允许模型通过删除检查、改写 pass 或清空历史继续归档。
- 当时的第一版规则是：第一次同签名失败继续，第二次告警，第三次 manual-stop，并把 change 历史上的所有 failure 累计到 12 次 hard-stop。后续复审否决了永久累计语义；当前规则是单个 repair episode 12 次，真实 scope 进展或 pass 会结束旧 episode。一次显式 override 仍只能作用于最近的 manual-stop。

### 实施过程

- 初版 helper 计划让第三次失败停留在 Verify，只把 stop 返回给当前命令。复审后否决：没有合法 phase transition 就没有现成的 exactly-once journal，stop 会在新会话丢失；强行写 Verify→Verify 又会污染状态机语义。
- journal 结构最终让失败仍完成真实的 Verify→Build，并在同一个 `state_transitioned` 事件里只保存 `{signatureHash, disposition, overrideSummaryHash}`。第三次与单 episode 第十二次因此是可恢复的持久事实；原始失败文本、categories、check IDs 和 override 摘要都不落 trajectory。
- 后续 Build→Verify 若 scope hash 已变化，Runtime 把它视为真实进展并自动解除 manual-stop；scope 未变时必须携带匹配 signature 的显式 override。override 与这次 Build→Verify 同一事件提交，只增加 override 记录，不重复计算一次 failure。
- 已使用 override 后再次得到相同失败，状态仍会诚实回到 Build，但 continuation 要求人工复核；中断在 Run 写入后重试时，transition journal 会收口成同一个 stop，不会多记一次 failure。
- 第十二次 hard-stop 的主链测试最初无法到达：通用 Engine 仍限制 16 次 transition，而一次 repair 要消耗 Verify→Build 与 Build→Verify 两次，Engine 会先于 repair 协议终止。阶段性修正曾把 Native iteration budget 提升到 32；后续跨波次收口确认固定 32 仍会锁死长期 change，最终改为本节后文记录的 semantic repair budget。

### Website 可用叙事草稿

- 用户问题：强模型应该自己修，但“自己修”不能等于同一个错误无限循环。
- 关键取舍：Comet 不教模型如何 debug，只比较机械上是否真的有进展；实现 scope 变化会自然解锁，没有进展才停止。
- 当时暂不可公开为已交付事实：生成 Runtime、双语 Skill、receipt 边界与 Wave D 专项 eval 尚未一起收口；receipt 后来收敛为内置 process-free `check`，不是外部命令执行。

## 2026-07-17：波次 E 开发切片——只承诺当前 Native root 内可证明的并行安全

### 当时假设与边界

- Comet 可以可靠比较同一物理 Native root 当前可见的 change，却不能发现另一个尚未集成的 worktree、远端分支或其他机器上的隐藏状态；把本地 advisory 包装成分布式锁会制造错误安全感。
- 冲突分类只由 capability、operation、base hash 和已声明产物决定。workspace/worktree identity 只解释“这些事实来自哪里”，不能把确定冲突降级，也不能把未知关系升级为安全。

### 第一版实施过程（随后由 process-free v2 推翻）

- Conflict collector 对当前 root 的可见 change 统一读取 state、spec 与内容寻址 scope；任一竞争 change 的确定性事实损坏时整体 fail closed，只有 workspace identity 作为 advisory 可以降级为 unknown。
- Archive preflight 已把确定冲突与可能重叠纳入 hash 和 blocked findings；status 也在 Shape/Build/Verify 提前投影同一 code，使模型不必等到归档才发现共享 capability 或产物。
- 第一版仍调用 Git：change 创建时只有能得到 worktree/common-dir identity 才写本地 metadata，status 重新检查 branch、HEAD、worktree 和未归属变化，并把结果降为 warning/info。后续安全复审确认“只作提示”仍不能消除外部进程副作用，因此整条 probe 被删除，不能视为当前行为。
- Native 自身目录按前缀归属给 Runtime，避免把 checkpoint/evidence 写入误报为用户的未归属修改；声明 artifact 也按目录所有权匹配，不只做字符串精确相等。

### 后续安全复审：删除默认 Git probe

- 上述第一版虽把 Git 结果定义为 advisory，却仍在 `new`、离开 Build 和几乎每次 status 时执行 `git status`。复审确认：Git 为判断 worktree 内容可能调用仓库控制的 clean/process filter 或 fsmonitor，ambient PATH 也存在可执行文件劫持面；`GIT_OPTIONAL_LOCKS=0` 只能减少锁写入，不能把这个过程证明为无副作用。
- 最终默认路径彻底删除 Git inspector 及其 platform API。Build scope 只由创建时 baseline、当前有界 snapshot、声明 artifact 和 contract 推导；这本来就是完整性 authority，Git changed paths 从未被允许改变结论。
- workspace metadata 升级为 process-free v2，只保存 project root/native root 的物理身份 hash、相对 Native root ref、revision 与可选 session hash，不落原始路径，也不再声称知道 branch、HEAD、未归属 worktree 修改或跨机器状态。status 只用文件系统重算 root identity；旧 Git-backed v1 metadata 作为 advisory legacy 被只读路径忽略，后续收口再由 doctor 提供显式迁移，而不是在 status 中隐式改写。
- 这次修正也改变 Website 边界：可公开的是“当前物理 Native root 内的 change 冲突与 root identity 提示”，不是 Git 工作区监控。`new`、`next`、`status` 和内置 `check` 的默认 Native 主链均不启动外部进程。

### Website 可用叙事草稿

- 用户问题：多个 change 同时推进时，最危险的不是“有人在工作”，而是两个看似独立的修改最后覆盖同一份长期规格或实现文件。
- 关键取舍：Comet 提前暴露当前 Native root 内能证明的冲突，同时用 process-free root identity 说明事实来源；它不读取 Git branch/HEAD，也不承诺跨机器、跨未集成 worktree 的全局协调。
- 暂不可公开为已交付事实：最终生成资产、全量测试与 Wave E eval 仍待统一收口；Website 不能把 workspace advisory 写成自动 worktree 管理或分布式锁。

## 2026-07-17：波次 F 开发切片——Dashboard 只读展示，不成为第二套 Runtime

### 当时假设与边界

- 团队需要看到 Native change 的阶段、证据新鲜度、归档就绪和并行冲突，但 Dashboard 如果重新推导阶段、缓存证据或提供写入口，就会与 CLI/Runtime 形成两套事实来源。
- Dashboard adapter 因此只消费 status、Archive preflight 与 conflict radar 的白名单投影；采集失败只返回稳定的 `native-dashboard-unavailable`，不能把路径、报告、证据、原始异常或命令输出带进页面。
- Native 未配置时不显示占位区域，也不改变已有 Classic Dashboard；Native 已配置但没有 change 时才显示独立空态。

### 实施过程

- 第一版展示候选字段时主动删除了 `nextCommand`、revision、verification result、preflight hash、required inputs、workspace relationship 和 signal count。它们有些是 agent-facing 控制信息，有些会放大内部实现；团队视图只保留 change、phase、freshness、archive readiness、continuation 摘要、finding code 与冲突对象。
- Collector 与现有 Classic 采集并行运行；Native 读取失败被隔离并脱敏，不能让 Classic Dashboard 整体不可用。前端没有新增按钮或写 API，响应式卡片只是既有 snapshot 的只读函数。
- 聚焦验证为 4 个测试文件、17 项通过，Dashboard 生产构建通过。此数字只证明 adapter/collector/UI 契约，不代表真实模型效果或整个分支已经发布。

### Website 可用叙事草稿

- 用户问题：Native 的价值不应只存在于模型会话里；团队也需要快速判断哪些 change 能归档、哪些证据过期、哪些工作互相冲突。
- 关键取舍：Dashboard 是 Runtime 的窗口，不是新的工作流控制器。相同事实由 CLI、JSON 和页面共享，页面不能反向推进 phase。
- 暂不可公开为已交付事实：在 Wave D、生成 Runtime、双语 Skill 与最终 eval 一起收口前，只能把本节保留为开发过程，不能单独宣称 Native Dashboard 已发布。

## 2026-07-17：跨波次开发切片——可信检查从外部命令收敛为内置策略

### 当时假设与第一版方案

- 强模型能够自行选择测试和实现方法，Comet 不应监控全部 shell 活动，也不应把 package script 视为天然安全。`npm`、`pnpm` 或任意项目脚本都会执行项目控制的代码，因此第一版先把 seam 收窄为固定 Git whitespace check。
- receipt 被定义成独立证据而不是阶段结论：它不改变 phase、revision、Run 或 trajectory；Verify envelope 的消费者仍须重新校验 receipt 与当前 contract、implementation scope。
- 第一版公开草案曾是 `comet native check <change> [--staged] [--timeout <ms>]`，随后删掉 `--staged`，并把 Git 调用固定为相对某个解析后的 HEAD。实现还解析项目外的 Git 可执行文件、计算二进制身份 hash，禁用 fsmonitor、pager、external diff、textconv 和 submodule traversal，以 `shell: false`、最小环境、超时、取消和进程树终止运行。
- 为避免 receipt 自身被路径替换，读取侧捕获 Native root 到 receipt 目录的完整目录身份链，再复核打开句柄、路径项和 realpath；写入侧复用 contained root 下的原子写协议。stdout/stderr、argv、绝对可执行路径和环境不直接落盘，只保存脱敏有界输出的 hash 与字节计数。

### 安全复审为什么否决外部 Git

- “固定 argv”并不等于“只读”。Git diff 可能自动刷新 index；worktree diff 可以触发仓库控制的 clean/process filter；promisor repository 还可能 lazy fetch、联网并写 object。即使禁用 external diff 和 textconv，这些副作用仍然存在。
- HEAD 最初只被折进 opaque argv hash，没有结构化写入 receipt，也没有在 Verify/Archive 重算；切换 ref 而保持同一 worktree 时，旧 receipt 可能继续被接受。并且没有项目 pathspec 时，大仓子目录会扫描 project root 之外的 worktree 内容。
- 继续叠加 Git 配置开关无法证明所有宿主版本、仓库配置和 filter 行为都被封闭。这个方向因此在合入前整体删除，不把“安全命令执行器”变成 Native 的隐性第二产品。

### 最终收敛方向

- 公开 seam 只保留 `comet native check <change>`。Runtime 不启动 child process、不解析 Git、不读取 PATH、不联网，也没有 executable、argv、timeout、signal 或 stdout/stderr receipt 字段。
- checker 只读取当前 implementation scope/current snapshot 中列出的项目内普通文件，按文件数、单文件字节、总字节和 issue 数显式设限；对 symlink、junction、越界路径、身份变化、hash/size 不匹配和 TOCTOU 一律 fail closed。
- 内置策略只检查少量确定性文本事实，例如 conflict marker、行尾空白和 space-before-tab。receipt 绑定 checker policy/version、contract、scope 和执行前后 snapshot，并只保存有界的项目相对 issue、计数、stale 原因与内容 hash；它不声称替代测试、需求覆盖或模型选择的验证策略。
- `check` 仍在 mutation/transition 锁内先收口遗留 journal，再读取 Verify 状态和 implementation scope。fresh passed receipt 可作为 Verify evidence；failed receipt 可诚实附到失败报告；检查本身永不推进工作流。

### Website 可用叙事草稿

- 用户问题：既要让强模型自由选择怎样验证，又要避免最终只剩一句无法复核的“测试通过”。
- 关键取舍：Comet 不执行项目脚本，只用内置、窄范围、可重建的策略保存防篡改 check receipt；验证策略仍由模型决定，Runtime 只封印事实、新鲜度和范围。
- 对外边界：`check` 不是通用命令执行器，不读取 Git 状态，不保存文件内容，也不推进工作流。第一版外部 Git 方案是安全复审中被明确淘汰的开发过程，Website 只描述最终内置边界。
- 截至本节记录时，专项 eval 只验证夹具与 validator；按用户安排未启动 Docker 或真实模型运行，因此还不能声称模型行为或效率已经得到实验验证。

## 2026-07-17：跨波次收口复审——先证明输入可信，再允许状态留下痕迹

### 为什么再次收口

Wave A–F 已经覆盖状态、续跑、证据、修复、并行和展示，但安全复审发现一个共同问题：即使最终 transition 会被 guard 拒绝，候选输入、证据文件或不可逆 marker 仍可能过早落盘。对强模型而言，失败本身可以修复；更危险的是失败尝试留下“看起来像已提交”的新事实，导致恢复会话误判当前状态。

这轮没有新增阶段、方法 Skill 或用户表单，而是把既有 Runtime 边界进一步收紧。

### 实施偏差与最终修正

- **Acceptance 不能先无界解析再分页。** 初版分页限制了输出，却仍可能先把接近文件上限的 Markdown 展开成大量中间对象。最终解析改为流式扫描，brief 与拟议规格共享最多 1024 项的总预算；`acceptancePage` 每页最多 16 项，文字、context 与序列化结果分别有硬上限，cursor 绑定 acceptance hash。超过总预算直接拒绝，不用截断掩盖遗漏。
- **Failure facts 必须先于任何 evidence write 校验。** `summary`、`noCodeReason`、failure category、failed check 与 override token 统一执行字符、数量和格式预算。无效 token、超过 16 个 category、超过 128 个 failed check 或过长文本会在 mutation lock 与证据写入前失败，不能靠反复无效调用制造孤儿 evidence。
- **Build/Verify 从 prepare-and-write 拆成 inspect-then-persist。** Runtime 先纯计算并校验 contract、scope、acceptance、freshness、repair guard、Run outcome 与 trajectory，再在准备 transition 前持久化最终 evidence。Partial Build 为了把同一候选交给用户确认，可以先保存内容寻址 scope 并返回稳定 hash；没有匹配确认时不会写 allowance 或推进。Verify 若被 Run/trajectory/freshness 阻塞，不留下可被误认为新结论的 verification envelope。
- **Archive 的不可逆 marker 曾写得太早。** 旧顺序在验证最终 Run 或 trajectory 之前写 `archive-finalization-started`，一旦后续发现 moved tree 已损坏，就失去了 rollback 路径。最终顺序先校验移动后的 archive tree、state、Protected Run、完成决定、trajectory collision 与最终事件，再写 marker；marker 前可以 rollback，marker 后只能 exactly-once continue。
- **通用 Engine Run store 不是 Native 的安全边界。** 所有 Native Run state、trajectory、checkpoint、pending action、context 与 artifact refs 改走 Protected Run I/O：拒绝 symlink/junction/FIFO 和父目录替换，打开前后复核 realpath/stat/identity，写入前复核目标与父链，并限制 Run state 256 KiB、trajectory 8 MiB/4096 事件/单事件 256 KiB、checkpoint/pending action 各 256 KiB、context/artifact refs 各 1 MiB。Engine 继续提供 parser、类型与 resolver 语义，但通用文件函数不再成为 Native 调用面。
- **稳定的 v2 Verify/Archive 也必须退回 Build。** 早期迁移只 supersede pending evidence transition；复审发现没有 pending journal 的 v2 Verify/Archive 同样缺 v3 scope/envelope。现在 migration journal 会同步 change、Run、trajectory 与 checkpoint 退回 Build，清空旧 result/report/ref 后重新采证，不能让旧 pass 跨 schema 继承权威。
- **通用 iteration budget 不应锁死长期 change。** Wave D 曾把 Engine 上限从 16 提到 32，只是让第 12 次 failure hard stop 能先发生；这仍把机械 transition 数误当产品语义。最终 Runtime 的通用 counter 只保留安全整数范围内的动作序号，真正的停止条件改为 evidence-bound semantic repair budget：第三次同签名且 scope 无进展时 manual stop，单 episode 12 次 failure 时 hard stop；真实 scope 进展或 pass 结束旧 episode，历史 trajectory 仍保留。
- **旧 workspace v1 不能永远静默忽略。** 普通 status 仍不信任 Git-backed v1，但 doctor 会明确报告 `workspace-identity-migration-required`；只有 `doctor --repair` 才用当前物理目录重建 process-free v2 root identity。迁移不会重新探测 branch、HEAD 或 worktree changed paths。
- **保留策略不能变成后台垃圾回收。** 默认 doctor 只读报告候选；显式 `--repair` 才在 mutation lock 内重算，只删除 active change 中至少 30 天、每种 evidence kind 最新 32 份之外、且从当前 state refs 与依赖闭包证明未引用的派生 evidence/receipt。归档证据从不清理；pending journal、缺失依赖、损坏文档、未知目录项、symlink 或其他特殊文件一律 fail closed，删除前后还要复核目录链和文件身份。
- **路径已经过包含校验，不代表复制和递归删除期间仍然安全。** Archive 与 root move 初版在事前校验路径后仍使用路径型 `copyFile`/`rm`；复审证明父目录可在校验后被 junction 或目录替换，源文件也可能在打开与提交之间变化，直接递归删除更缺少可恢复边界。最终抽出 Native Protected File/Directory I/O：复制从受保护句柄有界读取，打开前后复核源文件、realpath、父目录身份与预期 hash，目标用受包含约束的原子写入并在提交前复核；目录清理先验证整棵树等价性和目录 guard，再原子改名到事务 ID 绑定的 sibling quarantine，最后复核身份后删除。root move 的 continue/rollback 都能识别已存在的 quarantine 并从事务日志收口，不再按未经复核的旧路径直接删除。Website 可把它写成“迁移和归档可从中断恢复且拒绝路径替换”，不能写成整个多文件事务一次原子完成。
- **Evidence retention 的删除顺序和崩溃窗口不能靠‘未引用’三个字带过。** 第一版候选集合虽然排除了当前引用，却没有表达 candidate 之间的依赖顺序；若先删被其他候选引用的底层 snapshot，崩溃会留下结构损坏的上层 evidence。直接 unlink 也无法区分“已选中待删”与“意外消失”。最终先对候选依赖图做拓扑排序，严格按 dependents-before-dependencies 清理；每个文件在父链与身份复核后改名为同目录唯一 `.gc` quarantine，再复核并删除。中断留下的 quarantine 会被后续 doctor 确定性发现：只读 doctor 报告 `evidence-retention-recovery-required`，显式 `--repair` 仅在原路径仍不存在、quarantine 内容与身份有效时用无覆盖方式恢复，原文件与 quarantine 同时存在、多 quarantine、损坏依赖或特殊文件都 fail closed。这个过程保留了“显式 maintenance、默认只读”的产品边界，也为 Website 提供了为什么 Native 不做后台 GC 的完整理由。
- **“hash 没变”不能证明 canonical 还是同一个对象。** Archive v2 早期只比较内容 hash；并发进程可以用同内容的新文件替换 canonical，使事务误以为目标未变。最终 write/remove 先持久化 original 的内容与文件身份，原子改名到同目录 quarantine 后再次复验；write 从事务私有 candidate 无覆盖安装，rollback 同样先隔离并验证 post 对象，再无覆盖恢复 original。相同内容但不同对象也会冲突并保留现场，continue/rollback 能从隔离或安装后的崩溃点收口。
- **事件日志的坏尾只能修“可证明没写完”的一类。** 直接忽略最后一行会误删完整但无尾换行的事件，也可能吞掉完整非法 JSON。最终 v1/v2 transaction 共用有界 append：只承认 next-sequence canonical JSON 的未完成前缀，append 前对原 bytes 做 hash/size CAS，再原子重写整个事件文件；中间坏行、非规范尾、完整非法尾和并发改写都 fail closed。重复事件以 `type + operationId` exactly-once 收敛。
- **陈旧锁恢复不能发生在普通写路径。** 仅凭 owner 时间或一次进程检查自动删锁，会让旧 owner 在新 owner 获锁后误删新锁，形成 split-brain。最终锁绑定 owner、锁文件身份与进程内 FIFO；普通 mutation 只报告冲突，只有显式 `doctor --repair` 能在证明本机 owner 消失、身份未变且恢复事务兼容时 takeover。
- **限制输出不够，所有项目可控输入也要先有预算。** 收口扫描把 config、selection、change YAML、brief/spec、show、status、migration/baseline journal、Run、trajectory、transaction journal/events 与目录枚举分别放进受保护读取和硬预算；status/list 使用 hash-bound cursor 分页，show 超限直接拒绝而不是截断需求。持久化摘要、理由与跳过说明还会先做文本上限和 credential-shaped redaction，普通非敏感文字保持原样。
- **“两侧现有 report 的并集”不是 expected sample matrix。** 对齐比较器最初从 candidate/baseline 的 report 并集推导应有 `task + repetition`；这能看到单侧缺样本，却看不到两侧同时没有留下 report 的整项缺失。最终让 pytest controller 在任何模型运行前，把完整 collection 中的 `task + treatment + repetition` 规范化、哈希并原子写入 experiment；xdist worker 必须对同一矩阵逐字节达成一致。比较器分别按两侧目标 treatment 校验矩阵，矩阵损坏时 fail closed，只有真正没有该文件的历史 experiment 才允许 observed-report fallback。这个修正适合 Website 解释“为什么 pass@3 的分母也必须有证据”，但当前历史实验没有矩阵，不能事后声称已检测到当时两侧同时缺失的样本。
- **同一 task tree 不等于同一次执行。** v1 case manifest 只绑定 task、instruction、validator、environment、data 与 prompt，最终审查指出 runner/controller 源码、Docker image、Claude 工具版本、model 和 interaction 改变时仍可能得到同一 case hash。v2 在报告中只持久化安全 hash 与有限枚举：静态绑定 `run-claude-loop.sh`、`docker.sh`、`common.sh`、`test_tasks.py`、`conftest.py` 等控制面源码；运行前从实际 image 取得不可变 ID、在该 image 内执行 `claude --version` 并哈希，然后主体运行强制复用刚验证的 image ID；model selector 与完整 interaction 配置只做 controller-side hash，不写原文或环境。v1/v2 仍可按共同 task-core hash 做历史兼容比较，但报告必须明确它没有证明旧 run 的执行身份，不能把 fallback 包装成精确复现。
- **Archive 树的 hash 也必须有输入预算与目录快照。** 最终审查发现单文件事务已经受保护，但移动后的完整 change 树仍用无界递归目录读取和路径型文件 hash。收口后每个文件、总字节、条目数、目录深度、ref 与 manifest 都有硬上限；文件通过受保护句柄读取，目录遍历前后比较同一有界条目快照并复核父链。旧 v1 transaction 的兼容恢复也改为有界二进制复制、内容 CAS、身份绑定的目录移动和受保护删除，不再用 UTF-8 转换损坏历史二进制内容。
- **公开选项必须形成持久语义，不能只回显。** `native init --language` 初版只把值返回给调用方，后续 `new` 仍默认英文。最终把项目默认语言写入 `comet.config.yaml`，旧配置缺字段时兼容为英文；`new --language` 只覆盖当前 change，root move 保留该设置。同时删除已经没有调用方的通用 `safe-command` 实现，使“Native 不提供任意命令执行器”同时成为文档边界和实际代码边界。

### 波次 A–F 的当前事实状态

| 波次 | 功能分支当前事实                                                                                                                              | 尚未得到的证据                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A    | schema v3、journal migration、snapshot/CAS、敏感路径排除、Protected Run/File I/O、可恢复 quarantine、显式 doctor retention 与指标聚合已接线。 | 没有新的同窗口真实模型安全/效率对照。                                                                     |
| B    | 单 Skill 决策前沿、仓库事实优先、冷启动可执行标准、structured continuation、checkpoint 与紧凑恢复视图已接线。                                 | 2026-07-18 的 `mimo-v2.5-pro` 专项运行未触发隐藏决定，不能证明澄清质量等同 grilling；仍缺目标强模型矩阵。 |
| C    | scope/allowance/verification/check receipt 内容寻址、acceptance trace、stale retreat、两步 Archive 与 transaction v2 已接线。                 | 没有大型真实仓库上的模型行为实验。                                                                        |
| D    | semantic repair episode、无进展停止、单次 override 与真实 scope 进展解锁已接线。                                                              | 没有真实模型长程修复成功率、token 或耗时结论。                                                            |
| E    | process-free root identity、同一 Native root conflict radar 与 Archive 阻塞已接线。                                                           | 不承诺未集成 worktree、远端或其他机器的分布式协调。                                                       |
| F    | 只读 Dashboard adapter 复用 Runtime projection，不提供写入口。                                                                                | 没有真实团队使用或协作效率结论。                                                                          |

以上都只表示 `codex/feat-comet-native-workflow` 功能分支的开发事实，尚未发布。生成 Runtime、真实构建、Native/入口域 62 个测试文件共 608 个通过测试、9 个平台条件跳过，以及中文 Skill 校验已经完成；中文 Website 用户页和演进文章已形成待确认稿。专项 eval 已具备 fixture、validator、artifact binding 与对抗性确定性测试；2026-07-18 又运行了 interrupted-transition、Wave C、Wave E 和多轮 Wave B 真实模型实验，其中 Wave B 的失败边界见下节。历史 Native/0.4.0 对齐只提供第 6 节所述方向性证据，不能替代 Wave A–F 的专项实验。

### Website 可用叙事草稿

- 用户问题：轻流程不是少写几个文件，而是让模型只在真正需要人决定时停下，同时保证失败调用不会留下假证据、旧 pass 不会跨需求或 schema 继续生效。
- 关键取舍：Comet 把“怎么实现”继续交给强模型，把输入预算、事实校验、证据封印、停止语义和不可逆边界放进 Runtime；新增的复杂度不变成用户阶段。
- 可公开的开发故事：外部 Git receipt、Git workspace probe、通用 Run store、固定 Engine iteration 上限、过早 Archive marker、内容 hash 单独作 CAS、路径型 copy/delete、无界事件尾恢复和无恢复语义的 retention 删除都曾在开发中暴露边界问题，最终被更窄的 process-free、inspect-first、对象身份 CAS、protected I/O 与可恢复 quarantine 替换。
- 发布前限制：Website 可以保留这段演进过程，但不能把功能分支事实写成稳定版能力，也不能用不同窗口的离线 duration 宣称性能倍数。

## 2026-07-18：Wave B 真实模型澄清实验与边界收口

这轮把“Native 的澄清是否已经达到 grilling 类似效果”从静态 prompt 评审推进到真实模型实验。任务 `comet-native-wave-b-decision-resume` 隐藏大小写、首尾标点和内部撇号的 token 归一化决定；成功样本必须只问一个产品问题，接收确定性用户回答，以 `--confirmed` 进入 Build，清空上下文后从磁盘恢复同一 change，再完成实现、验证和归档。

### 迭代与真实结果

| Experiment                   | Prompt 变量                                                                 | 结果 | 关键事实                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `experiment_20260718_100052` | 增加用户可见契约扫描和文本/CLI 边界清单                                     | 0/3  | 三次都识别大小写或标点分歧，随后用相邻 `text.split()` 行为自行选择；`decision_points=0`，最终功能和 `approval` 不符合确定性答案。               |
| `experiment_20260718_101243` | 明确相邻实现、一致性、惯例和最小改动只能支撑推荐，不能代替用户答案          | 0/3  | 三次仍把新语义重分类为实现选择；`decision_points=0`，并因没有进入预期多轮协议而缺少一个或多个冷恢复/归档 envelope。                             |
| `experiment_20260718_102227` | 增加“出现两个合理输出就停止、不得 `next`”的硬停止句                         | 0/1  | 模型仍选择区分大小写和保留标点，功能输出错误，`approval` 保持 implicit。                                                                        |
| `experiment_20260718_103320` | 把事实、用户决定和实现选择的所有权边界提前到 Skill 开头，模仿 grilling 结构 | 0/1  | 模型仍未提问，`actual_turns=1`、`decision_points=0`、`deterministic_replies=0`、`fresh_resume_boundaries=0`，随后缺少三份要求的 eval envelope。 |

所有运行都使用当前 `eval/.env` 配置的 subject model `mimo-v2.5-pro`；仓库没有配置第二个更强 subject model，因此这些结果证明“当前 Native prompt 对该模型不可靠”，不能外推为所有强模型都失败，也不能把该模型结果包装成强模型发布结论。完整 experiment 轨迹保留在本地 ignored eval logs 中，报告没有进入发布包。

### 最终设计判断

- grilling 的有效核心不是边界清单，而是把“事实由模型调查、产品决定属于用户、逐题询问、确认前不行动”放在最前面。Native 保留这条所有权边界，但不照搬“任何任务都必须显式确认”的重型交互。
- 继续堆禁止条款没有改善当前模型的行为，反而让主 Skill 更重。最终把重复分类和停止规则压缩为顶部优先边界与一段短 Decision protocol；静态 Skill/validator 测试证明契约存在，不证明模型遵守。
- 不把语义理解塞进 Runtime。Runtime 无法可靠判断“大小写是否应归一化”，强制每个 Shape 都 `--confirmed` 又会破坏 Native 的轻量定位；当前保留“明确决定才阻塞、没有决定自动推进”的产品边界。
- Website 可以写“Native 借鉴 grilling 的问题所有权与单问题结构，并用 Wave B 持续评估”，不能写“澄清质量已经等同 grilling”或“Wave B pass@3 已通过”。发布级结论仍需要在目标强模型上重新运行相同任务矩阵。

## 2026-07-18：需求澄清协议中文稿——从影响阈值改为决定所有权

Wave B 失败轨迹显示，模型并非没有发现大小写与标点分支，而是把它们判断为“影响不大”的实现选择，再借相邻 `text.split()` 行为替用户选了默认值。旧 Skill 虽然多次写明“两个用户可见结果就提问”，Shape 与 Build 后文仍只对“高影响决定”要求显式确认；这个内部阈值给了模型重新分类的空间。

中文稿因此先完成一个不增加 Runtime 概念的纵向切片：

- 在任何状态和命令说明之前增加简短的“需求澄清协议”，沿用 grilling 有效的共享理解、决策树、单问题和问后立即停止结构，但不调用或依赖外部 Skill。
- 用户可见分支没有精确契约时，决定权默认归用户；只有不同做法保持相同用户可见结果时才是实现选择。无法证明时按用户决定处理，不以“影响不大”自动降级。
- 内部实现原语、依赖库默认值、相邻功能、惯例和最小改动只能形成推荐，不能成为新行为的产品契约。
- 共享理解不增加通用确认题：决策前沿为空且冷启动模型无需猜测时直接继续。
- Shape 与 Build 的 `--confirmed` 语义统一绑定“用户刚确认的决定”，删除与前置协议冲突的“高影响决定”措辞。

当前只完成中文 Skill 与静态行为回归；按照双语 Skill 流程，英文稿需在中文确认后同步。最终效果仍必须以当前 Prompt 的隐藏决定 Wave B 真实模型复跑为准，不能用措辞测试宣称已经达到 grilling 类似质量。若英文同步后的目标强模型仍自行选择，下一步优先继续删减或调整决定所有权提示，不向 Native 加固定问卷、强制通用确认或 Runtime LLM 判断。

用户确认中文稿后，英文主 Skill、命令参考和恢复参考按同一决定所有权协议同步，双语静态行为测试通过。外部评测权限短暂恢复后，使用同一个 `comet-native-wave-b-decision-resume` case、`COMET_NATIVE_PHASE1` treatment、`mimo-v2.5-pro` subject model 与 `count=3` 完成了两轮真实复跑；这两轮都保持同一 case/task/controller identity，只改变 Skill snapshot。

第一轮 `experiment_20260718_131258` 的 Skill hash 为 `sha256:2cf4e3dc8e50ad8b23ff9f1977461c3fc8d5a597e7fc60df4c94d235d468c10d`，结果仍为 0/3，但已经从此前的低完成度失败提升到 22/25、23/25、24/25。三条 interaction 分别为：`0 decision / 0 reply / 0 cold-resume`、`1 / 1 / 0`、`0 / 0 / 0`。原始轨迹证明失败不是模型没有看到歧义：直接推进的样本明确识别了大小写与标点分支，却被“不要询问实现选择”“保持与 text.split() 一致”和“最简单实现”诱导，把产品语义重新归类为实现选择；唯一真正提问的样本正确实现了确定性答案，但没有遵守新会话停点。

第二轮在需求澄清协议增加“必须引用精确契约”“耦合细节组成一个策略问题”和“显式会话边界优先于自动推进”后运行，实验为 `experiment_20260718_132818`，Skill hash 为 `sha256:945faa387c312cdcb79d115f06fb7a7b9319bbcf54d0f1dee58a9be55f31f23b`，结果仍为 0/3。三条 interaction 分别为 `0 / 0 / 0`、`0 / 0 / 1`、`1 / 1 / 0`；检查完成度为 21/24、19/24、21/23。失败形态进一步暴露三处精确缺口：模型仍把“preserve existing behavior”解释成新能力继承旧 token 语义；把最初提出功能误记成需要 `--confirmed` 的新回答；以及在正确回答后越过调用方要求的 Shape→Build 停点，直接实现与归档。第三条已经正确保存大小写、外围标点和内部撇号的完整策略，说明单问题决定前沿有效，但停点执行还不稳定。

基于第二轮轨迹，当前未复跑稿继续做了最小收敛：明确“保持现有行为”只保护旧结果、不自动定义新语义；只有用户回答先前已提出的阻塞问题才使用 `--confirmed`，最初功能请求不算；如果任一回答仍留下同级分支，问题就过窄；显式阶段边界的 transition 成功后不得再调用工具，只能精确输出停点标记。没有增加固定问卷、阶段 Skill 或 Runtime 语义判断。

随后启动单样本 smoke 时，租户策略再次以外传本地 Eval fixture 到未验证外部 subject model 为由拒绝执行。该拒绝没有生成 experiment ID，不计为失败样本，也不能绕过。因此当前可以确认两轮失败轨迹驱动的提示收敛与本地静态契约，但不能宣称最新稿已达到 grilling 类似的 pass@3；下一次真实结论必须从这份未复跑稿开始，在获准的外部目的地上先跑 1 条 smoke，再跑同 case 的 3 条复验。

## 2026-07-18：最新版澄清 smoke 与严格 pass@3

恢复外部 Eval 后，先后运行了多轮单样本诊断。这些中间实验保留了两个重要发现：`COMET_NATIVE_PHASE1` treatment 曾用“material user decision”重新引入已从 Skill 删除的影响阈值，并且 treatment 的“leave a terminal archive”会覆盖任务明确要求的会话停点。两处控制层冲突均改为：任一未解决用户决定都会阻止推进；调用方明确的阶段或会话边界优先于自动推进。Wave B 任务也明确了与隐藏决定无关的“unique=distinct values”语义，并把 benchmark 专用 runtime envelope 捕获顺序写成可执行证据协议，避免把 Archive 采集噪声误诊为澄清失败。

真实轨迹仍显示，同一个强模型会随机把未定义的 `normalized` 当成可自行选择的默认值，或只问大小写而遗留标点分支。最终稿因此没有增加阶段、固定通用问卷或外部 Skill 依赖，而是在需求澄清协议最前面增加三个短约束：

- `normalized`、`intuitive`、`standard`、`expected` 等词只是未定义行为的占位符，不是产品契约；
- 文本规范化必须作为一个策略问题，同时覆盖大小写折叠、外围标点、内部标点或撇号，并用反例说明输出差异；
- 当前消息若回答了已提出问题，必须把完整答案写入 brief 与 target spec，离开 Shape 时使用 `--confirmed`，并服从调用方要求的 transition 后停点。

最新版单样本 smoke 为 `experiment_20260718_172651`。完整 Wave B 为 24/25，唯一失败是冷恢复 status 没有捕获在精确 Build 时点；澄清子指标通过：首轮只提出一个 normalization 策略问题，在实现前停止，同时覆盖大小写、外围标点和内部撇号风险，并包含推荐、理由与可量化影响。这个 smoke 证明澄清行为，但不能证明完整 workflow 全绿。

冻结该稿后运行最终三样本 `experiment_20260718_173545`，case matrix hash 为 `sha256:6c9a3fe98386c278e11fcc1a3603f34f34a217d92faf3b07a237422f418fd157`，三条使用同一 task、treatment、controller 与 subject model。严格人工 rubric 要求每条首轮同时满足：一个上游问题；大小写、外围标点、内部标点/撇号三类分支；推荐与实际输出影响；实现前停止。结果如下：

| 样本 | 澄清结果                                                                                                         | 交互证据                                           | 完整 Wave B                                |
| ---- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| r1   | 通过：分别询问 case folding、surrounding punctuation、internal punctuation/apostrophes，并给出完整推荐与计数反例 | 1 decision / 1 deterministic reply / 1 cold resume | 21/23；Archive envelope 文件缺失           |
| r2   | 通过：推荐同时定义大小写、外围标点、内部撇号与连字符，并说明输出影响                                             | 1 / 1 / 1                                          | 21/23；Archive envelope 文件缺失           |
| r3   | 通过：推荐覆盖三类分支，并对 contractions 给出差异反例                                                           | 1 / 1 / 1                                          | 21/23；未在回合预算内保存 Archive envelope |

因此，本轮可以限定地确认 **clarification pass@3 = 3/3**：Native 已在这个隐藏 normalization 决策 case 上稳定复现 grilling 类似的核心效果——发现未定义用户可见语义、把同级分支合并成一个高杠杆问题、给出推荐和影响、在实现前停下等待答案。不能扩张为“所有任务或所有强模型等同于 grilling”；也不能宣称完整 Native workflow pass@3，后者本轮仍为 **0/3**。后续优化应聚焦新会话中的证据捕获与执行效率，不再用 Archive 失败否定已经独立证明的澄清质量。

## 2026-07-18：初始化、统一配置与阶段保护收口

这一轮把 Native 从“可单独运行的实验路径”收口为可安装的项目工作流，同时保持 Native 与 Classic 概念独立：

- `comet init` 交互式提供 Native、Classic、两者三种选择，并在选项中直接解释适用模型、流程重量和依赖边界；`both` 只并列安装两套永久入口，默认入口仍为 Native，不合并 change、状态或产物。
- Native 尚未发布，因此不保留根目录 `comet.config.yaml` 兼容层，直接统一迁移到 `.comet/config.yaml`。同一 YAML 在顶层保留 Classic 配置，并增加 `schema`、`default_workflow`、`workflows` 与 `native` 映射；Native 产物仍只进入可配置的 `<artifact-root>/comet/`。
- Native 当时先增加了自有的中英文阶段 Rule 和 Write/Edit Hook，用于验证独立 Guard 边界；这套“分别安装”的中间形态已由后文的统一 Rule/Hook Router 取代。保留下来的是 Native Guard 本身：它只读取 Native 配置与 change 状态，在 Shape、Verify、Archive 阶段拦截普通实现写入，允许 Native 控制产物和平台配置写入，也不依赖外部 Skill。
- Native Eval 的任务清单、Docker 夹具和验证器同步使用 `.comet/config.yaml`，隔离检查只允许该配置文件，不再把整个 `.comet/` 目录视为非法。

这一决定替代本文早期章节中的根目录 `comet.config.yaml` 描述；早期文字继续保留，用于呈现设计如何从“Native 自有可见配置”演进到“Comet 统一项目配置”。

## 2026-07-18：Native 状态文件命名收口

Native 尚未发布，因此不保留 `change.yaml` 兼容层，活跃与归档 change 的状态文件直接统一为 `comet-state.yaml`。项目级配置仍位于 `.comet/config.yaml`；`comet-state.yaml` 只表达单个 Native change 的状态机，避免把项目配置、change 身份和状态机混成同一种文件心智。

Classic 本轮不迁移。未来 Classic 可以沿用同一状态文件命名，但 Native 与 Classic 仍保持各自独立的目录、schema、状态机和执行路径，不因文件同名而合并概念。

## 2026-07-18：Native Guard 写入边界加固

Native Guard 的最终边界从“单个 `Write|Edit` 文件路径提示”收紧为一次工具调用级别的原子判断：同时解析 Claude 兼容的 `tool_name/tool_input` 与原生 `toolName/toolArgs` 载荷，识别多目标字段和 patch 文件头；任一目标属于普通项目文件时，Shape、Verify、Archive 都阻断整次写入。明确的非写工具继续放行；已识别写工具却无法恢复目标、空输入或畸形载荷在非 Build 阶段失败关闭。后续统一路由只改变安装入口，不合并或弱化这套 Native Guard 语义。

点号开头不再等于平台配置白名单，`.github/workflows/*`、`.husky/*`、`.env`、`.gitignore` 等都服从普通项目写入边界。跨阶段只保留 `.comet/config.yaml` 与配置的 `<artifact-root>/comet/` Native 控制产物；项目外路径继续超出本项目 Hook 的责任范围。Verify 只运行检查和记录证据，发现实现问题时先记录失败并返回 Build，再修改实现。

## 2026-07-18：Native 与 Classic 统一 Hook 路由

项目同时启用 Native 与 Classic 时，不再同时安装两套常驻 Hook 和 Rule。`workflows` 只表示项目具备的能力，`default_workflow` 只决定 `/comet` 默认入口；当前需求归属统一记录在项目级 `.comet/current-change.json`，格式为 `comet.selection.v2` 的 `workflow + change + branch`。Native 和 Classic 的阶段、产物和 Guard 仍完全独立。

所有支持 Hook 的平台只安装 `comet-hook-router.mjs`。Router 先规范化平台载荷，再验证共享 selection；selection 缺失时只允许只读推断唯一活跃 change，存在多个候选时失败关闭。一次写入事件最多调用一个 workflow Guard，因此保留 `workflow: both` 不会再造成双 Guard 误拦。所有支持 Rule 的平台也只安装一份 `comet-workflow-guard`，用于说明 enabled、default、current 三种状态和跨 workflow 的稳定边界。

Init、Update、Doctor repair 与 Uninstall 同时识别新 Router/Rule 和旧 Native/Classic managed 文件。已发布的 Classic v1 selection 可确定性迁移到 v2；无法唯一判断归属时不自动选择。Native 尚未发布，不保留旧 Native selection 的长期兼容格式。

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

|   # | 原始检查点         | 收敛去向                                                                  |
| --: | ------------------ | ------------------------------------------------------------------------- |
|  17 | 验证新鲜度封印     | `verification-evidence-envelope`。                                        |
|  18 | 产物 manifest      | `content-snapshot-manifest` 与 evidence envelope 共用。                   |
|  19 | 结构化证据采集     | 收敛为显式、可选、process-free 的内置 check receipt；不执行或监控 shell。 |
|  20 | 验收—证据覆盖视图  | `acceptance-evidence-trace`。                                             |
|  21 | 跳过检查的诚实表达 | 合并进 evidence trace 和现有 verification report。                        |
|  22 | 验证建议           | Skill 根据风险自主决定；Runtime 只提供确定性事实，不形成独立功能。        |
|  23 | 连续修复闭环       | 复用现有 Verify fail → Build，加深 continuation 和停止条件。              |
|  24 | 无进展检测         | `repair-stagnation-control`。                                             |
|  25 | 失败历史保留       | `repair-stagnation-control` 与保留策略。                                  |
|  26 | Archive 预演       | `spec-archive-preview`。                                                  |

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

|   # | 原始检查点                 | 收敛去向                                                                      |
| --: | -------------------------- | ----------------------------------------------------------------------------- |
|  34 | Worktree/会话级 selection  | 降级为 Native selection + process-free root identity；不识别或切换 worktree。 |
|  35 | 工作区身份与基线           | `workspace-identity-advisory` 只保存物理 root hash 与 revision。              |
|  36 | 无关修改归属保护           | baseline/current snapshot + root advisory，只告警和防止错误认领。             |
|  37 | Active change revision/CAS | `runtime-revision-cas`，扩展到所有 Runtime mutation。                         |
|  38 | 非阻塞活动标记             | 删除；heartbeat/TTL 容易演变为 daemon 或在线协作系统。                        |
|  39 | 跨 change 冲突雷达         | `multi-change-conflict-radar`。                                               |
|  40 | 安全归档顺序建议           | conflict radar 的只读推导，不增加 queue。                                     |
|  41 | 可移交快照                 | 复用 checkpoint + compact resume view，不新增 handoff 协议。                  |
|  42 | 轻量 prerequisite          | 暂不增加字段；先从 capability、artifact 和 base hash 推导。                   |
|  43 | 可选交付引用               | 作为 snapshot 的可选引用，不成为阶段、依赖或独立 capability。                 |

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

## 2026-07-19：时点证据、回答回合停点与最新版 Wave B

这轮把完整 workflow 失败拆成了三类独立问题，而不是继续把所有失败归因给澄清质量：调用方要求的时点证据被归档后重建或覆盖；回答用户决定的回合越过 Shape→Build 停点；Eval controller 没有识别 `completed through Archive` / `Archived to` 等完成表达，错误追加 continuation 并破坏原本正确的冷恢复快照。Native 双语 Skill 因此只增加两条轻量执行契约：回答回合不执行下一阶段，调用方时点 envelope 由首次真实命令直接生成并在验证后保持不可变。Controller 与 validator 同时补充语义等价回归，避免把控制器误触发或 `case folding`、`str.lower()`、内部标点保留等正确规格误判为失败。

迭代中的 `experiment_20260719_122705` 曾达到单样本 25/25；其后的 `experiment_20260719_123746` 暴露三条样本对 archive envelope 与冷恢复快照的时点纪律不稳定。`experiment_20260719_125807`、`experiment_20260719_131425` 和 `experiment_20260719_132636` 进一步区分了完成检测误触发、validator 过度字面化与真实停点失败。`experiment_20260719_133850` 是 `Connection closed mid-response`，已由 sample-quality 以 `excluded / network_failure` 保留但不计入分析集。

最新版三样本实验为 `experiment_20260719_134408`，Skill hash `sha256:78f4845c33a528622b6095ff3acccb985ba89302f3b0c6875931ae2515cca7d6`，case hash `sha256:789f349fd0a2538b6ef9fada566fda0a63dfbb77b68c48611c77a6485cf46068`。三个样本分别为 23/25、24/25、25/25；都触发了一个 normalization 决策点并使用确定性回答，其中一条完整完成澄清、停点、冷恢复、实现、验证和归档。按仓库采用的 HumanEval 至少一次成功估计器，`n=3, c=1` 时 overall `pass@1 = 0.33`、`pass@3 = 1.00`；但 `pass^3 = 0.00`，因此只能证明三次预算内存在完整成功路径，不能声称三次都稳定。两条失败分别是缺少完整目标 specification，以及没有进入冷恢复边界。Website 若引用本轮，应同时展示 capability ceiling 与 reliability floor，不能只写 `pass@3 = 1.00`。
