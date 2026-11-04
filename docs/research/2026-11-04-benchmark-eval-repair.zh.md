# WorkBuddy / SkillsBench 接入修复记录

日期：2026-11-04。工作区 `D:/Project/Comet`，分支 `052`，比较基线 `144880f53ae7b826d8d5b58997ac51ee6ace5f26`。本轮按用户“领域 skill 暂时不需管，其余的修复”实施，来源为 [接入审查](D:/Project/Comet/docs/research/2026-11-04-benchmark-eval-audit.zh.md:1)，稳定报告 ID：`report:2026-11-04-benchmark-eval-audit`。

领域 Skill 的注入、删除和 with-skill/no-skill 条件保持原状。本轮没有启动真实模型、原题评分容器或容器 Eval，没有改写既有分数，也没有提交、推送或创建 PR。代码与确定性检查完成后，仍须分别看待下文列出的外部验收缺口；本文不宣称已证明模型遵循或全部题目可运行。

## 原题与模拟确认

- 保留原始 instruction，新增独立的 `instructionHash` 校验；加载和评分时从原题重新读取，拒绝用模拟批准替换原题正文。
- 新计划的主体任务说明明确：批准不能删减原题要求，不能改变接口、路径、格式或行为；先读公开代码和文档，模拟用户不补充新的产品决定。
- 将原题的公开任务文件以只读方式挂载到 `/opt/comet-task-contract/task.md`。路径来自评估控制器，不从模型可改的候选元数据中选择本机文件；没有给主体挂载隐藏测试或原评分目录。
- 主体被要求把这个路径交给独立 Verifier，同时核对原题和批准后的 Spec。模拟用户受到相同的需求边界约束。
- 原题 hash 只能证明文本绑定。模型能否识别语义冲突、Verifier 是否实际完整阅读原题，仍待获得授权后的真实模型 Eval；不能用提示文本测试代替。

## 候选文件与修改范围

新计划声明候选目录，执行与评分共用相同映射；Goal 的数据卷准备不再依赖 Comet 安装标记。

| 路径                     | 处理                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `/workspace`             | 当前任务的工作区                                                 |
| `/root`、`/app`、`/data` | 保留原有支持；原工作目录使用同一候选，避免重复复制一份无用工作区 |
| `/outputs`               | 原题公开材料引用时纳入候选，覆盖视频产物等任务                   |
| `/opt/syzkaller`         | 原题公开材料引用时纳入候选，覆盖对应源码输出                     |
| `/home/agent`            | 新计划保留 Agent 会话与工作文件                                  |
| 其他工作目录             | 保留明确的不支持判断；没有泛化成任意本机路径挂载                 |

候选目录缺失、受保护目录、越界或不安全链接不能静默变成空目录。产品快照和 trusted oracle 在 `/workspace` 及工作目录别名下均只读，避免通过 `/root` 等别名写入同一快照。

只把公开工作区复制前已经存在的控制器路径写入 Git 的本地 exclude；同名原题文件冲突会停止准备。路径清单写入元数据，策略进入执行身份。不会排除后续业务代码或 Native 正式文档。

WorkBuddy 的四道 testing 题和 repo_understanding 类型按 treatment 判断：Native 因正式流程文档与原题修改范围冲突而提前标为不支持；Goal 不再因 Native 专属原因被拒绝。没有修改原 grader、过滤评分中的业务差异或给题目加分。

## 资源、预算和评分条件

计划保留原预算，并绑定实际执行条件：

- **每题流程预算**：原 `agent.timeout_sec` 的四倍，最多 86400 秒。普通 Native、bugfree、Goal 使用相同公式。新计划的 Agent 循环不会再额外加 60 秒活动时间；停止和清理另行保留证据。
- **构建预算**：原 `environment.build_timeout_sec` 加 1200 秒，最多 86400 秒；为安装 Agent、Comet 和固定评分依赖保留明确的额外时间。普通非数据集任务的构建预算不变。
- **评分预算**：继续使用原题 verifier 时限，脚本和外层监督分别记录失败。
- **显式预算**：已有正数覆盖仍生效，报告同时保留计划条件与 `effective_agent_timeout_seconds`。Dashboard 的 `timeoutSeconds=0` 保留外层不设总截止时间的语义，不会取消新计划绑定的每题预算。
- **历史计划**：没有新执行策略的已保存计划保持原有行为，包括可能不限时；没有把新的预算追溯写入旧计划。正常公开 CLI 为新执行生成新计划。既有“不能被通用 900/1500 秒限时打断”的历史回归没有删除或缩窄。
- **CPU / 内存**：执行和评分都传递 Docker 参数。具体值进入计划与比较身份；未知执行字段、未支持的服务或隔离条件提前说明。
- **网络**：当前只支持 public。任务与模型 API 共用容器网络，不能忠实支持 no-network 的任务提前拒绝；没有为了让模型联网而悄悄放宽题目要求。
- **存储**：按候选普通文件大小监测，每两秒检查一次；不跟随符号链接，不计入构建上下文和 Comet 产品快照。超限停止本次执行并保留候选，读取失败明确报告。它不是镜像整个文件系统的内核 quota，存在检查间隔，计划和报告都注明这一差异。

Docker CPU / 内存参数的含义参考 [官方资源说明](https://docs.docker.com/engine/containers/resource_constraints/)。本实现没有把容器层 `storage-opt` 当成宿主绑定目录的配额。

SkillsBench 评分使用控制器提供的只读执行配置，传递公开 `verifier.env`。在隔离评分副本中处理 `cleanup_conftests`，清理可注入 Python 启动和 pytest 的文件；不删除主体候选。禁用 pytest 任意插件自动发现，允许评分镜像或评分时新安装、位于候选可写目录之外的 root-owned 插件，并记录声明插件是否缺失。评分时缓存放在新的评分目录，用户 site packages 不参与加载。对应约定参考 [BenchFlow hardening](https://github.com/benchflow-ai/benchflow/blob/main/docs/sandbox-hardening.md) 和 [pytest 插件说明](https://docs.pytest.org/en/stable/how-to/plugins.html)。这些来源用于核对机制，不代表已完成与某个 BenchFlow 发布版本的全量等价性验证。

## 原始分数与执行状态

保留原始 reward 和输出。SkillsBench 新增只读 pytest 观察器记录执行阶段，不改变测试断言、退出码或 reward。WorkBuddy 读取原 CompositeVerifier 返回的 judges 状态：执行正常且判定失败仍是有效业务失败；执行错误、超时和缺少记录另行标记。它不依赖 pytest，因此结构化报告题也不会因为没有 pytest 记录而被误判。原框架接口见 [固定版本的 registry](https://github.com/Tencent/workbuddy-bench/blob/625b2233093ae4f23e76be28c1f341d41cc70373/src/workbuddy_bench/judge/registry.py)。本地固定数据插件没有设置 custom_verify，repo_understanding 使用同一原引擎注册的规则。

| 状态                                   | 含义                                              |
| -------------------------------------- | ------------------------------------------------- |
| `completed`                            | 已观察到原评分判断正常完成并通过                  |
| `assertion_failed`                     | 已观察到原评分执行后的业务断言失败                |
| `collection_error`                     | 收集阶段未完成，原因需根据日志归因                |
| `test_error`                           | 初始化或执行出现错误，不能直接断言是基础设施原因  |
| `environment_error`                    | 声明插件缺失、pytest 内部或调用条件等明确执行问题 |
| `script_error`                         | 原脚本非零退出，未得到更精确的执行记录            |
| `not_executed` / `timeout` / `unknown` | 未执行、超时或执行阶段无法确认，均不伪装成通过    |

例如，原脚本可能把 pytest 收集错误写成 reward 0 后退出 0。现在仍保存这个 0，同时标记执行阶段。无法归因的结果保留在样本中，风险标记为 `flagged`，不把它删掉，也不把所有收集错误都归咎于环境。已确认的原题失败与 Native 流程完成继续独立呈现。

观察器未生效时写 unknown，不伪造测试计数。原始评分、流程结果、附加 rubric、样本质量是不同信息，不能互相替代。

## 用量与耗时

- `usage` 按调用相加；已识别 Claude 会话的 `modelUsage` 和费用按会话累计快照合并，再跨会话相加。相同 result ID 的重传只计一次。
- 计数回退和缺少会话身份会记录覆盖缺口，不强行解释成准确总量。明确使用 Claude、但累计费用缺少会话身份时，费用总计保持未知；计数回退只保留下界。其他 Agent 不直接套用 Claude 的累计规则。
- `total_tokens` 明确为主体调用，含缓存。`workflow_total_tokens` 在角色账目不全时保持未知，不把主体、子 Agent、累计 modelUsage 重复相加。
- 模拟用户的计量字段单独记录。没有将回答正文混入主体计量，也没有声称已完整计入所有独立 Verifier、子 Agent、压缩和 Judge 用量。
- 主体活动耗时、Agent 墙钟耗时和用例墙钟耗时分别呈现。Agent 墙钟包含模拟用户等待；用例墙钟再包含验证，不含共享镜像准备。费用明确为 CLI 估算，不是供应商账单。
- 缺失 efficiency 遥测为未知，不再填 0 得到满分。命令正则只表示需要审查的线索，不表示完整安全结论。
- 保存到 events、case report 和最终 summary 的字段一致，避免解析正确、报告汇总时又丢掉范围或原题结果。
- Summary 按数据集、treatment、category、task_type 和 modality 分组，区分执行样本数、题目数、评分已确认和未确认数。真实断言失败计入已确认均分；未确认项单列，逐题原始 reward 仍保留。没有元数据时写 unknown，不推测题型。静态支持数量不混入执行数量。
- 首轮/全部 Verify、检查命令及子 Agent 的独立耗时与角色用量仍受原始遥测覆盖限制。没有可靠记录的指标继续未知；本轮没有声称取得完整阶段账目。

## 验证模式与配对条件

公开 CLI 新增 `--verify-mode standard|bugfree`，仅用于内置数据集 Native。Goal 不接受 bugfree。静态查看示例：

```powershell
node bin/comet.js eval --dataset skillsbench --dataset-root <已存在的固定目录> --task <题目ID> --verify-mode bugfree --collect
```

`--collect` 不启动模型或容器。真正执行仍须用户另行明确要求。

模式在模型开始前通过公开 Native init 初始化到隔离项目配置；验收时通过真实 Runtime 读取 Run 输入核对。模式不符会保留原题得分并使对照不合格，不能通过运行中改配置补成正确样本。托管配置、进程参数和内容新鲜度检查均保留模式。

计划的 `contentHash` 包含模式；`comparisonHash` 只排除这个明确允许变化的维度，其余共同输入仍固定。新增 `adapterHash` 绑定原题装配、执行、观察和报告相关控制代码，启动和评分均核对。Native 模式对照还要求每题产品快照、实际镜像、CLI、模型配置和交互身份相同；缺失或不同均不能给有效配对结论。Goal/Native 对照保持其自身处理条件区别，不假装两组安装了相同产品。

## 回归登记

原有 291 项登记对象逐项保持不变；追加 10 项。追加前旧对象序列的 SHA-256 为 `69828c943bf9ba56eaa0d663f3be5029bf662adf3c6e68c9006c04b13d894274`。未删除历史 ID、修改历史映射或降低历史断言。

| Case ID                                 | 确定性覆盖                                 | 额外验收                           |
| --------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `eval-dataset-original-task-binding`    | 正文绑定、改题拒绝、原题提示与只读参数     | 模型遵循待验证                     |
| `eval-dataset-candidate-transfer`       | 两组映射、输出目录、保护路径与别名只读参数 | 真实容器待验证                     |
| `eval-dataset-session-cumulative-usage` | 会话累计、跨会话、重传、回退               | 已有原始日志可只读复算；不重跑模型 |
| `eval-dataset-tests-only-compatibility` | 按题型和 treatment 判断                    | 不冒充整题评分复现                 |
| `eval-dataset-new-plan-budgets`         | 新预算、无隐式活动宽限、历史兼容           | 不声称超时恢复的模型遵循已验证     |
| `eval-dataset-execution-policy`         | 资源配置与启动前拒绝                       | 真实容器待验证                     |
| `eval-dataset-verifier-phase-evidence`  | 真正运行临时 pytest、评分包装、保留原分    | 原题评分容器待验证                 |
| `eval-dataset-telemetry-scope`          | 缺失指标、独立模拟用户账目                 | 完整角色账目没有被假定存在         |
| `eval-dataset-candidate-storage-limit`  | 超限、保留现场、不重复计入工具输入         | 真实容器停止待验证                 |
| `eval-dataset-fixed-native-mode`        | 公开 CLI init、模式不符、计划与比较身份    | 真实模型配对待验证                 |

精确选择器见 [登记文件](D:/Project/Comet/config/workflow-regressions.json)。pending 项未标为 verified，不能用于完整发布放行。

## 实际验证

修复前已运行新增的最小红测：5 项 Python 用例和3项 TypeScript 用例失败，分别命中累计计数、候选目录、预算、缺失遥测、资源条件和修改范围支持性。随后完成实现并扩展定向回归。其余新用例验证当前行为，不把未执行的旧版本或整题容器复现写成已取得。

实际结果如下；多次定向执行有重叠，数量不相加：

| 检查                             | 实际结果                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8 个相关 Python 文件             | 245 passed、1 skipped；跳过项需要当前 Windows 环境未允许的文件符号链接                                                                                 |
| 最后评分状态、用量和分层报告改动 | `test_builtin_datasets.py` 与 `test_logging.py` 96 passed；最后费用身份与回退相关 56 passed，报告归一化与任务包装相关 110 passed，另有单项补充检查通过 |
| 8 个相关 Vitest 文件             | 首轮 143 passed、3 failed；新配对夹具字段修正后对应检查通过，剩余 2 项为 Windows `fs.symlinkSync` 的 EPERM，未删除或跳过其断言                         |
| 10 项新 badcase 的正式选择器     | 3 groups、26 executed tests 通过；最后扩展评分状态和分层报告后，重跑受影响的两个包装检查均通过，内部包含 20 项 Python 检查                             |
| 构建与 TypeScript                | `pnpm build` 通过；最终资源元数据判断修改后 `pnpm exec tsc` 通过                                                                                       |
| Lint 与格式                      | `pnpm lint` 通过：0 errors，8 项既有 Dashboard warnings；后续相关 ESLint、Ruff、Prettier 和差异空白检查通过                                            |
| 登记与生成契约                   | `pnpm check:badcase-registration --base 144880f53ae7b826d8d5b58997ac51ee6ace5f26` 通过；正式回归执行前的 Runtime schema 和各生成资产检查通过           |
| 发布包预览                       | `npm pack --dry-run --ignore-scripts --json` 通过，3652 个文件；确认观察器、适配器清单和编译后的数据集模块均在包内。没有安装或发布                     |
| 公开静态入口                     | 普通/bugfree 两个 `comet eval --collect` 计划均可由 Python 校验；common comparisonHash 相同，contentHash 不同，示例流程预算均为 240 秒                 |

两个 Vitest 环境阻塞项均在 `eval-run-store.test.ts`：`checks every path component once and never reuses a previous symlink check`、`rejects cross-run evidence through a report-file symlink`。另外运行不依赖产品代码的最小 Node 探针，也在创建文件符号链接时得到 EPERM。它们没有被记为通过；本轮没有修改 Windows 权限设置。

对本地固定全集只执行静态收集：WorkBuddy Native 为 **72/80**，拒绝四道 testing 和四道 repo_understanding；Goal 为 **80/80**，仅表示没有 Native 文档冲突及当前静态检查已通过，不表示已完成容器运行。WorkBuddy 的标准 `CompositeVerifier` import_path 与空 mcp_servers 列表允许通过；非空 MCP 服务和未知评分入口仍提前拒绝。

SkillsBench 为 **79/87**。未支持项为 `bike-rebalance`（no-network）以及工作目录暂不支持的 `fix-build-agentops`、`fix-build-google-auto`、`fix-druid-loophole-cve`、`fix-erlang-ssh-cve`、`flink-query`、`jpg-ocr-stat`、`lean4-proof`。这些是明确拒绝的接入条件，没有删题、放宽条件或把它们计作已执行。

只读复算上一轮两份 stdout，按会话消重后的 modelUsage token 分别为 bugfree **8,172,627**、普通 **30,073,883**；CLI 累计费用估算分别为 **6.784095**、**23.186995 USD**。主体调用 usage token 为 **7,574,120**、**25,934,603**，与 modelUsage 统计范围不同，不相加。两份计数均没有回退警告。读取原有评分记录后，两组仍是 **0.2143（3/14）**，原 judges 显示执行正常、业务断言失败；修复后的状态分类为 assertion_failed，没有改写原始结果。上述复算不是新的模型 Eval，也不能据此证明两种模式保持相同正确率。

没有运行仓库全量测试、真实平台 Hook、浏览器交互、真实模型或原题容器 Eval。模型能否遵循原题约束、真实容器资源与目录映射、原评分器观察及完整角色账目仍缺相应证据。用户本轮只要求修复，没有要求启动新 Eval，故未自动补跑。

## 版本与工作区

当前 package、本地 origin/master 引用和分支已有版本均为 0.5.2，上一个发布 tag 为 0.5.1；本轮没有 fetch。用户此前明确要求所有本轮内容归入 0.5.2。保持版本不变，按最终用户能力重写该版本已有的 benchmark Added 条目，没有新增开发过程流水账。

修改集中在 Eval CLI、数据集计划、scaffold、相关定向测试与回归登记。保留原有 Native bugfree、生成资产、文档和其他未提交工作；未编辑安装 Skill 副本或 website。
