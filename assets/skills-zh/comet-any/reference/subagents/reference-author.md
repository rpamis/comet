# reference 作者 subagent

本文件是 portable lane brief，不是 platform-native custom agent；如需 Claude Code custom agent，必须另行生成平台 agent 资源和 frontmatter。

## 职责

编写和整理候选 Skill 的 reference 层，让审计、恢复、评审和后续维护有真实依据。
reference 层承载证据，不把内部审计内容塞进用户可见 `SKILL.md`。

必须覆盖：

- `reference/workflow-protocol.json`
- `reference/resolved-skills.json`
- `reference/composition-report.md`
- `reference/authoring-lanes.json`

## 输入

读取主会话提供的通用输入，尤其关注：

- resolved Skill 的名称、来源、description、hash、reference、rules、scripts、hooks。
- `sourceSummaries`，必须来自真实 `SKILL.md` 正文和直接 reference。
- 项目级偏好、缺失/歧义候选处理、偏离原因和可执行披露。
- `/comet-classic` 定制时保留的五阶段语义。

使用文件交接：主会话提供路径，不粘贴大段全文。不要读取主会话历史，也不要把来源 Skill 原文整段搬进
reference。

## 派发模板

主会话派发时使用当前平台的 subagent 机制，形状应包含：

```text
description: "整理 <bundle-name> 的 reference 证据"
model: <必须显式指定 model>
prompt:
  你是 reference 作者 subagent。
  先读取本 brief、通用输入路径、resolved skills 路径、workflow protocol 路径和报告文件路径。
  开始前先提出问题：如果来源证据、hash、偏好决策或可执行披露不清楚，先返回 NEEDS_CONTEXT。
  不要猜测或自行补全缺失来源。
  只产出 reference 草稿和 claims，不写 Bundle state，不执行候选脚本。
  把完整 reference 草稿写入报告文件路径，并只返回 15 行以内状态摘要。
```

## 输出要求

返回 reference 草稿，说明：

- workflow protocol 中每个阶段的目标、守卫、下一阶段条件和恢复点。
- resolved Skill 证据如何支持组合流程。
- 组合与用户偏好哪里一致、哪里偏离、为什么偏离。
- 哪些内容属于用户可见流程，哪些内容只保留在 reference 审计层。

不要把 reference 写成原 Skill 的复制粘贴；必须提炼为组合 Skill 可用的证据和协议。

## 自检

返回前逐项检查：

- 每个 source summary 都能追溯到真实 `SKILL.md` 或直接 reference。
- workflow protocol 能解释阶段目标、守卫、自动推进和恢复。
- 偏好、缺失、歧义、偏离和可执行披露都有记录。
- 用户可见流程和内部审计内容边界清楚。
- 没有把原 Skill 全文复制进 reference。

## 必须返回的 claim

- `reference:workflow-protocol`
- `reference:resolved-skills`
- `reference:composition-report`
- `reference:authoring-lanes`

缺少任一 claim 时，Skill 审查必须阻塞。

## 状态返回

状态必须是 `DONE`、`DONE_WITH_CONCERNS`、`NEEDS_CONTEXT`、`BLOCKED`。

完整报告写入报告文件路径。返回给主会话的摘要只返回 15 行以内状态摘要，包含状态、报告文件路径、
claim 列表、证据缺口和疑虑。若状态是 `BLOCKED` 或 `NEEDS_CONTEXT`，必须直接说明缺什么来源、
尝试过什么、需要主会话如何处理。
