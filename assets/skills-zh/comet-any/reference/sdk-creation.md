# 创作动作与恢复

仅在领取、回传、确认或恢复当前 Creator 动作时读取本页。请求存入临时 JSON，运行 `comet creator dispatch <name> --project <项目> --request <临时JSON> --json`；不编辑 Runtime 状态。

## 分析动作

先读取当前 `actions` 中的 `analyze`，提交 `operation: claim`，保留 `runId`、`actionId`、`attempt`、`inputHash`；使用 `executorId: creator-host`、实际 `sessionId`、唯一且稳定的 `claimToken`，并提供实际具备的 `capabilities: [skill-load, handoff]`。领取成功后才执行分析。

回传 `operation: record-outcome`。`outcome` 保留相同 Action 身份与 claimToken，并使用唯一 outcomeId、真实 status 和 output。成功 output 包含：

- `summary`：说明目标与所选流程。
- `failurePaths`：至少一个具体失败与恢复路径。
- `limitations`：说明能力与证据边界。
- `proposal`：公开 `@rpamis/comet/applications/compiler` 接受的声明式方案，包含 `schema: comet.workflow.application.plan.v1`、manifest、composition、modules；由组合器生成 workflows，不拷贝完整手写 createApplication。

manifest 固定独立应用身份、基础流程、Runtime 版本和真实 Skill 的根目录、内容摘要及适配契约。依赖引用绝对目录，由组合器读取实际字节。模块只提供固定执行端口、验证器与已声明的纯转移处理器；不得把凭据写入源码。方案结构与组合支持以公开类型和当前命令为准。

分析成功后运行 `next`，取得实际装配的方案。必须结合有效图检查用户可见步骤、产物、Skill 绑定与能力限制；不能只展示最初的意图摘要。

## 用户决定

当前 `waits` 中只有待处理的 Wait 能接受决定。取得用户明确选择后，提交 `operation: resolve-wait`，保留 `runId`、`waitId`、`proposalHash`，附唯一 decisionId 和 choice（approved / revise / rejected）。不要替用户选择 approved。

批准方案与批准安装是两个决定，分别对应 confirm-plan 与 confirm-install。旧摘要、安装目标漂移或依赖变化时审批拒绝；选 revise 后重新分析、装配并展示当前方案。preview 中的 files 与 target 用于具体安装说明。

## 中断与结果未知

新进程调用 status / next 读取同一 Run。running 或 unknown Action 先核对原执行是否发生。需要标记未知时使用 mark-unknown，保留原 Action 和 attempt；retry 必须携带当前恢复 proposalHash 和实际 reconciliation。不能以超时为理由重新运行已经发生的安装。

编译与安装可核对已固定方案对应的实际文件；部分写入、文件漂移或未知能力保持阻塞并保留现场。修复不删除无关文件，不覆盖已有安装。当前 Creator 的直接安装面向项目内的新目录；用户级安装、升级、卸载及正式业务样本由分发入口提供相应规则与证据。
