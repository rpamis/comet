# Subagent 驱动开发的 Comet 扩展

规范路径：`comet/reference/subagent-dispatch.md`

本文档提供在 Superpowers `subagent-driven-development` 技能**之上**应用的 Comet 专属扩展。Superpowers `subagent-driven-development` 技能提供基础连续派发循环（每个 task 派发全新 implementer，并包含默认 task reviewer 节点）并强制连续执行。本文档添加 Comet 特有的真实后台调度、任务追踪、状态验证、上下文恢复，以及审查/修复预算；Comet 的 `review_mode` 接管 reviewer 阶段，决定哪些任务需要 reviewer、需要几轮修复和最终审查。若 Superpowers 技能与本文档发生冲突时，以本文档中更具体的 Comet 约束为准。

> **⚠️ 关键约束 — 任务之间禁止暂停**
>
> 当一个 task 按 `review_mode` 完成验收并被勾选后，**立即派发下一个 task**，不得停止、总结或询问用户是否继续。用户期望所有 task 按顺序自动执行，无需手动干预。任务之间暂停会中断工作流，导致用户每次都需要手动恢复。
>
> 仅在以下情况才停止并等待用户输入：
> - 任务处于 **BLOCKED** 状态（`review_mode: standard` 下风险任务 1 轮 review-fix 或最终轻量复查仍未通过，或 `review_mode: thorough` 下任务级/最终审查 2 轮审查-修复仍未通过）
> - 存在无法从仓库、计划或既有上下文消除的真实歧义
> - 平台没有真实后台 agent 调度能力，需要用户改选 `executing-plans`
> - 用户**明确**要求暂停
>
> 此规则适用于整个派发循环，而非单个任务。

## 开始前

1. 派发第一个 task 前，必须完成 Superpowers `subagent-driven-development` 技能的预检计划审查：扫描 plan 和全局约束中是否存在互相矛盾的要求，或 plan 明确要求但 reviewer 会判为缺陷的内容。若发现问题，实施前一次性向用户提出成组问题并附上冲突的 plan 原文；若没有问题，直接继续。
2. 读取计划一次，按顺序提取所有未勾选 task 的完整文本。
3. 为每个 task 保存唯一标识：plan 中 checkbox 后的完整任务文本，以及它映射的 OpenSpec task 完整文本（若存在）。若文本不唯一，停止并先修正计划，禁止依赖"第一个匹配项"。
4. 尊重依赖关系；依赖尚未完成的 task 不得提前派发。

## 每个 Task 的 Comet 扩展

在每个 task 上应用这些扩展，叠加在 Superpowers 技能的派发循环之上：

### 0. 派发强制约束（关键）

主会话**仅负责协调**，禁止直接执行 task。主会话禁止修改源代码。协调者唯一允许的文件修改是 plan、OpenSpec task 和 subagent 进度检查点的持久化更新。不得把多个 task 打包给同一个 agent。每个 task 派发一个全新的后台 implementer agent；当 `review_mode` 需要审查或修复时，task reviewer、修复 agent 和 final reviewer 也必须分别使用全新的后台 agent：

- **Claude Code**：对每个 implementer，以及 `review_mode` 要求的 task reviewer、修复 agent 和 final reviewer 使用 `Agent` 工具并设置 `run_in_background: true`。禁止内联执行 task，禁止错误进入需要预先创建 team 的团队模式。
- **其他平台**：使用平台等效的后台 agent / Task / 多 agent 派发机制。
- **禁止**跨 task 或角色复用 implementer、reviewer 或修复 agent。每个 agent 拥有全新的隔离上下文，并且只接收当前角色所需的单个 task 上下文。
- 若平台无真实后台派发能力，不得继续；暂停并等待用户改选 `build_mode: executing-plans`。

### 1. 派发 Prompt 与回报契约

每个 implementer 或修复 agent prompt 必须包含：

- 当前单个 task 的完整文本、架构背景和依赖上下文
- `Language: 使用 "$COMET_BASH" "$COMET_STATE" get <name> language 读取到的 Comet 配置产物语言输出`
- 允许修改的文件范围和禁止修改的范围
- 必须执行的测试命令和提交要求
- 修复 agent 还必须收到对应 reviewer 的完整反馈

大型 task 文本、实现报告和审查材料必须通过已加载的 Superpowers `subagent-driven-development` 技能提供的文件交接机制传递，不得整段粘贴进主会话。派发 prompt 应指向这些交接产物，同时保留角色、允许范围、必跑测试、报告契约和 Comet 特有约束。Comet 可以记录 agent 回传的产物路径或短摘要用于恢复，但不得依赖这些产物的内部名称或目录布局。

agent 回报状态必须为 `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`，并包含或指向实现内容、测试结果、提交哈希、变更文件和顾虑。**implementer/修复 agent 还必须回报本任务是否命中任一风险信号**（见下方清单），命中则逐条列出；这是 `review_mode: standard` 下是否派发每任务 reviewer 的第一信号源。进入审查前，主会话必须确认提交和文件在当前工作树可见；若平台使用隔离副本，先拉取或合并变更。

**风险信号清单**（命中任一即视为风险任务）：

- 跨模块/跨子系统协调改动
- 安全敏感面：认证、授权、加解密、SQL、外部输入处理、密钥/凭证
- 并发、锁、共享可变状态
- 数据或 schema 迁移
- 公共 API 契约或对外接口变更
- implementer 返回 `DONE_WITH_CONCERNS`
- 单任务 diff 超过 200 行

当 `review_mode` 需要 reviewer 时，每个 reviewer prompt 必须包含或指向完整 task 需求、实现提交或差异以及 RED/GREEN 证据（`tdd_mode: tdd` 时）。reviewer 不得只依据 implementer 的总结进行审查。

reviewer prompt 必须保持中立：

- 不得要求 reviewer 重新运行 implementer 已经运行并报告的同一批测试；reviewer 负责核验已报告的证据和代码/diff。
- 不得在 reviewer prompt 中预判、压低或禁止报告某个发现。若某个可能发现与 plan 冲突，让 reviewer 先报告，再询问用户以哪个要求为准。
- 不得把之前 task 的累计历史粘贴进后续派发。只提供当前 task、相关接口/约束，以及已加载的 Superpowers `subagent-driven-development` 技能暴露的交接产物。

**Model 选择（强制）**：每次派发必须显式指定 model，省略会静默继承会话最贵 model，拖慢执行并抬高成本。遵循 Superpowers `subagent-driven-development` 的 Model Selection 规则：

- **implementer / 修复 agent**：用 prose 描述的实现任务至少使用中档；多文件集成、需要模式匹配或调试 → 中档；需要设计判断或广泛理解代码库 → 高档。只有当 plan 文本已含完整待写代码（转写+测试），或只是单文件机械修复时，才用最便宜档。
- **reviewer（任务级/最终）**：按 diff 大小、复杂度和风险缩放。小机械 diff 不需要最高档；微妙并发改动才上高档。
- **final whole-branch review**：使用可用的最高档 model，不用会话默认档。

省略 model 等于让它跑会话最贵 model，直接违背本节目标。

### 2. Implementer 范围限制

implementer 只负责实现、测试和提交代码。**implementer 不得勾选 plan 或 OpenSpec task**，也不得只更新内置 Todo 或对话 checklist。

### 3. TDD 硬约束

若 `tdd_mode: tdd`，每个 implementer 和修复 agent 必须先使用 Skill 工具加载 Superpowers `test-driven-development` 技能，并在 prompt 中同时注入：

```text
You MUST follow TDD: write a failing test first, watch it fail, then write minimal code to pass. No production code without a failing test first.
```

implementer 或修复 agent 回报必须提供 **RED 失败命令与失败摘要**、**GREEN 通过命令与通过摘要**；缺少任一证据不得进入审查。当 `review_mode` 需要 task reviewer 时，该 reviewer 必须核验 RED/GREEN 证据与测试覆盖，并同时检查 spec compliance 与 code quality。

### 4. 持久进度检查点

主会话必须维护 `openspec/changes/<name>/.comet/subagent-progress.md`，并在每次派发、agent 回报、审查结果、修复轮次变化和 task 勾选后立即更新。检查点至少记录：

- 当前 plan task 唯一文本及映射的 OpenSpec task 文本
- 当前阶段：`implementing | task-review | checkoff | done | blocked | final-review | final-fix`
- 实现提交哈希、变更文件和 RED/GREEN 证据
- 已选择的 `review_mode`
- 已通过的审查阶段及尚未解决的 reviewer 反馈
- 当前 task 或 final review 的审查-修复轮次（`standard` 最多 1 轮，`thorough` 最多 2 轮，`off` 为 0 轮）
- `review_mode: standard` 时，本 task 是否已触发风险任务级 review 及命中的风险信号（恢复时不得重复派发已完成的任务级 review）

该文件只保存恢复所需的协调状态，不替代 plan 或 OpenSpec checkbox。当前 task 完成后保留其最终记录，开始下一个 task 时用下一 task 的记录替换。

Comet 不读取、不写入、也不要求任何 Superpowers `subagent-driven-development` 内部脚本或工作区路径。如果当前安装的 Superpowers `subagent-driven-development` 技能维护自己的临时产物、审查材料、任务需求文件或进度记录，这些都由 Superpowers 自行管理。Comet 的持久事实来源只限于 Comet workflow 状态、plan/OpenSpec checkbox 和本协调检查点。

### 5. 代码审查模式与轮次限制

> **⚠️ CRITICAL — review_mode 接管 Superpowers 默认流程，禁止双重审查**
>
> Superpowers `subagent-driven-development` 的 Process 流程图把"每个 task 后派发 task reviewer"设为必经节点。**Comet 的 `review_mode` 接管这一环节，决定哪些任务派发每任务 reviewer**（见下表每任务 reviewer 列）。**不得在 review_mode 已规定的每任务 reviewer 之外，额外按 Superpowers 默认派发 reviewer**。未派发 reviewer 的任务（`off` 全部、`standard` 非风险任务）必须直接进入 task 勾选与下一个 task 的派发。
>
> 一个 change 的审查次数由下表唯一决定，不得自行追加。

**build 阶段审查次数预算**（仅这些，不得额外增加）。本表只覆盖 build 阶段；verify 阶段有自己的审查处理（见下方说明）：

| `review_mode` | build 阶段每任务 reviewer | build 阶段最终审查 |
|---------------|--------------------------|-------------------|
| `off` | 0 | 0 |
| `standard` | 仅风险任务（见下方规则） | 1（轻量） |
| `thorough` | 每个任务（spec + quality） | 1（完整） |

**verify 阶段的审查不在此表内。** verify 阶段的审查由 `verify_mode`（light/full）驱动规模，`review_mode` 只决定是否触发自动代码审查（`off` 跳过；`standard`/`thorough` 在轻量验证下做一次轻量代码审查，在全量验证下依赖 `openspec-verify-change`）。verify 阶段没有按 `review_mode` 区分的独立"完整"代码审查——verify 阶段的权威行为见 `comet-verify`。

当 `review_mode: standard` 时，默认不为每个 task 派发 reviewer，而是按**风险触发**决定：implementer 自测、提交并回报证据（含风险信号自报）后，协调者读取自报信号并复核该 task 的 diff。**仅当 implementer 自报命中任一风险信号、或协调者复核 diff 发现命中任一风险信号时**，为该 task 单独派发一个每任务 reviewer，同时检查 spec compliance 与 code quality，发现 CRITICAL/IMPORTANT 问题进入一轮 review-fix（最多 1 轮），复查未通过则标记 **BLOCKED**。未命中风险信号的 task 直接做定向勾选验证后放行。所有 task 完成后仍派发一次最终轻量 code reviewer（范围：正确性、安全、边界）。若最终轻量审查发现 CRITICAL 或 IMPORTANT 问题，最多自动派发一轮修复 agent 并复查一次；复查仍未通过时标记 **BLOCKED**，暂停并把反馈交给用户。非 CRITICAL 发现可记录接受理由后继续。

当 `review_mode: thorough` 时，**每个 task 派发一个每任务 reviewer，同时检查 spec compliance 与 code quality**：implementer 自测、提交并回报证据后，协调者为该 task 派发一个全新后台 reviewer。reviewer 发现 CRITICAL/IMPORTANT 问题进入审查-修复（最多 2 轮），仍未通过则标记 **BLOCKED**，暂停并把反馈交给用户。所有 task 完成后再派发一次最终完整 reviewer。thorough 不做批次合并审查——高风险 change 要求每个任务即时、专注的审查，等批次边界才抓到问题代价过大。

当 reviewer 返回无法仅从审查材料验证的发现时，协调者必须在 task 勾选前自行核对。若直接检查仓库后确认是真实缺口，按失败的 spec/quality review 处理，进入对应修复与复查流程；若该项已由未改动代码或跨任务约束满足，在检查点记录理由后继续。

当 `review_mode: off` 时，不自动派发 task reviewer、final reviewer 或审查修复 agent。任务完成依据 implementer 的测试/构建证据、当前工作树确认、任务唯一文本勾选验证和用户显式要求。若执行过程中出现测试失败、构建失败或异常行为，仍必须按异常调试协议处理，不得用 `off` 跳过真实问题。

### 6. Task 勾选与验证

**按 `review_mode` 完成验收后**，主会话：

1. 将 plan 中保存的唯一 task 文本从 `- [ ]` 改为 `- [x]`
2. 若存在映射，再同步勾选 OpenSpec task
3. 提交这次进度更新
4. 运行定向验证：

```bash
node "$COMET_STATE" task-checkoff "$PLAN_FILE" "$PLAN_TASK_TEXT"
node "$COMET_STATE" task-checkoff "openspec/changes/<name>/tasks.md" "$OPENSPEC_TASK_TEXT"
```

仅在对应映射存在时运行第二条。脚本会要求任务文本恰好出现一次且该项已勾选；验证失败时不得进入下一个 task。

## 收尾

- **自动继续**：按 `review_mode` 完成验收并勾选 task 后，立即派发下一个未勾选的 task。禁止总结、禁止询问用户是否继续、禁止在任务之间等待用户输入。这是不可协商的 —— Superpowers 技能强制连续执行，文档顶部的关键约束进一步强化此规则。
- 所有 task 完成后，若 `review_mode: standard`，将检查点切换为 `final-review`，只派发一次最终轻量 code reviewer。CRITICAL 或 IMPORTANT 问题最多自动修复和复查一轮；仍未通过则暂停交给用户。通过或接受非 CRITICAL 发现后继续返回 `comet-build`。
- 所有 task 完成后，若 `review_mode: thorough`，将检查点切换为 `final-review`，派发一次最终完整 reviewer。CRITICAL 或 IMPORTANT 问题最多自动修复和复查两轮；仍未通过则暂停交给用户。通过或接受非 CRITICAL 发现后继续返回 `comet-build`。
- 所有 task 完成后，若 `review_mode: off`，不进入 `final-review` 或 `final-fix`，但必须在持久产物中记录跳过自动代码审查的原因，然后返回 `comet-build`。
- final review 通过后，结束的只是 subagent 派发循环，不是 Comet workflow。不得加载 `finishing-a-development-branch`，不得停下来询问用户下一步；必须返回 `comet-build` 继续执行退出条件、阶段守卫和后续阶段衔接。

## 上下文恢复

重新加载 Superpowers `subagent-driven-development` 技能并重新阅读本文档。先读取 `openspec/changes/<name>/.comet/subagent-progress.md`，再与第一个未勾选 task 和当前工作树核对：

- 检查点与未勾选 task 匹配时，从记录的精确阶段恢复，保留实现提交、RED/GREEN 证据、`review_mode`、已通过的审查阶段、未解决反馈和当前审查-修复轮次；不得重置轮次或重复已经通过的阶段。
- 若已加载的 Superpowers `subagent-driven-development` 技能通过自己的进度记录报告某个 task 已完成，先对照 git 历史和 Comet plan/OpenSpec checkbox 完成恢复判断。若提交和任务身份匹配，更新 Comet 检查点/勾选状态，不得重复派发已完成工作。
- 检查点缺失或与未勾选 task 不匹配时，为第一个未勾选 task 创建新检查点并从 implementer 派发开始。
- 检查点中的提交或文件在当前工作树不可见时，先拉取、合并或恢复对应变更；不得假定实现已存在。
- 所有 task 已勾选且检查点处于 `final-review` 或 `final-fix` 时，从最终审查的精确阶段恢复，并保留最终反馈和审查-修复轮次；不得重新进入已完成的 task。

已提交但未按 `review_mode` 完成验收的 task 保持未勾选，并按检查点重新进入对应的验证、审查或修复流程。
