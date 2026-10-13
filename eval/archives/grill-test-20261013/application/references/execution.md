# 执行与恢复

用实际安装的 application.json 启动 grill-test@3。根 Run 的 next 创建或推进当前 child_workflow；读取返回的 children[].runId，领取该子 Run 的 handoff Action。父 Run 不代替子 Run 执行 Skill。子 Run 完成并确认后，再对原根 Run next 进入下一个阶段。

Runtime CLI 必须是 0.5.0；使用 comet runtime dispatch --application grill-test --project-root <项目> --request <JSON文件> --details --json，完整实际 Run 位于 response.data。不要通过阅读 Runtime 源码猜测参数；使用随包提供的 tools/session.mjs 生成当前身份请求和核对固定依赖。

所有请求 JSON 保存于 .scratch/grill-test/requests/；请求文件不推进状态。claim 使用当前 action.id、attempt、inputHash，executorId grill-test-host，稳定 sessionId/claimToken，真实 skill-load、handoff、local-tracker、local-commit 能力。record-outcome 使用同一身份，输出非空 summary，文件阶段附真实 URI/SHA-256；grill 的 artifacts 为空，因为原 Skill 只产生会话。

每轮 frontier 问题或审批均向实际评估用户提问并结束当前响应，等待下一条用户回答；auto_user 由控制器回复，不能将配置中的“推荐继续”伪造成一次真实答复。SDK confirm-understanding、confirm-spec、confirm-tickets 和 authorize-implementation 只记录当前 Wait 的实际决定。

只有 Spec、票据文件及实现代码是原链路的正式业务产物。tickets.json、implementation.json 和 verification.json 是此应用的核对与测试记录，均不属于 Native brief。Spec 保留原 Skill 七个章节及输入中的 acceptance IDs；票据索引包含 id/file/blockedBy/acceptanceIds；实现记录包含 completedTickets/filesTouched/reviewSummary。

verify 用 grill-test-local 执行端口 execute，真实运行 testCommand；不人工填报测试成功。宿主拒绝合法阶段写入时保留具体错误并停下，不换 Bash 绕过 Hook。未知执行沿原 Run reconcile，保留所有现场。

辅助命令（在项目根执行 node <固定包>/tools/session.mjs）：skills [id] 通过 SDK 核对依赖并返回原文；start <input.json> 启动；next <rootRun> 创建/推进当前子流程；inspect <run> 查询；claim <childRun> 领取；record <run> <output.json> 收集实际摘要和文件证据；decide <run> approved|rejected 只在真实用户决定后使用；execute <run> 执行最终机器测试。产物或参数错误时保留 Runtime 的真实拒绝，不自动重试、不自动批准。
