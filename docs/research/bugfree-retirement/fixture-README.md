# bugfree 对照材料

`frozen.json` 保存 24 个固定候选和 6 个完整流程的起点、参考终点、文件摘要、无外部依赖的锁文件及隐藏判定。固定候选有 12 个正确版本和 12 个缺陷版本。正确性来自需求和实际执行的独立判定，不使用模型评分。

真实边界分别由以下材料覆盖：

- F07/F08：`candidate.cjs` 经两个入口模块调用折扣规则，缺陷只在右入口。
- F11/F12：两个独立 Node 进程操作同一磁盘记录。首进程在写入及完成记录持久化后以 73 退出，第二进程恢复，核对只追加一次。
- F17/F18：启动 `node cli.cjs --enabled false|true`，同时核对退出码、stdout JSON 和实际写入的配置。
- F19/F20：真实 Chrome/Edge、DOM 点击和本地 HTTP 服务；请求保持未完成时再次点击，核对服务器收到的 POST 次数，再放行响应并验证下一次提交。
- F21/F22：实际运行用户指定的 `node verify.cjs`，命令和配置均须符合要求。
- F23/F24：`prepareFrozenSupervisorCandidate` 用真实 SDK、Git worktree、Node 检查、Child 验收和集成生成父级候选。两个 Child 在正确基线上完成；正确/缺陷代码只在父级交接前写入并提交。父级不虚构命令通过，最终空计划仍绑定实际候选。核对集成工作区源码的完整字节后，在相同源码的隔离副本中检查共享磁盘中的任务编号，避免改变已绑定候选。

所有 Agent/User 身份和决定都明确标为模拟。SDK Action、Git commit、检查执行及其收据实际产生；它们不能作为真实模型遵循协议的证据。

## 普通离线检查

```text
pnpm exec vitest run test/domains/eval/native-bugfree-preparation.test.ts
```

需要 Node 22、项目锁定依赖、Git 和真实 Chrome/Edge。可用 `COMET_TEST_CHROME` 指定浏览器。浏览器只使用独立临时配置和本地 HTTP 服务。隐藏判定、标签与参考修复不写入模型工作区，`result.json` 的格式校验也不代替隐藏质量评分。

公开 `comet eval --collect` 只验证 30 个目标的离线装配，不调用模型或容器。这个测试不执行 180 次模型对照。

## 授权运行时的准备

F23/F24 和 C06 的控制器须在选定执行工作进程中调用 `test/helpers/native-bugfree-supervisor.ts` 的准备函数，传入冻结的最终文件、需求、正确基线及 `standard` 或 `bugfree`。代码相同，standard 保留实际父级语法检查，bugfree 可用空计划；Child 和集成检查相同。随后把返回的 `projectRoot`、`integrationRoot` 和 `task` 交给执行平台，Runtime 命令在控制项目运行，代码审查指向集成工作区。可用 `COMET_NATIVE_TEST_PACKAGE_ROOT` 指向固定 Comet 包；首次记录其版本、内容摘要及执行环境。不能把另一台机器已经创建的 Run 直接复制进容器，或自行填造 Child/集成收据。公开 manifest 的任务正文保留了这项准备要求；实际模型环境接入仍须在用户指定场景和轮次后核对。

未来运行前仍要人工复核标签、固定模型与环境并取得明确授权。实际修复轮数由模型行为决定，不能为凑“多轮”而强制失败。缺失的 token、费用和计时保持 null；超时、未完成与 blocked 都保留。材料若需要调整，保留旧来源与变化原因，重新检查摘要和隐藏判定，不在看到模型结果后删除困难案例。
