---
name: comet-design
description: "Comet 阶段 2：深度设计。用 /comet-design 调用。通过 brainstorming 产出 Design Doc 和 delta spec。"
---

# Comet 阶段 2：深度设计（Design）

## 前置条件

- 活跃 change 已存在（proposal.md、design.md、tasks.md）
- 无 Design Doc（`docs/superpowers/specs/` 下无对应文件）

## 步骤

### 0. 入口状态验证（Entry Check）

执行入口验证：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> design
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：所有 design 阶段操作可以安全重试。如果 `handoff_context` 和 `handoff_hash` 已存在，先确认它们与当前产物一致再决定是否重新生成。

### 1a. 生成 OpenSpec → Superpowers 交接包

**必须由脚本生成，不允许 agent 临场手写 summary 代替。**

```bash
bash "$COMET_HANDOFF" <change-name> design --write
```

脚本会生成并记录：

```
openspec/changes/<name>/.comet/handoff/design-context.json
openspec/changes/<name>/.comet/handoff/design-context.md
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

如确实需要全文上下文，可显式运行：

```bash
bash "$COMET_HANDOFF" <change-name> design --write --full
```

交接包来源来自 OpenSpec open 阶段产物：
- `proposal.md`：目标、动机、范围、非目标
- `design.md`：高层架构决策、方案约束
- `tasks.md`：初始任务边界
- `specs/*/spec.md`：delta 能力规格

### 1b. 执行 Brainstorming（带上下文）

**立即执行：** 使用 Skill 工具加载 `superpowers:brainstorming` 技能，ARGUMENTS 包含：

```
Change: <change-name>
OpenSpec Context Pack: openspec/changes/<name>/.comet/handoff/design-context.md
Machine handoff: openspec/changes/<name>/.comet/handoff/design-context.json

OpenSpec 产物是上游事实源，不要重新定义需求，不要重写 proposal/spec。
你的任务是基于交接包做深度技术设计：实现方案、技术风险、测试策略、边界条件。
如发现 OpenSpec delta spec 缺少验收场景，只能提出 Spec Patch，并回写 OpenSpec delta spec；不要在 Design Doc 中创建第二份需求 spec。

Design Doc frontmatter 必须最小化，只包含：
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---

跳过重复上下文探索，直接进入设计提问。
```

禁止跳过此步骤，禁止在未加载该技能的情况下继续。

如 `superpowers:brainstorming` 不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引产出设计方案（以对话形式呈现）：
- 技术方案：架构、数据流、关键技术选型与风险
- 测试策略
- 如需补充验收场景，标明将回写的 delta spec 变更

brainstorming 阶段不写入 Design Doc 文件，仅产出设计方案供 Step 1c 用户确认。确认后才创建 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 并回写 delta spec。

### 1c. 用户确认设计方案（阻塞点）

brainstorming 产出设计方案后，**必须使用 AskUserQuestion 工具暂停并等待用户明确确认设计方案**。不得在用户确认前创建最终 Design Doc、写入 `design_doc`、运行 design guard，或进入 `/comet-build`。也不得仅输出文字提示后继续执行。

暂停时只展示必要摘要：
- 采用的技术方案
- 关键取舍与风险
- 测试策略
- 如有 Spec Patch，列出将回写的 delta spec 变更

用户明确确认后，才继续 Step 2。若用户要求调整，继续 brainstorming 迭代，直到用户确认。

### 2. 更新 Comet 状态

先记录 design_doc 路径。如果 Step 1c 回写了 delta spec（新增或修改了 `specs/*/spec.md`），必须重新生成 handoff 以更新 hash：

```bash
# 记录 design_doc 路径
bash "$COMET_STATE" set <name> design_doc docs/superpowers/specs/YYYY-MM-DD-topic-design.md

# 如有 delta spec 变更，重新生成 handoff（更新 hash）
bash "$COMET_HANDOFF" <change-name> design --write

# 自动流转到下一阶段
bash "$COMET_GUARD" <change-name> design --apply
```

如果没有 delta spec 变更，跳过 handoff 重新生成步骤。状态文件自动更新，无需手动编辑其他字段。

## 退出条件

- Design Doc 已创建并保存
- Design Doc frontmatter 包含 `comet_change`、`role: technical-design`、`canonical_spec: openspec`
- `handoff_context` 和 `handoff_hash` 已写入 `.comet.yaml`（由 guard 强制校验）
- `handoff_hash` 与当前 OpenSpec open 阶段产物一致（由 guard 强制校验）
- `design-context.md` 必须是脚本生成，且包含 source path、mode、sha256 等可追溯标记（由 guard 强制校验）
- 如有新能力或补充验收场景，OpenSpec delta spec 已创建/更新
- `design_doc` 已写入 `.comet.yaml`
- **阶段守卫**：运行 `bash "$COMET_GUARD" <change-name> design --apply`，全部 PASS 后自动流转到 `phase: build`

退出前必须使用 `--apply`：

```bash
bash "$COMET_GUARD" <change-name> design --apply
```

## 上下文压缩恢复

design 阶段在 brainstorming 过程中可能触发上下文压缩。恢复时先运行：

```bash
bash "$COMET_STATE" check <change-name> design --recover
```

脚本输出结构化恢复上下文（阶段、已完成字段、待完成字段、恢复动作）。按 Recovery action 判断下一步。

## 自动流转

退出条件满足后（包括用户确认设计方案），自动流转到下一阶段：

> **REQUIRED NEXT SKILL:** 调用 `comet-build` skill 进入计划与构建阶段。
