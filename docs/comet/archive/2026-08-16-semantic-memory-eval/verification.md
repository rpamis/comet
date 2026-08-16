---
generated_from_state_version: 11
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-08-16T17:59:14.038Z
- 摘要: 指定 Vitest 1/1 通过，pnpm lint:architecture 通过；现有 Runtime check 全部 passed，JSON/Markdown runner 现场验证通过，A1-A21 无剩余验收缺口。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | specs/semantic-memory-eval/spec.md | Eval 必须提供固定的 case 数据集，至少覆盖 `zh-CN` 与 `en`、Native 与 Classic、`full`/`hotfix`/`tweak`。每个 case 必须声明项目身份、workflow、语言、稳定检查点、输入证据、已有记忆、期望 action、期望持久化差异和后续检索任务。数据集不得包含真实凭据、PII、完整对话或隐藏推理。 | 15 个固定 case 覆盖中英文、Native/Classic 及 full/hotfix/tweak，并输出完整脱敏元数据。 |
| A2 | passed | specs/semantic-memory-eval/spec.md | **当** case 在干净临时 memory root 中重复运行 | 每个 case 使用独立临时 memory root，重复运行报告完全相等。 |
| A3 | passed | specs/semantic-memory-eval/spec.md | **那么** action、状态摘要、检索结果和评分结果稳定 | action、持久化状态摘要、检索摘要、失败分类和评分结果均稳定。 |
| A4 | passed | specs/semantic-memory-eval/spec.md | **并且** 不依赖网络、系统 locale、当前时间或宿主模型随机性 | 固定 now，无网络或模型调用，结果不依赖 locale、当前时间或随机输出。 |
| A5 | passed | specs/semantic-memory-eval/spec.md | 评估器必须提供旧 command-summary 观察基线和当前语义记忆实现的并行结果。报告必须区分：流水账/噪声记录、长期可复用记忆、skip、危险内容拒绝、作用域错误、语言错误、重复计数和后续任务收益。不能用“某个文件存在”代替质量评分。 | 报告并列输出 command-summary-v0 基线与语义实现结果，并提供噪声、记录、作用域、语言和下游指标。 |
| A6 | passed | specs/semantic-memory-eval/spec.md | **当**输入是一次性要求、命令成功、测试数量、Change/PR/Issue 摘要或仓库可轻易重查的事实 | 覆盖一次性请求、命令、测试、Change、PR、Issue、日志、diff 和注入内容。 |
| A7 | passed | specs/semantic-memory-eval/spec.md | **那么**语义实现返回 `skip` 或不改变记忆状态 | 非可复用内容均返回 skip，状态保持无 active record。 |
| A8 | passed | specs/semantic-memory-eval/spec.md | **并且**基线产生的命令流水账必须在报告中标记为噪声 | 基线记录明确标记为 noiseRecords。 |
| A9 | passed | specs/semantic-memory-eval/spec.md | 评估必须验证：一次隐式行为第一次只形成候选；同一项目两个独立成功 Change 的一致证据才能激活 project 记忆；无跨项目证据时不能自动激活 global；同一 Change 的恢复、重试和重复 candidateKey 不增加独立计数；不同 candidateKey 可以并列存在。 | 覆盖首次候选、项目稳定激活、跨项目 global 激活、重试及 candidateKey 幂等。 |
| A10 | passed | specs/semantic-memory-eval/spec.md | **当** 一个 Change 提交两个不同 candidateKey | 同一 Change 的不同 candidateKey 保持并列，观察数量验证为 3。 |
| A11 | passed | specs/semantic-memory-eval/spec.md | **那么** 两个候选互不覆盖 | 不同候选不互相覆盖，候选 case 的 activeRecordCount 为 0。 |
| A12 | passed | specs/semantic-memory-eval/spec.md | **并且**重复提交同一 candidateKey 只更新幂等状态 | 重复 candidateKey 返回 deduplicated，失败后重试不增加独立观察计数。 |
| A13 | passed | specs/semantic-memory-eval/spec.md | 评估必须覆盖 secret、PII、prompt injection、原始日志、完整 diff 的拒绝；错误语言自动内容的拒绝；显式记忆与隐式证据冲突时的保护；纠正、遗忘和回滚后的状态及检索行为。危险内容落盘、显式记忆被隐式覆盖、错误作用域或语言违约均为硬失败。 | secret、PII、prompt injection、日志、diff、错误语言、冲突、纠正、遗忘和回滚均有断言，危险内容未落盘。 |
| A14 | passed | specs/semantic-memory-eval/spec.md | **当**查询与现有记忆无关 | 无关 deploy 查询在已有 build 记忆时正确 abstain。 |
| A15 | passed | specs/semantic-memory-eval/spec.md | **那么**检索结果不注入无关历史 | 无关检索返回空记录，不注入历史记忆。 |
| A16 | passed | specs/semantic-memory-eval/spec.md | **并且**评估报告标记为正确 abstain | abstain case 明确记录 abstainCorrect=true。 |
| A17 | passed | specs/semantic-memory-eval/spec.md | 对至少一组可复现的后续任务，评估必须比较无记忆、command-summary 基线和语义记忆三种条件。结果至少记录：是否选用了正确偏好/工作习惯、是否产生错误建议、是否需要用户纠正、上下文长度和最终任务动作。记忆质量不能只以召回条数衡量。 | 下游结果记录无记忆、command-summary 基线和语义记忆三种动作、错误建议、用户纠正、上下文长度及最终动作。 |
| A18 | passed | specs/semantic-memory-eval/spec.md | Runner 必须输出稳定 JSON，并可生成简短 Markdown 汇总。每个失败属于以下一种或多种：contract、quality、language、scope、idempotency、security、conflict、retrieval、downstream-impact、harness。报告不得输出真实用户私密输入或内部 Runtime 文件全文。 | JSON runner 和 --markdown runner 均现场执行成功，输出稳定且无敏感内容；失败分类集合符合规范。 |
| A19 | passed | specs/semantic-memory-eval/spec.md | Eval 使用真实生产 service/plugin API，不复制或绕过核心合并、候选和校验逻辑。 | 直接使用生产 PersonalMemoryService、FileMemoryRepository 及其 observe/retrieve/manage/sync API，未复制核心逻辑。 |
| A20 | passed | specs/semantic-memory-eval/spec.md | 数据集和 runner 放在现有 `eval/` 允许的目录边界；不得新增未登记顶层目录。 | 实现位于现有 domains/eval、scripts/benchmark 和 test/domains/eval 边界，架构 lint 通过。 |
| A21 | passed | specs/semantic-memory-eval/spec.md | Eval 失败不能修改用户级记忆或项目仓库文件。 | 所有 case 使用临时目录并在 finally 清理，Git 工作树未因本轮验证新增或修改文件。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| semantic memory eval and related regressions | vitest run test/domains/eval/semantic-memory-eval.test.ts test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/review-contract.test.ts test/domains/comet-plugin/plugin-integration.test.ts | . | passed | 0 | 5615 ms |
| production build and generated runner | build | . | passed | 0 | 33502 ms |
| JSON eval runner | scripts/benchmark/semantic-memory-eval.mjs | . | passed | 0 | 284 ms |
| Markdown eval runner | scripts/benchmark/semantic-memory-eval.mjs --markdown | . | passed | 0 | 265 ms |
| TypeScript compilation | exec tsc --noEmit | . | passed | 0 | 6926 ms |
| targeted lint | eslint domains/eval/semantic-memory-eval.ts domains/eval/index.ts test/domains/eval/semantic-memory-eval.test.ts | . | passed | 0 | 2260 ms |
| targeted formatting | prettier --check domains/eval/semantic-memory-eval.ts domains/eval/index.ts test/domains/eval/semantic-memory-eval.test.ts scripts/benchmark/semantic-memory-eval.mjs | . | passed | 0 | 1519 ms |
| architecture lint | run lint:architecture | . | passed | 0 | 882 ms |
| diff check | diff --check | . | passed | 0 | 186 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 下游三条件执行器是本地确定性执行器，不代表真实模型运行行为；父 Change 仍需按既定 Runtime 限制执行最终全量集成验证。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A3, A5, A6, A9, A13, A17, A18 | 定向测试通过，但 A1、A3、A5、A6、A9、A13、A17、A18 存在规格或评估有效性缺口，退回 Build 修正。 | 2026-08-16T17:45:32.050Z |
| 1 | 2 | 1 | pass | — | 指定 Vitest 1/1 通过，pnpm lint:architecture 通过；现有 Runtime check 全部 passed，JSON/Markdown runner 现场验证通过，A1-A21 无剩余验收缺口。 | 2026-08-16T17:59:14.038Z |



## 结论

指定 Vitest 1/1 通过，pnpm lint:architecture 通过；现有 Runtime check 全部 passed，JSON/Markdown runner 现场验证通过，A1-A21 无剩余验收缺口。
