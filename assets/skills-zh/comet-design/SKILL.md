---
name: comet-design
description: "Use when full Comet change 已完成 open 阶段但缺少 Superpowers Design Doc，或 design 阶段需要从 OpenSpec 交接包恢复。"
---

# Comet 阶段 2：深度设计（Design）

## 前置条件

- 活跃 change 已存在（proposal.md、design.md、tasks.md）
- 无 Design Doc（`docs/superpowers/specs/` 下无对应文件）

> 职责边界：open 阶段的 `design.md` 给出**高层方案框架**（架构决策方向、方案选型、数据流）；design 阶段的 Design Doc 是对它的**深度技术细化**（详细实现设计、技术风险、测试策略、边界条件），是深化而非替代或重写。

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet/reference/scripts.md` 定位脚本（定位 `comet-env.mjs`），然后执行入口验证；从任意入口恢复时先按 `comet/reference/context-recovery.md` 运行恢复检查：

```bash
node "$COMET_STATE" check <name> design
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：所有 design 阶段操作可以安全重试。如果 `handoff_context` 和 `handoff_hash` 已存在，先确认它们与当前产物一致再决定是否重新生成。

### 1a. 生成 OpenSpec → Superpowers 交接包

**必须由脚本生成，不允许 agent 临场手写 summary 代替。**

```bash
node "$COMET_HANDOFF" <change-name> design --write
```

脚本会根据 change `.comet.yaml` 的 `context_compression` 快照生成并记录交接包。

默认 `context_compression: off` 时生成：

```text
openspec/changes/<name>/.comet/handoff/design-context.json
openspec/changes/<name>/.comet/handoff/design-context.md
```

启用 beta（项目 `.comet/config.yaml` 中 `context_compression: beta`，创建 change 时快照进入 `.comet.yaml`）时生成：

```text
openspec/changes/<name>/.comet/handoff/spec-context.json
openspec/changes/<name>/.comet/handoff/spec-context.md
```

并在 `.comet.yaml` 写入：

```yaml
handoff_context: openspec/changes/<name>/.comet/handoff/design-context.json
handoff_hash: <sha256>
```

默认交接包是 **compact 可追溯摘录**，不是 agent summary：
- `design-context.json`：机器索引，包含 change、phase、canonical spec、source paths、hash
- `design-context.md`：供 Superpowers 阅读的上下文，包含脚本标记、source path、line range、sha256、确定性摘录
- 超出摘录预算时标记 `[TRUNCATED]`，并保留 Full source 路径

beta 交接包是 **结构化 spec projection**，用于减少 OpenSpec 原文 token 占用但避免实现漂移：
- `spec-context.json`：机器索引，包含 change、phase、mode=beta、source paths、context_hash、files 角色
- `spec-context.md`：供 Superpowers 阅读的紧凑上下文，verbatim 投影 delta spec 文件并按 hash 引用支撑产物
- OpenSpec delta spec 仍是 canonical spec；projection 缺失或过期时必须重新生成或读取源 spec，不得用 agent summary 替代

如确实需要全文上下文，可显式运行：

```bash
node "$COMET_HANDOFF" <change-name> design --write --full
```

交接包来源来自 OpenSpec open 阶段产物：
- `proposal.md`：目标、动机、范围、非目标
- `design.md`：高层架构决策、方案约束
- `tasks.md`：初始任务边界
- `specs/*/spec.md`：delta 能力规格

### 1b. 执行 Brainstorming（带上下文）

**立即执行：** 使用 Skill 工具加载 Superpowers `brainstorming` 技能。禁止跳过此步骤。

技能加载时，ARGUMENTS 必须包含：

```text
Language: 使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取到的 Comet 配置产物语言输出
```

技能加载后，按其指引使用以下上下文：

```text
Change: <change-name>
OpenSpec Context Pack: openspec/changes/<name>/.comet/handoff/design-context.md
Machine handoff: openspec/changes/<name>/.comet/handoff/design-context.json

如 context_compression: beta，则使用：
OpenSpec Context Pack: openspec/changes/<name>/.comet/handoff/spec-context.md
Machine handoff: openspec/changes/<name>/.comet/handoff/spec-context.json

OpenSpec 产物是上游事实源，但不得用“跳过重复上下文探索”削弱 Superpowers `brainstorming` 的澄清流程。
你的任务是基于交接包做深度技术设计：实现方案、技术风险、测试策略、边界条件。
如发现目标、范围、非目标、验收场景或关键约束仍不清楚，必须先继续提问并形成设计方案，不得只进行一轮问答就创建 Design Doc。
不要重写 proposal/spec；如发现 OpenSpec delta spec 缺少验收场景，只能提出 Spec Patch，并回写 OpenSpec delta spec；不要在 Design Doc 中创建第二份需求 spec。Spec Patch 仅限于补充验收场景、修正歧义描述或添加边界条件，不得大幅重写 delta spec 的结构或范围——如需大幅修改，应标记为设计发现并回到 brainstorming 确认。

Design Doc frontmatter 必须最小化，只包含：
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---

按 Superpowers `brainstorming` 技能原流程推进：澄清问题、2-3 个方案、分段确认设计。不得提前写入 Design Doc。
```

禁止在未加载该技能的情况下继续。

如 Superpowers `brainstorming` 技能不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引产出设计方案（以对话形式呈现）：
- 技术方案：架构、数据流、关键技术选型与风险
- 测试策略
- 需求/范围缺口与需回写的 Spec Patch
- 如需补充验收场景，标明将回写的 delta spec 变更

brainstorming 阶段不写入 Design Doc 文件，仅产出设计方案供 Step 1c 用户确认。确认后才创建 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 并回写 delta spec。

但为了上下文压缩恢复，brainstorming 过程中必须增量更新 `brainstorm-summary.md`。每轮澄清或方案迭代后，只要产生新的已确认事实、关键约束、候选方案、取舍/风险、测试策略或 Spec Patch 候选，就更新该文件；未确认内容必须标注为“待确认”或“候选”。该文件是恢复检查点，不是 Design Doc，也不得替代 Step 1c 的用户确认。

### 1c. 用户确认设计方案（阻塞点）

brainstorming 产出设计方案后，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确确认设计方案**。不得在用户确认前创建最终 Design Doc、写入 `design_doc`、运行 design guard，或进入 `/comet-build`。

暂停时只展示必要摘要：
- 采用的技术方案
- 关键取舍与风险
- 测试策略
- 如有 Spec Patch，列出将回写的 delta spec 变更

用户明确确认后，才继续 Step 2。若用户要求调整，继续 brainstorming 迭代，直到用户确认。


### 1d. Brainstorming 检查点定稿

用户确认设计方案后，在创建 Design Doc 前，创建或更新已增量维护的检查点文件，将其定稿为确认后的设计方案摘要：

```bash
mkdir -p openspec/changes/<name>/.comet/handoff
```

`openspec/changes/<name>/.comet/handoff/brainstorm-summary.md` 结构：

```markdown
# Brainstorm Summary

- Change: <change-name>
- Date: <YYYY-MM-DD>

## 确认的技术方案

<用户确认的方案摘要>

## 关键取舍与风险

<主要取舍和风险>

## 测试策略

<测试方法概述>

## Spec Patch

<将回写的 delta spec 变更，无则写"无">
```

**上下文压缩说明**：每次增量更新 `brainstorm-summary.md` 后，都是相对安全的压缩恢复点。Brainstorming 完成后，如上下文窗口紧张，应优先在此处进行压缩。压缩后重新加载以下文件继续 Step 2：
- `openspec/changes/<name>/.comet/handoff/brainstorm-summary.md`
- `openspec/changes/<name>/.comet/handoff/design-context.md`（或 beta 模式的 `spec-context.md`）
- `openspec/changes/<name>/.comet/handoff/design-context.json`（或 beta 模式的 `spec-context.json`）

### 1e. 主动式上下文压缩

完成 Step 1d 并确认 `brainstorm-summary.md` 已写入后，进入 Design Doc 创建前的主动式上下文压缩。此时 OpenSpec 交接包、brainstorming 决策和待确认项都已落盘，应主动释放前面读取 Spec 和 brainstorming 消耗的上下文，为 Step 2 及后续 Build 阶段保留窗口。

执行规则：
- 如果当前平台提供原生上下文压缩/清理机制（例如宿主 Agent 的 compact/compaction 命令、工具或 UI 操作），必须在这里触发一次主动压缩；不要尝试用 shell 脚本伪造压缩命令。
- 压缩恢复提示必须包含 change 名称、当前步骤（Design Step 2）、以及上方三类需重新加载的 handoff 文件。
- 如果当前平台无法由 agent 程序化触发压缩，必须暂停并提示用户在宿主平台执行手动压缩；用户确认无法压缩或要求继续时，才继续 Step 2。

### 2. 创建 Design Doc

基于 brainstorming 对话的完整上下文（仍在主 session 中），创建 Design Doc。

Design Doc frontmatter 必须最小化：

```yaml
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---
```

将 Design Doc 写入 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`。
如需回写 delta spec（Spec Patch），同时编辑对应的 `specs/*/spec.md`。

**上下文压缩恢复**：若上下文已被压缩，从 `brainstorm-summary.md` + handoff 上下文恢复。若用户尚未确认设计方案，回到 Step 1b/1c 继续 brainstorming；若用户已确认，继续创建 Design Doc。brainstorm-summary.md 是压缩恢复的落盘点，不是 Design Doc 的唯一输入——创建时应尽可能利用恢复后的完整上下文。

### 3. 更新 Comet 状态

先记录 design_doc 路径。如果 Spec Patch 回写了 delta spec（新增或修改了 `specs/*/spec.md`），必须重新生成 handoff 以更新 hash：

```bash
# 记录 design_doc 路径
node "$COMET_STATE" set <name> design_doc docs/superpowers/specs/YYYY-MM-DD-topic-design.md

# 如有 delta spec 变更，重新生成 handoff（更新 hash）
node "$COMET_HANDOFF" <change-name> design --write

# 阶段守卫推进 phase 到下一阶段
node "$COMET_GUARD" <change-name> design --apply
```

如果没有 delta spec 变更，跳过 handoff 重新生成步骤。状态文件自动更新，无需手动编辑其他字段。

## 退出条件

- Design Doc 已创建并保存
- Design Doc frontmatter 包含 `comet_change`、`role: technical-design`、`canonical_spec: openspec`
- `handoff_context` 和 `handoff_hash` 已写入 `.comet.yaml`（由 guard 强制校验）
- `handoff_hash` 与当前 OpenSpec open 阶段产物一致（由 guard 强制校验）
- `design-context.md` 或 beta `spec-context.md` 必须是脚本生成，且包含 source path、mode、sha256 等可追溯标记（由 guard 强制校验）
- beta 模式下，`spec-context.json` 必须结构合法且引用当前源文件（由 guard 强制校验）
- 如有新能力或补充验收场景，OpenSpec delta spec 已创建/更新
- `design_doc` 已写入 `.comet.yaml`
- **阶段守卫**：运行 `node "$COMET_GUARD" <change-name> design --apply`，全部 PASS 后由守卫推进到 `phase: build`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

退出前必须使用 `--apply`：

```bash
node "$COMET_GUARD" <change-name> design --apply
```

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `design`。

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
node "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
