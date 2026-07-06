---
name: comet-tweak
description: "Use when 用户要进行可收敛为单一 OpenSpec change 的轻量或中等变更，且不需要完整设计；也用于恢复 tweak workflow。"
---

# Comet 预设路径：Tweak

Tweak 是 Comet 五阶段能力的预设工作流，不是独立的平行流程。它串联 OpenSpec 的核心流程，复用 open、build、verify、archive 能力，仅跳过 Superpowers brainstorming 和完整 plan。

适用于串联 OpenSpec 的轻量改动，例如配置调整、文档或 prompt 优化，以及需 spec 驱动（含 delta spec）但不需要完整 `/comet` 深度设计流程的中等变更。delta spec 在 tweak 中是一等公民正常产物，需要 delta spec 本身不构成升级理由。

**适用条件**（必须全部满足）：
1. 可收敛为**单一 OpenSpec change**
2. 不需要 Superpowers Design Doc 和完整 plan 才能澄清方案
3. 不涉及跨模块、跨层级的架构协调
4. 任务规模可预估（文件数和任务数仅作提示，不作为硬性升级条件，见下方升级判定）

**不适用**：如变更过程中命中质变信号（见「升级判定」章节），由用户决定是否升级为完整 `/comet` 流程。

---

## 流程（预设流程，4 阶段）

### 0. 输出语言约束

精简版 OpenSpec 产物必须使用 Comet 配置产物语言。`.comet.yaml` 尚不存在时读取 `.comet/config.yaml` 的 `language`，初始化后使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取。

执行链路：open → OpenSpec apply → verify → archive。Tweak 为每个阶段提供默认决策：精简开启、通过 OpenSpec apply 直接构建、按规模与 delta spec 判定验证轻重、验证通过后进入归档前最终确认。

开始前按 `comet/reference/scripts.md` 定位 Comet 脚本（定位 `comet-env.mjs`）；从任意入口恢复时先按 `comet/reference/context-recovery.md` 确认 phase/workflow。

### 1. 快速开启（预设 open）

复用 Comet open 能力创建 change，但使用 tweak 默认值：不执行 `openspec-explore` 长探索，直接进入精简 change 创建。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

技能加载后，按其指引创建精简版产物：
  - `proposal.md` — 变更动机 + 目标 + 范围
  - `design.md` — 简短实现说明（无需方案对比）
  - `tasks.md` — 任务清单（建议控制在合理规模，数量本身不触发升级，见「升级判定」）
  - `delta spec`（可选）— 若变更影响已有 spec 的验收场景，作为正常产物创建（仅含 `## MODIFIED Requirements` 或 `## ADDED Requirements`）。delta spec 是 OpenSpec brownfield 改动的核心产物，需要 delta spec 本身不构成升级理由

初始化 Comet 状态文件：

```bash
node "$COMET_STATE" init <name> tweak
```

初始化后验证状态：

```bash
node "$COMET_STATE" check <name> open
```

阶段守卫完成 open → build 过渡：

```bash
node "$COMET_GUARD" <change-name> open --apply
```

### 2. OpenSpec apply 构建（tweak 专用预设 build）

使用 tweak 默认值：`build_mode: direct`。跳过 Superpowers `brainstorming` 和 `writing-plans`，改由 OpenSpec 的 apply action 执行当前 change 的 tasks。

<IMPORTANT>
这条 apply 路径只属于 tweak。完整 `/comet` 或 `workflow: full` 不得套用 tweak 的 `openspec-apply-change` 构建路径；full 仍必须先通过 `/comet-design` 生成 Design Doc，再由 `/comet-build` 通过 Superpowers `writing-plans`、执行方式选择和对应执行技能完成构建。
</IMPORTANT>

继续或开始修改前，按 `comet/reference/dirty-worktree.md` 协议处理未提交改动。若归因后发现命中质变信号或文件数 tripwire，按本文件「升级判定」处理。

**立即执行：** 使用 Skill 工具加载 `openspec-apply-change` 技能。禁止跳过此步骤。

技能加载后，以当前 `<change-name>` 作为输入，按 `openspec-apply-change` 的指引执行 OpenSpec apply 流程：

1. 运行或遵循 `openspec status --change "<name>" --json`，确认 schema 和任务 artifact
2. 运行或遵循 `openspec instructions apply --change "<name>" --json`，读取 OpenSpec 返回的 apply 指令、`contextFiles`、任务进度和动态 instruction
3. 读取 apply 指令列出的所有 context files，不得只凭旧对话或手写 tasks 循环实现
4. 按 apply 指令逐个完成未勾选任务，保持改动最小且聚焦
5. 每完成一个任务后：
   - 运行项目格式化命令（如 `mvn spotless:apply`、`npm run format` 等）
   - 运行相关测试确认通过
   - 按 `openspec-apply-change` 规则将对应 task 勾选为完成
   - 提交代码，commit message 格式：`tweak: <简述变更>`
6. 全部任务完成后，显式运行项目相关测试和构建命令
7. 运行阶段守卫完成 build → verify 过渡

执行 tweak 期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

具体调查、最小失败测试、修复验证和保持当前 change 验证闭环的要求，按 `comet/reference/debug-gate.md` 执行。

**升级判定检查**：build 全程持续判断，并在 build→verify 守卫执行前做一次集中复核。判定采用三层分工（详见「升级判定」章节）：质变信号靠 agent 语义识别、文件数仅作提示交用户拍板、scale 脚本仅管验证轻重。命中质变信号或文件数超提示阈值时，**不得自行升级或自行判定可继续**，必须按 `comet/reference/decision-point.md` 暂停并把决策权交给用户：继续 tweak 轻量流程，还是升级为完整 `/comet`。

运行阶段守卫完成 build → verify 过渡：

```bash
node "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 3. 验证（预设 verify）

复用 `/comet-verify`，由 comet-verify 的规模评估决定轻量或完整验证。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

**带 delta spec 的验证分流**：tweak 接受 delta spec 作为正常产物。若本次 change 创建了 delta spec，进入 comet-verify 前显式设置完整验证模式，走 OpenSpec 原生验证（`openspec-verify-change`）以覆盖 delta spec 一致性：

```bash
node "$COMET_STATE" set <change-name> verify_mode full
```

无 delta spec 的 tweak 通常满足轻量验证条件（≤ 3 tasks、改动文件数低于 scale 阈值），由 comet-verify 的规模评估选择轻量验证路径（6 项快速检查）。若用户希望增加审查，可在验证前运行 `node "$COMET_STATE" set <name> review_mode standard` 或 `thorough`。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。验证通过后仍必须进入 `/comet-archive` 的归档前最终确认，不得自动运行归档脚本。

### 4. 归档（预设 archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`，并等待 `/comet-archive` 的归档前最终确认。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。

---

## 连续执行模式

<IMPORTANT>
Tweak 流程默认 **一次性连续执行**。调用 `/comet-tweak` 后，agent 在 tweak 自有步骤间自动推进，不主动停顿。**例外**：若 `auto_transition: false`，则在每个 phase 边界（build/verify/archive 之间）停下，由用户手动运行下一阶段命令——此时连续执行降级为逐阶段手动推进，详见下方「自动衔接下一阶段」。但无论 `auto_transition` 取何值，以下情况都必须暂停等待用户确认：

1. 遇到升级判定信号（见「升级判定」章节），**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确选择**：继续 tweak 轻量流程，还是升级为完整 `/comet` 流程
2. 验证阶段（comet-verify）的验证失败决策和分支处理决策
3. 归档前最终确认（comet-archive 执行归档脚本前）

执行顺序：快速开启 → 构建（含升级判定检查）→ 验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级判定

tweak 的升级判定只决定是否从轻量预设转为 full；delta spec 本身不是升级理由，文件数不自动升级，`comet-state scale` 只决定验证轻重。

若由 `/comet` 入口传入 intent frame，tweak 在 build 前只复核 `risk_signal` 和升级信号：新增 capability、public API、schema 变更、跨模块协调或深层架构问题。命中时进入现有升级决策点；delta spec 仍是 tweak 的正常产物，不因存在 delta spec 自动升级；不得重新实现入口意图识别。

持续检查以下质变信号：跨模块协调修改、需要新增 capability、数据库 schema 变更、引入新的 public API、触及深层架构问题；以及 tweak 特有信号：需要拆分为多个 OpenSpec changes。命中任一信号时，agent **不得自行升级或自行判定可继续**。

文件数 tripwire 仅作提示：改动文件数超过提示阈值（如 > 6 个文件）时，也交给用户决定继续 tweak 还是升级 full；文件数多不等于质变。tweak 常伴随 delta spec 或配置调整，波及面天然比 bug 修复宽，故提示阈值高于 hotfix。

命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**。不得直接进入 `/comet-design`，不得自动补充 Design Doc。

用户选择升级（选项 B）后，使用状态机合法的升级通道，单条命令完成预设流程 → full 转换并回退到 design 阶段：

```bash
node "$COMET_STATE" transition <name> preset-escalate
```

该命令原子地把 `workflow`/`classic_profile` 置为 `full`、`phase` 回退到 `design`、清空 `design_doc`（满足 comet-design 入口要求）。然后在当前 change 基础上补充 Design Doc：**立即使用 Skill 工具加载 `comet-design` skill**，后续正常走完整流程。

用户选择继续（选项 A）时，继续 tweak 流程，并记录用户确认继续的原因。

---

## 退出条件

- 变更已完成，测试通过
- change 已归档
- 如有 spec 变更，已同步到 main spec
- **阶段守卫**：build → verify 前运行 `node "$COMET_GUARD" <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `node "$COMET_GUARD" <change-name> verify --apply`

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续 tweak 流程（`phase: build` 返回 `comet-tweak`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`）
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
