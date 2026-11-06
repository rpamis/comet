# #538：Windows Dashboard 插件页加载与探针恢复

来源：[GitHub Issue #538](https://github.com/rpamis/comet/issues/538)。日期：2026-11-04。

本次按用户最新要求直接修复，不使用 Comet 工作流。先前创建的 `issue-538-dashboard-latency` Run 已通过公开命令取消，返回 `cancelled: true`、`quiescent: true`、`cleanupRequired: false`；对应 change 文档和目录已删除。实现和验收在隔离 Git 工作区完成；后续按用户授权提交并合入 `052`，Git 交付结果以实际提交与远端记录为准。未评论或创建 PR。

## 范围与版本

- 工作区：`D:/Project/comet-issue-538`，分支：`codex/issue-538-dashboard-latency`。
- 实现前基线：`0c75bfaab8507c3931b9816ce2f59517613f033e`；原 `D:/Project/Comet` checkout 和 `website` 子模块未改动。
- 旧产物：从 npm 获取的 `@rpamis/comet@0.5.1` 发布包；未改写包内文件。旧包测试只把同一批测试的导入路径指向 `package/dist`。
- 远端 master：`ff64a75cc51d68b57218c6ce7fad94a7383b9a76`，版本 `0.5.2`；上一个发布 tag 为 `0.5.1`。本次将版本与 manifest 设为 `0.5.3`，同步 npm lock 根版本，新增英文 Changelog。未发布。

## 行为、根因与回归映射

| 独立行为 / case ID                                     | 根因                                            | 预期与禁止结果                                                                                           | 实际测试边界                                                |
| ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `dashboard-plugin-host-slow-reloads`                   | 成功 host 只缓存 1 秒；项目配置写入没有失效通知 | 缓存 60 秒，并发共用构建；每次读取新页面数据，配置和插件操作立即失效，失败可重试；禁止缓存错误或页面数据 | 真实临时项目和 HTTP API；配置写入、启停、过期及失败恢复     |
| `dashboard-plugin-host-git-observations`               | host 初始化没有复用已有的请求内 Git 观察        | 单次有 origin 的项目构建执行 2 次必要探测；后续构建重新读取；禁止跨构建永久缓存项目身份                  | 默认 factory、真实存储和可计数 Git 适配入口                 |
| `dashboard-plugin-local-page-budget`                   | 页面 2 秒父预算截短内部 10 秒预算               | 本地 2.2 秒操作成功；页面及调用上限均为 10 秒；更短父预算和取消仍生效；禁止无限等待                      | 实际等待的 Runtime 页面调用及父预算；原远端失联测试完整保留 |
| `memory-dashboard-section-debug-diagnostics`           | 分区异常只变成通用文案，原因被丢弃              | 保留成功分区；`COMET_DEBUG=1` 或 `true` 记录插件、分区及脱敏错误，默认不额外记录；禁止泄露 Bearer 凭据   | 真实个人记忆模块、故障服务、日志捕获；默认模式反例          |
| `windows-process-probe-slow-compilation`               | 编译上限 1500ms                                 | 有限编译预算改为 10 秒，1.6 秒夹具可发布并复用；禁止无界编译或跳过 hash 校验                             | 文件系统和编译故障夹具；另运行真实 Windows 探针兼容测试     |
| `windows-process-probe-unpublished-executable-cleanup` | finally 没有清理未发布 exe                      | 编译写出输出后失败、manifest 发布失败均清理本次 exe、源码、临时 manifest 和持有的锁；禁止删除有效缓存    | 两个独立故障注入，检查目录内容与未知探测结果                |
| `windows-process-probe-preparation-backoff`            | 准备失败每 10 秒重试                            | 10 秒及 59999ms 不重试，60000ms 可以恢复；保留兼容探测；禁止将不可用当作进程退出                         | 既有编译失败和忙锁恢复测试增加分钟级断言，未删除原断言      |
| `windows-process-probe-owned-temporary-cleanup`        | 未取得锁、未创建文件也会尝试 unlink             | 只清理本次实际使用的临时文件；忙锁路径不调用 unlink；禁止绕过外部删除护栏                                | 忙锁反例及成功发布路径的文件检查                            |

精确测试文件、选择器和完整测试名登记在 `config/workflow-regressions.json`，均保留 #538 来源。没有删除或停用历史案例。

## 旧失败与新通过

修复前当前分支先执行新增的四个测试文件，确认缓存、预算、调试日志、exe 清理、慢编译和忙锁空删除断言能够检出问题。

同一批相关断言再针对 npm `0.5.1` 运行：实际执行的 11 项中，10 项按预期失败，默认不输出调试日志的反例通过；其余 26 项未由该次精确选择器选择。具体失败包括：

- host 重载后构建次数从 1 增至 2；默认构建 Git 次数为 6，超过 2 次断言。
- 2.2 秒本地操作被预算错误拒绝；调试分区失败没有日志。
- 两种失败各残留一个 exe；慢编译返回 null；忙锁仍调用两次 unlink。
- 原包在 10 秒重新准备，违反新增的分钟级冷却断言。

旧包使用的命令：

```powershell
pnpm exec vitest run --config .tmp/issue-538-old.config.mjs -t 'loads a section taking|reuses hosts across|removes unpublished|allows slow successful|does not delete files when|keeps successful sections|shares Git identity|retries after a cooldown' --reporter=json --outputFile=.tmp/issue-538-version-051.json
```

修复后定向检查覆盖 Dashboard host、HTTP、默认 factory、项目知识缓存兼容、个人记忆诊断、Windows 探针、进程身份、操作预算和插件存储：10 个文件中 56 项通过、0 项失败，另外 2 项 POSIX 专用读取/FIFO 测试在 Windows 按既有条件跳过。真实 Windows 当前进程枚举和 native probe 与 PowerShell 身份一致的测试均执行通过。

```powershell
pnpm exec vitest run test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/default-plugin-host-options.test.ts test/domains/dashboard/default-plugin-host-defaults.test.ts test/domains/comet-memory/dashboard-diagnostics.test.ts test/platform/process/windows-process-identity.test.ts test/platform/process/process-identity.test.ts test/platform/process/operation-budget.test.ts test/platform/plugin-store.test.ts --reporter=json --outputFile=.tmp/issue-538-final-tests.json
```

## 浏览器与公开 HTTP

环境：Windows `10.0.26300`、Node `v22.20.0`、本机 Chrome 无头模式、1440×1000。每个版本使用独立临时 HOME、数据目录、有 origin 的 Git 项目和一条测试记忆；保持原进程环境，`NODE_OPTIONS` 实际未设置。

浏览器先从 Dashboard 首页点击“个人记忆”，在超过一秒后重新打开，再点击“项目知识”；随后以 1.5 秒间隔直接调用三次个人记忆 HTTP API。两版均能显示测试记忆，全部 API 返回 `partial: false`，无分区错误、浏览器异常或“此部分暂不可用”提示。新构建的三个页面均已保留截图并检查真实渲染。

| 观测                                     | npm 0.5.1            | 当前修复构建         |
| ---------------------------------------- | -------------------- | -------------------- |
| 整个场景的 host 构建次数                 | 6                    | 1                    |
| 每次 host 构建 Git 次数                  | 6                    | 2                    |
| 首次 host 构建                           | 856ms                | 350ms                |
| 浏览器首次个人记忆 / 再次打开 / 项目知识 | 3821 / 3159 / 2783ms | 3387 / 2291 / 2201ms |
| 后续三次个人记忆 API                     | 736 / 751 / 705ms    | 156 / 159 / 185ms    |

这是本机小样本观察，旧新任务曾并行执行，浏览器总耗时还包含前端加载和渲染，不作为严格性能基准或原报告机器的固定速度承诺。旧包在本机未出现 20–40 秒或自然分区失败；这些条件通过真实发布包上的慢操作与故障注入逐项复现，不能声称完整重现了原用户环境。

本机证据原位于 `.tmp/issue-538-browser-{old,new}.json`、`.tmp/issue-538-{old,new}-{1,2,3}.png`，浏览器脚本为 `.tmp/issue-538-browser.mjs`。清理隔离工作区前，报告、截图、脚本、旧 npm 包和回归执行报告保留到原 checkout 的 `D:/Project/Comet/.tmp/issue-538-delivery-evidence-20261104/`。这些是本地证据，不属于发布资产。

## 其他验证

- `pnpm build`：通过，包含 TypeScript、Native CLI、Classic/Native/Entry bundle 和 Dashboard 前端。构建报告既有的大 chunk 提示，未更改前端拆包策略。
- `pnpm check:generated`：通过。探针实现被多个 Runtime 使用，对应生成资产由构建同步。
- `pnpm lint`：通过；8 条现有未使用变量警告，未改动相关前端文件；architecture lint 通过。
- `pnpm check:badcase-registration --base 0c75bfaab8507c3931b9816ce2f59517613f033e`：通过，保留历史登记。
- 本次 8 个 case 的 `pnpm test:core-regressions --case ...`：全部通过。执行器按文件合并为 5 组，12 项断言通过，失败组为 0；本地 `coverage/core-regressions/summary.json` 保存汇总，各组 JSON 保存精确测试名。

## 限制与后续

1. 不修改或移除 `NODE_OPTIONS`，不改第三方安全 shim，也不换用绕过其删除拦截的 API。减少了 Comet 在忙锁、未创建产物及已发布 manifest 上的多余 unlink，但未消除安全 shim 对必要锁释放的成本。
2. 原报告的 CodeBuddy/WorkBuddy 注入脚本和原机器性能环境未提供给本次隔离运行。该环境下仍需报告方在修复包发布后复测并保留耗时及 `COMET_DEBUG=1` 日志；负责人为报告方与维护者。不能把未复现的第三方影响标成已修复。
3. host 的 60 秒 TTL 保留有界刷新；Dashboard 内项目配置和插件操作立即使缓存失效，其他进程直接改写配置可能等待当前 TTL。页面业务数据不因 host 缓存而缓存。
4. 未运行仓库全量测试、模型 Eval、真实 Agent 平台 Hook、完整发布验收或新 npm 安装包验证。本次改变的是 Dashboard 和本地进程探针，没有模型遵循变更；Eval 未获启动请求。
5. 实现与验收阶段未修改 GitHub、提交、推送或发布；后续 Git 交付获得单独授权。测试与浏览器证明本机对应边界，不代表远端 CI 或原报告环境的完整结论。
