---
name: comet-build
description: 'Comet Classic 阶段 3 —— 恢复或创建实施计划并执行其任务。'
---

# Comet 阶段 3：计划与构建（Build）

开始或恢复前必须先读取并执行 `comet-classic/reference/classic-layout.md`；本文件中的 OpenSpec CLI 调用必须使用 adapter，文件路径必须使用该协议绑定的 `<classic-*>` 逻辑根。

## 前置条件

- Design Doc 已创建（阶段 2 完成）
- 活跃 change 存在

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet-classic/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <name> build --json
```

验证通过后使用 `data.configuration` 中的语言、执行与审查配置继续 Step 1，不逐字段重复调用 `get`。写入配置或推进阶段后重新读取；验证失败时处理具体失败原因。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

**恢复**：以入口 phase、任务 ID 和 plan 的 `base-ref` 核对现有实现与审查记录，从尚未完成的执行或审查步骤继续。未勾选不等于未实现；先核对检查点再派发，不重复已有提交，也不假定外部操作可安全重复。

### 1. 制定计划

先运行 `comet state tasks <name> --json`，以 `tasks.md` 为完成状态权威。新任务缺少 ID 时运行 `comet state tasks <name> --assign-ids --json`，保留现有 ID，并刷新受影响的 handoff；旧计划仍有复选框时先核对其实现与验收，再明确迁移，不静默丢弃未完成项。

使用 `writing-plans` Skill 创建实施计划。计划使用入口 configuration.language 的产物语言，保存至固定路径 `docs/superpowers/plans/<YYYY-MM-DD>-<change-name>.md`。

调用 Skill 时提供以下输入：

1. 产物语言：入口 configuration.language
2. Design Doc：已记录 design_doc 路径指向的正式设计文档
3. `<classic-change-dir>/tasks.md`（任务边界）
4. 固定计划路径和 `git rev-parse HEAD` 的结果

只使用 `writing-plans` 的计划编写与自检流程；计划完成后返回 Comet Build，由 Comet 统一处理后续执行配置。若 Skill 加载或计划生成失败，停止 Build 并报告原因。

**Comet 调用契约**：将以下要求一并传入 `writing-plans`，覆盖其通用的细粒度步骤和完整代码模板：每个任务以一个独立可验收结果为单位，列明文件范围、依赖、约束和验收命令/场景；相关准备、实现、测试和文档归为同一任务。不得按分钟数、文件数或 RED/GREEN 步骤机械拆任务。默认不预写完整实现和测试代码；只有必须预审的接口、算法或高风险逻辑才提供必要代码片段。计划引用已确认设计，不重复需求正文。

恢复时先核对已有计划、任务完成证据和已确认配置；有效计划不重新生成，已确认的工作方式不重新询问。未勾选但已有匹配提交的任务先核对审查和验收，再补齐进度，不重做实现。

计划要求：

- 保存至指令中给定的计划路径，不更改文件名
- 只覆盖 tasks.md 列出的任务，不扩展范围
- 引用设计文档，拆分为可执行任务
- 新计划只说明实现顺序、依赖和方法，不复制任务完成状态。写入 `<!-- comet-task-authority: <classic-change-dir>/tasks.md -->`，并用 `<!-- comet-task-ref:<task-id> -->` 覆盖每个任务；不再创建第二套复选框。需求、设计正文通过引用保留单一来源。
- **Plan 文件头必须包含关联元数据**：

```yaml
---
change: <openspec-change-name>
design-doc: <recorded-design-doc-path>
base-ref: <git rev-parse HEAD before implementation>
---
```

`base-ref` 用于验证阶段跨提交统计改动规模。创建计划时先记录当前提交：

```bash
git rev-parse HEAD
```

计划写入后确认该路径存在，再运行 Step 2 的 `comet state set <name> plan ...` 记录计划路径。

### 2. 记录计划并联合确认工作方式

先记录 plan 路径：

```bash
comet state set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

无需手动更新 phase，阶段守卫（guard `--apply`）会在退出条件满足后推进 `phase` 字段。

展示联合决策时，只提供本工作流支持的执行方式、TDD 模式和代码审查模式。工作区已经在 Open 阶段准备并绑定；若当前 change 没有有效 isolation，返回 `/comet-open` 修复，不在 Build 创建或切换工作区。

计划写入后只提供**一个联合决策点**，一次收集：是否现在继续、执行方式、TDD 模式和代码审查模式。不得先询问“继续/暂停”，继续后又创建第二个配置阻塞点。

| 选项 | 行为               | 说明                                                                                                           |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| A    | 继续执行并提交配置 | 在同一次回复中选择 Step 3 的执行、TDD 和审查配置                                                               |
| B    | 暂停切换模型       | 记录 `build_pause: plan-ready`，本次 `/comet-build` 停止，用户稍后可从 `/comet-classic` 或 `/comet-build` 恢复 |

这是用户决策点。**必须按 `comet-classic/reference/decision-point.md` 的协议一次性展示计划摘要、暂停选项和 Step 3 全部可执行配置**。不得自动选择，也不得把暂停写入 `build_mode`。

用户选择继续并给出完整配置时，在 Step 3 一次提交全部相关字段，同时清除暂停，不先写半套配置。

用户选择暂停时：

```bash
comet state set <name> build_pause plan-ready
```

设置 `build_pause: plan-ready` 后，当前调用停止。不要选择 `isolation` 或 `build_mode`，不要加载执行技能。

### 3. 应用已确认的工作方式

如果恢复时检测到 `build_pause: plan-ready` 且 `plan` 文件存在，不重新运行 `writing-plans`。重新发起 Step 2 的同一个联合决策；只有完整配置确认后才原子提交并清除暂停。

计划已写入 Open 阶段准备好的工作区。从本轮入口配置确认已有 `isolation` 绑定。

如果结果为空，停止 Build 并返回 `/comet-open` 执行 workspace resolve/prepare；不得在本步骤首次选择或创建 current、branch、worktree。

**执行方式**：

| 选项 | 技能                                      | 适用场景                                                                                    |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| A    | Superpowers `subagent-driven-development` | 任务独立、复杂度高；每个任务在隔离的 implementer subagent 中执行，审查由 `review_mode` 驱动 |
| B    | Superpowers `executing-plans`             | 由主会话按计划顺序执行，适合任务较少或紧密关联的改动                                        |

**执行方式推荐规则**：

- 独立可验收任务、隔离上下文收益高且交接成本低 → 推荐 A
- 任务紧密关联、共享上下文较多或交接成本高 → 推荐 B
- 来自 hotfix 路径 → 推荐 B

执行方式、TDD 和审查表格是 Step 2 联合决策的一部分，不再单独暂停。不得用推荐规则替代用户确认。

用户选择后，只更新执行方式、TDD 模式和代码审查模式相关字段；保留 Open 阶段已绑定的 `isolation` 和 `bound_branch`。

- 若用户选择 `executing-plans`：同一更新中设置 `subagent_dispatch null` 和 `build_mode executing-plans`。
- 若用户选择 `subagent-driven-development`：同一更新中设置 `subagent_dispatch confirmed` 和 `build_mode subagent-driven-development`。

**TDD 模式**：

| 选项     | 含义                                      | 适用场景                                                                      |
| -------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `tdd`    | 每个任务先写失败测试再写实现              | 推荐。变更涉及业务逻辑、新功能、API                                           |
| `direct` | 实现优先，不强制逐任务 Red-Green-Refactor | 仍需运行相关测试并为 bug 修复保留回归证据；hotfix/tweak 预设默认使用 `direct` |

将确认的 `tdd_mode` 纳入同一次配置更新。

**代码审查模式**：

| 选项       | 含义                                                               | 适用场景                           |
| ---------- | ------------------------------------------------------------------ | ---------------------------------- |
| `off`      | 不自动派发代码审查                                                 | 文档、配置、文案、小范围低风险任务 |
| `standard` | 任务命中风险信号时派发任务级审查，并在 Verify 执行一次最终整合审查 | 默认推荐，适合大多数普通改动       |
| `thorough` | 每个任务派发任务级审查，并在 Verify 执行一次最终整合审查           | 高风险、多模块、架构或安全相关改动 |

将确认的 `review_mode` 纳入同一次配置更新。例如用户选择顺序执行、TDD 和 standard 时：

```bash
comet state set <name> build_pause null build_mode executing-plans subagent_dispatch null tdd_mode tdd review_mode standard --json
comet state check <name> build --json
```

替换为用户实际确认的值。任何字段无效时整组不写入；保留 Open 已绑定的工作区配置。

`isolation` 是脚本级硬约束。full workflow 必须在 Open 阶段写入 `current`、`branch` 或 `worktree`，并在进入 Build 前完成对应 workspace 准备和 `bound_branch` 绑定；若缺失，Build 只能停止并返回 Open 修复。

`subagent_dispatch` 是脚本级硬约束，用于记录用户已选择子代理执行。`build_mode: subagent-driven-development` 离开 build 阶段前必须同时满足 `subagent_dispatch: confirmed`，否则 `comet guard build --apply` 和 `comet state transition build-complete` 都会失败；它不是能力检查。

`tdd_mode` 是脚本级硬约束。full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`，否则 `comet guard build --apply` 和 `comet state transition build-complete` 都会失败。

`review_mode` 是脚本级硬约束。新建 full workflow 离开 build 阶段前 `review_mode` 必须已选择为 `off`、`standard` 或 `thorough`，否则 `comet guard build --apply` 和 `comet state transition build-complete` 都会失败。旧状态文件若没有该字段，按兼容路径继续，但恢复时应补写该字段。

`build_mode` 默认仅 hotfix/tweak 预设使用 `direct`。full workflow 不得默认使用 `direct`。只有用户明确要求跳过计划执行技能，且你已记录显式 override 时，才允许：

```bash
comet state set <name> direct_override true build_mode direct
```

没有 `direct_override: true` 时，full workflow 的 `build_mode=direct` 会被 guard 和状态转换同时拦截。

**执行位置**：

Open 阶段已经根据 `isolation` 准备好当前目录、分支或 Worktree，并返回了实际 `projectRoot`。恢复时先运行 `comet classic workspace resolve <name> --json`，进入返回目录，再运行 `comet state select <change-name>`；不得在 Build 再创建 Worktree、切换分支、提交计划以跨 Worktree 传递，或重新绑定 isolation。

**执行计划**：必须按 `build_mode` 的真实运行位置处理。

向外部执行 Skill 明确传入返回边界：只能执行当前计划和已确认配置，不得因“平台支持子代理”更改 `executing-plans`，不得重新创建 Worktree、选择隔离方式、触发阶段确认、追加最终审查或调用 `finishing-a-development-branch`。完成任务后返回 Comet Build；五阶段生命周期由 Comet 独占。

- `build_mode: executing-plans`：**立即执行：** 使用 Skill 工具加载 Superpowers `executing-plans` 技能。禁止跳过此步骤。若加载失败，停止并报告错误，不要用普通对话替代该步骤。技能加载后，ARGUMENTS 必须包含与 Step 1 相同的 Language 约束：`Language: 使用 comet state get <name> language 读取到的 Comet 配置产物语言输出`。按计划执行。
- `build_mode: subagent-driven-development`：主会话只负责协调，禁止直接编写实现代码。**立即执行：** 使用 Skill 工具加载 Superpowers `subagent-driven-development` 技能。技能加载后，读取 `comet-classic/reference/subagent-dispatch.md` 获取 Comet 专属扩展（子代理派发、任务隔离、勾选验证、TDD 约束、连续执行、上下文恢复），与技能工作流配合应用。若两者发生冲突，以更具体的 Comet 扩展为准。
- 若子代理派发操作失败，按 `comet-classic/reference/subagent-dispatch.md` 将当前任务记录为 `BLOCKED` 并带上失败原因；主会话不得接管实现。

**TDD 模式执行约束**：

若 `tdd_mode: tdd`：

- `build_mode: executing-plans`：加载执行技能后、执行第一个任务前，**立即执行：** 使用 Skill 工具加载 Superpowers `test-driven-development` 技能一次。禁止跳过此步骤。对每个任务遵循已加载的 TDD Red-Green-Refactor 循环，不跳过失败测试验证。后续任务不重复加载；冷恢复时只在当前上下文缺少该技能时加载一次，核对已有 RED/GREEN 证据后从未完成步骤继续，不重演已验证的实现过程。
- `build_mode: subagent-driven-development`：主会话不加载 TDD skill；TDD 约束和证据门槛已在 `comet-classic/reference/subagent-dispatch.md` 中定义，每个后台 implementer 和修复 agent 必须自行使用 Skill 工具加载 Superpowers `test-driven-development` 技能，并遵循 Comet 注入的 TDD 硬约束。

若 `tdd_mode: direct`：按正常流程执行，不强制 TDD。

**Build 审查边界**：Build 只保留任务级或分段审查，Verify 负责整个 change 的唯一最终集成代码审查。

- `executing-plans` + `off|standard`：Build 不额外请求整个 change 的最终审查；完成任务验收后进入 Verify
- `executing-plans` + `thorough`：每完成 3 个任务请求一次分段审查，只覆盖该段 diff；总任务数不超过 3 时不在 Build 额外审查
- `subagent-driven-development`：按 `comet-classic/reference/subagent-dispatch.md` 执行 `review_mode` 对应的任务级审查，不在全部任务结束后追加 final reviewer

分段或任务级审查发现 CRITICAL/IMPORTANT 问题时必须在 Build 修复；加载所需审查 Skill 失败时停止并报告，不能静默跳过。非 CRITICAL 发现如被接受，在持久产物中记录原因和影响范围。

### 3b. 执行中异常调试（异常调试协议）

执行任务期间，出现非预期的崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。TDD 中因待实现行为而产生、且失败原因已核对的预期 RED 是正常证据，不触发异常调试；加载错误、环境错误、无关回归或原因不明的 RED 仍须调查。

具体调查、最小失败测试、修复验证和保持当前 change 验证闭环的要求，按 `comet-classic/reference/debug-gate.md` 执行。

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

已确认范围内、不改变公开行为和验收约束的实现细节调整，只更新实施计划及理由，不重新开启 Open/Design。下面的分级规则仅用于真实规格或范围变化。

| 规模 | 触发条件                       | 做法                                                                                                                     |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 小   | 遗漏验收场景、边界条件         | 直接编辑 delta spec + design.md，追加 tasks.md 任务                                                                      |
| 中   | 接口变更、新增组件、数据流变化 | **暂停、展示选择并等待用户明确确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming` 更新 Design Doc + delta spec |
| 大   | 全新 capability 需求           | **暂停、展示拆分选择并等待用户明确确认**；用户确认后，通过 `/comet-open` 创建独立 change                                 |

**50% 阈值判定**：以 tasks.md 初始任务总数为基准，若新增任务数超过该总数的一半，视为超出原计划范围，**必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户决定是否拆分为新 change**。

创建独立 change 时必须调用 `/comet-open`，不得直接调用 `/opsx:new`。`/comet-open` 会同时创建 OpenSpec 产物和 `.comet.yaml`，避免新 change 脱离 Comet 状态机。

**用户选择必须包含**：

- 「拆分为新 change」— 通过 `/comet-open` 创建独立 change
- 「继续在当前 change 内完成」— 记录范围扩展决策，更新 tasks.md 和 delta spec 后继续

**原则**：

- delta spec 是活文档，本阶段期间随时可修改
- 每次更新应提交，commit message 说明变更原因
- 不提前同步到 main spec，归档时统一同步
- 小规模增量直接改 delta spec 时，应在 commit message 中注明，便于归档时判断 design doc 漂移

**handoff 同步**：delta spec 的增、改、删都会使设计交接包（`handoff_hash`）过期。Build 阶段可随时直接重新生成，无需回退当前 phase 或 step：

```bash
comet handoff <change-name> design --write
```

重新生成会从当前 OpenSpec artifacts 重建 handoff 并更新 `handoff_hash`，不会改变 `phase` 字段或 Runtime `currentStep`；刷新后可按 build 阶段继续推进。

### 5. 上下文管理

Build 是最长阶段，可能跨越大量任务。为支持上下文压缩后断点恢复：

- **每完成一个 task**：按当前执行分支和 `review_mode` 验收后，用 `comet state task-complete <name> <task-id> --expect <revision> --json` 记录完成。revision 来自本次 task 列表，需求变化时先重新判断，不能盲目刷新重试；计划和检查点不重复维护 checkbox。`subagent-driven-development` 在 `off` 时不派发每任务 reviewer，`standard` 仅风险任务派发，`thorough` 每项派发；合批仍逐 ID 验收。按项目提交策略保存进度，不机械增加微任务进度提交。
- **上下文压缩后恢复**：按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `build`。
- **用户手动修改恢复**：按 `comet-classic/reference/dirty-worktree.md` 协议处理未提交改动。该协议定义了检查步骤、归因分类和禁令。build 阶段的特殊处理：
  1. 归因后，若 diff 暗示计划或 spec 已变化，按 Step 4「Spec 增量更新」分级处理
- **长任务拆分**：以独立验收结果和依赖边界拆分；行数只提示审查风险，不单独决定任务数量

## 退出条件

- tasks.md 全部勾选
- 代码已提交
- 已显式运行项目对应的构建/测试命令并通过（不要只依赖 guard 自动猜测）
- `isolation` 已写为 `current`、`branch` 或 `worktree`
- `build_mode` 已写为 `subagent-driven-development`、`executing-plans` 或带显式 override 的 `direct`；若为 `subagent-driven-development`，`subagent_dispatch` 必须为 `confirmed`
- `tdd_mode` 已写为 `tdd` 或 `direct`
- `review_mode` 已写为 `off`、`standard` 或 `thorough`
- 已完成 `review_mode` 要求的任务级或分段审查；不在 Build 重复 Verify 的最终集成审查
- **阶段守卫**：运行 `comet guard <change-name> build --apply`，全部 PASS 后由守卫推进到 `phase: verify`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

优先用 Runtime 执行并记录检查，避免手动运行后 Guard 再跑一次：

仅对确定性本地检查使用 `--local`；外部服务或环境不确定的检查省略该参数，证据只使用一次。Windows 的普通 npm/pnpm shim 由平台适配器处理；包含 shell 元字符的 batch 参数会被拒绝，复杂检查应使用 `node <script>` 等明确入口，不把整段 shell 字符串当作程序名。

```bash
comet check run <change-name> build --local -- <program> [args...]
```

Guard 先检查配置、任务和产物，再复用相同输入与环境下的 Runtime 证据；没有有效证据时才运行可探测的构建。源文件、测试、相关配置、依赖或子模块变化要求重跑；冷恢复重新校验本地可复用证据，只重跑无效或一次性证据。执行期间输入变化不得复用。预检不消费一次性证据，成功阶段转换才消费。失败日志保存在 `logRef`，按需读取。

`state record-check --command` 仍只保存手工声明，Comet **绝不会执行该文本**，也不能据此自动推进。build 与 verify 证据彼此独立：Verify 可引用已验证的同一构建结果，但构建通过不替代测试和验收场景。`COMET_SKIP_BUILD=1` 仅是旧流程的兼容绕过方式，不是可审计的构建证据。

退出前运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
comet guard <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 执行。关键命令：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
