# SkillsBench 与 WorkBuddy 各一道题的真实模型评测

用户明确要求环境修复后两套数据集各运行一次题目。本轮只执行以下矩阵，不自动重跑或扩展任务。使用公开 `node bin/comet.js eval` 入口，当前未提交候选的 Native，Agent 为 Claude Code 2.1.306，模型为 `glm-5.3-flash`。

| 数据集              | 题目                            | 次数 | Run                                               |
| ------------------- | ------------------------------- | ---- | ------------------------------------------------- |
| SkillsBench v1.1    | `dialogue-parser`               | 1    | `comet-eval-d7704c55-8b48-440b-acf7-0d8339def7c4` |
| WorkBuddy Code v1.0 | `bug_fix-easy-a_crash_in_local` | 1    | `comet-eval-b581b9ba-3e1d-421b-b94c-a77df93db1aa` |

每个 Run 的 `expected-case-matrix.json` 均只有对应题目、`COMET_NATIVE_SDK_CURRENT` 和 rep 1。沿用前次题目，原始数据源目录保持不变，不注入领域 Skills。配置 `--agent-timeout=900 --max-turns=12`，循环执行器另加 60 秒结束宽限，实际终止阈值为 960 秒；交互次数不代表题目重复次数。关闭额外 LLM Judge，保留原题评分与 Native 流程检查。

启动器和原始终端日志位于 `.comet/eval/launches/2026-11-02-native-benchmark-full-single/`。凭据只注入子进程环境，不写入启动器或报告。此轮继续到评分或明确失败，和前次“收到首个模型响应就停止”的运行分别记录。

## WorkBuddy：执行超时，评分器报错

北京时间 22:46:53 开始、23:05:07 结束，终端记录 `1 failed, 5 passed in 1095.68s`，CLI 退出 1。基础镜像复用，候选 CLI 镜像 Build `e5mpm8mbma8jwcz62kdr38psl` 用时 3.6 秒成功。模型确实调用了 `comet-native`，生成了 `local-del-robust-cleanup` 的 Shape 方案；只读观测阶段仍为 Shape/active，最终没有 Native Archive。

原题没有有效分数：`dataset_verifier_error` 显示 `docker start -a comet-eval-score-f53bab9bcdbecf1af354fc9d` 退出 1。当前适配器只保存异常字符串，没有保留该评分容器的详细 stderr，容器已按 finally 清理，因此这条记录不能给出底层根因，也不能将评分异常当作原题 reward 0。

执行器 stderr 保存 `Timeout after 960s`；第二轮交互未完成。报告为 `sample_quality.status=excluded`、`reason_code=runner_timeout`、`include_in_analysis=false`。汇总的 12/16 检查通过包含 Skill、隔离与 Rubric，不等于任务正确率。4 项失败分别为评分器异常、缺少终态 Native Archive、portable state 不可用、Agent 退出 124。

事件汇总只计入一个完整主体调用：868 秒、45 个 Agent turn、50 次工具调用、总 tokens 1,267,985（包括缓存计量），不能当作整个超时运行的完整消耗。原始 stderr 中的 `unrecognized_model` 是 Claude Code 识别自定义模型名称的诊断；本次有实际模型响应，不能将它解释为 API 调用被拒绝。

Run `execution-state.json` 为 completed，`process-cleanup.json` 为 confirmed true；模型执行及评分容器已结束。未追加重跑。评分器异常仍待排查，环境准备走通不能证明评分链路完整通过。

## SkillsBench：原始 reward 0，执行超时

北京时间 22:46:53 开始、23:11:52 结束，终端记录 `1 failed, 5 passed in 1500.92s`，CLI 退出 1。修复后的基础镜像 Build `73svvnzfn1re4g7kld8ek337g` 用时 6 分 37 秒成功，其中 Agent 原生包安装与版本检查通过；候选 CLI 覆盖层 Build `qqmde0vijd8ladnsi7y4mkxbr` 用时 3.3 秒成功。

模型调用了 `comet-native`，创建 `dialogue-parser` change。执行器识别了第一次 Shape 决策点并产生模拟用户回复，第二轮进入 Build，有实际文件修改与命令执行；到 960 秒时仍未完成，stderr 保存 `Timeout after 960s`。报告为 `excluded/runner_timeout`、`include_in_analysis=false`，没有终态 Native Archive。

原始评分脚本成功返回 `reward=0`，事件中 `dataset_result` 保存了任务、来源版本、内容摘要和原始 `0\n`。这是未完成候选的实际评分，不能抹去或改为通过；但本次运行因超时被排除，不能作为完整标准条件下的能力结论。13/17 检查通过包含数值 Rubric；其中“dataset-score: 0.0”列在评分检查中不表示题目通过。4 项失败为原题未完整成功、没有 Native Archive、portable state 不可用和 Agent 退出 124。

汇总只计入一个完整主体调用：428 秒、29 个 Agent turn、51 次工具调用、总 tokens 920,356（包括缓存计量）；第二次调用被中断，因此这些计数不是整个运行的完整用量。

Run `execution-state.json` 为 completed、`process-cleanup.json` 为 confirmed true，最终没有本轮 Eval 容器残留；没有重跑。

## 结论与边界

| 数据集      | 原始评分                 | Native 完成    | 样本质量                  | 本轮结论               |
| ----------- | ------------------------ | -------------- | ------------------------- | ---------------------- |
| SkillsBench | 0.0                      | 未完成 Archive | excluded / runner_timeout | 未通过                 |
| WorkBuddy   | 无有效分数，评分器退出 1 | 未完成 Archive | excluded / runner_timeout | 未通过，另有评分器问题 |

两套模型入口、Agent 安装和基础运行环境均已走通，评分链路并非全部通过。WorkBuddy 本轮统一覆盖为 900 秒，低于其原题 1800 秒；SkillsBench 原题为 900 秒。这是两道题各一次的有限时运行，不能作为官方榜单复现或两数据集能力比较。

WorkBuddy 首轮明确输出 Shape 待确认摘要，而循环驱动记录 `no decision point and not complete; nudging to continue`，决策点计数为 0；这是值得排查的交互识别线索，尚未复现为独立缺陷或确定根因。SkillsBench 的模拟确认和 Build 推进有实际记录。当前未修改这些行为，也未修复或重试 WorkBuddy 评分器。

HTML 与原始报告分别保存在两个 Run 的 `summary.html`、`summary.md`、`reports/`、`events/` 和 `raw/` 中。`execution-state=completed` 表示 Run 执行结束，不表示评测通过。

本轮只新增这份验证记录和被忽略的启动日志，没有修改产品源码、Changelog、版本或 website 子模块；未提交或推送。没有运行全量单元测试、平台 Hook 或额外模型 Eval。文档格式与工作区差异检查单独执行，结果不替代上述真实模型结果。
