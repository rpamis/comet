---
generated_from_state_version: 23
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-11T14:04:25.905Z
- 摘要: 当前候选可接受，A1-A15 全部 passed，未发现实现缺口。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | specs/spec-capability-evolution/spec.md | 不同 change 关联同一能力 - **GIVEN** 已归档的登录能力和后续短信登录需求 - **WHEN** 后续 change 明确关联该能力 - **THEN** 两个 change 保留各自迭代记录，并指向同一个总 Spec - **AND** change 名称变化不自动新建或重命名能力。 | 稳定 capability 与 change 解耦，支持跨 change 关联。 |
| A2 | passed | specs/spec-capability-evolution/spec.md | 新增行为保留已有能力 - **GIVEN** 总 Spec 包含密码登录 - **WHEN** 后续 change 仅新增短信登录并完成验证归档 - **THEN** 总 Spec 同时保留密码登录和短信登录 - **AND** change 中能够追溯本次新增内容。 | 新增 delta 合并后保留既有完整 Spec。 |
| A3 | passed | specs/spec-capability-evolution/spec.md | 精确修改删除和重命名 - **GIVEN** 总 Spec 中具有稳定身份的多个需求 - **WHEN** 增量明确修改、删除或重命名其中指定需求 - **THEN** 只有指定对象发生对应变化，其余内容保留 - **AND** 重命名保留可追溯关系，不以删除再新增掩盖身份变化。 | add、modify、remove、rename 均按稳定 requirement ID 精确处理。 |
| A4 | passed | specs/spec-capability-evolution/spec.md | 拒绝无效增量 - **GIVEN** 增量包含不存在的目标、重复身份、冲突操作或歧义引用 - **WHEN** Runtime 校验或预览该增量 - **THEN** 返回可定位到操作和目标的错误，不修改总 Spec，不把增量误当完整文本发布。 | 无效目标、重复及冲突操作可定位拒绝。 |
| A5 | passed | specs/spec-capability-evolution/spec.md | 基线变化后自动合并互不影响的增量 - **GIVEN** 两个 change 基于同一能力版本启动，其中一个先归档，双方增量互不影响 - **WHEN** 后一个 change 请求归档 - **THEN** 检测最新基线变化，保留先归档结果 - **AND** 自动在最新基线上应用后一个增量，展示更新后的目标结果并重新验证，通过后才允许归档，不能用旧结果直接发布。 | 独立变更可在最新基线上重基并重新验证。 |
| A6 | passed | specs/spec-capability-evolution/spec.md | 冲突或影响不明时暂停自动合并 - **GIVEN** 并发增量修改同一需求、存在删除/重命名或共享约束冲突，或无法可靠判断影响 - **WHEN** Runtime 检测到归档基线变化 - **THEN** 保留双方内容并指出需要解决的对象与原因，不自动覆盖任一方 - **AND** 解决方案改变用户目标或实施范围时重新进入 Shape，其他情况重新验证。 | 重叠、删除、重命名及影响不明时阻止自动覆盖。 |
| A7 | passed | specs/spec-capability-evolution/spec.md | 预览与确认发布一致 - **GIVEN** 增量、基线和验收结果均已确定 - **WHEN** 执行归档预览及后续确认 - **THEN** 预览展示操作和完整目标变化，确认仅应用已检查的内容 - **AND** 两步之间输入变化会使旧预览失效。 | Archive preview 使用 expected/result hash，输入变化使预览失效。 |
| A8 | passed | specs/spec-capability-evolution/spec.md | 归档中断后恢复 - **GIVEN** 涉及多个能力的归档在发布过程中中断 - **WHEN** Runtime 恢复归档 - **THEN** 恢复到一致可解释的完成或待处理状态，不重复应用增量，不丢失未涉及的需求 - **AND** 总 Spec、迭代轨迹与归档状态保持一致。 | 事务恢复具备一致性和幂等性，不重复应用。 |
| A9 | passed | specs/spec-capability-evolution/spec.md | 历史能力不会重复成为实施任务 - **GIVEN** 已有密码登录，新 change 增加短信登录 - **WHEN** 生成实施和验收范围 - **THEN** 实施任务仅覆盖短信登录及明确需要的兼容调整 - **AND** 受影响的密码登录行为可进入回归检查，但不会被声明为尚未实现。 | 历史需求仅进入回归范围，不重复生成实施任务。 |
| A10 | passed | specs/spec-capability-evolution/spec.md | 自动关联草案可查看和撤销 - **GIVEN** 用户未指定能力，召回并核对后只有一个高置信有效候选 - **WHEN** Agent 准备 Shape - **THEN** 自动建立关联草案，说明能力、来源与匹配原因，纳入最终确认 - **AND** 用户可撤销或改选，撤销不会改变总 Spec，也不会遗留旧候选的实施任务。 | 高置信关联生成可见草案，删除 capability-association.yaml 可撤销。 |
| A11 | passed | specs/spec-capability-evolution/spec.md | 明确能力与歧义候选 - **GIVEN** 新需求显式指定能力，或召回得到多个可能能力 - **WHEN** Shape 确定关联 - **THEN** 显式标识先经过真实路径和工作流校验；多个候选展示差异并由用户选择 - **AND** 单一低置信候选也不强行关联，用户可以拒绝所有候选并明确创建新能力，无匹配结果不会伪造关联。 | 显式能力走真实路径校验，多候选或低置信时不强行关联。 |
| A12 | passed | specs/spec-capability-evolution/spec.md | 召回旧记录后核对最新规格 - **GIVEN** 索引引用旧版本或已删除、重命名的能力 - **WHEN** Agent 准备采用候选 - **THEN** 核对当前总 Spec，失效候选不作为有效基线 - **AND** 历史 change 只提供来源，不替代当前能力事实。 | 历史候选会核对当前 Spec，失效记录不作为基线。 |
| A13 | passed | specs/spec-capability-evolution/spec.md | Classic 保持现有归档语义 - **GIVEN** Classic change 关联已有 Classic 能力 - **WHEN** 完成增量归档 - **THEN** 继续使用现有 OpenSpec 合并机制 - **AND** Native 同名能力不会被交叉写入，新增关联体验不改变 Classic 状态机。 | Classic 继续使用 OpenSpec 归档，Native 与 Classic 能力不交叉写入。 |
| A14 | passed | specs/spec-capability-evolution/spec.md | 检索成本有界且可降级 - **GIVEN** 大量历史 change、可用或不可用的项目知识索引 - **WHEN** 创建 change、发现能力并重复读取工作流状态 - **THEN** 首屏候选不超过 5 个、正文按需且受既有预算约束，普通状态查询不触发全量历史扫描，相同输入与来源不触发重复召回 - **AND** 检索失败提供可解释的显式定位方式，不把失败当作不存在历史能力。 | 候选、读取、缓存和 Provider 降级均有界。 |
| A15 | passed | specs/spec-capability-evolution/spec.md | 旧 Native 规格与归档保持可读 - **GIVEN** 升级前的整份目标 Spec、活跃 change 和已归档记录 - **WHEN** 升级后恢复或查看历史 - **THEN** 旧格式按原语义读取，不把完整文本误当增量，不重编号历史验收 - **AND** 采用新格式时显式建立基线和标识，不批量重写历史归档。 | 旧 full Spec、旧 journal 保持兼容，新协议显式绑定基线。 |

## 检查

_没有记录 Runtime 检查。_

## 阻塞项

_无。_

## 风险与跳过的工作

- pnpm check:generated 仍受未修改的 assets/skills/comet/scripts/comet-hook-router.mjs 陈旧限制；Native 与 Classic bundle build 及 --check 已通过。
- 未进行真实宿主 Hook 或真实模型 Eval；结论基于当前源码、专项测试、跨域回归和独立验收证据。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | execution-error | — | 独立 Verifier 在正式派发后连续等待超过 6 分钟仍未返回结果，未产生可接受的逐项验收报告；本次 attempt 按协议视为执行超时，不代表实现失败。 | 2026-09-11T13:25:25.279Z |
| 1 | 1 | 2 | recovery | — | 补充 Archive dry-run 对旧事务缺少目标绑定时的安全重验证提示 | 2026-09-11T13:28:45.525Z |
| 1 | 2 | 1 | execution-error | — | 独立 Verifier 未完成完整核对便被中止，未形成可接受的逐项验收结果；本次 attempt 按协议视为执行错误，不代表实现失败。 | 2026-09-11T13:43:05.508Z |
| 1 | 2 | 2 | execution-error | — | 正式独立 Verifier 在派发后等待 10 分钟仍未返回逐项结果，按协议视为执行错误；不代表实现失败。 | 2026-09-11T13:54:06.530Z |
| 1 | 2 | 3 | recovery | — | Native Shape artifacts changed | 2026-09-11T13:57:53.272Z |
| 2 | 1 | 1 | pass | — | 当前候选可接受，A1-A15 全部 passed，未发现实现缺口。 | 2026-09-11T14:04:25.905Z |



## 结论

当前候选可接受，A1-A15 全部 passed，未发现实现缺口。
