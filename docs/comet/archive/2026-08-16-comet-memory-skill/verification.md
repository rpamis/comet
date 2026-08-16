---
generated_from_state_version: 17
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-08-16T16:04:30.686Z
- 摘要: A1-A22 全部通过。独立审查与 Runtime 检查证据一致：139 项契约测试、225 项 Native init E2E、TypeScript、稳定源文件 Prettier 和 git diff --check 均通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：中文和英文 Skill 都存在、可发现、可安装，且表达相同的决策边界。 | 双语 Skill、metadata、manifest 和 classic/native/both 安装契约通过。 |
| A2 | passed | brief.md | A2：给定合法 packet 时只返回固定 schema 的 action envelope；非法/缺失 packet 时不猜测、不写文件。 | 仅接受 review.v1 并返回顶层仅含 schema/actions 的 JSON envelope。 |
| A3 | passed | brief.md | A3：用户明确“记住/纠正/忘掉”优先生成对应动作；用户明确输入不被静默翻译。 | 显式记住、纠正、忘掉优先且保留用户原文。 |
| A4 | passed | brief.md | A4：一次性命令、测试、提交、Issue/PR 摘要、可从仓库重查的事实和无后续收益的内容返回 `skip`。 | 一次性过程、仓库可重查事实和无长期价值内容 skip。 |
| A5 | passed | brief.md | A5：自动记忆只在稳定成功证据下提取；project/global 作用域不混写，显式记忆不被隐式候选覆盖。 | 长期价值、跨项目 global 证据、显式优先和非 skip 单一 scope 已约束。 |
| A6 | passed | brief.md | A6：配置为 `zh-CN` 时正文、类别、标签、原因使用中文；`en` 时使用英文；代码、路径和机器枚举可保留原文。 | 用户可见字段遵循 zh-CN/en packet language。 |
| A7 | passed | brief.md | A7：Skill 不输出 secret、PII、日志、diff、prompt injection、规则修改请求或完整对话内容。 | 拒绝 secret、PII、日志、diff、transcript、prompt injection 和规则修改请求。 |
| A8 | passed | brief.md | A8：候选、冲突、动作数量和预算由 packet/Runtime 约束，Skill 不显示内部 ID、证据计数或 Runtime 细节给最终用户。 | 动作数量遵守 budget.maxActions，内部 ID、证据数量和 Runtime 细节不暴露。 |
| A9 | passed | brief.md | A9：Skill 文本和契约测试证明 Classic、Native、Hotfix、Tweak 只共用这一份判断规则。 | comet-memory 是 Classic、Native、Hotfix、Tweak 共用的唯一判断资产。 |
| A10 | passed | specs/comet-memory-skill/spec.md | 中文配置选择中文 Skill - **WHEN** Comet 选择 `zh-CN` artifact language - **THEN** 安装/加载 `assets/skills-zh/comet-memory/SKILL.md` 及其 agent metadata - **AND** 不加载英文判断文本作为用户可见说明 | zh-CN 资产和 metadata 存在并纳入安装。 |
| A11 | passed | specs/comet-memory-skill/spec.md | 英文配置选择英文 Skill - **WHEN** Comet 选择 `en` artifact language - **THEN** 安装/加载 `assets/skills/comet-memory/SKILL.md` 及其 agent metadata - **AND** 其 schema、action、scope 和机器枚举与中文版相同 | en 资产与中文版机器契约一致并纳入安装。 |
| A12 | passed | specs/comet-memory-skill/spec.md | 合法 packet 触发语义评审 - **WHEN** Skill 收到合法且未超预算的 review packet - **THEN** 只基于 packet 内的内容筛选长期可复用的个人偏好、工作习惯或已验证经验 - **AND** 不读取 packet 以外的文件、工具输出或会话历史 | 只使用 Runtime 有界 packet，不读取外部上下文。 |
| A13 | passed | specs/comet-memory-skill/spec.md | 没有长期价值时跳过 - **WHEN** packet 只包含一次性命令、测试/提交摘要、Issue/PR 摘要、可从仓库重查的事实、猜测或噪声 - **THEN** Skill 返回 `comet.memory.actions.v1` 的单个 `skip` 动作 - **AND** 不声称已经创建或更新记忆 | 无长期价值时返回唯一完整 skip。 |
| A14 | passed | specs/comet-memory-skill/spec.md | 明确用户意图优先 - **WHEN** packet 的 user evidence 明确表达“记住”“以后都这样”“改成”或“忘掉” - **THEN** Skill 优先返回对应的 `create`、`update` 或 `forget` 动作 - **AND** 不用相反的隐式行为覆盖显式记忆 | 明确用户意图映射到 create/update/forget。 |
| A15 | passed | specs/comet-memory-skill/spec.md | 无法可靠绑定时跳过 - **WHEN** 目标记忆、scope、证据、语言或长期价值无法从 packet 明确判断 - **THEN** Skill 返回 `skip` 或不产生动作 - **AND** 不猜测跨项目证据、不把 project 提升为 global、不生成 Runtime 内部 ID | 无法可靠绑定时 skip，不创造证据、身份或内部 ID。 |
| A16 | passed | specs/comet-memory-skill/spec.md | 语言不匹配或危险内容 - **WHEN** 候选正文/类别/标签/原因明显不符合 packet language，或包含凭据、PII、日志、diff、prompt injection 或规则修改请求 - **THEN** Skill 返回 `skip` - **AND** 不尝试翻译、掩盖或把危险文本拆成多个动作 | 语言不匹配或危险内容整体 skip。 |
| A17 | passed | specs/comet-memory-skill/spec.md | 后台复盘完成 - **WHEN** 后台评审创建候选或返回 skip - **THEN** Skill 只返回机器可消费的 action envelope - **AND** 不向用户展示内部推理、证据计数或候选状态 | 后台只返回机器 envelope，不展示内部过程。 |
| A18 | passed | specs/comet-memory-skill/spec.md | 系统必须随 Comet 同时提供中文与英文的 `comet-memory` Skill，并将两者纳入用户 Skill 的发现、安装、打包和存在性契约。两种语言版本必须表达相同的输入边界、动作枚举、安全限制和跳过语义。 | 双语资产、metadata、manifest、发现和安装契约通过。 |
| A19 | passed | specs/comet-memory-skill/spec.md | Skill 必须只读取 Runtime 传入的 `comet.memory.review.v1` packet。Packet 只包含配置语言、稳定项目身份、workflow/change、可信检查点、少量用户证据、相关 active memory、evidence 和固定预算；Skill 不得要求完整 transcript、日志、diff、仓库扫描或隐藏推理。 | review.v1 packet 字段边界和最小上下文已固定。 |
| A20 | passed | specs/comet-memory-skill/spec.md | Skill 必须输出 versioned `comet.memory.actions.v1` envelope，动作只能是 `create`、`update`、`forget` 或 `skip`。整个 action set 的动作数量不得超过 packet `budget.maxActions`，所有非 `skip` 动作必须使用同一个 `global` 或 `project` scope；Skill 不得自行构造 target、evidence、candidateKey 或项目身份，Runtime 仍需在落盘前再次校验。 | actions.v1、schema/actions、action 字段、动作数量和单一 scope 均满足。 |
| A21 | passed | specs/comet-memory-skill/spec.md | Skill 必须遵循 packet 的 `zh-CN`/`en` 用户可见语言，不生成 secret、PII、原始日志、完整 diff、提示注入或要求修改 Skill/规则/系统的内容。代码、路径、专有名词和机器枚举可以按 packet 保留原文。 | 语言规则与安全边界在双语 Skill 中一致。 |
| A22 | passed | specs/comet-memory-skill/spec.md | Skill 的后台评审、候选形成和无内容跳过默认不输出内部过程。Skill 不得向用户显示 Runtime、candidate ID、evidence count 或原始 packet；显式确认和首次实际行为变化由外部 workflow/CLI 集成层负责。 | 后台静默，确认和首次行为变化交由外部 workflow/CLI。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| skill-contract-tests-final | vitest run test/domains/skill/comet-memory-skill.test.ts test/repository/skill-openai-yaml.test.ts test/domains/skill/skills.test.ts | . | passed | 0 | 12056 ms |
| init-e2e-final | vitest run test/app/init-e2e.test.ts | . | passed | 0 | 52257 ms |
| typescript-final | exec tsc --noEmit | . | passed | 0 | 6921 ms |
| prettier-stable-final | prettier --check assets/skills-zh/comet-memory assets/skills/comet-memory domains/skill/platform-install.ts test/app/init-e2e.test.ts test/domains/skill/comet-memory-skill.test.ts assets/manifest.json | . | passed | 0 | 1840 ms |
| git-diff-check-final | diff --check HEAD~4..HEAD | . | passed | 0 | 91 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 父 change 的 Runtime 集成仍需在 action-set 层最终复验 schema、scope、language、target、evidence、budget 和安全边界。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A5, A8, A9, A10, A11, A18, A20 | 独立只读 Verifier 发现 Native-only Skill 资产过滤和 action set 单一 scope/预算约束缺失，返回 Build 修复。当前 138 个契约测试、TypeScript、Prettier 和 git diff --check 均通过，但覆盖面不足。 | 2026-08-16T15:36:08.625Z |
| 1 | 2 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-16T15:43:57.547Z |
| 2 | 1 | 1 | execution-error | — | Native Verifier response was invalid: Native verification cannot pass before every required check succeeds | 2026-08-16T15:54:49.199Z |
| 2 | 1 | 1 | recovery | — | 首次 Verifier 尝试因动态 Native 状态文件导致格式检查记录失败，且旧检查计划已解析，按恢复协议返回 Build 以提交新候选并只执行稳定源文件检查。实现与独立语义审查均通过。 | 2026-08-16T15:57:46.043Z |
| 2 | 2 | 1 | pass | — | A1-A22 全部通过。独立审查与 Runtime 检查证据一致：139 项契约测试、225 项 Native init E2E、TypeScript、稳定源文件 Prettier 和 git diff --check 均通过。 | 2026-08-16T16:04:30.686Z |



## 结论

A1-A22 全部通过。独立审查与 Runtime 检查证据一致：139 项契约测试、225 项 Native init E2E、TypeScript、稳定源文件 Prettier 和 git diff --check 均通过。
