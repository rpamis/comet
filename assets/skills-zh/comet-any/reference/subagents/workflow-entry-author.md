# Workflow Entry 作者 subagent

本文件是 portable lane brief，不是 platform-native custom agent；如需 Claude Code custom agent，必须另行生成平台 agent 资源和 frontmatter。

## 职责

编写生成 Skill 的 entry `SKILL.md`。entry 只负责入口、恢复、主路由说明和用户停顿点；不得把阶段路线写成会立即触发多个 Skill 的执行清单。

必须覆盖：

- entry Skill
- workflow-state / workflow-guard / workflow-handoff 的入口说明
- `workflow-entry` claim

## 创作区（你写什么）

生成器把 entry SKILL.md 组装成确定性 **Auto 区**（frontmatter、Workflow Nodes 路由表、Skill Bindings、Guardrails And Evidence、Runtime And Recovery）+ 由你编写的 **Authored 区**（`## Decision Core`）。**你只写 Decision Core 正文，不写整个文件**。主会话通过 `comet creator authoring-record <name> --lane workflow-entry --file <out.json>` 记录；artifact `SKILL.md` 的 `content` 即 Decision Core 正文。

质量标尺：`comet/SKILL.md` 的 Decision Core（完整 entry Decision Core 范例见 `reference/authored-zone-example.md`）。写 agent 可读的决策规则——机械路由已由 Auto 区的 `workflow-state.mjs next` 处理，所以聚焦判断：

- **语义化当前节点检测** — 如何判断用户在哪个 Node，而非只跑脚本。建模 comet 的 Step 0（从用户消息检测意图，检查 Node 顺序，处理"属于前序/后序 Node"的冲突）+ Step 1（读状态，文件优先于过期状态）。
- **Resume 与 drift 规则** — 上下文恢复时怎么办（从头重新检测，永远不信任对话历史），状态说 DONE 但 artifact 缺失时怎么办，用户在 Node 中途换话题时怎么办。
- **决策分类与决策点** — 先区分用户决策、自动处理、停止条件和手动衔接，再只为真正需要用户选择的情况建表。清晰的首次调用、可确定修复的 guard 失败、单一合法下一步和 `NEXT: manual` 都不得制造确认点。
- **Red flags** — "agent 想法 → 实际风险"模式，抓自欺（如"用户提到了主题所以研究已确认" → 提到 ≠ 确认）。

没有这四个子节的 Decision Core 是 stub，不是 Decision Core。entry 是每次调用最先读取的文件——它决定了 Skill 感觉"智能"还是"机械"。

Auto 区的 Node 路由表仅供参考——不要复制成执行清单，不要发出多个立即 Skill 加载。

## 输入

读取主会话提供的通用输入，尤其关注：

- 用户确认的目标、语言和阶段名。
- `reference/workflow-protocol.json` 的阶段顺序、插槽、`requiredSkillCalls` 和恢复路径。
- 脚本作者返回的 `status`、`init`、`next`、`NEXT:`、`SKILL:` 和 guard 契约。
- `/comet-classic` 定制场景下必须保留的 open / design / build / verify / archive 边界。

使用文件交接：主会话提供路径，不粘贴大段全文。不要继承主会话历史；只使用本 brief、通用输入、脚本契约和 reference 证据。

## 派发模板

主会话派发时使用当前平台的 subagent 机制，形状应包含：

```text
description: "编写 <bundle-name> 的 workflow entry"
model: <必须显式指定 model>
prompt:
  你是 workflow entry 作者 subagent。
  先读取本 brief、通用输入路径、脚本契约路径、workflow protocol 路径和报告文件路径。
  开始前先分类用户决策、自动处理、停止条件和手动衔接；如果启动路由、恢复路径、当前阶段判定或真正的用户选择不清楚，先返回 NEEDS_CONTEXT。
  不要猜测或自行补全缺失流程。
  只写 entry SKILL.md 草稿，不写 internal Node Skill，不写 Bundle state，不执行候选脚本。
  Decision Core 必须包含四个子节：### 自动节点检测（Step 0 意图检测 + Step 1 状态读取 + Resume 规则）、### 决策分类与决策点（只列真正的用户选择）、### Red Flags（agent 想法 → 实际风险表格）。不得把 guard 失败、确定性修复、单一合法动作或手动衔接列为用户决策。没有这些子节的 Decision Core 是 stub。
  把完整 entry 草稿写入报告文件路径，并只返回 15 行以内状态摘要。
```

## 输出要求

entry 草稿必须体现：

- 进入 Skill 后先读取 workflow 状态，不直接加载Node Skill。
- 未启动时先初始化状态，再查询 `next`。
- 只有脚本输出 `NEXT: auto` 和 `SKILL: <node-skill>` 后，才加载这一个 Node Skill。
- 阶段路线只能作为参考表，不能使用“立即执行”或“必须加载”这类执行指令。
- 对 `/comet-classic` 定制，entry 必须列出必调槽位 Skill，但只能作为阶段内义务说明，不能变成 entry 立即执行清单。
- 用户决策、自动处理、停止条件、手动衔接、恢复路径和参考文件清楚可见；只有至少两个真实合法选项时才停顿，相邻选择应合并。
- 对 `/comet-classic` 定制，说明保留 open / design / build / verify / archive 主路径和阶段守卫。

禁止：

- 在 entry `SKILL.md` 中写多个 `**立即执行：**` Node Skill。
- 复制粘贴原 Skill 全文。
- 写 provider 前缀。
- 把审计报告、source hash、内部 metadata 泄漏到用户可见 `SKILL.md`。

## 自检

返回前逐项检查：

- Decision Core 包含全部四个必须子节：自动节点检测、决策点、Red Flags、Error Handling 或 Resume Rules。
- entry 只有一个主路由启动协议。
- entry 没有立即加载Node Skill 的清单。
- 阶段路线是参考，不是执行步骤。
- 自动推进引用脚本输出的 `NEXT:` 和 `SKILL:`。
- 清晰首次调用直接初始化；guard 失败先自动诊断或报告停止条件；`NEXT: manual` 只交还控制权；以上情况均不伪造用户决策。
- 中文用户可见文案没有混入英文流程句。

## 必须返回的 claim

- `workflow-entry`

缺少该 claim 时，Skill 审查必须阻塞。

## 状态返回

状态必须是 `DONE`、`DONE_WITH_CONCERNS`、`NEEDS_CONTEXT`、`BLOCKED`。

完整报告写入报告文件路径。返回给主会话的摘要只返回 15 行以内状态摘要，包含状态、报告文件路径、claim 列表、未解决疑虑和建议返工点。若状态是 `BLOCKED` 或 `NEEDS_CONTEXT`，必须直接说明缺什么上下文、尝试过什么、需要主会话如何处理。
