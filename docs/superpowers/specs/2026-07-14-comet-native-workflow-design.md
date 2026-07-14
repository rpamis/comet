# Comet Native Workflow 设计

> 状态：已确认
>
> 日期：2026-07-14
>
> 产品决策：Native 最终成为新 change 的默认敏捷路径；Classic 保留为显式高治理模式。第一版先以 opt-in 方式验证，不立即替换默认路径。

## 1. 背景

Comet Classic 已经具备完整的需求管理、阶段状态机、阶段守卫、恢复、验证、归档和自动推进能力。它适合长周期、跨模块、多人协作、需要正式规格与审计证据的 change。

但 Classic 的执行路径仍然继承了 OpenSpec 与 Superpowers 的完整方法链：需求产物、深度设计、实施计划、执行方式、TDD、代码审查、验证和归档均由多个 Skill 共同规定。随着模型的仓库探索、推理、计划、工具使用和错误恢复能力增强，这些详细执行协议会产生新的成本：

- 同一意图被 proposal、delta spec、Design Doc、plan 和 tasks 多次表达。
- Skill 同时规定目标、推理过程和运行时控制，模型很难区分必须满足的边界与可自主决定的方法。
- 简单或中等 change 也需要经历与高风险 change 相近的仪式和确认点。
- 新增澄清 Skill 只能继续叠加流程，不能消除原有执行负担。
- 大量流程字段进入 `.comet.yaml`，状态机开始记录实现偏好，而不只是持久业务状态。

Native 不是删除 Spec，也不是取消验证。它重新划分职责：

- 模型负责理解、设计和执行。
- Comet 负责持久状态、阶段边界、证据、恢复和自动推进。
- Spec 负责声明意图与验收契约，不再充当逐步施工手册。

## 2. 目标

### 2.1 产品目标

1. 为大多数敏捷开发任务提供一条低摩擦、可恢复、可验证的 Comet 原生路径。
2. 保留 Classic 已验证的需求治理、状态机、阶段守卫、自动推进和归档能力。
3. 让强模型在明确边界内自主探索、规划、实现和选择验证策略。
4. 只向用户询问无法从仓库或工具获取的决策，并且一次只处理一个最高价值决策。
5. 让需求、关键决策和验证证据在跨 session、上下文压缩和 agent 更换后仍然可恢复。
6. 允许 Native change 在风险或范围扩大时升级为 Classic，而不丢失已有意图和历史。

### 2.2 工程目标

1. 不修改 Superpowers 或 OpenSpec 的原始 Skill。
2. 不通过给 Classic 节点追加 `grill-me` 调用来实现 Native。
3. 复用现有 `domains/engine` 的 Run state、trajectory、checkpoint 和确定性 Resolver 能力。
4. 让 `comet status`、`comet doctor`、恢复探针和自动推进同时理解 Native 与 Classic。
5. Native 使用独立状态 schema 和 transition table，避免把新语义塞入 `ClassicProfile`。
6. 用行为和证据守卫阶段，而不是校验模型是否调用了指定方法 Skill。

## 3. 非目标

- 不删除或降级 Classic。
- 不在第一版自动把现有 Classic change 迁移为 Native。
- 不支持执行中的 Classic change 降级为 Native。
- 不要求 Native 为每个 change 生成 Design Doc、完整实施计划或 tasks 清单。
- 不保存模型隐藏思维链、内部推理草稿或逐 token 轨迹。
- 不以文件数量作为自动切换 Classic 的硬条件。
- 不在第一版解决跨仓库统一事务；跨仓库 change 应建议使用 Classic。
- 不把远程提交、PR、合并或其他外部写操作授权包含在工作流自动推进中。

## 4. 核心原则

### 4.1 Spec 详细描述结果，不规定施工动作

Native Spec 可以详细，但详细信息集中在：

- 用户要获得的结果。
- 范围和非目标。
- 可观察验收场景。
- 兼容性、安全性、性能和架构约束。
- 已确认的产品或技术决策。
- 仍未解决且会阻塞执行的问题。
- 完成时需要提供的验证证据。

Spec 默认不规定具体文件、函数、逐步实现顺序或必须调用的执行 Skill。只有当某个实现决定本身构成稳定契约时才记录它。

### 4.2 约束边界，不微观管理实现

Comet 对以下内容使用确定性约束：

- 当前 change 与 phase。
- 必需产物是否存在且结构有效。
- 阻塞性决策是否已解决。
- 是否存在可复核验证证据。
- 状态转换是否合法。
- 归档与升级是否保持单一事实源。

具体如何调查、设计、拆分代码和组织实现，由模型根据仓库事实决定。

### 4.3 事实由模型调查，决策由用户做出

模型先读取仓库、现有文档、测试、运行结果和工具输出。能够通过环境回答的问题不得转交给用户。

仍需用户判断时，模型维护一个“决策前沿”，每次只提出当前最重要的一个问题，同时给出推荐答案及影响。决策按依赖顺序逐个解决，不批量抛出问卷。

### 4.4 证据优先于仪式

Native 不验证“是否举行过 TDD、planning 或 review 流程”，而验证：

- 报告的 bug 是否被真实复现。
- 关键行为是否有稳定接口上的测试或等价证据。
- 构建、类型检查、静态检查或真实运行是否支持完成结论。
- 验收场景是否逐项得到证明。
- diff 是否与 brief 一致。

### 4.5 渐进披露

Native 主 Skill 只携带稳定决策协议和阶段契约。错误恢复、格式细节和平台差异由运行时错误信息或按需 reference 提供，不在每次执行时全部注入上下文。

## 5. 产品模式

### 5.1 Native

面向单个可收敛 change 的默认敏捷路径，适合：

- 日常功能迭代。
- 已有行为修复。
- 单仓库内的中小型重构。
- 文档、配置、Prompt 和工具链调整。
- 需求可以通过一个 living brief 表达的任务。

### 5.2 Classic

面向显式高治理需求，适合：

- 用户明确要求正式 OpenSpec 或 Classic 流程。
- 多个独立 capability 或需要拆分为多个 change。
- 跨仓库或跨团队协调。
- 公共 API、schema、数据迁移或兼容性政策变更。
- 不可逆、高风险、安全或合规工作。
- 需要长期维护的正式主 Spec 和 delta merge。
- 需要多人在多个 session 中审阅设计、计划和归档历史。

### 5.3 路由原则

第一版必须显式调用 Native，例如 `/comet-native` 或 `/comet --native`。完成对比验证后，新的 `/comet` change 默认进入 Native。

以下信号只触发“建议 Classic”的单一决策点，不得自动升级：

- 多 capability。
- 公共 API、schema 或数据迁移。
- 跨仓库、跨团队或多个独立里程碑。
- 不可逆操作或高安全风险。
- 需求边界无法收敛为一个 brief。
- 用户要求正式规格、审计或长期主 Spec。

文件数量只用于提示复杂度和选择验证强度，不直接决定工作流。

## 6. Native 生命周期

```text
shape ──shape-complete──> build ──build-complete──> verify
  │                         ▲                         │
  │                         └──────verify-fail────────┘
  │                                                   │
  └────────────escalate-to-classic────────────────────┤
                                                      │
                         archive <────verify-pass─────┘
                            │
                     archive-complete
                            │
                         archived
```

### 6.1 Shape

Shape 合并 Classic 的 open 与 design 中对敏捷 change 真正必要的部分：

1. 发现或创建 Native change。
2. 调查仓库事实与已有行为。
3. 沿决策前沿澄清目标、边界和验收条件。
4. 创建或更新唯一的 `brief.md`。
5. 判断是继续 Native，还是建议升级 Classic。
6. 运行 shape 守卫并请求状态推进。

Shape 不要求独立 proposal、Design Doc、plan 或 tasks。

#### 确认策略

`approval` 有两个合法值：

- `implicit`：用户请求已经明确，模型调查没有引入重大新范围、取舍或风险。
- `confirmed`：用户对重大范围、产品行为、不可逆操作或方案取舍做出了明确选择。

Shape 守卫根据 brief 内容决定是否允许 `implicit`。只要存在阻塞性未知项、多个实质方案或高风险信号，就必须要求 `confirmed`。

### 6.2 Build

Build 读取 brief、仓库规则、当前状态与已有验证要求，由模型自主：

- 决定是否需要单独 plan。
- 选择修改顺序和代码结构。
- 决定是否使用子 agent 或并行调查。
- 选择适合当前风险的测试方式。
- 在发现需求冲突或范围漂移时回写 brief。

只有跨 session 或存在多个有依赖的长期任务时才创建 `plan.md`。短任务的计划由模型在当前会话内维护；只有恢复所需的当前步骤、pending action 和 checkpoint 进入 Run state，不要求持久化完整计划。

Build 不包含固定的 `writing-plans → executing-plans → TDD → requesting-code-review` 调用链。需要某个辅助 Skill 时，模型可以自主调用，但它不是阶段通过条件。

### 6.3 Verify

Verify 从 brief 的验收场景出发收集证据：

- 执行相关测试、构建、类型检查、lint 或真实运行检查。
- 检查实现是否越过范围或遗漏非目标约束。
- 记录命令、结果、未运行项及理由。
- 对高风险 diff 进行必要审查。
- 生成 `verification.md`。

验证失败通过 `verify-fail` 回到 Build，并保留失败证据。修复完成后再次进入 Verify，不清除历史失败记录。

### 6.4 Archive

Native archive 不执行 OpenSpec delta merge。它完成以下动作：

- 冻结最终 brief 与 verification 引用。
- 确认没有阻塞性未解决问题。
- 记录最终状态事件。
- 将 state 标记为 archived。

Native archive 本身不是需要额外用户确认的不可逆外部操作，因此默认可在 verify 通过后自动完成。若本次 change 还包含发布、推送、合并、部署或数据写入，这些动作仍分别遵循平台授权与用户确认，不得因 Native archive 自动获得权限。

## 7. 产物与存储

### 7.1 目录

Native change 使用 Comet 自有目录，不放入 `openspec/changes/`：

```text
.comet/
└── changes/
    └── <change-name>/
        ├── state.yaml
        ├── brief.md
        ├── verification.md       # verify 后生成
        ├── plan.md               # 可选，仅长任务
        └── .comet/
            ├── run-state.json        # machine-owned，复用 Engine schema
            └── state-events.jsonl    # append-only
```

Native adapter 将 `.comet/changes/<change-name>` 作为 `changeDir` 传给现有 Engine，因此 machine-owned 文件继续遵循 `<changeDir>/.comet/` 契约。每个 change 的 Run state 与事件日志彼此隔离，避免多个 active Native change 共享可变运行态。

### 7.2 `state.yaml`

第一版只包含稳定工作流字段：

```yaml
schema: comet.native.v1
name: add-example-capability
workflow: native
language: zh-CN
phase: shape
brief: brief.md
approval: null
confirmation_required: false
classic_signals: []
classic_decision: null
verification_result: pending
verification_report: null
archived: false
successor_ref: null
created_at: 2026-07-14
run_id: null
```

字段约束：

- `phase`: `shape | build | verify | archive`
- `approval`: `null | implicit | confirmed`
- `confirmation_required`: intent resolver 根据重大取舍、风险与不可逆性设置
- `classic_signals`: 建议升级 Classic 的稳定原因列表，不包含文件数量
- `classic_decision`: `null | continue-native | escalate`
- `verification_result`: `pending | pass | fail`
- `successor_ref`: Native 升级为 Classic 后指向接管它的 OpenSpec change
- `run_id`: 链接 machine-owned Run state

Native 不持久化 `build_mode`、`tdd_mode`、`review_mode`、`isolation`、`direct_override` 等实现偏好。必要的临时执行选择属于 Run state 或当前会话，不成为长期 change schema。

### 7.3 `brief.md`

`brief.md` 是 Native 唯一的需求事实源：

```markdown
# Outcome

# Scope

# Non-goals

# Acceptance examples

# Constraints and invariants

# Decisions

# Open questions

# Verification expectations
```

要求：

- `Outcome`、`Scope`、`Non-goals`、`Acceptance examples` 必须存在且非空。
- `Open questions` 可以为空，但不得包含标记为 blocking 的条目后通过 Shape。
- `Decisions` 只记录结论、理由和影响，不保存内部思维链。
- 实施发现改变行为契约时必须先更新 brief，再继续完成相关实现。

### 7.4 `verification.md`

验证报告至少包含：

- 验收场景与对应证据。
- 实际执行的命令和结果。
- 未执行检查及理由。
- 已知限制或剩余风险。
- 最终结论。

## 8. Native Prompt 契约

Native Skill 使用以下稳定协议，不调用 `grill-me` 或 `grilling`：

```text
先理解，再行动。

先检查仓库、现有实现、文档和测试。能从环境得到的事实不要询问用户。

持续维护当前的决策前沿：如果仍存在会显著改变范围、行为或风险的未知决策，
每次只向用户提出其中最重要的一个，并同时给出你的推荐答案及影响。

当目标、非目标、验收场景、约束和阻塞性未知项已经足够明确时，更新 change brief。
清晰、低风险的任务可继续；重大取舍或不可逆行为必须等待确认。

实现方式由你自主决定。选择满足 brief 的最简单可靠方案。
测试用于提供行为证据，不是固定仪式。发现需求冲突或范围漂移时先更新 brief，
再判断是否需要用户决策。

每个阶段结束时提交可验证证据，并通过 Comet guard 请求状态推进。
不要自行修改 phase，也不要跳过失败的 guard。
```

运行时在 Prompt 后只注入当前阶段、brief 路径、状态摘要、失败守卫和下一合法动作。完整格式说明只在需要时按需读取。

## 9. 测试与验证策略

Native 将测试视为风险与证据策略：

### 9.1 必须先得到失败证据

- 已发布行为的 bug 或回归。
- 可通过稳定公共接口复现的异常。
- 状态机、数据转换和边界校验错误。

优先写失败回归测试；暂时无法自动化时，可以使用可重复命令、fixture、日志或真实运行步骤作为失败证据，并在 verification 中说明。

### 9.2 优先行为测试

- 公共 API。
- 状态机与领域规则。
- 数据迁移和兼容性逻辑。
- 安全、权限和路径边界。
- 用户关键路径。

测试应位于最高稳定 seam，避免只验证内部实现。

### 9.3 不强制 Red 阶段

- 文档与文案。
- 格式化和机械迁移。
- 简单配置调整。
- 没有新增行为的内部重构。

这些任务仍需适当的格式、构建、类型、lint、现有测试或人工运行证据。

### 9.4 Review 策略

Review 不再作为所有 change 的独立必经阶段。以下信号要求在 Verify 中增加审查证据：

- 认证、权限、路径、命令执行或敏感数据。
- 公共 API、schema 或兼容性变化。
- 并发、事务、缓存或恢复逻辑。
- diff 明显超出 brief。
- 模型对正确性仍缺乏足够置信证据。

## 10. 阶段守卫与状态转换

### 10.1 Shape 守卫

通过条件：

- `state.yaml` 与 `brief.md` 存在并通过 schema/结构校验。
- brief 必需章节非空。
- 没有 blocking open question。
- `confirmation_required: true` 时 approval 必须为 `confirmed`；否则可以为 `implicit` 或 `confirmed`。
- `classic_signals` 非空时，`classic_decision` 必须为 `continue-native` 或 `escalate`；选择 `escalate` 时不得进入 Build。

### 10.2 Build 守卫

通过条件：

- 当前 Run 没有未处理 blocker。
- 实现或明确的无代码结果存在。
- 实现范围与 brief 一致。
- 验证期望可执行；无法执行的项已有理由。
- 长任务存在可恢复 checkpoint；短任务不强制 plan 文件。

### 10.3 Verify 守卫

通过条件：

- `verification.md` 存在且结构有效。
- 每个验收场景都有证据或明确接受的例外。
- 必需命令成功，或失败已经触发 `verify-fail`。
- 没有未解决的高风险审查发现。
- `verification_result` 可转换为 `pass`。

### 10.4 Archive 守卫

通过条件：

- verify 已通过，或者 `successor_ref` 指向已成功接管的有效 Classic change。
- brief 与 verification 引用有效。
- 没有 blocking open question。
- 若已升级 Classic，则 `successor_ref` 有效且 Native 不再可执行。

### 10.5 单一推进入口

Skill 只请求：

```bash
comet next <change-name>
```

运行时负责：

1. 解析 change backend。
2. 运行当前 phase 的守卫。
3. 应用 transition table。
4. 更新 Run state 与 checkpoint。
5. 追加状态事件。
6. 返回 `NEXT: auto | manual | done` 和下一合法命令。

Prompt、Rule 和 Hook 不得硬编码下一 Skill 映射。

## 11. 组件架构

### 11.1 `domains/comet-native/`

职责：

- Native state schema、读取与写入。
- brief 与 verification 结构校验。
- transition table 与阶段守卫。
- Native change 发现、诊断、恢复和归档。
- Native 到 Classic 的升级投影。
- Native runtime package 与 launcher 源码。

### 11.2 `domains/engine/`

继续负责模式无关能力：

- Run state。
- trajectory、artifact refs 和 checkpoints。
- action guardrails。
- deterministic resolver loop。
- runtime eval。

Native 不复制 Engine schema，也不把 Engine 字段混入用户可编辑 state。

### 11.3 `domains/workflow-contract/`

增加独立内建 kind：`comet-native`。

节点：

- `shape`
- `build`
- `verify`
- `archive`

Output Schema：

- `comet.native.brief.v1`
- `comet.native.implementation.v1`
- `comet.native.verify.v1`
- `comet.native.archive.v1`

Native 不是 `comet-five-phase-overlay` 的 augmentation，也不通过 `requiredSkillCalls` 模拟。

### 11.4 Managed Change Adapter

定义模式无关的只读与推进接口，由 Classic 和 Native 分别实现：

```ts
interface ManagedChangeAdapter {
  discover(root: string): Promise<ManagedChangeSummary[]>;
  inspect(change: ManagedChangeRef): Promise<ManagedChangeDiagnostic>;
  next(change: ManagedChangeRef): Promise<ManagedChangeTransition>;
  recover(change: ManagedChangeRef): Promise<ManagedChangeRecovery>;
}
```

`app/commands/status.ts`、`doctor.ts` 和恢复探针只组合 adapter 结果，不直接了解各模式文件布局。

### 11.5 Skill 与资产

新增 Comet 自有 Skill：

- `assets/skills-zh/comet-native/`
- 中文内容确认后同步 `assets/skills/comet-native/`

Classic Skill 保持原样。根 `/comet` 只增加路由能力，不把 Native 协议复制进 Classic 子 Skill。

## 12. Native 到 Classic 的升级

### 12.1 触发

模型或守卫发现 Classic 建议信号后，暂停并只询问一次：继续 Native，还是升级 Classic。必须给出推荐及影响，用户决定后才转换。

### 12.2 投影

用户确认升级后：

升级可从 Shape 或 Build 发起。Verify 中发现升级信号时，先通过 `verify-fail` 返回 Build，再执行升级，避免一个 transition event 同时承担验证失败和工作流转换。

升级步骤：

1. 冻结当前 Native brief hash。
2. 通过 OpenSpec CLI 创建或选择目标 change。
3. 将 Outcome、Scope、Non-goals、Acceptance、Constraints 和 Decisions 投影到 OpenSpec artifacts。
4. 按 OpenSpec 当前 schema/instructions 生成所需产物，不硬编码目录模板。
5. 初始化 Classic `.comet.yaml`。
6. 写入来源引用和 Native brief hash。
7. 将 Native state 推进到 archive，设置 `successor_ref`。
8. 追加 `escalate-to-classic` 事件。

升级后 Classic 是唯一可执行事实源。Native brief 保留为历史输入，不得继续独立修改和执行。

### 12.3 失败处理

如果 OpenSpec 创建、产物生成或 Classic state 初始化任一步失败：

- Native 保持原 phase 和可恢复状态。
- 不写入 `successor_ref`。
- 记录失败事件和已创建的临时目标。
- 重试必须复用可确认的现有目标，不能静默创建重复 change。

## 13. 错误处理与恢复

### 13.1 畸形状态

state、Run state 或事件日志畸形时 fail closed。`doctor` 报告具体字段、期望值和安全恢复命令，不自动猜测或覆盖用户内容。

### 13.2 Brief 漂移

Build 或 Verify 发现实现目标与 brief 不一致时：

- 可兼容的细化：更新 Decisions 或 Acceptance，并记录事件。
- 改变用户可见行为或范围：回到 Shape 的决策前沿，等待必要确认。
- 拆成多个独立能力：建议升级 Classic 或创建多个 Native change，由用户选择。

### 13.3 上下文压缩和 session 恢复

恢复时只需要读取：

1. `state.yaml`
2. `brief.md`
3. 当前 `run-state.json` checkpoint
4. 最近相关 state events
5. 当前 diff 与验证失败证据

不要求重新读取完整历史对话。模型从持久事实恢复，不从摘要猜测已确认决策。

### 13.4 幂等性

- `comet next` 在守卫未通过时不产生 phase 变化。
- 重复运行已完成 transition 返回当前状态，不重复追加等价成功事件。
- brief/verification 写入采用安全替换，失败不留下半写文件。
- archive 与 upgrade 可以从 checkpoint 重试。

## 14. Eval 与成功指标

第一版同时运行 Native、tweak 和 Classic，对比同一任务集合。

### 14.1 任务矩阵

- 明确的小功能。
- 模糊但单一 capability 的功能。
- 已发布 bug。
- 机械重构。
- 状态机或 schema 变更。
- 执行中发现范围扩大的任务。
- 上下文压缩后恢复。
- 验证失败后的 repair loop。
- Native 升级 Classic。

### 14.2 核心指标

- 最终任务完成率。
- 验收场景满足率。
- spec/brief 漂移率。
- 首次写代码前的 token 与耗时。
- 用户需要回答的问题数量。
- 用户纠正或返工次数。
- 全流程 token、耗时和工具调用数。
- 上下文恢复成功率。
- 阶段守卫误阻塞和漏阻塞率。
- 验证证据完整率。
- Native 升级 Classic 的正确率与可恢复性。

### 14.3 默认切换条件

Native 只有同时满足以下条件才成为新 change 默认：

- 中小型任务完成率不低于 Classic/tweak 基线。
- spec 漂移和返工没有显著上升。
- 用户问题数、首次修改时间或总成本至少一项有明确改善。
- 恢复、verify-fail loop 和 upgrade eval 全部通过。
- 阶段守卫没有出现不可接受的漏阻塞。

如果未满足，Native 继续 opt-in，基于失败案例增加最小必要约束，不通过扩写完整方法手册解决。

## 15. 交付阶段

本文定义完整产品方向，但首个实施计划只覆盖 Phase 1。Phase 2 必须在 Phase 1 eval 结果通过评审后单独规划；Phase 3 必须在默认切换条件满足后单独规划。这样可以避免一次实现计划同时承担内核、迁移和默认行为切换。

### Phase 1：独立 Native 内核

- Native state、brief、verification、transition 和 guard。
- opt-in `/comet-native`。
- `status`、`doctor` 和恢复支持 Native。
- 独立 runtime/eval fixtures。
- Classic 完全不变。

### Phase 2：统一入口与升级

- `/comet` Resolver 理解 Native 与 Classic。
- Native 到 Classic 的显式升级。
- 统一 `comet next`、状态事件和诊断输出。
- Native/Classic 对比 eval 与报告。

### Phase 3：默认切换

- 达到成功指标后，新 change 默认 Native。
- Classic 通过显式命令、配置或升级决策进入。
- 文档以 Native 为快速路径，Classic 为治理路径。
- 保持现有 Classic change 的恢复和兼容行为。

## 16. 已确定的关键决策

1. Spec 保留，但变为行为契约和长期记忆，不再规定完整执行方法。
2. Native 是独立 workflow kind，不是 Classic augmentation。
3. Native 最终默认，第一版先 opt-in。
4. Classic 不删除、不降级，也不在执行中转为 Native。
5. Native 可以显式升级 Classic，升级后 Classic 成为唯一执行事实源。
6. Native 使用 `shape → build → verify → archive` 四阶段。
7. Native 只有一个必需需求产物 `brief.md`；plan 可选，verification 在 Verify 生成。
8. TDD 和 review 是按风险选择的证据策略，不是固定状态字段或必经 Skill。
9. 守卫验证产物、证据和状态，不验证模型是否遵循某个方法仪式。
10. 自动推进由 transition table 和 `comet next` 统一负责，Prompt 不硬编码路由。
11. Native 运行态和事件按 change 隔离，支持多个 active change。
12. 不记录模型隐藏思维链，只记录决策、证据和可恢复 checkpoint。

## 17. 设计依据

- 项目本地 `grilling` Prompt：通过决策树、单问题、事实/决策边界和确认终止条件约束交互，而不枚举完整流程。
- Anthropic《Building effective agents》：从简单、可组合模式开始，只在结果证明有价值时增加复杂度。
- OpenAI《Harness engineering》：使用短入口与渐进披露，让机械约束保护架构边界，同时给模型实现自主权。
- OpenAI Symphony：用任务与状态机作为 agent 控制面，将执行 session 与持久工作解耦。
- METR Time Horizons：强模型在清晰、自包含、可评分任务上的能力持续提升，但真实模糊任务仍依赖高质量上下文与成功条件。
