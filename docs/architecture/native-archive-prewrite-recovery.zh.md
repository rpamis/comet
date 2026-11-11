# Native 归档写入前失败的恢复

来源：`report:2026-11-11-native-archive-prewrite-race`。

## 复现与根因

0.5.2 用户运行曾在通过全部验收后进入以下链路：

1. Archive 执行器检查候选输入时遇到短暂的文件变化，返回 `failed`、`ready: false`、`reason: candidate-drift`。此时尚未创建归档事务，也未发布 Specs。
2. 结果校验器再次读取候选，输入已经稳定。因为本次检查没有重现相同错误，校验器拒绝合法失败，报 `Unexpected Native Archive apply event`。
3. `native archive --recover` 把原 Action 视为结果未知，但要求冻结事务必须存在，报 `Native SDK Archive recovery has no frozen Spec transaction`。

比较基线：`a61a2e5b4766e1ad62377dec598e402560a259b6`。同一测试在该实现上出现两项预期失败：合法失败无法提交、CLI 恢复后仍为 unknown。“没有事务且没有失败证据”反例保持拒绝。用临时项目实际改变候选文件、执行归档并恢复原字节来控制时序，不依赖后台索引进程的调度。

## 修复边界

失败结果依然核对原成功预检、Run、Action、候选、批准和报告绑定，但不要求过去的瞬时错误再次发生。只有结构正确、精确匹配执行器持久证据的写入前失败，且当前没有归档事务时，才能记录失败；这不代表验收或归档通过。执行器在 Native mutation lock 内检查候选，将真实失败与 Run、Action、attempt、inputHash、claimToken 和原预检摘要一起保存。同一锁也保护事务创建，因此重复投递只能回放原失败，不能在校验与 Runtime 提交之间或之后写入 Specs。

对于 unknown/running Action，恢复必须读取同一执行器保存的原失败证据。结果曾被拒收或在提交前丢失都可以恢复；已有 prepared/specs-applied 事务仍使用原恢复流程。

**兼容限制：真正旧版本只有 rejectedOutcomes、没有执行器持久证据的记录，仍然阻塞，原现场问题的这类存量数据尚未解决。** 旧回报的 claim、outcomeId 和拒绝原因只能证明回报归属，不能证明执行器观察过漂移。恢复不把这些字段升级为新的可信证据，也不要求修改候选来人为重现错误。保留原 Run、拒收记录和工作区，先通过 `native doctor` 诊断；本次没有新增人工确认后终止旧执行的协议。

恢复后原失败仍保留，回到 Verify 修复入口。用户选择修复后生成后继候选，重新验收和接受后才允许归档；不会通过恢复操作补造事务或直接将旧候选标记为完成。

## 回归映射

- `native-archive-prewrite-failure-settlement`：输入恢复稳定后记录真实失败；拒绝已有事务和候选不匹配。
- `native-archive-prewrite-rejection-recovery`：通过构建后的公开 CLI 恢复有执行器证据的原失败、重复调用无重复副作用、按返回指令修复并最终归档；缺少原失败证据时继续阻塞。
- `native-archive-prewrite-duplicate-delivery`：在失败校验后提交前、以及失败提交后重复投递同一 claim，都只回放原失败，不产生事务或 Specs。
- `native-archive-prewrite-executor-evidence`：拒绝凭空构造或修改过的失败输出；真正旧格式缺失证据时保持阻塞。
- `native-archive-prewrite-lost-result`：执行器已保存失败、结果尚未提交就丢失时，公开 CLI 可恢复原失败。

精确测试选择器保存在 `config/workflow-regressions.json`。旧版本拒绝行为只在测试中通过一次校验器故障注入生成真实 Runtime 拒绝收据，不手工伪造正常推进状态。该成功恢复夹具先运行当前执行器，具有持久证据，不能作为旧版本无证据数据可自动恢复的证明；另有缺失证据夹具明确验证保守阻塞。

测试默认调用当前源码的 CLI dispatcher，避免依赖陈旧的 dist。公开 CLI 验收在 `pnpm build` 后设置 `COMET_TEST_PACKAGE_ROOT="$PWD"`，执行 `pnpm exec vitest run test/domains/comet-native/native-sdk-application.test.ts -t 'Archive prewrite failure'`。两种模式都保留原测试名称和断言。

对审查时的 `59245d31d77c412324313bd83c7352657c2da220`，两项重复投递、两项伪造或修改失败输出的相同回归均先出现失败；修复后通过。事务缺席断言统一使用 change 名称，并精确检查 ENOENT，覆盖首次恢复、重复恢复与拒绝路径。

这些测试证明确定性的 Runtime 和构建后 CLI 行为；不涉及模型指令遵循、平台 Hook 或浏览器交互，也不启动模型 Eval。现有用户工作区和全局 Comet 安装不由这些回归测试修改。

## 本轮验证与未完成项

- 写入前失败定向测试：源码模式 11 项通过；构建后设置 `COMET_TEST_PACKAGE_ROOT` 的公开 CLI 模式 11 项通过。
- 相关归档、取消与已有事务恢复回归：17 项通过，1 项失败。失败是 `recovers applied Archive Specs after restart without creating another transaction` 的旧全对象相等断言未包含 `recoveryBinding`；在审查前 `59245d31` 上复跑也同样失败。本轮保留该断言，没有把该项记为通过。
- Native / Entry Runtime 资产及 badcase 契约：30 项通过，1 项 Windows 专用案例因当前平台未执行。
- 构建、TypeScript、lint/架构、生成物新鲜度、SDK API、SDK 恢复 fixture、改动文件格式和 badcase 基线保留检查通过。lint 保留 Dashboard 中 8 个已有 unused-vars 警告。
- 未运行全量测试、完整 npm package-e2e、真实平台 Hook 或模型 Eval。旧无执行器证据的存量失败仍需另行设计明确的人工恢复协议。
