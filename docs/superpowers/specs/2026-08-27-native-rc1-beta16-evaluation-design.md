# Native rc1 与 beta16 对齐评测设计

## 目标

重新运行 `0.4.0-rc.1` Native 与 `0.4.0-beta.16` Native 的对齐基线，沿用既有
`comet-native-vs-040-experiment` 的 16 个 canonical Comet 业务任务和每任务 3 次重复，
并发布一篇中英文对比文章及可切换语言的 HTML 报告。

## 版本与实验边界

- rc1 版本固定为当前 `040rc1` checkout 的 `0.4.0-rc.1`，使用当前仓库 Native Skill、
  Runtime 和本地评测器。
- beta16 版本固定为 Git tag `0.4.0-beta.16`，使用该 tag 的 Native Skill、Runtime、
  评测器和 validator；不把当前 rc1 的生成资产复制回 beta16 运行环境。
- 两侧都运行以下 16 个任务，每个任务重复 3 次，共 48 次运行；两侧合计 96 次：
  `agent-memory-routing`、`api-cache-ttl`、`cross-file-refactor`、
  `dependency-confusion`、`fix-median`、`framework-selection`、`full-workflow`、
  `graph-execution-review`、`human-approval-flow`、`layered-streaming-fix`、
  `noise-distractor`、`observability-env-template`、`perf-dedupe`、
  `persistence-threading`、`refactor-counter`、`robust-config`。
- 任务 prompt、业务环境和重复次数保持一致；workflow 检查遵循各版本实际 Native
  契约。比较按 `task + repetition` 对齐，同时记录 runner、model、Docker、Skill 和
  validator 身份；若这些身份不一致，不宣称为完全受控的同协议因果实验。
- 原始实验日志留在本地评测输出目录，不作为网站源码提交；网站只提交可审计的实验 ID、
  汇总数字、失败归因、限制说明和脱敏的 HTML 报告。

## 产物设计

- 中文文章：`website/zh/eval/comet-native-vs-rc1-beta16-experiment.mdx`。
- 英文文章：`website/en/eval/comet-native-vs-rc1-beta16-experiment.mdx`。
- 报告资源：`website/assets/eval-reports/comet-native-vs-rc1-beta16-20260827/`，包含
  `native-benchmark-report.json`、中文 HTML、英文 HTML 和独立 HTML 预览。
- MDX 与 HTML 复用历史文章的章节顺序和视觉结构：实验对齐、核心数据、pass@k、完成任务
  效率、修正耗时、任务级稳定性矩阵、失败归因、Judge/数据质量边界和结论。
- 文章先写中文，再同步英文；两种语言必须使用同一批原始统计和相同的限制说明。

## 数据分析口径

- `strict pass@1` 使用每次运行最终 workflow 与业务验证共同通过的状态。
- `pass@3` 表示每个任务的 3 次运行中至少成功一次；`pass^3` 表示 3 次全部成功。
- 效率只统计两侧同一任务与重复序号都完成且具备原始 telemetry 的样本；累计模型耗时累加
  每次运行的所有顶层 `result.duration_ms`，不把 Docker 准备和业务 validator 时间计入。
- 失败归因区分 harness、workflow、task 和 model；环境噪声进入数据质量说明，不静默从
  48 个预期样本中删除。
- HTML 中的所有 headline、图表、稳定性矩阵和失败摘要直接来自同一份分析结果，避免手工
  维护两套数字。

## 验收标准

1. rc1 与 beta16 两侧各自存在完整的 16 × 3 expected case matrix，或对缺失运行明确报告
   缺失 coverage，不把较小样本写成完整 pass@3。
2. 报告能够追溯到两个实验 ID、版本/tag、模型/agent、运行日期和实际 validator 协议。
3. 中英文 MDX、导航入口和 HTML 报告都使用同一组统计；HTML 可在浏览器中独立打开并切换
   中文/英文。
4. 报告不把不同 Runtime/validator 的结果包装成完全受控的同协议因果结论，并保留真实
   失败与环境限制。
5. 相关网站内容检查、Prettier、`git diff --check` 和报告资源完整性检查通过；父仓库只
   更新本次 website gitlink，已有无关工作区改动保持原状。
