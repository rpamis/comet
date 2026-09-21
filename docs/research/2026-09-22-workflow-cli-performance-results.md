# Comet workflow CLI 性能对比结果

日期：2026-09-22。该记录对应 Native change `workflow-cli-performance` 的 Windows 候选复测。

## 测量边界

- 平台：Windows `10.0.26200`，Intel Core i5-10600KF，12 logical CPUs。
- Node：`v22.20.0`；Git：`2.51.0.windows.1`；包版本：`0.4.2`。
- 基线和候选均使用同一提交 `1ef5d0200480db1ad7dbdb3898f9046bde342d87`、同一入口、同一隔离 fixture、3 次 warmup、5 次正式采样。
- 计时定义为 fresh Node process、warm filesystem；不包括 fixture 建立、清理和后置断言。`FS` 是 benchmark 通过适配器计数的文件操作，不代表操作系统全部 I/O。
- `Git` 是被测流程实际启动的 Git 子进程数；外部构建、测试程序、Agent/Verifier 和网络耗时不在表内。

## 中位耗时和调用次数

| 场景 | 基线中位 ms | 候选中位 ms | 变化 | 基线 P95 | 候选 P95 | Git 基线→候选 | FS 基线→候选 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| node-empty | 87.1 | 85.7 | -1.6% | 90.1 | 88.4 | 0→0 | 0→0 |
| cli-version | 123.4 | 118.1 | -4.3% | 124.9 | 121.6 | 0→0 | 0→0 |
| cli-help | 121.0 | 120.6 | -0.3% | 123.7 | 125.3 | 0→0 | 0→0 |
| entry-public | 136.1 | 136.4 | +0.2% | 167.4 | 138.4 | 0→0 | 15→15 |
| entry-public-activate | 199.4 | 176.4 | -11.6% | 205.2 | 179.8 | 0→0 | 15→15 |
| classic-current-public | 228.5 | 220.6 | -3.5% | 247.8 | 226.1 | 0→0 | 0→0 |
| classic-next-public | 152.0 | 144.6 | -4.8% | 160.5 | 145.8 | 0→0 | 0→0 |
| native-show-public | 578.2 | 573.9 | -0.7% | 592.9 | 592.3 | 0→0 | 0→0 |
| classic-check-execute | 3432.7 | 1786.3 | **-48.0%** | 3490.1 | 1805.1 | 26→8 | 900→900 |
| classic-check-reuse | 2149.5 | 1116.9 | **-48.0%** | 2177.7 | 1182.8 | 15→4 | 372→372 |
| classic-check-invalidate | 5096.0 | 2085.0 | **-59.1%** | 5105.1 | 2175.4 | 45→12 | 819→819 |
| native-check-execute | 4874.5 | 3487.0 | **-28.5%** | 4965.1 | 3542.7 | 21→20 | 573→573 |
| native-check-reuse | 1970.3 | 1938.9 | -1.6% | 1984.7 | 1960.7 | 12→12 | 116→116 |
| native-check-retry-interrupted | 3234.0 | 3232.5 | 0.0% | 3265.1 | 3277.6 | 13→13 | 553→553 |
| native-next-public | 1258.6 | 1220.2 | -3.0% | 1315.4 | 1294.2 | 4→4 | 386→386 |
| native-next-direct | 1250.0 | 1274.4 | +1.9% | 1275.2 | 1304.5 | 4→4 | 386→386 |
| task-no-origin | 1019.1 | 1022.1 | +0.3% | 1025.1 | 1211.4 | 2→2 | 202→202 |
| task-origin | 921.5 | 957.6 | +3.9% | 983.4 | 1008.7 | 1→1 | 202→202 |
| native-status-public-1 | 572.1 | 558.2 | -2.4% | 576.0 | 570.8 | 0→0 | 0→0 |
| native-status-public-10 | 657.7 | 654.5 | -0.5% | 661.0 | 683.7 | 0→0 | 0→0 |
| native-status-public-30 | 925.4 | 921.6 | -0.4% | 935.5 | 934.4 | 0→0 | 0→0 |

## 结论

- Classic 的三条代表性 check 路径均超过 30% 的最低目标；主要收益来自把 dirty/untracked 文件的逐文件 `git hash-object` 合并为有序批量调用。
- Native 首次 check 中位耗时下降 28.5%，超过 20% 的最低目标；没有 gitlink 时跳过递归 `git submodule status`，保留有 gitlink 时的原有检查。
- Native check reuse、interrupted retry、next、task 和 status 没有形成可归因的明显收益；`native-next-direct` 和 `task-origin` 的小幅回退仍低于 5% 中位回归容差，P95 也低于 10% 容差。
- 这组数据只证明 Comet Runtime/CLI 自身在 Windows fixture 上的变化，不外推到 Agent 模型、外部构建、网络或完整用户流程总耗时。

## 未覆盖项

本地未运行 macOS/Linux 兼容环境、真实宿主 Hook、真实模型/Agent 全程和远端服务；这些由正式 Verifier 按 Native 验收范围继续核对。`pnpm verify:changed --base master` 的 Native 域整组测试在长时间无新输出后停止，已完成的脚本域测试、定向测试、TypeScript、lint、build 和 generated 检查结果单独记录在 Builder 交接中。
