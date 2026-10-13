# comet-any 的任务结果与调用轨迹分析

产物来源补充：本次组合由我作为 Creator 宿主 Agent 创作并多轮修订，运行还包含控制器修复和额外续跑提醒。下述肯定结论限于这个经过修订与辅助的成功产物，不能作为未经干预的一次生成测试。详见[产物来源与干预审计](D:/Project/Comet/.comet/experiments/grill-test-final/provenance-audit.md)。

按“真正解决任务、调用轨迹合理、验收有实际证据”衡量，本次结果支持肯定判断：**comet-any 已能产出具备 Comet 核心工作流能力的组合 Skill，grill-test 在这个用例上达标。** 单个经过修订的成功用例，不等于已经证明所有目标都能一次生成、稳定运行或全面等同 Native。

模型和预算不同，不妨碍判断实际代码是否解决问题、轨迹是否形成闭环。本次不以耗时或 token 数否定业务能力，也不据此判断效率和成本。

## 业务问题确实解决

重新阅读最终代码、原始测试、九个新增回归测试与独立验收记录，四项原始要求都有直接对应的实现：

| 原问题                 | 最终实现                                                                           | 实际证据                           |
| ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| 只处理部分任务         | 遍历完整 task_list，不再截取第一项                                                 | 原始 fan-out 测试通过              |
| 审核前直接输出 summary | 有任务且需要审核时先保存结果，返回 waiting_for_review 和中断信息，暂不输出 summary | 原始审核暂停测试通过               |
| resume 丢失或重做任务  | 按 thread_id 读取已保存结果，保留状态并转为 approved                               | 原始同线程恢复测试通过             |
| 不同线程状态混淆       | 每个线程独立保存和查找状态                                                         | 原始线程隔离测试与逆序恢复回归通过 |

原始测试文件字节未改，公开函数名称、参数和默认值未改；独立验证为原始 4/4、全部业务测试 13/13。评审还促成返回结果列表的隔离，新增测试证明调用方修改返回值不会污染后续恢复结果。业务源码由执行 Agent 修改；控制器没有补写业务实现。

固定执行端口没有嵌入本题的 pipeline 修复答案：它接收 goal、acceptance 和 testCommand，检查阶段产物并执行输入中的测试命令。实际业务实现来自 Skill 链路中的 Agent，这比只通过一个写死答案的演示更能支持“能够产出工作流 Skill”的判断；其他任务的效果仍需实测。

本轮只复核现存证据、当前文件摘要、公开函数签名以及与隔离提交的内容一致性，没有重新执行模型 Eval。此前独立验收的产物摘要与原始测试摘要目前仍匹配。

## 调用轨迹总体合理

| 阶段          | 实际行为                                                                            | 判断                      |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------- |
| grill         | 实际加载 grilling，访谈八个行为决定，确认共同理解；没有 brief                       | 保留了会话型 Skill 的职责 |
| to-spec       | 读取固定原文，形成七章节 Spec，承接同一会话和 AC-1 至 AC-4                          | 需求能够传入后续工作      |
| to-tickets    | 读取固定原文，生成四张票据；按 01 → 02 → 03 → 04 记录依赖及验收覆盖                 | 切片可追溯，适合逐项验证  |
| implement     | 领取实现 Action 后修改代码，实际加载 tdd，执行原始测试的红绿循环                    | 工作范围和测试与需求一致  |
| code-review   | 实际加载 Skill，两个独立 Agent 并行审查 Standards / Spec，产生发现并推动修复        | 评审对最终结果有实际作用  |
| verify / 交付 | 通过机器端口执行固定测试命令，完成原根 Run 与四个子 Run；本地提交后由独立控制器复验 | 已形成可核对的交付闭环    |

grill-me、to-spec、to-tickets、implement 原文声明 disable-model-invocation，组合按其已声明的适配方式读取当前固定包的原文。grilling、tdd、code-review 则有真实 Skill 工具调用。不能只统计 Skill 工具调用次数，就把手动调用型依赖判为漏执行。

SDK 并非只保存一个完成字符串：阶段有 Action 领取、结果、产物和 Wait；下游沿同一根 Run 推进。最终根 Run completed，四个子 Run completed，verify Action succeeded。真实机器执行与独立原始测试验证互相支持。

续跑中的三次 Agent 调用均 completed：事实调查，以及两轴评审。Standards 评审 08:59:04–09:00:21 UTC，Spec 评审 08:59:11–09:01:30 UTC，时间重叠，确认实际并行。Spec 发现逆序恢复测试缺口及返回列表共享的风险；后续代码和测试体现了对应修正。

## 仍有差距，但不推翻本用例的成功

- grill 原文要求委派环境事实，首次访谈由主 Agent 自行调查，直到票据阶段才补做事实子 Agent。额外边界测试在实现后补充；评审使用基线至未提交工作树及新增文件，随后修正并提交，没有原样使用三点 HEAD 比较。这些影响严格遵循原 Skill 的判断，不改变实际测试和评审已发生的事实。
- 用户已经授权后续最优选择继续，后续 Wait 决定有既有授权基础；不能声称每个 Wait 都收到了一次新的模拟用户答复。授权来源仍主要保存在会话，应该让组合的审批记录更明确地关联授权与提案。
- 首次查询和领取未创建的子 Run 发生错误，Agent 通过 parent next 自行恢复。多次 inspect、claim、next 增加了执行负担；应让生成入口清楚返回可执行的下一步与已创建的子 Run，减少猜测。
- 固定包声明了质量步骤，但实现验证器只检查 reviewSummary 非空。本次真实双轴评审由轨迹证明，不能把该验证器当成对所有未来运行都强制完成双轴评审的保证。最终机器步骤执行原始四个测试，13 个完整业务测试和独立复验还依赖宿主与评估控制器。
- Runtime 挂载、Windows 设备标识、问题检测和结束条件由实验控制器修复。这些是环境与评估集成问题；控制器没有替 Agent 写业务代码，也没有手改 SDK 成功状态。完整的自动运行体验仍需要覆盖这些边界。
- 最终候选经过多轮 Agent 修订和用户对 grill 职责的纠正。真实 Creator 编译、必需验收和安装已完成，说明它能承载这样的 Skill；本次不能推断一次自然语言输入就有同样的成功率。

## 对 comet-any 的判断

**可以产出达到本次 Comet 核心要求的 Skill。** 证据包括同一任务的实际解决、需求到实现的合理传递、SDK 推进、真实双轴评审及修复、机器验收和可复验产物。生成结果具有可执行的流程、规则和执行端口。

**尚未证明可以稳定、普遍地产出与 Native 全面等同的 Skill。** 进一步验证应优先测功能与协议失败路径：缺失评审证据、验收失败打回、上游产物变化、审批与提案不匹配、执行中断恢复，以及新的业务任务。不同模型或预算的性能比较不是这项能力判断的前置条件。

原始证据：[完整独立验收](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/continuation-recovered/independent-final-check.json)、[首次事件](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/logs/experiments/grill-test-faithful-graph-one-shot-20261013/events/comet_graph_execution_review_DYNAMIC_SKILL_r1_rep1.json)、[续跑事件](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/continuation-recovered/events.json)、[固定 Skill](D:/Project/Comet/.comet/experiments/grill-test-final/exports/grill-test/SKILL.md)、[固定执行端口](D:/Project/Comet/.comet/experiments/grill-test-final/exports/grill-test/bindings.mjs)、[原完整报告](D:/Project/Comet/.comet/experiments/grill-test-final/report.md)。
