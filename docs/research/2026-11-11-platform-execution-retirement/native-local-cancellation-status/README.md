# 当前工作区的取消状态发现

来源：`report:2026-11-10-agent-platform-execution`。普通状态发现不再自动枚举其他 worktree；每个 workspace 单独处理自己的 Run，父 Agent 明确汇总业务结果。本组只调整一条测试的候选所在根及标题，没有修改产品、检查执行、取消或清理实现。

## 原故障与当前消费者

原第一条在当前源码实际 **0 通过、1 失败、2 未选择**：`coverage/native-status-cancellation-original-one-results.json`。测试把六个名字分散在两个根，期待首次启动四条探测；当前 `discoverSources` 只读取显式 `projectRoot`，因此实际只有本地三条，等待四次调用失败。

这个文件不能整组判为死进程机制。`native-status-discovery.ts` 仍将本地活动 Run 名字交给 `mapWithConcurrency(...,4)`，收齐只读取消状态后才过滤候选；失败或不完整取消必须留给完整 inspection。`isNativeSdkChangeCancellationComplete` 从原 owner/store 校验 Run、workflow、name 和 input，`inspectNativeSdkCancellation` 核对原业务 Action、Child Run 与 selection 释放。它不执行普通命令、不扫描 PID、不接停止握手，也不负责 CLI 自启 Eval/下载等进程的实际清理。

## 逐行为迁移与 Review 边界

原全文保存在 `native-status-cancellation-concurrency.test.ts.txt` 和 `tests.json`。`declaration-mapping.json` 保留两条声明的完整旧/新正文；第二条参数化为两个案例，正文完全不变。

- 第一条从 `limits cancellation checks to four across workspaces and waits for every check` 改为 `limits local cancellation checks to four, waits for every check, and does not scan other workspaces`。原六个 gate、四路上限、释放一个后再启动下一个、全部完成后才返回、六条稳定顺序及过滤完成取消的断言保留。只把六个活动名字放在当前根；另一根仍在 fixture 的 worktree 列表中，并新增断言不调用跨 worktree 枚举、不读取另一根的 history partition、不在那里执行取消探测。
- `retains failed probes in stable candidate order for full inspection (corrupt: false/true)` 保留原样。错误探测仍保留候选；全部探测 settle 前不能开始完整 inspection；最终顺序稳定，损坏权威 Run 必须报错，不能隐藏成取消成功。

可退休的仅是普通状态中的自动 peer worktree 发现合同。当前本地业务等待、隔离、错误可见性以及真正取消 Run 的只读历史不能退休，也没有以本组 mock 探测代替真实取消或进程清理测试。

## 实际验证与真实业务去向

- 修改后同文件三项：`coverage/native-status-cancellation-local-three-results.json`，**3 通过、0 失败**。
- 原有真实历史两条定向执行：`coverage/native-status-cancellation-real-history-two-results.json`，**2 通过、0 失败、38 未选择**。精确目标见 mapping：真实 npm 0.5.2 cancelled fixture 经明确 Doctor repair 恢复原 Run/批准/Action/claim/命令历史且保 portable 原字节；当前合法 cancelled Run 封存后 named status/Doctor 可读、保文档、退出活动列表且禁止修改封存 Run。这些原测试没有被改写。
- `registry-target-audit.json` 使用正式迁移链解析器审查 725 个 current/covered historical 案例。原文件在原登记或任何迁移链中为 **0 引用**，没有要追加的 case，也没有删除、改写其他 ID、来源或 target。无需创建四 artifact 的登记追加包。
- 修改测试的 Prettier 检查及 `git apply --reverse --check tests.patch` 通过。

未运行生成 bundle、仓库全量测试、真实平台 Hook、Eval、模型或容器；未构建。当前单个 fixture 修正不证明旧跨根雷达仍支持，也不把旧协议移除称为修复并发取消进程。
