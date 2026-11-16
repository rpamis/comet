# master CI 测试进程启动等待修复

来源：[Windows Runtime smoke 失败日志](https://github.com/rpamis/comet/actions/runs/43545217542/job/132294851001)。比较基线：`a6b8e63e474af98fb6947b9c21b90a316e0214aa`。

## 失败与复现

线上 `keeps its deadline when the owner event loop cannot run its timeout timer` 在约 5.1 秒时失败，错误为 `owned command did not start`，尚未进入调用方阻塞和整树清理断言。本机不加延迟的原测试通过，不能据此认定线上失败已消失。

将夹具的测试进程延迟 6 秒加载原 bundle，再运行新增的 `waits for owner readiness before measuring the independent deadline`，稳定复现相同错误：约 5.5 秒失败。此时测试进程尚未调用 `runOwnedCommand`，排除了被测命令时限和整树清理逻辑是本次复现失败的原因。线上日志没有记录每层进程的启动耗时，因此不能声称已测得线上具体的启动延迟。

## 修改与断言保留

测试进程加载依赖后，通过 IPC 向测试发送就绪消息；测试收到消息后才开始原有的 5 秒命令启动等待。新增慢启动案例和原历史案例复用相同断言，仅慢启动案例在加载 bundle 前增加 6 秒延迟。

- 被测命令时限仍为 5 秒，调用方事件循环仍阻塞 10 秒。
- 命令及后代必须在原来的 8 秒清理等待内停止，调用方此时仍未恢复。
- 心跳必须已产生且停止增长，恢复后结果必须是 `timeout` 和 `confirmed: true`。
- 原案例名称、选择器和 25 秒测试总超时保留；新增慢启动案例的总超时为 35 秒，包含额外的夹具启动时间。

登记 case ID：`ci-owned-command-owner-startup-readiness`。历史 `owned-command-timeout-independent-deadline` 的登记和断言保持原样；新增案例只覆盖测试启动协调，不声称修复产品进程清理缺陷。

## 验证

- 新增慢启动案例：补就绪消息前失败，补齐后通过，约 17 秒完成。
- 按线上失败步骤运行相同的 5 个文件、`--maxWorkers=1`：48 项通过，1 项按原有平台条件跳过，约 79 秒完成。
- `pnpm test:core-regressions --case ci-owned-command-owner-startup-readiness`：1 组、10 项执行测试通过，包含原截止时间案例、新增慢启动案例和同文件相关清理案例；其他选择外案例不算执行通过。
- `pnpm lint` 通过，架构检查通过；9 条 unused-vars 警告均位于本次未改动文件。badcase 登记与基线保留检查、受影响文件 Prettier、`git diff --check` 通过。
- 远端结果见本次提交的 CI；提交前尚未执行该候选的远端检查，不以本地通过代替。

本次只修改测试夹具、回归登记和本记录，没有产品行为变化，无需版本升级或用户发布 Changelog。未启动真实模型 Eval，用户没有启动请求。本地不运行全量测试，完整套件由远端 CI 验证。

## 2026-11-16 冷探测准备补充

来源：[PR #562 Windows Runtime smoke](https://github.com/rpamis/comet/actions/runs/43806388846/job/133098663297)，提交 `a4d833cd`。原案例再次在约 5.1 秒报告 `owned command did not start`，尚未进入事件循环阻塞断言。原样本地定向两项均通过，没有本地重现线上时序；CI 没有逐层启动日志，不能声称已测得具体慢在哪个子进程。

代码核对发现，夹具的 ready 消息早于第一次 `readProcessIdentity`，Windows 的可选本地探测器首次准备仍落在后续 5 秒启动等待内。本轮只将真实进程身份探测准备移到夹具 ready 之前；生产 `runOwnedCommand`、监管器的截止时间、5 秒命令预算、8 秒清理等待、10 秒原调用方阻塞、心跳停止及 `confirmed: true` 断言全部保留。没有 mock 身份探测或进程终止，没有修改 Runtime 或发布行为，不追加用户 Changelog。

登记 `ci-562-process-probe-readiness` 复用原两项精确测试，历史登记和名称保留。实际远端验收须以本轮候选的 Windows Runtime smoke 为准，本地通过不能证明冷 CI 环境已修复；完整验证结果在 PR 中持续更新。未启动模型 Eval。

为取得稳定的前后对照，新增 `waits for cold process identity preparation before reporting owner readiness`：只在测试 bundle 为第一次真实身份探测注入 6 秒准备延迟，不 mock 返回身份或终止行为。沿原先先报告 ready 的顺序约 5.3 秒失败，错误同为 `owned command did not start`；准备后再报告 ready 使用相同的完整截止时间与后代清理断言。此案例的 35 秒测试总超时包含夹具准备，不改变原案例的 25 秒总超时或 5 秒命令预算。
