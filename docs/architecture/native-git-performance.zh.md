# Native Next 与 Archive 的 Git 性能

来源：`report:2026-10-25-native-git-performance`。比较基线为 `e8fdaebc935b4798d68a0ceff0fff7b915de3a2c`，环境为 Windows、Node 22.20.0。

## 复现与根因

用户截图对应的本地可观察记录中，一次成功 Next 耗时 281,253.7 ms，48 次 Git 累计 96,746.8 ms；一次成功 Archive 耗时 44,454.3 ms，228 次 Git 累计 23,556.4 ms。Git 累计耗时允许包含并行调用，不能直接当作命令总耗时。

在当前 Comet checkout 上，用基线源码只读采样检查输入，复现了约 35.6 秒的等待。具体失败命令是生成输入的 `git ls-files --others --ignored --exclude-standard`：多个 glob 路径导致 Git 进入不属于本次输入的 `.worktrees`、`.tmp` 和依赖目录，达到 30 秒进程期限，采样结果为不完整。简单添加排除模式仍不能阻止这些目录被遍历。

另一个最小真实 Git SDK 项目从公开 Next 进入 Archive 预检，再执行 Archive，分别调用 56、66 次 Git。提交与分支、索引与未跟踪文件分别查询，以及准确 checkout 根重复探测，增加了进程启动和串行等待。

## 修改范围

- 先发现生成根，再对每个实际存在的生成目录使用单独的字面路径查询。保留嵌套项目与子模块的生成输入、Next 类型文件，以及依赖目录和 Next 临时输出的既有排除规则。
- 查询后重新核对所有生成根，包括开始时不存在的根。根在采样期间新增、移除或替换时，报告不完整，不能复用旧证据。目录时间不参与身份比较，避免已排除的 Next cache/trace 更新造成误阻塞。
- 合并提交与分支、索引与未跟踪文件的查询；每批最多并行四个只读 Git 查询。失败后等待本批查询结束，保留原来的时限、输出限制和错误处理。
- 准确 checkout 根直接使用 Git worktree 列表中的身份；子目录仍由 Git 解析归属。后续命令重新读取分支，不增加跨命令内容缓存。

完整输入摘要及生成输入摘要的字段和值保持兼容。没有省略候选、检查收据、生成内容、子模块或归档副作用边界的校验。

## 验证记录

- 真实 Comet checkout 的同一输入采样路径由约 35.6 秒降至 5.6 秒，约减少 84%，结果由不完整恢复为完整；这是输入采样的对照，不是整个 Next 或 Archive 的重放。
- 在隔离 Git 项目中，基线与新源码的完整检查输入和生成输入摘要逐字段相同，分别验证普通分支与 detached HEAD。
- 公开 source 与生成 Runtime bundle 的回归同时断言 Git 调用上限、原 Run 正常归档；另验证实现变动在 Archive 边界被拒绝。
- 最小项目的 source 路径中，Next 的 Git 调用从 56 次降到 39 次，Archive 从 66 次降到 45 次；生成 bundle 分别为 38、44 次。回归上限分别为 40、46 次，按调用数验证，不使用易受机器负载影响的墙钟时间断言。
- 回归保留生成内容变化、依赖内容排除、嵌套项目、Next 类型、子模块撤销初始化、HEAD 变化、目录替换及内容读取竞争的断言。新增断言覆盖字面查询范围和采样期间出现生成根。
- 回归案例登记在 `config/workflow-regressions.json`：`native-next-git-query-budget`、`native-archive-git-query-budget`、`native-generated-input-literal-query-scope`。
- 已登记的五个精确测试全部通过，并用 Vitest JSON 报告逐一核对 `requiredNames` 与执行结果。`test:core-regressions --case ...` 会把同一文件合并到历史大组，因此该次运行主动停止，改用登记中的精确测试名执行；未把停止的大组报告为通过，也没有缩减历史登记。
- 分轮执行并通过 77 项相关测试，覆盖输入指纹、候选比较、Git 进程、worktree 身份、旧收据、正常归档和实现漂移。`tsc --noEmit`、Prettier、`git diff --check`、架构检查及三个 Runtime 的构建和生成物一致性检查通过。`pnpm lint` 无错误，保留 8 个既有 Dashboard 警告；额外检查受影响测试文件时保留 1 个既有未使用变量警告。

没有重新运行截图中已经归档的原 change，也没有修改其状态。没有运行仓库全量测试、真实模型 Eval、真实 Agent 平台 Hook 或完整 npm 安装验收；本次验证的是确定性 Git 查询、输入绑定及公开 Runtime 命令，不涉及模型协议或 UI 修改。完整发布与安装验收仍需按对应流程执行。
