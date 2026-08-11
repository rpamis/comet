---
name: comet-github
description: 将 Comet GitHub 维护请求路由到基于证据的 PR 审阅、Issue 分诊、本地想法收集、CI 诊断或 Issue 实施流程。用户提到 Comet GitHub Issue/PR 但未指定流程，或询问下一步如何处理时使用。
disable-model-invocation: true
---

# Comet GitHub

将本 Skill 作为 Comet GitHub 工作的明确入口。路由前先读取[共享维护者契约](references/maintainer-contract.md)。

## 按意图路由

- “审阅 PR / 看这个 PR” → `comet-github-pr-review`
- “看下这个 Issue 是否成立 / 是不是 Bug” → `comet-github-issue-triage`
- “把这个本地想法提成 Issue” → `comet-github-idea-to-issue`
- “CI 有报错 / 哪个 job 失败了” → `comet-github-ci-triage`
- “按照这个 Issue 修复” → `comet-github-issue-fix`

如果请求同时包含审阅和修复，先完成只读诊断，再说明建议交接到哪个流程。不得从分析阶段无声地跨入代码修改或 GitHub 写操作。

## 共享路由规则

1. 确认仓库、Issue/PR 编号或 URL、当前本地分支以及用户要求的操作级别。
2. 在依赖复制来的评论、旧 CI 结果或记忆中的 SHA 前，先刷新 GitHub 实时状态。
3. 将证据、诊断、建议动作和已完成动作分开报告。
4. 明确报告不确定性：已确认、可能成立、证据不足、已阻塞或未验证。
5. 默认只读。评论、改标签、关闭 Issue、创建 Issue、提交、推送或创建 PR 都需要明确授权。

## 交接输出

返回简短的路由决定、选中的 Skill、支持该路由的证据以及下一步安全动作。保留用户指定的范围，不要把生成的草稿当作已经发布到 GitHub 的变更。
