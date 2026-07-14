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
- 不提供 Native 与 Classic 之间的迁移、升级、降级或自动路由。
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

两个 active change 可以引用同一 canonical capability spec。它们各自记录创建时的 `base_hash`。

先归档的 change 更新 canonical spec 后，后归档 change 的 base hash 会失效。archive 守卫必须阻塞并输出：

- 发生冲突的 capability。
- 预期 hash 与实际 hash。
- 当前 canonical spec 路径。
- 需要模型重新读取并重写目标完整 spec 的恢复动作。

Comet 不自动三方语义合并，也不静默覆盖。

## 8. Native 状态

### 8.1 `change.yaml`

```yaml
schema: comet.native.v1
name: add-example-capability
language: zh-CN
phase: shape
brief: brief.md
approval: null
confirmation_required: false
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
- `confirmation_required`: 重大取舍或不可逆行为是否需要明确确认
- `spec_changes`: create/replace/remove 操作与 base hash
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
5. 为受影响 capability 生成完整目标 spec，并记录 base hash。
6. 运行 Shape 守卫并请求推进。

用户请求已明确且没有重大新取舍时，`approval: implicit`。存在重大范围、产品行为或不可逆操作选择时，必须得到用户回答并记录 `approval: confirmed`。

### 9.2 Build

Build 读取 brief、proposed specs、canonical specs、仓库规则和当前 Run state，由模型自主：

- 决定是否需要 plan。
- 设计代码结构与修改顺序。
- 使用宿主原生工具探索和修改仓库。
- 选择测试与审查强度。
- 在发现需求或 spec 漂移时更新 Native 产物。

只有跨 session 或多个依赖任务需要持久恢复时才创建 `plan.md`。短任务的完整计划不要求落盘，恢复所需当前步骤和 checkpoint 写入 `runtime/`。

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

每个阶段结束时提交可验证证据，并运行 comet native next <change-name>。
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
- `confirmation_required: true` 时 approval 为 `confirmed`。
- 每个 spec change 的 operation、source 和 base hash 结构有效。

### 11.2 Build 守卫

- 当前 Run 没有未处理 blocker。
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
- 改变用户可见行为：回到 Shape 并按决策前沿请求必要确认。
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
