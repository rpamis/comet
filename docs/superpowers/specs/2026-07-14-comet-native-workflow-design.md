# Comet Native Workflow 设计

> 状态：已确认
>
> 日期：2026-07-14
>
> 产品决策：Native 与 Classic 是两套独立工作流。Native 是 Comet 自包含、面向强模型的默认敏捷路径；Classic 是依赖 OpenSpec 与 Superpowers、面向需要强流程引导模型的治理路径。两者不共享 change 目录、不互相升级，也不在执行中自动切换。

## 1. 背景

Comet Classic 已经具备需求管理、阶段状态机、阶段守卫、恢复、验证、归档和自动推进能力。它通过 OpenSpec 管理 change 与规格，通过 Superpowers 规定设计、计划、TDD、执行和审查方法。这种完整流程对需要详细步骤引导的模型有效，但也会限制强模型已有的仓库探索、推理、工具使用、计划与错误恢复能力。

Native 不应继续在 Classic 上追加 Skill，也不应成为 Classic 的简化 preset。它是一套 Comet 原生 change 系统：

- 使用 Comet 自己的目录、状态、规格与归档格式。
- 只依赖 Comet runtime 和宿主模型原生工具能力。
- 不依赖 OpenSpec、Superpowers、`grill-me` 或任何外部 Skill。
- 让模型自主决定实现方法，Comet 只固定需求契约、状态边界和完成证据。

Native 保留 Spec，但 Spec 的角色从“指导模型逐步施工”变为“给模型足够完整的信息、约束和验收条件”。

## 2. 产品边界

### 2.1 Native

Native 面向具备强推理、长上下文、仓库探索、工具调用和自我修正能力的模型。它强调：

- 详细需求，轻量执行。
- 模型自主规划，不强制外部方法 Skill。
- 事实由模型调查，决策由用户做出。
- 每次只询问一个最高价值决策。
- 以验证证据而不是执行仪式判断完成。
- change、spec、archive、状态与恢复全部由 Comet 自己管理。

### 2.2 Classic

Classic 面向推理、规划或工具使用稳定性相对较弱，需要更细步骤、更强方法约束或正式 OpenSpec 工作流的模型和团队。它继续使用当前 OpenSpec + Superpowers 双星流程与现有路径。

Classic 不作为 Native 的升级目标，也不由 Native 自动建议。用户根据模型能力、团队治理偏好或既有项目选择其中一套。

### 2.3 独立性约束

- Native 不读取或写入 `openspec/`。
- Native 不读取或写入 Classic change 内的 `.comet.yaml` 或 `.comet/` runtime 文件。
- Classic 不读取或写入 Native 的 `comet/` 目录。
- Native 与 Classic 不共享 active change、phase、artifact hash 或 archive 语义。
- Native change 不能转换为 Classic change；Classic change 也不能转换为 Native change。
- 两套工作流可以存在于同一仓库，但必须通过明确入口分别操作。

## 3. 目标

### 3.1 产品目标

1. 为强模型提供一条低摩擦、可恢复、可验证的 Comet 原生开发路径。
2. 提供类似 OpenSpec 的 change 管理能力，但不依赖 OpenSpec CLI、目录或 Skill。
3. 支持多个 active change、持久规格、change 归档、冲突检测和历史恢复。
4. 支持把整个 Native `comet/` 产物树放在项目根或用户指定的产物根目录。
5. 让强模型自主探索、设计、实现和选择验证策略。
6. 只向用户询问无法从仓库或工具获得的决策，并一次处理一个问题。
7. 用状态机、阶段守卫和自动推进保持长任务可靠性。
8. 在上下文压缩、session 更换或 agent 更换后从仓库事实恢复。

### 3.2 工程目标

1. Native runtime、Skill、Prompt、状态和规格操作全部由 Comet 仓库维护。
2. Native Skill 缺少任何外部 Skill 时仍能完整运行。
3. 复用 Comet 内部 `domains/engine` 的 Run state、trajectory、checkpoint 和 deterministic resolver 能力。
4. Native 使用独立 state schema、transition table、guard 和 archive 实现。
5. Native 规格归档使用确定性 hash、日志化可恢复事务与单文件原子交换，避免静默覆盖并发变化。
6. `status`、`doctor` 和恢复命令能够独立检查 Native，不借用 Classic diagnostics。

## 4. 非目标

- 不修改 Superpowers 或 OpenSpec 原始 Skill。
- 不调用或包装 `grill-me`、`grilling`、`brainstorming`、`writing-plans`、`test-driven-development`、`requesting-code-review` 等外部 Skill。
- 不提供 Native 与 Classic 之间的迁移、升级、降级，或基于任务复杂度的自动路由；`/comet` 只读取项目显式配置。
- 不把 Native state 塞入 `ClassicProfile` 或 Classic `.comet.yaml`。
- 不要求每个 Native change 都生成独立 Design Doc、完整 plan 或 tasks 清单。
- 不保存模型隐藏思维链或内部推理草稿。
- 不以文件数量决定执行流程。
- 不自动获得 push、PR、merge、部署、发布或外部数据写入权限。
- 不在第一版支持一个 Native change 跨多个仓库进行事务性归档。

## 5. 核心原则

### 5.1 Spec 详细描述结果

Native Spec 应详细描述：

- 用户要获得的结果。
- 范围与非目标。
- 可观察验收场景。
- 兼容性、安全、性能和架构约束。
- 已确认决策与理由。
- 阻塞性未知项。
- 完成时必须提供的验证证据。

默认不规定具体文件、函数、实现顺序或必须调用的方法 Skill。只有当实现决定本身构成稳定产品契约时才写入 Spec。

### 5.2 Comet 约束边界，模型决定方法

Comet 确定性约束：

- change 身份与当前 phase。
- brief/spec/verification 结构。
- blocking question 是否解决。
- 规格 base hash 是否仍然有效。
- 验证证据是否存在。
- 状态转换与归档是否合法。

模型自主决定：

- 读取哪些文件。
- 如何设计实现。
- 是否需要临时计划或子任务。
- 修改顺序。
- 测试与审查强度。
- 如何处理非阻塞异常。

### 5.3 事实由模型调查，决策由用户做出

模型先读取仓库、现有规格、代码、测试和运行结果。能够从环境获取的事实不得询问用户。

仍需用户判断时，模型维护“决策前沿”，每次只提出当前最重要的一个问题，并同时提供推荐答案及影响。问题沿依赖关系逐个解决，不批量生成问卷。

### 5.4 证据优先于仪式

Native 不验证模型是否执行了 TDD、planning 或 review Skill，而验证：

- bug 是否真实复现。
- 关键行为是否有测试或等价证据。
- 必需构建、类型、lint 或真实运行是否通过。
- 验收场景是否逐项得到证明。
- 实现是否偏离 change brief 或 proposed spec。

### 5.5 渐进披露

Native 主 Skill 只包含稳定决策协议、阶段职责和停止条件。格式细节、恢复说明与错误修复由 Comet 命令输出和按需加载的 Comet 自有 reference 提供。

## 6. 产物根目录

### 6.1 默认布局

Native 的固定目录名是 `comet`，默认位于项目根：

```text
<project-root>/comet/
```

Native 不使用 `.comet` 目录。

### 6.2 指定产物根

用户可以把 Native 产物放在项目内的指定根目录。例如指定 `docs`：

```text
<project-root>/docs/comet/
```

解析公式：

```text
nativeRoot = resolve(projectRoot, artifactRoot, "comet")
```

`artifactRoot` 默认为 `.`。

### 6.3 项目配置

产物根必须持久化在项目根的非隐藏配置文件中，避免每次命令扫描整个仓库：

```yaml
# <project-root>/comet.config.yaml
schema: comet.project.v1
default_workflow: native
native:
  artifact_root: docs
```

例子对应的 Native 根为 `docs/comet/`。

配置规则：

- `artifact_root` 必须是项目根下的相对路径。
- 拒绝绝对路径、`..`、驱动器前缀、`~` 和解析后逃逸项目根的 symlink。
- 路径使用 `/` 持久化，运行时按平台解析。
- `artifact_root: .` 表示 `<project-root>/comet/`。
- 创建第一个 Native change 后，不能直接修改 `artifact_root` 导致现有 change 失联。
- 第一版若需更换根目录，必须运行 `comet native root move <artifact-root>`；不允许仅编辑配置静默切换。

### 6.4 根目录发现

Native 命令按以下顺序解析根目录：

1. 从当前目录向上查找最近的项目根 `comet.config.yaml`。
2. 若配置存在，读取并验证 `native.artifact_root`。
3. 若配置不存在，以仓库根和 `artifact_root: .` 作为默认值。
4. 如果默认位置与显式 `--root` 同时出现且不一致，停止并要求用户选择，不扫描猜测。

`--root <path>` 只允许用于初始化或显式迁移。已有项目的普通 `list/status/next/archive` 必须遵守持久配置。

`comet native new` 在配置缺失时创建默认 `comet.config.yaml`（`artifact_root: .`、`default_workflow: native`）；希望使用 `docs/comet/` 等自定义位置的用户必须先运行 `comet native init --root docs`。

## 7. Native change 与 spec 管理

### 7.1 完整目录

以下示例使用 `artifact_root: docs`：

```text
docs/comet/
├── specs/
│   └── <capability>/
│       └── spec.md
├── changes/
│   └── <change-name>/
│       ├── change.yaml
│       ├── brief.md
│       ├── specs/
│       │   └── <capability>/
│       │       └── spec.md
│       ├── verification.md
│       ├── plan.md                 # 可选
│       └── runtime/
│           ├── run-state.json
│           ├── trajectory.jsonl
│           └── checkpoints/
├── archive/
│   └── YYYY-MM-DD-<change-name>/
│       └── ...                     # 完整冻结的 change 目录
└── runtime/
    ├── locks/
    └── transactions/               # root move/archive 恢复日志与 staged tree
```

所有 Native 文件都位于解析后的 `comet/` 树中。运行态使用可见的 `runtime/` 子目录，不创建嵌套 `.comet/`。

### 7.2 三层事实

Native change 管理有三个层次：

1. `comet/specs/`：当前已接受的长期产品行为。
2. `comet/changes/<name>/`：正在提议和实现的 change。
3. `comet/archive/`：已完成 change 的不可变历史快照。

`brief.md` 是当前 change 的目标与边界事实源；`changes/<name>/specs/` 是对长期能力规格的拟议结果；`comet/specs/` 只在 archive 成功后更新。

### 7.3 Spec 表达方式

Native 不复制 OpenSpec 的 delta heading 协议。强模型直接生成目标 capability 的完整“归档后版本”：

- `create`：创建新的 capability spec。
- `replace`：用 change 中的完整 spec 替换当前 capability spec。
- `remove`：删除当前 capability spec。

每个操作记录在 `change.yaml`：

```yaml
spec_changes:
  - capability: authentication
    operation: replace
    source: specs/authentication/spec.md
    base_hash: 8b4d...
```

规则：

- `create` 要求 canonical spec 不存在，`base_hash` 为 `null`。
- `replace` 要求 canonical spec 存在，且 archive 时 hash 与 `base_hash` 一致。
- `remove` 要求 canonical spec 存在，记录 `base_hash`，不需要 `source`。
- `source` 必须留在当前 change 目录内。
- capability ID 必须是字母开头的 lowercase kebab-case 单段名称。
- 一个 change 对同一 capability 只能声明一个最终操作。
- 不改变长期产品行为的任务可以使用空 `spec_changes`，只归档 brief 与验证证据。

完整目标 spec 比文本 delta 更适合强模型：模型可以直接理解归档后的最终行为，Comet runtime 只需确定性验证 base hash，并通过日志化事务交换文件，不承担语义合并。

### 7.4 Change 命令能力

Native 第一版提供 Comet 自有命令：

```text
comet native init [--root <artifact-root>]
comet native root show
comet native root move <artifact-root>
comet native new <change-name>
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list
comet native show <change-name>
comet native status [<change-name>]
comet native select <change-name>
comet native next <change-name>
comet native archive <change-name>
comet native doctor [<change-name>]
```

能力要求：

- 支持多个 active change。
- change name 使用字母开头的 lowercase kebab-case。
- `list` 只扫描配置指定的 Native root。
- `show/status/next/archive` 必须解析明确 change，不借用 Classic active change。
- `select` 只影响 Native 当前选择，不写 Classic selection。
- archive 目录使用日期前缀，输入 change name 仍保持无日期形式。
- archive 后原 active 目录不再存在。

`root move` 必须持有 Native root 全局锁，先把完整 `comet/` 树复制到目标根的临时目录并验证，再使用事务日志切换 `comet.config.yaml`。迁移阶段同时写入 `comet.config.yaml` 的 `native.pending_root_move`，确保即使旧 root 已移动，doctor 仍能从项目根发现恢复信息。失败或进程中断时，doctor 根据配置中的 pending 状态和两端事务日志恢复到唯一有效 root；不得留下两个都可写的 Native root。

### 7.5 并发 change 冲突

两个 active change 可以引用同一 canonical capability spec。runtime 在首次协调 proposed spec 时为它们分别冻结 `base_hash`。

先归档的 change 更新 canonical spec 后，后归档 change 的 base hash 会失效。archive 守卫必须阻塞并输出：

- 发生冲突的 capability。
- 预期 hash 与实际 hash。
- 当前 canonical spec 路径。
- 需要模型重新读取并重写目标完整 spec 的恢复动作。

重读最新 canonical spec 并更新完整目标 spec 后，模型运行 `spec rebase`。runtime 在锁内刷新 operation/base hash，通过 transition journal 把 change 受控重开到 Build，并清除旧 verification 结论。Comet 不自动三方语义合并，也不静默覆盖。

## 8. Native 状态

### 8.1 `change.yaml`

```yaml
schema: comet.native.v1
name: add-example-capability
language: zh-CN
phase: shape
brief: brief.md
approval: null
spec_changes: []
verification_result: pending
verification_report: null
archived: false
created_at: 2026-07-14
run_id: null
```

字段约束：

- `phase`: `shape | build | verify | archive`
- `approval`: `null | implicit | confirmed`
- `spec_changes`: runtime 根据完整目标规格和显式 remove 命令维护的 create/replace/remove 操作与 base hash
- `verification_result`: `pending | pass | fail`
- `verification_report`: change 内相对路径或 `null`
- `run_id`: 链接 `runtime/run-state.json`

Native 不持久化 `build_mode`、`tdd_mode`、`review_mode`、`isolation`、`direct_override` 或任何 Classic 字段。实现偏好属于当前模型执行上下文，不是 change 长期状态。

### 8.2 `brief.md`

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

- Outcome、Scope、Non-goals、Acceptance examples 必须存在且非空。
- Open questions 可以为空，但存在 blocking 项时不能离开 Shape。
- Decisions 只记录结论、理由和影响，不保存内部思维链。
- 实施发现改变用户行为、范围或长期 spec 时，必须先更新 brief/spec，再继续实现。

### 8.3 `verification.md`

验证报告至少包含：

- 验收场景与对应证据。
- 实际执行的命令和结果。
- 未执行检查及理由。
- spec 与实现一致性结论。
- 已知限制和剩余风险。
- 最终结论。

## 9. Native 生命周期

```text
shape ──shape-complete──> build ──build-complete──> verify
                             ▲                         │
                             └──────verify-fail────────┘
                                                       │
                         archive <────verify-pass──────┘
                            │
                     archive-complete
                            │
                         archived
```

Native 状态机没有 Classic transition，也没有 upgrade/downgrade event。

### 9.1 Shape

1. 创建或恢复 Native change。
2. 读取 canonical specs、仓库代码、文档和测试。
3. 沿决策前沿澄清目标、范围和验收条件。
4. 创建或更新 brief。
5. 为受影响 capability 生成完整目标 spec，由 runtime 推导 operation 并冻结 base hash。
6. 运行 Shape 守卫并请求推进。

用户请求已明确且没有重大新取舍时，Shape `next` 记录 `approval: implicit`。存在重大范围、产品行为或不可逆操作选择时，必须得到用户回答，并通过 `next --confirmed` 记录 `approval: confirmed`；模型不直接编辑 approval。

### 9.2 Build

Build 读取 brief、proposed specs、canonical specs、仓库规则和当前 Run state，由模型自主：

- 决定是否需要 plan。
- 设计代码结构与修改顺序。
- 使用宿主原生工具探索和修改仓库。
- 选择测试与审查强度。
- 在发现需求或 spec 漂移时更新 Native 产物。

只有跨 session 或多个依赖任务需要持久恢复时才创建 `plan.md`。短任务的完整计划不要求落盘，恢复所需当前步骤和 checkpoint 写入 `runtime/`。

若实现中发现新的高影响决定，模型把它记录为一个 `[blocking]` 问题并只询问最重要的一个。用户回答后，模型更新 Decisions、移除 blocking 项，并在离开 Build 时传入 `--confirmed`。Build 守卫会重新读取 brief 与 proposed specs，不能用已有产物绕过新发现的阻塞项。

### 9.3 Verify

Verify 从 brief 与 proposed specs 出发：

- 执行相关测试、build、typecheck、lint 或真实运行检查。
- 检查实现是否满足验收场景。
- 检查实现是否符合拟议长期 spec。
- 记录未执行检查与理由。
- 生成 verification report。

失败通过 `verify-fail` 返回 Build，并保留失败证据。

### 9.4 Archive

Archive 是 Native change management 的确定性收口：

1. 验证所有 `spec_changes` 的 base hash。
2. 在 `comet/runtime/transactions/<id>/` 构造 archive 后的完整 specs staged tree 和事务日志。
3. 验证 create/replace/remove 操作没有路径逃逸、重复 capability 或缺失 source。
4. 在持有 archive 锁的情况下按事务日志交换 canonical spec 文件；每次文件替换使用原子 rename，整个多文件事务允许 doctor 在崩溃后继续或回滚。
5. 冻结最终 brief、proposed specs、verification 和 runtime 摘要。
6. 将 active change 移动到 `comet/archive/YYYY-MM-DD-<name>/`。
7. 追加最终状态事件。

archive 不调用 OpenSpec，不写 `openspec/`，也不更新 Classic 状态。

## 10. 自包含 Skill 与 Prompt

### 10.1 依赖边界

Native Skill 只能依赖：

- Comet 自有 CLI/runtime/launcher/reference。
- 宿主 agent 原生的文件、shell、搜索、编辑和用户输入能力。
- 当前仓库已经提供的开发命令和测试工具。

Native Skill 不得：

- 调用任何外部 Skill。
- 因外部 Skill 缺失而停止。
- 要求安装 OpenSpec 或 Superpowers。
- 把外部 Skill 名称写入 state、guard 或完成证据。
- 用 `requiredSkillCalls` 组合出 Native 流程。

### 10.2 Native Prompt 契约

```text
先理解，再行动。

先检查当前 Native change、canonical specs、仓库实现、文档和测试。
能从环境得到的事实不要询问用户。

持续维护决策前沿。如果仍存在会显著改变范围、行为或风险的未知决策，
每次只提出其中最重要的一个，并给出推荐答案及影响。

当 Outcome、Scope、Non-goals、Acceptance、Constraints 和阻塞性未知项已经明确时，
更新 brief；影响长期产品行为时，同时更新 change 中的完整目标 spec。

实现方式由你自主决定。选择满足 brief 和 proposed specs 的最简单可靠方案。
测试用于提供行为证据，不是固定仪式。发现漂移时先更新 Native change 产物，
再判断是否需要用户决策。

每个阶段结束时提交可验证证据，并运行 comet native next <change-name>；用户刚确认高影响 Shape 或 Build 决策时追加 --confirmed。
不要直接修改 phase，不要跳过失败的守卫，不要调用任何外部 Skill。
```

### 10.3 测试策略

- 已发布 bug：必须先得到可重复失败证据；可自动化时增加回归测试。
- 状态机、公共 API、数据变换、安全边界：优先在最高稳定 seam 测试。
- 文档、格式、机械迁移、简单配置：不强制制造 Red 阶段。
- 没有合适自动化 seam 时：使用 build、typecheck、静态检查或真实运行证据并说明限制。
- Review 是模型根据风险选择的验证手段，不是独立 phase 或外部 Skill 调用。

## 11. 阶段守卫与自动推进

### 11.1 Shape 守卫

- `change.yaml` 与 `brief.md` 有效。
- brief 必需章节非空。
- 没有 blocking open question。
- `--confirmed` 只在用户已回答高影响决策时记录 confirmed approval；否则记录 implicit approval。
- 每个 spec change 的 operation、source 和 base hash 结构有效。

### 11.2 Build 守卫

- 当前 Run 没有未处理 blocker。
- brief 必需章节与 proposed specs 仍然完整，且没有 `[blocking]` 问题。
- 实现或明确的无代码结果存在。
- 实现范围与 brief/proposed specs 一致。
- 验证期望可执行；例外已有理由。
- 长任务存在 checkpoint；短任务不强制 plan。

### 11.3 Verify 守卫

- verification report 存在且结构有效。
- 每个验收场景都有证据或明确接受的例外。
- 必需命令成功。
- 没有未解决高风险问题。
- 实现与 proposed specs 一致。

### 11.4 Archive 守卫

- verify 已通过。
- brief、proposed specs 和 verification 引用有效。
- 所有 replace/remove base hash 与 canonical specs 一致。
- create 目标尚不存在。
- 归档目标不存在，active change 尚未归档。

### 11.5 单一推进入口

```bash
comet native next <change-name>
```

运行时负责：

1. 从 `comet.config.yaml` 解析 Native root。
2. 定位明确 Native change。
3. 运行当前 phase 守卫。
4. 应用 Native transition table。
5. 更新 Run state/checkpoint。
6. 追加 Native state event。
7. 返回 `NEXT: auto | manual | done` 与下一 Native 命令。

Prompt、Rule 和 Hook 不得硬编码下一 Skill，也不得返回 Classic 命令。

## 12. 组件架构

### 12.1 `domains/comet-native/`

负责：

- 项目配置与 artifact root 解析。
- Native root/path 安全校验。
- change/spec/archive 发现与存储。
- state schema 与 transition table。
- brief/spec/verification validator。
- spec base hash、日志化 apply/archive 和崩溃恢复。
- Native diagnostics、recovery 和 status projection。
- Native runtime package 与 launcher 源码。

该 domain 不 import `domains/comet-classic`，也不调用 OpenSpec CLI。

### 12.2 `domains/engine/`

继续提供 Comet 内部通用能力：

- Run state。
- trajectory、artifact refs 和 checkpoints。
- action guardrails。
- deterministic resolver loop。
- runtime eval。

Native 为 Engine 提供自己的 storage adapter，把 Engine 文件写到 change 的 `runtime/`，不复用 Classic 的 `<changeDir>/.comet/` store。

### 12.3 `domains/workflow-contract/`

增加独立内建 kind `comet-native`，节点为：

- shape
- build
- verify
- archive

Output Schema：

- `comet.native.brief.v1`
- `comet.native.spec-change.v1`
- `comet.native.implementation.v1`
- `comet.native.verify.v1`
- `comet.native.archive.v1`

Native 不是 `comet-five-phase-overlay` augmentation，不声明外部 required Skill call。

### 12.4 App 命令

Native 与 Classic 使用不同 domain API：

- `comet native ...` 只发现 Native。
- `comet classic ...` 或 Classic 兼容入口只发现 Classic。
- 第一版不提供混合 Native/Classic change 的统一状态视图；两套 status 分别工作。

### 12.5 Skill 与资产

新增 Comet 自有 Skill：

- `assets/skills-zh/comet-native/`
- 中文内容经用户确认后同步 `assets/skills/comet-native/`

Native references、launchers 和 runtime 均随 Comet 发布。Classic Skill 保持现有依赖和路径，不被 Native 修改。

## 13. 入口与默认选择

### 13.1 永久显式入口

- `/comet-native`：只启动或恢复 Native。
- `/comet-classic`：只启动或恢复 Classic。

### 13.2 `/comet` 别名

`/comet` 只是项目配置选择的别名：

```yaml
default_workflow: native
```

规则：

- 新项目执行新版 `comet init` 时创建 `comet.config.yaml` 并默认 `native`。
- 既有项目没有 `comet.config.yaml` 时，`/comet` 保留原 Classic 行为；用户显式运行 `comet native init` 后才写入 Native 默认配置。
- `/comet` 不根据任务复杂度、文件数量或模型输出自动切换工作流。
- Native active change 只由 Native 入口恢复；Classic active change 只由 Classic 入口恢复。
- 两套 active change 同时存在时，`/comet` 只遵循配置默认值，不跨模式猜测目标。

## 14. 错误处理与恢复

### 14.1 配置与路径错误

- `comet.config.yaml` 畸形时 fail closed。
- artifact root 逃逸、symlink 逃逸或权限不足时停止，不回退到其他目录。
- 配置 root 与显式 root 冲突时停止，不扫描猜测。
- 配置改变导致旧 root 存在时，doctor 报告冲突并要求显式迁移。

### 14.2 状态错误

change state、Run state 或事件日志畸形时 fail closed。doctor 输出字段、期望值、文件路径和安全恢复命令，不自动覆盖用户文件。

### 14.3 Brief/spec 漂移

- 兼容细化：更新 Decisions 或 Acceptance。
- 实现中发现新的用户可见行为决定：在当前 Build 写入 `[blocking]`，按决策前沿请求必要确认；冲突 rebase 也受控重开到 Build，不增加新 phase。
- 改变长期能力行为：更新完整 proposed spec 与 spec change metadata。
- change 扩大为多个独立目标：创建多个独立 Native change，由用户选择先执行哪个；不切换 Classic。

### 14.4 上下文恢复

恢复只读取：

1. `comet.config.yaml`
2. `change.yaml`
3. `brief.md`
4. change 的 proposed specs
5. `runtime/run-state.json` 与最近 checkpoint/events
6. 当前 diff 与验证失败证据

不依赖原始对话，也不读取 Classic/OpenSpec 产物补齐信息。

### 14.5 幂等与原子性

- 守卫失败不改变 phase。
- 重复成功 transition 不重复追加等价事件。
- state 与单个 spec 写入使用同目录临时文件 + 原子 rename。
- 普通 phase transition 先写 `runtime/transition.json`，再记录 `run_started` 并幂等更新 Run state、change state、trajectory 与 checkpoint；`next`、archive 和 doctor 可确定性续做。
- 所有 mutation 使用 Native root mutation lock 和 change lock；同时需要两者时固定按 root → change 获取，未完成事务阻塞新的 mutation。
- `status/doctor` 交叉检查 change state、Run state、trajectory 与 checkpoint；只有不存在 pending 事务时才能清理可证明陈旧的锁。
- root move 和 archive 使用全局锁、staged tree 与 append-only 事务日志；它们是可恢复事务，不宣称整个多文件操作具有单次文件系统原子性。
- archive 任一步失败时，doctor 必须能根据事务日志继续或回滚到一个一致状态；不得同时开放旧、新两套 canonical specs 写入。

## 15. Eval 与成功指标

Native 与 Classic 可以在相同任务集上对比，但 eval 只比较结果，不建立转换关系。

### 15.1 任务矩阵

- 明确的小功能。
- 模糊但单一 capability 的功能。
- 已发布 bug。
- 机械重构。
- 状态机或 schema 变更。
- 两个 Native change 修改同一 capability spec。
- 自定义 artifact root。
- 上下文压缩后恢复。
- verify-fail repair loop。
- archive 中的 base-hash 冲突。
- 冲突后的 spec rebase 与重新验证。
- Build 中新发现高影响决定后的单问题确认。
- 仓库可调查事实不向用户提问。
- 普通 transition 中断后的幂等恢复。
- 外部 Skill 完全不可用的环境。

### 15.2 指标

- 最终任务完成率。
- 验收场景满足率。
- brief/spec 漂移率。
- 首次写代码前 token 与耗时。
- 用户需要回答的问题数量。
- 用户纠正与返工次数。
- 全流程 token、耗时和工具调用数。
- 恢复成功率。
- 阶段守卫误阻塞和漏阻塞率。
- canonical spec 冲突检测率。
- 自定义 artifact root 发现正确率。
- 无外部 Skill 环境的端到端完成率。

## 16. 交付阶段

本文定义完整 Native 产品方向。首个实施计划只覆盖 Phase 1；后续默认入口调整必须在 Phase 1 eval 通过后单独规划。

### Phase 1：独立 Native 系统

- `comet.config.yaml` 与 artifact root。
- root show/move 的锁、pending 配置与崩溃恢复。
- `comet/` specs/changes/archive 布局。
- Native state、brief、完整目标 spec、verification、transition 和 guards。
- Comet 自有 Native CLI/runtime/Skill。
- `comet native` status/doctor/recovery。
- spec base hash、日志化 archive 和崩溃恢复。
- 自定义 root、并发冲突、恢复和无外部 Skill eval。
- Classic 完全不变。

### Phase 2：入口产品化

- 永久 `/comet-native` 与 `/comet-classic` 入口。
- `/comet` 根据 `default_workflow` 映射。
- 新项目默认 Native；既有项目保持兼容默认。
- Native/Classic 分区状态展示。
- 文档分别描述强模型 Native 与强引导 Classic。

## 17. 已确定的关键决策

1. Native 固定使用 `comet` 目录，不使用 `.comet`。
2. 用户可以通过项目根 `comet.config.yaml` 指定 artifact root，例如 `docs/comet/`。
3. Native 与 Classic 是两套独立概念，不互相升级、降级、迁移或自动切换。
4. Native 面向强模型，Classic 面向需要详细流程引导的模型与团队。
5. Native 不依赖 OpenSpec、Superpowers、`grill-me` 或任何外部 Skill。
6. Native 自己维护 `specs/changes/archive`，提供多 active change、状态、选择、恢复和归档能力。
7. Native proposed spec 使用完整目标版本，不使用 OpenSpec delta heading。
8. archive 通过 create/replace/remove、base hash 与日志化可恢复事务更新 canonical specs。
9. Native 使用 `shape → build → verify → archive` 四阶段。
10. brief 是 change 目标事实源；canonical specs 是已接受产品行为事实源。
11. TDD、planning 和 review 是模型可自主选择的方法，不是外部 Skill 依赖或状态字段。
12. 守卫验证产物、证据、hash 和状态，不验证执行仪式。
13. 自动推进只返回 Native 命令，不感知 Classic transition。
14. Native Engine 文件写在 change 的 `runtime/`，不复用 Classic `.comet/` store。
15. `/comet` 只按项目配置映射默认工作流，不根据任务动态路由。

## 18. 设计依据

- 项目本地 `grilling` Prompt：用决策树、单问题、事实/决策边界和确认终止条件约束交互，而不枚举完整执行流程。
- Anthropic《Building effective agents》：从简单、可组合模式开始，只在结果证明有价值时增加复杂度。
- OpenAI《Harness engineering》：使用短入口与渐进披露，让机械约束保护架构边界，同时给模型实现自主权。
- OpenAI Symphony：用任务与状态机作为 agent 控制面，将执行 session 与持久工作解耦。
- METR Time Horizons：强模型在清晰、自包含、可评分任务上的能力持续提升，但真实模糊任务仍依赖高质量上下文和成功条件。

## 19. 已确认的后续演进原则

### 19.1 加强 Shape 的隐藏决策发现

Native 已复用 `grilling` 的单问题、推荐答案、事实与决策分离、按依赖顺序解决等核心机制，但当前更擅长处理已经暴露的歧义，尚不能证明模型会主动发现所有会改变用户可见结果的隐藏决定。

后续增强必须继续保持 Native 自包含和轻量：

- 保留一个公开 `/comet-native` Skill，不调用或包装 `grill-me`、`grilling` 或其他外部 Skill。
- 在认为“决策前沿为空”之前，主动检查目标行为的主要分支、默认值、边界、失败路径、兼容性与不可逆操作。
- 每个会改变用户可见结果的分支，都必须能从仓库事实、用户已给信息、明确非目标或已确认决定中得到唯一答案；否则标记为 `[blocking]`，一次只询问最高价值问题，并提供推荐答案与实际影响。
- brief 各章节已有文字不等于需求已经清楚。Shape 的完成标准是：另一个没有当前对话上下文的强模型，只读取 brief、完整目标规格和仓库事实，就能在不猜测用户可见行为的情况下实现和验收。
- 明确任务仍允许 `approval: implicit`；不能为了模拟“充分澄清”而增加通用确认题、固定问卷或低价值追问。

对应 eval 必须同时覆盖：必须询问的隐藏产品决定、具有依赖关系的连续决定、可从仓库调查而不应询问的事实，以及实现方式不同但用户可见行为唯一的无须询问场景。成功指标包括关键决策召回率、不必要提问率、提前实现率、决策顺序正确率和冷启动 brief/spec 可执行性。

### 19.2 长跑能力不是新的流程清单

后续审视得到的行为、实现和评估候选可以展开为数十个检查点，但它们不是数十个用户功能，也不能成为新的阶段、模式或强制产物。长期设计采用三层表达：

1. 用户只感知少量稳定结果，例如问题问得准确、恢复后能够继续、验证没有过期、并发变化不会被覆盖。
2. Runtime 使用少量内部 capability 支撑这些结果；内部 hash、revision、manifest、checkpoint 和冲突分类不要求用户理解或手写。
3. Eval 保留更细的行为矩阵，用来证伪每个 capability 是否真的改善强模型，而不是把测试矩阵暴露成工作流。

以下是目标用户结果，不代表当前版本均已交付。每项只有在对应波次通过专项 eval 后，才能进入 Website 的“当前能力”描述。Native 始终约束需求、证据和恢复，不规定计划、TDD、调试或审查方法。

目标用户结果收敛为以下十项：

1. 主动发现会改变最终结果的隐藏决定，只询问真正属于用户的选择。
2. 先调查代码、规则和测试，不把可查事实或纯实现选择抛给用户。
3. 只有出现用户决定时暂停；其余阶段返回明确 continuation，支持该契约的宿主连续推进，其他宿主下次调用时从同一状态继续。
4. 即使更换会话，也能恢复唯一或已经选择的 change，并一次看到 Runtime 已知的全部阻塞项和下一步；存在多个合理候选时只询问一次选择。
5. 验证只对当时明确覆盖的需求和实现范围有效；scope 内相关内容变化后旧结论失效，覆盖无法证明完整时明确标记 partial。
6. 完成前能够追溯每项结构化验收场景的证据、跳过原因和剩余风险。
7. 验证失败后继续修复；重复同类失败且没有有效进展时停止并说明原因。
8. 归档前预览长期规格将新增、替换或删除什么，以及冲突和恢复方案。
9. 同一 Native root 的并行写入不会静默覆盖，当前 root 可见的 change 重叠会在归档前暴露；不同 worktree 只有在 change/spec 被带入同一物理 Native root 或集成分支后才能比较。
10. 无论通过 CLI 还是 Dashboard，看到的阶段、证据和下一步保持一致。

### 19.3 四类稳定职责

后续能力优先加深现有职责面。命令数量不是目标；语义单一比机械地维持“四个命令”更重要：

| 职责面                                             | 长期责任                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skill：`/comet-native`                             | 决策前沿、仓库调查、单问题澄清、冷启动可执行性判断，以及无阻塞时的持续推进。                                                                                                                                                                                                                                 |
| Inspection：`comet native status [change]`         | 紧凑恢复投影、证据新鲜度、workspace 提示、跨 change 重叠、Archive 预演摘要和精确下一动作。默认只返回当前 revision 已计算的 findings 摘要；检测到 revision/snapshot 不匹配时返回 `inspection: stale` 和 details 引用，不把旧结果展示为当前事实。完整 findings、manifest、diff 与冲突详情由显式 details 重算。 |
| Progress/Evidence：`next` 与候选 agent-facing seam | `next` 只执行 phase transition。同阶段进度写入和可信命令 receipt 若进入实施，必须使用语义独立的 seam；`checkpoint`、`check` 只是当前候选名称，公开 CLI 语法尚未确认。                                                                                                                                        |
| Recovery/Finalize：`doctor`、`archive`             | 统一诊断、安全恢复建议、canonical preflight、冲突检查和事务收口。只有异常恢复时才暴露事务内部阶段。                                                                                                                                                                                                          |

所有职责面调用同一个只读 inspection/preflight 模块：status 只投影 findings，doctor 在同一 finding 上附加 repair，archive 在锁内重新运行同一 preflight。接口不得各自实现一套检查逻辑。Dashboard 只是这些投影的只读 adapter，不得写 Native 状态、缓存出一套独立 phase 或反向决定 Runtime schema。

### 19.4 路线能力与依赖

下表中的 capability 是路线能力，不等同于单个代码模块。实现时应拆成小型内部模块，再由 19.3 的少量职责面统一投影，不能形成巨型 Runtime 文件。

| 顺序 | Capability                        | 责任                                                                                                                                                                                                                        | 依赖              |
| ---: | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
|    1 | `runtime-schema-safety`           | 为 change、transition、transaction、checkpoint 和后续字段定义版本兼容、确定性迁移、敏感信息排除、输出预算与保留策略。                                                                                                       | 无                |
|    2 | `content-snapshot-manifest`       | 以规范化项目相对路径和内容 hash 形成 VCS 无关快照；Git revision 只是可选补充。                                                                                                                                              | 1                 |
|    3 | `runtime-revision-cas`            | 为状态、checkpoint、证据、rebase 和 archive 操作提供统一 revision/CAS，并复用现有 mutation lock 与事务协议。                                                                                                                | 1                 |
|    4 | `shape-decision-frontier`         | 落实 19.1 的隐藏决策发现；语义判断留在 Skill，Runtime 只保存显式事实并阻塞 `[blocking]`。                                                                                                                                   | 无 Runtime 依赖   |
|    5 | `structured-diagnostics-recovery` | 统一 finding code、路径、严重度、所需动作、可重试命令与安全恢复建议；只读投影依赖 schema，repair mutation 才依赖 CAS。                                                                                                      | 1；repair 依赖 3  |
|    6 | `same-skill-continuation`         | 返回机器可读 continuation、当前 phase、下一动作、所需输入和是否需要用户决定；支持该契约的宿主可自动续跑，其他宿主由 Skill 根据同一结果继续。                                                                                | 1、finding schema |
|    7 | `in-phase-checkpoint`             | 通过语义独立的 checkpoint 写入，在不改变 phase 的情况下保存摘要、下一动作和产物快照。                                                                                                                                       | 2、3              |
|    8 | `compact-resume-view`             | 合并恢复包、增量视图和按变化读取；默认有确定性输出上限，详细内容按引用渐进披露。                                                                                                                                            | 5、7              |
|    9 | `verification-evidence-envelope`  | 绑定 contract、implementation snapshot、report hash 和可选真实命令 receipt，并标记 freshness 为 complete、partial 或 stale。Receipt 前后只比较 contract + implementation hash，最终 envelope 再绑定 report + receipt hash。 | 2、3、5           |
|   10 | `acceptance-evidence-trace`       | 只追踪 Acceptance examples 中的列表项或明确 Scenario；用规范化文本 hash 派生与顺序无关的 ID，在 verification report 的固定结构化块中映射证据或跳过原因。                                                                    | 4、9              |
|   11 | `repair-stagnation-control`       | 以规范化失败类别、失败测试 ID、contract hash 和 artifact snapshot 形成签名；重复先告警，达到阈值才手动停止。                                                                                                                | 7、9              |
|   12 | `spec-archive-preview`            | 使用同一差异引擎提供 diff、rebase preview 和 archive dry-run；preflight hash 绑定 revision、canonical base、proposed spec 与 evidence envelope，Archive 通过 `--expect-preflight <hash>` 在锁内重算并拒绝漂移。             | 2、3、9           |
|   13 | `workspace-identity-advisory`     | 可选记录 VCS、base revision、branch、worktree 或宿主 session 身份；只告警漂移，不自动创建、切换或调度工作区。                                                                                                               | 2、7              |
|   14 | `multi-change-conflict-radar`     | 提前比较 capability、operation、base hash 和已声明产物，区分确定冲突、可能重叠与互不相交；workspace identity 只是可选补充。                                                                                                 | 2、3、9；13 可选  |

`native-eval-matrix` 是横切验证计划，不是 Runtime capability。它必须验证 1–14，并维护共同业务、持久工作价值和模式契约三层指标。

无进展控制首次命中只告警；达到明确阈值后返回 manual stop。模型可以提交带摘要的显式 override 再尝试一次，但不能绕过 Runtime 总 iteration 上限。

Schema 演进遵守以下规则：只有旧 Runtime 可安全忽略的可选字段才能留在原 schema；新增不变量或必填字段必须升级 schema，并通过 journal 化迁移完成。旧 Runtime 遇到更高 schema 必须 fail closed；状态同时记录最低兼容 Runtime 版本，防止旧 launcher 写坏新状态。status/show 对旧 schema 只报告 `migration_required`；迁移只能由 `doctor --repair` 在独立 migration journal 与 mutation lock 下执行。迁移完成前，transition、checkpoint、check、rebase 和 archive 全部 fail closed。

Verification scope 固定由以下事实组成：brief、proposed specs 与 verification report 分别进入 contract/evidence hash；implementation snapshot 包含所有声明 artifact，以及相对 change 创建时工作树基线 manifest 新增或变化、且可由 VCS adapter 发现的项目文件。Native root 必须排除在 implementation snapshot 外。无法归属给当前 change 的变化标记为 `unattributed`，不能自动算作覆盖范围。没有 VCS adapter 时，模型必须声明完整 artifact 集；Runtime 无法证明覆盖完整时只能给出 `freshness: partial`，不能宣称整个实现已封印。

Partial verification 默认禁止 Archive。Verify 发现只能达到 partial 时先返回 Build，并把需要用户接受的具体 scope 标为 blocking。用户确认后，模型在离开 Build 时通过结构化 `next --allow-partial <scope> --confirmed` 记录 scope、理由和确认摘要；Verify 与 Archive 只消费这份 allowance，不接收新的 `--confirmed`。Runtime 不从自由 Markdown 的 Verification expectations 推断授权，也不得把 partial 静默升级为 complete。

Acceptance evidence 写在 `verification.md` 的单个固定、机器可解析块中，字段只包含 Runtime 派生的 `acceptance_id`、evidence refs 和可选 `skipped_reason`。模型维护映射内容，但不要求用户生成 ID；Runtime 负责校验完整性并投影到 status，不新增 coverage 命令。

`runtime-schema-safety` 必须遵守以下安全底线：

- 排除任意深度的 `.env*`、`.git`、Native runtime/transaction 目录、依赖缓存和配置 denylist；不保存 API key、token、完整环境变量或疑似密钥内容。
- Manifest 不跟随 symlink/junction，只读取项目内普通文件；读取前后校验 realpath/stat，先执行文件大小上限，只保存项目相对路径、hash、大小和类型，不保存文件内容或绝对路径。
- resume、manifest、receipt 和历史输出都有确定性的文件数、字节数和事件数上限；截断后保留引用和 hash，而不是静默丢失。
- 保留策略只能清理未引用 staged 文件和过期派生快照；活跃 Run 不删除 checkpoint 引用的事件，历史压缩写入带前序 hash 的 compaction 事件，已归档核心证据默认不可变。
- 可选 `check` receipt 只在宿主已经授权对应命令后执行，使用项目内 cwd、结构化 argv、平台可执行解析 adapter、`spawn(..., { shell: false })`、默认最小环境、超时与取消、stdout/stderr 上限和脱敏。Windows 不拼接 `cmd /c` 字符串；无法安全解析时明确降级为“命令未记录”，不偷偷回退到 shell。Receipt 记录执行前后的 contract hash 与 implementation snapshot hash、signal/exit code；report、receipt 和其他 Native evidence 文件不参与这次前后比较。两组 hash 变化时 receipt 直接 stale。第一版只为不修改受验证文件的只读检查生成 fresh receipt。
- Session/worktree 身份只保存在本地 runtime metadata；session ID 默认 hash 化，路径使用项目相对表示，不写入 canonical spec、公开交付引用或 Dashboard 导出。

### 19.5 演进波次

后续不采用“Runtime 全做完再补 Skill/eval”或“先做 Dashboard”的横向建设方式。每个波次都以一个可证伪的用户结果为中心，同时交付 Skill、Runtime、测试、eval、文档和演进记录。

真实假设、实现偏差、评估限制和被否决方向持续追加到 [Comet Native 演进记录](2026-07-16-comet-native-evolution-record.md)，不把开发过程塞入 Changelog。

#### 波次 A：基础安全与指标可信

- `runtime-schema-safety`、`content-snapshot-manifest`、`runtime-revision-cas`。
- 修正 Native validator 被错误归入 business completion 的指标分层，并让通用 harness 累加样本内全部顶层 result duration，而不是只保留最后一次调用。
- 建立当前 Native 与增强版的同模型、同任务、同窗口配对方法。

#### 波次 B：判断与续跑

- `shape-decision-frontier`、`structured-diagnostics-recovery`、`same-skill-continuation`、`in-phase-checkpoint`、`compact-resume-view`。
- 先证明模型会发现未被提示的真实产品决定，同时不会询问仓库事实或制造确认题。
- 先分别证明 Runtime 会发出正确 continuation，以及支持该契约的宿主会实际续跑；清空上下文后只给“继续”，新会话仍能恢复唯一或已有有效 selection 的 change 并 exactly-once 推进。多个合理候选场景单独验证一次性选择。

#### 波次 C：可信证据与安全归档

- `verification-evidence-envelope`、`acceptance-evidence-trace`、`spec-archive-preview`。
- 先证明 Verify 后修改已覆盖的实现范围或验收契约会使旧证据失效；覆盖范围无法证明完整时必须显示 partial。
- 先证明 Archive 预演会返回 preflight hash；`archive --expect-preflight <hash>` 在锁内重算，落盘前任何相关事实变化都会使 Archive 拒绝，而未变化时预演与最终 canonical 结果一致。

#### 波次 D：自主修复与长程效率

- `repair-stagnation-control`，并深化 checkpoint、增量恢复和失败历史。
- 证明确定性隐藏回归能够形成 `Verify fail → Build → Verify pass`，且不会删除或弱化测试。
- 证明不可解决或重复失败时能够停止，不伪造 pass、不归档。
- 在大 fixture 上以不降低 strict pass 和证据覆盖为前提，再衡量文件读取量、输入 token 和恢复成本。

#### 波次 E：并行安全

- `workspace-identity-advisory`、`multi-change-conflict-radar`。
- 证明同一物理 Native root 内相同 revision 的竞争写入只能有一个 CAS 成功。不同 worktree 只记录身份与基线；只有 change/spec 被带入同一物理 Native root 或同一集成分支后才能比较，不承诺跨 worktree 分布式锁定。
- 证明同一 Native root 内可见 change 的共享 capability 或产物在 Archive 之前就能暴露重叠。Archive 只能检查当前 worktree 可见的 canonical 与记录基线，不能发现尚未集成的其他 worktree。

#### 波次 F：团队展示

- 在 CLI/JSON 投影稳定后增加只读 Native Dashboard。
- Dashboard 与按需 handoff 视图复用 `status` snapshot，只展示目标、phase、证据、新鲜度、冲突和下一步。
- commit、PR 或外部工单只能作为可选交付引用，不成为新阶段或外部服务依赖。

### 19.6 Eval 的证伪顺序

每个候选能力先用三次配对运行快速淘汰无效设计；安全类要求 `3/3`，效率类要求业务和证据零回退且至少 `2/3` 样本改善。三次运行只用于早期证伪，不作为发布级统计结论。

优先顺序为：

1. 隐藏决策前沿与清空上下文续跑。
2. stale verification 与验收证据覆盖。
3. Verify 失败修复与无进展停止。
4. delta context、spec diff 与 rebase 恢复。
5. 同一 Native root 的 CAS 竞争、跨 worktree 基线漂移与变更归属。
6. 多角色 handoff 和只读 Dashboard 新鲜度。

正式比较使用同窗口三臂：裸强模型 Control、Native、Classic。三组共享完全相同的业务 validator；持久交接与恢复价值单独衡量；Native 与 Classic 的模式契约分别报告，不能比较检查数量。效率使用每次 strict success 的 token、时间、成本和工具调用，不单独用 `pass@3`、原始耗时、文件数量、Skill invocation、检查通过比例或单个 LLM Judge 分数下结论。

### 19.7 明确删除或降级的候选

- 不要求用户维护 acceptance ID、coverage matrix、manifest、checkpoint、handoff 或依赖图；能派生的全部由 Runtime 派生。
- 不增加 claim、owner、lease、heartbeat、archive queue、Sprint、RBAC 或调度器。
- 不为 context、resume、overlap、handoff 等内部机制逐一增加命令。同阶段 checkpoint 与可选命令 receipt 若进入实施，必须使用区别于 `next` 的 agent-facing seam；候选命令名和公开程度在实施设计中决定，不构成新阶段。
- 不让 Runtime 评价需求语义、生成产品决定、自动接受冲突或进行语义合并。
- 不自动采集所有 shell 活动；命令 receipt 是显式、可选和安全受限的证据 seam。
- 不把 Verify fail → Build 包装成新的 Debug 阶段；只增强证据、恢复和停止条件。
- 不让 Dashboard 写状态、执行修复或持有缓存事实源。
- 不做 Native/Classic 升级、转换、基于任务复杂度的动态路由或混合 change。

### 19.8 每个波次的完成定义

一个波次只有同时满足以下条件才算完成：

1. 中文 Skill 行为先完成并经用户确认，再同步英文 Skill。
2. Runtime 只增加机械事实和安全边界，不规定模型的计划、TDD、调试或 review 方法。
3. 公开 CLI/JSON 契约、生成 runtime、单元测试和架构边界同步。
4. 至少一个能够证伪核心假设的 Native 专项 eval 已运行，不以任务文件存在代替模型行为证据。
5. 对照结果、失败、修正和最终判断写入 Native 演进记录。
6. Website 只提炼稳定后的用户可见结果；开发分支中的修补、命名往返和普通测试不进入 Changelog。
