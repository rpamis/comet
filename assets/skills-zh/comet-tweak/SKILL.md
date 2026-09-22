---
name: comet-tweak
description: '使用 Classic 预设流程完成单个 change 的轻量调整。在用户明确调用 /comet-tweak、选择 tweak，或恢复 workflow: tweak 时使用。'
---

# Comet 预设路径：Tweak

开始或恢复任务前，必须先读取并遵守 `comet-classic/reference/classic-layout.md`。本文件中的 OpenSpec CLI 调用必须通过适配器执行，文件路径必须基于该协议绑定的 `<classic-*>` 逻辑根目录。

Tweak 为 Comet 五阶段流程提供一组预设配置。它通过 OpenSpec 完成需求与实施工作，复用 open、build、verify、archive 阶段，跳过 Superpowers brainstorming 和完整实施计划，不另建一套独立流程。

适用于配置调整、文档或提示词优化等轻量改动，也适用于需要依据 spec（含 delta spec）实施、但不需要完整 `/comet-classic` 深度设计的中等变更。Tweak 正常支持 delta spec，不能仅因为需要 delta spec 就要求升级流程。

**适用条件**（必须全部满足）：

1. 可以在**单个 OpenSpec change** 中完成
2. 无需通过 Superpowers Design Doc 和完整实施计划，就能明确方案
3. 不涉及跨模块、跨层级的架构协调
4. 任务规模可预估（文件数和任务数仅作提示，不会自动要求升级，见下方升级判定）

**不适用**：变更过程中如发现「升级判定」章节列出的变化，需要由用户决定是否改用完整 `/comet-classic` 流程。

---

## 流程（预设流程，4 阶段）

### 0. 设置输出语言

精简版 OpenSpec 产物必须使用 Comet 配置产物语言。`.comet.yaml` 尚不存在时依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `classic.language`，初始化后使用 `comet state get <name> language` 读取。

执行顺序：open → OpenSpec apply → verify → archive。Tweak 预设各阶段的执行方式：创建必要文档，通过 OpenSpec apply 直接构建，根据改动规模和 delta spec 选择轻量或完整验证，验证通过后进入归档前的最终确认。

开始前，按 `comet-classic/reference/scripts.md` 使用正式支持的 Comet CLI；从任意入口恢复任务时，先按 `comet-classic/reference/context-recovery.md` 检查 phase/workflow。

恢复已有 tweak change 时，第一项状态操作必须是 `comet state select <change-name>`；创建新 change 时，在 `.comet.yaml` 初始化成功后立即运行该命令，再进入源码写入步骤。

进入 tweak 工作区并读取当前状态 `phase` 后，运行 `comet task <project-root> --task "<用户原始请求>" --phase "<phase>" --session "<本次任务稳定标识>" --json`，按以下规则使用返回的上下文：

- 只将返回的 `text` 加入当前上下文。Context Manifest（`manifest` / `<context_manifest>`）只包含摘要、应用原因和固定 ID；需要正文、来源或验证方式时，增加 `--expand-context "<id>"`。路径、操作或阶段变化后，使用同一 `--session` 重新选择适用条目。
- 用户明确要求长期记住时，调用 `comet memory remember ... --scope global|project`。对于用户未明确要求记忆、但可重复采用且相对稳定的协作方式，才调用 `comet memory observe`；不得保存任务摘要、进展、命令输出或测试结果。
- 任务结束前，将本次验证过且未来任务仍可复用的项目经验写入项目记忆：`comet knowledge remember <project-root> --title "<简明标题>" --text "<现象、做法、验证结果>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --json`。同一标题默认更新已有条目；没有可复用经验时跳过，任务摘要、一次性命令输出和未验证的猜测不得写入项目记忆。
- 实际使用某条记录、且使用结果已经明确后，取 `applications[].applicationId`（Hook 文本中的 `application_id`），运行 `comet task <project-root> --task "<用户原始请求>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`，记录使用结果。
- 任务结束前完成一次学习检查：有明确后续复用条件的用户纠正、偏好或协作习惯先调用 `comet memory observe`，再在完成命令中传 `--learning-check submitted`；确认没有合格观察时传 `--learning-check no-observation`，没有执行检查时传 `--learning-check not-run`。观察 JSON 的 `learning.result` 和 `status.learning.lastCheck` 用于区分候选、晋级、去重和跳过；不要提交任务摘要或测试结果。
- 任务结束时，仍须运行带 `--complete --workflow <workflow> --change <change-id> --learning-check submitted|no-observation|not-run` 的 `comet task`。没有 Hook 时，由本 Skill 调用相同接口；`comet memory context` 只作为兼容入口。插件失败不阻断本次变更。

### 1. 快速开启（预设 open）

复用 Comet open 创建 change，并采用 tweak 默认配置：不执行 `openspec-explore` 的完整探索，直接创建本次变更所需的文档。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 加载后，不执行其中直接运行官方 CLI、采用固定 cwd 或读写固定 OpenSpec 目录的指令。所有 OpenSpec 命令改用 `comet classic openspec -- <args...>`，所有 change 与产物路径改用本轮绑定的 `<classic-*>` 逻辑根目录。

技能加载后，按其指引创建精简版产物：

- `proposal.md` — 变更动机 + 目标 + 范围
- `design.md` — 简短实现说明（无需方案对比）
- `tasks.md` — 任务清单（建议控制在合理规模，数量本身不触发升级，见「升级判定」）
- `delta spec`（可选）— 变更影响已有 spec 的验收场景时，正常创建 delta spec（仅含 `## MODIFIED Requirements` 或 `## ADDED Requirements`）。OpenSpec 使用 delta spec 描述对现有系统的增量变更，不能仅因为需要这份产物就要求升级流程

开始工作前先由用户选择工作区隔离方式，不能默认写入 `current`（选 worktree 必须在初始化状态前决定——change 目录在初始化后才存在，事后补选会失败）。按 `comet-classic/reference/decision-point.md` 暂停，以单选题让用户选择：

- A. 当前分支直接工作（`--isolation current`，如实绑定当前分支）
- B. 创建分支：先创建并切换到 `tweak/YYYYMMDD/<change-name>`（`--isolation branch`）
- C. 创建 worktree：必须先使用 Skill 工具加载 Superpowers `using-git-worktrees` 技能，由该技能创建隔离工作区（`--isolation worktree`）

随后准备工作区并在返回的 `projectRoot` 中初始化与选中 change：

```bash
comet classic workspace prepare <name> --isolation <selected-isolation> --json
cd <返回的 projectRoot>
comet state init <name> tweak --isolation <selected-isolation>
comet state select <name>
comet state check <name> open
```

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

阶段守卫完成 open → build 过渡：

```bash
comet guard <change-name> open --apply
```

### 2. OpenSpec apply 构建（tweak 专用预设 build）

使用 tweak 默认值：`build_mode: direct`。`isolation` 必须沿用 Step 1 中用户已确认的工作区隔离方式，不得自行改回 `current`。跳过 Superpowers `brainstorming` 和 `writing-plans`，由 OpenSpec 的 apply action 执行当前 change 的任务。

<IMPORTANT>
这条 apply 路径只属于 tweak。完整 `/comet-classic` 或 `workflow: full` 不得套用 tweak 的 `openspec-apply-change` 构建路径。full 仍必须先通过 `/comet-design` 生成 Design Doc，再由 `/comet-build` 按已确认的策略制定计划并实施；autonomous 无需加载 `writing-plans`，其他策略按 `/comet-build` 的要求使用相应规划与执行 Skill。
</IMPORTANT>

开始或继续修改前，按 `comet-classic/reference/dirty-worktree.md` 处理未提交改动。确认改动归属后，如发现下文列出的升级条件，或改动文件数超过提示阈值，按本文件「升级判定」处理。

**立即执行：** 使用 Skill 工具加载 `openspec-apply-change` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 加载后只采用其 apply 方法。直接运行官方 CLI、采用固定 cwd 或读写固定 OpenSpec 目录的指令，都必须改为通过 `comet classic openspec -- <args...>` 执行，并使用 `<classic-*>` 逻辑根目录。

技能加载后，以当前 `<change-name>` 作为输入，按 `openspec-apply-change` 的指引执行 OpenSpec apply 流程：

1. 运行 `comet classic openspec -- status --change "<name>" --json`，或使用该命令仍然有效的结果，确认 schema 和任务产物
2. 运行 `comet classic openspec -- instructions apply --change "<name>" --json`，或使用该命令仍然有效的结果，读取 OpenSpec 返回的 apply 指令、`contextFiles`、任务进度和本次生成的 instruction
3. 读取 apply 指令列出的全部上下文文件，不能只凭旧对话，或自行遍历 tasks 就开始实现
4. 按 apply 指令逐个完成未勾选任务，保持改动最小且聚焦
5. 每完成一个任务后：
   - 运行项目格式化命令（如 `mvn spotless:apply`、`npm run format` 等）
   - 运行相关测试确认通过
   - 按 `openspec-apply-change` 规则将对应 task 勾选为完成
   - 提交代码，commit message 格式：`tweak: <简述变更>`
6. 全部任务完成后，显式运行项目相关测试和构建命令
7. 运行阶段守卫完成 build → verify 过渡

执行 tweak 期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

根因调查、最小失败测试、修复后的验证，以及如何在当前 change 中完成这些步骤，均按 `comet-classic/reference/debug-gate.md` 执行。

**升级判定检查**：在整个 build 阶段持续判断是否仍适合 tweak，并在运行 build→verify 守卫前集中复核一次。具体按「升级判定」章节处理：

- Agent 根据改动内容，判断是否出现需要重新评估流程的变化。
- 文件数量只用于提示用户复核范围；超过阈值且没有有效授权时，由用户决定是否升级。
- scale 脚本只建议采用轻量还是完整验证，不决定是否升级流程。

出现升级条件，或文件数超过提示阈值且没有有效授权时，**不得自行升级，也不得自行决定继续使用 tweak**。必须按 `comet-classic/reference/decision-point.md` 暂停，让用户选择继续 tweak 轻量流程，还是改用完整 `/comet-classic`；命中有效授权时按下方报告要求继续，不重新提问。

运行阶段守卫完成 build → verify 过渡：

```bash
comet guard <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 3. 验证（预设 verify）

复用 `/comet-verify`，由 comet-verify 的规模评估决定轻量或完整验证。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

**带 delta spec 的验证分流**：tweak 接受 delta spec 作为正常产物。若本次 change 创建了 delta spec，进入 comet-verify 前显式设置完整验证模式，走 OpenSpec 原生验证（`openspec-verify-change`）以覆盖 delta spec 一致性：

```bash
comet state set <change-name> verify_mode full
```

无 delta spec 的 tweak 通常满足轻量验证条件（≤ 3 tasks、改动文件数低于 scale 阈值），按 comet-verify 的轻量验证清单逐项检查。若用户希望增加审查，可在验证前运行 `comet state set <name> review_mode standard` 或 `thorough`。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。验证通过后仍必须进入 `/comet-archive` 的归档前最终确认，不得自动运行归档脚本。

### 4. 归档（预设 archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`，并等待 `/comet-archive` 的归档前最终确认。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。

---

## 连续执行模式

<IMPORTANT>
Tweak 默认连续执行。调用 `/comet-tweak` 后，Agent 自动推进 tweak 的各个步骤，不额外暂停。若 `auto_transition: false`，则在阶段之间（build/verify/archive）结束当前调用，按 `HINT` 提示用户稍后手动运行下一阶段命令，不再追加确认问题。无论 `auto_transition` 取何值，遇到以下情况仍须暂停，请用户决定：

1. 遇到升级判定信号（见「升级判定」章节），**必须暂停、展示选择并等待用户明确选择**：继续 tweak 轻量流程，还是升级为完整 `/comet-classic` 流程
2. 验证阶段（comet-verify）需要接受 WARNING/SUGGESTION 偏差、处理 Spec 不一致，或决定达到自动修复上限后如何继续；前 3 次明确可修复的失败自动修复并重新验证
3. 归档前在一个最终确认中选择是否归档及归档提交的交付方式

执行顺序：快速开启 → 构建（含升级判定检查）→ 验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级判定

tweak 的升级判定只决定是否从轻量预设转为 full。需要 delta spec 或文件数量较多，都不会自动触发升级。`comet state scale` 只建议采用轻量还是完整验证，不写入配置；最终由 Verify 根据实际风险选择。

如果 `/comet-classic` 入口已传入需求意图摘要（intent frame），tweak 在 build 前只复核 `risk_signal`，以及是否新增功能、引入公共 API、修改结构化数据格式（schema）、需要跨模块协调或涉及深层架构问题。出现这些情况时，按本节请用户决定是否升级。delta spec 仍是 tweak 正常支持的产物，不能因为它存在就自动升级；不重新判断入口已经识别的用户意图。

实施过程中，持续检查是否出现以下需要重新评估流程的变化：

- 需要协调修改多个模块
- 需要新增功能
- 需要修改数据库 schema
- 需要引入新的公共 API
- 涉及深层架构问题
- 当前 tweak 需要拆分为多个 OpenSpec changes

出现任一情况时，Agent **不得自行升级，也不得自行决定继续使用 tweak**。

文件数量只触发范围复核，不等同于实质升级信号。改动文件数超过提示阈值（如 > 6 个文件）时，先统计当前 change 的交付文件，再按下文检查是否存在有效的用户授权；文件多不代表一定需要完整流程。Tweak 常包含 delta spec 或配置调整，通常比缺陷修复涉及更多文件，因此提示阈值高于 hotfix。

交付文件只包括源码、测试、用户文档、配置和生成物。统计覆盖确认基线之后已提交的变更、暂存、未暂存和未跟踪文件，并按路径去重；排除当前 change 目录中的 OpenSpec 产物、`.comet` 元数据以及与当前 change 无关的脏文件。不能把 OpenSpec 产物或无关脏文件计入阈值，也不能因为文件数量较少而跳过实质升级信号检查。

### 文件数超限时复用当前 change 的明确授权

只有当前 change 的用户明确授权“范围、风险不变且仅文件数超限时继续”，才能建立或复用授权。普通开始修复、调用 Skill、历史偏好或 Personal Memory 都不是授权。授权记录只写入 `<classic-change-dir>/.comet/rulings.md`，并使用以下稳定结构；change 目录尚未初始化时，先保留待写入状态，不能假定授权已经成立：

```text
### Preset file-count authorization
- status: active|invalidated
- workflow: tweak
- decision: continue-on-file-count-only
- scope: <当前 change 已确认的范围>
- allowed-file-categories: implementation, tests, user-docs, config, generated
- authorization-basis: user-explicit
- reason: <用户授权依据和继续理由>
```

没有有效 ruling 的首次超过阈值时，仍按 `comet-classic/reference/decision-point.md` 暂停并让用户选择继续 tweak（选项 A）或升级 full（选项 B）。只有用户明确选择 A，并明确说明范围、风险不变且仅文件数超限，才写入上述 ruling；后续同一范围内的文件增长可以复用 `status: active` 的记录而不重复提问。已有有效授权时不提问，但必须先报告文件总数、分类、与确认范围的对应关系、ruling 记录位置，以及没有命中实质升级信号的依据，然后继续 tweak；验证深度仍按实际风险和 `comet state scale` 的建议决定。

恢复任务时，先读取当前 change 的 ruling。有效的 `status: active` 记录按同样条件继续；`status: invalidated`、缺失、不可读、含糊或与当前 scope 不匹配时，必须暂停并重新提供继续 tweak 或升级 full 的选择。

只有同时满足以下条件，`status: active` 才有效：`workflow` 与当前 tweak 匹配，scope、验收和风险假设没有变化，所有新增交付文件仍在 `allowed-file-categories` 内，且当前触发原因只有文件数超限。用户撤销授权、切换 workflow、范围或验收变化、出现新的模块/API/schema/capability/架构问题（例如新增公共 API、修改结构化数据格式（schema）），或文件落到授权类别之外时，必须把记录标为 `status: invalidated` 并回到暂停流程。`rulings.md` 缺失、不可读、含糊或已失效时，无有效授权时必须暂停；升级到 full 时也将记录标为 `status: invalidated`，之后不得继续复用该授权。

因此，出现任何实质升级信号，或没有有效授权而改动文件数超过提示阈值时，必须按 `comet-classic/reference/decision-point.md` 暂停并等待用户明确选择。不得直接进入 `/comet-design`，也不得自动补充 Design Doc。

用户选择升级（选项 B）后，运行状态机提供的升级命令，将预设流程转为 full，并回到 design 阶段：

```bash
comet state transition <name> preset-escalate
```

该命令会原子地将 `workflow`/`classic_profile` 设为 `full`、将 `phase` 改为 `design`、清空 `design_doc`，并清除预设专属的 `build_mode`、`tdd_mode`、`review_mode`、`isolation` 和 `verify_mode`。然后，**立即使用 Skill 工具加载 `comet-design` skill**，在当前 change 的基础上补充 Design Doc。进入 build 后，必须在同一轮提问中重新确认完整的工作方式配置。

用户选择继续（选项 A）时，只有在用户明确确认范围和风险不变且仅文件数超限时，才继续 tweak，并按上述结构记录用户授权依据和继续理由；仅说“开始修复”或“继续”而没有这项授权语义时，仍按暂停流程等待澄清。

---

## 退出条件

- 变更已完成，测试通过
- change 已归档
- 如有 spec 变更，已同步到 main spec
- **阶段守卫**：build → verify 前运行 `comet guard <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `comet guard <change-name> verify --apply`

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 和成功结果中的 `agent.continuation` 继续。已有仍然有效的状态信息时，不重复 next、select 或 check。只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供这些信息时，才运行：

```bash
comet state next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续 tweak 流程（`phase: build` 返回 `comet-tweak`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`）
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
