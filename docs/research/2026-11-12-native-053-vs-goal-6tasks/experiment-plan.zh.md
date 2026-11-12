# Native 0.5.3 与 Goal：六题分层选样

用户在 2026-11-12 明确缩减为两个内置数据集各低、中、高难度 1 题。每题每组 3 次；Native 0.5.3 与无 Comet 的 Claude Code 原生 Goal 各 18 次，共 36 次真实模型样本。旧 16 题准备停止，不沿用其 96 次预算。

| 数据集              | 低 / easy                            | 中 / medium                              | 高 / hard                             |
| ------------------- | ------------------------------------ | ---------------------------------------- | ------------------------------------- |
| WorkBuddy Code v1.0 | feature-easy-lru_caching_to_tzoffset | data_reporting-medium-audit_event_export | product_analytics-hard-day7_retention |
| SkillsBench v1.1    | court-form-filling                   | manufacturing-codebook-normalization     | paratransit-routing                   |

难度来自原数据集标注。选题在取得任何真实模型输出之前固定，兼顾已准备的环境。结果不佳不换题，不自动增加真实模型轮次。

## 执行

直接调用公开内置 `comet eval --dataset ... --task ... --dataset-treatment native|goal --count 3 --agent claude-code --model deepseek-flash[1M]`。保留原题、模型与评分预算、数据集版本和评分器；不另建评分脚本。用户随后要求取消固定构建总时限，本轮后续启动设置 `COMET_EVAL_BUILD_TIMEOUT_SECONDS=0`；不改写原始任务预算，已进入模型的 Goal 结果继续保留。两组均不额外注入领域 Skills。

模型与路由见 `model-config.json`。主模型为 `deepseek-flash[1M]`，两组 Haiku 路由统一到主模型，其余路由相同。Claude Code 固定 2.1.318，模型容器 Node 固定 22.23.5；关闭可选 LLM Judge。凭据仅在内存与进程环境中使用。

每个数据集 / 执行方式最多 1 个 worker，总模型并发上限 4。先运行镜像已就绪的题目；SkillsBench 因原题镜像使用不同普通用户 UID，按相同 UID 分批调用同一公开命令。控制器与对应模型用户 UID 一致，避免 root 创建的私有工作区无法读取；模型始终使用镜像原有非 root 用户。不会放宽目录权限、修改 Windows 安全设置或全局网络规则。

两组的原题内容、评分器和模型配置分别核对一致。模型耗时不含镜像准备与退出后评分；不同时间开始的任务保留实际调度记录，不把环境准备速度计入模型效率。

## 指标

原题 reward 为 1.0 才记为完整成功，部分 reward 原样保留。每数据集每组有 3 题 / 9 次：pass@1 为 9 次的完整成功率；pass@3 为每题 3 次至少 1 次成功的题目比例；pass^3 为 3 次均成功的题目比例。Native 流程完成与原题成功单列。

缺失、评分错误或未启动模型的环境失败记为未知，保留固定分母与上下界，不能当作模型答错。有效低分必须保留。两个数据集分别报告；此六题小样本不代表完整官方榜单。

Token 和费用仅报告可观测遥测；CLI 估价不是 DeepSeek 账单。效率同时展示全部尝试与双方成功配对，不只挑选有利样本。

## 已撤销的旧范围与环境记录

旧 16 题的准备记录保留在 `../2026-11-12-native-053-vs-goal/`。Windows 的两次启动均未产生模型输出；Linux 下时区缓存题两组各 3 次也因 root / 非 root 工作区权限不匹配在读取提示文件前失败，6 份 stdout 均为空，未调用模型。原始报告中评分器对未修改的候选给出 0 分，这些不是有效模型成绩；保留 Run 与原因，不并入本次 36 次结果。

本次按用户新授权，删除六题不需要的实验镜像、停止的临时 seed 容器与未使用构建缓存；保留六题需要的镜像、运行记录、数据集、数据卷和其他项目镜像。没有修改 Native / Goal 核心 Runtime、版本号、官网或原题评分规则。后续发现并修复内置 Eval 工作区镜像构建未读取原题预算的问题，见 `build-budget-reproduction.zh.md`。
