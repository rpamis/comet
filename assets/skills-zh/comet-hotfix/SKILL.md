---
name: comet-hotfix
description: '使用 Classic 预设流程修复局部缺陷。在用户明确调用 /comet-hotfix、选择 hotfix，或恢复 workflow: hotfix 时使用。'
---

# Comet 预设路径：Hotfix

开始或恢复任务前，必须先读取并遵守 `comet-classic/reference/classic-layout.md`。本文件中的 OpenSpec CLI 调用必须通过适配器执行，文件路径必须基于该协议绑定的 `<classic-*>` 逻辑根目录。

快速缺陷修复流程：open → build → 根因消除检查 → verify → archive。跳过 brainstorming 和完整实施计划，适用于修复已有行为、不需要设计新功能的场景。

**适用条件**（必须全部满足）：

1. 修复已有功能的缺陷，不新增功能
2. 不涉及接口变更或架构调整
3. 改动范围可预估（文件数仅作提示，不会自动要求升级，见下方升级判定）

**不适用**：修复过程中如发现「升级判定」章节列出的变化，需要由用户决定是否改用完整 `/comet-classic` 流程。

---

## 流程（预设流程，6 步）

### 0. 设置输出语言

精简版 OpenSpec 产物必须使用 Comet 配置产物语言。`.comet.yaml` 尚不存在时依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `classic.language`，初始化后使用 `comet state get <name> language` 读取。

执行顺序：open → build → 根因消除检查 → verify → archive。Hotfix 预设各阶段的执行方式：创建必要文档后直接构建，检查根因是否消除，按规模选择验证方式，验证通过后进入归档前的最终确认。

开始前，按 `comet-classic/reference/scripts.md` 使用正式支持的 Comet CLI；从任意入口恢复任务时，先按 `comet-classic/reference/context-recovery.md` 检查 phase/workflow。

恢复已有 hotfix change 时，第一项状态操作必须是 `comet state select <change-name>`；创建新 change 时，在 `.comet.yaml` 初始化成功后立即运行该命令，再进入源码写入步骤。

进入 hotfix 工作区并读取当前状态 `phase` 后，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json`，按以下规则使用返回的上下文：

- 只将返回的 `text` 加入当前上下文。Context Manifest（`manifest` / `<context_manifest>`）只包含摘要、应用原因和固定 ID；需要正文、来源或验证方式时，增加 `--expand-context "<id>"`。路径、操作或阶段变化后，使用同一 `--session` 重新选择适用条目。
- 用户明确要求长期记住时，调用 `comet memory remember ... --scope global|project`。对于用户未明确要求记忆、但可重复采用且相对稳定的协作方式，才调用 `comet memory observe`；不得保存任务摘要、进展、命令输出或测试结果。
- 实际使用某条记录、且使用结果已经明确后，取 `applications[].applicationId`（Hook 文本中的 `application_id`），运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`，记录使用结果。
- 任务结束时，仍须运行带 `--complete --workflow <workflow> --change <change-id>` 的 `comet task`。没有 Hook 时，由本 Skill 调用相同接口；`comet memory context` 只作为兼容入口。插件失败不阻断缺陷修复。

### 1. 快速开启（预设 open）

复用 Comet open 创建 change，并采用 hotfix 默认配置：不执行 `openspec-explore` 的完整探索，直接创建修复所需的文档。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 加载后，不执行其中直接运行官方 CLI、采用固定 cwd 或读写固定 OpenSpec 目录的指令。所有 OpenSpec 命令改用 `comet classic openspec -- <args...>`，所有 change 与产物路径改用本轮绑定的 `<classic-*>` 逻辑根目录。

技能加载后，先创建 change 的基础目录和文件，随即初始化状态并选中当前 change，以便中断后恢复：

```bash
comet state init <name> hotfix
comet state select <name>
comet state check <name> open
```

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

开始工作时，由用户选择工作区隔离方式，不能默认写入 `current`。按 `comet-classic/reference/decision-point.md` 暂停，以单选题让用户选择：

- A. 当前分支直接工作：运行 `comet state set <name> isolation current`，如实绑定当前分支
- B. 创建分支：先创建并切换到 `hotfix/YYYYMMDD/<change-name>`，再运行 `comet state set <name> isolation branch`
- C. 创建 worktree：必须先使用 Skill 工具加载 Superpowers `using-git-worktrees` 技能，由该技能创建隔离工作区；进入 worktree 后运行 `comet state set <name> isolation worktree`

B/C 完成后，必须在实际执行分支或 worktree 中重新运行：

```bash
comet state select <name>
```

随后按指引创建精简版产物：

- `proposal.md` — 问题描述 + 根因分析 + 修复目标（无需方案对比）
- `design.md` — 修复方案（1 个即可，无需多方案对比）
- `tasks.md` — 修复任务清单
- **无需 delta spec**（除非修复改变了已有 spec 的验收场景）

阶段守卫完成 open → build 过渡：

```bash
comet guard <change-name> open --apply
```

检查 `auto_transition` 决定是否继续：

```bash
comet state next <name>
```

- `NEXT: auto` → 继续 Step 2
- `NEXT: manual` → 按 `HINT` 交还控制权并结束当前调用；不要再询问用户是否继续

### 2. 直接构建（预设 build）

使用 hotfix 默认值：`build_mode: direct`、`tdd_mode: direct`、`review_mode: off`。`isolation` 必须沿用 Step 1 中用户已确认的工作区隔离方式，不得自行改回 `current`。

`direct` 表示不采用完整的规划和逐任务 TDD 流程，仍然必须复现问题、运行回归测试并完成验证。跳过 Superpowers `brainstorming` 和 `writing-plans`；**任务数量本身不触发 `/comet-build`**。任务较多时，仍按当前 hotfix 的 tasks.md 顺序执行。只有出现后文列出的升级条件或范围超限提示时，才交给用户决定是否改用 full。

开始或继续修改前，按 `comet-classic/reference/dirty-worktree.md` 处理未提交改动。确认改动归属后，如发现修复涉及下文列出的升级条件，或改动文件数超过提示阈值，按本文件「升级判定」处理。

修改实现前，必须**先复现问题并记录失败证据**：

1. 用最小可重复步骤确认用户报告的旧行为确实失败，并记录命令、输入和实际结果
2. 能自动化时先新增一个会失败的回归测试并实际运行，确认失败原因对应本 bug，而不是环境或测试本身错误
3. 暂时无法自动化时，在 proposal/验证报告中记录不可自动化原因和可重复的手工失败证据；不得无证据直接改代码

完成 RED 证据后，按 tasks.md 逐个执行任务：

1. 读取 `<classic-change-dir>/tasks.md`，获取未完成任务列表
2. 对每个未完成任务：
   - 根据任务描述修改代码
   - 运行项目格式化命令（如 `mvn spotless:apply`、`npm run format` 等）
   - 先运行新增的失败回归测试确认转绿，再运行相关测试确认通过
   - 将 tasks.md 中对应 `- [ ]` 勾选为 `- [x]`
   - 提交代码，commit message 格式：`fix: <简述修复>`
3. 全部任务完成后，显式运行项目相关测试和构建命令

执行 hotfix 期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

根因调查、最小失败测试、修复后的验证，以及如何在当前 change 中完成这些步骤，均按 `comet-classic/reference/debug-gate.md` 执行。

**如修复影响已有 spec 验收场景**：

- 在 `<classic-change-dir>/specs/<capability>/spec.md` 创建 delta spec
- 仅包含 `## MODIFIED Requirements` 部分

### 3. 根因消除检查

**在运行 build guard 之前执行**，确保修复确实消除了问题根因：

1. 读取 proposal.md 中的 bug 描述和根因
2. 搜索相关代码，确认导致该问题的实现已被移除或修正
3. 如根因未消除，回到 Step 2 继续修复（此时仍在 build 阶段，无需状态回退）

**升级判定信号**：

- 根因消除检查发现深层架构问题：按「升级判定」章节暂停，由用户决定是否改用完整流程
- 修复需要额外接口变更，例如引入新的公共 API：按「升级判定」章节暂停，由用户决定是否改用完整流程

根因确认消除后，运行阶段守卫完成 build → verify 过渡：

```bash
comet guard <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 4. 验证（预设 verify）

复用 `/comet-verify`，由 comet-verify 的规模评估决定轻量或完整验证。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

无 delta spec 的小范围 hotfix 通常满足轻量验证条件（≤ 3 tasks、改动文件数低于 scale 阈值），按 comet-verify 的轻量验证清单逐项检查；默认 `review_mode: off` 时，不自动安排代码审查。若用户希望增加审查，可在验证前运行 `comet state set <name> review_mode standard` 或 `thorough`。若 hotfix 创建了 delta spec，则根据 comet-verify 的规模评估规则进入完整验证路径。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。验证通过后仍必须进入 `/comet-archive` 的归档前最终确认，不得自动运行归档脚本。

### 5. 归档（预设 archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`，并等待 `/comet-archive` 的归档前最终确认。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。
如有 delta spec，按 comet-archive 规则同步到 main spec，并处理关联 Design Doc 与 Plan 的归档标注。

---

## 连续执行模式

<IMPORTANT>
Hotfix 默认连续执行。调用 `/comet-hotfix` 后，Agent 自动推进 hotfix 的各个步骤，不额外暂停。若 `auto_transition: false`，则在阶段之间（build/verify/archive）结束当前调用，按 `HINT` 提示用户稍后手动运行下一阶段命令，不再追加确认问题。无论 `auto_transition` 取何值，遇到以下情况仍须暂停，请用户决定：

1. 遇到升级判定信号（见「升级判定」章节），**必须暂停、展示选择并等待用户明确选择**：继续 hotfix 流程，还是升级为完整 `/comet-classic` 流程
2. 验证阶段（comet-verify）需要接受 WARNING/SUGGESTION 偏差、处理 Spec 不一致，或决定达到自动修复上限后如何继续；前 3 次明确可修复的失败自动修复并重新验证
3. 归档前在一个最终确认中选择是否归档及归档提交的交付方式

执行顺序：快速开启 → 直接构建 → 根因消除检查 → 验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级判定

hotfix 的升级判定只决定是否从预设流程转为 full。文件数量不会自动触发升级。`comet state scale` 只建议采用轻量还是完整验证，不写入配置；最终由 Verify 根据实际风险选择。

如果 `/comet-classic` 入口已传入需求意图摘要（intent frame），hotfix 在 build 前只复核 `risk_signal`，以及是否新增功能、引入公共 API、修改结构化数据格式（schema）、需要跨模块协调或涉及深层架构问题。出现这些情况时，按本节请用户决定是否升级，不重新判断入口已经识别的用户意图。

修复过程中，持续检查是否出现以下需要重新评估流程的变化：

- 需要协调修改多个模块
- 需要新增功能
- 需要修改数据库 schema
- 需要引入新的公共 API
- 涉及深层架构问题；hotfix 中通常会在根因消除检查时发现

出现任一情况时，Agent **不得自行升级，也不得自行决定继续使用 hotfix**。

文件数量仅用于提示用户复核范围。改动文件数超过提示阈值（如 > 4 个文件）时，也由用户决定继续 hotfix 还是改用 full；文件多不代表一定需要完整流程。缺陷修复通常集中在 1-3 个文件，超过阈值说明涉及范围偏大，需要用户复核是否仍适合预设流程。

出现上述变化，或改动文件数超过提示阈值时，**必须按 `comet-classic/reference/decision-point.md` 暂停并等待用户明确选择**。不得直接进入 `/comet-design`，也不得自动补充 Design Doc。

用户选择升级（选项 B）后，运行状态机提供的升级命令，将预设流程转为 full，并回到 design 阶段：

```bash
comet state transition <name> preset-escalate
```

该命令会原子地将 `workflow`/`classic_profile` 设为 `full`、将 `phase` 改为 `design`、清空 `design_doc`，并清除预设专属的 `build_mode`、`tdd_mode`、`review_mode`、`isolation` 和 `verify_mode`。然后，**立即使用 Skill 工具加载 `comet-design` skill**，在当前 change 的基础上补充 Design Doc。进入 build 后，必须在同一轮提问中重新确认完整的工作方式配置。

用户选择继续（选项 A）时，继续 hotfix 流程，并记录用户确认继续的原因。

---

## 退出条件

- Bug 已修复，测试通过
- change 已归档
- 如有 spec 变更，已同步到 main spec
- **阶段守卫**：build → verify 前运行 `comet guard <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `comet guard <change-name> verify --apply`

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 和成功结果中的 `agent.continuation` 继续。已有仍然有效的状态信息时，不重复 next、select 或 check。只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供这些信息时，才运行：

```bash
comet state next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续 hotfix 流程（`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`）
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
