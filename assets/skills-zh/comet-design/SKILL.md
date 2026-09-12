---
name: comet-design
description: '完成 Classic 技术设计与确认。在用户调用 /comet-design，或 Classic Runtime 路由到 Design 时使用。'
---

# Comet 阶段 2：深度设计（Design）

入口返回 layout 后按 `comet-classic/reference/classic-layout.md` 绑定逻辑根；协议已在当前上下文时不重复加载。本文件的 OpenSpec CLI 使用 adapter，文件路径使用绑定的 `<classic-*>` 根，不先额外运行 root show。

## 前置条件

- 活跃 change 已存在，Open 必需产物检查通过
- 当前 Runtime phase 为 design；已有设计时恢复，不因文件存在跳过用户确认

> 职责边界：proposal 保存目标与范围，spec 保存行为和验收，Design Doc 保存技术决策，plan 保存实施步骤，tasks.md 保存完成状态。已有 `design.md` 时在同一文件补充必要设计，不另外复制技术方案。`design_doc` 是正式技术设计的唯一入口；旧 change 已记录其他路径时保持该路径，其他文件只引用，不双写同一决策。

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 运行公开 Comet CLI 命令，然后执行入口验证；从任意入口恢复时先按 `comet-classic/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <name> design --json
```

验证通过后使用入口 layout、configuration、nextAction 和协调摘要继续，不逐字段查询或重复 root show。普通衔接只做入口检查；冷恢复及详情读取按 context-recovery.md。验证失败时处理具体失败原因。

**恢复**：先核对现有产物和用户确认，只补未完成步骤。普通入口和恢复入口均保留已登记的有效设计；读取 `data.designReadiness`、`data.issues` 和 `data.nextAction`。修复缺失文件、错误归属或过期 handoff，不清空 `design_doc`。已确认设计后可执行返回的 complete-design 动作；该协调命令保留已完成步骤，已进入 Build 时只返回当前入口。

### 1a. 生成 OpenSpec → Superpowers 交接包

**必须由脚本生成，不允许 agent 临场手写 summary 代替。**

```bash
comet handoff <change-name> design --write
```

脚本会根据 change `.comet.yaml` 的 `context_compression` 快照生成并记录交接包。

默认 `context_compression: off` 时生成：

```text
<classic-change-dir>/.comet/handoff/design-context.json
<classic-change-dir>/.comet/handoff/design-context.md
```

启用 beta（项目 `.comet/config.yaml` 中 `classic.context_compression: beta`，创建 change 时快照进入 `.comet.yaml`）时生成：

```text
<classic-change-dir>/.comet/handoff/spec-context.json
<classic-change-dir>/.comet/handoff/spec-context.md
```

并在 `.comet.yaml` 写入：

```yaml
handoff_context: <classic-change-ref>/.comet/handoff/design-context.json
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
comet handoff <change-name> design --write --full
```

交接包来源来自 OpenSpec open 阶段产物：

- `proposal.md`：目标、动机、范围、非目标
- `design.md`（存在时）：已有技术决策、方案约束
- `tasks.md`：初始任务边界
- `specs/**/spec.md`：delta 能力规格，保留嵌套 capability 的完整路径

### 1b. 执行 Brainstorming（带上下文）

**立即执行：** 使用 Skill 工具加载 Superpowers `brainstorming` 技能。禁止跳过此步骤。

技能加载时，ARGUMENTS 必须包含：

```text
Language: 使用入口 configuration.language 中的 Comet 配置产物语言输出
```

技能加载后，按其指引使用以下上下文：

```text
Change: <change-name>
OpenSpec Context Pack: <classic-change-dir>/.comet/handoff/design-context.md

如 context_compression: beta，则使用：
OpenSpec Context Pack: <classic-change-dir>/.comet/handoff/spec-context.md

OpenSpec 产物是上游事实源。引用已确认需求，brainstorming 只深入尚未解决的技术选择，不重新访谈已确认需求。
默认只读取上述一个 Markdown 上下文包；机器 JSON 由 Runtime 校验，只有诊断索引问题才读取。截断或验收条款不足时按 source path/line range 补读相关原文，不同时通读 JSON、Markdown 和全部源文件。
你的任务是基于交接包做深度技术设计：实现方案、技术风险、测试策略、边界条件。
如发现目标、范围、非目标、验收场景或关键约束仍不清楚，先澄清缺口；信息已足够时直接形成设计方案，不设置最低问答轮数。
需要提问时，先读取 comet-classic/reference/decision-point.md，逐问给出明确问题、推荐及基于当前约束的理由、各选项影响，优先使用可用的 AskUserQuestion，并等待回答。无法形成真实选项的缺失事实明确请求补充。已有有效确认不重复询问；技术方案唯一不替代 Step 1c 的正式设计确认。
不要重写 proposal/spec；如发现 OpenSpec delta spec 缺少验收场景，只能提出 Spec Patch，并回写 OpenSpec delta spec；不要在 Design Doc 中创建第二份需求 spec。Spec Patch 仅限于补充验收场景、修正歧义描述或添加边界条件，不得大幅重写 delta spec 的结构或范围——如需大幅修改，应标记为设计发现并回到 brainstorming 确认。

Design Doc frontmatter 必须最小化，只包含：
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---

按风险决定设计深度：存在真实取舍时比较 2-3 个方案；既有架构已决定方案时说明依据，不为凑数编造替代方案。高风险接口、迁移、安全与并发必须说明失败路径及验证策略。
只采用 brainstorming 的探索与设计方法；相邻设计段合并展示，Comet Step 1c 是正式设计确认边界。外部 Skill 不得额外要求整份设计文档再次批准，不得自动调用 writing-plans、切换工作区或进入实施。不得提前写入 Design Doc。
```

禁止在未加载该技能的情况下继续。

如 Superpowers `brainstorming` 技能不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引产出设计方案（以对话形式呈现）：

- 技术方案：架构、数据流、关键技术选型与风险
- 测试策略
- 需求/范围缺口与需回写的 Spec Patch
- 如需补充验收场景，标明将回写的 delta spec 变更

brainstorming 阶段不把候选写为正式 Design Doc，仅产出设计方案供 Step 1c 用户确认。确认后才创建或更新正式设计及 delta spec。既有 Open design.md 保留原内容，待确认的修改先记录在检查点，不提前覆盖已确认决策。

但为了上下文压缩恢复，brainstorming 过程中必须增量更新 `brainstorm-summary.md`。每轮澄清或方案迭代后，只要产生新的已确认事实、关键约束、候选方案、取舍/风险、测试策略或 Spec Patch 候选，就更新该文件；未确认内容必须标注为“待确认”或“候选”。该文件是恢复检查点，不是 Design Doc，也不得替代 Step 1c 的用户确认。

### 1c. 用户确认设计方案（阻塞点）

brainstorming 产出设计方案后，**必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户明确确认设计方案**。不得在用户确认前创建最终 Design Doc、写入 `design_doc`、运行 design guard，或进入 `/comet-build`。

暂停时只展示必要摘要：

- 采用的技术方案
- 关键取舍与风险
- 测试策略
- 如有 Spec Patch，列出将回写的 delta spec 变更

用户明确确认后，才继续 Step 2。若用户要求调整，继续 brainstorming 迭代，直到用户确认。

### 1d. Brainstorming 检查点定稿

用户确认设计方案后，在创建 Design Doc 前，创建或更新已增量维护的检查点文件，将其定稿为确认后的设计方案摘要：

使用文件工具确保 `<classic-change-dir>/.comet/handoff/` 存在；不要依赖 POSIX 专用目录命令。

`<classic-change-dir>/.comet/handoff/brainstorm-summary.md` 结构：

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

**上下文压缩说明**：brainstorm-summary.md 提供中断恢复依据，但主动式压缩应等正式设计、状态和 handoff 落盘后再进行。此前若被动压缩，按需加载以下文件继续 Step 2：

- `<classic-change-dir>/.comet/handoff/brainstorm-summary.md`
- 按需补读 `<classic-change-dir>/.comet/handoff/design-context.md`（或 beta 的 `spec-context.md`）及缺失的原文段落；机器 JSON 不作为必读上下文

### 1e. 压缩策略（此处不阻塞）

`brainstorm-summary.md` 是恢复检查点，但 Design Doc 尚未落盘时不得主动丢弃当前设计上下文。直接进入 Step 2；上下文压缩移到 Design Doc、状态和最新 handoff 全部持久化之后执行。

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

按以下顺序确定唯一 `<design-doc-path>`：已有 `design_doc` 时沿用；否则优先使用 `<classic-change-dir>/design.md` 并在同一文件深化 Open 的技术决策。只有既有项目约定要求独立 Superpowers 文档时才使用 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`，此时 Open design.md 只保留 schema 所需摘要及正式设计链接，不复制详细技术内容。模型按风险决定篇幅，不强制生成空章节或重复备选方案。

如需回写 delta spec（Spec Patch），同时编辑对应的 `specs/**/spec.md`。行为需求只在 spec 中维护；正式设计引用相关 capability/验收条款，不能创建第二份需求规格。

**上下文压缩恢复**：若上下文已被压缩，从 `brainstorm-summary.md` + handoff 上下文恢复。若用户尚未确认设计方案，回到 Step 1b/1c 继续 brainstorming；若用户已确认，继续创建 Design Doc。brainstorm-summary.md 是压缩恢复的落盘点，不是 Design Doc 的唯一输入——创建时应尽可能利用恢复后的完整上下文。

### 3. 更新 Comet 状态

用户已明确确认且正式设计已保存后，将仓库相对的 `data.artifactRefs.designDoc` 绑定为 `<design-doc-ref>`；如确认采用其他设计文件，使用以 `projectRoot` 为基准的相对引用。文件读写仍使用绝对 `<design-doc-path>`。用一次协调命令登记设计、刷新需要更新的 handoff 并执行原有 Guard：

```bash
comet state complete-design <name> --design-doc "<design-doc-ref>" --json
```

任何 handoff 来源内容变化（proposal、design、任务语义、delta spec 或 OpenSpec metadata）都必须刷新 handoff，不能只检查 Spec Patch；否则 design guard 将拒绝推进。只有所有来源内容均未变化时才跳过重新生成；单纯勾选任务完成状态不改变需求 hash。状态文件自动更新，无需手动编辑其他字段。

### 3a. 可选主动式上下文压缩

只在 **Design Doc 和状态证据落盘后**、进入 Build 前考虑主动式压缩。先确认 `design_doc`、最新 handoff、`handoff_hash` 和 design guard 均已成功持久化；这样压缩后可从文件恢复，不会丢失尚未写入的设计判断。

- 上下文窗口确有压力且存在可调用的原生压缩机制时，可以触发一次，并在恢复提示中列出 change、下一步和需重新加载的 Design Doc/handoff 文件
- 压缩只能由用户手动触发时，给出一次非阻塞建议并继续；**不得阻塞**、不得额外制造确认点
- 不得用 shell 命令或摘要伪造上下文压缩

## 退出条件

- Design Doc 已创建并保存
- Design Doc frontmatter 包含 `comet_change`、`role: technical-design`、`canonical_spec: openspec`
- `handoff_context` 和 `handoff_hash` 已写入 `.comet.yaml`（由 guard 强制校验）
- `handoff_hash` 与当前 OpenSpec open 阶段产物一致（由 guard 强制校验）
- `design-context.md` 或 beta `spec-context.md` 必须是脚本生成，且包含 source path、mode、sha256 等可追溯标记（由 guard 强制校验）
- beta 模式下，`spec-context.json` 必须结构合法且引用当前源文件（由 guard 强制校验）
- 如有新能力或补充验收场景，OpenSpec delta spec 已创建/更新
- `design_doc` 已写入 `.comet.yaml`
- **阶段守卫**：运行 `comet guard <change-name> design --apply`，全部 PASS 后由守卫推进到 `phase: build`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

Step 3 成功返回 `data.phase: build` 即已通过并应用 Guard，不重复执行。失败时处理 `data.issues`，保留成果并重试同一 complete-design。

## 上下文压缩恢复

按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `design`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 消费成功结果的 `agent.continuation`，不再查询 next。仅冷恢复、外部变更或旧结果没有观察时重新读取：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
