# 第三轮完整测试跟进

第三轮 `pnpm test` 实际退出 1，耗时 3276.92 秒：731 个文件中 724 通过、5 失败、2 跳过；8757 项中 8629 通过、14 失败、114 跳过。原始结果为 `coverage/platform-execution-full-suite-round3.json`，完整日志为同名 `.log`。修改前五个失败文件的全文保存在 `original-tests.json`；后续单项通过不能改写这轮结果。

## 已确认的原因

- `native-sdk-supervisor-revise.test.ts` 的七项失败均为 `dist/app/cli/index.js` 不存在。该轮之前只重建了 Native / Entry bundle，没有先完整构建 CLI；另一测试的既有 `ensure-cli-built` 检测到陈旧产物，运行会清空共享 `dist` 的完整构建，打断了已经运行的公开 CLI 测试。第三轮结束后已完整执行 `pnpm build`，结果成功，日志为 `coverage/platform-execution-post-round3-full-build.log`。这是本轮验证准备遗漏，不通过新增运行器、缓存或锁解决。此前隔离探针的 `ETIMEDOUT` 发生在另一条集成命令，不能代替本轮七项失败的实际原因。
- `runtime-application.test.ts` 的真实 HTTP 测试失败原因为 `fetch` 的 `bad port`。操作系统 `listen(0)` 分配的可监听端口可能在 Fetch 的禁止端口表内。夹具改用 `node:http.request`，仍向真实服务发送原 POST 请求并读取 GET 对账结果；批准、claim、replay、unknown Outcome、原 claim 保留和副作用次数断言未改。`coverage/http-port-diagnostic/` 固定使用同一端口 10080，原夹具同名测试失败、新夹具通过。两轴只读 Review 确认无需测试迁移：业务断言和选择器保持原文。

## 尚待确认的失败

- `eval-container-cleanup.test.ts` 四项失败分别为提前失败收尾仍是 `stopping`、Skill timeout 后仍是 `stopping`、Application timeout 前没有启动带标识的替身容器、清理故障未产生预期拒绝。这些测试使用真实 Node / Bash 子进程和文件模拟 Docker，没有启动模型或真实容器。原四项单独重跑全部通过，结果为 `coverage/platform-execution-round3-eval-cleanup-repro.json`；这不是修复证明。
- `standalone-static-collect.test.ts` 的数字批准回复用例中，离线 Python / 假 Claude 子进程测试退出非零，原包装器没有输出 Python 失败详情。相同 Python 选择器单独执行通过，日志为 `coverage/platform-execution-round3-numeric-approval-repro.log`；具体全量失败原因尚未确认。
- `native-sdk-supervisor-verifier-recovery.test.ts` 的 checkpoint-only 恢复用例超过 120 秒，随后清理与未完成异步工作相遇，出现 `ENOTEMPTY`。前两轮同名测试分别约 24 秒、50 秒通过，本轮约 123 秒失败。不能据此放宽业务条件或声称恢复功能已修复。

以上四个文件随后按默认四文件并发设置运行，实际退出 0：150 项全部通过、无跳过，耗时 236.29 秒。记录为 `coverage/platform-execution-round3-related-repro.{log,json}`。HTTP 文件 22 项、Docker 替身文件 22 项、离线 Python 契约文件 94 项、Supervisor 恢复文件 12 项均完整执行。没有修改后三个文件或放宽其时间及业务断言；负载相关失败尚未稳定复现，不将本次通过宣称为已定位或修复其根因。没有启动真实 Eval。

CLI 文件缺失的原七项业务用例也在完整构建后通过：`coverage/platform-execution-round3-supervisor-missing-cli-recheck.json` 为 6 项通过、5 项筛选跳过；原 genuine failed Outcome 用例另在 `coverage/platform-execution-round3-supervisor-retained-outcome-recheck.json` 为 1 项通过、10 项筛选跳过。筛选跳过不计入通过。没有修改该测试文件或其断言。

随后 TypeScript、lint / architecture（0 错误、9 条原有 warning）、SDK API、Runtime 生成物和受影响文件格式检查通过。只读检查确认全部编译文件存在，CLI 产物新于源码和 `build.js`，证据为 `coverage/platform-execution-round4-build-readiness.json`。第四轮完整测试沿用标准默认四个 worker，开始前记录原因、范围与约 55 分钟预估于 `coverage/platform-execution-full-suite-round4-intent.json`；完成结果另行记录，不能把定向通过写作全量通过。

## 第四轮最终结果

第四轮完整测试实际退出 0，耗时 3385.16 秒：731 个文件中 729 通过、2 跳过；8757 项中 8643 通过、0 失败、114 原有跳过。证据为 `coverage/platform-execution-full-suite-round4.{log,json}`。本轮真实执行全部五个失败文件，150 项相关测试和 Supervisor 修订文件 11 项均通过；CLI 自有进程终止文件 22 项与 Native 归档文件 28 项也通过。上述通过不改写第三轮的失败结果或此前未定位的负载根因，没有放宽后三个文件的业务断言、删除用例或新增 skip。

结束后的受跟踪差异与开始时逐字节一致，CLI 产物没有重建，website 状态为空。当前实际登记的逐断言核对无缺失，原 Windows symlink 权限跳过未计为通过。真实模型／容器 Eval、真实平台 Hook 和完整发布安装验收未执行；本次没有启动 Eval。
