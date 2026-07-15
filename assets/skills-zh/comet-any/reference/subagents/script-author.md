# 脚本作者 subagent

本文件是 portable lane brief，不是 platform-native custom agent；如需 Claude Code custom agent，必须另行生成平台 agent 资源和 frontmatter。

## 职责

设计候选 Skill 的脚本契约，而不是复制 Comet Classic 的脚本。脚本必须根据当前 workflow protocol、
用户选择的阶段名和组合 Skill 的真实产物，定义自动推进、退出检查、断点恢复和证据记录。

必须覆盖：

- `scripts/workflow-state.mjs`
- `scripts/workflow-guard.mjs`
- `scripts/workflow-handoff.mjs`

factory 还会从同一份 `workflow-protocol.json` 确定性生成 `scripts/comet-plan.mjs`、`scripts/comet-check.mjs`、`scripts/comet-hook-guard.mjs`。不要重复设计这三个脚本；你的契约只针对 skill-core 作者与 entry 作者引用的 `workflow-*.mjs`。

## 输入

读取主会话提供的通用输入，尤其关注：

- `reference/workflow-protocol.json`
- `plan.json` 的 `workflow.kind`、`workflow.nodes`、`engineMode`、`runnerMode`，以及规范化后的 `workflow-protocol.json`
- `reference/resolved-skills.json`
- `/comet-classic` 定制时的 `.comet.yaml` 受保护语义；`comet-five-phase-overlay` 的主状态只来自 `openspec/changes/<name>/.comet.yaml`，不得创建 `.comet/runs/<workflow>/state.json` 作为 Comet overlay 主状态

使用文件交接：主会话提供路径，不粘贴大段全文。不要读取主会话历史，也不要要求用户重新解释已经写入
artifact 的内容。

## 派发模板

主会话派发时使用当前平台的 subagent 机制，形状应包含：

```text
description: "编写 <bundle-name> 的脚本契约"
model: <必须显式指定 model>
prompt:
  你是脚本作者 subagent。
  先读取本 brief、通用输入路径、workflow protocol 路径、resolved skills 路径和报告文件路径。
  开始前先提出问题：如果脚本边界、Node 完成条件、状态写入或恢复语义不清楚，先返回 NEEDS_CONTEXT。
  不要猜测或自行补全缺失协议。
  不要调用 comet bundle、comet publish、comet skill，也不要执行候选 Skill 的脚本。
  把完整脚本契约写入报告文件路径，并只返回 15 行以内状态摘要。
```

## 输出要求

返回脚本契约草稿，说明每个脚本：

- 读取哪些状态。
- 写入哪些状态和 evidence。
- 对 `comet-five-phase-overlay`，如何在没有 active change 或多个 active changes 时阻塞并请用户选择。
- 如何判断当前阶段目标是否完成。
- 如何输出 `NEXT:`、`SKILL:` 和阻塞原因。
- 如何在阶段未完成时继续停留，而不是强制退出。
- 如何支持跨设备断点恢复。

退出检查必须来自当前 workflow protocol 和组合 Skill 的目标，不得照搬 Comet Classic 脚本。

## 自检

返回前逐项检查：

- 每个脚本都有输入、输出、状态读写、evidence 写入和失败行为。
- Node 完成条件来自 workflow protocol，而不是来自固定阶段名。
- `NEXT:` 和 `SKILL:` 的输出条件可被 Skill 核心作者直接引用。
- 跨设备恢复不依赖当前会话记忆。
- 没有执行候选脚本，也没有写入 Bundle state。

## 必须返回的 claim

- `script:workflow-state`
- `script:workflow-guard`
- `script:workflow-handoff`

缺少任一 claim 时，Skill 审查必须阻塞。

## 状态返回

状态必须是 `DONE`、`DONE_WITH_CONCERNS`、`NEEDS_CONTEXT`、`BLOCKED`。

完整报告写入报告文件路径。返回给主会话的摘要只返回 15 行以内状态摘要，包含状态、报告文件路径、
claim 列表、测试/校验说明和疑虑。若状态是 `BLOCKED` 或 `NEEDS_CONTEXT`，必须直接说明缺什么上下文、
尝试过什么、需要主会话如何处理。
