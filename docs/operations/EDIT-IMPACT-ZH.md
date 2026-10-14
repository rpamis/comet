# Verify 阶段的非行为修改

Native 和 Classic 会先重建一次 Write、Edit、MultiEdit 或 apply_patch 的完整修改，再结合差异、文件用途和当前验收条件判断影响。这个入口不限制语言和文件格式：代码、配置、文案和其他文本文件都可以复核。普通说明文档沿用项目已有的文档策略。

判定结果决定后续处理：

- 确认不影响行为：保留 Verify，允许应用具体编辑，并刷新已经失效的检查。
- 确认改变实现、需求或验收条件：通过原工作流修订。
- 无法确定：保留 Verify，记录待复核编辑；复核完成前暂时阻止该编辑、通过和归档。

本地解析只是提供等价证据的快捷方式。现有解析器可以识别部分源码、结构化数据和 Markdown 的等价编辑；解析结果不同、解析失败或没有对应解析器，都进入同一个复核入口，不直接推断行为变化。例如，同一段逻辑的局部重写、配置中的说明文字调整，都需要结合实际使用方判断，不能仅凭语法结构或配置值不同要求回滚。

复核由当前工作流的独立 Verifier 完成，不需要额外模型、API key 或联网服务。Verifier 读取原文件和具体修改请求，核对实际使用方及验收条件，并在结果中说明判断依据；仍无法判断时保持待复核。Runtime 只保存文件路径、内容 hash、候选归属和复核结果，不保存源文件内容。

实际文件 hash 仍然参与检查绑定。保留 Verify 不代表沿用旧的成功结果：已经失效的检查必须按新文件内容重新执行。正式需求、计划和 Runtime 材料保留原有确认协议；`AGENTS.md`、`CLAUDE.md`、Skill 和 Agent 规则文件属于执行输入，不能通过通用编辑复核绕过修订要求。

## 复核具体编辑

把原始 Hook 请求写入临时 JSON 文件，然后读取复核任务。`workflow` 使用 `native` 或 `classic`，`change` 使用当前需求名称：

```bash
comet edit-review prepare <workflow> <change> --file hook-input.json --json
comet edit-review show <workflow> <change> --json
```

Verifier 读取原文件、返回的完整编辑请求及相关调用场景，判断是否影响行为。SDK 复核结果必须使用当前独立 Verifier 已领取的 Action 身份提交：

```json
{
  "proposalHash": "prepare 返回的 proposalHash",
  "decision": "non-behavioral",
  "summary": "具体说明哪些内容变化，以及为什么不影响行为",
  "claim": {
    "actionId": "当前 Verifier Action ID",
    "attempt": 1,
    "inputHash": "当前 Action 输入 hash",
    "claimToken": "当前领取 token",
    "sessionId": "独立 Verifier session ID"
  }
}
```

```bash
comet edit-review record <workflow> <change> --file review-result.json --json
```

旧 Compat 工作流没有 SDK 的领取身份，结果需要用户明确确认后通过同一命令的 `--confirmed` 提交。该标志只记录用户对这份具体复核结果的确认，不能代替 SDK 的独立 Verifier 身份。

`non-behavioral` 通过后，重试原编辑。授权只匹配这一候选、工作区和编辑前后的内容；再次修改需要重新判定。修改尚未应用、复核未完成或当前内容不匹配时，Runtime 都会阻止通过和归档。

`implementation-changed` 或 `requirements-changed` 表示应使用原工作流的实现或需求修订入口。不要用复核结果覆盖正式需求、设计和计划的确认。放弃尚未应用的提案时，可以提交 `decision: "discard"`；已经应用的修改不能靠丢弃复核跳过验收。

## 刷新检查

Classic 在 Verify 重新执行受影响的 `comet check run <change> verify -- <program> [args...]`。Native Compat 沿用当前检查计划重跑。

Native SDK 的 Verifier 使用已有的 `request-checks` 响应，列出原检查，并在响应外层加入 `refreshChecks: true`。Runtime 会在新的检查 Action 中执行原候选的全部已声明检查及本次请求的检查，再继续同一 Verifier：

```json
{
  "candidateId": "当前候选 ID",
  "verifierExecutionRef": "当前独立 Verifier session ID",
  "refreshChecks": true,
  "response": {
    "kind": "request-checks",
    "iteration": 1,
    "attempt": 1,
    "checks": ["填写原检查的完整计划对象"]
  }
}
```

Verifier 已提交通过结果、尚在 Verify 等待确认时，读取 `comet native status <change> --json`，选择返回的 `--retry-verifier` 命令重新验收。Runtime 保留候选和实现迭代，刷新检查并派发新的独立验收尝试，不返回 Build。旧 SDK 定义先通过 `comet native doctor <change> --repair` 显式升级，再使用重新验收选项。

正常情况下仍复用未失效的证据。刷新遵守既有检查请求次数限制，不重放不可重复执行的命令；这类检查失效时，需要通过原工作流确认后续验证方式。检查失败、命令冲突和无法完整读取的输入不能被当作通过。

本次判定针对具体文件编辑。Git 提交、暂存区变化、重命名、文件增删及执行权限变化仍按候选绑定规则处理。二进制、大于 1 MiB 的文件和无法重建的工具请求不会由本地规则自动放行。
