# Issue #545：无效检查结果的恢复出口

来源：[Issue #545](https://github.com/rpamis/comet/issues/545)。比较基线为 `630ce380787f446e803f94b4b90cbbdbf8663364`。

## 已复现的行为与原因

1. 已停止的受管检查保留无效 `execution.outcome` 后，正确停止证据也无法结束原未知 Action。恢复入口和中断结果校验只允许 outcome 缺失，不允许 outcome 校验失败。案例：`native-invalid-completed-check-recovery`。
2. doctor 与 next 不提供适用的停止确认入口，反复要求补交无法通过校验的原结果。它们各自按 outcome 是否存在决定恢复指引。案例：`native-invalid-completed-check-guidance`。

测试通过 SDK 正式创建、批准 Shape，并让 Builder 请求 v3 Build 检查。命令真实写入计数文件并完成后，只在隔离项目中损坏持久结果的计划名称，再通过正式 Runtime 将 Action 标记为未知。这是损坏结果的确定性恢复复现，不代表复现了原报告的进程中断时序。

原报告中“上一轮结果如何进入新记录”的原因仍未复现、未解决；缺少原始执行记录和落盘时序。后续应由维护者使用脱敏现场继续调查。`build.checks` 使用 Action ID 作为 candidateId 是 0.5.2 与当前源码的约定，不在本次修改范围。

## 修复范围

恢复、doctor 和 next 共享完整结果的校验结论。有效结果继续按原领取补交；无效结果在确认原执行及全部后代停止、原 Action 身份和计划仍匹配后，作为中断结束旧 Action，沿原流程继续修复。

无效完整结果不转成部分通过，原检查保持未知，原始坏记录和日志不覆盖。原 Run、Shape 批准与副作用保留；重复恢复不再执行旧命令。Builder 后续明确请求的新检查仍可执行。新 Native v4 没有受管检查 Action，本次修改服务于旧 Run 兼容恢复。

## 验证记录

- 修改前：源码 CLI 与原命令 bundle 的新增案例均失败，缺少停止确认指引；原 bundle 还保留正确停止证据无法恢复的失败证据。
- 修改后：源码 CLI、生成 bundle、有效完整结果恢复、真实 owner 中断、缺少登记与晚到登记、Windows 停止收据等 14 项定向测试通过。新增的两个参数化案例补充候选绑定反例后再次通过；不将重复执行累计为新的独立案例。
- `pnpm build:native-runtime`、`pnpm build:entry-runtime`、`pnpm check:generated`、`pnpm exec tsc --noEmit`、受影响文件的 Prettier 和 `git diff --check` 通过。Native 改动影响 Router 的传递依赖，因此同步构建了 Entry 资产；没有修改 Entry 业务源码。
- badcase 登记与基线保留检查通过。精确测试报告为 `coverage/issue-545-recovery.json`，通过仓库现有的 `loadWorkflowRegressions` 与 `assertCoreRegressionResult` 核对两个登记案例的文件及完整断言名。
- `pnpm test:core-regressions --case native-invalid-completed-check-recovery --case native-invalid-completed-check-guidance` 会合并同文件的 98 项历史断言；为保持定向范围，已停止该扩展运行，改用精确测试名执行并核对报告。该扩展运行不记为通过。
- `pnpm verify:changed --base 630ce380787f446e803f94b4b90cbbdbf8663364` 在架构检查处被既有顶层 `.ruff_cache` 阻塞，后续计划未执行。`pnpm lint` 的 ESLint 部分无错误、保留 9 项已有警告，随后因相同架构问题失败；没有删除无关目录或修改架构白名单。所需类型、格式和生成物检查已另行执行。
- 未启动真实模型 Eval；本问题属于确定性的 Runtime/CLI 恢复，不涉及模型遵循协议。
- 未执行仓库全量测试、真实 Agent 平台 Hook、macOS/Linux 或报告方真实项目验证。

每个登记行为对应同一测试中的独立断言。通过 `source` 与 `bundle` 参数分别验证源码 CLI 和自包含命令 bundle。测试覆盖未确认、错误 claim 和执行记录候选不匹配时拒绝推进，保留批准与坏记录、原命令不重放、重复恢复以及新的合法检查可完成。

## Issue #546

旧版 0.5.2 的生成目录发现问题已在发布包上复现；当前分支已撤下输入快照扫描。按本次用户决定不单独回补旧扫描器。不能将本记录视为已验证真实用户升级流程。
