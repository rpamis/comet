---
name: comet-design
description: '完成 Classic 技术设计并请用户确认。在用户调用 /comet-design，或 Classic Runtime 进入 Design 时使用。'
---

# Comet 阶段 2：深度设计（Design）

收到入口返回的 layout 后，按 `comet-classic/reference/classic-layout.md` 确定各逻辑根对应的目录。当前上下文已有这份协议时，无需重复加载。本文件中的 OpenSpec CLI 调用均通过适配器执行，文件路径均基于已绑定的 `<classic-*>` 根目录，无需先额外运行 root show。

## 前置条件

- 活跃 change 已存在，Open 必需产物检查通过
- Runtime 当前的 phase 为 design；已有设计时从已有进度继续，不能因为设计文件存在就跳过用户确认

> 各文档的用途：proposal 记录目标与范围，spec 记录行为和验收要求，Design Doc 记录技术决策，plan 记录实施步骤，tasks.md 记录任务完成状态。已有 `design.md` 时，在同一文件中补充必要设计，不另建一份相同的技术方案。正式技术设计以 `design_doc` 指向的文件为准；旧 change 已记录其他路径时，沿用该路径。其他文件只引用这份设计，不重复维护同一项决策。

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用正式支持的 Comet CLI，执行以下入口验证。从任意入口恢复任务时，先按 `comet-classic/reference/context-recovery.md` 检查恢复状态：

```bash
comet state select <change-name>
comet state check <name> design --json
```

验证通过后，使用入口返回的 layout、configuration、nextAction 和协作进度摘要继续，不逐字段查询，也不重复 root show。正常进入本阶段时，只做入口检查；丢失上下文后恢复任务或需要读取详情时，按 context-recovery.md 处理。验证失败时，处理返回的具体原因。

**恢复**：先核对现有产物和用户确认记录，只补未完成的步骤。无论正常进入还是恢复任务，都要保留已登记且仍然有效的设计，并读取 `data.designReadiness`、`data.issues` 和 `data.nextAction`。补回缺失文件、纠正文件关联的 change，或更新过期 handoff，不清空 `design_doc`。用户已确认设计后，可以执行返回的 complete-design 动作；该命令会保留已完成的步骤。如果已经进入 Build，则只返回当前阶段的入口信息。

### 1a. 生成 OpenSpec → Superpowers 交接包

**必须由脚本生成，不能由 Agent 手写摘要代替。**

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

默认交接包由脚本摘录源文件，并保留来源信息，不是 Agent 撰写的摘要：

- `design-context.json`：供程序读取的索引，包含 change、phase、正式规格（canonical spec）、源文件路径（source paths）和 hash
- `design-context.md`：供 Superpowers 阅读的上下文，包含脚本标记、source path、line range、sha256，以及脚本按固定规则生成的摘录
- 超出摘录长度上限时标记 `[TRUNCATED]`，并保留 Full source 路径

beta 交接包按固定结构组织规格内容，在减少 OpenSpec 原文 token 占用的同时，保留实现所需的规格依据：

- `spec-context.json`：供程序读取的索引，包含 change、phase、mode=beta、source paths、context_hash，以及 files 中各文件的角色
- `spec-context.md`：供 Superpowers 阅读的上下文，逐字保留 delta spec 文件内容，并按 hash 引用相关产物
- 正式规格仍以 OpenSpec delta spec 为准；交接包中的规格内容缺失或过期时，必须重新生成交接包或读取源 spec，不得用 Agent 摘要替代

如确实需要全文上下文，可显式运行：

```bash
comet handoff <change-name> design --write --full
```

交接包取自 OpenSpec open 阶段的产物：

- `proposal.md`：目标、动机、范围、非目标
- `design.md`（存在时）：已有技术决策、方案约束
- `tasks.md`：初始任务范围
- `specs/**/spec.md`：各项功能的增量规格，保留嵌套 capability 的完整路径

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

已确认需求以 OpenSpec 产物为准。brainstorming 引用这些需求，只讨论尚未解决的技术选择，不重新询问已经确认的需求。
默认只读取上述一个 Markdown 上下文包；机器 JSON 由 Runtime 校验，只有诊断索引问题才读取。截断或验收条款不足时按 source path/line range 补读相关原文，不同时通读 JSON、Markdown 和全部源文件。
你的任务是基于交接包做深度技术设计：实现方案、技术风险、测试策略、边界条件。
如发现目标、范围、非目标、验收场景或关键约束仍不清楚，先澄清缺口；信息已足够时直接形成设计方案，不设置最低问答轮数。
需要提问时，先读取 comet-classic/reference/decision-point.md，逐问给出明确问题、推荐及基于当前约束的理由、各选项影响，优先使用可用的 AskUserQuestion，并等待回答。无法形成真实选项的缺失事实明确请求补充。已有有效确认不重复询问；技术方案唯一不替代 Step 1c 的正式设计确认。
不要重写 proposal/spec。如发现 OpenSpec delta spec 缺少验收场景，只能提出 Spec Patch，并回写 OpenSpec delta spec，不能在 Design Doc 中创建第二份需求规格。Spec Patch 仅限于补充验收场景、修正歧义描述或添加边界条件，不得大幅重写 delta spec 的结构或范围。如需大幅修改，应记录设计阶段发现的需求问题，回到 brainstorming 请用户确认。

Design Doc frontmatter 必须最小化，只包含：
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---

按风险决定设计深度：存在真实取舍时比较 2-3 个方案；既有架构已决定方案时说明依据，不为凑数编造替代方案。高风险接口、迁移、安全与并发必须说明失败路径及验证策略。
只采用 brainstorming 的探索与设计方法；相邻的设计段落合并展示，统一在 Comet Step 1c 请用户正式确认设计。外部 Skill 不得额外要求用户再次批准整份设计文档，不得自动调用 writing-plans、切换工作区或进入实施。不得提前写入 Design Doc。
```

禁止在未加载该技能的情况下继续。

如 Superpowers `brainstorming` 技能不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引产出设计方案（以对话形式呈现）：

- 技术方案：架构、数据流、关键技术选型与风险
- 测试策略
- 需求/范围缺口与需回写的 Spec Patch
- 如需补充验收场景，标明将回写的 delta spec 变更

brainstorming 阶段先提出候选方案，供用户在 Step 1c 确认，不直接写成正式 Design Doc。确认后，才创建或更新正式设计及 delta spec。保留 Open 阶段已有的 design.md 内容，将待确认的修改先记录到检查点，不能提前覆盖已确认的决策。

为便于上下文压缩后恢复，brainstorming 过程中必须持续更新 `brainstorm-summary.md`。每轮澄清或方案调整后，只要新增了已确认事实、关键约束、候选方案、取舍与风险、测试策略或 Spec Patch 候选，就更新该文件。未确认的内容必须标注为“待确认”或“候选”。该文件用于恢复讨论进度，不是 Design Doc，也不能代替 Step 1c 的用户确认。

### 1c. 请用户确认设计方案

brainstorming 产出设计方案后，**必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户明确确认设计方案**。不得在用户确认前创建最终 Design Doc、写入 `design_doc`、运行 design guard，或进入 `/comet-build`。

暂停时只展示必要摘要：

- 采用的技术方案
- 关键取舍与风险
- 测试策略
- 如有 Spec Patch，列出将回写的 delta spec 变更

用户明确确认后，才继续 Step 2。若用户要求调整，继续 brainstorming 迭代，直到用户确认。

### 1d. 保存已确认的设计摘要

用户确认设计方案后、创建 Design Doc 前，创建或更新上述检查点文件，将摘要整理为用户最终确认的方案：

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

**上下文压缩说明**：brainstorm-summary.md 用于在中断后恢复讨论；主动式压缩应等正式设计、状态和 handoff 都保存到文件后再进行。此前如果上下文已被压缩，按需加载以下文件，再继续 Step 2：

- `<classic-change-dir>/.comet/handoff/brainstorm-summary.md`
- 按需补读 `<classic-change-dir>/.comet/handoff/design-context.md`（或 beta 的 `spec-context.md`）及缺失的原文段落；机器 JSON 不作为必读上下文

### 1e. 继续创建设计文档，暂不压缩上下文

`brainstorm-summary.md` 用于恢复进度，但 Design Doc 尚未保存时，不能主动丢弃当前设计上下文。直接进入 Step 2，等 Design Doc、状态和最新 handoff 都保存后，再执行上下文压缩。

### 2. 创建 Design Doc

根据当前主会话中 brainstorming 对话的完整上下文，创建 Design Doc。

Design Doc frontmatter 必须最小化：

```yaml
---
comet_change: <change-name>
role: technical-design
canonical_spec: openspec
---
```

按以下顺序确定唯一的 `<design-doc-path>`：已有 `design_doc` 时沿用；否则优先使用 `<classic-change-dir>/design.md`，在同一文件中完善 Open 阶段的技术决策。只有项目已有约定要求单独的 Superpowers 文档时，才使用 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`。此时，Open 的 design.md 只保留 schema 要求的摘要和正式设计链接，不复制详细技术内容。根据风险决定设计需要写多详细，不强制生成空章节或重复的备选方案。

如需回写 delta spec（Spec Patch），同时编辑对应的 `specs/**/spec.md`。行为需求只在 spec 中维护；正式设计引用相关 capability/验收条款，不能创建第二份需求规格。

**上下文压缩恢复**：若上下文已被压缩，读取 `brainstorm-summary.md` 和 handoff，恢复设计讨论。用户尚未确认方案时，回到 Step 1b/1c 继续 brainstorming；用户已确认时，继续创建 Design Doc。brainstorm-summary.md 保存了恢复所需的摘要，但创建 Design Doc 时，还应结合恢复后的完整上下文。

### 3. 更新 Comet 状态

用户明确确认且正式设计已保存后，将 `data.artifactRefs.designDoc` 中的仓库相对路径用作 `<design-doc-ref>`。如果用户确认采用其他设计文件，则使用相对于 `projectRoot` 的路径。文件读写仍使用绝对路径 `<design-doc-path>`。运行以下命令，一次完成设计登记、必要的 handoff 更新和原有 Guard 检查：

```bash
comet state complete-design <name> --design-doc "<design-doc-ref>" --json
```

只要 handoff 的任何来源发生内容变化，包括 proposal、design、任务含义、delta spec 或 OpenSpec metadata，都必须更新 handoff，不能只检查 Spec Patch；否则 design guard 会拒绝推进。只有所有来源内容都没有变化时，才跳过重新生成。单纯勾选任务完成状态不会改变需求 hash。状态文件会自动更新，无需手动编辑其他字段。

### 3a. 可选主动式上下文压缩

只在 **Design Doc 和状态记录已保存后**、进入 Build 前考虑主动式压缩。先确认 `design_doc`、最新 handoff、`handoff_hash` 和 design guard 的结果都已保存；这样压缩后才能从文件恢复，不会丢失尚未记录的设计判断。

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
- 如有新增功能或补充验收场景，OpenSpec delta spec 已创建或更新
- `design_doc` 已写入 `.comet.yaml`
- **阶段守卫**：运行 `comet guard <change-name> design --apply`，全部 PASS 后由守卫推进到 `phase: build`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

Step 3 成功返回 `data.phase: build` 即已通过并应用 Guard，不重复执行。失败时处理 `data.issues`，保留成果并重试同一 complete-design。

## 上下文压缩恢复

按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `design`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 和成功结果中的 `agent.continuation` 继续，不再查询 next。只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供下一步信息时，才重新读取：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续
