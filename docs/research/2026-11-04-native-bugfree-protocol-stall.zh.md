# 停止 bugfree 对照后发现的问题与修复

> 历史记录：该模式已于 2026-11-05 撤下。当前状态、失败根因和证据索引见[撤下记录](2026-11-05-bugfree-retirement.zh.md)。文中的启用步骤和待办不再适用于当前产品。

来源：`report:2026-11-04-native-bugfree-protocol-stall`。

本次以 `052` 的 `c3d0e82fba36c6851f7afd7517b5d510ca0cb6a5` 为比较基线。用户要求停止对照并修复已发现的问题；停止后只执行确定性测试、公开 CLI 和构建检查，没有启动新的模型或容器 Eval。

## 停止状态与原始记录

- bugfree Run：`comet-eval-ffbef2bd-904d-405b-a30e-a248daec64a0`，WorkBuddy `reliability-hard-pipeline_reconnect`，单样本。
- 模型和独立 Verifier 均使用 `glm-5.3-flash`，执行器为 Claude Code 2.1.306，没有 LLM Judge。
- Run 于 `2026-11-04T09:41:02.685Z` 停止，记录状态为 `stopped`，进程清理已确认，所属执行容器为零。普通 Native 组没有启动，保存 `standard.skipped.json`，不补跑。
- 原题评分尚未执行，没有本轮业务分数，不能用作有效配对对照，也不能把停止样本记为零分。
- 约 90 分钟中，Shape 约 23 分钟（含一次约 10 分钟的接口响应等待），Build 约 16 分钟。Verify 开始后约 27 分钟才真正派发独立 Agent，子任务又花约 20 分钟调查输入与协议。实际两次正式检查只用了 83ms 和 109ms，合计 192ms。
- 保存的工具记录确认有一次真实 Agent 调用和对应子会话，不能把本次归因为“没有独立 Verifier”。主 Agent 在此之前已预先领取逻辑 Verifier 身份并准备协议；实际独立派发明显滞后。
- 父子记录中有 217 条去重后的 assistant API 消息。停止时没有完整最终用量账目，不将该数字当作 token 或费用结算。

完整现场位于本地忽略目录 `.comet/eval/launches/2026-11-04-bugfree-hard-rerun-c3d0e82f/`：计划、启动与停止结果、观察记录、脱敏工具轨迹、候选代码与正式文档均保留。`evidence/sources.json` 保存原始来源摘要；`evidence/runtime-checks/` 保存原始检查收据和三份输入快照。没有把 API 凭据写入报告或归档。

## 逐项修复与边界

### 1. Windows 初始化生成了 Linux 无法读取的 Runtime 标记

旧 `seed_dataset_native_mode` 在真正候选目录运行本机 Native init。即使只想设置模式，也会留下包含 Windows 绝对路径的 `.comet/runtime` 迁移 fence。Linux 正确拒绝这些损坏路径，模型随后陷入修复状态目录的往返。

现在在独立临时项目通过公开 CLI 生成配置，再只复制 `.comet/config.yaml` 到执行目录；已有配置先交给该 CLI 读取验证。拒绝通过配置文件或父目录符号链接写入。不复制 Runtime 标记，也不放宽 fence 校验。

同一公开 status bundle 在 WSL Ubuntu 24.04、Node 18.19.1 上取得旧失败、新通过证据：

- 旧目录 `pytest-1169/test_dataset_native_mode_seed_0/prepared`：退出 65，提示“Runtime 迁移 fence 已损坏”。
- 新目录 `pytest-1170/test_dataset_native_mode_seed_0/prepared`：退出 0，Native changes 为零。

两次均为普通 Node CLI 调用，不启动模型或 Eval 容器。临时目录可能被 pytest 后续清理；结果以本次工具执行记录为证据。

案例：`eval-native-portable-mode-seed`。真实完整容器启动链路仍待另行授权验收。

### 2. 后创建的控制器文件混入候选输入

控制器最初登记路径之后，还会创建 `_eval_target_skills`、`.eval-task-prompt.txt` 和 `.eval-runtime-volume`。旧流程没有在创建时补登记，冻结快照包含了大量评估器文件。

现在只对这三个已知路径在创建前登记，使用精确 Git exclude，并记录到 `controllerPaths`。只适用于声明 `exclude-harness-created-paths` 的新策略；历史策略保持原语义。若原题已有同名文件或目录，拒绝继续并保留原文件，禁止覆盖或顺便隐藏。业务文件、相似前缀和 Native 文档仍然可见。

案例：`eval-native-late-controller-inputs`。没有修改领域 Skill 的内容或注入政策；这部分按用户要求暂缓。

### 3. 审查任务包没有展示检查后的真实文件变化

原始和刷新后的快照各有 750 个文件，内容摘要同为 `f30c47cda7386c084450b73fc5591c70cc33b01a4c2d0ab272a730e9d694fe1c`。刷新前快照只有 746 个文件，摘要为 `0b9c6b13008624fc2b7ac244f07b921cb9c631e70e30a8a514371fcc00673061`。差异恰好是 `redis_like/__pycache__/` 下四个 Python 3.12 缓存文件：模型删除，检查又生成。

原任务包展示的是创建基线到最后检查快照的变化，无法直接说明检查之后发生了什么。Runtime 拒绝未经审查的输入变化是正确行为；修复不忽略某类扩展名，也不让 Verifier 手工改写绑定摘要。

现在任务包读取当前实际输入，返回 `checkInput`：原检查与当前摘要、逐文件变化、输入完整性、候选适用状态、检查证据适用状态和恢复命令。判定复用既有 Runtime 检查器：

1. 候选发生变化：使用返回的 `edit-review observe`，由当前 Agent 判断实际影响，不能靠刷新检查接受代码修改。
2. 绑定的保留证明成立：返回 `retained`，继续审查，不重跑检查。
3. 候选仍适用而检查证据过期：才按需提交原可重复检查的刷新请求。
4. 输入不完整或无法判断：保留阻塞，不将未知记为通过。

确定性测试用通用 `check-cache.bin` 复现删除，先断言旧结果不能通过，再通过正式编辑审查保留证据；最终通过时仍只有一次检查 Action。没有语言或缓存类型特判。

案例：`native-verifier-live-input-retention`。一次性检查没有整组刷新模板；原 Runtime 的候选、授权及执行约束保持有效。

### 4. 提交字段需要反复猜测，独立派发说明被大量上下文挤到后面

旧 `resultRequest.result.output` 只是提示字符串，业务结构藏在另一份完整协议模板里。bugfree 的空检查列表还隐藏了添加检查所需字段。此次记录出现多次缺字段拒绝及 Runtime 源码搜索。

现在领取响应直接提供可填写的业务结果模板，保留不透明 `receipt`，由 Runtime 绑定 Action 和领取身份；完整 `outcomeRequest` 继续兼容。另提供可选 `checkRequestTemplate`，但默认不新增任何检查。仅当已知原检查全部可重复时，提供带原检查参数的 `refreshChecksResultRequest`；这是请求模板，不自动执行。失败与独立执行限制仍须如实提交。

待派发任务先展示独立只读会话要求及领取请求，再展示可能很大的语义输入。真实模型能否及时派发独立 Verifier，仍需模型 Eval；字段顺序本身不能证明独立执行。

案例：`native-handoff-typed-result-template`、`native-verifier-delegation-header`。

## 验证记录

本次逐项取得旧代码红测，再运行修正后的同一案例。既有 301 项 badcase 登记保留，追加上述五项；涉及模型或真实容器的附加验收均保留为 pending。

实际执行结果：

| 检查                                                                                                                                                           | 结果与范围                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `vitest run test/app/native-bugfree-cli.test.ts test/domains/comet-native/native-verifier-context.test.ts test/domains/eval/builtin-dataset-bootstrap.test.ts` | 3 文件、39 项通过，包含公开 CLI 冷恢复、全部上下文正反例和确定性 Python 数据集适配测试；194.41 秒   |
| Native runtime dispatch、SDK application、verification-inputs 的定向选择                                                                                       | 3 文件、8 项通过；包含收据提交、独立交接、拒绝失效收据和单次命令防重放；其余 229 项未选中；30.88 秒 |
| 扩展后的公开 CLI 收据案例                                                                                                                                      | 1 项通过：实际提交返回的 `refreshChecksResultRequest`，执行检查并回到独立审查；41.50 秒             |
| Windows → WSL 公开 status bundle                                                                                                                               | 旧准备目录退出 65，新准备目录退出 0；不使用模型或 Eval 容器                                         |
| `pnpm build`                                                                                                                                                   | 通过，重新生成 Runtime、编译 TypeScript 和构建 Dashboard；保留现有前端分块体积提示                  |
| `pnpm check:generated`                                                                                                                                         | 最终构建后通过，生成物与源码一致                                                                    |
| `pnpm lint`                                                                                                                                                    | 通过，架构检查通过；有 8 条未修改的 Dashboard unused 警告，无错误                                   |
| `pnpm check:sdk-api`                                                                                                                                           | 所有已登记 SDK 公开接口报告一致，无需更新基线                                                       |
| `pnpm check:badcase-registration --base c3d0e82fba36c6851f7afd7517b5d510ca0cb6a5`                                                                              | 通过，保留原 301 项，追加 5 项；未声明 pending 附加验收已经完成                                     |
| 3 个受影响 Python 文件的 Ruff check / format check                                                                                                             | 通过                                                                                                |
| 受影响 TS、JSON、Markdown 的 Prettier 与 `git diff --check`                                                                                                    | 通过                                                                                                |

源码路径测试两次触发既有的 `comet-task-context-worker.js` 缺失提示，并按原降级策略继续；编译后的公开 CLI 案例通过。没有因这个提示更改上下文产品行为。普通测试通过不能证明真实模型遵循或耗时改善。

## 未完成的证据与交付限制

- 不重启用户已停止的 Eval，不启动普通 Native 组。模型协议遵循、正确率、token 和端到端耗时改善均未重新测量。
- 没有重跑原题评分。原候选 Spec 仍以调用方显式 `Connection.reconnect()` 再 `execute()` 为主；与原题恢复语义是否一致仍需独立判断，不能通过向固定任务注入隐藏评分答案解决。
- 没有运行仓库全量测试、真实平台 Hook 或网站验收；本次没有修改网站、领域 Skill 或平台 Hook 安装规则。
- 当前分支和 `origin/master` 的 package 版本均为 0.5.2，上一个发布 tag 为 0.5.1。用户已明确本轮全部追加到 0.5.2；不新增版本。只调整现有新能力描述，不把未发布功能内部修正列为已发布问题的 Fixed 条目。
- 本次没有自动提交、推送或创建 PR。
