---
name: comet-build
description: '制定计划、实施并验收 Classic 任务。在用户调用 /comet-build，或 Classic Runtime 进入 Build、返回 Build 修复时使用。'
---

# Comet 阶段 3：计划与构建（Build）

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## 前置条件

- Design Doc 已创建（阶段 2 完成）
- 活跃 change 存在

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用正式支持的 `comet` CLI，执行以下入口验证。从任意入口恢复任务时，先按 `comet-classic/reference/context-recovery.md` 检查恢复状态：

```bash
comet state select <change-name>
comet state check <name> build --json
```

本轮 Design/Guard 已成功返回 Build 状态信息时，直接使用其中的 `data.configuration`、`artifactRefs` 和任务信息，并按 `agent.continuation` 继续，不重复 select/check。恢复任务、工作区变化或外部状态变化时，才执行上述入口验证。配置写入成功后，使用返回的结果，不逐字段重复调用 get；验证失败时处理 `data.issues`。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

**恢复**：根据入口返回的 phase、任务 ID 和 plan 的 `base-ref`，核对现有实现与审查记录，再从尚未完成的实施或审查步骤继续。任务未勾选不等于尚未实现。派发任务前先核对检查点，不重复已有提交，也不假定外部操作可以安全重试。

### 1. 先确认执行策略

读取入口返回的 configuration、taskState 和 nextAction。已有配置、计划和审查记录仍然有效时，直接继续，不重新询问或生成。工作区必须已在 Open 阶段准备并绑定；缺少 isolation 或目录不匹配时停止，回到 workspace resolve 返回的 projectRoot 恢复任务，不能在 Build 新建或切换工作区。

**写计划前必须确认执行策略**。配置缺失或用户明确要求更改时，按 `comet-classic/reference/decision-point.md` 在同一轮提问中收集执行方式、TDD 和审查模式，不按模型名称自动选择：

| build_mode                    | 行为                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `autonomous`                  | 用户明确选择后，Agent 自行制定计划；可以串行实施，也可以将范围明确的一组任务委派给子代理，不强制加载外部规划或执行 Skill |
| `subagent-driven-development` | 加载同名 Superpowers Skill；主会话负责协调，实现代理（implementer）负责实施，并遵守 Comet 的任务派发与审查规则           |
| `executing-plans`             | 加载同名 Superpowers Skill，由主会话按计划顺序实施                                                                       |

Agent 具备较强的自主规划能力、任务较长且需要灵活安排时，可推荐 autonomous；希望遵循固定的委派方法时，推荐 subagent-driven-development；希望按固定顺序执行计划时，推荐 executing-plans。推荐不能代替用户确认，也不自动替换已有 change 的执行策略。

| 配置          | 选项与约束                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tdd_mode`    | `tdd`：先确认测试因待实现的行为而失败（RED），再实施并使测试通过（GREEN）；`direct`：不强制逐任务 RED/GREEN，但仍需相关测试和缺陷回归结果                           |
| `review_mode` | `off`：低风险任务不自动审查；`standard`：审查有风险的任务，并在 Verify 完成唯一一次最终集成审查；`thorough`：按已选执行方式逐任务或分段独立审查，并完成最终集成审查 |

full 流程采用 autonomous 时，必须选择 standard 或 thorough，不能用实现者自评代替独立审查。已有执行策略仍遵循原有 review_mode 规则。TDD 默认推荐 tdd，审查默认推荐 standard；hotfix/tweak 的 direct 预设保持不变。

用户完成所有选择后，在一次原子操作中写入配置。例如，用户明确选择自主执行、TDD 和 standard 审查时：

```bash
comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json
```

将示例替换为用户的实际选择。选择 subagent-driven-development 时，同时写入 `subagent_dispatch confirmed`；其他方式写入 null。保留 isolation、bound_branch 和已有暂停状态。写入失败时停止，不加载执行 Skill。用户尚未决定或要求暂停时停止，不写入不完整的配置。

`direct` 不是 autonomous 的别名：full 只有用户明确要求且记录 `direct_override true` 才允许 direct；不能借自主策略跳过设计、计划、配置、验证或独立审查。

### 2. 创建或恢复计划

任务是否完成，以 `tasks.md` 为准。需要读取各项任务的正文或 ID 时，才运行 `comet state tasks <name> --json`；缺少 ID 时运行 `comet state tasks <name> --assign-ids --json`。保留已有 ID，并更新受影响的 handoff 和计划中的任务映射。

恢复任务、同步旧计划中的勾选框或补记完成状态时，按 context-recovery.md 处理。任务未勾选不等于尚未实施：已经实现且检查、审查充分的任务可以补勾；其余任务只补未完成的工作。task-complete 会自动同步有 comet-task ID 映射的旧计划；需要单独同步时，使用 `comet state sync-plan <name>`。planSync 返回 mapping-required 时，只补任务映射，不重做实现。

已有有效计划时沿用。否则使用 configuration.language，在 `<classic-superpowers-root>/plans/<YYYY-MM-DD>-<change-name>.md` 创建计划：

- autonomous：由当前 Agent 直接编写和自检，不加载 writing-plans。
- 其他计划执行策略：使用 `writing-plans` Skill，只采用其编写和自检方法；技能失败则停止。传入已确认的配置、design_doc、tasks.md、固定计划路径和当前 `git rev-parse HEAD`。完成后返回 Comet Build，不再次选择执行策略，也不自动进入外部 Skill 的后续流程。

所有策略都遵守以下计划要求：每个任务对应一个可独立验收的结果，列明 task ID、范围、依赖、约束，以及验收命令或场景。按这个结果安排准备、实现、测试和文档工作，不按预计分钟数、文件数量或 RED/GREEN 步骤拆分任务。计划引用已有设计和需求，不预先写出完整实现；只有必须提前审查的接口或高风险算法，才提供必要的代码片段。

新计划不创建第二套 checkbox，写入 `<!-- comet-task-authority: <classic-task-authority-ref> -->`（取自 `data.artifactRefs.tasks` 的仓库相对引用），以 `<!-- comet-task-ref:<task-id> -->` 关联每个任务。计划新增实际任务必须先纳入 tasks.md 并分配 ID；范围变化按 Step 4 处理。

计划文件头：

```yaml
---
change: <change-name>
design-doc: <recorded-design-doc-path>
base-ref: <git rev-parse HEAD before implementation>
---
```

保留旧计划 base-ref，不在恢复时替换为当前 HEAD。`<plan-ref>` 沿用 `data.artifactRefs.plan`，新计划使用 `data.artifactRefs.plansRoot` 与已选文件名组成的仓库相对引用；绝对路径仅用于写文件。确认文件存在后记录：

```bash
comet state set <name> plan "<plan-ref>" --json
```

计划完成后，默认按已确认的策略继续，不再追加配置确认。用户明确要求切换模型，或要求写完计划后暂停时，写入 `comet state set <name> build_pause plan-ready` 并停止。恢复已有 plan-ready 暂停时，只有用户明确要求继续，才清除暂停状态。沿用仍然有效的计划和配置；旧 change 缺少配置时补做 Step 1，不重写计划。

### 3. 执行与验收

执行前使用本轮入口配置；配置、需求或工作区变化后刷新入口。外部 Skill 只执行当前计划和确认配置，不新建 Worktree、重新选择隔离、追加最终审查或调用 finishing-a-development-branch；完成任务返回 Comet Build。

- autonomous：Agent 在计划范围内自行组织实施。需要委派时，先读取 `comet-classic/reference/subagent-dispatch.md`，将范围明确的一组任务作为工作包交给子代理，通过 Runtime 保存协调记录，并安排独立审查者（reviewer）；不强制加载外部执行 Skill。
- executing-plans：使用 Skill 工具加载 Superpowers `executing-plans`，传入入口 configuration.language，按计划顺序执行；加载失败则停止。
- subagent-driven-development：加载同名 Superpowers Skill 和 `comet-classic/reference/subagent-dispatch.md`。主会话负责协调，不代替实现代理编写代码；派发失败时保存 BLOCKED 原因，不能擅自接管实现或更改策略。

配置为 tdd 时，每个实现任务都必须记录 RED 和对应 GREEN 的命令及真实结果，并确认 RED 的失败原因就是待实现的行为。autonomous 无需加载外部 TDD Skill，但仍须完成 RED/GREEN；executing-plans 在首次实施前加载一次 test-driven-development，子代理策略则由实现代理加载。上下文完整时不重复加载；丢失上下文后恢复任务时，先核对已有结果，不重演已经验证的实现过程，也不回退代码伪造 RED。direct 模式仍需相关检查与缺陷回归结果。

Build 只做任务或分段审查，Verify 负责唯一最终集成审查：

- autonomous 及子代理执行：按 subagent-dispatch.md 的风险分级和复查次数限制进行独立任务审查；autonomous 即使不委派实现，也必须由独立审查者完成所需审查。
- executing-plans + off|standard：验收任务后进入 Verify，不追加 Build 最终审查。
- executing-plans + thorough：每个任务都须纳入独立审查；依赖紧密、必须共同验收的任务可组成一段，按可独立验收的结果与风险边界审查 diff，不按固定任务数量切段。各段通过审查后才继续依赖它的后续实施，不将可独立验收的全部任务合成一段延后审查。没有后续实施的最后一段交由 Verify 的唯一最终集成审查。

必须解决 CRITICAL/IMPORTANT 问题。无法进行独立审查时停止，不能用自评代替。对于已接受的非关键偏差，记录接受依据和影响范围。验收后，使用 task-complete 按任务 ID 逐项勾选 tasks.md；通过 `comet state checkpoint <name> --file <json-path>` 保存协作与恢复记录，字段与读写规则见 context-recovery.md。检查点不能代替任务勾选或实际检查、审查结果。

### 3b. 执行中异常调试（异常调试协议）

执行任务期间，出现非预期的崩溃、异常行为、测试失败或构建失败，必须先调查根因；autonomous 直接遵循异常调试协议，其他策略加载 Superpowers `systematic-debugging`。根因未明前不得实施源码修复。已核对因待实现行为而失败的 TDD RED 是正常证据；加载错误、环境错误、无关回归或原因不明的 RED 仍须调查。

根因调查、最小失败测试、修复后的验证，以及如何在当前 change 中完成这些步骤，均按 `comet-classic/reference/debug-gate.md` 执行。

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

已确认范围内、不改变公开行为和验收约束的实现细节调整，只更新实施计划及理由，不重新开启 Open/Design。下面的分级规则仅用于真实规格或范围变化。

| 规模 | 触发条件                       | 做法                                                                                                                     |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 小   | 遗漏验收场景、边界条件         | 直接编辑 delta spec + design.md，追加 tasks.md 任务                                                                      |
| 中   | 接口变更、新增组件、数据流变化 | **暂停、展示选择并等待用户明确确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming` 更新 Design Doc + delta spec |
| 大   | 全新的功能需求                 | **暂停、展示拆分选择并等待用户明确确认**；用户确认后，通过 `/comet-open` 创建独立 change                                 |

**范围复核**：新增任务前，先核对原目标、公开行为、验收要求，以及用户已接受的风险。补充原范围内遗漏的实现或验收、调整任务粒度时，直接更新任务并记录依据；任务数量或增长比例本身不触发暂停。只有实际扩大范围、需要重新设计或出现可独立交付的新功能时，才按 `comet-classic/reference/decision-point.md` 暂停，让用户确认继续、调整还是拆分。

创建独立 change 时必须调用 `/comet-open`，不得直接调用 `/opsx:new`。`/comet-open` 会同时创建 OpenSpec 产物和 `.comet.yaml`，避免新 change 脱离 Comet 状态机。

**用户选择必须包含**：

- 「拆分为新 change」— 通过 `/comet-open` 创建独立 change
- 「继续在当前 change 内完成」— 记录范围扩展决策，更新 tasks.md 和 delta spec 后继续

**原则**：

- delta spec 随实现进展持续维护，在本阶段可按上述规则修改
- 每次更新应提交，commit message 说明变更原因
- 不提前同步到 main spec，归档时统一同步
- 小规模增量直接改 delta spec 时，应在 commit message 中注明，便于归档时判断 design doc 漂移

**handoff 同步**：delta spec 的增、改、删都会使设计交接包（`handoff_hash`）过期。Build 阶段可随时直接重新生成，无需回退当前 phase 或 step：

```bash
comet handoff <change-name> design --write
```

重新生成时，会根据当前 OpenSpec 产物重建 handoff 并更新 `handoff_hash`，不会改变 `phase` 字段或 Runtime `currentStep`；更新后可以继续 build 阶段。

### 5. 上下文管理

Build 是最长阶段，可能跨越大量任务。为支持上下文压缩后断点恢复：

- **每完成一个 task**：按配置核对实际实现、检查和审查后，用 `comet state task-complete <name> <task-id> --expect <revision> --json` 勾选 tasks.md。revision 来自已核对的任务列表，需求变化时先重新判断，不能盲目刷新重试。新计划和检查点不复制 checkbox；旧计划只同步有明确 ID 映射的完成项，按 context-recovery.md 处理。工作包逐 ID 验收，使用 checkpoint 命令持久化协调记录，按项目提交策略保存进度。
- **上下文压缩后恢复**：按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `build`。
- **用户手动修改恢复**：按 `comet-classic/reference/dirty-worktree.md` 协议处理未提交改动。该协议定义了检查步骤、归因分类和禁令。build 阶段的特殊处理：
  1. 归因后，若 diff 暗示计划或 spec 已变化，按 Step 4「Spec 增量更新」分级处理
- **长任务拆分**：按可独立验收的结果和任务依赖关系拆分；代码行数只用于提示审查风险，不单独决定任务数量

## 退出条件

- tasks.md 全部勾选
- 代码已提交
- 已显式运行项目对应的构建/测试命令并通过（不要只依赖 guard 自动猜测）
- `isolation` 已写为 `current`、`branch` 或 `worktree`
- `build_mode` 已写为 `autonomous`、`subagent-driven-development`、`executing-plans` 或带显式 override 的 `direct`；若为 `subagent-driven-development`，`subagent_dispatch` 必须为 `confirmed`；full autonomous 必须保留有效设计、计划及 standard/thorough 独立审查
- `tdd_mode` 已写为 `tdd` 或 `direct`
- `review_mode` 已写为 `off`、`standard` 或 `thorough`
- 已完成 `review_mode` 要求的任务级或分段审查；不在 Build 重复 Verify 的最终集成审查
- **阶段守卫**：运行 `comet guard <change-name> build --apply`，全部 PASS 后由守卫推进到 `phase: verify`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

优先用 Runtime 执行并记录检查，避免手动运行后 Guard 再跑一次：

仅对确定性本地检查使用 `--local`；外部服务或环境不确定的检查省略该参数，证据只使用一次。Windows 的普通 npm/pnpm shim 由平台适配器处理；包含 shell 元字符的 batch 参数会被拒绝，复杂检查应使用 `node <script>` 等明确入口，不把整段 shell 字符串当作程序名。

```bash
comet check run <change-name> build --local -- <program> [args...]
```

Guard 先检查配置、任务和产物，再复用输入与环境相同的 Runtime 检查结果；没有有效结果时，才运行自动识别出的构建命令。源文件、测试、相关配置、依赖或子模块变化后，必须重跑相关检查。丢失上下文后恢复任务时，重新校验可复用的本地结果，只重跑已失效或只能使用一次的检查。执行期间输入发生变化的结果不得复用。预检不会用掉一次性结果；只有阶段转换成功后，该结果才不能再次使用。失败日志保存在 `logRef`，按需读取。

`state record-check --command` 仍只保存手工声明，Comet **绝不会执行该文本**，也不能据此自动推进。build 与 verify 证据彼此独立：Verify 可引用已验证的同一构建结果，但构建通过不替代测试和验收场景。`COMET_SKIP_BUILD=1` 仅是旧流程的兼容绕过方式，不是可审计的构建证据。

退出前运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
comet guard <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 和成功结果中的 `agent.continuation` 继续。已有仍然有效的状态信息时，不重复 next、select 或 check。只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供这些信息时，才运行：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
