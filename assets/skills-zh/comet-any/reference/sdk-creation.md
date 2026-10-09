# 创作动作与恢复

仅在领取、回传、确认或恢复当前 Creator 动作时读取本页。请求存入临时 JSON，运行 `comet creator dispatch <name> --project <项目> --request <临时JSON> --json`；不编辑 Runtime 状态。

## 分析动作

宿主只领取 `analyze`，完成实际 Skill 调查并回传分析结果。compile / verify / eval-preview / evaluate / preview / install 是机器步骤，由 `comet creator next <name> --project <项目> --json` 使用固定 `creator-local` 执行器完成；宿主不能领取这些机器 Action，不能把它们交给 `creator-host` 或自行填入成功结果。`next` 停在宿主动作或用户决定时，再处理返回的当前 Action 或 Wait。

先读取当前 `actions` 中的 `analyze`，提交 `operation: claim`，保留 `runId`、`actionId`、`attempt`、`inputHash`；使用 `executorId: creator-host`、实际 `sessionId`、唯一且稳定的 `claimToken`，并提供实际具备的 `capabilities: [skill-load, handoff]`。领取成功后才执行分析。

回传 `operation: record-outcome`。`outcome` 保留相同 Action 身份与 claimToken，并使用唯一 outcomeId、真实 status 和 output。成功 output 包含：

- `summary`：说明目标与所选流程。
- `failurePaths`：至少一个具体失败与恢复路径。
- `limitations`：说明能力与证据边界。
- `proposal`：公开 `@rpamis/comet/applications/compiler` 接受的声明式方案，包含 `schema: comet.workflow.application.plan.v1`、manifest、composition、modules；由组合器生成 workflows，不拷贝完整手写 createApplication。
- `evaluation`（可选）：agent、model、judgeAgent、judgeModel、maxTurns、timeoutSeconds。默认使用创作宿主、8 轮交互和 1200 秒总时限；用例数量为 2–4 个。限制是执行次数、轮数和时限，不是美元费用硬上限。凭据或其他字段会被拒绝。

manifest 固定独立应用身份、基础流程、Runtime 版本和真实 Skill 的根目录、内容摘要及适配契约。依赖引用绝对目录，由组合器读取实际字节。SDK 从确认后的流程声明生成默认 Rule 与 Guard，Rule 通过 manifest.rule 引用并随完整包交付；模块只提供业务执行端口、验证器与已声明的纯转移处理器，额外 Guard 只能收紧默认保护，不能允许写入 SDK 控制资源或篡改当前 Run。不得把凭据写入源码。方案结构与组合支持以公开类型和当前命令为准。

分析成功后运行 `next`，取得实际装配的方案。必须结合有效图检查用户可见步骤、产物、Skill 绑定与能力限制；不能只展示最初的意图摘要。

## 用户决定

当前 `waits` 中只有待处理的 Wait 能接受决定。取得用户明确选择后，提交 `operation: resolve-wait`，保留 `runId`、`waitId`、`proposalHash`，附唯一 decisionId 和当前 Wait 支持的 choice。不要替用户审批或选择跳过。

批准方案与批准安装是两个决定，分别对应 confirm-plan 与 confirm-install。旧摘要、安装目标漂移或依赖变化时审批拒绝；选 revise 后重新分析、装配并展示当前方案。preview 中的 files 与 target 展示完整包导出，distribution 展示 SDK 正式分发的固定版本、依赖、宿主入口和 Rule/Hook 实际配置计划。两部分由同一当前安装 Wait 批准，任一部分漂移均拒绝安装。平台不支持 Hook 时明确展示能力缺失；只有真实执行证据才能报告 Hook 验收通过。

仅提供当前 Creator 定义（version: 3）。本次未批准的旧创作 Run 与工件保留现场，重新创建当前创作；不迁移旧记录或复用旧批准。编译验证后到达 confirm-eval，选择 evaluate / skip / revise。evaluate 由本地执行器调用独立 Eval，固定完整应用快照和实验身份；通过后进入安装预览，失败或未完成进入 review-eval（retry / revise / skip）。报告中的失败不会过滤成通过；skip 保留实际失败或未评估状态。重试复用缓存用例，修订后优先沿用原固定用例。报告只绑定当前应用内容、依赖、配置和用例集，不代表其他平台通过。

v3 的 install-target 是项目内完整包导出目录，应与 SDK 管理目录及平台 Skill 入口分开。批准后 Creator 先导出已确认字节，再通过正式 SDK 分发安装当前宿主的项目入口、Rule/Hook 与 Runtime 依赖；不要手补应用私有安装器。真实 Skill 加载、Rule 配置、Hook 执行、SDK Run 和业务断言分别验证，配置文件存在不能代替真实宿主触发。

v3 只读安装预览的明确失败进入 review-install（retry / revise / rejected），回报保留 reason 与 noFilesWritten。retry 重新读取当前配置并生成预览，随后仍需批准新的 confirm-install；revise 返回 analyze 修订方案；rejected 停止并保留现场。实际 install 已发生的写入与未知结果仍按下节核对，不能借预览重试盲目重复安装。

## 中断与结果未知

新进程调用 status / next 读取同一 Run。running 或 unknown Action 先核对原执行是否发生。需要标记未知时使用 mark-unknown，保留原 Action 和 attempt；retry 必须携带当前恢复 proposalHash 和实际 reconciliation。不能以超时为理由重新运行已经发生的安装。

编译与安装可核对已固定方案对应的实际文件；部分写入、文件漂移或未知能力保持阻塞并保留现场。v3 安装需要同时核对导出包与正式平台安装，不能只看到导出目录就回报完成。修复不删除无关文件，不覆盖已有安装。Creator v3 面向项目级安装；用户级安装、升级、卸载及正式业务样本由分发入口提供相应规则与证据。
