# Linux 进程组退出确认

来源：[PR #562 Quality and coverage](https://github.com/rpamis/comet/actions/runs/43813842367/job/133121798612)。比较提交：`8a0353cf7cfc2b5138a901f6872f75c8200c3980`。

## 失败与根因

完整 Linux CI 运行 8,880 项测试后，bridge=false 的真实后代清理案例失败：`orphanAlive:true` 与 `confirmed:true` 同时出现。其余 8,841 项通过，38 项跳过。这不是覆盖率阈值失败，不能用缩小覆盖范围或重复运行代替修复。

Linux 路径在向受管进程组发送 SIGKILL 后立即返回成功；组成员的实际退出异步完成。[Linux kill(2) 文档](https://man7.org/linux/man-pages/man2/kill.2.html) 说明，对进程组返回成功表示至少一个信号已送达，不构成所有成员均已退出的证明。现有 Darwin 路径已经等待整组消失，Linux 则缺少这次核对。

## 复现与修复

在 WSL Ubuntu 24.04、Node 18.19.1 中运行由当前真实 runOwnedCommand 生成的自包含 bundle。命令启动一个忽略 stdio、unref 的后代；bridge 模式再增加一层同步中间进程。仅在测试驱动中把实际组信号推迟 150ms，保留完整真实命令、登记和停止逻辑。旧实现两个模式都返回 confirmed:true，后代仍活着，稳定得到 2 次错误确认；修复后两个模式均确认成功且后代已停止，错误确认 0 次。取消驱动延迟后，两个自然退出模式也正常完成。

新增五项确定性测试分别模拟组已消失、延迟退出、仍存活、探测未知和仅剩僵尸。旧实现五项均失败，修复后全部通过。原 bridge=false/true 的历史名称和断言保留。

修复复用原有一秒 POSIX 退出核对期限，并将既有 Linux /proc 组成员检查提取为共享函数。终止核对与原进程身份观察使用同一判定：僵尸及已停止执行的成员不算运行中，无法读取时不生成成功证明。不新增监管器、不重发组信号、不修改命令执行时限，也不按组长退出推断后代停止。

登记 case：`process-562-linux-group-exit-confirmation`，保留 CI 来源、五项状态断言及两个真实后代案例的精确选择器。WSL 定向证据不替代当前候选的完整 Linux CI；后者仍须在推送后验收。未启动真实模型 Eval。

本轮验证：进程身份、命令启动、Node CLI、整树终止与 Native 旧 Supervisor 诊断五份测试 54 passed / 1 原有平台 skip；五项新增 Linux 状态断言再单独通过。完整构建、lint/架构、TypeScript、生成资产检查、受影响文件格式及 Mintlify build/validation 通过。未在本地启动全量测试；完整矩阵由候选 CI 验证。

通过登记入口执行本 case 时，控制器按同文件去重合并到既有 startup-readiness 分组，实际执行 18 项断言全部通过；其中本次五项 Linux 状态及原两个 bridge 后代案例均为 passed。没有把分组中的 skip 计入通过，也没有更改历史分组选择器。
