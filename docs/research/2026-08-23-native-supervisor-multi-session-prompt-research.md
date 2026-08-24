# Native Supervisor 多会话提示兼容调研

日期：2026-08-23  
范围：Codex 独立任务/并行 subagent、Claude Code Agent Teams、Comet Native Supervisor Change  
结论状态：MVP 建议只修改 Native Skill；不修改 Runtime

## 结论

Comet 可以把该能力定义为一个需要用户确认的“多会话协作”执行模式。Supervisor Change 的拆分、依赖、`readyChildren`、Child Worktree、`runId`、验收和集成仍由现有 Native Runtime 决定；Skill 只把 Runtime 返回的 ready Child 映射到宿主提供的独立执行会话，并负责监控、追问和汇总。

MVP 不需要新增 Runtime 状态或配置字段，原因是执行模式不改变 Native 的持久化语义，只改变当前宿主如何承载 Worker：

- Codex：优先使用宿主的独立任务能力；不可用时可退化为独立 subagent，再不可用时串行执行。
- Claude Code：Agent Teams 已启用时使用一个 lead 和多个 teammate；不可用时退化为 subagent 或串行执行。
- 所有平台：写入型 Child 必须进入 Runtime 指定的独立 Worktree；父会话只协调、集成和最终 Verify。

只有需要项目默认值、跨父会话恢复宿主任务句柄、Dashboard 展示团队状态或 Runtime 主动探测宿主能力时，才需要继续修改配置、Runtime 或 Dashboard。

## 已确认事实

### Codex

- OpenAI 官方把 Skill 定义为可复用工作流的指令载体；Skill 可以请求 Codex 使用并行 subagent。
- 官方建议用直接、具体的自然语言触发，例如明确“为每个点启动一个 agent”“等待全部完成后汇总”，并说明如何拆分、何时等待以及返回什么结果。
- Codex app 会显示 subagent thread，主线程可以收集结果、检查进度、继续引导或停止 agent。
- Codex 项目适合为不同结果建立独立 chat；各 chat 保留自己的上下文，项目保留共享说明和文件入口。
- 当前 Codex app 宿主还暴露了创建独立任务、读取任务状态、等待任务和向任务发送后续消息的能力。创建独立任务要求用户明确授权，因此 Comet 的模式选择可以提供这份授权。
- OpenAI 提示规范建议保持指令精简，每条规则只写一次，并明确自治范围、审批边界、停止条件和并发限制。

Codex 的“subagent thread”和用户截图中的“独立任务”不是完全相同的产品边界。前者是当前主任务内部的委派线程；后者是用户可在侧栏独立继续的任务。若目标是截图中的行为，Skill 必须明确写“创建独立任务，不要只启动 subagent”，并在用户选择该模式后才执行。

### Claude Code Agent Teams

- Agent Teams 是实验能力，默认关闭，需要显式启用 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，并且只在交互式会话中生成 teammate。
- 启用后，用户以自然语言要求 teammate、角色和任务结构即可触发；主会话是固定 team lead，teammate 有独立上下文，通过共享 task list 和 mailbox 协作。
- 最新官方行为不再保证额外的原生确认：启用 Agent Teams 后，带名字的 Agent 调用可能直接生成 teammate。因此 Comet 若要求“先问用户”，必须由 Skill 在调用前建立自己的确认点。
- Agent Teams 适合互相独立的研究、审查、新模块、竞争假设和跨层任务；顺序任务、同文件修改或强依赖任务会产生更高协调成本。
- Agent Teams 不自动为 teammate 建立 Git Worktree。Comet 必须先使用 Native Runtime 建立 Child Worktree，并在派发提示中把明确路径交给对应 teammate。
- Agent Teams 不能嵌套，lead 在会话生命周期内固定；in-process teammate 不能随 `/resume` 恢复，任务状态可能滞后。恢复 Supervisor 时不能只信任 Claude 团队状态，必须重新读取 Native Runtime。

## 方案比较

### A. 每个 Supervisor Change 询问一次（推荐）

在最终 Shape 确认中增加一个执行模式选择：

1. 多会话协作：确认后由当前会话作为协调者，按宿主能力创建 Codex 独立任务或 Claude Agent Team。
2. 单会话执行：继续使用现有串行回退语义。

用户已经明确要求“多个会话”“独立任务”或“Agent Team”时，视为已选择多会话协作，不重复询问。

优点是仅需修改 Skill，审批语义清楚，也不会把易变的宿主句柄写进 Comet 的持久化状态。缺点是 Supervisor 在全新父会话恢复且原宿主团队已消失时，需要重新询问或按单会话继续。

### B. 增加项目默认配置

例如增加 `native.supervisor_execution`。它能减少重复选择，但会引入配置 schema、CLI、Runtime 和文档改动，而且仍不能保证宿主任务句柄可恢复，不适合作为第一版。

### C. 检测到能力就自动启用

交互最少，但会放大 token 成本和并发写入风险，也无法满足“先问用户”的产品要求。Claude Code 启用 Agent Teams 后还可能把普通命名 subagent 自动提升为 teammate，因此不建议自动模式。

## 建议写入 Skill 的平台无关协议

```text
当 Supervisor Change 至少有两个可独立执行的 ready Child 时，在最终 Shape
确认中询问用户是否启用“多会话协作”。用户明确要求多个会话、独立任务或
Agent Team 时，视为已经确认，不重复询问。

确认后，当前会话只作为 Supervisor 协调者，不直接实现 Child。每个写入型
Child 使用 Runtime 返回的独立 Worktree、任务包和 runId。只派发
readyChildren；依赖未满足的 Child 不得启动。持续监控执行会话，出现阻塞、
范围歧义或新的用户可见决定时立即反馈父会话，不等全部任务结束。只有父会话
可以集成 Child 并执行最终 Verify。宿主能力不可用时保持相同范围和顺序语义，
退化为独立 subagent 或单会话串行执行。
```

### Codex 分支提示

```text
使用宿主的独立任务能力，为每个 ready Child 创建一个项目任务，不要只创建
当前会话内的 subagent。用户的模式确认即是创建这些任务的授权。以 Supervisor
integration HEAD 为起点，并让每个任务进入 Runtime 指定的 Child Worktree。
保存返回的任务引用；使用等待/读取任务能力监控进度，并在需要时向目标任务发送
后续指令。任务报告完成后仍以 Runtime 的验证与集成状态为准。
```

### Claude Code 分支提示

```text
仅在 Agent Teams 已启用且处于交互式会话时创建 teammate。当前会话保持 team
lead；每个 ready Child 对应一个有名字的 teammate，并在派发时提供 Child
Worktree 路径、任务包、runId、验收范围和停止条件。teammate 不得创建嵌套团队，
不得领取 Runtime 尚未返回为 ready 的任务，也不得直接集成到父分支。团队能力
不可用或恢复后 teammate 已消失时，重新读取 Runtime 并退化执行。
```

## 对当前 Native Skill 的最小改动位置

- Shape：在现有 Supervisor 拆分确认之后增加一次执行模式选择，明确“用户已主动要求时不重复问”。
- Build：把当前笼统的“平台支持并行时派发”改成平台无关协议，并增加 Codex 与 Claude Code 两个宿主分支。
- Verify：保留现有“fresh read-only Verifier subagent 或独立 Agent 任务”语义，不让 Builder teammate 自验收。
- 不改 `children.yaml`、Runtime continuation、`runId`、最大并发数或 Archive 规则；当前 Runtime 的并发上限仍为两个。

## 官方来源

- OpenAI, [Build skills](https://developers.openai.com/codex/skills)
- OpenAI, [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- OpenAI, [Projects and chats](https://learn.chatgpt.com/docs/projects)
- OpenAI, [Model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- Anthropic, [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- Anthropic, [Run agents in parallel](https://code.claude.com/docs/en/agents)
