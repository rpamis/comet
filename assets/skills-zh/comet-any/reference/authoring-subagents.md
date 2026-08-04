# Authoring Subagents 总览

## 核心原则

`/comet-any` 的创作成果由六个职责独立的 subagent 分工产出，再交给主会话组装和后端 CLI 记录状态。主会话按 authoring DAG 为每个 lane 派发全新的 subagent，并把对应的 `reference/subagents/*.md` 作为该角色的 brief。

先读取本总览，再只把对应角色 brief 交给对应 subagent。不要把六个角色 brief 合并成一个大 prompt；
主会话负责保留全局上下文、汇总成果、调用 `comet bundle` 和 `comet publish`，subagent 只产出可审查草稿。

所有 subagent 只返回 Markdown 成果和结构化审查结论，不得直接写入 Bundle state，不得执行候选 Skill 的脚本，
不得运行发布、安装或分发命令。CLI 状态仍由主会话维护。

## 角色 brief

在用户确认 Skill Creator 方案后、运行 `comet creator generate` 或生成源码前，主会话按以下顺序读取并派发：

1. 脚本作者 subagent：`comet-any/reference/subagents/script-author.md`
2. reference 作者 subagent：`comet-any/reference/subagents/reference-author.md`
3. workflow entry 作者 subagent：`comet-any/reference/subagents/workflow-entry-author.md`
4. Skill 核心作者 subagent：`comet-any/reference/subagents/skill-core-author.md`
5. 停顿点作者 subagent：`comet-any/reference/subagents/pause-points-author.md`
6. Skill 审查 subagent：`comet-any/reference/subagents/skill-reviewer.md`

角色文件在本 Skill 内的相对路径是：

- `reference/subagents/script-author.md`
- `reference/subagents/reference-author.md`
- `reference/subagents/workflow-entry-author.md`
- `reference/subagents/skill-core-author.md`
- `reference/subagents/pause-points-author.md`
- `reference/subagents/skill-reviewer.md`

这些 subagent 的成果先落为可审查草稿，再进入 `reference/authoring-lanes.json`、`reference/skill-review.md`
和最终 Bundle draft。若任一 subagent 报告 blocking finding，必须停在草稿修复，不得继续 ready。

## 按 DAG 派发

上面的角色 brief 顺序只是创作 DAG 的线性展开，并非要求严格串行。权威 DAG 在 `reference/authoring-protocol.json` 与 `comet creator authoring-plan <name> --depth quick|full --json`：

- **wave1**（`script`、`reference`、`pause-points`）：彼此无依赖，并发派发这三个。每个只拿到自己的角色 brief、通用输入和 protocol/resolved-skills 路径（文件交接，不共享历史）。
- **wave2**（`workflow-entry`、`skill-core`）：依赖 script 契约（`NEXT:`/`SKILL:` 输出）。仅在 script lane DONE 后开始。两者之间可并发。
- **barrier**（`skill-review`）：唯一同步点。仅在 wave1 与 wave2 全部 DONE 后运行；审查者必须读取所有 artifact 与 claim。

派发规则：

- 编排遵循 DAG 依赖；只有 barrier 真正等待此前所有 lane。
- 每个 lane 产出在下一个依赖 wave 开始前，必须经 `comet creator authoring-record <name> --lane <id> --file <out.json> --json` 校验并记录。

## 通用输入

每个 subagent 都必须拿到同一组上下文：

- 用户确认的目标、起点和语言。
- `plan.json` 中的 `goal`、`workflow.kind`、`workflow.nodes`、`engineMode`、`runnerMode`，以及规范化后的 `workflow-protocol.json`。
- `reference/resolved-skills.json` 或等价的真实 Skill 来源摘要。
- `reference/workflow-protocol.json` 或即将写入该文件的 workflow protocol。
- `/comet-classic` 定制场景下的受保护边界：`open / design / build / verify / archive`、`.comet.yaml`、decision point、verify-result-transition、archive-delta-sync。
- 项目级偏好、缺失/歧义候选处理结果、偏离原因、scripts/hooks 可执行披露。

## 输出格式

每个 subagent 返回：

```json
{
  "lane": "<lane-name>",
  "artifacts": [
    {
      "path": "reference/example.md",
      "kind": "reference",
      "content": "..."
    }
  ],
  "claims": [
    {
      "id": "reference:example",
      "kind": "reference",
      "paths": ["reference/example.md"],
      "summary": "说明该成果保证了什么"
    }
  ],
  "findings": []
}
```

`claims` 是审查依据，不是装饰字段。缺少关键 claim 时，Skill 审查 subagent 必须阻塞。

## 派发注意事项

- 每次派发必须创建新的 subagent，不得继承主会话历史。主会话只提供该角色需要的 brief、输入路径和必要背景。
- 使用文件交接：主会话提供路径，不粘贴大段全文。通用输入、来源 Skill 摘要、草稿 artifact 和报告都应以路径交接。
- 每个 subagent 只接收自己的角色 brief、通用输入和必要 artifact，不接收其他角色的完整 brief。
- Skill 审查 subagent 必须在其他五个作者角色产出后运行，并读取所有 artifacts 与 claims。
- 主会话可以要求某个角色返工，但返工结果仍必须回到 `reference/authoring-lanes.json` 和 `reference/skill-review.md`。
- subagent 不能调用 `comet bundle`、`comet publish`、`comet skill`，也不能执行候选 Skill 的脚本。
- 如果状态是 `BLOCKED` 或 `NEEDS_CONTEXT`，主会话必须补上下文、拆小任务、换更强模型或询问用户；不得继续组装。
