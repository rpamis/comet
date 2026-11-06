# 原始请求核对与 Eval 运行边界修复

来源：`report:2026-11-04-native-original-request-verification`。比较基线：`052` 的 `5759f1565acc400e94d64df32b56139a801b349e`。

用户要求修复 Comet。此前两组单样本 Eval 已结束；这次修复没有启动模型、评分容器或新一轮 Eval。模型行为和实际镜像对照仍需新授权的独立证据，不能以确定性测试替代。

## 原始现场

bugfree Run `comet-eval-ef33e72b-de52-4955-a011-4df32bdfbd1b` 完成独立验收和归档，但 WorkBuddy 原题只有 3/14。7 项失败需要安全场景自动 reconnect/replay，4 项失败涉及不可重放场景的 WatchError。Agent 的 brief 明确把自动重连和新增 WatchError 列为非目标；后续测试和独立审查都围绕新 Spec，未纠正该解释与原题评分契约的分歧。

原始自然语言没有完整规定自动重连和异常类型，不能把评分分歧全部当成基础编码错误。Comet 需要处理的是原始目标、方案选择和独立审查之间的语义关系；不在产品中硬编码这道题的隐藏答案。

普通 Run `comet-eval-d066e321-1585-48b4-9fd5-fcaed50ff144` 连续 10 次 HTTP 429，停在 Shape，未实施。其原始候选的 3/14 不作为普通模式最终成果。两组原始记录、失败项和脱敏工具记录继续保留于本地 `.comet/eval/launches/2026-11-04-bugfree-hard-rerun-5759f156/`，不改写历史评分。

## 修复一：绑定原始请求，在同一次验收中核对

此前 `--task` 只用于能力检索，没有保存到 Native Run。bugfree 给独立 Verifier 的任务包以生成的 Spec 和验收项为主，原始请求可能在交接时丢失。

现在：

1. `native new --task` 的文本原样写入不可变的 `run.input.task`，现有能力检索继续使用同一输入；空文本在创建前拒绝。
2. Builder 和 Verifier 的领取结果提供 `originalRequest`。bugfree 任务包也提供原文及核对指令；普通模式沿用原手工接入协议，并获得同一原始请求来源。
3. 对保存了原始请求的 Run，Verifier 在已有结果中提交 `requestReview: { result, reason }`。result 为 `aligned`、`conflict` 或 `blocked`。只有明确 aligned 且其他条件全部满足，Runtime 才接受 pass；缺项、冲突和未解决疑问不能通过。
4. 字段不增加新 Action、审查 Agent、模型调用或固定测试。Runtime 核对来源、结构、身份与既有候选绑定；具体语义仍由当前 Agent 判断。
5. 中文 Skill 先更新并得到用户确认，再同步英文：创建时保存原始请求，Shape 核对非目标和假设，Verifier 先比较原始请求、Spec 与实现，范围变更要有真实用户授权。固定评估中的模拟批准不能改写原题。
6. 旧 Run 没有 task 时保持原协议，不伪造历史原文；Skill 要求从交接与用户记录补查。Compat 沿用原状态和协议。该兼容边界不等于旧 Run 已自动获得新的 Runtime 约束。

测试先在旧代码失败：Run 输入缺少 task。修复后分别验证 standard、bugfree 的来源保存、缺少 requestReview 拒绝 pass、conflict/blocked 拒绝 pass，以及 aligned 的正常通过。公开 CLI 还验证返回的业务收据模板包含原文和核对结构，并通过真实派发提交结果。

这里的 aligned 是可审查的 Agent 判断，不是 Runtime 已经理解并证明业务语义。当前模型仍可能误判，真实模型遵循和正确率改善保持待验证。

## 修复二：在评分容器读取原 Runtime，区分不可用与不匹配

此前本机 `validate_dataset` 调用 `inspect_run`，其默认模块根为 `/opt/comet-current`，在 Windows 执行 `as_uri()` 抛出 `relative path can't be expressed as a file URI`。本机也无法直接读取 Linux 容器中的 Runtime 卷。异常随后被误归类为模式不匹配。

现在模式检查在已有隔离评分容器中执行，并且早于原题评分器上传测试或修改副本：

- 从原始执行目录通过已有确定性命名规则取得 Runtime 卷，确认存在后只读挂载；不根据模型可改写的卷标记选择任意数据。
- 将控制器的 SDK 检查模块只读挂载，以隔离的 Python 入口启动控制器，使用容器内公开 CLI 和真实 owner/Run 查询；不以 portable checkpoint 或模型声明代替 Runtime 证据。WorkBuddy 保留原私有 Python，SkillsBench 控制器增加 `-I`；原题测试自己的解释器和插件规则不变。
- 保留实际查询的 SDK evidence、原始 Run 和创建时模式。仍有 active change、根 Run 未完成、缺少卷、查询错误等情况返回 unavailable。
- 主体候选继续保留，原题只在副本评分。即使模式证明缺失，原始 reward 和业务失败仍记录。
- 真正不同的模式记为 `dataset_verify_mode`；查询无法完成记为 `dataset_verify_mode_unavailable`，归入 harness，不声称已经证明模式不同。
- Goal 及未声明模式的历史计划不新增这项读取。

定向测试核对本机不再调用容器模块入口、查询发生在原评分之前、matched/mismatch/unavailable 的区分，以及原始低分仍保留。实际容器挂载、只读 Runtime 查询与完整评估链路尚未重跑。

## 修复三：镜像缓存键绑定实际构建输入

旧 `get_dockerfile_hash` 混入整个 `.dataset-task.json`。verifyMode 或后补 controllerPaths 会改变镜像键，导致本应只比较模式的样本使用不同镜像；同时键没有覆盖所有实际构建文件，例如安装脚本。

现在数据集准备后的构建键读取 `.dataset-build` 的实际目录与普通文件，绑定相对路径、文件模式和流式读取的内容，空目录也参与绑定；文件读取不稳定、目录集合改变或链接输入不能可靠处理时明确失败。不把模式、控制器后续文件或评分结果加入构建键。

普通 Bash/Node 测试取得旧失败、新通过证据：只更改模式和 controllerPaths 时键保持一致，改变安装脚本时键必须改变。真实镜像 ID、CLI 版本、模型和对照身份的严格检查保留，没有通过忽略镜像差异获得可比较结论。实际 Docker 镜像复用和新一轮配对仍未执行。

## 验证与交付

逐项案例追加到 `config/workflow-regressions.json`，保留基线全部登记及断言；模型、容器和真实配对证据分别登记 pending。

实际执行结果：

| 检查                                                | 结果与范围                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Native verifier-context                             | 13 项全部通过，包含 standard/bugfree 原始请求核对、旧 Run、续审、输入变化与一次性操作；228.58 秒              |
| Native verifier-protocol 与 flow-efficiency         | 24 项全部通过，旧完整协议、验收覆盖、独立身份和原结果模板兼容；4.13 秒                                        |
| Native capability-discovery                         | 8 项通过，原检索与关联行为保留                                                                                |
| 公开 CLI 与 runtime-dispatch 定向测试               | 4 项通过，含原始请求和结果模板、真实收据提交、正常 pass、冷恢复及 Builder 身份拒绝；其他 12 项未选；116.07 秒 |
| Python 数据集、sample-quality、attribution 定向文件 | 92 项通过；16.95 秒。后续加强空目录指纹反例，旧断言失败、修正后与只读卷/隔离入口测试一起通过                  |
| 两项新增 Vitest → Python 适配入口                   | 通过，实际执行镜像指纹及模式核对的精确选择，未启动 Docker 或模型                                              |
| Skill 路由/来源、Native 与 Entry 资产契约           | 4 文件、33 项通过；12.96 秒                                                                                   |
| `pnpm build`                                        | 最终源码构建通过，TypeScript、Runtime bundle 与 Dashboard 已生成；有既有前端分块体积提示                      |
| `pnpm check:generated`、`pnpm check:sdk-api`        | 通过，已登记 SDK 公开接口报告不变                                                                             |
| `pnpm lint`                                         | 无错误，架构检查通过；8 条未修改的 Dashboard unused 警告保留                                                  |
| badcase 登记基线保留                                | 基于 5759f156 通过，原 306 项不变，追加 3 项；附加验收保持 pending                                            |
| Ruff、受影响文件 Prettier、`git diff --check`       | 通过                                                                                                          |

开发过程中发现新字段误被基础解析器当成所有 Run 必填，相关 17 项回归曾失败；修正为可选解析、仅有原始 task 的新 Run 在 pass 时强制后，原协议 24 项和上下文 13 项重新通过，旧断言保持不变。源码路径的 runtime-dispatch 测试仍有既有 `comet-task-context-worker.js` 缺失提示并降级继续；编译后公开 CLI 路径通过，没有借本次修复改动上下文产品行为。

没有运行仓库全量测试、真实平台 Hook、实际评分容器或模型 Eval。这些未完成证据不计为通过；尤其不能据此把旧 3/14 改成更高分，或宣称模型已消除误解。

版本继续使用用户指定的 0.5.2。当前 package 和 origin/master 均为 0.5.2，上一个发布 tag 为 0.5.1；不新增版本。Changelog 描述最终可见行为，不把本分支内部修正单列为已发布缺陷。本次未提交、推送、创建 PR 或修改 website、领域 Skill、原题及评分脚本。
