# grill-test 完整任务评估

同一高难任务已完成：原始四个业务测试全部通过，原始测试文件未改，原 SDK 根 Run 与四个子 Run 均完成。grill 仍是会话和共同理解，没有要求或生成 brief。

目前可以确认这条组合在本用例上交付了与 Native 相同的业务结果；**现有证据不足以宣称已达到 Comet Native 级别**。首次 900 秒内未完成，后来扩大预算并恢复同一任务；模型、Runtime、控制器和预算也与 Native 历史样本不同。

## 候选与实际验证

真实 comet-any Creator 创建、编译并隔离安装 `grill-test@3`，固定包 hash 为 `5c95c6a0669eb7c85719f99338e7affe12a81fd4e71af28544c6384c059065f0`。原始 grill-me、grilling、to-spec、to-tickets、implement、tdd、code-review 和 setup Skill 内容固定且未修改；完整模型任务期间没有改动固定包。

grill 通过访谈确认理解；to-spec 生成七章节 Spec；to-tickets 生成 tracer-bullet 票据和依赖；implement 执行代码、TDD、评审和本地交付；机器 verify 实际运行原测试命令。应用索引和核对记录不能替代真实文件、测试或评审。

- Creator 必需验收：4 组正常样例通过，20 组缺失、空内容、篡改和异常被拒绝。
- 真实 CLI 协议 fixture：grill 无文件也能确认并进入 Spec；合法阶段写入允许，提前实现与 SDK 控制资源写入拒绝。
- 独立重新执行原命令 `python -m pytest test_pipeline.py -q`：4/4 通过；测试 SHA-256 与原始 Eval 用例一致。
- 额外完整业务测试：13/13 通过；9 个新增回归测试与 4 个原始测试一起执行。
- 新验证容器通过正式 Runtime 只读接口检查根与子 Run，全部 completed；没有手动改状态、伪造通过或替换原测试。
- 实际 Task/Agent 调用 3 次，事实调查与两个评审均有完成结果；两轴评审的开始/结束时间确认重叠。评审发现的逆序恢复测试缺口、返回列表可被外部修改等问题已修复，完整业务测试随后通过。
- 凭据仅放在进程/容器环境；最终产物另行进行凭据扫描。未修改产品源码、原始第三方 Skill、主仓库和网站的无关修改。

## 同一 Run 的完整过程

最初 Eval 任务预算 900 秒，外层执行限制 960 秒，到 Spec 时被终止。这个样本保留原 `excluded/runner_timeout` 结果，没有改成通过。

按用户要求扩大续跑预算到 7200 秒，沿原根 Run `d4903448-9787-40d1-91bc-0e0e8762b138` 完成后续工作。控制器恢复期间发现：验证容器未挂载 Runtime，以及 Docker 重挂载 Windows 目录导致设备标识变化。固定 checkout 挂载后，将同一份保存数据挂到容器当前 Runtime 路径，正式接口核对原 Run；没有改写审批、Action 或 checkpoint。中间因环境不可读而终止的尝试单独保留。

控制器也修正了 Markdown 加粗导致审批问题未被识别的情况。续跑 Spec 确认来自模型对实际 continuation 指令的解释；授权来源和真实宿主输入保存在独立结论中，不声称每次批准都来自模拟用户。用户此前已明确授权后续最优选择继续。

结束判断通过正式只读接口查询 SDK 根 Run completed，不套用 Native Archive 文案，也不让单个子流程的完成提前终止实验。早期强制 grill 产出 brief 的候选不符合原 Skill，相关运行只作诊断，未纳入此次候选结论。

最终 Runtime 状态：

- `grill-me`：`completed`，revision 6。
- `to-tickets`：`completed`，revision 6。
- `grill-test`：`completed`，revision 12。
- `implement`：`completed`，revision 3。
- `to-spec`：`completed`，revision 6。

## 与 Native 同任务历史结果对照

选择 `comet-graph-execution-review`，其 hard 用例同时覆盖 fan-out、review 暂停、同线程 resume 和 thread_id 隔离。Eval 没有唯一最难排序，因此不把它称为客观唯一最难。

| 样本                  | 模型              | 原始业务测试 | 最终结果       | 报告耗时秒 |
| --------------------- | ----------------- | ------------ | -------------- | ---------: |
| Native RC1 1          | DeepSeek v4 Flash | 4/4          | 完整通过       |      510.5 |
| Native RC1 2          | DeepSeek v4 Flash | 4/4          | 完整通过       |      549.6 |
| Native RC1 3          | DeepSeek v4 Flash | 4/4          | 完整通过       |      364.1 |
| grill-test 首次预算   | GLM 5.3 / 5.2     | 0/4          | 超时，到 Spec  |      900.9 |
| grill-test 同任务续跑 | GLM 5.3 / 5.2     | 4/4          | SDK 与业务完成 |     2341.5 |

Native 三份报告来自 2026-08-28 RC1，Claude Code 2.1.220、900 秒、auto_user 12 次。组合使用当前 0.5.0、GLM 和扩大后的预算。表中续跑耗时不包括第一次执行或控制器排障，不能把它与 Native 的单次耗时直接比较，也不能据此比较成本或稳定性。

组合两段主体报告耗时合计 3219.2 秒，报告 token 合计 4,936,396（含缓存）；不含中间环境故障尝试和控制器修复。续跑主体记录 87 轮、110 次工具调用。这些是实测记录，不能用不同模型的 token 数直接推算成本优劣。

## 判断与边界

组合能完成这一个任务，链路语义与真实业务结果已验证。它仍未在 Native 历史样本的 900 秒预算内完成，原始 grill 阶段也缺少要求的事实调查委派，后续才补上；审批来源和容器恢复需要额外人工核对。实现验证器只核对评审摘要非空，真实两轴评审须依靠宿主证据核实，不能仅凭 SDK succeeded 宣称完成。

执行与原文仍有差异：原始业务用例按红绿循环修复，新增边界测试在实现后补充；code-review 的两轴实际审查了固定基线至未提交工作树及新增文件，没有使用原文的三点 HEAD 比较，评审后再应用修正并提交。因此不能把业务通过等同所有原 Skill 细节都完全遵循。

本次是单任务的完整恢复实验，不是同条件 A/B，也不是完整应用模型验收。未执行同模型同预算 Native 重跑、正式 2–4 用例 application Eval、多次稳定性/拒绝恢复验证或真实 Codex Hook；未跑仓库全量测试，因为没有修改生产源码。当前结论是业务结果一致，Comet 级别的效率、稳定性与完整协议覆盖尚未建立证据。

入口：[SKILL.md](D:/Project/Comet/.comet/experiments/grill-test-final/exports/grill-test/SKILL.md)；[固定应用](D:/Project/Comet/.comet/experiments/grill-test-final/exports/grill-test/application.json)；[完整独立验收](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/continuation-recovered/independent-final-check.json)；[续跑 events](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/continuation-recovered/events.json)；[独立结论](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/independent-conclusion.json)；[Native 原始报告索引](D:/Project/Comet/.comet/experiments/grill-test-final/benchmark/native-baselines.json)。
