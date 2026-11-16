# #561：插件 Hook 管道启动失败

来源：[Issue #561](https://github.com/rpamis/comet/issues/561)，已分配给 benym。实现分支为 `054`，比较基线为 `2ea7575c4d20b8914cb2658e57ceb4f16b02c969`。

## 结论与方案

CLI 和插件原本就使用同一套 `comet-hook-router.mjs`、Native/Classic Guard。插件的 `comet-plugin-hook.mjs` 是生命周期适配层：核对启停和安装内容、迁移可识别的旧配置、在 SessionStart 注入规则位置，并编码平台需要的 JSON 拒绝结果。直接删除包装层会丢失这些职责。

问题在于 PreToolUse 包装层已读取并解析事件，却再通过 `spawnSync(process.execPath, [router, ...], { input, encoding, ... })` 把事件交给第二个 Node。Node 默认给子进程建立管道，平台允许运行 Hook 不代表允许该进程再创建管道子进程。参见 [Node child_process 文档](https://nodejs.org/docs/latest-v22.x/api/child_process.html#optionsstdio)。截图所述 EPERM 出现在这次启动，尚未进入 Guard。

修复让同一个发布 Router 导出 `inspectCometHookRequest`。独立 CLI 仍读取 stdin、解析参数和按原协议输出；插件用文件 URL 加载已批准安装中的该 Router，把已解析事件直接传入，再编码平台输出。两种分发使用同一份 Router 产物与决策路径。Router 仍按需加载相邻 Guard bundle。

比较的方案：

| 方案                              | 判断                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| 删除插件包装层，直接挂 CLI Router | 丢失插件启停、校验、迁移与启动规则注入职责，不采用                   |
| 保留子进程，改为临时文件重定向    | 增加临时文件、事件落盘、清理及子进程依赖，且仍受启动策略影响，不采用 |
| 当前进程加载共享 Router           | 消除出错的管道子进程，复用现有事件和同一 Router，采用                |
| 插件复制 Guard 逻辑或错误时放行   | 会产生规则漂移或失去拒绝保护，不采用                                 |

动态加载目标来自插件安装路径，并在既有包内容校验后使用。架构清单新增精确 `runtimeImports` 映射；linter 将它计入原有依赖图，继续检查领域方向、公开入口和循环，并拒绝未登记、失效或不存在的映射。未新增内容摘要或公开配置开关。

## 复现与回归

原报告包含一个独立失败行为：合法 write/edit 因包装层启动失败而被拒绝。旧项目 Hook 被迁移是已有行为，未发现它是第二个独立故障；本次保留迁移及用户配置保护测试。

确定性限制注入通过 Node preload 替换 `child_process.spawnSync`：启动同一 Node 且 stdio 非 inherit 时返回 EPERM，其他命令保留实际执行。它复现报告的失败机制，不代表已在原用户操作系统沙箱复现。

```powershell
pnpm exec vitest run test/domains/skill/plugin-hook.test.ts -t 'when piped Node children are forbidden'
```

- 旧基线：DSH、Codex 两项均失败；普通写入收到 `permissionDecision: deny`，原因是 `Comet Router 启动失败：spawnSync D:\nodejs\node.exe EPERM`。
- 新实现：相同输入与断言通过；普通项目不创建 `.comet`、活动 change 合法写入保持可用、跨 change 写入收到原 Guard 原因；记录文件确认没有尝试启动管道 Node。
- 新增错误反例：包内 Router 检查抛错时，两平台均输出 JSON deny。保留插件停用/卸载、包内容改变、坏输入不迁移和原有跨 change 拒绝测试。
- 登记 case ID：`plugin-561-no-piped-router-child`。精确选择器与真实平台待验收项见 `config/workflow-regressions.json`。

旧测试 `does not turn a failed DSH router process into an allowed tool execution` 的名称、平台覆盖和拒绝断言保持原样。故障夹具由子进程退出改为模块加载抛错，适配本次移除子进程后的调用边界；另有独立测试覆盖导出检查函数执行抛错。Review 核对：两种现存错误边界均须保留原原因并返回 deny，没有删掉或缩窄历史拒绝断言。进程被外部杀死或 Node 自身崩溃属于平台执行器边界，本次没有宣称对此提供新的保证。

## 发布包与官方 DSH 桥接

使用 `npm pack comet-dsh-plugin@0.5.3 --ignore-scripts` 取得真实发布包。通过本机已安装的官方 `@deepseek-ai/dsh-hooks-claude-code` 和 `dsh-hook-protocol` 0.2.2-rc.1，给隔离事件上下文提供真实 PowerShell 命令执行适配器，调用官方 `tools/pre-execute` 处理器；Hook 子进程使用上述 EPERM preload。

| 产物                            | 结果                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm `comet-dsh-plugin@0.5.3`    | 普通 write 返回 deny，原因 `Comet Router 启动失败：spawnSync EPERM`；目标文件未写入，记录一次管道启动尝试                                                                   |
| 当前源码构建的 DSH 0.5.4 tar.gz | 普通 write 成功且不初始化项目；SessionStart 注入规则位置；活动 change 的 write/edit 完成；另一 change 的 write/edit 拒绝且文件不存在；10 条 Hook 事件，无管道 Node 启动尝试 |

本地复验脚本保存在 `.comet/tmp/issue-561-bridge.mjs`，结果在临时目录 `comet-561-official-bridge-uSIg0q/evidence.json`；旧发布包复现目录为 `comet-561-official-bridge-XyXO5X`。临时根为本机 `%TEMP%`。这些路径是本次执行记录，仓库内可重复运行的伴随回归是上面的 Vitest 案例。

这是官方桥接和实际命令的离线集成验证，事件上下文与 Shell 服务由隔离夹具提供，未启动真实模型，未验证运行中 DSH 桌面及原用户沙箱。

## 验证记录与交付限制

- 插件 Hook 文件：13 项通过，覆盖两平台的限制注入、生命周期、迁移和错误拒绝。
- Router entry、runtime、请求读取预算三个文件：31 项通过，1 项按原条件跳过。
- 架构 linter 回归、DSH 打包及 Entry Runtime 资产三个文件均通过；Agent 规则契约 6 项通过。受影响文件 Prettier、`git diff --check` 和 badcase 基线保留检查通过。
- `pnpm test:core-regressions --case plugin-561-no-piped-router-child` 通过：1 组，10 项实际执行通过，3 项因本轮选择器未选择而跳过；精确登记的 3 项全部执行通过。原始报告位于 `coverage/core-regressions/registered-plugin-561-no-piped-router-child.json`。
- TypeScript 编译与 `pnpm check:generated` 通过；已重新生成共享 Router。
- ESLint 通过。`pnpm lint` 的架构检查仅因任务开始前已有的 `.codex-attachments` 顶层目录失败；保留了该目录，未为检查删除附件或增加无关白名单。
- Codex 完整打包测试中的可迁移安装案例超过原有 90 秒限制，记为未通过，不通过增加超时掩盖；Hook 产物回归与该包含 MCP/Dashboard 的完整案例分别报告。
- 未执行仓库全量测试：本次有明确的 Router、插件 Hook、打包与架构检查范围。
- 未执行真实模型 Eval：用户未授权启动。
- 未执行真实 DSH 桌面原环境复验：本机未运行 DSH，且没有原报告沙箱。负责人 benym 在升级并重新启用插件后验证合法 write/edit 成功、跨 change 写入拒绝。Issue 保持打开，附加验收登记为 pending。

当前 package 为 0.5.4，已重新拉取并确认 origin/master 为 0.5.3，上个发布 tag 为 0.5.3；修复追加到现有 0.5.4 Changelog，不再次递增版本。没有修改 website、本机插件安装缓存或 Hook 信任记录，也没有创建 PR 或发表评论。

## Codex 打包超时补充核查

用户追问后，保留原案例的全部断言和 90 秒限制，在诊断副本中单独运行同一打包、搬迁、MCP/Dashboard、Windows Hook 和 Guard 验收流程，通过，实际测试耗时 80.65 秒。诊断副本已删除，没有修改产品代码、测试断言或超时。

原超时运行与其他打包和 Runtime 测试并行；文件记录确认 tar.gz 和 npm tgz 均已生成，两份包的解包目录约在测试开始后第 83 秒建立。该案例统一限制整条流程为 90 秒，还需逐文件比对、启动 MCP、访问 Dashboard、执行 Hook/Guard 和清理，因此累计预算余量很小。单独通过与先前并行超时支持耗时受运行负载影响，尚未证明具体某个构建子步骤存在性能缺陷。

另复用原超时运行的已搬迁产物，在新的隔离 HOME 中检查 MCP：连接 266ms，工具列表 273ms，Dashboard 资源读取 506ms，HTTP 访问通过 587ms，关闭 601ms（均为累计耗时）。这排除了该产物必然卡死在 MCP/Dashboard 的假设；原 90 秒超时保留为事实，不能改写为原轮通过。后续若优化该测试，优先拆分构建与运行验收，并复用一次构建产物。
