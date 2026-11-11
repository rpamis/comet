# Native 归档写入前失败的恢复

来源：`report:2026-11-11-native-archive-prewrite-race`。

## 复现与根因

0.5.2 用户运行曾在通过全部验收后进入以下链路：

1. Archive 执行器检查候选输入时遇到短暂的文件变化，返回 `failed`、`ready: false`、`reason: candidate-drift`。此时尚未创建归档事务，也未发布 Specs。
2. 结果校验器再次读取候选，输入已经稳定。因为本次检查没有重现相同错误，校验器拒绝合法失败，报 `Unexpected Native Archive apply event`。
3. `native archive --recover` 把原 Action 视为结果未知，但要求冻结事务必须存在，报 `Native SDK Archive recovery has no frozen Spec transaction`。

比较基线：`a61a2e5b4766e1ad62377dec598e402560a259b6`。同一测试在该实现上出现两项预期失败：合法失败无法提交、CLI 恢复后仍为 unknown。“没有事务且没有失败证据”反例保持拒绝。用临时项目实际改变候选文件、执行归档并恢复原字节来控制时序，不依赖后台索引进程的调度。

## 修复边界

失败结果依然核对原成功预检、Run、Action、候选、批准和报告绑定，但不要求过去的瞬时错误再次发生。只有结构正确的写入前失败、且当前没有归档事务时，才能记录失败；这不代表验收或归档通过。

对于旧版本留下的 unknown/running Action，恢复只消费原 Runtime 保存的被拒失败回报，并逐项匹配 Action ID、attempt、inputHash、claimToken。缺少证据或已有事务时不能使用这条分支。已有 prepared/specs-applied 事务仍使用原恢复流程。

恢复后原失败仍保留，回到 Verify 修复入口。用户选择修复后生成后继候选，重新验收和接受后才允许归档；不会通过恢复操作补造事务或直接将旧候选标记为完成。

## 回归映射

- `native-archive-prewrite-failure-settlement`：输入恢复稳定后记录真实失败；拒绝已有事务和候选不匹配。
- `native-archive-prewrite-rejection-recovery`：通过构建后的公开 CLI 恢复原失败、重复调用无重复副作用、按返回指令修复并最终归档；缺少原失败证据时继续阻塞。

精确测试选择器保存在 `config/workflow-regressions.json`。旧版本拒绝行为只在测试中通过一次校验器故障注入生成真实 Runtime 拒绝收据，不手工伪造正常推进状态。

这些测试证明确定性的 Runtime 和构建后 CLI 行为；不涉及模型指令遵循、平台 Hook 或浏览器交互，也不启动模型 Eval。现有用户工作区和全局 Comet 安装不由这些回归测试修改。
