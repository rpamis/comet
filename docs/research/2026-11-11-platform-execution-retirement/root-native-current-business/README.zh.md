# Native 当前业务与原断言映射

授权来源：`report:2026-11-10-agent-platform-execution`。本组保存六份完整旧测试、当前逐声明正文、补丁，以及两个登记病例的原字段；旧字段、来源和历史链不改写。普通命令交给 Agent 平台、同一工作区由主 Agent 串行提交是本次迁移的前提。

- Handoff 与生成 Runtime：原 Runtime 检查计划、自动执行、内容指纹复用和 `request-checks` 退休。新案例真实执行 Node 命令并提交实际报告，保留缺失或不完整验收不得冻结候选、原状态不变、全部验收 ID、原候选与 Verifier 身份，以及用户接受结果的确认。临时协议文件新增、替换、被拒后保留或删除均不要求重跑已完成的平台命令；执行次数实际核对。
- 原“失败检查后拒绝 pass”不能仅用缺少 A2 的拒绝替代。迁移后的 Handoff 案例验证缺少 A2 时原 Verifier、候选和状态不变，实际平台命令失败后修复成功。另保留 `native-loop-runtime.test.ts` 中 `does not accept a pass when an Agent-reported check failed`，覆盖已报告失败不能通过；不声称保留已删除的受管重查器和收据。
- UserOptions 保留分支／worktree 交付、`keep`、主目标不变、真实 alpha/beta 文件、子工作区和集成工作区及对应分支的实际清理。检查和 merge 由测试通过真实平台命令执行；主 Agent 使用原任务结果模板顺序回报。只读状态不再自动改写旧 overlay 的目标分支，也不通过删除 sidecar 后读取 status 自动恢复整套机器记录；这两段兼容机制明确退休。已发布 Run 的业务数据和显式转移恢复分别由 published-business、SDK checkpoint 和原 portability 七项验证；缺少可信子任务证据时不能伪造完成。
- 原 `afterSpecApplied` 测试钩子已无实现，不恢复该接口。中断测试在原文件事务实际持久化 `specs-applied` 后注入一次文件操作错误，保留原事务 ID、归档位置、开始版本及状态／Supervisor 批准字节，再通过公开 Archive 沿原 WAL 完成。清理复用现有 SDK 的真实 Git 业务算法，在写入前拒绝脏工作区、错误分支和目标漂移，不引入进程监管或新的清理账本。
- 显式串行归档仍可执行；普通 Archive 不再枚举其他 worktree 以等待用户选择顺序，另一工作区原状态保留。SDK portability 只删除已经折叠的内部 Shape 重复执行，原 Shape claim、真实用户 Wait 和 choice，以及跨设备任务、领取、候选和拒绝反例保持。
- 覆盖率病例改用当前 `withNativeMutation` 为已执行源码目标，保留实际定制应用失败、兄弟任务推进、仅重试原审查及源码命中大于零的全部要求。没有降低覆盖率门槛，也不以普通无覆盖测试代替此层。

独立 Review 已核对原批准、任务身份、候选、完整验收和上述迁移差异；真实收尾在 Spec Review 中另核。原始结果保存在 `coverage/`；早期失败原样保留，最终实际结果见总交付记录。尤其首轮嵌套覆盖测试曾失败且当时未输出内部失败详情，补充诊断后的单项通过不证明原失败同因已修复，最终组合仍须单独报告。

本组未启动 Eval、真实模型或容器；脚本化 Verifier 回报明确作为协议测试，不代替真实模型遵循证据。全量仓库测试、真实平台 Hook 和发布安装分别记录，不能由这些结果替代。

后续增强保留上述冻结四份 evidence：同一 worktree 交付案例另在真实清理已移除 alpha、删除 beta 配置后注入一次错误，证明公开 Archive 的原 finish-only 恢复仍补完 beta／integration 清理，重复归档保持原 Specs 字节。原版本该例失败，新入口复用同一归档回执补清理后通过；没有恢复测试专属 Hook，也没有添加收尾账本。故障注入使用 source CLI 解析入口；最终恢复命令可通过 `COMET_TEST_NATIVE_RUNTIME=1` 验证生成 bundle，二者证据分别记录。原所有清理断言均保留，只增加此中断反例。
