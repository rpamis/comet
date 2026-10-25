# Issue #506：Windows 聚合仓与 Native 归档回归

来源：[Issue #506](https://github.com/rpamis/comet/issues/506)。修复前比较基线为 `475666a3be88dee2dc2decb74f376c97bb14913b`，该分支版本是 `0.5.1`；刷新后的 `origin/master` 和上一个发布 tag `0.5.0` 均为 `0.5.0`。本次更新已有 `0.5.1` 条目，不再升级版本。

## 报告拆分与处理

| 报告 | 实际行为与处理                                                                                                                                                                                                                                   | Badcase ID                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1    | dirty gitlink 不能按普通文件读取。现在递归绑定子仓 HEAD、索引、状态和实际修改字节，支持没有 `.gitmodules` 的独立嵌套仓；不能完整读取或采样不稳定时仍拒绝复用。检查后修改子仓仍会拒绝验收。                                                       | `native-dirty-gitlink-archive`                  |
| 2    | SDK 写入口未登记请求材料，导致 UUID 或 outcome 内容变化被当作实现变化。现在复用受保护的未跟踪输入登记；已登记文件改写为同一 Run 的严格只读 inspect 时无须写登记。已跟踪文件、普通 JSON、跨 Run 或包含额外字段的 inspect 都不获豁免。             | `native-sdk-request-transport-inputs`           |
| 3.1  | 非规范 `submittedAt` 曾误报会话领取问题。现在显示字段、规范 UTC 值和实际值。                                                                                                                                                                     | `native-builder-submitted-at-diagnostic`        |
| 3.2  | `checks[].result` 曾只报摘要无效。现在显示检查下标、允许值和实际值。                                                                                                                                                                             | `native-builder-check-result-diagnostic`        |
| 3.3  | evidence 类型错误缺少具体验收项定位。现在显示数组下标、验收 ID、字符串数组要求和每条长度限制。                                                                                                                                                   | `native-builder-review-evidence-diagnostic`     |
| 3.4  | note 并非可选字段：它是 Builder 对该验收项的具体自审说明。仍拒绝空值，诊断增加验收 ID。                                                                                                                                                          | `native-builder-review-note-diagnostic`         |
| 3.5  | Verifier 回环后提交旧 iteration/attempt。继续拒绝陈旧结果，并显示预期与实际位置，提示读取当前模板并使用新的 outcomeId。                                                                                                                          | `native-verifier-position-diagnostic`           |
| 4    | 当前分支未复现“被拒请求污染基线”。实际代码仅从 succeeded 的 Verifier Action 建立历史命令基线。新增回归证明：错误轮次的失败 argv 被拒后，同一 claim、同一检查 ID 的正确 argv 可以执行；已接受命令的真实冲突仍拒绝。未放宽逐 argv 的命令身份比较。 | `native-rejected-check-request-no-baseline`     |
| 5    | SDK resolve-wait 接受结果后，verify.revalidate 仍可处于 pending。Archive 现在执行这一次已获批准的原重验，再继续归档；不会把等待算作验证失败，不重放 running/unknown Action。                                                                     | `native-archive-awaits-accepted-revalidation`   |
| 6    | Archive move 未使用已有的瞬时文件占用重试。现在短暂 EPERM/EACCES/EBUSY 按既有退避重试；持续占用时显示目录路径、外部句柄提示与恢复条件，保留原事务。未引入双份目录的复制后延迟删除方案。                                                          | `native-archive-directory-sharing-recovery`     |
| 7    | 父仓拥有两侧提交不表示目标子仓拥有 change 指向的提交对象。已授权的 worktree 合并在需要比较并发 gitlink 前，从本地 change 子仓导入缺失对象；不切换目标子仓 HEAD、不自动解决真正分叉的冲突。SDK 默认归档仍将 Git 交付单独处理。                    | `native-worktree-missing-gitlink-object`        |
| 8    | dry-run 只看待办步骤，Doctor 只看存储和执行状态，遗漏候选复核。现在 dry-run 返回具体 blockers，Doctor 将候选不可用或失败的原归档预检列为不健康；只读操作不改变 revision/state。                                                                  | `native-archive-readonly-candidate-diagnostics` |
| 9.1  | task 快速入口绕过完整 CLI 的异常处理；不可用或失效的记忆展开会打印 Node 栈。现在返回非零退出码和可解析的错误，有效记忆仍能展开，来源变化仍拒绝使用。                                                                                             | `task-unavailable-context-cli-diagnostic`       |
| 9.2  | knowledge get 读取已有记录前刷新无关索引，可能输出 index-budget。现在直接读取记录，保留查询本身的错误和 Remote 策略。回归在真实 Local Provider 上注入刷新预算耗尽，证明 get 不触发这次无关刷新。                                                 | `knowledge-get-without-index-refresh`           |
| 10   | Archive 早期拒绝没有 SDK 业务状态，通用恢复又只从 Portable state 提取候选。现在 exit 73 也保留 summary、phase/status、验收结果、candidateId 和原恢复结构。                                                                                       | `native-archive-failure-business-state`         |

15 个案例均登记在 `config/workflow-regressions.json`，每个案例保留该 Issue URL、预期、禁止结果、根因、覆盖层级和精确可执行测试名称。未删除或缩窄历史案例。

## 请求文件的位置

将 SDK `--request` 文件写到项目检出之外的系统临时目录，尤其是新建的只读 inspect/query 文件。只读查询不会为了排除自身而写入新登记；未登记或已跟踪的文件仍属于项目输入，不能靠文件名、扩展名或任意 JSON 外观绕过候选绑定。

PowerShell 示例：

```powershell
$requestFile = Join-Path ([System.IO.Path]::GetTempPath()) 'comet-native-request.json'
@{ operation = 'inspect'; runId = 'example-change' } |
  ConvertTo-Json | Set-Content -LiteralPath $requestFile -Encoding utf8
comet runtime dispatch --application native --request $requestFile --project-root . --json
```

Builder 提交采用 `submittedAt: new Date().toISOString()`；检查枚举是 `passed`、`failed`、`not-run`。每个 acceptanceReview 条目的 evidence 为具体字符串数组，每条不超过 4000 字符；note 必须提供非空具体说明。Verifier 使用当前 Action 的 outputTemplate，不复制之前回环的 iteration/attempt。更正被拒内容时使用新的 outcomeId，保留原 claim。

## 修复前后证据

- 在修复前当前分支的最小临时 Git 项目中，dirty 独立子仓导致真实 SDK 检查报“输入快照不完整”；相同测试修复后可完成检查、独立验收、用户接受和 Archive。验收后再次修改已 dirty 的文件仍被拒绝，恢复原字节并使用新收据后可继续。
- 实际下载并解包 `@rpamis/comet@0.5.0` 后，在同一个临时项目比较发布模块与本次构建。只有 dirty 子仓的简单项目可能进入物理扫描并取得摘要；加入被忽略的本地链接缓存后，发布模块的候选摘要为 null，本次构建取得完整摘要，且第二次修改 dirty 字节会改变摘要。该证据支持报告的回退死锁路径，不把“任意 dirty 子仓一定返回 null”当作已证实事实。
- SDK 项目内请求改写、接受后 pending 重验、字段错误诊断、只读诊断和失败响应都先取得修复前失败，再以同一断言验证修正。公开 Native 回归实际执行生成的命令 bundle。
- worktree 回归构造两个独立子仓对象库，目标缺少 change 提交；修复前出现报告中的 Git 原始错误，修复后从本地检出导入对象并合并成功，目标子仓 HEAD 未改变。
- Windows 回归通过独立隐藏 PowerShell 进程调用 CreateFile，持续持有不共享删除的真实目录句柄。占用时事务保留；释放后读取并恢复相同 transaction ID，重复调用仍只有一份归档。另有确定性瞬时 EPERM 回归供其他平台执行。
- 第 4 项的污染在当前分支未复现；本次只增加可执行防退化证据。若报告者仍遇到，需要原 request/outcome 收据及已接受计划来区分“被拒失败记录”与“已接受命令的真实冲突”。
- 第 9 项原报告没有异常栈、slug 或记录 ID；本次验证的是已复现的不可用记忆展开栈泄漏和 get 的无关刷新。不能据此承诺所有未知 Provider 或来源读取故障均已消除。

## 验证范围

本次执行定向 Vitest、生成命令 bundle、实际 npm 0.5.0 对照、Windows 文件系统占用与恢复、构建、类型和架构检查，以及 badcase 登记与精确选择器检查。临时目录中实际安装了本次本地 npm 包，使用独立用户数据目录核对版本、请求文件帮助、不可用记忆的 JSON 错误，以及打包模块的子仓摘要。安装使用 `--ignore-scripts`，不证明依赖安装脚本或完整发布流程。最终实际数量和结果以本次完成报告为准。

初轮登记执行中，组合了 blocked 恢复的新增 CLI 用例达到 120 秒上限；改为直接独立验收后，保留原业务断言并在原上限内通过。后续共用历史输入证据组出现两个 `EXECUTION_UNKNOWN`，前轮同名用例通过，单独串行和带子仓负载的定向复跑也通过。测试失败诊断现会显示原 Action 持久化原因。以 `VITEST_MAX_WORKERS=1` 再次执行登记案例时，记录到了“检查进程树的停止尚未确认；保留原执行登记，不能验收或重试”，生成 CLI 还出现 `spawnSync ETIMEDOUT`，达到测试子进程的 60 秒期限。没有取得底层 taskkill 的完整停止证明，不能断言并发负载是根因，也不能将未知进程树改为放行。

因此完整登记执行尚未通过，不作为完整修复关闭或发布批准。失败报告保存在 `coverage/core-regressions/registered-native-dirty-gitlink-archive.json`；前轮历史组失败报告为 `coverage/core-regressions/native-check-evidence.json`。后续应先取得原进程树与停止收据、恢复稳定执行条件，再重跑必要案例；不删除、缩窄或降低历史断言。

补充审批安全反例：接受结果后的自动重验必须仍由当前 next-step 判定允许；有待处理的扩展审批或证据请求时，不执行重验或归档。该反例先确认错误调用了执行器，再用同一断言验证停止边界。

未运行仓库全量测试、真实 Agent 平台 Hook、真实模型 Eval 或报告者 ZCode/Git Bash 环境。问题发生在确定性的输入、状态转换和文件系统边界，本次不修改模型指令或平台事件协议。第 4 项和第 9 项缺失的原始报告证据仍由维护者向报告者补齐，必要时追加来源明确的新案例；本次没有在 GitHub 评论、关闭 Issue 或创建 PR。
