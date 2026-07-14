# Authored 区质量标尺（样例）

这是你编写的 **Authored 区**（entry 的 `## Decision Core`、node 的 `## Guidance`）的具体质量标尺。生成器把你的 Authored 区组装到确定性 **Auto 区**（frontmatter、路由表、Entry/Exit Check、证据格式、Recovery）之上。**你只写 Authored 区**。请按本样例校准，而不是写一行套话。

## "Auto" 与 "Authored" 的含义

- **Auto 区（模板，不要重写）**：不变的控制面。node 的 Auto 区包括 `## Node Goal`、`## Entry Check`、`## Skill Implementation`、`## Required Skill Calls`、`## Output Schemas`、`## Evidence Record`、`## Guardrails`、`## Exit Check`、`## Recovery`。entry 的 Auto 区包括 `## Workflow Nodes`、`## Skill Bindings`、`## Guardrails And Evidence`、`## Runtime And Recovery`。
- **Authored 区（你写）**：Auto 区无法得知的领域决策。这是让 Skill "好用"而非"只是能跑"的关键。

## 样例：`substance` 节点的 Guidance 区（workflow-kernel）

下面是 research-writer workflow 中"Research"生产者节点的 `## Guidance` 正文。注意它是**决策内容**：前提、有序的领域步骤、超出机械 Exit Check 的完成判断、Red flags。它按名引用绑定的 Skill，但不复制其正文。

```markdown
## Prerequisites

- entry 的 Decision Core 已确认研究主题与范围。
- `research-skill` 在项目 Skill 池中可解析；若缺失，先停下询问用户，不要临时替代。

## Steps

1. 加载 `research-skill` 并按其发现方法处理已确认主题。当项目 Skill 定义了特定来源顺序时，不要用通用网络搜索替代。
2. 按优先级收集来源；为每个来源记录来源、日期和你要复用的论点。不通过项目可信度门槛的来源应直接剔除，而不是标注为"偏弱"。
3. 把发现提炼到 `notes/*.md` 笔记文件——每条独立论点一份，含逐字引用与来源指针。综合写在 writer 节点，不在这里。
4. 记录 `research.notes.v1` 的 `summary` evidence：一段提炼 + 产出的笔记数量。

## Completion reasoning

本节点完成当且仅当两条同时成立：(a) 已记录 `summary` evidence；(b) 至少一个 artifact 匹配 `notes/*.md`。不要仅仅因为步骤清单走完就退出——如果相对主题范围笔记仍偏稀疏，应继续研究而非宣布完成。Exit Check 脚本会机械地强制 artifact + evidence 要求；你的职责是判断研究是否真正充分。

## Red flags

- 记录了 `summary` 却没有产出任何 `notes/*.md` 就退出（guardrail 会阻塞——不要试图绕过）。
- 把来源原文复制进笔记却不加引用标记或来源指针。
- 某来源仍"待核实"就推进到 Write 节点——核实属于本节点。
- 对需要多视角的主题，仅凭单一来源就认为充分。
```

用 `###` 子标题，使其嵌套在 `## Guidance` 之下。上述四段（Prerequisites / Steps / Completion reasoning / Red flags）是 `substance` 节点的预期形态。

## 样例：entry Decision Core（workflow-entry）

下面是 entry SKILL.md 的 `## Decision Core` 正文。entry 是**每次调用最先读取的文件**——一个薄 Decision Core（"跑 next，照做"）会让整个 Skill 感觉机械。一个富 Decision Core 是 comet 级 Skill "好用"的核心。

Decision Core 应建模 Auto 区不处理的三件事：(1) **语义化当前节点检测**（如何判断用户在哪个 Node，而非只看脚本输出），(2) **resume 与 drift 规则**（上下文恢复或状态与文件冲突时怎么办），(3) **决策点与 Red flags**（何时暂停等用户，以及什么是假进展）。

```markdown
### 自动节点检测

**Step 0：确定当前节点与意图**

1. 检查 workflow protocol 的有序 Node 列表。第一个未完成（无 Exit evidence 记录）的 Node 是候选当前节点。
2. 若用户描述的工作明显属于更后面的 Node（如"验证结果"但研究尚未完成），暂停并说明：前序 Node 必须先完成。不要跳过。
3. 若用户描述的工作属于已标记完成的更早 Node，视为纠正——重置该 Node 的完成状态并重新进入。

**Step 1：读取 workflow 状态**

运行 `node "$WORKFLOW_STATE" status` 确认检测到的节点。若脚本的 `NEXT:` 输出与文件证据冲突（如脚本说 DONE 但无 artifact），以文件为准，先纠正状态再继续。

**Resume 规则**：
- 每次上下文恢复，重新执行 Step 0 和 Step 1。不要信任对话历史做节点检测。
- 若状态显示某 Node 已完成但预期 artifact 缺失，视为未完成并重新进入。
- 若用户在某个 Node 中途恢复但话题变了，确认是继续当前 Node 还是开始新的。

### 决策分类与决策点

先分类再行动：有两个或以上会改变范围、行为、风险接受或不可逆结果的合法选项才是用户决策；唯一安全下一步直接执行；缺少依赖、状态损坏或无法继续的 guard 失败是停止条件；`NEXT: manual` 只是交还控制权。只有第一类必须暂停。

| 情况 | 处理 |
|------|------|
| 首次调用且主题/范围明确 | 自动初始化状态并进入第一个 Node；不得为了确认已知信息而停顿 |
| 主题、范围或目标 Node 存在两个以上互斥且合法的解释 | 合并为一个问题，让用户选择；不要猜测 |
| Node 需要用户确认输出才能推进 | 记录 evidence 后停下；等待明确确认 |
| WARNING/偏差接受或不可逆发布存在真实取舍 | 只展示当前可执行选项，并记录用户选择 |

Node guard 失败时先自动读取证据并执行唯一安全修复；若缺少依赖或状态损坏导致无法继续，报告停止条件和恢复要求。只有恢复方式存在多个会改变范围或风险的合法选项时，才升级为上表中的用户决策。

### Red Flags

| Agent 想法 | 实际风险 |
|-----------|---------|
| "首次调用都应该再确认一次" | 清晰输入不需要重复批准；只有互斥解释仍会改变范围时才询问。 |
| "脚本返回 NEXT: auto，应该立即加载下一个 Skill" | `NEXT: auto` 表示 Node 完成，不是跳过确认。检查下一个 Node 是否有决策点。 |
| "guard 失败，所以让用户决定怎么办" | 先自动诊断并执行唯一安全修复；无合法动作时报告停止条件，不要发明选项。 |
| "看起来和上次一样的话题，从上次断点继续" | 始终重新读取状态。对话记忆在上下文压缩后不可靠。 |
| "Exit Check 通过了，所以工作够好了" | Exit Check 是机械的。你的职责是判断检查之外的质量——稀疏笔记、浅层分析、缺失视角，脚本抓不到。 |
```

此样例以精简形式建模了 comet 的 Decision Core：语义检测（Step 0 读 Node 顺序，非只看脚本输出）、状态忠实（文件优先于过期状态）、resume 规则（每次恢复重新检测）、阻塞决策点（显式表格）、Red flags（"想法 → 风险"模式，抓 agent 自欺）。

## substance 与 delegates

- **substance** 节点（workflow-kernel）：上面的样例就是标尺。必须有富 Guidance；缺失时该节点渲染为 `AUTHORING PENDING`，Bundle 不得 ready。
- **delegates** 节点（comet-five-phase-overlay，委托给已安装的富 Skill）：富执行内容由被委托 Skill 承载，**不要复制**。但如果该节点声明了 **Required Skill Calls**（如 execute 节点要求 `elementui`），请写一段聚焦的整合说明——在被委托流程的什么时机必须加载该 Skill、它补充什么 evidence——而不是泛泛一句"加载 X"。例如要求 `elementui` 的 delegates execute 节点：

```markdown
本节点用 `comet-build` 执行。在其流程之外，每当改动涉及组件库时加载 `elementui`，并在记录 `required-skill:execute.elementui` 检查前确认改动使用了项目认可的组件。不要重复实现 `comet-build` 已做的事。
```

## 反模式（不要写）

- 一行式 Guidance，如"运行本节点并记录 evidence。"——Auto 区已隐含此意，毫无增量。
- 整段复制被绑定 Skill 的正文。
- 重述路由表或 Output Schema 列表（Auto 区已有）。
- substance 节点没有 `### Red flags`——Red flags 是大部分真实价值所在。
