---
name: comet-build
description: '计划、实施并验收 Classic 任务。在用户调用 /comet-build，或 Classic Runtime 路由到 Build、返回修复时使用。'
---

# Comet 阶段 3：计划与构建（Build）

入口返回 layout 后按 `comet-classic/reference/classic-layout.md` 绑定逻辑根；协议已在当前上下文时不重复加载。本文件的 OpenSpec CLI 使用 adapter，文件路径使用绑定的 `<classic-*>` 根，不先额外运行 root show。

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

已有本轮成功 Design/Guard 返回的 Build 观察时，直接消费其 `data.configuration`、`artifactRefs`、任务和 `agent.continuation`，不重复 select/check。恢复、工作区或外部状态变化时才执行上方入口。写入配置后直接消费成功结果，不逐字段重复调用 get；验证失败时处理 `data.issues`。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

**恢复**：以入口 phase、任务 ID 和 plan 的 `base-ref` 核对现有实现与审查记录，从尚未完成的执行或审查步骤继续。未勾选不等于未实现；先核对检查点再派发，不重复已有提交，也不假定外部操作可安全重复。

### 1. 先确认执行策略

使用入口 configuration、taskState 和 nextAction；已有有效配置、计划和审查记录时直接恢复，不重新询问或生成。工作区必须已在 Open 准备并绑定；缺少 isolation 或目录不匹配时停止，按 workspace resolve 返回的 projectRoot 恢复，不能在 Build 新建或切换工作区。

**写计划前必须已有执行策略**。配置缺失或用户明确要求更改时，按 `comet-classic/reference/decision-point.md` 提供一次联合决策，收集执行方式、TDD 和审查模式，不按模型名称自动选择：

| build_mode                    | 行为                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `autonomous`                  | 显式选择的自主策略；Agent 自行形成紧凑计划，选择串行实施或有界工作包委派，不强制加载外部规划/执行 Skill |
| `subagent-driven-development` | 加载同名 Superpowers Skill，主会话协调、implementer 实施，应用 Comet 派发与审查契约                     |
| `executing-plans`             | 加载同名 Superpowers Skill，由主会话按计划顺序实施                                                      |

自主规划能力强、需要灵活组织长任务时可推荐 autonomous；希望固定委派方法时推荐 subagent-driven-development；希望固定顺序执行方法时推荐 executing-plans。推荐不替代用户确认，已有 change 的旧策略不自动替换。

| 配置          | 选项与约束                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tdd_mode`    | `tdd`：先核对真实 RED，再实施并获得 GREEN；`direct`：不强制逐任务 RED/GREEN，但保留相关测试和缺陷回归证据                                           |
| `review_mode` | `off`：低风险任务不自动审查；`standard`：风险任务审查及 Verify 唯一最终集成审查；`thorough`：按已选执行方式逐任务或分段独立审查，并完成最终集成审查 |

full 的 autonomous 必须选择 standard 或 thorough，独立审查不能由自评替代。旧策略仍遵循已有 review_mode 规则。TDD 默认推荐 tdd，审查默认推荐 standard；hotfix/tweak 的 direct 预设保持不变。

完整选择后原子写入配置，例如用户明确选择自主、TDD、standard：

```bash
comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json
```

替换为用户实际选择；subagent-driven-development 同时写入 `subagent_dispatch confirmed`，其他方式写入 null。保留 isolation、bound_branch 和已有暂停状态。写入失败时停止，不加载执行 Skill。用户尚未决定或要求暂停时停止，不写半套配置。

`direct` 不是 autonomous 的别名：full 只有用户明确要求且记录 `direct_override true` 才允许 direct；不能借自主策略跳过设计、计划、配置、验证或独立审查。

### 2. 创建或恢复计划

`tasks.md` 是唯一完成状态来源。需要逐项正文或 ID 时才运行 `comet state tasks <name> --json`；缺少 ID 时运行 `comet state tasks <name> --assign-ids --json`，保留已有 ID，刷新受影响 handoff 和计划映射。

恢复、旧计划 checkbox 同步及补勾按 context-recovery.md：未勾选不等于未实施。已实现且检查、审查充分时补勾；缺什么只补什么。task-complete 自动同步有 comet-task ID 映射的旧计划；单独同步使用 `comet state sync-plan <name>`，planSync mapping-required 时只补映射，不重做实现。

已有有效计划时沿用。否则使用 configuration.language，在 `<classic-superpowers-root>/plans/<YYYY-MM-DD>-<change-name>.md` 创建计划：

- autonomous：由当前 Agent 直接编写和自检，不加载 writing-plans。
- 其他计划执行策略：使用 `writing-plans` Skill，只采用编写和自检方法；技能失败则停止。传入已确认配置、design_doc、tasks.md、固定计划路径和当前 `git rev-parse HEAD`。完成后返回 Comet Build，不再次选择执行策略或自动进入外部生命周期。

所有策略使用同一计划契约：每项是独立可验收结果，列明 task ID、范围、依赖、约束和验收命令/场景；准备、实现、测试和文档围绕结果组织，不按分钟、文件数量或 RED/GREEN 步骤拆任务。引用设计和需求，不预写完整实现；只有必须预审的接口或高风险算法提供必要片段。

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

计划完成后默认按已确认策略继续，不再追加配置确认点。用户明确要求切换模型或计划后暂停时，写入 `comet state set <name> build_pause plan-ready` 并停止。恢复已有 plan-ready 暂停时，只有用户明确要求继续才清除暂停；有效计划与配置沿用，旧 change 缺配置时补 Step 1，不重写计划。

### 3. 执行与验收

执行前使用本轮入口配置；配置、需求或工作区变化后刷新入口。外部 Skill 只执行当前计划和确认配置，不新建 Worktree、重新选择隔离、追加最终审查或调用 finishing-a-development-branch；完成任务返回 Comet Build。

- autonomous：Agent 在计划范围内自行组织实施；需要委派时读取 `comet-classic/reference/subagent-dispatch.md`，使用有界工作包、Runtime 协调记录和独立 reviewer，不强制加载外部执行 Skill。
- executing-plans：使用 Skill 工具加载 Superpowers `executing-plans`，传入入口 configuration.language，按计划顺序执行；加载失败则停止。
- subagent-driven-development：加载同名 Superpowers Skill 和 `comet-classic/reference/subagent-dispatch.md`。主会话协调而不代写实现；派发失败时保存 BLOCKED 原因，不静默接管或改策略。

配置为 tdd 时，每个实现任务必须有原因匹配的 RED 和对应 GREEN 命令及真实结果。autonomous 无需加载外部 TDD Skill，但不能免除 RED/GREEN；executing-plans 在首次实施前加载 test-driven-development 一次，子代理策略由 implementer 加载。上下文完整时不重复加载；冷恢复先核对已有证据，不重演已验证实现，也不倒退代码伪造 RED。direct 模式仍需相关检查与缺陷回归证据。

Build 只做任务或分段审查，Verify 负责唯一最终集成审查：

- autonomous 及子代理执行：按 subagent-dispatch.md 的风险与预算规则进行独立任务审查；autonomous 即使不委派实现，所需 reviewer 也必须独立。
- executing-plans + off|standard：验收任务后进入 Verify，不追加 Build 最终审查。
- executing-plans + thorough：每个任务都须纳入独立审查；依赖紧密、必须共同验收的任务可组成一段，按可独立验收的结果与风险边界审查 diff，不按固定任务数量切段。各段通过审查后才继续依赖它的后续实施，不将可独立验收的全部任务合成一段延后审查。没有后续实施的最后一段交由 Verify 的唯一最终集成审查。

CRITICAL/IMPORTANT 发现必须解决；审查不可用时停止，不以自评代替。已接受的非关键偏差保存依据和范围。验收后使用 task-complete 逐 ID 勾选 tasks.md；协作与恢复记录通过 `comet state checkpoint <name> --file <json-path>` 保存，字段与读写规则见 context-recovery.md。检查点不代替任务勾选或真实证据。

### 3b. 执行中异常调试（异常调试协议）

执行任务期间，出现非预期的崩溃、异常行为、测试失败或构建失败，必须先调查根因；autonomous 直接遵循异常调试协议，其他策略加载 Superpowers `systematic-debugging`。根因未明前不得实施源码修复。已核对因待实现行为而失败的 TDD RED 是正常证据；加载错误、环境错误、无关回归或原因不明的 RED 仍须调查。

具体调查、最小失败测试、修复验证和保持当前 change 验证闭环的要求，按 `comet-classic/reference/debug-gate.md` 执行。

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

已确认范围内、不改变公开行为和验收约束的实现细节调整，只更新实施计划及理由，不重新开启 Open/Design。下面的分级规则仅用于真实规格或范围变化。

| 规模 | 触发条件                       | 做法                                                                                                                     |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 小   | 遗漏验收场景、边界条件         | 直接编辑 delta spec + design.md，追加 tasks.md 任务                                                                      |
| 中   | 接口变更、新增组件、数据流变化 | **暂停、展示选择并等待用户明确确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming` 更新 Design Doc + delta spec |
| 大   | 全新 capability 需求           | **暂停、展示拆分选择并等待用户明确确认**；用户确认后，通过 `/comet-open` 创建独立 change                                 |

**范围复核**：新增任务先核对原目标、公开行为、验收与风险承担。补充原范围内遗漏的实现或验收、调整任务粒度时直接更新任务及依据；任务数量或增长比例本身不触发暂停。只有真实范围扩张、需要重新设计或出现可独立交付的新能力时，才按 `comet-classic/reference/decision-point.md` 暂停并确认继续、调整或拆分。

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

- **每完成一个 task**：按配置核对实际实现、检查和审查后，用 `comet state task-complete <name> <task-id> --expect <revision> --json` 勾选 tasks.md。revision 来自已核对的任务列表，需求变化时先重新判断，不能盲目刷新重试。新计划和检查点不复制 checkbox；旧计划只同步有明确 ID 映射的完成项，按 context-recovery.md 处理。工作包逐 ID 验收，使用 checkpoint 命令持久化协调记录，按项目提交策略保存进度。
- **上下文压缩后恢复**：按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `build`。
- **用户手动修改恢复**：按 `comet-classic/reference/dirty-worktree.md` 协议处理未提交改动。该协议定义了检查步骤、归因分类和禁令。build 阶段的特殊处理：
  1. 归因后，若 diff 暗示计划或 spec 已变化，按 Step 4「Spec 增量更新」分级处理
- **长任务拆分**：以独立验收结果和依赖边界拆分；行数只提示审查风险，不单独决定任务数量

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

Guard 先检查配置、任务和产物，再复用相同输入与环境下的 Runtime 证据；没有有效证据时才运行可探测的构建。源文件、测试、相关配置、依赖或子模块变化要求重跑；冷恢复重新校验本地可复用证据，只重跑无效或一次性证据。执行期间输入变化不得复用。预检不消费一次性证据，成功阶段转换才消费。失败日志保存在 `logRef`，按需读取。

`state record-check --command` 仍只保存手工声明，Comet **绝不会执行该文本**，也不能据此自动推进。build 与 verify 证据彼此独立：Verify 可引用已验证的同一构建结果，但构建通过不替代测试和验收场景。`COMET_SKIP_BUILD=1` 仅是旧流程的兼容绕过方式，不是可审计的构建证据。

退出前运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
comet guard <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 消费成功结果的 `agent.continuation`，已有有效观察时不重复 next、select 或 check。仅冷恢复、外部变化或旧结果缺少观察时运行：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
