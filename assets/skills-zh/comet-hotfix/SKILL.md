---
name: comet-hotfix
description: "Comet 预设路径：Bug fix / 热修复。跳过 brainstorming，直接 open → build → verify → archive。适用于行为修复、不涉及新 capability 设计的场景。"
---

# Comet 预设路径：Hotfix

快速 bug fix 工作流：open → build → verify → archive。跳过 brainstorming 和完整 plan，适用于行为修复、不涉及新 capability 设计的场景。

**适用条件**（必须全部满足）：
1. 修复已有功能的 bug，不新增 capability
2. 不涉及接口变更或架构调整
3. 改动范围可预估（通常 ≤ 2 个文件）

**不适用**：如修复过程发现需要架构调整，应升级为完整 `/comet` 流程。

---

## 流程（preset workflow，6 步）

### 0. 输出语言约束

精简版 OpenSpec 产物必须使用触发本次工作流的用户请求语言。

执行链路：open → build → verify → archive。Hotfix 为每个阶段提供默认决策：精简开启、直接构建、按规模验证、验证通过后进入归档前最终确认。

开始前先定位 Comet 脚本：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

### 1. 快速开启（preset open）

复用 Comet open 能力创建 change，但使用 hotfix 默认值：不执行 `openspec-explore` 长探索，直接进入精简 change 创建。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

技能加载后，按其指引创建精简版产物：
  - `proposal.md` — 问题描述 + 根因分析 + 修复目标（无需方案对比）
  - `design.md` — 修复方案（1 个即可，无需多方案对比）
  - `tasks.md` — 修复任务清单
- **无需 delta spec**（除非修复改变了已有 spec 的验收场景）

初始化 Comet 状态文件：

```bash
"$COMET_BASH" "$COMET_STATE" init <name> hotfix
```

初始化后验证状态：

```bash
"$COMET_BASH" "$COMET_STATE" check <name> open
```

阶段守卫完成 open → build 过渡：

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply
```

检查 `auto_transition` 决定是否继续：

```bash
"$COMET_BASH" "$COMET_STATE" next <name>
```

- `NEXT: auto` → 继续 Step 2
- `NEXT: manual` → 暂停，按 `HINT` 提示用户手动运行 `/<SKILL>`

### 2. 直接构建（preset build）

使用 hotfix 默认值：`build_mode: direct`。跳过 Superpowers `brainstorming` 和 `writing-plans`（除非任务 > 3 个；若超过 3 个任务，转入 `/comet-build` 的计划与执行方式选择——注意这不触发 full workflow 升级，仅切换执行方式）。

继续或开始修改前，按 `comet/reference/dirty-worktree.md` 协议处理未提交改动。若归因后发现修复范围超出 hotfix，按本文件“升级条件”处理。

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

**升级条件**：
- 根因消除检查发现深层架构问题 → 停止 hotfix，按升级条件阻塞确认处理
- 修复需要额外接口变更 → 停止 hotfix，按升级条件阻塞确认处理

根因确认消除后，运行阶段守卫完成 build → verify 过渡：

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 4. 验证（preset verify）

复用 `/comet-verify`，由 comet-verify 的规模评估决定轻量或完整验证。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

无 delta spec 的小范围 hotfix 通常满足轻量验证条件（≤ 3 tasks、≤ 2 files），comet-verify 的规模评估会选择轻量验证路径（6 项快速检查，包含简化代码审查）。若 hotfix 创建了 delta spec，则根据 comet-verify 的规模评估规则进入完整验证路径。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。验证通过后仍必须进入 `/comet-archive` 的归档前最终确认，不得自动运行归档脚本。

### 5. 归档（preset archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`，并等待 `/comet-archive` 的归档前最终确认。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。
如有 delta spec，按 comet-archive 规则同步到 main spec，并处理关联 Design Doc 与 Plan 的归档标注。

---

## 连续执行模式

<IMPORTANT>
Hotfix 流程默认 **一次性连续执行**。调用 `/comet-hotfix` 后，agent 在 hotfix 自有步骤间自动推进，不主动停顿。**例外**：若 `auto_transition: false`，则在每个 phase 边界（build/verify/archive 之间）停下，由用户手动运行下一阶段命令——此时连续执行降级为逐阶段手动推进，详见下方「自动衔接下一阶段」。但无论 `auto_transition` 取何值，以下情况都必须暂停等待用户确认：

1. 遇到升级条件（见"升级条件"章节），**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确确认**升级为完整流程
2. 任务超过 3 个转入 `/comet-build` 时的工作区隔离和执行方式选择
3. 验证阶段（comet-verify）的验证失败决策和分支处理决策
4. 归档前最终确认（comet-archive 执行归档脚本前）

执行顺序：快速开启 → 直接构建 → 根因消除检查 → 验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级条件

满足以下**任一**条件时，停止 hotfix 流程，升级为完整 `/comet`：

| 条件 | 说明 |
|------|------|
| 改动涉及 **3+ 文件** | 超出单点修复范围 |
| 架构变更 | 新模块、新接口、新依赖 |
| 数据库 schema 变更 | 结构性调整 |
| 引入新的 public API | 修复产生了新的对外接口 |
| 修复范围超出单一函数/模块 | 需要多处协调修改 |

满足升级条件时**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确确认**升级为完整 `/comet` 流程。不得直接进入 `/comet-design`，不得自动补充 Design Doc。

用户确认升级后，**必须先更新 workflow 和 phase 字段**再进入完整流程：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> workflow full
"$COMET_BASH" "$COMET_STATE" set <name> phase design
```

然后在当前 change 基础上补充 Design Doc：**立即使用 Skill 工具加载 `comet-design` skill**，后续正常走完整流程。若用户不确认升级，停止 hotfix 并报告当前变更已超出 hotfix 适用范围。

---

## 退出条件

- Bug 已修复，测试通过
- change 已归档
- 如有 spec 变更，已同步到 main spec
- **阶段守卫**：build → verify 前运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply`

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
"$COMET_BASH" "$COMET_STATE" next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续 hotfix 流程（`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`）
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
