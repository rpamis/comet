# 用户确认的 CLI 自有进程超时验收

授权来源：`report:2026-11-11-cli-owned-timeout-cleanup-acceptance`。用户对明确说明“撤回原测试的半秒保证，改为到期独立发起停止、确认整棵进程树退出后才报告已停止”的问题答复：“按建议调整验收，保留真实清理确认”。这不是原量化断言的等价迁移；本次显式改变验收语义，不改产品进程实现。

旧断言、登记和原失败完整保留在本目录 `registry.json`、`tests.json`、`mapping.json` 和 `tests.patch`，并保留上一轮迁移链。旧测试要求 5 秒 timeout 后不能出现 5.5 秒的 late 文件；Windows 真实探针 48 次中 10 次晚写入，停止发起仅晚 1–18ms，而 taskkill 整树清理完成耗时 821–1058ms。不能继续承诺固定半秒内没有副作用，也不能提前缩短用户命令时限。

新测试保持命令 timeout 为 5000ms，实际启动持续运行的命令及真实后代，后代持续写心跳；原调用方从命令启动后阻塞 10 秒。测试在 8 秒观察窗口内要求命令和后代均已退出，此时调用方仍未恢复；心跳必须停止。调用方恢复后必须收到 `timeout` 且 `confirmed: true`。调用方退出观察窗口随真实阻塞时长调整，测试总上限为 25 秒；不是延后原 late 文件以伪装半秒保证仍成立。

同一新断言通过临时 esbuild 加载边界使用真实基线 `630ce380787f446e803f94b4b90cbbdbf8663364` 的进程适配器，实际失败为 `command tree survived its deadline while the owner was blocked`；测试随后清理自己的真实父子进程。当前实现的同一断言实际通过。报告分别为 `coverage/platform-execution-owned-deadline-baseline-red2.json` 与 `coverage/platform-execution-owned-deadline-approved-green2.json`。临时控制器完整正文保存在 `negative-control.json`，执行结束后已从测试收集路径移走。首次控制器运行因为 esbuild 不接受带 `u` 标志的过滤正则而失败，不作为有效 RED；首次新测试仍使用旧 5 秒调用方退出观察窗口而超时，改为覆盖已明确设置的 10 秒阻塞后通过，不算产品失败或修复。

其余真实 taskkill 失败、后代未停止、已退出 PID 不能重用、终止失败不得被 completed 覆盖及串行清理竞态断言保留。普通 Native/Classic 工作不调用这个执行器；实际调用者为 CLI 自己的 Eval 和下载等进程。本次没有启动 Eval。

完整进程测试文件实际 22 项全部通过，报告 `coverage/platform-execution-owned-command-approved-file.json`。Standards / Spec 两轴只读复核均通过，确认其余测试正文未变、原登记及链保留、四件证据摘要正确，并核对真实基线 RED 与当前 GREEN。正式登记已沿原链追加，未改写原 case 字段，结构及 evidence 校验通过。定向结果不代表最终全量通过。
