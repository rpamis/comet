# Subagent 驱动开发的 Comet 扩展

规范路径：`comet/reference/subagent-dispatch.md`

本文档提供在 Superpowers `subagent-driven-development` 技能**之上**应用的 Comet 专属扩展。该技能负责核心派发循环（每个 task 派发全新 implementer → spec compliance review → code quality review → 下一个 task）并强制连续执行。本文档添加 Comet 特有的真实后台调度、任务追踪、状态验证、代码审查模式和上下文恢复。若 Superpowers 技能与本文档发生冲突时，以本文档中更具体的 Comet 约束为准。

> **⚠️ 关键约束 — 任务之间禁止暂停**
>
> 当一个 task 按 `review_mode` 完成验收并被勾选后，**立即派发下一个 task**，不得停止、总结或询问用户是否继续。用户期望所有 task 按顺序自动执行，无需手动干预。任务之间暂停会中断工作流，导致用户每次都需要手动恢复。
>
> 仅在以下情况才停止并等待用户输入：
> - 任务处于 **BLOCKED** 状态（`review_mode: standard` 下一轮轻量复查仍未通过，或 `review_mode: thorough` 下批次/最终审查 2 轮审查-修复仍未通过）
> - 存在无法从仓库、计划或既有上下文消除的真实歧义
> - 平台没有真实后台 agent 调度能力，需要用户改选 `executing-plans`
> - 用户**明确**要求暂停
>
> 此规则适用于整个派发循环，而非单个任务。

## 开始前

1. 读取计划一次，按顺序提取所有未勾选 task 的完整文本。
2. 为每个 task 保存唯一标识：plan 中 checkbox 后的完整任务文本，以及它映射的 OpenSpec task 完整文本（若存在）。若文本不唯一，停止并先修正计划，禁止依赖"第一个匹配项"。
3. 尊重依赖关系；依赖尚未完成的 task 不得提前派发。

## 每个 Task 的 Comet 扩展

在每个 task 上应用这些扩展，叠加在 Superpowers 技能的派发循环之上：

### 0. 派发强制约束（关键）

主会话**仅负责协调**，禁止直接执行 task。主会话禁止修改源代码。协调者唯一允许的文件修改是 plan、OpenSpec task 和 subagent 进度检查点的持久化更新。不得把多个 task 打包给同一个 agent。每个 task 派发一个全新的后台 implementer agent；当 `review_mode` 需要审查或修复时，spec reviewer、code quality reviewer、修复 agent 和 final reviewer 也必须分别使用全新的后台 agent：

- **Claude Code**：对每个 implementer，以及 `review_mode` 要求的 spec reviewer、code quality reviewer、修复 agent 和 final reviewer 使用 `Agent` 工具并设置 `run_in_background: true`。禁止内联执行 task，禁止错误进入需要预先创建 team 的团队模式。
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

agent 回报状态必须为 `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`，并包含实现内容、测试结果、提交哈希、变更文件和顾虑。进入审查前，主会话必须确认提交和文件在当前工作树可见；若平台使用隔离副本，先拉取或合并变更。

当 `review_mode` 需要 reviewer 时，每个 reviewer prompt 必须包含完整 task、实现提交或差异以及 RED/GREEN 证据（`tdd_mode: tdd` 时）。reviewer 不得只依据 implementer 的总结进行审查。

### 2. Implementer 范围限制

implementer 只负责实现、测试和提交代码。**implementer 不得勾选 plan 或 OpenSpec task**，也不得只更新内置 Todo 或对话 checklist。

### 3. TDD 硬约束

若 `tdd_mode: tdd`，每个 implementer 和修复 agent 必须先使用 Skill 工具加载 Superpowers `test-driven-development` 技能，并在 prompt 中同时注入：

```text
You MUST follow TDD: write a failing test first, watch it fail, then write minimal code to pass. No production code without a failing test first.
```

implementer 或修复 agent 回报必须提供 **RED 失败命令与失败摘要**、**GREEN 通过命令与通过摘要**；缺少任一证据不得进入审查。spec compliance reviewer 和 code quality reviewer 都必须核验 RED/GREEN 证据与测试覆盖。

### 4. 持久进度检查点

主会话必须维护 `openspec/changes/<name>/.comet/subagent-progress.md`，并在每次派发、agent 回报、审查结果、修复轮次变化和 task 勾选后立即更新。检查点至少记录：

- 当前 plan task 唯一文本及映射的 OpenSpec task 文本
- 当前阶段：`implementing | spec-review | quality-review | checkoff | done | blocked | final-review | final-fix`
- 实现提交哈希、变更文件和 RED/GREEN 证据
- 已选择的 `review_mode`
- 已通过的审查阶段及尚未解决的 reviewer 反馈
- 当前 task、批次或 final review 的审查-修复轮次（`standard` 最多 1 轮，`thorough` 最多 2 轮，`off` 为 0 轮）

该文件只保存恢复所需的协调状态，不替代 plan 或 OpenSpec checkbox。当前 task 完成后保留其最终记录，开始下一个 task 时用下一 task 的记录替换。

### 5. 代码审查模式与轮次限制

当 `review_mode: standard` 时，每个 task 不自动派发 per-task reviewer；implementer 必须自测、提交并回报证据，协调者完成定向勾选验证。所有 task 完成后只派发一次最终轻量 code reviewer，审查范围限定为正确性、安全和边界条件。若最终轻量审查发现 CRITICAL 或 IMPORTANT 问题，最多自动派发一轮修复 agent 并复查一次；复查仍未通过时标记 **BLOCKED**，暂停并把反馈交给用户。非 CRITICAL 发现可记录接受理由后继续。

当 `review_mode: thorough` 时，不执行每 task 双审查。协调者按批次或风险边界运行合并审查：每完成最多 3 个 task、或完成一个跨模块/高风险边界时，派发一个 reviewer 同时检查 spec compliance 与 code quality。若总 task 数不超过 3 且没有高风险边界，可跳过中途批次审查，只做最终完整审查。所有 task 完成后再派发一次最终完整 reviewer。批次和最终审查各最多 2 轮审查-修复；仍未通过则标记 **BLOCKED**，暂停并把累计反馈交给用户。

当 `review_mode: off` 时，不自动派发 spec reviewer、code quality reviewer、final reviewer 或审查修复 agent。任务完成依据 implementer 的测试/构建证据、当前工作树确认、任务唯一文本勾选验证和用户显式要求。若执行过程中出现测试失败、构建失败或异常行为，仍必须按异常调试协议处理，不得用 `off` 跳过真实问题。

### 6. Task 勾选与验证

**按 `review_mode` 完成验收后**，主会话：

1. 将 plan 中保存的唯一 task 文本从 `- [ ]` 改为 `- [x]`
2. 若存在映射，再同步勾选 OpenSpec task
3. 提交这次进度更新
4. 运行定向验证：

```bash
"$COMET_BASH" "$COMET_STATE" task-checkoff "$PLAN_FILE" "$PLAN_TASK_TEXT"
"$COMET_BASH" "$COMET_STATE" task-checkoff "openspec/changes/<name>/tasks.md" "$OPENSPEC_TASK_TEXT"
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
- 检查点缺失或与未勾选 task 不匹配时，为第一个未勾选 task 创建新检查点并从 implementer 派发开始。
- 检查点中的提交或文件在当前工作树不可见时，先拉取、合并或恢复对应变更；不得假定实现已存在。
- 所有 task 已勾选且检查点处于 `final-review` 或 `final-fix` 时，从最终审查的精确阶段恢复，并保留最终反馈和审查-修复轮次；不得重新进入已完成的 task。

已提交但未按 `review_mode` 完成验收的 task 保持未勾选，并按检查点重新进入对应的验证、审查或修复流程。
