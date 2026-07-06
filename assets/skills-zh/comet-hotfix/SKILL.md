---
name: comet-hotfix
description: "Use when 用户要修复已有行为 bug，且不新增 capability、不需要完整设计；也用于恢复 hotfix workflow。"
---

# Comet 预设路径：Hotfix

快速 bug fix 工作流：open → build → verify → archive。跳过 brainstorming 和完整 plan，适用于行为修复、不涉及新 capability 设计的场景。

**适用条件**（必须全部满足）：
1. 修复已有功能的 bug，不新增 capability
2. 不涉及接口变更或架构调整
3. 改动范围可预估（文件数仅作提示，不作为硬性升级条件，见下方升级判定）

**不适用**：如修复过程命中质变信号（见「升级判定」章节），由用户决定是否升级为完整 `/comet` 流程。

---

## 流程（预设流程，6 步）

### 0. 输出语言约束

精简版 OpenSpec 产物必须使用 Comet 配置产物语言。`.comet.yaml` 尚不存在时读取 `.comet/config.yaml` 的 `language`，初始化后使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取。

执行链路：open → build → verify → archive。Hotfix 为每个阶段提供默认决策：精简开启、直接构建、按规模验证、验证通过后进入归档前最终确认。

开始前按 `comet/reference/scripts.md` 定位 Comet 脚本（定位 `comet-env.mjs`）；从任意入口恢复时先按 `comet/reference/context-recovery.md` 确认 phase/workflow。

### 1. 快速开启（预设 open）

复用 Comet open 能力创建 change，但使用 hotfix 默认值：不执行 `openspec-explore` 长探索，直接进入精简 change 创建。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

技能加载后，按其指引创建精简版产物：
  - `proposal.md` — 问题描述 + 根因分析 + 修复目标（无需方案对比）
  - `design.md` — 修复方案（1 个即可，无需多方案对比）
  - `tasks.md` — 修复任务清单
- **无需 delta spec**（除非修复改变了已有 spec 的验收场景）

初始化 Comet 状态文件：

```bash
node "$COMET_STATE" init <name> hotfix
```

初始化后验证状态：

```bash
node "$COMET_STATE" check <name> open
```

阶段守卫完成 open → build 过渡：

```bash
node "$COMET_GUARD" <change-name> open --apply
```

检查 `auto_transition` 决定是否继续：

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → 继续 Step 2
- `NEXT: manual` → 暂停，按 `HINT` 提示用户手动运行 `/<SKILL>`

### 2. 直接构建（预设 build）

使用 hotfix 默认值：`build_mode: direct`，`review_mode: off`（hotfix/tweak 跳过 review_mode 选择——guard 不要求预设工作流选择此项）。跳过 Superpowers `brainstorming` 和 `writing-plans`（除非任务 > 3 个；若超过 3 个任务，转入 `/comet-build` 的计划与执行方式选择——注意这不触发 full workflow 升级，仅切换执行方式）。

继续或开始修改前，按 `comet/reference/dirty-worktree.md` 协议处理未提交改动。若归因后发现修复命中质变信号或文件数 tripwire，按本文件「升级判定」处理。

**立即执行：** 按 tasks.md 逐个执行任务：

1. 读取 `openspec/changes/<name>/tasks.md`，获取未完成任务列表
2. 对每个未完成任务：
   - 根据任务描述修改代码
   - 运行项目格式化命令（如 `mvn spotless:apply`、`npm run format` 等）
   - 运行相关测试确认通过
   - 将 tasks.md 中对应 `- [ ]` 勾选为 `- [x]`
   - 提交代码，commit message 格式：`fix: <简述修复>`
3. 全部任务完成后，显式运行项目相关测试和构建命令

执行 hotfix 期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

具体调查、最小失败测试、修复验证和保持当前 change 验证闭环的要求，按 `comet/reference/debug-gate.md` 执行。

**如修复影响已有 spec 验收场景**：
- 在 `openspec/changes/<name>/specs/<capability>/spec.md` 创建 delta spec
- 仅包含 `## MODIFIED Requirements` 部分

### 3. 根因消除检查

**在运行 build guard 之前执行**，确保修复确实消除了问题根因：

1. 读取 proposal.md 中的 bug 描述和根因
2. 搜索验证问题代码不再存在
3. 如根因未消除，回到 Step 2 继续修复（此时仍在 build 阶段，无需状态回退）

**升级判定信号**：
- 根因消除检查发现深层架构问题 → 命中质变信号，按「升级判定」章节暂停交用户决定
- 修复需要额外接口变更 → 命中质变信号（引入新的 public API），按「升级判定」章节暂停交用户决定

根因确认消除后，运行阶段守卫完成 build → verify 过渡：

```bash
node "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 4. 验证（预设 verify）

复用 `/comet-verify`，由 comet-verify 的规模评估决定轻量或完整验证。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

无 delta spec 的小范围 hotfix 通常满足轻量验证条件（≤ 3 tasks、改动文件数低于 scale 阈值），comet-verify 的规模评估会选择轻量验证路径（6 项快速检查；默认 `review_mode: off` 时不自动派发代码审查）。若用户希望增加审查，可在验证前运行 `node "$COMET_STATE" set <name> review_mode standard` 或 `thorough`。若 hotfix 创建了 delta spec，则根据 comet-verify 的规模评估规则进入完整验证路径。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。验证通过后仍必须进入 `/comet-archive` 的归档前最终确认，不得自动运行归档脚本。

### 5. 归档（预设 archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`，并等待 `/comet-archive` 的归档前最终确认。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。
如有 delta spec，按 comet-archive 规则同步到 main spec，并处理关联 Design Doc 与 Plan 的归档标注。

---

## 连续执行模式

<IMPORTANT>
Hotfix 流程默认 **一次性连续执行**。调用 `/comet-hotfix` 后，agent 在 hotfix 自有步骤间自动推进，不主动停顿。**例外**：若 `auto_transition: false`，则在每个 phase 边界（build/verify/archive 之间）停下，由用户手动运行下一阶段命令——此时连续执行降级为逐阶段手动推进，详见下方「自动衔接下一阶段」。但无论 `auto_transition` 取何值，以下情况都必须暂停等待用户确认：

1. 遇到升级判定信号（见「升级判定」章节），**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确选择**：继续 hotfix 流程，还是升级为完整 `/comet` 流程
2. 任务超过 3 个转入 `/comet-build` 时的工作区隔离和执行方式选择
3. 验证阶段（comet-verify）的验证失败决策和分支处理决策
4. 归档前最终确认（comet-archive 执行归档脚本前）

执行顺序：快速开启 → 直接构建 → 根因消除检查 → 验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级判定

hotfix 的升级判定只决定是否从预设流程转为 full；文件数不自动升级，`comet-state scale` 只决定验证轻重。

若由 `/comet` 入口传入 intent frame，hotfix 在 build 前只复核 `risk_signal` 和升级信号：新增 capability、public API、schema 变更、跨模块协调或深层架构问题。命中时进入现有升级决策点；不得重新实现入口意图识别。

持续检查以下质变信号：跨模块协调修改、需要新增 capability、数据库 schema 变更、引入新的 public API、触及深层架构问题（hotfix 语境下多在根因消除检查时暴露）。命中任一信号时，agent **不得自行升级或自行判定可继续**。

文件数 tripwire 仅作提示：改动文件数超过提示阈值（如 > 4 个文件）时，也交给用户决定继续 hotfix 还是升级 full；文件数多不等于质变。bug 修复通常聚焦在 1-3 个文件，超过阈值说明改动面偏大、值得让用户复核是否仍属预设范围。

命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**。不得直接进入 `/comet-design`，不得自动补充 Design Doc。

用户选择升级（选项 B）后，使用状态机合法的升级通道，单条命令完成预设流程 → full 转换并回退到 design 阶段：

```bash
node "$COMET_STATE" transition <name> preset-escalate
```

该命令原子地把 `workflow`/`classic_profile` 置为 `full`、`phase` 回退到 `design`、清空 `design_doc`（满足 comet-design 入口要求）。然后在当前 change 基础上补充 Design Doc：**立即使用 Skill 工具加载 `comet-design` skill**，后续正常走完整流程。

用户选择继续（选项 A）时，继续 hotfix 流程，并记录用户确认继续的原因。

---

## 退出条件

- Bug 已修复，测试通过
- change 已归档
- 如有 spec 变更，已同步到 main spec
- **阶段守卫**：build → verify 前运行 `node "$COMET_GUARD" <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `node "$COMET_GUARD" <change-name> verify --apply`

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
node "$COMET_STATE" next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续 hotfix 流程（`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`）
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
