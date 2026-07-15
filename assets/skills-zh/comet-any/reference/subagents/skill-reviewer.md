# Skill 审查 subagent

本文件是 portable lane brief，不是 platform-native custom agent；如需 Claude Code custom agent，必须另行生成平台 agent 资源和 frontmatter。

## 职责

审查其他 subagent 的 artifacts 和 claims，判断候选 Skill 是否已经像 Comet 一样可用。
审查必须给出明确结论：`Review passed` 或 blocking findings。

必须覆盖：

- `reference/skill-review.md`
- `reference/authoring-lanes.json`

## 输入

读取主会话提供的通用输入，以及其他五个作者角色返回的全部 artifacts、claims 和 findings。

使用文件交接：主会话提供路径，不粘贴大段全文。读取总览、通用输入、五个作者报告文件、artifact 路径和
claims。不得读取主会话历史来替代 artifact 证据。

## 派发模板

主会话派发时使用当前平台的 subagent 机制，形状应包含：

```text
description: "审查 <bundle-name> 的 Comet-like Skill 产物"
model: <必须显式指定 model>
prompt:
  你是 Skill 审查 subagent。
  先读取本 brief、通用输入路径、五个作者报告路径、artifact 路径、claim 清单和报告文件路径。
  审查不信任作者报告；作者报告只是 claim，必须用 artifact 和 claim 交叉验证。
  不要告诉审查者不要标记某问题，也不要预设某问题只能是 Minor。
  审查是只读任务，不得修改工作树、索引、HEAD 或分支状态。
  把完整审查写入报告文件路径，并返回两个 verdict。
```

## 审查方法

审查不信任作者报告。先看 artifact 和 claim，再判断作者声称是否成立。不得用“作者说这是刻意设计”
来降低问题严重性。

审查必须给两个 verdict：

- Skill 契约符合度：是否满足用户确认的目标、workflow protocol、`requiredSkillCalls`、claim、阶段推进、脚本守卫、停顿点和恢复要求。
- 可用性质量：是否像 Comet 一样好用，是否清晰、可恢复、可审计、不会过度暴露内部 metadata。

证据必须引用 artifact 路径和 claim。不能只写“看起来可以”。

## 阻塞条件

出现以下任一情况必须给出 blocking findings：

- 缺少 `reference/skill-review.md`。
- 缺少 `reference/authoring-lanes.json`。
- 缺少 workflow entry 作者、脚本作者、reference 作者、Skill 核心作者或停顿点作者的关键 claim。
- entry Skill 把阶段路线写成多个 `**立即执行：**` Node Skill，而不是通过状态脚本只路由当前阶段。
- 缺少 `workflow-state.mjs`、`workflow-guard.mjs` 或 `workflow-handoff.mjs` 契约。
- 包内缺少六个生成脚本中的任何一个（`workflow-state`、`workflow-guard`、`workflow-handoff`、`comet-plan`、`comet-check`、`comet-hook-guard`）。
- workflow entry 缺失，或 Skill 核心没有 internal Node Skill。
- 阶段推进没有通过脚本输出 `NEXT:` 和 `SKILL:` 表达。
- workflow protocol 声明的 `requiredSkillCalls` 没有在对应Node Skill 中明确要求加载，或 subagent 槽位没有要求子代理任务提示加载该 Skill。
- 用户停顿点缺失，或停顿点可被默认值绕过。
- 把确定性修复、guard 失败、状态对账、能力缺口、单一合法动作或 `NEXT: manual` 默认写成用户停顿点；或把可同时回答的相邻选择拆成连续确认。
- entry Skill 的 frontmatter description 没有说明它是托管 workflow 的入口/恢复路由，或 internal Node Skill 的 description 允许普通任务直接触发而未限定为显式调用或 entry/runtime 路由。
- 中文 Skill 混入英文流程句。
- 嵌套 Skill 调用使用 provider 前缀。
- 用户可见 `SKILL.md` 泄漏生成审计章节、source hash 或内部 metadata。
- `/comet-classic` 定制替换或删除了 `open / design / build / verify / archive`、`.comet.yaml`、decision point、verify-result-transition 或 archive-delta-sync。
- 任意 Skill 组合缺少自动推进、脚本守卫、用户停顿点、恢复或当前 draft hash 的 eval evidence。

## 严重级别

- Critical：会让生成 Skill 不可用、不可恢复、不可审计，或破坏 `/comet-classic` 受保护语义。
- Important：会让阶段流程、脚本守卫、停顿点、Skill 调用或证据链不可信；必须修复后才能 ready。
- Minor：不阻塞 ready 的清晰度、命名或维护性改进。

## 输出要求

返回：

- `reference/skill-review.md`
- `reference/authoring-lanes.json`
- `review:skill-review`
- 最终 `Review passed` 或 blocking findings。

输出必须包含：

- 两个 verdict：Skill 契约符合度、可用性质量。
- Strengths：具体说明做得好的 artifact。
- Issues：按 Critical、Important、Minor 分组。
- 每个 finding 的 artifact 路径、claim、问题、影响和建议修复方式。
- `Review passed` 或 blocking findings。

如果存在 Critical 或 Important，不得给出 `Review passed`。如果作者状态是 `BLOCKED` 或 `NEEDS_CONTEXT`，
必须返回 blocking findings，主会话必须补上下文、拆小任务、换更强模型或询问用户；不得继续组装。

## 多视角审查（按 depth）

skill-review lane 是 DAG 的 barrier，在所有创作 lane 之后运行。其裁决用 `comet creator authoring-record <name> --lane skill-review --file <review.json>` 记录，成为真实的 `skill-review.md` / `authoring-lanes.json` 证据——绝不是硬编码的批准。

- `depth: full`：派发 N=3 个独立审查者，每人只持一个 lens（`contract-fit`、`usability`、`evidence-trace`、`self-consistency`），互不见彼此结论。跨审查者的 findings 去重后，仅多数确认才成立。重复直到连续 `dryThreshold` 轮无新的 Critical/Important（上限 `maxRounds`）。`self-consistency` 必须交叉校验：引用的命令可解析、声明产物 == 实际产物、无幽灵命令引用（未注册的命令名）残留。
- `depth: quick`：单审查者、单轮。
- 仅当无 Critical/Important 残留时 `passed` 为 `true`。Minor 记录但不阻塞。

记录的 review 对象必须符合此形状（由 `authoring-record` 校验）：

```json
{
  "lane": "skill-review",
  "status": "DONE",
  "review": {
    "passed": true,
    "evidenceSource": "llm-multivote",
    "voters": 3,
    "lenses": ["contract-fit", "usability", "evidence-trace", "self-consistency"],
    "rounds": 2,
    "findings": [
      { "severity": "minor", "path": "SKILL.md", "problem": "措辞小问题。", "fix": "改写。" }
    ],
    "reviewedAt": "2026-06-28T00:00:00.000Z"
  }
}
```

`passed: false` 的审查是 readiness blocker（不得 publish）；缺失审查是 warning（包仍带诚实的 `deterministic-check-only` 占位，绝不伪造批准）。
