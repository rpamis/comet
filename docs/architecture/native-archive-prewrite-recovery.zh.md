# Native 旧 Run 的归档失败恢复

来源：`report:2026-11-11-native-archive-prewrite-race`。本次基于 `053` 的 `9acb00ff61220f1bbeea5bf46dd190438f3f9a77`，继承版本 0.5.3。

## 适用范围

0.5.2 的归档执行器可能在创建事务前返回 `candidate-drift` 失败；输入恢复后，旧校验器拒绝失败回报，留下已返回但未收尾的 Action。053 已移除文件指纹及候选内容检查，因此不迁移旧 PR 的瞬时输入检查、失败证据文件和锁内执行逻辑。

遗留 Run 仍有恢复缺口：`native archive <change> --recover --project-root <project> --json` 只寻找冻结事务，导致这类失败继续停在 `unknown`。

## 恢复行为

恢复命令先核对原执行已返回的记录。只有原 Action、attempt、inputHash、claimToken 和执行器结果 ID 均匹配、输出为旧版完整 `candidate-drift` 失败且没有归档事务时，才补记原失败。原预检的候选和状态版本绑定仍须通过。

恢复不会把失败变为通过，也不会创建事务或发布 Specs。返回码 73 表示仍需处理失败；按响应中的修复入口继续原 Run，完成修复、独立验收及用户接受后再归档。重复恢复保留原失败和既有 Action。

已有事务优先按实际进度恢复，不能用失败回报覆盖。事务按 change 名称查找，不假定 Run ID 等于 change 名称。没有事务也没有匹配失败记录时保持阻塞，保留原 Run 并使用 `native doctor <change> --project-root <project> --json` 诊断。

此路径读取 Runtime 已保存的拒绝回报，不以拒绝记录证明历史文件从未改变；它只收尾原失败。普通运行中的失败提交仍不能直接通过归档校验器。053 不再生成这类候选漂移失败。

## 回归证据

案例 `native-archive-prewrite-rejection-recovery`（下方前四项）和 `native-archive-recovery-change-name`（第五项）登记在 `config/workflow-regressions.json`，精确映射到 `test/domains/comet-native/native-sdk-application.test.ts` 的五个测试：

- `recovers a rejected Archive prewrite failure through the CLI without creating a transaction`：恢复失败、重复恢复、使用返回的修复命令、重新验收与接受、最终仅一次成功归档。
- `keeps legacy Archive recovery blocked without a rejected prewrite failure`：无记录时保持未知且不写入。
- `rejects mismatched legacy Archive failure identities and preflight candidates`：身份、候选和失败正文不匹配时拒绝。
- `recovers an existing Archive transaction instead of a rejected prewrite failure`：已有事务不被失败覆盖，完成原归档。

- `recovers Archive transactions by change name when the Run ID differs`：Run ID 与 change 不同的旧流程仍恢复原事务。

同一恢复断言在未修改的 053 源码上失败（Action 实际为 unknown），无记录的对照通过。修复后同一断言通过。夹具通过真实 Runtime 提交旧执行器格式的失败并保存真实拒绝记录；没有手工伪造正常流程状态。由于 053 已删除旧输入检查，本次未重新执行 0.5.2 的瞬时文件变化复现，夹具模拟的是遗留失败回报边界。 Run ID/change 名称回归未单独在未修改基线上执行；证据为原查找键与事务保存键的差异，以及修复后真实 Runtime 的事务恢复断言。

最终相关回归 18 passed / 0 failed（5 项新增、13 项既有案例）。定向测试分别覆盖源码 Runtime 和构建后的 `bin/comet.js`；未执行全量测试、完整安装包 E2E、真实平台 Hook 或模型 Eval。这些层级不能由定向测试代替。

## PR 审查补充回归

失败恢复提交与事务写入共用 Native mutation lock。锁内重新读取原 revision 和事务：若延迟执行器已先写入事务，失败提交会停止，原 Action 保持 unknown，随后按事务的实际进度恢复。该边界不增加文件指纹，也不改变普通 Runtime 的领取协议。

取消后的归档恢复同样使用 change 名称定位事务，保留 cancelled 终态。响应分别标识预检失败与归档执行失败；无事务的失败补记不会声称已经恢复 Specs 事务。

以下两项在本次修复前失败、修复后通过：

- `native-archive-prewrite-recovery-commit-race` → `rejects Archive prewrite recovery when a transaction appears before its commit`：在校验与 CAS 之间写入真实事务，阻止失败提交，并继续恢复原成功结果。
- `native-cancelled-archive-recovery-change-name` → `recovers a cancelled Archive transaction by change name when the Run ID differs`：旧取消流程留下的事务按 change 名称收尾，重复恢复返回原收据。

## 与当前 053 精简实现合并后的验证

本地 053 与 PR #549 合并时，归档失败提交改用现有 `withNativeMutation` 业务事务边界，不恢复已移除的进程锁。提交前仍重新读取原 Run revision 和事务；原“校验后出现事务”的反例保留并通过。Builder 修复续行使用平台实际检查报告，不恢复 Runtime 检查执行器；取消事务恢复沿用已取消 Run，不调用已移除的停止握手。

新增的七项回归在合并后全部通过；完整构建、lint / architecture 和 Runtime 生成物检查通过。历史测试移除沿用此前已登记的迁移映射，没有重新恢复其已退休的旧定义生成器。合并后整个 Native SDK application 文件实际 125 / 125 通过，耗时 700.11 秒；没有重新运行仓库全量测试、模型 Eval、真实平台 Hook 或完整安装验收。
