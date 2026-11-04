# WorkBuddy / SkillsBench Eval 接入审查

日期：2026-11-04。工作区：`D:/Project/Comet`，分支 `052`，当前提交 `144880f53ae7b826d8d5b58997ac51ee6ace5f26`，结论以当前工作树为准。此次读取源码、固定数据集和已有结果，运行静态统计、临时确定性探针及相关 scaffold 测试；未启动模型、容器评估或重跑，没有改产品代码。

## 先说明结论边界

其他题目也会受到同一套接入逻辑影响，但不能据此说它们都会得到低分。需要区分三件事：原题实际失败、评估器没有正确交付候选或环境、Comet 采用了不同于原实验的处理条件。前者应保留低分；后两者要修接入或更正实验名称，不能直接改成通过。

这份审查静态盘点了 WorkBuddy Code v1.0 全部 80 题，以及 SkillsBench v1.1 全部 87 题的元数据和环境材料，细读下列代表题。没有逐题执行，也没有逐项审完所有公开规则与隐藏断言，更没有证明其余题已经可运行。除上一轮 pipeline 的两次已结束运行外，没有新增其他题的真实模型证据。

建议先修评估接入，再用修正后的条件研究 bugfree 是否保持正确率。当前低分要保留；不能通过降低原题要求、把隐藏断言塞进提示、排除真实失败来获得更好的结果。

## 固定来源与覆盖范围

Comet 内置目录将 SkillsBench 固定为 v1.1、87 题、提交 `b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af`，格式为 BenchFlow `task.md`。来源见 [builtin-datasets.ts](D:/Project/Comet/domains/eval/builtin-datasets.ts:12) 和 [dataset_fetch.py](D:/Project/Comet/eval/scaffold/python/dataset_fetch.py:22)。原始归档 SHA-256 为 `525bf1559a1eb3511ca2daaf2a307e2dd882efd646c130a730de0f9f37da34d7`。

正式缓存 `.comet/eval/cache/datasets/` 当前只有 WorkBuddy。本次实际读取的 SkillsBench 完整固定材料位于 `C:/Users/BENYM/AppData/Local/Temp/comet-skillsbench-v11-validation`，包含 87 个任务、`registry.json` 和来源回执 `dataset-source.json`。该回执记录上述提交与归档摘要；本次未重新下载或重新验证整包摘要，逐题材料也没有被当作官方“已通过”证明。已有 [catalog](D:/Project/Comet/.comet/eval/launches/2026-11-03-goal-workbuddy-single/skillsbench-catalog.json:14) 指向同一材料目录。

全部 87 题都有 `environment/skills/`，共找到 232 个一级 `SKILL.md`。分类如下，不能把 SkillsBench 整体当作代码修复题集：

| 官方 category                   | 题数 |
| ------------------------------- | ---: |
| software-engineering            |   16 |
| industrial-physical-systems     |   14 |
| office-white-collar             |   14 |
| natural-science                 |   14 |
| finance-economics               |    9 |
| mathematics-or-formal-reasoning |    8 |
| cybersecurity                   |    7 |
| media-content-production        |    5 |

统计直接解析各题 `task.md` YAML 和目录结构，没有运行评估。Comet 当前计划只保留 instruction、workdir、两种 timeout 和内容摘要，没有保留 category、task_type、modality、资源以及任务 Skill 条件；见 [builtin-datasets.ts](D:/Project/Comet/domains/eval/builtin-datasets.ts:150) 与 [任务计划输出](D:/Project/Comet/domains/eval/builtin-datasets.ts:191)。

仓库 `eval/local/tasks/comet-*` 中标注 adapted/inspired by skills-benchmarks 的本地题是另一个来源的改编题，不能计入此次 SkillsBench v1.1 87 题的覆盖率。

## 已确认的共享接入问题

### 1. 模拟用户缺少保护原题契约的明确限制

两种数据集统一配置 `auto_user`、最多 40 轮；模拟用户只收到“在原题范围内确认合理工作，不给解法或隐藏测试”等通用要求，原题正文原样交给 Agent。见 [builtin_datasets.py](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:334)。正文保留是正确的，但目前没有单独冻结输出路径、公开接口、必须保持的行为，也没有明确禁止模拟用户批准更改这些条件。这里确认的是提示与协议缺口；是否实际发生范围变更，仍须读每次轨迹，不能从低分反推。

修正要求：为固定题保存不可变题面与任务身份；模拟用户只能确认执行流程和题面允许的实现选择。题面要求的接口、功能、文件、格式、容差和约束不能在 Shape 中被删改。先阅读公开代码、README 和现有测试；公开材料不足时，模拟用户必须说明没有进一步的产品决定，不能猜一个行为再批准它。Agent 仍可在原题范围内推理和实现。明确违背原题的方案必须拒绝，不能用模拟批准使其合法化。

如果接入器实际批准了改题，保留原始轨迹、原题得分和失败，将该对照标为受接入干预影响，不用于证明正确率保持；不得删去这行结果。如果没有接入改题，只是 Agent 实现错误，仍是正常任务失败。Native 验收完成仍只说明完成了它批准的 Spec，原题评分必须独立保留。

数据集路径自带 simulator prompt，因此 [eval/simulator-instruction.md](D:/Project/Comet/eval/simulator-instruction.md:1) 中的 “Never refuse” 不是本次数据集的实际默认要求；只有显式覆盖等条件才可能采用该文件，见 [conftest.py](D:/Project/Comet/eval/local/tests/conftest.py:1495)。不能用未生效的提示解释上一轮失败。

这是 WorkBuddy 与 SkillsBench 共享的问题。对非代码题尤其不能把原有交付物换成一份设计说明或实现计划。

### 2. 候选持久化只覆盖固定目录，遗漏真实交付路径

Agent 执行与评分使用不同容器。准备阶段只从镜像导出 `/root`、`/app`、`/data`，另复制工作目录；见 [prepare_dataset_workspace](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:384)。Native 执行路径挂载 `/workspace` 和上述目录；见 [docker.sh](D:/Project/Comet/eval/scaffold/shell/docker.sh:697)。评分在新建容器中重新挂载同一候选目录与原始数据集，只额外挂载 `/root`、`/app`、`/data`；见 [dataset_mounts](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:221) 与 [评分容器参数](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:159)。没有看到执行结束后将其他目录复制回候选的路径。

因此，题目在 `/outputs` 或 `/opt/syzkaller` 产生的文件无法靠当前持久化路径交给评分容器。这是源码可确定的交付遗漏，尚未进行真实容器复现。不能把这类评分中的“文件不存在”直接归因于模型没做。

还有一个组间差异：`prepare_eval_runtime_data` 在没有 `_eval_current_comet` 或 `.include-current-comet-cli` 时直接返回，数据集目录挂载位于该判断之后，见 [docker.sh](D:/Project/Comet/eval/scaffold/shell/docker.sh:681)。Goal 特意没有这些 Comet 标记，见 [Goal 装配](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:276)、[快照条件](D:/Project/Comet/eval/local/tests/conftest.py:749) 和 [现有测试](D:/Project/Comet/eval/local/tests/scaffold/test_builtin_datasets.py:57)。因此 Goal 与 Native 不能只凭使用相同 Dockerfile 就认为候选映射相同。应把“数据集文件系统映射”从“Comet Runtime 数据卷”中拆开，并以确定性参数测试检查两组映射完全一致。

`/home/agent` 同样没有候选挂载，但当前统计不证明每题都要求此目录产物。装配统一将 `HOME` 改为该目录，也会影响依赖缓存、用户配置和旧镜像假设；应做环境兼容检查，不能把它自动解释为每题缺陷。

### 3. 元数据宣告的执行条件没有完整传递

TypeScript 仅读取工作目录、GPU、OS 和超时；支持性检查只有 Linux/无 GPU、四种工作目录、Alpine，以及 WorkBuddy 的一个排除类型。见 [builtin-datasets.ts](D:/Project/Comet/domains/eval/builtin-datasets.ts:150)。SkillsBench 全部 87 题都有 CPU、内存、存储、网络模式、构建时限和 verifier hardening；3 题还有 `verifier.env`。当前 Python 装配与 Docker 命令没有据此传递相应限制或环境，见 [装配](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:248)、[执行参数](D:/Project/Comet/eval/scaffold/shell/docker.sh:1080)、[评分参数](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:159)。

实际差异包括：`bike-rebalance` 声明 `no-network`；`parallel-tfidf-search` 声明 8 CPU；`fix-druid-loophole-cve` 声明 8 CPU、24576 MB 内存、3600 秒构建时限。统一无限制容器既可能放宽题目，也可能在本机资源不足时制造失败；不能假定影响总朝一个方向。构建脚本的实际时限也须与元数据逐项对应。

SkillsBench 当前评分直接复制 `/verifier` 并运行 `bash /verifier/test.sh`，没有加载 YAML 的 `verifier.env`、`pytest_plugins` 或 `hardening.cleanup_conftests`，见 [dataset_score.py](D:/Project/Comet/eval/scaffold/python/dataset_score.py:108)。其中部分原始脚本自己安装插件或配置隔离，必须逐题辨别；不能因为字段被忽略，就宣称全部 87 题测试被污染或一定跑不起来。

修正要求：计划显式记录、校验、传递支持的原始运行条件；无法等价支持的字段在启动前明确报 unsupported，而不是静默丢弃。保持 GPU/OS 等现有限制。增加包含未识别影响执行字段的负例，并保留原题内容摘要。

### 4. 续行累计用量被重复相加，统计范围也未统一

[logging.py](D:/Project/Comet/eval/scaffold/python/logging.py:186) 对每个 result 的 `modelUsage` 各数值相加，[同文件](D:/Project/Comet/eval/scaffold/python/logging.py:251) 也累加 `total_cost_usd`。但上一轮固定 Claude Code 2.1.306 的相同会话续行记录中，这两个字段是累计值。每次调用的 `usage` 与累计 `modelUsage` 不能采用同一种相加规则，也不能把此结论直接套到其他 Agent 或 CLI 版本。

直接调用现有 `extract_events` 的无模型探针，输入同一 session 的两次 result：单次 input 都是 10，而累计 model input 分别是 10 和 20。当前得到单次合计 20、累计合计 30；累计费用 0.1、0.2 被加成 0.3。这证实当前解析器不能正确处理这种遥测语义。

对上一轮原始 stdout 重新解析，结果如下。末次值是该会话 CLI 报告的累计数，不表示已核对供应商账单：

| 既有样本    | result 数 / session 数 | 当前解析的 modelUsage token | 末次累计 modelUsage token | 当前解析费用 / 末次累计费用（USD） |
| ----------- | ---------------------- | --------------------------: | ------------------------: | ---------------------------------: |
| bugfree     | 5 / 1                  |                  20,637,426 |                 8,172,627 |               19.276994 / 6.784095 |
| 普通 Native | 11 / 1                 |                 115,652,094 |                30,073,883 |              99.965518 / 23.186995 |

原始 run ID 分别为 `comet-eval-0b79117b-c27c-416a-b3c1-7303341e940b` 与 `comet-eval-86d8c381-c89e-47ac-9e2b-f7c0c8174840`。详细条件与第一轮 Verify 的独立观测见 [上一轮报告](D:/Project/Comet/docs/research/2026-11-04-native-bugfree-hard-eval.zh.md:1)。上表不修改既有文件，也不覆盖上一轮人工核对的指标。

其他范围缺口：

- `events.total_tokens` 从主体 result 的 `usage` 累加，没有单独汇总独立 Verifier / 其他子 Agent 的账目。不能把主体 token 标为整个工作流 token，也不能在累计 modelUsage 可能已含子会话时再重复加一次。
- [run-claude-loop.sh](D:/Project/Comet/eval/scaffold/shell/run-claude-loop.sh:246) 将模拟用户调用的完整原始返回放在局部变量，仅输出回答和有限 session 标识；不能从主体 stdout 得到完整模拟用户费用。Judge 是另一种角色，按启用状态单独列示。
- [logging.py](D:/Project/Comet/eval/scaffold/python/logging.py:333) 的 duration 是各次主体 result `duration_ms` 之和；[aligned_comparison.py](D:/Project/Comet/eval/scaffold/python/aligned_comparison.py:1293) 将它标成 `Wall duration`。它不包含调用间的模拟用户等待、镜像准备和评分，不能等同端到端耗时。
- [generic_rubric.py](D:/Project/Comet/eval/scaffold/python/validation/generic_rubric.py:120) 把缺失遥测当作 0；确定性探针中空 events 得到 efficiency 1.0。安全维度也仅匹配几个命令文本，不能当作完整安全审查。二者属于附加 rubric，不是原题 reward，见 [执行顺序](D:/Project/Comet/eval/local/tests/tasks/test_tasks.py:735)。

修正要求：按 Agent、CLI 版本和字段语义区分单次增量与会话累计量；累计量按 session/model/角色消重，再跨会话合计。必须保留无法归属的差额与覆盖率，不能强行凑齐。至少分别展示端到端时间、主体活动时间、Verify 活动时间、检查命令时间；token 分输入、输出、缓存读写、角色。费用注明 CLI 估算还是实际账单，未知时写未知。不能对所有 Agent 一律取最后一条，也不能把各阶段重叠时间相加为端到端时间。缺少必要遥测时该指标为未知，不给满分。

### 5. 数据集默认没有整个流程的截止时间

[conftest.py](D:/Project/Comet/eval/local/tests/conftest.py:1521) 在存在 dataset plan 且没有 `--agent-timeout` 时返回 `None`，取消整个 Agent 循环的时限；相应 pytest 超时也放开。现有 [确定性测试](D:/Project/Comet/eval/local/tests/scaffold/test_builtin_datasets.py:113) 明确要求这个行为，所以这不是本次偶发漏传参数。

原题 Agent 时限确实不能不加区分地充当整个多阶段 workflow 时限，但完全没有截止时间会使恢复循环持续消耗模型资源。40 次模拟交互也约束不了单次调用内部的长工具循环。

修正要求：计划在启动前固定原题预算和实际执行预算。严格原协议实验使用原预算；Comet 多阶段实验可以采用另行声明的有限预算，并明确标注偏离原协议。Native、bugfree、Goal 使用相同的可比较策略；分别限制整个样本、单次调用、构建和评分，并在无进展恢复达到已声明限制时停止、保存已有候选。超时保留为未完成/失败，不自动重跑或当通过。预算值必须进入计划与对照身份，不能运行中由 Agent 延长。本报告不替下一轮实验擅自设定数值，也不新增项目级 Native 快照预算。

## WorkBuddy：80 题的覆盖与兼容问题

固定材料为 `.comet/eval/cache/datasets/workbuddy-code`，Code v1.0 共 80 题。数据 revision 为 `3e8ad839685c589d83a1dd60fe2d15eabb75f27a`，归档回执 SHA-256 为 `f60394e44341f45f66af17ba69efc51ceadc61f17c08aa89e4af35b51f6f34e1`；评分框架另固定为 `625b2233093ae4f23e76be28c1f341d41cc70373`，两种 revision 不同，不能合并成一个身份。见 [官方框架](https://github.com/Tencent/workbuddy-bench/tree/625b2233093ae4f23e76be28c1f341d41cc70373) 与 [固定数据归档](https://huggingface.co/datasets/tencent/workbuddy-bench/resolve/3e8ad839685c589d83a1dd60fe2d15eabb75f27a/wb-bench-code-v1.0.tar.gz)。本次读取本地固定材料，未重新核验整包归档摘要。

元数据盘点结果：

| 项目                | 数量或条件                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| 难度                | hard 42、medium 31、easy 7                                                   |
| complexity          | L5 9、L4 40、L3 27、L2 4                                                     |
| instruction_clarity | medium 57、high 23；不是57题存在缺陷的证明                                   |
| verifier family     | script_verifier 54、pytest_injected 22、repo_understanding 4                 |
| 原始预算            | 全部 agent 1800秒、verifier 600秒、build 600秒                               |
| 原始资源            | 全部 2 CPU、4096MB 内存、10240MB 存储、public network、无GPU                 |
| 工作目录            | 全部 `/workspace`                                                            |
| 公开测试文件        | 按文件路径启发式扫描，38题有测试文件、42题未发现；未验证这些测试是否完整有效 |

不能把 L5 当作经过性能测量的唯一最难题；pipeline 属于9道 L5 之一。

### 4 道 testing 题与 Native 流程文档冲突

以下四题的 `tests/verifier.py:63` 读取整个 `git status --porcelain`，`:118` 要求有改动且每个路径都以 `tests/` 开头：

- `testing-hard-router_matching`
- `testing-medium-format_errors`
- `testing-medium-option_resolution`
- `testing-medium-request_builder`

题面确实要求只修改测试。Native 在仓库写入 `docs/comet/...` 后也会被评分器纳入改动，形成接入兼容冲突。当前 [支持性检查](D:/Project/Comet/domains/eval/builtin-datasets.ts:185) 只拒绝4道 repo_understanding 题，没有识别这4道 testing 题。

临时 Git 探针未运行原 verifier：只修改 `tests/test_case.py` 时状态为 `[' M tests/test_case.py']`，原谓词为 true；增加 `docs/comet/changes/probe/brief.md` 后状态增加 `?? docs/`，同一谓词变 false。这证明范围判定冲突，不等于完成整题评分复现。

近期应按 treatment 明确标记不支持，不能继续把它们当作 Native 已兼容的题。若未来实现流程文件与业务候选分离，必须显式声明为适配变体，保留控制文件清单与业务候选完整性；不能静默修改 Git 状态、过滤任意业务文件或改原 grader。现有 repo_understanding 拒绝逻辑也应按 treatment 判断：Native 的元数据冲突不能直接证明 Goal 同样不支持。

### 代表题：哪些是契约风险，哪些不需要改题

以下路径相对于本地固定材料的 `tasks/<id>/`；`environment/workspace.tar.gz!` 表示归档内公开文件，本次只读归档，没有解压到产品仓库。

| 题目                                          | 已核对证据                                                                                                                                                                                     | 应如何处理                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `reliability-hard-pipeline_reconnect`         | instruction.md:1要求区分安全/不安全重放并清理；公开README仅一句，原pipeline.py:23–29没有自动重连；隐藏verifier.py:64–84要求首次execute自动恢复，不能重放时抛WatchError                         | 上一轮真实轨迹批准了另一恢复API，两个样本都3/14。保留失败并标明契约偏移；不能由这个同分推断两种Verify正确率相同。 |
| `api_contract-hard-token_errors`              | instruction.md:1指向公开异常字段；公开tokens.py:17–36规定字段和继承关系，原消息为小写bad signature/expired；隐藏verifier.py:69、96额外查大写Signature及max_age文本，公开材料扫描未找到相应约定 | 登记公开契约不足风险，必要时向上游报告。当前不能断言评分错误，也不能把隐藏字符串注入模型提示。                    |
| `product_policy-medium-refund_policy`         | 虽instruction很短，公开README.md:4–8已列输出字段、14天、exports/API调用阈值及优先级                                                                                                            | 先读完整公开材料即可；不需要模拟用户重新决定政策。不能只看instruction给它贴模糊题标签。                           |
| `reliability-hard-ack_after_success`          | 题面明确成功后ack；隐藏verifier.py:63、67还要求重试耗尽原因和missing-handler处置，公开README/design较短                                                                                        | 核对现有API能否推出细节；列为待审风险，未跑模型，不能称已发生pipeline式失败。                                     |
| `repo_understanding-hard-interface_http_flow` | instruction.md:3–27只允许analysis.json；shared/verifier/rule.py:137–160限制其他Git改动                                                                                                         | 当前已被拒绝，列unsupported。不要计成模型失败，也不要声称当前可用。                                               |
| `feature_pipeline-hard-text_hashing`          | 公开app/text_features.py:16已有json.dumps(..., sort_keys=True)，既有CLI行为可满足该评分的键序要求                                                                                              | 排除“缺少排序契约”的初步猜测；应保持既有行为，不能为解释低分而扩大题目问题。                                      |

这些例子不支持“其他79题都一样失败”。它们支持先做逐题兼容清单，并对少数公开契约风险单独调查。WorkBuddy 未发现隐藏 tests 被直接交给主体的挂载路径；80题也没有识别到必须把结果写入 `/outputs` 或 `/home/agent` 的案例，因此不能将 SkillsBench 的目录问题直接算成 WorkBuddy 全集缺陷。

## SkillsBench 特有的实验条件

官方 v1.1 使用 task.md 包，领域 Skill 放在 `environment/skills/`，运行时通过 `--skill-mode with-skill --skills-dir ...` 注入，并提供 no-skill 对照；见固定提交的 [CONTRIBUTING](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/CONTRIBUTING.md#quick-start) 与 [environment 约定](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/CONTRIBUTING.md#environment)。

当前 Comet 只定义 Native / Claude Code Goal 两种 treatment；Native 强制 `comet-native`，Goal 不安装 Comet。装配删除常见领域 Skill 根，准备阶段删除环境副本中的 `skills/`，没有看到按原题注入 232 个领域 Skill 的路径；见 [builtin_datasets.py](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:271)、[处理条件](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:340)、[清理副本](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:404)。

所以现有实验应明确叫“使用 SkillsBench 固定题和原评分器的 Comet 自定义变体：不提供原题领域 Skill”。它可以研究该条件下的 workflow，但不能称为复现官方 with-skill，也不能从结果推断官方 Skill 的有效性。单独缺少领域 Skill 不会使全部题失效；no-skill 本来就是有意义的官方对照。

若比较 bugfree 与普通 Native，两组必须使用相同领域 Skill 条件、相同任务资源与候选交付。若要研究领域 Skill，另设 `with-skill` / `no-skill` 因素，不能把“Native 有 comet-native、Goal 无 Comet”当作官方领域 Skill 对照。对题面明确要求使用搜索 Skill 的任务，则应直接标明当前变体与原题冲突。

## 六个实际题例

下表中的“影响”是静态结论或风险范围，没有声称执行过这些题。

| 固定题                       | 原题与原验证要求                                                                                                                          | 当前接入影响及边界                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3d-scan-calc`               | 从二进制 STL 找最大连通体，提取材质，输出 `/root/mass_report.json`，误差不超过 0.1%；附带 `mesh-analysis` Skill                           | 是计算/提取题，不能替换成解析器设计。Native 的 `/root` 映射覆盖输出；无领域 Skill 可作为自定义 no-skill 条件，不因缺 Skill 自动判无效。                                 |
| `travel-planning`            | 7 日行程、三城、宠物住宿、5100 美元预算、禁飞；题面要求用 Skill 检索数据库；输出 `/app/output/itinerary.json` 并列调用工具                | 附带 6 个搜索 Skill，Dockerfile 只复制数据库，没有复制 Skill。当前不注入这些 Skill，与题面明确操作要求冲突；`comet-native` 不能代替数据检索。                           |
| `multilingual-video-dubbing` | `/outputs/tts_segments/seg_0.wav`、`/outputs/dubbed.mp4`、`/outputs/report.json`；检查响度、48 kHz 单声道、开始误差 10 ms、结尾漂移 0.2 s | 原 Dockerfile 创建 `/outputs` 并允许非 root 写入；当前候选与评分挂载均不保留该目录。文件在 Agent 容器中存在，也不能因此保证新评分容器看见。                             |
| `syzkaller-ppdev-syzlang`    | 新建 `/opt/syzkaller/sys/linux/dev_ppdev.txt` 与常量文件；Dockerfile 将该目录设为可写                                                     | 工作目录 `/root` 被支持性检查接受，但实际源码输出在 `/opt/syzkaller`，不在当前持久化范围。不能只按 WORKDIR 判断题目可支持。                                             |
| `fix-build-agentops`         | 在 `/home/github/build/failed/...` 修复并生成 patch；verifier 元数据必须传 `REPO_ID=AgentOps-AI/agentops`，测试显式断言变量存在           | 当前工作目录 `/home/github/build` 本来会被检查拒绝，因此不能把它当作已运行失败。未来若放开工作目录，必须同时支持该候选路径与 verifier.env；只放开目录白名单仍不够。     |
| `pdf-excel-diff`             | 对比旧 PDF 与当前 Excel，输出 `/root/diff_report.json`，保留数值类型、按员工 ID 排序                                                      | 输入/输出位于 Native 已映射的 `/root`，没有发现此题专属路径丢失。仍需要固定输出格式和原题验收，不应重新协商成分析报告。这是“共享问题存在，但并非每题均中招”的边界例子。 |

固定版本官方题源：[3D](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/3d-scan-calc/task.md)、[travel](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/travel-planning/task.md)、[video](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/multilingual-video-dubbing/task.md)、[syzkaller](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/syzkaller-ppdev-syzlang/task.md)、[AgentOps](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/fix-build-agentops/task.md)、[PDF/Excel](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/pdf-excel-diff/task.md)。

交叉核对的验证证据：[视频路径常量](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/multilingual-video-dubbing/verifier/test_outputs.py#L12-L14)、[视频环境](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/multilingual-video-dubbing/environment/Dockerfile)、[syzkaller 环境](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/syzkaller-ppdev-syzlang/environment/Dockerfile#L20-L33)、[AgentOps 环境断言](https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/tasks/fix-build-agentops/verifier/test_outputs.py#L54-L55)。上述源码从本地固定材料读取。

## 原始评分器：应保留的正确行为与尚缺的证据

当前原始 grader 没有被改写成 Comet 自己的业务评分。评分在候选副本中执行；数据集以只读目录挂载，按任务摘要防漂移；评分结果只接受有限数值，并保留小数。见 [候选隔离](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:107)、[输入身份](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:141)、[结果保存](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:192)。

SkillsBench 的 `/verifier` 绝对目录兼容问题已有修复与定向测试：`test_skillsbench_scoring_preserves_the_original_verifier_absolute_directory`，位于 [test_builtin_datasets.py](D:/Project/Comet/eval/local/tests/scaffold/test_builtin_datasets.py:278)。不能再把这个已修问题列为当前待修根因，也不能因此宣布所有 SkillsBench 评分环境完整兼容。

当前 Agent 可见的是 environment，oracle/verifier 没有被作为任务源码复制进去；评分时才挂载原数据集并复制 verifier，见 [环境复制](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:254)、[评分入口](D:/Project/Comet/eval/scaffold/python/dataset_score.py:102)。本次没有发现直接泄露答案的复制路径；仍应加执行/评分挂载参数负例，防止将整个任务包挂进 Agent 容器。

部分原始 `test.sh` 将 pytest 退出码统一写为 reward 0，再以进程 0 退出，例如 `3d-scan-calc`。因此“获得数值 0”仍不证明业务断言已执行：依赖安装失败、收集异常和断言失败要靠原始输出分开记录。Comet 当前保留截断 stdout/stderr，但没有把这些阶段明确结构化；见 [原始日志保存](D:/Project/Comet/eval/scaffold/python/builtin_datasets.py:194)。修正应保留原 reward，另外记录 verifier 的准备、收集、执行状态及测试计数，避免把环境错误当模型能力 0 分，也避免把真实断言失败剔除。

## 修正顺序与确定性验收

| 优先级 | 改动                                   | 无模型的完成条件                                                                                                                                                                               |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | 先保护原题契约，限制模拟用户批准范围   | 固定题面 hash 不变；脚本化批准/拒绝记录不能覆盖原题绑定；超范围决定不得被当作修改原题的授权，合法流程确认仍能推进。这验证记录和推进边界；真实模拟用户能否识别语义冲突，仍需获授权的模型 Eval。 |
| P0     | 统一两组候选映射，保留真实输出         | 用假的 Docker 命令捕获参数，确认 Native/Goal 同一题挂载相同数据目录；覆盖 `/root`、`/app`、`/outputs`、`/opt/syzkaller` 和未支持目录，支持不了必须在启动前说明；不能只放宽 workdir 白名单。    |
| P0     | 明确 experiment 的领域 Skill 条件      | plan/report 固定记录 no-skill/with-skill、Skill 内容 hash、workflow；两组除验证模式外相同。with-skill 必须完整注入原题目录，no-skill 不泄露该目录。现有实验按实际条件保留。                    |
| P0     | 修正累计 token/费用，明示统计范围      | 同session累计10→20得到20；独立session可相加；覆盖多model、重传、续行、累计重置、缺失session；CLI单次usage保持增量规则。角色汇总不重算子Agent，无法解释差额须保留。                             |
| P1     | 修正 WorkBuddy 修改范围兼容性          | 4道testing题和4道repo_understanding按treatment判断支持性；测试-only候选、额外控制文档、额外业务代码三个负/正例均覆盖，不改原评分器。                                                           |
| P1     | 给整个流程明确截止时间                 | dataset不再默认无限；原题与实际预算同时记录并绑定身份；Native/bugfree/Goal使用同一预算策略；超时/无进展保存候选并退出，不自动重跑。                                                            |
| P1     | 完整传递执行条件，严格判断支持性       | 解析资源/network/build timeout/verifier.env/hardening；用 `bike-rebalance`、`parallel-tfidf-search`、`fix-build-agentops` 等最小元数据 fixture 校验 Docker 参数或明确 unsupported。            |
| P1     | 分开原题评分、工作流完成和基础设施状态 | 依赖失败、pytest 收集异常、实际断言失败、fractional reward、缺 reward 各自有固定结果；全部保留原始 reward，环境失败不伪装模型低分。                                                            |
| P1     | 防止原题评分与答案泄露或候选被改写     | 执行容器看不到 oracle/verifier；评分可见只读原始包；grader 在候选副本执行，评分前后候选业务文件摘要相同；延续已有回归。                                                                        |
| P2     | 按实际任务分层抽样与展示               | 计划和报告保留 category、task_type、modality、资源；代码题、计算题、文档/媒体题分别统计。87 题静态可解析、supported 数量与模型运行数分别显示，不互相替代。                                     |
| P2     | 修正时间命名、缺失遥测和附加rubric展示 | 主体活动时间不能标端到端Wall；缺失efficiency不再满分；命令正则只称线索，不称完整安全证明；原题reward与附加weighted_score分开展示。                                                             |

可复用的确定性测试入口是 [eval/local/tests/scaffold/test_builtin_datasets.py](D:/Project/Comet/eval/local/tests/scaffold/test_builtin_datasets.py:1)、[test_logging.py](D:/Project/Comet/eval/local/tests/scaffold/test_logging.py:1)、[test_aligned_comparison.py](D:/Project/Comet/eval/local/tests/scaffold/test_aligned_comparison.py:1) 和 TypeScript 的数据集计划测试；现有候选隔离、小数 reward、输入漂移与 `/verifier` 测试应保留。

## 下一轮比较应满足的条件

当前数据集公开入口只区分 Native 与 Goal，没有正式的 bugfree 对照维度；上一轮靠隔离插件固定模式及额外观察器收集阶段账目。后续应通过受支持的公开入口在 Run 创建前固定验证模式，进入 plan、身份与报告；开始后读真实 Run 输入核对，禁止操作员运行中补配置。

在同一任务做普通 Native / bugfree 比较，至少满足以下条件才纳入配对统计：

1. 同一固定原题、公开输入和原评分器；只改变创建时的验证模式。产品快照、Agent/CLI版本、模型及子Agent模型、领域Skill、网络资源、预算、模拟回复策略均相同。身份校验允许的差异明确到验证模式字段，不能因产品hash相同就忽略运行配置差异。
2. 评估器能把所有候选产物交给评分器；样本若因目录、依赖或评分收集错误无法完成，列基础设施未完成，保留原reward与日志，不冒充已执行的业务断言失败。
3. 原题业务得分和Native流程结论分别给出。业务失败两组都保留，不能因为同分就证明正确率保持。既有低分不因整改而被改写，旧结果与后续新结果分别存档。
4. 首轮Verify、全部Verify和端到端分别统计；普通组独有的后续文档修改与恢复不能全部归因于验证模式。不能把较快失败当作有效的正确率与效率共同改进。
5. 题目先按静态兼容性和公开契约质量选择，再比较结果；不能看过低分后换一道题当作原实验。代码验证优化以代码题为主要结论范围，其他领域独立展示。难度标签只是选样依据，不能证明全局最难。
6. 题量、轮次、顺序/配对方式和成功标准在启动前写清。单题一对只能作个案观察；是否保持总体正确率，需要后续有足够样本的配对实验支持。本报告不声称已取得该证据。

已结束的模型运行保持原状。本次没有新的 Eval 启动授权，不执行修复后的模型重跑。用户后续明确要求启动时，只覆盖授权题目与轮次；修复没有影响的既有证据继续保留。

## 本次实际执行的检查与未执行项

从 `D:/Project/Comet/eval` 执行：

```powershell
uv run pytest local/tests/scaffold/test_builtin_datasets.py local/tests/scaffold/test_logging.py local/tests/scaffold/test_aligned_comparison.py -q
```

结果：**86 passed、1 skipped，8.99秒**。跳过的是 `test_duration_rejects_symlinked_raw_stdout`，当前 Windows 环境不能创建该测试所需文件符号链接。这些测试只说明现有受测契约仍成立，部分契约恰好包含当前待改的“无默认截止时间”；不能把测试通过解释为本报告问题已经修好。

另执行三个不调用模型/容器的临时探针：

- 用现有parser重现同session累计量10→20被加成30，并只读重算上一轮两份原始stdout。
- 调用现有 `dataset_mounts`：即便临时state下有outputs目录，返回仍仅含root/app/data；空events的efficiency当前为1.0。
- 在临时Git仓库复现测试文件与新增流程文档对原范围谓词的影响。

全部167题仅静态盘点，代表题细读，不是167题执行验收。未运行真实模型Eval、原题评分容器、真实平台Hook、全量测试或构建；本次只有研究文档修改，没有产品实现或新的回归测试。后续实现必须按各独立行为登记来源与回归，并取得对应执行边界证据，才能宣布修复。

报告本身执行了受影响文件的 Prettier 检查和新增文件差异空白检查；未发现该研究文档专属的额外契约测试。没有修改或格式化既有未提交文件，没有操作 website，没有提交、推送或创建 PR。
