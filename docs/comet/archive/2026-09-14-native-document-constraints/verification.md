---
generated_from_state_version: 16
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 3
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-09-14T15:56:57.702Z
- 摘要: Independent read-only verification passed all 15 acceptance items. The remove-only false positive, previously declared missing Spec bypass, and reject-repair-retry evidence gaps are fixed. Runtime checks, generated assets, formatting, lint, and focused Native suites passed.

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | brief 缺失、缺少必需章节、章节为空或只含模板占位内容时，Shape 准备确认被阻止，并返回对应路径、章节及补齐方式；有效的中文和英文文档均可通过。 | Strict brief validation and actionable Shape rejection are covered by focused tests. |
| A2 | passed | brief.md | brief 的非目标、决策或待解决问题确实为空时，可以用明确的无相关事项说明表达；真实阻塞问题仍阻止确认。 | Explicit no-item statements are accepted while blocking content remains rejected. |
| A3 | passed | brief.md | 没有目标 Spec 且没有适用的明确豁免理由时不能确认 Shape；不改变产品行为的工作可以记录理由后豁免，能力删除继续使用正式删除声明。 | Formal remove-only changes are accepted without an unnecessary exemption; missing exemptions remain blocked. |
| A4 | passed | brief.md | 已声明的 Spec 缺失、为空或仍为模板占位时不能完成 Shape；确认准备之后发生的文档变化不能沿用过期确认进入 Build。 | Previously declared target Specs cannot disappear from discovered changes or be hidden by an exemption. |
| A5 | passed | brief.md | Hook 能明确归属于当前 change 的正式文档写入若指向错误位置，则拒绝并提示配置决定的正确路径；正确路径允许按现有正式产物规则编辑。 | Formal target source path validation reports the configured path. |
| A6 | passed | brief.md | 普通项目文档不会仅因名为 brief.md 或 spec.md 被拦截；缺少可归属写入事件时，Runtime 仍独立执行阶段文档检查。 | Checks are bound to discovered formal change artifacts rather than arbitrary filenames. |
| A7 | passed | brief.md | 自定义 artifact_root 下的检查和纠错路径与默认目录一致遵循项目配置，不硬编码 docs；多文件写入继续整体裁决。 | Validation resolves through configured Native project paths. |
| A8 | passed | brief.md | 升级前已确认并处于 Build、Verify 或待归档状态的需求保留进度，不仅因新文档规范被追溯阻塞；新建需求及旧需求重新确认 Shape 时必须满足新约束，已归档需求保持兼容。 | The constraint marker is applied at new or reconfirmed Shape while legacy later-phase state remains compatible. |
| A9 | passed | brief.md | 完整合法的文档可经过用户确认正常进入 Build；状态、报告仍由 Runtime 管理，需求变化与候选失效继续遵循现有机制。 | Valid documents proceed through the existing Runtime-managed Shape transition. |
| A10 | passed | brief.md | Build 提交候选前检查适用新约束的正式文档；缺失、为空或位置错误时拒绝候选，但必须允许补写或返回正确阶段修复。 | Build rechecks marked changes and returns actionable repair errors. |
| A11 | passed | brief.md | Verify 接受通过结论前核对正式文档、已确认需求与候选的一致性；文档漂移不能沿用旧通过结论，语义遗漏仍由独立 Verifier 判断。 | Verify drift inspection revalidates marked formal documents. |
| A12 | passed | brief.md | Archive 核对文档、当前验收结论和待发布 Spec；缺失或过期的 verification.md 由 Runtime 从有效状态重建，修复后可重试归档。 | Archive inspection revalidates marked formal documents before finalization. |
| A13 | passed | brief.md | 恢复任务时明确当前阶段、正确文档路径、缺失项和可执行的下一动作。 | Failure messages identify the formal path and the resumable continuation action. |
| A14 | passed | brief.md | 每类新增阻塞必须通过“触发拒绝、按提示修复、重试成功”的回归验证，不要求手改 Runtime 状态或绕过 Hook。 | Focused regression coverage now exercises reject-repair-retry for exemption, missing target content, and formal path blockers. |
| A15 | passed | brief.md | 恢复动作可以安全重试并保留已有工作，不能出现“先修复才允许返回修复阶段”的循环依赖。 | Recovery preserves Runtime state and directs repair without requiring state edits or Hook bypass. |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Native document-constraint regression tests after repair | exec vitest run test/domains/comet-native/native-document-constraints.test.ts | . | passed | 0 | 7360 ms |
| Native Archive regression tests after repair | exec vitest run test/domains/comet-native/native-portable-archive.test.ts | . | passed | 0 | 82895 ms |
| Native Runtime artifacts and Hook regression tests after repair | exec vitest run test/domains/comet-native/native-artifacts.test.ts test/domains/comet-native/native-portable-runtime.test.ts test/domains/comet-native/native-hook-guard.test.ts | . | passed | 0 | 80173 ms |
| Native document format checks after repair | exec prettier --check domains/comet-native/native-artifacts.ts domains/comet-native/native-next-command.ts domains/comet-native/native-portable-archive.ts domains/comet-native/native-portable-requirements.ts domains/comet-native/native-portable-runtime.ts domains/comet-native/native-portable-state.ts domains/comet-native/native-portable-types.ts test/domains/comet-native/native-document-constraints.test.ts assets/skills-zh/comet-native/SKILL.md assets/skills/comet-native/SKILL.md CHANGELOG.md docs/comet/changes/native-document-constraints/brief.md docs/comet/changes/native-document-constraints/specs/native-document-constraints/spec.md | . | passed | 0 | 2164 ms |
| Native lint and architecture checks after repair | lint | . | passed | 0 | 12139 ms |
| Generated Native and Entry Runtime consistency after repair | check:generated | . | passed | 0 | 2055 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- Native document-constraint regression tests: passed — Focused Vitest: 7 tests passed, including remove-only, missing declared Spec, and reject-repair-retry coverage.
- Native Archive regression tests: passed — Focused Vitest: 23 tests passed.
- Native Runtime, artifacts, and Hook regression tests: passed — Focused Vitest: 67 tests passed across artifacts, portable Runtime, and Hook Guard.
- Native document format checks: passed — Prettier check passed for changed source, tests, Skills, changelog, and formal change documents.
- Native lint and architecture checks: passed — pnpm lint passed, including architecture lint.
- Generated Runtime consistency: passed — Native and Entry Runtime rebuilt; pnpm check:generated passed.
- 已知限制: Real host Hook execution and model-based independent semantic verification were not run in this local Builder turn.
- 已知限制: The earlier Windows orphaned Runtime-process timing test exceeded its wait budget; the focused Runtime and Hook regression rerun passed 67 tests.

## 阻塞项

_无。_

## 风险与跳过的工作

- Real host Hook execution, published package installation, and model-based semantic Eval were not run.
- The earlier Windows orphaned Runtime-process timing test exceeded its wait budget; the current focused Runtime and Hook rerun passed 67 tests.

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 0 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-14T14:47:14.540Z |
| 2 | 1 | 0 | recovery | — | Native Shape artifacts changed | 2026-09-14T15:15:52.106Z |
| 3 | 1 | 1 | fail | A3, A4, A14 | Independent verification found three recoverable gaps in the document constraint implementation: remove-only changes, missing previously declared Specs, and incomplete reject-repair-retry regression evidence. Related local checks passed, but the candidate must return to Build for correction. | 2026-09-14T15:44:03.562Z |
| 3 | 2 | 1 | pass | — | Independent read-only verification passed all 15 acceptance items. The remove-only false positive, previously declared missing Spec bypass, and reject-repair-retry evidence gaps are fixed. Runtime checks, generated assets, formatting, lint, and focused Native suites passed. | 2026-09-14T15:56:57.702Z |



## 结论

Independent read-only verification passed all 15 acceptance items. The remove-only false positive, previously declared missing Spec bypass, and reject-repair-retry evidence gaps are fixed. Runtime checks, generated assets, formatting, lint, and focused Native suites passed.
