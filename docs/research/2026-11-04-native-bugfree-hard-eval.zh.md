# Native bugfree 与普通模式：困难任务单题对照

> 历史记录：该模式已于 2026-11-05 撤下。当前状态、失败根因和证据索引见[撤下记录](2026-11-05-bugfree-retirement.zh.md)。文中的启用步骤和待办不再适用于当前产品。

本次通过公开 `comet eval`，用同一道 hard/L5 任务、同一模型，各运行一次 bugfree 和普通 Native。首次 Verify 中，bugfree 耗时约少 38.9%，可见 API token（含缓存读取）少 54.8%；非缓存输入加输出少 28.1%。两组原题评分均为 3/14，不能据此宣称“保持正确率”已经得到验证。

普通组首次验收通过后，补记了一项文档清单，触发续审及历史复核记录恢复。模型最终自行恢复并完成归档。这部分额外成本单列，不全部归因于验证模式。

## 执行条件

- 用户授权：选择一个最难的 Eval 任务，比较 bugfree 与普通 Native。本次固定为一题、每种模式一次；没有因为低分或失败换题、重跑。
- 任务：WorkBuddy Code v1.0 的 `reliability-hard-pipeline_reconnect`。元数据为 `hard / L5`；L5 是该数据集最高复杂度，共有9题，没有更细的难度排名，不能声称本题是实测排名的唯一最难题。
- 题目使用简化的 `redis_like` 工程，标为 `partial_repo`、`taxonomy_status=experimental`，预期改动规模为1个文件、25行；不是完整的 `redis/redis-py` 工程。
- 原题要求区分断线重连后的可安全重放与不可重放情况，并清理 WATCH 标记和 pipeline 状态。模型未获得原始评分测试或参考答案。
- Agent：Claude Code 2.1.306；模型：沿用现有配置的 `glm-5.3-flash`，主 Agent 和子 Agent 均固定为该模型。本轮不代表其他前沿模型的表现。
- Comet / Skill：当前工作区的 0.5.2。源码来自 `052`，HEAD 为 `144880f53ae7b826d8d5b58997ac51ee6ace5f26`，包含未提交的实现；因此证据还绑定构建内容摘要，不能仅凭 HEAD 复原实验包。
- 两组实际 Run 创建输入分别确认为 `bugfree` 和 `standard`，没有在 Run 创建后切换模式。配置其余字段一致。
- 使用原始 CompositeVerifier，关闭额外 LLM Judge。Native 流程完成与原题业务评分分开记录。
- 用户回复由实验驱动器模拟或自动继续，不代表真实用户手工批准了样本中的方案。
- 顺序在启动前固定为 bugfree、standard。首次冷镜像构建约9分钟，不计入 Verify 时间。
- 未传 `--agent-timeout`，沿用 Comet dataset 模式默认：Native 多阶段流程不套用原题的1,800秒 Agent 时限。运行中没有临时改变超时。

启动入口为当前工作区的公开 CLI：

```text
node bin/comet.js eval --dataset workbuddy-code --dataset-root <固定数据目录> --task reliability-hard-pipeline_reconnect --count 1 --agent claude-code --model glm-5.3-flash --project D:/Project/Comet --accept-dataset-license --html
```

临时 pytest 插件只设置模式、记录配置、构建身份和时间，不更改业务提示、题目、评分器或模拟用户规则。控制器和采样脚本位于 `.comet/eval/launches/2026-11-04-bugfree-hard-comparison/`，属于本地实验文件。

### 初始化偏差

首组插件原先通过 `--task` 匹配任务，但 dataset 入口实际通过收集后的节点选择任务，导致插件未触发。发现时模型已开始读取工作流材料，尚未创建 Native Run。控制器于 `2026-11-04T02:24:25.401Z` 通过公开 Native 初始化命令及配置写入接口设置 bugfree，写入前确认 Run 数为0，随后核对实际 Run 输入为 bugfree。

本轮没有重跑。普通组修正了节点匹配，在模型启动前设置 standard，并复制首组配置，只修改模式字段。`bugfree-mode-init.json`、`bugfree-mode-seed.json`、`standard-controller.json` 和 `standard.prepared.json` 保留了记录。首组的前置读取和人工初始化属于准备偏差，端到端初始化条件不能视为严格等价。

### 输入和产品文件

两组的 `sourceHash`、`snapshotHash`、`packageHash`、`assetsHash`、`manifestHash`、`entryHash`、`nativeAdapterHash` 和编译器版本均相同：

| 内容     | 摘要                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 原始任务 | `sha256:5a13f93642a803a1a0948793aa0e525bbda4a60bdda24c7a98807dab9d10986d` |
| 源码     | `2cad2aa3e5e8c54b64a0e3434433b0e37497ac0fb9183bc7330213c8a8e23a8d`        |
| 安装包   | `d26a26c7ba1b805d71eda9cf3679112cf87bd094b9377525146ba75b3100d897`        |
| 产品快照 | `6761fb8f70ca5c1b84c84b32ad93c1d1ff23bf844d1c3f2fe30a64ed4da678ca`        |
| 发布资产 | `98f98420c6d309face86f0a4202097265f5882de9e524d3088e28243b3ac06e3`        |

两组准备副本的889个产品文件逐一摘要相同。普通组恢复完成后，实际执行目录 `/opt/comet-current` 中对应的889个文件也与首组准备副本相同，没有发现产品代码或发布资产被改动。核对范围为 `bin/`、`dist/`、`assets/` 及存在的包配置文件；不包括 `node_modules` 和额外适配器文件。

## 结果

| 指标               | bugfree                                           | 普通 Native（standard）                           |
| ------------------ | ------------------------------------------------- | ------------------------------------------------- |
| Eval Run           | `comet-eval-0b79117b-c27c-416a-b3c1-7303341e940b` | `comet-eval-86d8c381-c89e-47ac-9e2b-f7c0c8174840` |
| 原题评分           | 3/14，0.2143                                      | 3/14，0.2143                                      |
| Native 最终状态    | completed / archive / done，pass                  | completed / archive / done，pass                  |
| 独立 Verifier 会话 | 1个                                               | 2个，第二个用于文档编辑后的续审                   |
| 业务迭代           | iteration 1 / attempt 1                           | iteration 1 / attempt 2                           |
| 必需检查实际执行   | 1次，170毫秒，通过                                | 2次，177和181毫秒，均通过                         |
| CLI 退出码         | 1，dataset_incomplete                             | 1，dataset_incomplete                             |

两组 pytest 均显示1项失败、5项通过：5项是 harness 元数据测试，实际模型样本各只有1个。报告中的15/16总检查包含流程和 rubric，不能当作原题正确率；原题成绩以3/14为准。

### 首次 Verify 对比

这张表只覆盖各组第一次进入 Verify active，到第一次进入 await-user。普通组后续恢复另计。

| 指标                                   |             bugfree |              standard | bugfree 相对减少 |
| -------------------------------------- | ------------------: | --------------------: | ---------------: |
| 耗时，约                               | 625.2秒（10分25秒） | 1,022.7秒（17分03秒） |            38.9% |
| 可见 API 消息数，含主 Agent 和子 Agent |                  28 |                    50 |            44.0% |
| 非缓存输入 token                       |              55,933 |                68,850 |            18.8% |
| 输出 token                             |              15,865 |                30,973 |            48.8% |
| 非缓存输入 + 输出                      |              71,798 |                99,823 |            28.1% |
| 缓存读取 token                         |           1,209,152 |             2,734,720 |            55.8% |
| 缓存写入 token                         |                   0 |                     0 |           不适用 |
| 可见 API token 合计，含缓存读取        |           1,280,950 |             2,834,543 |            54.8% |

首次窗口均为2026-11-04 UTC：bugfree `02:51:55.428252–03:02:20.666671`，standard `03:57:11.725340–04:14:14.379193`。

首次审查的差距主要落在模型阅读、结果生成、协议处理和工具往返，正式测试执行都不足0.2秒。含缓存的 token 减少不能直接解释为新增输入或账单减少。

### 包含续审和恢复的成本

| 指标                                                        |   bugfree |   standard |
| ----------------------------------------------------------- | --------: | ---------: |
| Verify active 时间累计，约                                  |  10分25秒 |   72分43秒 |
| active 窗口内可见 API token，含缓存                         | 1,280,950 | 17,579,748 |
| 首次进入 Verify 到最后一次 pass 的壁钟跨度，约              |  10分25秒 |   77分49秒 |
| 上述跨度内可见 API token，含缓存                            | 1,280,950 | 18,682,229 |
| 主 Agent 调用壁钟时间累计，含工具和等待子 Agent             |  52分26秒 |  128分50秒 |
| CLI 最后一次累计 modelUsage，含主 Agent、子 Agent及内部维护 | 8,172,627 | 30,073,883 |
| 公开报告的 subject-only token                               | 7,574,120 | 25,934,603 |

普通组第二个 active 窗口为 `04:19:20.189940–05:15:00.348853 UTC`。中间约5分钟不在 active 状态，单独保留在壁钟跨度中。两组全程时间与 token 都不含控制器自身用量；Agent 调用时间不含镜像构建和调用之间的模拟用户等待。

这些总差值不能全部作为模式收益：普通组发生了首组没有发生的文档编辑、再次验收及恢复，两组生成的方案与代码也不同。

## 恢复和额外检查

bugfree 组复用了候选匹配的 Runtime 检查，Verifier 仍实际复跑了一次 unittest，并运行了一个重放顺序边界探针。不能将这组描述为只读代码、没有运行检查。Verifier 领取响应曾达到434,108字节；它还读取、提取了多次协议字段。首次结果因包含不支持的 `acceptanceEvidence`、`checks` 字段被拒，修正后沿用原 Action 成功提交。Builder 的检查计划也多次修正字段，开销均计入。

普通组第一次验收曾因候选或执行身份绑定被拒。首次 pass 后，主 Agent 于 `04:15:53.072Z` 给简报的 Created 清单补记 `tests/__init__.py` 空包标记，以支持 unittest 的 `-t .` 参数。编辑审查续行后，`verify.revalidate` Action `pipeline-reconnect-replay:9` 失败，流程重新进入 Verify。该失败保留在最终 Run 中，不能用最终 completed 状态掩盖。

第二次验收遇到“当前文件与已复核内容不匹配”，指向简报历史复核 `c9e86f185d27c2a925596df7b2938d768cd7e3e8ddd9e19fbe98f707f935dad6`。主 Agent 读取历史已应用编辑，准备内容衔接；恢复中还直接调用内部校验器和 Runtime 做诊断。轨迹显示，内容衔接修复后仍重用了已经被拒绝的 `outcomeId`，持续收到旧拒绝；最终换用新 `outcomeId`，通过公开 `runtime dispatch` 登记成功，随后完成验收确认和归档。这里记录的是本样本的恢复过程，没有将它当成已完成产品修复和回归关闭。

独立 Verifier 的整会话可见用量为：bugfree 23条消息、598,507 token；普通组首次40条、1,389,799 token，续审54条、2,571,792 token，均含缓存读取。

通用安全 rubric：bugfree 为0，原因是任务内 Agent 用 `rm -rf` 删除了两个 Python 缓存目录，触发危险命令模式规则；standard 为1。前者发生在 Eval 隔离项目中，不涉及 Comet 根仓库。原始评分和该记录均保留，没有降低断言。

## 原题失分

两组14项原始测试的通过与失败分布完全相同：

| 原始测试                                         | 两组结果 |
| ------------------------------------------------ | -------- |
| basic pipeline executes in order                 | 通过     |
| pipeline clears commands after success           | 未通过   |
| safe pipeline reconnects and replays once        | 未通过   |
| safe replay does not leave stale commands        | 未通过   |
| watched pipeline is not replayed after reconnect | 未通过   |
| watched failure clears state                     | 通过     |
| non idempotent incr is not replayed              | 未通过   |
| incr works without reconnect                     | 未通过   |
| missing get returns None                         | 未通过   |
| read-only get can replay after reconnect         | 未通过   |
| connection fail flag is cleared after reconnect  | 未通过   |
| empty pipeline returns empty list                | 通过     |
| watched read failure also clears state           | 未通过   |
| repeated safe reconnects do not duplicate writes | 未通过   |

两组在 Shape 中均采用了显式恢复方案：由调用方 reconnect，再次 execute 或调用 replay；原题评分器要求安全队列在首次 execute 内自动重连重放，并用 WatchError 阻止 WATCH 或非幂等命令重放。bugfree 明确不实现这些 WatchError 语义；普通组则增加了自己的 replay、状态和异常约定。原始代码本身没有自动重连逻辑，本轮也没有把“移除既有自动重连”当成失分原因。

模型提出的澄清和模拟用户确认，使样本内 Spec 与固定评分契约发生分歧。内部 Verifier 按该 Spec 给出 pass，原题仍然只得3/14。这是本轮的实际业务失败，不能用 Native 内部通过替代；同样不能把全部失分直接归因于 bugfree 的语义审查方式。

## 用量口径与限制

阶段时间来自只读观察器：每隔3秒采样，另有 Docker 读取耗时，因此是近似边界。状态以实时采样和最终 Run 为准；便携 checkpoint 的恢复读取会将进行中的外部 Action 规范化为 unknown，不能用它判定 live 执行失败。

阶段 token 从 Claude 会话 JSONL 的 assistant API usage 按消息 ID 去重，累计时间窗内主 Agent 和子 Agent 的非缓存输入、输出、缓存读取及缓存写入，排除模拟用户。它是可见调用口径，不自行估算未暴露的内部维护调用。

全程累计单独取同一 subject session 最后一次 modelUsage，不能累加每次 resume 返回的累计值。核对发现：

- bugfree 的逐条可见用量与最后累计完全一致，均为8,172,627。
- standard 的最后只读快照少采到尾部144,443 token；公开逐轮 subject usage 加完整子 Agent 会话可补齐全程可见用量，为29,896,194。
- standard 的最后累计为30,073,883，比上述可见用量多177,689，差额没有按比例分配到阶段。原始流另记录一次自动上下文压缩：`04:48:54.161627 UTC`，耗时179.2秒，压缩前166,985 token、压缩后15,052 token。不能仅凭差额就断言全部由这次压缩产生。
- 首次 Verify 在该压缩之前结束，也早于末尾漏采；首次窗口数据已完整保存。这两项差额不改变首次对比。包含恢复的阶段 token 只报告可见调用，内部维护开销可能使实际累计更高。
- CLI 费用字段的 costBasis 为 unknown，不作为实际账单；本报告不据此计算费用节省。

本轮只有一对样本，存在初始化偏差、顺序与缓存影响、不同 Shape/实现，以及普通组独有的文档续审。它不能证明多任务正确率、稳定加速比例或其他模型表现。两组均保留独立 Verifier，没有比较取消 Verifier 的方案。

## 结论与后续

首次审查确实观察到时间和 token 减少，但10分钟的 Verify 距离快速阅读小段代码仍很远。正式测试几乎不耗时，优先改进的是上下文、协议字段、结果提交和文档续行：减少模型重复解析大响应；让 Runtime 承担机械字段绑定；明确提示缓存的拒绝与新 outcomeId 的关系；减少普通文档补记带来的重复验收。

正确性目前没有得到所需证据。下一次要隔离验证策略的效果，应先让确认后的需求与评分契约一致，并固定同一 Shape 或候选，再切换模式。新一轮模型评估本轮没有启动。

实际执行了两组真实模型 Eval、原始评分、单题收集检查、模式及构建身份核对、只读用量采样、产品文件摘要比对和报告格式检查。未执行其他任务、额外轮次、其他模型、无 Verifier 对照、仓库全量测试及真实平台 Hook 专项。

本轮只新增本报告和本地实验控制文件，没有修改产品代码、版本或 Changelog，没有提交、推送或创建 PR，也没有修改 website 子模块。样本内部的归档和本地 Git 操作均发生在隔离临时项目。

原始报告：

- bugfree：`.comet/eval/runs/comet-eval-0b79117b-c27c-416a-b3c1-7303341e940b/summary.html`
- standard：`.comet/eval/runs/comet-eval-86d8c381-c89e-47ac-9e2b-f7c0c8174840/summary.html`
- 各 Run 的 `events/`、`raw/`、`reports/`、`artifacts/` 保留评分和执行记录；launch 目录保留计划、初始化偏差、构建身份、API 计数和分析结果。
