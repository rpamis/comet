# Goal 单题真实运行验证

用户要求先保证 Goal 跑一次能跑通，再考虑批量评测。本轮使用公开 `comet eval` 入口，仅执行 WorkBuddy Code 的 `bug_fix-easy-a_crash_in_local`，Goal 组、1 题、1 次；没有额外重跑 Native 或 SkillsBench Goal。

## 结果

| 项目         | 实际结果                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 模型 / Agent | `glm-5.3-flash` / Claude Code `2.1.306`                                                                       |
| Run          | `comet-eval-140d2163-3753-4927-a57b-2ec284bc1f7b`                                                             |
| 原题评分     | **1.0，3/3 隐藏测试通过**                                                                                     |
| 执行结果     | Agent 与公开 CLI 均退出 0，检查 10/10 通过                                                                    |
| 时间         | 北京时间 2026-11-03 09:30:14 至 09:46:49；含首次镜像构建约 16 分 36 秒，Agent 阶段 600.3 秒                   |
| 完成方式     | 自然结束，总时长未设上限；外层交互 1 轮，无模拟用户调用                                                       |
| CLI 内部步骤 | 41 轮、44 次工具调用；与外层交互上限 40 的计数对象不同                                                        |
| 可观测 token | 非缓存输入 56,655、输出 20,108、缓存读取 1,257,024、缓存创建 0；合计 1,333,787                                |
| 费用         | CLI 显示 $1.414487，但 `modelUsage.glm-5.3-flash.costBasis` 为 `unknown`，不能视为实际 GLM 账单或批量预算依据 |
| 清理         | 执行状态 completed；受管进程清理 confirmed=true，无该 Run 容器残留                                            |

上述 token 来自 CLI 返回的可观测 usage；没有单独完整的 Goal 评估器计量账单，不将未知费用按零计。主模型与 Goal 评估模型均配置为同一 GLM 模型。

## 真实 Goal 与隔离证据

在运行容器中读取到 CLI 会话记录：`commandRun.command=goal`、`Goal set: ...` 和启用会话内 Stop hook 的消息，Agent 版本为 2.1.306。执行器原始日志记录 `native Goal command available and invoked`，结束时记录 `native Goal invocation ended`，未触发 Native 完成探针或阶段续行提示。

同一容器确认 `/opt/comet-current`、`/usr/local/bin/comet` 和 `/workspace/.claude/skills/comet-native` 均不存在。激活及隔离证据保存为 `.comet/eval/launches/2026-11-03-goal-workbuddy-single/goal-activation-proof.json`。

运行期间未修改评测源码，启动前登记的 14 个入口、适配器及脚本摘要在结束后全部一致。观察命令只读取状态，没有向模型反馈隐藏测试或评分结果。模型读取的原题 `environment/scorer.py` 是通用评分辅助程序；本题的隐藏测试仍在独立评分阶段注入。

## 产物与自测说明

候选在 `Local.__del__` 的完整迭代清理循环外捕获 `TypeError`，保留迭代中途异常之前已完成的逐对象清理，并新增局部回归测试。模型在允许联网的环境中核对了公开上游 asgiref 修复；这项条件应在后续对照中保持一致。

模型自测报告 `tests/test_local.py` 12 项通过；全套可见测试为 37 passed、2 failed，并报告在原始版本复现相同的两个 Python 3.12 异步兼容失败。这里保留其自测陈述，不把它写成仓库全套通过。与之独立的原题评分器实际执行 3 条隐藏测试，3 条全部通过，reward 为 1.0。

原始 summary、raw、events、reports 和候选位于对应 Run 目录；启动脚本、授权范围、摘要、构建日志与 token 原始字段位于 `.comet/eval/launches/2026-11-03-goal-workbuddy-single/`。`sample_quality` 为 included / valid_signal，但本题已参与调试，仅作为连通性和案例记录，不纳入后续盲测主表。

## 后续批量范围

静态目录检查：WorkBuddy Code 80 题中当前支持 76 题，SkillsBench 87 题中当前支持 80 题。根据已有领域和难度标签，使用固定种子 20261103 准备了 20 / 40 / 80 次完整任务执行的草案；均为单模型、Native 与 Goal 两组、每题一次，排除本题及 dialogue-parser 调试题。

草案保存在 `bulk-options-draft.json`，**尚未启动批量评测，等待用户确定题量**。没有根据本题 1.0 推断整个数据集成绩，亦未与先前执行器中途修改的 Native 记录构造正式胜率对比。

本轮没有产品代码修改、额外模型轮次、全量仓库测试或发布；website 引用未变，未提交或推送。
